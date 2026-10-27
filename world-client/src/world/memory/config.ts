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

/** 各层容量预算。v1.0 §3.1「各层容量预算」。 */
export interface MemoryBudget {
  /** 当日片段。 */
  readonly day: number;
  /** 每日摘要条数。 */
  readonly daySummary: number;
  /** 长期层。 */
  readonly long: number;
  /** 对他人的印象。 */
  readonly impression: number;
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

  // §3.1 写入与晋升。
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

  // §3.1 各层容量预算。
  budget: { day: 16, daySummary: 5, long: 64, impression: 32 },
  placeTraceLayers: 5,

  // §3.1 检索打分权重；budget_k 默认 5，对话注入 Top-3。
  recallWeights: { recency: 0.2, salience: 0.25, relevance: 0.25, cue: 0.2, relationship: 0.1 },
  budgetK: 5,
  dialogueTopK: 3,

  // §3.1 传说形成条件。
  legendHolders: 5,
  legendDays: 3,

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
