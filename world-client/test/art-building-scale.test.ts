/** 位图建筑显示缩放的边界（art-assets.ts::artBuildingScale）。
 *
 * 起因：`fit_to_footprint` 只按宽度缩放，矮胖图贴在地上像贴纸；
 * 高图（`wave_house`）又把屋顶画进上方留白。这里钉住兜底与上限。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// art-assets.ts 在 base 上不存在：动态 import + typeof 断言，让 base 上红在断言（B7）。
const mod = (await import('../src/render/art-assets.ts')) as unknown as {
  artBuildingScale?: (textureH: number, bodyH: number, artScale: number) => number;
};
assert.equal(typeof mod.artBuildingScale, 'function', 'artBuildingScale 必须存在');
const artBuildingScale = mod.artBuildingScale!;
const artEnabledOf = (mod as unknown as {
  artEnabledOf?: (search: string | URLSearchParams) => boolean;
}).artEnabledOf;

const S = 2; // artScale

test('正常高度的图保持 1/artScale，不放大也不缩小', () => {
  // 楼体 64px、图 100 纹理px -> 50 逻辑px，介于 0.8*64=51.2 之下？不，50 < 51.2，会被兜底。
  // 换个真正居中的：图 120 纹理px -> 60 逻辑px，在 [51.2, 64+22+32=118] 内。
  const scale = artBuildingScale(120, 64, S);
  assert.equal(scale, 0.5);
});

test('矮图放大到至少楼体高的 80%，不再贴纸', () => {
  // waiting_shelter 实测 40 逻辑px（80 纹理px），楼体 48px -> floorH = 38.4
  // 40 >= 38.4，其实已达标；用更矮的图验证兜底。
  const scale = artBuildingScale(60, 48, S); // 30 逻辑px < 38.4
  assert.ok(scale > 0.5, '应比基准放大');
  assert.ok(Math.abs(60 * scale - 48 * 0.8) < 1e-9, '恰好放大到 80% 楼体高');
});

test('高图被压到屋顶+留白上限内，不越界', () => {
  // wave_house 实测 327 纹理px -> 163.5 逻辑px，楼体 96、屋顶 33、留白 32 -> maxH=161
  const scale = artBuildingScale(327, 96, S);
  const maxH = 96 + Math.max(10, Math.round(96 * 0.34)) + 32;
  assert.ok(327 * scale <= maxH + 1e-9, `显示高 ${327 * scale} 必须 ≤ ${maxH}`);
  assert.ok(scale <= 0.5, '只能缩小，不能放大越过上限');
});

test('放大不会越过 maxH（矮楼 + 极矮但极宽比例的图）', () => {
  const scale = artBuildingScale(20, 48, S);
  const maxH = 48 + Math.max(10, Math.round(48 * 0.34)) + 32;
  assert.ok(20 * scale <= maxH + 1e-9);
  assert.ok(scale > 0);
});

test('artScale=1 时基准缩放就是 1', () => {
  assert.equal(artBuildingScale(100, 64, 1), 1);
});

test('开关默认开：不写 art 参数就装图，`?art=0` 才关', () => {
  assert.equal(typeof artEnabledOf, 'function', 'artEnabledOf 必须存在');
  const on = artEnabledOf!;
  assert.equal(on(''), true, '空查询串时必须默认装图');
  assert.equal(on('?world=dengchao&time=noon&feed=off'), true, '日常那串参数不该把关掉');
  assert.equal(on('?art=1'), true);
  assert.equal(on('?art=0'), false, 'art=0 是唯一的关法');
  // 认不得的值按默认（开）：写错一个字不该让画面悄悄退回程序化。
  assert.equal(on('?art=true'), true);
  assert.equal(on(new URLSearchParams('art=0')), false, '也认 URLSearchParams');
});
