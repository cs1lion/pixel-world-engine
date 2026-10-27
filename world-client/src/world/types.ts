/** 世界数据模型。这一层不依赖 Phaser，可被 node --test 直接加载。 */

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

/** 浮点世界坐标，单位是格（1 = 一块 16px 图块）。 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

export type ZoneId =
  | 'street'
  | 'altar'
  | 'industry'
  | 'scholarly'
  | 'agriculture'
  | 'living';

export type TerrainId = 'grass' | 'stone' | 'plaza' | 'farm' | 'tree' | 'shallow' | 'mud' | 'coal';

export interface TileCell {
  zone: ZoneId;
  terrain: TerrainId;
  /** 地理区域。旧世界的 ZoneId 仍负责建造许可，两者不混用。 */
  region?: string;
  walkable: boolean;
  /** 占用者 id（建筑实例名），null 表示空。 */
  occupant: string | null;
}

/** 神谕能派的活。前三种入驻铺子，`quick` 在原地做完。 */
export type TaskKind = 'code' | 'research' | 'writing' | 'quick';

/** 需要铺子承接的活。`quick` 故意不在里面。 */
export type WorkshopTask = Exclude<TaskKind, 'quick'>;

/** 铺子干活时冒出来的东西（纯视觉，由渲染层解释）。 */
export type WorkAccent = 'smoke' | 'pages' | 'ink';

/** 建筑轮廓。三栋楼靠剪影就能分开，不用读招牌。 */
export type Silhouette = 'gable' | 'tower' | 'flat';

export interface PrefabBlueprint {
  readonly id: string;
  readonly displayName: string;
  readonly zone: ZoneId;
  readonly footprint: { readonly w: number; readonly h: number };
  /** 建筑四周必须留出的空地格数。防贴脸、保胡同。 */
  readonly clearMargin: number;
  /** 门口相对原点的偏移，A* 终点用它。必须在占地之外。 */
  readonly door: GridPoint;
  /** 干活时小人站的位置（相对原点偏移）。 */
  readonly workSpots: readonly GridPoint[];
  /** 烟囱相对原点的偏移，单位是格；粒子发射器挂在这里。 */
  readonly chimney: Vec2;
  readonly accent: WorkAccent;
  readonly silhouette: Silhouette;
  /** null 表示这栋楼不接活，只占地方（扩建样板、装饰建筑）。 */
  readonly boundTask: WorkshopTask | null;
  readonly palette: {
    readonly body: number;
    readonly roof: number;
    readonly trim: number;
    readonly window: number;
  };
  readonly upgradeTo?: string;
}

/**
 * 天气。`storm` 不是新机制，是 `rain` 的强度档——`WeatherState.intensity`
 * 早已能表达浓淡，渲染层按它插值。三档主要改的是取值域，但**加了一条分支**：
 * `renderIntensity` 对 `storm` 在同一个 `intensity` 上多加 0.25（见 `weather.ts`）。
 *
 * 这里原来写「三档只改了取值域，没加分支」——不成立。`weather.ts` 那边同一句话
 * 已经更正过（`8bae0c4`），这一处是漏掉的第二个现场，而它还在替那个已撤回的
 * 结论作证。测试把分支钉着：同浓淡 0.5 下 rain 得 0.5、storm 得 0.75。
 *
 * 旧存档只有两档；`storm` 是新增值，读进来只会出现在新档里。#14。
 */
export type Weather = 'clear' | 'rain' | 'storm';

export type VillagerMode =
  | 'idle'
  | 'saluting'
  | 'toWork'
  | 'working'
  | 'delivering'
  | 'toAltar'
  | 'sheltering'
  /** 举着急件跑去祭坛：上游有单在等人答复。 */
  | 'bearingDecree';

export type TaskStatus = 'assigned' | 'in_progress' | 'done' | 'failed';

/**
 * 名牌的状态（SPEC_V2 §4.6）。
 *
 * - `held`：名字还在自己身上，正常接活。
 * - `pawned`：名字被抵押出去了。**只拦新活**——正在干的活照干完，
 *   因为半途扔掉一单比不收一单更糟（那一单会悬空）。
 *
 * 这是世界状态位，不是玩法：v2 只交付「抵押后不再被派活」这道判定，
 * 怎么欠下这笔债不在这一版里（SPEC_V2 §4.6 明确不做经济数值）。
 */
