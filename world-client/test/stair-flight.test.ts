import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENE_ARTBOOK_ASSETS } from '../src/settings/dengchao/scene-artbook.ts';

/**
 * P2（收敛，不是新增）：把两处写死的台阶（街面 4 级、渡口 3 级）收进一个纯生成器。
 *
 * 判据不是「新台阶好看」，而是：
 * 1. `stairFlight(params)` 纯函数，输出每级矩形 + `topY/footY` 锚点，不碰 Phaser；
 * 2. 两处现有台阶都能用它逐字节复现原来的绘制；
 * 3. 数据里的 `rise` 一改，总高差跟着变（反向用例）。
 *
 * 本文件在 base（origin/main a03a1cb）上还不存在 `render/stair-flight.ts`：
 * 用动态导入 + 断言，让红灯红在断言上，而不是 ERR_MODULE_NOT_FOUND。
 */

interface StairTread {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly topY: number;
  readonly footY: number;
}

interface StairFlightResult {
  readonly treads: readonly StairTread[];
  readonly topY: number;
  readonly footY: number;
  readonly totalRise: number;
}

interface StairParams {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly treads: number;
  readonly rise: number;
  readonly run?: number;
  readonly insetSide?: 'left' | 'right';
}

type StairModule = {
  stairFlight?: (params: StairParams) => StairFlightResult;
};

const loadStairFlight = async (): Promise<(params: StairParams) => StairFlightResult> => {
  let mod: Partial<StairModule> = {};
  try {
    mod = (await import('../src/render/stair-flight.ts')) as Partial<StairModule>;
  } catch {
    mod = {};
  }
  assert.equal(typeof mod.stairFlight, 'function', 'render/stair-flight.ts 必须导出 stairFlight');
  return mod.stairFlight!;
};

const rects = (flight: StairFlightResult): number[][] =>
  flight.treads.map((tread) => [tread.x, tread.y, tread.width, tread.height]);

// ----------------------------------------------- 街面 4 级：复现原来的写死绘制

test('街面石阶（4 级 × 4px）：每级矩形与旧循环逐值相同', async () => {
  const stairFlight = await loadStairFlight();
  const flight = stairFlight({ x: 0, y: 0, width: 64, treads: 4, rise: 4 });
  assert.deepEqual(rects(flight), [
    [0, 0, 64, 4],
    [0, 4, 64, 4],
    [0, 8, 64, 4],
    [0, 12, 64, 4],
  ]);
});

test('街面石阶：每级自带上/下边线锚点，阶顶 = 上一级阶底', async () => {
  const stairFlight = await loadStairFlight();
  const flight = stairFlight({ x: 0, y: 0, width: 64, treads: 4, rise: 4 });
  assert.deepEqual(
    flight.treads.map((tread) => [tread.topY, tread.footY]),
    [[0, 4], [4, 8], [8, 12], [12, 16]],
  );
});

// ------------------------------------------- 渡口 3 级：右沿不动，逐级向左收

test('渡口踏步（3 级，右沿固定）：每级矩形与旧循环逐值相同', async () => {
  const stairFlight = await loadStairFlight();
  // drawQuay 的旧写法：x = x + w - 20 + step*3、宽 = 20 - step*3、y = y + 2 + step*4。
  const flight = stairFlight({
    x: 60,
    y: 2,
    width: 20,
    treads: 3,
    rise: 4,
    run: 3,
    insetSide: 'left',
  });
  assert.deepEqual(rects(flight), [
    [60, 2, 20, 4],
    [63, 6, 17, 4],
    [66, 10, 14, 4],
  ]);
  for (const tread of flight.treads) {
    assert.equal(tread.x + tread.width, 80, '每一级的右沿都钉在堤头');
  }
});

// ----------------------------------------------------- 航段整体锚点（现在就进类型）

test('航段整体锚点：topY/footY = 首级阶顶 / 末级阶底，总高差 = 级数 × 每级高', async () => {
  const stairFlight = await loadStairFlight();
  for (const params of [
    { x: 10, y: 20, width: 64, treads: 4, rise: 4 },
    { x: 60, y: 2, width: 20, treads: 3, rise: 4, run: 3, insetSide: 'left' as const },
  ]) {
    const flight = stairFlight(params);
    assert.equal(flight.topY, params.y);
    assert.equal(flight.footY, params.y + params.treads * params.rise);
    assert.equal(flight.totalRise, params.treads * params.rise);
    assert.equal(flight.footY - flight.topY, flight.totalRise, 'footY 与 topY 之差必须就是总高差');
  }
});

// ------------------------------------------------- 与真实数据对齐（反向用例的挂点）

const placementOf = (id: string) => {
  const asset = SCENE_ARTBOOK_ASSETS.find((item) => item.id === id);
  assert.ok(asset?.placement, `${id} 必须有 placement`);
  return asset!.placement!;
};

test('数据显式写出级数与每级高：街面 4×4 = 16px，渡口 3×4 = 12px', () => {
  const street = placementOf('street_steps');
  const quay = placementOf('ferry_quay');
  assert.equal(street.treads, 4, 'street_steps 必须显式写 treads = 4');
  assert.equal(street.rise, 4, 'street_steps 必须显式写 rise = 4');
  assert.equal(quay.treads, 3, 'ferry_quay 必须显式写 treads = 3');
  assert.equal(quay.rise, 4, 'ferry_quay 必须显式写 rise = 4');
});

test('数据 → 生成器：两处的总高差分别是 16px 与 12px（rise 改一档这里必须红）', async () => {
  const stairFlight = await loadStairFlight();
  const street = placementOf('street_steps');
  const quay = placementOf('ferry_quay');
  const streetFlight = stairFlight({
    x: street.at.x,
    y: street.at.y,
    width: (street.length ?? 0) * 16,
    treads: street.treads ?? 0,
    rise: street.rise ?? 0,
  });
  const quayFlight = stairFlight({
    x: quay.at.x,
    y: quay.at.y,
    width: (quay.length ?? 0) * 16 - 20,
    treads: quay.treads ?? 0,
    rise: quay.rise ?? 0,
    run: 3,
    insetSide: 'left',
  });
  assert.equal(streetFlight.totalRise, 16);
  assert.equal(quayFlight.totalRise, 12);
});

// ----------------------------------------------------------------- 纯函数约束

test('生成器不 import Phaser：TypeScript 的 Phaser 依赖不许漏进来', () => {
  const source = readFileSync(new URL('../src/render/stair-flight.ts', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"]phaser['"]/.test(source), 'render/stair-flight.ts 必须不碰 Phaser');
});

test('非法参数当场拒绝（不是画出负宽度的台阶）', async () => {
  const stairFlight = await loadStairFlight();
  assert.throws(() => stairFlight({ x: 0, y: 0, width: 64, treads: 0, rise: 4 }), 'treads 必须 ≥ 1');
  assert.throws(() => stairFlight({ x: 0, y: 0, width: 64, treads: 4, rise: 0 }), 'rise 必须 ≥ 1');
  assert.throws(
    () => stairFlight({ x: 0, y: 0, width: 9, treads: 4, rise: 4, run: 3, insetSide: 'left' }),
    '收分到宽度 ≤ 0 必须拒绝',
  );
});
