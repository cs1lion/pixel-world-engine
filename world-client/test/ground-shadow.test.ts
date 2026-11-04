import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUND_SHADOW_DEPTH,
  GROUND_SHADOW_MOTION_OFF,
  GROUND_SHADOW_MOTION_ON,
  groundShadowAt,
  groundShadowSpan,
} from '../src/world/ground-shadow.ts';

test('落地投影的 depth 落在潮水与光池之间，远低于人物与摊位', () => {
  // 潮水 3 / 光池 3.2 / 人 ≥ 1000。影子必须比水高、比光低，才不与光池打架。
  assert.ok(GROUND_SHADOW_DEPTH > 3);
  assert.ok(GROUND_SHADOW_DEPTH < 3.2);
});

test('相位影长：正午最短、黄昏最长、夜里不做', () => {
  const noon = groundShadowSpan('noon');
  const dawn = groundShadowSpan('dawn');
  const dusk = groundShadowSpan('dusk');
  const night = groundShadowSpan('night');
  assert.equal(night, 0, '夜里不画');
  assert.ok(noon < dawn, '正午比清晨短');
  assert.ok(dawn < dusk, '黄昏最长');
});

test('形状是整数像素，且夜里 alpha 为 0（不落暗像素）', () => {
  for (const phase of ['dawn', 'noon', 'dusk', 'night'] as const) {
    const shape = groundShadowAt(phase);
    assert.ok(Number.isInteger(shape.dx), `${phase} dx 必须是整数`);
    assert.ok(Number.isInteger(shape.span), `${phase} span 必须是整数`);
    assert.ok(shape.span >= 0);
    assert.ok(shape.alpha >= 0 && shape.alpha <= 1);
  }
  assert.equal(groundShadowAt('night').alpha, 0);
});

test('同一相位两次调用返回同一形状（不读墙钟、不存上一帧）', () => {
  const a = groundShadowAt('dusk');
  const b = groundShadowAt('dusk');
  assert.deepEqual(a, b);
});

test('开关只有 on 一个字段：关掉即整层不画', () => {
  assert.equal(GROUND_SHADOW_MOTION_ON.on, true);
  assert.equal(GROUND_SHADOW_MOTION_OFF.on, false);
});
