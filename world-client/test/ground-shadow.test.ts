import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUND_SHADOW_DEPTH,
  GROUND_SHADOW_MOTION_OFF,
  GROUND_SHADOW_MOTION_ON,
  groundShadowAt,
  groundShadowSpan,
} from '../src/world/ground-shadow.ts';
import { LAMP_POOL_DEPTH, TIDE_DEPTH } from '../src/render/layer-depth.ts';

test('落地投影的 depth 严格夹在潮水与光池之间，远低于人物与摊位', () => {
  // 潮水 / 光池 / 人 ≥ 1000。影子必须比水高、比光低，才不与光池打架。
  // 这里直接引用两边的命名常量，不抄 3 / 3.2 字面量：
  // 若以后有人调光池或潮水深度，这条会先红，不会等到截图里影子被盖掉才发现。
  assert.ok(GROUND_SHADOW_DEPTH > TIDE_DEPTH, `投影 ${GROUND_SHADOW_DEPTH} 必须 > 潮水 ${TIDE_DEPTH}`);
  assert.ok(GROUND_SHADOW_DEPTH < LAMP_POOL_DEPTH, `投影 ${GROUND_SHADOW_DEPTH} 必须 < 光池 ${LAMP_POOL_DEPTH}`);
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
