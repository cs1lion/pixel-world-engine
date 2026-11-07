/**
 * 岸线带：水陆邻接边 → 参数化的岸带矩形。
 *
 * 纯函数，不碰 Phaser。为什么单独一层：岸型要能从数据里换（直岸 / 收进），
 * 而绘制层只该拿到已经解析成数字的矩形。把「是不是收进」的等值判断写在绘制里，
 * 加第三种岸型就得改绘制；留在这里，加岸型只是往 `SHORE_PRESETS` 加一行。
 * 「水」的定义是**地形浅滩**（`terrain === 'shallow'`），不是潮位谓词
 * `isFloodedAt`：后者在低潮时一格都不认（水集合为空，判据空转），在高潮时
 * 又把 2000 多格陆地认成水（岸带必然「入水」）。实测读数见
 * `docs/P1_SHORE_BAND_DESIGN.md` §3.3.1。
 *
 * v3（`docs/P1_SHORE_BAND_DESIGN.md` §6）：带宽以 `depthPx`（8 的整数倍，
 * 24 = 1.5 格）跨 2–3 格落地，逐格错位由 `hash2` 决定；每一段是不透明实色，
 * 不叠 alpha。返回 `{ pieces, truncatedPx, overlapPx }`：截断与被裁掉的重叠
 * 面积都要能对着数据里的上限断言，不许静默少画一段。
 */

import { WORLD, type WorldColor } from '../world/palette-data.ts';
import { TILE_PX } from '../world/setup.ts';
import type { GridPoint, TerrainId } from '../world/types.ts';

export type ShoreSide = 'north' | 'east' | 'south' | 'west';

