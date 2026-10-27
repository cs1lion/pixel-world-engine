/** 存档 v1：只序列化世界自有事实（ADR_SAVE §1.2，final / frozen）。
 *
 * 这里刻意不 import Simulation：存档形状与运行时类解耦，测试可离线校验。
 * 字段冻结规则：WorldSaveV1 与 docs/save-v1.sample.json 必须一致；
 * 字段变了就要升 schemaVersion + 写迁移，指纹测试会拦。
 */

import type {
  CarryItem,
  Critter,
  Facing,
  GridPoint,
  NameState,
  OracleRecord,
  PendingDispatch,
  PlacedBuilding,
  PropKind,
  Silhouette,
  TaskKind,
  TaskRecord,
  TaskSource,
  TaskStatus,
  VillagerMode,
  Weather,
  WorkAccent,
  WorkshopTask,
  WorkstationActivity,
  WorldProp,
  ZoneId,
} from './types.ts';
import { ORACLE_SLAB_LIMIT } from './types.ts';
import { CARRY_ITEMS } from './gate.ts';
import type { WeatherState } from './weather.ts';
import type { TideOverride } from './tide.ts';

export const CURRENT_SCHEMA_VERSION = 4;
/** 槽位键沿用 v1：升 schema 不改存储键，老档才读得到、才谈得上迁移。 */
export const SAVE_STORAGE_KEY = 'xiaoxi.pixel-world.save.v1';
/** 已结算记录超过这个数就告警一次（每会话一次）。 */
export const SETTLED_WARN_THRESHOLD = 5000;
/** v1 冻结指纹（ADR_SAVE §1，frozen）。旧档迁移前用它自证，仍然有效。 */
export const SCHEMA_V1_FINGERPRINT = 'f53a0736d782d657';
/** v2 冻结指纹（ADR_WORLD_ALIVE §8）。由 docs/save-v2.sample.json 算出，单测核对。 */
export const SCHEMA_V2_FINGERPRINT = '72c4a6c0f1f444f7';
/**
 * v3 冻结指纹。由 docs/save-v3.sample.json 算出，单测核对。
 *
 * v3 只扩位置，不加业务：`villagers[].lampOil`、`tideOverride`、
 * `worldChangeVersion` 三个字段一次加齐，好让灯油、潮位覆盖、折返计数
 * 三张票各自去填，不必各升一次版本、各重算一次指纹。
 */
export const SCHEMA_V3_FINGERPRINT = '7b6a0058c54ba3e4';
/**
 * v4 冻结指纹。由 docs/save-v4.sample.json 算出，单测核对。
 *
 * 沿用 v3 的做法：一次把四个槽位扩好，让「名牌抵押」「渡有仪式」「污浊度」
 * 三张票各自去填，不必各升一次版本、各重算一次指纹。四个都是**位置**，
 * 谁来写、写成什么由各自的票决定（SPEC_V2 §4.6）。
 */
export const SCHEMA_V4_FINGERPRINT = 'aea397c23b23cda4';

/** v1 冻结路径全集（99 条，来自 docs/save-v1.sample.json；指纹见上，单测核对）。
 * `assertSaveV1` 做**集合包含**校验：存档出现的每条叶子路径都必须在这个集合里；
 * 越界即按「字段漂移」拒绝，并指名越界路径。
 *
 * 语义边界（P2）：本校验只防「新增路径」。字段删除（路径合法缩小）、类型变化
 * （number↔string↔null、null↔{} 等）不在这里拦——靠显式形状校验与 v2 迁移处理。
 * 不给存档本身重算指纹再比常量，是因为空数组会让路径集合合法地缩小
 * （fresh save 的重算值本来就不等于常量），那样会把正常存档全判成坏档。
 */
export const SAVE_V1_PATHS: readonly string[] = [
  'meta.savedAtWallClock',
  'meta.savedReconciled',
  'schemaVersion',
  'world.activities[]',
  'world.activities[].activity.determinate',
  'world.activities[].activity.estimateMs',
  'world.activities[].activity.kind',
  'world.activities[].activity.since',
  'world.activities[].activity.startedAt',
  'world.activities[].activity.taskId',
  'world.activities[].activity.until',
  'world.activities[].buildingId',
  'world.buildings[]',
  'world.buildings[].accent',
  'world.buildings[].boundTask',
  'world.buildings[].chimney.x',
  'world.buildings[].chimney.y',
  'world.buildings[].displayName',
  'world.buildings[].door.x',
  'world.buildings[].door.y',
  'world.buildings[].footprint.h',
  'world.buildings[].footprint.w',
  'world.buildings[].instanceId',
  'world.buildings[].origin.x',
  'world.buildings[].origin.y',
  'world.buildings[].palette.body',
  'world.buildings[].palette.roof',
  'world.buildings[].palette.trim',
  'world.buildings[].palette.window',
  'world.buildings[].prefabId',
  'world.buildings[].silhouette',
  'world.buildings[].workSpot.x',
  'world.buildings[].workSpot.y',
  'world.buildings[].zone',
  'world.constructions[]',
  'world.constructions[].buildingId',
  'world.constructions[].remainingMs',
  'world.constructions[].totalMs',
  'world.faith.milestones',
  'world.faith.points',
  'world.nextPendingNumber',
  'world.nextTaskNumber',
  'world.now',
  'world.pending[]',
  'world.pending[].id',
  'world.pending[].kind',
  'world.pending[].requestedAt',
  'world.pending[].source',
  'world.pending[].summary',
  'world.pending[].villagerId',
  'world.props[]',
  'world.props[].at.x',
  'world.props[].at.y',
  'world.props[].id',
  'world.props[].kind',
  'world.props[].label',
  'world.roads[]',
  'world.roads[].x',
  'world.roads[].y',
  'world.settled[]',
  'world.settled[].completedAt',
  'world.settled[].completedAtClock',
  'world.settled[].id',
  'world.settled[].source',
  'world.settled[].workerId',
  'world.tasks[]',
  'world.tasks[].blockedQuestion',
  'world.tasks[].buildingId',
  'world.tasks[].completedAt',
  'world.tasks[].createdAt',
  'world.tasks[].id',
  'world.tasks[].kind',
  'world.tasks[].source',
  'world.tasks[].status',
  'world.tasks[].summary',
  'world.tasks[].workerId',
  'world.villagers[]',
  'world.villagers[].bubble',
  'world.villagers[].bubbleUntil',
  'world.villagers[].deliverUntil',
  'world.villagers[].facing',
  'world.villagers[].id',
  'world.villagers[].inPlaceUntil',
  'world.villagers[].mode',
  'world.villagers[].name',
  'world.villagers[].nextRoutineAt',
  'world.villagers[].path[]',
  'world.villagers[].pendingBuildingId',
  'world.villagers[].pendingRoute[]',
  'world.villagers[].pos.x',
  'world.villagers[].pos.y',
  'world.villagers[].routineIndex',
  'world.villagers[].routineLabel',
  'world.villagers[].saluteUntil',
  'world.villagers[].taskId',
  'world.villagers[].visible',
  'world.weather.intensity',
  'world.weather.kind',
  'world.weather.remainingMs',
];

/**
 * v2 在 v1 之上新增的叶子路径。
 *
 * v1 的 99 条保持冻结不动：旧档迁移前要先按 v1 形状自证，改它等于改历史。
 * 新增只加在这里，`assertSave` 用 v1 ∪ optional ∪ 本表做集合包含校验。
 *
 * 石板数组在样例里非空，所以元素键也在样例里出现，不需要额外补可选路径。
 * （v1 当年补 optional，是因为样例里 path/pendingRoute 是空数组。）
 */
export const SAVE_V2_ADDED_PATHS: readonly string[] = [
  'world.buildings[].sourceSummary',
  'world.buildings[].sourceTaskId',
  'world.critters[]',
  'world.critters[].at.x',
  'world.critters[].at.y',
  'world.critters[].id',
  'world.critters[].kind',
  'world.critters[].leavesAt',
  'world.oracle[]',
  'world.oracle[].at',
  'world.oracle[].raw',
  'world.oracle[].receipt',
  'world.props[].sourceSummary',
  'world.props[].sourceTaskId',
  'world.props[].sourceTaskKind',
];

