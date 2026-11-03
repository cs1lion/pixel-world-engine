/** 街面光池：灯笼落在**地面**上的那一圈暖光。
 *
 * 为什么单独一个纯模块：池子的半径与强度是潮位的函数，要能在 node 下被单测
 * 钉住，而不是靠截图猜；`setting-scenery.ts` 只拿这里算好的几圈去画。
 *
 * 口径（不是凑数）：
 * - 点光源（单根灯柱）的池子是**扁椭圆**：地面是斜着看过去的，纵向半径约为
 *   横向的 0.4；
 * - 外圈横向半径 2 格（32px），与「4 格一根」的灯柱间距正好错开：相邻两池
 *   在街面上相切、不叠成一团，所以不用 additive 层去堆亮度；
 * - 纵向 13px 压在地砖上，不往上飘——离地 20 多像素的光晕留在灯体那一层，
 *   这里只管落地的那一圈；
 * - 潮位越高池子越大也越亮：半径 0.75→1.0 倍、强度 0.45→1.0 倍。两端之外
 *   按端点算（潮位是 0..1 的连续量，不设档位）。
 */

/** 一圈池子：外圈在前，内圈在后（同心，不另铺整块）。 */
export interface LampPoolBand {
  /** 横向半径（像素）。 */
  readonly rx: number;
  /** 纵向半径（像素）。 */
  readonly ry: number;
  /** 叠在地面上的透明度。 */
  readonly alpha: number;
}

/** 单根灯柱的外圈横向半径：32px = 2 格。 */
export const POINT_POOL_RX = 32;
/** 单根灯柱的外圈纵向半径：斜看地面的扁率约 0.4。 */
export const POINT_POOL_RY = 13;
/** 灯串 / 店面这种长条光源的纵向半径：比点光源更扁一档。 */
export const WIDE_POOL_RY = 10;

/** 四圈的比例与透明度（外→内）。外圈淡而宽，内圈窄而亮。 */
const POINT_SHAPE = [1, 0.78, 0.55, 0.32] as const;
const POINT_ALPHA = [0.09, 0.13, 0.19, 0.26] as const;
/** 长条光源三圈：中间那圈再窄就只剩两条边，读不出「一整片光」。 */
const WIDE_SHAPE = [1, 0.72, 0.45] as const;
const WIDE_ALPHA = [0.07, 0.11, 0.16] as const;

const clampLevel = (level: number): number =>
  Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;

/** 潮位 → 池子半径的倍率。退潮 0.75、满潮 1。 */
export function lampPoolReach(level: number): number {
  return 0.75 + 0.25 * clampLevel(level);
}

/** 潮位 → 池子强度的倍率。退潮 0.45、满潮 1。 */
export function lampPoolGain(level: number): number {
  return 0.45 + 0.55 * clampLevel(level);
}

/** 单根灯柱的四圈：潮位同时改半径与强度。 */
export function lampPoolBands(level: number): readonly LampPoolBand[] {
  const reach = lampPoolReach(level);
  const gain = lampPoolGain(level);
  return POINT_SHAPE.map((shape, i) => ({
    rx: POINT_POOL_RX * reach * shape,
    ry: POINT_POOL_RY * reach * shape,
    alpha: POINT_ALPHA[i]! * gain,
  }));
}

/**
 * 灯串 / 店面的长条池子：横向按实际跨度给（半个跨度）。
 *
 * 这里只让潮位改强度、不改长度：一条 12 格灯串的光带若随潮位伸缩，
 * 看上去像灯串自己在缩短，而不是水涨灯亮。
 */
export function wideLampPoolBands(level: number, halfWidth: number): readonly LampPoolBand[] {
  const gain = lampPoolGain(level);
  const rx = Math.max(0, halfWidth);
  return WIDE_SHAPE.map((shape, i) => ({
    rx: rx * shape,
    ry: WIDE_POOL_RY * shape,
    alpha: WIDE_ALPHA[i]! * gain,
  }));
}
