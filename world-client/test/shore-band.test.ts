/**
 * P1 岸线带：判据侧（v3，构件化跨 2–3 格）。
 *
 * 判据与设计稿 `docs/P1_SHORE_BAND_DESIGN.md` 一一对应：
 *   J1 水陆邻接边（含 D1–D4 退化夹具）
 *   J2 岸型参数化到数据层（灯潮界两组岸型、装载期校验）
 *   J3 像素不侵入水面（含反向 M1/M2，证明检查器会红）
 *   J4 直岸 k 格连续 = k × TILE_PX（沿水线无缝覆盖）
 *   J6 跨格承载分配（24px 落 2 格、36px 落 3 格、truncatedPx）
 *   J7 三档逐段可辨（逐时相合成值 + Sharma 完整式 CIEDE2000）
 *   J7-pin 已知降级（夜+雨两档半，不是通过）
 *   J8 确定性错位（hash2 12 格宽度序列、禁随机）
 *   J9 零入水（跨格版）与 M8–M13 反向用例
 *   §3.6 像素 → 格子：DPR / zoom / scroll / canvas 偏移与校准点
 *   附录：潮位不改水/陆格分类（决定 J3 的「水」定义）
 *
 * 颜色换算与 CIEDE2000 按 Sharma et al. (2005) 的完整式实现，并用该文两个
 * 标准样本自检。设计稿 §6.5 的读数与这里共用同一份 `composite()`，
 * 不手抄第二套色值。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { WorldGrid } from '../src/world/grid.ts';
import { WORLD } from '../src/world/palette-data.ts';
import { TILE_PX } from '../src/world/setup.ts';
import { isFlooded } from '../src/world/tide.ts';
import type { GridPoint } from '../src/world/types.ts';

// ---------------------------------------------------------------- 动态模块

type Side = 'north' | 'east' | 'south' | 'west';

interface ShoreSide {
  readonly side: Side;
  readonly land: GridPoint;
  readonly water: GridPoint;
  readonly terrain?: string;
}

interface RectView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface ShoreStepView {
  readonly token: string;
  readonly depthPx: number;
}

interface ShoreNumbersView {
  readonly land: readonly string[];
  readonly insetPx: number;
  readonly depthPx: number;
  readonly staggerPx: number;
  readonly staggerLevels: number;
  readonly staggerStep: number;
  readonly maxTruncatedPx: number;
  readonly maxOverlapPx: number;
  readonly steps: readonly ShoreStepView[];
}

interface PieceView {
  readonly cell: GridPoint;
  readonly side: Side;
  readonly step: number;
  readonly token: string;
  readonly rect: RectView;
  readonly lengthPx: number;
}

interface BandResultView {
  readonly pieces: readonly PieceView[];
  readonly truncatedPx: number;
  readonly overlapPx: number;
}

interface DeviceView {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly cameraWidth: number;
  readonly cameraHeight: number;
  readonly zoom: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly gameWidth: number;
  readonly gameHeight: number;
  readonly deviceScaleFactor: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

interface ShoreModule {
  waterLandEdges?: (fixture: { readonly water: readonly GridPoint[]; readonly land: readonly GridPoint[] }) => readonly ShoreSide[];
  waterLandEdgesFromGrid?: (
    grid: { readonly width: number; readonly height: number; at(p: GridPoint): { readonly terrain: string } | undefined },
    isWaterTerrain: (terrain: string) => boolean,
  ) => readonly ShoreSide[];
  SHORE_PRESETS?: Readonly<Record<'straight' | 'inset', { readonly insetPx: number }>>;
  resolveShore?: (style: 'straight' | 'inset', numbers: Omit<ShoreNumbersView, 'insetPx'>) => ShoreNumbersView;
  resolveShoreConfig?: (shore: unknown) => readonly ShoreNumbersView[] | null;
  shoreBandRects?: (
    edges: readonly ShoreSide[],
    configs: readonly ShoreNumbersView[] | null,
    isLandCell?: (cell: GridPoint) => boolean,
  ) => BandResultView;
  countPixelsInCells?: (rects: readonly { readonly rect: RectView }[], cells: ReadonlySet<string>) => number;
  countDoubleCovered?: (rects: readonly { readonly rect: RectView }[]) => number;
  hash2?: (x: number, y: number) => number;
  cellToDeviceRect?: (cell: GridPoint, view: DeviceView) => RectView;
  deviceToCell?: (x: number, y: number, view: DeviceView) => GridPoint;
}

const SHORE_MODULE_PATH = '../src/render/shore-band.ts';

async function shore(): Promise<ShoreModule> {
  try {
    return (await import(SHORE_MODULE_PATH)) as ShoreModule;
  } catch {
    return {};
  }
}

const has = (mod: ShoreModule, name: keyof ShoreModule): void => {
  assert.equal(typeof mod[name], name === 'SHORE_PRESETS' ? 'object' : 'function', `render/shore-band.ts 必须导出 ${String(name)}`);
};

// ---------------------------------------------------------------- 夹具

const key = (p: GridPoint): string => `${p.x},${p.y}`;

function ring(): { water: GridPoint[]; land: GridPoint[] } {
  const water: GridPoint[] = [];
  const land: GridPoint[] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const outer = x === 0 || x === 4 || y === 0 || y === 4;
      if (outer || (x === 2 && y === 2)) land.push({ x, y });
      else water.push({ x, y });
    }
  }
  return { water, land };
}

/** 4 格直岸：水在上、陆在下。 */
function straight4(): { water: GridPoint[]; land: GridPoint[] } {
  return straightK(4);
}

function straightK(k: number): { water: GridPoint[]; land: GridPoint[] } {
  const land: GridPoint[] = [];
  const water: GridPoint[] = [];
  for (let x = 0; x < k; x += 1) {
    water.push({ x, y: 0 });
    land.push({ x, y: 1 });
  }
  return { water, land };
}

/** 灯潮界行 15 的 12 格直岸段（x=42..53），水在行 14。 */
function row15(): { water: GridPoint[]; land: GridPoint[] } {
  const land: GridPoint[] = [];
  const water: GridPoint[] = [];
  for (let x = 42; x <= 53; x += 1) {
    water.push({ x, y: 14 });
    land.push({ x, y: 15 });
  }
  return { water, land };
}

const STEPS_STONE: readonly ShoreStepView[] = [
  { token: 'soil', depthPx: 8 },
  { token: 'farm', depthPx: 8 },
  { token: 'plaza', depthPx: 8 },
];

const STEPS_GRASS: readonly ShoreStepView[] = [
  { token: 'soil', depthPx: 8 },
  { token: 'farm', depthPx: 8 },
  { token: 'copper', depthPx: 8 },
];

const BASE = {
  depthPx: 24,
  staggerPx: 4,
  staggerLevels: 4,
  staggerStep: 0,
  maxTruncatedPx: 0,
  maxOverlapPx: 0,
} as const;

function configOf(kind: 'stone' | 'grass'): Omit<ShoreNumbersView, 'insetPx'> {
  return {
    land: [kind],
    ...BASE,
    steps: kind === 'stone' ? STEPS_STONE : STEPS_GRASS,
  };
}

async function numbersOf(kind: 'stone' | 'grass', style: 'straight' | 'inset' = 'straight', extra: Partial<Omit<ShoreNumbersView, 'insetPx'>> = {}): Promise<ShoreNumbersView> {
  const mod = await shore();
  has(mod, 'resolveShore');
  return mod.resolveShore!(style, { ...configOf(kind), ...extra });
}

function tagTerrain(edges: readonly ShoreSide[], terrain: string): ShoreSide[] {
  return edges.map((edge) => ({ ...edge, terrain }));
}

// ---------------------------------------------------------------- 颜色

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Lab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

type Phase = 'dawn' | 'noon' | 'dusk' | 'night';

const PALETTE = DENGCHAO_RAW.palette as Readonly<Record<string, string>>;

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

