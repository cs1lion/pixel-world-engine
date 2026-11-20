import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALTAR, buildWorld, checkPlacement } from '../src/world/setup.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { WORLD } from '../src/world/palette-data.ts';
import type { WorldPalette } from '../src/world/theme.ts';
import type { GridPoint, PrefabBlueprint, WorldProp } from '../src/world/types.ts';

/**
 * 摆放 overlay 的判据层单测：拒因透传、挡路对象识别、door→主干道预览、
 * 色板合规。
 *
 * 本文件在 base（origin/main 469bbc7）上还没有 `render/placement-overlay.ts`：
 * 用动态导入 + typeof 断言，让红灯红在断言上，而不是 ERR_MODULE_NOT_FOUND
 * （与 `stair-flight.test.ts` 同一套 red:first 口径）。
 *
 * 判据本身不在这里长一份：`classifyPlacement` / `findPlacementBlockers` /
 * `doorPathPreview` 全部是生产校验的**翻译层**，这里钉的是「翻译不走样」。
 */

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

const plot = blueprints.get('workshop_plot');
if (plot === undefined) throw new Error('测试依赖 workshop_plot 蓝图');

// ---------------------------------------------------------------- 模块加载

type PlacementModule = {
  classifyPlacement?: (
    check: { readonly ok: false; readonly reason: string; readonly message: string },
    streetCells: readonly GridPoint[],
  ) => string | null;
  findPlacementBlockers?: (args: {
    readonly grid: unknown;
    readonly blueprint: PrefabBlueprint;
    readonly origin: GridPoint;
    readonly buildings: readonly unknown[];
    readonly props: readonly WorldProp[];
  }) => readonly { readonly kind: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  doorPathPreview?: (grid: unknown, door: GridPoint, anchor: GridPoint) => readonly GridPoint[];
  semanticOverlayColors?: (palette: WorldPalette) => {
    readonly dim: number;
    readonly legal: number;
    readonly illegal: number;
    readonly dot: number;
  };
  PLACEMENT_LABEL_TEXT?: Record<string, string>;
};

const loadPlacementOverlay = async (): Promise<Required<PlacementModule>> => {
  let mod: Partial<PlacementModule> = {};
  try {
    mod = (await import('../src/render/placement-overlay.ts')) as Partial<PlacementModule>;
  } catch {
    mod = {};
  }
  assert.equal(
    typeof mod.classifyPlacement, 'function',
    'render/placement-overlay.ts 必须导出 classifyPlacement',
  );
  assert.equal(
    typeof mod.findPlacementBlockers, 'function',
    'render/placement-overlay.ts 必须导出 findPlacementBlockers',
  );
  assert.equal(
    typeof mod.doorPathPreview, 'function',
    'render/placement-overlay.ts 必须导出 doorPathPreview',
  );
  assert.equal(
    typeof mod.semanticOverlayColors, 'function',
    'render/placement-overlay.ts 必须导出 semanticOverlayColors',
  );
  assert.equal(
    typeof mod.PLACEMENT_LABEL_TEXT, 'object',
    'render/placement-overlay.ts 必须导出 PLACEMENT_LABEL_TEXT',
  );
  return mod as Required<PlacementModule>;
};

// ---------------------------------------------------------------- 拒因透传

test('拒因透传：生产 checkPlacement 的五种 reason 原样映射到五个浮层标签', async () => {
  const overlay = await loadPlacementOverlay();
  const fail = (reason: string) => ({ ok: false as const, reason, message: '生产那句话' });
  assert.equal(overlay.classifyPlacement(fail('edge'), []), 'edge');
  assert.equal(overlay.classifyPlacement(fail('occupied'), []), 'overlap');
  assert.equal(overlay.classifyPlacement(fail('margin'), []), 'margin');
  assert.equal(overlay.classifyPlacement(fail('doorBlocked'), []), 'overlap');
  assert.equal(overlay.classifyPlacement(fail('tide'), []), 'tide');
});

test('拒因透传：outOfZone 细分——压到 street 分区读作压路，其余读作越界', async () => {
  const overlay = await loadPlacementOverlay();
  const fail = (reason: string) => ({ ok: false as const, reason, message: '生产那句话' });
  assert.equal(overlay.classifyPlacement(fail('outOfZone'), [{ x: 1, y: 1 }]), 'road');
  assert.equal(overlay.classifyPlacement(fail('outOfZone'), []), 'edge');
});

test('拒因透传：迷雾与群落环不硬套标签，浮层原样引用生产那句话', async () => {
  const overlay = await loadPlacementOverlay();
  const fail = (reason: string) => ({ ok: false as const, reason, message: '生产那句话' });
  assert.equal(overlay.classifyPlacement(fail('fog'), []), null);
  assert.equal(overlay.classifyPlacement(fail('ring'), []), null);
});

test('浮层文案：五个标签就是任务约定的那五句中文名', async () => {
  const overlay = await loadPlacementOverlay();
  assert.deepEqual(overlay.PLACEMENT_LABEL_TEXT, {
    road: '压路',
    edge: '越界',
    overlap: '建筑重叠',
    tide: '潮位淹没',
    margin: '留白不足',
  });
});

// ---------------------------------------------------------------- 挡路对象

test('挡路对象识别：占地压住既有楼 → 描红那栋楼的整块占地（去重）', async () => {
  const overlay = await loadPlacementOverlay();
  const world = buildWorld(blueprints);
  const standing = world.buildings[0]!;
  const blockers = overlay.findPlacementBlockers({
    grid: world.grid,
    blueprint: plot,
    origin: standing.origin,
    buildings: world.buildings,
    props: [],
  });
  const buildings = blockers.filter((b) => b.kind === 'building');
  assert.equal(buildings.length, 1, '同一栋楼占多格也只描一次红');
  assert.equal(buildings[0]!.x, standing.origin.x);
  assert.equal(buildings[0]!.y, standing.origin.y);
  assert.equal(buildings[0]!.w, standing.footprint.w);
  assert.equal(buildings[0]!.h, standing.footprint.h);
});

test('挡路对象识别：树篱格与摆件格也描红，标签分别是树与摆件', async () => {
  const overlay = await loadPlacementOverlay();
  const world = buildWorld(blueprints);
  // 小世界边圈是树篱（border 树），拿一格确定的 tree 格。
  const treeCell: GridPoint = { x: 0, y: 0 };
  assert.equal(world.grid.at(treeCell)?.terrain, 'tree', '边圈格应当是树');
  const treeBlockers = overlay.findPlacementBlockers({
    grid: world.grid,
    blueprint: plot,
    origin: treeCell,
    buildings: world.buildings,
    props: [],
  });
  assert.ok(
    treeBlockers.some((b) => b.kind === 'tree' && b.x === 0 && b.y === 0),
    '树要描红',
  );

  const propCell: GridPoint = { x: 5, y: 5 };
  const fakeProp = { at: propCell } as WorldProp;
  const propBlockers = overlay.findPlacementBlockers({
    grid: world.grid,
    blueprint: plot,
    origin: propCell,
    buildings: world.buildings,
    props: [fakeProp],
  });
  assert.ok(
    propBlockers.some((b) => b.kind === 'prop' && b.x === propCell.x && b.y === propCell.y),
    '摆件要描红',
  );
});

test('挡路对象识别：留白环里的占用也算挡路（margin 拒因的现场）', async () => {
  const overlay = await loadPlacementOverlay();
  const world = buildWorld(blueprints);
  let marginCase: GridPoint | null = null;
  for (let y = 0; y < world.grid.height && marginCase === null; y += 1) {
    for (let x = 0; x < world.grid.width && marginCase === null; x += 1) {
      const result = checkPlacement(world.grid, plot, { x, y });
      if (result.ok || result.reason !== 'margin') continue;
      // 只要「环里真有占用者」的 margin 现场；贴边造成的留白不足没有东西可描红。
      const margin = plot.clearMargin;
      for (let dy = -margin; dy < plot.footprint.h + margin && marginCase === null; dy += 1) {
        for (let dx = -margin; dx < plot.footprint.w + margin && marginCase === null; dx += 1) {
          if (world.grid.at({ x: x + dx, y: y + dy })?.occupant != null) {
            marginCase = { x, y };
          }
        }
      }
    }
  }
  if (marginCase === null) {
    // 开局世界若恰好没有这种落点，这条就跳过而不是假绿——跳过要说话。
    console.log('开局世界找不到 reason=margin 的落点，本条略过');
    return;
  }
  const blockers = overlay.findPlacementBlockers({
    grid: world.grid,
    blueprint: plot,
    origin: marginCase,
    buildings: world.buildings,
    props: [],
  });
  assert.ok(
    blockers.some((b) => b.kind === 'building'),
    '留白环里的占用者必须描红',
  );
});

// ---------------------------------------------------------------- 预览连线

test('door 预览：直接复用生产 grid.path，返回什么画什么', async () => {
  const overlay = await loadPlacementOverlay();
  const world = buildWorld(blueprints);
  const standing = world.buildings[0]!;
  const route = overlay.doorPathPreview(world.grid, standing.door, ALTAR);
  assert.deepEqual(route, world.grid.path(standing.door, ALTAR), '必须是同一条路由');
});

// ---------------------------------------------------------------- 色板合规

const hueOf = (value: number): number => {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return -1;
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  const degrees = hue * 60;
  return degrees < 0 ? degrees + 360 : degrees;
};

const dengchaoPalette: WorldPalette = (() => {
  const raw: Record<string, string> = {
    ink: '#111821', soil: '#202b35', grass: '#30454a', grassLit: '#4a6152',
    stone: '#52666a', plaza: '#7d8984', farm: '#3d5154', timber: '#7c4a40',
    timberDark: '#412d32', trim: '#dfbd7a', amber: '#f0a44b', skin: '#d5b28c',
    cloak: '#48727b', cloakDark: '#293f50', ember: '#bf5441', pale: '#d1d7bd',
    plaster: '#b9b294', terracotta: '#a4483d', copper: '#53736d', water: '#294f60',
    moss: '#47645c', deepShade: '#1b303b', warmLight: '#f4d596', charcoal: '#2c3439',
  };
  const out: Record<string, number> = {};
  for (const [name, hex] of Object.entries(raw)) {
    out[name] = Number.parseInt(hex.slice(1), 16);
  }
  return out as WorldPalette;
})();

test('色板合规：四色全部来自当前 24 色板，绿框是绿、红框是红、遮罩是最深色', async () => {
  const overlay = await loadPlacementOverlay();
  for (const palette of [WORLD, dengchaoPalette]) {
    const values = Object.values(palette);
    const colors = overlay.semanticOverlayColors(palette);
    for (const color of [colors.dim, colors.legal, colors.illegal, colors.dot]) {
      assert.ok(values.includes(color), `色必须出自 24 色板，拿到 ${color}`);
    }
    assert.equal(colors.dim, palette.ink, '压暗遮罩必须是色板最深色 ink');
    assert.equal(colors.dot, palette.pale, '白点必须是色板最浅的 pale');
    assert.notEqual(colors.legal, colors.illegal, '绿框红框不能同色');
    const greenHue = hueOf(colors.legal);
    assert.ok(greenHue >= 60 && greenHue <= 180, `绿框色相要在绿家族，拿到 ${greenHue}`);
    const redHue = hueOf(colors.illegal);
    assert.ok(
      (redHue >= 0 && redHue < 60) || redHue >= 330,
      `红框色相要在红家族，拿到 ${redHue}`,
    );
  }
});
