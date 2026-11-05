/** 记忆世界的编排层：把上面那些纯模块接成一台能跑的机器。
 *
 * 这里是内环唯一持有**全部**记忆与信念的地方。它对外只开三扇门：
 *
 * 1. `ingest()` —— 世界侧把一条事件交进来（含 `source = agent / genesis` 的入口）；
 * 2. `viewOf(holderId)` —— **单位读自己**的那一扇。它返回的是一个只含该单位
 *    记忆与信念的快照，别的东西一概拿不到；
 * 3. `dayClosed()` —— 天界，整理 + 扩散 + 传说 + 心电图。
 *
 * 第 2 条是《信息传播设计》的核心约束「单位逻辑只能读自己的信念库，不能读
 * 全局世界状态」在 API 层的落法。它不是靠调用方自觉：`HolderView` 里根本没有
 * 指向其他单位的字段，而 `MemoryWorld` 的其余字段全是 `private`。
 *
 * 这一层仍然**不调模型**。日摘要走规则模板；模型摘要的位置（
 * `generatedBy.by = 'llm'`）留着，但本组不实现调用，也不占预算。
 */

import { DEFAULT_MEMORY_CONFIG, weightsFor, type LayerBudget, type MemoryConfig } from './config.ts';
import { byteSizeOf, consolidateHolder, trimEntriesToBudget } from './consolidate.ts';
import {
  buildDayDigest,
  compactDayDigest,
  digestRank,
  digestTimelineOf,
  shouldCompact,
  stripDigestEvent,
} from './digest.ts';
import { advanceEra, openEra, signatureOf } from './era.ts';
import { makeEpic } from './epic.ts';
import {
  isStanding,
  landmarkAltered,
  landmarkBuilt,
  landmarkDemolished,
  landmarkRebuilt,
  landmarkRuined,
  landmarkWithoutHistory,
  plotKeyOf,
  shouldRuine,
  type LandmarkEvent,
} from './landmark.ts';
import {
  candidatesFrom,
  decayLegend,
  faded,
  formLegend,
  maxImportance,
  mergeByPlace,
  qualifies,
  reinforceLegend,
  type LegendCandidate,
} from './legend.ts';
import {
  distance,
  witnessesOf,
  type OcclusionGrid,
  type Perceiver,
  type PlaceAnchor,
} from './perception.ts';
import { soundKindOf } from './hearing.ts';
import { biasFor, misremember } from './distort.ts';
import { nextMood, decayedMood, moodLabel, MOOD_HALF_LIFE_DAYS } from './mood.ts';
import { innerVoiceOf as composeInnerVoice } from './inner-voice.ts';
import {
  cascadeBeliefs,
  cascadeClaims,
  cascadeLegends,
  cascadeTraces,
  deleteCascade,
  writeModeOf,
  type DeletionReport,
  type DeletionRoot,
} from './privacy.ts';
import {
  announcementReach,
  canFanout,
  canSpread,
  createClaim,
  credibilityOf,
  fanoutKey,
  pairKey,
  penalize,
  postAnnouncement,
  retell,
  spreadStep,
  trustBetween,
  type Announcement,
  type CooldownState,
  type CredibilityScores,
  type FanoutState,
  type ListenerBelief,
  type Relationship,
  type RelationshipMap,
  type SpreadCandidate,
  type Verdict,
} from './propagate.ts';
import { recall, type RecallOutcome, type RecallRequest } from './recall.ts';
import { decideWrite, inputsFor } from './salience.ts';
import { claimContentFor, compile, type UpstreamAction } from './sanitize.ts';
import { rollBelow, seedOf } from './seed.ts';
import { exposedTraces, consequenceOf, fitTraceLayers, inferenceOf, makeTrace, weatherTrace, type InferenceSpec } from './traces.ts';
import { epithetFor, renamed } from './toponym.ts';
import { readRecord, writeDiary, writeLetter, type WrittenRecord } from './written.ts';
import type {
  Belief,
  Bond,
  Claim,
  DayDigest,
  EpicEntry,
  Era,
  EventVoice,
  Holder,
  HolderType,
  Landmark,
  Legend,
  MemoryContent,
  MemoryEntry,
  MemoryEvent,
  MemoryTier,
  Mood,
  Toponym,
  ToponymEntry,
  Trace,
  TurningPoint,
  Visibility,
  WorldFact,
  WorldVitals,
} from './types.ts';
import {
  asListenerBelief,
  beliefFrom,
  checkConflict,
  judgeVerify,
  planVerify,
  verifyAt,
  type VerifyPlan,
} from './verify.ts';
import { computeVitals, type TellRecord } from './vitals.ts';

/** 一条**已经由世界判好方向**的关系增量。 */
export interface BondDelta {
  /** 谁的关系被改。 */
  readonly from: string;
  /** 对着谁。 */
  readonly to: string;
  readonly trust: number;
  readonly warmth: number;
  readonly debt?: number;
}

/** 交进来的一条事件：世界侧已经知道谁在场，或由这里按感知模型算。 */
export interface IngestInput {
  readonly eventId: string;
  readonly at: number;
  readonly kind: string;
  readonly place: PlaceAnchor;
  readonly actors: readonly string[];
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly visibility: Visibility;
  readonly source: WorldFact['source'];
  readonly importanceHint: number | null;
  readonly parentEventId: string | null;
  /** 世界侧已经算好的在场者。给了就不再按感知模型算。 */
  readonly witnesses?: readonly string[];
  /** 感知模型要的现场快照。没给 `witnesses` 时必须给。 */
  readonly perceivers?: readonly Perceiver[];
  readonly grid?: OcclusionGrid;
  /** 事件的情绪。没给时按 kind 的先验推。 */
  readonly valence?: number;
  readonly arousal?: number;
  /**
   * 听见但没有看见的人。由调用方按 `hearing.ts` 算好，这里只负责写条目。
   * 与 `witnesses` 去重：看见的人不再补一条「听来的」。
   */
  readonly hearers?: readonly string[];
  /**
   * 这件事被怎么说。**`source = agent / genesis` 的事件必须给**——那是
   * 脱敏编译器自己那张表，比世界侧按 kind 的先验推更具体。
   *
   * 具体差在哪儿，说准了是这样（原先写「世界侧那张表根本没有这两行」，那是
   * 把两张表说成了一张）：
   *
   * | kind | `defaultValence` | `defaultArousal` | 编译器 |
   * | --- | --- | --- | --- |
   * | `discipline` | **有行，-0.6** | 兜底 0.3 | -0.6 / **0.7** |
   * | `oracle_prayer` | 兜底 0 | 兜底 0.3 | 0 / **0.4** |
   *
   * 差的全在**唤醒度**一列，而且只在这两个 kind 上；五个 kind 的效价
   * **一列都不差**。所以这句话该说成「`defaultArousal` 没有这两行」，
   * 不是「那张表没有这两行」。表里那两行是拿公开 API 量出来的：
   * `observe` 一个不带 `voice` 的事件，读它落下来的 `content.arousal`。
   *
   * 别顺手把这两行补进 `defaultArousal`：这两个 kind 只有 `compile()` 产出
   * （`grep -rn "discipline\|oracle_prayer" src | grep -v sanitize.ts`，
   * 剩下的命中是 `salience.ts` 的先验表与这两张兜底表自己），世界侧没有
   * 发出方，补了就是给不发生的路径加行。而 `ingestUpstream` 无条件给
   * `voice`，所以**跑着的世界**走不到这条兜底。
   *
   * 但「走不到」只到「没人这么发」为止，**门是开着的**：`observe` 收的是
   * 一个 `kind: string`，谁来敲一个 `'discipline'` 它都落 0.3。所以这不
   * 是一条够不着的兜底，是一条**没人走的兜底**——留着不补，是留着
   * 「世界侧哪天真要发一条训诫，这里会静悄悄地给它 0.3」这个记号。
   */
  readonly voice?: EventVoice;
  /**
   * 这件事是一栋楼的落成 / 拆除，位置信息在这儿。
   *
   * 记忆层不认识「origin / footprint」这些词，它只拿它们当地标的躯体：
   * 拆掉之后要在原地画废墟，就得知道那块地原来占多大、在哪儿。
   * 省略 = 普通地点，不产生地标阶段。
   */
  readonly landmark?: LandmarkEvent;
  /**
   * 方向性关系增量。少数事件在感知规则之外**已经知道方向**——街头小事
   * 里谁撞了谁、谁帮了谁，世界那一侧就定下来了。这里收的是那些数的落账，
   * 不是另一套关系推断：不传时行为与从前逐字节相同。
   */
  readonly bondDeltas?: readonly BondDelta[];
}

/**
 * 单位能看见的世界。
 *
 * 只有它自己的东西。**没有** `entries`（那是全库）、没有其他 holder 的 id 列表、
 * 没有事件日志。想加一个字段之前先问：这个单位凭什么知道它。
 */
export interface HolderView {
  readonly holderId: string;
  readonly type: HolderType;
  readonly memories: readonly MemoryEntry[];
  readonly beliefs: readonly Belief[];
  /** 自己此刻的日程：要不要去求证，去哪。 */
  readonly verifyPlans: readonly VerifyPlan[];
  /** 自己的可靠度（别人怎么看他，他自己不知道；这里是他自己的账）。 */
  readonly credibility: number;
  readonly traces: readonly Trace[];
  /**
   * 他自己翻过的那几次：求证之后看法变了。只读、不衰减。
   * 这一轮只有 `belief-reversed`；关系与习惯的记录还没有生产者。
   */
  readonly turningPoints: readonly TurningPoint[];
}

export interface MemoryWorldDeps {
  readonly config?: MemoryConfig;
  readonly relations?: RelationshipMap;
  readonly grid?: OcclusionGrid;
  /** 事件出口。世界侧接它写日志、广播心电图。 */
  readonly emit?: (event: MemoryEvent) => void;
  /** 世界 id，参与种子派生。 */
  readonly worldId?: string;
}

/**
 * 记忆世界的完整运行期状态（可 JSON 化）。
 *
 * 这是 `MemoryRuntime.toJSON()` 的载荷。形状与 `MemoryWorld` 的私有字段一一对应，
 * 但不含五个**依赖**：`config` / `relations` / `grid` / `emit` / `worldId`
 * ——那些由构造方给，读档时重建，不属于「发生过的事」。
 *
 * 为什么 Map 全部摊平成 `[key, value]` 数组：JSON 没有 Map；摊平后键序仍然显式，
 * 复原时按数组顺序重建，顺序稳定。
 */
export interface MemoryWorldSnapshot {
  readonly holders: readonly Holder[];
  readonly facts: readonly WorldFact[];
  readonly entries: readonly MemoryEntry[];
  readonly claims: readonly Claim[];
  readonly beliefs: readonly Belief[];
  readonly traces: readonly {
    readonly placeId: string;
    readonly entries: readonly Trace[];
  }[];
  /**
   * 地点坐标（`memorySchemaVersion >= 2`）。**与 Holder 分库存**：拆掉的楼
   * 名册里没有了，但它的痕迹还在这里，够不够得着要靠这个坐标。
   */
  readonly placeAnchors: readonly {
    readonly placeId: string;
    readonly at: { readonly x: number; readonly y: number };
  }[];
  /**
   * 场景记忆（`memorySchemaVersion >= 3`）：地标一生、时代分段、史诗条目。
   * v2 及更早的档没有这三段，迁移补空数组（空 = 这一段历史还没开始记）。
   */
  readonly landmarks: readonly Landmark[];
  readonly eras: readonly Era[];
  readonly epics: readonly EpicEntry[];
  /** 成长记录（`memorySchemaVersion >= 3`）。只增不删，不衰减。 */
  readonly turningPoints: readonly TurningPoint[];
  /**
   * 方向性关系账本（`memorySchemaVersion >= 4`）。
   * 只有当前值，不存每日快照；`evidence` 是事件 id，追溯得到原事。
   */
  readonly bonds: readonly Bond[];
  /** 情绪残留（`memorySchemaVersion >= 4`）。每个角色一条当前值。 */
  readonly moods: readonly Mood[];
  readonly legends: readonly Legend[];
  /**
   * 逐日压后的时间轴（SOAK-BUG-5）。**可选**：v4 及更早的档没有这一段，
   * 读档按空数组处理——空就是事实，不拿条目倒推一份假摘要。
   */
  readonly digests?: readonly DayDigest[];
  readonly placeNames: readonly {
    readonly placeId: string;
    readonly name: string;
    readonly history: readonly ToponymEntry[];
  }[];
  readonly announcements: readonly Announcement[];
  readonly tells: readonly TellRecord[];
  readonly written: readonly WrittenRecord[];
  readonly cooldowns: readonly CooldownState[];
  readonly fanout: {
    readonly day: number;
    readonly counts: readonly (readonly [string, number])[];
  };
  readonly verifyPlans: readonly {
    readonly holderId: string;
    readonly plans: readonly VerifyPlan[];
  }[];
  readonly credibility: readonly (readonly [string, number])[];
  readonly nextSerial: number;
  readonly currentDay: number;
  readonly metToday: readonly (readonly [string, number])[];
}

/** 开局设定档案的注入输入：只写一条「读到档案」的记忆，不生成目击、断言或痕迹。 */
export interface GenesisSeedInput {
  readonly holderId: string;
  readonly atMs: number;
  readonly text: string;
  readonly placeAt: { readonly x: number; readonly y: number };
  readonly bonds: readonly {
    readonly to: string;
    readonly trust: number;
    readonly warmth: number;
    readonly debt: number;
    readonly familiarity: number;
  }[];
}

/**
 * 日常照面：不靠「重要事件」也长关系的那条通道。
 *
 * 0.4 的门槛量的是**这件事重不重要**，不是**这两个人熟不熟**。打招呼、
 * 让路、一起走一段都是 0.38，永远跨不过去——于是两个人天天见面，账本上
 * 却永远是 0（30 天 360 次街头互动，`bondsOf()` 全空）。
 *
 * 这里给日常互动一条独立的、**按天结算**的小额累积：同一对一天里见几次
 * 都只积一次，所以不会「聊一次就生死之交」；累积的目标是一个「熟识」
 * 上限而不是满格，所以也不会「全员满格」。信任不动——见过面不等于信得过。
 */
const ACQUAINTANCE_KINDS = new Set(['street_greet', 'street_yield', 'street_together']);
const ACQUAINTANCE_FAMILIARITY_CEIL = 0.75;
const ACQUAINTANCE_WARMTH_CEIL = 0.4;
/**
 * 熟悉度不走日衰减（`decayBonds` 只收 trust/warmth），每天走近上限 4%：
 * 30 天约 55%，90 天约 73%，永远到不了 1。
 */
const ACQUAINTANCE_FAMILIARITY_STEP = 0.04;
/**
 * warmth 会被 `decayBonds` 每天收 15%，所以入账的步子要大一些才能留下痕迹：
 * 每天走近上限 20%，稳态约 0.23，30 天到约 0.22——有账，但离满格很远。
 */
const ACQUAINTANCE_WARMTH_STEP = 0.2;

/**
 * 一台记忆世界。
 *
 * 所有随机都从 `worldId + day + holder + op` 派生，所有集合的迭代顺序都
 * 在取用前排序——回放同一串输入得到同一个库，这是协议第 16 节的硬要求。
 */
export class MemoryWorld {
  readonly config: MemoryConfig;
  private readonly relations: Map<string, Relationship>;
  private readonly grid: OcclusionGrid | undefined;
  private readonly emitFn: ((event: MemoryEvent) => void) | undefined;
  private readonly worldId: string;

  private readonly holders = new Map<string, Holder>();
  private readonly facts = new Map<string, WorldFact>();
  private entries: MemoryEntry[] = [];
  private readonly claims = new Map<string, Claim>();
  /** 方向性关系账本；键是 `${from}\u0000${to}`，A→B 与 B→A 是两条。 */
  private readonly bonds = new Map<string, Bond>();
  /** 每个角色的当前情绪；日终更新，读时衰减。 */
  private readonly moods = new Map<string, Mood>();
  private beliefs: Belief[] = [];
  /**
   * 信念的三个索引：按人、按断言、按 `(人, 断言)` 定到数组位置。
   *
   * **这不是微优化，是关账能不能活到第二年的问题。** 日终扩散原先三处
   * 都扫全表：`diffuseDay` 按断言挑同跳持有者（每条断言扫一遍全部信念）、
   * `spreadStep` 判「这个听众是否已经知道」（每个候选扫一遍那个人的信念）、
   * `deliver` 判重（每次交谈扫一遍全部信念）。三条叠起来是
   * `O(断言 × 信念)`，实测 400 天 `dayClosed` 从 1.8ms 涨到 2.6s（1469 倍）。
   *
   * 索引只改变**查找方式**，不改变任何一条规则：写谁、写什么、什么顺序，
   * 全都还是原来那套。回放一致靠的是规则不变，不是靠每次重扫一遍。
   *
   * `positions` 只在 `addBelief` 追加/替换时维护；整表被换掉的几处
   * （读档、隐私级联、求证改状态）各自走 `reindexBeliefs` / `replaceBelief`。
   */
  private readonly beliefsByHolder = new Map<string, Belief[]>();
  private readonly beliefsByClaim = new Map<string, Belief[]>();
  private readonly beliefPositions = new Map<string, number>();
  /**
   * 「这个人关于这件事知道些什么」：`holderId → eventRef → 信念`。
   *
   * 日终判「他是不是已经知道了」与 `judge` 的「有没有相反的记忆」原先都要
   * 遍历**这个人的全部信念**，而一个人的信念数随断言数线性增长——于是每个
   * 候选一次全扫，又是一项平方。按事件分桶之后，这两问只看相关的那几条。
   */
  private readonly beliefsByHolderEvent = new Map<string, Map<string, Belief[]>>();
  /**
   * 冷却按「单位对」建索引。`diffuseDay` 原先给每个候选都扫一遍全部冷却，
   * 只为了跳过别人的那一对；冷却条数随断言数线性长，于是每天多出一个
   * 「断言 × 冷却」的平方项。索引之后每次只读一个桶。
   */
  private readonly cooldownsByPair = new Map<string, CooldownState[]>();
  private readonly traces = new Map<string, Trace[]>();
  /**
   * 每个地点**最后一次**被人知道在哪。楼拆了、名称还在、痕迹也还在时，它是
   * 那堆痕迹唯一还站得住的坐标。
   *
   * 与 `holders` 分开，是因为 Holder 名册管的是「谁还活着、谁能传话」：
   * 一栋不存在的楼不能继续当听众（`removePlace` 会把它摘掉）。但它的位置
   * 不是「谁」的一部分，是「哪儿」的一部分——摘掉 Holder 之后，`lookAtTraces`
   * 还要靠这个坐标判「他站在三格内看得见那道废墟吗」。
   *
   * 早先没有这张表，坐标只能从 Holder 上读。于是拆楼那一刻，痕迹的可读路径
   * 与 Holder 一起断了：`withinTraceReach` 拿不到地点坐标，返回 false；
   * `placeHints` 走 `viewOf`，Holder 不在就返回 null。楼拆了，痕迹既读不到
   * 也画不出——这正是「那儿原来有间铺子」没有落点的原因。
   */
  private readonly placeAnchors = new Map<string, { readonly x: number; readonly y: number }>();
  /**
   * 地标：一块地的一生。键是**地块**（`plotKey`），不是实例 id——
   * 拆掉再建会换 id，但那还是同一块地（见 `landmark.ts` 文件头）。
   */
  private readonly landmarks = new Map<string, Landmark>();
  /** `placeId → plotKey`。重建换了 id 之后，旧 id 也要查得到同一块地。 */
  private readonly landmarkByPlace = new Map<string, string>();
  /** 时代：按世界日区间分段。最后一条永远 `toDay: null`（当前时代）。 */
  private eras: Era[] = [];
  /** 史诗条目：传说里够格的那几条。按形成顺序。 */
  private epics: EpicEntry[] = [];
  /**
   * 成长记录：一个人对一件事的看法**翻过来**了（求证证实/证伪）。
   *
   * 这一轮只做这一种（`TurningPoint`）——`BondPhase` 与 `HabitRecord`
   * 留到关系/习惯真的有生产者的那一版，现在不摆空壳。
   *
   * 它**不衰减**：这是「他变了」的锚点，不是一条会模糊的记忆。
   */
  private turningPoints: TurningPoint[] = [];
  private legends: Legend[] = [];
  /**
   * 逐日的压后时间轴（SOAK-BUG-5，`digest.ts`）。**每天至多一条**，按 `day` 升序。
   *
   * 它独立于 `entries`：条目层的 `day` 桶每人只有 16 格，旧日片段会被挤掉，
   * 而摘要是一天一条、不随人增长。它也不替代条目——近档仍读条目，摘要接的是
   * 「条目被裁掉之后，那一天还能读出什么」。
   */
  private digests: DayDigest[] = [];
  /**
   * 每个地点此刻叫什么、改过几次名（协议 §11 的历史链）。
   *
   * 名字从**外面**进来（`syncHolders` 的 `RuntimeHolder.name`，场景从
   * `PlacedBuilding.displayName` 递）：记忆层不认识「账房」这个词，它只认得
   * 谁在哪个 id 上。改名则由这一层自己判——判据在 `toponym.ts`。
   */
  private readonly placeNames = new Map<string, { name: string; history: ToponymEntry[] }>();
  private announcements: Announcement[] = [];
  private readonly tells: TellRecord[] = [];
  private written: WrittenRecord[] = [];
  private cooldowns: CooldownState[] = [];
  private fanout: FanoutState = { day: 0, counts: new Map() };
  private readonly verifyPlans = new Map<string, VerifyPlan[]>();
  private credibility: CredibilityScores = { scores: new Map() };
  private nextSerial = 1;
  private currentDay = 0;
  /**
   * 今天谁和谁照过面。键是 `pairKey`，值是这一对今天最近的一次距离。
   *
   * **这一张表是「日终只拍一格」那个 bug 的解。** 原先 `spreadCandidates`
   * 只问「此刻谁挨着谁」，整整一天的相处被压成子夜那一格坐标：两个人在街上
   * 碰了一整天面，日终各自走开，这一天就等于谁也没见过谁。三天实测里两人
   * 相距 2 格以内的拍数是 89,242（约两个半世界小时），而三个日终分别相距
   * 13.5 / 14.0 / 17.0 格——`beliefs` 一直是 0，`diffuseDay` 一次也没开过口。
   *
   * 现在按「今天照过面」算。`sampleEncounters` 在行为层每拍喂位置时记一次，
   * 日终再补一次（只摆好位置、从没动过的单位靠这一下，老行为因此不会丢）。
   * `diffuseDay` 用完就清，所以它是**这一天的账**，不是历史。
   */
  private metToday = new Map<string, number>();