function hexToRgb(hex: string): Rgb {
  const raw = hex.replace('#', '');
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((value) => clamp255(value).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToLab({ r, g, b }: Rgb): Lab {
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0]! * 0.4124 + linear[1]! * 0.3576 + linear[2]! * 0.1805) / 0.95047;
  const y = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  const z = (linear[0]! * 0.0193 + linear[1]! * 0.1192 + linear[2]! * 0.9505) / 1.08883;
  const f = (value: number): number => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/** CIEDE2000（kL = kC = kH = 1，Sharma 2005 完整式）。 */
function deltaE2000(first: Lab, second: Lab): number {
  const [L1, a1, b1] = [first.L, first.a, first.b];
  const [L2, a2, b2] = [second.L, second.a, second.b];
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number): number => {
    if (a === 0 && b === 0) return 0;
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    return angle < 0 ? angle + 360 : angle;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(((dhp / 2) * Math.PI) / 180);
  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH),
  );
}

/** Sharma 2005 两个标准样本；容差 5e-4。 */
function assertReferencePairs(): void {
  const pairs: readonly [Lab, Lab, number][] = [
    [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }, 2.8615],
  ];
  for (const [first, second, expected] of pairs) {
    const actual = deltaE2000(first, second);
    assert.ok(Math.abs(actual - expected) <= 5e-4, `CIEDE2000 自检失败：期望 ${expected}，实得 ${actual}`);
  }
}

const PHASE_DIM: Readonly<Record<Phase, { readonly dim: string; readonly a: number }>> = {
  dawn: { dim: 'cloakDark', a: 0.2 },
  noon: { dim: 'deepShade', a: 0 },
  dusk: { dim: 'ink', a: 0.16 },
  night: { dim: 'deepShade', a: 0.46 },
};

const PHASE_ORDER: readonly Phase[] = ['noon', 'dawn', 'dusk', 'night'];

/**
 * 出画值：先按天气 dim（cloakDark × 0.28），再按时相 dim 叠一层。
 * 与设计稿 §6.5 同一个模型：逐通道 8-bit 线性混合。
 */
function composite(token: string, phase: Phase, rain: boolean): { readonly hex: string; readonly lab: Lab } {
  const source = PALETTE[token];
  assert.ok(source !== undefined, `dengchao 色板里没有 ${token}`);
  let rgb = hexToRgb(source!);
  if (rain) {
    const dim = hexToRgb(PALETTE.cloakDark!);
    rgb = { r: clamp255(rgb.r * 0.72 + dim.r * 0.28), g: clamp255(rgb.g * 0.72 + dim.g * 0.28), b: clamp255(rgb.b * 0.72 + dim.b * 0.28) };
  }
  const phaseDim = PHASE_DIM[phase];
  if (phaseDim.a > 0) {
    const dim = hexToRgb(PALETTE[phaseDim.dim]!);
    rgb = {
      r: clamp255(rgb.r * (1 - phaseDim.a) + dim.r * phaseDim.a),
      g: clamp255(rgb.g * (1 - phaseDim.a) + dim.g * phaseDim.a),
      b: clamp255(rgb.b * (1 - phaseDim.a) + dim.b * phaseDim.a),
    };
  }
  return { hex: rgbToHex(rgb), lab: rgbToLab(rgb) };
}

interface PairReading {
  readonly dL: number;
  readonly dE: number;
}

function pairOf(first: string, second: string, phase: Phase, rain: boolean): PairReading {
  const a = composite(first, phase, rain).lab;
  const b = composite(second, phase, rain).lab;
  return { dL: b.L - a.L, dE: deltaE2000(a, b) };
}

// ---------------------------------------------------------------- J1

test('J1 退化夹具 D1/D2/D4：四邻接边数与 side', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  const edges = mod.waterLandEdges!;

  assert.deepEqual(
    edges({ water: [{ x: 0, y: 0 }], land: [{ x: 0, y: 1 }] }).map((edge) => ({ side: edge.side, land: edge.land, water: edge.water })),
    [{ side: 'north', land: { x: 0, y: 1 }, water: { x: 0, y: 0 } }],
    'D1 单格接触：水在陆格北面，1 条 north',
  );
  assert.equal(edges({ water: [{ x: 0, y: 0 }], land: [{ x: 1, y: 1 }] }).length, 0, 'D2 对角接触不算岸（四邻接，不含对角）');
  assert.deepEqual(
    edges({ water: [{ x: 0, y: 0 }, { x: 1, y: 0 }], land: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }).map(
      (edge) => `${edge.side}:${key(edge.land)}`,
    ),
    ['north:0,1', 'north:1,1'],
    'D4 整边相接：2 条同 side，顺序先按陆格 y 再 x',
  );
});

test('J1 退化夹具 D3 环形水：内圈 4 + 外圈 12 = 16，且无重复', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  const edges = mod.waterLandEdges!(ring());

  assert.equal(edges.length, 16, 'D3 环形水：内圈 4（中心四侧）+ 外圈 12（四条边各 3；四个外角只对角接触）');
  const keys = new Set(edges.map((edge) => `${key(edge.water)}>${key(edge.land)}`));
  assert.equal(keys.size, edges.length, '同一对水/陆格不能重复计数');

  const fixture = ring();
  const landSet = new Set(fixture.land.map(key));
  const brute = fixture.water.reduce((sum, cell) => {
    const around: GridPoint[] = [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x - 1, y: cell.y },
    ];
    return sum + around.filter((p) => landSet.has(key(p))).length;
  }, 0);
  assert.equal(edges.length, brute, '邻接边数必须与独立暴力计数一致');
});

test('J1 每条边的 side 都指向水格，坐标满足映射', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  for (const edge of mod.waterLandEdges!(ring())) {
    const expected = {
      north: { x: edge.land.x, y: edge.land.y - 1 },
      east: { x: edge.land.x + 1, y: edge.land.y },
      south: { x: edge.land.x, y: edge.land.y + 1 },
      west: { x: edge.land.x - 1, y: edge.land.y },
    }[edge.side];
    assert.deepEqual(edge.water, expected, `side=${edge.side} 的水格应在陆格那一侧`);
  }
});

test('J1 网格适配器与显式集合输入给出同一结果，并带上陆格地形', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'waterLandEdgesFromGrid');

  const grid = new WorldGrid({
    width: 12,
    height: 8,
    zones: [],
    border: 0,
    terrain: [
      { x: 0, y: 0, w: 12, h: 2, terrain: 'shallow' },
      { x: 0, y: 2, w: 12, h: 2, terrain: 'grass' },
      { x: 0, y: 4, w: 12, h: 4, terrain: 'mud' },
    ],
  });

  const water: GridPoint[] = [];
  const land: GridPoint[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.at({ x, y });
      if (cell === undefined) continue;
      (cell.terrain === 'shallow' ? water : land).push({ x, y });
    }
  }

  const explicit = mod.waterLandEdges!({ water, land })
    .map((edge) => `${edge.side}:${key(edge.land)}>${key(edge.water)}`)
    .sort();
  const adapted = mod.waterLandEdgesFromGrid!(grid, (terrain) => terrain === 'shallow')
    .map((edge) => `${edge.side}:${key(edge.land)}>${key(edge.water)}`)
    .sort();
  assert.deepEqual(adapted, explicit, '网格适配器不能另造一套边');

  const fromGrid = mod.waterLandEdgesFromGrid!(grid, (terrain) => terrain === 'shallow');
  assert.ok(fromGrid.every((edge) => edge.terrain !== undefined), '从网格扫出来的边必须带上陆格地形（岸型按它查表）');
  assert.equal(fromGrid[0]!.terrain, 'grass', '行 2 的岸线陆格是 grass');
});

// ---------------------------------------------------------------- J2

