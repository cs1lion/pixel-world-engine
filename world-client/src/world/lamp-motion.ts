/** 灯柱与灯串的三层动态：逐盏渐次点亮、呼吸、风摆。
 *
 * **只认世界时钟**：这里每一支都只吃 `worldNow`（`snapshot.now`），不读
 * `Date.now()` / `performance.now()`，也不存任何状态。同一个世界时刻必然得到
 * 同一帧——回放与暂停验收靠的就是这一条，而不是靠截图碰运气。
 *
 * 三个动作各自可关：`LampMotion` 的三个布尔位由调用方递进来，关掉哪一层，
 * 那一层就回到常量（不亮 / 亮度 1 / 位移 0），与「有没有动画」是两回事。
 *
 * 时长口径都按**世界毫秒**算，默认倍率 60 下 1 世界秒 = 1/60 真实秒：
 * - 渐次点亮窗口 6 世界分钟（默认倍率下约 6 真实秒），28 盏依次亮；
 * - 呼吸周期 5 世界分钟（约 5 真实秒）；
 * - 风摆周期约 3.2 世界分钟（约 3.2 真实秒）。
 * 把窗口写成 6 世界**秒**会让整条街在一帧里亮完（一拍步长就是 6 世界秒），
 * 那就不是「逐盏」了。
 */

import { DAY_MS } from './memory/config.ts';
import { worldMinutes } from './pace.ts';
import { lampStreetLitAt, type LampPhase } from './lamp-street.ts';
import { minuteOfDay, TIMETABLE, type TimetableId } from './timetable.ts';

/** 三支动态的开关。关掉哪一支，那一支就退化成常量。 */
export interface LampMotion {
  readonly ignite: boolean;
  readonly breathe: boolean;
  readonly sway: boolean;
}

/** 默认全开：夜街本来就该是活的。 */
export const LAMP_MOTION_ON: LampMotion = { ignite: true, breathe: true, sway: true };

/** 渐次点亮的窗口：从第一盏到最后一盏共 6 世界分钟。 */
export const IGNITION_SPAN_MS = worldMinutes(6);
/** 单盏从暗到亮的时间：12 世界秒（两拍逻辑步长），不在一帧里跳满。 */
export const IGNITION_RAMP_MS = worldMinutes(0.2);

/** 点灯那一拍的世界毫秒偏移。只认时刻表的 id，不另写一份 18:00。 */
function lightsOnOffsetMs(): number {
  const beat = TIMETABLE.find((item) => item.id === ('light_lamps' satisfies TimetableId));
  if (beat === undefined) throw new Error('时刻表缺少 light_lamps');
  return worldMinutes(beat.minuteOfDay);
}

/** 收灯那一拍的分钟数：凌晨这段的判据只认时刻表的 id。 */
function lightsOutMinute(): number {
  const beat = TIMETABLE.find((item) => item.id === ('lamps_out' satisfies TimetableId));
  if (beat === undefined) throw new Error('时刻表缺少 lamps_out');
  return beat.minuteOfDay;
}

/**
 * 从当天点灯时刻起过了多少世界毫秒。
 *
 * 负数表示「今天还没到点灯时刻」（凌晨那一段灯是从昨天亮过来的），
 * 由调用方按「早就亮了」处理。
 */
export function msSinceLightsOn(worldNow: number): number {
  if (!Number.isFinite(worldNow)) return 0;
  const day = Math.floor(worldNow / DAY_MS);
  return worldNow - (day * DAY_MS + lightsOnOffsetMs());
}

/** 第 `order` 盏（0 起）在窗口里的起点偏移。单盏时就是 0。 */
export function ignitionStartOffsetMs(order: number, total: number): number {
  if (!Number.isFinite(order) || total <= 1) return 0;
  const index = Math.min(Math.max(order, 0), total - 1);
  return (index * IGNITION_SPAN_MS) / (total - 1);
}

/** 第 `order` 盏在当天的那一个世界时刻（绝对毫秒）。 */
export function ignitionWorldMs(worldNow: number, order: number, total: number): number {
  const day = Math.floor(worldNow / DAY_MS);
  return day * DAY_MS + lightsOnOffsetMs() + ignitionStartOffsetMs(order, total);
}

/** 平滑起亮：两端导数为 0，中间快——读成「灯芯被点着」而不是插值。 */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 第 `order` 盏此刻亮到什么程度（假定整条街已该亮）。
 *
 * 只是 `lampIgnitionAt` 去掉总闸那一半：`debugForceLamps(true)` 要能在正午
 * 也把灯点亮，靠的就是这一层；夜里的正常路径仍走 `lampIgnitionAt`。
 */
export function lampIgnitionProgress(
  worldNow: number,
  order: number,
  total: number,
): number {
  const elapsed = msSinceLightsOn(worldNow);
  if (elapsed < 0) {
    // 今天还没到点灯时刻：凌晨那段（收灯之前）是从昨天亮过来的，给 1；
    // 傍晚点灯之前（比如 17:59）必须还是暗的——强制相位下 `lit` 已经说「亮」，
    // 但「几点亮的」仍归世界时刻管，不能把下午也当成「昨天点着的」。
    return minuteOfDay(worldNow) < lightsOutMinute() ? 1 : 0;
  }
  const start = ignitionStartOffsetMs(order, total);
  if (elapsed >= start + IGNITION_RAMP_MS) return 1;
  if (elapsed <= start) return 0;
  return ease((elapsed - start) / IGNITION_RAMP_MS);
}

