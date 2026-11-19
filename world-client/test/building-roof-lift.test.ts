import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuildingView } from '../src/render/buildings.ts';

/**
 * 旁观掀屋顶的状态机单测：悬停掀、离开合、点屋顶锁定、点空地盖回，
 * 以及「只动 roof/front 两层 alpha、depth 序一个字不改」的层纪律。
 *
 * 本文件在 base（origin/main 469bbc7）上还没有这些导出：动态导入 +
 * typeof 断言，让红灯红在断言上（与 `stair-flight.test.ts` 同一套
 * red:first 口径）。`BuildingView` 是 type-only import，运行时被抹掉，
 * base 上不会链接失败。
 */

// ---------------------------------------------------------------- 模块加载

type RoofLiftModule = {
  roofLiftNext?: (state: string, event: string) => string;
  roofLiftTargetAlpha?: (state: string) => number;
  ROOF_LIFT_ALPHA?: number;
  applyRoofLiftAlpha?: (view: BuildingView, alpha: number) => void;
  createRoofLift?: (view: BuildingView, buildingId: string) => {
    state: () => string;
    alpha: () => number;
    handle: (event: string) => void;
    update: (deltaMs: number) => void;
  };
  buildingSpansPoint?: (args: {
    readonly groundY: number;
    readonly wallH: number;
    readonly roofH: number;
    readonly y: number;
  }) => boolean;
};

const loadRoofLift = async (): Promise<Required<RoofLiftModule>> => {
  let mod: Partial<RoofLiftModule> = {};
  try {
    mod = (await import('../src/render/buildings.ts')) as Partial<RoofLiftModule>;
  } catch {
    mod = {};
  }
  assert.equal(typeof mod.roofLiftNext, 'function', 'buildings.ts 必须导出 roofLiftNext');
  assert.equal(typeof mod.roofLiftTargetAlpha, 'function', 'buildings.ts 必须导出 roofLiftTargetAlpha');
  assert.equal(typeof mod.ROOF_LIFT_ALPHA, 'number', 'buildings.ts 必须导出 ROOF_LIFT_ALPHA');
  assert.equal(typeof mod.applyRoofLiftAlpha, 'function', 'buildings.ts 必须导出 applyRoofLiftAlpha');
  assert.equal(typeof mod.createRoofLift, 'function', 'buildings.ts 必须导出 createRoofLift');
  assert.equal(typeof mod.buildingSpansPoint, 'function', 'buildings.ts 必须导出 buildingSpansPoint');
  return mod as Required<RoofLiftModule>;
};

// ---------------------------------------------------------------- 假楼层

/** 记录每个方法调用的假层：alpha 写入与 depth 写入分开记。 */
interface FakeLayer {
  readonly setAlpha: (a: number) => void;
  readonly setDepth: (d: number) => void;
  readonly alphas: number[];
  readonly depths: number[];
}

const fakeLayer = (): FakeLayer => {
  const alphas: number[] = [];
  const depths: number[] = [];
  return {
    setAlpha: (a) => alphas.push(a),
    setDepth: (d) => depths.push(d),
    alphas,
    depths,
  };
};

/** 假楼视图：只要 roof/front 会被写，其余层记下来证明它们没被碰。 */
const fakeView = (wholeBuilding = false): { readonly view: BuildingView; readonly roof: FakeLayer; readonly front: FakeLayer; readonly rest: Record<string, FakeLayer> } => {
  const layers = {
    back: fakeLayer(),
    container: fakeLayer(),
    front: fakeLayer(),
    decal: fakeLayer(),
    chimney: fakeLayer(),
    window: fakeLayer(),
    progress: fakeLayer(),
    sign: fakeLayer(),
    roof: fakeLayer(),
  };
  const view = {
    ...layers,
    roofIsWholeBuilding: wholeBuilding || undefined,
    chimneyWorld: { x: 0, y: 0 },
    baseY: 0,
  } as unknown as BuildingView;
  return { view, roof: layers.roof, front: layers.front, rest: layers as unknown as Record<string, FakeLayer> };
};

// ---------------------------------------------------------------- 状态机

test('状态切换：悬停掀开、离开合上、点屋顶锁定、点空地盖回', async () => {
  const roof = await loadRoofLift();
  const cases: readonly [string, string, string][] = [
    ['closed', 'hover', 'opening'],
    ['closed', 'leave', 'closed'],
    ['closed', 'click-roof', 'opening'],
    ['opening', 'leave', 'closing'],
    ['opening', 'click-roof', 'locked'],
    ['lifted', 'leave', 'closing'],
    ['lifted', 'click-roof', 'locked'],
    ['locked', 'leave', 'locked'],
    ['locked', 'hover', 'locked'],
    ['locked', 'click-roof', 'locked'],
    ['locked', 'click-empty', 'closing'],
    ['closing', 'hover', 'opening'],
    ['closing', 'leave', 'closing'],
    ['closing', 'click-roof', 'locked'],
  ];
  for (const [state, event, expected] of cases) {
    assert.equal(
      roof.roofLiftNext(state, event),
      expected,
      `${state} + ${event} 应当落到 ${expected}`,
    );
  }
});

