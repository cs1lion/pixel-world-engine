/** 渡口的潮汐后果：水位、突堤、灯影、船班。
 *
 * 潮位本来只是「越高灯越亮」的一个读数。这一层把它接到四件看得见的事上：
 *
 *   1. 渡口水位与突堤露出长度（越高，水线越靠岸，露出的木栈越短）；
 *   2. 水面灯影长度（有水的面积越大，倒影拉得越长）；
 *   3. 船班（涨潮靠岸可开航，退潮搁浅停航）；
 *   4. 面板时间线上的一句「今天潮位多少、船开没开」。
 *
 * **全是 `level` 与世界时间的纯函数**：同一串步长、同一个潮位，四件事逐项相同。
 * 这里不读墙钟，也不存状态——回放与离线断言都只需要喂一个数。
 *
 * 阈值只借 `tide.ts` 的两条作息线，不再另写一份：
 * - `TIDE_HIGH_MIN` 以上算涨潮，船靠岸；
 * - `TIDE_LOW_MAX` 以下算退潮见底，船搁浅；
 * - 中间是航道还开着，船在往返。
 *
 * （「涨潮时停靠」不是「涨潮才开」：船在岸边等客，航道是开的。
 *   停航只发生在搁浅这一档。）
 */

import { DAY_MS } from './memory/config.ts';
import { TIDE_HIGH_MIN, TIDE_LOW_MAX } from './tide.ts';

/** 突堤从滩头伸进水里有多少格。满潮全淹，退到底全露。 */
export const JETTY_CELLS = 7;

/** 满潮时水面灯影最长拉几格。退潮没有水，倒影自然收成 0。 */
export const MAX_REFLECTION_CELLS = 5;

/**
 * 每天报三次船班：早、中、晚。
 *
 * 世界时间里的分钟数（从日界起算）。固定在时刻上，不跟着潮汐周期跑——
 * 潮汐 12 分钟一个来回，跟着它报会在一天里刷出上百条。
 */
export const HARBOR_REPORT_MINUTES = [390, 750, 1110] as const;

export type BoatStatus = 'docked' | 'crossing' | 'grounded';

export interface HarborState {
  /** 潮位，0..1。 */
  readonly level: number;
  readonly boat: BoatStatus;
  /** 船班此刻开不开：只有搁浅这一档是停航。 */
  readonly boatOpen: boolean;
  /** 突堤露在空气里的格数。 */
  readonly jettyCells: number;
  /** 水面灯影长度（格）。 */
  readonly reflectionCells: number;
  /** 状态行的一两个字。 */
  readonly boatLabel: string;
  /** 面板时间线用的整句。 */
  readonly text: string;
}

export interface HarborReport {
  /** 世界时间。 */
  readonly at: number;
  readonly text: string;
  readonly state: HarborState;
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level));
}

/** 船班跟着潮位走。两端的门槛与作息共用 `tide.ts` 的那两条线。 */
export function boatStatusAt(level: number): BoatStatus {
  const value = clampLevel(level);
  if (value >= TIDE_HIGH_MIN) return 'docked';
  if (value <= TIDE_LOW_MAX) return 'grounded';
  return 'crossing';
}

export function boatLabelOf(status: BoatStatus): string {
  switch (status) {
    case 'docked':
      return '靠岸';
    case 'crossing':
      return '往返';
    case 'grounded':
      return '搁浅';
  }
}

/** 突堤露出的格数：水越高，露得越少。 */
export function jettyExposedCells(level: number): number {
  return Math.round(JETTY_CELLS * (1 - clampLevel(level)));
}

/** 水面灯影长度：水越高，灯影拉得越长。 */
export function lampReflectionCells(level: number): number {
  return Math.round(MAX_REFLECTION_CELLS * clampLevel(level));
}

/** 一次潮位读数 → 渡口四件事。纯函数，渲染与面板读的是同一份。 */
export function harborStateAt(level: number): HarborState {
  const value = clampLevel(level);
  const boat = boatStatusAt(value);
  const boatOpen = boat !== 'grounded';
  const jettyCells = jettyExposedCells(value);
  const reflectionCells = lampReflectionCells(value);
  const label = boatLabelOf(boat);
  const boatText = boat === 'grounded'
    ? '船班搁浅，停航'
    : boat === 'docked'
      ? '船班靠岸，可开航'
      : '船班往返中';
  return {
    level: value,
    boat,
    boatOpen,
    jettyCells,
    reflectionCells,
    boatLabel: label,
    text: `潮位 ${value.toFixed(2)}，${boatText}；突堤露出 ${jettyCells} 格`,
  };
}

/**
 * `(prevNow, now]` 跨过的船班播报时刻。
 *
 * 与 `ambientBetween` / `beatsBetween` 同一条判据：两头一夹，不存游标。
 * 同一拍重复调用不会重复播报。
 */
export function harborReportsBetween(
  prevNow: number,
  now: number,
  tideAt: (at: number) => number,
): readonly HarborReport[] {
  if (!Number.isFinite(prevNow) || !Number.isFinite(now) || now <= prevNow) return [];
  const firstDay = Math.floor(prevNow / DAY_MS);
  const lastDay = Math.floor(now / DAY_MS);
  const reports: HarborReport[] = [];
  // 离线补算可能跨很多天；给一个上限只是防 `now` 被喂进一个离谱的数。
  const capped = Math.min(lastDay, firstDay + 400);
  for (let day = firstDay; day <= capped; day += 1) {
    for (const minute of HARBOR_REPORT_MINUTES) {
      const at = day * DAY_MS + minute * 60_000;
      if (at <= prevNow || at > now) continue;
      const state = harborStateAt(tideAt(at));
      reports.push({ at, text: state.text, state });
    }
  }
  return reports;
}
