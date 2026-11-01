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
 * 一条候选里最重的那件事有多重。
 *
 * 「反复讲述」与「是件大事」是两个问题：`qualifies` 只回答前一个。一件被五个
 * 人讲满三天的闲话照样够格，而碑上该刻的是大事——协议 §12 的原话是「反复讲述的
 * **大事**」。
 *
 * `importanceOf` 由调用方给（`world.ts` 从 `facts` 里查），这个文件不碰事件库。
 *
 * **查不到的那件事按 0 计。** 事件被回收之后它的重量就无从谈起，而「查不到多重」
 * 不该被读成「很重」——那会让回收本身变成一次抬举。
 */
export function maxImportance(
  candidate: LegendCandidate,
  importanceOf: (eventRef: string) => number,
): number {
  let max = 0;
  for (const eventRef of candidate.eventRefs) {
    const hint = importanceOf(eventRef);
    if (hint > max) max = hint;
  }
  return max;
}

/**
 * 同一天、同一地点的闲话并成一条。
 *
 * 裁决（用户定）：「大事优先，闲话同日同地兜底」。够得着 `legendImportanceFloor`
 * 的大事各立各的碑；同一天同一个地点若**没有**大事，那一堆闲话并成一块碑，
 * 而不是每件小事一块。同一个地点**有**大事时，那天的闲话不立——大事已经替
 * 那个地点说过话了，这是调用方（`world.ts` 的 `formable()`）剪的，不在这个
 * 函数里：一个纯归并函数不该知道门槛是多少。
 *
 * 为什么非并不可：实测（`.tmp-audit/legend-census.ts`，8 个世界日）灯潮界的
 * 35 条传说里，第 4 天关账时一次立起 22 条，全部是 `routine_done` 的闲话，
 * `max(importanceHint)` 一律 0.35。22 块碑同时压下来，那不是「世界共识」，
 * 那是一面流水账。按地点归并后第 4 天剩 15 条、8 天剩 27 条——这一组是 2026-11-01
 * 修痕迹之前的数；修完（`recurrence` 数事件、地标 Holder 落地）同一口径重测是
 * 59 → 28、第 4 天 38 → 14，见 `docs/SETTING_DENGCHAO.md` 的「传说与碑」。
 *
 * **只并同一次关账里的候选，不回头并已经立好的传说。** `Legend` 形成即定格：
 * 后来的事在同一个地点再立新的（碑按 `reach` 排它们）。回溯改写会让
 * 「回放一致」（§16）变成要比较历史版本的东西——同一天同一个世界跑两遍，
 * 第二次的碑文与第一次不一样，而它们本该逐字节相同。
 *
 * 合并口径：`eventRefs` 取并集（非空性天然保住）、`holders` 并集去重排序、
 * `variants` 按世界给出的顺序拼接去重、`firstDay` 取最小；`valence`/`arousal`
 * 取并集中**最重**那件事的，与 `candidatesFrom` 同一口径（那两列是从事件的
 * kind 取的，不是从信念取的）。一样重时取先遇到的——`candidatesFrom` 的顺序
 * 是确定的，所以这里也是确定的。
 */
export function mergeByPlace(
  candidates: readonly LegendCandidate[],
  importanceOf: (eventRef: string) => number,
): LegendCandidate[] {
  const order: string[] = [];
  const buckets = new Map<string, LegendCandidate[]>();
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.homePlaceId);
    if (bucket === undefined) {
      buckets.set(candidate.homePlaceId, [candidate]);
      order.push(candidate.homePlaceId);
    } else {
      bucket.push(candidate);
    }
  }
  return order.map((placeId) => mergeGroup(buckets.get(placeId)!, importanceOf));
}

/** 一个地点的一组候选并成一条。单条时原样返回——没有闲话可并的日子不该被改写。 */
function mergeGroup(
  group: readonly LegendCandidate[],
  importanceOf: (eventRef: string) => number,
): LegendCandidate {
  if (group.length === 1) return group[0]!;

  const eventRefs: string[] = [];
  const holders = new Set<string>();
  const variants: string[] = [];
  let firstDay = Number.POSITIVE_INFINITY;
  let heaviest = group[0]!;
  let heaviestWeight = -1;
  for (const candidate of group) {
    for (const ref of candidate.eventRefs) {
      if (!eventRefs.includes(ref)) eventRefs.push(ref);
    }
    for (const holder of candidate.holders) holders.add(holder);
    for (const variant of candidate.variants) {
      if (!variants.includes(variant)) variants.push(variant);
    }
    if (candidate.firstDay < firstDay) firstDay = candidate.firstDay;
    const weight = maxImportance(candidate, importanceOf);
    if (weight > heaviestWeight) {
      heaviest = candidate;
      heaviestWeight = weight;
    }
  }
  return {
    // 组非空、每条候选至少一个事件引用，所以并集非空。
    eventRefs: eventRefs as unknown as [string, ...string[]],
    holders: [...holders].sort(),
    firstDay,
    variants,
    homePlaceId: heaviest.homePlaceId,
    valence: heaviest.valence,
    arousal: heaviest.arousal,
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
 * `DEFAULT_ASSISTANT_NAME`）；灯潮界今天声明 7 个（曾经 2 个）。原写「两个设定集都只有 2 个村民」，
 * 听着像两份包各自写了 2 个，其实是「一份写了 0 个、另一份写了 2 个」。
 *
 * 也别把「两人」当成这个世界的定律：loader 只要求至少 1 个且不重名，没有上限
 * （`settings/load.ts`）——灯潮界今天就是 7 人，「一半人口」不再是 1 个人，
 * 这条注释的力道要重新掂量（7 人时一天没人讲，只是 1/7 沉默）。
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
