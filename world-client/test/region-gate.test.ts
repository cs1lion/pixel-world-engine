import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid, type GridSpec } from '../src/world/grid.ts';
import { gateSatisfied } from '../src/world/gate.ts';
import type { CarryItem } from '../src/world/types.ts';

/**
 * 渡有仪式（SPEC_V2 §4.6）：区域声明 `requires`，不满足则寻路绕开。
 *
 * 这里测的是**寻路这道接缝**：`WorldGrid.path(start, goal, accept?)`。
 * 「她带着什么」由调用方给，世界只负责「这道门她过不过去」。
 */

/** 一张 12×10 的地，四周一圈树篱不可走，可走区是 x∈[1,10]、y∈[1,8]。 */
function grid(regions: GridSpec['regions']): WorldGrid {
  return new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions });
}

/** 一道堵死的墙：x=6 从 y=1 到 y=8，把地图切成左右两半。 */
const WALL = [{ id: 'tide_gate', x: 6, y: 1, w: 1, h: 8, requires: 'lamp' as CarryItem }];

/** 同一道墙，但 y=7..8 留了缺口——没凭证的人从缺口绕。 */
const DETOURABLE = [
  { id: 'tide_gate', x: 6, y: 1, w: 1, h: 6, requires: 'lamp' as CarryItem },
];

const LEFT = { x: 3, y: 5 };
const RIGHT = { x: 9, y: 5 };

/** 她带着 `carries` 时用的寻路过滤器。 */
function acceptFor(
  target: WorldGrid,
  carries: readonly CarryItem[],
): (p: { x: number; y: number }) => boolean {
  return (p) => gateSatisfied(target.requirementAt(p), carries);
}

test('没带凭证又绕不开：如实报告到不了，不给断头路', () => {
  const target = grid(WALL);
  const path = target.path(LEFT, RIGHT, acceptFor(target, []));
  assert.equal(path.length, 0, '每一格都进不去时必须说到不了，不能给一条穿门的假路');
});

test('带了凭证就直接穿过去，不绕', () => {
  const target = grid(WALL);
  const path = target.path(LEFT, RIGHT, acceptFor(target, ['lamp']));
  assert.ok(path.length > 0, '有凭证必须过得去');
  assert.ok(
    path.some((step) => target.requirementAt(step) !== null),
    '有凭证就该走直线穿过去',
  );
});

test('凭证不对也过不去：灯过不了要鞋的门', () => {
  const target = grid([{ id: 'tide_gate', x: 6, y: 1, w: 1, h: 8, requires: 'shoes' }]);
  assert.equal(target.path(LEFT, RIGHT, acceptFor(target, ['lamp'])).length, 0);
  assert.ok(target.path(LEFT, RIGHT, acceptFor(target, ['shoes'])).length > 0);
});

test('绕得开就绕：没凭证的人走缺口，不硬闯', () => {
  const target = grid(DETOURABLE);
  const path = target.path(LEFT, RIGHT, acceptFor(target, []));
  assert.ok(path.length > 0, '有缺口就必须绕得到');
  for (const step of path) {
    assert.equal(target.requirementAt(step), null, '路线不该踏进任何要凭证的格子');
  }
  assert.ok(
    path.some((step) => step.y === 7 || step.y === 8),
    '绕行的路必须真的经过缺口',
  );
});

test('区域没要凭证时不设卡：两手空空也走得进去', () => {
  const target = grid([{ id: 'open', x: 6, y: 1, w: 1, h: 8, requires: null }]);
  const path = target.path(LEFT, RIGHT, acceptFor(target, []));
  assert.ok(path.length > 0);
  assert.ok(path.some((step) => step.x === 6), '不设卡的区域该直接穿过去');
});

test('不给 accept 时行为与从前完全一致：门不拦任何人', () => {
  const target = grid(WALL);
  const plain = target.path(LEFT, RIGHT);
  assert.ok(plain.length > 0, '旧调用点不该因为世界多了门就被改变行为');
  assert.ok(plain.some((step) => target.requirementAt(step) !== null));
});

test('设定集不声明 requires 的老区域一样不设卡', () => {
  // 莞尔镇的地域只用于展示，从来没有 requires——它们不能因为这一版就变成门。
  const target = grid([{ id: 'old_quarter', x: 6, y: 1, w: 1, h: 8 }]);
  assert.ok(target.path(LEFT, RIGHT, acceptFor(target, [])).length > 0);
  assert.equal(target.requirementAt({ x: 6, y: 3 }), null, '没声明 requires 的老区域不是门');
});

// ------------------------------------------------------------------ 纯判定

test('门要什么、她带什么：判定是一张闭集对照表', () => {
  assert.equal(gateSatisfied(null, []), true, '没要凭证就不判');
  assert.equal(gateSatisfied(null, ['lamp']), true);
  assert.equal(gateSatisfied('lamp', []), false);
  assert.equal(gateSatisfied('lamp', ['lamp']), true);
  assert.equal(gateSatisfied('lamp', ['shoes']), false, '凭证不对等于没有');
  assert.equal(gateSatisfied('shoes', ['lamp', 'shoes']), true, '带得全就都过得去');
});
