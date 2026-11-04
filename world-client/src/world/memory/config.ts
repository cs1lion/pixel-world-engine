/** 内环参数表：把《补充设计 v1.0》第 3.1 / 3.2 节的定稿初值收成一份可改的 Config。
 *
 * 为什么单独立一份而不是散在各模块里：协议文档里每个「建议初值」都是**待调**的，
 * 而调参的前提是能一眼看到全部旋钮。散开之后，改一个阈值要先 grep 半个仓库，
 * 调参就退化成碰运气。
 *
 * 三条纪律：
 *
 * 1. **这里只有数，没有逻辑。** 怎么用是各自模块的事，读它的人不该为了看一个
 *    权重而先读完一个算法。
 * 2. **每一项都写明出处。** 文档改了这里得跟着改，而「这一项是从哪来的」
 *    是唯一能判断该不该跟的依据。
 * 3. **一天是 24 个世界小时**（`docs/adr/ADR_MEMORY.md`）。v1.0 的
 *    `day_length_seconds = 900` 是「现实里看完一天要多久」的节奏目标，
 *    由前端时间倍率承担，不是另一套「天」。
 *
 *    第 3 条的后半句**现在成立了一半**。机制是对的（`timeScale` 只放大喂给
 *    Simulation 的步长）：`paceFrame` 稳定给出 **10 步/真实秒**（与帧率无关），
 *    每步推进 `LOGIC_STEP_MS × timeScale` 的世界时间，于是
 *    一世界日要 `DAY_MS / (1000 × timeScale)` 真实秒——
 *
 *    | `timeScale` | 一世界日 | 相对 900 秒目标 |
 *    | --- | --- | --- |
 *    | **60（默认，也是上限）** | **1440 秒（24 分钟）** | 1.6 倍 |
 *    | **96（需要）** | **900 秒（15 分钟）** | 达标 |
 *
 *    这张表只适用于**默认的游玩时间驱动**（页面开着按倍率走、关页面即冻结），
 *    也适用于显式 `?clock=fast` / `?speed=`；显式 `?clock=real` 是 1:1，
 *    一世界日就是 24 小时，且会按墙钟补算离线天数。门槛仍写死
 *    `MAX_TIME_SCALE = 60`，所以 **900 秒这个目标在许可范围内达不到**——
 *    最接近就是 24 分钟。§3.1 给 900 的理由（「1 小时现实工作刚好经历 4
 *    个游戏日」）也不成立：默认 60 下一小时经历 2.5 个世界日。
 *
 *    节奏这一版按用户的裁决定了：**一世界日 = 24 分钟现实**（1 世界分钟 =
 *    1 现实秒），所以白天 06:00–22:00 正好 16 分钟。要 900 秒一日就得抬
 *    上限；本组不抬，`test/day-pace.test.ts` 把这张表钉住，谁改倍率或上限
 *    它会响。
 */

/**
 * 一个世界日：24 个世界小时。
 *
 * 与 `lampoil.ts` 的 `LAMP_DAY_MS`、`server/memory/snapshot.py` 的 `DAY_MS`
 * 是同一个长度，三处各写一遍。不 import 灯油那一份：那个文件自己写着
 * 「只活在渲染层」，而记忆是世界的账，反过来依赖渲染层会把两层的依赖方向弄反。
 * `test/memory-day.test.ts` 钉住这三个数一致。
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export type Tier = 'day' | 'long' | 'legend';

/** 显著度的四个分量。和恒为 1 的权重表按 Holder profile 微调。 */
export interface SalienceWeights {
  readonly emotion: number;
  readonly surprise: number;
  readonly goalRelevance: number;
  readonly involvement: number;
}

/**
 * 一层库的预算：**条数与字节双约束**，先超哪个按哪个裁。
 *
 * 为什么字节与条数要同时给：单看条数，一条碑文与一条印象一样重，于是
 * 「80 条」可以是 5 KB 也可以是 50 KB；单看字节，条目大小一变（多存一句
 * 说法、多记一个见证人），同一个条数上限的实际容量就跟着漂。两个都是硬
 * 上限，改一个不会悄悄放大另一个。
 */
