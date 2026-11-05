import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BANNER_MOTION_OFF,
  BANNER_MOTION_ON,
  bannerShadowAt,
  bannerPhaseSpan,
  bannerSwayAt,
} from '../src/world/banner-motion.ts';

const MIN = 60_000;

test('布身摆动：横移只有 -1/0/1，且会动', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 24; i += 1) {
    const { dx } = bannerSwayAt(i * 3000, 0);
    assert.ok(dx >= -1 && dx <= 1, `dx 超出 1px：${dx}`);
    seen.add(dx);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [-1, 0, 1], '三个档位都要出现');
});

test('三面幌布错开相位：同一时刻不全是同一个摆幅', () => {
  const standings = [0, 1, 2].map((order) => bannerSwayAt(18 * 60 * MIN + 10_000, order).dx);
  assert.ok(new Set(standings).size > 1, `三面幌布全同相：${standings.join(',')}`);
});

test('投影：正午短、黄昏长、夜里几乎无', () => {
  assert.equal(bannerPhaseSpan('noon'), 1);
  assert.equal(bannerPhaseSpan('dusk'), 5);
  assert.equal(bannerPhaseSpan('night'), 0);
  assert.ok(bannerPhaseSpan('dusk') > bannerPhaseSpan('noon'));
});

test('投影跟着布身走：影子的横移不落后于布', () => {
  for (let i = 0; i < 12; i += 1) {
    const sway = bannerSwayAt(i * 3000, 1);
    const shadow = bannerShadowAt(i * 3000, 1, 'dusk');
    assert.equal(shadow.span, 5);
    assert.ok(shadow.alpha > 0);
    if (sway.dx !== 0) {
      assert.ok(Math.abs(shadow.dx) > Math.abs(sway.dx), '布一动，影子要先动');
      assert.equal(Math.sign(shadow.dx), Math.sign(sway.dx));
    }
  }
});

test('夜里不给影子：span 与 alpha 都是 0（南侧幌布的落影会落进夜街扫描带）', () => {
  const shadow = bannerShadowAt(18 * 60 * MIN + 10_000, 0, 'night');
  assert.equal(shadow.span, 0);
  assert.equal(shadow.alpha, 0);
});

test('同一世界时刻必然同一帧；开关常量是"全开 / 全关"', () => {
  const a = bannerSwayAt(18 * 60 * MIN + 20_000, 2);
  const b = bannerSwayAt(18 * 60 * MIN + 20_000, 2);
  assert.deepEqual(a, b);
  assert.deepEqual(BANNER_MOTION_ON, { sway: true, shadow: true });
  assert.deepEqual(BANNER_MOTION_OFF, { sway: false, shadow: false });
});
