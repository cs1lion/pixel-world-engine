/** 造物账本的 HTTP 运输：只做搬运与形状校验，不做判决。
 *
 * 账本文件在服务端（`data/creation-ledger/<worldId>.jsonl`），浏览器不直接
 * 写盘。与 `events-client.ts` / `memory-client.ts` 同一套纪律：
 *   - 失败返回 `ok: false`，不抛——账本写失败不该让世界停摆；
 *   - 不重试单条请求；重试交给出队器，**同一条记录复用同一个 `recordId`**，
 *     服务端据此去重；
 *   - 成功才出队，失败留着下一拍再试。
 *
 * 出队器与 `memory-client.ts` 的 `createMemoryOutbox` 同形：空队不请求、
 * 同一时刻只有一条在途、成功才出队。区别是造物很少，所以场景每次入队后
 * 立刻 `flush()`，不攒到自动存档那一刻。
 */

import type {
  LedgerRecord,
  StoredLedgerRecord,
  GateName,
  FoldedCreationEntry,
} from './ledger.ts';
import { foldLedger } from './ledger.ts';
import {
  LEDGER_QUEUE_MAX_BYTES,
  LEDGER_QUEUE_MAX_ITEMS,
  LEDGER_QUEUE_VERSION,
  ledgerQueueBytes,
  type LedgerQueueStorage,
} from './ledger-queue.ts';

export const CREATION_LEDGER_APPEND_URL = '/api/creation-ledger/entries';
export const CREATION_LEDGER_LIST_URL = '/api/creation-ledger/entries';
export const CREATION_LEDGER_TIMEOUT_MS = 5000;

export type LedgerAppendResult =
  | { readonly ok: true; readonly record: StoredLedgerRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

export interface LedgerListQuery {
  readonly worldId: string;
  readonly day?: number;
  readonly template?: string;
  readonly reject?: GateName;
}

export interface LedgerListPage {
  readonly entries: readonly StoredLedgerRecord[];
  readonly count: number;
  readonly bytes: number;
  /** 读取端折好的「每件造物一条」；服务端不做这个折叠，客户端自己折。 */
  readonly folded: readonly FoldedCreationEntry[];
}

export type LedgerListResult =
  | { readonly ok: true; readonly page: LedgerListPage }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

export interface CreationLedgerClient {
  append(record: LedgerRecord): Promise<LedgerAppendResult>;
  list(query: LedgerListQuery): Promise<LedgerListResult>;
}

export interface CreationLedgerClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly appendUrl?: string;
  readonly listUrl?: string;
}