export interface LayerBudget {
  readonly count: number;
  /** 字节上限（UTF-8，口径与存档一致：`JSON.stringify` 后的字节数）。 */
  readonly bytes: number;
}

/** 各层容量预算。v1.0 §3.1「各层容量预算」，字节那一栏是本轮补的。 */
export interface MemoryBudget {
  /** 当日片段。 */
  readonly day: number;
  /** 每日摘要条数。 */
  readonly daySummary: number;
  /** 长期层。 */
  readonly long: number;
  /** 对他人的印象。 */
  readonly impression: number;
  /**
   * 碑文层。**曾经是 `Infinity`。**
   *
   * 30 日实测 500 条 / 311.8 KB，占条目字节的 86.6%，且不裁、不归档
   * （legend 每天只衰 0.15 × 0.05 = 0.75%，30 天还剩 0.79，离
   * `T_forget = 0.15` 有 98 天）。碑文是「传说成立时给每个当事人刻一条」，
   * 条数随「传说 × 人 × 地点」长——它是条目层唯一的无上限增长项。
   *
   * 24 条/持有者：一个地点记事簿的容量，不是一块碑的容量。地点 Holder 是
   * 碑文的主要持有者（30 日 6 个地点各 85 条），24 条之后按强度与新旧淘汰，
   * 留下的正好是「最近还在被讲」的那批。
   */
  readonly legend: number;
  /** 每一层的字节上限。与条数同时生效。 */
  readonly bytes: Readonly<Record<'day' | 'long' | 'legend' | 'impression', number>>;
}

/**
 * 条目层以外那几个库的预算。它们没有 `tier`，单独一张表。
 *
 * 30 日实测（seed A）：`facts` 898 条 / 321.7 KB、`claims` 598 / 211.4 KB、
 * `beliefs` 1132 / 167.4 KB、`cooldowns` 1709 / 113.7 KB、`tells` 1132 / 67.3 KB、
 * `written` 150 / 184.1 KB——六项合计 945 KB，占记忆 JSON 的 65%。它们原先
 * **一条都没有预算**，这才是存档日均 +47.9 KB 的主体。
 *
 * 取值口径：按 90 天、稳态下每一条的平均字节数反推条数（见
 * `docs/evidence/soak/REPORT.md` 的「预算表」），让 90 天末的记忆 JSON 落在
 * 约 1.2 MB，连同世界存档一起留出 2 MB 上限的 30% 余量。
 */
export interface LibraryBudget {
  readonly facts: LayerBudget;
  readonly claims: LayerBudget;
  readonly beliefs: LayerBudget;
  readonly cooldowns: LayerBudget;
  readonly tells: LayerBudget;
  /** 日记与书信（`written.ts`）。它一条 1.2 KB，是字节意义上的大头。 */
  readonly written: LayerBudget;
  /** 镇志里的传说条目（`legends`），与碑文层的记忆条目不是一张表。 */
  readonly legends: LayerBudget;
  /**
   * 日摘要（SOAK-BUG-5，`digest.ts`）。**每天至多一条**，90 天 ≈ 30 条全量 +
   * 60 条浓缩，实测 1.0–1.6 KB/天。条数取 120 = 90 天再留一个月的余量；
   * 字节取 160 KB = 90 天实测的约 1.4 倍。两个上限都是硬上限。
   */
  readonly digests: LayerBudget;
}

export interface RecallWeights {
  readonly recency: number;
  readonly salience: number;
  readonly relevance: number;
  readonly cue: number;
  readonly relationship: number;
}

export interface MemoryConfig {
  readonly dayMs: number;