export interface WaterLandEdge {
  /** 陆格：岸带从这一格的水边起算。 */
  readonly land: GridPoint;
  /** 水格：岸带不得越过这条边。 */
  readonly water: GridPoint;
  /** 水在陆的哪一侧。 */
  readonly side: ShoreSide;
  /**
   * 陆格的地形。`waterLandEdgesFromGrid` 会填；
   * 显式夹具可以省略（此时只允许单一岸型）。
   * 岸型的选取按这个地形查数据，而不是在渲染层写分支。
   */
  readonly terrain?: TerrainId;
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

export interface ShoreStepNumbers {
  readonly token: WorldColor;
  readonly depthPx: number;
}

export interface ShoreNumbers {
  /** 这一组色阶适用于哪些陆地地形（按数据查表，不写分支）。 */
  readonly land: readonly TerrainId[];
  readonly insetPx: number;
  /** 基线总宽 = steps 之和；8..48 且 %8 === 0。 */
  readonly depthPx: number;
  readonly staggerPx: number;
  readonly staggerLevels: number;
  /** 错位加在哪一段（v3 取第一段/湿端，末段保持恒定宽度）。 */
  readonly staggerStep: number;
  readonly maxTruncatedPx: number;
  readonly maxOverlapPx: number;
  readonly steps: readonly ShoreStepNumbers[];
}

export interface ShoreRect {
  /** 这一块实际落在哪一格（跨格后会与岸线源格不同）。 */
  readonly cell: GridPoint;
  readonly side: ShoreSide;
  /** 段下标：0 是湿段（贴水），往后越干。 */
  readonly step: number;
  readonly token: WorldColor;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 沿岸方向的长度（世界像素）。 */
  readonly lengthPx: number;
}

export interface ShoreBandResult {
  readonly pieces: readonly ShoreRect[];
  readonly truncatedPx: number;
  readonly overlapPx: number;
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

/** 同一套四邻接判据，从网格上扫出浅滩与陆地，并带上陆格地形。 */
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
  const edges = waterLandEdges({ water, land });
  // 再加上地形：岸型的选取按陆格地形查数据表。
  return edges.map((edge) => {
    const cell = grid.at(edge.land);
    return cell === undefined ? edge : { ...edge, terrain: cell.terrain as TerrainId };
  });
}

/**
 * 数据里的岸型 → 绘制用的数字。绘制层只吃这里出来的 `ShoreNumbers`。
 *
 * 缺省不按 0 画：`depthPx` 漏写时静默画成 0 带宽，等于这份配置没生效，
 * 而且画面差异是 0——那正是 A1 验收要抓的「存在但没人用」。
 */
export function resolveShore(
  style: 'straight' | 'inset',
  numbers: Omit<ShoreNumbers, 'insetPx'>,
): ShoreNumbers {
  const preset = (SHORE_PRESETS as Record<string, ShoreStylePreset | undefined>)[style];
  if (preset === undefined) throw new Error(`shore-band: 未知岸型 ${String(style)}`);
  const resolved: ShoreNumbers = { ...numbers, insetPx: preset.insetPx };
  const { insetPx, depthPx, steps } = resolved;
  assertInset(insetPx);
  assertDepth(depthPx);
  assertSteps(steps, depthPx);
  assertStagger(resolved);
  assertMaxima(resolved.maxTruncatedPx, resolved.maxOverlapPx);
  if (resolved.land === undefined || resolved.land.length === 0) {
    throw new Error('shore-band: 岸型必须声明 land（适用哪些陆地地形）');
  }
  const furthest = insetPx + depthPx + resolved.staggerPx * (resolved.staggerLevels - 1);
  if (furthest > 3 * TILE_PX) {
    throw new Error(
      `shore-band: insetPx（${insetPx}）+ depthPx（${depthPx}）+ staggerPx × (levels−1) = ${furthest} 超过 3 格 ${3 * TILE_PX}，会跨出陆格`,
    );
  }
  return resolved;
}

/**
 * 数据里的岸型表 → 绘制用的数字表。`undefined` / `null` → null → 一段都不画。
 *
 * 为什么是一张表而不是一个对象：石板段与草岸段的末段 token 不同
 * （`plaza` 是铺装词，铺在草岸上会把岸读成码头/硬边），两组各自三档，
 * 按陆格地形选取。选取是查表，不在渲染层写岸型分支。
 */
export function resolveShoreConfig(shore: unknown): ShoreNumbers[] | null {
  if (shore === undefined || shore === null) return null;
  const entries = Array.isArray(shore) ? shore : [shore];
  const configs: ShoreNumbers[] = [];
  for (const entry of entries) {
    const value = entry as {
      readonly land?: unknown;
      readonly style?: unknown;
      readonly depthPx?: unknown;
      readonly staggerPx?: unknown;
      readonly staggerLevels?: unknown;
      readonly staggerStep?: unknown;
      readonly maxTruncatedPx?: unknown;
      readonly maxOverlapPx?: unknown;
      readonly steps?: unknown;
    };
    if (
      typeof value.style !== 'string' ||
      typeof value.depthPx !== 'number' ||
      !Array.isArray(value.land) ||
      typeof value.staggerPx !== 'number' ||
      typeof value.staggerLevels !== 'number' ||
      typeof value.staggerStep !== 'number' ||
      typeof value.maxTruncatedPx !== 'number' ||
      typeof value.maxOverlapPx !== 'number' ||
      !Array.isArray(value.steps)
    ) {
      throw new Error('shore-band: shore 配置缺 land/style/depthPx/stagger*/max*/steps');
    }
    configs.push(
      resolveShore(value.style as 'straight' | 'inset', {
        land: value.land as readonly TerrainId[],
        depthPx: value.depthPx,
        staggerPx: value.staggerPx,
        staggerLevels: value.staggerLevels,
        staggerStep: value.staggerStep,
        maxTruncatedPx: value.maxTruncatedPx,
        maxOverlapPx: value.maxOverlapPx,
        steps: value.steps as readonly ShoreStepNumbers[],
      }),
    );
  }
  return configs;
}

/**
 * 确定性错位：只用格坐标，无随机、无种子、无时钟。
 *
 * v2 的线性取模（x 系数 3、y 系数 5，两者皆奇）等价于按 x+y 的奇偶交替，
 * 直岸上会出现 24/28/24/28 的规则锯口（见设计稿 §6.6）。
 */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

interface Portion {
  readonly cell: GridPoint;
  readonly side: ShoreSide;
  readonly step: number;
  readonly token: WorldColor;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly config: ShoreNumbers;
}

/**
 * 边 → 岸带矩形。逐格发截面（沿水线每格 16px 全宽，格子之间不留缝），
 * 沿法线跨 2–3 格落地；同一格被两条边覆盖时**只裁不叠**。
 *
 * 矩形一律落在**陆格**内：水边是外沿，`insetPx` 只把起点往陆侧退。
 * 越界的部分在格边截断，记进 `truncatedPx`；超过数据上限当场抛。
 */
export function shoreBandRects(
  edges: readonly WaterLandEdge[],
  configs: readonly ShoreNumbers[] | null,
  isLandCell: (cell: GridPoint) => boolean = () => true,
): ShoreBandResult {
  if (configs === null || configs.length === 0) return { pieces: [], truncatedPx: 0, overlapPx: 0 };
  for (const config of configs) assertConfig(config);

  const unique = new Map<string, WaterLandEdge>();
  for (const edge of edges) unique.set(`${cellKey(edge.water)}>${cellKey(edge.land)}`, edge);

  const portions: Portion[] = [];
  const truncatedByConfig = new Map<ShoreNumbers, number>();
  let truncatedPx = 0;

  const ordered = [...unique.values()].sort(
    (a, b) => a.land.y - b.land.y || a.land.x - b.land.x || SIDES.indexOf(a.side) - SIDES.indexOf(b.side),
  );

  for (const edge of ordered) {
    const config = pickConfig(configs, edge);
    if (config === null) continue;

    const { insetPx, steps, staggerPx, staggerLevels, staggerStep } = config;
    const phase = hash2(edge.land.x, edge.land.y) % staggerLevels;
    const extra = phase * staggerPx;

    let t0 = insetPx;
    for (let step = 0; step < steps.length; step += 1) {
      const length = steps[step]!.depthPx + (step === staggerStep ? extra : 0);
      const a = t0;
      const b = t0 + length;
      t0 = b;
      for (const portion of splitByCell(edge, step, steps[step]!.token, a, b)) {
        if (!isLandCell(portion.cell)) {
          // 截断量是沿法线的长度（px），不是面积：M12 的读数就是 8。
          const lost = portion.side === 'north' || portion.side === 'south' ? portion.rect.h : portion.rect.w;
          truncatedPx += lost;
          truncatedByConfig.set(config, (truncatedByConfig.get(config) ?? 0) + lost);
          continue;
        }
        portions.push({ ...portion, config });
      }
    }
  }

  for (const [config, lost] of truncatedByConfig) {
    if (lost > config.maxTruncatedPx) {
      throw new Error(`shore-band: 截断 ${lost} px 超过上限 ${config.maxTruncatedPx}`);
    }
  }

  // 发出顺序：格坐标 → **段下标（湿端优先）** → side → 矩形位置。
  // 湿端优先是拐角不变量：贴水的 1px 带必须永远是 `steps[0]`。
  // 同一格里横带与竖带相交时，若按 side 排序，side 靠前的那条腿会把另一条腿的
  // 湿段裁掉，竖岸的贴水带就露出 farm/plaza（实测 `(7,9)`/`(19,9)` 各 16px）。
  // 按 step 排序后，较低段的矩形先占地，较高段（干端）被吸收——正是
  // 「湿端连续、亮端让吞」。这是引擎规则，与具体地图无关。
  portions.sort(
    (a, b) =>
      a.cell.y - b.cell.y ||
      a.cell.x - b.cell.x ||
      a.step - b.step ||
      SIDES.indexOf(a.side) - SIDES.indexOf(b.side) ||
      a.rect.x - b.rect.x ||
      a.rect.y - b.rect.y,
  );

  const occupied = new Map<string, { x: number; y: number; w: number; h: number }[]>();
  const pieces: ShoreRect[] = [];
  const overlapByConfig = new Map<ShoreNumbers, number>();
  let overlapPx = 0;

  for (const portion of portions) {
    const key = cellKey(portion.cell);
    const taken = occupied.get(key) ?? [];
    let remaining: { x: number; y: number; w: number; h: number }[] = [portion.rect];
    let removed = 0;
    for (const cover of taken) {
      const next: typeof remaining = [];
      for (const rect of remaining) {
        const split = subtractRect(rect, cover);
        removed += split.removed;
        next.push(...split.rects);
      }
      remaining = next;
    }
    if (removed > 0) {
      overlapPx += removed;
      overlapByConfig.set(portion.config, (overlapByConfig.get(portion.config) ?? 0) + removed);
    }
    for (const rect of remaining) {
      if (rect.w === 0 || rect.h === 0) continue;
      pieces.push({
        cell: { ...portion.cell },
        side: portion.side,
        step: portion.step,
        token: portion.token,
        rect,
        lengthPx: portion.side === 'north' || portion.side === 'south' ? rect.w : rect.h,
      });
      taken.push(rect);
    }
    occupied.set(key, taken);
  }

  for (const [config, lost] of overlapByConfig) {
    if (lost > config.maxOverlapPx) {
      throw new Error(`shore-band: 重叠 ${lost} px 超过上限 ${config.maxOverlapPx}`);
    }
  }

  return { pieces, truncatedPx, overlapPx };
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

/** 同一格内被多个矩形盖住（叠画）的像素数。只裁不叠时必须是 0。 */
export function countDoubleCovered(
  rects: readonly { readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } }[],
): number {
  let doubled = 0;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!.rect;
      const b = rects[j]!.rect;
      const left = Math.max(a.x, b.x);
      const right = Math.min(a.x + a.w, b.x + b.w);
      const top = Math.max(a.y, b.y);
      const bottom = Math.min(a.y + a.h, b.y + b.h);
      if (left < right && top < bottom) doubled += (right - left) * (bottom - top);
    }
  }
  return doubled;
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

