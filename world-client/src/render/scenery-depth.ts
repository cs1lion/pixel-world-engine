/** 设定集构件的落地行与 depth：纯函数，不碰 Phaser，可以在 Node 里直接验算。
 *
 * 为什么单独一个文件
 * ------------------
 * 和 `prop-depth.ts` 同一个道理：构件与人物能不能正确前后遮挡，靠的是
 * 「同一把尺子」，这种算术必须能脱离渲染独立断言。`setting-scenery.ts` 只负责画。
 *
 * 人物（`villager.ts`）的 depth 是 `altitude + (row + 1) * TILE_PX + 8`，
 * 脚踩在**行底**。构件按自己的落地行取 `altitude + row * TILE_PX + 12`：
 *
 *   构件 depth = 行底 + 12
 *   上一行的人 = 行底 + 8    → 被构件挡住（站在摊位后）
 *   同一行的人 = 行底 + 24   → 盖住构件（站在摊位前）
 *
 * 为什么是 12 而不是中点 16：建筑楼体的 depth 是 `altitude + baseY`，baseY 取
 * 占地底边。灯串常常挂在「楼体最后一行」上（比如 `lamp_lodge` 底边在 27 行，
 * 灯串挂在 26 行）。取 16 时两者的 depth 恰好相等，谁在前只剩对象创建顺序——
 * 实测灯串会翻到墙面上。取 12 后构件比楼体低 4px，稳稳在墙后；同时
 * 12 仍落在 8..24 之间（只差 4px 与 12px），人物前后判据不受影响。
 */
import { TILE_PX } from '../world/setup.ts';
import { ACTOR_DEPTH_OFFSET } from './prop-depth.ts';

/** 构件 depth 相对落地行的偏移：比人物偏移高 4px，见文件头的推导。 */
export const SCENERY_DEPTH_OFFSET = ACTOR_DEPTH_OFFSET + 4;

/** 构件的落地 y（像素）：行号 × 格径。与 `setting-scenery.ts` 里 `item.at.y * TILE_PX` 同源。 */
export function sceneryFootY(row: number): number {
  return row * TILE_PX;
}

/** 构件 depth：按落地行排序，与人物同一套坐标口径。 */
export function sceneryDepth(row: number, altitude: number): number {
  return altitude + sceneryFootY(row) + SCENERY_DEPTH_OFFSET;
}

/** 人物站在某一行时的 depth（`altitude + (row + 1) * TILE_PX + 8`）。 */
export function actorDepthAtRow(row: number, altitude: number): number {
  return altitude + (row + 1) * TILE_PX + ACTOR_DEPTH_OFFSET;
}
