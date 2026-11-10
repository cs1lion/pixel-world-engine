/** 场所产出账：让作息里的「作业」真的产出东西。
 *
 * 问题：`activity: 'work' / 'trade'` 原来只做**门控**（这个场所此刻允不允许
 * 这个词），到点后只挂一句 `routineLabel` 站满 `dwellMs`——炉匠「搬炭」搬不出
 * 任何炭，洗衣妇「收衣裳」收不出任何衣裳，世界状态一个字都不变。
 *
 * 这一层补的就是那个「真的发生了」：走到场所那一刻记一趟作业，产出进世界事实。
 *
 * 三条纪律（与 `needs.ts` / `fatigue.ts` 同源）：
 *   1. **纯值对象**：这里只有常量与纯函数，不读 `Date.now()`、不摇 `Math.random()`。
 *   2. **产出物由设定集声明**：`SettingSite.output`。引擎不按场所 id 硬编码——
 *      「设定集可换」是这仓的承诺，硬编码等于换包就产出错东西。
 *   3. **只累积，不消耗**（本轮口径，用户 2026-11-10 拍板）：炭供炉火、衣裳供来客
 *      那条供需链留下一轮。这里没有消耗速率，也没有缺货后果。
 *
 * 记在**到达那一刻**而不是站满之后：`finishIdleLeg` 每条腿只调用一次，
 * 与 `dwellOf` 回查的是同一拍，因此不需要额外的「这一拍记过没有」标记，
 * 也不会因为 `behavior.plan` 空转而重复记。口径是「走到场所即完成一趟作业」，
 * 停留时长仍照旧管她站多久。
 */

import type { ActivityId } from './timetable.ts';

/**
 * 产出物闭集。
 *
 * - `coal` / `laundry` 有设定集依据（锅炉房搬炭 p48、大浴场清洗）；
 * - `trade` 是饮食街的成交计数（设定集有饮食街，没有「成交」这个量，属引擎取值）。
 *
 * 与 `ActivityId` 同一套克制：不预留没有消费方的词，写错就 throw。
 */
export type OutputKind = 'coal' | 'laundry' | 'trade';

export const OUTPUT_KINDS: readonly OutputKind[] = ['coal', 'laundry', 'trade'];

export function isOutputKind(value: string): value is OutputKind {
  return (OUTPUT_KINDS as readonly string[]).includes(value);
}

/** 一趟作业产出多少。第一版固定 1，不做速率与熟练度。 */
export const OUTPUT_PER_SHIFT = 1;

/** 产出物给人看的叫法。日报与 HUD 用它，不自己另写一份。 */
export const OUTPUT_LABELS: Readonly<Record<OutputKind, string>> = {
  coal: '炭',
  laundry: '洗好的衣裳',
  trade: '成交',
};

/**
 * 这个活动产不产东西。
 *
 * `work` / `trade` 产出；`rest` / `stroll` 不产——花径坐下与走看是过日子，
 * 不是作业。把它们也算成产出会让「今天出了多少」变成「今天走了多少趟」。
 */
export function activityProduces(activity: ActivityId): boolean {
  return activity === 'work' || activity === 'trade';
}

/** 场所产出账：场所 id → 累计产出。只增不减（本轮不做消耗）。 */
export type SiteOutputTally = Readonly<Record<string, number>>;

/** 空账。新世界与旧档迁移都从这里起。 */
export function emptyOutputTally(): SiteOutputTally {
  return {};
}

/** 纯函数：记一趟产出。amount 省略就是一趟的量。 */
export function accrueOutput(
  tally: SiteOutputTally,
  siteId: string,
  amount: number = OUTPUT_PER_SHIFT,
): SiteOutputTally {
  return { ...tally, [siteId]: (tally[siteId] ?? 0) + amount };
}

/** 全账合计。HUD 那句「今天出了多少」的分子。 */
export function outputTotal(tally: SiteOutputTally): number {
  let total = 0;
  for (const value of Object.values(tally)) total += value;
  return total;
}