function pickConfig(configs: readonly ShoreNumbers[], edge: WaterLandEdge): ShoreNumbers | null {
  if (edge.terrain === undefined) {
    if (configs.length === 1) return configs[0]!;
    throw new Error(`shore-band: 边 (${edge.land.x},${edge.land.y}) 缺 terrain，无法在 ${configs.length} 组岸型里选取`);
  }
  return configs.find((config) => config.land.includes(edge.terrain!)) ?? null;
}

/**
 * 把 [a,b) 按格窗 [k×16,(k+1)×16) 切开，发到第 k 格。
 * `a`/`b` 是从水边起算的法向坐标，k=0 是岸线源格自己。
 */
function splitByCell(
  edge: WaterLandEdge,
  step: number,
  token: WorldColor,
  a: number,
  b: number,
): Omit<Portion, 'config'>[] {
  const portions: Omit<Portion, 'config'>[] = [];
  const first = Math.floor(a / TILE_PX);
  const last = Math.floor((b - 1) / TILE_PX);
  for (let k = first; k <= last; k += 1) {
    const start = Math.max(a, k * TILE_PX);
    const end = Math.min(b, (k + 1) * TILE_PX);
    if (end <= start) continue;
    const cell = cellAlong(edge, k);
    const rect = rectOf(edge, start, end);
    portions.push({ cell, side: edge.side, step, token, rect });
  }
  return portions;
}