  // ---------------------------------------------------------- 感知（§3.1）
  /** 室外感知半径，格。 */
  readonly perceptionRadius: number;
  /** 室内感知：同房间。房间判定由调用方给，这里只记口径。 */
  readonly indoorSameRoom: boolean;
  /** 视线是否被墙遮挡。 */
  readonly occlusion: boolean;

  // ---------------------------------------------------------- 显著度（§3.1）
  readonly salienceWeights: SalienceWeights;
  /** 角色性格对某一维的偏置上限，±0.10。 */
  readonly salienceBias: number;

  // ------------------------------------------------------ 写入与晋升（§3.1）
  readonly T_write: number;
  /**
   * 晋升日摘要的门槛。**0.60 是对的，日常场景够不着它——本轮用数据确认了这一点。**
   *
   * seed A、30 世界日、5 位居民，共 1156 条日层片段，显著度分布是：
   * `0.303 × 5`、`0.438 × 178`、`0.463 × 39`、`0.475 × 39`、`0.495 × 843`、
   * `0.499 × 26`、`0.503 × 26`。**p50 = p90 = 0.495，p99 = max = 0.5029**，
   * 主峰在 0.495（73%）。0.60 在整条分布之上，所以日常跑多久都不晋升。
   *
   * 那为什么不把它降到 0.50？因为 0.6 正好卡在两个真实档位之间：
   * - **听来的**（`sourceMode = 'heard'`，含转述）实测 0.575；
   * - **亲历且重要**（`importanceHint = 0.9` 的事故）实测 0.775。
   *
   * 降到 0.50 会把 0.575 那档全部晋升，而 `makeSummary` 写死
   * `sourceMode: 'witnessed'`、`sourceChain: []`（摘要是一条结论，不是一条转述）。
   * 实测：把阈值调到 0.5 后，v1/v2 的 heard 条目当场变成 `witnessed` 的 `long`
   * 摘要——传闻的来历与保真度整条消失，「听说的和我看见的不一样」这个冲突
   * 检测就再没有输入了。0.6 保住了这条边界：日常与传闻都留在 `day` 层，
   * 只有亲历的重要事才压成摘要，这正是补充设计 §3.1「至少两个维度突出才
   * 进 DaySummary」的数值位置。
   *
   * 结论（选项 b）：阈值不动，是**场景不够**——纯日常的 30 天里没有一件
   * 亲历的大事。压缩与归档的入口是否真的通，由
   * `test/memory-archive-reach.test.ts` 用「每 7 天一件亲历大事」的 90 天场景
   * 单独证明（promoted / summaries / archived 三个计数都必须非零）。
   */
  readonly T_promote: number;
  readonly T_flash: number;
  readonly weekLength: number;

  // ------------------------------------------------------ 遗忘与衰减（§3.1）
  readonly decayRate: number;
  readonly tierFactor: Readonly<Record<Tier, number>>;
  readonly T_forget: number;
  readonly boost: number;
  readonly pBlur: number;
  /** 重构性回忆放大情绪时的倍数，上限 1。 */
  readonly blurValenceGain: number;

  // ---------------------------------------------------------- 预算（§3.1）
  readonly budget: MemoryBudget;
  /** 条目层以外的六个库的预算（条数 + 字节）。 */
  readonly libraryBudget: LibraryBudget;
  /** 每个地点最多几层装饰。 */
  readonly placeTraceLayers: number;

  // ---------------------------------------------------------- 检索（§3.1）
  readonly recallWeights: RecallWeights;
  /** `recall()` 默认取几条。 */
  readonly budgetK: number;
  /** 对话注入取 Top-N。 */
  readonly dialogueTopK: number;

