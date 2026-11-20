/** `src/render/art1/lighting.ts` 的纯函数单测。
 *
 * 灯光本体在 Phaser 侧（WebGL-only，node 里跑不了），但它**吃的每一口都是
 * 纯函数**：时相+天气 → 环境光、时刻 → 呼吸强度。这两处一旦写成「随手算」，
 * 黄昏蓝调就会在钉钟页里漂、呼吸就会让截图比对连帧不同。所以这里钉的
 * 是确定性，不是观感。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COOL_DUSK_RGB,
  ambientTintFor,
  mixRgb,
  warmLightIntensity,
  type WarmLightSource,
} from '../src/render/art1/lighting.ts';

const rgb = (v: number): readonly [number, number, number] => [
  (v >> 16) & 0xff,
  (v >> 8) & 0xff,
  v & 0xff,
];

test('环境光是时相与天气的函数：黄昏偏蓝、雨夜更暗', () => {
  const noon = ambientTintFor('noon', 0, false);
  const dusk = ambientTintFor('dusk', 0, false);
  assert.ok(dusk.strength > noon.strength, '黄昏的环境要比正午强');
  assert.ok(rgb(dusk.rgb)[2] > rgb(dusk.rgb)[0], '黄昏底色偏蓝（蓝道高于红道）');

  const dry = ambientTintFor('night', 0, false);
  const wet = ambientTintFor('night', 1, true);
  assert.ok(wet.strength > dry.strength, '雨夜要比晴夜压得更暗');
  assert.notEqual(wet.rgb, dry.rgb, '雨天底色要往深蓝走');
});

test('雨不下了，环境光必须与晴天逐字节相同（不能让 intensity 单独起作用）', () => {
  // 关键反例：`raining=false` 但 `weatherIntensity=1`。
  const calm = ambientTintFor('night', 0, false);
  const ghost = ambientTintFor('night', 1, false);
  assert.deepEqual(ghost, calm, 'raining 为假时，强度读数一律不该进画面');
});

test('mixRgb：两端点与中点，且夹住越界的 t', () => {
  assert.equal(mixRgb(0x000000, 0xffffff, 0), 0x000000);
  assert.equal(mixRgb(0x000000, 0xffffff, 1), 0xffffff);
  assert.equal(mixRgb(0x000000, 0xffffff, 0.5), 0x808080, '中点取整到 0x80（不是 0x7f）');
  assert.equal(mixRgb(0x123456, 0xabcdef, 2), mixRgb(0x123456, 0xabcdef, 1), 't>1 夹成 1');
  assert.equal(mixRgb(0x123456, 0xabcdef, -3), 0x123456, 't<0 夹成 0');
  assert.equal(mixRgb(0x000000, COOL_DUSK_RGB, 0), 0);
});

test('暖光呼吸：同一时刻必得同一强度，且一个周期后回到原点', () => {
  const source: WarmLightSource = { x: 10, y: 20, radius: 40, intensity: 0.6, periodMs: 4000 };
  assert.equal(warmLightIntensity(source, 1234), warmLightIntensity(source, 1234));
  assert.equal(warmLightIntensity(source, 0), warmLightIntensity(source, 4000), '周期要整除回绕');
  assert.notEqual(warmLightIntensity(source, 1000), warmLightIntensity(source, 3000), '四分之一相位与四分之三相位不同');
});

test('暖光呼吸幅度：强度永远夹在 0..1，基准贴边也不会溢出成负数', () => {
  const high: WarmLightSource = { x: 0, y: 0, radius: 10, intensity: 0.98, periodMs: 1000, breath: 0.5 };
  const low: WarmLightSource = { x: 0, y: 0, radius: 10, intensity: 0.02, periodMs: 1000, breath: 0.5 };
  for (let t = 0; t < 1000; t += 37) {
    assert.ok(warmLightIntensity(high, t) <= 1, `高基准 ${t} 越上界`);
    assert.ok(warmLightIntensity(low, t) >= 0, `低基准 ${t} 越下界`);
  }
});

test('呼吸周期为 0 的脏数据不炸、不 NaN', () => {
  const broken = { x: 0, y: 0, radius: 1, intensity: 0.5, periodMs: 0 } as WarmLightSource;
  const value = warmLightIntensity(broken, 100);
  assert.equal(Number.isFinite(value), true);
  assert.equal(value >= 0 && value <= 1, true);
});
