/** 摊位的动态层：棚布摆动、雨天盖布摆动、火盆火光跳动。
 *
 * 与灯街那三支（`lamp-motion.ts`）同一套口径：**只读世界时刻**，表驱动整数动画，
 * 不读墙钟、不存上一帧。同一世界时刻必然同一帧。
 *
 * 三件事的开关各自独立（`StallMotion`）：
 * - `cloth`：干天摆的是棚布，雨天摆的是盖布；同一时刻只会有一个在动。
 * - `fire`：火盆的焰高与亮度。火盆不投地面光池，因此不改夜街光带读数。
 *
 * 周期为什么是这些数：摆布 16 拍 × 4 世界秒 = 64 世界秒一循环（默认倍率 60 下
 * 约 1 真实秒走完 4 拍，看上去是慢摆而不是抖）；火光 12 拍 × 2 世界秒 = 24 世界
 * 秒一循环，比摆布快，才有"火在跳"的读法。
 */

export interface StallMotion {
  readonly cloth: boolean;
  readonly fire: boolean;
}

export const STALL_MOTION_ON: StallMotion = { cloth: true, fire: true };

export const STALL_MOTION_OFF: StallMotion = { cloth: false, fire: false };

/** 每一拍的世界毫秒数（`worldSeconds(4)` = 4000 世界毫秒）。 */
export const worldSeconds = (seconds: number): number => Math.round(seconds * 1000);

/** 棚布横摆：16 拍，取值 -1..1 像素；柱脚与柜台不动。 */
const CLOTH_DX = [0, 1, 1, 1, 0, 0, -1, -1, -1, 0, 0, 1, 1, 0, 0, -1];
const CLOTH_STEP_MS = worldSeconds(4);

/** 盖布横摆：12 拍 × 4 世界秒 = 48 世界秒一循环，相位与棚布错开——
 * 两件不是同一块布，不该同手同脚；周期也不能正好 60 秒（t / t+1s 会踩回同相）。 */
const COVER_DX = [0, 0, 1, 1, 1, 0, 0, -1, -1, -1, 0, 0];
const COVER_STEP_MS = worldSeconds(4);

/** 火光：亮度系数（压在暖色 alpha 上）与焰高（像素）。12 拍 × 2 世界秒。 */
const FIRE_LEVEL = [1, 0.82, 0.66, 0.9, 0.72, 1, 0.6, 0.86, 0.7, 0.95, 0.64, 0.88];
const FIRE_HEIGHT = [3, 2, 2, 3, 2, 4, 2, 3, 2, 3, 2, 3];
const FIRE_STEP_MS = worldSeconds(2);

const beat = (worldNow: number, stepMs: number, offset: number, length: number): number => {
  const raw = Math.floor(worldNow / stepMs) + offset;
  return ((raw % length) + length) % length;
};

/** 棚布的横摆（像素）：`order` 是摊子在设定集里的次序，错开相位免得整排同摆。 */
export function stallClothSwayAt(worldNow: number, order: number): { dx: number; lift: number } {
  const index = beat(worldNow, CLOTH_STEP_MS, order * 3, CLOTH_DX.length);
  const dx = CLOTH_DX[index] ?? 0;
  // 掀起来的那两拍把布边抬 1px：只平移会读成"整块布在滑"，抬边才像风掀。
  return { dx, lift: Math.abs(dx) };
}

/** 盖布的横摆（像素）+ 下沿下垂 1px（布落下来压住柜台）。 */
export function stallCoverSwayAt(worldNow: number, order: number): { dx: number; droop: number } {
  const index = beat(worldNow, COVER_STEP_MS, order * 2, COVER_DX.length);
  const dx = COVER_DX[index] ?? 0;
  return { dx, droop: dx === 0 ? 0 : 1 };
}

/** 火光：`level` 压 alpha，`height` 是焰高像素。 */
export function stallFireAt(worldNow: number, order: number): { level: number; height: number } {
  const index = beat(worldNow, FIRE_STEP_MS, order * 5, FIRE_LEVEL.length);
  return {
    level: FIRE_LEVEL[index] ?? 1,
    height: FIRE_HEIGHT[index] ?? 3,
  };
}