export type NameState = 'held' | 'pawned';

/**
 * 这条活的完成权归谁。
 *
 * - `sandbox`：世界自己造的活（神谕派下来的），由世界内的计时器收尾。
 * - `ledger`：**由上游事件流派来的活**，只有上游的 `task.settled` 能收。
 *
 * 值 `'ledger'` 是历史遗留的字面量，冻结在存档 v1–v3 的样例与校验里，
 * 改它要升 schema。语义已经换了（不再是读台账快照，而是折叠事件流），
 * 但存进去的那个字符串不能动——那是别人的旧档。
 */
export type TaskSource = 'sandbox' | 'ledger';

export interface TaskRecord {
  readonly id: string;
  readonly kind: TaskKind;
  /** 上游给的说法。上游改标题时跟着改——标题只有它知道，世界不自己编。 */
  summary: string;
  /** 原地做的活没有铺子；上游派来的活等派下去才写。 */
  buildingId: string | null;
  readonly source: TaskSource;
  status: TaskStatus;
  readonly createdAt: number;
  completedAt: number | null;
  /**
   * 上游事件时间（epoch 毫秒，来自 `task.settled` 的 `completedAt`）。只给 settled 用：
   * 交付时直接写入 `settled.completedAt`；缺失保持 null，禁止本地时间顶替。
   */
  ledgerCompletedAt?: number | null;
  /**
   * 上游 `task.blocked` 带来的问题。只透传、只展示，世界绝不在内部回答；
   * 非 blocked 状态（转 running / 完成 / 撤单）必须清成 null，不残留。
   * 这里保留完整原文，展示截断由 excerptBlockedQuestion 负责。
   */
  blockedQuestion: string | null;
  /** 接下这单的角色 id；没人接时 null。交付归属按它算。 */
  workerId: string | null;
}

/** 状态行/回执里展示要请示问题时最多显示多少个字符（按 Unicode 码点计）。 */
export const BLOCKED_QUESTION_LIMIT = 60;

/** 展示用截断：超过 60 字符加省略号；完整值仍留在 TaskRecord.blockedQuestion。 */
export function excerptBlockedQuestion(question: string | null): string {
  if (question === null) return '';
  const text = question.trim();
  if (text === '') return '';
  const points = Array.from(text);
  if (points.length <= BLOCKED_QUESTION_LIMIT) return text;
  return `${points.slice(0, BLOCKED_QUESTION_LIMIT).join('')}…`;
}

/**
 * 排队等待派发的一条神谕。她手上有活时新神谕不丢，先排在这里；
 * 队列只存在 Simulation 内，随快照暴露，保证固定步长下可复现。
 */
export interface PendingDispatch {
  /** 世界内自增 id（p1、p2…），不用时间戳/随机数。 */
  readonly id: string;
  readonly kind: TaskKind;
  readonly summary: string;
  /** 入队时刻（this.now）。 */
  readonly requestedAt: number;
  /** 只排神谕单；上游单走 tasks.assigned，天然排队且不可被神谕撤销。 */
  readonly source: 'oracle';
  /**
   * 这条排队的神谕打算给谁。按角色分队列**已经落地**，不是预留：
   * `pendingOf(villager)` 按人取（`simulation.ts` 的 `this.pending.get(villager.id)`），
   * 快照也按人展开。
   *
   * 这里原来写「预留按角色分队列：当前单角色世界固定用 v0」——两句都不成立。
   * 一、默认世界（不带 `?world=`）有**两**个居民：莞尔与阿雾。
   * `LEGACY_PACK.villagers` 是空的（`settings/index.ts`），所以 `SandboxScene`
   * 根本不递 `villagerNames`，`Simulation` 于是走
   * `?? [villagerName, DEFAULT_ASSISTANT_NAME]` 那条兜底——阿雾就是这么来的。
   * `Simulation` 按 index 发 v0/v1，从来不是单角色。
   * （迷路人、汐是**灯潮界**那两个，住在 `settings/dengchao/pack.ts`，而那份包
   * `authored: true`，不是默认设定集。原来这儿把他们写成了「默认设定集」的居民。）
   * 二、队列也不固定 v0：
   * `enqueuePendingDispatch` 从「没抵押」的候选里挑队列最短的那个，然后
   * `queue.push({ ..., villagerId: target.id })`——完全可能写进 v1。
   */
  readonly villagerId: string;
}

