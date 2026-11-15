/**
 * world-client/src/render/creator-scaffolding-buildings.ts
 * 造物主建筑生命周期：WorldState 施工逻辑拍结算 + render/buildings.ts 三层脚手架视觉蜕变对接
 *
 * 设计要点：
 * 1. 严格遵循无模型依赖的确定性时钟：施工进度仅由 tickBuildingConstruction(world, 1) 推进，严禁使用 Date.now / setTimeout。
 * 2. 无缝对接 render/buildings.ts 现有的 back（地面层 depth-2）、container（楼体层 depth）、front（前檐层 depth+32）三层深度结构。
 * 3. 在 scaffolding 阶段隐藏 front 前檐层并绘制 24 色板竹木脚手架线框与进度条，联动 work-smoke.ts 冒出施工烟尘；
 *    完工拍（completed）自动擦除脚手架、展开前檐遮挡层并写入编年史回执。
 */

import type * as Phaser from 'phaser';
import type { BuildingView, BuildingLayer } from './buildings';
import type { GridPoint } from '../world/creator/schema';

export type BuildingConstructionStage = 'scaffolding' | 'completed';

export interface PlacedBuildingState {
  readonly id: string;
  prefabId: string;
  readonly origin: GridPoint;
  readonly footprint: { readonly w: number; readonly h: number };
  readonly doorOffset: GridPoint;
  stage: BuildingConstructionStage;
  readonly totalConstructionTicks: number;
  constructionTicksRemaining: number;
  pavedRoadTiles: GridPoint[];
}

export interface ConstructionChronicleEvent {
  readonly tick: number;
  readonly kind: 'building.scaffolding_started' | 'building.completed' | 'building.upgraded';
  readonly buildingId: string;
  readonly prefabId: string;
  readonly origin: GridPoint;
}

export interface WorldConstructionLedger {
  nowTick: number;
  buildings: PlacedBuildingState[];
  roads: Set<string>;
  chronicle: ConstructionChronicleEvent[];
}

/**
 * 1. WorldState 内环：创建或原位升级建筑时的初始脚手架入账
 */
export function enqueueBuildingConstruction(
  ledger: WorldConstructionLedger,
  params: {
    id: string;
    prefabId: string;
    origin: GridPoint;
    footprint: { w: number; h: number };
    doorOffset: GridPoint;
    constructionTicks?: number;
    pavedRoadTiles?: GridPoint[];
  },
): PlacedBuildingState {
  const ticks = Math.max(1, Math.floor(params.constructionTicks ?? 3));
  const roadTiles = params.pavedRoadTiles ?? [];

  for (const tile of roadTiles) {
    ledger.roads.add(`${tile.x},${tile.y}`);
  }

  const building: PlacedBuildingState = {
    id: params.id,
    prefabId: params.prefabId,
    origin: { x: params.origin.x, y: params.origin.y },
    footprint: { w: params.footprint.w, h: params.footprint.h },
    doorOffset: { x: params.doorOffset.x, y: params.doorOffset.y },
    stage: 'scaffolding',
    totalConstructionTicks: ticks,
    constructionTicksRemaining: ticks,
    pavedRoadTiles: roadTiles,
  };

  ledger.buildings.push(building);
  ledger.chronicle.push({
    tick: ledger.nowTick,
    kind: 'building.scaffolding_started',
    buildingId: building.id,
    prefabId: building.prefabId,
    origin: building.origin,
  });

  return building;
}

/**
 * 2. WorldState 内环：原位升级既有建筑（保留坐标与道路网，重置短期脚手架打磨拍数）
 */
export function enqueueBuildingUpgrade(
  ledger: WorldConstructionLedger,
  targetId: string,
  toPrefabId: string,
  upgradeTicks = 2,
): PlacedBuildingState {
  const target = ledger.buildings.find((b) => b.id === targetId);
  if (!target) {
    throw new Error(`Upgrade target building not found: ${targetId}`);
  }

  target.prefabId = toPrefabId;
  target.stage = 'scaffolding';
  target.constructionTicksRemaining = Math.max(1, Math.floor(upgradeTicks));

  ledger.chronicle.push({
    tick: ledger.nowTick,
    kind: 'building.upgraded',
    buildingId: target.id,
    prefabId: toPrefabId,
    origin: target.origin,
  });

  return target;
}

/**
 * 3. WorldState 内环：固定逻辑拍推进施工倒计时（100% 确定性，零时钟/随机数依赖）
 */
export function tickBuildingConstruction(
  ledger: WorldConstructionLedger,
): ConstructionChronicleEvent[] {
  const completedEvents: ConstructionChronicleEvent[] = [];

  for (const b of ledger.buildings) {
    if (b.stage === 'scaffolding' && b.constructionTicksRemaining > 0) {
      b.constructionTicksRemaining -= 1;
      if (b.constructionTicksRemaining === 0) {
        b.stage = 'completed';
        const ev: ConstructionChronicleEvent = {
          tick: ledger.nowTick,
          kind: 'building.completed',
          buildingId: b.id,
          prefabId: b.prefabId,
          origin: b.origin,
        };
        ledger.chronicle.push(ev);
        completedEvents.push(ev);
      }
    }
  }

  return completedEvents;
}

