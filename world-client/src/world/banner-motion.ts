/** 幌布的动态层：布身摆动 + 沿墙投影。
 *
 * 与灯街、摊位同一套口径：**只读世界时刻**，表驱动整数动画，不读墙钟、不存上一帧。
 * 同一世界时刻必然同一帧。
 *
 * 两个开关各自独立（`BannerMotion`）：
 * - `sway`：布身横摆 1px、下沿抬 1px；杆子钉死不动。
 * - `shadow`：沿墙投影。**长度与浓淡由光照相位给**，正午短、黄昏长、夜里几乎无；
 *   投影跟着布身一起横移，才像同一块布投下来的。
 *
 * 周期：12 拍 × 2 世界秒 = 24 世界秒一循环（不是 60 秒——t / t+1s 不能踩回同相）。
 */

export interface BannerMotion {
  readonly sway: boolean;
  readonly shadow: boolean;
}

export const BANNER_MOTION_ON: BannerMotion = { sway: true, shadow: true };

export const BANNER_MOTION_OFF: BannerMotion = { sway: false, shadow: false };

/** 每一拍的世界毫秒数（`worldSeconds(2)` = 2000 世界毫秒）。 */
const worldSeconds = (seconds: number): number => Math.round(seconds * 1000);

/**
 * 布身横摆：12 拍 × **2** 世界秒，取值 -1..1 像素。
 *
 * 步长从 3 秒改到 2 秒是证据口径逼出来的：18:10:00 与 18:11:00 对三面幌布
 * （offset 0/4/8）在 3 秒步长下都落在 dx=0，帧差全 0.00%——采样踩回同相，
 * 量不到摆动。2 秒步长下 t 时三面为 [0,0,0]、t+1s 为 [-1,0,1]。
 */
const BANNER_DX = [0, 1, 1, 0, 0, -1, -1, 0, 0, 1, 0, -1];
const BANNER_STEP_MS = worldSeconds(2);

/**
 * 沿墙投影的「太阳高度」：正午最短、黄昏最长、夜里几乎无。
 *
 * 数值是像素长度与墨色 alpha。夜里给 0 不是"省一笔"，是**灯下本来就没有那条影子**；
 * 而且南侧幌布的落影会落进夜街扫描带（y 435..535），夜里给 0 才能保证
 * 光带覆盖率与暗带读数不被这条影子改写。
 */
const SHADOW_SPAN: Readonly<Record<'dawn' | 'noon' | 'dusk' | 'night', number>> = {
  dawn: 2,
  noon: 1,
  dusk: 5,
  night: 0,
};
const SHADOW_ALPHA: Readonly<Record<'dawn' | 'noon' | 'dusk' | 'night', number>> = {
  dawn: 0.10,
  noon: 0.07,
  dusk: 0.20,
  night: 0,
};

export type BannerPhase = keyof typeof SHADOW_SPAN;

/** 影长（像素）：证据脚本拿它核对"正午短、黄昏长、夜里几乎无"。 */
export function bannerPhaseSpan(phase: BannerPhase): number {
  return SHADOW_SPAN[phase];
}

const beat = (worldNow: number, stepMs: number, offset: number, length: number): number => {
  const raw = Math.floor(worldNow / stepMs) + offset;
  return ((raw % length) + length) % length;
};

/** 布身的横摆（像素）与下沿抬升（像素）：`order` 是幌布在设定集里的次序，错开相位。 */
export function bannerSwayAt(worldNow: number, order: number): { dx: number; tilt: number } {
  const index = beat(worldNow, BANNER_STEP_MS, order * 4, BANNER_DX.length);
  const dx = BANNER_DX[index] ?? 0;
  // 摆开的那几拍把下沿抬 1px：只平移会读成"整块布在滑"，抬边才像被风甩了一下。
  return { dx, tilt: Math.abs(dx) };
}

/** 沿墙投影的长度与浓淡：由相位给，不读墙钟；横移跟着布身走。 */
export function bannerShadowAt(
  worldNow: number,
  order: number,
  phase: BannerPhase,
): { dx: number; span: number; alpha: number } {
  const sway = bannerSwayAt(worldNow, order);
  const step = sway.dx === 0 ? 0 : sway.dx > 0 ? 1 : -1;
  return {
    // 影子比布身多走 1px：光从西边来，布一甩影子先动。
    dx: sway.dx + step,
    span: SHADOW_SPAN[phase],
    alpha: SHADOW_ALPHA[phase],
  };
}
