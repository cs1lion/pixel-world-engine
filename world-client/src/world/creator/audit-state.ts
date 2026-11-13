/** 造物主审计台账：施工生命周期、空间规则、熔断读数的一处可序列化状态。
 *
 * **它为什么不是存档的一部分**：存档 v6 的路径集合是冻结的（`SAVE_V6_PATH_SET`），
 * 往里加一个键会被 `assertSave` 按「字段漂移」直接拒；要加就得升 v7、写迁移、
 * 换冻结指纹与样例。而这里记的是**外环审计**（哪条规则被人工否决、熔断器处在
 * 什么等级、脚手架还剩几拍），不是玩家世界的地形与人物——`docs/OPEN_ISSUES.md`
 * 把「外环状态跨会话持久化」列为未落地项，本来就该有独立的落盘位置。
 *
 * 所以桥把这份台账写进独立的 localStorage 键，`exportSaveBytes()` 把它和
 * `SaveStore.readRawText()` 的**原始存档字节**打成一个包。存档本体只读不改，
 * `schemaVersion` 因此恒等；审计状态是真写盘的，不是内存态假装出来的。
 *
 * 这里没有 Phaser、没有 `Date.now`、没有 `Math.random`。施工进度只由
 * `tickBuildingConstruction()` 的显式调用推进。
 */

import type { GridPoint } from '../types.ts';

export type BuildingConstructionStage = 'scaffolding' | 'completed';

export interface PlacedBuildingState {
  readonly instanceId: string;
  prefabId: string;
  readonly origin: GridPoint;
  readonly footprint: { readonly w: number; readonly h: number };
  readonly margin: number;
  readonly door: GridPoint;
  stage: BuildingConstructionStage;
  readonly totalConstructionTicks: number;
  constructionTicksRemaining: number;
  /** 这栋楼铺出来的路，格子键 "x,y"。 */
  pavedRoadTiles: string[];
  /** 门口有没有真的连进主干道网。铺路失败时为 false。 */
  doorConnected: boolean;
}

export interface ConstructionChronicleEvent {
  readonly tick: number;
  readonly kind: 'building.scaffolding_started' | 'building.completed' | 'building.upgraded';
  readonly buildingId: string;
  readonly prefabId: string;
  readonly origin: GridPoint;
}

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

export interface CreatorAuditState {
  nowTick: number;
  worldNow: number;
  buildings: PlacedBuildingState[];
  /** 全世界的道路格（含开局就有的主干道），键 "x,y"。 */
  roads: string[];
  chronicle: ConstructionChronicleEvent[];
  creatorRules: SpatialRule[];
  fuseState: FuseSnapshot;
  /** 显式注入的障碍格（H2 的门口岩石）。 */
  blockedTiles: string[];
  /** 被标记为满载的分区（H1）。 */
  filledRegions: string[];
  tideLevel: number;
  seed: number;
  nextInstance: number;
  /** 最近一次铺路的实测读数：H2 靠它证明「真的绕了」，不是碰巧连上了。 */
  lastRoadPlan: {
    readonly door: GridPoint;
    readonly blocked: readonly string[];
    /** 最终铺下的逐格路径（格子键），用来证明它没穿过障碍。 */
    readonly path: readonly string[];
    readonly pathLength: number;
    readonly straightDistance: number;
  } | null;
}

export const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

export function emptyAuditState(seed: number, worldNow: number): CreatorAuditState {
  return {
    nowTick: 0,
    worldNow,
    buildings: [],
    roads: [],
    chronicle: [],
    creatorRules: [],
    fuseState: { isFused: false, fromLevel: 2, toLevel: 2, lastEvent: 'NONE' },
    blockedTiles: [],
    filledRegions: [],
    tideLevel: 0,
    seed,
    nextInstance: 1,
    lastRoadPlan: null,
  };
}

export interface EnqueueParams {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly origin: GridPoint;
  readonly footprint: { readonly w: number; readonly h: number };
  readonly margin: number;
  readonly door: GridPoint;
  readonly constructionTicks?: number;
  readonly pavedRoadTiles?: readonly GridPoint[];
  readonly doorConnected?: boolean;
}

/** 建筑入账：脚手架阶段、施工拍数、铺出来的路一次记齐。 */
export function enqueueBuildingConstruction(
  audit: CreatorAuditState,
  params: EnqueueParams,
): PlacedBuildingState {
  const ticks = Math.max(1, Math.floor(params.constructionTicks ?? 3));
  const roadTiles = (params.pavedRoadTiles ?? []).map(pointKey);
  for (const tile of roadTiles) {
    if (!audit.roads.includes(tile)) audit.roads.push(tile);
  }

  const building: PlacedBuildingState = {
    instanceId: params.instanceId,
    prefabId: params.prefabId,
    origin: { x: params.origin.x, y: params.origin.y },
    footprint: { w: params.footprint.w, h: params.footprint.h },
    margin: params.margin,
    door: { x: params.door.x, y: params.door.y },
    stage: 'scaffolding',
    totalConstructionTicks: ticks,
    constructionTicksRemaining: ticks,
    pavedRoadTiles: roadTiles,
    doorConnected: params.doorConnected ?? false,
  };

  audit.buildings.push(building);
  audit.chronicle.push({
    tick: audit.nowTick,
    kind: 'building.scaffolding_started',
    buildingId: building.instanceId,
    prefabId: building.prefabId,
    origin: building.origin,
  });
  return building;
}

