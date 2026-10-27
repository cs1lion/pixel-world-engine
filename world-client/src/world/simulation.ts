/** 世界运行时。固定步长由调用方给，内部不读时钟，因此可以离线回放。
 *
 * 外部只能从一个口子进来：enqueue()。命令在下次 update() 开头统一结算，
 * 渲染循环里不会出现半更新的中间态。
 *
 * 角色是数组：每个小人各自有状态机、路线、任务与等待队列；命令一次只叫一个人。
 */

import type { WorldGrid } from './grid.ts';
import { CARRY_ITEMS, gateFilter, isCarryItem } from './gate.ts';
import { TASK_PROFILES, taskDurationFor } from './tasks.ts';
import { pickVenue, type VenueCandidate, type VenueMiss } from './venue.ts';
import { fogAt, revealedRadiusFor } from './fog.ts';
import {
  TIDE_OVERRIDE_MAX_MS,
  effectiveTideLevel,
  makeTideOverride,
  tideOverrideRejection,
  tideView,
  type TideOverrideRejection,
} from './tide.ts';
import { awaitingDecree } from './decree.ts';
import type { TaskFoldState } from './task-events.ts';
import type { WorldChange } from './world-changes.ts';

import { parseOracle } from './oracle.ts';
import { parseOracleBuild, type BuildIntent } from './oracle-build.ts';
import { parseOracleMiracle } from './oracle-miracle.ts';
import { routeIntent } from './intent-router.ts';
import type { IntentModel } from './intent-router.ts';
import type { ParsedIntent } from './intent-schema.ts';
import { summarizeWorld } from './world-state.ts';
import { summarizeForIntent } from './intent-context.ts';
import type { BreathingRegion, GatedRegion } from './intent-context.ts';
import { addTrail, visibleTrails, type TrailMap } from './trails.ts';
import { carryKindFor } from './carry.ts';
import { WILD_PREFABS } from './setup.ts';
import {
  nextProp,
  MILESTONE_POINTS,
  describePropSource,
  POINTS_PER_TASK,
} from './faith.ts';
import { GRIME_CLEAN, grimeAfter, landProp } from './grime.ts';
import { routineBeats, routineFor, shelterTarget, type RoutineBeat } from './routines.ts';
import {
  clearWeather,
  fadingToClear,
  renderIntensity,
  stepWeather,
  weatherFor,
  type WeatherState,
} from './weather.ts';
import type {
  CommandResult,
  ConstructionSnapshot,
  CarryKind,
  Critter,
  Facing,
  CarryItem,
  GridPoint,
  NameState,
  OracleRecord,
  PendingDispatch,
  PlacedBuilding,
  PrefabBlueprint,
  PropKind,
  TaskRecord,
  TaskKind,
  Vec2,
  VillagerMode,
  VillagerSnapshot,
  Weather,
  WorkstationActivity,
  WorkstationSnapshot,
  WorldEvent,
  WorldProp,
  WorldSnapshot,
} from './types.ts';
import { ORACLE_SLAB_LIMIT } from './types.ts';
import type { SavedVillager, SettledRecord, TideOverride, WorldSave } from './save.ts';
import { CURRENT_SCHEMA_VERSION, SCHEMA_V4_FINGERPRINT } from './save.ts';

/**
 * 上游事件带的时间 → settled 用的 epoch 毫秒。
 *
 * 事件流约定给毫秒；但历史存档与旧调用方可能给秒，所以这里做一次归一：
 * 大于 1e12 的当毫秒原样，否则当秒 ×1000。缺失/非法 → null，
 * **禁止用本地时间顶替**——那会让"这单什么时候成的"变成"我什么时候读到的"。
 */
export function completedAtMs(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value > 1e12 ? value : value * 1000);
}

/** 三件神迹。纯世界侧动作，不是你的话。 */
export type MiracleKind = 'light' | 'tree' | 'cat';

/** 猫在世界里待多久。到点自己走开，不占位。 */
const CAT_DWELL_MS = 20_000;

/** 已经就是这个天气时的回执。`ok: false` = 世界没变，不是命令被拒。 */
const WEATHER_ALREADY: Readonly<Record<Weather, string>> = {
  clear: '天本来就是晴的。',
  rain: '天已经在下雨了。',
  storm: '已经在刮暴雨了。',
};

/** 三种拒绝各自的说法。分开写是因为用户能改的是不同的东西。 */
const TIDE_REJECTIONS: Readonly<Record<TideOverrideRejection, string>> = {
  'level-out-of-range': '潮位只能是 0 到 1 之间的一个数。',
  'duration-not-positive': '潮位要拨住多久？给一个正数毫秒。',
  'duration-too-long': `潮水最多拨住 ${TIDE_OVERRIDE_MAX_MS / 60_000} 分钟——再久就成了夺权，不只是拨一下。`,
};

export type WorldCommand =
  /**
   * 一句神谕的原文。世界自己解析，解析结果再落到下面的具体命令上。
   *
   * 只有走这条入口才会进石板：外部 Agent 的 `feed`、上游的 `syncEvents` 都不是
   * 「你对世界说的话」，不该被记成神谕。
   */
  | { readonly kind: 'oracle'; readonly raw: string }
  /**
   * 模型判定的结果，回队结算。
   *
   * 为什么不直接调 `applyIntent`：模型是异步的，回来时世界可能已经走了几拍。
   * 回队让它的时序与玩家同步输入完全一致——石板、事件、排队顺序都不特殊。
   */
  | {
      readonly kind: 'intent';
      readonly intent: ParsedIntent;
      readonly raw: string;
    }
  /**
   * 模型判定的结果，回队结算。**只有 `classifyLater` 产得出这一种。**
   *
   * 与上面的 `intent` 分成两个成员，是为了让「这是从模型回来的」成为类型层面
   * 的事实，而不是一个忘了填就静默失效的可选字段（`owner?: string` 那一版
   * 就是：将来任何一个新的调用点忘了写它，整条保护一声不响地消失，类型不报错、
   * 测试不红）。分开之后，忘了填 `askedAtSeq` 编译不过。
   *
   * 为什么迟到的答复要单独一种：模型的答复要过网络，回来时那一行可能已经归了
   * 别的东西。见 `receiptOwnerSeq`。
   */
  | {
      readonly kind: 'intentFromModel';
      readonly intent: ParsedIntent;
      readonly raw: string;
      /** 发问那一条神谕的入队序号。回执那一行归谁，按它算，不按本条的序号算。 */
      readonly askedAtSeq: number;
    }
  | { readonly kind: 'dispatch'; readonly taskKind: TaskKind; readonly summary: string }
  | { readonly kind: 'complete'; readonly target?: string }
  | { readonly kind: 'cancelPending'; readonly id?: string }
  | { readonly kind: 'setWeather'; readonly weather: Weather }
  /**
   * 拨一下潮水：**有期限的**，到期回到潮汐自己的节律。
   *
   * 不是"设潮位"。前者是一次事件，后者是夺权——潮汐同时是世界时钟，
   * 让它被人永久按住，所有依赖它的确定性都会跟着松动。
   */
  | { readonly kind: 'setTideLevel'; readonly level: number; readonly durationMs: number }
  /**
   * 造物。`at` 省略时自动选址（旧行为）；给了就是玩家在造物模式里指定的位置。
   */
  | {
      readonly kind: 'build';
      readonly prefabId: string;
      readonly instanceId: string;
      readonly at?: GridPoint;
      /** 这次建造的来由，写进建筑的来源字段。省略表示"没有来由"。 */
      readonly source?: { readonly taskId: string; readonly summary: string };
    }
  /**
   * 神迹：纯世界侧动作，不是你的话，所以不刻石板。
   *
   * 三件：点灯、种树、召唤猫（猫只做氛围，会自己走开）。
   * `at` 省略时落在祭坛周围；给了就落在指定位置。
   * 指定位置要过三道：在界内、不在迷雾里、格子空着。
   */
  | { readonly kind: 'miracle'; readonly miracle: MiracleKind; readonly at?: GridPoint }
  /**
   * 拆掉一栋楼。
   *
   * 三条拒绝：找不到、正在施工、有人在里面干活。
   * 后者不是为了保护建筑，是为了保护正在干的活——拆了会让那单悬空。
   */
  | { readonly kind: 'demolish'; readonly instanceId: string }
  /**
   * 上游事件流。这是世界接真实工作的**唯一**入口。
   *
   * 传的是调用方已经折叠好的结果（`foldTaskEvents` 的输出），不是原始事件：
   * 折叠是纯函数，世界只负责把结果与自己的任务表对齐。判断全在折叠层，
   * 这里不做业务推理——这条边界让「事件怎么变成活」可以离线单测。
   *
   * `connected: false` 表示这一轮没读到（断网/超时）。世界照常过日子，
   * 只是不更新任何上游状态——**绝不能**把"没读到"当成"全都撤了"。
   */
  | {
      readonly kind: 'syncEvents';
      readonly fold: TaskFoldState;
      readonly connected: boolean;
    }
  /**
   * 抵押或赎回一个角色的名牌。
   *
   * 这是世界侧的状态开关，不是玩家操作：v2 只交付「抵押后不再被派活」这道判定
   * （SPEC_V2 §4.6），欠债的来处留给日后的经济票。没有这条命令，
   * `nameState` 就是一个永远停在 `held` 的死字段。
   */
  | { readonly kind: 'setNameState'; readonly villagerId: string; readonly nameState: NameState }
  /**
   * 把一个角色带着的东西设成 `carries`（灯、鞋）。
   *
   * 渡有仪式的另一半天。区域能要东西了，可没有这条命令，`carries` 就永远是
   * 空数组，每一道门都是一堵永远的墙——那比没有门更糟：世界看着能走，
   * 其实谁都走不动。灯与鞋从哪来交给设定集和日后的票，这里只交付
   * 「她带着什么」这个状态位本身，理由同 `setNameState`。
   *
   * 整体替换而不是增删：白名单命令说出口的必须是完整事实，
   * 「加一双鞋」那种半句会让世界和说话的人对不上账。
   * **说话的人得知道她此刻带着什么，才说得出这个完整事实。**
   * 喂给模型的现状里有 `carries`，模型算得出来；离线规则没有名册也没有
   * 兜里有什么，它算不出来。所以另有一条 `removeCarries`：它说的不是
   * 结果，是动作——世界从她现有的里减。没有它，「收回她的鞋」只能翻成
   * `carries: []`，那会把她手里的灯一起拿走，而用户要的只是一双鞋。
   */
  | { readonly kind: 'setCarries'; readonly villagerId: string; readonly carries: readonly CarryItem[] }
  | { readonly kind: 'removeCarries'; readonly villagerId: string; readonly carries: readonly CarryItem[] }
  /**
   * 洗一件摆件（清洗即还原，SPEC_V2 §4.6）。污浊度归零，露话因此看得见。
   *
   * 与 `setCarries` / `setNameState` 同一条边界：它只存在于客户端的命令表里，
   * 上游收不到、模型也说不出（`IntentKind` 里没有它）。清洗是玩家对世界做的
   * 一件事，不是世界从上游听来的一句话。
   *
   * 不做小游戏、不做物品栏（SPEC_V2 §4.6 明写不加这两样）：一按就干净，
   * 报酬是露出来的那句话。要「搓三下才洗干净」那是另一个票。
   */
  | { readonly kind: 'cleanProp'; readonly propId: string };

/**
 * 不需要特殊仲裁的命令：`apply()` 亲自接走的那两种之外的全部。
 *
 * 排掉 `oracle`（要解析、要发问）与 `intentFromModel`（要按发问那一条的序号
 * 仲裁，不按本条入队的序号）。参数写成这个类型，`applyCommand` 里的 switch
 * 就是穷尽的——给 `WorldCommand` 加一种而那里忘了写，编译不过。
 */
export type SettledCommand = Exclude<
  WorldCommand,
  { readonly kind: 'oracle' } | { readonly kind: 'intentFromModel' }
>;

export interface NewBuilding {
  readonly building: PlacedBuilding;
  readonly road: readonly GridPoint[];
}

export interface SimulationDeps {
  readonly grid: WorldGrid;
  readonly buildings: readonly PlacedBuilding[];
  readonly altar: GridPoint;
  readonly villagerName: string;
  /**
   * 角色名。至少 1 个；省略时是「主角色 + 助手」两人。
   * 传 3 个名字即可扩到 3 人，逻辑不需要再改。
   */
  readonly villagerNames?: readonly string[];
  /** 设定集提供的出生点、作息与开局带的凭证；每项与 villagerNames 对齐。 */
  readonly villagerProfiles?: readonly {
    readonly at: GridPoint;
    readonly routine: readonly RoutineBeat[];
    /** 开局随身凭证（渡有仪式）。省略就是两手空空。 */
    readonly carries?: readonly CarryItem[];
  }[];
  /**
   * 地域 id → 给人看的叫法。喂模型的世界现状要用它说出「叠浪楼要一盏灯」。
   *
   * 网格只记 id 不记叫法（`SettingPack['regions']` 那段写明别让它背显示名），
   * 所以这一份由拿着设定集的调用方给。省略时现状里那道门只说得出 id——
   * 比不说好，但模型看到的是一个英文词。
   */
  readonly regionNames?: ReadonlyMap<string, string>;
  /**
   * 摆件种类 → 它底下的那几句露话（清洗即还原，SPEC_V2 §4.6）。
   *
   * 与 `regionNames` 同一条规矩：**话是谁的就说谁拿着**。引擎不编设定集的
   * 内容，所以这一份由拿着设定集的调用方给。省略（或某个种类缺席）时
   * 那类摆件没有露话，也就没有什么要盖的——于是一件都不脏。
   *
   * 莞尔镇一份都没给，所以默认世界里没有一件摆件会脏。这不是降级失败，
   * 是槽位空着：v2 只交付承载设定的槽位（SPEC_V2 §6）。
   */
  readonly propReveals?: ReadonlyMap<PropKind, readonly string[]>;
  /**
   * 蓝图注册表。造物神谕（「建一间书阁」）要用它把词换成模板。
   * 省略时造物神谕一律认不出——那是安全的降级，不是错误。
   */
  readonly blueprints?: ReadonlyMap<string, PrefabBlueprint>;
  /**
   * 造物主：把一栋新楼落进世界。返回 null 表示落不下。
   * `at` 省略时自动选址；给了就是玩家指定的位置。
   */
  readonly spawnBuilding?: (
    prefabId: string,
    instanceId: string,
    at?: GridPoint,
    source?: { readonly taskId: string; readonly summary: string },
  ) => NewBuilding | null;
  /** 本地 wall clock（只给 settled.completedAt 的 mock 来源用，不喂逻辑）。 */
  readonly wallClock?: () => number;
  /**
   * 意图模型：规则认不出的话才问它。省略表示纯离线。
   *
   * 这里只放**客户端**，不放提示词与校验——那两样在世界侧已经是确定的了
   * （`intent-prompt.ts` / `intent-schema.ts`），模型只负责产出一份 JSON。
   */
  readonly intentModel?: IntentModel;
  /** 世界尺寸。给意图校验判坐标越界用；省略时从 grid 推。 */
  readonly worldSize?: { readonly width: number; readonly height: number };
  /**
   * 回写：世界改了什么，交出去记进日志。
   *
   * 省略表示纯离线（测试与无服务端的演示）。**世界不读自己写的东西**：
   * `world.changed` 不归折叠层管，所以回写不会变成反馈回路。
   * 调用方负责把失败吞掉——写不进去是世界之外的遗憾，不是世界该停下的理由。
   */
  readonly onChange?: (change: WorldChange, at: number) => void;
}

/** 一个角色的完整本地状态。渲染层只读快照，不碰这里。 */
interface Villager {
  readonly id: string;
  readonly name: string;
  mode: VillagerMode;
  pos: Vec2;
  facing: Facing;
  visible: boolean;
  path: GridPoint[];
  taskId: string | null;
  bubble: string | null;
  bubbleUntil: number;
  saluteUntil: number;
  deliverUntil: number;
  nextRoutineAt: number;
  routineIndex: number;
  routineLabel: string | null;
  inPlaceUntil: number;
  /** 神谕下达时算好的路线，等行礼结束再交给她走。 */
  pendingRoute: GridPoint[];
  /** 这一趟要去哪栋楼。上游同步派活时同样走这条路。 */
  pendingBuilding: PlacedBuilding | null;
  /** 手上带着的东西。郊野返程时非空。 */
  carrying: CarryKind | null;
  /**
   * 灯油余量 0..1（v3 存档字段）。
   *
   * **`Simulation` 只负责原样存与取，不读它做任何决定**：衰减、亮度、
   * 发灰全在渲染层（见 #4）。世界要是读它，确定性回放就不成立了。
   */
  lampOil: number;
  /**
   * 名牌的状态。抵押者接不到新活，但手上的活照干完（SPEC_V2 §4.6）。
   */
  nameState: NameState;
  /**
   * 带着的凭证。渡有仪式据此判某道门过不过得去（SPEC_V2 §4.6）。
   *
   * 开局两手空空：谁给她灯与鞋是日后的票，这一版只把槽位与判定做对。
   */
  carries: CarryItem[];
}

interface WorkstationState {
  readonly remainingMs: number;
  readonly totalMs: number;
}

const SPEED_CELLS_PER_SECOND = 3;
const SALUTE_MS = 700;
const DELIVER_MS = 1400;
const COOLING_MS = 900;
const EVENT_LIMIT = 60;
const CONSTRUCTION_MS = 3200;
const QUICK_DONE_MS = 900;
const DEFAULT_ASSISTANT_NAME = '阿雾';
/** 每个角色自己的等待队列上限。两位都忙且各自满了才拒单。 */
export const MAX_PENDING_DISPATCHES = 3;

