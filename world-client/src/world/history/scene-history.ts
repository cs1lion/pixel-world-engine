/** 只读回溯：每天一份补丁，每 30 天一份全量；给定世界日，还原那一天。
 *
 * ## 为什么是「30 天全量 + 每日字段级补丁」
 *
 * | 方案 | 一年存储（3 人基线） | 还原一天 |
 * | --- | --- | --- |
 * | 每天全量 | ≈756MB–4.5GB | 解析一份，最快 |
 * | 纯事件溯源 | ≈1–2MB | 从第 0 天重放，实测 365 天要 168s |
 * | **30 天全量 + 每日补丁** | **≈28MB** | 解析基准 + 应用 ≤30 份补丁 |
 *
 * 补丁必须是**状态差**（改了哪些字段），不是「当天的事件重放」——后者会把还原
 * 速度退回事件溯源。线是 `patch.ts` 的 `diffDoc`。
 *
 * ## 为什么写档不在关账主路径上
 *
 * `dayClosed` 一年后会涨到几百毫秒（这一版已把平方项修掉，400 天实测 76ms）。
 * 如果每天再在主路径上 `JSON.stringify` 整份记忆，那一笔就直接压在关账上。
 * 所以记录器只做两件便宜事：把**当天的快照对象**拿住（引用），把差分的活
 * 排进队列；真正的 `stringify` / `diff` / IndexedDB 写在队列里跑，不占关账那一帧。
 *
 * ## 离线缺日：如实标「没有记录」
 *
 * 页面关着的时候世界不跑，那些天没有真实状态。记录器只标 `missing`，
 * **不拿前后两天插值、不拿今天的楼倒推**。回溯到那一天会明确说「没有记录」。
 */

import { MemoryRuntime } from '../memory/runtime.ts';
import type { MemoryEntry, TurningPoint } from '../memory/types.ts';
import type { WorldSave as SaveDoc } from '../save.ts';
import { applyOps, diffDoc, type HistoryDoc } from './patch.ts';
import type { HistoryDay, HistoryStore } from './store.ts';

/** 全量快照的间隔。30 天：还原最多叠 29 份补丁，而一年的全量只有 12 份。 */
export const BASE_INTERVAL_DAYS = 30;

export interface SceneHistoryOptions {
  readonly worldId: string;
  readonly store: HistoryStore;
  /** 记录器自己出的错（写失败 / 读失败）走这儿；调用方据此提示，不抛。 */
  readonly onError?: (message: string) => void;
}

/** 回溯里「一个角色记得什么」的那几行。只给摘要，不给全库。 */
export interface RewindMemoryLine {
  readonly memoryId: string;
  readonly day: number;
  readonly kind: string;
  readonly what: string;
  readonly sourceMode: string;
}

export interface RewindCharacter {
  readonly holderId: string;
  readonly name: string | null;
  readonly memories: readonly RewindMemoryLine[];
  readonly beliefCount: number;
  readonly turningPoints: readonly TurningPoint[];
}

export interface RewindPlace {
  readonly placeId: string;
  readonly name: string;
  readonly state: string;
  readonly phases: readonly { readonly day: number; readonly state: string; readonly note: string }[];
  readonly hints: readonly { readonly layer: string; readonly visibility: number }[];
  readonly absent: string | null;
}

export interface RewindResult {
  readonly day: number;
  readonly missing: boolean;
  /** 那天的世界存档（`world.memory` 留空；记忆视图在上面的 `characters`）。 */
  readonly save: SaveDoc | null;
  readonly memorySchemaVersion: number | null;
  readonly eraLabel: string | null;
  readonly characters: readonly RewindCharacter[];
  readonly places: readonly RewindPlace[];
}

/** 每一天一条记录的摘要（给时间轴）。 */
export interface RecordedDay {
  readonly day: number;
  readonly kind: HistoryDay['kind'];
}

export class SceneHistory {
  private readonly worldId: string;
  private readonly store: HistoryStore;
  private readonly onError: (message: string) => void;
  private readonly everyDays: number;
  private lastDoc: HistoryDoc | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly recorded = new Map<number, HistoryDay['kind']>();

  constructor(options: SceneHistoryOptions & { readonly everyDays?: number }) {
    this.worldId = options.worldId;
    this.store = options.store;
    this.onError = options.onError ?? (() => {});
    this.everyDays = options.everyDays ?? BASE_INTERVAL_DAYS;
  }

  /**
   * 记下「这一天结束时的世界」。**同步只做引用赋值**，差分与写库排进队列。
   *
   * 调用点在关账之后一帧内；它不再序列化任何整档。
   */
  capture(day: number, doc: HistoryDoc): void {
    const previous = this.lastDoc;
    this.lastDoc = doc;
    const isBase = previous === null || day - previous.day !== 1 || day % this.everyDays === 0;
    this.recorded.set(day, isBase ? 'base' : 'patch');
    this.queue = this.queue
      .then(async () => {
        if (isBase) {
          await this.store.putBase(day, JSON.stringify(doc));
          return;
        }
        const ops = diffDoc(previous, doc);
        await this.store.putPatch(day, ops);
      })
      .catch((error: unknown) => {
        this.recorded.delete(day);
        this.onError(error instanceof Error ? error.message : String(error));
      });
  }

