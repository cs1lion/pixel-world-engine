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
  | 'inscription';

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

/** 记忆层的事件 kind。写入这些事件不调模型，全部由规则产生。 */
export type MemoryEventKind =
  | 'memory.written'
  | 'memory.consolidated'
  | 'memory.recalled'
  | 'memory.archived'
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

/** 记忆层发出的事件。形状与 `events-client.ts` 的信封一致，便于回写日志。 */
export interface MemoryEvent {
  readonly kind: MemoryEventKind;
  readonly at: number;
  readonly payload: Readonly<Record<string, unknown>>;
}
