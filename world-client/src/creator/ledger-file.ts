/** 账本的本地文件存储：一行一条 JSONL，只追加。
 *
 * **为什么住在 `src/creator/` 却 import `node:fs`：** 它只给测试、验收脚本
 * 与离线工具用；浏览器生产路径走 `ledger-client.ts` 的 HTTP 端口。构建时
 * `index.html` 的 import 图走不到这里，所以 `vite build` 不会把它带进包。
 * 一旦有人从 `scenes/` 里 import 它，构建会立刻报 `node:fs` 解析失败——
 * 那是想要的失败，不是要兜住的失败。
 *
 * 三条保证：
 *
 * 1. **只追加**：没有 update / delete / rewrite 方法，也不暴露 `Path`。
 * 2. **序号单调**：`seq` 从文件里最后一个序号接着数，重启不从 1 重来。
 * 3. **时间不倒退**：`recordedAt` 取注入时钟，且新值不小于上一个写入值。
 *    世界时间可以因为「撤销日界对齐」回拨；账本的写盘时刻不该跟着倒退。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  parseLedgerJsonl,
  queryLedger,
  serializeLedgerRecord,
  type FoldedCreationEntry,
  type LedgerQuery,
  type LedgerRecord,
  type StoredLedgerRecord,
} from './ledger.ts';

export interface JsonlLedgerFileOptions {
  /** 写盘时刻的时钟。测试注入一个单调的假时钟。 */
  readonly clock?: () => Date;
}

export interface AppendOutcome {
  readonly record: StoredLedgerRecord;
  readonly duplicate: boolean;
}

export class JsonlLedgerFile {
  readonly path: string;
  private readonly clock: () => Date;
  private loaded: StoredLedgerRecord[] | null = null;
  private readonly ids = new Map<string, StoredLedgerRecord>();
  private lastSeq = 0;
  private lastRecordedAt = '';

  constructor(path: string, options: JsonlLedgerFileOptions = {}) {
    this.path = path;
    this.clock = options.clock ?? (() => new Date());
  }

  /** 追加一条。`recordId` 已存在时原样返回旧的那一条，不写第二遍。 */
  append(record: LedgerRecord): AppendOutcome {
    this.ensureLoaded();
    const existing = this.ids.get(record.recordId);
    if (existing !== undefined) return { record: existing, duplicate: true };

    const stored: StoredLedgerRecord = {
      ...record,
      seq: this.lastSeq + 1,
      recordedAt: this.stamp(),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${serializeLedgerRecord(stored)}\n`, {
      encoding: 'utf-8',
      flag: 'a',
    });
    this.lastSeq = stored.seq;
    this.lastRecordedAt = stored.recordedAt;
    this.ids.set(stored.recordId, stored);
    this.loaded?.push(stored);
    return { record: stored, duplicate: false };
  }

  readAll(): StoredLedgerRecord[] {
    this.ensureLoaded();
    return [...this.loaded!];
  }

  query(query: LedgerQuery = {}): FoldedCreationEntry[] {
    return queryLedger(this.readAll(), query);
  }

  /** 文件真实字节数；文件不存在（还没写过）为 0。 */
  get bytes(): number {
    return existsSync(this.path) ? statSync(this.path).size : 0;
  }

  private ensureLoaded(): void {
    if (this.loaded !== null) return;
    const text = existsSync(this.path) ? readFileSync(this.path, 'utf-8') : '';
    const records = parseLedgerJsonl(text);
    for (const record of records) {
      this.ids.set(record.recordId, record);
      if (record.seq > this.lastSeq) this.lastSeq = record.seq;
      if (record.recordedAt > this.lastRecordedAt) this.lastRecordedAt = record.recordedAt;
    }
    this.loaded = records;
  }

  /** 写盘时刻。单调守卫：同一进程里绝不比上一条更早。 */
  private stamp(): string {
    const now = this.clock().toISOString();
    return now < this.lastRecordedAt ? this.lastRecordedAt : now;
  }
}