test('J2 两种岸型预设：直岸 inset 0、收进 inset 2', async () => {
  const mod = await shore();
  has(mod, 'SHORE_PRESETS');
  has(mod, 'resolveShore');
  has(mod, 'shoreBandRects');

  assert.equal(mod.SHORE_PRESETS!.straight.insetPx, 0);
  assert.equal(mod.SHORE_PRESETS!.inset.insetPx, 2);

  const edges = mod.waterLandEdges!(straight4());
  const straight = await numbersOf('stone', 'straight');
  const inset = await numbersOf('stone', 'inset');
  const straightRects = mod.shoreBandRects!(edges, [straight]);
  const insetRects = mod.shoreBandRects!(edges, [inset]);

  assert.deepEqual([...new Set(straightRects.pieces.map((piece) => piece.step))].sort(), [0, 1, 2], '三档都要发出来');
  assert.ok(straightRects.pieces.filter((piece) => piece.step === 0).length >= 4, '湿段错位后可能跨格拆成两块');
  assert.equal(straightRects.pieces[0]!.rect.y, 1 * TILE_PX, '直岸紧贴水边（陆格北沿）');
  assert.equal(insetRects.pieces[0]!.rect.y, 1 * TILE_PX + 2, '收进从水边向陆侧退 2px');
  assert.equal(straightRects.truncatedPx, 0);
  assert.equal(straightRects.overlapPx, 0);
});

test('J2 灯潮界必须真的配上 shore，且石板与草岸各有独立三档', () => {
  const raw = DENGCHAO_RAW as { readonly shore?: readonly unknown[] };
  assert.ok(Array.isArray(raw.shore) && raw.shore.length === 2, '默认世界 `dengchao` 必须配两组岸型（石材/草岸）');

  const table = raw.shore as readonly {
    readonly land?: readonly string[];
    readonly style?: string;
    readonly depthPx?: number;
    readonly staggerPx?: number;
    readonly staggerLevels?: number;
    readonly staggerStep?: number;
    readonly maxTruncatedPx?: number;
    readonly maxOverlapPx?: number;
    readonly steps?: readonly { readonly token?: string; readonly depthPx?: number }[];
  }[];
  const stone = table.find((entry) => entry.land?.includes('stone'));
  const grass = table.find((entry) => entry.land?.includes('grass'));
  assert.ok(stone !== undefined && grass !== undefined, '石板段与草岸段各要一组');
  assert.deepEqual(stone!.steps?.map((step) => step.token), ['soil', 'farm', 'plaza'], '石板段末段是 plaza');
  assert.deepEqual(grass!.steps?.map((step) => step.token), ['soil', 'farm', 'copper'], '草岸段末段是 copper，不许用 plaza 通吃');
  for (const entry of [stone!, grass!]) {
    assert.equal(entry.style, 'straight', '灯潮界用直岸（inset 0），每格至多一条边');
    assert.equal(entry.depthPx, 24);
    assert.equal(entry.staggerPx, 4);
    assert.equal(entry.staggerLevels, 4);
    assert.equal(entry.staggerStep, 0, '错位只加在湿端第一段，末段固定 8px（否则正午读成亮板）');
    assert.equal(entry.maxTruncatedPx, 0);
    assert.deepEqual(entry.steps?.map((step) => step.depthPx), [8, 8, 8]);
  }
  // 拐角重叠是结构事实（4 个拐角格），石材段按实测基线写死；草岸段不在拐角。
  assert.equal(stone!.maxOverlapPx, 2656, '石材段的重叠上限是实测基线，不是 0');
  assert.equal(grass!.maxOverlapPx, 0, '草岸段不在拐角，重叠必须是 0');
  assert.ok((WORLD as Record<string, unknown>).plaza !== undefined && (WORLD as Record<string, unknown>).copper !== undefined);

  const loaded = loadSettingPack(DENGCHAO_RAW) as { readonly shore?: unknown };
  assert.ok(loaded.shore !== undefined, '装载后的 SettingPack 必须保留 shore，不能在校验时丢掉');
});

test('J2 数据选择决定矩形：改 style 改的是数据，不是渲染层分支', async () => {
  const mod = await shore();
  has(mod, 'resolveShore');
  has(mod, 'shoreBandRects');
  const edges = mod.waterLandEdges!(straight4());

  const a = mod.shoreBandRects!(edges, [await numbersOf('stone', 'straight')]).pieces[0]!;
  const b = mod.shoreBandRects!(edges, [await numbersOf('stone', 'inset')]).pieces[0]!;
  assert.equal(b.rect.y - a.rect.y, 2, 'style 从 straight 改成 inset，差的是数据里的 insetPx=2');
  assert.equal(a.rect.w, b.rect.w, '沿岸方向的长度不因收进而变');
});

test('J2 shore 缺席 → 不画（旧设定集路径）', async () => {
  const mod = await shore();
  has(mod, 'resolveShoreConfig');
  has(mod, 'shoreBandRects');

  assert.equal(mod.resolveShoreConfig!(undefined), null, '没有 shore 就不解析出任何数字');
  const edges = mod.waterLandEdges!(straight4());
  assert.deepEqual(mod.shoreBandRects!(edges, null), { pieces: [], truncatedPx: 0, overlapPx: 0 }, '数字为 null 时一段都不画');

  const oldPack = loadSettingPack({ ...DENGCHAO_RAW, shore: undefined });
  assert.equal(mod.resolveShoreConfig!((oldPack as { readonly shore?: unknown }).shore), null, '删掉配置的包必须回到「不画」');
});

test('J2 装载期校验：shore 写错当场拒绝', () => {
  const make = (overrides: Record<string, unknown>): never =>
    ({ ...DENGCHAO_RAW, shore: [{ ...configOf('stone'), style: 'straight', ...overrides }] }) as never;

  assert.throws(() => loadSettingPack(make({ depthPx: 30, steps: STEPS_STONE })), /depthPx[\s\S]*8 的整数倍/i, 'depthPx 不是 8 的倍数必须拒绝');
  assert.throws(() => loadSettingPack(make({ depthPx: 24, steps: [{ token: 'soil', depthPx: 7 }, { token: 'farm', depthPx: 17 }] })), /steps\[0\]/i, '每段不是 8 的倍数必须拒绝');
  assert.throws(() => loadSettingPack(make({ depthPx: 24, steps: [{ token: 'soil', depthPx: 8 }, { token: 'farm', depthPx: 8 }] })), /steps/i, '段和与 depthPx 不等必须拒绝');
  assert.throws(() => loadSettingPack(make({ style: 'wavy' })), /style/i, '未知岸型必须拒绝');
  assert.throws(() => loadSettingPack(make({ steps: [{ token: 'paper', depthPx: 8 }, { token: 'farm', depthPx: 8 }, { token: 'plaza', depthPx: 8 }] })), /token/i, 'token 不在 24 色里必须拒绝');
  assert.throws(() => loadSettingPack(make({ staggerLevels: 5 })), /staggerLevels/i, '错位档数越界必须拒绝');
  assert.throws(() => loadSettingPack(make({ maxOverlapPx: -1 })), /maxOverlapPx/i, '上限为负必须拒绝');
  assert.throws(
    () => loadSettingPack({ ...DENGCHAO_RAW, shore: [{ ...configOf('stone'), style: 'straight', land: ['stone'] }, { ...configOf('grass'), style: 'straight', land: ['stone'] }] } as never),
    /同时声明/i,
    '同一地形被两组岸型声明必须拒绝（否则同一格有两种读法）',
  );

  const badInset = { ...configOf('stone'), style: 'inset', depthPx: 48, steps: [{ token: 'soil', depthPx: 16 }, { token: 'farm', depthPx: 16 }, { token: 'plaza', depthPx: 16 }] };
  assert.throws(() => loadSettingPack({ ...DENGCHAO_RAW, shore: [badInset] } as never), /insetPx|depthPx|staggerPx/, 'inset + depth + stagger 超过 3 格必须拒绝');
});

