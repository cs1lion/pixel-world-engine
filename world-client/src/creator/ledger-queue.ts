/** 造物账本的持久化出队队列。
 *
 * **为什么要有它。** 账本写失败时，记录原先只活在内存里；页面在 POST 成功前
 * 关掉，那几条就永远没了。账本是审计日志，丢一条等于那一次造物没有发生过。
 *
 * 这里的存储是**有界**的：最多 `LEDGER_QUEUE_MAX_ITEMS` 条、`LEDGER_QUEUE_MAX_BYTES`
 * 字节（按整份 JSON 算）。超限时丢**最旧**的未发送记录，并把 `dropped` 计数
 * 一起持久化——宁可少一条旧的，也不让队列无限长大把 localStorage 撑爆。
 *
 * **去重键是 `recordId`**：同一条记录重复入队只留一条；服务端再用同一个 id
 * 去重。这样「重试」与「重复事件」都不会在账本里变成两条。
 *
 * 浏览器里用 `localStorage`；测试/Node 用 `MemoryLedgerQueueStorage`。
 * 没有 localStorage（隐私模式/配额满）时返回 `null`，出队器退回内存队列。
 */

import type { LedgerRecord } from './ledger.ts';

export const LEDGER_QUEUE_VERSION = 1 as const;
export const LEDGER_QUEUE_KEY_PREFIX = 'pwe-creation-ledger-queue:v1';

/** 队列条数上限。超过就丢最旧的未发送记录。 */
export const LEDGER_QUEUE_MAX_ITEMS = 200;

/** 队列字节上限（整份 JSON，UTF-8）。256 KiB 约等于 100 条左右的大记录。 */
export const LEDGER_QUEUE_MAX_BYTES = 256 * 1024;

export interface LedgerQueueSnapshot {
  readonly version: typeof LEDGER_QUEUE_VERSION;
  readonly records: readonly LedgerRecord[];
  /** 已经因为容量上限被丢掉的记录数。跨会话保留，别把丢失藏起来。 */
  readonly dropped: number;
}

export interface LedgerQueueStorage {
  load(): LedgerQueueSnapshot | null;
  save(snapshot: LedgerQueueSnapshot): void;
}

/** 测试与 Node 用：一份内存快照，语义与 localStorage 那份逐条对齐。 */
export class MemoryLedgerQueueStorage implements LedgerQueueStorage {
  private snapshot: LedgerQueueSnapshot | null = null;

  load(): LedgerQueueSnapshot | null {
    return this.snapshot;
  }

  save(snapshot: LedgerQueueSnapshot): void {
    this.snapshot = {
      version: LEDGER_QUEUE_VERSION,
      records: [...snapshot.records],
      dropped: snapshot.dropped,
    };
  }
}

/**
 * 浏览器入口。没有 localStorage 就返回 `null`——调用方退回内存队列，
 * 不假装「已经持久化」。
 */
export function createLocalStorageLedgerQueue(
  worldId: string,
  storage?: Storage | null,
): LedgerQueueStorage | null {
  const target = storage
    ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (target === null) return null;
  const key = `${LEDGER_QUEUE_KEY_PREFIX}:${worldId}`;

  return {
    load(): LedgerQueueSnapshot | null {
      let raw: string | null;
      try {
        raw = target.getItem(key);
      } catch {
        return null;
      }
      if (raw === null || raw === '') return null;
      try {
        const parsed = JSON.parse(raw) as Partial<LedgerQueueSnapshot>;
        if (parsed.version !== LEDGER_QUEUE_VERSION || !Array.isArray(parsed.records)) {
          return null;
        }
        // 存储里若有重复（旧版本写坏/手工改过），在这里先按 recordId 去重。
        const seen = new Set<string>();
        const records: LedgerRecord[] = [];
        for (const record of parsed.records as LedgerRecord[]) {
          if (typeof record?.recordId !== 'string' || seen.has(record.recordId)) continue;
          seen.add(record.recordId);
          records.push(record);
        }
        return {
          version: LEDGER_QUEUE_VERSION,
          records,
          dropped: typeof parsed.dropped === 'number' && parsed.dropped >= 0
            ? parsed.dropped
            : 0,
        };
      } catch {
        return null;
      }
    },

    save(snapshot: LedgerQueueSnapshot): void {
      try {
        target.setItem(key, JSON.stringify(snapshot));
      } catch {
        // 配额满/隐私模式：这一次没写进去，内存队列还在。
        // 不在这里假装成功——下一次写会再试。
      }
    },
  };
}

/** 整份队列的 UTF-8 字节数；容量判定与「体积读数」用同一个口径。 */
export function ledgerQueueBytes(records: readonly LedgerRecord[], dropped = 0): number {
  const encoder = new TextEncoder();
  return encoder.encode(
    JSON.stringify({ version: LEDGER_QUEUE_VERSION, records, dropped }),
  ).length;
}