/** 交付攒到里程碑时，世界多一件东西。 */
const FAITH_MILESTONE = MILESTONE_POINTS;

export class Simulation {
  private readonly grid: WorldGrid;
  private readonly altar: GridPoint;
  private readonly spawnBuilding:
    | ((
        prefabId: string,
        instanceId: string,
        at?: GridPoint,
        source?: { readonly taskId: string; readonly summary: string },
      ) => NewBuilding | null)
    | undefined;

  private readonly buildings: PlacedBuilding[];
  /**
   * 开局那一刻就有的楼。见 `WorldSnapshot.startupBuildingIds`。
   *
   * 不是 `readonly`：读档后要重记一次（`rememberStartupBuildings`）。
   * 构造时记的是 `deps.buildings`——空壳世界的几栋常驻铺子，不是档里这些。
   */
  private startupBuildingIds: ReadonlySet<string>;
  private readonly villagers: Villager[];
  private readonly tasks: TaskRecord[] = [];
  private readonly activities = new Map<string, WorkstationActivity>();
  private readonly events: WorldEvent[] = [];
  /**
   * 排队等结算的命令，各带一个**入队序号**。
   *
   * 序号是回执那一行「归谁」的唯一依据，所以它必须跟着命令走、并且对所有来路
   * 一视同仁：用户的话、神迹按钮、造物按钮、交付按钮、上游轮询、外部 Agent 的
   * feed，全部排在同一条递增的序列上。按调用点分别记「谁算新」的那种写法
   * （早先的 `receiptOwner` 只认「用户又说了一句话」）漏一个就是一个谎言：
   * 实测「今天天气不错」送进模型之后点一下「神迹：点灯」，灯落下了，4.8 秒后
   * 回执变成「听起来你在感叹天气……所以世界不动」——屏上一盏新灯，回执说世界
   * 没动。神迹、造物、交付、下雨、上游重连五条路全是这样。
   */
  private readonly queue: { readonly command: WorldCommand; readonly seq: number }[] = [];
  /** 下一条命令的入队序号。从 1 起，0 表示「还没有谁占过那一行」。 */
  private nextSeq = 1;
  /**
   * 哪条上游的活、因为哪个原因已经报过一句「派不下去」。键是任务 id，值是原因。
   *
   * **不落档**：这是「上一回说到哪儿了」的记号，不是世界状态。读档之后重新
   * 说一遍也无妨——那句话本身仍然是真的，只是没必要。
   *
   * 为什么不许同一句说第二遍见 `assignFromFeedTo` 里那段：事件流就是世界的
   * 记忆，十六条同样的话会把真正发生的事挤出那十二条的窗口。
   */
  private readonly saidMiss = new Map<string, VenueMiss>();
  private readonly lastResults: CommandResult[] = [];
  private readonly props: WorldProp[] = [];
  /**
   * 走出来的痕迹。**不落档**：能从走动重新累积，存起来只会让存档无限膨胀。
   * 与铺好的 `roads` 是两回事——那个是施工结果，这个是踩踏。
   */
  private readonly trails: TrailMap = new Map();
  /** 神谕石板：只记改变了世界的话。旧在前，封顶 ORACLE_SLAB_LIMIT。 */
  private readonly oracleLog: OracleRecord[] = [];
  /** 氛围实体（猫等）。只影响渲染，不参与任何结算。 */
  private critters: Critter[] = [];
  /** 神迹编号：世界内自增，不用时间戳/随机数，保证可回放。 */
  private nextMiracleNumber = 1;
  /** 正在举急件的那位角色；null 表示没有急件在呈。 */
  private decreeBearer: string | null = null;
  private readonly roads: GridPoint[] = [];
  private readonly constructions = new Map<string, WorkstationState>();

  private readonly beats: readonly (readonly RoutineBeat[])[];
  private weather: WeatherState = clearWeather();
  /**
   * 上一拍的潮位，只用来判断"在涨还是在退"。
   *
   * 潮位本身不存字段：它是 `now` 的纯函数（`tideLevelAt`），存了反而会在
   * 回放时和 `now` 打架。这里留一个上一拍的值，只为给状态行一句话。
   */
  private lastTideLevel = 0;
  /**
   * 潮位覆盖：一句话让潮水涨/退，到期自动失效。
   *
   * **过期不删字段，读的时候判。** 每次 `stepTide` 都拿 `now` 跟 `until` 比，
   * 过期就忽略它。这样回放与读档不会因为「谁先清理字段」的时序不同而分叉——
   * 一个需要被"清理"的状态，迟早会在某条路径上漏掉清理。
   */
  private tideOverride: TideOverride | null = null;
  /**
   * 世界被玩家实质改变过几次（v3 存档字段）。**只存不用**：写它是 #8 的事。
   */
  private worldChangeVersion = 0;
  private faithPoints = 0;
  private milestones = 0;
  /** 交付统计按来源分开：上游的活只有上游能收，沙盒/离线本地另计。 */
  private feedDeliveries = 0;
  private localDeliveries = 0;
  /** 每个角色各自的交付归属（上游/本地分开），日报按人分账用。 */
  private readonly deliveryTally = new Map<string, { feed: number; local: number }>();
  /** 私有结算日志：save-only，不入快照（ADR_SAVE §2.1）。 */
  private readonly settledLog: SettledRecord[] = [];
  private readonly wallClock: () => number;
  private readonly blueprints: ReadonlyMap<string, PrefabBlueprint> | undefined;
  /** 地域 id → 给人看的叫法。现状里说「叠浪楼」不说 `bathhouse`。 */
  private readonly regionNames: ReadonlyMap<string, string> | undefined;
  /** 摆件种类 → 露话池。没有池子的种类不攒脏（`grime.ts` 的第三条规则）。 */
  private readonly propReveals: ReadonlyMap<PropKind, readonly string[]> | undefined;
  private readonly intentModel: IntentModel | undefined;
  private readonly worldSize: { readonly width: number; readonly height: number };
  /** 回写出口。省略表示不记日志（离线/测试）。 */
  private readonly onChange: ((change: WorldChange, at: number) => void) | undefined;
  /** 正在问模型的句子。防止同一句被重复投递时问两次。 */
  private readonly pendingClassify = new Set<string>();
  /**
   * 回执那一行现在归谁——**按入队序号记，不记内容**。0 表示还没有谁占过它。
   *
   * 那一行只有一个位置。规则：**最后一条真的往上写了字的命令占着它**；一条
   * 更老的结果迟回来时，那儿已经换了主人，它就把嘴闭上。
   *
   * 为什么是序号而不是「用户最后说了什么」：会往那一行写字的远不止用户的话。
   * 神迹按钮、造物按钮、交付按钮、上游轮询、外部 Agent 的 feed 都写。按
   * 「用户又说话了吗」判，这些全都漏——实测「今天天气不错」送进模型后点一下
   * 「神迹：点灯」，灯落下了，4.8 秒后回执变成「听起来你在感叹天气……所以
   * 世界不动」：屏上一盏新灯，回执说世界没动。那是这个仓库最不容的那一件
   * （「说谎比不去更糟」，`docs/SPEC.md`），而触发点根本不需要第二句话。
   *
   * 被闭上嘴的结果，**世界效果照算**——模型判出来的是一条真命令，该下的雨
   * 照样下、石板照样刻（`settleIntent` 里已经做了）。要拦的只是那句话别落到
   * `#reply` 上。空 message 就是「这话不说」，`oracle-panel` 与
   * `SandboxScene.speak` 都认这个记号。
   *
   * 与 `syncEvents` 的 `!connected` 分支、与 `00e46bf`（场景挂上前的结果整条
   * 丢掉）是同一条规矩的各面：那一行是**刚刚发生过的事**的归宿，不是任何
   * 更早的东西的归宿。
   */
  private receiptOwnerSeq = 0;
  /** 是否已与上游对过账。读档后为 false：对账前不驱动上游单。 */
  private feedReconciled = true;
  /** 上游事件流是否在线。离线时世界照常过日子，但状态行必须说出来。 */
  private feedConnected = false;
  /**
   * 上一次**说出口的**上游状态。null 表示还没说过。
   *
   * 与 `feedConnected` 分开存：后者是事实，前者是「这话讲过了没有」。
   * 轮询每次失败都往里写一句「上游连不上了」，那句话就会在事件流里排成
   * 二十遍——事件流是世界的记忆，重复会把它真正发生过的事挤干净。
   * 去重按状态，不按调用次数，和 `saidMiss` 同一个道理。
   */
  private feedSaidConnected: boolean | null = null;
  /** 最近一次成功读到事件的世界时间（不是墙钟）。 */
  private feedLastReadAt: number | null = null;
  /** 已消费到的事件 id。下次从这里续读。 */
  private feedCursor = 0;

  /** 每个角色自己的等待队列（FIFO）。只存在 Simulation 内，随快照暴露。 */
  private readonly pending = new Map<string, PendingDispatch[]>();
  private nextPendingNumber = 1;

  private now = 0;
  private nextTaskNumber = 1;
  /**
   * 实例编号的水位：世界之内只增不减。
   *
   * 早先拿 `buildings.length + 1` 当编号，拆一栋再建一栋就会得到一个**用过的** id
   * ——旧 id 指向新楼，一句「拆掉 workshop_plot#7」会拆掉不是它说的那一栋。
   *
   * 水位不落档（存档 v3 已冻结），读档时从幸存建筑里重新推：
   * 幸存的 id 一个不变，新建的编号一定大于它们。跨读档后，**已被拆掉**的那个
   * 编号可以再用一次——那需要有人拿着上一次会话的旧 id 来拆，而模型只从
   * 上下文里拿现存 id。这条残余风险记在这里，不让它变成一句没人知道的假设。
   */
  private buildingSerial = 0;
  private readonly usedInstanceIds = new Set<string>();

  constructor(deps: SimulationDeps) {
    this.grid = deps.grid;
    this.altar = deps.altar;
    this.spawnBuilding = deps.spawnBuilding;
    this.wallClock = deps.wallClock ?? (() => Date.now());
    this.blueprints = deps.blueprints;
    this.regionNames = deps.regionNames;
    this.propReveals = deps.propReveals;
    this.intentModel = deps.intentModel;
    this.worldSize = deps.worldSize ?? { width: deps.grid.width, height: deps.grid.height };
    this.onChange = deps.onChange;
    this.buildings = [...deps.buildings];
    // 开局（读档也是开局）那一刻就有的楼。之后 `build` 推进来的都不在这个集合里，
    // 于是「这次玩起来之后造的吗」是一个查得到的事实，不是一个猜出来的判据。
    this.startupBuildingIds = new Set(this.buildings.map((building) => building.instanceId));
    this.seedInstanceIds();
    const names = deps.villagerNames ?? [deps.villagerName, DEFAULT_ASSISTANT_NAME];
    this.beats = names.map((_, index) => deps.villagerProfiles?.[index]?.routine ?? routineBeats(deps.altar, deps.grid));
    this.villagers = names.map((name, index) => ({
      id: `v${index}`,
      name,
      mode: 'idle' as const,
      pos: { ...(deps.villagerProfiles?.[index]?.at ?? deps.altar) },
      facing: 'down' as const,
      visible: true,
      path: [],
      taskId: null,
      bubble: null,
      bubbleUntil: 0,
      saluteUntil: 0,
      deliverUntil: 0,
      // 错开作息起点，两个人不会像复制粘贴一样同进同出。
      nextRoutineAt: 1200 + index * 1400,
      routineIndex: index * 2,
      routineLabel: null,
      inPlaceUntil: 0,
      pendingRoute: [],
      pendingBuilding: null,
      carrying: null,
      // 新世界开局是满油。谁把油烧掉是渲染层的事（见 #4）。
      lampOil: 1,
      // 开局名牌都在自己身上。谁把它抵押出去不在这一版里（#15）。
      nameState: 'held',
      // 开局两手空空，除非设定集说她带着什么（`load.ts` 从 style.lamp 算好）。
      // 谁给她灯与鞋是日后的票——`villager.carry` 那条命令。
      carries: [...(deps.villagerProfiles?.[index]?.carries ?? [])],
    }));
    for (const villager of this.villagers) this.pending.set(villager.id, []);
    for (const villager of this.villagers) {
      this.deliveryTally.set(villager.id, { feed: 0, local: 0 });
    }
    for (const building of this.buildings) {
      this.activities.set(building.instanceId, { kind: 'idle' });
    }
    this.log('info', '世界醒来。祭坛等待神谕。');
  }

  enqueue(command: WorldCommand): void {
    this.queue.push({ command, seq: this.nextSeq });
    this.nextSeq += 1;
  }

  /**
   * 领一个新的实例 id。**领了就算用掉**，即使这一次建造失败。
   *
   * 在入队时就领：命令要下一拍才结算，两栋楼在同一个队列里就不会拿到同一个号。
   */
  nextInstanceId(prefabId: string): string {
    let instanceId: string;
    do {
      this.buildingSerial += 1;
      instanceId = `${prefabId}#${this.buildingSerial}`;
    } while (this.usedInstanceIds.has(instanceId));
    this.usedInstanceIds.add(instanceId);
    return instanceId;
  }

  /** 把已有建筑的编号收进水位。构造与读档各调一次。 */
  private seedInstanceIds(): void {
    for (const building of this.buildings) {
      this.usedInstanceIds.add(building.instanceId);
      const serial = instanceSerialOf(building.instanceId);
      if (serial !== null && serial > this.buildingSerial) this.buildingSerial = serial;
    }
  }

