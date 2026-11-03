/** 历史快照存哪儿：IndexedDB，一个世界一本库。
 *
 * **为什么不进主档。** 主档是 v5 单槽（`ADR_SAVE` 的 save-store 那一半），
 * 一份 v5 文档里已经有 `world.memory` 那一整段；把历史再塞进去，主档每次写盘
 * 都要重写 N 份历史，而 localStorage 的配额在一年左右就会被记忆本身吃满。
 * 历史是「读多写一份」的数据，IndexedDB 正是为这种体量准备的。
 *
 * **为什么按世界分库。** 两个设定集是两段互不相干的历史：`pwe-history:莞尔镇`
 * 与 `pwe-history:灯潮界` 各自一本。混在一个库里要靠键前缀过滤，而
 * `getAllKeys()` 会把另一个世界的历史也读出来——分库省掉这类错。
 *
 * 三张表：
 *
 * | 表 | 键 | 值 |
 * | --- | --- | --- |
 * | `bases` | 世界日 | 一整份 `HistoryDoc` 的 JSON 文本 |
 * | `patches` | 世界日 | 从上一日到这一日的字段级补丁 |
 * | `missing` | 世界日 | `1`（那一天**没有记录**，不近似重建） |
 *
 * 测试与 node 环境用 `MemoryHistoryStore`：同一个接口，两张 Map。
 * 生产环境没有 IndexedDB（极少数隐私模式）时，`createIdbHistoryStore` 返回
 * `null`，场景把历史功能整个关掉并在状态行说明——不让它半死不活。
 */

import type { DiffOp } from './patch.ts';

export interface StoredBase {
  readonly day: number;
  readonly text: string;
}

export interface StoredPatch {
  readonly day: number;
  readonly ops: readonly DiffOp[];
}

export type HistoryDayKind = 'base' | 'patch' | 'missing';

export interface HistoryDay {
  readonly day: number;
  readonly kind: HistoryDayKind;
}

export interface HistoryStore {
  putBase(day: number, text: string): Promise<void>;
  putPatch(day: number, ops: readonly DiffOp[]): Promise<void>;
  putMissing(day: number): Promise<void>;
  getBase(day: number): Promise<StoredBase | undefined>;
  /** 不晚于 `day` 的最近一份全量。没有就 `undefined`。 */
  latestBase(day: number): Promise<StoredBase | undefined>;
  getPatch(day: number): Promise<StoredPatch | undefined>;
  /** 有记录的日子的清单（全量 / 补丁 / 无记录）。按天升序。 */
  listDays(): Promise<readonly HistoryDay[]>;
}

/** 测试与降级用：两张 Map，语义与 IndexedDB 那份逐条对齐。 */
export class MemoryHistoryStore implements HistoryStore {
  private readonly bases = new Map<number, string>();
  private readonly patches = new Map<number, readonly DiffOp[]>();
  private readonly missing = new Set<number>();

  async putBase(day: number, text: string): Promise<void> {
    this.bases.set(day, text);
    this.missing.delete(day);
  }

  async putPatch(day: number, ops: readonly DiffOp[]): Promise<void> {
    this.patches.set(day, ops);
    this.missing.delete(day);
  }

  async putMissing(day: number): Promise<void> {
    this.missing.add(day);
    this.patches.delete(day);
  }

  async getBase(day: number): Promise<StoredBase | undefined> {
    const text = this.bases.get(day);
    return text === undefined ? undefined : { day, text };
  }

  async latestBase(day: number): Promise<StoredBase | undefined> {
    let best: number | undefined;
    for (const key of this.bases.keys()) {
      if (key > day) continue;
      if (best === undefined || key > best) best = key;
    }
    const text = best === undefined ? undefined : this.bases.get(best);
    return best === undefined || text === undefined ? undefined : { day: best, text };
  }

  async getPatch(day: number): Promise<StoredPatch | undefined> {
    const ops = this.patches.get(day);
    return ops === undefined ? undefined : { day, ops };
  }

  async listDays(): Promise<readonly HistoryDay[]> {
    const days: HistoryDay[] = [];
    for (const day of this.bases.keys()) days.push({ day, kind: 'base' });
    for (const day of this.patches.keys()) days.push({ day, kind: 'patch' });
    for (const day of this.missing) days.push({ day, kind: 'missing' });
    return days.sort((a, b) => a.day - b.day);
  }
}

