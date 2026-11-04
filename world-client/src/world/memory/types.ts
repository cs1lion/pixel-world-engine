/** 内环的数据形状：事件、Holder、记忆条目、断言、信念、痕迹、传说。
 *
 * 这一层只放**类型**。协议第 0 节那七条原则在这里落成结构上的几条硬约束：
 *
 * - 每条记忆都有 `eventRefs`，且类型上是非空数组（`[string, ...string[]]`）。
 *   「至少引用一个真实事件」因此不是一句约定，是类型系统拦得住的东西。
 * - 事件带 `witnesses`，写入后不可改——所以它是 `readonly`，且只由感知层生成。
 * - 信念与记忆分开：记忆是「我知道发生过什么」，信念是「我认为某人某事如何」。
 *   传播协议流动的是 Claim，落地成 Belief；两者都不能凭空出现，都要 `eventRefs`。
 */

/** 事件可见性（协议第 15 节）。 */
export type Visibility = 'private_to_player' | 'world' | 'sanitized';

/** 事件来源。`genesis` 是造物主入口，本组只收不用（边界红线）。 */
export type EventSource = 'agent' | 'world' | 'player' | 'genesis';

/**
 * 世界事件：唯一真相。
 *
 * `witnesses` 由运行时按感知模型算好再写进来，之后不可改。它**不在**写入路径
 * 里现算，因为「谁在场」这件事依赖那一刻的地图与遮挡，事后再算就是另一件事了。
 */
export interface WorldFact {
  readonly eventId: string;
  readonly day: number;
  readonly tick: number;
  readonly kind: string;
  readonly placeId: string;
  readonly actors: readonly string[];
  readonly witnesses: readonly string[];
  readonly parentEventId: string | null;
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly visibility: Visibility;
  readonly importanceHint: number | null;
  readonly source: EventSource;
  /**
   * 这件事发生在哪一类地点（`'building'` / `'workshop'` / `'altar'`…）。
   *
   * 后果规则（`traces.ts`）与史诗判档（`epic.ts`）都要用它：「一栋楼被拆」
   * 与「两个人在街上吵了一架」在记忆层是同一个 `conflict`，靠这一列才分得开。
   * 老档没有它——读作「不知道是哪类地点」，按普通地点处理，不猜。
   */
  readonly placeType?: string;
  /**
   * 这件事在世界里被怎么说。**只在事件出生时给定**，之后不可改。
   *
   * 存在的理由是记忆条目与断言必须同源：它们是同一次感知的两种读法，
   * 各推一份情绪就会长出两条不一样的说法。世界侧事件留空，按 kind 先验推。
   */
  readonly voice?: EventVoice;
}

/**
 * 一条事件被说出来时的样子：文本与情绪。
 *
 * `source = agent / genesis` 的事件由脱敏编译器给（`claimContentFor` 自己
 * 那张表）；世界侧事件不给，按 kind 的先验推。
 */
export interface EventVoice {
  readonly what: string;
  readonly valence: number;
  readonly arousal: number;
  readonly detailLevel: number;
}

/** Holder 的三种类型。玩家（上帝）不在这三者里——他的记忆在上游。 */
export type HolderType = 'character' | 'place' | 'collective';

/** 性格偏置：对显著度四个分量的加减，上限见 `config.salienceBias`。 */
export interface HolderProfile {
  readonly emotion?: number;
  readonly surprise?: number;
  readonly goalRelevance?: number;
  readonly involvement?: number;
  /** 亲疏：影响是否愿意开口、信几分。 */
  readonly talkativeness?: number;
}

export interface Holder {
  readonly holderId: string;
  readonly type: HolderType;
  readonly profile: HolderProfile;
  /**
   * 此刻站在哪。**只有人物的位置会变**；地点 Holder 的这个字段是它自己的落点。
   *
   * 传播要算「两个人隔多远」，而「隔多远」决定了他们能不能说上话
   * （`talkDistance = 2`）。没有位置的话，唯一能给的候选距离是 1，
   * 于是全村的人两两之间都在说话——那正好是护栏要防的「全员一天内全知」。
   *
   * 由调用方在世界推进时更新。记忆层自己不移动任何人：它是账本，不是行为层。
   */
  readonly at?: { readonly x: number; readonly y: number };
}