  constructor(deps: MemoryWorldDeps = {}) {
    this.config = deps.config ?? DEFAULT_MEMORY_CONFIG;
    this.relations = new Map(deps.relations ?? []);
    this.grid = deps.grid;
    this.emitFn = deps.emit;
    this.worldId = deps.worldId ?? 'world';
  }

  // ---------------------------------------------------------------- Holder

  addHolder(holder: Holder): void {
    this.holders.set(holder.holderId, holder);
    // 地点的坐标是「哪儿」的一部分，不是「谁」的一部分：它要比 Holder 活得久。
    if (holder.type === 'place' && holder.at !== undefined) {
      this.placeAnchors.set(holder.holderId, holder.at);
    }
  }

  /** 有人走动了。行为层每拍调一次，记忆层据此算谁跟谁挨得够近。 */
  moveHolder(holderId: string, at: { readonly x: number; readonly y: number }): void {
    const holder = this.holders.get(holderId);
    if (holder === undefined) return;
    this.holders.set(holderId, { ...holder, at });
    if (holder.type === 'place') this.placeAnchors.set(holderId, at);
  }

  hasHolder(holderId: string): boolean {
    return this.holders.has(holderId);
  }

  /**
   * 一栋楼没了。
   *
   * **只删地点 Holder，不删人物的记忆。** 楼拆了，但它留下的痕迹与
   * 「那儿原来有间铺子」这件事还该有人记得——记忆不是世界状态的副本，
   * 它比世界慢半拍，这正是它该有的样子。
   *
   * 不删的话，`spreadCandidates` 会把一栋不存在的楼当成听众，
   * 而它永远「听得见」任何发生在原地的传言。
   *
   * **摘 Holder，不摘坐标。** `placeAnchors` 是「那儿在哪」，痕迹要读它；
   * 把它一起删掉，就是这一版修的那个洞（痕迹读不到也画不出）。
   */
  removePlace(holderId: string): void {
    const holder = this.holders.get(holderId);
    if (holder === undefined || holder.type !== 'place') return;
    this.holders.delete(holderId);
  }

  holderIds(): readonly string[] {
    return [...this.holders.keys()].sort();
  }

  // ------------------------------------------------------------ 事件入口

  /**
   * 世界侧交进来一条事件。
   *
   * 这一步做三件事，全部是规则：
   * 1. 定 `witnesses`（没给就按感知模型算）并写进事实；
   * 2. 对每个 witness 算显著度，过线的写 Episode；
   * 3. 对 place Holder 按后果规则落痕迹。
   *
   * `source = agent / genesis` 的事件走**同一条**路。本组只收不用：造物主
   * 与上游都从这里进来，之后怎么被感知、记忆、传播，与本地事件没有区别。
   */
  ingest(input: IngestInput): { readonly witnesses: readonly string[]; readonly written: readonly string[] } {
    const day = Math.floor(input.at / this.config.dayMs);
    const tick = input.at - day * this.config.dayMs;
    const witnesses = this.resolveWitnesses(input);

    const written: string[] = [];
    // 三级取值：显式给的 > 编译器给的 > 按 kind 先验推。
    // 中间那一级不能漏——漏了它，`makeEpisodic` 会用先验值盖掉编译器定的性，
    // 于是同一条上游事件的记忆是 0.3、断言是 0.7，一件事两个版本。
    const valence = input.valence ?? input.voice?.valence ?? defaultValence(input.kind);
    const arousal = input.arousal ?? input.voice?.arousal ?? defaultArousal(input.kind);

    // **生效的那一版要落进事实里**，不能只在这个函数里用一次。
    //
    // 原来这里存的是 `input.voice` 原样，于是调用方显式给的 `valence` 进了
    // 显著度（`inputsFor`）与痕迹强度（`depositTraces`），却没有进事实本身。
    // 事后任何读 `contentForFact(fact)` 的人——断言的内容、以及碑文继承的
    // 效价——都只拿得到 kind 先验值。结果就是：目击者的记忆是 0.6，
    // 同一条事件的断言是 0，读碑文的人也是 0。一件事三个版本，
    // 而上面那条注释防的正是这个。
    //
    // `what` 与 `detailLevel` 也一并解析掉：`whatOf` 是先看 `outcome.what`
    // 再看 `voice.what`，把先验句填进来不改变它的结果（`outcome` 优先），
    // 但省得以后有人以为 `voice.what` 空着就等于「没有定过性」。
    const fact: WorldFact = {
      eventId: input.eventId,
      day,
      tick,
      kind: input.kind,
      placeId: input.place.placeId,
      actors: input.actors,
      witnesses,
      parentEventId: input.parentEventId,
      outcome: input.outcome,
      visibility: input.visibility,
      importanceHint: input.importanceHint,
      source: input.source,
      ...(input.place.placeType === undefined ? {} : { placeType: input.place.placeType }),
      voice: {
        what: input.voice?.what ?? DEFAULT_WHAT[input.kind] ?? input.kind,
        valence,
        arousal,
        detailLevel: input.voice?.detailLevel ?? 3,
      },
    };
    this.facts.set(fact.eventId, fact);
    // 事件落在哪儿，那个地方就「在哪」——哪怕它没有 Holder（`place:12,7` 这类
    // 合成地点只有坐标）。痕迹的准入（`traceRadius`）与废墟的渲染都读这张表。
    this.placeAnchors.set(input.place.placeId, input.place.at);
    // 方向性关系账本：**见证人 → 当事人**，不是在场的所有人两两互写。
    // A 看见 B 做了什么，只改 A 对 B；B 对 A 要 B 自己看见才算。
    this.updateBondsFromFact(fact, valence, day);
    // 街头小事的方向世界已经判好了：谁撞谁、谁帮谁。这一笔只落账，
    // 不再按见证人推——两个人都在场时，上面那条规则会把当事人跳过，
    // 于是「被撞的那一位恨撞人的」这一半永远记不下。
    if (input.bondDeltas !== undefined) this.applyBondDeltas(input.bondDeltas, fact.eventId, day);

    for (const holderId of witnesses) {
      const holder = this.holders.get(holderId);
      if (holder === undefined || holder.type !== 'character') continue;
      const parts = inputsFor({
        kind: input.kind,
        holderId,
        actors: input.actors,
        importanceHint: input.importanceHint,
        valence,
        arousal,
      });
      const weights = weightsFor(this.config.salienceWeights, holder.profile, this.config.salienceBias);
      const decision = decideWrite(weights, parts, this.config.T_write);
      if (!decision.write) continue;
      const entry = this.makeEpisodic(holderId, fact, {
        valence,
        arousal,
        salience: decision.salience.salience,
        detailLevel: 3,
      });
      this.entries.push(entry);
      written.push(entry.memoryId);
      this.emit('memory.written', input.at, {
        memoryId: entry.memoryId,
        holderId,
        eventRefs: entry.eventRefs,
        salience: entry.salience,
      });
    }

    // 听见的人：比目击更弱的记忆（细节 2、置信 0.6），并留一种可能的偏差。
    this.writeHeard(input, fact, witnesses, valence, arousal, written);

    // place Holder：后果规则，不走显著度。
    this.depositTraces(fact, input.at, input.place.placeType ?? 'generic', valence);

    // 楼的一生：建 / 改 / 拆 / 废墟 / 重建。与痕迹同源（都挂在 `placeId` 上）。
    if (input.landmark !== undefined) this.applyLandmark(fact, input.landmark, input.at, input.place.at);

    this.birthClaim(fact, written, input.at);

    return { witnesses, written };
  }

  /**
   * 开局把人物设定档案写进记忆。
   *
   * 这条**不是世界事件**：`source = genesis`、`kind = genesis_profile`，
   * 只有当事人自己「读到」档案，`sourceMode = read`；不生成目击者、
   * 不生成断言、不落痕迹，也不参与传言。重复调用按事件 id 幂等。
   *
   * 关系初值随同一条档案落账，证据指向同一条 genesis 事件，避免面板里
   * "档案写了关系、关系账本却是空"的两套说法。
   */
  seedGenesis(input: GenesisSeedInput): boolean {
    const eventId = `genesis:${input.holderId}`;
    if (this.facts.has(eventId)) return false;
    const day = Math.floor(input.atMs / this.config.dayMs);
    const tick = input.atMs - day * this.config.dayMs;
    const placeId = `genesis:${input.holderId}`;
    const fact: WorldFact = {
      eventId,
      day,
      tick,
      kind: 'genesis_profile',
      placeId,
      actors: [input.holderId],
      witnesses: [input.holderId],
      outcome: { what: input.text, genesis: true },
      visibility: 'world',
      importanceHint: 0,
      source: 'genesis',
      parentEventId: null,
      voice: { what: input.text, valence: 0, arousal: 0.15, detailLevel: 3 },
    };
    this.facts.set(eventId, fact);
    this.placeAnchors.set(placeId, input.placeAt);

    const base = this.makeEpisodic(input.holderId, fact, {
      valence: 0,
      arousal: 0.15,
      salience: 0.55,
      detailLevel: 3,
    });
    const entry: MemoryEntry = {
      ...base,
      tier: 'long',
      sourceMode: 'read',
      sourceChain: [],
      strength: 1,
      confidence: 1,
    };
    this.entries.push(entry);
    for (const bond of input.bonds) {
      if (bond.to === input.holderId) continue;
      this.bonds.set(this.bondKey(input.holderId, bond.to), {
        from: input.holderId,
        to: bond.to,
        trust: clampBond(bond.trust),
        warmth: clampBond(bond.warmth),
        debt: clampBond(bond.debt),
        familiarity: clamp01(bond.familiarity),
        strength: clamp01(Math.max(bond.familiarity, Math.abs(bond.trust), Math.abs(bond.warmth))),
        confidence: 1,
        evidence: [eventId],
        updatedDay: day,
      });
      this.refreshRelation(input.holderId, bond.to);
    }
    this.emit('memory.written', input.atMs, {
      memoryId: entry.memoryId,
      holderId: input.holderId,
      eventRefs: entry.eventRefs,
      salience: entry.salience,
    });
    return true;
  }

  /**
   * 上游动作从边界网关进来：先编译，再当作一条世界事件。
   *
   * 这是 `source = agent` 的唯一入口，也是脱敏发生的地方。编译不出事件
   * （拓扑不在表里，或一次平静的检索）时返回 `null`，世界什么都不会发生。
   */
  ingestUpstream(
    action: UpstreamAction,
    at: number,
    place: PlaceAnchor,
    actors: readonly string[],
    sight?: { readonly perceivers: readonly Perceiver[]; readonly grid: OcclusionGrid },
  ): WorldFact | null {
    const compiled = compile(action);
    if (compiled === null) return null;
    const eventId = this.nextEventId('up');
    // 编译器的定性一路带进世界。**早先这里把 `valence` / `arousal` 显式传成
    // `undefined`**，于是上游事件的情绪落回 `defaultValence` / `defaultArousal`
    // 那两张世界侧的兜底表。差的是唤醒度那一列：`defaultArousal` 没有
    // `discipline`（0.7）与 `oracle_prayer`（0.4）两行，兜底给 0.3，于是
    // `COMPILE_TABLE` 上写着「高唤醒」的训诫，进世界时唤醒度是通用的 0.3。
    // `claimContentFor` 的 `what` 也一并不被读取：上游事件说的是
    // 「有人被训诫了」，不是「有人在祭坛被训诫了」。
    // （效价那一列原来也是这么说的，那半句已经过期：`defaultValence`
    // 现在有 `discipline` → -0.6 这一行。详见 `EventVoice` 上那张对照表。）
    const voice = claimContentFor(compiled);
    this.ingest({
      eventId,
      at,
      kind: compiled.kind,
      place,
      actors,
      outcome: compiled.outcome,
      visibility: compiled.visibility,
      source: 'agent',
      importanceHint: compiled.importanceHint,
      parentEventId: null,
      // 给了现场就按感知模型算在场者；没给就按 `actors`——参与这件事的人
      // 按定义就在场。**早先这里写死成空数组**，于是上游事件一条目击者都
      // 没有：痕迹照落，但谁都不记得，入口形同虚设。事件进得来是一回事，
      // 进来之后世界真的记得它，是另一回事。
      ...(sight === undefined
        ? { witnesses: [...actors] }
        : { perceivers: sight.perceivers, grid: sight.grid }),
      voice,
    });
    return this.facts.get(eventId) ?? null;
  }

  // ------------------------------------------------------------ 单位读面

  /**
   * 某个单位能看见的世界。**唯一**的读入口。
   *
   * 返回的是深拷贝的切片：调用方改了它，世界里的库不受影响。这不是性能考量，
   * 是「单位不能改世界」这条的落法——他只能读。
   */
  viewOf(holderId: string): HolderView | null {
    const holder = this.holders.get(holderId);
    if (holder === undefined) return null;
    return {
      holderId,
      type: holder.type,
      memories: this.entries.filter((entry) => entry.holderId === holderId).map(cloneEntry),
      beliefs: this.beliefsOf(holderId).map((belief) => ({ ...belief })),
      verifyPlans: [...(this.verifyPlans.get(holderId) ?? [])],
      credibility: credibilityOf(this.credibility, holderId),
      traces: holder.type === 'place' ? [...(this.traces.get(holderId) ?? [])] : [],
      turningPoints: this.turningPointsOf(holderId),
    };
  }

  /**
   * 单位的一次回忆。走 `recall`，`commit` 时强化并可能变形。
   *
   * 取几条由调用方定：**对话注入是 `dialogueTopK`（3），一般回忆是 `budgetK`（5）**。
   * 两个数不是重复——对话里塞五条记忆，模型的话就会变成流水账；而主动回忆时
   * 捞得太少又接不上。早先只接了后者，于是 `dialogueTopK` 是个死数。
   */
  recallFor(holderId: string, request: Omit<RecallRequest, 'holderId'>): RecallOutcome {
    const mine = this.entries.filter((entry) => entry.holderId === holderId);
    const outcome = recall(mine, {
      ...request,
      holderId,
      relationshipOf: request.relationshipOf ?? ((entry) => this.relationshipFor(holderId, entry)),
    }, this.config, rollBelow);
    if (request.commit && outcome.updated.length > 0) {
      const byId = new Map(outcome.updated.map((entry) => [entry.memoryId, entry]));
      this.entries = this.entries.map((entry) => byId.get(entry.memoryId) ?? entry);
      for (const mutation of outcome.mutations) {
        this.emit('memory.recalled', request.nowDay * this.config.dayMs, {
          memoryId: mutation.memoryId,
          cues: request.cues,
          mutation: mutation.mutation,
        });
      }
    }
    return outcome;
  }

  /**
   * 对话时注入的那几条。`dialogueTopK` 在这里落地。
   *
   * 与 `recallFor` 的差别只有取几条与默认 `commit`：对话是**读**，
   * 读一次就把这条记忆强化一次会让「被反复提起的事」迅速变得比事实更牢固，
   * 而它可能只是一句闲话。所以默认不 commit，要 commit 得明说。
   *
   * **今天有一条链了**：点一个村民 → `SandboxScene.lookAtVillager` →
   * `MemoryRuntime.recallForDialogue` → 这里。`dialogueTopK` 因此有了真的
   * 读出点（面板的 Top-3 就是它），不是死数。但那条链只走**读**的一支：
   * `commit: true` 仍然零调用方——会强化、会变形的重构性回忆留给真正的交谈，
   * 那是外环的事。整条读链的形状见 `recall.ts` 文件头。
   */
  recallForDialogue(
    holderId: string,
    request: Omit<RecallRequest, 'holderId' | 'budgetK'>,
  ): RecallOutcome {
    return this.recallFor(holderId, { ...request, budgetK: this.config.dialogueTopK });
  }

  // -------------------------------------------------------------- 传播

  /**
   * 一条事件进来之后，断言在谁嘴里诞生。
   *
   * **这是传播层的地基。** `diffuseDay` 遍历的是 `this.claims`，而断言原本
   * 只有测试手工调用 `createClaimFrom` 才会存在——于是跑着的世界里这一层
   * 永远是空的：三天下来零次交谈、熵恒为 0、所有人被算成孤立。交谈、广播、
   * 书面、求证四条通道全都建在它上面，所以它们一起是死的，而且不报错。
   *
   * 三条规则，都不调模型：
   *
   * 1. **得有人真的记住了它。** 一条没人当回事的事不会有人去讲。所以断言的
   *    诞生门槛不是显著度（那是逐人的），而是「至少有一个目击者把它写进了
   *    记忆」——`written` 非空。
   * 2. **断言诞生在目击者身上，不在事件身上。** 起源者是按 `witnesses` 顺序
   *    第一个真正写下了记忆的人。楼不算：`place` Holder 记得痕迹，但它不开口。
   * 3. **一件事只诞生一条断言。** 重复 `ingest` 同一个 `eventId`，或者调用方
   *    已经手工 `createClaimFrom` 过，都不再生成第二条——否则同一天里
   *    同一个事件会有两种说法在村里并行流传，而它们本该是同一句话的两个版本。
   *
   * `private_to_player` 不诞生断言：那是玩家自己的事，村里的单位没有版本可讲。
   * （`sanitized` 事件照常诞生——它进世界时已经被编译成脱敏版本了。）
   */
  private birthClaim(fact: WorldFact, written: readonly string[], at: number): void {
    if (written.length === 0) return;
    if (fact.visibility === 'private_to_player') return;
    if (this.claimOfEvent(fact.eventId) !== undefined) return;
    const origin = written
      .map((memoryId) => this.entries.find((entry) => entry.memoryId === memoryId))
      .find((entry) => entry !== undefined);
    if (origin === undefined) return;
    this.createClaimFrom(fact.eventId, origin.holderId, at);
  }

  /** 这个事件已经有断言了吗。按 `eventRefs` 找，不按 id 猜。 */
  private claimOfEvent(eventId: string): Claim | undefined {
    for (const claim of this.claims.values()) {
      if (claim.eventRefs.includes(eventId)) return claim;
    }
    return undefined;
  }

  /**
   * 造一条断言。断言诞生在目击者身上。
   *
   * `claim.created` 事件照发，但**不调模型**：内容直接取自事件的结构化字段。
   *
   * **一件事只有一条断言。** 已经有了就原样返回，不再发第二次
   * `claim.created`。这条不是防重的小聪明：同一个事件如果同时挂着两条断言，
   * 它们会各自扩散、各自算覆盖率，而 `coverage_curve` 的分母是一个事件——
   * 同一件事在村里有两个「版本」同时流传，正是协议想避免的那种重复。
   * 不同的讲法由 `retell` 的逐跳变形表达（`hop` 与 `sourceChain`），
   * 不是由第二条断言表达。
   *
   * 先到先得也适用于 `secret`：第一次诞生时不是秘密，后来再有人想把它
   * 标成秘密，不会成功——秘密是断言出生时的属性，不是谁都能事后盖的章。
   */
  createClaimFrom(eventId: string, originHolderId: string, at: number, secret = false): Claim | null {
    const existing = this.claimOfEvent(eventId);
    if (existing !== undefined) return existing;
    const fact = this.facts.get(eventId);
    if (fact === undefined) return null;
    const claim = createClaim({
      claimId: this.nextId('claim'),
      eventRef: eventId,
      content: this.contentForFact(fact),
      originHolderId,
      day: fact.day,
      confidence: 1,
      secret,
    });
    this.claims.set(claim.claimId, claim);
    this.emit('claim.created', at, {
      claimId: claim.claimId,
      eventRefs: claim.eventRefs,
      originHolderId,
    });
    return claim;
  }