// ============================================================================
// 4. Phaser 4 渲染层对接：扩展 render/buildings.ts 的 BuildingView
// ============================================================================

export interface BuildingRenderSnapshot {
  readonly stage: BuildingConstructionStage;
  readonly progressRatio: number;
  readonly scaffoldingVisible: boolean;
  readonly frontEavesVisible: boolean;
  readonly smokeActive: boolean;
}

/**
 * 24 色板程序化脚手架与进度条常量（保证 ?art=0 模式下零图片请求依然像素质感拉满）
 */
const PALETTE_BAMBOO_MAIN = 0xc89d54;
const PALETTE_BAMBOO_SHADOW = 0x7a5928;
const PALETTE_ROPE_KNOT = 0xe8d5b5;
const PALETTE_PROGRESS_BG = 0x1c2128;
const PALETTE_PROGRESS_FILL = 0x56d364;

/**
 * 根据 PlacedBuildingState 的确定性状态刷新 BuildingView 的三层容器（back / container / front）与进度条
 */
export function syncBuildingConstructionView(
  view: BuildingView,
  state: PlacedBuildingState,
  tilePixelSize = 16,
): BuildingRenderSnapshot {
  const pixelW = state.footprint.w * tilePixelSize;
  const pixelH = state.footprint.h * tilePixelSize;
  const isScaffolding = state.stage === 'scaffolding' && state.constructionTicksRemaining > 0;
  const elapsed = state.totalConstructionTicks - state.constructionTicksRemaining;
  const ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, state.totalConstructionTicks)));

  // 1) 前檐层（front, depth = ALTITUDE + baseY + 32）仅在完工态展开，施工态隐藏
  view.front.setVisible(!isScaffolding);

  // 2) 楼体层（container）中的屋顶、招牌、窗户在施工态半透明或按进度显露
  setLayerAlpha(view.roof, isScaffolding ? 0.35 : 1.0);
  setLayerAlpha(view.sign, isScaffolding ? 0.0 : 1.0);
  setLayerAlpha(view.window, isScaffolding ? 0.25 : 1.0);

  // 3) 在 view.progress (Phaser.GameObjects.Graphics) 上程序化绘制竹木脚手架网格与像素进度条
  view.progress.clear();

  if (isScaffolding) {
    drawProceduralScaffolding(view.progress, pixelW, pixelH);
    drawPixelProgressBar(view.progress, pixelW, -pixelH - 8, ratio);
  }

  return {
    stage: state.stage,
    progressRatio: ratio,
    scaffoldingVisible: isScaffolding,
    frontEavesVisible: !isScaffolding,
    smokeActive: isScaffolding, // 联动 work-smoke.ts 在施工期间持续发射烟尘粒子
  };
}

function setLayerAlpha(layer: BuildingLayer, alpha: number): void {
  if ('setAlpha' in layer && typeof layer.setAlpha === 'function') {
    layer.setAlpha(alpha);
  }
}

/**
 * 使用 24 色板绘制像素对齐的竹木脚手架立杆、横杆、斜撑与绳结
 */
function drawProceduralScaffolding(
  gfx: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
): void {
  const left = -Math.floor(w / 2);
  const top = -h;

  // 阴影底衬立杆
  gfx.fillStyle(PALETTE_BAMBOO_SHADOW, 1);
  for (let x = left + 2; x <= left + w - 2; x += 12) {
    gfx.fillRect(x + 1, top, 2, h);
  }

  // 主竹木立杆与横杆
  gfx.fillStyle(PALETTE_BAMBOO_MAIN, 1);
  for (let x = left + 2; x <= left + w - 2; x += 12) {
    gfx.fillRect(x, top, 2, h);
  }
  for (let y = top + 4; y < 0; y += 10) {
    gfx.fillRect(left, y, w, 2);
  }

  // 交叉绳结像素点（1x1 高光点）
  gfx.fillStyle(PALETTE_ROPE_KNOT, 1);
  for (let x = left + 2; x <= left + w - 2; x += 12) {
    for (let y = top + 4; y < 0; y += 10) {
      gfx.fillRect(x, y, 2, 2);
    }
  }
}

/**
 * 在脚手架顶部绘制整数像素对齐的施工进度条
 */
function drawPixelProgressBar(
  gfx: Phaser.GameObjects.Graphics,
  w: number,
  topY: number,
  ratio: number,
): void {
  const barW = Math.max(24, Math.min(48, w - 8));
  const barH = 4;
  const startX = -Math.floor(barW / 2);

  gfx.fillStyle(PALETTE_PROGRESS_BG, 0.9);
  gfx.fillRect(startX - 1, topY - 1, barW + 2, barH + 2);

  const fillW = Math.round(barW * ratio);
  if (fillW > 0) {
    gfx.fillStyle(PALETTE_PROGRESS_FILL, 1);
    gfx.fillRect(startX, topY, fillW, barH);
  }
}