test('J2 源码检查：shore-band 绘制路径里没有 kind === / style === 的写死分支', () => {
  let source = '';
  try {
    source = readFileSync(new URL('../src/render/shore-band.ts', import.meta.url), 'utf8');
  } catch {
    source = '';
  }
  assert.ok(source.length > 0, 'render/shore-band.ts 必须存在（模块缺席就是本轮的实现还没写）');
  assert.ok(!/\b(style|kind)\s*===/.test(source), '岸型必须从数据表解析成数字后再画，不能留 style === 分支');
});

// ---------------------------------------------------------------- J3

test('J3 入水像素必须为 0：直岸/收进 × depthPx × 退化夹具', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');

  const fixtures = [
    { name: 'D1', fixture: { water: [{ x: 0, y: 0 }], land: [{ x: 0, y: 1 }] } },
    { name: 'D3', fixture: ring() },
    { name: 'D4', fixture: straight4() },
  ];
  const styles: readonly ('straight' | 'inset')[] = ['straight', 'inset'];

  for (const { name, fixture } of fixtures) {
    for (const style of styles) {
      for (const depthPx of [16, 24]) {
        const numbers = await numbersOf('stone', style, {
          depthPx,
          steps: depthPx === 16
            ? [{ token: 'soil', depthPx: 8 }, { token: 'farm', depthPx: 8 }]
            : STEPS_STONE,
          staggerStep: depthPx === 16 ? 1 : 2,
          // 湖心岛（D3 中心格）的带子会跨进内部水面，截断是正确行为；
          // D3 中心格四侧临水，四条带在同一格相交，overlap 是拐角结构事实，
          // 这里只要求「被截断，不许画进水里」。
          maxTruncatedPx: 512,
          maxOverlapPx: 1024,
        });
        const water = new Set(fixture.water.map(key));
        const result = mod.shoreBandRects!(mod.waterLandEdges!(fixture), [numbers], (cell) => !water.has(key(cell)));
        assert.equal(
          mod.countPixelsInCells!(result.pieces, water),
          0,
          `${name} / ${style} / depth=${depthPx}：矩形像素不得落进任何水格`,
        );
      }
    }
  }
});

test('J3 结构断言：每个矩形像素所属格都不是浅滩（跨格版）', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdgesFromGrid');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');

  const grid = new WorldGrid({
    width: 12,
    height: 8,
    zones: [],
    border: 0,
    terrain: [
      { x: 0, y: 0, w: 12, h: 1, terrain: 'shallow' },
      { x: 0, y: 1, w: 12, h: 7, terrain: 'grass' },
    ],
  });
  const shallow = new Set<string>();
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) if (grid.at({ x, y })!.terrain === 'shallow') shallow.add(key({ x, y }));
  }

  const edges = mod.waterLandEdgesFromGrid!(grid, (terrain) => terrain === 'shallow');
  const result = mod.shoreBandRects!(edges, [await numbersOf('grass')], (cell) => {
    if (cell.x < 0 || cell.y < 0 || cell.x >= grid.width || cell.y >= grid.height) return false;
    return grid.at(cell)?.terrain !== 'shallow';
  });

  assert.equal(mod.countPixelsInCells!(result.pieces, shallow), 0, '跨到第二、三格的像素也必须全在陆格');
  assert.equal(result.truncatedPx, 0);
});

test('J3 反向 M1/M2：故意越界 1px，检查器必须报红', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');

  const north = straight4();
  const northRects = mod.shoreBandRects!(mod.waterLandEdges!(north), [await numbersOf('stone')]).pieces;
  const moved = northRects.map((entry) => ({ ...entry, rect: { ...entry.rect, y: entry.rect.y - 1 } }));
  assert.ok(mod.countPixelsInCells!(moved, new Set(north.water.map(key))) > 0, 'M1 必须红：检查器看不见上移 1px 的话，「0 像素」就是空话');

  const east = { water: [{ x: 1, y: 1 }], land: [{ x: 0, y: 1 }] };
  const eastRects = mod.shoreBandRects!(mod.waterLandEdges!(east), [await numbersOf('stone')]).pieces;
  const wider = eastRects.map((entry) => ({ ...entry, rect: { ...entry.rect, w: entry.rect.w + 1 } }));
  assert.ok(mod.countPixelsInCells!(wider, new Set(east.water.map(key))) > 0, 'M2 必须红：向东越过陆格边界 1px 要被抓到');
});

// ---------------------------------------------------------------- J4

function coverageOf(pieces: readonly PieceView[], axis: 'x' | 'y'): { start: number; end: number }[] {
  const intervals = pieces.map((piece) =>
    axis === 'x'
      ? { start: piece.rect.x, end: piece.rect.x + piece.rect.w }
      : { start: piece.rect.y, end: piece.rect.y + piece.rect.h },
  );
  intervals.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

test('J4 直岸 k 格连续 = k × TILE_PX（沿水线无缝，断一格必须拆段）', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  const edgesOf = mod.waterLandEdges!;
  const rectsOf = mod.shoreBandRects!;
  const numbers = await numbersOf('stone');

  for (let k = 1; k <= 6; k += 1) {
    const pieces = rectsOf(edgesOf(straightK(k)), [numbers]).pieces;
    assert.deepEqual(coverageOf(pieces, 'x'), [{ start: 0, end: k * TILE_PX }], `${k} 格连续：沿水线覆盖 [0,${k * TILE_PX}) 且无缝`);
  }

  // 反向 M4：3 格 + 空 1 格 + 1 格 → 两段（[0,48) 与 [64,80)），不能读成 4 格连续。
  const gap = {
    water: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }],
    land: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 4, y: 1 }],
  };
  assert.deepEqual(
    coverageOf(rectsOf(edgesOf(gap), [numbers]).pieces, 'x'),
    [{ start: 0, end: 48 }, { start: 64, end: 80 }],
    'M4：断一格必须拆成两段',
  );

  // 收进段只改垂直方向，沿岸覆盖仍是 k × 16。
  const inset = rectsOf(edgesOf(straightK(4)), [await numbersOf('stone', 'inset')]).pieces;
  assert.deepEqual(coverageOf(inset, 'x'), [{ start: 0, end: 4 * TILE_PX }]);
});

test('J4 反向 M3/M11：越界参数在生成器里当场抛，文案点名参数', async () => {
  const mod = await shore();
  has(mod, 'resolveShore');
  has(mod, 'shoreBandRects');
  const edges = mod.waterLandEdges!(straight4());
  const base = await numbersOf('stone');

  assert.throws(() => mod.shoreBandRects!(edges, [{ ...base, depthPx: 0 }]), /depthPx/, 'depthPx = 0 必须抛，且点名 depthPx');
  assert.throws(() => mod.shoreBandRects!(edges, [{ ...base, insetPx: -1 }]), /insetPx/, 'insetPx = -1 必须抛，且点名 insetPx');
  assert.throws(
    () => mod.resolveShore!('straight', { ...configOf('stone'), depthPx: 30 }),
    /depthPx[\s\S]*8 的整数倍（8\.\.48），收到 30/,
    'M11b：depthPx = 30 必须抛，文案给出 8 的整数倍与收到的值',
  );
  assert.throws(
    () => mod.resolveShore!('straight', { ...configOf('stone'), depthPx: 24, steps: [{ token: 'soil', depthPx: 7 }, { token: 'farm', depthPx: 17 }] }),
    /steps\[0\]\.depthPx 必须是 8 的整数倍，收到 7/,
    'M11b：steps[0].depthPx = 7 必须抛',
  );
  assert.throws(
    () => mod.resolveShore!('straight', { ...configOf('stone'), depthPx: 24, steps: [{ token: 'soil', depthPx: 8 }, { token: 'farm', depthPx: 8 }] }),
    /长度和[\s\S]*depthPx/,
    'M11：段和 ≠ depthPx 必须抛',
  );
  assert.throws(
    () => mod.resolveShore!('inset', { ...configOf('stone'), depthPx: 48, steps: [{ token: 'soil', depthPx: 16 }, { token: 'farm', depthPx: 16 }, { token: 'plaza', depthPx: 16 }] }),
    /insetPx[\s\S]*depthPx[\s\S]*staggerPx|超过 3 格/,
    'M11：inset + depth + stagger > 48 必须抛',
  );
  assert.throws(
    () => mod.resolveShore!('straight', { ...configOf('stone'), staggerLevels: 5 }),
    /staggerLevels/,
    'M11：staggerLevels 越界必须抛',
  );
});

