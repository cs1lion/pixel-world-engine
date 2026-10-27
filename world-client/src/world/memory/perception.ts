/** 感知：谁能记下一件事。
 *
 * 协议第 2 节把「地点」与「在场」列为两个基础概念，因为 `witnesses` 必须在
 * 事件发出的那一刻算好、写死。补充设计 §3.1 给了参数：室外 8 格、室内同房间、
 * 视线受墙体遮挡。
 *
 * 这一层是纯的：吃一张格子的可通行图、一组观察者的位置、一个事件落点，
 * 返回一串 holder id。不读 `Simulation`、不读时钟，因此可离线测。
 *
 * **室内/室外的区别是硬的，不是半径的微调。** 在工坊里炸炉，屋外站在门口
 * 三格的人看不见——他只能事后看见焦痕，或者听说。这正是痕迹通道存在的理由；
 * 如果把室内事件也按 8 格半径发出去，痕迹就退化成装饰。
 */

import type { GridPoint } from '../types.ts';
import type { MemoryConfig } from './config.ts';

/** 观察者。`inside` 是它此刻所在建筑的 id；室外为 null。 */
export interface Perceiver {
  readonly holderId: string;
  readonly at: GridPoint;
  readonly inside: string | null;
}

/** 一个地点在地图上的落点。`indoor` 表示这个地点是不是室内空间。 */
export interface PlaceAnchor {
  readonly placeId: string;
  readonly at: GridPoint;
  readonly indoor: boolean;
  /** 地点类型（工坊 / 祭坛 / 酒馆…）。后果规则按它决定留什么痕迹。 */
  readonly placeType?: string;
}

/**
 * 遮挡查询需要的最小地图面。
 *
 * 只要这一个方法，不传整个 `WorldGrid`：感知不该知道网格的潮位、区域、寻路代价。
 * 测试里给一个格子集合就能验遮挡。
 */
export interface OcclusionGrid {
  isWalkable(p: GridPoint): boolean;
}

export interface PerceptionInput {
  readonly place: PlaceAnchor;
  readonly perceivers: readonly Perceiver[];
  readonly grid: OcclusionGrid;
  readonly config: MemoryConfig;
}

/**
 * 事件落点的在场者，按输入顺序返回，不含重复。
 *
 * 规则按顺序判：
 * 1. 事件在室内：只有**同一个房间**里的人在场。屋外的人一律不在，哪怕贴墙站着。
 * 2. 观察者自己在室内：他看不见室外发生的事。他在屋里，窗外的事不归他。
 * 3. 室外事件：欧氏距离不超过 `perceptionRadius`，且视线不被墙挡住。
 */
export function witnessesOf(input: PerceptionInput): string[] {
  const { place, perceivers, grid, config } = input;
  const witnesses: string[] = [];
  const seen = new Set<string>();

  for (const perceiver of perceivers) {
    if (seen.has(perceiver.holderId)) continue;
    if (!perceives(perceiver, place, grid, config)) continue;
    seen.add(perceiver.holderId);
    witnesses.push(perceiver.holderId);
  }
  return witnesses;
}

/** 单个观察者能不能感知到这件事。 */
export function perceives(
  perceiver: Perceiver,
  place: PlaceAnchor,
  grid: OcclusionGrid,
  config: MemoryConfig,
): boolean {
  // 室内事件：默认只有同一个房间里的人在场。
  //
  // `indoorSameRoom = false` 时退回「室内也按半径算」——那是另一种世界设定
  // （比如一间大通铺工坊，屋里屋外都看得见）。这个开关存在是因为设定集可换：
  // 千与千寻的油屋是隔间的，换成一个大棚就不是了。**但默认必须是 true**：
  // 按半径发室内事件，痕迹通道就退化成装饰。
  if (place.indoor) {
    if (config.indoorSameRoom) return perceiver.inside === place.placeId;
  } else if (perceiver.inside !== null) {
    // 观察者在室内：他看不见室外发生的事。窗外的事不归他。
    return false;
  }
  if (distance(perceiver.at, place.at) > config.perceptionRadius) return false;
  if (!config.occlusion) return true;
  return hasLineOfSight(perceiver.at, place.at, grid);
}

/** 欧氏距离。用距离而不是切比雪夫：8 格是一个圆，不是一方块。 */
export function distance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 两点之间有没有一条不被墙挡住的路。
 *
 * Bresenham 逐格走，**两端都不算**：起点是观察者站的格子（必然可走），
 * 终点是事件落点（可能正是一栋楼的墙里）。中间任何一格不可走就算挡住。
 *
 * 这条路是「格子中心到格子中心」的近似，不是真正的视线几何。对像素网格来说
 * 够用，而且它的不确定性是**一致的**：同一对坐标永远得到同一个答案，回放
 * 不会因为换了台机器就换个结果。
 */
export function hasLineOfSight(from: GridPoint, to: GridPoint, grid: OcclusionGrid): boolean {
  const x0 = Math.round(from.x);
  const y0 = Math.round(from.y);
  const x1 = Math.round(to.x);
  const y1 = Math.round(to.y);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx - dy;
  let x = x0;
  let y = y0;

  while (x !== x1 || y !== y1) {
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
    if (x === x1 && y === y1) break;
    if (!grid.isWalkable({ x, y })) return false;
  }
  return true;
}