/**
 * v3 在 v2 之上新增的叶子路径。
 *
 * 三个字段一次加齐（见 SCHEMA_V3_FINGERPRINT 的注释）。都是**位置**：
 * 谁来写、写成什么，由各自的票决定；这一版只保证能存能读、缺省明确。
 *
 * `tideOverride` 是 `{level, until} | null`。样例里给 null，
 * 所以元素键 `tideOverride.level` / `.until` 不在样例路径里，
 * 但运行中非空时必须合法——补进下面的 v3 可选路径。
 */
export const SAVE_V3_ADDED_PATHS: readonly string[] = [
  'world.tideOverride',
  'world.villagers[].lampOil',
  'world.worldChangeVersion',
];

/**
 * v3 样例里没走到、但运行中合法的嵌套路径。
 *
 * 与 v1 的 `path[].x/y` 同因：样例里 `tideOverride` 是 null，
 * `collectSavePaths` 不会记下它的元素键；覆盖一旦生效就是非空对象。
 */
export const SAVE_V3_OPTIONAL_PATHS: readonly string[] = [
  'world.tideOverride.level',
  'world.tideOverride.until',
];

/**
 * v4 在 v3 之上新增的叶子路径（理由同 v3：一次扩好四个槽）。
 *
 *   - `world.villagers[].nameState`：名牌在谁手上（SPEC_V2 §4.6）。
 *   - `world.villagers[].carries[]`：她带着什么，渡有仪式据此判（同上）。
 *   - `world.props[].grime`：物件的污浊度 0..1，渲染层照它叠噪点（同上）。
 *   - `world.props[].reveal`：洗干净后露出的那句话；没得可露时是 null。
 */
export const SAVE_V4_ADDED_PATHS: readonly string[] = [
  'world.villagers[].carries[]',
  'world.villagers[].nameState',
  'world.props[].grime',
  'world.props[].reveal',
];

/**
 * v1 冻结的 `world.tasks[]` 键集合（必须与 docs/save-v1.sample.json 逐键一致）。
 * 运行时字段（如 ledgerCompletedAt）不得落盘；字段漂移必须升版本，不能裸加。
 */
export const SAVE_TASK_KEYS = [
  'blockedQuestion',
  'buildingId',
  'completedAt',
  'createdAt',
  'id',
  'kind',
  'source',
  'status',
  'summary',
  'workerId',
] as const;

/** v1 冻结的 `world.settled[]` 键集合（ADR_SAVE §2.1）。 */
export const SAVE_SETTLED_KEYS = [
  'completedAt',
  'completedAtClock',
  'id',
  'source',
  'workerId',
] as const;

/**
 * 潮位覆盖：一句话让潮水涨/退，但它有期限。
 *
 * 形状定义在 `tide.ts`——那里是唯一能算它的地方（`effectiveTideLevel`）。
 * 存档只是把它序列化，不另立一份。
 */
export type { TideOverride } from './tide.ts';

/** 存档里的角色：快照缺的续跑字段由 toSave() 补齐（ADR_SAVE §1.2）。 */
export interface SavedVillager {
  readonly id: string;
  readonly name: string;
  readonly mode: VillagerMode;
  readonly pos: { readonly x: number; readonly y: number };
  readonly facing: Facing;
  readonly visible: boolean;
  readonly path: readonly GridPoint[];
  readonly taskId: string | null;
  readonly bubble: string | null;
  readonly bubbleUntil: number;
  readonly saluteUntil: number;
  readonly deliverUntil: number;
  readonly nextRoutineAt: number;
  readonly routineIndex: number;
  readonly routineLabel: string | null;
  readonly inPlaceUntil: number;
  readonly pendingRoute: readonly GridPoint[];
  readonly pendingBuildingId: string | null;
  /**
   * v3：灯油余量 0..1，缺省 1（满油）。
   *
   * **世界自己的拍点不读它。** 存它是因为「你离开一段时间再回来，灯该灭的已经灭了」，
   * 那是世界自有的事实；但烧油的动作在渲染层（`render/villager.ts` 调
   * `advanceLamp`，拿这个数只起头一次），`Simulation` 没有任何分支看它。
   *
   * 这里原来写「不进 `Simulation` 的读路径」——读起来像「Simulation 不碰它」，
   * 而它其实**是个 Simulation 字段**：`fromSave` 把它写进 `villager.lampOil`，
   * 快照与 `toSave()` 又读出来。准确说法是「不进世界自己的推进路径」：
   * 世界照常走，灯照常烧，两者不相干。原话把这两件事压成一句，读的人会去
   * `simulation.ts` 里找读它的地方，然后误以为找到了反例。
   */
  readonly lampOil: number;
  /**
   * v4：名牌状态。缺省 `'held'`（名字在自己身上）。
   *
   * 读档后抵押者必须还是抵押的：凭空把她放回来接活，等于让「抵押」这件事
   * 在每次读档后失效一次。
   */
  readonly nameState: NameState;
  /**
   * v4：她带着的凭证。渡有仪式据此判某道门过不过得去（SPEC_V2 §4.6）。
   *
   * 闭集 `CARRY_ITEMS`，缺省 `[]`（两手空空）。
   */
  readonly carries: readonly CarryItem[];
}

/** 已结算记录：save-only 的去重与分账唯一真相（ADR_SAVE §2.1/§2.2）。 */
export interface SettledRecord {
  readonly id: string;
  readonly source: 'ledger' | 'mock';
  readonly workerId: string;
  /**
   * `'ledger'` 用上游事件时间（`task.settled` 带来的 `completedAt`）；
   * 缺失记 null，禁止本地时间顶替。`'mock'` 用本地 wall clock。
   *
   * 两个字符串都是存档 v1–v3 的字面量，冻结着；语义已换成「事件流派来的」与「本地造的」。
   */
  readonly completedAt: number | null;
  readonly completedAtClock: 'ledger' | 'local';
}

export interface SavedActivity {
  readonly buildingId: string;
  readonly activity: WorkstationActivity;
}

export interface SavedConstruction {
  readonly buildingId: string;
  readonly remainingMs: number;
  readonly totalMs: number;
}

export interface SaveWorld {
  readonly now: number;
  readonly villagers: readonly SavedVillager[];
  readonly buildings: readonly PlacedBuilding[];
  readonly roads: readonly GridPoint[];
  readonly props: readonly WorldProp[];
  readonly tasks: readonly TaskRecord[];
  readonly pending: readonly PendingDispatch[];
  readonly activities: readonly SavedActivity[];
  readonly constructions: readonly SavedConstruction[];
  readonly weather: WeatherState;
  readonly faith: { readonly points: number; readonly milestones: number };
  readonly settled: readonly SettledRecord[];
  readonly nextTaskNumber: number;
  readonly nextPendingNumber: number;
  /** v2 新增：神谕石板。旧档迁移后是空数组，不是缺字段。 */
  readonly oracle: readonly OracleRecord[];
  /** v2 新增：氛围实体（猫等）。旧档迁移后是空数组。 */
  readonly critters: readonly Critter[];
  /**
   * v3：当前生效的潮位覆盖。旧档迁移后是 null（没有覆盖，走纯函数）。
   *
   * 空值用 null 而不是省略键：省略键会让路径集合合法缩小，
   * 那正是 `assertSave` 分不清「旧档」与「坏档」的地方。
   */
  readonly tideOverride: TideOverride | null;
  /**
   * v3：世界被玩家实质改变过几次。旧档迁移后是 0。
   *
   * 只影响画什么（同一个场景该长成什么样），不影响世界怎么走。
   * 写它的是 #8，这一版只留位置。
   */
  readonly worldChangeVersion: number;
}

export interface SaveMeta {
  /** 仅诊断，永不喂逻辑（ADR_SAVE §5）。 */
  readonly savedAtWallClock: number;
  /** 写档时是否已与上游事件流对过（仅诊断）。 */
  readonly savedReconciled: boolean;
  /** 冻结指纹；加载时存在且不符 → 按坏档处理。 */
  readonly schemaFingerprint: string;
}

export interface WorldSaveV1 {
  readonly schemaVersion: 1;
  readonly world: SaveWorld;
  readonly meta: SaveMeta;
}

export interface WorldSaveV2 {
  readonly schemaVersion: 2;
  readonly world: SaveWorld;
  readonly meta: SaveMeta;
}

export interface WorldSaveV3 {
  readonly schemaVersion: 3;
  readonly world: SaveWorld;
  readonly meta: SaveMeta;
}

export interface WorldSaveV4 {
  readonly schemaVersion: 4;
  readonly world: SaveWorld;
  readonly meta: SaveMeta;
}

