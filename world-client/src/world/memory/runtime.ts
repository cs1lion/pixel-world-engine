/** 把记忆世界接到世界循环上：同步位置、收事件、跨日关账、抛出心电图。
 *
 * 这一层是**适配器**，不是又一个世界。它只做四件事：
 *
 * 1. `syncHolders()` —— 把这一刻谁站在哪喂进去（传播要算距离）；
 * 2. `observe()` —— 世界做成了什么事，转成一条事实；
 * 3. `ingestUpstream()` —— **边界入口**：`source = agent / genesis` 的事件从这里进；
 * 4. `tick(now)` —— 跨过日界就关账，把心电图交出去。
 *
 * 为什么不直接长在 `Simulation` 里：世界内核只认它自己的事（任务、天气、潮汐），
 * 记忆是**关于**这些事的第二层。把它塞进 `Simulation`，等于让世界在推进时
 * 顺手整理自己的记忆——那既拖慢固定步长，也把两层的时间语义搅在一起。
 * 这里改成世界每拍交出一份快照，适配器照着快照过日子，与世界同钟。
 *
 * 这一层仍然**不调模型**，也**不读全局状态替单位做决定**：它只搬运。
 * 单位能看见什么，仍然只有 `MemoryWorld.viewOf()` 那一扇门。
 */

import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from './config.ts';
import { placeHints, type NarrativeHint } from './hints.ts';
import { enforceWitnessedProvenance, type MemoryImportReport } from './import-guard.ts';
import type { LandmarkEvent } from './landmark.ts';
import type { OcclusionGrid, Perceiver } from './perception.ts';
import { witnessesOf } from './perception.ts';
import { heardBy, soundKindOf } from './hearing.ts';
import type { RecallOutcome, RecallRequest } from './recall.ts';
import { compile, type UpstreamAction } from './sanitize.ts';
import type {
  Bond,
  EpicEntry,
  Era,
  HolderType,
  Landmark,
  Legend,
  MemoryEvent,
  Mood,
  Toponym,
  TurningPoint,
  WorldFact,
  WorldVitals,
} from './types.ts';
import { MemoryWorld, type BondDelta, type HolderView, type MemoryWorldSnapshot } from './world.ts';

/**
 * 记忆段的版本号。存档里 `world.memory` 是一段 JSON 字符串，开头就带这个数。
 *
 * 与存档的 `schemaVersion` 是**两条独立的版本线**：世界存档升版本不必动记忆，
 * 记忆加字段也不必重算世界存档指纹。读取时不认识的版本按「没有记忆」拒绝，
 * 认识的旧版本**逐级迁移**（见 `migrateSnapshot`）。
 *
 * | 版本 | 加了什么 | 迁移 |
 * | --- | --- | --- |
 * | 1 | 内环原本的全部状态 | — |
 * | 2 | `world.placeAnchors`（地点坐标与 Holder 分库存） | 从名册里的地点 Holder 补回坐标 |
 * | 3 | `world.landmarks` / `eras` / `epics` / `turningPoints`（场景记忆与成长记录） | 补空数组：v2 的档没记过这些，空 = 那一段历史还没开始 |
 * | 4 | `world.bonds` / `world.moods`（方向性关系与情绪残留） | 补空数组：老档没有这两本账，空 = 还没开始记 |
 *
 * 每一次迁移都必须**无损**：新增的段要么从既有数据推得出来（v2 的坐标），
 * 要么明确是空的（v3）。旧档里已有的字段一个都不动、一条都不删。
 *
 * **不含任何存档侧的改动**：`world.memory` 这一段字符串以外的位置、
 * 路径白名单、指纹都不动。导出带历史这类需求留到以后（那时才谈 v6）。
 */
export const MEMORY_SCHEMA_VERSION = 4;

