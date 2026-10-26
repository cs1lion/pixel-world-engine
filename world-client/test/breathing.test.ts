import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid, type GridSpec } from '../src/world/grid.ts';

/**
 * 呼吸段（SPEC_V2 §4.7）：每个区域可以声明 `breathing: true`。
 *
 * 设定集手册的第 7 条——紧张段之后必须有一屏呼吸——落成一条**世界侧规则**：
 * 呼吸区里不派活、不触发随机事件、不弹提示；氛围实体（萤火、猫）照常。
 *
 * 这里测的是**网格这道接缝**：哪一格在呼吸、世界上有几处呼吸。
 * 「呼吸区里不派活」是世界的事（`simulation.ts`），不在这里重复。
 *
 * 与 §4.6 的渡有仪式同构：那边 `requirementAt` 按格问、`gatedRegions`
 * 报「有几道门」；这边 `breathingAt` 按格问、`breathingRegions` 报「有几处」。
 */

/** 一张 12×10 的地，四周一圈树篱不可走，可走区是 x∈[1,10]、y∈[1,8]。 */
function grid(regions: GridSpec['regions']): WorldGrid {
  return new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions });
}

/** 一道不呼吸的普通区域：x∈[6,7]、y∈[1,8]。 */
const PLAIN = [{ id: 'quarter', x: 6, y: 1, w: 2, h: 8 }];

test('声明了 breathing 的格子才在呼吸，没声明的一个都不呼吸', () => {
  // 莞尔镇的地域只用于展示，从来没有 breathing——它们不能因为这一版
  // 就变成留白。默认不呼吸，否则整个世界都会停下。
  const target = grid([{ id: 'shoal', x: 6, y: 1, w: 2, h: 8, breathing: true }]);
  assert.equal(target.breathingAt({ x: 6, y: 3 }), true);
  assert.equal(target.breathingAt({ x: 7, y: 3 }), true);
  assert.equal(target.breathingAt({ x: 3, y: 5 }), false, '区域外不呼吸');
  assert.equal(target.breathingAt({ x: 0, y: 0 }), false, '世界外不呼吸');
});

test('没声明 breathing 的老区域一样不呼吸', () => {
  const target = grid(PLAIN);
  assert.equal(target.breathingAt({ x: 6, y: 3 }), false);
  assert.deepEqual(target.breathingRegions(), [], '一处呼吸都没有时说的是一处都没有');
});

test('世界外与未覆盖的格子不呼吸：问不到区域就是问不到呼吸', () => {
  // `breathingAt` 问的是「这一格属于哪道区域」，答不上来就没有呼吸。
  // 返回 false 而不是抛——渲染层每帧都会问。
  const target = grid([{ id: 'shoal', x: 6, y: 1, w: 2, h: 8, breathing: true }]);
  assert.equal(target.breathingAt({ x: 99, y: 99 }), false);
});

test('breathingRegions 报得出世界上有几处呼吸', () => {
  // 与 `gatedRegions` 同一条理由：「有几处」是要说给人听的（界面、喂模型的
  // 现状）。不说，呼吸段就只是配置里的一行字，没人知道它在起作用。
  const target = grid([
    { id: 'shoal', x: 6, y: 1, w: 2, h: 8, breathing: true },
    { id: 'ferry', x: 2, y: 2, w: 2, h: 2 },
    { id: 'bank', x: 3, y: 3, w: 2, h: 2, breathing: true },
  ]);
  assert.deepEqual(target.breathingRegions(), [{ id: 'shoal' }, { id: 'bank' }]);
});

test('分数坐标落在格子外：按整数格问，问不出来就是不在呼吸', () => {
  // 角色是**滑**着走的，`pos` 几乎永远是小数。`at()` 拿坐标当下标，
  // `cells[y * width + x]` 收一个 4.048 就是 undefined。
  // 这里钉住这个行为：调用方必须先过 `cellOf`，别把小数直接递进来。
  // 少这一条，「她走过整片留白而世界一次都没看见」就再也查不出来。
  const target = grid([{ id: 'shoal', x: 6, y: 1, w: 2, h: 8, breathing: true }]);
  assert.equal(target.breathingAt({ x: 6, y: 3 }), true, '整数格照旧认得');
  assert.equal(target.breathingAt({ x: 6.4, y: 3.2 }), false, '小数递进来问不出来');
  // 四舍五入到格之后就对了——`simulation.ts` 的 `cellOf` 干的就是这件事。
  assert.equal(target.breathingAt({ x: Math.round(6.4), y: Math.round(3.2) }), true);
});

test('呼吸与凭证是两件事：一道区域可以既要凭证又呼吸', () => {
  // §4.6 与 §4.7 是独立的两个槽位。门后的呼吸区完全说得通：
  // 「进了这道门才该安静下来」。混成一个字段就会有一个表达不了。
  const target = grid([
    { id: 'bathhouse', x: 6, y: 1, w: 2, h: 8, requires: 'lamp', breathing: true },
  ]);
  assert.equal(target.requirementAt({ x: 6, y: 3 }), 'lamp');
  assert.equal(target.breathingAt({ x: 6, y: 3 }), true);
});
