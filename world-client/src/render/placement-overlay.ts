/**
 * 造物主摆放 overlay：让「哪里能放」看得见。
 *
 * 这一层只做两件事，都不碰世界的判据：
 * 1. 进入造物模式时铺一层压暗遮罩（色板最深色 `ink` 的半透明），合法可建区
 *    不压暗、再加一点同色的提起——「能建的格子」是被遮罩剩下来的那部分。
 * 2. 指针悬停时把**生产单源校验**的结论画出来：合法 → 绿框 + 从 door 到镇心
 *    的白点预览连线（`grid.path` 的既有一条路由，不自己连点成线）；非法 →
 *    红框 + DOM 浮层写明拒因 + 把挡路的既有建筑/摆件/树描红。
 *
 * 为什么不许这里长出一套判据：本模块所有「行不行」的问句都发给场景已经用的
 * 那一份生产校验（`SandboxScene.canPlaceBlueprintHere`，其内部是
 * `world/setup.ts` 的 `checkPlacement` / `biomeRingAllows` / `fogAt` 与网格的
 * 潮位读数），挡路对象也只是把生产网格的占用读数翻译成矩形。悬停画面上多出
 * 的任何一条「平行规则」都会让预览与确认各说各话，而这份代码存在的前提就是
 * 「预览说的就是世界会做的」。
 *
 * 中文与长文一律不进 canvas（D5-A，`no-cjk-canvas.test.ts` 守着）：拒因浮层是
 * DOM 节点，投影数学复用 `labels.ts`。本文件也不出现任何写死的色值——绿/红/
 * 压暗/白点四色全由 `semanticOverlayColors` 从**当前世界的 24 色板**里挑出来。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import type { WorldGrid } from '../world/grid.ts';
import type { GridPoint, PlacedBuilding, PrefabBlueprint, WorldProp } from '../world/types.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import { WORLD } from '../world/palette-data.ts';
import type { PlacementProblem } from '../world/setup.ts';
import { overlayViewportOf, projectWorldToOverlay } from './labels.ts';
import { readStageScale } from './world-overlay.ts';

/**
 * 场景层校验的拒因码：`world/setup.ts` 的 `PlacementProblem` 五种（那是生产
 * 落位预检的原话），加上场景层在预检之外补的两道显示闸——迷雾与潮位——
 * 以及群落环。三者都读生产状态（`fogAt` / `grid.isFloodedAt` / `biomeRingAllows`），
 * 判据本体一处没改。
 */
export type PlacementBlockReason =
  | 'fog'
  | 'tide'
  | 'ring'
  | PlacementProblem;

/** 场景层校验的返回形状：ok 与拒因码 + 那句给人看的话。 */
export type CreationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PlacementBlockReason; readonly message: string };

/**
 * 浮层上写给玩家的五种拒因标签。
 *
 * 压路 = 占地压到主干道（street 分区）；越界 = 出世界边界 / 不在本蓝图的分区；
 * 建筑重叠 = 占地或门口被既有建筑/树/摆件占住；潮位淹没 = 楼体会泡在当前的
 * 水里；留白不足 = 压不动留白环。
 */
export type PlacementLabel = 'road' | 'edge' | 'overlap' | 'tide' | 'margin';

export const PLACEMENT_LABEL_TEXT: Record<PlacementLabel, string> = {
  road: '压路',
  edge: '越界',
  overlap: '建筑重叠',
  tide: '潮位淹没',
  margin: '留白不足',
};

/** 把生产拒因翻译成浮层标签。返回 null 表示没有五标签可归（迷雾/群落环），
 *  那两种情况浮层原样引用生产那句话，不硬套标签。 */
export function classifyPlacement(
  check: Extract<CreationCheck, { readonly ok: false }>,
  streetCells: readonly GridPoint[],
): PlacementLabel | null {
  switch (check.reason) {
    case 'edge':
      return 'edge';
    case 'outOfZone':
      // 分区不符里专挑「占地压到 street 分区」的一种说法：这条路不能压。
      return streetCells.length > 0 ? 'road' : 'edge';
    case 'occupied':
    case 'doorBlocked':
      return 'overlap';
    case 'margin':
      return 'margin';
    case 'tide':
      return 'tide';
    default:
      // fog / ring：生产那句话本身就是最具体的拒因。
      return null;
  }
}