function cellAlong(edge: WaterLandEdge, k: number): GridPoint {
  const { land, side } = edge;
  if (side === 'north') return { x: land.x, y: land.y + k };
  if (side === 'south') return { x: land.x, y: land.y - k };
  if (side === 'east') return { x: land.x - k, y: land.y };
  return { x: land.x + k, y: land.y };
}

function rectOf(edge: WaterLandEdge, start: number, end: number): { x: number; y: number; w: number; h: number } {
  const { land, side } = edge;
  const span = end - start;
  const baseX = land.x * TILE_PX;
  const baseY = land.y * TILE_PX;
  if (side === 'north') {
    return { x: baseX, y: baseY + start, w: TILE_PX, h: span };
  }
  if (side === 'south') {
    return { x: baseX, y: baseY + TILE_PX - end, w: TILE_PX, h: span };
  }
  if (side === 'east') {
    return { x: baseX + TILE_PX - end, y: baseY, w: span, h: TILE_PX };
  }
  return { x: baseX + start, y: baseY, w: span, h: TILE_PX };
}

/** 从 subject 里减去 cover，返回剩下的矩形与减掉的面积。 */
function subtractRect(
  subject: { x: number; y: number; w: number; h: number },
  cover: { x: number; y: number; w: number; h: number },
): { rects: { x: number; y: number; w: number; h: number }[]; removed: number } {
  const left = Math.max(subject.x, cover.x);
  const right = Math.min(subject.x + subject.w, cover.x + cover.w);
  const top = Math.max(subject.y, cover.y);
  const bottom = Math.min(subject.y + subject.h, cover.y + cover.h);
  if (left >= right || top >= bottom) return { rects: [subject], removed: 0 };
  const removed = (right - left) * (bottom - top);
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  if (top > subject.y) rects.push({ x: subject.x, y: subject.y, w: subject.w, h: top - subject.y });
  if (bottom < subject.y + subject.h) rects.push({ x: subject.x, y: bottom, w: subject.w, h: subject.y + subject.h - bottom });
  if (left > subject.x) rects.push({ x: subject.x, y: top, w: left - subject.x, h: bottom - top });
  if (right < subject.x + subject.w) rects.push({ x: right, y: top, w: subject.x + subject.w - right, h: bottom - top });
  return { rects, removed };
}