// ---------------------------------------------------------------- J6

test('J6 24px 落 2 格、36px 落 3 格，每格承担段与 §6.4 表一致', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');

  // (42,15) 的 hash2 % 4 = 0 → extra 0；总宽 24，落两格。
  const phase0 = mod.shoreBandRects!(
    mod.waterLandEdges!({ water: [{ x: 42, y: 14 }], land: [{ x: 42, y: 15 }] }),
    [await numbersOf('stone')],
  );
  assert.equal(phase0.truncatedPx, 0);
  assert.equal(phase0.overlapPx, 0);
  assert.deepEqual(
    phase0.pieces.map((piece) => [piece.step, piece.token, piece.cell, piece.rect]),
    [
      [0, 'soil', { x: 42, y: 15 }, { x: 672, y: 240, w: 16, h: 8 }],
      [1, 'farm', { x: 42, y: 15 }, { x: 672, y: 248, w: 16, h: 8 }],
      [2, 'plaza', { x: 42, y: 16 }, { x: 672, y: 256, w: 16, h: 8 }],
    ],
    '24px = soil 8 + farm 8（行 15）+ plaza 8（行 16）',
  );

  // (44,15) 的 hash2 % 4 = 3 → extra 12；总宽 36，落三格。
  const phase3 = mod.shoreBandRects!(
    mod.waterLandEdges!({ water: [{ x: 44, y: 14 }], land: [{ x: 44, y: 15 }] }),
    [await numbersOf('stone')],
  );
  assert.equal(phase3.truncatedPx, 0);
  assert.deepEqual(
    phase3.pieces.map((piece) => [piece.step, piece.cell, piece.rect.y, piece.rect.h]),
    [
      [0, { x: 44, y: 15 }, 240, 16],
      [0, { x: 44, y: 16 }, 256, 4],
      [1, { x: 44, y: 16 }, 260, 8],
      [2, { x: 44, y: 16 }, 268, 4],
      [2, { x: 44, y: 17 }, 272, 4],
    ],
    '36px：错位 12px 加在湿端（soil 20px 切到行 15 的 16px + 行 16 的 4px），末段固定 8px',
  );
});

test('J6 石板段与草岸段的几何逐项一致，只有末段 token 不同', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  const edges = mod.waterLandEdges!(straight4());

  const stone = mod.shoreBandRects!(tagTerrain(edges, 'stone'), [await numbersOf('stone')]).pieces;
  const grass = mod.shoreBandRects!(tagTerrain(edges, 'grass'), [await numbersOf('grass')]).pieces;

  assert.deepEqual(stone.map((piece) => [piece.step, piece.cell, piece.rect]), grass.map((piece) => [piece.step, piece.cell, piece.rect]));
  assert.deepEqual(
    new Set(stone.filter((piece) => piece.step === 2).map((piece) => piece.token)),
    new Set(['plaza']),
  );
  assert.deepEqual(
    new Set(grass.filter((piece) => piece.step === 2).map((piece) => piece.token)),
    new Set(['copper']),
    '草岸段末段必须是 copper，不许用一个 plaza 通吃所有岸型',
  );
});

test('J6 多组岸型按陆格地形查表；缺 terrain 无法选取时必须抛', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdgesFromGrid');
  has(mod, 'shoreBandRects');

  const grid = new WorldGrid({
    width: 12,
    height: 8,
    zones: [],
    border: 0,
    terrain: [
      { x: 0, y: 0, w: 12, h: 1, terrain: 'shallow' },
      { x: 0, y: 1, w: 6, h: 7, terrain: 'grass' },
      { x: 6, y: 1, w: 6, h: 7, terrain: 'stone' },
    ],
  });
  const edges = mod.waterLandEdgesFromGrid!(grid, (terrain) => terrain === 'shallow');
  const configs = [await numbersOf('stone'), await numbersOf('grass')];
  const result = mod.shoreBandRects!(edges, configs);
  assert.deepEqual(
    new Set(result.pieces.filter((piece) => piece.cell.x < 6 && piece.step === 2).map((piece) => piece.token)),
    new Set(['copper']),
  );
  assert.deepEqual(
    new Set(result.pieces.filter((piece) => piece.cell.x >= 6 && piece.step === 2).map((piece) => piece.token)),
    new Set(['plaza']),
  );

  assert.throws(
    () => mod.shoreBandRects!(mod.waterLandEdges!(straight4()), configs),
    /terrain/i,
    '显式夹具缺 terrain 且给了两组岸型时必须抛，不许猜一组',
  );
});

test('J6 截断不许静默：maxTruncatedPx = 0 必须抛，放到 8 才返回读数', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  // (42,15) 的相位是 0：24px 的 plaza 段 8px 整块落在行 16。
  const fixture = { water: [{ x: 42, y: 14 }], land: [{ x: 42, y: 15 }] };
  const edges = mod.waterLandEdges!(fixture);
  const isLand = (cell: GridPoint): boolean => cell.y <= 15;
  const water = new Set(fixture.water.map(key));

  // M12/M10：第二格（行 16）是浅滩单格岛，plaza 段的 8px 被截断。
  const strict = await numbersOf('stone');
  assert.throws(
    () => mod.shoreBandRects!(edges, [strict], isLand),
    /截断 8 px 超过上限 0/,
    'maxTruncatedPx=0 时任何截断都必须让地形烘焙当场失败',
  );

  const relaxed = mod.shoreBandRects!(edges, [await numbersOf('stone', 'straight', { maxTruncatedPx: 8 })], isLand);
  assert.equal(relaxed.truncatedPx, 8, '截断量是沿法线的 8px，不是面积');
  assert.equal(mod.countPixelsInCells!(relaxed.pieces, water), 0, '被截断的部分不许画进水面');
  assert.deepEqual(
    coverageOf(relaxed.pieces, 'y'),
    [{ start: 240, end: 256 }],
    '带子只在行 15 里铺满 16px',
  );
});

// ---------------------------------------------------------------- J7

test('CIEDE2000 自检：Sharma 2005 两个标准样本', () => {
  assertReferencePairs();
});

test('J7 石板段逐时相合成值：两对相邻段都过 6 / 5.53', () => {
  const expected = [
    // [phase, rain, soil→farm ΔL/ΔE, farm→plaza ΔL/ΔE]
    ['noon', false, 16.0, 13.58, 23.0, 22.21],
    ['noon', true, 11.3, 9.76, 16.8, 15.04],
    ['dawn', false, 12.6, 10.61, 18.8, 17.06],
    ['dawn', true, 8.8, 7.57, 13.6, 11.68],
    ['dusk', false, 13.7, 11.56, 19.8, 17.77],
    ['dusk', true, 9.7, 8.55, 14.3, 12.01],
    ['night', false, 8.9, 7.66, 13.0, 10.80],
    ['night', true, 6.0, 4.81, 9.6, 7.73],
  ] as const;

  for (const [phase, rain, dl1, de1, dl2, de2] of expected) {
    const first = pairOf('soil', 'farm', phase as Phase, rain);
    const second = pairOf('farm', 'plaza', phase as Phase, rain);
    assert.ok(Math.abs(first.dL - dl1) <= 0.05, `${phase}${rain ? '+雨' : ''} soil→farm ΔL 期望 ${dl1}，实得 ${first.dL.toFixed(2)}`);
    assert.ok(Math.abs(first.dE - de1) <= 0.05, `${phase}${rain ? '+雨' : ''} soil→farm ΔE 期望 ${de1}，实得 ${first.dE.toFixed(2)}`);
    assert.ok(Math.abs(second.dL - dl2) <= 0.05, `${phase}${rain ? '+雨' : ''} farm→plaza ΔL 期望 ${dl2}，实得 ${second.dL.toFixed(2)}`);
    assert.ok(Math.abs(second.dE - de2) <= 0.05, `${phase}${rain ? '+雨' : ''} farm→plaza ΔE 期望 ${de2}，实得 ${second.dE.toFixed(2)}`);
  }

  for (const phase of PHASE_ORDER) {
    const first = pairOf('soil', 'farm', phase, false);
    const second = pairOf('farm', 'plaza', phase, false);
    assert.ok(first.dL >= 6, `clear ${phase} soil→farm ΔL ${first.dL.toFixed(2)} ≥6（ΔE 仅记录）`);
    assert.ok(second.dL >= 6, `clear ${phase} farm→plaza ΔL ${second.dL.toFixed(2)} ≥6（ΔE 仅记录）`);
  }
});