export function createCreationLedgerClient(
  options: CreationLedgerClientOptions = {},
): CreationLedgerClient {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? CREATION_LEDGER_TIMEOUT_MS;
  const appendUrl = options.appendUrl ?? CREATION_LEDGER_APPEND_URL;
  const listUrl = options.listUrl ?? CREATION_LEDGER_LIST_URL;

  return {
    async append(record: LedgerRecord): Promise<LedgerAppendResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(appendUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(record),
            signal: controller.signal,
          });
        } catch (error) {
          const why = controller.signal.aborted ? `超时 ${timeoutMs}ms` : errorText(error);
          return { ok: false, reason: `造物账本不可达：${why}`, status: null };
        }
        if (!response.ok) {
          return {
            ok: false,
            reason: `造物账本返回 ${response.status}`,
            status: response.status,
          };
        }
        const body = await safeJson(response);
        if (body === null) {
          return { ok: false, reason: '造物账本响应不是 JSON', status: response.status };
        }
        const parsed = parseAppend(body);
        if (parsed === null) {
          return { ok: false, reason: '造物账本响应形状不对', status: response.status };
        }
        return parsed;
      } finally {
        clearTimeout(timer);
      }
    },

    async list(query: LedgerListQuery): Promise<LedgerListResult> {
      if (query.worldId.trim() === '') {
        return { ok: false, reason: '查询账本要给 worldId', status: null };
      }
      const params = new URLSearchParams({ worldId: query.worldId });
      if (query.day !== undefined) params.set('day', String(query.day));
      if (query.template !== undefined) params.set('template', query.template);
      if (query.reject !== undefined) params.set('reject', query.reject);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${listUrl}?${params.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          });
        } catch (error) {
          const why = controller.signal.aborted ? `超时 ${timeoutMs}ms` : errorText(error);
          return { ok: false, reason: `造物账本不可达：${why}`, status: null };
        }
        if (!response.ok) {
          return {
            ok: false,
            reason: `造物账本返回 ${response.status}`,
            status: response.status,
          };
        }
        const body = await safeJson(response);
        if (body === null) {
          return { ok: false, reason: '造物账本响应不是 JSON', status: response.status };
        }
        const parsed = parseList(body);
        if (parsed === null) {
          return { ok: false, reason: '造物账本响应形状不对', status: response.status };
        }
        return { ok: true, page: { ...parsed, folded: foldLedger(parsed.entries) } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * 出队器：一次只交一条，成功才出队；队列本身**落盘**。
 *
 * 三条规矩：
 *   - 入队立刻 `flush()` 是场景的事——造物一天最多几次，不像记忆那样每拍都有；
 *   - 失败留在队里，并**马上写进 storage**；页面关掉再开，新出队器会把它们
 *     读回来接着发；
 *   - 容量有上限：超过 `maxItems` / `maxBytes` 时丢**最旧**的未发送记录，
 *     `dropped` 计数一起持久化，不把丢失藏起来。
 *
 * 去重键是 `recordId`：同一条记录重复入队只留一条。服务端还会再按同一个
 * id 去重，所以「重试」与「重复事件」都不会变成两条。
 */
export interface CreationLedgerOutbox {
  enqueue(record: LedgerRecord): void;
  readonly size: number;
  /** 因容量上限被丢掉的记录数。跨会话保留。 */
  readonly dropped: number;
  /** 队列当前占用的 UTF-8 字节数（与容量判定同一个口径）。 */
  readonly pendingBytes: number;
  /** 交一条。空队或上一条还没回来时返回 `null`。 */
  flush(): Promise<LedgerAppendResult | null>;
}

export interface CreationLedgerOutboxOptions {
  readonly storage?: LedgerQueueStorage | null;
  readonly maxItems?: number;
  readonly maxBytes?: number;
}

export function createCreationLedgerOutbox(
  client: CreationLedgerClient,
  options: CreationLedgerOutboxOptions = {},
): CreationLedgerOutbox {
  const storage = options.storage ?? null;
  const maxItems = options.maxItems ?? LEDGER_QUEUE_MAX_ITEMS;
  const maxBytes = options.maxBytes ?? LEDGER_QUEUE_MAX_BYTES;
  const queue: LedgerRecord[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let inFlight = false;

  /** 从存储恢复；重复 recordId 只留第一条，坏条目跳过。 */
  const restored = storage?.load() ?? null;
  if (restored !== null) {
    for (const record of restored.records) {
      if (seen.has(record.recordId)) continue;
      seen.add(record.recordId);
      queue.push(record);
    }
    dropped = restored.dropped;
  }

  /** 整份快照写回存储。写失败只影响持久化，不影响内存队列。 */
  const persist = (): void => {
    storage?.save({
      version: LEDGER_QUEUE_VERSION,
      records: [...queue],
      dropped,
    });
  };

  /**
   * 按上限裁剪。`start` 是「允许删的第一条」：有在途请求时传 1，
   * 别把正在 POST 的那条从脚下抽走。
   */
  const trim = (start: number): void => {
    while (queue.length > maxItems || ledgerQueueBytes(queue, dropped) > maxBytes) {
      if (queue.length <= start) break;
      const removed = queue.splice(start, 1)[0];
      if (removed === undefined) break;
      seen.delete(removed.recordId);
      dropped += 1;
    }
  };

  // 恢复出来的队列也可能超限（旧版本上限更小/写坏了），先裁一次再落盘。
  trim(0);
  persist();

  return {
    enqueue(record: LedgerRecord): void {
      if (seen.has(record.recordId)) return;
      seen.add(record.recordId);
      queue.push(record);
      trim(inFlight ? 1 : 0);
      persist();
    },
    get size(): number {
      return queue.length;
    },
    get dropped(): number {
      return dropped;
    },
    get pendingBytes(): number {
      return ledgerQueueBytes(queue, dropped);
    },
    async flush(): Promise<LedgerAppendResult | null> {
      if (inFlight) return null;
      const record = queue[0];
      if (record === undefined) return null;
      inFlight = true;
      try {
        const result = await client.append(record);
        if (result.ok && queue[0]?.recordId === record.recordId) {
          queue.shift();
          seen.delete(record.recordId);
          persist();
        }
        return result;
      } catch (error) {
        // 传输层不该抛；真抛了也当失败，留在队里。
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
          status: null,
        };
      } finally {
        inFlight = false;
        trim(0);
        persist();
      }
    },
  };
}

// ---------------------------------------------------------------- 形状校验

function parseAppend(value: unknown): LedgerAppendResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  if (typeof body['duplicate'] !== 'boolean') return null;
  const record = parseStored(body['record']);
  if (record === null) return null;
  return { ok: true, record, duplicate: body['duplicate'] };
}

function parseList(value: unknown): Omit<LedgerListPage, 'folded'> | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body['entries'])) return null;
  if (typeof body['count'] !== 'number' || typeof body['bytes'] !== 'number') return null;
  const entries: StoredLedgerRecord[] = [];
  for (const item of body['entries']) {
    const record = parseStored(item);
    if (record === null) return null;
    entries.push(record);
  }
  return { entries, count: body['count'], bytes: body['bytes'] };
}

function parseStored(value: unknown): StoredLedgerRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record['kind'] !== 'creation'
    && record['kind'] !== 'landing'
    && record['kind'] !== 'observation'
  ) {
    return null;
  }
  if (typeof record['recordId'] !== 'string' || record['recordId'] === '') return null;
  if (!Number.isInteger(record['seq']) || typeof record['recordedAt'] !== 'string') return null;
  return record as unknown as StoredLedgerRecord;
}

async function safeJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
