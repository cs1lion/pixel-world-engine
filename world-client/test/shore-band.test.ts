/**
 * P1 岸线带：先红后实现的那一侧。
 *
 * 这里只写判据，不写实现。`render/shore-band.ts` 在基点上不存在，因此所有
 * 需要它的用例都走**动态 import + typeof 断言**：模块缺席时红在断言上，
 * 不是 `ERR_MODULE_NOT_FOUND`（red-first 只认断言红，见 scripts/red-first.ts）。
 *
 * 判据与设计稿 `docs/P1_SHORE_BAND_DESIGN.md` 一一对应：
 *   J1 水陆邻接边（含 D1–D4 退化夹具）
 *   J2 岸型参数化到数据层（灯潮界必须真的配上 `shore`）
 *   J3 像素不侵入水面（含反向 M1/M2，证明检查器会红）
 *   J4 直岸 k 格连续 = k × TILE_PX
 *   §3.6 像素 → 格子：DPR / zoom / scroll / canvas 偏移与校准点
 *   附录：潮位不改水/陆格分类（实测，决定 J3 的「水」定义）
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

interface ShoreSide {
  readonly side: 'north' | 'east' | 'south' | 'west';
  readonly land: GridPoint;
  readonly water: GridPoint;
}

interface ShoreRectView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
  resolveShore?: (
    style: 'straight' | 'inset',
    numbers: { readonly depthPx: number; readonly token: string; readonly alpha: number },
  ) => { readonly insetPx: number; readonly depthPx: number; readonly token: string; readonly alpha: number };
  resolveShoreConfig?: (shore: unknown) => { readonly insetPx: number; readonly depthPx: number; readonly token: string; readonly alpha: number } | null;
  shoreBandRects?: (
    edges: readonly ShoreSide[],
    numbers: { readonly insetPx: number; readonly depthPx: number; readonly token: string; readonly alpha: number } | null,
  ) => readonly { readonly cell: GridPoint; readonly side: ShoreSide['side']; readonly rect: ShoreRectView; readonly lengthPx: number }[];
  countPixelsInCells?: (rects: readonly { readonly rect: ShoreRectView }[], cells: ReadonlySet<string>) => number;
  cellToDeviceRect?: (cell: GridPoint, view: DeviceView) => ShoreRectView;
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
  const land: GridPoint[] = [];
  const water: GridPoint[] = [];
  for (let x = 0; x < 4; x += 1) {
    water.push({ x, y: 0 });
    land.push({ x, y: 1 });
  }
  return { water, land };
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

const NUMBERS = { insetPx: 0, depthPx: 3, token: 'water', alpha: 0.5 };

// ---------------------------------------------------------------- J1

test('J1 退化夹具 D1/D2/D4：四邻接边数与 side', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  const edges = mod.waterLandEdges!;

  assert.deepEqual(
    edges({ water: [{ x: 0, y: 0 }], land: [{ x: 0, y: 1 }] }).map((edge) => ({
      side: edge.side,
      land: edge.land,
      water: edge.water,
    })),
    [{ side: 'north', land: { x: 0, y: 1 }, water: { x: 0, y: 0 } }],
    'D1 单格接触：水在陆格北面，1 条 north',
  );
  assert.equal(
    edges({ water: [{ x: 0, y: 0 }], land: [{ x: 1, y: 1 }] }).length,
    0,
    'D2 对角接触不算岸（四邻接，不含对角）',
  );
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

  // 独立暴力计数：每个水格的四邻里属于陆集合的个数。
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

test('J1 网格适配器与显式集合输入给出同一结果（同一 12×8 夹具）', async () => {
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
  const straight = mod.resolveShore!('straight', { depthPx: 3, token: 'water', alpha: 0.5 });
  const inset = mod.resolveShore!('inset', { depthPx: 3, token: 'water', alpha: 0.5 });
  const straightRects = mod.shoreBandRects!(edges, straight);
  const insetRects = mod.shoreBandRects!(edges, inset);

  assert.equal(straightRects.length, 1, '4 格连续直岸应合成 1 段');
  assert.equal(insetRects.length, 1);
  assert.equal(straightRects[0]!.rect.y, 1 * TILE_PX, '直岸紧贴水边（陆格北沿）');
  assert.equal(insetRects[0]!.rect.y, 1 * TILE_PX + 2, '收进从水边向陆侧退 2px');
  assert.equal(straightRects[0]!.rect.h, 3, 'depthPx 决定带宽');
});

test('J2 灯潮界必须真的配上 shore（否则组件是死代码）', () => {
  const raw = DENGCHAO_RAW as { readonly shore?: unknown };
  assert.ok(raw.shore !== undefined, '默认世界 `dengchao` 的数据里必须有 `shore`，不能只有旧设定集不配的退路');

  const shore = raw.shore as {
    readonly style?: string;
    readonly depthPx?: number;
    readonly token?: string;
    readonly alpha?: number;
  };
  assert.ok(shore.style === 'straight' || shore.style === 'inset', 'shore.style 必须是引擎预设之一');
  assert.ok(
    Number.isInteger(shore.depthPx) && (shore.depthPx as number) >= 1 && (shore.depthPx as number) <= TILE_PX,
    'shore.depthPx 必须是 1..TILE_PX 的整数',
  );
  assert.ok(
    typeof shore.token === 'string' && (WORLD as Record<string, unknown>)[shore.token] !== undefined,
    'shore.token 必须落在 24 色 token 表内',
  );
  assert.ok(
    typeof shore.alpha === 'number' && shore.alpha > 0 && shore.alpha <= 1,
    'shore.alpha 必须在 (0, 1] 内',
  );

  const loaded = loadSettingPack(DENGCHAO_RAW) as { readonly shore?: unknown };
  assert.ok(loaded.shore !== undefined, '装载后的 SettingPack 必须保留 shore，不能在校验时丢掉');
});

test('J2 数据选择决定矩形：改 style 改的是数据，不是渲染层分支', async () => {
  const mod = await shore();
  has(mod, 'resolveShore');
  has(mod, 'shoreBandRects');
  const edges = mod.waterLandEdges!(straight4());

  // 同一段岸，只换数据里的 style：矩形沿垂直岸方向差 2px。
  const a = mod.shoreBandRects!(edges, mod.resolveShore!('straight', { depthPx: 4, token: 'water', alpha: 0.5 }))[0]!;
  const b = mod.shoreBandRects!(edges, mod.resolveShore!('inset', { depthPx: 4, token: 'water', alpha: 0.5 }))[0]!;
  assert.equal(b.rect.y - a.rect.y, 2, 'style 从 straight 改成 inset，差的是数据里的 insetPx=2');
  assert.equal(a.rect.w, b.rect.w, '沿岸方向的长度不因收进而变');
});

test('J2 shore 缺席 → 不画（旧设定集路径）', async () => {
  const mod = await shore();
  has(mod, 'resolveShoreConfig');
  has(mod, 'shoreBandRects');

  assert.equal(mod.resolveShoreConfig!(undefined), null, '没有 shore 就不解析出任何数字');
  const edges = mod.waterLandEdges!(straight4());
  assert.deepEqual(mod.shoreBandRects!(edges, null), [], '数字为 null 时矩形列表必须为空');

  // 反向 M6（升格为验收 A2 的单测部分）：从灯潮界里删掉 shore，装载器照常接受，
  // 但这一份包不再产生任何岸带。
  const oldPack = loadSettingPack({ ...DENGCHAO_RAW, shore: undefined });
  assert.equal(mod.resolveShoreConfig!((oldPack as { readonly shore?: unknown }).shore), null, '删掉配置的包必须回到「不画」');
});

test('J2 装载期校验：shore 写错当场拒绝', () => {
  const badToken = {
    ...DENGCHAO_RAW,
    shore: { style: 'straight', depthPx: 3, token: 'paper', alpha: 0.5 },
  } as never;
  assert.throws(() => loadSettingPack(badToken), /shore|色板|token/i, 'shore.token 不在 24 色表内必须拒绝');

  const badDepth = {
    ...DENGCHAO_RAW,
    shore: { style: 'straight', depthPx: 0, token: 'water', alpha: 0.5 },
  } as never;
  assert.throws(() => loadSettingPack(badDepth), /shore|depthPx/i, 'depthPx 越界必须拒绝');

  const badStyle = {
    ...DENGCHAO_RAW,
    shore: { style: 'wavy', depthPx: 3, token: 'water', alpha: 0.5 },
  } as never;
  assert.throws(() => loadSettingPack(badStyle), /shore|style/i, '未知岸型必须拒绝');

  const badAlpha = {
    ...DENGCHAO_RAW,
    shore: { style: 'straight', depthPx: 3, token: 'water', alpha: 1.5 },
  } as never;
  assert.throws(() => loadSettingPack(badAlpha), /shore|alpha/i, 'alpha 越界必须拒绝');
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
  const styles = [
    { name: 'straight', numbers: { insetPx: 0, depthPx: 0, token: 'water', alpha: 0.5 } },
    { name: 'inset', numbers: { insetPx: 2, depthPx: 0, token: 'water', alpha: 0.5 } },
  ];

  for (const { name, fixture } of fixtures) {
    for (const style of styles) {
      for (const depthPx of [1, 2, 4]) {
        const numbers = { ...style.numbers, depthPx };
        const rects = mod.shoreBandRects!(mod.waterLandEdges!(fixture), numbers);
        const water = new Set(fixture.water.map(key));
        const leaked = mod.countPixelsInCells!(rects, water);
        assert.equal(leaked, 0, `${name} / ${style.name} / depth=${depthPx}：矩形像素不得落进任何水格`);
      }
    }
  }
});

test('J3 结构断言：每个矩形像素所属格都是陆格', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');

  const fixture = straight4();
  const land = new Set(fixture.land.map(key));
  const rects = mod.shoreBandRects!(mod.waterLandEdges!(fixture), NUMBERS);
  // 反向用「不在陆格」计数：它应等于 0，且与「在水格」互证。
  const cells = new Set<string>();
  for (const { rect } of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        cells.add(key({ x: Math.floor(x / TILE_PX), y: Math.floor(y / TILE_PX) }));
      }
    }
  }
  const outside = [...cells].filter((cell) => !land.has(cell));
  assert.deepEqual(outside, [], '岸带矩形必须整块落在声明的陆格内');
});

test('J3 反向 M1/M2：故意越界 1px，检查器必须报红', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  has(mod, 'countPixelsInCells');

  // M1：北岸带整体上移 1px（进入水格）。
  const north = straight4();
  const northRects = mod.shoreBandRects!(mod.waterLandEdges!(north), NUMBERS);
  const moved = northRects.map((entry) => ({ ...entry, rect: { ...entry.rect, y: entry.rect.y - 1 } }));
  assert.ok(
    mod.countPixelsInCells!(moved, new Set(north.water.map(key))) > 0,
    'M1 必须红：检查器看不见上移 1px 的话，「0 像素」就是空话',
  );

  // M2：东岸的矩形向东多画 1px（越过陆格边界进入水格）。
  const east = { water: [{ x: 1, y: 1 }], land: [{ x: 0, y: 1 }] };
  const eastRects = mod.shoreBandRects!(mod.waterLandEdges!(east), NUMBERS);
  const wider = eastRects.map((entry) => ({ ...entry, rect: { ...entry.rect, w: entry.rect.w + 1 } }));
  assert.ok(
    mod.countPixelsInCells!(wider, new Set(east.water.map(key))) > 0,
    'M2 必须红：向东越界 1px 要被抓到',
  );
});

// ---------------------------------------------------------------- J4

test('J4 直岸 k 格连续 = k × TILE_PX，断一格必须拆段', async () => {
  const mod = await shore();
  has(mod, 'waterLandEdges');
  has(mod, 'shoreBandRects');
  const edgesOf = mod.waterLandEdges!;
  const rectsOf = mod.shoreBandRects!;

  for (let k = 1; k <= 6; k += 1) {
    const rects = rectsOf(edgesOf(straightK(k)), NUMBERS);
    assert.equal(rects.length, 1, `${k} 格连续直岸应合成 1 段`);
    assert.equal(rects[0]!.lengthPx, k * TILE_PX, `${k} 格连续 = k × 16`);
    assert.equal(rects[0]!.rect.w, k * TILE_PX, `矩形长度也要是 k × 16`);
  }

  // 反向 M4：3 格 + 空 1 格 + 1 格 → 两段（3×16 与 1×16），不能读成 4 格连续。
  const gap = {
    water: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }],
    land: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 4, y: 1 }],
  };
  const segments = [...rectsOf(edgesOf(gap), NUMBERS)].sort((a, b) => a.rect.x - b.rect.x);
  assert.deepEqual(
    segments.map((entry) => entry.lengthPx),
    [3 * TILE_PX, TILE_PX],
    'M4：断一格必须拆成两段',
  );

  // 收进段只改垂直方向，沿岸长度仍是 k × 16。
  const inset = rectsOf(edgesOf(straightK(4)), { insetPx: 2, depthPx: 3, token: 'water', alpha: 0.5 })[0]!;
  assert.equal(inset.lengthPx, 4 * TILE_PX);
});

test('J4 反向 M3：越界参数在生成器里当场抛，文案点名参数', async () => {
  const mod = await shore();
  has(mod, 'resolveShore');
  has(mod, 'shoreBandRects');
  const edges = mod.waterLandEdges!(straight4());

  assert.throws(
    () => mod.shoreBandRects!(edges, { insetPx: 0, depthPx: 0, token: 'water', alpha: 0.5 }),
    /depthPx/,
    'depthPx = 0 必须抛，且点名 depthPx',
  );
  assert.throws(
    () => mod.shoreBandRects!(edges, { insetPx: -1, depthPx: 3, token: 'water', alpha: 0.5 }),
    /insetPx/,
    'insetPx = -1 必须抛，且点名 insetPx',
  );
  assert.throws(
    () => mod.shoreBandRects!(edges, { insetPx: 2, depthPx: 15, token: 'water', alpha: 0.5 }),
    /depthPx[\s\S]*insetPx|insetPx[\s\S]*depthPx/,
    'depthPx + insetPx = 17 > TILE_PX 必须抛，文案同时点名两个参数',
  );
  assert.throws(
    () => mod.resolveShore!('straight', { depthPx: 0, token: 'water', alpha: 0.5 }),
    /depthPx/,
    'resolveShore 缺省/越界也必须抛，不能按 0 带宽静悄悄画',
  );
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

  // 校准点：origin = (240+240-120, 160+160-80) = (360, 240)；
  // 格 (23,16) 左上 = 世界 (368,256) → 设备 (32,64)；一格 = 16×2×2×1 = 64 设备像素。
  assert.deepEqual(mod.cellToDeviceRect!({ x: 23, y: 16 }, view), { x: 32, y: 64, w: 64, h: 64 });
  assert.deepEqual(mod.deviceToCell!(95, 127, view), { x: 23, y: 16 }, '设备像素 (95,127) 仍在格 (23,16)');
  assert.deepEqual(mod.deviceToCell!(96, 128, view), { x: 24, y: 17 }, '半开区间：设备 (96,128) 已进入格 (24,17)');

  // DPR 与页面偏移都要乘进去，不能只乘世界→画布那一截。
  const shifted: DeviceView = { ...view, deviceScaleFactor: 2, offsetX: 1, offsetY: 1 };
  assert.deepEqual(
    mod.cellToDeviceRect!({ x: 23, y: 16 }, shifted),
    { x: 66, y: 130, w: 128, h: 128 },
    'dpr=2、offset=(1,1)：左上 = 32×2+2 / 64×2+2，格宽 = 64×2',
  );

  // 反解必须与正解互逆（取格中心，避开半开区间边界）。
  for (const cell of [{ x: 0, y: 0 }, { x: 23, y: 16 }, { x: 47, y: 31 }]) {
    const rect = mod.cellToDeviceRect!(cell, view);
    assert.deepEqual(
      mod.deviceToCell!(rect.x + rect.w / 2, rect.y + rect.h / 2, view),
      cell,
      `格 ${key(cell)} 的中心反解应回到同一格`,
    );
  }
});
