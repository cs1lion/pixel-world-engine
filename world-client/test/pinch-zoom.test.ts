import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PINCH_MIN_BASE_PX,
  PINCH_STEP_RATIO,
  beginPinchZoom,
  pinchZoomStep,
} from '../src/render/pinch-zoom.ts';

/**
 * 捏合纯逻辑：阈值与迟滞。
 *
 * 这些数不是为了「手感好看」随手挑的——每一条都对应一个会真出问题的场景：
 * 两指挨着落下会误缩放、手指在阈值附近抖会进进出出、快速张开会一次跳两档。
 */

/** 按顺序走一串间距，收集每一拍的方向。 */
function walk(distances: readonly number[], start: number): (1 | -1 | 0)[] {
  let state = beginPinchZoom(start);
  return distances.map((distance) => {
    const step = pinchZoomStep(state, distance);
    state = step.state;
    return step.direction;
  });
}

test('两指 80→200：中途不跨，翻到两倍才进一档', () => {
  // 浏览器 L1-11c 派发的正是这条路径：80 → 140 → 200。
  assert.deepEqual(walk([140, 200], 80), [0, 1]);
});

test('两指 200→80：收拢到一半才退一档，回到出发点', () => {
  assert.deepEqual(walk([140, 80], 200), [0, -1]);
});

test('迟滞：跨档后基准重置，缩回去一点点不会立刻又跨回来', () => {
  // 80 张开到 200 进一档；随后缩到 190、185 都还在新基准的迟滞窗口里。
  let state = beginPinchZoom(80);
  state = pinchZoomStep(state, 200).state;
  assert.equal(pinchZoomStep(state, 190).direction, 0);
  assert.equal(pinchZoomStep(state, 185).direction, 0);
  // 再缩到一半（100 = 200/2）才退一档。
  assert.equal(pinchZoomStep(state, 100).direction, -1);
});

test('一次移动最多跨一档，不会一帧连跳两档', () => {
  // 80 → 400 是五倍，但只输出一个 +1；下一拍从 400 重新起算。
  assert.deepEqual(walk([400], 80), [1]);
});

test('两指太近先不起算：双指点击不会顺手缩放', () => {
  let state = beginPinchZoom(10);
  assert.equal(state.baseDistance, null, '10px 不到阈值，不该记基准');
  assert.equal(pinchZoomStep(state, 20).direction, 0);
  state = pinchZoomStep(state, 20).state;
  assert.equal(state.baseDistance, null, '20px 仍不够');
  state = pinchZoomStep(state, 30).state;
  assert.equal(state.baseDistance, 30, '张开到阈值后才起算');
  assert.equal(pinchZoomStep(state, 60).direction, 1, '起算后再翻倍才进档');
});

test('两指间距为 0 不会算出 Infinity', () => {
  // 分母兜底成 1：distance 0 只是「缩到底」，不该被读成无穷大而突然放大。
  const step = pinchZoomStep({ baseDistance: 1 }, 0);
  assert.equal(step.direction, -1);
  assert.ok(Number.isFinite(step.state.baseDistance ?? 0));
});

test('阈值本身是常量，改小会让双指点击也缩放', () => {
  assert.ok(PINCH_STEP_RATIO > 1, '跨档比必须大于 1');
  assert.ok(PINCH_MIN_BASE_PX >= 16, '起始间距至少一格（16px），否则两指并拢点一下就会进档');
});