test('J7 草岸段独立三档：soil→farm→copper 的逐时相读数与 clear 四相', () => {
  const expected = [
    ['noon', false, 16.0, 13.58, 13.0, 13.06],
    ['noon', true, 11.3, 9.76, 9.3, 9.20],
    ['dawn', false, 12.6, 10.61, 10.8, 10.99],
    ['dawn', true, 8.8, 7.57, 7.8, 7.72],
    ['dusk', false, 13.7, 11.56, 10.9, 10.63],
    ['dusk', true, 9.7, 8.55, 7.9, 7.67],
    ['night', false, 8.9, 7.66, 7.2, 6.95],
    ['night', true, 6.0, 4.81, 5.3, 4.86],
  ] as const;

  for (const [phase, rain, dl1, de1, dl2, de2] of expected) {
    const first = pairOf('soil', 'farm', phase as Phase, rain);
    const second = pairOf('farm', 'copper', phase as Phase, rain);
    assert.ok(Math.abs(first.dL - dl1) <= 0.05, `${phase}${rain ? '+雨' : ''} soil→farm ΔL=${first.dL.toFixed(2)}`);
    assert.ok(Math.abs(first.dE - de1) <= 0.05, `${phase}${rain ? '+雨' : ''} soil→farm ΔE=${first.dE.toFixed(2)}`);
    assert.ok(Math.abs(second.dL - dl2) <= 0.05, `${phase}${rain ? '+雨' : ''} farm→copper ΔL=${second.dL.toFixed(2)}`);
    assert.ok(Math.abs(second.dE - de2) <= 0.05, `${phase}${rain ? '+雨' : ''} farm→copper ΔE=${second.dE.toFixed(2)}`);
  }

  for (const phase of PHASE_ORDER) {
    const first = pairOf('soil', 'farm', phase, false);
    const second = pairOf('farm', 'copper', phase, false);
    assert.ok(first.dL >= 6, `clear ${phase} soil→farm ΔL ${first.dL.toFixed(2)} ≥6（ΔE 仅记录）`);
    assert.ok(second.dL >= 6, `clear ${phase} farm→copper ΔL ${second.dL.toFixed(2)} ≥6（ΔE 仅记录）`);
  }
});

test('J7 末段与背景地形仍可辨：plaza↔stone、copper↔grass', () => {
  const plazaStoneNoon = pairOf('stone', 'plaza', 'noon', false);
  const plazaStoneNight = pairOf('stone', 'plaza', 'night', false);
  assert.ok(Math.abs(plazaStoneNoon.dL - 14.3) <= 0.05 && Math.abs(plazaStoneNoon.dE - 15.13) <= 0.05, '正午 plaza→stone 14.3 / 15.13');
  assert.ok(Math.abs(plazaStoneNight.dL - 8.1) <= 0.05 && Math.abs(plazaStoneNight.dE - 7.27) <= 0.05, '夜相 plaza→stone 8.1 / 7.27');

  const copperGrassNoon = pairOf('grass', 'copper', 'noon', false);
  const copperGrassNight = pairOf('grass', 'copper', 'night', false);
  assert.ok(Math.abs(copperGrassNoon.dL - 18.1) <= 0.05 && Math.abs(copperGrassNoon.dE - 16.98) <= 0.05, '正午 copper→grass 18.1 / 16.98');
  assert.ok(Math.abs(copperGrassNight.dL - 10.2) <= 0.05 && Math.abs(copperGrassNight.dE - 9.16) <= 0.05, '夜相 copper→grass 10.2 / 9.16');
});

test('J7 每段沿法线 ≥8 art px：错位只加宽湿端第一段，末段恒定 8px', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  const edges = mod.waterLandEdges!({ water: [{ x: 42, y: 14 }], land: [{ x: 42, y: 15 }] });
  const numbers = await numbersOf('stone');

  for (const [x, extra] of [[42, 0], [43, 4], [48, 8], [44, 12]] as const) {
    const result = mod.shoreBandRects!(
      mod.waterLandEdges!({ water: [{ x, y: 14 }], land: [{ x, y: 15 }] }),
      [numbers],
    );
    const byStep = new Map<number, number>();
    for (const piece of result.pieces) byStep.set(piece.step, (byStep.get(piece.step) ?? 0) + piece.rect.h);
    assert.equal(byStep.get(0), 8 + extra, '第一段（湿端）= 8 + 相位 × 4');
    assert.equal(byStep.get(1), 8, '中段永远是 8px（不许从中间借宽度）');
    assert.equal(byStep.get(2), 8, '末段永远是 8px（亮面不许被错位撑大）');
  }
  assert.ok(edges.length === 1);
});

test('J7-pin 夜+雨：石板段三档全过（ΔL 6.02 / 9.55，降级承诺已删除）', () => {
  const first = pairOf('soil', 'farm', 'night', true);
  const second = pairOf('farm', 'plaza', 'night', true);

  assert.ok(Math.abs(first.dL - 6.02) <= 0.05, `石板段 夜+雨 soil→farm ΔL 6.02，实得 ${first.dL.toFixed(2)}`);
  assert.ok(Math.abs(second.dL - 9.55) <= 0.05, `石板段 夜+雨 farm→plaza ΔL 9.55，实得 ${second.dL.toFixed(2)}`);
  assert.ok(first.dL >= 6, '石板段 夜+雨 soil→farm ΔL 压线过 6：三档成立，不再是「两档半」');
  assert.ok(second.dL >= 6, '石板段 夜+雨 farm→plaza ΔL 过 6');
});

test('J7-pin nightRainGrassDegraded：草岸段夜+雨是已知降级，不是通过', () => {
  // 唯一降级对：草岸段 farm→copper 夜+雨 ΔL 5.29 < 6。
  // **这是记录降级事实的断言，不是三档达标**；谁改 token/混合模型让它继续下滑，
  // 或把 soil→farm 的 6.02 也拉下去，这里必须红。旧用例 knownDegradedNightRain
  // 依据 ΔE 4.81，已在 ΔL-only 口径下作废。
  const first = pairOf('soil', 'farm', 'night', true);
  const second = pairOf('farm', 'copper', 'night', true);

  assert.ok(Math.abs(first.dL - 6.02) <= 0.05, `草岸段 夜+雨 soil→farm ΔL 6.02，实得 ${first.dL.toFixed(2)}`);
  assert.ok(Math.abs(second.dL - 5.29) <= 0.05, `草岸段 夜+雨 farm→copper ΔL 5.29，实得 ${second.dL.toFixed(2)}`);
  assert.ok(first.dL >= 6, '草岸段 夜+雨 soil→farm 仍过 6');
  assert.ok(second.dL < 6, '草岸段 夜+雨 farm→copper ΔL 5.29 < 6：这是降级事实，不许读成通过');
});