  /**
   * 屏幕外的一天：图扩散批量近似。
   *
   * 与屏幕内的逐次交谈走同一组函数（`spreadStep` → `judge` → 写信念），
   * 所以两边结果一致。屏幕内只是把「相遇」换成动画驱动的触发，
   * 不另写一套传播规则。
   *
   * **按跳数分层推进，不按「轮」**。第 h 跳的持有者说的话，落成第 h+1 跳的
   * 版本；同一个村子里的第一跳与第三跳可以同时存在，它们各自有各自的保真度。
   * 早先的实现让所有人共用一条不断被 retell 的断言对象，于是最后一个听到的人
   * 会把所有人的跳数一起改掉——保真度曲线因此画不出来，而它是一条验收指标。
   */
  diffuseDay(at: number): { readonly told: number; readonly accepted: number; readonly suspicious: number } {
    const day = Math.floor(at / this.config.dayMs);
    this.currentDay = day;
    if (this.fanout.day !== day) this.fanout = { day, counts: new Map() };
    // 日终再补一次照面：只摆好位置、从没被行为层挪动过的单位（测试里全是
    // 这样）靠这一下进 `metToday`，于是「日终那一格」这个老行为原样保留，
    // 新的「白天碰过面」只是加在它上面。
    this.sampleEncounters();

    let told = 0;
    let accepted = 0;
    let suspicious = 0;

    // 一次批量扩散 = 每对单位之间的一次交谈。两条闸各管一头：
    //
    // - `talkTopicsPerChat`（2 条）：**这一次交谈**能带几个话题。没有它，
    //   一个人一天之内可以把世上所有断言一口气讲给同一个人听。
    // - `chatCooldownDays`（0.25 天）：**下一次交谈**得等多久。它记的是
    //   交谈结束的时刻，所以本次交谈期间的后续话题不受它拦。
    //
    // 两条分开记，是因为它们是两件事。早先只推了后者，于是前者永远咬不到：
    // 同一对单位一次只能传一条断言，而「一次交谈 2 条」这个上限根本没机会生效。
    const topicsByPair = new Map<string, number>();
    const chatCooldowns: CooldownState[] = [];

    // 「今天还能开几次口」的可达上限：每个够得着的单位对每天最多
    // `talkTopicsPerChat` 个话题，而这是**跨断言共享**的一份额度。
    //
    // 少了这道闸，日终会为每一句历史断言都跑一遍「找候选 → 判采信 →
    // retell」，最后被 `talkTopicsPerChat` 在同一对单位那里挡掉。实测 400 天、
    // 3 人 4 楼：1800 条断言里 1398 条一个听众都没有，而它们天天被重跑。
    // 等所有够得着的对都用完额度，剩下的断言今天不可能改变任何人——
    // 这是 `diffuseDay` 的一半开销。
    const speakPairs: string[] = [];
    for (const key of this.metToday.keys()) {
      const split = key.indexOf('\u0000');
      const a = key.slice(0, split);
      const b = key.slice(split + 1);
      if (this.holders.get(a)?.type === 'character' || this.holders.get(b)?.type === 'character') {
        speakPairs.push(key);
      }
    }
    const speakPairSet = new Set(speakPairs);
    let saturatedPairs = 0;

    // 冷却按「单位对」建索引：原先每个候选都要扫一遍全部冷却（只为了跳过
    // 别人的那一对），而冷却条数随断言数线性增长，于是又乘出一个平方项。
    const cooldownsOfPair = (a: string, b: string): readonly CooldownState[] =>
      this.cooldowsFor(pairKey(a, b));
    // 听众「关于这件事知道什么」走事件索引，不再把他的全部信念铺一遍。
    // `spreadStep` 缺省仍读 `beliefs` 那张全表——测试与别的调用方行为不变。
    const existingOf = (listener: string, claim: Claim): readonly ListenerBelief[] =>
      this.listenerViewsFor(listener, claim.eventRefs);
    // 性格表一天建一次：原先每个说话者都重建一遍（每句断言 × 每个人）。
    const talkativeness = this.talkativeness();

    // 按 claimId 排序处理：同一天里多条断言的先后必须确定。
    const claimIds = [...this.claims.keys()].sort();
    const holderIds = this.holderIds();
    // 今天**够得着的**那些人：出现在 `metToday` 里的单位。楼在村子另一头就
    // 够不着，哪怕它还没听说过这件事——它今天没跟任何人碰上，谁也讲不进
    // 它的耳朵。这一格是「今天可能改变什么」的全部范围。
    const reachable = new Set<string>();
    for (const key of this.metToday.keys()) {
      const split = key.indexOf('\u0000');
      reachable.add(key.slice(0, split));
      reachable.add(key.slice(split + 1));
    }
    for (const claimId of claimIds) {
      // 每一对够得着的单位今天的额度都用完了：剩下的断言今天谁也讲不进。
      // 这不是「提前收工」的优化，是同一件事的另一次表述——额度是共享的。
      if (saturatedPairs >= speakPairs.length) break;
      const origin = this.claims.get(claimId);
      if (origin === undefined) continue;

      // **今天不可能改变任何人的断言，直接跳过。** 这是这一版最大的一笔省：
      // 没有它，每条断言每天都要把 `hops × 说话者 × 候选` 走一遍，
      // 而走出来的结果永远是「没人可讲」——400 天时九成开销花在这里。
      //
      // 判据是「够得着的人里还有没有不知道的」，不是「全员都知道」：
      // 楼常年站在村子另一头，永远够不着，把它算进分母会让这道闸永不关闭
      // （实测 3 人 4 楼的合成基线，`dayClosed` 因此一点没降）。
      // 也不是「跳数用完」：跳数管深度，不回答「今天还有没有人能听」。
      const knownHolders = new Set(this.beliefsOfClaim(claimId).map((belief) => belief.holderId));
      let useful = false;
      for (const holderId of reachable) {
        if (!knownHolders.has(holderId)) {
          useful = true;
          break;
        }
      }
      if (!useful) continue;

      for (let hop = 0; hop < this.config.maxHops; hop += 1) {
        const version = claimAtHop(origin, hop, this.config);
        if (!canSpread(version, this.config)) break;
        const holdersAtHop = this.beliefsOfClaim(claimId)
          // **今天才听说的人，今天不往下传。**
          //
          // 一跳 ≈ 一天的闲话。少了这一条，`diffuseDay` 会在一次日终里把
          // 0→1→2→3 跳全部跑完，等于一夜之间把三天的流言都传遍——覆盖率曲线
          // 第 1 天就冲到 60%，而护栏要的是第 1 天 ≤35%、第 3 天才到 60~80%。
          // 第 0 跳不受限：目击者当天就能开口。
          .filter((belief) => belief.hop === hop)
          .filter((belief) => belief.learnedDay < day || hop === 0)
          .map((belief) => belief.holderId);
        // 断言诞生者本人就是第 0 跳的持有者。
        if (hop === 0 && !holdersAtHop.includes(origin.originHolderId)) {
          holdersAtHop.push(origin.originHolderId);
        }
        if (holdersAtHop.length === 0) continue;

        for (const speaker of [...holdersAtHop].sort()) {
          if (!canFanout(this.fanout, speaker, claimId, day, this.config)) continue;
          const candidates = this.spreadCandidates(speaker, holderIds);
          const steps = spreadStep({
            day,
            claim: version,
            candidates,
            relations: this.relations,
            credibility: this.credibility,
            beliefs: EMPTY_BELIEF_VIEWS,
            existingOf,
            talkativeness,
            cooldowns: this.cooldowns,
            cooldownsOf: cooldownsOfPair,
            nowMs: at,
            config: this.config,
          });
          for (const step of steps) {
            if (!canFanout(this.fanout, step.from, claimId, day, this.config)) break;
            const pair = pairKey(step.from, step.to);
            const used = topicsByPair.get(pair) ?? 0;
            // 这一对已经聊满了，换下一对。不是 `break`：别的单位对还能说。
            if (used >= this.config.talkTopicsPerChat) continue;
            const delivered = this.deliver(step.from, step.to, step.claim, step.verdict, at);
            if (!delivered) continue;
            if (used === 0) {
              // 第一次开口：这一对今天聊过了。散完之后整体记冷却。
              chatCooldowns.push({ pairKey: pair, claimId: null, atMs: at });
            }
            topicsByPair.set(pair, used + 1);
            if (used + 1 >= this.config.talkTopicsPerChat && speakPairSet.has(pair)) {
              saturatedPairs += 1;
            }
            told += 1;
            if (step.verdict === 'accept') accepted += 1;
            if (step.verdict === 'verify') suspicious += 1;
            this.bumpFanout(step.from, claimId, day);
          }
        }
      }
    }

    // 交谈结束了才记冷却。中途记的话，本次交谈的第二个话题会被自己刚写的
    // 冷却拦住——「一次交谈 2 条」就变成了一句空话。
    for (const item of chatCooldowns) this.appendCooldown(item);

    // 这一天的账到此为止。不清的话，「昨天见过」会一直算数，几天之后村里
    // 就成了全连接图——那正是 `talkDistance` 想拦的东西。
    this.metToday.clear();

    return { told, accepted, suspicious };
  }

  /** 读公告栏。公告不 retell：保真度是「高，有权威」。 */
  postAnnouncement(announcement: Announcement): boolean {
    const next = postAnnouncement(announcement, this.announcements, this.config);
    if (next === null) return false;
    this.announcements = next;
    this.claims.set(announcement.claim.claimId, announcement.claim);
    this.emit('announcement.posted', announcement.postedDay * this.config.dayMs, {
      announcementId: announcement.announcementId,
      placeId: announcement.placeId,
      claimId: announcement.claim.claimId,
    });
    return true;
  }

  /** 一个单位读到了公告。读到的内容直接进信念，跳数为 0。 */
  readAnnouncement(holderId: string, announcementId: string, at: number): Belief | null {
    const announcement = this.announcements.find((item) => item.announcementId === announcementId);
    if (announcement === undefined) return null;
    const belief = this.addBelief(holderId, announcement.claim, announcement.claim.originHolderId, 'held', at);
    this.emit('announcement.read', at, { announcementId, holderId });
    return belief;
  }

  // -------------------------------------------------------------- 书面

  /**
   * 写一封信。一封信一条断言，超了就写不成（见 `written.ts` 的解释）。
   *
   * **这一路在跑着的世界里是断的，两头都断。** 扫一遍（`grep -rn "\.writeLetter(" src`）
   * 可知：`writeLetter` 与 `readWritten`、`writtenOf` 在 `src/` 里一个调用方都没有，
   * 层内也没有。而五类通道里另外四类都有生产方——直接感知走 `observe`/`ingest`，
   * 对话走 `diffuseDay`，广播走 `postDailyReport`，痕迹随 `ingest` 落。所以书面通道
   * 是**半接**的：日记那一半由 `dayClosed` → `writeDailies` 天天在产，书信那一半
   * 从来没有被触发过一次，`kind: 'letter'` 在跑着的世界里一次都没落过地。
   *
   * 没有替它接上，是因为补设计 §3.2 那一行只规定了书面通道的**参数**（`letterClaims`
   * 一条、去档案室主动查阅、慢、最高保真）与**权限**（收发双方），没有一个字说
   * 「什么时候该有人写信」。对照广播：那一行明写了三方发布权，其中「系统日终日报」
   * 不需要生成逻辑，所以 `postDailyReport` 接得上。书信缺的正是这个「谁该写」的判据，
   * 而它是外环的事。出口留着，不假装它接着。
   *
   * 顺带两处贴错的事件标签，病根同一个——`MemoryEventKind` 那个闭集里，写侧只有
   * `diary.written`、读侧只有 `announcement.read`，书信被塞进了这两格，而协议 §13
   * 那张表本来就没有书信事件：
   * - 本函数发的竟是 `'diary.written'`。写一封信，报的是「有人写了一篇日记」。
   *   `memory-diary.test.ts` 里「两天两条」那条断言能过，只因为那个测试里恰好没有信。
   * - `readWritten` 发的是 `'announcement.read'`。读一封信，报的是「有人读了一条公告」。
   * 要修就得往闭集里加 `letter.written` / `written.read` 两格——那是 taxonomy 决定，
   * 而归将来接这条流的人（今天它一个消费方都没有，见 `MemoryEventKind` 上那张表）。
   */
  writeLetter(input: {
    readonly authorId: string;
    readonly recipientId: string;
    readonly claimIds: readonly string[];
    readonly placeId: string;
    readonly at: number;
  }): WrittenRecord | null {
    const claims = input.claimIds
      .map((claimId) => this.claims.get(claimId))
      .filter((claim): claim is Claim => claim !== undefined);
    const record = writeLetter({
      recordId: this.nextId('letter'),
      authorId: input.authorId,
      recipientId: input.recipientId,
      claims,
      day: Math.floor(input.at / this.config.dayMs),
      placeId: input.placeId,
      config: this.config,
    });
    if (record === null) return null;
    this.written = [...this.written, record];
    this.emit('diary.written', input.at, {
      recordId: record.recordId,
      kind: record.kind,
      authorId: record.authorId,
      recipientId: record.recipientId,
      claimIds: record.claims.map((claim) => claim.claimId),
    });
    return record;
  }

  /**
   * 写今天的日记。只收亲历的条目，超 `diaryClaimsPerDay` 条按显著度截断。
   */
  writeDiary(input: {
    readonly authorId: string;
    readonly placeId: string;
    readonly at: number;
  }): WrittenRecord | null {
    const record = writeDiary({
      recordId: this.nextId('diary'),
      authorId: input.authorId,
      entries: this.entries,
      day: Math.floor(input.at / this.config.dayMs),
      placeId: input.placeId,
      config: this.config,
    });
    if (record === null) return null;
    this.written = [...this.written, record];
    this.emit('diary.written', input.at, {
      recordId: record.recordId,
      kind: record.kind,
      authorId: record.authorId,
      recipientId: null,
      claimIds: record.claims.map((claim) => claim.claimId),
    });
    return record;
  }

  /**
   * 读一封信或一本日记。读到的断言原样进信念，**跳数为 0**——
   * 书面通道不随跳数衰减，这是它存在的理由。
   *
   * 读不到（不是收件人、不是本人、记录不存在）时返回空数组，
   * 调用方分不出「没有」和「不给读」——这两种情况下他本来就都该什么都不知道。
   */
  readWritten(holderId: string, recordId: string, at: number): readonly Belief[] {
    const record = this.written.find((item) => item.recordId === recordId);
    if (record === undefined) return [];
    const claims = readRecord(record, holderId);
    const out: Belief[] = [];
    for (const claim of claims) {
      this.claims.set(claim.claimId, claim);
      out.push(this.addBelief(holderId, claim, record.authorId, 'held', at));
    }
    if (out.length > 0) {
      this.emit('announcement.read', at, {
        recordId,
        holderId,
        kind: record.kind,
        claimIds: claims.map((claim) => claim.claimId),
      });
    }
    return out;
  }

  /** 这个人写得下、也读得到的那几条记录。给 UI 与调试用。 */
  writtenOf(holderId: string): readonly WrittenRecord[] {
    return this.written.filter((record) => readRecord(record, holderId).length > 0);
  }

  // -------------------------------------------------------- 痕迹与推断

  /**
   * 集体记忆：活着的与淡去的传说。
   *
   * 不挂在 `HolderView` 上——传说不是任何一个单位的记忆，它挂在事件上。
   * 但世界得能读它：协议第 12 节要验「同一事件的断言被足够多的人持有」，
   * 而 `reach` 是这个世界上唯一会自己涨自己跌的数，不给读就没法验。
   *
   * 返回拷贝：调用方改了它，表里不受影响。
   */
  legendsOf(): readonly Legend[] {
    return this.legends.map((legend) => ({ ...legend }));
  }

  /**
   * 给一个地点登记它的名字。**只登记第一次**。
   *
   * 名字是场景每一拍递进来的（`PlacedBuilding.displayName`），而改名是这一层
   * 自己的事。如果这里每次都覆盖，下一次 `syncHolders` 就会把改过的名字抹回
   * 原名——历史链还在，名字却倒退，那比不改名更难看。
   */
  setPlaceName(placeId: string, name: string): void {
    if (this.placeNames.has(placeId)) return;
    this.placeNames.set(placeId, { name, history: [] });
  }

  /** 一个地点此刻叫什么、改过几次名。没登记过就是 `null`——不编一个名字给它。 */
  placeNameOf(placeId: string): Toponym | null {
    const entry = this.placeNames.get(placeId);
    if (entry === undefined) return null;
    return { name: entry.name, history: entry.history.map((item) => ({ ...item })) };
  }

  /**
   * 一个地点此刻留下的全部痕迹。**不问 Holder 还在不在。**
   *
   * `viewOf` 的那一扇门要求单位在名册里，而楼拆掉之后名册里就没有它了——
   * 于是痕迹明明还在库里，读的人却拿不到。这一扇门只读痕迹那一张表，
   * 楼拆了、地标还在、痕迹照旧在原处。
   */
  tracesAt(placeId: string): readonly Trace[] {
    return [...(this.traces.get(placeId) ?? [])];
  }

  /** 一个地点最后一次被人知道在哪。拆掉的楼也有——那是废墟的位置。 */
  placeAnchorOf(placeId: string): { readonly x: number; readonly y: number } | null {
    const at = this.placeAnchors.get(placeId);
    return at === undefined ? null : { x: at.x, y: at.y };
  }

  /** 还留着痕迹的地点的 id，按字典序。渲染层据此找出「已经没有楼、但还有痕迹」的废墟。 */
  tracedPlaceIds(): readonly string[] {
    const ids: string[] = [];
    for (const [placeId, traces] of this.traces) {
      if (traces.length === 0) continue;
      ids.push(placeId);
    }
    return ids.sort();
  }

  /**
   * 一个单位路过某地，看见痕迹，推断出点什么。
   *
   * 这是「痕迹」通道的落点：低保真、需推断、0 次模型调用。
   * 碑文是唯一例外——它升级成 `read`，因为碑文绑着 event_ref。
   */
  lookAtTraces(holderId: string, placeId: string, at: number): InferenceSpec[] {
    // 走到那栋楼跟前才看得见痕迹。`traceRadius`（3 格）是这一步的准入，
    // 不是装饰参数：没有它，任何一个 unit 都能在村子另一头「路过」，
    // 于是痕迹通道等于免费的全村广播，而它本该是最慢、最费力的一条。
    if (!this.withinTraceReach(holderId, placeId)) return [];
    const traces = exposedTraces(this.traces.get(placeId) ?? [], this.config.traceExposedLayers);
    const out: InferenceSpec[] = [];
    for (const trace of traces) {
      const spec = inferenceOf(trace.layerType);
      if (spec === null) continue;
      // 碑文的效价继承它绑着的那个事件（见 `traceValence`）。别的痕迹照表里的来。
      const valence = this.traceValence(trace, spec);
      // 回报出去的也是**生效的那份**：调用方拿它去挂牌子，牌子上写的情绪
      // 得跟落进记忆的是同一个。原来这里原样push 表里那一行，于是碑文
      // 「说」出来是 0，写下去是 0.6——同一个函数两个口径。
      out.push(valence === spec.valence ? spec : { ...spec, valence });
      // 同一个人、同一处、同一类痕迹，只落一条记忆。
      //
      // `deliver` 靠「已经有这条信念了」保证一句话只被收下一次；痕迹通道
      // 这边原来没有任何等价物——`lookAtTraces` 每调一次就多写一条，而
      // 唯一的调用方（SandboxScene）是拿自己那张 `seenToday` 表挡住的。
      // 账本自己不认这条性质，换个调用方就原形毕露：一个人站在门口不动，
      // 每拍都重新推断同一道焦痕，一天下来记忆库被同一条痕迹灌满，而痕迹
      // 的价值恰恰在于稀少。
      //
      // **回报照旧给。** 看得见与记下来是两件事：重复调用仍然拿得到这条
      // 痕迹，调用方因此照旧知道「今天看过了」。要是改成返回空数组，
      // 调用方便永远学不会这件事，于是每拍都来问一遍。
      const already = this.entries.some(
        (entry) =>
          entry.holderId === holderId &&
          entry.content.where === placeId &&
          entry.content.what === spec.what &&
          entry.sourceMode === spec.sourceMode,
      );
      if (already) continue;
      const content: MemoryContent = {
        what: spec.what,
        who: [],
        where: placeId,
        when: Math.floor(at / this.config.dayMs),
        detailLevel: spec.detailLevel,
        valence,
        arousal: spec.arousal,
      };
      const entry: MemoryEntry = {
        memoryId: this.nextId('m'),
        holderId,
        // 照表里那一行的来，不一律写 `episodic`：磨损小径推出来的是 `habit`
        // （§1.2 第三行），它记的是「这里一直有人来」，不是「那天我看见了一道痕」。
        kind: spec.kind,
        tier: 'day',
        eventRefs: [trace.eventRef],
        sourceMode: spec.sourceMode,
        sourceChain: [],
        content,
        salience: spec.confidence * 0.6 + Math.abs(valence) * 0.4,
        confidence: spec.confidence,
        strength: 1,
        createdDay: content.when,
        lastRecalledDay: content.when,
        recallCount: 0,
        flashbulb: false,
        pinned: false,
        redacted: false,
        derivedFrom: { memoryIds: [], claimIds: [] },
        generatedBy: this.ruleMeta(holderId, trace.traceId, content.when),
        archived: false,
      };
      this.entries.push(entry);
      this.emit('cue.fired', at, { holderId, cue: { placeId, layer: trace.layerType } });
    }
    return out;
  }

