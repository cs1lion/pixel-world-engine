/** 记忆 → 一句她说得出口的话。
 *
 * 这是读侧的最后一步：`recall.ts` 捞回 Top-k，这里把它们变成能摆到屏幕上的句子。
 * 只消费检索结果（`RecallHit` = 条目 + 分数），**不碰记忆库**——协议第 10 节
 * 「表现层只消费，不直接读记忆库」的那条路，落点在这里。
 *
 * 两条纪律：
 *
 * 1. **`content.what` 原样用，不改写。** 那句话是世界自己组织好的
 *    （「汐在旧站牌下认路」「潮水退过一半，滩涂露出来了」），改写就是造事实——
 *    而「重构性回忆不得新增事实」是有验收的（`isSubsetFacts`）。
 * 2. **不调模型。** 检索与渲染都是 0 次模型调用（补充设计 §0）；渲染要性格与
 *    关系，这两样东西世界里都还没有，所以这一版只做「把她记得的那句摆出来」，
 *    不假装有口吻。
 */

import type { RecallHit } from './recall.ts';

export interface MemoryLine {
  readonly memoryId: string;
  /** 世界写下的那句话，原样。 */
  readonly text: string;
  /** 「今天 / 昨天 / N 天前」。 */
  readonly age: string;
}

/** 距今多少天，说成人话。负数按今天算——时钟不该倒着走，真倒了也不必编。 */
export function ageLabel(days: number): string {
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

/**
 * 一次检索的结果 → 她要说的那几句。顺序就是检索的顺序（分数降序），不重排：
 * 排在前面的就是她此刻最先想起来的。
 */
export function memoryVoice(hits: readonly RecallHit[], nowDay: number): readonly MemoryLine[] {
  return hits.map((hit) => ({
    memoryId: hit.entry.memoryId,
    text: hit.entry.content.what,
    age: ageLabel(nowDay - hit.entry.createdDay),
  }));
}
