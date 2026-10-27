/** 日终整理：一天结束，把当日片段压成摘要，衰减、晋升、归档。
 *
 * 协议第 7 节由 `DayClosed` 触发，对每个 Holder 依次执行。这里的实现**全部走规则**，
 * 不调模型：日摘要用模板，重要角色的模型摘要留给上游（本组只预留 `generatedBy.by = 'llm'`
 * 的位置与预算，不实现调用）。
 *
 * 为什么整理必须按 Holder 独立做：记忆是主观视图。两个人看同一场事故，一个
 * 记得「三号房的灯灭了」，另一个只记得「有人喊了一声」——摘要不能合成一份，
 * 那等于把「谁记得什么」抹平。
 *
 * 整理是幂等的（协议第 16 节）：同一天对同一个 Holder 重复整理，结果相同。
 * 靠的是「只整理 `tier === 'day'` 且 `createdDay === day` 的条目」这条边界——
 * 整理过的条目会变成 `summary` 或降到 `long`，不会再被收进来。
 */

import type { MemoryConfig } from './config.ts';
import { decayStrength } from './salience.ts';
import { seedOf } from './seed.ts';
import type { MemoryEntry, MemoryContent, WorldFact } from './types.ts';

/** 一次整理的结果。`stats` 原样进 `MemoryConsolidated` 事件。 */
export interface ConsolidationResult {
  readonly entries: readonly MemoryEntry[];
  readonly stats: {
    readonly collected: number;
    readonly summarized: number;
    readonly promoted: number;
    readonly archived: number;
    readonly dropped: number;
  };
}

/**
 * 整理一个 Holder 在 `day` 这一天的一切。
 *
 * 顺序是刻意的，换一下就会算出不同的结果：
 * 1. 先挑（`T_promote`）——挑之前不衰减，否则一条刚好在门槛上的记忆会因为
 *    这次衰减而落选，而它本应被记住。
 * 2. 生成摘要（模板，只引用 eventRefs 里真有的事实）。
 * 3. 衰减当日之外的全部条目。
 * 4. 归档低于 `T_forget` 的条目。
 * 5. 预算裁剪。
 *
 * **`T_promote` 的定稿理由还有半句没兑现。** 补充设计 §3.1 那张表写着
 * 「需至少两个维度表现突出（如高参与+高情绪）才进入 `DaySummary`」，而这里
 * 只看了 `salience >= T_promote`。`strongParts`（四项里过 0.5 的个数）在
 * `salienceOf` 里算得出来，但**没有一个消费者读它**，`MemoryEntry` 也没存
 * 它——要兑现就得给条目加一列，那是 schema 变更，不塞进这次改动里。
 * 差距是窄的：均匀权重下 `salience >= 0.6` 要求四项之和 ≥ 2.4，而只有一项
 * 过 0.5 时最多也就 1 + 0.5 × 3 = 2.5，正好压在线上。也就是说这条规则今天
 * 只影响「一项顶天、其余恰好半边」的那一档，不影响别的一切。
 */