/** 每类活的时长与场地。短的原地做，长的进城。 */
export interface TaskProfile {
  readonly estimateMs: number;
  readonly venue: 'workshop' | 'in_place';
  readonly label: string;
}

export interface PlacedBuilding {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly displayName: string;
  readonly zone: ZoneId;
  readonly origin: GridPoint;
  readonly footprint: { readonly w: number; readonly h: number };
  readonly door: GridPoint;
  readonly workSpot: GridPoint;
  readonly chimney: Vec2;
  readonly accent: WorkAccent;
  readonly silhouette: Silhouette;
  readonly boundTask: WorkshopTask | null;
  readonly palette: PrefabBlueprint['palette'];
  /**
   * 这栋楼是谁建的、为什么建。开局常驻的楼没有来源，记 null。
   *
   * 与摆件同一个理由：没有来源，过两天就没人知道它为什么在那儿。
   * 老档迁移来的楼也没有来源，读作"世界自带的"。
   */
  readonly sourceTaskId?: string | null;
  readonly sourceSummary?: string | null;
}

export type WorkstationActivity =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'operating';
      readonly taskId: string;
      readonly startedAt: number;
      readonly estimateMs: number;
      /**
       * 世界知不知道这条活还要多久。沙盒的活由计时器估，所以是 true；
       * 上游的活只有上游自己知道，世界不许编一个百分比，所以是 false。
       */
      readonly determinate: boolean;
    }
  | {
      /**
       * 工具报错后的滑稽故障态，黑烟，不会自己恢复。
       *
       * **目前没有任何代码进入这个态。** 全仓唯一写着 `kind: 'overheating'` 的
       * 赋值处就是本行这个类型声明；六个地方会**读**它（渲染画黑烟、存档校验
       * 收这个枚举值、`Simulation` 两处判断它算不算在忙），但写它的人不存在。
       * 唯一打算写它的是 `tasks.ts` 的 `shouldOverheat()`，那个函数写死返回
       * false，而且**没有任何调用方**。所以这一支是「形状齐全、还没接线」。
       *
       * 留着不删：渲染与存档都已经为它备好了位置，接上时不该再改一圈类型。
       * 但别照这句注释去 `simulation.ts` 里找故障转移——那边没有。
       */
      readonly kind: 'overheating';
      readonly taskId: string;
      readonly since: number;
    }
  | { readonly kind: 'cooling'; readonly taskId: string; readonly until: number };

export interface WorkstationSnapshot {
  readonly buildingId: string;
  readonly activity: WorkstationActivity;
  /** 本次开工已经过去多久（毫秒）。只驱动烟雾浓淡。 */
  readonly elapsedMs: number;
  /**
   * 0..1。粗估进度，用于铺子上方那条细线；任务仍以状态机终态为准。
   * 上游的活是 null：世界不知道真实工作跑到哪了，就不画一条假的进度。
   */
  readonly progress: number | null;
}

/** 在建工地。期间不能接活，画成脚手架。 */
export interface ConstructionSnapshot {
  readonly buildingId: string;
  readonly displayName: string;
  readonly remainingMs: number;
  readonly totalMs: number;
}

/** 交付统计：上游事件流来的活与本地造的活分开计，不合并。 */
export interface DeliveryStats {
  readonly feed: number;
  readonly local: number;
}

/** 单个角色的交付归属：按人分账，上游与本地仍分开。 */
export interface VillagerDeliveries {
  readonly villagerId: string;
  readonly name: string;
  readonly feed: number;
  readonly local: number;
}

/**
 * 从郊野带回来的东西。按活类型分：查资料带卷轴、写代码带石料、
 * 整理文稿带纸。
 */
export type CarryKind = 'scroll' | 'stone' | 'paper';

/** 累积式改变：交付多了，世界多一件东西。不可花掉、不贬值。 */
export type PropKind = 'lamp' | 'tree' | 'banner';

