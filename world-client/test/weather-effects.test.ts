import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOG_VISIT_CELLS,
  RAIN_WALK_FACTOR,
  fogKeepsClose,
  stallsPackedFor,
  walkSpeedFactor,
} from '../src/world/weather-effects.ts';

/**
 * 天气的**行为**后果，不是换滤镜。
 *
 * 三档各有一条可数的行为：雨里快走（`RAIN_WALK_FACTOR`）、雨天收摊
 * （`stallsPackedFor`）、雾天只走近路（`FOG_VISIT_CELLS`）。
 * 这三条都是纯函数，世界只调用它们，渲染只读同一组常量。
 */

test('雨里快走：雨/暴雨 1.5 倍，晴与雾正常步速', () => {
  assert.equal(walkSpeedFactor('clear'), 1);
  assert.equal(walkSpeedFactor('rain'), RAIN_WALK_FACTOR);
  assert.equal(walkSpeedFactor('storm'), RAIN_WALK_FACTOR);
  assert.equal(walkSpeedFactor('fog'), 1);
});

test('雨天收摊，雾天不收', () => {
  assert.equal(stallsPackedFor('clear'), false);
  assert.equal(stallsPackedFor('rain'), true);
  assert.equal(stallsPackedFor('storm'), true);
  assert.equal(stallsPackedFor('fog'), false);
});

test('雾天只走 8 格以内，晴雨的远路照走', () => {
  const here = { x: 20, y: 20 };
  assert.equal(fogKeepsClose('fog', here, { x: 20 + FOG_VISIT_CELLS, y: 20 }), true);
  assert.equal(fogKeepsClose('fog', here, { x: 20 + FOG_VISIT_CELLS + 1, y: 20 }), false);
  assert.equal(fogKeepsClose('clear', here, { x: 0, y: 0 }), true);
  assert.equal(fogKeepsClose('rain', here, { x: 0, y: 0 }), true);
});
