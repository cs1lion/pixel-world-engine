/** 落地投影与深度的唯一写法：格子坐标 → 屏幕像素 / depth。
 *
 * 纯函数，不 import Phaser，可以在 Node 里直接验算（同 `building-depth.ts` /
 * `prop-depth.ts` 的规矩）。
 *
 * 为什么把这几行单独抽出来
 * ------------------------
 * 今天每一层渲染器各写一遍 `(y + 1) * TILE_PX`，靠「碰巧都写成 16」保持一致。
 * 一旦有格子抬层，谁的脚底改了、谁的道具没改，就会出现「人抬了、树没抬」。
 * 所以这里只留一套：**脚底 = `groundY(gridY, level)`**，其余都是它的派生。
 *
 * 高度只做两件事，别的都不许：
 *   · 位置：每层抬一整格，`- level * LEVEL_PX`（只出现在 `groundTopY` / `groundY`）；
 *   · 深度：每层只挪半个像素做 tie-break，`- level * DEPTH_LEVEL_EPS`，
 *     不参与位置。`MAX_LEVEL × 0.5 = 1.5 < 8`，翻不过现有的四层间距。
 *
 * 阶段 0（本提交）所有调用点传 `level = 0`，因此像素与指纹逐字不变；
 * 阶段 2 才由场景把 `grid.levelAt(p)` 的结果传进来。**渲染层不自己读 levelAt**，
 * 那是 `WorldGrid` 的读入口，不是第二套投影。
 */

import { TILE_PX } from '../world/setup.ts';

/** 每抬一层，屏幕上移多少像素。初值 = 一格；全仓只此一处。 */
export const LEVEL_PX = TILE_PX;

/** 层数上限，只用于深度间距的预算（`MAX_LEVEL × DEPTH_LEVEL_EPS < 8`）。 */
export const MAX_LEVEL = 3;

/** 高度对深度只贡献的亚像素量。保证高层略靠后、但翻不过一格。 */
export const DEPTH_LEVEL_EPS = 0.5;

/** 角色 depth 的偏移量。原来住在 `prop-depth.ts`，现在是投影的一部分。 */
export const ACTOR_DEPTH_OFFSET = 8;

/** 道具落点相对格底向上收进多少：0.8 格是既有画法，不是随手取的数。 */
export const PROP_FOOT_INSET_PX = 0.2 * TILE_PX;

/** 设定集构件的 depth 相对落地行的偏移：比人物高 4px，见 `scenery-depth.ts`。 */
export const SCENERY_DEPTH_OFFSET = ACTOR_DEPTH_OFFSET + 4;

/**
 * 一行格子的上边在屏幕上的 y。`level = 0` 时就是 `gridY * TILE_PX`。
 *
 * 用途：从行顶起画的东西（地形砖、铺路、构件、建筑占地顶边）。
 * 人物的落地线用 `groundY`，别用这个。
 */
export function groundTopY(gridY: number, level = 0): number {
  return gridY * TILE_PX - level * LEVEL_PX;
}

/**
 * 一行格子的下边（= 站在该行的人的脚底）在屏幕上的 y。
 * `level = 0` 时就是 `(gridY + 1) * TILE_PX`。
 */
export function groundY(gridY: number, level = 0): number {
  return (gridY + 1) * TILE_PX - level * LEVEL_PX;
}

/**
 * 角色站在某一行时的 depth。**锚在行号，不锚在投影后的脚底**：
 * 抬层后北边低地人与高地人的屏幕脚底相同，只有行号能把次序定死。
 */
export function actorDepth(gridY: number, altitude: number, level = 0): number {
  return altitude + (gridY + 1) * TILE_PX + ACTOR_DEPTH_OFFSET - level * DEPTH_LEVEL_EPS;
}

/** 道具的落点 y：格底再向上收 0.2 格。与 `drawProp` 的 `setPosition` 同源。 */
export function propFootAt(gridY: number, originY = 0, level = 0): number {
  return originY + groundY(gridY, level) - PROP_FOOT_INSET_PX;
}

/**
 * 道具 depth：锚在行号（`gridY + 0.8` 是既有落点），抬层只贡献亚像素项。
 * 与 `drawProp` 的 y 同源，但**不随投影脚底一起抬**——那是位置，不是次序。
 */
export function propDepthAt(gridY: number, altitude: number, originY = 0, level = 0): number {
  return altitude + originY + (gridY + 0.8) * TILE_PX + ACTOR_DEPTH_OFFSET - level * DEPTH_LEVEL_EPS;
}
