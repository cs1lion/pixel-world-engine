/** 造物主的空间执行器：确定性选址 + 门口自动铺路。
 *
 * 两条纪律，写在前头：
 *  1. **零随机、零墙钟**。没有 `Math.random`、没有 `Date.now`、没有按对象键序迭代的
 *     Map/Set 决定结果。同样的网格 + 同样的输入，永远得到同一串坐标。
 *  2. **只算坐标，不碰世界**。这里不 import Phaser、不调 Simulation、不写存档。
 *     调用方拿着算出来的点去落位、去铺路、去记账。
 *
 * 选址走曼哈顿螺旋：以锚点为中心逐圈外扩，每圈内的方向顺序固定。它不是"最优解"，
 * 是"可解释解"——人问「为什么建在这儿」，答案是「从祭坛往外数，第一个放得下的格子」。
 * 铺路走四方向 BFS：同样固定邻居顺序，遇到障碍绕开，找不到路就明确返回 null，
 * 绝不假装连通。
 */

import type { GridPoint } from '../types.ts';

export interface Bounds {
  readonly width: number;
  readonly height: number;
}

export interface Footprint {
  readonly w: number;
  readonly h: number;
}

/** 一个格子能不能作为建筑的占地/留白。 */
export type CellPredicate = (point: GridPoint) => boolean;

export interface SlotQuery {
  readonly footprint: Footprint;
  /** 四周必须空出的格数（蓝图的 clearMargin）。 */
  readonly margin: number;
  /** 螺旋起点。通常是祭坛或目标分区的中心。 */
  readonly anchor: GridPoint;
  readonly bounds: Bounds;
  /** true = 这一格不能占（越界 / 已有建筑 / 淹没 / 显式障碍）。 */
  readonly blocked: CellPredicate;
  /** 给了就只在这个分区里选；没给则整张图都算。 */
  readonly inRegion?: (point: GridPoint) => boolean;
  /** 整块落位的最终校验（例如 `checkPlacement` 的分区/留白规则）。
   * 逐格的 `blocked` 管不了「整块必须在同一分区」这一类约束，所以留这道口子。 */
  readonly accept?: (origin: GridPoint) => boolean;
  /** 螺旋最多扩几圈。默认按图对角线上限，保证遍历完整张图。 */
  readonly maxRings?: number;
}

/** 固定的四方向顺序。BFS 与螺旋都用它，改一处就等于改了全世界的落位。 */
export const FOUR_DIRECTIONS: readonly GridPoint[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
] as const;

function inBounds(point: GridPoint, bounds: Bounds): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < bounds.width && point.y < bounds.height;
}

/** 这一块占地（含留白）能不能整块放下。留白也要在界内——边界外不算"空"。 */
export function fitsAt(origin: GridPoint, query: SlotQuery): boolean {
  const { footprint, margin, bounds, blocked, inRegion } = query;
  for (let dy = -margin; dy < footprint.h + margin; dy += 1) {
    for (let dx = -margin; dx < footprint.w + margin; dx += 1) {
      const point = { x: origin.x + dx, y: origin.y + dy };
      if (!inBounds(point, bounds)) return false;
      if (blocked(point)) return false;
      // 分区判定只管**占地本体**，留白可以伸到隔壁区——否则窄分区永远建不了东西。
      if (dx >= 0 && dx < footprint.w && dy >= 0 && dy < footprint.h && inRegion) {
        if (!inRegion(point)) return false;
      }
    }
  }
  return true;
}

/**
 * 曼哈顿螺旋找第一个可用坐标。
 *
 * ring=0 是锚点本身；ring=N 是与锚点曼哈顿距离恰为 N 的一圈，从正右方出发，
 * 按下→左→上的顺序走。这样遍历是**全序**的：不依赖任何哈希结构。
 */
export function findDeterministicSlot(query: SlotQuery): GridPoint | null {
  const maxRings =
    query.maxRings ?? Math.max(query.bounds.width, query.bounds.height) * 2;

  const accepted = (origin: GridPoint): boolean =>
    fitsAt(origin, query) && (query.accept === undefined || query.accept(origin));

  if (accepted(query.anchor)) return { ...query.anchor };

  for (let ring = 1; ring <= maxRings; ring += 1) {
    // 从正右方 (anchor.x + ring, anchor.y) 出发，顺时针（屏幕坐标 y 向下）。
    let cursor = { x: query.anchor.x + ring, y: query.anchor.y };
    for (let side = 0; side < 4; side += 1) {
      const direction = FOUR_DIRECTIONS[(side + 1) % 4]!;
      for (let step = 0; step < ring; step += 1) {
        if (accepted(cursor)) return { ...cursor };
        cursor = { x: cursor.x + direction.x, y: cursor.y + direction.y };
      }
    }
  }
  return null;
}

export interface RoadQuery {
  /** 门口那一格（必须可走，否则无解）。 */
  readonly door: GridPoint;
  /** 主干道路格。连上任意一格即算成功。 */
  readonly network: readonly GridPoint[];
  readonly bounds: Bounds;
  /** true = 这一格能铺路 / 能走。false = 障碍（岩石、建筑占地、水）。 */
  readonly walkable: CellPredicate;
}

const keyOf = (point: GridPoint): string => `${point.x},${point.y}`;

/**
 * 从门口到最近主干道路格的四方向 BFS。
 *
 * 返回**含门口与终点**的逐格路径；铺路时把它写进 world.roads。
 * 找不到就返回 null——调用方必须把它当成一次失败，而不是「大概连上了」。
 */
export function planRoadToMainNetwork(query: RoadQuery): readonly GridPoint[] | null {
  if (!inBounds(query.door, query.bounds) || !query.walkable(query.door)) return null;

  const targets = new Set(query.network.filter((p) => inBounds(p, query.bounds)).map(keyOf));
  if (targets.size === 0) return null;
  if (targets.has(keyOf(query.door))) return [{ ...query.door }];

  const queue: GridPoint[] = [{ ...query.door }];
  const parents = new Map<string, GridPoint | null>([[keyOf(query.door), null]]);
  let head = 0;

  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    for (const direction of FOUR_DIRECTIONS) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = keyOf(next);
      if (!inBounds(next, query.bounds) || parents.has(key) || !query.walkable(next)) continue;
      parents.set(key, current);
      if (targets.has(key)) {
        const path: GridPoint[] = [next];
        let cursor: GridPoint | null = current;
        while (cursor !== null) {
          path.push(cursor);
          cursor = parents.get(keyOf(cursor)) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
