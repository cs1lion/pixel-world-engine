/** 显著度与写入路径：一条事件值不值得记、记成什么。
 *
 * 协议第 6 节的三步，全部由规则算，**写入路径不调模型**：
 *
 * 1. 按 Holder profile 的权重把四个分量折成 `salience`；
 * 2. `salience >= T_write` 才写入 Episode，否则丢弃；
 * 3. 极高显著度（`T_flash`）标成闪光灯记忆，永不衰减。
 *
 * 为什么显著度要拆成四个分量而不是一个「重要度」：`T_promote` 的定稿理由是
 * 「至少两个维度表现突出」（补充设计 §3.1）。一个合成分数说不出这件事，
 * 四个分量说得出——于是晋升判定可以要求「有两项过 0.5」，而不是「总分够高」。
 */

import type { SalienceWeights } from './config.ts';
import type { MemoryContent } from './types.ts';

/**
 * 显著度的四个输入，全部 0..1。
 *
 * - `emotion`：这件事有多动情绪（`|valence|` 与 `arousal` 合成）。
 * - `surprise`：多出乎意料。
 * - `goalRelevance`：和这个 Holder 想做的事有多相关。
 * - `involvement`：他自己卷入多深（是不是当事人）。
 */
export interface SalienceInputs {
  readonly emotion: number;
  readonly surprise: number;
  readonly goalRelevance: number;
  readonly involvement: number;
}

export interface SalienceResult {
  readonly salience: number;
  readonly parts: SalienceInputs;
  /** 有几项过了 0.5。晋升与闪光灯都看它。 */
  readonly strongParts: number;
}

/** 加权求和。权重已由 `weightsFor` 归一化到 1，所以结果天然落在 0..1。 */
export function salienceOf(parts: SalienceInputs, weights: SalienceWeights): SalienceResult {
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
  const emotion = clamp01(parts.emotion);
  const surprise = clamp01(parts.surprise);
  const goalRelevance = clamp01(parts.goalRelevance);
  const involvement = clamp01(parts.involvement);

  const salience = clamp01(
    weights.emotion * emotion +
      weights.surprise * surprise +
      weights.goalRelevance * goalRelevance +
      weights.involvement * involvement,
  );
  const strongParts = [emotion, surprise, goalRelevance, involvement].filter((part) => part > 0.5).length;
  return { salience, parts: { emotion, surprise, goalRelevance, involvement }, strongParts };
}

/**
 * 从事件形状推出四个分量。
 *
 * 这是**规则**，不是模型判断：输入是事件自带的字段（importance hint、是否当事人、
 * outcome 里的情绪词），输出是四个数。没有 `importanceHint` 时退到按 kind 的
 * 默认表，表在 `kindPrior` 里。
 *
 * 为什么按 kind 给先验而不是按 outcome 的文本猜：世界不知道「炸炉了」这四个字
 * 有多严重，但它知道 `workshop_accident` 这一类事通常有多严重。文本理解属于
 * 模型，而写入路径不许调模型。
 */
export function inputsFor(input: {
  readonly kind: string;
  readonly holderId: string;
  readonly actors: readonly string[];
  readonly importanceHint: number | null;
  readonly valence: number;
  readonly arousal: number;
}): SalienceInputs {
  const prior = kindPrior(input.kind);
  const involved = input.actors.includes(input.holderId);
  const hint = input.importanceHint;
  return {
    // 情绪：情绪强度与唤醒度各占一半，取绝对值——大喜与大悲同样显著。
    emotion: Math.min(1, (Math.abs(input.valence) + input.arousal) / 2),
    surprise: hint === null ? prior.surprise : Math.max(prior.surprise, hint),
    goalRelevance: prior.goalRelevance,
    involvement: involved ? 1 : prior.involvement,
  };
}

/** 按事件类型给的先验。没列出的 kind 用 `unknown` 那一行。 */
function kindPrior(kind: string): SalienceInputs {
  return KIND_PRIORS[kind] ?? KIND_PRIORS.unknown!;
}

/**
 * 事件类型 → 先验显著度。
 *
 * 这张表是**开放的**：造物主（任务组 B）会注入 `visitor_arrival`、
 * `weather_anomaly`、`tavern_feast` 这类 kind（补充设计 §2.3），它们的先验
 * 由这里给，不由生成逻辑给。表里没有的 kind 落 `unknown`，显著度不高不低——
 * 新事件类型不会因为没人登记就被静默丢掉，也不会因为登记得晚就突然霸屏。
 */