export interface WorldProp {
  readonly id: string;
  readonly kind: PropKind;
  readonly at: GridPoint;
  readonly label: string;
  /**
   * 这个摆件从哪种活换来的。v1 存档迁移过来的老摆件没有来源，记 null；
   * 绘制层据此换外观，纸面据此写「这盏灯是哪一单换来的」。
   */
  readonly sourceTaskKind: TaskKind | null;
  /** 换来摆件的那条活的 id，没有来源时记 null。 */
  readonly sourceTaskId: string | null;
  /**
   * 换来摆件的那条活的摘要。
   *
   * 为什么抄一份：任务结算后会被 `removeTask` 删掉，`settled` 只留 id。
   * 只存 id 的话，纸面永远只能显示一个编号，说不出「那单爬虫」。
   * 老摆件没有来源，记 null。
   */
  readonly sourceSummary: string | null;
  /**
   * v4：污浊度 0..1。渲染层照它叠噪点；1 是刚积满，0 是洗干净（SPEC_V2 §4.6）。
   *
   * 存在世界里而不是只在画面上：洗干净是一个发生过的事实，读档后不该复位。
   */
  readonly grime: number;
  /**
   * v4：洗干净后露出的那句话。没有可露的就是 null。
   *
   * 与 `label` 分开：label 是它此刻的名字，reveal 是藏在地皮下面那句话。
   */
  readonly reveal: string | null;
}

/** 渡有仪式认得的凭证。区域声明 `requires`，角色带着 `carries`，两边同一套词。 */
export type CarryItem = 'lamp' | 'shoes';

/**
 * 一道门要什么。`null` 表示没要，谁都能过。
 *
 * 单独起名而不是处处写 `CarryItem | null`：寻路、设定集校验、存档三处都要
 * 表达「这一格要不要凭证」，三种写法迟早有一种漏掉 null 那一半。
 */
export type RegionRequirement = CarryItem | null;

export interface VillagerSnapshot {
  /** 世界内稳定 id（v0 = 主角色）。渲染按它对齐多个实例。 */
  readonly id: string;
  readonly name: string;
  readonly mode: VillagerMode;
  readonly pos: Vec2;
  readonly facing: Facing;
  readonly visible: boolean;
  readonly taskId: string | null;
  readonly bubble: string | null;
  /** 没活干时她在做什么，给纸面状态行用。 */
  readonly routine: string | null;
  /** 下雨时渲染层给她打把伞；世界不判断"她淋不淋湿"。 */
  readonly umbrella: boolean;
  /**
   * 手上带着的东西。从郊野干完活回来时不为 null。
   * 纯视觉：它不影响任务结算，只是"跑了一趟，带了东西回来"的读感。
   */
  readonly carrying: CarryKind | null;
  /** 渲染专用余量；Simulation 不读取它作任何决定。 */
  readonly lampOil: number;
  /** 名牌在谁手上。抵押者接不到新活（SPEC_V2 §4.6）。 */
  readonly nameState: NameState;
  /**
   * 她随身带着的东西，决定哪道门她过不过得去（SPEC_V2 §4.6）。
   *
   * 和 `carrying` 不是一回事：`carrying` 是干完活捎回来的视觉读感，
   * 这个是通行凭证。`carrying` 可以随时变，这个只有白名单命令能改。
   */
  readonly carries: readonly CarryItem[];
}

/**
 * 只做氛围的环境实体，不参与任务、不改交付统计。
 * 猫是第一个：它会自己走开，不永久占位。
 */
export interface Critter {
  readonly id: string;
  readonly kind: 'cat';
  readonly at: Vec2;
  /** 离开世界的逻辑时刻。到点自己走，不需要调用方清理。 */
  readonly leavesAt: number;
}

/**
 * 神谕石板上的一条：只记真正改变了世界的那句话，外加世界当时的回执。
 * 认不出的输入不进石板（那是回问，不是世界事件）。封顶见 ORACLE_SLAB_LIMIT。
 */
export interface OracleRecord {
  /** 玩家原话。 */
  readonly raw: string;
  /** 世界执行后的回执原文。 */
  readonly receipt: string;
  /** 逻辑时刻（sim.now），不是墙钟：石板要能确定性回放。 */
  readonly at: number;
}

/** 石板最多留多少条。超出丢最旧：再多就没人读了。 */
export const ORACLE_SLAB_LIMIT = 20;

