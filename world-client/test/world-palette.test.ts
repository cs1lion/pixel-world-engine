/** 渲染色板的间接层：按当前世界解析，默认世界有回落。
 *
 * 为什么值得单独锁：`paletteFor()` 一旦退化成「直接读 WORLD」或忘记回落，
 * 换世界时画面上会同时出现两套 24 色，而任何一条单世界截图都看不出来——
 * 只有把「激活 → 解析」这条链单独测一遍才会红。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD, TERRAIN_COLORS } from '../src/world/palette-data.ts';
import {
  activateWorld, activeWorld, paletteFor, registerWorldPalette, terrainFor,
} from '../src/world/theme.ts';

const FAKE = 'test-world';
const fakePalette = Object.fromEntries(
  Object.entries(WORLD).map(([token, value]) => [token, value ^ 0x020202]),
) as typeof WORLD;
const fakeTerrain = Object.fromEntries(
  Object.entries(TERRAIN_COLORS).map(([terrain, value]) => [terrain, value ^ 0x010101]),
) as typeof TERRAIN_COLORS;

test('默认世界：paletteFor()/terrainFor() 直接就是 WORLD/TERRAIN_COLORS', () => {
  assert.equal(activeWorld(), 'default');
  assert.equal(paletteFor(), WORLD, '省略参数 = 当前世界；默认世界必须是同一份对象');
  assert.equal(terrainFor(), TERRAIN_COLORS);
});

test('登记并激活另一套后按世界解析；默认世界仍可指名取到', () => {
  registerWorldPalette(FAKE, fakePalette, fakeTerrain);
  activateWorld(FAKE);
  assert.equal(activeWorld(), FAKE);
  assert.equal(paletteFor(), fakePalette, '当前世界应当换到新登记的那套');
  assert.notEqual(paletteFor().plaza, WORLD.plaza, '假色板必须真的不同，否则测不出切换');
  assert.equal(paletteFor('default'), WORLD, '指名 default 不受当前世界影响');
  assert.equal(terrainFor(FAKE), fakeTerrain);
  activateWorld('default');
});

test('没登记的 id 回落默认世界，不画 undefined 色', () => {
  assert.equal(paletteFor('nope'), WORLD);
  assert.equal(terrainFor('nope'), TERRAIN_COLORS);
});

test('激活没登记的世界当场抛错（装载期错误，不静默）', () => {
  assert.throws(() => activateWorld('nope'), /没有登记这个世界的调色板/);
  assert.equal(activeWorld(), 'default', '抛错不应改动当前世界');
});
