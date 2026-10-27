/**
 * 「每格几块板岩」——那个数原来只写在注释里，而它写错了（「3–4 块」）。
 *
 * 数出来三份布局整整齐齐都是 4 块。这类「每格几块」的话没有机器会响，写错了
 * 就一直在纸上错着，下一个照着它推理面积或缝宽的人会被带偏。所以这里按源码里的
 * 布局数组数一遍：`drawFlagstones` 引 Phaser（值级不用，类型用），但 `layouts`
 * 是个纯字面量，`codeOf` 剥掉注释后就能数。
 *
 * 钉的是三件：
 *   1. 三份布局，每份 4 块——「3–4 块」是假的，恒为 4；
 *   2. 每块都不出 16×16 那一格（`TILE_PX`）——不然会画到邻格去；
 *   3. 三份布局**不重复**——重复了就等于只有两种花样，`h % 3` 少一档。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeOf } from './source-scan.ts';

const source = codeOf(new URL('../src/render/tilemap.ts', import.meta.url));

const TILE_PX = 16;

/** 从 `drawFlagstones` 里把 `layouts` 那份字面量抠出来。 */
function layoutsOf(): readonly (readonly number[])[] {
  const start = source.indexOf('const layouts');
  assert.ok(start >= 0, 'tilemap.ts 里找不到 layouts——数组改名了，这个文件要重写');
  const open = source.indexOf('[', start);
  // 布局数组在 `const h = hash2(x, y);` 之前结束；从那里截，避免吃到后面的代码。
  const end = source.indexOf('const h = hash2', start);
  assert.ok(open >= 0 && end > open, 'layouts 的位置对不上');
  const body = source.slice(open, end);
  const rects = [...body.matchAll(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g)];
  assert.ok(rects.length > 0, 'layouts 里一个矩形都没数到');
  return rects.map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
}

const layouts = layoutsOf();

test('每格恒为 4 块板岩：不是「3–4 块」', () => {
  // 三份布局，每份 4 块，所以总数是 12。说「3–4 块」的那位大概只数了其中两份。
  assert.equal(layouts.length, 12, `三份布局该一共 12 个矩形，实得 ${layouts.length}`);
  for (let i = 0; i < layouts.length; i += 4) {
    const one = layouts.slice(i, i + 4);
    assert.equal(one.length, 4, `第 ${i / 4 + 1} 份布局该是 4 块，实得 ${one.length} 块`);
  }
});

test('每一块都待在自个那一格里：不出 16×16', () => {
  for (const [index, rect] of layouts.entries()) {
    const [x, y, w, h] = rect as [number, number, number, number];
    assert.ok(w > 0 && h > 0, `第 ${index} 块的尺寸是 ${w}×${h}，得是正的`);
    assert.ok(x >= 0 && y >= 0, `第 ${index} 块从 (${x},${y}) 起，越出了格子左上角`);
    assert.ok(x + w <= TILE_PX, `第 ${index} 块右边到 ${x + w}，出了 ${TILE_PX}`);
    assert.ok(y + h <= TILE_PX, `第 ${index} 块下边到 ${y + h}，出了 ${TILE_PX}`);
  }
});

test('三份布局互不相同：不然 hash 只挑得出两种花样', () => {
  // 按**份**比，不是按块比：12 块本来就两两不同，按块比永远得 12，那条会空转。
  const seen = new Set<string>();
  for (let i = 0; i < layouts.length; i += 4) {
    seen.add(layouts.slice(i, i + 4).map((rect) => rect.join(',')).join('|'));
  }
  assert.equal(seen.size, 3, `三份布局该是三个样子，实得 ${seen.size} 个`);
});
