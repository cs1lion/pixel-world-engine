/** 世界节奏表：所有「世界走多快」的时长都收在这一处。
 *
 * **单位约定**：表里的时长一律以**世界分钟**给出，由 `worldMinutes(n)` 换算成
 * 世界毫秒——`1 世界分钟 = DAY_MS / 1440`。不在这里写 `5200` 或
 * `30 * 60 * 1000` 这种字面量：散在各文件的毫秒数改一处忘一处，节奏就会
 * 一边快一边慢，而屏幕上只表现为「她有时候走得很怪」。
 *
 * 换算口径（倍率 60，`?clock=real` 除外）：
 * - 一世界日 = 1440 世界分钟 = 24 分钟现实；
 * - 1 世界分钟 = 1 现实秒；
 * - 玩家白天 06:00–22:00 = 960 世界分钟 = 960 现实秒。
 *
 * 这个文件只放数与纯换算，不读时钟、不碰 `Simulation`。谁要用就 import，
 * 别再在调用处写第二份毫秒常量。
 */

import { DAY_MS } from './memory/config.ts';

/** 一世界日有多少世界分钟。24 × 60，与 `DAY_MS` 是同一件事的两种写法。 */
export const WORLD_MINUTES_PER_DAY = 24 * 60;

/** 世界分钟 → 世界毫秒。表里所有数都过这一道。 */
export function worldMinutes(minutes: number): number {
  return (DAY_MS * minutes) / WORLD_MINUTES_PER_DAY;
}

/** 世界小时 → 世界毫秒。等同于 `worldMinutes(hours * 60)`，只为表头读得顺。 */
export function worldHours(hours: number): number {
  return worldMinutes(hours * 60);
}

/**
 * 节奏表。改任何一项都只改这里。
 *
 * | 项 | 值 | 现实里（倍率 60） |
 * | --- | --- | --- |
 * | 一站停留 | 20–40 世界分钟 | 20–40 秒 |
 * | 步行一格 | 1 世界分钟 | 1 秒 |
 * | 氛围槽 | 2 世界小时 | 2 分钟 |
 */
export const PACE = {
  /** 一站停留的下限。 */
  dwellMinMs: worldMinutes(20),
  /** 一站停留的上限。 */
  dwellMaxMs: worldMinutes(40),
  /** 没有特别说法的落点停多久：区间中位偏上，读起来像「坐一会儿」。 */
  dwellDefaultMs: worldMinutes(28),
  /** 12:00–14:00 安静段：一站停到上限，别在镇上反复走。 */
  quietDwellMs: worldMinutes(40),
  /** 步行一格。原来的 3 格/秒是 6 倍速时代的读感，现在按世界分钟重算。 */
  walkCellMs: worldMinutes(1),
  /** 氛围事件的时间槽。一个槽里最多出一件事。 */
  ambientSlotMs: worldHours(2),
} as const;

/**
 * 设定集里的作息时长是 4600–6500 的旧毫秒值。它们不是绝对的「停 5 秒」，
 * 而是**相对长短**：有的落点写得久一点，有的短一点。
 *
 * 这里把这段相对关系整体折进 20–40 世界分钟的区间：最短的 4600 落在 20 分钟，
 * 最长的 6500 落在 40 分钟，中间按比例。设定集因此不用改数字，节奏归世界。
 */
const SETTING_DWELL_MIN_MS = 4600;
const SETTING_DWELL_MAX_MS = 6500;

/** 设定集的 `dwellMs` → 世界时钟上的停留毫秒（20–40 世界分钟）。 */
export function dwellMsForSetting(rawMs: number): number {
  const span = SETTING_DWELL_MAX_MS - SETTING_DWELL_MIN_MS;
  const ratio = span <= 0 ? 0.5 : (rawMs - SETTING_DWELL_MIN_MS) / span;
  const clamped = Math.min(1, Math.max(0, ratio));
  return Math.round(PACE.dwellMinMs + clamped * (PACE.dwellMaxMs - PACE.dwellMinMs));
}