function assertConfig(config: ShoreNumbers): void {
  assertInset(config.insetPx);
  assertDepth(config.depthPx);
  assertSteps(config.steps, config.depthPx);
  assertStagger(config);
  assertMaxima(config.maxTruncatedPx, config.maxOverlapPx);
  if (config.insetPx + config.depthPx + config.staggerPx * (config.staggerLevels - 1) > 3 * TILE_PX) {
    throw new Error(
      `shore-band: insetPx（${config.insetPx}）+ depthPx（${config.depthPx}）+ staggerPx × (levels−1) 超过 3 格 ${3 * TILE_PX}`,
    );
  }
}

function assertDepth(value: number): void {
  if (!Number.isInteger(value) || value < 8 || value > 48 || value % 8 !== 0) {
    throw new Error(`shore-band: depthPx 必须是 8 的整数倍（8..48），收到 ${String(value)}`);
  }
}

function assertSteps(steps: readonly ShoreStepNumbers[], depthPx: number): void {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 3) {
    throw new Error(`shore-band: steps 必须是 2..3 段，收到 ${Array.isArray(steps) ? steps.length : String(steps)}`);
  }
  let sum = 0;
  steps.forEach((step, index) => {
    if (!Number.isInteger(step.depthPx) || step.depthPx < 8 || step.depthPx % 8 !== 0) {
      throw new Error(`shore-band: steps[${index}].depthPx 必须是 8 的整数倍，收到 ${String(step.depthPx)}`);
    }
    assertToken(step.token);
    sum += step.depthPx;
  });
  if (sum !== depthPx) {
    throw new Error(`shore-band: steps 的长度和 ${sum} 不等于 depthPx ${depthPx}`);
  }
}

function assertStagger(numbers: ShoreNumbers): void {
  if (numbers.staggerPx !== 4 && numbers.staggerPx !== 8) {
    throw new Error(`shore-band: staggerPx 只能是 4 或 8，收到 ${String(numbers.staggerPx)}`);
  }
  if (!Number.isInteger(numbers.staggerLevels) || numbers.staggerLevels < 2 || numbers.staggerLevels > 4) {
    throw new Error(`shore-band: staggerLevels 必须是 2..4 的整数，收到 ${String(numbers.staggerLevels)}`);
  }
  if (
    !Number.isInteger(numbers.staggerStep) ||
    numbers.staggerStep < 0 ||
    numbers.staggerStep >= numbers.steps.length
  ) {
    throw new Error(`shore-band: staggerStep 必须是 0..${numbers.steps.length - 1} 的整数，收到 ${String(numbers.staggerStep)}`);
  }
}

function assertMaxima(truncated: number, overlap: number): void {
  for (const [name, value] of [['maxTruncatedPx', truncated], ['maxOverlapPx', overlap]] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`shore-band: ${name} 必须是 ≥0 的整数，收到 ${String(value)}`);
    }
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