/** 运行期只认当前版本。v1/v2/v3 只在迁移入口出现，不流进 Simulation。 */
export type WorldSave = WorldSaveV4;

export type RawSave = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 取叶子路径：数组记 `[]`（数组本身也记一条），元素内的键继承 `[]`。
 * 同路径去重；`meta.schemaFingerprint` 不参与（ADR_SAVE §1 冻结规则）。
 */
export function collectSavePaths(value: unknown, prefix = '', out: string[] = []): string[] {
  if (Array.isArray(value)) {
    out.push(`${prefix}[]`);
    for (const item of value) collectSavePaths(item, `${prefix}[]`, out);
    return out;
  }
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (prefix === 'meta' && key === 'schemaFingerprint') continue;
      collectSavePaths(value[key], prefix === '' ? key : `${prefix}.${key}`, out);
    }
    return out;
  }
  out.push(prefix);
  return out;
}

/** FNV-1a 64-bit over UTF-8，16 位小写 hex。 */
export function fnv1a64Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  for (const byte of bytes) {
    hash = (hash ^ BigInt(byte)) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 路径集合 → 排序、`\n` 连接、FNV-1a 64-bit。 */
export function fingerprintOfPaths(paths: readonly string[]): string {
  return fnv1a64Hex([...new Set(paths)].sort().join('\n'));
}

/**
 * 样例里没走到、但运行中合法的 4 条嵌套路径（完整字符串见下方常量）。
 *
 * 原因：`docs/save-v1.sample.json` 里 `world.villagers[].path` 与
 * `world.villagers[].pendingRoute` 都是空数组，`collectSavePaths` 只会记下
 * `world.villagers[].path[]` 这一条数组路径，不会出现元素键；而小人一旦在走路
 * （`mode=toWork/toAltar/sheltering`，或读档时带着待走路径），这两个数组就是
 * 非空的 `{x,y}[]`，属于 v1 的合法现场。不补进允许集合，「正在走路」的存档
 * 会被集合包含校验误判成字段漂移。
 */
export const SAVE_V1_OPTIONAL_PATHS: readonly string[] = [
  'world.villagers[].path[].x',
  'world.villagers[].path[].y',
  'world.villagers[].pendingRoute[].x',
  'world.villagers[].pendingRoute[].y',
];

/** 合法存档允许出现的路径全集 = 冻结样例 99 条 + 可选嵌套路径。 */
export const SAVE_V1_ALLOWED_PATHS: readonly string[] = [
  ...SAVE_V1_PATHS,
  ...SAVE_V1_OPTIONAL_PATHS,
];

/** v2 允许全集 = v1 全集 + v2 新增。 */
export const SAVE_V2_ALLOWED_PATHS: readonly string[] = [
  ...SAVE_V1_ALLOWED_PATHS,
  ...SAVE_V2_ADDED_PATHS,
];

/** v3 允许全集 = v2 全集 + v3 新增 + v3 可选嵌套。 */
export const SAVE_V3_ALLOWED_PATHS: readonly string[] = [
  ...SAVE_V2_ALLOWED_PATHS,
  ...SAVE_V3_ADDED_PATHS,
  ...SAVE_V3_OPTIONAL_PATHS,
];

/** v4 允许全集 = v3 全集 + v4 新增。 */
export const SAVE_V4_ALLOWED_PATHS: readonly string[] = [
  ...SAVE_V3_ALLOWED_PATHS,
  ...SAVE_V4_ADDED_PATHS,
];

const SAVE_V1_PATH_SET = new Set(SAVE_V1_ALLOWED_PATHS);
const SAVE_V2_PATH_SET = new Set(SAVE_V2_ALLOWED_PATHS);
const SAVE_V3_PATH_SET = new Set(SAVE_V3_ALLOWED_PATHS);
const SAVE_V4_PATH_SET = new Set(SAVE_V4_ALLOWED_PATHS);

/** 对任意存档对象取指纹（跳过 meta.schemaFingerprint）。 */
export function saveFingerprint(save: unknown): string {
  return fingerprintOfPaths(collectSavePaths(save));
}


/** 键集合必须与冻结样例逐键一致：多一个运行时字段就是字段漂移。 */
function assertKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} 键集合与 v1 样例不一致：实际 [${actual.join(',')}]`);
  }
}

/* ------------------------------------------------------------------ task-32 字段级校验
 *
 * 两级校验分工（ADR_SAVE §1.3）：
 *   - 路径集合包含校验：只防「新增字段」——存档出现允许集合之外的路径即拒。
 *   - 本节的类型/范围/存在性校验：防「删字段」「换错类型」「值越界」——
 *     路径集合会因删除而合法缩小，所以那一半必须由这里逐字段兜住。
 *
 * 纪律：一律**拒绝**，不静默补默认值。存档缺一个字段就是坏档，不能拿 `??` 猜。
 */

/** 合法枚举值（与 types.ts 的联合类型逐项对应，改一处必须同步）。 */
export const VILLAGER_MODES: readonly VillagerMode[] = [
  'idle', 'saluting', 'toWork', 'working', 'delivering', 'toAltar', 'sheltering',
  'bearingDecree',
];
export const TASK_STATUSES: readonly TaskStatus[] = ['assigned', 'in_progress', 'done', 'failed'];
export const TASK_KINDS: readonly TaskKind[] = ['code', 'research', 'writing', 'quick'];
export const TASK_SOURCES: readonly TaskSource[] = ['sandbox', 'ledger'];
export const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];
/** 名牌的两态（SPEC_V2 §4.6）。抵押者接不到新活。 */
export const NAME_STATES: readonly NameState[] = ['held', 'pawned'];
/**
 * 六个建造分区（与 `ZoneId` 同一份名单）。`grid.ts` 的 `zoneAt` 是它的主人，
 * 存档校验只是照单点名，防的是「表里冒出第七个词」。
 *
 * 这里原来挂的是 `gate.ts` 里 `CARRY_ITEMS` 的文档字符串——「渡有仪式认得的凭证…
 * 住在 `gate.ts`……存档只是向它问话的一方」。那段讲的是渡有仪式的闭集凭证，
 * 贴在分区枚举头上，而 `ZONES` 自己一条注释都没有。同一段话在两个文件里各出现
 * 一次，其中一个贴错了符号；以 `gate.ts` 那份为准，这份删掉重写。
 */
export const ZONES: readonly ZoneId[] = [
  'street', 'altar', 'industry', 'scholarly', 'agriculture', 'living',
];
export const PROP_KINDS: readonly PropKind[] = ['lamp', 'tree', 'banner'];
export const WORK_ACCENTS: readonly WorkAccent[] = ['smoke', 'pages', 'ink'];
export const SILHOUETTES: readonly Silhouette[] = ['gable', 'tower', 'flat'];
/** 三档。旧档只会出现前两档，读进来照常合法。 */
export const WEATHER_KINDS: readonly Weather[] = ['clear', 'rain', 'storm'];
export const ACTIVITY_KINDS: readonly WorkstationActivity['kind'][] = [
  'idle', 'operating', 'overheating', 'cooling',
];
/** boundTask 只接工地活（quick 原地做，不进铺子）。 */
export const WORKSHOP_TASKS: readonly WorkshopTask[] = ['code', 'research', 'writing'];

const SETTLED_SOURCES = ['ledger', 'mock'] as const;
const SETTLED_CLOCKS = ['ledger', 'local'] as const;
const PENDING_SOURCES = ['oracle'] as const;

function fail(path: string, problem: string): never {
  throw new Error(`存档字段校验不通过：${path} ${problem}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, '必须是对象');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  return value as readonly unknown[];
}

/** 必须有这个键（值为 undefined 也算缺）：删字段是坏档，不是"用默认值"。 */
function requireKey(object: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(object, key) || object[key] === undefined) {
    fail(`${path}.${key}`, '缺失（当前版要求该字段存在）');
  }
  return object[key];
}

function checkNumber(value: unknown, path: string, opts: { min?: number; integer?: boolean } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必须是有限数字');
  if (opts.integer === true && !Number.isInteger(value)) fail(path, '必须是整数');
  if (opts.min !== undefined && value < opts.min) fail(path, `必须 ≥ ${opts.min}，实际 ${value}`);
  return value;
}

function checkString(value: unknown, path: string, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') fail(path, '必须是字符串');
  if (opts.allowEmpty !== true && value === '') fail(path, '必须是非空字符串');
  return value;
}

function checkBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, '必须是布尔值');
  return value;
}

/** number | null（时间戳类字段）。 */
function checkNumberOrNull(value: unknown, path: string, opts: { min?: number } = {}): number | null {
  if (value === null) return null;
  return checkNumber(value, path, opts);
}

/** string | null（可为空的文本/引用）。 */
function checkStringOrNull(value: unknown, path: string, opts: { allowEmpty?: boolean } = {}): string | null {
  if (value === null) return null;
  return checkString(value, path, opts);
}

function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `只能是 ${allowed.join('/')}，实际 ${JSON.stringify(value)}`);
  }
  return value as T;
}

/**
 * 一个 `{x, y}`：两个键都在、都是数。就这些。
 *
 * 这里原来写「网格坐标：整数、落在世界内」——两半都不成立：
 *
 * - **「整数」看调用方。** `opts.integer` 由调用方给，而三个点故意不给：
 *   `world.villagers[].pos`、`world.critters[].at` 与 `world.buildings[].chimney`
 *   都是 `Vec2`（浮点），不是 `GridPoint`。她是**一路滑过来的**——`grid.ts`
 *   的 `breathingAt` 专门写了「拿 `villager.pos` 直接问会落到一格之外」。
 *   这些点带小数是对的。反过来 `origin` / `door` / `workSpot` / `at`（prop）
 *   与 `checkPointList` 都传了 `{ integer: true }`。
 *
 * - **「落在世界内」这里根本问不了。** 本函数跑在原始 JSON 上，那会儿还没有
 *   网格；而世界多大是个参数（`GridSpec`，设定集自己选），存档这一层不知道。
 *   实测：把 `villagers[0].pos` 手改成 `{x: 99999, y: -98765}`，`validateSaveFields`
 *   放行，`fromSave` 原样恢复，之后每一步 `at()` 都返回 `undefined`——
 *   不抛、不记日志，她只是从此看不见也够不着，一直站在世界外面。
 *   命令那条路是有人拦的（`simulation.ts` 会回「那里在世界外面。」），
 *   所以这个洞只有手改存档才够得着。
 *
 *   这个洞 2026-10-27 补了，但**不补在这里**：补在 `findOutOfWorldCoordinates`——
 *   一个收 `{width, height}` 的纯函数，由 `parseSaveText` 在读档与导入两条路上调用。
 *   不补在本函数里，是因为它拿不到世界多大；而把 `GridSpec` 拖进存档校验层，
 *   等于让「存档形状」依赖「地图配置」，两件会各自演进的东西从此绑死。
 *
 * 原注释后半句「有键集合校验兜着，这里只查存在键」说的也是 JSON 路径的键，
 * 不是坐标——见下面 `validateWorldFields` 的注释。
 */
function checkPoint(value: unknown, path: string, opts: { integer?: boolean } = {}): void {
  const point = asRecord(value, path);
  checkNumber(requireKey(point, 'x', path), `${path}.x`, { integer: opts.integer });
  checkNumber(requireKey(point, 'y', path), `${path}.y`, { integer: opts.integer });
}

/** `{x,y}[]`：元素结构必须完整；空数组合法（样例里就是空）。 */
function checkPointList(value: unknown, path: string): void {
  const list = asArray(value, path);
  list.forEach((item, index) => checkPoint(item, `${path}[${index}]`, { integer: true }));
}

/**
 * 逐个字段校验：类型/范围/存在性。只做「值」层面。
 *
 * 「坐标有没有跑出世界外面」不归这里管——那需要知道世界多大，而这一层只有
 * 一段 JSON（见 `checkPoint`）。上面说的「越界」全是**JSON 叶子路径**的越界：
 * 集合包含校验专防「多出字段」，删字段会让路径集合合法缩小，所以「少字段」
 * 「换错类型」「值越界」这三样必须由本函数逐字段点名兜住。
 *
 * `version` 决定查到哪一版为止：旧档在迁移前必须能过这一层，
 * 所以 v1 不查 `props[].sourceTaskKind` 与 `world.oracle`，v2 不查 v3 的三个字段。
 */
