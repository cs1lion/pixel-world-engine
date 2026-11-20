/** `src/render/art1/atlas-tiles.ts` 与 `atlas-buildings.ts` 的计划部分单测。
 *
 * 这两层里真正藏着判据的是「网格 → 格索引」与「楼体尺寸 → 四层矩形」，
 * 它们都是纯函数——图形侧（离屏 canvas 合成）由无头冒烟与截图闸门负责，
 * 这里只钉几何与查表口径，不起 Phaser。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  collectCells,
  planAtlasGround,
  planAtlasShore,
  sliceSourceHeight,
} from '../src/render/art1/atlas-tiles.ts';
import {
  atlasBuildingLayerBoxes,
  atlasRoofHeight,
  planAtlasBuildingLayers,
} from '../src/render/art1/atlas-buildings.ts';
import type { TileAtlasManifest } from '../src/render/art1/atlas-registry.ts';
import { roofHeight } from '../src/render/decal.ts';

const manifest = JSON.parse(
  readFileSync(new URL('../public/assets/art1/manifest.json', import.meta.url), 'utf8'),
) as TileAtlasManifest;

/** 手捏网格：只实现 `at(width,height,at)` 三个字段，够计划函数用。 */
const gridOf = (
  width: number,
  height: number,
  at: (x: number, y: number) => { zone: string; terrain: string } | undefined,
) => ({ width, height, at: (p: { x: number; y: number }) => at(p.x, p.y) }) as never;

test('地面计划：地形查 ground 槽，街道的石头改铺 road 槽', () => {
  const grid = gridOf(2, 1, (x) => (x === 0
    ? { zone: 'living', terrain: 'grass' }
    : { zone: 'street', terrain: 'stone' }));
  const plan = planAtlasGround(grid, manifest);
  assert.equal(plan.frameAt(0, 0), manifest.ground.grass);
  assert.equal(plan.frameAt(1, 0), manifest.road, '街道上的石头地形要铺石板路槽');
});

test('地面计划：非街道的石头仍走 ground 槽，不越界借用 road', () => {
  const grid = gridOf(1, 1, () => ({ zone: 'industry', terrain: 'stone' }));
  assert.equal(planAtlasGround(grid, manifest).frameAt(0, 0), manifest.ground.stone);
});

test('地面计划：水体槽优先于同名地面槽，清单没登记的格回 null', () => {
  const grid = gridOf(2, 1, (x) => (x === 0
    ? { zone: 'living', terrain: 'shallow' }
    : { zone: 'living', terrain: 'lava' }));
  const plan = planAtlasGround(grid, manifest);
  assert.equal(plan.frameAt(0, 0), manifest.water.shallow, '水槽要盖过 ground 槽');
  assert.equal(plan.frameAt(1, 0), null, '清单没这个地形就不接管，留给程序化底色');
});

test('地面计划：越界格不炸，回 null', () => {
  const grid = gridOf(1, 1, () => undefined);
  const plan = planAtlasGround(grid, manifest);
  assert.equal(plan.frameAt(0, 0), null);
  assert.deepEqual(collectCells(plan), [], '一格都没登记时格集合为空');
});

test('岸带计划：只给水陆边的陆格，键是陆侧地形', () => {
  // 3x1：水 | 草 | 水 → 两个水陆边，陆格都是中间那格（只算一次）。
  const grid = gridOf(3, 1, (x) => ({ zone: 'living', terrain: x === 1 ? 'grass' : 'shallow' }));
  const plan = planAtlasShore(grid, manifest);
  assert.equal(plan.frameAt(1, 0), manifest.shore.grass);
  assert.equal(plan.frameAt(0, 0), null, '水格自己不是岸');
  assert.equal(collectCells(plan).length, 1, '同一陆格的两条边只算一格');
});

test('岸带计划：陆侧地形清单里没有岸型时回 null（保留程序化岸带）', () => {
  const grid = gridOf(2, 1, (x) => ({ zone: 'living', terrain: x === 0 ? 'shallow' : 'coal' }));
  assert.equal(planAtlasShore(grid, manifest).frameAt(1, 0), null);
});

test('建筑四层：back 贴地一行、roof 在楼体上方、front 归 front 容器', () => {
  const w = 48;
  const h = 32;
  const frames = { back: 0, body: 1, front: 2, roof: 3 };
  const boxes = atlasBuildingLayerBoxes(w, h, frames);
  const byName = new Map(boxes.map((box) => [box.name, box]));
  assert.equal(byName.get('back')!.y, h - 16, 'back 是最低那一行');
  assert.equal(byName.get('back')!.target, 'back');
  assert.equal(byName.get('roof')!.y, -atlasRoofHeight(h), 'roof 骑在楼体之上');
  assert.equal(byName.get('roof')!.target, 'body', 'roof 进 body 容器（与程序化同层序）');
  assert.equal(byName.get('front')!.target, 'front', '前檐必须压在角色身上');
  // 前檐高必须与 `drawFrontLayer` 同高：差一个像素就会盖住站在门口的人。
  assert.equal(byName.get('front')!.hPx, 3);
  assert.equal(byName.get('front')!.sliceBottomPx, 3, '不压扁：取格底边 3 行像素原尺度贴');
});

test('建筑四层：屋顶高与 decal.ts 同一口径，不各写一套', () => {
  for (const h of [16, 32, 48, 96]) {
    assert.equal(atlasRoofHeight(h), roofHeight(h), `h=${h} 时两个屋顶高公式必须相等`);
  }
});

test('建筑平铺：每层格集合按自己矩形铺满，键按 instanceId + 层名唯一', () => {
  const plans = planAtlasBuildingLayers('b1', 32, 32, { back: 0, body: 1, front: 2, roof: 3 });
  assert.deepEqual(plans.map((p) => p.name), ['back', 'body', 'roof', 'front']);
  const keys = plans.map((p) => p.textureKey);
  assert.equal(new Set(keys).size, keys.length, '四层纹理键不能撞');
  assert.ok(keys.every((key) => key.startsWith('art1:building:b1:')), '键要带 instanceId');
  for (const plan of plans) {
    const cols = Math.ceil(plan.wPx / 16);
    // 切片层只铺一行；整格层按自己矩形行数铺满。
    const rows = plan.sliceBottomPx === undefined
      ? Math.max(1, Math.ceil(plan.hPx / 16))
      : 1;
    assert.equal(plan.cells.length, cols * rows, `${plan.name} 的格数要铺满自己矩形`);
    assert.ok(plan.cells.every((cell) => cell.frame >= 0 && cell.frame <= 3), '格索引来自清单四层');
  }
});

test('切片高换算：16 格图集 1:1，32 格图集逻辑 3px 是源 6px', () => {
  assert.equal(sliceSourceHeight(16, 3), 3);
  assert.equal(sliceSourceHeight(32, 3), 6);
  assert.equal(sliceSourceHeight(32, 16), 32, '16 逻辑 px 正好占满一个 32 格（整格）');
  assert.equal(sliceSourceHeight(16, 0), 1, '不许切出 0 高的源矩形');
  assert.equal(sliceSourceHeight(16, 99), 16, '也不许切过格高');
});

test('建筑平铺：不同楼的纹理键互不影响（同名楼也能同时存在）', () => {
  const frames = { back: 0, body: 1, front: 2, roof: 3 };
  const a = planAtlasBuildingLayers('a', 16, 16, frames).map((p) => p.textureKey);
  const b = planAtlasBuildingLayers('b', 16, 16, frames).map((p) => p.textureKey);
  assert.equal(a.some((key) => b.includes(key)), false);
});