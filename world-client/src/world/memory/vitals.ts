/** 世界心电图：`DayClosed` 之后向外广播的四个标量。
 *
 * 补充设计 §2.3。任务组 A 只负责**算出来并广播**，怎么用是导演（任务组 B）的事。
 * 这条分工是边界红线的一部分：本组不读这四个数做任何决定，也不实现任何
 * 「世界太安静了所以注入一场宴席」的逻辑。
 *
 * 四个数的口径（全部只读世界侧的记忆与信念，不读上游）：
 *
 * - `mean_valence`：近 3 日**全部 Holder 的**记忆的效价均值，-1..1。
 * - `mean_arousal`：同上，唤醒度均值，0..1。
 * - `info_entropy`：当日活跃传播的独立 Claim 数量与覆盖率方差。
 *   这里用「独立断言数 × 覆盖不均度」合成一个 0..1 的量：断言越多越分散，
 *   值越高；全员知道同一件事（方差 0）时值反而低——那正是「同质化」的样子。
 * - `isolated_holders_count`：连续 3 天没有任何 `ClaimTold` 交互的孤立单位数。
 *
 * 「近 3 日」是 `vitalsWindowDays`。它按**世界日**算，不按墙钟。
 */

import type { MemoryConfig } from './config.ts';
import type { Belief, MemoryEntry, WorldVitals } from './types.ts';

/** 一条 `claim.told` 的流水。心电图只需要「谁在哪天跟谁说过话」。 */
export interface TellRecord {
  readonly day: number;
  readonly from: string;
  readonly to: string;
  readonly claimId: string;
}

export interface VitalsInput {
  readonly day: number;
  readonly memories: readonly MemoryEntry[];
  readonly beliefs: readonly Belief[];
  readonly tells: readonly TellRecord[];
  readonly holderIds: readonly string[];
  readonly config: MemoryConfig;
}

export function computeVitals(input: VitalsInput): WorldVitals {
  const { config, day } = input;
  const from = day - config.vitalsWindowDays + 1;
  const recent = input.memories.filter(
    (entry) => !entry.redacted && entry.createdDay >= from && entry.createdDay <= day,
  );

  const meanValence = mean(recent.map((entry) => entry.content.valence));
  const meanArousal = mean(recent.map((entry) => entry.content.arousal));

  const todaysTells = input.tells.filter((tell) => tell.day === day);
  const claims = new Set(todaysTells.map((tell) => tell.claimId));
  const coverage = new Map<string, Set<string>>();
  for (const tell of todaysTells) {
    const known = coverage.get(tell.claimId) ?? new Set<string>();
    known.add(tell.to);
    known.add(tell.from);
    coverage.set(tell.claimId, known);
  }
  const infoEntropy = entropyOf(claims.size, coverage, input.holderIds.length);

  const isolated = input.holderIds.filter((holderId) => {
    const windowStart = day - config.isolatedDays + 1;
    return !input.tells.some(
      (tell) =>
        tell.day >= windowStart &&
        tell.day <= day &&
        (tell.from === holderId || tell.to === holderId),
    );
  }).length;

  return {
    day,
    meanValence: round(meanValence, 4),
    meanArousal: round(meanArousal, 4),
    infoEntropy: round(infoEntropy, 4),
    isolatedHoldersCount: isolated,
  };
}

/**
 * 「独立断言数」与「覆盖率不均」合成一个 0..1 的数。
 *
 * 断言数的贡献用 `1 - 1/(1+n)`：0 条是 0，1 条 0.5，3 条 0.75，边际递减——
 * 世界从「一件都没人讲」到「有一件事在传」是质变，从 5 件到 6 件不是。
 *
 * 不均度用覆盖率的方差：全员都只知道同一件事时方差接近 0，合成值低。
 * 这正是护栏要的那个读法——「全员一天内全知」在心电图上看起来**很平静**，
 * 而导演该据此知道世界病了，而不是健康。
 */
function entropyOf(
  claimCount: number,
  coverage: ReadonlyMap<string, Set<string>>,
  holderCount: number,
): number {
  if (claimCount === 0 || holderCount === 0) return 0;
  const shares = [...coverage.values()].map((known) => known.size / holderCount);
  const spread = variance(shares);
  const variety = 1 - 1 / (1 + claimCount);
  // 方差最大约 0.25（一半人知道、一半不知道）。归一化到 0..1 再折进合成值。
  return Math.min(1, variety * 0.6 + Math.min(1, spread / 0.25) * 0.4);
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 心电图的四个标量按固定次序排，便于日志与快照比对。 */
export function vitalsOf(vitals: WorldVitals): readonly [number, number, number, number] {
  return [vitals.meanValence, vitals.meanArousal, vitals.infoEntropy, vitals.isolatedHoldersCount];
}