function validateWorldFields(raw: Record<string, unknown>, version: 1 | 2 | 3 | 4): void {
  const world = asRecord(raw.world, 'world');

  checkNumber(requireKey(world, 'now', 'world'), 'world.now', { min: 0 });
  checkNumber(requireKey(world, 'nextTaskNumber', 'world'), 'world.nextTaskNumber', {
    min: 1, integer: true,
  });
  checkNumber(requireKey(world, 'nextPendingNumber', 'world'), 'world.nextPendingNumber', {
    min: 1, integer: true,
  });

  // ---- 角色
  const villagers = asArray(requireKey(world, 'villagers', 'world'), 'world.villagers');
  if (villagers.length === 0) fail('world.villagers', '至少要有一个角色');
  villagers.forEach((item, index) => {
    const path = `world.villagers[${index}]`;
    const villager = asRecord(item, path);
    checkString(requireKey(villager, 'id', path), `${path}.id`);
    checkString(requireKey(villager, 'name', path), `${path}.name`);
    checkEnum(requireKey(villager, 'mode', path), VILLAGER_MODES, `${path}.mode`);
    checkPoint(requireKey(villager, 'pos', path), `${path}.pos`);
    checkEnum(requireKey(villager, 'facing', path), FACINGS, `${path}.facing`);
    checkBoolean(requireKey(villager, 'visible', path), `${path}.visible`);
    checkPointList(requireKey(villager, 'path', path), `${path}.path`);
    checkStringOrNull(requireKey(villager, 'taskId', path), `${path}.taskId`);
    checkStringOrNull(requireKey(villager, 'bubble', path), `${path}.bubble`, { allowEmpty: true });
    checkNumber(requireKey(villager, 'bubbleUntil', path), `${path}.bubbleUntil`, { min: 0 });
    checkNumber(requireKey(villager, 'saluteUntil', path), `${path}.saluteUntil`, { min: 0 });
    checkNumber(requireKey(villager, 'deliverUntil', path), `${path}.deliverUntil`, { min: 0 });
    checkNumber(requireKey(villager, 'nextRoutineAt', path), `${path}.nextRoutineAt`, { min: 0 });
    checkNumber(requireKey(villager, 'routineIndex', path), `${path}.routineIndex`, {
      min: 0, integer: true,
    });
    checkStringOrNull(requireKey(villager, 'routineLabel', path), `${path}.routineLabel`, {
      allowEmpty: true,
    });
    checkNumber(requireKey(villager, 'inPlaceUntil', path), `${path}.inPlaceUntil`, { min: 0 });
    checkPointList(requireKey(villager, 'pendingRoute', path), `${path}.pendingRoute`);
    checkStringOrNull(requireKey(villager, 'pendingBuildingId', path), `${path}.pendingBuildingId`);
    if (version >= 3) {
      // 灯油是 0..1 的余量，不是无限可负的计数器：越界即坏档。
      const lampOil = checkNumber(requireKey(villager, 'lampOil', path), `${path}.lampOil`, {
        min: 0,
      });
      if (lampOil > 1) fail(`${path}.lampOil`, `必须在 0..1，实际 ${lampOil}`);
    }
    if (version >= 4) {
      // 名牌只有两态，写成别的字符串就是坏档——它决定谁接得到活。
      checkEnum(requireKey(villager, 'nameState', path), NAME_STATES, `${path}.nameState`);
      // 带着的东西：闭集。未知的一件就等于渡有仪式认不出的凭证。
      const carries = asArray(requireKey(villager, 'carries', path), `${path}.carries`);
      for (const item of carries) {
        checkEnum(item, CARRY_ITEMS, `${path}.carries[]`);
      }
    }
  });

  // ---- 建筑
  const buildings = asArray(requireKey(world, 'buildings', 'world'), 'world.buildings');
  const buildingIds = new Set<string>();
  buildings.forEach((item, index) => {
    const path = `world.buildings[${index}]`;
    const building = asRecord(item, path);
    const instanceId = checkString(requireKey(building, 'instanceId', path), `${path}.instanceId`);
    if (buildingIds.has(instanceId)) fail(`${path}.instanceId`, `重复的实例 id ${instanceId}`);
    buildingIds.add(instanceId);
    checkString(requireKey(building, 'prefabId', path), `${path}.prefabId`);
    checkString(requireKey(building, 'displayName', path), `${path}.displayName`);
    checkEnum(requireKey(building, 'zone', path), ZONES, `${path}.zone`);
    checkPoint(requireKey(building, 'origin', path), `${path}.origin`, { integer: true });
    const footprint = asRecord(requireKey(building, 'footprint', path), `${path}.footprint`);
    checkNumber(requireKey(footprint, 'w', `${path}.footprint`), `${path}.footprint.w`, {
      min: 1, integer: true,
    });
    checkNumber(requireKey(footprint, 'h', `${path}.footprint`), `${path}.footprint.h`, {
      min: 1, integer: true,
    });
    checkPoint(requireKey(building, 'door', path), `${path}.door`, { integer: true });
    checkPoint(requireKey(building, 'workSpot', path), `${path}.workSpot`, { integer: true });
    // 烟囱是浮点格坐标（粒子挂点），允许小数。
    checkPoint(requireKey(building, 'chimney', path), `${path}.chimney`);
    checkEnum(requireKey(building, 'accent', path), WORK_ACCENTS, `${path}.accent`);
    checkEnum(requireKey(building, 'silhouette', path), SILHOUETTES, `${path}.silhouette`);
    const boundTask = requireKey(building, 'boundTask', path);
    if (boundTask !== null) checkEnum(boundTask, WORKSHOP_TASKS, `${path}.boundTask`);
    const palette = asRecord(requireKey(building, 'palette', path), `${path}.palette`);
    for (const slot of ['body', 'roof', 'trim', 'window'] as const) {
      checkNumber(requireKey(palette, slot, `${path}.palette`), `${path}.palette.${slot}`, { min: 0 });
    }
    if (version >= 2) {
      // 建筑的来源：开局常驻的楼与老档迁移来的楼都是 null。
      checkStringOrNull(requireKey(building, 'sourceTaskId', path), `${path}.sourceTaskId`, {
        allowEmpty: true,
      });
      checkStringOrNull(requireKey(building, 'sourceSummary', path), `${path}.sourceSummary`, {
        allowEmpty: true,
      });
    }
  });

  // ---- 道路 / 摆件
  checkPointList(requireKey(world, 'roads', 'world'), 'world.roads');
  const props = asArray(requireKey(world, 'props', 'world'), 'world.props');
  props.forEach((item, index) => {
    const path = `world.props[${index}]`;
    const prop = asRecord(item, path);
    checkString(requireKey(prop, 'id', path), `${path}.id`);
    checkEnum(requireKey(prop, 'kind', path), PROP_KINDS, `${path}.kind`);
    checkPoint(requireKey(prop, 'at', path), `${path}.at`, { integer: true });
    checkString(requireKey(prop, 'label', path), `${path}.label`, { allowEmpty: true });
    if (version >= 2) {
      // v2：来源可以为 null（老摆件来路不明），但不能是空串或未知类型。
      const sourceKind = requireKey(prop, 'sourceTaskKind', path);
      if (sourceKind !== null) checkEnum(sourceKind, TASK_KINDS, `${path}.sourceTaskKind`);
      checkStringOrNull(requireKey(prop, 'sourceTaskId', path), `${path}.sourceTaskId`, {
        allowEmpty: true,
      });
      checkStringOrNull(requireKey(prop, 'sourceSummary', path), `${path}.sourceSummary`, {
        allowEmpty: true,
      });
    }
    if (version >= 4) {
      // 污浊度 0..1：越界就是坏档，渲染层会照它叠噪点，1.4 层噪点会画到格子外。
      const grime = checkNumber(requireKey(prop, 'grime', path), `${path}.grime`, { min: 0 });
      if (grime > 1) fail(`${path}.grime`, `必须在 0..1，实际 ${grime}`);
      // 洗干净后露出的那句话。没得可露就是 null；空串是第二套「没得可露」，
      // 两种说法迟早有一处对不上，所以这里只认 null。
      checkStringOrNull(requireKey(prop, 'reveal', path), `${path}.reveal`, {
        allowEmpty: false,
      });
    }
  });

  if (version >= 2) {
    // ---- 氛围实体（v2）：只做氛围，不参与结算。
    const critters = asArray(requireKey(world, 'critters', 'world'), 'world.critters');
    critters.forEach((item, index) => {
      const path = `world.critters[${index}]`;
      const critter = asRecord(item, path);
      checkString(requireKey(critter, 'id', path), `${path}.id`);
      checkEnum(requireKey(critter, 'kind', path), ['cat'] as const, `${path}.kind`);
      checkPoint(requireKey(critter, 'at', path), `${path}.at`);
      checkNumber(requireKey(critter, 'leavesAt', path), `${path}.leavesAt`, { min: 0 });
    });

    // ---- 神谕石板（v2）：只记改变了世界的话，封顶 ORACLE_SLAB_LIMIT 条。
    const oracle = asArray(requireKey(world, 'oracle', 'world'), 'world.oracle');
    if (oracle.length > ORACLE_SLAB_LIMIT) {
      fail('world.oracle', `最多 ${ORACLE_SLAB_LIMIT} 条，实际 ${oracle.length}`);
    }
    oracle.forEach((item, index) => {
      const path = `world.oracle[${index}]`;
      const record = asRecord(item, path);
      checkString(requireKey(record, 'raw', path), `${path}.raw`, { allowEmpty: true });
      checkString(requireKey(record, 'receipt', path), `${path}.receipt`, { allowEmpty: true });
      checkNumber(requireKey(record, 'at', path), `${path}.at`, { min: 0 });
    });
  }

  // ---- 任务
  const tasks = asArray(requireKey(world, 'tasks', 'world'), 'world.tasks');
  tasks.forEach((item, index) => {
    const path = `world.tasks[${index}]`;
    const task = asRecord(item, path);
    checkString(requireKey(task, 'id', path), `${path}.id`);
    checkEnum(requireKey(task, 'kind', path), TASK_KINDS, `${path}.kind`);
    checkString(requireKey(task, 'summary', path), `${path}.summary`, { allowEmpty: true });
    checkStringOrNull(requireKey(task, 'buildingId', path), `${path}.buildingId`);
    checkEnum(requireKey(task, 'source', path), TASK_SOURCES, `${path}.source`);
    checkEnum(requireKey(task, 'status', path), TASK_STATUSES, `${path}.status`);
    checkNumber(requireKey(task, 'createdAt', path), `${path}.createdAt`, { min: 0 });
    const completedAt = checkNumberOrNull(requireKey(task, 'completedAt', path), `${path}.completedAt`, {
      min: 0,
    });
    // done 必须有完成时间：状态与时间不能自相矛盾。
    if (task.status === 'done' && completedAt === null) {
      fail(`${path}.completedAt`, 'done 任务必须有完成时间（不能是 null）');
    }
    checkStringOrNull(requireKey(task, 'blockedQuestion', path), `${path}.blockedQuestion`, {
      allowEmpty: true,
    });
    checkStringOrNull(requireKey(task, 'workerId', path), `${path}.workerId`);
  });

  // ---- 排队神谕
  const pending = asArray(requireKey(world, 'pending', 'world'), 'world.pending');
  pending.forEach((item, index) => {
    const path = `world.pending[${index}]`;
    const entry = asRecord(item, path);
    checkString(requireKey(entry, 'id', path), `${path}.id`);
    checkEnum(requireKey(entry, 'kind', path), TASK_KINDS, `${path}.kind`);
    checkString(requireKey(entry, 'summary', path), `${path}.summary`, { allowEmpty: true });
    checkNumber(requireKey(entry, 'requestedAt', path), `${path}.requestedAt`, { min: 0 });
    checkEnum(requireKey(entry, 'source', path), PENDING_SOURCES, `${path}.source`);
    checkString(requireKey(entry, 'villagerId', path), `${path}.villagerId`);
  });

  // ---- 铺子活动：四种 kind 各有不同必填键（联合类型，不能只看 kind）
  const activities = asArray(requireKey(world, 'activities', 'world'), 'world.activities');
  activities.forEach((item, index) => {
    const path = `world.activities[${index}]`;
    const entry = asRecord(item, path);
    checkString(requireKey(entry, 'buildingId', path), `${path}.buildingId`);
    const activity = asRecord(requireKey(entry, 'activity', path), `${path}.activity`);
    const kindPath = `${path}.activity.kind`;
    const kind = checkEnum(requireKey(activity, 'kind', `${path}.activity`), ACTIVITY_KINDS, kindPath);
    if (kind === 'operating') {
      checkString(requireKey(activity, 'taskId', `${path}.activity`), `${path}.activity.taskId`);
      checkNumber(requireKey(activity, 'startedAt', `${path}.activity`), `${path}.activity.startedAt`, {
        min: 0,
      });
      checkNumber(requireKey(activity, 'estimateMs', `${path}.activity`), `${path}.activity.estimateMs`, {
        min: 0,
      });
      checkBoolean(requireKey(activity, 'determinate', `${path}.activity`), `${path}.activity.determinate`);
    } else if (kind === 'overheating') {
      checkString(requireKey(activity, 'taskId', `${path}.activity`), `${path}.activity.taskId`);
      checkNumber(requireKey(activity, 'since', `${path}.activity`), `${path}.activity.since`, { min: 0 });
    } else if (kind === 'cooling') {
      checkString(requireKey(activity, 'taskId', `${path}.activity`), `${path}.activity.taskId`);
      checkNumber(requireKey(activity, 'until', `${path}.activity`), `${path}.activity.until`, { min: 0 });
    }
  });

  // ---- 在建工地
  const constructions = asArray(requireKey(world, 'constructions', 'world'), 'world.constructions');
  constructions.forEach((item, index) => {
    const path = `world.constructions[${index}]`;
    const entry = asRecord(item, path);
    checkString(requireKey(entry, 'buildingId', path), `${path}.buildingId`);
    const remaining = checkNumber(requireKey(entry, 'remainingMs', path), `${path}.remainingMs`, {
      min: 0,
    });
    const total = checkNumber(requireKey(entry, 'totalMs', path), `${path}.totalMs`, { min: 0 });
    if (remaining > total) fail(`${path}.remainingMs`, `不能大于 totalMs（${remaining} > ${total}）`);
  });

  if (version >= 3) {
    // ---- 潮位覆盖（v3）：null 表示没有覆盖，世界走 `tideLevelAt(now)`。
    const override = requireKey(world, 'tideOverride', 'world');
    if (override !== null) {
      const record = asRecord(override, 'world.tideOverride');
      const level = checkNumber(
        requireKey(record, 'level', 'world.tideOverride'), 'world.tideOverride.level', { min: 0 },
      );
      if (level > 1) fail('world.tideOverride.level', `必须在 0..1，实际 ${level}`);
      checkNumber(requireKey(record, 'until', 'world.tideOverride'), 'world.tideOverride.until', {
        min: 0,
      });
    }
    // ---- 折返计数（v3）：只影响画什么，所以只要求是非负整数。
    checkNumber(requireKey(world, 'worldChangeVersion', 'world'), 'world.worldChangeVersion', {
      min: 0, integer: true,
    });
  }

  // ---- 天气
  const weather = asRecord(requireKey(world, 'weather', 'world'), 'world.weather');
  checkEnum(requireKey(weather, 'kind', 'world.weather'), WEATHER_KINDS, 'world.weather.kind');
  const intensity = checkNumber(
    requireKey(weather, 'intensity', 'world.weather'), 'world.weather.intensity', { min: 0 },
  );
  if (intensity > 1) fail('world.weather.intensity', `必须在 0..1，实际 ${intensity}`);
  checkNumberOrNull(
    requireKey(weather, 'remainingMs', 'world.weather'), 'world.weather.remainingMs', { min: 0 },
  );

  // ---- 神恩
  const faith = asRecord(requireKey(world, 'faith', 'world'), 'world.faith');
  checkNumber(requireKey(faith, 'points', 'world.faith'), 'world.faith.points', {
    min: 0, integer: true,
  });
  checkNumber(requireKey(faith, 'milestones', 'world.faith'), 'world.faith.milestones', {
    min: 0, integer: true,
  });

  // ---- 已结算（去重/分账真相）
  const settled = asArray(requireKey(world, 'settled', 'world'), 'world.settled');
  const settledIds = new Set<string>();
  settled.forEach((item, index) => {
    const path = `world.settled[${index}]`;
    const record = asRecord(item, path);
    const id = checkString(requireKey(record, 'id', path), `${path}.id`);
    if (settledIds.has(id)) fail(`${path}.id`, `重复的已结算 id ${id}`);
    settledIds.add(id);
    checkEnum(requireKey(record, 'source', path), SETTLED_SOURCES, `${path}.source`);
    checkString(requireKey(record, 'workerId', path), `${path}.workerId`);
    checkNumberOrNull(requireKey(record, 'completedAt', path), `${path}.completedAt`, { min: 0 });
    checkEnum(
      requireKey(record, 'completedAtClock', path), SETTLED_CLOCKS, `${path}.completedAtClock`,
    );
  });

  // ---- done 任务必须在 settled 里（写档不变量，ADR_SAVE §2.1）
  for (const [index, item] of tasks.entries()) {
    const task = asRecord(item, `world.tasks[${index}]`);
    if (task.status === 'done' && !settledIds.has(String(task.id))) {
      fail(`world.tasks[${index}]`, `done 任务 ${String(task.id)} 缺少 settled 记录`);
    }
  }
}

