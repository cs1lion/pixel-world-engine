/**
 * 需求层第二版：疲劳与睡眠。
 *
 * 与 `needs.ts` 同一个纪律：
 *   1. **纯值对象**：这里只有常量与纯函数。清醒时的 `fatigueAt(now, lastRestAt)`
 *      只由这两个数决定；睡着时的 `fatigueAt(now, lastRestAt, sleep)` 只由「入睡时刻 +
 *      入睡时的疲劳值」决定。不读 `Date.now()`、不摇 `Math.random()`。
 *   2. **运行时算**：`Simulation` 只记住每人「上次睡醒的世界时刻」与（睡着时）
 *      那一段的起点，读数现算。
 *   3. **不落档**：`FatigueReading` 与睡眠段都不进 v5 存档、不进快照；
 *      读档后从「刚睡醒」起，和 `lastMealAt` 同类。
 *
 * 速率与衰减率都是可枚举常量：
 *   - 清醒：每世界日 `+NEEDS_FATIGUE_PER_DAY`，跨过 `NEEDS_SLEEP_THRESHOLD` 才会睡；
 *   - 睡着：每世界日 `−NEEDS_SLEEP_DECAY_PER_DAY`，衰减到 `NEEDS_WAKE_THRESHOLD` 醒。
 * 睡眠段长度因此不是写死的时长，而是「入睡时疲劳值 / 衰减率」算出来的。
 *
 * 数值依据：清醒 0 → 1 要两个世界日，跨阈要 1.6 个世界日（约 38 小时）——比饥饿的
 * 2.7 天早，所以冻结的 50 小时轨迹里会出现一次睡眠（本轮指纹因此变，见证据）；
 * 睡着 0.8 → 0 要 0.2 个世界日（4.8 小时），一个睡眠段落在 5 小时上下。
 */

import { DAY_MS } from './memory/config.ts';

/** 清醒时每世界日涨多少疲劳（0 → 1 需要 2 个世界日）。 */
export const NEEDS_FATIGUE_PER_DAY = 1 / 2;

/** 睡着时每世界日降多少疲劳（0.8 → 0 需要 0.2 个世界日）。 */
export const NEEDS_SLEEP_DECAY_PER_DAY = 4;

/** 跨过它才会产生「睡一觉」的目标。 */
export const NEEDS_SLEEP_THRESHOLD = 0.8;

/** 睡着后疲劳降到它（含）就醒；醒来把「上次睡醒」拨到此刻。 */
export const NEEDS_WAKE_THRESHOLD = 0;

/** 从「上次睡醒」到跨阈要多久（世界毫秒）。纯算术，证据里的跨阈时刻用它算。 */
export const NEEDS_SLEEP_CROSS_MS = DAY_MS * NEEDS_SLEEP_THRESHOLD / NEEDS_FATIGUE_PER_DAY;

/** 已经睡着的那一段：起点与入睡时的疲劳值。纯数据，没有方法。 */
export interface SleepSpan {
  readonly startedAtMs: number;
  readonly fatigueAtStart: number;
}

export interface FatigueReading {
  /** 0 = 刚睡醒，1 = 累到顶。clamp 在 [0, 1]。 */
  readonly fatigue: number;
  /** `fatigue >= NEEDS_SLEEP_THRESHOLD`（清醒时才有意义）。 */
  readonly sleepy: boolean;
  /** 正躺在这一睡段里（由 `sleep !== null` 决定，不是另记一个状态）。 */
  readonly asleep: boolean;
}

/**
 * 纯函数：给定世界时刻与「上次睡醒」，算出此刻的疲劳值。
 *
 * `sleep` 为 `null` 时走清醒曲线；非空时走「从入睡那一刻起按衰减率往下掉」，
 * 与 `lastRestAtMs` 无关——睡着的人不会同时还在累积。两条曲线都在 [0, 1] 内。
 */
export function fatigueAt(
  nowMs: number,
  lastRestAtMs: number,
  sleep: SleepSpan | null = null,
): number {
  if (sleep !== null) {
    const asleep = Math.max(0, nowMs - sleep.startedAtMs);
    const raw = sleep.fatigueAtStart - asleep / DAY_MS * NEEDS_SLEEP_DECAY_PER_DAY;
    return Math.min(1, Math.max(0, raw));
  }
  const elapsed = Math.max(0, nowMs - lastRestAtMs);
  const raw = elapsed / DAY_MS * NEEDS_FATIGUE_PER_DAY;
  return Math.min(1, Math.max(0, raw));
}

/** 纯函数：疲劳读数。`sleepy` 只在清醒时有意义，睡着时按 `asleep` 读。 */
export function fatigueReadingOf(
  nowMs: number,
  lastRestAtMs: number,
  sleep: SleepSpan | null = null,
): FatigueReading {
  const fatigue = fatigueAt(nowMs, lastRestAtMs, sleep);
  return {
    fatigue,
    sleepy: sleep === null && fatigue >= NEEDS_SLEEP_THRESHOLD,
    asleep: sleep !== null,
  };
}

/** 从「上次睡醒」算起，疲劳跨阈的确切世界时刻（不是「第一次被注意到」的那一拍）。 */
export function sleepCrossedAtMs(lastRestAtMs: number): number {
  return lastRestAtMs + NEEDS_SLEEP_CROSS_MS;
}

/** 这一段睡到哪个世界时刻醒：入睡时的疲劳值按衰减率归零。纯算术。 */
export function wakeUpAtMs(sleep: SleepSpan): number {
  const hours = sleep.fatigueAtStart / NEEDS_SLEEP_DECAY_PER_DAY * DAY_MS;
  return sleep.startedAtMs + Math.max(0, hours);
}