test('J11 宽度/结构判据（独立于 ΔL）：24px 是带、3px 是描边', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'resolveShore');

  // 1) 带宽 ≥8 art px、≥2 段不同 token、跨 ≥2 格。
  for (const kind of ['stone', 'grass'] as const) {
    const numbers = await numbersOf(kind);
    const base = mod.shoreBandRects!(mod.waterLandEdges!({ water: [{ x: 42, y: 14 }], land: [{ x: 42, y: 15 }] }), [numbers]);
    const width = Math.max(...base.pieces.map((piece) => piece.rect.y + piece.rect.h)) - 240;
    assert.ok(width >= 8, `${kind} 带宽 ${width} ≥ 8 art px（下限半格）`);
    assert.equal(width, 24, '相位 0 的基值 24 art px = 1.5 格');
    assert.ok(new Set(base.pieces.map((piece) => piece.token)).size >= 2, `${kind} 带内至少 2 段不同 token`);
    assert.ok(new Set(base.pieces.map((piece) => piece.cell.y)).size >= 2, `${kind} 至少跨 2 格`);

    // 2) 36px 相位必须真的跨到第 3 格。
    const wide = mod.shoreBandRects!(mod.waterLandEdges!({ water: [{ x: 44, y: 14 }], land: [{ x: 44, y: 15 }] }), [numbers]);
    const wideWidth = Math.max(...wide.pieces.map((piece) => piece.rect.y + piece.rect.h)) - 240;
    assert.equal(wideWidth, 36, '相位 3 总宽 36 = 2.25 格');
    assert.ok(new Set(wide.pieces.map((piece) => piece.cell.y)).size >= 3, '36px 必须跨到第 3 格');
  }

  // 3) 反例：3px（描边）在装载/解析期就被拒，不靠观感。
  assert.throws(() => mod.resolveShore!('straight', { ...configOf('stone'), depthPx: 3 }), /depthPx/, 'depthPx 3 是描边宽度，守卫必须拒绝');
  // 单段 8px：结构上只有一种 token、没有段界 → 拒绝。
  assert.throws(
    () => mod.resolveShore!('straight', {
      ...configOf('stone'),
      depthPx: 8,
      steps: [{ token: 'soil', depthPx: 8 }],
      staggerStep: 0,
    }),
    /steps 必须是 2\.\.3 段/,
    '单段 8px 没有第二档，结构上还是描边',
  );
});

// ---------------------------------------------------------------- J8

test('J8 确定性错位：12 格宽度序列、无随机、两次调用 deepEqual', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  const numbers = await numbersOf('stone');

  const widthsOf = (pieces: readonly PieceView[]): number[] => {
    const totals = new Map<number, number>();
    for (const piece of pieces) {
      const bottom = piece.rect.y + piece.rect.h;
      totals.set(piece.cell.x, Math.max(totals.get(piece.cell.x) ?? 0, bottom - 240));
    }
    return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([, width]) => width);
  };

  const fixture = row15();
  const first = mod.shoreBandRects!(mod.waterLandEdges!(fixture), [numbers]);
  const second = mod.shoreBandRects!(mod.waterLandEdges!(fixture), [numbers]);
  assert.deepEqual(first.pieces, second.pieces, '同一输入调用两次，矩形列表逐项相同');

  const widths = widthsOf(first.pieces);
  assert.deepEqual(widths, [24, 28, 36, 28, 28, 28, 32, 28, 36, 24, 36, 28], '§6.6 的 12 格宽度序列逐项相等');
  assert.ok(new Set(widths).size >= 3, '至少 3 个不同档位，不是两档交替');

  let longest = 1;
  let run = 1;
  for (let i = 1; i < widths.length; i += 1) {
    run = widths[i] === widths[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  assert.ok(longest <= 4, `最长同宽游程 ${longest} ≤ 4`);

  let alternating = 0;
  for (let i = 0; i + 2 < widths.length; i += 1) if (widths[i] === widths[i + 2]) alternating += 1;
  assert.ok(alternating < widths.length - 2, `w[i]==w[i+2] 只有 ${alternating}/${widths.length - 2} 对，不是纯交替`);

  const source = readFileSync(new URL(SHORE_MODULE_PATH, import.meta.url), 'utf8');
  assert.ok(!source.includes('Math.random'), '模块内不许有 Math.random');
  assert.ok(!/x\s*\*\s*3\s*\+\s*y\s*\*\s*5/.test(source), 'v2 的 (x*3+y*5)%2 必须删掉');
});

// ---------------------------------------------------------------- J9

test('J9 跨格零入水：第二、三格的像素也全在陆格', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdgesFromGrid');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');

  const grid = new WorldGrid({
    width: 12,
    height: 8,
    zones: [],
    border: 0,
    terrain: [
      { x: 0, y: 0, w: 12, h: 1, terrain: 'shallow' },
      { x: 0, y: 1, w: 12, h: 7, terrain: 'stone' },
    ],
  });
  const edges = mod.waterLandEdgesFromGrid!(grid, (terrain) => terrain === 'shallow');
  const result = mod.shoreBandRects!(edges, [await numbersOf('stone')], (cell) => {
    if (cell.x < 0 || cell.y < 0 || cell.x >= grid.width || cell.y >= grid.height) return false;
    return grid.at(cell)?.terrain !== 'shallow';
  });

  const shallow = new Set<string>();
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) if (grid.at({ x, y })!.terrain === 'shallow') shallow.add(key({ x, y }));
  }
  assert.equal(mod.countPixelsInCells!(result.pieces, shallow), 0);
  assert.equal(result.truncatedPx, 0, '灯潮界行 15/16/17 都是陆格，截断应为 0');
  assert.ok(result.pieces.some((piece) => piece.cell.y === 3), '相位 3 的带子要真的跨到第三格（行 4）');
});

test('J9 反向 M8/M9：第二格落进水面，检查器必须报红', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');
  // 行 2 是浅滩单格岛：若生成器不过问目标格，干段就会画进水面。
  // 这里故意不给 isLandCell，验证检查器能看见这层泄漏。
  const fixture = { water: [{ x: 0, y: 0 }, { x: 0, y: 2 }], land: [{ x: 0, y: 1 }] };
  const result = mod.shoreBandRects!(
    mod.waterLandEdges!({ water: [{ x: 0, y: 0 }], land: [{ x: 0, y: 1 }] }),
    [await numbersOf('stone')],
  );

  const secondCell = result.pieces.filter((piece) => piece.cell.y > 1);
  assert.ok(secondCell.length > 0, '先要有第二格的干段');
  assert.ok(mod.countPixelsInCells!(secondCell, new Set(fixture.water.map(key))) > 0, 'M8/M9 必须红：干段进水面要被抓到');
});

test('J9 反向 M13：同格两侧临水只裁不叠，直岸单侧 overlapPx === 0', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');
  has(mod, 'countDoubleCovered');

  // (1,1) 北侧与水、西侧与水：北带与西带在同一格里相交。
  const corner = { water: [{ x: 1, y: 0 }, { x: 0, y: 1 }], land: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }] };
  const inset = await numbersOf('stone', 'inset', { maxOverlapPx: 256 });
  const result = mod.shoreBandRects!(mod.waterLandEdges!(corner), [inset]);

  assert.equal(result.overlapPx, 196, 'inset 下同格两侧临水：两条带在 [inset,inset+d)² 相交，裁掉 14×14=196');
  assert.equal(mod.countDoubleCovered!(result.pieces), 0, '只裁不叠：同一像素不许画两次');
  assert.equal(mod.countPixelsInCells!(result.pieces, new Set(corner.water.map(key))), 0, '裁掉的部分也不许漏进水面');

  // 同一夹具改成单侧临水（直岸）：每格至多一条边，overlapPx 必须是 0。
  const straightCorner = { water: [{ x: 1, y: 0 }], land: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }] };
  const straight = mod.shoreBandRects!(mod.waterLandEdges!(straightCorner), [await numbersOf('stone')]);
  assert.equal(straight.overlapPx, 0, '直岸段每格至多一条边 → overlapPx === 0 是结构事实');

  // 反向：把交叉处改成「覆盖」而不是裁掉，doubleCovered 必须红。
  assert.ok(
    mod.countDoubleCovered!([
      { rect: { x: 16, y: 16, w: 8, h: 8 } },
      { rect: { x: 20, y: 20, w: 8, h: 8 } },
    ]) > 0,
    '覆盖而不是裁掉时必须报红',
  );

  const strictCorner = await numbersOf('stone', 'inset', { maxOverlapPx: 0 });
  assert.throws(
    () => mod.shoreBandRects!(mod.waterLandEdges!(corner), [strictCorner]),
    /重叠 196 px 超过上限 0/,
    'maxOverlapPx 超限必须当场抛',
  );
});

