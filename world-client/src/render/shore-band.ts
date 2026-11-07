/**
 * 岸线带：水陆邻接边 → 参数化的岸带矩形。
 *
 * 纯函数，不碰 Phaser。为什么单独一层：岸型要能从数据里换（直岸 / 收进），
 * 而绘制层只该拿到已经解析成数字的矩形。把「是不是收进」的等值判断写在绘制里，
 * 加第三种岸型就得改绘制；留在这里，加岸型只是往 `SHORE_PRESETS` 加一行。
 *
 * 「水」的定义是**地形浅滩**（`terrain === 'shallow'`），不是潮位谓词
 * `isFloodedAt`：后者在低潮时一格都不认（水集合为空，判据空转），在高潮时
 * 又把 2000 多格陆地认成水（岸带必然「入水」）。实测读数见
 * `docs/P1_SHORE_BAND_DESIGN.md` §3.3.1。
 */

import { WORLD, type WorldColor } from '../world/palette-data.ts';
import { TILE_PX } from '../world/setup.ts';
import type { GridPoint } from '../world/types.ts';

export type ShoreSide = 'north' | 'east' | 'south' | 'west';

export interface WaterLandEdge {
  /** 陆格：岸带只能画在这一格里。 */
  readonly land: GridPoint;
  /** 水格：岸带不得越过这条边。 */
  readonly water: GridPoint;
  /** 水在陆的哪一侧。 */
  readonly side: ShoreSide;
}

export interface WaterLandFixture {
  readonly water: readonly GridPoint[];
  readonly land: readonly GridPoint[];
}

/** 网格适配器只要求「能取一格」，不依赖 WorldGrid 的具体实现。 */
export interface ShoreGridLike {
  readonly width: number;
  readonly height: number;
  at(p: GridPoint): { readonly terrain: string } | undefined;
}

export interface ShoreStylePreset {
  /** 从水边向陆侧退多少像素。 */
  readonly insetPx: number;
}

/** 岸型预设。加一种岸型 = 在这里加一行，绘制层不用改。 */
export const SHORE_PRESETS: Readonly<Record<'straight' | 'inset', ShoreStylePreset>> = {
  straight: { insetPx: 0 },
  inset: { insetPx: 2 },
};

export interface ShoreNumbers {
  readonly insetPx: number;
  readonly depthPx: number;
  readonly token: WorldColor;
  readonly alpha: number;
}

export interface ShoreRect {
  readonly cell: GridPoint;
  readonly side: ShoreSide;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 沿岸方向的长度（世界像素）。直岸 k 格连续 = k × TILE_PX。 */
  readonly lengthPx: number;
}

const SIDES: readonly ShoreSide[] = ['north', 'east', 'south', 'west'];

const OFFSETS: Readonly<Record<ShoreSide, GridPoint>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

const cellKey = (p: GridPoint): string => `${p.x},${p.y}`;