/** 原位升级：坐标、道路、门口连接全保留，只换 prefabId 并重置一段短施工。 */
export function enqueueBuildingUpgrade(
  audit: CreatorAuditState,
  targetId: string,
  toPrefabId: string,
  upgradeTicks = 2,
): PlacedBuildingState {
  const target = audit.buildings.find((b) => b.instanceId === targetId);
  if (!target) throw new Error(`Upgrade target building not found: ${targetId}`);
  target.prefabId = toPrefabId;
  target.stage = 'scaffolding';
  target.constructionTicksRemaining = Math.max(1, Math.floor(upgradeTicks));
  audit.chronicle.push({
    tick: audit.nowTick,
    kind: 'building.upgraded',
    buildingId: target.instanceId,
    prefabId: toPrefabId,
    origin: target.origin,
  });
  return target;
}

/** 固定逻辑拍推进施工倒计时。返回这一拍完工的那些楼。 */
export function tickBuildingConstruction(
  audit: CreatorAuditState,
): ConstructionChronicleEvent[] {
  const completed: ConstructionChronicleEvent[] = [];
  for (const building of audit.buildings) {
    if (building.stage !== 'scaffolding' || building.constructionTicksRemaining <= 0) continue;
    building.constructionTicksRemaining -= 1;
    if (building.constructionTicksRemaining === 0) {
      building.stage = 'completed';
      const event: ConstructionChronicleEvent = {
        tick: audit.nowTick,
        kind: 'building.completed',
        buildingId: building.instanceId,
        prefabId: building.prefabId,
        origin: building.origin,
      };
      audit.chronicle.push(event);
      completed.push(event);
    }
  }
  return completed;
}

/** 两栋楼的占地有没有交叠，交叠了几格。 */
function overlapBetween(a: PlacedBuildingState, b: PlacedBuildingState): number {
  let count = 0;
  for (let y = a.origin.y; y < a.origin.y + a.footprint.h; y += 1) {
    for (let x = a.origin.x; x < a.origin.x + a.footprint.w; x += 1) {
      if (
        x >= b.origin.x &&
        x < b.origin.x + b.footprint.w &&
        y >= b.origin.y &&
        y < b.origin.y + b.footprint.h
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** 两栋楼占地矩形之间的最小格距（相邻为 1，交叠为 0）。 */
function gapBetween(a: PlacedBuildingState, b: PlacedBuildingState): number {
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

export interface CreatorMetrics {
  readonly overlapCount: number;
  readonly minClearMargin: number;
  readonly submergedBuildingCount: number;
  readonly pathfindingConnectivity: number;
  readonly doorWalkableToAltar: boolean;
}

/**
 * 从台账本身算指标——不读渲染、不读内存态。
 *
 * `submergedTiles` 由桥按当前潮位算好后传进来；台账只负责数有几栋楼踩进去了。
 */
export function metricsOf(
  audit: CreatorAuditState,
  submergedTiles: ReadonlySet<string>,
): CreatorMetrics {
  let overlapCount = 0;
  for (let i = 0; i < audit.buildings.length; i += 1) {
    for (let j = i + 1; j < audit.buildings.length; j += 1) {
      overlapCount += overlapBetween(audit.buildings[i]!, audit.buildings[j]!);
    }
  }

  let minClearMargin = Number.POSITIVE_INFINITY;
  for (const building of audit.buildings) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of audit.buildings) {
      if (other === building) continue;
      nearest = Math.min(nearest, gapBetween(building, other));
    }
    // 只有一栋楼时没有"邻居"可比，用蓝图自身的留白要求作答。
    minClearMargin = Math.min(minClearMargin, Number.isFinite(nearest) ? nearest : building.margin);
  }
  if (!Number.isFinite(minClearMargin)) minClearMargin = 1;

  let submergedBuildingCount = 0;
  for (const building of audit.buildings) {
    for (let y = building.origin.y; y < building.origin.y + building.footprint.h; y += 1) {
      for (let x = building.origin.x; x < building.origin.x + building.footprint.w; x += 1) {
        if (submergedTiles.has(pointKey({ x, y }))) {
          submergedBuildingCount += 1;
          break;
        }
      }
    }
  }

  const connected = audit.buildings.filter((b) => b.doorConnected).length;
  return {
    overlapCount,
    minClearMargin,
    submergedBuildingCount,
    pathfindingConnectivity:
      audit.buildings.length === 0 ? 1 : connected / audit.buildings.length,
    doorWalkableToAltar: audit.buildings.every((b) => b.doorConnected),
  };
}

/** 施工阶段的视图读数：供渲染层与评分器共用同一份真值。 */
export function constructionReadout(building: PlacedBuildingState): {
  readonly smokeActive: boolean;
  readonly progressRatio: number;
  readonly scaffoldingVisible: boolean;
} {
  const scaffoldingVisible =
    building.stage === 'scaffolding' && building.constructionTicksRemaining > 0;
  const elapsed = building.totalConstructionTicks - building.constructionTicksRemaining;
  return {
    smokeActive: scaffoldingVisible,
    progressRatio: Math.max(
      0,
      Math.min(1, elapsed / Math.max(1, building.totalConstructionTicks)),
    ),
    scaffoldingVisible,
  };
}
