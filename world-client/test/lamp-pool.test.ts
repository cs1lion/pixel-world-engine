import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lampPoolBands,
  lampPoolGain,
  lampPoolReach,
  POINT_POOL_RX,
  POINT_POOL_RY,
  wideLampPoolBands,
} from '../src/render/lamp-pool.ts';

test('潮位把半径与强度一起调：满潮比退潮大、也比退潮亮', () => {
  assert.equal(lampPoolReach(0), 0.75);
  assert.equal(lampPoolReach(1), 1);
  assert.equal(lampPoolGain(0), 0.45);
  assert.equal(lampPoolGain(1), 1);
  const low = lampPoolBands(0);
  const high = lampPoolBands(1);
  for (let i = 0; i < low.length; i += 1) {
    assert.ok(high[i]!.rx > low[i]!.rx, `第 ${i} 圈横向半径应随潮位变大`);
    assert.ok(high[i]!.ry > low[i]!.ry, `第 ${i} 圈纵向半径应随潮位变大`);
    assert.ok(high[i]!.alpha > low[i]!.alpha, `第 ${i} 圈透明度应随潮位变亮`);
  }
});

test('四圈由外到内：越往中心越小、越亮', () => {
  const bands = lampPoolBands(1);
  assert.equal(bands.length, 4);
  assert.equal(bands[0]!.rx, POINT_POOL_RX);
  assert.equal(bands[0]!.ry, POINT_POOL_RY);
  for (let i = 1; i < bands.length; i += 1) {
    assert.ok(bands[i]!.rx < bands[i - 1]!.rx);
    assert.ok(bands[i]!.ry < bands[i - 1]!.ry);
    assert.ok(bands[i]!.alpha > bands[i - 1]!.alpha);
  }
});

test('外圈 2 格：与「4 格一根」的灯柱间距相切，不叠成一团', () => {
  // 相邻灯柱相距 4 格 = 64px；两池外圈半径相加正好 64，相切不重叠。
  assert.equal(POINT_POOL_RX * 2, 64);
});

test('长条光源：横向按跨度给，潮位只改强度不改长度', () => {
  const low = wideLampPoolBands(0, 96);
  const high = wideLampPoolBands(1, 96);
  assert.equal(high[0]!.rx, 96);
  assert.equal(low[0]!.rx, 96);
  for (let i = 0; i < high.length; i += 1) {
    assert.ok(high[i]!.alpha > low[i]!.alpha, `第 ${i} 圈透明度应随潮位变亮`);
    assert.equal(high[i]!.rx, low[i]!.rx, '长度不随潮位伸缩');
  }
});

test('潮位越界按端点算，NaN 当作 0：不抛、不画出负半径', () => {
  assert.deepEqual(lampPoolBands(2), lampPoolBands(1));
  assert.deepEqual(lampPoolBands(-1), lampPoolBands(0));
  assert.deepEqual(lampPoolBands(Number.NaN), lampPoolBands(0));
  for (const band of lampPoolBands(1)) {
    assert.ok(band.rx > 0 && band.ry > 0);
    assert.ok(band.alpha >= 0 && band.alpha <= 1);
  }
});