export function consolidateHolder(
  holderId: string,
  entries: readonly MemoryEntry[],
  day: number,
  config: MemoryConfig,
  facts: ReadonlyMap<string, WorldFact>,
): ConsolidationResult {
  const mine = entries.filter((entry) => entry.holderId === holderId);
  const others = entries.filter((entry) => entry.holderId !== holderId);

  const todays = mine.filter(
    (entry) => entry.tier === 'day' && entry.kind === 'episodic' && entry.createdDay === day,
  );
  // 按 id 判定，不按对象引用：读档回来的条目是新对象，`includes` 认不出来。
  const todayIds = new Set(todays.map((entry) => entry.memoryId));
  const rest = mine.filter((entry) => !todayIds.has(entry.memoryId));

  // 1. 挑：显著度过线。
  //
  //    **闪光灯与固定不挑。** 这不是偏爱，是「闪光灯记忆永久」那句话的唯一
  //    兑现方式。`T_promote`（0.6）低于 `T_flash`（0.85），所以每条够格的闪光灯
  //    片段按原样必然也够晋升——而晋升就是被 `makeSummary` 压成日摘要，摘要
  //    写死 `flashbulb: false`。实测一条 0.850 的里程碑片段：`dayClosed(0)`
  //    一过就只剩摘要，第 6 天再并成周摘要，flag 活不过一天。于是
  //    `decayStrength` 的豁免分支、下面第 4 步的归档豁免、`trimBudget` 的
  //    「固定与闪光灯先保」三个消费者从来咬不动——没有哪条闪光灯活得着衰减。
  //
  //    留成当天那条鲜明的片段，它才谈得上「永久」：不衰减所以不归档，又在
  //    `day` 桶里被 `trimBudget` 排在最前，16 条的预算挤不掉它。代价是它
  //    长期占着当日预算的一格——而 `T_flash` 是刻意罕见的，实测 40 天 120 件
  //    事只出一条。
  const promoted = todays
    .filter((entry) => entry.salience >= config.T_promote && !entry.flashbulb && !entry.pinned)
    .sort((a, b) => {
      if (a.salience !== b.salience) return b.salience - a.salience;
      return a.memoryId < b.memoryId ? -1 : 1;
    })
    .slice(0, config.budget.daySummary);

  // 2. 摘要。逐句带各自的 eventRefs：摘要里的每一句都要能追到事件。
  const summary = promoted.length === 0 ? null : makeSummary(holderId, day, promoted, facts);

  // 3. 衰减 + 晋升。
  const decayed = rest.map((entry) => {
    const exempt = entry.flashbulb || entry.pinned;
    const strength = decayStrength(
      entry.strength,
      config.decayRate,
      config.tierFactor[entry.tier],
      exempt,
    );
    return { ...entry, strength };
  });

  // 4. 归档。place 的痕迹不在这里（它们是 Trace，不是 MemoryEntry）。
  let archivedCount = 0;
  const archived = decayed.map((entry) => {
    if (entry.archived || entry.flashbulb || entry.pinned) return entry;
    if (entry.strength >= config.T_forget) return entry;
    archivedCount += 1;
    return { ...entry, archived: true };
  });

  // 当日没被挑中的片段：保留但降一级细节（协议第 7 节第 2 步「其余降一级细节或丢弃」）。
  // 选降级而不是丢弃：一个人记得「那天好像有点事」比完全空白更接近真实，
  // 而且它仍然是可溯源的。
  const promotedIds = new Set(promoted.map((entry) => entry.memoryId));
  const kept = todays
    .filter((entry) => !promotedIds.has(entry.memoryId))
    .map((entry) => ({
      ...entry,
      content: { ...entry.content, detailLevel: Math.max(0, entry.content.detailLevel - 1) },
    }));

  const candidates = [...archived, ...kept, ...(summary === null ? [] : [summary])];
  const withWeekly = mergeWeekly(candidates, holderId, day, config);
  const merged = trimBudget(withWeekly, config);

  return {
    entries: [...others, ...merged],
    stats: {
      collected: todays.length,
      summarized: promoted.length,
      promoted: summary === null ? 0 : 1,
      archived: archivedCount,
      // 被预算挤掉几条。「丢了多少」本身是一个信号：它天天很大，说明某一层
      // 的预算该调了；它恒为 0，说明预算给宽了，而宽出来的部分只是内存。
      dropped: candidates.length - merged.length,
    },
  };
}

/**
 * 规则版日摘要。
 *
 * 只写**能追到事件**的话：每条被挑中的片段转成一句，句子里只出现它自己
 * `content` 里已有的 `what`、`who`、`where`。模板不加任何新词——「校验不过就
 * 回退到模板版本」在规则版里是恒成立的，因为模板版本本身就是从事件字段拼的。
 *
 * 摘要的 `eventRefs` 是各句出处的并集，`derivedFrom.memoryIds` 记着它是哪几条
 * 片段压出来的——删除级联靠这两个往下走。
 */
function makeSummary(
  holderId: string,
  day: number,
  promoted: readonly MemoryEntry[],
  facts: ReadonlyMap<string, WorldFact>,
): MemoryEntry {
  const sentences: string[] = [];
  for (const entry of promoted) {
    const who = entry.content.who.map(nameOf).join('、');
    const fact = facts.get(entry.eventRefs[0]);
    const place = fact === undefined ? entry.content.where : fact.placeId;
    sentences.push(who === '' ? `${entry.content.what}（${place}）` : `${who}：${entry.content.what}`);
  }
  const eventRefs = unique(promoted.flatMap((entry) => entry.eventRefs));
  const valence = average(promoted.map((entry) => entry.content.valence));
  const arousal = average(promoted.map((entry) => entry.content.arousal));
  const content: MemoryContent = {
    what: sentences.join('；'),
    who: unique(promoted.flatMap((entry) => entry.content.who)),
    where: promoted[0]?.content.where ?? '',
    when: day,
    // 摘要的细节层级取被压片段里最高的一档：它是一天的浓缩，不是又一次降级。
    detailLevel: Math.max(...promoted.map((entry) => entry.content.detailLevel)),
    valence,
    arousal,
  };
  return {
    memoryId: `m_sum_${holderId}_${day}`,
    holderId,
    kind: 'summary',
    tier: 'long',
    eventRefs: [eventRefs[0]!, ...eventRefs.slice(1)],
    sourceMode: 'witnessed',
    sourceChain: [],
    content,
    salience: Math.max(...promoted.map((entry) => entry.salience)),
    confidence: Math.max(...promoted.map((entry) => entry.confidence)),
    strength: 1,
    createdDay: day,
    lastRecalledDay: day,
    recallCount: 0,
    flashbulb: false,
    pinned: false,
    redacted: false,
    derivedFrom: { memoryIds: promoted.map((entry) => entry.memoryId), claimIds: [] },
    generatedBy: {
      by: 'rule',
      rulesetVersion: RULESET,
      inputHash: String(seedOf(holderId, day, 'summary')),
      seed: seedOf(holderId, day, 'summary'),
    },
    archived: false,
  };
}

