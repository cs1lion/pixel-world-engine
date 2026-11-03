/** 灯街的点灯时刻：18:00 亮、天亮收。
 *
 * 这是**渲染层的灯态谓词**，不是另一只时钟：它只读 `Simulation` 已经走过的
 * `snapshot.now`（世界时间），不读 `Date.now()`、不写任何状态。与
 * `feat/pace-60` 分支里的时刻表模块同一口径——世界日的第几分钟，
 * 18:00 = 1080。那个文件还没进 main，所以这里先把同一条判据落在本地；
 * 它合并进来之后，本文件的 `minuteOfDay` 应改成 import 它，而不是再抄一份。
 *
 * 为什么还要看 `phase`：本仓的昼夜相位跟的是**本地墙钟**（`render/day-phase.ts`），
 * 而世界时间从存档的 `now` 起算。两份时钟可以不同步，所以灯态取两者同时成立的
 * 那一刻：黄昏且过了 18:00，或夜里且还没到天亮。强制相位（`?time=`）下直接
 * 按该相位的代表时刻判，截图与回归才能复现。
 */

import { DAY_MS } from './memory/config.ts';

/** 相位词。**不 import `render/day-phase`**：世界层不依赖渲染层。 */
export type LampPhase = 'dawn' | 'noon' | 'dusk' | 'night';

/** 18:00 点灯。 */
export const LAMP_ON_MINUTE = 18 * 60;
/** 天亮收灯：本仓的 dawn 从 05:00 开始，与 `day-phase.ts` 的边界同一条口径。 */
export const LAMP_DOWN_MINUTE = 5 * 60;

const MS_PER_MINUTE = 60_000;

/** 世界日的第几分钟（0..1439）。负数时刻也稳定。 */
export function minuteOfDay(worldNow: number): number {
  if (!Number.isFinite(worldNow)) return 0;
  const day = Math.floor(worldNow / DAY_MS);
  return Math.floor((worldNow - day * DAY_MS) / MS_PER_MINUTE);
}

/**
 * 此刻灯街的灯亮不亮。
 *
 * - 自动相位（正常游玩）：世界分钟过 18:00 且处于黄昏，或处于夜里且还没到 05:00。
 * - 强制相位（`?time=` / N 键）：按该相位的代表时刻判——黄昏=18:00、夜=21:00、
 *   正午=12:00、晨=05:30。这样同一张截图不会因为页面打开的世界时刻不同而变灯。
 */
export function lampStreetLitAt(
  worldNow: number,
  phase: LampPhase,
  autoAdvancing = true,
): boolean {
  if (!autoAdvancing) return phase === 'dusk' || phase === 'night';
  const minute = minuteOfDay(worldNow);
  if (phase === 'dusk') return minute >= LAMP_ON_MINUTE;
  if (phase === 'night') return minute >= LAMP_ON_MINUTE || minute < LAMP_DOWN_MINUTE;
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