/**
 * 方向性关系账本：A 对 B 与 B 对 A 是两条独立记录。
 *
 * `trust` / `warmth` / `debt` 都按 **from 的视角**写：正 debt = 我欠他。
 * `evidence` 只存事件 id，查得到原事；`updatedDay` 是世界日。
 */
export interface Bond {
  readonly from: string;
  readonly to: string;
  readonly trust: number;      // -1..1
  readonly warmth: number;     // -1..1
  readonly debt: number;       // -1..1
  readonly familiarity: number; // 0..1
  readonly strength: number;    // 0..1
  readonly confidence: number;  // 0..1
  readonly evidence: readonly string[];
  readonly updatedDay: number;
}

/** 情绪残留：日终更新，按 `halfLifeDays` 衰减；`because` 是支撑它的记忆 id。 */
export interface Mood {
  readonly holderId: string;
  readonly valence: number; // -1..1
  readonly arousal: number; // 0..1
  readonly label: string;
  readonly because: readonly string[];
  /** 上一次日终更新的世界毫秒。 */
  readonly updatedAt: number;
  readonly halfLifeDays: number;
}

export type MemoryKind = 'episodic' | 'summary' | 'impression' | 'habit' | 'trace';
export type MemoryTier = 'day' | 'long' | 'legend';

/**
 * 五个种类，今天有写出点的是几个——扫一遍比看着声明猜准。
 *
 * | 种类 | 谁写 | 状态 |
 * | --- | --- | --- |
 * | `episodic` | `ingest`、`rememberTold`、`lookAtTraces` | 主力 |
 * | `summary` | `makeSummary`、`mergeWeekly` | 主力 |
 * | `habit` | `lookAtTraces` 的磨损小径那一行 | 补设计 §1.2 第三行明写 `kind: habit` |
 * | `impression` | **无** | 协议第 6 节把它单列为「对人或事的印象」，但没有任何一行要产出它 |
 * | `trace` | **无，也不该有** | 痕迹是 `Trace` 类型，不是 `MemoryEntry`；这一项是声明里的历史遗留 |
 *
 * 后两行不是漏接的清单，是**别急着补**的清单：声明一个种类不等于有东西要
 * 往里写。`impression` 与 `trace` 空着，`budget.impression`（32 条）与
 * `limitFor('impression')` 也就空着——等第一条真该写成印象的记忆出现，
 * 那里就是它非过不可的那道闸。
 */
/**
 * 这条记忆是怎么来的。
 *
 * 全仓库扫一遍，四种出处各落在哪儿是定数：`witnessed` 在 `ingest` 与
 * 整理（摘要继承亲历），`heard` 在 `rememberTold`，`inferred` 是
 * `traces.ts` 查表的前五行，而 **`read` 只有一处**——同一张表的最后
 * 一行，碑文。
 *
 * 这不是漏接，是补充设计 §3.2 定稿表就这么定的。那张表五行里，只有
 * 「碑文 / 留言牌」一行写着「高保真转化，直接升级为 source_mode = read」。
 * 广播与书面两行只描述**信念**那一侧——范围、可信度、条数上限、谁能读——
 * 没有一个字提到记忆条目。所以 `readAnnouncement` 与 `readWritten` 只写
 * `Belief`：不是少做了一半，是表里就只有这么多。
 *
 * 广播那条还另有一条结构性理由，让「漏了」这个怀疑更站不住：公告栏立在
 * 事发地（`postDailyReport` 取 `claim.content.where` 的落点），而
 * `broadcastRadius`（4）小于 `perceptionRadius`（8）——室外事件里，四格内
 * 的人必然在感知半径内；视线这一条见证要查、广播不查，所以墙后的人是唯一
 * 的例外。他已经亲眼记过一次了，再补一条 `read` 只是把同一件事抄成两行。
 */