  /** 这一天没有记录（页面没开着 / 一次补算了多天）。明确标出来，不假装有。 */
  markMissing(day: number): void {
    this.recorded.set(day, 'missing');
    this.queue = this.queue
      .then(async () => {
        await this.store.putMissing(day);
      })
      .catch((error: unknown) => {
        this.onError(error instanceof Error ? error.message : String(error));
      });
  }

  /** 已有记录的日子的清单（内存里那份，给时间轴用；不查库）。 */
  days(): readonly RecordedDay[] {
    return [...this.recorded.entries()]
      .map(([day, kind]) => ({ day, kind }))
      .sort((a, b) => a.day - b.day);
  }

  /** 等队列写完。只有测试与「点回溯之前」需要它；正常玩法不等。 */
  async flush(): Promise<void> {
    await this.queue;
  }

  /**
   * 给定世界日，还原那一天的只读视图。
   *
   * **不碰活动的世界**：新建一台 `MemoryRuntime`，从快照复原；世界存档只是一份
   * 克隆出来的对象。调用方拿到的任何东西改回去都影响不到主档。
   */
  async rewind(day: number): Promise<RewindResult> {
    await this.flush();
    const base = await this.store.latestBase(day);
    if (base === undefined) return missingResult(day);
    let doc: HistoryDoc;
    try {
      doc = JSON.parse(base.text) as HistoryDoc;
    } catch {
      return missingResult(day);
    }
    for (let cursor = base.day + 1; cursor <= day; cursor += 1) {
      const patch = await this.store.getPatch(cursor);
      if (patch === undefined) return missingResult(day);
      applyOps(doc, patch.ops);
    }
    return this.viewOf(day, doc);
  }

  private viewOf(day: number, doc: HistoryDoc): RewindResult {
    const runtime = new MemoryRuntime({ worldId: this.worldId });
    if (!runtime.fromSnapshot(doc.memory)) return missingResult(day);
    const eras = runtime.eras();
    const eraLabel = eras.length === 0 ? null : eras[eras.length - 1]!.label;
    const characters: RewindCharacter[] = [];
    for (const holder of doc.memory.world.holders) {
      if (holder.type !== 'character') continue;
      const view = runtime.viewOf(holder.holderId);
      if (view === null) continue;
      characters.push({
        holderId: holder.holderId,
        name: holderName(doc.save, holder.holderId),
        memories: summariseMemories(view.memories),
        beliefCount: view.beliefs.length,
        turningPoints: view.turningPoints,
      });
    }
    const places: RewindPlace[] = [];
    for (const landmark of runtime.landmarks()) {
      const chronicle = runtime.placeChronicle(landmark.placeId);
      if (chronicle === null) continue;
      places.push({
        placeId: chronicle.placeId,
        name: chronicle.name,
        state: chronicle.state,
        phases: chronicle.phases.map((phase) => ({
          day: phase.day,
          state: phase.state,
          note: phase.note,
        })),
        hints: chronicle.hints.map((hint) => ({ layer: hint.layer, visibility: hint.visibility })),
        absent: chronicle.absent === null ? null : chronicle.absent.text,
      });
    }
    return {
      day,
      missing: false,
      // 世界里那段记忆字符串留空：它在这儿没有读者，而整份字符串会让历史翻倍。
      save: { ...doc.save, world: { ...doc.save.world, memory: '' } },
      memorySchemaVersion: doc.memory.memorySchemaVersion,
      eraLabel,
      characters,
      places,
    };
  }
}

function missingResult(day: number): RewindResult {
  return {
    day,
    missing: true,
    save: null,
    memorySchemaVersion: null,
    eraLabel: null,
    characters: [],
    places: [],
  };
}

/** 角色的显示名来自那天的世界存档，不从记忆层猜。 */
function holderName(save: SaveDoc, holderId: string): string | null {
  const villager = save.world.villagers.find((item) => item.id === holderId);
  return villager === undefined ? null : villager.name;
}

/** 一个人那天记得的事：最近 5 条，按天与 id 倒序。只读摘要，不扫全库。 */
function summariseMemories(memories: readonly MemoryEntry[]): readonly RewindMemoryLine[] {
  return [...memories]
    .sort((a, b) => b.createdDay - a.createdDay || (a.memoryId < b.memoryId ? 1 : -1))
    .slice(0, 5)
    .map((entry) => ({
      memoryId: entry.memoryId,
      day: entry.createdDay,
      kind: entry.kind,
      what: entry.content.what,
      sourceMode: entry.sourceMode,
    }));
}