  // ---------------------------------------------------------- 传说（§3.1）
  readonly legendHolders: number;
  readonly legendDays: number;
  /**
   * 一件事要多重才**独占**一块碑。
   *
   * 协议 §12 写的是「反复讲述的**大事**」，而 `legendHolders`/`legendDays`
   * 只判「反复讲述」——一件被五个人讲满三天的闲话照样够格。这个数是那道
   * 「大事」的门槛，判在 `world.ts` 的 `formable()`，**不判在 `qualifies()`**：
   * 门槛只分栏，不闸嘴，够不着它的事照旧在信念与传闻里流动。
   *
   * 0.4 落在 `routine_done`（0.35，`observe.ts:50`）与 `task_done`（0.45，
   * `observe.ts:170`）之间：交付能单独立碑，闲话不能。
   *
   * **它单独用会把传说清到零。** 实测（`.tmp-audit/legend-census.ts`，2026-11-01，
   * 真设定集、1000ms 拍、8 个世界日）：35 条传说的 `max(importanceHint)`
   * 一律 0.35，全部来自 `routine_done`——0.4 以上一条都没有。所以门槛下面
   * 还有一层「闲话同日同地兜底」（`legend.ts` 的 `mergeByPlace`）：同一天同一个
   * 地点没有大事时，那一堆闲话并成一条。合起来的实测是第 4 天 22 → 15 条、
   * 8 天 35 → 27 条（2026-11-01 修痕迹之前的数；修完同一口径重测是 38 → 14、
   * 59 → 28，见 `docs/SETTING_DENGCHAO.md`）。
   */
  readonly legendImportanceFloor: number;
  /**
   * 一件事要多重才配给一个地点**改名**（协议 §11 的历史链）。
   *
   * 与 `legendImportanceFloor` 分开是刻意的：能立碑的事不一定说得出一个名字。
   * 0.6 正好是 `milestone` 的 hint（0.6，`observe.ts:73`）——
   * `celebration`（0.8）也在其上，而 `conflict`（0.55）落在其下：那张
   * `EPITHETS` 表说的是「这类事说得出称号」，这个数说的是「配不配」。
   * 判据在 `toponym.ts` 的 `epithetFor()`，调用点在 `world.ts` 的 `maybeRename()`。
   */
  readonly renameImportanceFloor: number;

  // ---------------------------------------------------- 传播通道（§3.2 A）
  readonly talkDistance: number;
  readonly talkTopicsPerChat: number;
  readonly talkTrustFloor: number;
  readonly talkSecretTrustFloor: number;
  readonly broadcastRadius: number;
  readonly broadcastMaxPosts: number;
  readonly broadcastConfidenceFloor: number;
  readonly letterClaims: number;
  readonly diaryClaimsPerDay: number;
  readonly traceRadius: number;
  readonly traceExposedLayers: number;

  // ---------------------------------------------------- 传播护栏（§3.2 B）
  readonly maxFanout: number;
  readonly pairCooldownDays: number;
  readonly chatCooldownDays: number;
  readonly maxHops: number;
  readonly hopDetailLoss: number;
  readonly hopConfidenceFactor: number;
  readonly hopValenceGain: number;

  // ---------------------------------------------------- 求证闭环（§1.1）
  readonly verifyImpulseThreshold: number;
  readonly credibilityPenalty: number;
  /** 判定「同地点同日的高置信度记忆」的门槛。 */
  readonly highConfidence: number;

  // ---------------------------------------------------------- 心电图（§2.3）
  /** 心电图回看几天。 */
  readonly vitalsWindowDays: number;
  /** 孤立单位判定：连续几天没有任何 ClaimTold。 */
  readonly isolatedDays: number;