export type SourceMode = 'witnessed' | 'heard' | 'read' | 'inferred';

/** 记忆的结构化内容。`detailLevel` 是 0–3 的细节层级，传播每跳降一级。 */
export interface MemoryContent {
  readonly what: string;
  readonly who: readonly string[];
  readonly where: string;
  readonly when: number;
  readonly detailLevel: number;
  readonly valence: number;
  readonly arousal: number;
}

/** 生成方式。规则产物也记 `seed`，回放时用它重现同一次变形。 */
export interface GeneratedBy {
  readonly by: 'rule' | 'llm';
  readonly rulesetVersion: string;
  readonly inputHash: string;
  readonly seed: number;
  readonly modelId?: string;
}

/** 记忆的派生来源。删除级联沿它往下走。 */
export interface DerivedFrom {
  readonly memoryIds: readonly string[];
  readonly claimIds: readonly string[];
}

/**
 * 记忆偏差的类型（见 `distort.ts`）。只有个人记忆条目会带它；
 * `eventRefs` 仍指向真实事件，所以「记错了」查得回原文。
 */
export type MemoryBias =
  | 'detail-substitution'
  | 'causal-mismatch'
  | 'time-shift'
  | 'wrong-person';

export interface MemoryEntry {
  readonly memoryId: string;
  readonly holderId: string;
  readonly kind: MemoryKind;
  readonly tier: MemoryTier;
  /** 出处，至少一个。类型上是非空数组，见文件头。 */
  readonly eventRefs: readonly [string, ...string[]];
  readonly sourceMode: SourceMode;
  /** heard 时的来源链：谁告诉我的，他又是听谁的。 */
  readonly sourceChain: readonly string[];
  readonly content: MemoryContent;
  readonly salience: number;
  readonly confidence: number;
  readonly strength: number;
  readonly createdDay: number;
  readonly lastRecalledDay: number;
  readonly recallCount: number;
  /**
   * 三个旗子，各有几个写出点——扫一遍，别看着声明猜。
   *
   * - `flashbulb`：两处写 `true`，都是同一句 `salience >= T_flash`
   *   （`makeEpisodic` 与 `rememberTold`）。其余一律 `false`。
   * - `pinned`：**七处，全是 `false`。没有任何一处写 `true`。**
   *   协议第 6 节把它和 flashbulb、redacted 并列在 flags 里，第 7 节说
   *   「flashbulb 与 pinned 不衰减」，而**没有任何一行规定什么东西该被钉住**。
   *   于是它有三个消费者（`decayStrength` 的豁免、归档豁免、`trimBudget`
   *   的「固定与闪光灯先保」）和零个生产者。碑文差一点就用它——见
   *   `test/memory-legend-inscribe.test.ts` 里「碑文不钉住」那条：钉住的碑文
   *   四十天 strength 一动不动停在 1.000，`tierFactor.legend = 0.05` 成了摆设。
   *   这一位在等一个具体的「什么该被钉住」，在那之前它就该是 `false`。
   * - `redacted`：两处写 `true`，都在 `privacy.ts` 的删除级联里
   *   （事件根摘掉一个出处、记忆根摘掉一环）。其余一律 `false`。
   */
  readonly flashbulb: boolean;
  readonly pinned: boolean;
  readonly redacted: boolean;
  readonly derivedFrom: DerivedFrom;
  readonly generatedBy: GeneratedBy;
  /** 这条记忆带哪种偏差；没有记错时省略（老档案没有这个字段，读作没有偏差）。 */
  readonly bias?: MemoryBias;
  /** 归档后不再参与默认检索，但仍可被强线索唤醒。 */
  readonly archived: boolean;
}

/** 一条断言的来源链上的一节：谁说的、从谁那里听来、第几跳。 */
export interface SourceChainLink {
  readonly holderId: string;
  readonly claimId: string;
  readonly hop: number;
}

