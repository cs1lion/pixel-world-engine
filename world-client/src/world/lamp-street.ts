/** 灯街的点灯时刻：18:00 亮、05:00 收。
 *
 * 这是**渲染层的灯态谓词**，不是另一只时钟：它只读 `Simulation` 已经走过的
 * `snapshot.now`（世界时间），不读 `Date.now()`、不写任何状态。时刻本身不在
 * 本文件里写第二份——`light_lamps` 与 `lamps_out` 两拍都从 `timetable.ts` 取。
 *
 * 为什么还要看 `phase`：本仓的昼夜相位跟的是**本地墙钟**（`render/day-phase.ts`），
 * 而世界时间从存档的 `now` 起算。两份时钟可以不同步，所以灯态取两者同时成立的
 * 那一刻：黄昏且过了点灯时刻，或夜里且还没到收灯时刻。强制相位（`?time=`）下
 * 直接按该相位的代表时刻判，截图与回归才能复现。
 */

import { minuteOfDay, TIMETABLE, type TimetableId } from './timetable.ts';

/** 相位词。**不 import `render/day-phase`**：世界层不依赖渲染层。 */
export type LampPhase = 'dawn' | 'noon' | 'dusk' | 'night';

/**
 * 从时刻表取一拍的分钟数。
 *
 * 写死 `18 * 60` / `5 * 60` 就是把时刻表抄了第二份；这里只认 `id`。
 * 表里缺那一拍是代码错误（`TimetableId` 是闭集），当场抛，不静默退回某个数。
 */
function timetableMinute(id: TimetableId): number {
  const beat = TIMETABLE.find((item) => item.id === id);
  if (beat === undefined) throw new Error(`时刻表缺少 ${id}`);
  return beat.minuteOfDay;
}

const LIGHTS_ON_MINUTE = timetableMinute('light_lamps');
const LIGHTS_OUT_MINUTE = timetableMinute('lamps_out');

/**
 * 此刻灯街的灯亮不亮。
 *
 * - 自动相位（正常游玩）：世界分钟过点灯时刻且处于黄昏，或处于夜里且还没到收灯时刻。
 * - 强制相位（`?time=` / N 键）：按该相位的代表时刻判——黄昏=亮、夜=亮、
 *   正午=不亮、晨=不亮。这样同一张截图不会因为页面打开的世界时刻不同而变灯。
 */
export function lampStreetLitAt(
  worldNow: number,
  phase: LampPhase,
  autoAdvancing = true,
): boolean {
  if (!autoAdvancing) return phase === 'dusk' || phase === 'night';
  const minute = minuteOfDay(worldNow);
  if (phase === 'dusk') return minute >= LIGHTS_ON_MINUTE;
  if (phase === 'night') return minute >= LIGHTS_ON_MINUTE || minute < LIGHTS_OUT_MINUTE;
  return false;
}

/** 这一刻该亮的街灯数。灯态是同一个谓词，数只是把「哪些灯」乘上去。 */
export function litLampCountAt(
  worldNow: number,
  phase: LampPhase,
  total: number,
  autoAdvancing = true,
): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return lampStreetLitAt(worldNow, phase, autoAdvancing) ? total : 0;
}