/** meta 三字段的类型/范围（指纹值另在 assertSaveV1 里比常量）。 */
function validateMetaFields(raw: Record<string, unknown>): void {
  const meta = asRecord(raw.meta, 'meta');
  checkNumber(requireKey(meta, 'savedAtWallClock', 'meta'), 'meta.savedAtWallClock', { min: 0 });
  checkBoolean(requireKey(meta, 'savedReconciled', 'meta'), 'meta.savedReconciled');
  checkString(requireKey(meta, 'schemaFingerprint', 'meta'), 'meta.schemaFingerprint');
}

/**
 * 字段级校验：类型/范围/存在性。防「删字段」「换错类型」「值越界」。
 * 路径集合会因删字段而合法缩小，所以这一半必须逐字段点名检查。
 *
 * v1 档在迁移前走这一层，所以 v2 新增字段按版本跳过。
 */
export function validateSaveFields(
  raw: unknown,
  version: 1 | 2 | 3 | 4 = CURRENT_SCHEMA_VERSION,
): asserts raw is WorldSaveV1 | WorldSaveV2 | WorldSaveV3 | WorldSaveV4 {
  if (!isObject(raw)) fail('存档', '不是对象');
  validateMetaFields(raw);
  validateWorldFields(raw, version);
}

/**
 * 当前版本存档的**唯一校验入口**。三层串联，逐层防不同的东西。
 *
 * 1. **字段级类型/范围/存在性**（`validateSaveFields`）：防「删字段」「换错类型」「值越界」。
 *    路径集合会因删字段而合法缩小，所以这一半必须逐字段点名检查；缺失即拒，
 *    绝不静默补默认值。
 * 2. **形状/嵌套键集合**：`world.tasks[]` / `world.settled[]` 键集合必须与冻结常量逐键一致。
 * 3. **路径集合包含**：存档里出现的每条叶子路径都必须落在允许全集里，越界即拒并指名
 *    越界路径——只防「新增字段」。v1 用 v1 全集，v2 用 v1 ∪ v2 新增，v3 再加 v3 新增，
 *    v4 用 v4 全集（`SAVE_V4_PATH_SET`）。
 *
 * 三层各管一段，合起来才等价于"形状完全没变"；任何一层失败都按坏档处理。
 *
 * v1 仍被接受，是因为迁移前的旧档要先按 v1 形状自证一次（`MIGRATIONS[1]`）。
 * 迁移完成后到这里的存档是 **v4**——`CURRENT_SCHEMA_VERSION = 4`，而 `assertSave`
 * 第一件事就是拿它比（下面那个 `schemaVersion 不是 4` 的抛错）。
 *
 * 这里原来写「一律是 v3」——v4 落地时漏改的旧话，而它挂在整个存档校验唯一入口的
 * 文档上。同一段上面那句枚举也停在 v3，没提 v4 全集，一并补上。
 */