/**
 * 断言：对某个事件的一种说法。传播的就是它。
 *
 * `distortedBy` 只在**规则**变形时写（丢细节、放大情绪），不写「谁在撒谎」——
 * 是否允许角色撒谎仍是开放问题（协议第 18 节），本组不表态。
 */
export interface Claim {
  readonly claimId: string;
  readonly eventRefs: readonly [string, ...string[]];
  readonly content: MemoryContent;
  readonly confidence: number;
  readonly hop: number;
  /**
   * 断言诞生时的来源：谁第一个说出它、用哪条 claim_id、第几跳。
   *
   * **只有一节，而且永远只有一节。** 原来这里有个 `withLink`，注释写的是
   * 「一条断言被讲出去之后，来源链上多一节」——它一个调用方都没有，所以那一
   * 节从来就没有被加上去过。而它是**结构上加不上来的**：一条断言被全村共享，
   * 同一跳上有好几个人持有它，把链挂在断言上，最后一个听到的人会把所有人的
   * 路径一起改掉。真正的来源链在 `MemoryEntry.sourceChain` 上——一条记忆一个
   * 持有者，链才长得起来。
   */
  readonly sourceChain: readonly SourceChainLink[];
  readonly originHolderId: string;
  readonly createdDay: number;
  readonly secret: boolean;
  readonly distortedBy: readonly string[];
}

/** 某个单位持有的信念。`speakerTrust` 是它对来源的信任，影响求证冲动。 */
export interface Belief {
  readonly holderId: string;
  readonly claimId: string;
  readonly eventRefs: readonly [string, ...string[]];
  readonly confidence: number;
  readonly learnedDay: number;
  readonly sourceHolderId: string;
  /**
   * 他手里的版本是第几跳。
   *
   * **必须逐信念存，不能只看断言上的 `hop`**：同一条断言在村里同时存在
   * 第一跳和第三跳的版本。把跳数挂在共享的断言对象上，最后一个听到的人
   * 会把所有人的跳数一起改掉——于是「谁在第几跳」这个信息就没了，
   * 而它正是保真度曲线要画的东西。
   */
  readonly hop: number;
  /** 状态位：正常 / 存疑 / 已证实 / 已辟谣。求证闭环写后两者。 */
  readonly state: BeliefState;
}

export type BeliefState = 'held' | 'suspicious' | 'confirmed' | 'debunked';

/**
 * 成长记录：一个人对某件事的看法翻过来了。
 *
 * 这一轮只实现这一种（`belief-reversed`）。它记的是**变化**，不是流水账：
 * 「第 12 天，他不再相信账房着火这件事」比二十条「他今天还是相信」有用。
 *
 * 三条硬约束：
 * 1. 只在信念状态真的变了的那一次写（`verify` 的求证闭环里）；
 * 2. `eventRefs` 指向原来的事件——成长可以查回事实，不是另一份说法；
 * 3. **不衰减、不删除**：`BondPhase` / `HabitRecord` 还留着位置，等它们
 *    有生产者时再一起谈保留策略。
 */
export interface TurningPoint {
  readonly holderId: string;
  readonly day: number;
  readonly atMs: number;
  readonly kind: 'belief-reversed';
  readonly claimId: string;
  readonly eventRefs: readonly [string, ...string[]];
  readonly from: BeliefState;
  readonly to: BeliefState;
}

/** 痕迹：地点的物质化记忆。 */
export interface Trace {
  readonly traceId: string;
  readonly placeId: string;
  readonly eventRef: string;
  readonly layerType: TraceLayer;
  readonly intensity: number;
  readonly createdDay: number;
  /** 风化只降可见度，不删记录。 */
  readonly visibility: number;
}

