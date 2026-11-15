/**
 * 造物落地账的**读侧**：把写进账本的落地记录读成两处人能看见的东西——
 * 日报里的一行，和楼面板里的一句脚注。
 *
 * 为什么单独一个纯模块：写侧（造物账本模块）已经够重，读侧只该负责
 * 「把记录折成一句人话」，不该顺手改账本、也不该碰 Phaser。这样它能在 node 里被钉住。
 *
 * 三条口径，缺一条这行字就会说谎：
 *   1. **来源分列，不合并**。外环提的、你提的、神谕提的、世界自己长的，四个数分开写。
 *      合并成一个「今日落地 3 栋」会让人以为是外环干的活（`ADR_SCHEMA_PASS_RATE_SEMANTICS`）。
 *   2. **违规要说出来**。落地检查跑过就是为了让人知道，藏起来等于没跑。
 *   3. **没落地就不写**。没有记录时不返回「今天很平静」这类填充句（`report.ts` 的规矩）。
 */

import type { GridPoint } from './types.ts';

/** 账本里的四个来源。与写侧的 `CreationOrigin` 同值。 */
export type LandingOrigin = 'manual' | 'auto' | 'oracle' | 'world';

export interface LandingEntry {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly displayName: string;
  readonly origin: LandingOrigin;
  /** 世界日序号（从 0 起）。 */
  readonly day: number;
  readonly landed: boolean;
  readonly pathfindingConnected: boolean;
  readonly hasConflict: boolean;
  readonly invariantViolated: boolean;
  /** 原始违规文案；空数组 = 查过且没有。 */
  readonly violations: readonly string[];
  readonly origin_cell?: GridPoint;
}

const ORIGIN_LABEL: Record<LandingOrigin, string> = {
  auto: '外环',
  manual: '你',
  oracle: '神谕',
  world: '世界',
};

export interface LandingSummary {
  /** 每个来源落地了几栋，顺序固定（外环 / 你 / 神谕 / 世界），0 的不出现。 */
  readonly byOrigin: readonly { readonly origin: LandingOrigin; readonly count: number }[];
  readonly total: number;
  /** 落地检查有问题的栋数（冲突或不变式任一）。 */
  readonly flagged: number;
  /** 去重后的违规文案。 */
  readonly violations: readonly string[];
}

/** 只统计给定世界日的记录。`day === null` 表示不按日筛（面板查单栋时用）。 */
export function summarizeLandings(
  entries: readonly LandingEntry[],
  day: number | null,
): LandingSummary {
  const scoped = entries.filter(
    (entry) => entry.landed && (day === null || entry.day === day),
  );
  const counts = new Map<LandingOrigin, number>();
  const violations = new Set<string>();
  let flagged = 0;
  for (const entry of scoped) {
    counts.set(entry.origin, (counts.get(entry.origin) ?? 0) + 1);
    if (entry.hasConflict || entry.invariantViolated) flagged += 1;
    for (const text of entry.violations) violations.add(text);
  }
  const order: LandingOrigin[] = ['auto', 'manual', 'oracle', 'world'];
  return {
    byOrigin: order
      .filter((origin) => (counts.get(origin) ?? 0) > 0)
      .map((origin) => ({ origin, count: counts.get(origin) ?? 0 })),
    total: scoped.length,
    flagged,
    violations: [...violations],
  };
}

/**
 * 日报那一行。没有落地就返回 `null`——报纸不写没发生的事。
 *
 * 形如：`今日落地 3 栋（外环 1 / 你 1 / 神谕 1）；1 栋有问题：不变式：占地压住既有摆件`
 */
export function landingLineOf(summary: LandingSummary): string | null {
  if (summary.total === 0) return null;
  const parts = summary.byOrigin.map((item) => `${ORIGIN_LABEL[item.origin]} ${item.count}`);
  const head = `今日落地 ${summary.total} 栋（${parts.join(' / ')}）`;
  if (summary.flagged === 0) return head;
  const why = summary.violations.slice(0, 2).join('；');
  return why === ''
    ? `${head}；${summary.flagged} 栋落地检查有问题`
    : `${head}；${summary.flagged} 栋有问题：${why}`;
}

export interface BuildingLandingView {
  readonly origin: LandingOrigin;
  readonly originLabel: string;
  readonly day: number;
  readonly clean: boolean;
  readonly violations: readonly string[];
}

/** 楼面板的脚注：这栋楼是谁提的、落地检查过没过。没有记录就 `null`。 */
export function buildingLandingOf(
  entries: readonly LandingEntry[],
  instanceId: string,
): BuildingLandingView | null {
  const found = entries.find((entry) => entry.instanceId === instanceId && entry.landed);
  if (found === undefined) return null;
  return {
    origin: found.origin,
    originLabel: ORIGIN_LABEL[found.origin],
    day: found.day,
    clean: !found.hasConflict && !found.invariantViolated,
    violations: found.violations,
  };
}