/**
 * 周摘要：每 `weekLength` 天，把这一周的日摘要压成一条，进 `long` 层。
 *
 * 补充设计 §3.1「层级周期」：连续 7 天的 `DaySummary` 合并压缩为周摘要。
 * 没有这一步，长层会被日摘要灌满——一天一条，64 条的预算两个多月就顶到
 * 上限，然后开始按强度淘汰，而被淘汰的正是最早那些天。周摘要把七条换一条，
 * 于是「三个月前发生过什么」还有一句能查。
 *
 * 触发日取 `day % weekLength === weekLength - 1`：第 6、13、20 天……
 * 也就是每七天一次的**最后一天**。这样第 0 天不会在开局第一拍就触发。
 *
 * 规则版压缩：只把这一周日摘要的 `what` 拼起来，`eventRefs` 取并集。
 * 不加任何新词——周摘要说的每一句都能追到某个事件，这是「不编造」的下限。
 */
function mergeWeekly(
  entries: readonly MemoryEntry[],
  holderId: string,
  day: number,
  config: MemoryConfig,
): MemoryEntry[] {
  if (config.weekLength <= 0) return [...entries];
  if (day % config.weekLength !== config.weekLength - 1) return [...entries];

  const from = day - config.weekLength + 1;
  const dailies = entries.filter(
    (entry) =>
      entry.holderId === holderId &&
      entry.kind === 'summary' &&
      entry.tier === 'long' &&
      entry.createdDay >= from &&
      entry.createdDay <= day,
  );
  if (dailies.length === 0) return [...entries];

  const weekly: MemoryEntry = {
    memoryId: `m_week_${holderId}_${day}`,
    holderId,
    kind: 'summary',
    tier: 'long',
    eventRefs: [dailies[0]!.eventRefs[0]!, ...dailies.flatMap((entry) => entry.eventRefs.slice(1))],
    sourceMode: 'witnessed',
    sourceChain: [],
    content: {
      what: dailies.map((entry) => entry.content.what).join('；'),
      who: unique(dailies.flatMap((entry) => entry.content.who)),
      where: dailies[0]!.content.where,
      when: day,
      // 周摘要的细节取被压日摘要的最高一档——它是浓缩，不是又一次降级。
      detailLevel: Math.max(...dailies.map((entry) => entry.content.detailLevel)),
      valence: average(dailies.map((entry) => entry.content.valence)),
      arousal: average(dailies.map((entry) => entry.content.arousal)),
    },
    salience: Math.max(...dailies.map((entry) => entry.salience)),
    confidence: Math.max(...dailies.map((entry) => entry.confidence)),
    strength: 1,
    createdDay: day,
    lastRecalledDay: day,
    recallCount: 0,
    flashbulb: false,
    pinned: false,
    redacted: false,
    derivedFrom: {
      memoryIds: dailies.map((entry) => entry.memoryId),
      claimIds: [],
    },
    generatedBy: {
      by: 'rule',
      rulesetVersion: RULESET,
      inputHash: String(seedOf(holderId, day, 'weekly')),
      seed: seedOf(holderId, day, 'weekly'),
    },
    archived: false,
  };

  // 被压进去的日摘要让位。留着它们，周摘要只是又多了七条。
  const absorbed = new Set(dailies.map((entry) => entry.memoryId));
  return [...entries.filter((entry) => !absorbed.has(entry.memoryId)), weekly];
}

/** 规则集版本。规则一改，旧档里那些条目的 `generatedBy` 就说明它是哪一版做的。 */
export const RULESET = 'memory-r1';

function nameOf(holderId: string): string {
  return holderId;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 预算裁剪：每层超限时淘汰强度最低且未被固定的条目。
 *
 * 摘要不参与淘汰——它是这一层里唯一「一天一条」的东西，淘汰它等于让那一天
 * 从记忆里消失，而它的强度本来就是 1。
 */
function trimBudget(entries: readonly MemoryEntry[], config: MemoryConfig): MemoryEntry[] {
  const kept: MemoryEntry[] = [];
  const byTier = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const key = entry.kind === 'impression' ? 'impression' : entry.tier;
    const bucket = byTier.get(key) ?? [];
    bucket.push(entry);
    byTier.set(key, bucket);
  }
  for (const [key, bucket] of byTier) {
    const limit = limitFor(key, config);
    if (bucket.length <= limit) {
      kept.push(...bucket);
      continue;
    }
    const ranked = [...bucket].sort((a, b) => {
      // 固定与闪光灯先保。
      const pinA = a.pinned || a.flashbulb ? 1 : 0;
      const pinB = b.pinned || b.flashbulb ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      if (a.strength !== b.strength) return b.strength - a.strength;
      return a.memoryId < b.memoryId ? -1 : 1;
    });
    kept.push(...ranked.slice(0, limit));
  }
  return kept;
}

function limitFor(key: string, config: MemoryConfig): number {
  if (key === 'day') return config.budget.day;
  if (key === 'long') return config.budget.long;
  if (key === 'legend') return Number.POSITIVE_INFINITY;
  if (key === 'impression') return config.budget.impression;
  return Number.POSITIVE_INFINITY;
}