/**
 * 第 `order` 盏此刻亮到什么程度：0 = 暗，1 = 亮满。
 *
 * `lampStreetLitAt` 仍是**总闸**：它说不亮，整条街就一盏都不亮；
 * 它说亮，才按世界时刻逐盏起亮。凌晨那段（`msSinceLightsOn` 为负）按
 * 「昨天已经亮过」直接给 1，不做假渐次。
 */
export function lampIgnitionAt(
  worldNow: number,
  order: number,
  total: number,
  phase: LampPhase,
  autoAdvancing = true,
): number {
  if (!lampStreetLitAt(worldNow, phase, autoAdvancing)) return 0;
  return lampIgnitionProgress(worldNow, order, total);
}

/** 呼吸的亮度倍率表：一个周期 10 拍，起伏约 ±5%。 */
const BREATH_STEPS = [1, 1.03, 1.06, 1.08, 1.06, 1.03, 1, 0.97, 0.95, 0.97] as const;
/** 呼吸每一拍的世界毫秒：10 拍 = 5 世界分钟。 */
const BREATH_STEP_MS = worldMinutes(0.5);

/** 第 `order` 盏此刻的亮度倍率。 */
export function lampBreathAt(worldNow: number, order: number): number {
  if (!Number.isFinite(worldNow)) return 1;
  const step = Math.floor(worldNow / BREATH_STEP_MS) + Math.round(order * 3);
  const index = ((step % BREATH_STEPS.length) + BREATH_STEPS.length) % BREATH_STEPS.length;
  return BREATH_STEPS[index]!;
}

/** 风摆的横向像素表：16 拍一周期，幅度 1px——16px 瓦片尺度下再大就读成断杆。 */
const SWAY_X = [0, 1, 1, 1, 0, 0, -1, -1, -1, -1, 0, 0, 1, 1, 0, 0] as const;
/** 悬挂灯的纵向抬升表：与横向错开半拍，摆起来才像钟摆而不是滑动。 */
const SWAY_LIFT = [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] as const;
/** 风摆每一拍的世界毫秒：16 拍 = 3.2 世界分钟。 */
const SWAY_STEP_MS = worldMinutes(0.2);

/**
 * 第 `order` 盏此刻的位移（整数像素）。
 *
 * 灯柱只晃灯体、不晃柱脚（柱脚钉在地上）；灯串上挂的纸灯跟着绳一起摆，
 * 所以 `hanging` 多一个纵向抬升。
 */
export function lampSwayAt(
  worldNow: number,
  order: number,
  hanging: boolean,
): { readonly dx: number; readonly dy: number } {
  if (!Number.isFinite(worldNow)) return { dx: 0, dy: 0 };
  const step = Math.floor(worldNow / SWAY_STEP_MS) + Math.round(order * 5);
  const index = ((step % SWAY_X.length) + SWAY_X.length) % SWAY_X.length;
  return { dx: SWAY_X[index]!, dy: hanging ? SWAY_LIFT[index]! : 0 };
}

/** 一组灯在某一刻的画面亮度：渐次 × 呼吸（任一支关掉就退成常量）。 */
export function lampBrightnessAt(
  worldNow: number,
  order: number,
  total: number,
  phase: LampPhase,
  autoAdvancing: boolean,
  motion: LampMotion,
): number {
  const ignition = motion.ignite
    ? lampIgnitionAt(worldNow, order, total, phase, autoAdvancing)
    : (lampStreetLitAt(worldNow, phase, autoAdvancing) ? 1 : 0);
  if (ignition === 0) return 0;
  return ignition * (motion.breathe ? lampBreathAt(worldNow, order) : 1);
}

/** 证据脚本用：一整天里第一盏与最后一盏的世界时刻，以及此刻已经亮了几盏。 */
export interface IgnitionSchedule {
  readonly total: number;
  readonly spanMs: number;
  readonly rampMs: number;
  /** 第一盏的世界时刻（当天点灯那一拍起算）；不亮的那半天为 `null`。 */
  readonly firstAtMs: number | null;
  readonly lastAtMs: number | null;
  readonly litAt: number;
}

export function ignitionSchedule(
  worldNow: number,
  total: number,
  phase: LampPhase,
  autoAdvancing = true,
): IgnitionSchedule {
  const base = {
    total,
    spanMs: IGNITION_SPAN_MS,
    rampMs: IGNITION_RAMP_MS,
    litAt: 0,
  };
  if (total <= 0 || !lampStreetLitAt(worldNow, phase, autoAdvancing)) {
    return { ...base, firstAtMs: null, lastAtMs: null };
  }
  const litAt = Array.from({ length: total }, (_, i) => (
    lampIgnitionAt(worldNow, i, total, phase, autoAdvancing) >= 1 ? 1 : 0
  )).reduce<number>((sum, n) => sum + n, 0);
  return {
    ...base,
    firstAtMs: ignitionWorldMs(worldNow, 0, total),
    lastAtMs: ignitionWorldMs(worldNow, total - 1, total),
    litAt,
  };
}
