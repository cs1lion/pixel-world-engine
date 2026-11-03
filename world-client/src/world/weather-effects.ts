/** 天气的**行为**后果：不是换滤镜，是居民与摊子怎么动。
 *
 * 纯函数，不读快照、不碰 Phaser。`Simulation` 只在两处调用它们：
 * 走路预算（`walkSpeedFactor`）与作息落点（`fogKeepsClose`）。
 * 渲染层拿到的开关量（摊子收不收、雾多浓）也都是从这几个常量派生的。
 *
 * 阈值为什么是这些数：
 *
 * - `RAIN_WALK_FACTOR = 1.5`：雨里行人快走，一格 1 世界分钟的步子缩到 40 秒。
 *   取 1.5 而不是 2：再快就不像走，像跑；而跑会与「赶路」那块牌子打架。
 * - `FOG_VISIT_CELLS = 8`：莞尔镇 64×48，灯街到渡口约 12 格，镇中心到祭坛约 10 格。
 *   8 格把雾天的活动圈在半条街内——居民仍会去近处的铺子与摊位，但不会横穿全镇。
 *   这个数写进常量，状态行与证据脚本都从它取，不在两处各写一份 8。
 */

import type { GridPoint, Weather } from './types.ts';

/** 雨里走路的倍率。1 表示不加速。 */
export const RAIN_WALK_FACTOR = 1.5;

/** 雾天允许走去的最远格数。超过它的作息落点会被跳过。 */
export const FOG_VISIT_CELLS = 8;

/** 这一档天气下，走路预算乘多少。 */
export function walkSpeedFactor(weather: Weather): number {
  return weather === 'rain' || weather === 'storm' ? RAIN_WALK_FACTOR : 1;
}

/** 雾天只走近路；晴、雨不受这条限制（雨由 `RAIN_WALK_FACTOR` 管快走）。 */
export function fogKeepsClose(weather: Weather, from: GridPoint, target: GridPoint): boolean {
  if (weather !== 'fog') return true;
  return Math.hypot(target.x - from.x, target.y - from.y) <= FOG_VISIT_CELLS;
}

/** 摊子收不收。雨与暴雨收；雾不落雨点，摊子照摆。 */
export function stallsPackedFor(weather: Weather): boolean {
  return weather === 'rain' || weather === 'storm';
}