const DB_PREFIX = 'pwe-history:';
const STORE_BASES = 'bases';
const STORE_PATCHES = 'patches';
const STORE_MISSING = 'missing';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

class IdbHistoryStore implements HistoryStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly worldId: string;

  constructor(worldId: string) {
    this.worldId = worldId;
  }

  private open(): Promise<IDBDatabase> {
    if (this.db !== null) return this.db;
    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`${DB_PREFIX}${this.worldId}`, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_BASES)) db.createObjectStore(STORE_BASES);
        if (!db.objectStoreNames.contains(STORE_PATCHES)) db.createObjectStore(STORE_PATCHES);
        if (!db.objectStoreNames.contains(STORE_MISSING)) db.createObjectStore(STORE_MISSING);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打不开'));
      request.onblocked = () => reject(new Error('IndexedDB 被另一个标签页占着'));
    });
    return this.db;
  }

  private async store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(name, mode).objectStore(name);
  }

  async putBase(day: number, text: string): Promise<void> {
    const bases = await this.store(STORE_BASES, 'readwrite');
    await requestToPromise(bases.put(text, day));
    const missing = await this.store(STORE_MISSING, 'readwrite');
    await requestToPromise(missing.delete(day));
  }

  async putPatch(day: number, ops: readonly DiffOp[]): Promise<void> {
    const patches = await this.store(STORE_PATCHES, 'readwrite');
    await requestToPromise(patches.put(ops, day));
    const missing = await this.store(STORE_MISSING, 'readwrite');
    await requestToPromise(missing.delete(day));
  }

  async putMissing(day: number): Promise<void> {
    const patches = await this.store(STORE_PATCHES, 'readwrite');
    await requestToPromise(patches.delete(day));
    const missing = await this.store(STORE_MISSING, 'readwrite');
    await requestToPromise(missing.put(1, day));
  }

  async getBase(day: number): Promise<StoredBase | undefined> {
    const bases = await this.store(STORE_BASES, 'readonly');
    const text = await requestToPromise(bases.get(day));
    return typeof text === 'string' ? { day, text } : undefined;
  }

  async latestBase(day: number): Promise<StoredBase | undefined> {
    const bases = await this.store(STORE_BASES, 'readonly');
    const keys = await requestToPromise(bases.getAllKeys()) as IDBValidKey[];
    let best: number | undefined;
    for (const key of keys) {
      const value = Number(key);
      if (!Number.isFinite(value) || value > day) continue;
      if (best === undefined || value > best) best = value;
    }
    if (best === undefined) return undefined;
    const text = await requestToPromise(bases.get(best));
    return typeof text === 'string' ? { day: best, text } : undefined;
  }

  async getPatch(day: number): Promise<StoredPatch | undefined> {
    const patches = await this.store(STORE_PATCHES, 'readonly');
    const ops = await requestToPromise(patches.get(day));
    return Array.isArray(ops) ? { day, ops: ops as readonly DiffOp[] } : undefined;
  }

  async listDays(): Promise<readonly HistoryDay[]> {
    const out: HistoryDay[] = [];
    for (const kind of ['base', 'patch', 'missing'] as const) {
      const name = kind === 'base' ? STORE_BASES : kind === 'patch' ? STORE_PATCHES : STORE_MISSING;
      const store = await this.store(name, 'readonly');
      const keys = await requestToPromise(store.getAllKeys()) as IDBValidKey[];
      for (const key of keys) {
        const day = Number(key);
        if (Number.isFinite(day)) out.push({ day, kind });
      }
    }
    return out.sort((a, b) => a.day - b.day);
  }
}

/**
 * 生产入口。没有 IndexedDB 就返回 `null`（调用方关掉历史），不抛。
 *
 * **开库是懒的**：构造这一步不做任何 I/O，第一次写才真开。场景在 `create()`
 * 里同步构造它，不必等一个 Promise；而写失败由记录器吞掉并降级。
 */
export function createIdbHistoryStore(worldId: string): HistoryStore | null {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return new IdbHistoryStore(worldId);
  } catch {
    return null;
  }
}
