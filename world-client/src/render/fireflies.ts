/** 萤火虫的固定位置：只放在空地上，不跟着仿真走，避免夜景变成随机噪声。
 *
 * 为什么单独一个文件：这份数据原来住在 `phase-view.ts` 里，而那个文件 import
 * Phaser，node 测试碰不得（Phaser 要 DOM）。于是「萤火真的在空地上吗」这件事
 * 没有任何机器在看——只能靠人手点。搬到这儿之后 `test/firefly-ground.test.ts`
 * 就能把它钉住：八枚全得落在默认大世界里可行走、无建筑的格子上。
 *
 * 单位是**像素**（`fillRect(point.x, point.y, 1, 1)` 画的是 1px 的点），
 * 不是格。换算成格要除 `TILE_PX`，所以坐标不要求是 16 的整数倍。
 *
 * 位置是手工挑的，没有生成规则；换位置或加位置都要过上面那个测试。
 */
export const FIREFLIES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 64, y: 190 },
  { x: 118, y: 258 },
  { x: 184, y: 118 },
  { x: 220, y: 300 },
  { x: 296, y: 186 },
  { x: 352, y: 252 },
  { x: 412, y: 300 },
  { x: 430, y: 148 },
];
