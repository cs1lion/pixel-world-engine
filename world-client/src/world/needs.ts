/**
 * 需求层第一版：只有一个标量——饥饿。
 *
 * 三条纪律：
 *   1. **纯值对象**：这里只有常量与纯函数，`hungerAt(now, lastMealAt)` 的返回值
 *      只由这两个数决定；没有隐藏状态、不读 `Date.now()`、不摇 `Math.random()`。
 *   2. **运行时算**：`Simulation` 只记住每人「上次吃饭的世界时刻」，读数现算。
 *   3. **不落档**：`NeedsReading` 不进 v5 存档，也不进快照；读档后从「刚吃过」起。
 *
 * 速率与阈值是可枚举的常量：`NEEDS_HUNGER_PER_DAY`（每个世界日涨多少）、
 * `NEEDS_HUNGER_EAT_THRESHOLD`（跨过它才产生吃饭目标）。
 * 第一版刻意慢：0 → 1 要三个世界日，跨阈要 2.7 个世界日，
 * 因此冻结的 50 小时轨迹里不会有人跨阈——世界读数逐字不变是本块的硬判据。
 */

import { DAY_MS } from './memory/config.ts';

/** 一个世界日涨多少饥饿（0 → 1 需要 1 / 这个数 个世界日）。 */
export const NEEDS_HUNGER_PER_DAY = 1 / 3;

/** 跨过它才会产生「去吃点东西」的目标。 */
export const NEEDS_HUNGER_EAT_THRESHOLD = 0.9;

/** 吃一顿之后回到多少。第一版是「清零」，不做饱腹衰减。 */
export const NEEDS_HUNGER_AFTER_MEAL = 0;

export interface NeedsReading {
  /** 0 = 刚吃过，1 = 饿到顶。clamp 在 [0, 1]。 */
  readonly hunger: number;
  /** `hunger >= NEEDS_HUNGER_EAT_THRESHOLD`。 */
  readonly hungry: boolean;
}

/** 纯函数：给定世界时刻与上次吃饭的时刻，算出此刻的饥饿值。 */
export function hungerAt(nowMs: number, lastMealAtMs: number): number {
  const elapsed = Math.max(0, nowMs - lastMealAtMs);
  const raw = elapsed / DAY_MS * NEEDS_HUNGER_PER_DAY;
  return Math.min(1, Math.max(0, raw));
}

export function needsAt(nowMs: number, lastMealAtMs: number): NeedsReading {
  const hunger = hungerAt(nowMs, lastMealAtMs);
  return { hunger, hungry: hunger >= NEEDS_HUNGER_EAT_THRESHOLD };
}