/** 四邻接的水陆边。对角接触不算岸（书里的岸是贴着水的那条边，不是角）。 */
export function waterLandEdges(fixture: WaterLandFixture): WaterLandEdge[] {
  const water = new Set(fixture.water.map(cellKey));
  const land = [...fixture.land].sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = new Set<string>();
  const edges: WaterLandEdge[] = [];
  for (const cell of land) {
    for (const side of SIDES) {
      const offset = OFFSETS[side];
      const neighbor = { x: cell.x + offset.x, y: cell.y + offset.y };
      if (!water.has(cellKey(neighbor))) continue;
      const dedupe = `${cellKey(neighbor)}>${cellKey(cell)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      edges.push({ land: { ...cell }, water: neighbor, side });
    }
  }
  return edges;
}

/** 同一套四邻接判据，从网格上扫出浅滩与陆地。 */
export function waterLandEdgesFromGrid(
  grid: ShoreGridLike,
  isWaterTerrain: (terrain: string) => boolean,
): WaterLandEdge[] {
  const water: GridPoint[] = [];
  const land: GridPoint[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.at({ x, y });
      if (cell === undefined) continue;
      (isWaterTerrain(cell.terrain) ? water : land).push({ x, y });
    }
  }
  return waterLandEdges({ water, land });
}

/**
 * 数据里的岸型 → 绘制用的数字。绘制层只吃这里出来的 `ShoreNumbers`。
 *
 * 缺省不按 0 画：`depthPx` 漏写时静默画成 0 带宽，等于这份配置没生效，
 * 而且画面差异是 0——那正是 A1 验收要抓的「存在但没人用」。
 */
export function resolveShore(
  style: 'straight' | 'inset',
  numbers: { readonly depthPx: number; readonly token: WorldColor; readonly alpha: number },
): ShoreNumbers {
  const preset = (SHORE_PRESETS as Record<string, ShoreStylePreset | undefined>)[style];
  if (preset === undefined) throw new Error(`shore-band: 未知岸型 ${String(style)}`);
  assertDepth(numbers.depthPx);
  assertToken(numbers.token);
  assertAlpha(numbers.alpha);
  return { insetPx: preset.insetPx, depthPx: numbers.depthPx, token: numbers.token, alpha: numbers.alpha };
}

/** 旧设定集没配 `shore` → null → 一段都不画（画面与改前逐字节一致）。 */
export function resolveShoreConfig(shore: unknown): ShoreNumbers | null {
  if (shore === undefined || shore === null) return null;
  const value = shore as {
    readonly style?: unknown;
    readonly depthPx?: unknown;
    readonly token?: unknown;
    readonly alpha?: unknown;
  };
  if (typeof value.style !== 'string' || typeof value.depthPx !== 'number' || typeof value.token !== 'string' || typeof value.alpha !== 'number') {
    throw new Error('shore-band: shore 配置缺 style/depthPx/token/alpha');
  }
  return resolveShore(value.style as 'straight' | 'inset', {
    depthPx: value.depthPx,
    token: value.token as WorldColor,
    alpha: value.alpha,
  });
}

/**
 * 边 → 岸带矩形。同 side 且沿岸方向连续的陆格合成一段；断一格就拆段。
 *
 * 矩形一律落在**陆格**内：水边是矩形的外沿，`insetPx` 只把矩形往陆侧退。
 * `depthPx + insetPx > TILE_PX` 会压进水面，当场抛，不靠测试之外的人眼。
 */
export function shoreBandRects(edges: readonly WaterLandEdge[], numbers: ShoreNumbers | null): ShoreRect[] {
  if (numbers === null) return [];
  assertInset(numbers.insetPx);
  assertDepth(numbers.depthPx);
  if (numbers.insetPx + numbers.depthPx > TILE_PX) {
    throw new Error(
      `shore-band: depthPx（${numbers.depthPx}）+ insetPx（${numbers.insetPx}）= ${numbers.insetPx + numbers.depthPx} 超过一格 TILE_PX=${TILE_PX}，会压进水面`,
    );
  }

  // 同一对水/陆格只算一次；夹具里重复写同一格不该让长度翻倍。
  const unique = new Map<string, WaterLandEdge>();
  for (const edge of edges) unique.set(`${cellKey(edge.water)}>${cellKey(edge.land)}`, edge);

  const rects: ShoreRect[] = [];
  for (const side of SIDES) {
    const items = [...unique.values()].filter((edge) => edge.side === side);
    if (items.length === 0) continue;
    if (side === 'north' || side === 'south') {
      const rows = new Map<number, WaterLandEdge[]>();
      for (const edge of items) {
        const row = rows.get(edge.land.y) ?? [];
        row.push(edge);
        rows.set(edge.land.y, row);
      }
      for (const row of rows.values()) {
        row.sort((a, b) => a.land.x - b.land.x);
        for (const run of runsAlong(row, (edge) => edge.land.x)) {
          rects.push(makeRect(run, side, numbers));
        }
      }
    } else {
      const columns = new Map<number, WaterLandEdge[]>();
      for (const edge of items) {
        const column = columns.get(edge.land.x) ?? [];
        column.push(edge);
        columns.set(edge.land.x, column);
      }
      for (const column of columns.values()) {
        column.sort((a, b) => a.land.y - b.land.y);
        for (const run of runsAlong(column, (edge) => edge.land.y)) {
          rects.push(makeRect(run, side, numbers));
        }
      }
    }
  }
  return rects;
}

/** 检查器：矩形里每一个像素归到的格，有多少落在给定的水格集合里。 */
export function countPixelsInCells(
  rects: readonly { readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } }[],
  cells: ReadonlySet<string>,
): number {
  let leaked = 0;
  for (const { rect } of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const cell = cellKey({ x: Math.floor(x / TILE_PX), y: Math.floor(y / TILE_PX) });
        if (cells.has(cell)) leaked += 1;
      }
    }
  }
  return leaked;
}

// ------------------------------------------------------------------ 像素换算

export interface DeviceView {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly cameraWidth: number;
  readonly cameraHeight: number;
  readonly zoom: number;
  /** 画布显示尺寸（CSS 像素，如 960×640）。 */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** 逻辑画布尺寸（如 480×320）。 */
  readonly gameWidth: number;
  readonly gameHeight: number;
  readonly deviceScaleFactor: number;
  /** 截图里画布左上角的位移（CSS 像素）。 */
  readonly offsetX: number;
  readonly offsetY: number;
}

function viewOriginOf(view: DeviceView): { x: number; y: number } {
  return {
    x: view.scrollX + view.cameraWidth / 2 - view.cameraWidth / (2 * view.zoom),
    y: view.scrollY + view.cameraHeight / 2 - view.cameraHeight / (2 * view.zoom),
  };
}

/** 格 → 截图设备像素矩形。公式与设计稿 §3.6 一致。 */
export function cellToDeviceRect(cell: GridPoint, view: DeviceView): { x: number; y: number; w: number; h: number } {
  const origin = viewOriginOf(view);
  const canvasScale = view.canvasWidth / view.gameWidth;
  const unit = view.zoom * canvasScale * view.deviceScaleFactor;
  return {
    x: (cell.x * TILE_PX - origin.x) * unit + view.offsetX * view.deviceScaleFactor,
    y: (cell.y * TILE_PX - origin.y) * unit + view.offsetY * view.deviceScaleFactor,
    w: TILE_PX * unit,
    h: TILE_PX * unit,
  };
}

/** 截图设备像素 → 格（半开区间：正好压线时归右/下一格）。 */
export function deviceToCell(x: number, y: number, view: DeviceView): GridPoint {
  const origin = viewOriginOf(view);
  const canvasScale = view.canvasWidth / view.gameWidth;
  const cssX = x / view.deviceScaleFactor - view.offsetX;
  const cssY = y / view.deviceScaleFactor - view.offsetY;
  return {
    x: Math.floor((origin.x + cssX / (view.zoom * canvasScale)) / TILE_PX),
    y: Math.floor((origin.y + cssY / (view.zoom * canvasScale)) / TILE_PX),
  };
}

// ------------------------------------------------------------------ 内部

function runsAlong(edges: readonly WaterLandEdge[], axis: (edge: WaterLandEdge) => number): WaterLandEdge[][] {
  const runs: WaterLandEdge[][] = [];
  let current: WaterLandEdge[] = [];
  for (const edge of edges) {
    const previous = current[current.length - 1];
    if (previous !== undefined && axis(edge) !== axis(previous) + 1) {
      runs.push(current);
      current = [];
    }
    current.push(edge);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function makeRect(run: readonly WaterLandEdge[], side: ShoreSide, numbers: ShoreNumbers): ShoreRect {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const lengthPx = run.length * TILE_PX;
  const { insetPx, depthPx } = numbers;
  const north = first.land.y * TILE_PX;
  const west = first.land.x * TILE_PX;
  if (side === 'north') {
    return { cell: { ...first.land }, side, lengthPx, rect: { x: west, y: north + insetPx, w: lengthPx, h: depthPx } };
  }
  if (side === 'south') {
    return {
      cell: { ...first.land },
      side,
      lengthPx,
      rect: { x: west, y: last.land.y * TILE_PX + TILE_PX - insetPx - depthPx, w: lengthPx, h: depthPx },
    };
  }
  if (side === 'west') {
    return { cell: { ...first.land }, side, lengthPx, rect: { x: west + insetPx, y: north, w: depthPx, h: lengthPx } };
  }
  return {
    cell: { ...first.land },
    side,
    lengthPx,
    rect: { x: last.land.x * TILE_PX + TILE_PX - insetPx - depthPx, y: north, w: depthPx, h: lengthPx },
  };
}

function assertDepth(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > TILE_PX) {
    throw new Error(`shore-band: depthPx 必须是 1..${TILE_PX} 的整数，收到 ${String(value)}`);
  }
}

function assertInset(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`shore-band: insetPx 必须是非负整数，收到 ${String(value)}`);
  }
}

function assertToken(value: WorldColor): void {
  if ((WORLD as Record<string, unknown>)[value] === undefined) {
    throw new Error(`shore-band: token ${String(value)} 不在 24 色里`);
  }
}

function assertAlpha(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`shore-band: alpha 必须在 (0, 1]，收到 ${String(value)}`);
  }
}