/**
 * 一句可读的产出摘要，按场所 id 排序保证同一份账给出同一句话。
 *
 * `kinds` 是场所 id → 产出物；没登记产出物的场所不进摘要（它本来就不产）。
 * 账为空时返回空串——「没有产出」不该说成「产出 0 份炭」。
 */
export function outputSummary(
  tally: SiteOutputTally,
  kinds: ReadonlyMap<string, OutputKind>,
): string {
  const parts: string[] = [];
  for (const siteId of Object.keys(tally).sort()) {
    const amount = tally[siteId] ?? 0;
    const kind = kinds.get(siteId);
    if (amount <= 0 || kind === undefined) continue;
    parts.push(`${siteId} ${OUTPUT_LABELS[kind]} ${amount}`);
  }
  return parts.join('；');
}

/**
 * 从存档字符串读回账。
 *
 * 坏 JSON / 非对象 / 项不是非负整数 → 跳过该项（整段读不出来就是空账）。
 * 这一段是累计读数、不是世界不变量，读不出来不该让整份档变坏档。
 */
export function parseOutputTally(raw: string | undefined): SiteOutputTally {
  if (raw === undefined || raw === '') return emptyOutputTally();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyOutputTally();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emptyOutputTally();
  }
  const tally: Record<string, number> = {};
  for (const [siteId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue;
    tally[siteId] = value;
  }
  return tally;
}

// ---------------------------------------------------------------- 消耗（循环的另一半）
//
// 只产不耗不叫循环：炭堆在账上永远涨，作业等于白刷。这一段补消耗。
//
// 纪律与产出同源：纯函数、按世界时刻算、不读墙钟。但消耗的**结算游标**是
// 运行时字段（不落档），读档后从「此刻」起算——同 `needs.ts` 的 `lastMealAt`。
// 落档只落**库存**（账本身），不落游标：游标是「上次算到哪一刻」的中间量，
// 读档后重新起算不会让库存跳变，只是少扣一次半次，而多扣一次才是坏账。

/** 每个产出场所每世界日消耗多少份。 */
export const OUTPUT_CONSUME_PER_DAY = 1;

/** 消耗结算的间隔：一个世界日一次。 */
export const OUTPUT_CONSUME_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 从 `fromMs` 到 `toMs` 之间应该结算几轮消耗。
 *
 * 纯函数：只由两头时刻决定，所以同一世界时刻无论怎么分帧都是同一个数——
 * 这是拆帧不变性的前提（`site-hours.test.ts` 那条钉的就是它）。
 */
export function consumeRoundsBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  if (toMs <= fromMs) return 0;
  return Math.floor((toMs - fromMs) / OUTPUT_CONSUME_INTERVAL_MS);
}

/**
 * 扣库存：返回新账与实际扣掉的量。
 *
 * **库存不足只扣到 0，不欠账**：负数库存会让「见底」这件事永远读不出来
 * （-3 和 0 都是缺，但 -3 还会越欠越深，像是世界在替谁记仇）。
 */
export function consumeOutput(
  tally: SiteOutputTally,
  siteId: string,
  want: number = OUTPUT_CONSUME_PER_DAY,
): { readonly tally: SiteOutputTally; readonly consumed: number } {
  const have = tally[siteId] ?? 0;
  const consumed = Math.min(have, Math.max(0, Math.floor(want)));
  if (consumed <= 0) return { tally, consumed: 0 };
  return { tally: { ...tally, [siteId]: have - consumed }, consumed };
}

/** 见底的场所（有产出声明但库存为 0）。日报用它说「炭见底」。 */
export function emptySites(
  tally: SiteOutputTally,
  kinds: ReadonlyMap<string, OutputKind>,
): readonly string[] {
  return [...kinds.keys()]
    .filter((siteId) => (tally[siteId] ?? 0) <= 0)
    .sort();
}