/** 一个挡路对象：浮层描红它的整块占地（或那一格）。 */
export interface PlacementBlocker {
  readonly kind: 'building' | 'prop' | 'tree' | 'cell';
  /** 占地左上角格与尺寸（格）。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 把「这一落点为什么不行」翻译成「哪些东西挡了路」。
 *
 * 输入只有生产的读数：网格占用（`grid.at().occupant`）、地形（树）、摆件表与
 * 既有建筑表。占地/门口/留白环三圈都查——拒因是 `occupied` 时挡路者在占地里，
 * 是 `margin` 时在留白环里，是 `doorBlocked` 时在门口那一格；调用方不必预判，
 * 并集一圈描红，玩家看得见的「红」与生产判的「不行」始终对着同一批格子。
 */
export function findPlacementBlockers(args: {
  readonly grid: WorldGrid;
  readonly blueprint: PrefabBlueprint;
  readonly origin: GridPoint;
  readonly buildings: readonly PlacedBuilding[];
  readonly props: readonly WorldProp[];
}): readonly PlacementBlocker[] {
  const { grid, blueprint, origin, buildings, props } = args;
  const { w, h } = blueprint.footprint;
  const margin = blueprint.clearMargin;
  const out: PlacementBlocker[] = [];
  const seenBuildings = new Set<string>();
  const seenCells = new Set<string>();

  const takeCell = (cell: GridPoint): void => {
    const key = `${cell.x},${cell.y}`;
    if (seenCells.has(key)) return;
    seenCells.add(key);
    const occupant = grid.at(cell)?.occupant;
    if (occupant !== null && occupant !== undefined) {
      if (seenBuildings.has(occupant)) return;
      seenBuildings.add(occupant);
      const building = buildings.find((item) => item.instanceId === occupant);
      if (building !== undefined) {
        out.push({
          kind: 'building',
          x: building.origin.x,
          y: building.origin.y,
          w: building.footprint.w,
          h: building.footprint.h,
        });
        return;
      }
      out.push({ kind: 'cell', x: cell.x, y: cell.y, w: 1, h: 1 });
      return;
    }
    if (grid.at(cell)?.terrain === 'tree') {
      out.push({ kind: 'tree', x: cell.x, y: cell.y, w: 1, h: 1 });
      return;
    }
    const prop = props.find((item) => item.at.x === cell.x && item.at.y === cell.y);
    if (prop !== undefined) {
      out.push({ kind: 'prop', x: prop.at.x, y: prop.at.y, w: 1, h: 1 });
    }
  };

  for (let y = origin.y; y < origin.y + h; y += 1) {
    for (let x = origin.x; x < origin.x + w; x += 1) takeCell({ x, y });
  }
  takeCell({ x: origin.x + blueprint.door.x, y: origin.y + blueprint.door.y });
  for (let y = origin.y - margin; y < origin.y + h + margin; y += 1) {
    for (let x = origin.x - margin; x < origin.x + w + margin; x += 1) takeCell({ x, y });
  }

  return out.sort((a, b) => a.y - b.y || a.x - b.x || a.kind.localeCompare(b.kind));
}

/**
 * door 到镇心的预览路线：直接复用生产寻路 `grid.path`，返回什么画什么。
 *
 * 这条路与「门口到不了镇心」判不判得出用的是同一份寻路（`doorReaches` 走的
 * 也是它），所以预览的线与生产的判据不可能各说各话。
 */
export function doorPathPreview(
  grid: WorldGrid,
  door: GridPoint,
  anchor: GridPoint,
): readonly GridPoint[] {
  return grid.path(door, anchor);
}

/** 浮层四色：全部来自当前世界的 24 色板，一个字面量色都不写。 */
export interface OverlayColors {
  /** 压暗遮罩色：色板最深色（`ink`，W01 最暗/轮廓/阴影）。 */
  readonly dim: number;
  /** 合法落点框色：色板里的绿色语义色。 */
  readonly legal: number;
  /** 非法落点框色：色板里的红色语义色。 */
  readonly illegal: number;
  /** door→主干道预览的白点色：色板里最浅的「白」（`pale`）。 */
  readonly dot: number;
}

const greenDominance = (value: number): number => {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return g - Math.max(r, b);
};

const redDominance = (value: number): number => {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return r - Math.max(g, b);
};

/**
 * 从当前 24 色板里挑「绿色语义色」与「红色语义色」。
 *
 * 判据是通道占优而不是写死 token 名：灯潮界与莞尔镇同名不同色，哪一格读起来
 * 是绿、哪一格读起来是红，由这套色板自己的值说话。挑选失败（理论上不存在，
 * 24 色里恒有绿有红）时回落到语义本来就是绿/红的 token（苔 / 陶瓦），仍然不
 * 出色板。`dim` 取 `ink`——色板定义里它就是「最暗」的那一格；`dot` 取 `pale`
 * （烟/纸片/雨/高光浅色，色板里最接近白的槽）。
 */
export function semanticOverlayColors(palette: WorldPalette): OverlayColors {
  let legal = palette.moss;
  let legalScore = 0;
  let illegal = palette.terracotta;
  let illegalScore = 0;
  for (const name of Object.keys(WORLD) as WorldColor[]) {
    const value = palette[name];
    const gScore = greenDominance(value);
    if (gScore > legalScore) {
      legalScore = gScore;
      legal = value;
    }
    const rScore = redDominance(value);
    if (rScore > illegalScore) {
      illegalScore = rScore;
      illegal = value;
    }
  }
  return { dim: palette.ink, legal, illegal, dot: palette.pale };
}

// ---------------------------------------------------------------- 视图

/** 遮罩的绘制深度：压在世界之上、幽灵预览（7900）之下。 */
const MASK_DEPTH = 7800;
const HOVER_DEPTH = 7950;

/** 压暗浓度（0..1）：只记录现值，不假装有一条统一的 alpha 纪律在管它。 */
const MASK_ALPHA = 0.45;
/** 合法格的提起浓度：比遮罩淡一档，读作「剩给你的那部分」。 */
const LIFT_ALPHA = 0.08;
/** 框线浓度：线要实，才读得出「就是这一格」。 */
const FRAME_ALPHA = 0.95;

export interface PlacementOverlayDeps {
  readonly palette: WorldPalette;
  readonly grid: WorldGrid;
  readonly altar: GridPoint;
  /** 场景层那一份生产校验的 ok 位（`canPlaceBlueprintHere` 的结论）。 */
  readonly isLegal: (cell: GridPoint) => boolean;
  readonly buildings: () => readonly PlacedBuilding[];
  readonly props: () => readonly WorldProp[];
}

export interface PlacementOverlay {
  /** 进入造物模式：铺遮罩。 */
  readonly enter: (blueprint: PrefabBlueprint) => void;
  /** 悬停一格：画合法/非法反馈。 */
  readonly showHover: (args: {
    readonly cell: GridPoint;
    readonly blueprint: PrefabBlueprint;
    readonly check: CreationCheck;
  }) => void;
  /** 每帧：潮位变了重铺遮罩；浮层跟随相机。 */
  readonly frame: (tideLevel: number) => void;
  /** 退出造物模式：全收。 */
  readonly exit: () => void;
  readonly dispose: () => void;
}

export function createPlacementOverlay(
  scene: Phaser.Scene,
  deps: PlacementOverlayDeps,
): PlacementOverlay {
  const colors = semanticOverlayColors(deps.palette);
  const maskG = scene.add.graphics();
  maskG.setDepth(MASK_DEPTH);
  maskG.setVisible(false);
  const hoverG = scene.add.graphics();
  hoverG.setDepth(HOVER_DEPTH);
  hoverG.setVisible(false);

  // 拒因浮层：中文只走 DOM（D5-A）。样式类在 index.html 里，颜色全走 CSS 变量。
  const label = document.createElement('div');
  label.className = 'placement-label';
  label.style.display = 'none';
  const root = document.querySelector<HTMLElement>('#world-overlay');
  if (root !== null) root.append(label);

  let blueprint: PrefabBlueprint | null = null;
  let hover: { readonly cell: GridPoint; readonly w: number; readonly h: number } | null = null;
  let lastLabelText: string | null = null;
  let lastMaskTide: number | null = null;
  let lastBuildingCount: number | null = null;
    let lastPropCount: number | null = null;
  
  const paintMask = (): void => {
    maskG.clear();
    if (blueprint === null) return;
    const { width, height } = deps.grid;
    // 两遍扫：先统一压暗所有不合法格，再统一提起合法格。
    // 样式切换停在每遍一次，6912 格也不会把渲染批打碎。
    maskG.fillStyle(colors.dim, MASK_ALPHA);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (deps.isLegal({ x, y })) continue;
        maskG.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      }
    }
    maskG.fillStyle(colors.legal, LIFT_ALPHA);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!deps.isLegal({ x, y })) continue;
        maskG.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      }
    }
  };

  const placeLabel = (): void => {
    if (hover === null || root === null) return;
    const canvas = scene.game.canvas as HTMLCanvasElement;
    const canvasRect = canvas.getBoundingClientRect();
    const stage = root.parentElement ?? root;
    const rootScale = readStageScale(stage);
    const viewport = overlayViewportOf(scene.cameras.main, canvasRect, canvas);
    // 锚在占地上沿中点：浮层在格子上方，不挡格子里的框。
    const point = projectWorldToOverlay(
      (hover.cell.x + hover.w / 2) * TILE_PX,
      hover.cell.y * TILE_PX,
      viewport,
    );
    // 先显示再量：隐藏元素的 offsetWidth 恒是 0，拿 0 去夹会把浮层钉在左边缘。
    label.style.display = 'block';
    const width = label.offsetWidth;
    const overlayWidth = canvasRect.width / rootScale;
    const left = Math.min(
      Math.max(point.x / rootScale, 2),
      Math.max(2, overlayWidth - width - 2),
    );
    label.style.left = `${left}px`;
    label.style.top = `${Math.max(2, point.y / rootScale - label.offsetHeight - 4)}px`;
  };

  return {
    enter(blueprintNow) {
      blueprint = blueprintNow;
      lastMaskTide = null;
      maskG.clear();
      paintMask();
      maskG.setVisible(true);
    },

    showHover(args) {
      const { cell, check } = args;
      if (
        cell.x < 0 || cell.y < 0
        || cell.x >= deps.grid.width || cell.y >= deps.grid.height
      ) {
        hoverG.clear();
        hoverG.setVisible(false);
        label.style.display = 'none';
        hover = null;
        return;
      }
      hover = { cell, w: args.blueprint.footprint.w, h: args.blueprint.footprint.h };
      const x = cell.x * TILE_PX;
      const y = cell.y * TILE_PX;
      const w = args.blueprint.footprint.w * TILE_PX;
      const h = args.blueprint.footprint.h * TILE_PX;
      hoverG.clear();

      if (check.ok) {
        hoverG.lineStyle(2, colors.legal, FRAME_ALPHA);
        hoverG.strokeRect(x + 1, y + 1, w - 2, h - 2);
        // 白点预览：door 到镇心的生产路由，逐格一个点。
        const door = { x: cell.x + args.blueprint.door.x, y: cell.y + args.blueprint.door.y };
        const route = doorPathPreview(deps.grid, door, deps.altar);
        hoverG.fillStyle(colors.dot, 0.9);
        for (const point of route) {
          hoverG.fillCircle(point.x * TILE_PX + TILE_PX / 2, point.y * TILE_PX + TILE_PX / 2, 2);
        }
        label.style.display = 'none';
        lastLabelText = null;
      } else {
        hoverG.lineStyle(2, colors.illegal, FRAME_ALPHA);
        hoverG.strokeRect(x + 1, y + 1, w - 2, h - 2);
        // 挡路对象同步描红。
        const blockers = findPlacementBlockers({
          grid: deps.grid,
          blueprint: args.blueprint,
          origin: cell,
          buildings: deps.buildings(),
          props: deps.props(),
        });
        if (blockers.length > 0) {
          hoverG.lineStyle(2, colors.illegal, 0.9);
          for (const blocker of blockers) {
            hoverG.strokeRect(
              blocker.x * TILE_PX,
              blocker.y * TILE_PX,
              blocker.w * TILE_PX,
              blocker.h * TILE_PX,
            );
          }
        }
        // 浮层文案：五标签在前，生产那句话跟在后面，二者都不发明。
        const streetCells = footprintCells(cell, args.blueprint).filter(
          (c) => deps.grid.zoneOf(c) === 'street',
        );
        const labelKind = classifyPlacement(check, streetCells);
        const text = labelKind === null
          ? check.message
          : `${PLACEMENT_LABEL_TEXT[labelKind]}：${check.message}`;
        if (text !== lastLabelText) {
          label.textContent = text;
          lastLabelText = text;
        }
        placeLabel();
      }
      hoverG.setVisible(true);
    },

    frame(tideLevel) {
      if (blueprint === null) return;
      // 潮位连续变化，遮罩不必逐帧重铺：量化到 1/64 一档，变档才重画。
      const quantized = Math.round(tideLevel * 64);
      const buildingCount = deps.buildings().length;
      const propCount = deps.props().length;
      if (lastMaskTide === null || lastMaskTide !== quantized||lastBuildingCount !== buildingCount || lastPropCount !== propCount) {
        lastMaskTide = quantized;
        lastBuildingCount = buildingCount;
        lastPropCount = propCount;
        paintMask();
      }
      if (label.style.display === 'block') placeLabel();
    },

    exit() {
      blueprint = null;
      hover = null;
      lastBuildingCount = null;
      lastPropCount = null;
      lastMaskTide = null;
      lastLabelText = null;
      maskG.clear();
      maskG.setVisible(false);
      hoverG.clear();
      hoverG.setVisible(false);
      label.style.display = 'none';
    },

    dispose() {
      maskG.destroy();
      hoverG.destroy();
      label.remove();
    },
  };
}

/** 占地格清单（纯坐标，不读世界）。 */
function footprintCells(origin: GridPoint, blueprint: PrefabBlueprint): GridPoint[] {
  const cells: GridPoint[] = [];
  for (let y = origin.y; y < origin.y + blueprint.footprint.h; y += 1) {
    for (let x = origin.x; x < origin.x + blueprint.footprint.w; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}