  // ---------------------------------------------- 场景记忆（地标 / 时代 / 史诗）
  /** 拆掉之后多少天没有重建，就从「刚拆」变成「废墟」。 */
  readonly ruinAfterDays: number;
  /** 一个时代至少多少天。短于它的波动不切段。 */
  readonly eraMinDays: number;
  /** 时代切段：效价相对段首偏移多少算一次转折。 */
  readonly eraValenceShift: number;
  /** 时代切段：孤立人数相对段首变化占人口多少算一次转折。 */
  readonly eraIsolationShare: number;
  /** 时代切段：楼的数量相对段首增减多少比例算一次转折。 */
  readonly eraBuildingShare: number;
  /**
   * 史诗的「重要」门槛。
   *
   * 0.55 = `building.removed` 的 hint，也是 `conflict` 的 hint。门槛压在
   * 0.55 上，是为了让**拆楼**够得着——它是日常事件里唯一不可逆到 1 的
   * （`epic.ts` 的 `irreversibilityOf`）。一次口角的 hint 也是 0.55，
   * 但它不可逆性 0，最高只到 `legend` 档，不会因为门槛低就混进史诗。
   */
  readonly epicImportanceFloor: number;
  /** 开天辟地档的重要度门槛：与 `celebration`（0.8）对齐。 */
  readonly epicFoundingImportance: number;
  /** 世界级（epic）要求覆盖多少人（占人口比例）。 */
  readonly epicReachShare: number;
  /** 开天辟地档（founding）要求覆盖多少人。 */
  readonly epicFoundingReachShare: number;
  /** 够格「legend」档要求事件被多少人知道（占人口比例）。 */
  readonly epicPopulationShare: number;
}