export function assertSave(raw: unknown): asserts raw is WorldSaveV4 {
  if (!isObject(raw)) throw new Error('存档不是对象');
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 不是 ${CURRENT_SCHEMA_VERSION}（迁移没跑？）`);
  }
  const world = raw.world;
  if (!isObject(world)) throw new Error('存档缺 world');
  const meta = raw.meta;
  if (!isObject(meta)) throw new Error('存档缺 meta');
  // meta.schemaFingerprint 是冻结产物的自证字段：缺失/不是字符串一律拒绝，避免
  // 「删掉它就能绕过旧检查」；存在但与常量不等也拒绝（被改过或字段漂移）。
  if (typeof meta.schemaFingerprint !== 'string') {
    throw new Error('存档缺 meta.schemaFingerprint（当前版本要求该字段存在）');
  }
  if (meta.schemaFingerprint !== SCHEMA_V4_FINGERPRINT) {
    throw new Error('存档指纹不符（字段变了但版本没升，或存档损坏）');
  }
  // 第 1 层：字段级类型/范围/存在性（含 weather/faith、各数组元素、done⊆settled）。
  validateSaveFields(raw, CURRENT_SCHEMA_VERSION);
  // 第 2 层：嵌套键集合冻结（多一个运行时字段就是漂移）。
  for (const record of world.settled as unknown[]) {
    assertKeys(record as Record<string, unknown>, SAVE_SETTLED_KEYS, 'world.settled[]');
  }
  for (const task of world.tasks as unknown[]) {
    assertKeys(task as Record<string, unknown>, SAVE_TASK_KEYS, 'world.tasks[]');
  }
  // 第 3 层：路径集合包含校验——只防「新增路径」（顶层/world/meta/数组元素里多字段）。
  const outside = collectSavePaths(raw).filter((path) => !SAVE_V4_PATH_SET.has(path));
  if (outside.length > 0) {
    throw new Error(
      `存档字段漂移：出现 v${CURRENT_SCHEMA_VERSION} 允许集合之外的路径：${outside.join(', ')}（字段变了但版本没升）`,
    );
  }
}

/**
 * 世界的尺寸：只用来问「这个坐标在不在世界里」。
 *
 * 刻意不是 `GridSpec`：这一层不该为了问一句话把整套分区/地形配置拖进来。
 * `width` / `height` 两个数就是 `WorldGrid.inBounds` 用的全部依据
 * （`grid.ts` 里那句 `p.x >= 0 && p.y >= 0 && p.x < width && p.y < height`）。
 */
export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

/** 与 `WorldGrid.inBounds` 同一条判据。复制而不 import：存档层不依赖网格层。 */
function outsideWorld(point: { readonly x: number; readonly y: number }, bounds: WorldBounds): boolean {
  return !(point.x >= 0 && point.y >= 0 && point.x < bounds.width && point.y < bounds.height);
}

function showPoint(point: { readonly x: number; readonly y: number }): string {
  return `{x:${point.x}, y:${point.y}}`;
}

/**
 * 存档里落在世界外面的坐标，一条一个，指名到 JSON 路径。
 *
 * **为什么需要这一层。** `validateSaveFields` 跑在原始 JSON 上，那会儿还没有网格，
 * 而世界多大是 `GridSpec` 参数——存档这一层天生问不出「在不在世界里」。于是下面这六类
 * 坐标今天**验不出越界**，而它们越界之后没有一处会红：
 *
 * - `villagers[].pos`：她从此站在世界外。`grid.at()` 对她永远返回 `undefined`，
 *   实测跑 30000 拍（8 分钟世界时间）她一次活都没接到过，不抛、不记日志。
 * - `villagers[].path[]` / `pendingRoute[]`：**这一条会主动把她拖出世界。**
 *   实测 `path:[{x:999,y:999}]` + `mode:'toWork'`，6000 拍后她站在 (218, 213)
 *   ——那是个 30×20 的世界；66000 拍后她精确停在 (999, 999)，再也不回来。
 * - `props[].at`：摆件还在 `snapshot.props` 里，日报照写「…已经落在祭坛边」，
 *   而地图上哪都没有它。**纸上一句没有人会怀疑的假话。**
 * - `critters[].at` / `roads[]`：只是画不出来，别的都在。
 *
 * **这不是一道防「世界跑偏」的闸，是一道防「存档坏了」的闸。** 分别说清楚：
 * 世界自己的寻路只会产出界内的格子——`grid.path()` 的 `passable()` 要求 `at()` 有值
 * （越界即 undefined），兜底的 `nearestWalkable()` 也只扫 `0..width` / `0..height`，
 * 而相邻两个界内格子之间滑过去的人落不出这块矩形。实测佐证：大世界 96×72 跑
 * 240000 拍（64 分钟世界时间）、八轮派活覆盖四类活，`pos` 全落在 x∈[42,52]、
 * y∈[28,36]，`path`/`pendingRoute` 的格子同样全在界内，一次越界都没有。
 * 所以一份**正常写出来的存档**过不了这条检查，只可能是它被改过、被截断、
 * 或者是从另一张地图搬过来的。
 *
 * **建筑不在这里查。** 建筑的落位早就有人拦，而且拦得更响：
 * `rebuildGridFromPlacements()` 放不下就抛 `WorldSetupError`。但那道抛错在
 * `main.ts` 顶层没有人接，白屏；把建筑也并到本函数，同样的存档就从「白屏」
 * 变成「备份原档 + 用新世界启动 + 说明白为什么」。并进来的代价是**别的事仍旧白屏**：
 * 两栋楼重叠、门口落在自己占地里、门口到不了镇心，这三样 `place()` 一样返回 false，
 * 与本函数查的「坐标在不在世界里」不是一件事。那三样仍然白屏，这里不装作补上了。
 *
 * 返回值是人类可读的一行行指控，直接给玩家看。
 */
export function findOutOfWorldCoordinates(
  save: WorldSave,
  bounds: WorldBounds,
): readonly string[] {
  const out: string[] = [];
  const world = save.world;

  world.villagers.forEach((villager, index) => {
    const base = `world.villagers[${index}]`;
    if (outsideWorld(villager.pos, bounds)) {
      out.push(`${base}.pos = ${showPoint(villager.pos)}`);
    }
    villager.path.forEach((cell, at) => {
      if (outsideWorld(cell, bounds)) out.push(`${base}.path[${at}] = ${showPoint(cell)}`);
    });
    villager.pendingRoute.forEach((cell, at) => {
      if (outsideWorld(cell, bounds)) out.push(`${base}.pendingRoute[${at}] = ${showPoint(cell)}`);
    });
  });

  world.buildings.forEach((building, index) => {
    const base = `world.buildings[${index}]`;
    for (const [slot, point] of [
      ['origin', building.origin],
      ['door', building.door],
      ['workSpot', building.workSpot],
    ] as const) {
      if (outsideWorld(point, bounds)) out.push(`${base}.${slot} = ${showPoint(point)}`);
    }
  });

  world.props.forEach((prop, index) => {
    if (outsideWorld(prop.at, bounds)) {
      out.push(`world.props[${index}].at = ${showPoint(prop.at)}`);
    }
  });

  world.critters.forEach((critter, index) => {
    if (outsideWorld(critter.at, bounds)) {
      out.push(`world.critters[${index}].at = ${showPoint(critter.at)}`);
    }
  });

  world.roads.forEach((cell, index) => {
    if (outsideWorld(cell, bounds)) {
      out.push(`world.roads[${index}] = ${showPoint(cell)}`);
    }
  });

  return out;
}

/**
 * 只认某个历史版本形状的自证校验。迁移链在改写存档前先跑它，确保「旧档确实是旧档」，
 * 而不是被改过的、或已经混进新版本字段的假旧档。
 *
 * v1 与 v2 各有一条，共用这段实现：差别只在版本号、指纹、字段校验的截止版本、
 * 以及允许的路径集合。
 */
function assertLegacySave(
  raw: unknown,
  version: 1 | 2 | 3,
  fingerprint: string,
  pathSet: ReadonlySet<string>,
): void {
  if (!isObject(raw)) throw new Error('存档不是对象');
  if (raw.schemaVersion !== version) {
    throw new Error(`schemaVersion 不是 ${version}（实际 ${String(raw.schemaVersion)}）`);
  }
  const world = raw.world;
  if (!isObject(world)) throw new Error('存档缺 world');
  const meta = raw.meta;
  if (!isObject(meta)) throw new Error('存档缺 meta');
  if (typeof meta.schemaFingerprint !== 'string') {
    throw new Error(`存档缺 meta.schemaFingerprint（v${version} 要求该字段存在）`);
  }
  if (meta.schemaFingerprint !== fingerprint) {
    throw new Error('存档指纹不符（字段变了但版本没升，或存档损坏）');
  }
  validateSaveFields(raw, version);
  for (const record of world.settled as unknown[]) {
    assertKeys(record as Record<string, unknown>, SAVE_SETTLED_KEYS, 'world.settled[]');
  }
  for (const task of world.tasks as unknown[]) {
    assertKeys(task as Record<string, unknown>, SAVE_TASK_KEYS, 'world.tasks[]');
  }
  const outside = collectSavePaths(raw).filter((path) => !pathSet.has(path));
  if (outside.length > 0) {
    throw new Error(
      `存档字段漂移：出现 v${version} 允许集合之外的路径：${outside.join(', ')}（字段变了但版本没升）`,
    );
  }
}

/** 只认 v1 形状的自证校验。 */
export function assertSaveV1(raw: unknown): asserts raw is WorldSaveV1 {
  assertLegacySave(raw, 1, SCHEMA_V1_FINGERPRINT, SAVE_V1_PATH_SET);
}

/** 只认 v2 形状的自证校验。v2→v3 迁移前用它，理由同 v1。 */
export function assertSaveV2(raw: unknown): asserts raw is WorldSaveV2 {
  assertLegacySave(raw, 2, SCHEMA_V2_FINGERPRINT, SAVE_V2_PATH_SET);
}

/**
 * 只认 v3 形状的自证校验。v3→v4 迁移前用它，理由同 v1。
 *
 * 为什么 v3 也要有一条：v3 曾经是当前版本，那时它不需要自证——调用方会直接
 * `assertSave` 它。一旦它变成旧版本（v4 起），迁移链就会先改写它再校验，
 * 那道「先自证」的关口就空了：一个被改过的 v3 档会被安静地迁成 v4。
 * 加一条与 v1/v2 同样的校验，把这道关口补回来。
 */
export function assertSaveV3(raw: unknown): asserts raw is WorldSaveV3 {
  assertLegacySave(raw, 3, SCHEMA_V3_FINGERPRINT, SAVE_V3_PATH_SET);
}

/** 逐级迁移链入口；任一步抛错都拒绝加载（ADR_SAVE §3）。 */
export type Migration = (raw: RawSave) => RawSave;

export const MIGRATIONS: Record<number, Migration> = {
  /**
   * v1 → v2：世界变活（ADR_WORLD_ALIVE §8）。
   *
   * 补的是 `SAVE_V2_ADDED_PATHS` 那 15 条路径，横跨 buildings / critters / oracle /
   * props 四类：
   *   - `world.oracle`：v1 没有石板，迁移后是空数组；
   *   - `props[].sourceTaskKind` / `sourceTaskId` / `sourceSummary`：v1 的摆件没有来源，记 null；
   *   - `buildings[].sourceTaskId` / `sourceSummary`：同上，楼也没有；
   *   - `settled[].completedAtClock`：曾在这条迁移里补过（旧样例），v1 冻结后它已必填，
   *     这里保留兜底以防极早的非样例档；对合法 v1 档是无操作；
   *   - `world.critters[]` 及其五个叶子：v1 没有活物，迁移后是空数组。
   *
   * 这里原来写「只补 v2 真正新增的两处，不猜别的」，然后只列了 oracle 与 props 两处。
   * 「两处」这个数与它自己脚下那份表矛盾（15 条、四类），「不猜别的」也与满屏的
   * `??` 默认值矛盾——那句话自己在 `completedAtClock` 上找补过，但 buildings 与
   * critters 两处只字未提。照着「两处」去改这条迁移，会漏掉三类。
   *
   * 历史摆件不编造来源。`null` 在世界里读作「来路不明」，这是诚实的默认值。
   */
  1: (raw) => {
    const world = isObject(raw.world) ? raw.world : {};
    const settled = Array.isArray(world.settled) ? world.settled : [];
    const props = Array.isArray(world.props) ? world.props : [];
    const meta = isObject(raw.meta) ? raw.meta : {};
    return {
      ...raw,
      schemaVersion: 2,
      world: {
        ...world,
        settled: settled.map((record) =>
          isObject(record) ? { ...record, completedAtClock: record.completedAtClock ?? 'local' } : record,
        ),
        props: props.map((prop) =>
          isObject(prop)
            ? {
                ...prop,
                sourceTaskKind: prop.sourceTaskKind ?? null,
                sourceTaskId: prop.sourceTaskId ?? null,
                sourceSummary: prop.sourceSummary ?? null,
              }
            : prop,
        ),
        buildings: (Array.isArray(world.buildings) ? world.buildings : []).map((b) =>
          isObject(b)
            ? { ...b, sourceTaskId: b.sourceTaskId ?? null, sourceSummary: b.sourceSummary ?? null }
            : b,
        ),
        oracle: Array.isArray(world.oracle) ? world.oracle : [],
        critters: Array.isArray(world.critters) ? world.critters : [],
      },
      meta: { ...meta, schemaFingerprint: SCHEMA_V2_FINGERPRINT },
    };
  },

  /**
   * v2 → v3：一次把三个新字段的位置扩好（见 SCHEMA_V3_FINGERPRINT 的注释）。
   *
   * 缺省值的理由：
   *   - `lampOil: 1`：满油。老档没有灯，读作「灯还亮着」比读作「已经灭了」诚实——
   *     灭灯是一个发生过的事件，不能凭空安到旧世界上。
   *   - `tideOverride: null`：没有覆盖。老档的潮汐本来就走纯函数，不该凭空多一段。
   *   - `worldChangeVersion: 0`：老档没有记过改变次数，从零开始数。
   *
   * 三个都是**位置**：这一版不写业务，谁去改它们由各自的票决定。
   */
  2: (raw) => {
    const world = isObject(raw.world) ? raw.world : {};
    const meta = isObject(raw.meta) ? raw.meta : {};
    const villagers = Array.isArray(world.villagers) ? world.villagers : [];
    return {
      ...raw,
      schemaVersion: 3,
      world: {
        ...world,
        villagers: villagers.map((villager) =>
          isObject(villager) ? { ...villager, lampOil: villager.lampOil ?? 1 } : villager,
        ),
        tideOverride: world.tideOverride ?? null,
        worldChangeVersion: world.worldChangeVersion ?? 0,
      },
      meta: { ...meta, schemaFingerprint: SCHEMA_V3_FINGERPRINT },
    };
  },

  /**
   * v3 → v4：一次把四个槽位扩好（见 SCHEMA_V4_FINGERPRINT 的注释）。
   *
   * 缺省值的理由——老档里这些事都没发生过，不能凭空安上去：
   *   - `nameState: 'held'`：名字都在自己身上。老档没人抵押过名牌。
   *   - `carries: []`：两手空空。老档没有「带着灯/鞋通行」这回事。
   *   - `grime: 0`：干净的。老档的物件没有污浊度，读作脏等于凭空弄脏它。
   *   - `reveal: null`：没有可露的话。老档的物件没有藏话。
   */
  3: (raw) => {
    const world = isObject(raw.world) ? raw.world : {};
    const meta = isObject(raw.meta) ? raw.meta : {};
    const villagers = Array.isArray(world.villagers) ? world.villagers : [];
    const props = Array.isArray(world.props) ? world.props : [];
    return {
      ...raw,
      schemaVersion: 4,
      world: {
        ...world,
        villagers: villagers.map((villager) =>
          isObject(villager)
            ? {
                ...villager,
                nameState: villager.nameState ?? 'held',
                carries: villager.carries ?? [],
              }
            : villager,
        ),
        props: props.map((prop) =>
          isObject(prop)
            ? { ...prop, grime: prop.grime ?? 0, reveal: prop.reveal ?? null }
            : prop,
        ),
      },
      meta: { ...meta, schemaFingerprint: SCHEMA_V4_FINGERPRINT },
    };
  },
};

export function migrateSave(raw: RawSave): RawSave {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  // 迁移前先按起点版本自证：被改过的旧档不能靠迁移「洗白」成合法档。
  if (version === 1) assertSaveV1(raw);
  if (version === 2) assertSaveV2(raw);
  if (version === 3) assertSaveV3(raw);
  let current = raw;
  let cursor = version;
  while (cursor < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[cursor];
    if (migration === undefined) throw new Error(`没有从 v${cursor} 升级的迁移`);
    current = migration(current);
    const next = typeof current.schemaVersion === 'number' ? current.schemaVersion : cursor + 1;
    if (next <= cursor) throw new Error('迁移没有推进版本号');
    cursor = next;
  }
  return current;
}
