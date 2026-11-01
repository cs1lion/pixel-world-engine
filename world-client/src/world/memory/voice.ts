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
import type { MemoryEntry } from './types.ts';

/**
 * 这条记忆是从谁那儿来的。
 *
 * 两种，因为世界里真的只有两种：
 *
 * - `person`：一个具体的人告诉她的。`name` 是查到的名字，`null` 是**查不到**——
 *   那个人可能被拆了、可能不在这张图上。查不到就照实说，不拿内部编号当人名。
 * - `everyone`：没有具体的人。今天只有碑文是这一种（`world.ts` 的 `inscribe`
 *   写 `sourceMode: 'heard'`、`sourceChain: []`，注释原话是「碑文的来历是
 *   『大家都这么说』，不是某一个人告诉我的」）。
 */
export type HeardFrom =
  | { readonly kind: 'person'; readonly name: string | null }
  | { readonly kind: 'everyone' };

export interface MemoryLine {
  readonly memoryId: string;
  /** 世界写下的那句话，原样。 */
  readonly text: string;
  /** 「今天 / 昨天 / N 天前」。 */
  readonly age: string;
  /** 听来的才有来源。亲历、读到、从痕迹推出来的都是 `null`——它们没有「谁说的」。 */
  readonly heardFrom: HeardFrom | null;
}

/**
 * 这条记忆从谁那儿来。不是听来的就返回 `null`。
 *
 * 取 `sourceChain` 的**最后一节**。依据在 `world.ts` 的 `toldChainOf`：
 * 它返回 `[claimId, ...上游, 讲的人]`——说话人排在最末，所以末节就是直接前手，
 * 不是最初的源头。要源头得往前翻，而「她是从谁那儿听来的」问的正是前手。
 *
 * 空链不算「查不到的人」：`sourceChain` 只在这两种地方产生，`rememberTold`
 * 永远至少两节（`claimId` + 讲的人），空链只可能是 `inscribe` 的碑文。
 */
export function heardFromOf(
  entry: MemoryEntry,
  nameOf: (holderId: string) => string | null,
): HeardFrom | null {
  if (entry.sourceMode !== 'heard') return null;
  const tail = entry.sourceChain[entry.sourceChain.length - 1];
  if (tail === undefined) return { kind: 'everyone' };
  return { kind: 'person', name: nameOf(tail) };
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
export function memoryVoice(
  hits: readonly RecallHit[],
  nowDay: number,
  /** 把 holderId 翻成人名。不给就一律查不到——那会读成「从一个不在这张图上的人听来」。 */
  nameOf: (holderId: string) => string | null = () => null,
): readonly MemoryLine[] {
  return hits.map((hit) => ({
    memoryId: hit.entry.memoryId,
    text: hit.entry.content.what,
    age: ageLabel(nowDay - hit.entry.createdDay),
    heardFrom: heardFromOf(hit.entry, nameOf),
  }));
}