const KIND_PRIORS: Readonly<Record<string, SalienceInputs>> = {
  // 事故与冲突：情绪与意外都高。
  workshop_accident: { emotion: 0.8, surprise: 0.8, goalRelevance: 0.4, involvement: 0.2 },
  conflict: { emotion: 0.75, surprise: 0.6, goalRelevance: 0.4, involvement: 0.2 },
  // 里程碑与庆典：情绪高、意外中等。
  celebration: { emotion: 0.8, surprise: 0.5, goalRelevance: 0.5, involvement: 0.3 },
  milestone: { emotion: 0.7, surprise: 0.4, goalRelevance: 0.7, involvement: 0.2 },
  // 日常交付：参与感有，意外很低。
  task_done: { emotion: 0.35, surprise: 0.2, goalRelevance: 0.5, involvement: 0.3 },
  expedition_done: { emotion: 0.45, surprise: 0.35, goalRelevance: 0.6, involvement: 0.3 },
  // 神谕相关：仪式感强，但当事人之外的人意外度不高。
  oracle_prayer: { emotion: 0.4, surprise: 0.45, goalRelevance: 0.35, involvement: 0.2 },
  discipline: { emotion: 0.6, surprise: 0.5, goalRelevance: 0.5, involvement: 0.2 },
  // 造物主注入的两类（§2.3）。
  visitor_arrival: { emotion: 0.5, surprise: 0.8, goalRelevance: 0.4, involvement: 0.15 },
  weather_anomaly: { emotion: 0.6, surprise: 0.85, goalRelevance: 0.3, involvement: 0.1 },
  tavern_feast: { emotion: 0.85, surprise: 0.4, goalRelevance: 0.4, involvement: 0.35 },
  unknown: { emotion: 0.3, surprise: 0.3, goalRelevance: 0.3, involvement: 0.2 },
};

/** 这个 Holder 该不该记下这条事件。 */
export interface WriteDecision {
  readonly write: boolean;
  readonly salience: SalienceResult;
}

export function decideWrite(
  weights: SalienceWeights,
  parts: SalienceInputs,
  threshold: number,
): WriteDecision {
  const salience = salienceOf(parts, weights);
  return { write: salience.salience >= threshold, salience };
}

/**
 * 这次回忆该不该变形（重构性回忆，协议第 8 节）。
 *
 * 变形只有两种，都**不新增事实**：
 * - 细节降一级；
 * - 情绪幅度放大（`|valence| × gain`，封顶 1）。
 *
 * `p_blur` 命中后选哪一种由种子决定，不由调用方挑——否则「降级还是放大」
 * 就成了一个可以调参的自由度，而它不该是。
 */
export interface BlurResult {
  readonly content: MemoryContent;
  readonly mutation: 'detail' | 'valence' | null;
}

export function blurOnRecall(
  content: MemoryContent,
  seed: number,
  pBlur: number,
  valenceGain: number,
  roll: (seed: number, p: number) => boolean,
): BlurResult {
  if (!roll(seed, pBlur)) return { content, mutation: null };
  // 细节还能降就降级；已经到 0 了才改放大情绪。两个都做不了就什么也不发生。
  if (content.detailLevel > 0) {
    return {
      content: { ...content, detailLevel: content.detailLevel - 1 },
      mutation: 'detail',
    };
  }
  const amplified = clampSigned(content.valence * valenceGain);
  if (amplified === content.valence) return { content, mutation: null };
  return { content: { ...content, valence: amplified }, mutation: 'valence' };
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** 回忆强化：`strength ← strength + boost × (1 − strength)`。 */
export function boostStrength(strength: number, boost: number): number {
  return Math.min(1, strength + boost * (1 - strength));
}

/**
 * 日衰减：`strength ← strength × (1 − decayRate × tierFactor)`。
 *
 * 闪光灯与固定（pinned）不衰减——这是「闪光灯记忆永久」那一条。
 * place 的痕迹不走这里，痕迹靠风化降可见度。
 */
export function decayStrength(
  strength: number,
  decayRate: number,
  tierFactor: number,
  exempt: boolean,
): number {
  if (exempt) return strength;
  return Math.max(0, strength * (1 - decayRate * tierFactor));
}