/** `MemoryRuntime.toJSON()` 的完整载荷。 */
export interface MemoryRuntimeSnapshot {
  readonly memorySchemaVersion: number;
  readonly lastClosedDay: number;
  readonly started: boolean;
  readonly now: number;
  readonly positions: readonly {
    readonly holderId: string;
    readonly at: { readonly x: number; readonly y: number };
  }[];
  readonly world: MemoryWorldSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is { readonly x: number; readonly y: number } {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

/**
 * 结构校验。只查「读档会不会崩」这一层：顶层标量、各段是数组、Map 摊平的键值是
 * `[string, number]`。数组**元素内部**的字段由记忆层自己的类型定义负责——
 * 这些元素都是本项目自己写出去的，且 `schemaVersion` 已经先比过。
 */
function isWorldSnapshot(value: unknown, version: number): value is MemoryWorldSnapshot {
  if (!isRecord(value)) return false;
  const arrays = [
    'holders',
    'facts',
    'entries',
    'claims',
    'beliefs',
    'traces',
    'legends',
    'placeNames',
    'announcements',
    'tells',
    'written',
    'cooldowns',
    'verifyPlans',
    'metToday',
  ] as const;
  for (const key of arrays) {
    if (!Array.isArray(value[key])) return false;
  }
  for (const key of ['traces', 'placeNames', 'verifyPlans'] as const) {
    for (const item of value[key] as unknown[]) {
      if (!isRecord(item)) return false;
    }
  }
  for (const item of value.placeNames as unknown[]) {
    if (!isRecord(item) || typeof item.placeId !== 'string' || typeof item.name !== 'string') {
      return false;
    }
    if (!Array.isArray(item.history)) return false;
  }
  for (const item of value.traces as unknown[]) {
    if (!isRecord(item) || typeof item.placeId !== 'string' || !Array.isArray(item.entries)) {
      return false;
    }
  }
  for (const item of value.verifyPlans as unknown[]) {
    if (!isRecord(item) || typeof item.holderId !== 'string' || !Array.isArray(item.plans)) {
      return false;
    }
  }
  if (!isRecord(value.fanout) || !isFiniteNumber(value.fanout.day) || !Array.isArray(value.fanout.counts)) {
    return false;
  }
  if (!Array.isArray(value.credibility)) return false;
  // 照面表摊平的是 `[pairKey, distance]` 元组，不是对象——按数组校验。
  for (const item of value.metToday as unknown[]) {
    if (!Array.isArray(item) || item.length !== 2) return false;
    if (typeof item[0] !== 'string' || !isFiniteNumber(item[1])) return false;
  }
  if (!isFiniteNumber(value.nextSerial) || !isFiniteNumber(value.currentDay)) return false;
  // `placeAnchors` 是 v2 才有的段。v1 的档没有它，迁移会补上，所以这里
  // 只在 v2 及以上要求它存在且形状正确。
  if (version >= 2) {
    if (!Array.isArray(value.placeAnchors)) return false;
    for (const item of value.placeAnchors as unknown[]) {
      if (!isRecord(item) || typeof item.placeId !== 'string' || !isPoint(item.at)) return false;
    }
  }
  // 场景记忆那四段是 v3 才有的，形状只查「是数组、地标元素查得到身份字段」。
  // 元素内部由记忆层自己的类型负责——这些全是本项目自己写出去的。
  if (version >= 3) {
    for (const key of ['landmarks', 'eras', 'epics', 'turningPoints'] as const) {
      if (!Array.isArray(value[key])) return false;
    }
    for (const item of value.landmarks as unknown[]) {
      if (!isRecord(item) || typeof item.plotKey !== 'string' || !Array.isArray(item.phases)) {
        return false;
      }
    }
    for (const item of value.eras as unknown[]) {
      if (!isRecord(item) || typeof item.eraId !== 'string' || !isFiniteNumber(item.fromDay)) {
        return false;
      }
    }
    for (const item of value.epics as unknown[]) {
      if (!isRecord(item) || typeof item.epicId !== 'string' || !Array.isArray(item.eventRefs)) {
        return false;
      }
    }
    for (const item of value.turningPoints as unknown[]) {
      if (!isRecord(item) || typeof item.holderId !== 'string' || !Array.isArray(item.eventRefs)) {
        return false;
      }
    }
  }
  // 关系与情绪（v4）：都只存当前值，形状查「是数组、元素有身份字段」。
  if (version >= 4) {
    for (const key of ['bonds', 'moods'] as const) {
      if (!Array.isArray(value[key])) return false;
    }
    for (const item of value.bonds as unknown[]) {
      if (!isRecord(item) || typeof item.from !== 'string' || typeof item.to !== 'string'
        || !isFiniteNumber(item.trust) || !isFiniteNumber(item.warmth) || !isFiniteNumber(item.debt)) {
        return false;
      }
    }
    for (const item of value.moods as unknown[]) {
      if (!isRecord(item) || typeof item.holderId !== 'string'
        || !isFiniteNumber(item.valence) || !isFiniteNumber(item.arousal)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 老记忆升到当前版本。**逐级**，每一级只认自己前后各一个版本。
 *
 * v1 → v2：补 `world.placeAnchors`。坐标不是新事实，是既有地点 Holder 上
 * 已经写着的那一个，所以这一步无损：别的字段一个都不动，缺坐标的地点
 * （本来就没有位置）照旧没有。
 *
 * v2 → v3：补四个空数组。v2 的档没有场景记忆可补——**空就是事实**
 * （「那段历史没记过」），不拿今天的楼去倒推一份假历史。
 *
 * v3 → v4：补关系与情绪两个空数组。老档没有这两本账，空就是事实；
 * 不拿已有印象倒推关系，也不拿旧记忆现算情绪。
 */
function migrateSnapshot(value: Record<string, unknown>, version: number): Record<string, unknown> {
  let current = version;
  let world = isRecord(value.world) ? { ...value.world } : value.world;
  if (current < 2) {
    if (isRecord(world)) {
      const holders = Array.isArray(world.holders) ? (world.holders as unknown[]) : [];
      const anchors: unknown[] = [];
      for (const item of holders) {
        if (!isRecord(item)) continue;
        if (item.type !== 'place' || !isPoint(item.at)) continue;
        if (typeof item.holderId !== 'string') continue;
        anchors.push({ placeId: item.holderId, at: { x: item.at.x, y: item.at.y } });
      }
      world = { ...world, placeAnchors: anchors };
    }
    current = 2;
  }
  if (current < 3) {
    if (isRecord(world)) {
      world = {
        ...world,
        landmarks: Array.isArray(world.landmarks) ? world.landmarks : [],
        eras: Array.isArray(world.eras) ? world.eras : [],
        epics: Array.isArray(world.epics) ? world.epics : [],
        turningPoints: Array.isArray(world.turningPoints) ? world.turningPoints : [],
      };
    }
    current = 3;
  }
  if (current < 4) {
    if (isRecord(world)) {
      world = {
        ...world,
        bonds: Array.isArray(world.bonds) ? world.bonds : [],
        moods: Array.isArray(world.moods) ? world.moods : [],
      };
    }
    current = 4;
  }
  return { ...value, memorySchemaVersion: current, world };
}

function isRuntimeSnapshot(value: unknown): value is MemoryRuntimeSnapshot {
  if (!isRecord(value)) return false;
  const version = value.memorySchemaVersion;
  if (!isFiniteNumber(version) || !Number.isInteger(version)) return false;
  // 高于当前版本的记忆不认识；老版本认识，交给 `migrateSnapshot` 迁上来。
  if (version < 1 || version > MEMORY_SCHEMA_VERSION) return false;
  const lastClosedDay = value.lastClosedDay;
  const now = value.now;
  if (!isFiniteNumber(lastClosedDay) || lastClosedDay < 0) return false;
  if (!isFiniteNumber(now) || now < 0) return false;
  if (typeof value.started !== 'boolean') return false;
  if (!Array.isArray(value.positions)) return false;
  for (const item of value.positions as unknown[]) {
    if (!isRecord(item) || typeof item.holderId !== 'string' || !isPoint(item.at)) return false;
  }
  return isWorldSnapshot(value.world, version);
}

/** 一个单位此刻的处境。位置是格坐标，与 `Simulation` 的 `Vec2` 同一套。 */
export interface RuntimeHolder {
  readonly holderId: string;
  readonly type: HolderType;
  readonly at?: { readonly x: number; readonly y: number };
  readonly talkativeness?: number;
  /**
   * 地点 Holder 的显示名（「账房」「炉匠铺」）。人物不给。
   *
   * 记忆层不认识这些词——它只拿它当「这个 id 原来叫什么」，好让改名有个底。
   * 名字**只登记第一次**（`MemoryWorld.setPlaceName`）：每拍覆盖会把改过的
   * 名字抹回原名。
   */
  readonly name?: string;
}

/**
 * 世界做成的一件事，翻译成记忆层的话。
 *
 * 刻意**不用** `WorldChange` 那个联合类型：那是世界回写日志的词表，长在
 * `src/world/world-changes.ts`，而记忆层不许往上一层 import。翻译发生在
 * 调用方（场景），记忆层只收翻译好的结果——这样加一种 `WorldChange` 不必
 * 动记忆层，改一种记忆的说法也不必动日志。
 */
export interface RuntimeObservation {
  readonly eventId: string;
  /** 记忆层的 kind（`task_done` / `celebration` / …），不是日志里的 `world.changed`。 */
  readonly kind: string;
  readonly placeId: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly actors: readonly string[];
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly importanceHint: number | null;
  readonly valence?: number;
  readonly arousal?: number;
  /**
   * 这件事是不是发生在室内空间里。
   *
   * **不是按 placeId 猜**：`building.built` 的 placeId 是楼，但事情发生在门口，
   * 是室外；`task_done` 才是屋里。由翻译层（`observe.ts`）按改变类型给出，
   * 省略按室外算。
   */
  readonly indoor?: boolean;
  /**
   * 地点类型。后果规则按它决定留什么痕迹——`'building'` 让一次拆楼
   * 留下的是**废墟**而不是一道焦痕（见 `traces.ts` 的 `consequenceOf`）。
   * 省略按 `'generic'` 算，与从前逐字节相同。
   */
  readonly placeType?: string;
  /**
   * 这件事是楼的落成 / 拆除，位置与名字在这儿。省略 = 普通地点。
   * 地标生命周期（`landmark.ts`）只认这一条输入。
   */
  readonly landmark?: LandmarkEvent;
  /**
   * 方向性关系增量。世界已经判好「谁对谁」的那几种事（街头小事）从这里
   * 落账；省略时与从前逐字节相同。
   */
  readonly bondDeltas?: readonly BondDelta[];
}

/** 个人时间线上的一格。`eventId` 与事件日志同一个 id。 */
export interface TimelineEntry {
  readonly memoryId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly day: number;
  readonly when: number;
  readonly sourceMode: string;
  readonly bias?: string;
}

/** 个人时间线上的一格，补上面板要的「在哪、和谁、当时那句话」。 */
export interface DayTimelineEntry extends TimelineEntry {
  readonly placeId: string | null;
  readonly actors: readonly string[];
  readonly what: string | null;
  /**
   * 事实发生的那一天。**不是 `createdDay`**：听说来的条目可能今天才落账，
   * 说的却是昨天的事，天序要跟时刻（`tick`）同源。
   *
   * 事实被裁掉（老档只剩记忆条目）时给 `null`，面板退回 `createdDay`。
   */
  readonly atDay: number | null;
  /**
   * 那件事发生时**当天已经走过的毫秒数**。`when` 只承载第几天，
   * 面板拿它当时刻会一律显示 `00:00`；这一格是真正的时刻。
   *
   * 事实被裁掉（老档只剩记忆条目）时给 `null`——宁可写「时刻不明」，
   * 也不编一个午夜。
   */
  readonly tick: number | null;
  /**
   * 这一格的时刻是否还站得住。
   *
   * 两件事会让它变 false：**事实被预算裁掉了**（`digest` 查不到，`when` 只剩
   * 条目自己记的补丁），以及**这一格本身是摘要**（摘要的 `when` 是「第几天」，
   * 不是一个时刻，`clockOf` 会把它算成 00:00，那是编的）。
   *
   * 面板据此写「时刻不明」而不是给一个看起来很像真的时间。
   */
  readonly whenKnown: boolean;
}

export interface MemoryRuntimeDeps {
  readonly config?: MemoryConfig;
  readonly worldId?: string;
  /** 心电图出口。**只出不进**：本组不拿它做任何决定，那是导演的事。 */
  readonly onVitals?: (vitals: WorldVitals) => void;
  /** 记忆层事件的出口（写日志用）。省略表示不记。 */
  readonly onEvent?: (event: MemoryEvent) => void;
  /**
   * 遮挡网格。**给了，「谁能看见一件事」才真的按感知模型算。**
   *
   * 世界那侧的 `WorldGrid` 直接满足 `OcclusionGrid`（只要 `isWalkable`），
   * 场景构造时把 `this.world.grid` 递进来即可。省略表示「判断不了遮挡」，
   * 于是退回归 `actors`——那是最保守的一档，宁可少记。
   */
  readonly occlusion?: OcclusionGrid;
  /**
   * 某个落点在哪栋楼里；室外返回 null。
   *
   * 给了，「观察者自己在室内」才有真实值——否则 `Perceiver.inside` 只能写死
   * null，而室内事件与室内观察者这两条感知规则等于没接。省略时按室外算。
   */
  readonly insideAt?: (point: { readonly x: number; readonly y: number }) => string | null;
  /**
   * 上游事件的地点是不是室内。`PlaceAnchor` 自带上游给的 `indoor` 时优先用它；
   * 这个回调只补本地事件翻译层答不出的那一半。
   */
  readonly placeIndoor?: (placeId: string) => boolean;
}

export class MemoryRuntime {
  readonly world: MemoryWorld;
  readonly config: MemoryConfig;
  private readonly deps: MemoryRuntimeDeps;
  /**
   * 已经关到第几天。`0` 表示一天都还没关——第 0 天要等跨进第 1 天才关。
   *
   * 起点不能是「当前第几天」：那样开局就站在第 0 天里，第 0 天永远不会关，
   * 而第 0 天恰恰是开局那批事最该被整理的一天。
   */
  private lastClosedDay = 0;
  private started = false;
  /**
   * 世界走到哪了。由 `tick` 推着走，不由墙钟。
   *
   * `observe` 用它给事件定时刻：一条观察不带时间（时间归世界，事件归这件事，
   * 与 `toEnvelope` 同一条纪律）。误差不超过一拍。
   */
  private now = 0;
  /**
   * 谁站在哪。**只记人物**，由 `syncHolders` 维护。
   *
   * 放在适配器这一层而不是 `MemoryWorld` 里：位置是行为层的知识，适配器的
   * 本职就是搬运它。放进世界就成了「任何人都能一次读到全村的位置」，
   * 而单位读世界的门至今只有 `viewOf` 一扇——那扇门后只有他自己的东西。
   */
  private readonly positions = new Map<string, { readonly x: number; readonly y: number }>();
  /**
   * 最近一次读档的出处闸报告（拒绝 / 降级 / 因淘汰无法核实）。
   *
   * 读档失败时为 `null`——「没读到」与「读到了但降级了 3 条」是两件事，
   * 面板与证据脚本要分得开。
   */
  private lastImportReport: MemoryImportReport | null = null;

  constructor(deps: MemoryRuntimeDeps = {}) {
    this.config = deps.config ?? DEFAULT_MEMORY_CONFIG;
    this.deps = deps;
    this.world = new MemoryWorld({
      config: this.config,
      worldId: deps.worldId ?? 'world',
      ...(deps.onEvent === undefined ? {} : { emit: deps.onEvent }),
    });
  }

  // ---------------------------------------------------------------- 存档

  /** 适配器自己的状态（关账日、时钟、位置）+ 记忆世界的完整快照。 */
  toSnapshot(): MemoryRuntimeSnapshot {
    return {
      memorySchemaVersion: MEMORY_SCHEMA_VERSION,
      lastClosedDay: this.lastClosedDay,
      started: this.started,
      now: this.now,
      positions: [...this.positions.entries()].map(([holderId, at]) => ({
        holderId,
        at: { x: at.x, y: at.y },
      })),
      world: this.world.toSnapshot(),
    };
  }

  /** 存档 `world.memory` 的实际内容：一段带 `memorySchemaVersion` 的 JSON 字符串。 */
  toJSON(): string {
    return JSON.stringify(this.toSnapshot());
  }

  /**
   * 从存档字符串复原。返回 `false` 表示「没有记忆 / 版本不认识 / 损坏」，
   * 调用方保持空库即可。
   *
   * **旧版本往上迁，新版本拒绝。** v1 的档迁成 v2 再读：迁移只补
   * `placeAnchors`，那是从既有 Holder 上读出来的坐标，不丢任何一条记忆。
   * 高于当前版本（v3+）的档不认识——宁可当成没有记忆，也不拿半个库去喂世界。
   *
   * **刻意不抛异常**：记忆是世界的第二层，坏一段记忆不该让整个世界读不出来。
   * 校验只到「结构能安全喂给 `restoreSnapshot`」这一层；元素内部字段由
   * `memorySchemaVersion` 与本项目自己写出的形状保证。
   */
  fromJSON(text: string): boolean {
    // 空串是 v4→v5 迁移给老档的默认值：明确的「没有记忆」，不是坏档。
    if (text === '') {
      this.lastImportReport = null;
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.lastImportReport = null;
      return false;
    }
    if (!isRuntimeSnapshot(parsed)) {
      this.lastImportReport = null;
      return false;
    }
    // 迁移之后再校验一次：迁上来的形状必须也过得了当前版本那道闸。
    const migrated: unknown =
      parsed.memorySchemaVersion === MEMORY_SCHEMA_VERSION
        ? parsed
        : migrateSnapshot(parsed as unknown as Record<string, unknown>, parsed.memorySchemaVersion);
    if (!isRuntimeSnapshot(migrated)) {
      this.lastImportReport = null;
      return false;
    }
    return this.fromSnapshot(migrated);
  }

  /** 最近一次读档的出处闸报告；读档失败或从未读过时为 `null`。 */
  get lastImport(): MemoryImportReport | null {
    return this.lastImportReport;
  }

  /**
   * 从**已经解析过**的快照复原。回溯（只读）走这条路：历史里存的是快照对象，
   * 不必再拼成字符串、解析一遍。
   *
   * 校验与 `fromJSON` 同一道闸；返回 `false` 表示形状不认识，调用方保持空库。
   */
  fromSnapshot(snapshot: MemoryRuntimeSnapshot): boolean {
    if (!isRuntimeSnapshot(snapshot)) {
      this.lastImportReport = null;
      return false;
    }
    this.lastClosedDay = snapshot.lastClosedDay;
    this.started = snapshot.started;
    this.now = snapshot.now;
    this.positions.clear();
    for (const item of snapshot.positions) {
      this.positions.set(item.holderId, { x: item.at.x, y: item.at.y });
    }
    // 出处闸：坏条目拒、自称亲历但无旁证的降级、因淘汰悬空但有旁证的放行。
    // 见 `import-guard.ts` 里那张「旁证写在哪」的表。
    const guarded = enforceWitnessedProvenance(snapshot.world);
    this.world.restoreSnapshot(guarded.world);
    this.lastImportReport = guarded.report;
    return true;
  }

  /**
   * 对齐这一刻的处境。
   *
   * 只增不删：走掉的人留在名册里（他还记得事），只是不再有位置——
   * 而**没有位置的单位不参与传播**（`spreadCandidates` 会跳过它们）。
   * 这是「不知道他在哪，就不能假装他站在谁旁边」。
   */
  syncHolders(holders: readonly RuntimeHolder[]): void {
    for (const holder of holders) {
      // 位置先记账，再管名册。**两个分支都要记**：第一次对齐时名册还是空的，
      // 人人走「新建」那条然后 `continue`——只写在另一条分支里的话，开局这
      // 一拍所有人都没有位置，感知模型于是谁都看不见。
      //
      // 地点 Holder 不记：一栋楼不会「看见」发生在它门口的事。
      if (holder.at !== undefined && holder.type === 'character') {
        this.positions.set(holder.holderId, holder.at);
      }
      // 名字也要在「新建」之前记：第一次对齐时名册是空的，走的是下面那条
      // `continue`，名字只写在新建分支里就永远登记不上（与位置同一个坑）。
      if (holder.type === 'place' && holder.name !== undefined) {
        this.world.setPlaceName(holder.holderId, holder.name);
      }
      if (!this.world.hasHolder(holder.holderId)) {
        this.world.addHolder({
          holderId: holder.holderId,
          type: holder.type,
          profile: { talkativeness: holder.talkativeness ?? 0.5 },
          ...(holder.at === undefined ? {} : { at: holder.at }),
        });
        continue;
      }
      if (holder.at !== undefined) this.world.moveHolder(holder.holderId, holder.at);
    }
    // 位置搬完再记一次照面。**不能放进上面那个循环**：循环里名册是逐个补齐
    // 的，第一拍只有半村人有位置，边算边记会漏掉后一半。放在这里，一次
    // `syncHolders` 就是行为层的一拍，照面按拍记。
    this.world.sampleEncounters();
    this.started = true;
  }

  /**
   * 开局设定档案：写一条「读到档案」的记忆，并落两人的关系初值。
   *
   * 走的是 `MemoryWorld.seedGenesis()` 这个公开边界：不会伪造目击、
   * 断言、痕迹或传言；同一人物重复调用只写第一次。
   */
  seedGenesis(input: {
    readonly holderId: string;
    readonly at: { readonly x: number; readonly y: number };
    readonly text: string;
    readonly bonds: readonly {
      readonly to: string;
      readonly trust: number;
      readonly warmth: number;
      readonly debt: number;
      readonly familiarity: number;
    }[];
    readonly atMs?: number;
  }): boolean {
    if (!this.world.hasHolder(input.holderId)) {
      this.world.addHolder({
        holderId: input.holderId,
        type: 'character',
        profile: { talkativeness: 0.5 },
        at: input.at,
      });
    }
    return this.world.seedGenesis({
      holderId: input.holderId,
      atMs: input.atMs ?? this.now,
      text: input.text,
      placeAt: input.at,
      bonds: input.bonds,
    });
  }

  /**
   * 世界做成了一件事。返回写下的记忆 id。
   *
   * `witnesses` 不传时**按感知模型算**（见 `witnessesFor`）。调用方手上
   * 有比位置更多的东西时（比如它知道谁真的在看），可以显式给一份盖过去。
   */
  observe(
    observation: RuntimeObservation,
    witnesses?: readonly string[],
    at = this.now,
  ): readonly string[] {
    const resolved = witnesses ?? this.witnessesFor(observation);
    const result = this.world.ingest({
      eventId: observation.eventId,
      at,
      kind: observation.kind,
      place: {
        placeId: observation.placeId,
        at: observation.at,
        // 由翻译层按改变类型给出（`task_done` 在屋里、`building.built` 在门口）；
        // 没给就按室外算。按室外是「多记」的方向：屋里屋外八格内的人都算在场。
        indoor: observation.indoor ?? false,
        ...(observation.placeType === undefined ? {} : { placeType: observation.placeType }),
      },
      actors: observation.actors,
      outcome: observation.outcome,
      visibility: 'world',
      source: 'world',
      importanceHint: observation.importanceHint,
      parentEventId: null,
      ...(observation.landmark === undefined ? {} : { landmark: observation.landmark }),
      ...(observation.bondDeltas === undefined ? {} : { bondDeltas: observation.bondDeltas }),
      witnesses: resolved,
      hearers: this.hearersFor(observation, resolved),
      ...(observation.valence === undefined ? {} : { valence: observation.valence }),
      ...(observation.arousal === undefined ? {} : { arousal: observation.arousal }),
    });

    // 印象的生产者：目击者看见别人交活，写一条关于那个人的印象。
    // 方向性靠持有者本身，A 看见 B 只写 A 对 B 的印象。
    const actor = observation.actors[0];
    if (observation.kind === 'task_done' && actor !== undefined) {
      for (const holderId of resolved) {
        if (holderId === actor) continue;
        this.world.addImpression({
          holderId,
          aboutHolderId: actor,
          at,
          placeId: observation.placeId,
          eventRef: observation.eventId,
          valence: observation.valence ?? 0.3,
        });
      }
    }
    return result.written;
  }

  /**
   * 听见这件事的人（不含已经看见的人）。
   *
   * 没有遮挡网格就不算：判断不了墙，就不能假装听见了。声音类型按事件 kind
   * 映射（见 `hearing.ts`），室内事件只传同房间。
   */
  private hearersFor(observation: RuntimeObservation, witnesses: readonly string[]): readonly string[] {
    const grid = this.deps.occlusion;
    if (grid === undefined) return [];
    const perceivers = this.perceivers();
    if (perceivers.length === 0) return [];
    const seen = new Set(witnesses);
    return heardBy({
      sound: {
        placeId: observation.placeId,
        at: observation.at,
        indoor: observation.indoor ?? false,
        kind: soundKindOf(observation.kind),
      },
      perceivers,
      grid,
      config: this.config,
    }).filter((holderId) => !seen.has(holderId));
  }

  /**
   * 谁看见了这件事。
   *
   * **感知模型在真实世界里的唯一入口。** `perception.ts` 的 `witnessesOf`
   * 写好了、测过了，而在这之前 `observe` 一直写死 `witnesses ?? actors`——
   * 一个调用方都没有。偏偏 `observe.ts` 里 `building.built`、
   * `building.removed`、`miracle`、`weather` 四种改变的 `actors` **都是空数组**：
   * 一栋新楼立起来、一次神迹、一场拆楼、一回天气反常，全村没有一个人记得，
   * 连站在原地的那个都不记得。没有目击者就没有记忆，没有记忆就没有断言，
   * 没有断言传播层就整层空转——而日志里一声不响，单元测试还全绿。
   *
   * `actors` 仍然算在场者，而且**排在最前**：参与这件事的人按定义就在那；
   * 更重要的是 witnesses 的顺序决定断言诞生在谁身上（`birthClaim` 取第一个），
   * 动手的人该是那个起源者。
   *
   * 没有遮挡网格时退回归 `actors`：判断不了遮挡，就不能假装看得见。
   */
  private witnessesFor(observation: RuntimeObservation): readonly string[] {
    const witnesses = [...observation.actors];
    const grid = this.deps.occlusion;
    if (grid === undefined) return witnesses;
    const perceivers = this.perceivers();
    if (perceivers.length === 0) return witnesses;

    const seen = new Set(witnesses);
    for (const holderId of witnessesOf({
      place: {
        placeId: observation.placeId,
        at: observation.at,
        indoor: observation.indoor ?? this.deps.placeIndoor?.(observation.placeId) ?? false,
      },
      perceivers,
      grid,
      config: this.config,
    })) {
      if (seen.has(holderId)) continue;
      seen.add(holderId);
      witnesses.push(holderId);
    }
    return witnesses;
  }

  /**
   * 这一刻可能看见事情的人，按 holderId 排序。
   *
   * 排序不是洁癖：感知的输入顺序决定 witnesses 的顺序，witnesses 的顺序
   * 决定断言诞生在谁身上。同一份存档跑两遍要得到同一个答案，就不许按
   * Map 的插入顺序走——插入顺序取决于行为层这拍先同步了谁。
   */
  private perceivers(): readonly Perceiver[] {
    const perceivers: Perceiver[] = [];
    for (const holderId of [...this.positions.keys()].sort()) {
      const at = this.positions.get(holderId);
      if (at === undefined) continue;
      // `inside` 每拍现算：人是走动的，进屋/出屋不需要额外的同步调用。
      perceivers.push({ holderId, at, inside: this.deps.insideAt?.(at) ?? null });
    }
    return perceivers;
  }

  /**
   * **边界入口**：上游动作从这里进世界。
   *
   * 这是本组唯一为造物主/上游预留的东西。事件进来之后怎么被感知、记忆、
   * 传播，与本地事件**没有区别**——本组不生成任何东西，只收。
   * 编译不出事件（拓扑不在表里，或一次平静的检索）时返回 `null`。
   */
  ingestUpstream(
    action: UpstreamAction,
    at: number,
    place: {
      readonly placeId: string;
      readonly at: { readonly x: number; readonly y: number };
      readonly indoor?: boolean;
    },
    actors: readonly string[],
    sight?: { readonly perceivers: readonly Perceiver[]; readonly grid: OcclusionGrid },
  ): WorldFact | null {
    // 调用方没给现场，就用适配器自己这一份：位置是 `syncHolders` 喂进来的，
    // 遮挡网格是构造时给的。两份都有才算得动；缺一个就按 `actors`——
    // 参与这件事的人按定义就在场。
    //
    // 不这么接的话，上游事件（`source = agent`）的记忆面会比本地事件窄一截：
    // 神迹从日志进来没人记得，神迹从 `observe` 进来就有人记得。
    const scene =
      sight ??
      (this.deps.occlusion === undefined
        ? undefined
        : { perceivers: this.perceivers(), grid: this.deps.occlusion });
    return this.world.ingestUpstream(
      action,
      at,
      { ...place, indoor: place.indoor || (this.deps.placeIndoor?.(place.placeId) ?? false) },
      actors,
      scene,
    );
  }

  /** 一条上游动作会变成什么事件。不写世界，只回答「会不会发生」。 */
  previewUpstream(action: UpstreamAction): ReturnType<typeof compile> {
    return compile(action);
  }

  /**
   * 世界走了 `now` 这么远。跨过的每一个日界都关一次账。
   *
   * 用 `while` 而不是 `if`：读档之后 `now` 可能一次跨好几天，
   * 而那些天该各自整理一次。补关的天用各自的天界时刻，不是「现在」——
   * 否则三天的记忆会全挤在同一个时刻，编年史就乱了。
   */
  tick(now: number): readonly WorldVitals[] {
    return this.tickCapped(now, Number.POSITIVE_INFINITY).closed;
  }

  /**
   * 与 `tick` 同一条关账路径，但一次跨太多天时只关一次。
   *
   * 真实时钟离线补算用这个：跨 3 天就逐日关 3 次（每一天用各自的天界时刻），
   * 跨 10 天则合并成一次，并返回 `skippedDays`——中间那些天没有各自关账，
   * 编年史上要能看出这是「一段时间过去了」，而不是十次完整结算。
   *
   * 合并那一笔仍走 `world.dayClosed` 与 `onVitals`，与逐日结算同一个出口；
   * 只是 `closing` 取目标日的前一天、`at` 取当前时刻。
   */
  tickCapped(now: number, maxDays: number): { closed: readonly WorldVitals[]; skippedDays: number } {
    this.now = now;
    const day = Math.floor(now / this.config.dayMs);
    const closed: WorldVitals[] = [];
    const gap = day - this.lastClosedDay;
    if (gap > maxDays) {
      const closing = day - 1;
      const vitals = this.world.dayClosed(closing, now);
      this.lastClosedDay = day;
      this.deps.onVitals?.(vitals);
      closed.push(vitals);
      return { closed, skippedDays: Math.max(0, gap - 1) };
    }
    while (this.lastClosedDay < day) {
      const closing = this.lastClosedDay;
      const at = (closing + 1) * this.config.dayMs;
      const vitals = this.world.dayClosed(closing, at);
      this.lastClosedDay = closing + 1;
      this.deps.onVitals?.(vitals);
      closed.push(vitals);
    }
    return { closed, skippedDays: 0 };
  }

  /**
   * 单位读自己。唯一那扇门，原样透出，不加任何东西。
   *
   * **今天没有人在用这扇门。** 它在 `SandboxScene` 只出现在
   * `Oracle.memory(holderId?)` 诊断里，而那个诊断在代码里零调用点——唯一调它的
   * 办法是人在浏览器控制台敲 `Oracle.memory('...')`。`src/ui/debug-panel.ts` 的
   * `DebugOracle` 五成员契约里也没有它；诊断摘要那一分支读的还是
   * `memories.length`，不是记忆本身。**验它要带注释过滤**，否则 grep 命中的是
   * 正在说明这件事的这几行：`grep -rn "\.memory(" src test scripts | grep -v ":[0-9]*: *\*"`。
   *
   * 注意这不是**回忆**：回忆是 `recall.ts`（打分、裁剪、强化），走下面的
   * `recallForDialogue`。这一扇给的是**全量原样**，那一扇给的是「他此刻想得起
   * 什么」——两条路的区别正是「他手上有什么」与「他要想起什么」。
   */
  viewOf(holderId: string): HolderView | null {
    return this.world.viewOf(holderId);
  }

  /** 这个人的方向性关系（只含 from=他自己）。只读副本。 */
  bondsOf(holderId: string): readonly Bond[] {
    return this.world.bondsOf(holderId);
  }

  bondOf(from: string, to: string): Bond | null {
    return this.world.bondOf(from, to);
  }

  /** 当前情绪：从最近一次日终衰减到 `now`；没有记录时为 null。 */
  moodOf(holderId: string): Mood | null {
    return this.world.moodOf(holderId, this.now);
  }

  /** 面板用的内心话：纯规则模板，不写公开 bubble。 */
  innerVoiceOf(holderId: string): { readonly templateId: string; readonly text: string } | null {
    return this.world.innerVoiceOf(holderId, this.now);
  }

  /** 世界走到第几天。检索算近因要用它；与 `observe` 定时刻是同一个 `now`。 */
  get day(): number {
    return Math.floor(this.now / this.config.dayMs);
  }

  /**
   * 按角色聚合的时间线：他自己记得的事，按发生时间排序。
   *
   * 每条都带 `eventId`（`eventRefs[0]`），与事件日志对得上——这是「记忆能
   * 追溯到事件」在个人视角下的读法。老存档里的条目本来就带 `eventRefs`
   * （类型上是非空数组），不需要迁移；新加的 `bias` 是可选字段，老条目没有
   * 就表示「没有记错」。
   */
  timelineFor(holderId: string): readonly TimelineEntry[] {
    const view = this.world.viewOf(holderId);
    if (view === null) return [];
    return view.memories
      .map((entry) => ({
        memoryId: entry.memoryId,
        eventId: entry.eventRefs[0],
        kind: entry.kind,
        day: entry.createdDay,
        when: entry.content.when,
        sourceMode: entry.sourceMode,
        ...(entry.bias === undefined ? {} : { bias: entry.bias }),
      }))
      .sort((a, b) => a.day - b.day || a.when - b.when || a.memoryId.localeCompare(b.memoryId));
  }

  /**
   * 某个人**某一天**的时间线。面板只用这一条。
   *
   * 在 `timelineFor` 的结果上加三样：地点、当事人、当时那句话。三样都从
   * `factDigest(eventId)` 取，不读别人的记忆，也不漏出见证人名单。
   * 查不到事实（事件被裁掉、老档只剩条目）时三样为 null / 空，条目本身
   * 仍然在——「她今天经历过什么」不该因为补不上地点就整条消失。
   */
  dayTimelineFor(holderId: string, day: number): readonly DayTimelineEntry[] {
    const rows: DayTimelineEntry[] = this.timelineFor(holderId)
      .filter((entry) => entry.day === day)
      .map((entry) => {
        const digest = this.world.factDigest(entry.eventId);
        return {
          ...entry,
          placeId: digest?.placeId ?? null,
          actors: digest?.actors ?? [],
          what: digest?.what ?? null,
          atDay: digest?.day ?? null,
          tick: digest?.tick ?? null,
          whenKnown: digest !== null && entry.kind !== 'summary',
        };
      });

    // **条目被裁掉的那一天，从日摘要补回拍子**（SOAK-BUG-5）。
    // 口径是「补缺」不是「并集」：条目层留下几格就算几格，摘要只把当天
    // 少掉的那几格补回来——同一条事件被同一个人记下两次时，两次都该在。
    const missing = new Map<string, number>();
    for (const row of rows) missing.set(row.eventId, (missing.get(row.eventId) ?? 0) + 1);
    const fromDigest = this.world.digestTimelineFor(holderId, day);
    if (fromDigest.length === 0) return rows;
    const digestBeats = new Map<string, number>();
    for (const beat of fromDigest) {
      digestBeats.set(beat.eventId, (digestBeats.get(beat.eventId) ?? 0) + 1);
    }
    const needed = new Map<string, number>();
    for (const [eventId, count] of digestBeats) {
      needed.set(eventId, Math.max(0, count - (missing.get(eventId) ?? 0)));
    }
    let serial = 0;
    for (const beat of fromDigest) {
      const left = needed.get(beat.eventId) ?? 0;
      if (left <= 0) continue;
      needed.set(beat.eventId, left - 1);
      serial += 1;
      const fact = this.world.factDigest(beat.eventId);
      rows.push({
        memoryId: `d_${day}_${beat.eventId}_${serial}`,
        eventId: beat.eventId,
        kind: beat.kind,
        day,
        when: fact?.tick ?? 0,
        sourceMode: 'recalled',
        placeId: fact?.placeId ?? beat.placeId,
        actors: fact?.actors ?? [],
        what: fact?.what ?? null,
        atDay: fact?.day ?? day,
        tick: fact?.tick ?? null,
        whenKnown: fact !== null && beat.kind !== 'summary',
      });
    }
    return rows;
  }

  /**
   * 此刻立着的传说（含淡去的）。转发 `world.legendsOf()`——同一扇门，不另开数据源。
   *
   * 这扇门为什么该存在：`legendsOf()` 到今天为止**零生产调用方**，它自己那条
   * 注释记着这件事。传说立得起来、`legend.formed` 发得出去，而没有任何一处能
   * 读回来——于是「碑」这块地方，世界已经刻好了，只是没人去看。
   *
   * 不算漏出 `MemoryWorld`：给的是镇上共识（不是任何单位的知识），而且是副本，
   * 拿不到 `holder` / `facts` / `positions`。`recallForDialogue` 已有同样的先例。
   */
  legends(): readonly Legend[] {
    return this.world.legendsOf();
  }

  /**
   * 一栋楼此刻该画出来的叙事装饰（补充设计 §10：表现层只消费提示，不读记忆库）。
   *
   * 与 `lookAtTraces` **同一道闸**：那边用 `config.traceExposedLayers` 决定
   * 「路过的人能推断出几道」，这边用同一个数决定「画面上画几道」。两处各翻一次
   * 库、各写一个上限，迟早会分叉成「看得见的推断不出来」或反过来。
   *
   * 读侧零模型调用，也不写任何东西：这是一次纯读。
   */
  placeHints(placeId: string): NarrativeHint[] {
    // **不读 `viewOf`。** 那一扇门要求地点 Holder 还在名册里，而拆掉的楼不在——
    // 于是它的痕迹明明还躺在库里，画面上却是一栋楼干干净净。痕迹按地点存，
    // 不按 Holder 存；这一扇门也只按地点读。
    return placeHints(this.world.tracesAt(placeId), this.config.traceExposedLayers);
  }

  /**
   * 还留着痕迹、但可能已经没有楼的地点。渲染层用它找废墟。
   *
   * 只给出 id 与坐标，不给痕迹内容——画面上要的东西仍然从 `placeHints`
   * 那一道闸拿，两道门不各算一份。
   */
  placeWithTraces(): readonly { readonly placeId: string; readonly at: { readonly x: number; readonly y: number } }[] {
    const out: { placeId: string; at: { readonly x: number; readonly y: number } }[] = [];
    for (const placeId of this.world.tracedPlaceIds()) {
      const at = this.world.placeAnchorOf(placeId);
      if (at === null) continue;
      out.push({ placeId, at });
    }
    return out;
  }

  /** 某个地点最后一次被知道的坐标。拆掉的楼也有——那是废墟的位置。 */
  placeAnchor(placeId: string): { readonly x: number; readonly y: number } | null {
    return this.world.placeAnchorOf(placeId);
  }

  /** 全部地标（只读副本）。一块地一生的阶段、落点、占地都在里面。 */
  landmarks(): readonly Landmark[] {
    return this.world.landmarksOf();
  }

  /** 时代分期（只读副本）；最后一条是当前时代（`toDay === null`）。 */
  eras(): readonly Era[] {
    return this.world.erasOf();
  }

  /** 够格的史诗条目（只读副本）。不够格的仍留在传说是，不在这里。 */
  epics(): readonly EpicEntry[] {
    return this.world.epicsOf();
  }

  /** 他自己翻过的那几次。读的是同一个 `viewOf` 门后的那一份。 */
  turningPointsOf(holderId: string): readonly TurningPoint[] {
    return this.world.viewOf(holderId)?.turningPoints ?? [];
  }

  /**
   * 看一块地时读到的全部：名字、阶段、此刻的痕迹、当前时代、缺了什么。
   *
   * 这是**纯投影**：O(阶段数 + 痕迹数)，不扫全库。面板只消费它，
   * 不自己去翻 `landmarks` / `traces` 两张表——与 `placeHints` 同一条纪律。
   */
  placeChronicle(placeId: string): PlaceChronicle | null {
    const landmark = this.world.landmarkOf(placeId);
    if (landmark === null) return null;
    const eras = this.world.erasOf();
    const current = eras[eras.length - 1];
    const standing = landmark.current === 'built'
      || landmark.current === 'altered'
      || landmark.current === 'rebuilt';
    const lastDemolished = [...landmark.phases]
      .reverse()
      .find((item) => item.state === 'demolished' || item.state === 'ruined');
    return {
      placeId: landmark.placeId,
      aliases: landmark.aliases,
      name: landmark.displayName,
      state: landmark.current,
      phases: landmark.phases.map((item) => ({ ...item })),
      footprint: landmark.footprint === null ? null : { ...landmark.footprint },
      anchor: { ...landmark.anchor },
      hints: placeHints(this.world.tracesAt(placeId), this.config.traceExposedLayers),
      eraLabel: current === undefined ? null : current.label,
      absent: standing || lastDemolished === undefined
        ? null
        : { text: '这里曾经有一栋楼', day: lastDemolished.day },
    };
  }

  /**
   * 一个地点此刻叫什么、改过几次名（协议 §11 的历史链）。
   *
   * 读它的是楼面板与 `Oracle`——DOM 那一侧。canvas 上不写字（D5-A），
   * 所以名字不进 `placeHints`：那不是装饰，是名字本身。
   */
  placeNamesOf(placeId: string): Toponym | null {
    return this.world.placeNameOf(placeId);
  }

  /**
   * 他此刻想得起什么。对话注入取 Top-`dialogueTopK`（3）。
   *
   * 这条链原先断在三层之外：`recall()` 只被 `world.recallFor` 叫，`recallFor`
   * 只被 `world.recallForDialogue` 叫，而后者只被 `test/memory-written.test.ts`
   * 叫——本类上没有一扇门通到它，场景连伸手都伸不到。现在「点一个村民」走这里。
   *
   * `commit` 由调用方给，而且**读的时候应当传 `false`**：`commit` 会强化、
   * 可能变形，还往事件流写 `memory.recalled`。面板上点一下就改了世界状态，
   * 还能靠连点把某条记忆强化得比事实更牢。
   */
  recallForDialogue(
    holderId: string,
    request: Omit<RecallRequest, 'holderId' | 'budgetK'>,
  ): RecallOutcome {
    return this.world.recallForDialogue(holderId, request);
  }

  /**
   * 某个人路过一个地点。走到跟前才看得见痕迹（`traceRadius`），
   * 看见之后按 `traces.ts` 的查表推断——不调模型，不猜。
   *
   * 返回他这次新推出的东西，调用方拿去挂牌子。返回空数组是常态：
   * 大多数地点大多数时候什么都没留下。
   */
  lookAtTraces(holderId: string, placeId: string): ReturnType<MemoryWorld['lookAtTraces']> {
    return this.world.lookAtTraces(holderId, placeId, this.now);
  }

  /**
   * **求证闭环的出口**。
   *
   * `verifyPlans` 早在传播时就写进了每个单位的视图里（`HolderView.verifyPlans`），
   * 但在这之前没有任何人读它——日程生成了，没人出门，于是 `verify()` 是死代码，
   * 而「造谣者可靠度下调 0.15」永远咬不动。
   *
   * 这里把它接上：行为层看到一个人站在他求证日程的落点上，就调一次。
   * 返回 `null` 表示他没这条日程（或已经跑过了）。
   */
  settleVerification(
    holderId: string,
    claimId: string,
  ): ReturnType<MemoryWorld['verify']> | null {
    const plans = this.world.viewOf(holderId)?.verifyPlans ?? [];
    const plan = plans.find((item) => item.claimId === claimId);
    if (plan === undefined) return null;
    return this.world.verify(holderId, claimId, plan.placeId, this.now);
  }

  /** 这个人此刻该去哪求证。行为层每拍读一次，读完就派路。 */
  pendingVerifications(holderId: string): HolderView['verifyPlans'] {
    return this.world.viewOf(holderId)?.verifyPlans ?? [];
  }

  /**
   * 一栋楼没了。**只删地点 Holder，不删人物的记忆。**
   *
   * 透出 `MemoryWorld.removePlace`——行为层拆楼时喊这一声，理由写在那儿的
   * 注释里（楼拆了，「那儿原来有间铺子」还该有人记得）。
   *
   * 这个转发方法原先不存在，而 `SandboxScene` 从 `6e8ec48` 起就在调它：
   * `npm run check` 从那一笔起一直是红的（TS2339，`MemoryRuntime` 没这个成员）。
   * 补上不是顺手——门少一层，喊的人就喊不到。
   */
  removePlace(holderId: string): void {
    this.world.removePlace(holderId);
  }

  /** 已经关到第几天（含）。给状态行与调试用。 */
  get closedThroughDay(): number {
    return this.lastClosedDay - 1;
  }

  /** 对齐过名册没有。没对齐过时传播无从谈起，状态行据此说「还没接上」。 */
  get ready(): boolean {
    return this.started;
  }

}

/**
 * 一块地的只读投影（面板与回溯共用）。
 *
 * 只给出面板要读的那几样：名字、阶段、此刻的痕迹单子、当前时代、以及
 * 「楼不在了」的那一句话。**不给 `facts` / `entries`**——面板没有理由
 * 从一块地读到全库。
 */
export interface PlaceChronicle {
  readonly placeId: string;
  readonly aliases: readonly string[];
  readonly name: string;
  readonly state: Landmark['current'];
  readonly phases: readonly Landmark['phases'][number][];
  readonly footprint: Landmark['footprint'];
  readonly anchor: { readonly x: number; readonly y: number };
  readonly hints: readonly NarrativeHint[];
  /** 当前时代的名字；还没有任何时代时是 `null`。 */
  readonly eraLabel: string | null;
  /** 楼已经不在时的那一句话；站着的楼是 `null`。 */
  readonly absent: { readonly text: string; readonly day: number } | null;
}
