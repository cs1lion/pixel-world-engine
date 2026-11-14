/** 造物主评测**会话**状态：只存生产里没有的东西。
 *
 * P0 收敛后，世界真值一律从 `SaveStore` 落盘的存档字节读：
 * `world.buildings` / `world.roads` / `world.constructions` / `world.now`。
 * 这里不再有选址器、不再有施工倒计时、不再有编年史——那些生产都有，
 * 旁边再放一份就是第二套真相（本仓 `test/creator-production-truth.test.ts` 钉着）。
 *
 * 仍然属于评测夹具、且**只服务 spec 组用例**的：
 * 人工否决过的坐标、熔断器被注入的违规、满载旗子、门口障碍。
 * 它们在报告里与 production 组分列，不冒充生产验收。
 */

import type { GridPoint } from '../types.ts';

export interface SpatialRule {
  readonly kind: 'SpatialConstraint';
  readonly forbiddenAt: GridPoint;
  readonly isSelfJustifying: boolean;
  readonly reason: string;
  readonly fromCommandId: string | null;
}

export interface FuseSnapshot {
  isFused: boolean;
  fromLevel: number;
  toLevel: number;
  lastEvent: string;
}

/**
 * H2 的反事实路径差分：种障前后各跑一次**生产** `grid.path`，用差集证明「真的绕了」。
 * 没有它，H2 与 M2 同构——障碍种在别处、`findBestSlot` 换了地、连通率照样 1.0。
 */
export interface DetourReading {
  /** 种障前生产选址器给的落点。 */
  readonly plannedOrigin: GridPoint;
  readonly obstacle: GridPoint;
  /** 种障前的生产路线（格子键）。 */
  readonly dryRunRoute: readonly string[];
  /** 种障后落成建筑的实际路线（格子键）。 */
  readonly finalRoute: readonly string[];
  /** 选址器有没有因为障碍换地方——换了就等于这条用例没测到绕行。 */
  readonly originDodged: boolean;
  /** 最终路线是否穿过障碍格。 */
  readonly roadCrossedObstacle: boolean;
  /** 最终路线与种障前是否不同。 */
  readonly routeChanged: boolean;
}

export interface RoadPlan {
  readonly blocked: readonly string[];
  /** 本次落地新增的道路格（来自存档 world.roads 的差集，不是自己算的 BFS 路径）。 */
  readonly path: readonly string[];
  readonly pathLength: number;
  readonly straightDistance: number;
}

export interface CreatorAuditState {
  /** 评测拍数。只用于 stateHash，不是世界时钟。 */
  nowTick: number;
  /** 本次会话落下的楼 id；真值在存档 world.buildings。 */
  placedInstanceIds: string[];
  /** spec：M4 原位升级在生产里不存在，只记规格期望，不写世界。 */
  upgradedPrefabIds: Record<string, string>;
  creatorRules: SpatialRule[];
  fuseState: FuseSnapshot;
  /** spec：H2 注入的障碍格；真的写进生产 WorldGrid，不是桥的私有地图。 */
  blockedTiles: string[];
  /** spec：H1 的满载旗子。 */
  filledRegions: string[];
  tideLevel: number;
  seed: number;
  nextInstance: number;
  lastRoadPlan: RoadPlan | null;
  detour: DetourReading | null;
  /** 反事实种障为什么没成（spec 报告里直接显示，不用猜）。 */
  detourSkip: string | null;
}

export const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

export function emptyAuditState(seed: number): CreatorAuditState {
  return {
    nowTick: 0,
    placedInstanceIds: [],
    upgradedPrefabIds: {},
    creatorRules: [],
    fuseState: { isFused: false, fromLevel: 2, toLevel: 2, lastEvent: 'NONE' },
    blockedTiles: [],
    filledRegions: [],
    tideLevel: 0,
    seed,
    nextInstance: 1,
    lastRoadPlan: null,
    detour: null,
    detourSkip: null,
  };
}

export interface CreatorMetrics {
  readonly overlapCount: number;
  readonly minClearMargin: number;
  readonly submergedBuildingCount: number;
  readonly pathfindingConnectivity: number;
  readonly doorWalkableToAltar: boolean;
}

export interface BuildingShape {
  readonly origin: GridPoint;
  readonly footprint: { readonly w: number; readonly h: number };
}

function overlapBetween(a: BuildingShape, b: BuildingShape): number {
  let count = 0;
  for (let y = a.origin.y; y < a.origin.y + a.footprint.h; y += 1) {
    for (let x = a.origin.x; x < a.origin.x + a.footprint.w; x += 1) {
      if (
        x >= b.origin.x && x < b.origin.x + b.footprint.w &&
        y >= b.origin.y && y < b.origin.y + b.footprint.h
      ) count += 1;
    }
  }
  return count;
}

function gapBetween(a: BuildingShape, b: BuildingShape): number {
  const dx = Math.max(
    0,
    Math.max(a.origin.x - (b.origin.x + b.footprint.w), b.origin.x - (a.origin.x + a.footprint.w)),
  );
  const dy = Math.max(
    0,
    Math.max(a.origin.y - (b.origin.y + b.footprint.h), b.origin.y - (a.origin.y + a.footprint.h)),
  );
  return Math.max(dx, dy);
}

/**
 * 指标从**存档里的建筑**算，不读台账、不读画面。
 * `doorReachable` 由生产 `doorReaches(grid, door, altar)` 给出，每项对应一栋楼。
 */
export function metricsOf(
  buildings: readonly BuildingShape[],
  doorReachable: readonly boolean[],
  submerged: ReadonlySet<string>,
): CreatorMetrics {
  let overlapCount = 0;
  for (let i = 0; i < buildings.length; i += 1) {
    for (let j = i + 1; j < buildings.length; j += 1) {
      overlapCount += overlapBetween(buildings[i]!, buildings[j]!);
    }
  }

  let minClearMargin = Number.POSITIVE_INFINITY;
  for (const building of buildings) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of buildings) {
      if (other === building) continue;
      nearest = Math.min(nearest, gapBetween(building, other));
    }
    if (Number.isFinite(nearest)) minClearMargin = Math.min(minClearMargin, nearest);
  }
  if (!Number.isFinite(minClearMargin)) minClearMargin = 1;

  let submergedBuildingCount = 0;
  for (const building of buildings) {
    let hit = false;
    for (let y = building.origin.y; y < building.origin.y + building.footprint.h && !hit; y += 1) {
      for (let x = building.origin.x; x < building.origin.x + building.footprint.w; x += 1) {
        if (submerged.has(pointKey({ x, y }))) { hit = true; break; }
      }
    }
    if (hit) submergedBuildingCount += 1;
  }

  const connected = doorReachable.filter(Boolean).length;
  return {
    overlapCount,
    minClearMargin,
    submergedBuildingCount,
    pathfindingConnectivity: doorReachable.length === 0 ? 1 : connected / doorReachable.length,
    doorWalkableToAltar: doorReachable.length > 0 && connected === doorReachable.length,
  };
}
