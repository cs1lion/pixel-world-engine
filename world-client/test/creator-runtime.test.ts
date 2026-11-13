/**
 * 造物主内环的毫秒级内核单测。
 *
 * 为什么要这一层：16 条 EDD 用例全走浏览器，一次要几分钟，而「螺旋选址多绕了一圈」
 * 这种错误在浏览器里表现为一条含糊的 FAIL。这里把四个不变量钉在纯函数上——
 * 无 Phaser、无 DOM、无存档文件，几百毫秒跑完。
 *
 * **加载方式是为 red-first 刻意设计的**：Phase 1 只交评测面，Phase 2 才交实现。
 * `red-first` 把 `test/` 的 diff 套到 Phase 1 的 base 上，那时 `src/world/creator/`
 * 里还没有这几个模块。若用静态 import，测试会以 `ERR_MODULE_NOT_FOUND` 崩掉，
 * 脚本判 ERROR（不可采信）；所以这里动态取，缺了就**红在断言上**。
 *
 * 但只吞「文件不在」：模块本身写坏、语法错、依赖缺失一律原样抛出去。
 * 把「模块坏了」也吞成「没实现」是最容易骗过先红后绿的一种写法。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

type Point = { readonly x: number; readonly y: number };
type Footprint = { readonly w: number; readonly h: number };
type Bounds = { readonly width: number; readonly height: number };

interface SlotQuery {
  readonly footprint: Footprint;
  readonly margin: number;
  readonly anchor: Point;
  readonly bounds: Bounds;
  readonly blocked: (point: Point) => boolean;
  readonly inRegion?: (point: Point) => boolean;
  readonly accept?: (origin: Point) => boolean;
}

interface RoadQuery {
  readonly door: Point;
  readonly network: readonly Point[];
  readonly bounds: Bounds;
  readonly walkable: (point: Point) => boolean;
}

type Module = Record<string, unknown>;

async function load(relativePath: string): Promise<Module> {
  try {
    return (await import(relativePath)) as Module;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') return {};
    throw error;
  }
}

const MISSING = '实现还没有落地——这正是 red-first 要在 base 上看到的红灯';

test('1. 确定性螺旋选址：避开障碍、满足留白、两次调用逐字相同', async () => {
  const spatial = await load('../src/world/creator/spatial-executor.ts');
  const find = spatial['findDeterministicSlot'] as
    | ((query: SlotQuery) => Point | null)
    | undefined;
  const fits = spatial['fitsAt'] as ((origin: Point, query: SlotQuery) => boolean) | undefined;
  assert.equal(typeof find, 'function', MISSING);
  assert.equal(typeof fits, 'function', MISSING);

  const blocked = new Set(['5,5', '5,6', '6,5', '6,6']);
  const query: SlotQuery = {
    footprint: { w: 2, h: 2 },
    margin: 1,
    anchor: { x: 5, y: 5 },
    bounds: { width: 12, height: 12 },
    blocked: (point) => blocked.has(`${point.x},${point.y}`),
  };

  const first = find!(query);
  const second = find!(query);
  assert.ok(first !== null, '图里有空地，选址器不该返回 null');
  assert.deepEqual(first, second, '同输入两次选址必须逐字相同');
  assert.equal(fits!(first, query), true, '选出来的点必须真的满足占地 + 留白');
  assert.equal(blocked.has(`${first.x},${first.y}`), false, '不能落在障碍格上');
});

test('2. 门口四方向 BFS：绕开障碍，路径不穿障碍且比直线长', async () => {
  const spatial = await load('../src/world/creator/spatial-executor.ts');
  const plan = spatial['planRoadToMainNetwork'] as
    | ((query: RoadQuery) => readonly Point[] | null)
    | undefined;
  assert.equal(typeof plan, 'function', MISSING);

  const obstacle = { x: 2, y: 1 };
  const path = plan!({
    door: { x: 1, y: 1 },
    network: [{ x: 5, y: 1 }],
    bounds: { width: 10, height: 10 },
    walkable: (point) => point.x !== obstacle.x || point.y !== obstacle.y,
  });

  assert.ok(path !== null, '有绕行路线时不该返回 null');
  assert.deepEqual(path![0], { x: 1, y: 1 }, '路径要从门口起步');
  assert.deepEqual(path![path!.length - 1], { x: 5, y: 1 }, '路径要连到主干道');
  assert.equal(
    path!.some((point) => point.x === obstacle.x && point.y === obstacle.y),
    false,
    '铺出的路穿过了障碍格',
  );
  assert.ok(path!.length > 5, `直线是 5 格，绕行却是 ${path!.length} 格——没绕`);
});

test('3. 施工生命周期：三拍完工，中途存档往返后精确续跑', async () => {
  const audit = await load('../src/world/creator/audit-state.ts');
  const empty = audit['emptyAuditState'] as
    | ((seed: number, worldNow: number) => Module)
    | undefined;
  const enqueue = audit['enqueueBuildingConstruction'] as
    | ((state: Module, params: Module) => Module)
    | undefined;
  const tick = audit['tickBuildingConstruction'] as
    | ((state: Module) => readonly Module[])
    | undefined;
  assert.equal(typeof empty, 'function', MISSING);
  assert.equal(typeof enqueue, 'function', MISSING);
  assert.equal(typeof tick, 'function', MISSING);

  const state = empty!(42, 0) as unknown as {
    buildings: Array<{ stage: string; constructionTicksRemaining: number }>;
    chronicle: Array<{ kind: string }>;
    nowTick: number;
    roads: string[];
  };
  const building = enqueue!(state as unknown as Module, {
    instanceId: 'b-1',
    prefabId: 'smithy_lv1',
    origin: { x: 3, y: 4 },
    footprint: { w: 2, h: 2 },
    margin: 1,
    door: { x: 3, y: 6 },
    constructionTicks: 3,
    pavedRoadTiles: [{ x: 3, y: 7 }],
    doorConnected: true,
  }) as unknown as { stage: string; constructionTicksRemaining: number };

  assert.equal(building.stage, 'scaffolding', '入账即脚手架态');
  assert.equal(state.roads.length, 1, '铺出的路要真进账本');

  tick!(state as unknown as Module);
  assert.equal(building.stage, 'scaffolding', '第 1 拍还没完工');
  assert.equal(building.constructionTicksRemaining, 2);

  // H3 的形状：施工到一半导出字节 → 反序列化 → 剩余拍数接着走。
  const reloaded = JSON.parse(JSON.stringify(state)) as typeof state;
  tick!(reloaded as unknown as Module);
  assert.equal(reloaded.buildings[0]!.stage, 'scaffolding', '重载后第 2 拍仍未完工');
  tick!(reloaded as unknown as Module);
  assert.equal(reloaded.buildings[0]!.stage, 'completed', '第 3 拍必须完工');
  assert.equal(
    reloaded.chronicle.some((entry) => entry.kind === 'building.completed'),
    true,
    '完工要写进编年史，不能只改个 stage',
  );
});

test('4. 指标从台账算：零重叠 / 连通率 / 淹没格都是实数', async () => {
  const audit = await load('../src/world/creator/audit-state.ts');
  const metricsOf = audit['metricsOf'] as
    | ((state: Module, submerged: ReadonlySet<string>) => Module)
    | undefined;
  const empty = audit['emptyAuditState'] as ((seed: number, worldNow: number) => Module) | undefined;
  const enqueue = audit['enqueueBuildingConstruction'] as
    | ((state: Module, params: Module) => Module)
    | undefined;
  const pointKey = audit['pointKey'] as ((point: Point) => string) | undefined;
  assert.equal(typeof metricsOf, 'function', MISSING);
  assert.equal(typeof empty, 'function', MISSING);
  assert.equal(typeof enqueue, 'function', MISSING);
  assert.equal(typeof pointKey, 'function', MISSING);

  const state = empty!(7, 0);
  const place = (id: string, x: number, y: number): void => {
    enqueue!(state, {
      instanceId: id,
      prefabId: 'workshop_lantern',
      origin: { x, y },
      footprint: { w: 2, h: 2 },
      margin: 1,
      door: { x, y: y + 2 },
      constructionTicks: 1,
      doorConnected: true,
    });
  };

  place('b-1', 2, 2);
  place('b-2', 8, 8);
  const clean = metricsOf!(state, new Set<string>()) as unknown as {
    overlapCount: number;
    pathfindingConnectivity: number;
    submergedBuildingCount: number;
  };
  assert.equal(clean.overlapCount, 0, '两栋分开的楼不该算重叠');
  assert.equal(clean.pathfindingConnectivity, 1, '两栋都连上了路，连通率应为 1.0');

  // 把第二栋压到第一栋的格子上，指标必须真的变。
  const overlapping = empty!(7, 0);
  enqueue!(overlapping, {
    instanceId: 'c-1',
    prefabId: 'workshop_lantern',
    origin: { x: 2, y: 2 },
    footprint: { w: 2, h: 2 },
    margin: 1,
    door: { x: 2, y: 4 },
    constructionTicks: 1,
    doorConnected: false,
  });
  enqueue!(overlapping, {
    instanceId: 'c-2',
    prefabId: 'workshop_lantern',
    origin: { x: 3, y: 3 },
    footprint: { w: 2, h: 2 },
    margin: 1,
    door: { x: 3, y: 5 },
    constructionTicks: 1,
    doorConnected: false,
  });
  const dirty = metricsOf!(overlapping, new Set([pointKey!({ x: 3, y: 3 })])) as unknown as {
    overlapCount: number;
    pathfindingConnectivity: number;
    submergedBuildingCount: number;
  };
  assert.ok(dirty.overlapCount > 0, '真重叠了却报 0，指标就是摆设');
  assert.equal(dirty.pathfindingConnectivity, 0, '两栋都没连路，不该报 1.0');
  assert.ok(dirty.submergedBuildingCount > 0, '淹没格上有楼却报 0');
});