  /** 返回本次 update 结算的命令结果，供调用方展示。 */
  update(deltaMs: number): readonly CommandResult[] {
    if (deltaMs < 0) throw new Error('deltaMs 不能为负');
    this.now += deltaMs;
    this.lastResults.length = 0;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry === undefined) break;
      this.lastResults.push(this.apply(entry));
    }
    this.weather = stepWeather(this.weather, deltaMs);
    this.stepTide();
    this.stepGrime(deltaMs);
    if (this.villagers.some((villager) => villager.mode === 'idle')) {
      const level = effectiveTideLevel(this.now, this.tideOverride);
      for (const villager of this.villagers) {
        if (villager.mode !== 'idle' || villager.path.length > 0) continue;
        const beats = this.beats[Number(villager.id.slice(1))] ?? this.beats[0]!;
        const beat = routineFor(this.weather.kind, beats, villager.routineIndex, level);
        if (beat.tide !== undefined && ((beat.tide === 'low' && level > 0.34) || (beat.tide === 'high' && level < 0.6))) {
          villager.nextRoutineAt = Math.min(villager.nextRoutineAt, this.now);
        }
      }
    }
    this.stepConstructions(deltaMs);
    for (const villager of this.villagers) this.stepVillager(villager, deltaMs);
    this.stepWorkstations();
    this.stepDecrees();
    this.stepCritters();
    for (const villager of this.villagers) this.expireBubble(villager);
    // 固定步长的最后一拍：每个空闲角色先接上游的活，再轮到自己队列里的神谕。
    this.pumpPending();
    return this.lastResults;
  }

  snapshot(): WorldSnapshot {
    const workstations: WorkstationSnapshot[] = this.buildings.map((building) => {
      const activity = this.activities.get(building.instanceId) ?? { kind: 'idle' };
      const elapsedMs =
        activity.kind === 'operating' ? Math.max(0, this.now - activity.startedAt) : 0;
      const progress =
        activity.kind === 'operating'
          ? activity.determinate
            ? Math.min(1, elapsedMs / Math.max(1, activity.estimateMs))
            : null
          : activity.kind === 'cooling' || activity.kind === 'overheating'
            ? 1
            : 0;
      return { buildingId: building.instanceId, activity, elapsedMs, progress };
    });
    const constructions: ConstructionSnapshot[] = [...this.constructions.entries()].map(
      ([buildingId, state]) => ({
        buildingId,
        displayName:
          this.buildings.find((item) => item.instanceId === buildingId)?.displayName ??
          buildingId,
        remainingMs: state.remainingMs,
        totalMs: state.totalMs,
      }),
    );
    const villagers = this.villagers.map((villager) => this.snapshotVillager(villager));
    return {
      now: this.now,
      altar: this.altar,
      /** 兼容旧调用方：villager 等于 villagers[0]（主角色）。 */
      villager: villagers[0] as VillagerSnapshot,
      villagers,
      buildings: this.buildings,
      startupBuildingIds: this.startupBuildingIds,
      workstations,
      constructions,
      tasks: this.tasks.map((task) => ({ ...task })),
      pending: this.allPending(),
      props: this.props,
      oracle: this.oracleLog,
      critters: this.critters,
      // 揭示半径由交付数决定：用得越久，迷雾退得越多。
      fog: {
        center: this.altar,
        revealedRadius: revealedRadiusFor(this.feedDeliveries + this.localDeliveries),
      },
      roads: this.roads,
      trails: visibleTrails(this.trails),
      events: this.events.slice(-12),
      weather: this.weather.kind,
      tide: tideView(this.now, this.tideOverride, this.lastTideLevel),
      faith: { points: this.faithPoints, milestones: this.milestones },
      /** 上游交付与本地交付分开计，不合并成一个数。 */
      deliveries: { feed: this.feedDeliveries, local: this.localDeliveries },
      /** 按角色分账：日报与状态行据此写清是谁交付的。 */
      deliveriesByVillager: this.villagers.map((villager) => {
        const tally = this.deliveryTally.get(villager.id) ?? { feed: 0, local: 0 };
        return {
          villagerId: villager.id,
          name: villager.name,
          feed: tally.feed,
          local: tally.local,
        };
      }),
      feed: {
        connected: this.feedConnected,
        lastReadAt: this.feedLastReadAt,
        cursor: this.feedCursor,
        /** 读档后到首次成功读取前为 false；此时上游单只读展示。 */
        reconciled: this.feedReconciled,
      },
    };
  }

  /**
   * 天气浓淡给渲染层插值雨幕用。
   *
   * 经过 `renderIntensity` 折算：暴雨在同一份浓淡上再重一档。折算放在世界侧而不是
   * 渲染层，是为了让渲染层不必知道天气有几档——加第三档时它一行没改。
   */
  weatherIntensity(): number {
    return renderIntensity(this.weather);
  }

  /** 调试面板用：取最近 N 条事件（快照只带 12 条，面板要 50 条）。只读。 */
  recentEvents(limit = 50): readonly WorldEvent[] {
    const size = Math.max(0, Math.floor(limit));
    return this.events.slice(-size);
  }

  // ---------------------------------------------------------------- commands

  private apply(entry: { readonly command: WorldCommand; readonly seq: number }): CommandResult {
    const command = entry.command;
    if (command.kind === 'oracle') {
      // 序号要一路带到 `speak()`：它发问时得记住「这一行归哪一条」，
      // 模型的答复回来时才有个可比的数。见 `receiptOwnerSeq`。
      return this.arbitrate(entry.seq, this.speak(command.raw, entry.seq));
    }
    if (command.kind === 'intentFromModel') {
      // 迟到的答复：**按发问那一条的序号仲裁**，不按本条入队的序号。
      //
      // 本条是网络回来后才入队的，序号最新——拿它比，它永远赢，那道闸就白设了。
      // 该比的是「我问出这句话的时候，那一行归谁」：那之后只要有别的命令写了
      // 字，序号就更大，这话该闭嘴。
      return this.arbitrate(command.askedAtSeq, this.applyIntent(command.intent, command.raw));
    }
    return this.arbitrate(entry.seq, this.applyCommand(command));
  }

  /**
   * 一条结果能不能落到回执那一行上。
   *
   * 两条路都短：没字可说的原样回去（空结果不擦回执，`oracle-panel` 的
   * `onResult` 认这个记号）；有字而那一行已经归了更新的命令，就把字收回去。
   * 收回去的只是**那句话**，世界效果在调用方那头早就落完了。
   */
  private arbitrate(seq: number, result: CommandResult): CommandResult {
    if (result.message === '') return result;
    if (seq < this.receiptOwnerSeq) return { ok: result.ok, message: '' };
    this.receiptOwnerSeq = seq;
    return result;
  }

  /**
   * 除 `oracle` / `intentFromModel` 之外的命令：原样结算，不仲裁。
   *
   * 这两种不进这里：`oracle` 要解析、要发问，`intentFromModel` 要按发问那一条的
   * 序号仲裁——都由 `apply()` 亲自接。参数类型把它们排掉，于是这个 switch 是穷尽的，
   * 将来给 `WorldCommand` 加一种而这里忘了写，编译不过。
   */
  private applyCommand(command: SettledCommand): CommandResult {
    switch (command.kind) {
      case 'intent':
        return this.applyIntent(command.intent, command.raw);
      case 'dispatch':
        return this.dispatch(command.taskKind, command.summary);
      case 'complete':
        return this.completeManually(command.target);
      case 'cancelPending':
        return this.cancelPending(command.id);
      case 'setWeather':
        return this.setWeather(command.weather);
      case 'setTideLevel':
        return this.setTideLevel(command.level, command.durationMs);
      case 'build':
        return this.build(command.prefabId, command.instanceId, command.at, command.source);
      case 'miracle':
        return this.performMiracle(command.miracle, command.at);
      case 'demolish':
        return this.demolish(command.instanceId);
      case 'syncEvents':
        return this.syncEvents(command.fold, command.connected);
      case 'setNameState':
        return this.setNameState(command.villagerId, command.nameState);
      case 'setCarries':
        return this.setCarries(command.villagerId, command.carries);
      case 'removeCarries':
        return this.removeCarries(command.villagerId, command.carries);
      case 'cleanProp':
        return this.cleanProp(command.propId);
    }
  }

  /**
   * 神迹：直接在世界里多一样东西。不刻石板（这不是你说的那句话），
   * 也不发货币、没有冷却——那会把神迹变成资源管理。
   *
   * 落点规则与信仰摆件一致：祭坛周围的环上找空格，避开已有摆件。
   */
  private performMiracle(kind: MiracleKind, at?: GridPoint): CommandResult {
    const id = `miracle-${this.nextMiracleNumber}`;

    // 指定了位置就先验：在界内、不在迷雾里、格子空着。
    if (at !== undefined) {
      const problem = this.miracleSpotProblem(at);
      if (problem !== null) {
        this.log('warn', problem);
        return { ok: false, message: problem };
      }
    }

    if (kind === 'cat') {
      this.nextMiracleNumber += 1;
      this.critters.push({
        id,
        kind: 'cat',
        // 指定位置时落在格子中央；不给时仍贴着祭坛。
        at:
          at === undefined
            ? { x: this.altar.x + 2.5, y: this.altar.y + 2.5 }
            : { x: at.x + 0.5, y: at.y + 0.5 },
        leavesAt: this.now + CAT_DWELL_MS,
      });
      this.log('info', '神迹：一只猫从街角溜达过来。');
      this.announce({
        change: 'miracle',
        miracle: 'cat',
        at: { x: Math.round(at?.x ?? this.altar.x + 2), y: Math.round(at?.y ?? this.altar.y + 2) },
      });
      return { ok: true, message: '一只猫来了，它会自己走开。' };
    }

    const propKind = kind === 'light' ? 'lamp' : 'tree';
    const label = kind === 'light' ? '一盏神迹点的灯' : '一棵神迹种的树';
    const spot = at ?? this.miracleSpot();
    if (spot === null) {
      return { ok: false, message: '祭坛周围没有空地了。' };
    }
    this.nextMiracleNumber += 1;
    this.props.push(
      landProp(
        {
          id,
          kind: propKind,
          at: spot,
          label,
          sourceTaskKind: null,
          sourceTaskId: null,
          // 神迹不是任务换来的；摘要写明来源，纸面据此区分"神迹"与"哪一单"。
          sourceSummary: kind === 'light' ? '神迹：点灯' : '神迹：种树',
          grime: 0,
          reveal: null,
        },
        this.propReveals?.get(propKind),
        this.props.length,
      ),
    );
    this.log('info', `神迹：${label}落在祭坛边。`);
    this.announce({
      change: 'miracle',
      miracle: kind === 'light' ? 'lamp' : 'tree',
      at: spot,
    });
    return { ok: true, message: `${label}落下了。` };
  }

  /**
   * 指定落点能不能用。返回 null 表示可以，否则返回给玩家看的原因。
   *
   * 三条与建造同一套口径：在界内、不在迷雾里、格子空着。
   * 神迹不占网格（摆件只是装饰），所以只查这三条，不查留白与门口。
   */
  private miracleSpotProblem(at: GridPoint): string | null {
    if (!this.grid.inBounds(at)) return '那里在世界外面。';
    // 判「被占」而不是「不能走」：树与树篱不可走但可以放东西，
    // 建筑不可走且不能放。两者的区别在 occupant。
    const cell = this.grid.at(at);
    if (cell === undefined) return '那里在世界外面。';
    if (cell.occupant !== null) return '那里被建筑占着。';
    if (fogAt(at, {
      center: this.altar,
      revealedRadius: revealedRadiusFor(this.feedDeliveries + this.localDeliveries),
    })) {
      return '那里还没长出来。';
    }
    if (this.props.some((prop) => prop.at.x === at.x && prop.at.y === at.y)) {
      return '那里已经有一件神迹了。';
    }
    return null;
  }

  /** 神迹落点：从祭坛外环开始找，避开已占格与已有摆件。 */
  private miracleSpot(): GridPoint | null {
    const taken = new Set(this.props.map((prop) => `${prop.at.x},${prop.at.y}`));
    for (let radius = 2; radius <= 6; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (const dy of [-radius, radius]) {
          const p = { x: this.altar.x + dx, y: this.altar.y + dy };
          if (!this.grid.isWalkable(p)) continue;
          if (this.grid.zoneOf(p) === 'altar') continue;
          if (taken.has(`${p.x},${p.y}`)) continue;
          return p;
        }
      }
      for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
        for (const dx of [-radius, radius]) {
          const p = { x: this.altar.x + dx, y: this.altar.y + dy };
          if (!this.grid.isWalkable(p)) continue;
          if (this.grid.zoneOf(p) === 'altar') continue;
          if (taken.has(`${p.x},${p.y}`)) continue;
          return p;
        }
      }
    }
    return null;
  }

  /**
   * 一句神谕：解析 → 落到具体命令 → **只有世界真的变了才刻上石板**。
   *
   * 判据是「回执说成功」，而不是「认出了意图」。认得出但没改变世界的
   * （撤销时没有排队单、本来就在下雨）不算世界事件，记下来就是噪音。
   *
   * 认不出的输入不落石板，回执里明说没听懂：石板不是聊天记录。
   */
  private speak(raw: string, seq: number): CommandResult {
    // 先试造物：它认「建一间书阁」这类话，与派活解析器不重叠
    // （那个的动词表里没有「建 / 盖 / 造」）。
    const buildIntent = this.parseBuildIntent(raw);
    if (buildIntent !== null) return this.buildFromIntent(raw, buildIntent);

    // 神迹：「点灯 / 种树 / 召唤猫」，可带坐标。与造物解析器不抢词。
    const miracleIntent = parseOracleMiracle(raw);
    if (miracleIntent !== null) {
      const result = this.performMiracle(miracleIntent.miracle, miracleIntent.at ?? undefined);
      if (result.ok) this.inscribe(raw, result.message);
      return result;
    }

    const intent = parseOracle(raw);
    if (intent.kind === 'unknown') {
      // 规则认不出。有模型就异步问一次——但**这一拍不能等网络**。
      //
      // 快环纪律：`speak()` 在任何情况下都同步返回。模型的结果回来时
      // 走 `enqueue({kind:'intent'})` 重新排队，由下一个逻辑拍结算。
      // 这样世界的时间线不依赖网络延迟，离线时也只是"这句话没听懂"。
      if (this.intentModel !== undefined) {
        void this.classifyLater(raw, seq);
        return { ok: true, message: '这句话规则认不出，正在问模型……' };
      }
      const message = '没听懂这句，世界没有动。';
      this.log('warn', message);
      return { ok: false, message };
    }
    let command: WorldCommand;
    switch (intent.kind) {
      case 'dispatch':
        command = { kind: 'dispatch', taskKind: intent.taskKind, summary: intent.summary };
        break;
      case 'weather':
        command = { kind: 'setWeather', weather: intent.weather };
        break;
      case 'tide':
        command = { kind: 'setTideLevel', level: intent.level, durationMs: intent.durationMs };
        break;
      case 'cancelPending':
        command = { kind: 'cancelPending' };
        break;
      default:
        command = { kind: 'complete' };
    }
    const result = this.applyCommand(command);
    if (result.ok) this.inscribe(raw, result.message);
    return result;
  }

  /**
   * 异步问模型，回来后再排队结算。
   *
   * 三条纪律：
   *
   * 1. **不 await 在快环里。** 调用方是 `speak()`，它必须同步返回。
   * 2. **结果回队，不直接改世界。** 模型的结果和玩家的话走同一条命令队列，
   *    这样时序、石板、事件顺序都与同步输入一致——没有"特权路径"。
   * 3. **失败只是没听懂。** 超时、网络错、JSON 不合法，全部落到 unknown，
   *    绝不退而求其次猜一个。
   */
  private async classifyLater(raw: string, askedAtSeq: number): Promise<void> {
    const model = this.intentModel;
    if (model === undefined) return;
    if (this.pendingClassify.has(raw)) return; // 同一句只问一次
    this.pendingClassify.add(raw);
    try {
      const result = await routeIntent(raw, {
        templates: this.blueprints ?? new Map(),
        worldSize: this.worldSize,
        model,
        // 现取快照：这句话进队列时世界的样子。模型据此少犯「已有工坊还要建」这类错。
        // 门也一起给：渡有仪式在世界上是真的，现状里不说，模型就不知道
        // 「让她进得去」这句话该翻成 carry。
        context: summarizeForIntent(
          this.snapshot(),
          this.gatedRegions(),
          this.breathingRegions(),
        ),
      });
      if (result.intent.kind === 'unknown') {
        // **原因要一路带到回执上。** 模型自己说了为什么听不懂，或者叫模型那一段
        // 出了什么错（超时 / 没配 Key / 输出不合法），都比我这儿一句
        // 「没听懂」有用：用户据此才知道该换句话、还是该去看服务端。
        const message = result.modelError ?? result.intent.reason;
        this.log('warn', message);
        this.enqueue({ kind: 'intentFromModel', intent: { kind: 'unknown', reason: message }, raw, askedAtSeq });
        return;
      }
      this.enqueue({ kind: 'intentFromModel', intent: result.intent, raw, askedAtSeq });
    } catch (error) {
      // `routeIntent` 自己已经把模型失败吞成 unknown 了，所以走到这里的是
      // 它管不着的那种：取快照、拼上下文、入队时抛的错。这条 async 方法由
      // `speak()` 用 `void` 调用，没人 await——不接住就是一次未捕获的
      // Promise 拒绝，浏览器会把它报到控制台，世界这一拍之后照常跑，
      // 但「造物主不可用时世界照常运行」就成了一句运气好的话。
      this.log('warn', `问模型时出了岔子：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pendingClassify.delete(raw);
    }
  }

  /** 把一份已校验的意图落成世界命令。与 `speak()` 的下半段同一条路。 */
  private applyIntent(intent: ParsedIntent, raw: string): CommandResult {
    switch (intent.kind) {
      case 'dispatch':
        return this.settleIntent({ kind: 'dispatch', taskKind: intent.taskKind, summary: intent.summary }, raw);
      case 'setWeather':
        return this.settleIntent({ kind: 'setWeather', weather: intent.weather }, raw);
      case 'setTide':
        // 模型给的是一句「涨潮」，世界落成一条**有期限**的覆盖——与规则那条路
        // （`parseOracle` 的 `tide`）落到同一条命令上，没有第二条特权路径。
        return this.settleIntent(
          { kind: 'setTideLevel', level: intent.level, durationMs: intent.durationMs },
          raw,
        );
      case 'cancelPending':
        return this.settleIntent({ kind: 'cancelPending' }, raw);
      case 'complete':
        return this.settleIntent({ kind: 'complete' }, raw);
      case 'build': {
        const instanceId = this.nextInstanceId(intent.templateId);
        return this.settleIntent(
          { kind: 'build', prefabId: intent.templateId, instanceId, at: intent.at ?? undefined },
          raw,
        );
      }
      case 'demolish': {
        // 指名道姓的一条：世界只认那一栋，找不到就拒——绝不改拆同模板的另一栋。
        // 只有规则解析器（用户说「拆掉抄书斋」没说哪一栋）才走模板那条路，
        // 那条路由 `demolishTargetOf` 判歧义。
        if (intent.instanceId !== undefined) {
          return this.settleIntent({ kind: 'demolish', instanceId: intent.instanceId }, raw);
        }
        const byTemplate = intent.templateId;
        if (byTemplate === undefined) {
          // schema 已经保证二者必给其一；走到这里是上游有人绕过了校验。
          const message = '这条拆除没说拆哪一栋。';
          this.log('warn', message);
          return { ok: false, message };
        }
        const target = this.demolishTargetOf(byTemplate);
        if ('message' in target) {
          this.log('warn', target.message);
          return { ok: false, message: target.message };
        }
        return this.settleIntent({ kind: 'demolish', instanceId: target.instanceId }, raw);
      }
      case 'miracle': {
        const result = this.performMiracle(intent.miracle, intent.at ?? undefined);
        if (result.ok) this.inscribe(raw, result.message);
        return result;
      }
      case 'carry': {
        // 意图说**名字**（上下文只给得起名字），世界命令认 **id**。
        // 这一层翻译放在这里，不放进 schema：schema 只管形状，「阿绣在不在」
        // 是世界才知道的事。点名了世界之外的人，拒——不顺手改递给站在边上的那位。
        const target = this.villagerNamed(intent.villager);
        if ('message' in target) {
          this.log('warn', target.message);
          return { ok: false, message: target.message };
        }
        // 给是整锅换上，收是从现有的里减——两条路不能混。
        // 「收回她的鞋」走 `carries: []` 会把她手里的灯一起拿走。
        return intent.remove !== undefined
          ? this.settleIntent(
              { kind: 'removeCarries', villagerId: target.villager.id, carries: intent.remove },
              raw,
            )
          : this.settleIntent(
              { kind: 'setCarries', villagerId: target.villager.id, carries: intent.carries },
              raw,
            );
      }
      case 'unknown': {
        // 原样回给用户。到这里的原因已经过校验（非空），比我另编一句有用——
        // 「模型调用失败：超时 10000ms」与「这句话没有对应的世界命令」，
        // 用户要做的下一步完全不同。
        this.log('warn', intent.reason);
        return { ok: false, message: intent.reason };
      }
    }
  }

  /** 走命令、成功就刻石板。`applyIntent` 里几处共用的收尾。 */
  private settleIntent(command: SettledCommand, raw: string): CommandResult {
    const result = this.applyCommand(command);
    if (result.ok) this.inscribe(raw, result.message);
    return result;
  }

  /** 试着把这句话认成造物意图。认不出返回 null，交给别的解析器。 */
  private parseBuildIntent(raw: string): BuildIntent | null {
    if (this.blueprints === undefined) return null;
    return parseOracleBuild(raw, this.blueprints);
  }

  /**
   * 把造物意图落成一次建造。
   *
   * 位置：说了就用说的；没说就由 `findBestSlot` 挑——那是世界的判断，
   * 不是模型的。校验仍走 `build` 那一套（重复检查、施工、铺路）。
   */
  private buildFromIntent(raw: string, intent: BuildIntent): CommandResult {
    // 拆：同一份意图，方向相反。找到那栋楼再走 demolish 的三条拒绝。
    if (intent.action === 'demolish') {
      const target = this.demolishTargetOf(intent.templateId);
      if ('message' in target) {
        this.log('warn', target.message);
        return { ok: false, message: target.message };
      }
      const result = this.demolish(target.instanceId);
      if (result.ok) this.inscribe(raw, result.message);
      return result;
    }

    const blueprint = this.blueprints?.get(intent.templateId);
    if (blueprint === undefined) {
      const message = `没有 ${intent.templateId} 这份蓝图。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    // 世界里的每种铺子只有一栋。认出了意图，但要说清"已经有了"——
    // 这比认不出有用：用户知道自己被听懂了，也知道为什么没建。
    const existing = this.buildings.find((b) => b.prefabId === intent.templateId);
    if (existing !== undefined) {
      // 说清"已经有了"，并且如果世界有明确缺口，顺带指出该补什么。
      const gaps = summarizeWorld(this.snapshot()).gaps.missingWild;
      // 用纸面上的说法（「查资料」），不是内部枚举名（research）。
      const hint =
        gaps.length === 0
          ? '想扩建的话说「建个工坊」。'
          : `世界还缺${gaps.map((kind) => TASK_PROFILES[kind].label).join('、')}的郊野铺子。`;
      const message = `已经有${existing.displayName}了。${hint}`;
      this.log('warn', message);
      return { ok: false, message };
    }
    const instanceId = this.nextInstanceId(intent.templateId);
    const result = this.build(intent.templateId, instanceId, intent.at ?? undefined, {
      taskId: `oracle-build-${instanceId}`,
      summary: `按神谕建了${blueprint.displayName}`,
    });
    if (result.ok) this.inscribe(raw, result.message);
    return result;
  }

  /**
   * 「拆掉抄书斋」——只说模板、没说哪一栋时，世界该怎么办。
   *
   * 世界只允许每种铺子一栋（`build` 里拒第二栋），所以正常只会有一栋。
   * 但**不假设**：真有两栋（比如读档读进了旧版本留下的）时，必须让用户
   * 说清是哪一栋，而不是替用户挑第一栋——那正是「替你改主意」。
   */
  private demolishTargetOf(
    templateId: string,
  ): { readonly instanceId: string } | { readonly message: string } {
    const matches = this.buildings.filter((building) => building.prefabId === templateId);
    if (matches.length === 1 && matches[0] !== undefined) {
      return { instanceId: matches[0].instanceId };
    }
    const name = this.blueprints?.get(templateId)?.displayName ?? templateId;
    if (matches.length === 0) return { message: `没有${name}可拆。` };
    const ids = matches.map((building) => building.instanceId).join('、');
    return { message: `有 ${matches.length} 栋${name}（${ids}），说清拆哪一栋。` };
  }

  /**
   * 按名字找出**那一个**人。
   *
   * 与 `demolishTargetOf` 是同一种约束的另一个实例：一个名字指着两个人时，
   * 把东西递给排在前头的那位就是替用户挑了人。`villagerNames` 是调用方给的、
   * 读档也不查重名，所以「两个莞尔」进得来——不假设它进不来。
   *
   * 返回带 `message` 的失败而不是抛：这句话要说给用户听，说清世界上都有谁。
   */
  private villagerNamed(
    name: string,
  ): { readonly villager: Villager } | { readonly message: string } {
    const matches = this.villagers.filter((item) => item.name === name);
    if (matches.length === 1 && matches[0] !== undefined) return { villager: matches[0] };
    const known = this.villagers.map((item) => item.name).join('、');
    if (matches.length === 0) {
      return {
        message:
          known === ''
            ? `世界上还没有叫「${name}」的人。`
            : `世界上没有叫「${name}」的人；有的是 ${known}。`,
      };
    }
    const ids = matches.map((item) => item.id).join('、');
    return { message: `有 ${matches.length} 个人叫「${name}」（${ids}），说清是哪一个。` };
  }

  /** 刻石板。只记真正改变了世界的那句话；超出上限丢最旧。 */
  private inscribe(raw: string, receipt: string): void {
    this.oracleLog.push({ raw, receipt, at: this.now });
    if (this.oracleLog.length > ORACLE_SLAB_LIMIT) {
      this.oracleLog.splice(0, this.oracleLog.length - ORACLE_SLAB_LIMIT);
    }
  }

  /**
   * 事件流落地。这是世界接上游工作的**唯一**入口，也是唯一一条替换式命令。
   *
   * 与旧 `sync` 的根本区别：旧的是**快照**——「不在列表里」既可能是撤单，
   * 也可能是这一页没取到，只能靠一个 `complete` 标志去猜。事件流没有这个问题：
   * 撤单是一个显式事件，「没发生」就是没发生。缺页只会漏事件，不会伪造出撤单。
   *
   * `fold` 是调用方已经折叠好的结果（纯函数，见 `task-events.ts`）。
   * 世界只负责把折叠结果与自己的任务表对齐——判断全在折叠层，这里不做业务推理。
   */
  private syncEvents(fold: TaskFoldState, connected: boolean): CommandResult {
    this.feedConnected = connected;
    // 连没连上，只在**变了**的时候说一次。
    //
    // 从前每次轮询失败都往事件流里写一句「上游连不上了，世界照常过日子。」。
    // 实测断线 20 次轮询，那句话就在世界的记忆里排了 20 遍，真正发生过的
    // 事被挤得一条都不剩；而它每次还作为命令结果发给界面，把用户上一句话
    // 的回执擦掉，换成一句他没问过的事——他说「下雨了」，屏上一秒后是
    // 「上游连不上了」。
    //
    // 「说错了比不说更糟，可把一句话说二十遍也不是诚实，是噪音。」这与
    // `saidMiss` 是同一个病：按状态去重，不按调用次数。
    const previous = this.feedSaidConnected;
    const changed = previous !== connected;
    this.feedSaidConnected = connected;
    if (!connected) {
      // 回执那一行是**用户自己的话**的归宿，不是上游状态的归宿：上游在顶栏
      // 「上游离线」与事件流里各有一处，都说得比这句全（连「手上的单可能
      // 不全」都写着）。所以这句话只在状态刚变那一次作为结果出去，之后
      // 给空——空结果不擦回执，见 `oracle-panel.ts` 的 onResult。
      if (!changed) return { ok: true, message: '' };
      this.log('warn', '上游连不上了，世界照常过日子。');
      return { ok: false, message: '上游连不上了，世界照常过日子。' };
    }
    this.feedLastReadAt = this.now;
    this.feedCursor = fold.cursor;

    // 读档后的第一次成功读取：先对账。对账前上游单只读展示，不派活/不交付/不撤单。
    const firstRead = !this.feedReconciled;
    this.feedReconciled = true;

    const settledIds = new Set(fold.settled.map((item) => item.id));
    const settledAtById = new Map(fold.settled.map((item) => [item.id, item.completedAt]));

    // 一、还在开的活：补进表里（已结算/已撤的 id 不复活，折叠层已经挡住，
    //     这里再挡一次是因为存档里可能还留着上次会话的 settledLog）。
    let added = 0;
    for (const incoming of fold.open) {
      if (this.isSettled(incoming.id)) continue;
      const existing = this.tasks.find((task) => task.id === incoming.id);
      if (existing !== undefined) {
        // 已有的只更新上游知道的两样：说法（标题）与「在问什么」。
        // 别的字段归世界自己管——谁在干、在哪干、干到哪了。
        // 标题必须跟着上游走：它是上游对这条活的唯一描述，世界不自己编。
        if (existing.source === 'ledger') {
          existing.summary = incoming.title;
          existing.blockedQuestion = incoming.question;
        }
        continue;
      }
      this.tasks.push({
        id: incoming.id,
        kind: incoming.kind,
        summary: incoming.title,
        buildingId: null,
        source: 'ledger',
        status: 'assigned',
        createdAt: this.now,
        completedAt: null,
        blockedQuestion: incoming.question,
        ledgerCompletedAt: null,
        workerId: null,
      });
      added += 1;
    }

    // 二、上游说收工了：由实际接下这单的角色走正常交付。
    //     读档后的第一次读取只对齐、不交付——那是上一次会话就该发生的事，
    //     在这里补做会让时间线错位（她会在刚打开的页面上突然开始庆祝）。
    let finished = 0;
    for (const task of [...this.tasks]) {
      if (task.source !== 'ledger') continue;
      if (!settledIds.has(task.id)) continue;
      finished += 1;
      task.ledgerCompletedAt = settledAtById.get(task.id) ?? task.ledgerCompletedAt ?? null;
      const owner = this.villagers.find((villager) => villager.taskId === task.id);
      if (firstRead) {
        this.removeTask(task.id);
        continue;
      }
      if (this.isSettled(task.id)) {
        this.removeTask(task.id);
        continue;
      }
      if (owner !== undefined && this.isOnTask(owner)) {
        // 她正在这单上：走正常交付（庆祝、冷却、加信仰），**不能**用 removeTask
        // ——那会把她的 mode 重置成 idle，交付动画当场消失。
        this.finishActiveTask(owner);
        this.dropFromList(task.id);
        this.idleWorkstationFor(task.id);
      } else {
        this.settleDetachedTask(task);
        this.removeTask(task.id);
      }
    }

    // 三、上游撤了单，或者这条活压根不在了：停手、熄火、删掉。
    //     注意这里**不需要** `complete` 标志：事件流里「不在 open 里」只有一种含义
    //     ——它被结算了或被撤了，两种都已在上面处理。剩下的才是真正「日志里没有」，
    //     那是日志缺页，不是撤单——所以只在上游明确说撤时才停手。
    const cancelled = new Set(fold.cancelled);
    for (const task of [...this.tasks]) {
      if (task.source !== 'ledger') continue;
      if (!cancelled.has(task.id)) continue;
      const owner = this.villagers.find((villager) => villager.taskId === task.id);
      if (owner !== undefined && this.isOnTask(owner) && !firstRead) this.abandonActiveTask(owner);
      this.idleWorkstationFor(task.id);
      this.removeTask(task.id);
    }

    if (added > 0) this.log('info', `上游来了 ${added} 条新活。`);
    if (finished > 0 && !firstRead) this.log('done', `上游结了 ${finished} 条。`);
    // 连上这一侧也只在一句话该说的时候说：**真的恢复过**那一次。
    //
    // 与掉线那一侧是同一条规矩（上面 `!connected` 分支的注释写着了）：回执那一行
    // 是用户自己的话的归宿，不是上游状态的归宿。可这里原来每次都回一句
    // 「上游已同步，N 条在册。」——轮询 4 秒一次，于是用户说「下雨了」，
    // 屏上一秒后是「上游已同步」。他不知道雨到底下没下。实测复现过：
    // `scripts/verify-reply.mjs` 走一遍，回执那一行从「雨落下来了。」变成
    // 「上游已同步，0 条在册。」，而世界时间与天气都照常变了。
    //
    // 第一次就连上不算「连上了」：没有东西恢复过，那句话是编一个事件。
    // 而这句话里的每一样信息状态行都另有其一处在说，且说得更全——
    // 在册数在「上游交付 N 单」，在等的答复在状态行末尾与急件面板各一处。
    // 所以稳态下给空，不损失任何用户读得到的东西。
    if (previous === false) {
      this.log('info', '上游连上了。');
      return { ok: true, message: '上游连上了。' };
    }
    return { ok: true, message: '' };
  }

  /** 这个角色是不是正走在这条活上（赶路、干活、交付都算）。 */
  private isOnTask(villager: Villager): boolean {
    return (
      villager.mode === 'working' ||
      villager.mode === 'saluting' ||
      villager.mode === 'toWork' ||
      villager.mode === 'delivering'
    );
  }

  /**
   * 只把这条活从活动清单里去掉，不碰任何角色的状态。
   *
   * 与 `removeTask` 的区别：那个是「这单没了，人也别干了」，会把角色重置成 idle；
   * 这个用于**正常交付之后**——她正处在 delivering，重置会抹掉交付动画。
   */
  private dropFromList(taskId: string): void {
    const index = this.tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) this.tasks.splice(index, 1);
  }

  /** 把还挂着这条活的铺子熄火。 */
  private idleWorkstationFor(taskId: string): void {
    for (const building of this.buildings) {
      const activity = this.activities.get(building.instanceId);
      if (activity === undefined || activity.kind === 'idle') continue;
      if ('taskId' in activity && activity.taskId === taskId) {
        this.activities.set(building.instanceId, { kind: 'idle' });
      }
    }
  }

  /**
   * 给一个空闲角色派上游来的活：按 id 顺序挑第一条接得下的。
   * 一个角色一次只接一单；铺子被占/施工/走不通就跳过，等下一拍。
   */
  private assignFromFeedTo(villager: Villager): void {
    // 抵押者不接上游的活：派活的三条路径（神谕、上游、自己的排队单）
    // 必须过同一道门，漏掉任一条就会出现「神谕派不下去，上游照样派」。
    if (!this.canTakeWork(villager)) return;
    // 读档后对账前：上游单只读展示，不派活。
    if (!this.feedReconciled) return;
    const open = this.nextFeedTasks();
    // 只给这一拍还开着的活留着「说过了」的记号。活收了，记号跟着收——
    // 不然这份表会跟着任务号一路长下去。
    for (const id of [...this.saidMiss.keys()]) {
      if (!open.some((task) => task.id === id)) this.saidMiss.delete(id);
    }
    for (const task of open) {
      // 原地办的短活不挑铺子：quick 这类压根不去铺子。曾和别的活一起走到
      // pickVenue，于是回一句「这座镇子没有接 quick 的铺子」——把「这类活
      // 不占铺子」说成了「这座镇子缺一座铺子」。而那座镇子可能明明有六栋。
      if (TASK_PROFILES[task.kind].venue === 'in_place') {
        this.startInPlace(villager, task, '上游');
        return;
      }
      // 上游活只去镇内铺子：那是本地确定性工作。郊野留给探索性的神谕活。
      const chosen = pickVenue(this.venueCandidates(), task.kind, 'feed');
      if (!chosen.ok) {
        // 三句不同的话，混成一句就是撒谎：
        //   - 灯潮界六栋楼 boundTask 全是 null，这时候说「没有空闲的」等于
        //     告诉用户「有，只是忙」——它一栋都没有；
        //   - 反过来，镇内被拆空了、只剩郊野铺子时，说「没有空闲的镇内铺子」
        //     也断言了镇内有——而镇内一栋都不剩（demolish 拆得出来）。
        //
        // 同一句不重复说：pumpPending 每个空闲角色每拍都问一遍，两个角色
        // 跑八拍就是十六条一模一样的 warn。而事件流就是世界的记忆——
        // 十六条同样的话会把真正发生的事挤出那十二条的窗口，记忆里那一晚
        // 于是只剩一句重复过十六遍的抱怨。说错了比不说更糟，可把一句话
        // 说十六遍也不是诚实，是噪音。原因变了就再说：那时是句新话。
        if (this.saidMiss.get(task.id) === chosen.reason) continue;
        this.saidMiss.set(task.id, chosen.reason);
        this.log(
          'warn',
          chosen.reason === 'none'
            ? `这座镇子没有接 ${task.kind} 的铺子，「${task.summary}」派不出去。`
            : chosen.reason === 'wild'
              ? `接 ${task.kind} 的铺子都在郊野，上游的活只去镇内，「${task.summary}」先等着。`
              : `没有空闲的镇内铺子承接 ${task.kind}，「${task.summary}」先等着。`,
        );
        continue;
      }
      const building = this.buildings.find((item) => item.instanceId === chosen.venue.instanceId);
      if (building === undefined) continue;
      const route = this.routeTo(villager, building.door);
      if (!route.there && route.path.length === 0) continue;
      task.buildingId = building.instanceId;
      task.workerId = villager.id;
      this.routeToBuilding(villager, task, building, route.path);
      this.log('oracle', `上游派活：${task.summary} → ${building.displayName}（${villager.name}）`);
      return;
    }
  }

  /**
   * 让这个角色原地办一条**已经存在**的短活：不占铺子。
   *
   * 神谕与上游两条路都走这里。上游的活曾和别的活一起进 `pickVenue`，
   * 于是 `quick` 单回一句「这座镇子没有接 quick 的铺子」——那句话把
   * 「这类活不占铺子」说成了「这座镇子缺一座铺子」，而在灯潮界也照样说。
   *
   * 两条路共用这一套**开工**，收尾是分开的：`stepWorking` 只让本地单自己结束，
   * 上游的单等 `task.settled`。见 `stepWorking` 上那段——别把这儿读成
   * 「两条路的收尾也共用」，那句话从前就写在这儿，而它是假的。
   */
  private startInPlace(villager: Villager, task: TaskRecord, origin: '神谕' | '上游'): void {
    const profile = TASK_PROFILES[task.kind];
    villager.mode = 'working';
    villager.taskId = task.id;
    villager.visible = true;
    villager.bubble = '这个我顺手就办了。';
    villager.bubbleUntil = this.now + 1400;
    villager.routineLabel = profile.label;
    villager.inPlaceUntil = this.now + profile.estimateMs;
    villager.path = [];
    task.workerId = villager.id;
    task.status = 'in_progress';
    this.log('oracle', `${origin}：${task.summary}（${villager.name}原地办）`);
  }

  /**
   * 当前所有铺子的候选视图，供 `pickVenue` 挑。
   *
   * 「郊野」按离祭坛的距离判，而不是按分区名：镇内与郊野的铺子可能同属
   * `industry`，只有位置能区分。
   */
  private venueCandidates(): readonly VenueCandidate[] {
    return this.buildings.map((building) => ({
      instanceId: building.instanceId,
      boundTask: building.boundTask,
      // 按**身份**判郊野，不按距离：镇内书斋实测落在 23 格外，按距离会被
      // 误判成郊野，于是神谕活全派给了镇内铺子。prefab id 是可靠的来源。
      isWild: WILD_PREFABS.has(building.prefabId),
      busy:
        this.constructions.has(building.instanceId) ||
        this.activities.get(building.instanceId)?.kind === 'overheating' ||
        this.buildingBusy(building) ||
        // 门口在水里：这栋铺子此刻不接活。人可以涉水，但没道理让他在
        // 齐腰的水里干活。收进 busy 而不是另开字段，两条派活路径都自然受益。
        this.grid.isFloodedAt(building.door),
    }));
  }

  /**
   * 还没人接的上游单，按 id 字典序。
   *
   * 为什么按 id 而不是按上游给的顺序：事件流本身就是有序的（id 单调），
   * 再让上游另发一份 `order` 数组就等于有两个顺序来源，两边不一致时无人能判断
   * 该信哪个。id 是日志自己的顺序，天然稳定、可回放。
   */
  private nextFeedTasks(): readonly TaskRecord[] {
    return this.tasks
      .filter(
        (item) => item.source === 'ledger' && item.status === 'assigned' && item.workerId === null,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 这栋铺子是否已经被一单活着的工作占着（含正在赶路的那一单）。 */
  private buildingBusy(building: PlacedBuilding): boolean {
    const activity = this.activities.get(building.instanceId);
    if (activity !== undefined && activity.kind !== 'idle') return true;
    return this.tasks.some(
      (task) =>
        task.buildingId === building.instanceId &&
        task.status !== 'done' &&
        task.status !== 'failed',
    );
  }

  /**
   * 让停手的角色回到「人能看见、也能走动」的状态（D-1）。
   *
   * 两件事缺一不可：
   *   1. visible = true —— 干活时 visible=false（arriveAtWork），停手后不恢复就**不渲染**。
   *   2. 位置移出建筑 —— 干活时 pos = building.workSpot，那是**占地内**的不可走格；
   *      而 grid.path() 在起点不可走时直接返回空数组（grid.ts path()），
   *      于是她永远迈不出第一步：人看得见，但钉在屋里不动。
   *
   * 两条「单没了」的路径都必须调它：live-sync 走 abandonActiveTask，
   * 读档对账走 removeTask —— 后者原先只重置 mode/taskId/path，两条都没做，
   * 角色会变成 idle + visible=false + 卡在工位，且该状态入档、跨会话持久。
   *
   * 落点选 building.door：assertWorldInvariants 强校验「门口不可通行」会直接拒绝开工，
   * 所以 door 一定是占地之外的可走格，是这里唯一不需要再找空地的落点。
   * 角色本来就在可走格（例如户外被撤单）时不动它，避免无谓位移。
   */
  private restoreOutOfBuilding(
    villager: Villager,
    building: PlacedBuilding | undefined,
  ): void {
    villager.visible = true;
    if (building === undefined) return;
    if (this.grid.isWalkable(this.cellOf(villager.pos))) return;
    villager.pos = { x: building.door.x, y: building.door.y };
  }

  /** 她手上的活被上游撤回：状态机收回 idle，铺子熄火。 */
  private abandonActiveTask(villager: Villager): void {
    const task = this.activeTaskOf(villager);
    if (task === null) return;
    this.clearDeparture(villager);
    task.blockedQuestion = null;
    const building = this.buildingOf(task);
    if (building !== undefined) {
      this.activities.set(building.instanceId, { kind: 'idle' });
    }
    villager.mode = 'idle';
    villager.taskId = null;
    this.restoreOutOfBuilding(villager, building);
    villager.path = [];
    villager.bubble = '这单被撤了。';
    villager.bubbleUntil = this.now + 1600;
    villager.nextRoutineAt = this.now + 1800;
    villager.routineLabel = null;
    this.log('warn', `${task.summary} 被上游撤回，${villager.name}停手了。`);
  }

  /**
   * 改天气。三档都走这一条路：`storm` 只是目标浓淡与时长更大的一档雨。
   *
   * 判"世界没变"用 `kind`，不用 `intensity`：浓淡是渐变过程，几乎每拍都在变；
   * 拿它判会让同一条命令时而被当成"变了"、时而不是。
   *
   * 换档时从**当前浓淡**接着走，不清零：从雨转暴雨不该先停一下再下大。
   */
  private setWeather(weather: Weather): CommandResult {
    if (weather === this.weather.kind) {
      // `ok: false` 表示"世界没变"，与"命令被拒"是两回事；调用方只把 ok 当"变了"用。
      return { ok: false, message: WEATHER_ALREADY[weather] };
    }
    if (weather === 'clear') {
      // 从当前浓淡慢慢退，不当场归零——否则雨幕一帧消失，像开关灯。
      this.weather = fadingToClear(this.weather);
      this.log('info', '神谕说：放晴。雨停了。');
      this.announce({ change: 'weather', weather: 'clear' });
      return { ok: true, message: '天放晴了。' };
    }

    const heavier = weather === 'storm';
    // 从雨转暴雨（或反过来）：浓淡接着当前值往下走，不清零。
    // 停了再下大，中间那一截空白看起来像两条不相干的消息。
    const from = this.weather.kind === 'clear' ? 0 : this.weather.intensity;
    this.weather = weatherFor(weather, from);
    this.log('info', heavier ? '神谕说：暴雨。天黑下来了。' : '神谕说：下雨。天暗下来了。');
    this.scatterToShelter();
    this.announce({ change: 'weather', weather });
    return { ok: true, message: heavier ? '暴雨砸下来了。' : '雨落下来了。' };
  }

  /**
   * 拨一下潮水。写一条有期限的覆盖，不改潮汐的曲线。
   *
   * 两条拒绝，都是"世界不会做这件事"而不是参数格式错：潮位不是 0..1 的数，
   * 时长不是正数（0 或负数等于没拨）。
   *
   * **重复拨同一个位置算世界变了。** 判重会需要比较"还剩多久"，而时长是从
   * 当前时刻算的——两次完全相同的命令落在不同时刻，本来就是两条不同的覆盖。
   * 与其猜用户想不想延期，不如照做：再拨一次 = 从这个时刻重新压住。
   *
   * 时长超上限**拒掉**，不夹。夹住的话「拨 10 分钟」会变成「拨了 2 分钟」，
   * 而回执说成功——世界做了件别的事，调用方还以为办成了。
   */
  private setTideLevel(level: number, durationMs: number): CommandResult {
    const rejection = tideOverrideRejection(level, durationMs);
    if (rejection !== null) return { ok: false, message: TIDE_REJECTIONS[rejection] };

    const next = makeTideOverride(level, durationMs, this.now);
    this.tideOverride = next;
    // 立刻生效：命令落下就该看见水动，不必等下一拍的 `stepTide`。
    this.grid.setTideLevel(effectiveTideLevel(this.now, next));
    // 回写：覆盖会进存档，是会留在世界状态里的事，所以归 `world.changed` 管。
    this.announce({ change: 'tide', level: next.level, until: next.until });
    this.log('info', `神谕拨了一下潮水：${Math.round(level * 100)}%，${Math.round((next.until - this.now) / 1000)} 秒后回到节律。`);
    return {
      ok: true,
      message: `潮水停在 ${Math.round(level * 100)}%，${Math.round((next.until - this.now) / 1000)} 秒后自己回去。`,
    };
  }

  /** 下雨的那一刻，户外还闲着的角色立刻改主意，不等到下一个作息拍。 */
  private scatterToShelter(): void {
    for (const villager of this.villagers) {
      if (villager.mode !== 'idle') continue;
      const cell = this.cellOf(villager.pos);
      const door = shelterTarget(this.buildings, cell);
      if (door === null) continue;
      const route = this.routeTo(villager, door);
      // 已经在门口的不算「没躲成」：她这会儿就站在屋檐下。
      if (!route.there && route.path.length === 0) continue;
      villager.mode = 'sheltering';
      villager.path = route.path;
      villager.bubble = '下雨了，快躲！';
      villager.bubbleUntil = this.now + 2200;
      villager.routineLabel = '跑到屋檐下躲雨';
    }
  }

  private dispatch(taskKind: TaskKind, summary: string): CommandResult {
    // 有人空着就叫一个人；全都在忙或全都抵押了名字才进等待队列。
    const free = this.workerFor();
    if (free === null) return this.enqueuePendingDispatch(taskKind, summary);
    return this.startDispatch(free, taskKind, summary);
  }

  /** 真正派活给某个角色。调用方保证这个角色空闲。 */
  private startDispatch(villager: Villager, taskKind: TaskKind, summary: string): CommandResult {
    const profile = TASK_PROFILES[taskKind];
    if (profile.venue === 'in_place') {
      const task = this.openTask(taskKind, summary, null, villager.id);
      this.startInPlace(villager, task, '神谕');
      return { ok: true, message: '这点小事她当场就办。' };
    }

    // 你派的活优先去郊野：那是探索性的外部工作。
    // 泡在水里的铺子不算数：人可以涉水过去，但没道理让他在齐腰的水里干活。
    const chosen = pickVenue(this.venueCandidates(), taskKind, 'oracle');
    if (!chosen.ok) {
      // 用户在屏幕上读到的就是这一句。一栋都不接的时候说「没有空闲的」，
      // 是让用户去找一座不存在的铺子——那句话比「办不到」更糟。
      const message =
        chosen.reason === 'none'
          ? `这座镇子没有接 ${taskKind} 的铺子。`
          : `没有空闲的 ${taskKind} 铺子。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    const building = this.buildings.find((item) => item.instanceId === chosen.venue.instanceId);
    if (building === undefined) {
      return { ok: false, message: `找不到那栋铺子。` };
    }
    const route = this.routeTo(villager, building.door);
    if (!route.there && route.path.length === 0) {
      const message = `${building.displayName} 门口走不过去。`;
      this.log('warn', message);
      return { ok: false, message };
    }

    const task = this.openTask(taskKind, summary, building.instanceId, villager.id);
    this.routeToBuilding(villager, task, building, route.path);

    this.log('oracle', `神谕：${summary} → ${building.displayName}（${villager.name}）`);
    return { ok: true, message: `神谕已送达 ${building.displayName}。` };
  }

  /** 所有人都忙时把神谕放进等待队列；按角色分，选排队最少的那位。 */
  private enqueuePendingDispatch(taskKind: TaskKind, summary: string): CommandResult {
    /**
     * 抵押者不进候选。
     *
     * 排进她的队列就等于把单子埋了：队列只在角色空闲时才抽，而抵押者**永远**
     * 空闲——这一单会躺到存档过期都没人开工，而调用方以为它已经排上了。
     * 宁可当场拒这一条。
     */
    const candidates = this.villagers.filter((villager) => villager.nameState !== 'pawned');
    if (candidates.length === 0) {
      const message = '没人接得住这条：名字都抵押出去了。';
      this.log('warn', message);
      return { ok: false, message };
    }
    let target = candidates[0]!;
    for (const villager of candidates) {
      if (this.pendingOf(villager).length < this.pendingOf(target).length) target = villager;
    }
    const queue = this.pendingOf(target);
    if (queue.length >= MAX_PENDING_DISPATCHES) {
      const message = `她手上有活，队列也满了（每人最多 ${MAX_PENDING_DISPATCHES} 条）；这条先不接。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    queue.push({
      id: `p${this.nextPendingNumber}`,
      kind: taskKind,
      summary,
      requestedAt: this.now,
      source: 'oracle',
      villagerId: target.id,
    });
    this.nextPendingNumber += 1;
    const position = queue.length;
    this.log('info', `神谕排队：${summary}（${target.name}，第 ${position} 位）`);
    return { ok: true, message: `她手上有活，神谕已排队（第 ${position} 位）。` };
  }

  /**
   * 每个空闲角色各自推进：先接上游的活（真实活优先），再按 FIFO 开自己的排队单。
   * 固定步长末尾调用一次；只依赖 this.now 与命令顺序，回放可复现。
   */
  private pumpPending(): void {
    for (const villager of this.villagers) {
      if (!this.canTakeWork(villager)) continue;
      this.assignFromFeedTo(villager);
      if (!this.isFree(villager)) continue;
      const queue = this.pendingOf(villager);
      const next = queue[0];
      if (next === undefined) continue;
      // 场地原因暂时派不下去就留在队首，下一拍再试，不丢单。
      if (!this.startDispatch(villager, next.kind, next.summary).ok) continue;
      queue.shift();
      this.log('oracle', `排队的神谕开工：${next.summary}（${villager.name}）`);
    }
  }

  /** 撤销排队中的神谕；省略 id 撤最后一条。只动等待队列，不动正在干的活。 */
  private cancelPending(id?: string): CommandResult {
    const queues = this.villagers.flatMap((villager) => this.pendingOf(villager));
    if (queues.length === 0) {
      const message = '没有排队的单可撤销。';
      this.log('warn', message);
      return { ok: false, message };
    }
    if (id === undefined) {
      // 撤全局最后一条：从后往前找第一个非空队列。
      for (let index = this.villagers.length - 1; index >= 0; index -= 1) {
        const villager = this.villagers[index] as Villager;
        const queue = this.pendingOf(villager);
        const removed = queue.pop();
        if (removed !== undefined) return this.finishCancel(removed);
      }
      const message = '没有排队的单可撤销。';
      this.log('warn', message);
      return { ok: false, message };
    }
    const target = queues.find((item) => item.id === id);
    if (target === undefined) {
      const message = `队列里没有 ${id}。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    const villager = this.villagers.find((item) => item.id === target.villagerId);
    if (villager === undefined) {
      const message = `队列里没有 ${id}。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    const queue = this.pendingOf(villager);
    const index = queue.findIndex((item) => item.id === id);
    const removed = queue.splice(index, 1)[0];
    if (removed === undefined) {
      const message = `队列里没有 ${id}。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    return this.finishCancel(removed);
  }

  private finishCancel(removed: PendingDispatch): CommandResult {
    const remaining = this.villagers.reduce(
      (sum, villager) => sum + this.pendingOf(villager).length,
      0,
    );
    this.log('info', `撤销排队：${removed.summary}（剩 ${remaining} 条）`);
    return { ok: true, message: `已撤销排队单「${removed.summary}」，队列还剩 ${remaining} 条。` };
  }

  /** 任务在出发前就结束了：取消行礼计时器、清掉还没交出去的路线与目标楼。 */
  private clearDeparture(villager: Villager): void {
    villager.saluteUntil = 0;
    villager.pendingRoute = [];
    villager.pendingBuilding = null;
  }

  /** 让她停下手上的事、行礼、走进这栋铺子。派活与上游同步共用这一条路。 */
  private routeToBuilding(
    villager: Villager,
    task: TaskRecord,
    building: PlacedBuilding,
    path: readonly GridPoint[],
  ): void {
    villager.mode = 'saluting';
    villager.path = [];
    villager.taskId = task.id;
    villager.bubble = '！吾神降旨！';
    villager.bubbleUntil = this.now + 1500;
    villager.saluteUntil = this.now + SALUTE_MS;
    villager.facing = 'down';
    villager.routineLabel = null;
    villager.pendingRoute = [...path];
    villager.pendingBuilding = building;
  }

  private openTask(
    kind: TaskKind,
    summary: string,
    buildingId: string | null,
    workerId: string,
  ): TaskRecord {
    const task: TaskRecord = {
      id: `t${this.nextTaskNumber}`,
      kind,
      summary,
      buildingId,
      source: 'sandbox',
      status: 'assigned',
      createdAt: this.now,
      completedAt: null,
      blockedQuestion: null,
      workerId,
    };
    this.nextTaskNumber += 1;
    this.tasks.push(task);
    return task;
  }

  private completeManually(target?: string): CommandResult {
    let villager: Villager | undefined;
    if (target === undefined) {
      // 省略目标：保持旧行为，收第一个在干活的人的单。
      villager = this.villagers.find(
        (item) => item.mode === 'working' && this.activeTaskOf(item) !== null,
      );
      if (villager === undefined) {
        const message = '她现在没有在干活，无需交付。';
        this.log('warn', message);
        return { ok: false, message };
      }
    } else {
      // 指定目标。id 先查：id 是世界上唯一的，一个 id 指着两个人不可能。
      // 名字走 `villagerNamed`：两个人都叫莞尔时，原先 `.find` 会把成果递给
      // 排在前头的那位，然后照实说「成果已交付（莞尔）」——替用户挑了人，
      // 而那句话听着像她点名的那位交了。`carry` 与 `demolish` 早就这么办，
      // 这一处是同一条约束漏掉的第三个实例。
      const byId = this.villagers.find((item) => item.id === target);
      const named = byId !== undefined ? { villager: byId } : this.villagerNamed(target);
      if ('message' in named) {
        // 这句话比原先那句「没有叫「X」的角色」有用：它说世界上都有谁，
        // 或者有几个人叫这个名字。
        this.log('warn', named.message);
        return { ok: false, message: named.message };
      }
      villager = named.villager;
      if (villager.mode !== 'working' || this.activeTaskOf(villager) === null) {
        const message = `${villager.name}现在没有在干活，无需交付。`;
        this.log('warn', message);
        return { ok: false, message };
      }
    }
    const task = this.activeTaskOf(villager);
    if (task === null) {
      const message = '她现在没有在干活，无需交付。';
      this.log('warn', message);
      return { ok: false, message };
    }
    // 完成权唯一来源是上游：上游单必须由上游的 `task.settled` 收尾，
    // 人工入口一律拒绝。世界也不替上游写这条收工事件——那会变成回路。
    if (task.source === 'ledger') {
      const message = '这单的完成权在上游，人工不能收尾。';
      this.log('warn', message);
      return { ok: false, message };
    }
    const label = this.feedConnected ? '本地' : '离线本地';
    if (task.buildingId === null) {
      this.finishInPlace(villager, task);
      return { ok: true, message: `这单办了（${villager.name}，${label}，不计入上游）。` };
    }
    this.finishActiveTask(villager);
    return { ok: true, message: `成果已交付（${villager.name}，${label}，不计入上游）。` };
  }

  private build(
    prefabId: string,
    instanceId: string,
    at?: GridPoint,
    source?: { readonly taskId: string; readonly summary: string },
  ): CommandResult {
    if (this.spawnBuilding === undefined) {
      return { ok: false, message: '这个世界没有造物主。' };
    }
    if (this.buildings.some((item) => item.prefabId === prefabId)) {
      return { ok: false, message: '这种铺子已经有一栋了。' };
    }
    const spawned = this.spawnBuilding(prefabId, instanceId, at, source);
    if (spawned === null) {
      return {
        ok: false,
        // 指定位置时要说清是"这里不行"，不是"没地方了"。
        message: at === undefined ? '分区里已经没有合规空地。' : '这个位置放不下。',
      };
    }
    this.buildings.push(spawned.building);
    this.activities.set(spawned.building.instanceId, { kind: 'idle' });
    this.constructions.set(spawned.building.instanceId, {
      remainingMs: CONSTRUCTION_MS,
      totalMs: CONSTRUCTION_MS,
    });
    for (const cell of spawned.road) {
      if (!this.roads.some((p) => p.x === cell.x && p.y === cell.y)) this.roads.push(cell);
    }
    this.log('info', `造物主动工：${spawned.building.displayName}。`);
    this.announce({
      change: 'building.built',
      instanceId: spawned.building.instanceId,
      prefabId: spawned.building.prefabId,
      displayName: spawned.building.displayName,
      summary: source?.summary ?? null,
    });
    return { ok: true, message: `${spawned.building.displayName} 开工建造。` };
  }

  /**
   * 开局（读档也是开局）那一刻就有的楼。之后 `build` 推进来的都不在这个集合里，
   * 于是「这次玩起来之后造的吗」是一个查得到的事实，不是一个猜出来的判据。
   *
   * 读档后要再调一次：`fromSave` 先构造（拿空壳世界的楼记一遍），再把档里的楼换进去。
   */
  private rememberStartupBuildings(): void {
    this.startupBuildingIds = new Set(this.buildings.map((building) => building.instanceId));
  }

  // ---------------------------------------------------------------- villagers

  private pendingOf(villager: Villager): PendingDispatch[] {
    return this.pending.get(villager.id) ?? [];
  }

  private allPending(): PendingDispatch[] {
    return this.villagers.flatMap((villager) =>
      this.pendingOf(villager).map((item) => ({ ...item })),
    );
  }

  /**
   * 此刻在下雨（含暴雨）。
   *
   * 集中一处而不是散着写 `=== 'rain'`：加第三档时漏掉一处，就会出现
   * 「暴雨天有人不打伞」这种只有截图才看得见的 bug。
   */
  private isRaining(): boolean {
    return this.weather.kind === 'rain' || this.weather.kind === 'storm';
  }

  private isFree(villager: Villager): boolean {
    return villager.mode === 'idle' || villager.mode === 'sheltering';
  }

  /**
   * 这个角色**接得下新活吗**。
   *
   * 与 `isFree` 分开是有意的：空闲是「此刻没在做事」，接得下是「有资格接」。
   * 抵押者永远空闲，但接不了——把两个条件合成一个方法，就会在某个只想知道
   * 「她有空吗」的调用点上把抵押者误判成不可用（或反过来放过她）。
   *
   * 呼吸段（SPEC_V2 §4.7）也是同一条理由：她正站在那一屏呼吸段里，就不该被
   * 一件活拽走。这里是派活三条路径（神谕、上游、自己的排队单）共同的那道门，
   * 漏掉任一条就会出现「神谕派不下去，上游照样派」——抵押在那条上栽过一次。
   *
   * 只问**此刻站在哪儿**，不把她锁死：作息照旧把她带走，下一拍她就在外头了。
   * 所以这里是「现在不派」，不是「永远不派」——呼吸段是会过去的。
   */
  private canTakeWork(villager: Villager): boolean {
    return (
      this.isFree(villager) &&
      villager.nameState !== 'pawned' &&
      !this.inBreathing(villager)
    );
  }

  /**
   * 她此刻是不是站在一处呼吸段里（SPEC_V2 §4.7）。
   *
   * 走 `cellOf` 而不是直接递 `villager.pos`：她站在分数坐标上（4.048），
   * 而网格是按整数格索引的——`cells[y * width + x]` 收一个 4.048 就是
   * undefined，于是她一路走过整片呼吸段，世界一次都没看见。这个坑看不见：
   * 她照样在走、照样在干活，只是那一片从不安静。
   *
   * **派活与急件两处都问这件事，所以收在一处**：`cellOf` 那个 Math.round
   * 只需要被写对一次。漏掉哪一处都不会报错，只会让 §4.7 的三条禁令
   * 有一条静静失效。
   */
  private inBreathing(villager: Villager): boolean {
    return this.grid.breathingAt(this.cellOf(villager.pos));
  }

  /** 空闲**且名牌还在自己身上**的角色。抵押者不在候选里。 */
  private workerFor(): Villager | null {
    return this.villagers.find((villager) => this.canTakeWork(villager)) ?? null;
  }

  /**
   * 这个角色走这段路。
   *
   * 她带着什么决定哪道门她过不过得去：区域声明 `requires`，她兜里有 `carries`，
   * 两边是同一套闭集词。世界不问她「有没有灯」——只把她带的和门要的对上，
   * 对不上的格子 A* 当作不可走，于是路线自己绕开。
   *
   * 没有区域声明 `requires` 时这个过滤器处处放行，行为和从前逐字节一致。
   */
  private pathFor(villager: Villager, from: GridPoint, to: GridPoint): GridPoint[] {
    return this.grid.path(from, to, gateFilter(villager.carries, (p) => this.grid.requirementAt(p)));
  }

  /**
   * 世界上有几道门，各要什么、叫什么。喂模型的世界现状用。
   *
   * 从网格拿 id 与凭证，从设定集拿叫法——两处各是一个事实，这里只是对上。
   * 没有门时返回空数组，现状里就一行都不多。
   */
  private gatedRegions(): GatedRegion[] {
    return this.grid.gatedRegions().map((gate) => ({
      id: gate.id,
      name: this.regionNames?.get(gate.id) ?? gate.id,
      needs: gate.needs,
    }));
  }

  /**
   * 哪几处是呼吸段（SPEC_V2 §4.7）。id 配上设定集的叫法。
   *
   * 与 `gatedRegions` 同一道手续：网格只记 id 不背显示名
   * （见 `SettingPack['regions']` 那段「别为了去重把这边改成引用 GridSpec」）。
   */
  private breathingRegions(): BreathingRegion[] {
    return this.grid.breathingRegions().map((place) => ({
      id: place.id,
      name: this.regionNames?.get(place.id) ?? place.id,
    }));
  }

  /**
   * 她走不走得到那儿，路一起拿回来。
   *
   * `pathFor` 的空数组有两种意思：她人已经在那儿，和根本走不到。
   * 混成一种就是对世界说谎——
   *   - 派活那条会说「门口走不过去」然后拒掉一单本该办的神谕，而她正站在门槛上
   *     （`restoreOutOfBuilding` 就是把她放在门口格上的）；
   *   - 急件那条会永远选不出举旨人，而她就站在祭坛边；
   *   - 上游派活那条会静默跳过，单子躺着，谁都不知道为什么。
   * 渡有仪式让「走不到」真的会出现，所以这不是理论上的。
   *
   * 与装载期的 `reaches`（`setup.ts`）是同一句话的两个版本：那边按两手空空判
   * （装载时还没人知道她以后会带上什么），这边按她兜里那几件判。
   */
  private routeTo(
    villager: Villager,
    to: GridPoint,
  ): { readonly path: GridPoint[]; readonly there: boolean } {
    const from = this.cellOf(villager.pos);
    // 终点不可走时 `grid.path` 把终点改写成离它最近的可走地；改写结果正好是
    // 她脚下这格，空数组说的就是「已经到了」。先问出来，两种空数组才分得开。
    const goal = this.grid.isWalkable(to) ? to : this.grid.nearestWalkable(to);
    if (goal !== null && goal.x === from.x && goal.y === from.y) return { path: [], there: true };
    return { path: this.pathFor(villager, from, to), there: false };
  }

  /**
   * 抵押或赎回名牌。只有这两态，写成布尔会读不懂。
   *
   * 抵押是**单向门**：她从此不会再空闲（空闲正是抽队列的时机），
   * 所以抵押前必须把她名下的排队神谕交出去。否则那一单会躺到存档过期
   * 都没人开工，而调用方还以为它已经排上了——那比当场拒掉更坏。
   */
  private setNameState(villagerId: string, nameState: NameState): CommandResult {
    const villager = this.villagers.find((item) => item.id === villagerId);
    if (villager === undefined) return { ok: false, message: `没有 ${villagerId} 这个人。` };
    if (villager.nameState === nameState) {
      return { ok: true, message: `${villager.name}的名牌本来就是这样。` };
    }
    if (nameState === 'pawned') {
      const blocked = this.rehomeQueuedDispatches(villager);
      if (blocked !== null) return blocked;
    }
    villager.nameState = nameState;
    this.log(
      'info',
      nameState === 'pawned' ? `${villager.name}把名牌抵押了出去。` : `${villager.name}赎回了名牌。`,
    );
    return { ok: true, message: nameState === 'pawned' ? `${villager.name}的名字押出去了。` : `${villager.name}赎回了名字。` };
  }

  /**
   * 把一个即将被抵押的角色名下的排队神谕转交给还没抵押的人。
   *
   * 候选是「名牌还在自己身上」而不是「此刻有空」：队列本来就排给忙人，
   * 她一空出手就会开走。转不出去（人人抵押、或队队都满）就返回拒绝，
   * 让调用方知道抵押没成——不能先抵押再悄悄把单子埋了。
   */
  private rehomeQueuedDispatches(villager: Villager): CommandResult | null {
    const queue = this.pendingOf(villager);
    if (queue.length === 0) return null;

    for (const item of [...queue]) {
      const target = this.villagers.find(
        (candidate) =>
          candidate.id !== villager.id &&
          candidate.nameState !== 'pawned' &&
          this.pendingOf(candidate).length < MAX_PENDING_DISPATCHES,
      );
      if (target === undefined) {
        return {
          ok: false,
          message: `${villager.name}手上还排着 ${queue.length} 条神谕，没人接得住；先撤掉再抵押。`,
        };
      }
      queue.splice(queue.indexOf(item), 1);
      this.pendingOf(target).push({ ...item, villagerId: target.id });
      this.log('info', `抵押前转交：${item.summary} → ${target.name}`);
    }
    return null;
  }

  /**
   * 把她带着的东西整个换一遍。
   *
   * 白名单外的词当场拒：`carries` 是和区域 `requires` 对照的闭集，
   * 放进一个不存在的词，表现成一道永远问「要什么」却永远对不上的门。
   */
  private setCarries(villagerId: string, carries: readonly CarryItem[]): CommandResult {
    const villager = this.villagers.find((item) => item.id === villagerId);
    if (villager === undefined) return { ok: false, message: `没有 ${villagerId} 这个人。` };
    const unknown = carries.filter((item) => !isCarryItem(item));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `世界上没有「${unknown.join('、')}」这种东西；带得动的只有 ${CARRY_ITEMS.join('、')}。`,
      };
    }
    villager.carries = [...carries];
    const held = carries.length === 0 ? '两手空空' : carries.join('、');
    this.log('info', `${villager.name}现在带着：${held}。`);
    return { ok: true, message: `${villager.name}现在带着${held}。` };
  }

  /**
   * 从她手里收走几件。**其余的留着。**
   *
   * 与 `setCarries` 分开是因为说话的人未必知道她此刻带着什么：离线规则
   * 没有名册也没有她的兜，「收回她的鞋」翻不成一个完整的最终清单。
   * 硬翻成 `carries: []`，灯就一起没了——用户要的只是一双鞋。
   *
   * 她本来就没带着那几件时，说清楚，不假装收下了什么。
   */
  private removeCarries(villagerId: string, carries: readonly CarryItem[]): CommandResult {
    const villager = this.villagers.find((item) => item.id === villagerId);
    if (villager === undefined) return { ok: false, message: `没有 ${villagerId} 这个人。` };
    const unknown = carries.filter((item) => !isCarryItem(item));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `世界上没有「${unknown.join('、')}」这种东西；带得动的只有 ${CARRY_ITEMS.join('、')}。`,
      };
    }
    const left = villager.carries.filter((item) => !carries.includes(item));
    if (left.length === villager.carries.length) {
      return { ok: false, message: `${villager.name}没有带着${carries.join('、')}。` };
    }
    villager.carries = left;
    const held = left.length === 0 ? '两手空空' : left.join('、');
    const gave = carries.join('、');
    this.log('info', `${villager.name}交出了${gave}，现在带着：${held}。`);
    return { ok: true, message: `${villager.name}交出了${gave}，现在带着${held}。` };
  }

  /**
   * 洗一件摆件（SPEC_V2 §4.6）。污浊度归零，露话因此看得见。
   *
   * 三条拒绝，说的都是事实而不是规则：
   *   - 没有这件东西——摆件只增不删，所以只可能是 id 写错了；
   *   - 它底下没有压着东西——脏只是盖着露话的那层（`grime.ts` 第三条规则），
   *     没有话的摆件从来不脏。正常走不到这儿，读档回来的旧档才可能带着一个；
   *   - 它本来就是干净的——`ok: false` 在这里是「世界没变」，与「命令被拒」
   *     是两回事（同 `setWeather` 撞上同一档时的口径）。
   *
   * 不编「洗好了」：没有露话的摆件从来不脏，对它说洗好了就是世界在演
   * 一件没发生的事。
   */
  private cleanProp(propId: string): CommandResult {
    const index = this.props.findIndex((prop) => prop.id === propId);
    if (index === -1) return { ok: false, message: `世界里没有 ${propId} 这样东西。` };
    const prop = this.props[index]!;
    // 脏只是盖着话的那层东西，所以「有脏而无话」是说不过去的状态。
    // 正常走不到这儿（`stepGrime` 只给有露话的摆件攒脏），但读档回来的
    // 旧档理论上可能带着这么一个：这时候该说的是它底下没有东西，
    // 而不是一句「洗干净了」——那是世界在演一件没发生的事。
    if (prop.reveal === null) return { ok: false, message: `${prop.label}底下没有压着东西。` };
    if (prop.grime <= GRIME_CLEAN) return { ok: false, message: `${prop.label}本来就是干净的。` };
    this.props[index] = { ...prop, grime: 0 };
    this.log('info', `${prop.label}洗干净了。`);
    // 露话是这件事唯一的报酬，所以它必须出现在玩家看得见的地方：
    // 只把 grime 改成 0 而一句话不说，他洗完不知道发生了什么——
    // 那比不洗更糟，因为他以为自己错过了什么。
    return { ok: true, message: `${prop.label}洗干净了。${prop.reveal}` };
  }

  /**
   * 污浊度往前走一格（SPEC_V2 §4.6）。世界自己攒，不等谁动手。
   *
   * 与 `stepWeather` / `stepTide` 同一类：都是世界时钟往前走带来的一件事。
   * 只动 `grime` 一个槽，且只在真的变了时才换对象——不然每一拍都给每件
   * 摆件做一个新引用，快照那边的浅拷贝（`{...prop}`）会全部失效。
   *
   * **没有露话的摆件不攒。** 规则三（`grime.ts` 开头）不能只写在 `landProp`
   * 里：那边管的是「落下来那一下」，这边管的是往后每一拍。只堵一边的话，
   * 莞尔镇（一份露话都不给）的摆件落地时是干净的，240 秒后自己攒到满值，
   * 于是 `cleanProp` 会答一句「洗干净了」——而底下一句话都没有。
   * 那句话在默认世界里听得见，所以这条得长在攒脏的这一步上。
   */
  private stepGrime(deltaMs: number): void {
    for (let index = 0; index < this.props.length; index += 1) {
      const prop = this.props[index]!;
      if (prop.reveal === null) continue;
      const grime = grimeAfter(prop.grime, deltaMs);
      if (grime !== prop.grime) this.props[index] = { ...prop, grime };
    }
  }

  private snapshotVillager(villager: Villager): VillagerSnapshot {
    return {
      id: villager.id,
      name: villager.name,
      mode: villager.mode,
      pos: villager.pos,
      facing: villager.facing,
      visible: villager.visible,
      taskId: villager.taskId,
      bubble: villager.bubble,
      routine: villager.routineLabel,
      umbrella: this.isRaining() && villager.mode !== 'working',
      carrying: villager.carrying,
      lampOil: villager.lampOil,
      nameState: villager.nameState,
      carries: [...villager.carries],
    };
  }

  private stepVillager(villager: Villager, deltaMs: number): void {
    switch (villager.mode) {
      case 'saluting':
        if (this.now >= villager.saluteUntil) {
          villager.mode = 'toWork';
          villager.path = villager.pendingRoute;
          villager.pendingRoute = [];
          if (villager.path.length === 0) this.arriveAtWork(villager);
        }
        return;
      case 'toWork':
        this.walk(villager, deltaMs);
        if (villager.path.length === 0) this.arriveAtWork(villager);
        return;
      case 'working':
        this.stepWorking(villager);
        return;
      case 'delivering':
        if (this.now >= villager.deliverUntil) {
          villager.path = this.pathFor(villager, this.cellOf(villager.pos), this.altar);
          villager.bubble = null;
          // 空数组有两种意思：人已经在祭坛边（那就地交付），和根本走不到。
          // 混成一种就是对世界说谎——后者会说成「东西已经送到了」，
          // 而她人还在没门的那一半。渡有仪式让后者真的会出现。
          if (villager.path.length === 0) {
            if (this.atAltar(villager)) {
              villager.mode = 'toAltar';
              this.dropAtAltar(villager);
            } else {
              villager.bubble = '过不去，东西先留着。';
              villager.bubbleUntil = this.now + 2400;
              // 隔一会儿再试：世界不放弃，但也不每拍喊一遍。
              villager.deliverUntil = this.now + 2000;
              this.log('warn', `${villager.name}到不了祭坛，这一交付先搁着。`);
            }
          } else {
            villager.mode = 'toAltar';
          }
        }
        return;
      case 'toAltar':
        this.walk(villager, deltaMs);
        if (villager.path.length === 0) {
          // 到祭坛就把东西放下。
          this.dropAtAltar(villager);
        }
        return;
      case 'bearingDecree':
        this.walk(villager, deltaMs);
        // 走到祭坛就停下举牌，等用户点开。**不自己回去**：
        // 问题没答完之前，急件一直呈在那里。
        if (villager.path.length === 0) {
          villager.mode = 'idle';
          villager.bubble = '有急件请旨';
          villager.bubbleUntil = this.now + 4000;
        }
        return;
      case 'sheltering':
        this.walk(villager, deltaMs);
        if (villager.path.length === 0) {
          villager.mode = 'idle';
          villager.nextRoutineAt = this.now + 2500;
          villager.routineLabel = this.isRaining()
            ? this.weather.kind === 'storm'
              ? '在屋檐下躲暴雨'
              : '在屋檐下看雨'
            : '雨停了，抖了抖身上的水';
        }
        return;
      case 'idle':
        this.stepIdle(villager, deltaMs);
        return;
    }
  }

  /**
   * 原地办的短活：时间一到自己结束。
   *
   * **但只限本地单。** 上游的活不在这里收尾——`stepWorkstations` 对铺子里的
   * 活早就守着同一条：`determinate` 只在 `task.source === 'sandbox'` 时为真
   * （见 `arriveAtWork` 那段）。原地这条路从前没有那道守卫，于是 `quick` 成了
   * 唯一一种「世界自己宣布干完」的上游活。
   *
   * 那不是漏了一个边界，是把这个世界的根本约定反过来说了。`completeManually`
   * 明写「完成权唯一来源是上游」，`test/unsettled-event-stuck.test.ts` 钉着
   * 「上游没说成的单不算交付」，`save.ts` 的 `SettledRecord` 钉着「`'ledger'`
   * 用上游事件时间，禁止本地时间顶替」。三处都被 `quick` 一个人绕过去：报告说
   * 「已有交付」、名字记进她的功劳簿、信仰照发，而上游从没说过这单成了。
   * 更难看的是它每次还把用户那句急件擦掉（`blockedQuestion` 无条件置 null）——
   * 世界刚请他回答，下一秒就说这单办完了。
   *
   * 上游真说了，走 `syncEvents` 第二节的 `finishActiveTask`：那一刻才结算，
   * 时间戳、庆祝、信仰一样不少。在此之前她照旧在干活，屏上是个正在干活的人。
   */
  private stepWorking(villager: Villager): void {
    const task = this.activeTaskOf(villager);
    if (task === null || task.buildingId !== null) return;
    if (task.source !== 'sandbox') return;
    if (this.now < villager.inPlaceUntil) return;
    this.finishInPlace(villager, task);
  }

  /**
   * 收一件原地办的本地单。
   *
   * 上游的单到不了这儿：`stepWorking` 按 `source` 拦了一道，`completeManually`
   * 也拦了一道。两道都别拆——拆了就是把「完成权唯一来源是上游」这句话作废，
   * 而 `test/unsettled-event-stuck.test.ts` 会红。
   */
  private finishInPlace(villager: Villager, task: TaskRecord): void {
    if (task.status === 'done') return;
    this.clearDeparture(villager);
    task.status = 'done';
    task.completedAt = this.now;
    task.blockedQuestion = null;
    if (!this.isSettled(task.id)) this.recordDelivery(villager.id, task);
    villager.mode = 'idle';
    villager.taskId = null;
    villager.bubble = '办好了。';
    villager.bubbleUntil = this.now + QUICK_DONE_MS;
    villager.nextRoutineAt = this.now + 1800;
    villager.routineLabel = null;
    this.accrueFaith(task);
    this.log('done', `${task.summary} 办完了（${villager.name}）。`);
  }

  private stepIdle(villager: Villager, deltaMs: number): void {
    if (villager.path.length > 0) {
      this.walk(villager, deltaMs);
      return;
    }
    // 举着急件的人不走作息：他得守在祭坛等答复。
    // 不加这条，他一到祭坛就被作息带走，急件呈不出来（实测 v1 在祭坛
    // 停一拍就溜去农田）。
    if (this.decreeBearer === villager.id && this.hasDecree()) return;
    if (this.now < villager.nextRoutineAt) return;

    // 已经站在这一拍的落点上就跳过它，否则开局会在祭坛上干坐一轮。
    const here = this.cellOf(villager.pos);
    const beats = this.beats[Number(villager.id.slice(1))] ?? this.beats[0]!;
    for (let attempt = 0; attempt < beats.length; attempt += 1) {
      // 躲雨那一拍的落点是道门，这里现算现给：`routineFor` 不认识建筑，
      // 它自己编的那个落点会让牌子说屋檐、脚往祭坛走。
      const beat = routineFor(
        this.weather.kind,
        beats,
        villager.routineIndex,
        effectiveTideLevel(this.now, this.tideOverride),
        shelterTarget(this.buildings, here),
      );
      villager.routineIndex += 1;
      const target = this.resolvedTarget(beat);
      if (target === null) continue;
      if (target.x === here.x && target.y === here.y) continue;
      // 路先问，话后说。
      //
      // `routeTo` 的空路径有两种意思：她人已经在那儿，和根本走不到。
      // 混成一种就是对世界说谎——渡有仪式（区域要凭证、她兜里没有）让后者
      // 真的会出现。原先牌子先挂出去、路后问，走不通时她就挂着那一拍的説法
      // 站在原地：读镇志的人以为她去了，而她半步也没动。
      // 交付路早就守着这条（`mode === 'delivering'` 那段「空数组有两种意思」），
      // 作息这条路漏了。
      //
      // 两种意思在这一拍上都是 `continue`（到了就不用走，走不到就走不了），
      // 所以这里不必分开——分开的是派活那条，那边「到了」与「走不到」是
      // 接单与拒单两种回答。
      const route = this.routeTo(villager, target);
      if (route.path.length === 0) continue;
      villager.path = route.path;
      villager.routineLabel = beat.label;
      villager.nextRoutineAt = this.now + beat.dwellMs;
      return;
    }
    villager.nextRoutineAt = this.now + 1600;
  }

  /**
   * 这一拍的落点。走不通就返回 null，调用方跳过这一拍。
   *
   * 躲雨那道门也走这把尺子：门格是可走的（`checkPlacement` 就要求门口能过人），
   * 而过不了尺子时正确的动作正是「不挂这块牌子」。
   *
   * 这里原先为 `shelter` 单开一道，直接采信 `shelterTarget`。那一开不要紧，
   * 要紧的是它让 `routineFor` 返回的 `target` 成了摆设——牌子与落点因此有两个
   * 真相来源，而单元测试钉的是假的那一个（`routine-tide.test.ts` 断言躲雨回锚点，
   * 可跑起来的人早就被这里改去了门口）。现在 `routineFor` 由调用方喂真门，
   * 落点只有一个出处。
   */
  private resolvedTarget(beat: RoutineBeat): GridPoint | null {
    return this.grid.isWalkable(beat.target) ? beat.target : null;
  }

  private walk(villager: Villager, deltaMs: number): void {
    let budget = (SPEED_CELLS_PER_SECOND * deltaMs) / 1000;
    while (budget > 0 && villager.path.length > 0) {
      const next = villager.path[0] as GridPoint;
      const dx = next.x - villager.pos.x;
      const dy = next.y - villager.pos.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        villager.pos = { x: next.x, y: next.y };
        // 走过一格就踩一次。重复走的格子强度累加，草被踩实。
        addTrail(this.trails, next);
        budget -= distance;
        villager.path.shift();
        continue;
      }
      const scale = budget / distance;
      villager.pos = {
        x: villager.pos.x + dx * scale,
        y: villager.pos.y + dy * scale,
      };
      villager.facing = facingFor(dx, dy);
      budget = 0;
    }
  }

  private arriveAtWork(villager: Villager): void {
    const task = this.activeTaskOf(villager);
    if (task === null) {
      villager.mode = 'idle';
      return;
    }
    // 上游的活建单时没有 buildingId（它不知道我们的铺子），用派活时记下的那栋。
    const building = this.buildingOf(task) ?? villager.pendingBuilding ?? undefined;
    villager.pendingBuilding = null;
    if (building === undefined) {
      // 楼没了（被拆/被撤），这单退回空闲，不让她对着空气干活。
      villager.mode = 'idle';
      villager.taskId = null;
      return;
    }
    task.status = 'in_progress';
    villager.mode = 'working';
    villager.visible = false;
    villager.bubble = null;
    villager.routineLabel = null;
    villager.pos = { x: building.workSpot.x, y: building.workSpot.y };
    this.activities.set(building.instanceId, {
      kind: 'operating',
      taskId: task.id,
      startedAt: this.now,
      // 郊野的活更久：走那么远，做的活也该更重。
      estimateMs: taskDurationFor(task.kind, WILD_PREFABS.has(building.prefabId)),
      // 上游的活只有上游知道还要多久；沙盒的活由计时器收尾。
      determinate: task.source === 'sandbox',
    });
    this.log('work', `${building.displayName} 开工（${villager.name}）。`);
  }

  /** 她此刻就站在祭坛那一格上。 */
  private atAltar(villager: Villager): boolean {
    const cell = this.cellOf(villager.pos);
    return cell.x === this.altar.x && cell.y === this.altar.y;
  }

  /** 到祭坛就把东西放下。 */
  private dropAtAltar(villager: Villager): void {
    villager.carrying = null;
    this.arriveAtAltar(villager);
  }

  private arriveAtAltar(villager: Villager): void {
    this.clearDeparture(villager);
    villager.mode = 'idle';
    villager.taskId = null;
    villager.routineLabel = null;
    villager.nextRoutineAt = this.now + 1600;
  }

  private stepWorkstations(): void {
    for (const building of this.buildings) {
      const activity = this.activities.get(building.instanceId);
      if (activity === undefined) continue;
      if (
        activity.kind === 'operating' &&
        activity.determinate &&
        this.now - activity.startedAt >= activity.estimateMs
      ) {
        const task = this.tasks.find((item) => item.id === activity.taskId);
        const owner = this.villagers.find(
          (villager) => villager.taskId === activity.taskId && villager.mode === 'working',
        );
        if (task !== undefined && task.status === 'in_progress' && owner !== undefined) {
          this.finishActiveTask(owner);
        } else {
          this.activities.set(building.instanceId, { kind: 'idle' });
        }
        continue;
      }
      if (activity.kind === 'cooling' && this.now >= activity.until) {
        this.activities.set(building.instanceId, { kind: 'idle' });
      }
    }
  }

  private finishActiveTask(villager: Villager): void {
    const task = this.activeTaskOf(villager);
    if (task === null || task.status === 'done') return;
    this.clearDeparture(villager);
    task.status = 'done';
    task.completedAt = this.now;
    task.blockedQuestion = null;
    if (!this.isSettled(task.id)) this.recordDelivery(villager.id, task);
    const building = this.buildingOf(task);
    if (building !== undefined) {
      this.activities.set(building.instanceId, {
        kind: 'cooling',
        taskId: task.id,
        until: this.now + COOLING_MS,
      });
      villager.pos = { x: building.door.x, y: building.door.y };
    }
    villager.mode = 'delivering';
    villager.visible = true;
    villager.facing = 'down';
    // 郊野干完活：手上多个东西。它是"跑了一趟"的证据，不是奖励。
    villager.carrying =
      building !== undefined && WILD_PREFABS.has(building.prefabId)
        ? carryKindFor(task.kind)
        : null;
    villager.bubble = '任务交付！';
    villager.bubbleUntil = this.now + DELIVER_MS;
    villager.deliverUntil = this.now + DELIVER_MS;
    villager.path = [];
    this.accrueFaith(task);
    this.log('done', `${task.summary} 已交付（${villager.name}）。`);
  }

  /** 交付按人和来源分开记账：上游/沙盒各自分开，角色之间也不合并。 */
  private recordDelivery(villagerId: string, task: TaskRecord): void {
    const source = task.source;
    if (source === 'ledger') this.feedDeliveries += 1;
    else this.localDeliveries += 1;
    const tally = this.deliveryTally.get(villagerId) ?? this.deliveryTally.get(this.villagers[0].id);
    if (tally !== undefined) {
      if (source === 'ledger') tally.feed += 1;
      else tally.local += 1;
    }
    this.settledLog.push({
      id: task.id,
      source: source === 'ledger' ? 'ledger' : 'mock',
      workerId: villagerId,
      // 上游时间只认 task.settled 带来的那个；缺失保持 null，绝不本地时间顶替。
      completedAt: source === 'ledger'
        ? completedAtMs(task.ledgerCompletedAt)
        : this.wallClock(),
      completedAtClock: source === 'ledger' ? 'ledger' : 'local',
    });
    // 交付是这个世界最要紧的「发生过的事」：记回日志，记忆层才有素材。
    // 放在这里而不是每个调用点：这是交付的唯一漏斗，三处交付都经过它。
    this.announce({
      change: 'task.delivered',
      taskId: task.id,
      summary: task.summary,
      workerId: villagerId,
      source: source === 'ledger' ? 'feed' : 'local',
      taskKind: task.kind,
    });
  }

  private isSettled(taskId: string): boolean {
    return this.settledLog.some((record) => record.id === taskId);
  }

  /** 攒够一个里程碑，世界多一件东西；不够就只是点数。
   *
   * `task` 是刚刚交付、把点数推过线的那一单：摆件的来源就记它。
   * 落不下（周围没空地）时点数保留，不吞掉。
   */
  private accrueFaith(task: TaskRecord): void {
    this.faithPoints += POINTS_PER_TASK;
    if (this.faithPoints < FAITH_MILESTONE) return;
    // 先落，落下了再扣点数。反过来的话，周围没空地那一回就把一个里程碑的
    // 点数吞掉了——而上面那行注释和 `faith.test.ts` 里那条测试的名字
    // （「由调用方保留点数」）说的都是留着。实测：第三单触发里程碑、落不下，
    // 改之前 points 归 0、props 空、milestones 不动，那 3 点再也要不回来。
    const prop = nextProp(
      this.milestones,
      this.altar,
      (p) => this.grid.isWalkable(p),
      { kind: task.kind, taskId: task.id, summary: task.summary },
      this.props.map((item) => item.at),
    );
    if (prop === null) return;
    this.faithPoints -= FAITH_MILESTONE;
    // 露话与污浊度在这里配（`landProp`）：`nextProp` 是纯函数，不碰设定集。
    this.props.push(landProp(prop, this.propReveals?.get(prop.kind), this.props.length));
    this.milestones += 1;
    // 日志写清是哪一单换的：这是"被记住"在事件流里的第一次落地。
    this.log('info', `神恩落地：${describePropSource(prop)}。`);
  }

  /**
   * 有 blocked 单就派一个人把急件送到祭坛。
   *
   * 只在没人已经举着的时候派：一次只呈一张，同时三个人举牌会把祭坛变收件箱。
   * 送件的人挑第一个空闲的；都忙就等下一拍——不打断正在干的活。
   */
  private stepDecrees(): void {
    const decree = awaitingDecree(this.snapshotForDecree());
    if (decree === null) {
      this.decreeBearer = null;
      return;
    }
    if (this.decreeBearer !== null) {
      const bearer = this.villagers.find((item) => item.id === this.decreeBearer);
      // 已在位：正在跑，或者已经到了并站在祭坛旁。
      // 判「到没到」用位置而不是 bubble——bubble 会过期，过期后这里会
      // 误判成"没人送"再派一次，把已经举着的人重新派出去。
      if (bearer !== undefined) {
        const atAltar =
          Math.abs(bearer.pos.x - this.altar.x) < 1.5 &&
          Math.abs(bearer.pos.y - this.altar.y) < 1.5;
        if (bearer.mode === 'bearingDecree' || atAltar) return;
      }
      this.decreeBearer = null;
    }

    // 呼吸段里的人不接这一趟（SPEC_V2 §4.7）。急件是世界自己发起的一件事，
    // 还带一句「急件！」的气泡——它同时是「随机事件」和「提示」，
    // 而那一屏呼吸段两样都不该有。
    //
    // 与 `canTakeWork` 那道门是**两处**，不是一处：那边管派活，这边管急件。
    // 漏了这边，「不派活」做到了、「不弹提示」没做到——用户在呼吸段里
    // 照样被一句「急件！」拽走。
    //
    // §4.7 的「不弹提示」到这里就是全的：**它禁的是世界自己开口**。
    // 另六处写 bubble 的地方（这单被撤了 / 下雨了快躲 / 办好了 / 任务交付 /
    // 过不去东西先留着 / 有急件请旨）说的都是世界在**回答**——回答玩家刚下的
    // 命令，或回答一件早就派给她的活。那些不堵：堵了就是玩家说了话世界不理，
    // 那是另一种坏。这条边界由 `breathing-bubble.test.ts` 钉住。
    const free = this.villagers.find(
      (item) =>
        item.mode === 'idle' &&
        item.path.length === 0 &&
        !this.inBreathing(item),
    );
    if (free === undefined) return;

    // 她站在祭坛格上时 `routeTo` 也说「路是空的」。这里**故意**当作「这一拍不派」：
    // 她不会永远站在祭坛上（作息会把她带走），下一拍就派得出。
    // 改成「已经到了」会让 `bearingDecree` 带上一条空路径，下一个 step 就掉回 idle——
    // 那一闪的过渡态看不见，而「跑过去举件」这条路正好是 decree.test.ts 守的。
    const route = this.routeTo(free, this.altar);
    if (route.path.length === 0) return;
    free.mode = 'bearingDecree';
    free.path = route.path;
    free.bubble = '急件！';
    free.bubbleUntil = this.now + 3000;
    this.decreeBearer = free.id;
    this.log('warn', `急件请旨：${decree.title}`);
  }

  /** 当前是否有待答复的急件。 */
  private hasDecree(): boolean {
    return awaitingDecree(this.snapshotForDecree()) !== null;
  }

  /** 造一个只含上游单的视图给 `awaitingDecree` 用。 */
  private snapshotForDecree(): WorldSnapshot {
    return { ...this.snapshot(), tasks: this.tasks };
  }

  /** 到点的猫自己走开。猫不参与任何结算，这里只做退场。 */
  private stepCritters(): void {
    if (this.critters.length === 0) return;
    this.critters = this.critters.filter((critter) => critter.leavesAt > this.now);
  }

  /** 拆一栋楼。见 `WorldCommand.demolish` 的三条拒绝。 */
  private demolish(instanceId: string): CommandResult {
    const building = this.buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) {
      const message = `没有 ${instanceId} 这栋楼。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    if (this.constructions.has(instanceId)) {
      const message = `${building.displayName} 还在施工，拆不了。`;
      this.log('warn', message);
      return { ok: false, message };
    }
    const busy = this.activities.get(instanceId);
    if (busy !== undefined && busy.kind === 'operating') {
      const message = `${building.displayName} 里有人在干活，等这单收工再拆。`;
      this.log('warn', message);
      return { ok: false, message };
    }

    // 释放网格占用。门口的路保留——那是铺过的路，拆楼不铲路。
    this.grid.remove(instanceId, building.origin, building.footprint.w, building.footprint.h);
    const index = this.buildings.findIndex((item) => item.instanceId === instanceId);
    if (index >= 0) this.buildings.splice(index, 1);
    this.activities.delete(instanceId);

    const message = `${building.displayName} 拆掉了。`;
    this.log('info', message);
    this.announce({
      change: 'building.removed',
      instanceId: building.instanceId,
      displayName: building.displayName,
    });
    return { ok: true, message };
  }

  /**
   * 潮汐每拍推进一次。
   *
   * 潮位是 `now` 的纯函数，所以这里没有状态机、没有累加器，也不读墙钟：
   * 同一个存档走同一串步长，回放出来的曲线逐拍一致。
   * 唯一写进世界的是"寻路代价"，那在 `grid.setTideLevel` 里。
   */
  private stepTide(): void {
    // 覆盖仍然只改「结果」，不改「节律」：过期的那一刻自动回到纯函数曲线。
    const level = effectiveTideLevel(this.now, this.tideOverride);
    this.grid.setTideLevel(level);
    this.lastTideLevel = level;
  }

  private stepConstructions(deltaMs: number): void {
    for (const [id, state] of [...this.constructions.entries()]) {
      const remaining = state.remainingMs - deltaMs;
      if (remaining > 0) {
        this.constructions.set(id, { ...state, remainingMs: remaining });
        continue;
      }
      this.constructions.delete(id);
      const building = this.buildings.find((item) => item.instanceId === id);
      this.log('info', `${building?.displayName ?? id} 落成了。`);
    }
  }

  private activeTaskOf(villager: Villager): TaskRecord | null {
    if (villager.taskId === null) return null;
    return this.tasks.find((item) => item.id === villager.taskId) ?? null;
  }

  private buildingOf(task: TaskRecord): PlacedBuilding | undefined {
    if (task.buildingId === null) return undefined;
    return this.buildings.find((item) => item.instanceId === task.buildingId);
  }

  private expireBubble(villager: Villager): void {
    if (villager.bubble !== null && this.now >= villager.bubbleUntil) {
      villager.bubble = null;
    }
  }

  // ---------------------------------------------------------------- save

  /** 序列化世界自有事实；上游链接态与派生计数不入档（ADR_SAVE §1）。 */
  toSave(): WorldSave {
    const villagers: SavedVillager[] = this.villagers.map((villager) => ({
      id: villager.id,
      name: villager.name,
      mode: villager.mode,
      pos: { x: villager.pos.x, y: villager.pos.y },
      facing: villager.facing,
      visible: villager.visible,
      path: villager.path.map((cell) => ({ x: cell.x, y: cell.y })),
      taskId: villager.taskId,
      bubble: villager.bubble,
      bubbleUntil: villager.bubbleUntil,
      saluteUntil: villager.saluteUntil,
      deliverUntil: villager.deliverUntil,
      nextRoutineAt: villager.nextRoutineAt,
      routineIndex: villager.routineIndex,
      routineLabel: villager.routineLabel,
      inPlaceUntil: villager.inPlaceUntil,
      pendingRoute: villager.pendingRoute.map((cell) => ({ x: cell.x, y: cell.y })),
      pendingBuildingId: villager.pendingBuilding?.instanceId ?? null,
      lampOil: villager.lampOil,
      nameState: villager.nameState,
      carries: [...villager.carries],
    }));
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      world: {
        now: this.now,
        villagers,
        buildings: this.buildings.map((building) => ({ ...building })),
        roads: this.roads.map((cell) => ({ x: cell.x, y: cell.y })),
        props: this.props.map((prop) => ({ ...prop })),
        oracle: this.oracleLog.map((record) => ({ ...record })),
        critters: this.critters.map((critter) => ({ ...critter, at: { ...critter.at } })),
        // 运行时字段不落盘：ledgerCompletedAt 只服务 settled；v1 schema 已冻结、样例无此键。
        tasks: this.tasks.map((task) => {
          const saved: TaskRecord = { ...task };
          delete saved.ledgerCompletedAt;
          return saved;
        }),
        pending: this.allPending(),
        activities: [...this.activities.entries()].map(([buildingId, activity]) => ({
          buildingId,
          activity,
        })),
        constructions: [...this.constructions.entries()].map(([buildingId, state]) => ({
          buildingId,
          remainingMs: state.remainingMs,
          totalMs: state.totalMs,
        })),
        weather: { ...this.weather },
        faith: { points: this.faithPoints, milestones: this.milestones },
        settled: this.settledLog.map((record) => ({ ...record })),
        nextTaskNumber: this.nextTaskNumber,
        nextPendingNumber: this.nextPendingNumber,
        // v3 的三个位置：#14 写覆盖、#8 写折返计数，这一版原样存取。
        tideOverride: this.tideOverride === null ? null : { ...this.tideOverride },
        worldChangeVersion: this.worldChangeVersion,
      },
      meta: {
        savedAtWallClock: this.wallClock(),
        savedReconciled: this.feedReconciled,
        schemaFingerprint: SCHEMA_V4_FINGERPRINT,
      },
    };
  }

  /**
   * 从存档重建世界。deps.grid 必须已按存档 buildings 顺序重放
   * （`rebuildGridFromPlacements`），deps.buildings 用存档里的那批。
   * 读档后一律标记未对账，等首个成功的读取从头折一遍。
   */
  static fromSave(save: WorldSave, deps: SimulationDeps): Simulation {
    const names = save.world.villagers.map((villager) => villager.name);
    const sim = new Simulation({
      ...deps,
      villagerName: names[0] ?? deps.villagerName,
      villagerNames: names,
    });
    const world = save.world;
    sim.now = world.now;
    sim.buildings.length = 0;
    sim.buildings.push(...world.buildings.map((building) => ({ ...building })));
    // 编号水位按幸存建筑重推：幸存的 id 一个不变，新建的号一定比它们大。
    sim.seedInstanceIds();
    // 构造时记的是 `deps.buildings`——那是个空壳世界的几栋常驻铺子，不是档里这些。
    // 不重算的话，读档后「这一场起的」会把上一次会话造的楼也算进来，
    // 而那句话正是这笔改动要堵的。少说一句比多说一句假话好。
    sim.rememberStartupBuildings();

    for (const saved of world.villagers) {
      const villager = sim.villagers.find((item) => item.id === saved.id);
      if (villager === undefined) continue;
      villager.mode = saved.mode;
      villager.pos = { x: saved.pos.x, y: saved.pos.y };
      villager.facing = saved.facing;
      villager.visible = saved.visible;
      villager.path = saved.path.map((cell) => ({ x: cell.x, y: cell.y }));
      villager.taskId = saved.taskId;
      villager.bubble = saved.bubble;
      villager.bubbleUntil = saved.bubbleUntil;
      villager.saluteUntil = saved.saluteUntil;
      villager.deliverUntil = saved.deliverUntil;
      villager.nextRoutineAt = saved.nextRoutineAt;
      villager.routineIndex = saved.routineIndex;
      villager.routineLabel = saved.routineLabel;
      villager.inPlaceUntil = saved.inPlaceUntil;
      villager.pendingRoute = saved.pendingRoute.map((cell) => ({ x: cell.x, y: cell.y }));
      villager.pendingBuilding =
        saved.pendingBuildingId === null
          ? null
          : (sim.buildings.find((item) => item.instanceId === saved.pendingBuildingId) ?? null);
      // 灯油只搬运，不参与任何世界判定（见 #4）。
      villager.lampOil = saved.lampOil;
      // 名牌状态要原样恢复：读档后抵押者仍然抵押，不能凭空把她放回来接活。
      villager.nameState = saved.nameState ?? 'held';
      villager.carries = [...(saved.carries ?? [])];
    }

    for (const queue of sim.pending.values()) queue.length = 0;
    for (const item of world.pending) {
      const queue =
        sim.pending.get(item.villagerId) ?? sim.pending.get(sim.villagers[0].id);
      queue?.push({ ...item });
    }

    sim.tasks.length = 0;
    sim.tasks.push(...world.tasks.map((task) => ({ ...task })));

    sim.roads.length = 0;
    sim.roads.push(...world.roads.map((cell) => ({ x: cell.x, y: cell.y })));
    sim.props.length = 0;
    sim.props.push(
      ...world.props.map((prop) => ({
        ...prop,
        // 读档不补默认值：缺字段的坏档要在 assertSave 就被拒，
        // 静默补一个「干净」等于把玩家洗过的脏东西又擦亮一次。
        grime: prop.grime,
        reveal: prop.reveal,
      })),
    );

    sim.activities.clear();
    for (const saved of world.activities) {
      if (sim.buildings.some((building) => building.instanceId === saved.buildingId)) {
        sim.activities.set(saved.buildingId, saved.activity);
      }
    }
    for (const building of sim.buildings) {
      if (!sim.activities.has(building.instanceId)) {
        sim.activities.set(building.instanceId, { kind: 'idle' });
      }
    }

    sim.constructions.clear();
    for (const saved of world.constructions) {
      if (!sim.buildings.some((building) => building.instanceId === saved.buildingId)) continue;
      sim.constructions.set(saved.buildingId, {
        remainingMs: saved.remainingMs,
        totalMs: saved.totalMs,
      });
    }

    sim.weather = { ...world.weather };
    sim.faithPoints = world.faith.points;
    sim.milestones = world.faith.milestones;

    sim.oracleLog.length = 0;
    for (const record of world.oracle) sim.oracleLog.push({ ...record });

    sim.critters = world.critters.map((critter) => ({ ...critter, at: { ...critter.at } }));

    // settled 是分账唯一真相：由它重建私有日志与交付统计（不持久化计数）。
    sim.settledLog.length = 0;
    for (const record of world.settled) {
      if (sim.settledLog.some((item) => item.id === record.id)) continue;
      sim.settledLog.push({ ...record });
    }
    for (const tally of sim.deliveryTally.values()) {
      tally.feed = 0;
      tally.local = 0;
    }
    sim.feedDeliveries = 0;
    sim.localDeliveries = 0;
    for (const record of sim.settledLog) {
      if (record.source === 'ledger') sim.feedDeliveries += 1;
      else sim.localDeliveries += 1;
      const tally =
        sim.deliveryTally.get(record.workerId) ?? sim.deliveryTally.get(sim.villagers[0].id);
      if (tally === undefined) continue;
      if (record.source === 'ledger') tally.feed += 1;
      else tally.local += 1;
    }

    sim.nextTaskNumber = world.nextTaskNumber;
    sim.nextPendingNumber = world.nextPendingNumber;
    // v3 的两个位置：原样读回，这一版不用它们（见 #14 / #8）。
    sim.tideOverride = world.tideOverride === null ? null : { ...world.tideOverride };
    sim.worldChangeVersion = world.worldChangeVersion;
    sim.feedConnected = false;
    sim.feedLastReadAt = null;
    sim.feedCursor = 0;
    sim.feedReconciled = false;
    sim.log('info', '读档回来：世界从关页那一刻继续。');
    return sim;
  }

  /** 上游说这单成了，但她不在单上（例如读档后她已经站回祭坛）：直接收尾。 */
  private settleDetachedTask(task: TaskRecord): void {
    if (this.isSettled(task.id)) return;
    task.status = 'done';
    task.completedAt = this.now;
    task.blockedQuestion = null;
    const workerId = task.workerId ?? this.villagers[0].id;
    this.recordDelivery(workerId, task);
    this.log('done', `${task.summary} 按上游事件收尾。`);
  }

  private removeTask(taskId: string): void {
    // 先记下这单挂在哪栋楼，删单后 task 没了、buildingOf 就查不到了；
    // 角色若正在屋里干活，需要这栋楼来算「挪到哪个门口」。
    const owningBuilding = this.buildingOfId(taskId);
    const index = this.tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) this.tasks.splice(index, 1);
    for (const villager of this.villagers) {
      if (villager.taskId !== taskId) continue;
      villager.mode = 'idle';
      villager.taskId = null;
      // 与 abandonActiveTask 共用同一套收尾：恢复可见 + 移出建筑。
      // 少了这一步，读档对账撤单后角色会 idle + visible=false + 卡在工位（D-1）。
      this.restoreOutOfBuilding(villager, owningBuilding);
      villager.path = [];
      villager.pendingRoute = [];
      villager.pendingBuilding = null;
      villager.bubble = null;
      villager.nextRoutineAt = this.now + 1600;
    }
    this.idleWorkstationFor(taskId);
  }

  /** 按 taskId 找它挂靠的楼（删单前调用；删完 task 就查不到了）。 */
  private buildingOfId(taskId: string): PlacedBuilding | undefined {
    const task = this.tasks.find((item) => item.id === taskId);
    return task === undefined ? undefined : this.buildingOf(task);
  }

  private cellOf(pos: Vec2): GridPoint {
    return { x: Math.round(pos.x), y: Math.round(pos.y) };
  }

  private log(tone: WorldEvent['tone'], text: string): void {
    this.events.push({ at: this.now, tone, text });
    if (this.events.length > EVENT_LIMIT) this.events.splice(0, this.events.length - EVENT_LIMIT);
  }

  /**
   * 把一次世界改变交出去记进日志。
   *
   * 三条边界：
   *   - `at` 用 `this.now`（世界时间），不是墙钟：回放同一条日志得到同一条时间线；
   *   - 只报**已经发生**的事。调用点都在成功分支里，被拒的命令不经过这里；
   *   - 回调里的异常吞掉。写日志失败是世界之外的遗憾，不该让世界当场停摆，
   *     更不该让一拍 `update` 抛到渲染循环里。
   */
  private announce(change: WorldChange): void {
    if (this.onChange === undefined) return;
    try {
      this.onChange(change, this.now);
    } catch {
      // 有意吞掉：回写是尽力而为的旁路，不是世界的一部分。
    }
  }
}

function facingFor(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/**
 * 实例 id 里的序号，`workshop_plot#7` → `7`；不是这个形状就是 `null`。
 *
 * 只用来推编号水位，**不解释身份**：`plot#report` 这类手工 id 是合法的，
 * 它只是不参与自增。所以匹配失败不能抛错，也不能当成 0。
 */
function instanceSerialOf(instanceId: string): number | null {
  const match = /#(\d+)$/.exec(instanceId);
  if (match === null) return null;
  const serial = Number(match[1]);
  return Number.isSafeInteger(serial) && serial > 0 ? serial : null;
}