  // ---------------------------------------------------------- 求证闭环

  /** 一个单位到了事发地，看现场，判这条传言是真是假。 */
  verify(holderId: string, claimId: string, placeId: string, at: number): {
    readonly outcome: ReturnType<typeof verifyAt>;
    readonly debunkedSpeaker: string | null;
    /** 被升级成 `witnessed` / `read` 的记忆 id。求证没成就是空数组。 */
    readonly upgradedMemoryIds: readonly string[];
  } {
    const claim = this.claims.get(claimId);
    if (claim === undefined) {
      return { outcome: 'inconclusive', debunkedSpeaker: null, upgradedMemoryIds: [] };
    }

    const announcementClaims = this.announcements
      .filter((item) => item.placeId === placeId)
      .map((item) => item.claim);
    const verdict = judgeVerify(
      { traces: this.traces.get(placeId) ?? [], announcementClaims },
      claim,
    );
    const outcome = verdict.outcome;

    const state = outcome === 'confirmed' ? 'confirmed' : outcome === 'debunked' ? 'debunked' : 'suspicious';
    const held = this.beliefOf(holderId, claimId);
    const before = held?.state;
    if (held !== undefined) this.setBelief({ ...held, state });
    // 成长记录：**看法真的翻过来**的那一次才记。
    //
    // 只记 `held/suspicious → confirmed/debunked` 这两类落地结算：求证没成
    // （`suspicious`）不是「他变了」，是他还没想明白——那不是转折点。
    // `inconclusive` 因此一条也不写。
    const settled = state === 'confirmed' || state === 'debunked';
    if (before !== undefined && before !== state && settled) {
      this.turningPoints.push({
        holderId,
        day: Math.floor(at / this.config.dayMs),
        atMs: at,
        kind: 'belief-reversed',
        claimId,
        eventRefs: claim.eventRefs,
        from: before,
        to: state,
      });
    }

    // 求证成功还有后半句，见 `upgradeOnVerify`。**先升级再报事件**：一条
    // `belief.updated` 把「信念变了」和「记忆也变了」一起说清。反过来先报，
    // 回放的人会先看到信念已证实、而记忆还是 `heard` 打折后的那一版。
    // `upgradedMemoryIds` 只在求证这一路上有：求证没成就是空数组——
    // 「跑了一趟，但没有听说记忆可升」本身也是个结果。
    const upgraded =
      outcome === 'confirmed' && verdict.evidence !== null
        ? this.upgradeOnVerify(holderId, claimId, verdict.evidence)
        : [];
    this.emit('belief.updated', at, { holderId, claimId, state, upgradedMemoryIds: upgraded });

    let debunkedSpeaker: string | null = null;
    if (outcome === 'debunked') {
      debunkedSpeaker = this.beliefOf(holderId, claimId)?.sourceHolderId ?? claim.originHolderId;
      this.credibility = penalize(this.credibility, debunkedSpeaker, this.config);
      this.emit('rumor.debunked', at, {
        claimId,
        holderId,
        speakerId: debunkedSpeaker,
        placeId,
      });
    }

    // 求证完就撤掉这条日程：跑一趟只解决一条传言。
    const remaining = (this.verifyPlans.get(holderId) ?? []).filter((plan) => plan.claimId !== claimId);
    this.verifyPlans.set(holderId, remaining);
    return { outcome, debunkedSpeaker, upgradedMemoryIds: upgraded };
  }

  /**
   * 求证成功之后，听说来的那条升级成亲眼或亲读。
   *
   * 补充设计 §1.1 第 3 步的后半句：「若在事发地目击到对应的物质痕迹，或在公告栏
   * 读到官方通告，则将原 `heard` 记忆升级为 `witnessed / read`，置信度拉满」。
   * 原先这一句一处都没有——只有前半句（辟谣、可靠度下调 0.15）落了地。全仓
   * `sourceMode` 与 `confidence` 都只在条目**诞生**时写一次，之后再也不改，
   * 于是跑完一趟求证，他的记忆仍旧是 `heard`、可信度还是跳数打折后的那个数。
   * 「他亲自去现场看过」这件事在世界里没有留下任何痕迹。
   *
   * 痕迹定的案升 `witnessed`（他到过现场，看见的是物质），公告定的案升 `read`
   * （他读到的是记录）。`sourceChain` 一并清空：那个字段的定义是「heard 时的
   * 来源链」，一条 `witnessed` 却挂着三层转述的条目自己和自己矛盾。
   *
   * 只升 `heard` 的。已经 `witnessed` 的不用升；`inferred` 是从痕迹推出来的，
   * 不是听说，也不该被这条路改动——他从没信过任何人，他只是看见了地上的东西。
   *
   * 不挑 `claimIds` 里只有这一条的：同一条断言常常派生出好几段说法（当面讲的、
   * 广播听的），它们都是同一个传闻，一起升。
   */
  private upgradeOnVerify(
    holderId: string,
    claimId: string,
    evidence: 'trace' | 'announcement',
  ): readonly string[] {
    const sourceMode = evidence === 'announcement' ? 'read' : 'witnessed';
    const upgraded: string[] = [];
    this.entries = this.entries.map((entry) => {
      if (entry.holderId !== holderId) return entry;
      if (entry.sourceMode !== 'heard') return entry;
      if (!entry.derivedFrom.claimIds.includes(claimId)) return entry;
      upgraded.push(entry.memoryId);
      return { ...entry, sourceMode, confidence: 1, sourceChain: [] };
    });
    return upgraded;
  }

  // -------------------------------------------------------------- 天界

  /**
   * `DayClosed`。整理、扩散、传说、心电图，一次做完。
   *
   * 顺序有讲究：先扩散（当天的传言当天传），再整理（把当天的一切压成摘要），
   * 最后算心电图（它要看的就是整理之后的样子）。
   */
  dayClosed(day: number, at: number): WorldVitals {
    const closedDay = day;
    this.currentDay = closedDay;

    // 关系账本先衰减，再整理记忆：第二天读到的 trust 是衰减后的绝对值，
    // 而证据链仍指着原事件。当天刚写过的那条不衰减——否则「今天结下的
    // -0.22」在当天关账时就变成 -0.187，日读数会把两天的变化混成一天。
    this.decayBonds(closedDay);
    // 衰减之后再记今天的日常照面：当天见过的那一对，`updatedDay` 落在今天。
    this.accrueDailyAcquaintance(closedDay);
    this.diffuseDay(at);
    this.weatherTraces(closedDay);

    // **日记要写在整理之前。** 整理会把当天的片段降级或压成摘要，写在那之后
    // 就一条都收不到了——日记收的正是「今天的片段」。这一句放错过位置，
    // 表现是日记从来不存在，而 `diary.written` 这个事件类型一直躺在类型表里。
    this.writeDailies(closedDay, at);
    // 情绪在整理之前更新：它读的是「今天的片段」。整理之后片段会被压成摘要。
    this.updateMoods(closedDay, at);

    const ids = this.holderIds();
    const archivedBefore = new Set(
      this.entries.filter((entry) => entry.archived).map((entry) => entry.memoryId),
    );
    for (const holderId of ids) {
      const result = consolidateHolder(holderId, this.entries, closedDay, this.config, this.facts);
      this.entries = [...result.entries] as MemoryEntry[];
      this.emit('memory.consolidated', at, { holderId, day: closedDay, stats: result.stats });
    }
    // **只报这一天才归档的。** 原先这里每天把全部已归档条目重发一遍：
    // 一条第 40 天归档的碑文，到第 90 天会被报 50 次，累计计数于是变成
    // 「归档过多少条 × 又过了多少天」，读数没法用来判断清理是否生效。
    for (const entry of this.entries) {
      if (!entry.archived || archivedBefore.has(entry.memoryId)) continue;
      this.emit('memory.archived', at, { memoryId: entry.memoryId, holderId: entry.holderId });
    }

    // 日报先贴，传说后算：公告也是一条「有人知道了」的路，而传说分不出
    // 也不该分他是从公告栏知道的还是从邻居那儿听来的。
    this.postDailyReport(closedDay, at);
    this.updateLegends(closedDay, at);

    // **当天的时间轴要压在「今天最后一次写库」之后、预算之前。**
    // 刻碑（`updateLegends`）也会给在场的人各记一条当天条目——它属于
    // 「那天的时间轴」，但不在活动的片段里。压在刻碑之后，摘要的拍子数
    // 才等于当天应有的条数；压在预算之前，才不会被旧日片段的裁剪带跑。
    this.writeDayDigest(closedDay);
    // 预算在传说之后：刻碑是今天最后一件往库里写字的事，落在预算外面就
    // 要等明天才被裁，而读数取的是当天末。
    this.enforceBudgets(closedDay, at);
    const vitals = computeVitals({
      day: closedDay,
      memories: this.entries,
      beliefs: this.beliefs,
      tells: this.tells,
      holderIds: ids,
      // 孤立只看人。楼不说话，把它算进来会让这个数常年钉在楼的数量上，
      // 而导演读它是要看「世界是不是死了」——那个数得会动。
      characterIds: ids.filter((holderId) => this.holders.get(holderId)?.type === 'character'),
      config: this.config,
    });
    // 场景记忆的日终两笔：先把拆掉很久的地标记成废墟，再把今天记进时代。
    // 两者都是 O(块/条) 的加法，不扫事实库、不序列化——关账路径上不许出现
    // 「把整个库 JSON 一次」这种事（checkpoint 那一层同理）。
    this.advanceLandmarks(closedDay, at);
    this.recordEra(closedDay, vitals);
    // 心电图向外广播。本组不读它做任何决定——那是导演的事。
    this.emit('day.closed', at, { ...vitals });
    return vitals;
  }

  // ---------------------------------------------------------------- 预算

  /**
   * 关账的最后一道闸：每一个库都按「条数 + 字节」裁到预算内，并留下可查的痕迹。
   *
   * **为什么要有这一层。** 整理（`consolidateHolder`）只裁条目层的四个桶；
   * 事实、断言、信念、冷却、传话记录、日记这六个库原先一条预算都没有。30 日
   * 实测它们合计 945 KB（占记忆 65%），日均 +38 KB，而条目层的增长只有 +12 KB。
   * 也就是说「存档越来越大」的主体不在整理路径上，任何只在整理里加阈值的
   * 修法都拦不住它。
   *
   * **裁的顺序不是随意的**，每一个库都按它自己的价值轴：
   * - `facts`：重要度 → 新 → id。一条拆楼留得比一条打水久。
   * - `claims`：置信度 → 新。说不清的事先忘。
   * - `beliefs`：置信度 → 新。同一个人对同一件事只留他知道得最清楚的那几条。
   * - `cooldowns`：纯新旧。它只管「这会儿能不能再说」，过期就是过期。
   * - `tells`：纯新旧。心电图只看最近三天。
   * - `written`：纯新旧。日记与书信是有日期的记录，裁得掉旧的，裁不掉的事实。
   * - `legends`（镇志条目）：传播面 → 新。讲得最广的那条传说最后才淡。
   *
   * **裁掉事实会被看见。** 条目里的 `eventRefs` 指向一条已经不在的事实库的
   * 事件，面板读到的地点/当事人/说法三样都变成「不知道」——`dayTimelineFor`
   * 已经按 null 返回，`unit-status` 写成「地点不明」「时刻不明」。这条路径
   * 在这之前一次都没被走过，因为事实从来不删。
   */
  private enforceBudgets(day: number, at: number): void {
    const entryTrim = trimEntriesToBudget(this.entries, this.config);
    if (entryTrim.byCount + entryTrim.byBytes > 0) {
      this.entries = entryTrim.kept as MemoryEntry[];
      this.emitPruned(day, at, 'entries', entryTrim.byCount, entryTrim.byBytes, entryTrim.countOver, entryTrim.bytesOver, this.entries.length);
    }

    const facts = this.trimRecords([...this.facts.values()], this.config.libraryBudget.facts, (a, b) => {
      const ia = a.importanceHint ?? 0;
      const ib = b.importanceHint ?? 0;
      if (ia !== ib) return ib - ia;
      if (a.day !== b.day) return b.day - a.day;
      return a.eventId.localeCompare(b.eventId);
    });
    if (facts.byCount + facts.byBytes > 0) {
      const keep = new Set(facts.kept.map((fact) => fact.eventId));
      for (const eventId of [...this.facts.keys()]) {
        if (!keep.has(eventId)) this.facts.delete(eventId);
      }
      this.emitPruned(day, at, 'facts', facts.byCount, facts.byBytes, facts.countOver, facts.bytesOver, this.facts.size);
    }

    const claims = this.trimRecords([...this.claims.values()], this.config.libraryBudget.claims, (a, b) => {
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.createdDay !== b.createdDay) return b.createdDay - a.createdDay;
      return a.claimId.localeCompare(b.claimId);
    });
    if (claims.byCount + claims.byBytes > 0) {
      const keep = new Set(claims.kept.map((claim) => claim.claimId));
      for (const claimId of [...this.claims.keys()]) {
        if (!keep.has(claimId)) this.claims.delete(claimId);
      }
      this.emitPruned(day, at, 'claims', claims.byCount, claims.byBytes, claims.countOver, claims.bytesOver, this.claims.size);
    }