export type TraceLayer =
  | 'scorch'
  | 'damage'
  | 'patch'
  | 'garland'
  | 'worn_path'
  | 'inscription'
  /**
   * 废墟：一栋楼被拆掉之后留在地上的那一层。
   *
   * 它与 `scorch` 分开，是因为「这里烧过」与「这里曾经有一栋楼」是两件事：
   * 前者会随时间淡到无，后者是一个地点被抹掉之后**唯一还留在原地的东西**。
   * 拆楼这件事原先只在原地留一道焦痕，于是「那儿原来有间铺子」这条记忆
   * 既没有落点、也没有专属的读法。废墟是那条记忆的物证。
   */
  | 'ruin';

/** 一次改名的记录。协议 §11 的「历史链」就是这几条串起来。 */
export interface ToponymEntry {
  /** 改完之后的名字。 */
  readonly name: string;
  /** 因为哪件事改的。查得到那件事，这条记录才算数。 */
  readonly fromEventRef: string;
  readonly day: number;
}

/** 一个地点此刻叫什么、改过几次名。 */
export interface Toponym {
  readonly name: string;
  readonly history: readonly ToponymEntry[];
}

/** 传说：集体记忆中被反复讲述的事件。 */
export interface Legend {
  readonly legendId: string;
  readonly eventRefs: readonly [string, ...string[]];
  readonly variants: readonly string[];
  readonly reach: number;
  readonly homePlaceId: string;
  readonly formedDay: number;
}

/** 心电图：`DayClosed` 之后向外广播的四个标量（补充设计 §2.3）。 */
export interface WorldVitals {
  readonly day: number;
  readonly meanValence: number;
  readonly meanArousal: number;
  readonly infoEntropy: number;
  readonly isolatedHoldersCount: number;
}

/**
 * 一块地经历过的阶段。**建 / 改 / 拆 / 废墟 / 重建**，每一次都带世界日与世界时间。
 *
 * 这是「场景记忆」的第一层：人物记得「那天发生了什么」，地标记得
 * 「**这块地**经历过什么」。两者共享同一个事件锚点（`causeEventRef`），
 * 不复制事实内容——一条事件只有一份真相，地标与人物各自引用它。
 */
export type LandmarkState =
  /** 第一次立起来。 */
  | 'built'
  /** 改了——今天唯一的来源是改名（协议 §11）；修缮留到有修缮命令时接在同一个状态上。 */
  | 'altered'
  /** 拆了，楼已不在，痕迹还在。 */
  | 'demolished'
  /** 拆掉之后过了一定时日仍没有重建：从「刚拆」变成「废墟」。 */
  | 'ruined'
  /** 同一块地上又立起了一栋。 */
  | 'rebuilt';

export interface LandmarkPhase {
  readonly state: LandmarkState;
  /** 世界日：`floor(at / dayMs)`。 */
  readonly day: number;
  /** 世界时间毫秒。留精确时刻，日只是它的一个投影。 */
  readonly atMs: number;
  /** 因为哪件事。查得到那件事，这一段历程才算数。 */
  readonly causeEventRef: string;
  /** 这一阶段它叫什么。改名之后的名字在这里更新。 */
  readonly name: string;
  /** 一句话，读给人看：落成 / 改名 / 拆除 / 荒废。 */
  readonly note: string;
}