export interface WorldSnapshot {
  readonly now: number;
  /** 兼容旧调用方：等于 villagers[0]（主角色）。 */
  readonly villager: VillagerSnapshot;
  /** 全部角色（2–3 个），渲染与状态行都读这里。 */
  readonly villagers: readonly VillagerSnapshot[];
  readonly buildings: readonly PlacedBuilding[];
  /**
   * 开局（或读档）那一刻世界**已经有的**楼的实例 id。
   *
   * 有了它才能回答「这栋楼是玩家这次玩起来之后造的吗」——而不必去猜。
   * 猜过的两种猜法都错过：`boundTask === null` 问的是接不接活（民居不接活但是开局落的），
   * `zone === 'living'` 问的是分区（灯潮界那六栋楼全是 `industry`，同一句话在设定集上原样重现）。
   *
   * **不落档。** 读档那一刻，档里所有的楼都算"开局就有"——包括上次玩的时候造的。
   * 这不是遗漏，是诚实：一个存档证明不了一栋楼是哪一次会话里造的，
   * 而日报宁可少说一句，不能多说一句假的。
   */
  readonly startupBuildingIds: ReadonlySet<string>;
  readonly workstations: readonly WorkstationSnapshot[];
  readonly constructions: readonly ConstructionSnapshot[];
  readonly tasks: readonly TaskRecord[];
  /** 排队等待派发的神谕（FIFO）。只展示/可撤销，不影响上游完成权。 */
  readonly pending: readonly PendingDispatch[];
  readonly props: readonly WorldProp[];
  /** 神谕石板：最近 N 条改变了世界的神谕，旧在前。 */
  readonly oracle: readonly OracleRecord[];
  /** 氛围实体（猫等）。不参与任何世界结算。 */
  readonly critters: readonly Critter[];
  /**
   * 迷雾：世界还没长出来的部分。
   * **不影响通行**，只压暗画面并拦住新建造——否则读档时迷雾里的建筑会变孤岛。
   */
  readonly fog: { readonly center: GridPoint; readonly revealedRadius: number };
  readonly roads: readonly GridPoint[];
  /**
   * 走出来的痕迹：人反复走过的地方。强度 2 起才出现在这里。
   * **不落档**——能从走动重新累积，存起来只会让存档无限膨胀。
   */
  readonly trails: readonly { readonly at: GridPoint; readonly strength: number }[];
  readonly altar: GridPoint;
  readonly events: readonly WorldEvent[];
  readonly weather: Weather;
  /**
   * 潮汐：水位 0..1 与一句话说法。
   *
   * 它是世界自己的时钟，不读墙钟；同一个存档回放出同一条曲线。
   * `level` 给渲染层插值水位，`label` 给状态行与报纸用。
   */
  readonly tide: {
    readonly level: number;
    readonly label: string;
    /** 这一拍相对上一拍是在涨还是在退。持平也算退，渲染层不靠它判断。 */
    readonly rising: boolean;
    /**
     * 此刻是不是有人在压着潮汐（`tide.setLevel` 的覆盖还没到期）。
     *
     * 世界照样按覆盖走，但这个标记让界面能说出「这是被拨过的」——
     * 否则用户看到潮水停在半满不动，会以为潮汐坏了。
     */
    readonly overridden: boolean;
  };
  /** 交付积累的信仰点数与已达成的世界记忆数。 */
  readonly faith: { readonly points: number; readonly milestones: number };
  /** 交付统计：上游交付与离线本地交付分开计，禁止合并成一个数。 */
  readonly deliveries: DeliveryStats;
  /** 按角色分账的交付归属（顺序同 villagers）；日报据此写「谁交付了几单」。 */
  readonly deliveriesByVillager: readonly VillagerDeliveries[];
  /** 上游事件流的连接情况。断线时世界照常过日子，但不再谎报"没有活"。 */
  readonly feed: {
    readonly connected: boolean;
    /** 最近一次成功读到事件的**世界时间**（不是墙钟）。 */
    readonly lastReadAt: number | null;
    /** 已消费到的事件 id。下次从这里续读。 */
    readonly cursor: number;
    /** 读档后首个成功读取之前为 false；此时上游单只读展示、不驱动。 */
    readonly reconciled: boolean;
  };
}

/** 神谕解析结果。世界只认这几种动词，别的都落到 unknown。 */
export type OracleIntent =
  | { readonly kind: 'dispatch'; readonly taskKind: TaskKind; readonly summary: string }
  | { readonly kind: 'complete' }
  | { readonly kind: 'cancelPending' }
  | { readonly kind: 'unknown'; readonly raw: string };

export interface CommandResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface WorldEvent {
  readonly at: number;
  readonly tone: 'oracle' | 'work' | 'done' | 'info' | 'warn';
  readonly text: string;
}