    const beliefs = this.trimRecords(this.beliefs, this.config.libraryBudget.beliefs, (a, b) => {
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.learnedDay !== b.learnedDay) return b.learnedDay - a.learnedDay;
      if (a.holderId !== b.holderId) return a.holderId.localeCompare(b.holderId);
      return a.claimId.localeCompare(b.claimId);
    });
    if (beliefs.byCount + beliefs.byBytes > 0) {
      this.beliefs = beliefs.kept;
      this.reindexBeliefs();
      this.emitPruned(day, at, 'beliefs', beliefs.byCount, beliefs.byBytes, beliefs.countOver, beliefs.bytesOver, this.beliefs.length);
    }

    const cooldowns = this.trimRecords(this.cooldowns, this.config.libraryBudget.cooldowns, (a, b) => {
      if (a.atMs !== b.atMs) return b.atMs - a.atMs;
      if (a.pairKey !== b.pairKey) return a.pairKey.localeCompare(b.pairKey);
      return (a.claimId ?? '').localeCompare(b.claimId ?? '');
    });
    if (cooldowns.byCount + cooldowns.byBytes > 0) {
      this.cooldowns = cooldowns.kept;
      this.reindexCooldowns();
      this.emitPruned(day, at, 'cooldowns', cooldowns.byCount, cooldowns.byBytes, cooldowns.countOver, cooldowns.bytesOver, this.cooldowns.length);
    }

    const tells = this.trimRecords(this.tells, this.config.libraryBudget.tells, (a, b) => {
      if (a.day !== b.day) return b.day - a.day;
      if (a.from !== b.from) return a.from.localeCompare(b.from);
      return a.claimId.localeCompare(b.claimId);
    });
    if (tells.byCount + tells.byBytes > 0) {
      // `tells` 是 readonly 字段：就地换内容，不换数组本身。
      this.tells.length = 0;
      this.tells.push(...tells.kept);
      this.emitPruned(day, at, 'tells', tells.byCount, tells.byBytes, tells.countOver, tells.bytesOver, this.tells.length);
    }

    const written = this.trimRecords(this.written, this.config.libraryBudget.written, (a, b) => {
      if (a.writtenDay !== b.writtenDay) return b.writtenDay - a.writtenDay;
      return a.recordId.localeCompare(b.recordId);
    });
    if (written.byCount + written.byBytes > 0) {
      this.written = written.kept;
      this.emitPruned(day, at, 'written', written.byCount, written.byBytes, written.countOver, written.bytesOver, this.written.length);
    }

    // 传说先按「传得多远」留，同 reach 时**留更早立起来的**。
    // 原来是 `formedDay` 倒序（留最新），结果同一 reach 下世界最早的那批
    // 碑文先被裁掉——90 天里早期传说整批消失，"岁月感"就是从这里漏的。
    // 同 reach 意味着同样重要；同样重要时，越早的事越该留下。
    const legends = this.trimRecords(this.legends, this.config.libraryBudget.legends, (a, b) => {
      if (a.reach !== b.reach) return b.reach - a.reach;
      if (a.formedDay !== b.formedDay) return a.formedDay - b.formedDay;
      return a.legendId.localeCompare(b.legendId);
    });
    if (legends.byCount + legends.byBytes > 0) {
      this.legends = legends.kept;
      this.emitPruned(day, at, 'legends', legends.byCount, legends.byBytes, legends.countOver, legends.bytesOver, this.legends.length);
    }

    // 日摘要的淘汰顺序见 `digest.ts` 的 `digestRank`：开天前 30 天保底，
    // 其余按「有争执/异常/大事 → 有事 → 空白」排，同权留更近的。
    // 不按「最旧优先」——那正是 `legend` 改前犯过的错。
    const digests = this.trimRecords(
      this.digests,
      this.config.libraryBudget.digests,
      digestRank,
    );
    if (digests.byCount + digests.byBytes > 0) {
      this.digests = digests.kept.sort((a, b) => a.day - b.day);
      this.emitPruned(day, at, 'digests', digests.byCount, digests.byBytes, digests.countOver, digests.bytesOver, this.digests.length);
    }
  }

  /**
   * 一份记录按「条数 + 字节」裁到预算内。两个上限都先看，超了才排序——
   * 没超的时候连一次排序都不做，稳态下这是每库一次长度判断。
   */
  private trimRecords<T extends object>(
    items: readonly T[],
    budget: LayerBudget,
    rank: (a: T, b: T) => number,
  ): { kept: T[]; byCount: number; byBytes: number; countOver: number; bytesOver: number } {
    if (items.length === 0) {
      return { kept: [], byCount: 0, byBytes: 0, countOver: 0, bytesOver: 0 };
    }
    let total = 0;
    let overBytes = false;
    for (const item of items) {
      total += byteSizeOf(item);
      if (total > budget.bytes) {
        overBytes = true;
        break;
      }
    }
    const countOver = Math.max(0, items.length - budget.count);
    if (items.length <= budget.count && !overBytes) {
      return { kept: [...items], byCount: 0, byBytes: 0, countOver: 0, bytesOver: 0 };
    }
    const ranked = [...items].sort(rank);
    const kept: T[] = [];
    let bytes = 0;
    let countHit = false;
    for (const item of ranked) {
      if (kept.length >= budget.count) {
        countHit = true;
        break;
      }
      const size = byteSizeOf(item);
      if (bytes + size > budget.bytes) break;
      bytes += size;
      kept.push(item);
    }
    const evicted = items.length - kept.length;
    // 第二遍**忽略条数上限**，只看字节：答「如果条数不限，光字节会裁掉几条」。
    // 与 countOver 一起，两个数回答的是两个不同的问题，不再二选一。
    let bytesOnly = 0;
    let bytesOnlyKept = 0;
    for (const item of ranked) {
      const size = byteSizeOf(item);
      if (bytesOnly + size > budget.bytes) break;
      bytesOnly += size;
      bytesOnlyKept += 1;
    }
    const bytesOver = items.length - bytesOnlyKept;
    return {
      kept,
      byCount: countHit ? evicted : 0,
      byBytes: countHit ? 0 : evicted,
      countOver,
      bytesOver,
    };
  }

  /**
   * 「淘汰过什么」的可查痕迹。**每层每天至多一条**，带条数、字节、原因与剩余量。
   *
   * 为什么不只留一个计数：计数说「丢了 40 条」，但答不出「因为条数还是因为
   * 字节」「丢完之后那一层还剩多少」。这两个数决定下一步该调哪个旋钮——
   * 条数超了调 `count`，字节超了看条目为什么变大。
   */
  private emitPruned(
    day: number,
    at: number,
    layer: string,
    byCount: number,
    byBytes: number,
    countOver: number,
    bytesOver: number,
    remaining: number,
  ): void {
    this.emit('memory.pruned', at, {
      day,
      layer,
      evicted: byCount + byBytes,
      byCount,
      byBytes,
      countOver,
      bytesOver,
      reason: byCount > 0 ? 'count' : 'bytes',
      remaining,
    });
  }

  // ---------------------------------------------------------------- 删除

  /**
   * 删一个根，沿五条库一路清下去。
   *
   * 协议第 15 节第 1 条点名的派生物是五样：**记忆、摘要、信念副本、痕迹、
   * 传说**。原先这里只调了 `deleteCascade`，另外四样一样没碰，而
   * `counts.traces` / `counts.legends` 是**写死的 0**、`counts.claims` 是
   * `root.kind === 'claim' ? 1 : 0` 拍出来的——于是 `memory.deleted` 事件
   * 向外面汇报「清了两条记忆，别的一切正常」，而实际上别的一样没看。
   *
   * 实测（10 人村、一件全员目击的大事、跑 7 天）删完之后：
   * 11 条信念还挂着那个 `event_ref`（村里每人嘴里还当它真）、
   * 1 道焦痕还在（`lookAtTraces` 照旧从它推断出事故并写成新记忆）、
   * 1 条传说的 `eventRefs` 还指着它、`createClaimFrom` 对同一个事件
   * **照样成功**——删掉的事实在靠四条通道同时复活。
   *
   * 顺序有讲究：先摘记忆（`deleteCascade` 要读 `derivedFrom`），再清另外
   * 四库，最后拿掉事件根本身。事实一拿走，`createClaimFrom` 自己就返回
   * `null` 了——§15 末行「不得再次被整理写回」不用另立一道闸。
   */
  delete(root: DeletionRoot): DeletionReport {
    const cascaded = deleteCascade(this.entries, root);
    this.entries = [...cascaded.entries] as MemoryEntry[];

    const beliefs = cascadeBeliefs(this.beliefs, root);
    this.beliefs = [...beliefs.beliefs] as Belief[];
    // 整表换过：索引重建。级联不常发生，重建一次 O(信念) 与它自己的成本同量级。
    this.reindexBeliefs();

    // 痕迹按地点分库存。删一个事件只动它落过的那些地方，别处的 stack 不动。
    let tracesRemoved = 0;
    for (const [placeId, layers] of this.traces) {
      const next = cascadeTraces(layers, root);
      if (next.removed.length === 0) continue;
      tracesRemoved += next.removed.length;
      this.traces.set(placeId, [...next.layers]);
    }

    const legends = cascadeLegends(this.legends, root);
    this.legends = [...legends.legends] as Legend[];

    const claims = cascadeClaims([...this.claims.values()], root);
    for (const claimId of claims.removed) this.claims.delete(claimId);

    // 事件根才拿事实。记忆与断言被删时，别的事件还好好在那儿。
    if (root.kind === 'event') {
      this.facts.delete(root.id);
      // 摘要里那条拍子也要摘掉：删掉的事件不该借着日摘要复活。
      this.digests = this.digests
        .map((digest) => stripDigestEvent(digest, root.id))
        .filter((digest): digest is DayDigest => digest !== null);
    }

    const counts = {
      memories: cascaded.report.removedMemoryIds.length,
      summaries: cascaded.report.redactedMemoryIds.length,
      beliefs: beliefs.removed.length,
      claims: claims.removed.length,
      traces: tracesRemoved,
      legends: legends.removed.length + legends.stripped.length,
    };
    this.emit('memory.deleted', this.currentDay * this.config.dayMs, { rootId: root.id, counts });
    return { ...cascaded.report, counts };
  }

  // ------------------------------------------------------------ 内部件

  private resolveWitnesses(input: IngestInput): string[] {
    if (input.witnesses !== undefined) return [...input.witnesses];
    const grid = input.grid ?? this.grid;
    if (input.perceivers === undefined || grid === undefined) return [];
    return witnessesOf({
      place: input.place,
      perceivers: input.perceivers,
      grid,
      config: this.config,
    });
  }

  private makeEpisodic(
    holderId: string,
    fact: WorldFact,
    extra: { valence: number; arousal: number; salience: number; detailLevel: number },
  ): MemoryEntry {
    // 内容走 `contentForFact`，**不再在这里重抄一遍**。早先这两处各写一份
    // 同样的五字段字面量，于是给上游事件接上编译器的定性时只改一处——
    // 记忆条目换了说法，断言还是老说法，同一件事两个版本。
    let content: MemoryContent = {
      ...this.contentForFact(fact),
      detailLevel: extra.detailLevel,
      valence: extra.valence,
      arousal: extra.arousal,
    };
    // **可见性在这里落。** `writeModeOf` 写好很久了，但从来没有人调过它——
    // 于是 `private_to_player` 事件的明文（上游的文件名、密钥、邮件正文）
    // 原样落进记忆，而 `privacy.ts` 的文件头一直说它被处理了。
    //
    // 两档抽象化，**只降细节，不删条目**：
    //
    // - `sanitized`：`outcome` 进世界之前已经被 `compile()` 洗过（`harvest`、
    //   `retries`、`blessing` 这些是世界语汇），照用。它的问题只是「说得太细」，
    //   所以只压 `detailLevel`，不碰 `what`。
    // - `private_to_player`：`outcome` **没洗过**，一个字都不许取。用事件类型
    //   的先验句子顶上——「有人做了件事」是允许的，「他改了哪个文件」不是。
    //
    // 早先两档被我一视同仁地压成先验句子，`sanitized` 的语义就丢了：斥候带回来
    // 什么、炸了几次炉，本来都是脱敏后的世界事实，压掉等于白编译一遍。
    const mode = writeModeOf(fact, false);
    if (mode === 'abstracted') {
      content = {
        ...content,
        what:
          fact.visibility === 'private_to_player'
            ? (DEFAULT_WHAT[fact.kind] ?? '有人做了件事')
            : content.what,
        who: [],
        detailLevel: 1,
      };
    }
    const flashbulb = extra.salience >= this.config.T_flash;
    return {
      memoryId: this.nextId('m'),
      holderId,
      kind: 'episodic',
      tier: 'day',
      eventRefs: [fact.eventId],
      sourceMode: 'witnessed',
      sourceChain: [],
      content,
      salience: extra.salience,
      confidence: 1,
      strength: 1,
      createdDay: fact.day,
      lastRecalledDay: fact.day,
      recallCount: 0,
      flashbulb,
      pinned: false,
      redacted: false,
      derivedFrom: { memoryIds: [], claimIds: [] },
      generatedBy: this.ruleMeta(holderId, fact.eventId, fact.day),
      archived: false,
    };
  }

  /**
   * 听见的人写一条「听来的」记忆。
   *
   * 与目击者的差别是**算出来的，不是写死的**：细节 2（不是 3）、置信 0.6
   * （不是 1）、显著度固定 0.4——它不参与 `T_write` 那张表，因为听见本身就是
   * 一条比看见更弱的通道。约七分之一的条目会带一种偏差（`biasFor` 确定性选）。
   */
  private writeHeard(
    input: IngestInput,
    fact: WorldFact,
    witnesses: readonly string[],
    valence: number,
    arousal: number,
    written: string[],
  ): void {
    const seen = new Set(witnesses);
    for (const holderId of input.hearers ?? []) {
      if (seen.has(holderId)) continue;
      const holder = this.holders.get(holderId);
      if (holder === undefined || holder.type !== 'character') continue;
      seen.add(holderId);
      let content = {
        ...this.contentForFact(fact),
        detailLevel: 2,
        valence,
        arousal,
      };
      const bias = biasFor(fact.eventId, holderId);
      if (bias !== null) {
        const distorted = misremember(content, bias);
        content = distorted.content;
      }
      const entry: MemoryEntry = {
        memoryId: this.nextId('m'),
        holderId,
        kind: 'episodic',
        tier: 'day',
        eventRefs: [fact.eventId],
        sourceMode: 'heard',
        sourceChain: [`sound:${soundKindOf(fact.kind)}`],
        content,
        salience: 0.4,
        confidence: 0.6,
        strength: 1,
        createdDay: fact.day,
        lastRecalledDay: fact.day,
        recallCount: 0,
        flashbulb: false,
        pinned: false,
        redacted: false,
        derivedFrom: { memoryIds: [], claimIds: [] },
        generatedBy: this.ruleMeta(holderId, fact.eventId, fact.day),
        ...(bias === null ? {} : { bias }),
        archived: false,
      };
      this.entries.push(entry);
      written.push(entry.memoryId);
      this.emit('memory.written', input.at, {
        memoryId: entry.memoryId,
        holderId,
        eventRefs: entry.eventRefs,
        salience: entry.salience,
      });
    }
  }

  /**
   * 印象的生产者：目击者看别人干完一件事，写一条**关于那个人**的印象。
   *
   * 方向性靠 `holderId` 自己：`holderId` 是持有者，`aboutHolderId` 是他看的人。
   * A 看见 B 干活，只写 A 对 B 的印象；B 对 A 的印象要 B 自己看见才算。
   */
  addImpression(input: {
    readonly holderId: string;
    readonly aboutHolderId: string;
    readonly at: number;
    readonly placeId: string;
    readonly eventRef: string;
    readonly valence: number;
  }): string | null {
    const holder = this.holders.get(input.holderId);
    if (holder === undefined || holder.type !== 'character') return null;
    const day = Math.floor(input.at / this.config.dayMs);
    const entry: MemoryEntry = {
      memoryId: this.nextId('m'),
      holderId: input.holderId,
      kind: 'impression',
      tier: 'long',
      eventRefs: [input.eventRef],
      sourceMode: 'witnessed',
      sourceChain: [],
      content: {
        what: `我看见${input.aboutHolderId}把活干完了`,
        who: [input.aboutHolderId],
        where: input.placeId,
        when: input.at,
        detailLevel: 3,
        valence: input.valence,
        arousal: 0.3,
      },
      salience: 0.5,
      confidence: 1,
      strength: 1,
      createdDay: day,
      lastRecalledDay: day,
      recallCount: 0,
      flashbulb: false,
      pinned: false,
      redacted: false,
      derivedFrom: { memoryIds: [], claimIds: [] },
      generatedBy: this.ruleMeta(input.holderId, input.eventRef, day),
      archived: false,
    };
    this.entries.push(entry);
    this.emit('memory.written', input.at, {
      memoryId: entry.memoryId,
      holderId: input.holderId,
      eventRefs: entry.eventRefs,
      salience: entry.salience,
    });
    return entry.memoryId;
  }

  /**
   * 关系账本：A 看见 B 做了什么，只改 A→B。B→A 要 B 自己看见才算。
   * 负向事件同样走这条路，所以「变差」与「变好」是同一套阈值。
   */
  private updateBondsFromFact(fact: WorldFact, valence: number, day: number): void {
    // 只有够显著的事件才改关系账本。日常闲话（0.35）不写：
    // 否则三句闲话就能把两个人的信任抬起来，关系反而不值钱了。
    if ((fact.importanceHint ?? 0) < BOND_IMPORTANCE_FLOOR) return;
    const actors = new Set(fact.actors);
    for (const witness of fact.witnesses) {
      if (actors.has(witness)) continue;
      for (const actor of fact.actors) {
        this.bumpBond(witness, actor, valence, fact.eventId, day);
      }
    }
    // 谁受益，谁就欠当事人一次。没有这个字段就不编。
    const beneficiary = fact.outcome['beneficiaryId'];
    if (typeof beneficiary === 'string') {
      for (const actor of fact.actors) {
        if (actor === beneficiary) continue;
        this.bumpDebt(beneficiary, actor, 0.4, fact.eventId, day);
      }
    }
  }

  /**
   * 落一笔方向性关系增量。与 `bumpBond` 的区别只有一处：数由调用方给，
   * 不再按 valence 折算。`from` 是「谁对谁的关系」，所以 A→B 与 B→A
   * 是两条独立的账——街头小事要的正是这种不对称。
   *
   * 证据保留 `eventId`：面板上点开某一条时间线，能顺着它回到这条关系
   * 是被哪件事改的。
   */
  private applyBondDeltas(
    deltas: readonly BondDelta[],
    eventId: string,
    day: number,
  ): void {
    for (const delta of deltas) {
      const { from, to } = delta;
      if (from === to) continue;
      const a = this.holders.get(from);
      const b = this.holders.get(to);
      if (a === undefined || b === undefined || a.type !== 'character' || b.type !== 'character') continue;
      const current = this.bonds.get(this.bondKey(from, to));
      const evidence = current === undefined
        ? [eventId]
        : [eventId, ...current.evidence.filter((id) => id !== eventId)].slice(0, 8);
      this.bonds.set(this.bondKey(from, to), {
        from,
        to,
        trust: clampBond((current?.trust ?? 0) + delta.trust),
        warmth: clampBond((current?.warmth ?? 0) + delta.warmth),
        debt: clampBond((current?.debt ?? 0) + (delta.debt ?? 0)),
        familiarity: clamp01((current?.familiarity ?? 0) + 0.07),
        strength: clamp01((current?.strength ?? 0) + 0.05),
        confidence: Math.max(current?.confidence ?? 0, 0.9),
        evidence,
        updatedDay: day,
      });
      this.refreshRelation(from, to);
    }
  }

  /**
   * 结算当天的日常照面。每对每天至多一次，证据指向当天那一条街头事件。
   *
   * 只认 `street_greet / street_yield / street_together`——它们是「见过」
   * 这一档，不是「出过事」那一档。已经有积怨（warmth < 0）的一对不靠
   * 天天见面自动和好：那得靠 0.4 以上的事件。
   */
  private accrueDailyAcquaintance(closedDay: number): void {
    const seen = new Set<string>();
    for (const fact of this.facts.values()) {
      if (fact.day !== closedDay || !ACQUAINTANCE_KINDS.has(fact.kind)) continue;
      const pair = this.characterPair(fact.actors);
      if (pair === null) continue;
      const key = pairKey(pair[0], pair[1]);
      if (seen.has(key)) continue;
      seen.add(key);
      this.touchAcquaintance(pair[0], pair[1], closedDay, fact.eventId);
      this.touchAcquaintance(pair[1], pair[0], closedDay, fact.eventId);
    }
  }

  private characterPair(actors: readonly string[]): readonly [string, string] | null {
    const characters = actors.filter((id) => this.holders.get(id)?.type === 'character');
    if (characters.length < 2) return null;
    return [characters[0]!, characters[1]!];
  }

  private touchAcquaintance(from: string, to: string, day: number, eventId: string): void {
    if (from === to) return;
    const key = this.bondKey(from, to);
    const current = this.bonds.get(key);
    // 负 warmth 是「有过节」，不是「不熟」；日常照面不能把它抹平。
    if (current !== undefined && current.warmth < 0) return;
    const familiarity = clamp01(
      (current?.familiarity ?? 0) +
        (ACQUAINTANCE_FAMILIARITY_CEIL - (current?.familiarity ?? 0)) * ACQUAINTANCE_FAMILIARITY_STEP,
    );
    const warmth = clampBond(
      (current?.warmth ?? 0) +
        (ACQUAINTANCE_WARMTH_CEIL - (current?.warmth ?? 0)) * ACQUAINTANCE_WARMTH_STEP,
    );
    const evidence = [eventId, ...(current?.evidence ?? []).filter((id) => id !== eventId)].slice(0, 8);
    this.bonds.set(key, {
      from,
      to,
      trust: current?.trust ?? 0,
      warmth,
      debt: current?.debt ?? 0,
      familiarity,
      strength: clamp01(Math.max(familiarity, Math.abs(current?.trust ?? 0), Math.abs(warmth))),
      confidence: current?.confidence ?? 0.6,
      evidence,
      updatedDay: day,
    });
    this.refreshRelation(from, to);
  }

  /**
   * 日终把关系读数往 0 收：与记忆强度同一条 `decayRate`（0.15/天），
   * 所以 `-0.22` 的 trust 会按 -0.187、-0.159、-0.135… 一路回到阈值内。
   *
   * 只衰减 `trust` 与 `warmth`：`debt` 是「欠了一次」的事实，不该被忘掉；
   * `evidence` 与 `updatedDay` 原样保留，面板仍能顺着它回到那件事。
   * 当天写过的不衰减，见 `dayClosed`。
   */
  private decayBonds(closedDay: number): void {
    const factor = 1 - this.config.decayRate;
    for (const [key, bond] of this.bonds) {
      if (bond.updatedDay >= closedDay) continue;
      const trust = Math.abs(bond.trust) < 0.01 ? 0 : bond.trust * factor;
      const warmth = Math.abs(bond.warmth) < 0.01 ? 0 : bond.warmth * factor;
      this.bonds.set(key, { ...bond, trust, warmth });
      this.refreshRelation(bond.from, bond.to);
    }
  }

  private bumpBond(from: string, to: string, valence: number, eventId: string, day: number): void {
    if (from === to) return;
    const a = this.holders.get(from);
    const b = this.holders.get(to);
    if (a === undefined || b === undefined || a.type !== 'character' || b.type !== 'character') return;
    const current = this.bonds.get(this.bondKey(from, to));
    const trust = clampBond((current?.trust ?? 0) + valence * 0.12);
    const warmth = clampBond((current?.warmth ?? 0) + valence * 0.28);
    const familiarity = clamp01((current?.familiarity ?? 0) + 0.04);
    const strength = clamp01((current?.strength ?? 0) + 0.03);
    const evidence = current === undefined
      ? [eventId]
      : [eventId, ...current.evidence.filter((id) => id !== eventId)].slice(0, 8);
    this.bonds.set(this.bondKey(from, to), {
      from,
      to,
      trust,
      warmth,
      debt: current?.debt ?? 0,
      familiarity,
      strength,
      confidence: 0.8,
      evidence,
      updatedDay: day,
    });
    this.refreshRelation(from, to);
  }

  private bumpDebt(from: string, to: string, delta: number, eventId: string, day: number): void {
    if (from === to) return;
    const current = this.bonds.get(this.bondKey(from, to));
    this.bonds.set(this.bondKey(from, to), {
      from,
      to,
      trust: current?.trust ?? 0,
      warmth: current?.warmth ?? 0,
      debt: clampBond((current?.debt ?? 0) + delta),
      familiarity: clamp01((current?.familiarity ?? 0) + 0.04),
      strength: clamp01((current?.strength ?? 0) + 0.03),
      confidence: current?.confidence ?? 0.8,
      evidence: current === undefined
        ? [eventId]
        : [eventId, ...current.evidence.filter((id) => id !== eventId)].slice(0, 8),
      updatedDay: day,
    });
    this.refreshRelation(from, to);
  }

  /** 传播层要的是无向的信任与强度；这里只做一层适配，不另存一份关系。 */
  private refreshRelation(a: string, b: string): void {
    const ab = this.bonds.get(this.bondKey(a, b));
    const ba = this.bonds.get(this.bondKey(b, a));
    if (ab === undefined && ba === undefined) return;
    const trust = ab === undefined
      ? (ba?.trust ?? 0)
      : ba === undefined ? ab.trust : (ab.trust + ba.trust) / 2;
    const strength = Math.max(ab?.strength ?? 0, ba?.strength ?? 0);
    this.relations.set(pairKey(a, b), { from: a, to: b, trust, strength });
  }

  private bondKey(from: string, to: string): string {
    return `${from}\u0000${to}`;
  }

  bondOf(from: string, to: string): Bond | null {
    return this.bonds.get(this.bondKey(from, to)) ?? null;
  }

  /**
   * 一条事实的**公共三件套**：落点、当事人、当时那句话；外加当天的时刻。
   *
   * 只给这几样，不给 `witnesses`——那是「谁也看见了」，属于别人。
   * 个人时间线要用它把「我记住的那条」补上「在哪、和谁」，但单位没有
   * 权利知道镇上谁还旁听了同一件事。
   *
   * `tick` 是**当天已经走过的毫秒数**（`at - day * dayMs`）。记忆条目的
   * `content.when` 存的是第几天，拿它当时刻会一律显示成 `00:00`；面板要
   * 「第几天 + 几点」两样都真，时刻只能回到事实本身来取。
   */
  factDigest(eventId: string): {
    readonly placeId: string;
    readonly actors: readonly string[];
    readonly what: string;
    readonly day: number;
    /** 事件发生的时刻（ms）。日摘要只存拍序不存时刻，这一项给它兜底排序。 */
    readonly tick: number;
  } | null {
    const fact = this.facts.get(eventId);
    if (fact === undefined) return null;
    return {
      placeId: fact.placeId,
      actors: [...fact.actors],
      what: this.whatOf(fact),
      day: fact.day,
      tick: fact.tick,
    };
  }

  /** 某天的日摘要。那天没有被压过就返回 `null`——「没有记录」不是「无事发生」。 */
  dayDigestOf(day: number): DayDigest | null {
    return this.digests.find((digest) => digest.day === day) ?? null;
  }

  /** 全部日摘要（按天升序，只读给审计与面板）。 */
  dayDigests(): readonly DayDigest[] {
    return [...this.digests];
  }

  /**
   * 某个人在某天的压后时间轴。**摘要只为「条目已被裁掉的那一天」兜底**：
   * 近档仍以条目为准（调用方先读条目，空了再来这里）。
   */
  digestTimelineFor(
    holderId: string,
    day: number,
  ): readonly { readonly eventId: string; readonly kind: string; readonly placeId: string | null }[] {
    const digest = this.dayDigestOf(day);
    return digest === null ? [] : digestTimelineOf(digest, holderId);
  }

  /** 这个人的方向性关系（只含 from=他自己）。只读副本，按 to 排序。 */
  bondsOf(holderId: string): readonly Bond[] {
    return [...this.bonds.values()]
      .filter((bond) => bond.from === holderId)
      .sort((a, b) => a.to.localeCompare(b.to))
      .map((bond) => ({ ...bond, evidence: [...bond.evidence] }));
  }

  /** 读取时的情绪：从最近一次日终衰减到 `at`，不写下任何东西。 */
  moodOf(holderId: string, at: number): Mood | null {
    const mood = this.moods.get(holderId);
    if (mood === undefined) return null;
    return decayedMood(mood, at, this.config.dayMs);
  }

  /** 面板只读：规则模板拼出的内心话，不写公开 bubble。 */
  innerVoiceOf(holderId: string, at: number): { readonly templateId: string; readonly text: string } | null {
    const holder = this.holders.get(holderId);
    if (holder === undefined || holder.type !== 'character') return null;
    const mood = this.moodOf(holderId, at) ?? {
      holderId,
      valence: 0,
      arousal: 0.2,
      label: moodLabel(0, 0.2),
      because: [],
      updatedAt: at,
      halfLifeDays: MOOD_HALF_LIFE_DAYS,
    };
    return composeInnerVoice(
      holderId,
      mood,
      this.entries.filter((entry) => entry.holderId === holderId),
      this.bondsOf(holderId),
    );
  }

  /** 日终更新：当天记忆合成目标值，旧情绪先按半衰期衰减。 */
  updateMoods(day: number, at: number): void {
    for (const holderId of this.holderIds()) {
      const holder = this.holders.get(holderId);
      if (holder === undefined || holder.type !== 'character') continue;
      this.moods.set(holderId, nextMood(
        this.moods.get(holderId),
        this.entries,
        holderId,
        day,
        at,
        this.config.dayMs,
      ));
    }
  }

  /** 检索关系项：这条记忆提到的人里，我有多在意他们。 */
  relationshipFor(holderId: string, entry: MemoryEntry): number {
    const who = entry.content.who.filter((id) => id !== holderId);
    if (who.length === 0) return 0;
    let sum = 0;
    for (const id of who) {
      const bond = this.bonds.get(this.bondKey(holderId, id));
      if (bond !== undefined) sum += (bond.warmth + bond.trust) / 2;
    }
    return Math.max(0, sum / who.length);
  }

  private depositTraces(fact: WorldFact, at: number, placeType: string, valence: number): void {
    const existing = this.traces.get(fact.placeId) ?? [];
    // 「这一类事在这个地点重复过几次」——数**事件**，不是数已有的痕迹层数。
    //
    // 原来这里数的是 `existing.length`（这个地点已经有几道痕迹）。那样写，
    // `worn_path` 的门槛就成了一句空话：它要求先有三层**别的**痕迹才轮得到
    // 自己，而灯潮界一天到晚只有 `routine_done`，一条痕迹都不产——那道门
    // 永远打不开，`trace.added` 在跑着的世界里一次都没发过。
    //
    // 扫 `this.facts` 而不另立计数器：事实会被隐私级联删掉（`deleteCascade`
    // 里的 `this.facts.delete`），计数器会跟它漂移，扫描不会。代价是每次
    // ingest 扫一遍事实库——8 个世界日 382 条，量级可忽略；真跑到上百天
    // 该换成按 `placeId\u0000kind` 建的索引，那时这里会先慢下来。
    let recurrence = 0;
    for (const prior of this.facts.values()) {
      if (prior.eventId === fact.eventId) continue;
      if (prior.placeId !== fact.placeId || prior.kind !== fact.kind) continue;
      recurrence += 1;
    }
    const specs = consequenceOf({
      eventId: fact.eventId,
      kind: fact.kind,
      placeId: fact.placeId,
      placeType,
      intensity: Math.min(1, Math.abs(valence) + 0.2),
      day: fact.day,
      recurrence,
    });
    if (specs.length === 0) return;
    let next = [...existing];
    for (const spec of specs) {
      const trace = makeTrace(this.nextId('trace'), {
        eventId: fact.eventId,
        kind: fact.kind,
        placeId: fact.placeId,
        placeType,
        intensity: spec.intensity,
        day: fact.day,
        recurrence,
      }, spec);
      // 同类痕迹合并：同一地点同一层只留最新一条，强度取高者。
      const sameLayer = next.findIndex((item) => item.layerType === spec.layerType);
      if (sameLayer >= 0) {
        const previous = next[sameLayer]!;
        next[sameLayer] = { ...trace, intensity: Math.max(previous.intensity, trace.intensity) };
      } else {
        next.push(trace);
      }
      this.emit('trace.added', at, { traceId: trace.traceId, placeId: trace.placeId, layerType: trace.layerType });
    }
    this.traces.set(fact.placeId, fitTraceLayers(next, this.config.placeTraceLayers));
  }

  // -------------------------------------------------------------- 地标

  /**
   * 一块地的阶段推进。**规则全在 `landmark.ts`**，这里只管查找与落库。
   *
   * 查找顺序：先按实例 id 找（同一个 id 的记录），再按地块找（重建换了 id）。
   * 两者都没有就是第一次听说这块地。
   */
  private applyLandmark(
    fact: WorldFact,
    event: LandmarkEvent,
    at: number,
    anchor: { readonly x: number; readonly y: number },
  ): void {
    const byPlace = this.landmarkByPlace.get(fact.placeId);
    const claimed = byPlace === undefined ? undefined : this.landmarks.get(byPlace);
    const byPlot = this.landmarks.get(plotKeyOf(event));
    const existing = claimed ?? byPlot;
    // 落点用事件给的坐标（门口），不是 origin：废墟画在人看得见的那一格。

    if (event.change === 'built') {
      if (existing === undefined) {
        this.storeLandmark(landmarkBuilt(fact.placeId, event, fact.day, at, fact.eventId));
        return;
      }
      // 已经站着的同一块地再报一次「落成」，不是第二次建——忽略，不往历史里塞重复项。
      if (isStanding(existing.current)) return;
      this.storeLandmark(landmarkRebuilt(existing, fact.placeId, event, fact.day, at, fact.eventId));
      return;
    }

    if (existing === undefined) {
      this.storeLandmark(
        landmarkWithoutHistory(
          fact.placeId,
          event,
          event.displayName,
          fact.day,
          at,
          fact.eventId,
          anchor,
        ),
      );
      return;
    }
    this.storeLandmark(landmarkDemolished(existing, fact.day, at, fact.eventId, anchor));
  }

  /** 落库：两个索引一起写。键取地块（重建前后不变）。 */
  private storeLandmark(landmark: Landmark): void {
    this.landmarks.set(landmark.plotKey, landmark);
    for (const placeId of landmark.aliases) this.landmarkByPlace.set(placeId, landmark.plotKey);
    this.landmarkByPlace.set(landmark.placeId, landmark.plotKey);
  }

  /** 一个地点属于哪块地（按任一历史 id 都查得到）。 */
  landmarkOf(placeId: string): Landmark | null {
    const plotKey = this.landmarkByPlace.get(placeId);
    if (plotKey === undefined) return null;
    const landmark = this.landmarks.get(plotKey);
    return landmark === undefined ? null : cloneLandmark(landmark);
  }

  landmarksOf(): readonly Landmark[] {
    return [...this.landmarks.values()].map(cloneLandmark).sort((a, b) => a.plotKey.localeCompare(b.plotKey));
  }

  /**
   * 日终：拆掉很久仍没有重建的地，变成废墟。
   *
   * 每条地标只看 O(1)；地标以「块」计，不随天数增长到成千上万——一座镇子
   * 几十栋到头，这一趟在关账里可以忽略。**不扫事实库。**
   */
  private advanceLandmarks(day: number, at: number): void {
    for (const [plotKey, landmark] of this.landmarks) {
      if (!shouldRuine(landmark, day, this.config.ruinAfterDays)) continue;
      const last = landmark.phases[landmark.phases.length - 1]!;
      this.landmarks.set(plotKey, landmarkRuined(landmark, day, at, last.causeEventRef));
    }
  }

  // -------------------------------------------------------------- 时代

  /**
   * 把今天记进当前时代，必要时切段。
   *
   * 成本：数一遍楼、加一遍传说 reach、数一遍人物。都是「块/条」级，不是
   * 「天」级；400 天时它们不会变成几千条扫描（传说会，但那是加法，
   * 一条 30B 的循环，不是深比较）。**这一趟不序列化任何东西。**
   */
  private recordEra(day: number, vitals: WorldVitals): void {
    let buildingCount = 0;
    let ruinCount = 0;
    for (const landmark of this.landmarks.values()) {
      if (isStanding(landmark.current)) buildingCount += 1;
      else ruinCount += 1;
    }
    let legendReachSum = 0;
    for (const legend of this.legends) legendReachSum += legend.reach;
    const signature = signatureOf({
      day,
      vitals,
      buildingCount,
      ruinCount,
      legendReachSum,
      population: this.characterCount(),
    });

    if (this.eras.length === 0) {
      this.eras.push(openEra(this.nextId('era'), signature));
      return;
    }
    const current = this.eras[this.eras.length - 1]!;
    if (current.toDay !== null) {
      // 当前段已经关了（读到一份中间态存档时才会出现）：开一段新的，不回头改历史。
      this.eras.push(openEra(this.nextId('era'), signature));
      return;
    }
    const { closed, open } = advanceEra(
      current,
      signature,
      this.config,
      () => this.nextId('era'),
      (fromDay, toDay) => this.definingEvents(fromDay, toDay),
    );
    if (closed === null) {
      this.eras[this.eras.length - 1] = open;
      return;
    }
    this.eras[this.eras.length - 1] = closed;
    this.eras.push(open);
  }

  /** 一段时代里最重的几件事：够重 + 至少三个人看见，取前 3。 */
  private definingEvents(fromDay: number, toDay: number): readonly string[] {
    const picked: { readonly eventId: string; readonly weight: number; readonly day: number }[] = [];
    for (const fact of this.facts.values()) {
      if (fact.day < fromDay || fact.day > toDay) continue;
      if ((fact.importanceHint ?? 0) < this.config.epicImportanceFloor) continue;
      if (fact.witnesses.length < 3) continue;
      picked.push({ eventId: fact.eventId, weight: fact.importanceHint ?? 0, day: fact.day });
    }
    picked.sort((a, b) => b.weight - a.weight || a.day - b.day || (a.eventId < b.eventId ? -1 : 1));
    return picked.slice(0, 3).map((item) => item.eventId);
  }

  erasOf(): readonly Era[] {
    return this.eras.map((era) => ({
      ...era,
      startSignature: { ...era.startSignature },
      lastSignature: { ...era.lastSignature },
      definingEventRefs: [...era.definingEventRefs],
    }));
  }

  epicsOf(): readonly EpicEntry[] {
    return this.epics.map(cloneEpic);
  }

  /** 会说话的那几个（人物）——时代与史诗的「人口」口径。 */
  characterCount(): number {
    let count = 0;
    for (const holder of this.holders.values()) {
      if (holder.type === 'character') count += 1;
    }
    return count;
  }

  turningPointsOf(holderId: string): readonly TurningPoint[] {
    return this.turningPoints
      .filter((point) => point.holderId === holderId)
      .map((point) => ({ ...point, eventRefs: [...point.eventRefs] as unknown as [string, ...string[]] }));
  }

  private deliver(
    from: string,
    to: string,
    claim: Claim,
    verdict: Verdict,
    at: number,
  ): boolean {
    if (this.beliefOf(to, claim.claimId) !== undefined) return false;
    const state = verdict === 'verify' ? 'suspicious' : 'held';
    this.addBelief(to, claim, from, state, at);
    this.rememberTold(to, claim, from, at);
    this.tells.push({ day: this.currentDay, from, to, claimId: claim.claimId });
    // 逐话题冷却（同一对单位、同一条断言）在这里记。闲聊冷却由
    // `diffuseDay` 在整场交谈结束时记——它记的是「聊过」这件事，不是某一条。
    this.appendCooldown({ pairKey: pairKey(from, to), claimId: claim.claimId, atMs: at });
    this.emit('claim.told', at, {
      claimId: claim.claimId,
      from,
      to,
      hop: claim.hop,
      detailLevel: claim.content.detailLevel,
      verdict,
    });

    if (verdict === 'verify') this.planVerification(to, claim, at);
    return true;
  }

  private addBelief(
    holderId: string,
    claim: Claim,
    sourceHolderId: string,
    state: Belief['state'],
    at: number,
  ): Belief {
    // 形状由 `beliefFrom` 定，不在这儿另写一遍。它的注释说「存疑信念与采信
    // 的区别只在 state 与日程上，形状是同一个」——那句话只有真的共用同一个
    // 构造器才作数；两边各写一份字面量的话，「同一个形状」只是个愿望。
    const belief = beliefFrom(holderId, claim, sourceHolderId, Math.floor(at / this.config.dayMs), state);
    this.setBelief(belief);
    this.emit('belief.updated', at, { holderId, claimId: claim.claimId, state });
    return belief;
  }

  /** `holderId + claimId` 的组合键。索引、判重、定位全用它。 */
  private beliefKey(holderId: string, claimId: string): string {
    return `${holderId}\u0000${claimId}`;
  }

  /** 记一条冷却：数组是真相，索引跟着走。 */
  private appendCooldown(item: CooldownState): void {
    this.cooldowns.push(item);
    appendTo(this.cooldownsByPair, item.pairKey, item);
  }

  /** 这一对单位自己的冷却。没有就返回空数组（不还一个新数组，免得每次分配）。 */
  private cooldowsFor(pair: string): readonly CooldownState[] {
    return this.cooldownsByPair.get(pair) ?? EMPTY_COOLDOWNS;
  }

  private reindexCooldowns(): void {
    this.cooldownsByPair.clear();
    for (const item of this.cooldowns) appendTo(this.cooldownsByPair, item.pairKey, item);
  }

  /**
   * 写一条信念。**同键替换，不同键追加**——与原来「先滤掉同键再拼一条」
   * 的结果逐字节相同，但只动一个位置，不再重排整张表。
   */
  private setBelief(belief: Belief): void {
    const key = this.beliefKey(belief.holderId, belief.claimId);
    const position = this.beliefPositions.get(key);
    if (position === undefined) {
      this.beliefPositions.set(key, this.beliefs.length);
      this.beliefs.push(belief);
      appendTo(this.beliefsByHolder, belief.holderId, belief);
      appendTo(this.beliefsByClaim, belief.claimId, belief);
      this.indexBeliefEvents(belief);
      return;
    }
    const previous = this.beliefs[position]!;
    this.beliefs[position] = belief;
    replaceIn(this.beliefsByHolder, belief.holderId, previous, belief);
    replaceIn(this.beliefsByClaim, belief.claimId, previous, belief);
    this.deindexBeliefEvents(previous);
    this.indexBeliefEvents(belief);
  }

  private indexBeliefEvents(belief: Belief): void {
    let byEvent = this.beliefsByHolderEvent.get(belief.holderId);
    if (byEvent === undefined) {
      byEvent = new Map();
      this.beliefsByHolderEvent.set(belief.holderId, byEvent);
    }
    for (const eventRef of belief.eventRefs) appendTo(byEvent, eventRef, belief);
  }

  private deindexBeliefEvents(belief: Belief): void {
    const byEvent = this.beliefsByHolderEvent.get(belief.holderId);
    if (byEvent === undefined) return;
    for (const eventRef of belief.eventRefs) removeFrom(byEvent, eventRef, belief);
  }

  /**
   * 这个人关于这几件事知道些什么（给 `spreadStep` 的 `existingOf`）。
   *
   * **只返回相关的那些**，不是他的全部信念：`judge` 要找的是「同事件的相反
   * 记忆」，同事件之外的信念它一条都不看。返回的是 `ListenerBelief`，
   * 与 `judge` 的入参同一个形状——两处不各建一份。
   */
  private listenerViewsFor(holderId: string, eventRefs: readonly string[]): readonly ListenerBelief[] {
    const byEvent = this.beliefsByHolderEvent.get(holderId);
    if (byEvent === undefined) return EMPTY_VIEWS;
    const seen = new Set<string>();
    const out: ListenerBelief[] = [];
    for (const eventRef of eventRefs) {
      const list = byEvent.get(eventRef);
      if (list === undefined) continue;
      for (const belief of list) {
        if (seen.has(belief.claimId)) continue;
        seen.add(belief.claimId);
        const view = asListenerBelief(belief, this.claims.get(belief.claimId));
        if (view !== null) out.push(view);
      }
    }
    return out;
  }

  /** 一个单位手上有哪些信念。**只读视图**，调用方别改元素。 */
  private beliefsOf(holderId: string): readonly Belief[] {
    return this.beliefsByHolder.get(holderId) ?? [];
  }

  /** 一条断言此刻被哪些人持有着。 */
  private beliefsOfClaim(claimId: string): readonly Belief[] {
    return this.beliefsByClaim.get(claimId) ?? [];
  }

  /** 这个人是不是已经有这条信念了。`deliver` 的判重走这里，不再扫全表。 */
  private beliefOf(holderId: string, claimId: string): Belief | undefined {
    const position = this.beliefPositions.get(this.beliefKey(holderId, claimId));
    return position === undefined ? undefined : this.beliefs[position];
  }

  /**
   * 整张信念表被换掉之后重建索引（读档、隐私级联、求证之外的整体替换）。
   *
   * **不做增量修补**：那几处本来就整表重写，重建一次 O(信念) 与它们自己
   * 的成本同一量级；而增量修补一旦漏一处，索引就会和真相漂移，
   * 而漂移的表现是「同一个人听了两遍同一句话」——静默的。
   */
  private reindexBeliefs(): void {
    this.beliefsByHolder.clear();
    this.beliefsByClaim.clear();
    this.beliefPositions.clear();
    this.beliefsByHolderEvent.clear();
    for (let index = 0; index < this.beliefs.length; index += 1) {
      const belief = this.beliefs[index]!;
      this.beliefPositions.set(this.beliefKey(belief.holderId, belief.claimId), index);
      appendTo(this.beliefsByHolder, belief.holderId, belief);
      appendTo(this.beliefsByClaim, belief.claimId, belief);
      this.indexBeliefEvents(belief);
    }
  }

  /**
   * 听说一件事，就记下它——`source_mode = heard` 的条目在这里诞生。
   *
   * 协议第 6 节末行：「听说类记忆走传播协议：单位收到 `ClaimTold` 并更新信念后，
   * 生成 source_mode = heard 的条目。」而 `deliver` 原先只写一条 `Belief`。
   * 实测：一条事故在 10 人的村里传到第 7 个人，7 个人都「知道」这件事，
   * **只有目击者本人有一条记忆**，另外 6 个人的记忆库是空的。
   *
   * 后果不止「记不住」这么轻。补充设计 §1.1 的求证闭环第 1 步是「单位收到
   * `ClaimTold`（准备生成 heard 记忆）时，检索自身记忆库中是否存在相同
   * `event_refs` 或同地点同日的高置信度记忆」——`checkConflict` 读的正是这个
   * 单位的记忆条目。heard 条目从来不存在，于是冲突检测只能拿目击者自己的
   * 记忆去比对，「听来的说法和我亲眼看见的不一样」这条触发路径一次都没走过。
   *
   * 显著度走目击者那条同一条路（`inputsFor` → `decideWrite`），阈值也是同一个
   * `T_write`：世界只有一个写入门槛，没有两个。`involvement` 天然偏低——
   * 他不是当事人，`inputsFor` 按 `actors` 判，用不着为传闻另立一个数。
   * 于是同一件事亲历者记得比听说者牢，而这道差是算出来的，不是写死的。
   * 过不了门槛的传闻照旧变成信念（他听说了），只是不落成记忆。
   */
  private rememberTold(holderId: string, claim: Claim, from: string, at: number): void {
    const holder = this.holders.get(holderId);
    if (holder === undefined || holder.type !== 'character') return;
    const eventRef = claim.eventRefs[0];
    if (eventRef === undefined) return;
    const fact = this.facts.get(eventRef);
    if (fact === undefined) return;

    const parts = inputsFor({
      kind: fact.kind,
      holderId,
      actors: fact.actors,
      importanceHint: fact.importanceHint,
      valence: claim.content.valence,
      arousal: claim.content.arousal,
    });
    const weights = weightsFor(this.config.salienceWeights, holder.profile, this.config.salienceBias);
    const decision = decideWrite(weights, parts, this.config.T_write);
    if (!decision.write) return;

    const day = Math.floor(at / this.config.dayMs);
    const entry: MemoryEntry = {
      memoryId: this.nextId('m'),
      holderId,
      kind: 'episodic',
      tier: 'day',
      eventRefs: claim.eventRefs,
      sourceMode: 'heard',
      sourceChain: this.toldChainOf(from, claim, eventRef),
      content: {
        what: claim.content.what,
        who: claim.content.who,
        where: claim.content.where,
        when: claim.content.when,
        // 细节照断言上的来：`retell` 每跳降一级，三跳的传闻进来就是 0 级。
        // 这里不再压一次——压两次就成了「传闻永远说不清」，而保真度曲线
        // 要的是跳数与细节一一对应。
        detailLevel: claim.content.detailLevel,
        valence: claim.content.valence,
        arousal: claim.content.arousal,
      },
      salience: decision.salience.salience,
      // 可信度照断言上的来，不再乘一次信任。说话人可不可信已经算进断言的
      // `confidence` 里了（`hopConfidenceFactor` 逐跳打折），在这儿再打一次
      // 就是把同一个因素算两遍。
      confidence: claim.confidence,
      strength: 1,
      createdDay: day,
      lastRecalledDay: day,
      recallCount: 0,
      flashbulb: decision.salience.salience >= this.config.T_flash,
      pinned: false,
      redacted: false,
      // 这条记忆是断言的副本，删断言时它该跟着走（`matchesRoot` 查的正是它）。
      derivedFrom: { memoryIds: [], claimIds: [claim.claimId] },
      generatedBy: this.ruleMeta(holderId, eventRef, day),
      archived: false,
    };
    this.entries.push(entry);
    this.emit('memory.written', at, {
      memoryId: entry.memoryId,
      holderId,
      eventRefs: entry.eventRefs,
      salience: entry.salience,
    });
  }

  /**
   * 这一条听来的记忆，来源链长什么样。
   *
   * 协议第 4 节只要求「claim_id 与前手 holder_id」——最少是 `[claimId, from]`。
   * 而 `types.ts` 上那句「谁告诉我的，他又是听谁的」要的是整条链。
   *
   * 链**不从断言上取**。`Claim.sourceChain` 那条链只有诞生那一节：`retell`
   * 只加 `hop` 不加链节，拿它拼出来的链三跳之后还是一个名字。断言是全村
   * 共享的，链挂在它上就长不起来（`types.ts` 上那段说清了为什么）。
   *
   * 从**人**上取：说话人对同一件事也有一条听来的记忆，把他的链接在我前面，
   * 我排在最后。于是一跳是 `[claim, 讲的人]`，三跳是 `[claim, 甲, 乙, 讲的人]`
   * ——每多一跳链条真长一节，这才叫「他又是听谁的」。领头的 claimId 在每一级
   * 都重写一次，所以拼之前先把说话人那条的前头去掉。
   */
  private toldChainOf(from: string, claim: Claim, eventRef: string): readonly string[] {
    const speaker =
      this.entries.find(
        (entry) =>
          entry.holderId === from && entry.eventRefs.includes(eventRef) && entry.sourceMode === 'heard',
      ) ??
      this.entries.find((entry) => entry.holderId === from && entry.eventRefs.includes(eventRef));
    const upstream = speaker === undefined ? [] : speaker.sourceChain.slice(1);
    return [claim.claimId, ...upstream, from];
  }

  /**
   * 求证冲动过线时插一条日程。
   *
   * 这一步同时做冲突检测（补充设计 §1.1 第 1 步）——它需要这个单位的**全部**
   * 记忆，所以只能在这里做，不能在传播层做（那一层只认断言）。
   */
  private planVerification(holderId: string, claim: Claim, at: number): void {
    const check = checkConflict({
      claim,
      memories: this.entries.filter((entry) => entry.holderId === holderId),
      speakerTrust: trustBetween(this.relations, holderId, claim.originHolderId),
      day: Math.floor(at / this.config.dayMs),
      config: this.config,
    });
    const plan = planVerify(holderId, check, claim, this.announcements.length > 0);
    if (plan === null) return;
    this.verifyPlans.set(holderId, [...(this.verifyPlans.get(holderId) ?? []), plan]);
  }

  /**
   * 把刚关账的那一天压成一条日摘要（SOAK-BUG-5）。
   *
   * 位置在整理之后、预算之前：整理已经把当天的片段收拢，预算还没裁掉任何
   * 旧日片段，此时压出来的 `beats` 才等于「当天应有条数」。
   *
   * 三档浓度：每天先按全量写；**天龄超 `DIGEST_FULL_DAYS` 的旧摘要当场压缩**
   * （清地点表与异常原句，事件只留 id + kind）。压缩是幂等的，重复关账不会
   * 把同一天压两遍。
   */
  private writeDayDigest(day: number): void {
    const digest = buildDayDigest(day, this.entries, this.facts);
    if (digest === null) return;
    // 每天至多一条：同一天重写时替换，不追加。
    this.digests = this.digests.filter((item) => item.day !== day);
    this.digests.push(digest);
    this.digests.sort((a, b) => a.day - b.day);
    this.digests = this.digests.map((item) =>
      shouldCompact(item, day) ? compactDayDigest(item) : item,
    );
  }

  /**
   * 日终写日记。协议第 7 节把日记列为整理的**表现产物**之一——
   * 一个世界过了一天，该有人把今天的事记下来。
   *
   * 为什么放在整理之后：日记收的是 `sourceMode === 'witnessed'` 的当日片段，
   * 而整理会把没被挑中的片段降一级细节。写日记要在整理之后，记下的才是
   * 「他今天记住的样子」，不是「他今天经历的样子」——后者是事件日志的事。
   *
   * 为什么不是每个人都写：`writeDiary` 只收亲历的条目，一天什么都没亲历的
   * 人写不出日记，返回 `null`。这不是缺陷，是这个世界该有的样子——
   * 不是每天每个人都有值得写下来的事。
   */
  private writeDailies(day: number, at: number): void {
    for (const holderId of this.holderIds()) {
      const holder = this.holders.get(holderId);
      if (holder === undefined || holder.type !== 'character') continue;
      const record = writeDiary({
        recordId: this.nextId('diary'),
        authorId: holderId,
        entries: this.entries,
        day,
        placeId: holder.at === undefined ? '' : `at_${holder.at.x}_${holder.at.y}`,
        config: this.config,
      });
      if (record === null) continue;
      this.written = [...this.written, record];
      this.emit('diary.written', at, {
        recordId: record.recordId,
        kind: record.kind,
        authorId: record.authorId,
        recipientId: null,
        claimIds: record.claims.map((claim) => claim.claimId),
      });
    }
  }

  /**
   * 日终日报：把今天最重大的一件事贴到公告栏，让够得着的人读到。
   *
   * 五类通道里的**广播**在这之前没有生产方：`postAnnouncement` 与
   * `readAnnouncement` 在测试之外一个调用方都没有，`announcementReach`
   * 只被它自己读。于是「官方渠道」这句话在跑着的世界里是假的——而
   * `latency_ratio` 那条指标（公告 ≤ 0.5 天 vs 传言 1.5–2.5 天）少了一半。
   *
   * 补充设计 §3.2 的定稿表把发布权留给三方：玩家（神明）、村长（Planner）、
   * **系统日终日报**。前两方都不在本组边界内——神明的入口是
   * `ingestUpstream`，Planner 属于造物主/导演那一节。所以这里只做第三方，
   * 而它恰好是唯一不需要任何生成逻辑的那一方：日报贴什么，是**从已经发生
   * 的事情里挑**，不是编一件新的。
   *
   * 挑法：今天诞生的断言里，取其起源者写下那条记忆的显著度最高的一条。
   * 显著度是这个世界自己的注意力，不是谁的偏好。同分按 claimId 取先——
   * 同一份存档跑两遍，贴上去的是同一张。
   */
  private postDailyReport(day: number, at: number): void {
    const claim = this.reportClaimOf(day);
    if (claim === null) return;
    // 公告栏得有地方站。地点 Holder 不在名册里（或没有落点）就没有广播——
    // 世界不能假装那儿立着一块板子。
    const board = this.holders.get(claim.content.where)?.at;
    if (board === undefined) return;

    const announcement: Announcement = {
      announcementId: this.nextId('notice'),
      claim,
      postedDay: day,
      placeId: claim.content.where,
      // 日报没有「人」作者。写 'system' 而不是某个村民：今天最重大的事
      // 不见得是村长经历的，而公告的可信度来自渠道，不来自发言人。
      poster: 'system',
    };
    if (!this.postAnnouncement(announcement)) return;

    // 读到的人才算被触达。范围 4 格，不看遮挡——公告栏立在明处。
    // 没有位置的人不在听众里：不知道他在哪，就不能假装他路过了一块板子。
    const listeners = this.holderIds()
      .filter((holderId) => this.holders.get(holderId)?.type === 'character')
      .map((holderId) => ({ holderId, at: this.holders.get(holderId)!.at }))
      .filter((listener): listener is { holderId: string; at: { x: number; y: number } } => listener.at !== undefined)
      .map((listener) => ({ holderId: listener.holderId, distance: distance(board, listener.at) }));
    for (const holderId of announcementReach(listeners, this.config)) {
      this.readAnnouncement(holderId, announcement.announcementId, at);
    }
  }

  /** 今天最值得贴上公告栏的那条断言。没有就返回 `null`——安静的一天没有新闻。 */
  private reportClaimOf(day: number): Claim | null {
    let best: { claim: Claim; salience: number } | null = null;
    for (const claim of [...this.claims.values()].sort()) {
      if (claim.createdDay !== day) continue;
      const entry = this.entries.find(
        (item) =>
          item.holderId === claim.originHolderId &&
          item.eventRefs.some((ref) => claim.eventRefs.includes(ref)),
      );
      if (entry === undefined) continue;
      if (best === null || entry.salience > best.salience) best = { claim, salience: entry.salience };
    }
    return best?.claim ?? null;
  }

  /**
   * 这条传说今天被讲给了几个人听。
   *
   * 按「今天新落地的信念」数，不按某一条通道数：交谈、公告、书信、
   * 痕迹推断都是「有人知道了」，而传说分不出也不该分他是从哪知道的。
   * 按人去重——同一天从两个渠道听说，只算一次「今天有人讲」。
   *
   * 这里数的是**昨天之后**新增的听众，所以一条刚形成的传说（reach 已经
   * 等于持有者数）不会在同一天又被自己喂一次。
   */
  private toldToday(legend: Legend, day: number): number {
    const holders = new Set<string>();
    for (const belief of this.beliefs) {
      if (belief.learnedDay !== day) continue;
      if (!belief.eventRefs.some((ref) => legend.eventRefs.includes(ref))) continue;
      holders.add(belief.holderId);
    }
    return holders.size;
  }

  /**
   * 日终风化：每道痕迹按自己的层掉一天可见度。
   *
   * 协议第 11 节：「风化只降低可见度，不删除记录。」所以这里**从不删**，
   * 连 `visibility` 归零的也留着——它只是不再出现在 `exposedTraces` 里，
   * 但 `eventRef` 还在，地点 Holder 还追得到「这里发生过什么」。
   *
   * **当天新落的痕迹不风化。** 中午炸的炉子，第二天早上路过的人该看见
   * 完整的焦痕。少了这个判断，痕迹落地当天的日终就先掉一天——一条
   * `garland`（0.30/天）会在它被看见之前就短了一截，而「今天刚办过庆典」
   * 正是它唯一想说的那句话。
   */
  private weatherTraces(day: number): void {
    for (const [placeId, traces] of this.traces) {
      const weathered = traces.map((trace) => (trace.createdDay >= day ? trace : weatherTrace(trace)));
      this.traces.set(placeId, weathered);
    }
  }

  private updateLegends(day: number, at: number): void {
    // **先补后削，淡去的不补。** 「靠传播维持」四个字在这里落地：今天有几个人
    // 听说，活着的传说 reach 就加几个；一整天没人讲，才掉 1。
    //
    // 少了补这一句，`reinforceLegend` 一个调用方都没有，而传说只淡不长。
    // 实测：一条 reach=7 的传说此后每天准掉 1（7,6,5,4,3,2），到 1 淡去，
    // 然后**当天就从信念库里重新形成一条 reach=7 的**，再掉 6 天。于是
    // `legend.formed` 每 6 天响一次，永远响下去——那不是集体记忆的生死，
    // 那是一台节拍器，而「无人讲则淡去」这句话一次都没应验过。
    //
    // 而**淡去的传说不删**：`faded` 就是 `reach <= 1`，`decayLegend` 又把
    // reach 夹在 0，所以淡去这件事写在记录自己身上，不需要另立一个 flag。
    // 删掉它，下面那段 Formation 当天就看见同样的信念、当场再造一条一模一样的
    // （除了 id）。留着它，它继续占着这个事件——这才是「淡去不是删除」。
    this.legends = this.legends.map((legend) =>
      faded(legend) ? legend : reinforceLegend(legend, this.toldToday(legend, day)),
    );
    this.legends = this.legends.map(decayLegend);
    const candidates = candidatesFrom(this.beliefs, this.claims);
    const fresh = candidates.filter(
      (candidate) => qualifies(candidate, day, this.config) && !this.alreadyTold(candidate),
    );
    for (const candidate of this.formable(fresh)) {
      const legend = formLegend(this.nextId('legend'), candidate, day);
      this.legends.push(legend);
      // 载荷补全到「外面那一层能直接用」的形状：`WorldChange` 那条 `legend`
      // 要的是碑上那句话、落点、几个人在讲、哪一天。传出去的是
      // `{legendId, eventRefs}` 时，场景那一侧只能回头再读一遍 `legendsOf()`
      // 按 id 对齐，于是 `text` 在两处各算一次——而 `variants.join('；')`
      // 这行代码有两份，迟早会分叉。
      this.emit('legend.formed', at, {
        legendId: legend.legendId,
        text: candidate.variants.join('；'),
        placeId: legend.homePlaceId,
        reach: legend.reach,
        day: legend.formedDay,
      });
      this.inscribe(legend, candidate, at);
      this.maybeRename(legend, candidate, at);
      // 史诗分级：同一条传说再加一层可计算的度量。判档不碰任何随机数，
      // 也不看「今天讲了多少」——同一份存档跑两遍得到同一批条目。
      const epic = makeEpic(this.nextId('epic'), legend, {
        factOf: (eventRef) => this.facts.get(eventRef),
        population: this.characterCount(),
        formedDay: day,
      }, this.config);
      if (epic !== null) this.epics.push(epic);
    }
  }

  /**
   * 这块碑立起来的时候，这个地点该不该换个名字（协议 §11）。
   *
   * 判据在 `toponym.ts`（查表 + 门槛），这里只负责**何时问**与**记住**：
   *
   *   - 只在一条传说立起来时问——改名总得有个由头，而碑就是这个由头；
   *   - 一个地点**只改一次**（`history.length === 0`）。改两次的历史链读起来
   *     就是世界说话不算数：昨天叫「账房·立事」，今天叫「账房·立事·张灯」，
   *     而两次之间没有任何一件事能解释名字为什么又长了一截；
   *   - 不知道它原来叫什么就不改——「无名·立事」不是名字。
   *
   * 取并集里**最重**那件事的 kind，与 `formable()` 判大事同一个口径：
   * 一块碑里并着几件闲话与一件里程碑时，说的是那件里程碑。
   */
  private maybeRename(legend: Legend, candidate: LegendCandidate, at: number): void {
    const entry = this.placeNames.get(legend.homePlaceId);
    if (entry === undefined) return;
    if (entry.history.length > 0) return;

    let heaviest: { ref: string; kind: string; weight: number } | null = null;
    for (const eventRef of candidate.eventRefs) {
      const fact = this.facts.get(eventRef);
      if (fact === undefined) continue;
      const weight = fact.importanceHint ?? 0;
      if (heaviest === null || weight > heaviest.weight) {
        heaviest = { ref: eventRef, kind: fact.kind, weight };
      }
    }
    if (heaviest === null) return;

    const epithet = epithetFor(heaviest.kind, heaviest.weight, this.config.renameImportanceFloor);
    if (epithet === null) return;

    const old = entry.name;
    const next = renamed(old, epithet);
    entry.history.push({ name: next, fromEventRef: heaviest.ref, day: legend.formedDay });
    entry.name = next;
    // 「改」这一阶段：改名是今天唯一能观察到的地标改动。楼还是那栋楼，
    // 名字变了——这段历史要落在同一块地上，不是另起一条。
    const landmark = this.landmarkByPlace.get(legend.homePlaceId);
    const current = landmark === undefined ? undefined : this.landmarks.get(landmark);
    if (current !== undefined) {
      this.storeLandmark(landmarkAltered(current, next, legend.formedDay, at, heaviest.ref));
    }
    this.emit('toponym.changed', at, {
      placeId: legend.homePlaceId,
      old,
      new: next,
      eventRef: heaviest.ref,
    });
  }

  /**
   * 这件事是不是已经有传说了——淡去的也算。
   *
   * 原来是「`eventRefs` 拼出来的 key 与某条传说完全相同」。归并之后那条传说
   * 手里攥着一组事件，而候选仍然一件一件地来，两个 key 再也不会相等，于是
   * 每天都会把同一批闲话重新立一遍（它们每天都还够格）。所以改成「它引用的
   * **任何一个**事件已经在某条传说里」。
   *
   * 这两种写法在归并之前是同一句话：候选按 `eventRefs` 的集合归并，
   * 一个事件只属于一个候选，所以「整组相等」与「有交集」等价。放宽之后它
   * 还多守住一件事——一条被并进去的闲话不会因为它的同伴进了碑就被落单。
   */
  private alreadyTold(candidate: LegendCandidate): boolean {
    return this.legends.some((legend) =>
      candidate.eventRefs.some((ref) => legend.eventRefs.includes(ref)),
    );
  }

  /**
   * 今天该立哪几条：大事各立各的，闲话同日同地并成一条。
   *
   * 裁决是「大事优先，闲话同日同地兜底」：
   *
   *   - `maxImportance >= legendImportanceFloor` 的候选是大事，一条一块碑；
   *   - 够不着门槛的是闲话，**同一天同一个地点**的并成一块——但那个地点那天
   *     若有大事，闲话今天不立（大事已经替那个地点说过话了）。不立不是丢：
   *     信念还在，明天那个地点没有大事时它们照样会被并进去。
   *
   * 门槛为什么落在这一层而不在 `qualifies()`：`qualifies` 判的是「反复讲述」，
   * 门槛判的是「是不是大事」。塞进 `qualifies` 会让「不够格」与「不够重」
   * 变成同一句话，而它们该有不同的出路——前者继续等，后者并进邻座的碑。
   *
   * 实测（`.tmp-audit/legend-census.ts`，8 个世界日）：35 条传说的
   * `max(importanceHint)` 一律 0.35，全在门槛之下，所以这条路径今天是**唯一**
   * 在出碑的路径；门槛以上的分支（`task_done` 0.45）在灯潮界还没出现过。
   * 2026-11-01 修完痕迹（地标 Holder 落地）同一口径重测是 28 条，hint 分布不变
   * （仍是 `routine_done` 一种），所以这条路径照旧是唯一的那条。
   */
  private formable(fresh: readonly LegendCandidate[]): LegendCandidate[] {
    const importanceOf = (eventRef: string): number =>
      this.facts.get(eventRef)?.importanceHint ?? 0;
    const big: LegendCandidate[] = [];
    const chatter: LegendCandidate[] = [];
    for (const candidate of fresh) {
      if (maxImportance(candidate, importanceOf) >= this.config.legendImportanceFloor) {
        big.push(candidate);
      } else {
        chatter.push(candidate);
      }
    }
    // 大事优先：同一天同一个地点有大事，那天的闲话今天不立。
    const bigPlaces = new Set(big.map((candidate) => candidate.homePlaceId));
    const merged = mergeByPlace(
      chatter.filter((candidate) => !bigPlaces.has(candidate.homePlaceId)),
      importanceOf,
    );
    return [...big, ...merged];
  }

  /**
   * 传说立起来的那一刻，给它涉及的每个人刻一条 `legend` 层的记忆。
   *
   * `MemoryTier` 一直列着 `'legend'`，`tierFactor.legend = 0.05`、
   * `limitFor('legend') = Infinity` 也早就配好了——**而没有任何一处写出过
   * 这个层的条目**。于是「淡去不是删除，它降到 legend 层之后衰减系数只有
   * 0.05，能撑很久」这句话的后半截在代码里是空的：碑文从来没有被刻过，
   * 那两个数一次都没用过。
   *
   * 下游全是现成的：`consolidateHolder` 按 `tierFactor[entry.tier]` 衰减，
   * `trimBudget` 对 legend 层不设上限。缺的只是**谁写第一笔**。
   *
   * 只写给形成时持有它的那几个人。后来才听说的人照旧只有一条普通信念——
   * 碑文是世界对这件事的记录，不是每个人各自的一份。
   */
  private inscribe(legend: Legend, candidate: LegendCandidate, at: number): void {
    for (const holderId of candidate.holders) {
      const entry: MemoryEntry = {
        memoryId: this.nextId('m'),
        holderId,
        kind: 'episodic',
        tier: 'legend',
        eventRefs: legend.eventRefs,
        // 碑文的来历是「大家都这么说」，不是某一个人告诉我的。
        sourceMode: 'heard',
        sourceChain: [],
        content: {
          // 几种讲法都刻上：传说的价值恰在于同一件事有几种说法。
          what: candidate.variants.join('；'),
          who: [],
          where: legend.homePlaceId,
          when: legend.formedDay,
          detailLevel: 3,
          valence: candidate.valence,
          arousal: candidate.arousal,
        },
        salience: 1,
        confidence: 1,
        strength: 1,
        createdDay: legend.formedDay,
        lastRecalledDay: legend.formedDay,
        recallCount: 0,
        flashbulb: false,
        // **不钉**。钉住会让 `consolidateHolder` 把它整个跳过衰减
        // （`exempt = flashbulb || pinned`），于是 `tierFactor.legend = 0.05`
        // 这个数又成了没人用的摆设——「衰减系数只有 0.05，能撑很久」的
        // 后半截再次落空。碑文该慢，不该停：0.15 × 0.05 = 每天掉 0.75%，
        // 一百天后还剩一半，这才是「撑很久」。
        pinned: false,
        redacted: false,
        derivedFrom: { memoryIds: [], claimIds: [] },
        generatedBy: this.ruleMeta(holderId, 'legend', legend.formedDay),
        archived: false,
      };
      this.entries.push(entry);
      this.emit('memory.written', at, {
        memoryId: entry.memoryId,
        holderId,
        eventRefs: entry.eventRefs,
        salience: entry.salience,
        tier: 'legend',
      });
    }
  }

  /**
   * 这个人此刻够不够得着那个地点的痕迹。
   *
   * 地点 Holder 永远够得着自己（它就是那个地点）。人物要走到 `traceRadius` 以内。
   * 位置缺失的单位**够不着**——不是禁足，是「不知道他在哪」，而世界不能
   * 假装他从那儿路过。
   *
   * **地点那一侧读 `placeAnchors`，不读 Holder。** 楼拆掉之后 Holder 被摘，
   * 痕迹还在原地；从 Holder 上读坐标的话，那一刻起再没有人够得着那道废墟。
   */
  private withinTraceReach(holderId: string, placeId: string): boolean {
    const holder = this.holders.get(holderId);
    if (holder === undefined) return false;
    if (holder.type === 'place') return holder.holderId === placeId;
    const from = holder.at;
    const to = this.placeAnchors.get(placeId);
    if (from === undefined || to === undefined) return false;
    return Math.hypot(from.x - to.x, from.y - to.y) <= this.config.traceRadius;
  }

  /**
   * 记下这一刻谁和谁挨得够近。行为层每拍调一次，日终再补一次。
   *
   * 只留这一对今天最近的那一次距离：`canTell` 还要拿它跟 `talkDistance` 比
   * 一次，只记「见过」不带距离，等于把那道闸的输入抽掉。用平方比大小是为了
   * 省掉每拍每对的 `Math.hypot`——这一支在跑着的世界里每帧都被调一次，
   * 而真正要开方记下来的只有已经够近的那几对。
   */
  sampleEncounters(): void {
    const ids = this.holderIds();
    const limit = this.config.talkDistance * this.config.talkDistance;
    for (let i = 0; i < ids.length; i += 1) {
      const a = this.holders.get(ids[i]!)?.at;
      if (a === undefined) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = this.holders.get(ids[j]!)?.at;
        if (b === undefined) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const squared = dx * dx + dy * dy;
        if (squared > limit) continue;
        const distance = Math.sqrt(squared);
        const key = pairKey(ids[i]!, ids[j]!);
        const seen = this.metToday.get(key);
        if (seen === undefined || distance < seen) this.metToday.set(key, distance);
      }
    }
  }

  /**
   * 这个人可能说给谁听：**今天照过面的人**。
   *
   * 距离是照面时最近的那一次，不是此刻的。没有这一条，候选表就是全连接图，
   * 而 `talkDistance = 2` 那道闸永远咬不到任何人——全村一天之内全知，正是
   * 护栏 sheet 第一行警告的那件事。
   *
   * 今天没照过面的单位**不参与**传播。它们不是被禁言，是「今天没碰上」——
   * 而世界不能假装他们说过话。位置缺失的单位自然也不在表里，调用方接上
   * 位置之后它们自然回来。
   */
  private spreadCandidates(speaker: string, ids: readonly string[] = this.holderIds()): SpreadCandidate[] {
    // **楼不说话。** 协议 §3 把两种 Holder 记的东西分得很清：人记「亲历与听说
    // 的事」，地点记「在此发生过的事，按空间沉积」（痕迹）。一栋楼把听来的话
    // 再讲给路过的人，不是这个世界该有的样子。
    //
    // 这句话在这里一直是**注释**，不是闸：`test/memory-spread.test.ts` 里
    // 那句「楼不参与 claim.told——它不说话」只对孤立度统计成立，传播路径上
    // 没人拦。实测（8 个世界日、7 人 9 楼 + 22 地标）：拆掉这道闸，村民信念
    // 从 330 条涨到 591 条，其中 261 条（44%）的前手是楼——面板上会读成
    // 「从一个不在这张图上的人听来」。闸在，是 0 条。
    //
    // 地点仍然**听**（`deliver` 照旧给它写信念、照旧算进传说的 reach）：
    // 那是覆盖率曲线与传说条数的分母，动它要重算一整组文档里的数。
    const speakerHolder = this.holders.get(speaker);
    if (speakerHolder === undefined || speakerHolder.type !== 'character') return [];
    const out: SpreadCandidate[] = [];
    for (const listener of ids) {
      if (listener === speaker) continue;
      const distance = this.metToday.get(pairKey(speaker, listener));
      if (distance === undefined) continue;
      out.push({ speaker, listener, distance });
    }
    return out;
  }

  private talkativeness(): ReadonlyMap<string, number> {
    const map = new Map<string, number>();
    for (const [id, holder] of this.holders) {
      map.set(id, holder.profile.talkativeness ?? 0.5);
    }
    return map;
  }

  private bumpFanout(holderId: string, claimId: string, day: number): void {
    if (this.fanout.day !== day) this.fanout = { day, counts: new Map() };
    const counts = new Map(this.fanout.counts);
    const key = fanoutKey(holderId, claimId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    this.fanout = { day, counts };
  }

  private whatOf(fact: WorldFact): string {
    const what = fact.outcome['what'];
    if (typeof what === 'string' && what !== '') return what;
    return fact.voice?.what ?? DEFAULT_WHAT[fact.kind] ?? fact.kind;
  }

  private contentForFact(fact: WorldFact): MemoryContent {
    return {
      what: this.whatOf(fact),
      who: [...fact.actors],
      where: fact.placeId,
      when: fact.day,
      detailLevel: fact.voice?.detailLevel ?? 3,
      valence: fact.voice?.valence ?? defaultValence(fact.kind),
      arousal: fact.voice?.arousal ?? defaultArousal(fact.kind),
    };
  }

  /**
   * 一道痕迹推断出来的记忆，效价该取多少。
   *
   * `INFERENCE_TABLE` 里 inscription 那条写着「碑文继承原事件的效价，由调用方
   * 在生成记忆时覆盖」——而这句话一直没有调用方认领：这里原样用了表里的
   * `valence: 0`，于是**每一道碑文在记忆里都是不带情绪的**。
   *
   * 后果不只是「读起来平淡」。效价 0 的记忆通不过 `judge` 的冲突检测
   * （`belief.valence * claim.content.valence < 0`，乘 0 永远是 0），也产不出
   * 求证冲动（`|valence_new − valence_old|` 有一边恒为 0）。一道记着庆典的
   * 碑文与一道记着事故的碑文，在村民记忆里因此长得一模一样——而碑文恰是
   * 唯一一种 `confidence 0.9` 的高保真痕迹，它本该是情绪最清楚的那条。
   *
   * 走 `contentForFact` 的同一条推导（`voice ?? defaultValence(kind)`），
   * 不在这里另抄一份：读碑文的人与当场目击的人，对同一件事的情绪必须对得上。
   *
   * 只改效价，不改唤醒度——表里那句要求说的就是效价，顺手把 arousal 也继承了
   * 属于替规范加需求。事件已经不在了（痕迹还在、事实被关账收走）时退回表里的值。
   */
  private traceValence(trace: Trace, spec: InferenceSpec): number {
    if (spec.sourceMode !== 'read') return spec.valence;
    const fact = this.facts.get(trace.eventRef);
    return fact === undefined ? spec.valence : this.contentForFact(fact).valence;
  }

  private ruleMeta(holderId: string, opId: string, day: number): MemoryEntry['generatedBy'] {
    const seed = seedOf(this.worldId, day, holderId, opId);
    return { by: 'rule', rulesetVersion: RULESET_VERSION, inputHash: String(seed), seed };
  }

  private nextId(prefix: string): string {
    const id = `${prefix}_${String(this.nextSerial).padStart(4, '0')}`;
    this.nextSerial += 1;
    return id;
  }

  private nextEventId(prefix: string): string {
    return `${prefix}_${String(this.nextSerial).padStart(4, '0')}`;
  }

  // ---------------------------------------------------------------- 存档

  /**
   * 把全部可变状态摊成一份可 JSON 化的快照。
   *
   * 只读、不改变任何东西；返回的数组元素是内部对象的引用，调用方应当立刻
   * `JSON.stringify` 掉（`MemoryRuntime.toJSON()` 就是这么做的）。
   */
  toSnapshot(): MemoryWorldSnapshot {
    return {
      holders: [...this.holders.values()],
      facts: [...this.facts.values()],
      entries: [...this.entries],
      claims: [...this.claims.values()],
      beliefs: [...this.beliefs],
      traces: [...this.traces.entries()].map(([placeId, entries]) => ({
        placeId,
        entries: [...entries],
      })),
      placeAnchors: [...this.placeAnchors.entries()].map(([placeId, at]) => ({
        placeId,
        at: { x: at.x, y: at.y },
      })),
      landmarks: [...this.landmarks.values()],
      eras: [...this.eras],
      epics: [...this.epics],
      turningPoints: [...this.turningPoints],
      bonds: [...this.bonds.values()],
      moods: [...this.moods.values()],
      legends: [...this.legends],
      digests: [...this.digests],
      placeNames: [...this.placeNames.entries()].map(([placeId, toponym]) => ({
        placeId,
        name: toponym.name,
        history: [...toponym.history],
      })),
      announcements: [...this.announcements],
      tells: [...this.tells],
      written: [...this.written],
      cooldowns: [...this.cooldowns],
      fanout: { day: this.fanout.day, counts: [...this.fanout.counts.entries()] },
      verifyPlans: [...this.verifyPlans.entries()].map(([holderId, plans]) => ({
        holderId,
        plans: [...plans],
      })),
      credibility: [...this.credibility.scores.entries()],
      nextSerial: this.nextSerial,
      currentDay: this.currentDay,
      metToday: [...this.metToday.entries()],
    };
  }

  /**
   * 用一份快照覆盖当前状态。**不是合并**：先清空再填，读档后的库与存档时一致。
   *
   * 不做校验——形状校验在 `MemoryRuntime.fromJSON()` 那一层；到这里已经是
   * 通过校验的数据。dep 字段（config / relations / grid / emit / worldId）不动。
   */
  restoreSnapshot(snapshot: MemoryWorldSnapshot): void {
    this.holders.clear();
    for (const holder of snapshot.holders) this.holders.set(holder.holderId, holder);

    this.facts.clear();
    for (const fact of snapshot.facts) this.facts.set(fact.eventId, fact);

    this.entries = [...snapshot.entries];

    this.claims.clear();
    for (const claim of snapshot.claims) this.claims.set(claim.claimId, claim);

    this.beliefs = [...snapshot.beliefs];
    this.reindexBeliefs();

    this.traces.clear();
    for (const entry of snapshot.traces) this.traces.set(entry.placeId, [...entry.entries]);

    this.placeAnchors.clear();
    for (const entry of snapshot.placeAnchors ?? []) {
      this.placeAnchors.set(entry.placeId, { x: entry.at.x, y: entry.at.y });
    }
    // 老档（v1）没有这一段：地点坐标只能从名册里的地点 Holder 补回来。
    // 补回来的东西就是那一刻真实存在的坐标，不是编的。
    if (this.placeAnchors.size === 0) {
      for (const holder of snapshot.holders) {
        if (holder.type !== 'place' || holder.at === undefined) continue;
        this.placeAnchors.set(holder.holderId, { x: holder.at.x, y: holder.at.y });
      }
    }

    this.landmarks.clear();
    this.landmarkByPlace.clear();
    for (const landmark of snapshot.landmarks ?? []) {
      this.landmarks.set(landmark.plotKey, landmark);
      for (const placeId of landmark.aliases) this.landmarkByPlace.set(placeId, landmark.plotKey);
      this.landmarkByPlace.set(landmark.placeId, landmark.plotKey);
    }
    this.eras = [...(snapshot.eras ?? [])];
    this.epics = [...(snapshot.epics ?? [])];
    this.turningPoints = [...(snapshot.turningPoints ?? [])];

    this.bonds.clear();
    for (const bond of snapshot.bonds ?? []) {
      this.bonds.set(this.bondKey(bond.from, bond.to), { ...bond, evidence: [...bond.evidence] });
      this.refreshRelation(bond.from, bond.to);
    }
    this.moods.clear();
    for (const mood of snapshot.moods ?? []) this.moods.set(mood.holderId, { ...mood, because: [...mood.because] });

    this.legends = [...snapshot.legends];
    // v4 及更早的档没有日摘要这一段。空就是事实：那段历史没压过，不拿条目倒推。
    this.digests = [...(snapshot.digests ?? [])];

    this.placeNames.clear();
    for (const entry of snapshot.placeNames) {
      this.placeNames.set(entry.placeId, { name: entry.name, history: [...entry.history] });
    }

    this.announcements = [...snapshot.announcements];
    // `tells` 是 readonly 引用，只能原地替换内容。
    this.tells.splice(0, this.tells.length, ...snapshot.tells);
    this.written = [...snapshot.written];
    this.cooldowns = [...snapshot.cooldowns];
    this.reindexCooldowns();
    this.fanout = { day: snapshot.fanout.day, counts: new Map(snapshot.fanout.counts) };

    this.verifyPlans.clear();
    for (const entry of snapshot.verifyPlans) {
      this.verifyPlans.set(entry.holderId, [...entry.plans]);
    }

    this.credibility = { scores: new Map(snapshot.credibility) };
    this.nextSerial = snapshot.nextSerial;
    this.currentDay = snapshot.currentDay;
    this.metToday = new Map(snapshot.metToday);
  }

  private emit(kind: MemoryEvent['kind'], at: number, payload: Readonly<Record<string, unknown>>): void {
    this.emitFn?.({ kind, at, payload });
  }
}