test('目标 alpha：只有 closed/closing 是盖回的 1，其余一律是掀起值', async () => {
  const roof = await loadRoofLift();
  for (const state of ['opening', 'lifted', 'locked'] as const) {
    assert.equal(roof.roofLiftTargetAlpha(state), roof.ROOF_LIFT_ALPHA);
  }
  for (const state of ['closed', 'closing'] as const) {
    assert.equal(roof.roofLiftTargetAlpha(state), 1);
  }
  assert.ok(roof.ROOF_LIFT_ALPHA > 0 && roof.ROOF_LIFT_ALPHA < 1, '掀起值必须介于 0 与 1 之间');
});

// ---------------------------------------------------------------- 帧步进

test('悬停掀屋顶：逐帧逼近到掀起值，状态 opening 落定成 lifted', async () => {
  const roof = await loadRoofLift();
  const made = fakeView();
  const lift = roof.createRoofLift(made.view, 'b1');
  lift.handle('hover');
  assert.equal(lift.state(), 'opening');
  for (let i = 0; i < 120; i += 1) lift.update(16);
  assert.equal(lift.state(), 'lifted', '到点后状态要收尾成 lifted');
  assert.ok(Math.abs(lift.alpha() - roof.ROOF_LIFT_ALPHA) < 1e-9, 'alpha 要停在掀起值');
  assert.ok(made.roof.alphas.length > 0, 'roof 层 alpha 要真的被写');
  assert.ok(made.front.alphas.length > 0, 'front 层 alpha 要真的被写');
  assert.equal(made.roof.alphas.at(-1), roof.ROOF_LIFT_ALPHA);
  assert.equal(made.front.alphas.at(-1), roof.ROOF_LIFT_ALPHA);
});

test('锁定常开：离开不盖回，alpha 停在掀起值', async () => {
  const roof = await loadRoofLift();
  const made = fakeView();
  const lift = roof.createRoofLift(made.view, 'b1');
  lift.handle('hover');
  for (let i = 0; i < 120; i += 1) lift.update(16);
  lift.handle('click-roof');
  assert.equal(lift.state(), 'locked');
  lift.handle('leave');
  for (let i = 0; i < 240; i += 1) lift.update(16);
  assert.equal(lift.state(), 'locked', '锁定后离开不能盖回');
  assert.equal(lift.alpha(), roof.ROOF_LIFT_ALPHA);
});

test('点空地盖回：locked 回到 closing，alpha 逐帧回到 1，状态收尾成 closed', async () => {
  const roof = await loadRoofLift();
  const made = fakeView();
  const lift = roof.createRoofLift(made.view, 'b1');
  lift.handle('hover');
  for (let i = 0; i < 120; i += 1) lift.update(16);
  lift.handle('click-roof');
  lift.handle('click-empty');
  assert.equal(lift.state(), 'closing');
  for (let i = 0; i < 120; i += 1) lift.update(16);
  assert.equal(lift.state(), 'closed');
  assert.equal(lift.alpha(), 1);
});

test('位图素材楼不掀：屋面是整栋生图，事件全部空转，alpha 恒为 1', async () => {
  const roof = await loadRoofLift();
  const made = fakeView(true);
  const lift = roof.createRoofLift(made.view, 'art1');
  lift.handle('hover');
  for (let i = 0; i < 240; i += 1) lift.update(16);
  lift.handle('click-roof');
  lift.handle('leave');
  assert.equal(lift.state(), 'closed');
  assert.equal(lift.alpha(), 1);
  assert.deepEqual(made.roof.alphas, [], '整栋生图不许被淡出');
});

// ---------------------------------------------------------------- 层纪律

test('层纪律：掀屋顶只写 roof/front 两层 alpha，depth 一个都不碰', async () => {
  const roof = await loadRoofLift();
  const made = fakeView();
  roof.applyRoofLiftAlpha(made.view, 0.2);
  for (const layer of [made.roof, made.front]) {
    assert.deepEqual(layer.alphas, [0.2], '只改这两层的 alpha');
    assert.deepEqual(layer.depths, [], 'depth 序一个字都不改');
  }
  for (const layer of [made.rest.back, made.rest.container, made.rest.decal, made.rest.chimney, made.rest.window, made.rest.progress, made.rest.sign]) {
    assert.deepEqual(layer.alphas, [], '其余层的 alpha 不许碰');
    assert.deepEqual(layer.depths, [], '其余层的 depth 不许碰');
  }
});

// ---------------------------------------------------------------- 命中判据

test('悬停命中：点落在地面线到屋脊之间才算楼体', async () => {
  const roof = await loadRoofLift();
  const groundY = 320;
  const wallH = 64;
  const roofH = 20;
  assert.equal(roof.buildingSpansPoint({ groundY, wallH, roofH, y: groundY }), true, '地面线算楼体');
  assert.equal(roof.buildingSpansPoint({ groundY, wallH, roofH, y: groundY - wallH }), true, '墙顶算楼体');
  assert.equal(roof.buildingSpansPoint({ groundY, wallH, roofH, y: groundY - wallH - roofH }), true, '屋脊算楼体');
  assert.equal(roof.buildingSpansPoint({ groundY, wallH, roofH, y: groundY + 1 }), false, '地面线以下不算');
  assert.equal(roof.buildingSpansPoint({ groundY, wallH, roofH, y: groundY - wallH - roofH - 1 }), false, '屋脊以上不算');
});