/** 一块地占的格。拆掉之后**留位**，等废墟态美术来接。 */
export interface LandmarkFootprint {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 一个地标（一块地）的一生。
 *
 * 身份是**地块**，不是建筑的实例 id：拆掉再建会拿到新的 `instanceId`
 * （`Simulation.nextInstanceId` 不回收旧号），但那还是同一块地。所以
 * `plotKey` 是主键，`placeId` 是「最近一次」的实例 id，`aliases` 是这块地
 * 用过的全部 id——旧痕迹还在旧 id 名下，查这块地的历史要看 aliases 里的每一个。
 */
export interface Landmark {
  readonly placeId: string;
  readonly aliases: readonly string[];
  readonly displayName: string;
  readonly plotKey: string;
  /** 落点（门口）。废墟画在这里。 */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly footprint: LandmarkFootprint | null;
  readonly bornDay: number;
  readonly phases: readonly LandmarkPhase[];
  readonly current: LandmarkState;
}

/**
 * 一天的世界体征。时代分期的原料：不是「另一套记忆」，是每日状态的**分段摘要**。
 *
 * `meanValence` / `meanArousal` / `infoEntropy` / `isolatedHolders` 直接取
 * 当日心电图（`WorldVitals`）；另外四个数是场景侧才有的（楼、废墟、传说、
 * 人口）。只存两端的签名（段首与段末），不存逐日曲线——切段只问
 * 「今天与段首差多少」，不问昨天。
 */
export interface EraSignature {
  readonly day: number;
  readonly meanValence: number;
  readonly meanArousal: number;
  readonly infoEntropy: number;
  readonly isolatedHolders: number;
  readonly buildingCount: number;
  readonly ruinCount: number;
  readonly legendReachSum: number;
  readonly population: number;
}

/** 一个时代：一段世界日区间，加上规则生成的名字与它里面的大事。 */
export interface Era {
  readonly eraId: string;
  readonly fromDay: number;
  /** `null` = 还没结束（当前时代）。 */
  readonly toDay: number | null;
  readonly label: string;
  readonly startSignature: EraSignature;
  /** 最近一天的签名。段没结束时它就是「此刻的样子」。 */
  readonly lastSignature: EraSignature;
  /** 段内最重的几件事（按 `importanceHint`，同分按事件 id）。 */
  readonly definingEventRefs: readonly string[];
  /** 0..1：段有多长（`spanDays / 90`，封顶 1）。短段不该和长段一样可信。 */
  readonly confidence: number;
}

/**
 * 史诗的档位。判据全部可计算（见 `epic.ts`），**不交给模型**：
 * 同一份存档跑两遍，档位必须一样，否则「回放一致」就没了。
 */
export type EpicGrade =
  /** 连传说都没到：只是某个人记得的事。 */
  | 'local'
  /** 够格立碑，但规模只在局部：够得着重要性门槛，覆盖不到一半人。 */
  | 'legend'
  /** 世界级：重要、覆盖过半、且多半不可逆。 */
  | 'epic'
  /** 开天辟地：极重 + 不可逆 + 覆盖七成以上。 */
  | 'founding';

/** 判档时算出来的五条度量。存下来是为了让「为什么是史诗」可复核，不是让读的人再猜一次。 */
export interface EpicCriteria {
  readonly importance: number;
  /** 0..1：拆楼/废墟 = 1，改名 = 0.8，立楼 = 0.4，其余 0。 */
  readonly irreversibility: number;
  /** 讲这件事的人占人口的比例。 */
  readonly reachShare: number;
  /** 事件被多少人知道（形成传说时的持有者）占人口的比例。 */
  readonly populationShare: number;
  /** 从最早那条事件到传说成立，过了几天。 */
  readonly spanDays: number;
}

/**
 * 史诗条目：从传说升上来的那一层。
 *
 * 只存引用与判定，不复制传说的讲法（`variants` 是引用过来的同一份字符串，
 * 方便碑上直接读）。一条传说最多升一条史诗，`eventRefs` 是它的身份。
 */
export interface EpicEntry {
  readonly epicId: string;
  readonly eventRefs: readonly [string, ...string[]];
  /** 规则模板给的一句话，不是模型起的名字。 */
  readonly title: string;
  readonly variants: readonly string[];
  readonly homePlaceId: string;
  readonly formedDay: number;
  readonly grade: EpicGrade;
  readonly criteria: EpicCriteria;
  /** 今天只有规则；玩家「封为史诗」留到有那个开关时。 */
  readonly promotedBy: 'rule' | 'player';
}

/**
 * 17 个 kind，与协议 §13 一一对应：那张表本身 11 行，段末另列 6 个传播事件
 * （ClaimCreated、ClaimTold、BeliefUpdated、AnnouncementPosted、AnnouncementRead、
 * RumorDebunked），合计 17。
 *
 * 数字别手数——`grep -c "^  | '"` 数下面这个联合，协议那一份数
 * `awk '/^## 13\./,/^## 14\./' …`。这一行原先写的是「18」，手数错的。
 *
 * 「转写得全」不等于「接得通」。扫一遍（`grep -rn "onEvent\\|emit(" src`）数一下
 * 今天谁在发、谁在接：
 *
 * | 事项 | 状态 |
 * | --- | --- |
 * | `legend.formed` | 有发出方（`updateLegends`）、有接收方（`SandboxScene` 的 `onEvent` → 镇志） |
 * | `toponym.changed` | 有发出方（`maybeRename`）、有接收方（`SandboxScene` 的 `onEvent` → 刷开着的那块楼面板） |
 * | 其余 15 个 | 都有发出方（`world.ts` 的 `emit`），但**运行中的 app 一个都没接** |
 *
 * 前两行是这一版补上的，补的正是**协议 §11 那半条规则**。§11 写着「地名演变保存
 * 历史链：`ToponymChanged(place_id, old, new, event_ref)`」，§11 的痕迹表又把「里程碑」
 * 一行指向「留言牌、碑文、地名变更」，补充设计还说叙事装饰层「由内环的 `Trace` 与
 * `ToponymChanged` 规则实时驱动」。当时缺的是四样：地点 Holder 的当前名字、一条历史链、
 * 一条「什么里程碑配改名」的判据、以及这个事件的发出点。四样现在分别在
 * `MemoryWorld.placeNames` / `ToponymEntry[]` / `toponym.ts` 的 `epithetFor` / `maybeRename`。
 *
 * **接收方这一格要读准**：`toponym.changed` 的接收方不是「唯一刷新路径」——
 * 楼面板打开时会自己读一遍 `placeNamesOf`，改名事件只是让**已经开着**的那一栋
 * 当场换名字。删掉那个分支，屏幕上不会立刻看出差别（关一次再开就对了），
 * 所以它没有一条能变红的变异测试；发出去的那一条有（`test/toponym.test.ts`
 * 的「发出一次、载荷四个键」）。两件事都写着，免得下一个人以为这里有个假闸。
 *
 * 同一个洞在 `traces.ts` 还留了一个更小的脚印：`consequenceOf` 里
 * `input.kind === 'toponym'` 那个析取项。全仓库仍然没有一处创建 `kind: 'toponym'`
 * 的事件——**改名不是世界事件，是记忆层的读法**（对照：`'milestone'` 有，`observe.ts` 发），
 * 所以那一支今天仍然咬不动。留着不删：接的人不用再翻一遍。
 *
 * 剩下 15 个的根源在**外面**，不在这一层：`WorldChange` 是七个成员的闭集，
 * 记忆层真发得出的那 15 个一个都不在里面——要接就得先改服务端契约。
 * 那是外环的决定：所以出口留成注入点（`MemoryWorldDeps.emit` /
 * `MemoryRuntimeDeps.onEvent`），这一层不替它接，也不假装它接着。
 */
export type MemoryEventKind =
  | 'memory.written'
  | 'memory.consolidated'
  | 'memory.recalled'
  | 'memory.archived'
  /** 预算淘汰。每层每天至多一条，带 `layer` / `evicted` / `byCount` / `byBytes`。 */
  | 'memory.pruned'
  | 'memory.deleted'
  | 'cue.fired'
  | 'trace.added'
  | 'toponym.changed'
  | 'legend.formed'
  | 'diary.written'
  | 'claim.created'
  | 'claim.told'
  | 'belief.updated'
  | 'announcement.posted'
  | 'announcement.read'
  | 'rumor.debunked'
  | 'day.closed';

/**
 * 记忆层发出的事件。
 *
 * 信封与 `events-client.ts` 对得上，为的是「能回写日志」。**今天只有一个 kind
 * 真的被写进日志**：`legend.formed`（`SandboxScene` 把它转成 `WorldChange 'legend'`，
 * 落进镇志）。`toponym.changed` 有接收方，但接收方只刷面板、不落日志——
 * `WORLD_CHANGE_KINDS` 那九种里没有地名，这一版不为它加第十种。
 * 别把这行注释读成「这些事件都在进日志」。
 */
export interface MemoryEvent {
  readonly kind: MemoryEventKind;
  readonly at: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * 日摘要里那一天的「定性标签」。**是枚举，不是散文**：读的人要能一眼扫出
 * 「这天有没有争执」，而不是读一段形容词。
 *
 * - `quiet`：那天没有任何事件，只有（或连）摘要。
 * - `social`：有照面/交谈/同行一类的事件。
 * - `work`：有干活、开市、建造一类的事件。
 * - `dispute`：有冲突、争吵、斥责。
 * - `anomaly`：有事故、失火、坍塌、失窃。
 * - `major`：有 `importanceHint ≥ 0.6` 的大事。
 * - `other`：有事件，但没落进上面任何一类。
 */
export type DayFlag = 'quiet' | 'social' | 'work' | 'dispute' | 'anomaly' | 'major' | 'other';

/**
 * 一天结束时的**压后时间轴**：日历证明「那天发生过事」，它证明「那天怎么过的」。
 *
 * 存在理由（SOAK-BUG-5）：90 天实跑里，条目层的 `day` 桶只有 16 格/人，
 * 旧日片段被强度排序挤掉，回溯第 20/45/60 天时居民时间轴缺失 100%/98.4%/96.5%。
 * 按天压成一条摘要，是「逐日降浓度」而不是「少删一点」：压掉的是句子与细节，
 * 留下的是人、地点、拍序与事件指针。
 *
 * **每天至多一条**（键是 `day`），异常原句至多 3 条。字段全部是枚举或 id 列表，
 * 不收自由文本摘要。
 *
 * 三档浓度见 `digest.ts` 的 `DIGEST_FULL_DAYS`：
 * 近档（≤7 天）照旧逐条条目；中档（8–30 天）用本结构全量；
 * 远档（>30 天）`compact = true`：地点表、异常原句清空，事件表只留 id + kind。
 */
export interface DayDigest {
  readonly day: number;
  /** 那天有活动的角色 id（升序）。回答「几个人在」。 */
  readonly people: readonly string[];
  /** 最先 / 最后的活动拍（事件 id）。回答「那天从什么开始、到什么结束」。 */
  readonly firstEvent: string | null;
  readonly lastEvent: string | null;
  /** 当天活动涉及的地点 id（去重升序）。远档清空。 */
  readonly places: readonly string[];
  readonly flags: readonly DayFlag[];
  /**
   * 事件表：`[事件 id, kind, places 下标]`。远档地点下标一律 `-1`。
   *
   * kind 原样存事件自己的枚举名（`street_greet` / `conflict` …），不做二次归类：
   * 归类表的版本会漂，而事件 kind 是事件出生时就定死的。
   */
  readonly events: readonly (readonly [string, string, number])[];
  /**
   * 与 `events` 对齐的拍子表：每个事件各被 `people` 里的哪些人记下（下标）。
   *
   * 允许同一个人重复出现：同一个事件可能给他留下两条不同来源的片段，
   * 而回溯的分母数的是**条目**，不是「人×事件」的去重对。
   */
  readonly beats: readonly (readonly number[])[];
  /**
   * 与 `people` 对齐的非片段条目数（摘要 / 印象 / 习惯）。
   *
   * 这些条目没有事件可指，但它们在当天时间轴上占格；不记这一列，回溯会把
   * 「有摘要的那天」算成缺失。
   */
  readonly extras: readonly number[];
  /** 异常条目原句（≤3 条，仅中档）。远档清空：浓度降到「有没有事」。 */
  readonly anomalies: readonly string[];
  /** 指向当天重要事件（`importanceHint ≥ 0.6`）的指针，至多 3 条。 */
  readonly pointers: readonly string[];
  /** `true` = 远档的浓缩形态。 */
  readonly compact: boolean;
}