const RULESET_VERSION = 'memory-r1';
/** 低于这个显著度的事件不改关系账本；日常闲话不算“关系事件”。 */
const BOND_IMPORTANCE_FLOOR = 0.4;
/** 「这一对没有冷却」的共享空数组：日终会给每个候选问一次，不每次都分配。 */
const EMPTY_COOLDOWNS: readonly CooldownState[] = [];
/** 「这个人关于这件事什么也不知道」的共享空数组，同上。 */
const EMPTY_VIEWS: readonly ListenerBelief[] = [];
/** 日终不再铺全表之后，`spreadStep` 的 `beliefs` 参数拿到的空表。 */
const EMPTY_BELIEF_VIEWS: ReadonlyMap<string, readonly ListenerBelief[]> = new Map();

/** 从桶里按引用删掉一条。桶空了就整个摘掉，免得日复一日堆空桶。 */
function removeFrom<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) return;
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  if (list.length === 0) map.delete(key);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampBond(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** 往 `Map<K, V[]>` 的一个桶里追加。桶不存在时建一个。 */
function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
    return;
  }
  list.push(value);
}

/** 桶里替换一个旧对象（按引用找位置）。找不到就追加，宁多不少。 */
function replaceIn<K, V>(map: Map<K, V[]>, key: K, previous: V, next: V): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [next]);
    return;
  }
  const index = list.indexOf(previous);
  if (index >= 0) list[index] = next;
  else list.push(next);
}

