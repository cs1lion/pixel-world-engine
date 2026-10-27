/** 集体记忆：传说。
 *
 * 协议第 12 节：同一事件的断言被至少 X 个 Holder 持有，且持续至少 Y 天，
 * 形成传说。补充设计 §3.1 定稿 `X = 5`、`Y = 3`。
 *
 * 「靠传播维持，无人讲则淡去」是传说与摘要的根本差别：摘要一旦写下就一直在，
 * 传说是活的，它的 `reach` 会掉。掉到阈值以下就淡去——但**淡去不是删除**，
 * 它降到 `legend` 层之后衰减系数只有 0.05，能撑很久。
 *
 * 传说的内容同样只能来自 `event_refs`：`variants` 是不同讲法，每一版都必须
 * 能追到同一组事件。加一条没有出处的讲法，就是把传说变成了虚构。
 */

import type { MemoryConfig } from './config.ts';
import type { Belief, Claim, Legend } from './types.ts';

/** 一条候选：某个事件的断言被谁持有着。 */
export interface LegendCandidate {
  readonly eventRefs: readonly [string, ...string[]];
  readonly holders: readonly string[];
  readonly firstDay: number;
  readonly variants: readonly string[];
  readonly homePlaceId: string;
  /** 事件的情绪。刻在碑上的那一笔也得有情绪，不然它只是一行字。 */
  readonly valence: number;
  readonly arousal: number;
}

/**
 * 从信念库里挑出够格的候选。
 *
 * 「被持有」按 `eventRefs` 归并：同一件事的不同说法算同一个候选——
 * 这正是传说该有的样子（一个事件，几种讲法）。
 *
 * 只看**非辟谣**的信念：一个被证伪的说法不能长成传说，否则辟谣就白做了。
 */
export function candidatesFrom(
  beliefs: readonly Belief[],
  claims: ReadonlyMap<string, Claim>,
): LegendCandidate[] {
  const byEvent = new Map<
    string,
    { holders: Set<string>; days: number[]; variants: string[]; placeId: string; valence: number; arousal: number }
  >();
  for (const belief of beliefs) {
    if (belief.state === 'debunked') continue;
    const claim = claims.get(belief.claimId);
    if (claim === undefined) continue;
    const key = [...belief.eventRefs].sort().join(',');
    const bucket = byEvent.get(key) ?? {
      holders: new Set<string>(),
      days: [],
      variants: [],
      placeId: claim.content.where,
      // 同一事件的几条断言共用一个事件的情绪（`contentForFact` 从 kind 取），
      // 所以取先见到的那条就够，不存在「挑哪条」的问题。
      valence: claim.content.valence,
      arousal: claim.content.arousal,
    };
    bucket.holders.add(belief.holderId);
    bucket.days.push(belief.learnedDay);
    if (!bucket.variants.includes(claim.content.what)) bucket.variants.push(claim.content.what);
    byEvent.set(key, bucket);
  }

  const candidates: LegendCandidate[] = [];
  for (const [key, bucket] of byEvent) {
    candidates.push({
      eventRefs: key.split(',') as unknown as [string, ...string[]],
      holders: [...bucket.holders].sort(),
      firstDay: Math.min(...bucket.days),
      variants: bucket.variants,
      homePlaceId: bucket.placeId,
      valence: bucket.valence,
      arousal: bucket.arousal,
    });
  }
  return candidates;
}

/**
 * 够不够格成为传说。
 *
 * 两个条件都要满足：`holders >= X` 且「持续」`>= Y` 天。
 *
 * 「持续」判的是 `nowDay - firstDay >= Y`。这里没有「连续」的检查——
 * 一个人第五天听说了、第六天又忘了，仍然算持续，因为信念没有「忘掉」这个
 * 动作，只有「被辟谣」。真要做连续性，得先有一条信念失效的规则，
 * 而本组没有发明它。
 */
export function qualifies(candidate: LegendCandidate, nowDay: number, config: MemoryConfig): boolean {
  return (
    candidate.holders.length >= config.legendHolders &&
    nowDay - candidate.firstDay >= config.legendDays
  );
}

/** 形成一条传说。`legendId` 由调用方给（世界内自增）。 */
export function formLegend(
  legendId: string,
  candidate: LegendCandidate,
  nowDay: number,
): Legend {
  return {
    legendId,
    eventRefs: candidate.eventRefs,
    variants: candidate.variants,
    reach: candidate.holders.length,
    homePlaceId: candidate.homePlaceId,
    formedDay: nowDay,
  };
}

/**
 * 传说淡去：无人复述则 reach 下降。
 *
 * 每天掉 1，因为「一天里没有一个人讲过它」在两人的世界里是很强的信号：
 * 一个人不讲就是一半的人口沉默了。
 *
 * 那两个人是这么来的：莞尔镇的包**一个村民都不声明**（`villagers: []`），
 * 运行时由 `Simulation` 补上默认的两个名字（`villagerName` 与
 * `DEFAULT_ASSISTANT_NAME`）；灯潮界声明 2 个。原写「两个设定集都只有 2 个村民」，
 * 听着像两份包各自写了 2 个，其实是「一份写了 0 个、另一份写了 2 个」。
 *
 * 也别把「两人」当成这个世界的定律：loader 只要求至少 1 个且不重名，没有上限
 * （`settings/load.ts`）——写一份 5 人以上的包就进得了 5–10 人的世界，那时
 * 「一半人口」不再是 1 个人，这条注释的力道要重新掂量。
 *
 * 掉到 `reach <= 1` 就不再是传说——一个人记得的事是私事，不是集体记忆。
 */
export function decayLegend(legend: Legend): Legend {
  return { ...legend, reach: Math.max(0, legend.reach - 1) };
}

export function faded(legend: Legend): boolean {
  return legend.reach <= 1;
}

/**
 * 传说被复述一次。
 *
 * 只在有人真的把它讲出去时调用——那是唯一能让传说活下去的动作。
 * 这一条让「靠传播维持」不是一句形容：不调用它，传说就会自己淡掉。
 */
export function reinforceLegend(legend: Legend, listeners: number): Legend {
  return { ...legend, reach: legend.reach + Math.max(0, listeners) };
}
