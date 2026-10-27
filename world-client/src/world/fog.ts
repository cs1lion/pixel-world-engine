/** 迷雾：世界还没长出来的部分。
 *
 * 一条硬约束：**迷雾不影响通行，只影响建造与观感**。
 *
 * 为什么：存档里没有网格数据，读档时按建筑坐标重建网格。如果迷雾让格子不可走，
 * 一栋落在迷雾里的建筑读档后就成了孤岛——玩家会看到"铺子在，但人走不进去"。
 * 所以迷雾只做两件事：压暗画面、拦住新建造。
 *
 * 纯函数，不碰网格也不碰渲染。
 */

import type { GridPoint } from './types.ts';

/**
 * 开局点亮的半径。
 *
 * **必须盖住所有可建区**（镇内 + 郊野，最远 35.0 格），否则拆了铺子想重建时
 * 会被「那里还没长出来」拒绝。
 *
 * 取 38：郊野最远 35.0 格，38 留出余量；再往外是迷雾。
 * 96×72 的地图最远角约 60 格（实测 59.3），38 以外那一环实测 2432/6912 格
 * = 35.2% 面积——够放下一层真正的「未探索」，这是更小的图做不到的。
 *
 * 「最远 35.0 格」是**默认世界**（`LARGE_WORLD_SPEC`）的数，别读成对所有设定集
 * 成立：这个常量是全局的，而包自己的图另有一套尺寸。灯潮界 64×48、镇心 (32,29)，
 * industry 区铺到 x 1–62 / y 1–46，最远可建格 41.77——比 38 远，开局在迷雾外，
 * 玩家在那儿会先看到「那里还没长出来」。那不是死路：半径随交付长，顶到 60 时
 * 全图（含灯潮界最远角 43.29）都揭得开。但「盖住所有可建区」这句话在包上不成立，
 * 写在这儿免得它被当成普适保证。
 *
 * （上面这几个「实测」用的是**格心坐标**：祭坛是 (48,36) 这个点，格子取
 * (x+0.5, y+0.5)。换成**整数格坐标**——`fogAt` 与 `biomeAt` 用的那把——
 * 最远角是 60.0、那一环是 2460 格 = 35.6%。两把尺子别混用：本段「郊野最远
 * 35.0 格」是整数格的（跟着 `biomeAt` 走），「2432 / 59.3」是格心的。
 * 没写明尺子的话，照着错的尺子算一遍会以为这几个数是编的。）
 *
 * （这里原来写着「约占 38% 面积」「这是 80×60 做不到的」：百分比实测是 35.2%，
 *  而 80×60 是个从来没存在过的尺寸——这个世界从一开始就是 96×72。
 *  见 `setup.ts` 那段说明。）
 */
export const FOG_INITIAL_RADIUS = 38;

/** 交付多少单扩一格。太密会让画面一直在变。 */
const DELIVERIES_PER_STEP = 4;

/**
 * 揭示半径的上限：地图最远角 60.0 格，再大就没有格可揭了。
 *
 * 最远角从 `LARGE_WORLD_SPEC` + `LARGE_ALTAR` 现算（`fog.test.ts` 的
 * `FARTHEST_CELL_DISTANCE`），用的是 `fogAt` 自己那把尺子——整数格坐标。
 * 它量的是**格位**不是格心：最远那格的格心只差 59.30。取 60.0 那个大的，
 * 因为 `fogAt` 比的正是格位；60 也就是「每一格都点得亮」的最小半径。
 *
 * 原来取 58，理由写的是「地图最远角约 60，超过它就没有意义了」。可 58 没到 60：
 * 四角各剩一小撮永远揭不亮，实测 19 格 / 6912 = 0.27%。那句话描述的不是这个值
 * 做的事——「到顶了也看不见全图」与「再大没有意义」是两回事。已改成贴着最远角。
 */
const MAX_RADIUS = 60;

export interface FogState {
  readonly center: GridPoint;
  readonly revealedRadius: number;
}

/**
 * 这一格是否还在迷雾里。
 *
 * 用欧氏距离，与群落判定同一把尺子：迷雾边界和"郊野"边界读起来该是一致的。
 */
export function fogAt(point: GridPoint, state: FogState): boolean {
  return Math.hypot(point.x - state.center.x, point.y - state.center.y) > state.revealedRadius;
}

/**
 * 交付单数 → 揭示半径。
 *
 * 每 `DELIVERIES_PER_STEP` 单扩一格，且不会小于初始半径。
 * 传进 NaN 时退回初始值：宁可少揭，不要因为一个坏数字把整张图点亮。
 */
export function revealedRadiusFor(deliveries: number): number {
  if (!Number.isFinite(deliveries) || deliveries <= 0) return FOG_INITIAL_RADIUS;
  const steps = Math.floor(deliveries / DELIVERIES_PER_STEP);
  return Math.min(MAX_RADIUS, FOG_INITIAL_RADIUS + steps);
}

/**
 * 盖住整张网格的揭示半径：一格迷雾都不剩。
 *
 * 只给设定集（`SettingPack.authored`）用。那种地图整张都是「已经到过的地方」——
 * 渡口、灯街、积尘滩是一口气铺开的，中间留一片迷雾读起来像「这里还没长出来」。
 * 旧镇的迷雾照旧由世界自己收敛，不走这条。
 *
 * 取 `width + height`，不是量出来的最小值。圆心落在网格**任意**位置时，最远那一格
 * 隔 `hypot(w-1, h-1)`；两直角边之和永远不小于斜边，所以 `w + h` 对任何圆心都够
 * （96×72 取 168，实际最远角隔 118.6）。取和而不取对角线 `hypot(w, h)`（=120）：
 * 这个数只需要「够」，不需要紧，紧的那一档没有观众，而和式不用多引一个 `Math`。
 *
 * 「够」有锁：`fog.test.ts` 的「盖住整张网格」那条按三种真实网格逐格扫，
 * 圆心取左上角——离所有格子最远的位置，所以那条过得去，任何圆心都过得去。
 */
export function wholeGridRadius(grid: {
  readonly width: number;
  readonly height: number;
}): number {
  return grid.width + grid.height;
}
