/** 道具的落地坐标与 depth：纯函数，不碰 Phaser，可以在 Node 里直接验算。
 *
 * 为什么单独一个文件
 * ------------------
 * 道具 depth 的正确性靠「和角色同一套口径」保证，而这种算术必须能独立验算——
 * 塞进依赖 Phaser 的 decor.ts 里就只能靠肉眼判断。decor.ts 负责画，这里负责算。
 *
 * 阶段 0 起公式本体搬到 `ground.ts`：`propFootAt` 是 `groundY - 0.2 格`，
 * `propDepthAt` 锚在行号并只吃 `level × 0.5` 的亚像素项。这里只做对象到行号的
 * 转接，保证 drawProp 的 y 与 depth 永远同源。
 */

import type { WorldProp } from '../world/types.ts';
import { ACTOR_DEPTH_OFFSET, propDepthAt, propFootAt } from './ground.ts';

/**
 * 道具的落地 y（像素）。**必须**与 drawProp 里 setPosition 用的 y 是同一个表达式，
 * 否则 depth 会锚在一个并不存在的落点上——排序看起来「有效」但和画面不符。
 *
 * 0.8 是既有画法给摆件的落点偏移（站在格内偏下），不是随手取的数。
 */
export function propFootY(prop: WorldProp, originY: number, level = 0): number {
  return propFootAt(prop.at.y, originY, level);
}

/**
 * 角色 depth 的偏移量：由 `ground.ts` 定义，这里转出给旧调用方/测试。
 * 道具与角色沿用同一档，两者才在同一把尺子上可比。
 */
export { ACTOR_DEPTH_OFFSET };

/** 道具 depth：锚在行号，与角色同一套口径（level 默认 0）。 */
export function propDepth(prop: WorldProp, originY: number, altitude: number, level = 0): number {
  return propDepthAt(prop.at.y, altitude, originY, level);
}