/** 深拷贝一份地标：对外只给副本，读的人改不动世界里的那一份。 */
function cloneLandmark(landmark: Landmark): Landmark {
  return {
    ...landmark,
    aliases: [...landmark.aliases],
    anchor: { x: landmark.anchor.x, y: landmark.anchor.y },
    footprint: landmark.footprint === null ? null : { ...landmark.footprint },
    phases: landmark.phases.map((item) => ({ ...item })),
  };
}

function cloneEpic(epic: EpicEntry): EpicEntry {
  return {
    ...epic,
    eventRefs: [...epic.eventRefs] as unknown as [string, ...string[]],
    variants: [...epic.variants],
    criteria: { ...epic.criteria },
  };
}

/** 事实里没有 `what` 时，按 kind 给一句。只用于世界侧自己发的事件。 */
const DEFAULT_WHAT: Readonly<Record<string, string>> = {
  task_done: '有人交了一单活',
  celebration: '有人庆祝了一件事',
  conflict: '有人起了争执',
  milestone: '达成了一个里程碑',
  workshop_accident: '工坊里出了事故',
  expedition_done: '有人从外面回来了',
  oracle_prayer: '有人在祭坛祈祷',
  discipline: '有人被训诫了',
  visitor_arrival: '有生人进了村',
  weather_anomaly: '天气反常',
  tavern_feast: '酒馆里摆了宴',
  // 世界自己的节律。正常路径上这两句用不到——`observe.ts` 把世界组织好的
  // 那句话写进了 `what`。留着是为了别的入口（上游、造物主）报这两种事时
  // 也有话说，而不是把 kind 本身当句子印出来。
  tide_turn: '潮水掉头了',
  routine_done: '有人在镇子上停了一会儿',
  harbor_report: '渡口报了船班',
};