test('J9 实测基线：真实 dengchao 的拐角重叠石材 2656 / 草岸 0，且超一像素必须抛', async () => {
  const mod = await shore();
  has(mod, 'resolveShoreConfig');
  has(mod, 'shoreBandRects');
  has(mod, 'waterLandEdgesFromGrid');
  has(mod, 'countDoubleCovered');
  has(mod, 'countPixelsInCells');

  const pack = loadSettingPack(DENGCHAO_RAW);
  const grid = buildSettingWorld(pack).grid;
  const configs = mod.resolveShoreConfig!((pack as { readonly shore?: unknown }).shore);
  assert.ok(configs !== null && configs.length === 2, '两组岸型都要解析出来');
  const edges = mod.waterLandEdgesFromGrid!(grid, (terrain) => terrain === 'shallow');
  const isLand = (cell: GridPoint): boolean => grid.at(cell)?.terrain !== 'shallow';

  // 拐角格是结构事实：这 4 格两侧同时临水，北带与竖带必然相交。
  const sides = new Map<string, string[]>();
  for (const edge of edges) {
    const k = key(edge.land);
    sides.set(k, [...(sides.get(k) ?? []), edge.side]);
  }
  const corners = [...sides.entries()].filter(([, list]) => list.length > 1).map(([k]) => k).sort();
  assert.deepEqual(corners, ['19,9', '28,14', '36,14', '7,9'], '灯潮界有 4 个拐角格（此前写的「全是北侧」是错的）');

  const water = new Set<string>();
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.at({ x, y })?.terrain === 'shallow') water.add(key({ x, y }));
    }
  }

  for (const [label, overlap] of [['stone', 2656], ['grass', 0]] as const) {
    const config = configs.find((entry) => entry.land.includes(label))!;
    const result = mod.shoreBandRects!(edges, [config], isLand);
    assert.equal(result.truncatedPx, 0, `${label}：三格承载都是陆格，不许截断`);
    assert.equal(result.overlapPx, overlap, `${label}：只裁不叠的重叠面积必须等于实测基线`);
    assert.equal(mod.countDoubleCovered!(result.pieces), 0, `${label}：同一像素不许画两次`);
    assert.equal(mod.countPixelsInCells!(result.pieces, water), 0, `${label}：被裁掉的部分也不许漏进水面`);
  }

  // 反向：基线少给 1px 就必须当场抛，证明 2656 是闸门而不是安全大数。
  const stone = configs.find((entry) => entry.land.includes('stone'))!;
  assert.throws(
    () => mod.shoreBandRects!(edges, [{ ...stone, maxOverlapPx: 2655 }], isLand),
    /重叠 2656 px 超过上限 2655/,
  );
});

test('J9 结构检查：反向 M10/M12 截断与上限（maxTruncatedPx）', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');

  // M10：第三格（行 3）改成浅滩单格岛，相位 3 的 4px 尾巴必须被截断。
  const fixture = { water: [{ x: 44, y: 14 }, { x: 44, y: 17 }], land: [{ x: 44, y: 15 }] };
  const edges = mod.waterLandEdges!({ water: [{ x: 44, y: 14 }], land: [{ x: 44, y: 15 }] });
  const isLand = (cell: GridPoint): boolean => !(cell.x === 44 && cell.y === 17);
  const strict = await numbersOf('stone');
  assert.throws(
    () => mod.shoreBandRects!(edges, [strict], isLand),
    /截断 4 px 超过上限 0/,
  );

  const relaxed = mod.shoreBandRects!(edges, [await numbersOf('stone', 'straight', { maxTruncatedPx: 4 })], isLand);
  assert.equal(relaxed.truncatedPx, 4);
  assert.equal(mod.countPixelsInCells!(relaxed.pieces, new Set(fixture.water.map(key))), 0);
});

// ---------------------------------------------------------------- 潮位分类

test('潮位不改水/陆格分类：地形数组跨潮位逐项相同（决定 J3 的「水」定义）', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const grid = buildSettingWorld(pack).grid;

  const before: string[] = [];
  for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) before.push(grid.at({ x, y })!.terrain);
  let shallow = 0;
  for (const terrain of before) if (terrain === 'shallow') shallow += 1;

  grid.setTideLevel(0);
  const floodedAt0 = countFlooded(grid);
  grid.setTideLevel(1);
  const floodedAt1 = countFlooded(grid);

  const after: string[] = [];
  for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) after.push(grid.at({ x, y })!.terrain);

  assert.deepEqual(after, before, '潮位只改 isFloodedAt 这个动态谓词，不改格子的 terrain');
  assert.equal(shallow, 790, '灯潮界 64×48 里永久水格（terrain === shallow）是 790 个');
  assert.equal(floodedAt0, 0, '潮位 0 时 isFloodedAt 一格都不认——它不能拿来定义「水」');
  assert.equal(floodedAt1, 2343, '潮位 1 时 isFloodedAt 认 2343 格为水，其中大量是地形陆地');
  assert.equal(isFlooded('shallow', 0), false, '低潮时浅滩也不被 isFlooded 认作水（0 > 0.12 不成立）');
  assert.equal(isFlooded('shallow', 1), true, '高潮时浅滩被 isFlooded 认作水');
});

function countFlooded(grid: WorldGrid): number {
  let n = 0;
  for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) if (grid.isFloodedAt({ x, y })) n += 1;
  return n;
}

// ---------------------------------------------------------------- 像素 → 格子

test('§3.6 像素 → 格子：DPR / zoom / scroll / canvas 偏移与校准点', async () => {
  const mod = await shore();
  has(mod, 'cellToDeviceRect');
  has(mod, 'deviceToCell');

  const view: DeviceView = {
    scrollX: 240,
    scrollY: 160,
    cameraWidth: 480,
    cameraHeight: 320,
    zoom: 2,
    canvasWidth: 960,
    canvasHeight: 640,
    gameWidth: 480,
    gameHeight: 320,
    deviceScaleFactor: 1,
    offsetX: 0,
    offsetY: 0,
  };

  assert.deepEqual(mod.cellToDeviceRect!({ x: 23, y: 16 }, view), { x: 32, y: 64, w: 64, h: 64 });
  assert.deepEqual(mod.deviceToCell!(95, 127, view), { x: 23, y: 16 }, '设备像素 (95,127) 仍在格 (23,16)');
  assert.deepEqual(mod.deviceToCell!(96, 128, view), { x: 24, y: 17 }, '半开区间：设备 (96,128) 已进入格 (24,17)');

  const shifted: DeviceView = { ...view, deviceScaleFactor: 2, offsetX: 1, offsetY: 1 };
  assert.deepEqual(
    mod.cellToDeviceRect!({ x: 23, y: 16 }, shifted),
    { x: 66, y: 130, w: 128, h: 128 },
    'dpr=2、offset=(1,1)：左上 = 32×2+2 / 64×2+2，格宽 = 64×2',
  );

  for (const cell of [{ x: 0, y: 0 }, { x: 23, y: 16 }, { x: 47, y: 31 }]) {
    const rect = mod.cellToDeviceRect!(cell, view);
    assert.deepEqual(
      mod.deviceToCell!(rect.x + rect.w / 2, rect.y + rect.h / 2, view),
      cell,
      `格 ${key(cell)} 的中心反解应回到同一格`,
    );
  }
});