/** v1.0 §3.1 / §3.2 的定稿初值。改任何一项都该顺手改它上面那行的出处注释。 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  dayMs: DAY_MS,

  // §3.1 感知模型：室外 8 格 / 室内同房间，视线受墙体遮挡。
  perceptionRadius: 8,
  indoorSameRoom: true,
  occlusion: true,

  // §3.1 显著度权重：默认各 0.25，四项和恒为 1。
  salienceWeights: { emotion: 0.25, surprise: 0.25, goalRelevance: 0.25, involvement: 0.25 },
  salienceBias: 0.1,

  // §3.1 写入与晋升。T_promote 保持 0.60：理由见 `MemoryConfig.T_promote`。
  T_write: 0.3,
  T_promote: 0.6,
  T_flash: 0.85,
  weekLength: 7,

  // §3.1 遗忘与衰减：day 层配合 T_forget 恰好 12 天归档。
  decayRate: 0.15,
  tierFactor: { day: 1.0, long: 0.3, legend: 0.05 },
  T_forget: 0.15,
  boost: 0.25,
  pBlur: 0.2,
  blurValenceGain: 1.15,

  // §3.1 各层容量预算（条数 + 字节）。取值与推导见接口注释。
  budget: {
    day: 16,
    daySummary: 5,
    long: 64,
    impression: 32,
    legend: 24,
    bytes: { day: 12_000, long: 32_000, legend: 16_000, impression: 8_000 },
  },
  // 六个无条目层的库。稳态容量按 90 天口径标定（见 REPORT 的「预算表」）。
  libraryBudget: {
    facts: { count: 1_200, bytes: 350_000 },
    claims: { count: 800, bytes: 230_000 },
    beliefs: { count: 1_400, bytes: 165_000 },
    cooldowns: { count: 1_000, bytes: 60_000 },
    tells: { count: 1_000, bytes: 55_000 },
    written: { count: 200, bytes: 200_000 },
    // SOAK-BUG-5 的余量处理：20 KB 时 90 天实测 19.6 KB（100.5%），再刻一条就
    // 连锁淘汰。提到 28 KB 的代价实测：末存档 +4.21 KB（seed A）/ +2.49 KB（seed B），
    // 尾段日增 +0.05 / +0.00 KB/天（条数上限 120 先卡住）。离 1800 KB 尚有
    // 174.5 / 227.5 KB，不逼近，因此动上限，不加第三条排序项。
    legends: { count: 120, bytes: 28_000 },
    digests: { count: 120, bytes: 160_000 },
  },
  placeTraceLayers: 5,

  // §3.1 检索打分权重；budget_k 默认 5，对话注入 Top-3。
  recallWeights: { recency: 0.2, salience: 0.25, relevance: 0.25, cue: 0.2, relationship: 0.1 },
  budgetK: 5,
  dialogueTopK: 3,

  // §3.1 传说形成条件。
  legendHolders: 5,
  legendDays: 3,
  // §12「大事」+ §3 collective 行 + A 段实测。理由与实测数见接口那一行。
  legendImportanceFloor: 0.4,

  // §11 改名判据。0.6 = `milestone` 的 hint；`conflict`（0.55）因此够不着。
  renameImportanceFloor: 0.6,

  // §3.2 A 五类通道。
  talkDistance: 2,
  talkTopicsPerChat: 2,
  talkTrustFloor: -0.2,
  talkSecretTrustFloor: 0.7,
  broadcastRadius: 4,
  broadcastMaxPosts: 5,
  broadcastConfidenceFloor: 0.9,
  letterClaims: 1,
  diaryClaimsPerDay: 3,
  traceRadius: 3,
  traceExposedLayers: 3,

  // §3.2 B 护栏。
  maxFanout: 3,
  pairCooldownDays: 1,
  chatCooldownDays: 0.25,
  maxHops: 3,
  hopDetailLoss: 1,
  hopConfidenceFactor: 0.8,
  hopValenceGain: 1.1,

  // §1.1 求证闭环。
  verifyImpulseThreshold: 0.45,
  credibilityPenalty: 0.15,
  highConfidence: 0.8,

  // §2.3 心电图。
  vitalsWindowDays: 3,
  isolatedDays: 3,

  // 场景记忆。取值理由见每一项的接口注释；这里只列数。
  //
  // 3 天：拆楼当天与第二天都还是「刚拆」，第三天开始「荒废」——比花环的
  // 3 天风化短得多，比「当天就成废墟」留出足够长的一段「刚拆」可读。
  ruinAfterDays: 3,
  // 30 天：短于一个月的起伏不该长成一个时代。设计文档 §2.3 定的最短段长。
  eraMinDays: 30,
  eraValenceShift: 0.25,
  eraIsolationShare: 0.3,
  eraBuildingShare: 0.2,
  // 0.55 = `building.removed` / `conflict` 的 hint；与 `legendImportanceFloor`
  // （0.4）分工不同：那个数判「配不配立碑」，这个数判「配不配叫史诗」。
  epicImportanceFloor: 0.55,
  epicFoundingImportance: 0.8,
  epicReachShare: 0.5,
  epicFoundingReachShare: 0.7,
  epicPopulationShare: 0.5,
};

/** 按 Holder 性格微调显著度权重，四项重新归一化到 1。
 *
 * 偏置只加在指定维度上，加完再归一——否则「性格偏置 ±0.10」会让四项和变成
 * 1.1 或 0.9，而显著度是个 0..1 的量，和不为 1 的权重算出来的东西没有上界。
 */
export function weightsFor(
  base: SalienceWeights,
  bias: Partial<SalienceWeights> | undefined,
  cap: number,
): SalienceWeights {
  if (bias === undefined) return base;
  const clamp = (value: number): number => Math.min(cap, Math.max(-cap, value));
  const raw = {
    emotion: base.emotion + clamp(bias.emotion ?? 0),
    surprise: base.surprise + clamp(bias.surprise ?? 0),
    goalRelevance: base.goalRelevance + clamp(bias.goalRelevance ?? 0),
    involvement: base.involvement + clamp(bias.involvement ?? 0),
  };
  const sum = raw.emotion + raw.surprise + raw.goalRelevance + raw.involvement;
  // 权重恒为正（初值 0.25，偏置上限 0.10），和不会是 0；仍然兜一下，
  // 免得将来有人把初值调成 0 时这里除出 NaN 而显著度静默变成 NaN。
  if (sum <= 0) return base;
  return {
    emotion: raw.emotion / sum,
    surprise: raw.surprise / sum,
    goalRelevance: raw.goalRelevance / sum,
    involvement: raw.involvement / sum,
  };
}