function defaultValence(kind: string): number {
  if (kind === 'celebration' || kind === 'tavern_feast') return 0.8;
  if (kind === 'workshop_accident' || kind === 'conflict') return -0.7;
  if (kind === 'discipline') return -0.6;
  if (kind === 'task_done' || kind === 'expedition_done') return 0.3;
  return 0;
}

function defaultArousal(kind: string): number {
  if (kind === 'workshop_accident' || kind === 'conflict') return 0.8;
  if (kind === 'weather_anomaly' || kind === 'visitor_arrival') return 0.7;
  if (kind === 'celebration' || kind === 'tavern_feast') return 0.6;
  return 0.3;
}

/**
 * 一对单位的规范键**只有一份**，在 `propagate.ts` 的 `pairKey`。
 *
 * 这里原来另写了一个逐字相同的 `pairOf`。关系表与冷却表查的是同一个键，
 * 各写一份就会各自漂移——哪天其中一份换了分隔符，另一份毫不知情，
 * 于是「昨天聊过」与「关系很近」从此对不上。
 */

/**
 * 一条断言在第 `hop` 跳时的样子。
 *
 * 逐跳 retell 而不是一次算到底：`retell` 每次都要记 `distortedBy`，
 * 一次算到底只能记一条「跳了 3 跳」，而验收要的是**每一次变形都记录**。
 */
function claimAtHop(origin: Claim, hop: number, config: MemoryConfig): Claim {
  let current = origin;
  for (let index = 0; index < hop; index += 1) current = retell(current, config);
  return current;
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    eventRefs: [...entry.eventRefs] as unknown as MemoryEntry['eventRefs'],
    sourceChain: [...entry.sourceChain],
    content: { ...entry.content, who: [...entry.content.who] },
    derivedFrom: { ...entry.derivedFrom },
    generatedBy: { ...entry.generatedBy },
  };
}

/** 未被使用的类型出口，留给任务组 B 与将来的 UI。 */
export type { MemoryTier };
