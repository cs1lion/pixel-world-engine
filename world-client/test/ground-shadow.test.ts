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

// ---------------------------------------------------------------- 动态模块
//
// `shadowSegments` 是这次合入才有的导出。静态 import 在 base 上会
// `SyntaxError: does not provide an export named`，被 `red:first` 归成
// compile（exit 2）；改成动态 import + 显式断言后，base 上红在断言上。

interface ShadowSegmentView {
  readonly x: number;
  readonly width: number;
  readonly alpha: number;
}

interface GroundShadowModule {
  readonly shadowSegments?: (x0: number, span: number, alpha: number, dir: number) => readonly ShadowSegmentView[];
}

const GROUND_SHADOW_MODULE_PATH = '../src/world/ground-shadow.ts';

async function shadowSegmentsOf(): Promise<NonNullable<GroundShadowModule['shadowSegments']>> {
  let mod: GroundShadowModule = {};
  try {
    mod = (await import(GROUND_SHADOW_MODULE_PATH)) as GroundShadowModule;
  } catch {
    // 模块整体不存在时也按「缺导出」处理：红在断言上，不红在解析上。
  }
  assert.equal(typeof mod.shadowSegments, 'function', 'world/ground-shadow.ts 必须导出 shadowSegments');
  return mod.shadowSegments!;
}

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

test('阶梯切成 1–3 段整数像素，连续且总长等于 span', async () => {
  const shadowSegments = await shadowSegmentsOf();
  for (const span of [1, 2, 3, 4, 5, 7, 27]) {
    const segments = shadowSegments(100, span, groundShadowAt('dusk').alpha, -1);
    assert.equal(segments.length, span <= 2 ? 1 : span <= 4 ? 2 : 3, `${span}px 的段数`);
    assert.equal(segments[0].x, 100);
    assert.equal(segments.at(-1)!.x + segments.at(-1)!.width, 100 + span, `${span}px 总长`);
    for (const [index, segment] of segments.entries()) {
      assert.ok(Number.isInteger(segment.x), '段起点必须是整数');
      assert.ok(Number.isInteger(segment.width) && segment.width >= 1, '段宽必须是正整数');
      if (index > 0) {
        const previous = segments[index - 1];
        assert.equal(segment.x, previous.x + previous.width, '段与段必须首尾相接');
      }
    }
  }
});

test('内段永远贴着物体：朝右内段在左端、朝左内段在右端，α 逐级递减', async () => {
  const shadowSegments = await shadowSegmentsOf();
  const alpha = groundShadowAt('dusk').alpha;
  const right = shadowSegments(100, 7, alpha, 1);
  assert.ok(right[0].alpha > right[1].alpha && right[1].alpha > right[2].alpha);
  const left = shadowSegments(100, 7, alpha, -1);
  assert.ok(left[2].alpha > left[1].alpha && left[1].alpha > left[0].alpha, '黄昏朝左：右端最深');
  assert.equal(left[2].alpha, alpha, '内段用满 α');
  assert.equal(right[0].alpha, alpha, '内段用满 α');
});

test('α 层数 ≤ 4：三段阶梯最多 3 个 α，内芯 1px 再叠一档', async () => {
  const shadowSegments = await shadowSegmentsOf();
  for (const span of [1, 2, 3, 4, 5, 7, 27]) {
    const segments = shadowSegments(0, span, 0.26, -1);
    const alphas = new Set(segments.map((segment) => segment.alpha));
    // 绘制端只在内段再叠一条 ink 内芯 → 总 α 层 = 阶梯数 + 1。
    assert.ok(alphas.size + 1 <= 4, `${span}px 的 α 层 ${alphas.size} + 内芯 超过 4`);
  }
});

test('夜里 / 零长度直接返回空段，不落暗像素', async () => {
  const shadowSegments = await shadowSegmentsOf();
  assert.deepEqual(shadowSegments(0, groundShadowAt('night').span, 0, -1), []);
  assert.deepEqual(shadowSegments(0, 7, 0, -1), []);
});
