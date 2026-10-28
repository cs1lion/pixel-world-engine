import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isGatePassed, runAllGateChecks, type AggregateGateMetrics, type CheckContext } from '../src/world/creator/metrics.ts';
import { parseGenesisCommandBatch, type GenesisCommandBatch } from '../src/world/creator/schema.ts';
import type { PrefabBlueprint } from '../src/world/types.ts';

/**
 * 门禁指标的算法本身。
 *
 * 这里钉的核心是**分母**：一批纯 CreateRegion 里没有寻路这回事，
 * 寻路连通率必须是「不适用→满分」，而不是被稀释成 0。
 * 否则地图师光因为世界还没铺路就永远升不了级。
 */

const templates = new Map<string, PrefabBlueprint>([
  [
    'iron_workshop',
    {
      id: 'iron_workshop',
      displayName: '铁匠铺',
      zone: 'industry',
      footprint: { w: 4, h: 3 },
      clearMargin: 1,
      door: { x: 2, y: 3 },
      workSpots: [{ x: 2, y: 2 }],
      chimney: { x: 3, y: 0 },
      accent: 'smoke',
      silhouette: 'gable',
      boundTask: null,
      palette: { body: 0x1a4d2e, roof: 0x5c4033, trim: 0x8b7355, window: 0xf5deb3 },
    },
  ],
]);

const worldSize = { width: 64, height: 64 };

function batchOf(commands: unknown[]): GenesisCommandBatch {
  return parseGenesisCommandBatch(
    { version: 1, commands },
    { templates, worldSize, existingChars: new Set(['Alice']) },
  );
}

function context(over: Partial<CheckContext['worldState']> = {}): CheckContext {
  return {
    existingChars: new Set(['Alice']),
    worldState: {
      getOccupiedCells: () => new Set(),
      checkSpatialConstraints: async () => null,
      checkInvariants: async () => null,
      ...over,
    },
  };
}

const allGreen: AggregateGateMetrics = {
  schemaPassRate: 1,
  conflictCount: 0,
  coverageRate: 0.97,
  pathfindingConnectedRate: 1,
  collisionRate: 0,
  constraintSatisfactionRate: 1,
  traceabilityRate: 1,
  relationSymmetryRate: 1,
  replayHashConsistencyRate: 1,
  invariantViolationCount: 0,
};

// ---------------------------------------------------------------- 跑检查

test('全通过的批处理各项都是满分', async () => {
  const results = await runAllGateChecks(
    batchOf([
      {
        kind: 'CreateRegion',
        name: '新大陆',
        boundaries: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        terrainType: 'forest',
      },
    ]),
    context(),
  );

  assert.equal(results.passedCount, 1);
  assert.equal(results.failedCount, 0);
  assert.equal(results.aggregateMetrics.schemaPassRate, 1);
});

test('被占用的格子算碰撞，不算通过', async () => {
  const results = await runAllGateChecks(
    batchOf([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }]),
    context({ getOccupiedCells: () => new Set(['5,5']) }),
  );

  assert.equal(results.failedCount, 1);
  assert.match(results.individualResults[0]!.errors[0]!, /已被占用/);
  assert.ok((results.aggregateMetrics.collisionRate ?? 0) > 0);
});

test('空间约束失败被算进约束满足率', async () => {
  const results = await runAllGateChecks(
    batchOf([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }]),
    context({ checkSpatialConstraints: async () => '门口正对另一栋楼的墙，缺少留白' }),
  );

  assert.equal(results.failedCount, 1);
  assert.equal(results.aggregateMetrics.constraintSatisfactionRate, 0);
});

test('不变式被违反会记进违反次数', async () => {
  const results = await runAllGateChecks(
    batchOf([
      { kind: 'InjectEvent', eventKind: 'tavern_feast', timing: { dayOffset: 1 }, scope: 'global' },
    ]),
    context({ checkInvariants: async () => '世界圣经说不许在丧期办宴会' }),
  );

  assert.equal(results.aggregateMetrics.invariantViolationCount, 1);
});

test('没有建筑的批次里，寻路与碰撞是「没测」，不是满分', async () => {
  const results = await runAllGateChecks(
    batchOf([
      {
        kind: 'CreateRegion',
        name: '空地',
        boundaries: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
        terrainType: 'plains',
      },
    ]),
    context(),
  );

  // 原来这里断言 `=== 1` 与 `=== 0`，注释还说「记满分而不是零」。
  // 那句话把「没测」当成了「没问题」：一批没有建筑的指令既不证明寻路好，
  // 也不证明寻路坏。正确答案是 `null`，由 `isGatePassed` 报 `not_measured`。
  assert.equal(results.aggregateMetrics.pathfindingConnectedRate, null);
  assert.equal(results.aggregateMetrics.collisionRate, null);
  assert.equal(results.aggregateMetrics.constraintSatisfactionRate, null);
});

test('没测过的门禁挡住升级，并说明是「没测」而不是「不达标」', async () => {
  const results = await runAllGateChecks(
    batchOf([
      {
        kind: 'CreateRegion',
        name: '空地',
        boundaries: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
        terrainType: 'plains',
      },
    ]),
    context(),
  );

  const gate = isGatePassed(results.aggregateMetrics, 3);
  assert.equal(gate.passed, false);
  const missing = gate.missingMetrics.find((m) => m.name === 'pathfindingConnectedRate');
  assert.equal(missing?.reason, 'not_measured');
  assert.equal(missing?.actual, null);
});

test('没提供要素清单时覆盖率是 null，不是 1', async () => {
  const results = await runAllGateChecks(
    batchOf([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }]),
    context(),
  );

  assert.equal(results.aggregateMetrics.coverageRate, null);
});

test('提供了要素清单才真的算覆盖率', async () => {
  const results = await runAllGateChecks(
    batchOf([
      { kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } },
      { kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 20, y: 20 } },
    ]),
    {
      ...context(),
      worldState: {
        ...context().worldState,
        requiredElements: ['桥', '码头', '铁匠铺', '客栈'],
        elementsCoveredBy: (command) =>
          command.kind === 'PlaceBuilding' && command.templateId === 'iron_workshop'
            ? ['铁匠铺']
            : [],
      },
    },
  );

  // 4 个要素里命中 1 个。
  assert.equal(results.aggregateMetrics.coverageRate, 0.25);
});

test('没提供回放校验器时回放一致率是 null——没跑过不能说一致', async () => {
  const results = await runAllGateChecks(
    batchOf([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }]),
    context(),
  );

  assert.equal(results.aggregateMetrics.replayHashConsistencyRate, null);
});

test('回放校验器说不一致，一致率就是 0，挡住 L4', async () => {
  const results = await runAllGateChecks(
    batchOf([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }]),
    {
      ...context(),
      worldState: { ...context().worldState, replayCheck: async () => false },
    },
  );

  assert.equal(results.aggregateMetrics.replayHashConsistencyRate, 0);
  assert.equal(isGatePassed(results.aggregateMetrics, 4).passed, false);
});

test('关系图不对称时对称率掉下来', async () => {
  const results = await runAllGateChecks(
    batchOf([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }]),
    {
      existingChars: new Set(['Alice', 'Bob']),
      worldState: {
        getOccupiedCells: () => new Set(),
        checkSpatialConstraints: async () => null,
        checkInvariants: async () => null,
        // Alice 认识 Bob，Bob 不认识 Alice：单向边。
        getRelationTargets: (name: string) => (name === 'Alice' ? new Set(['Bob']) : new Set()),
      },
    },
  );

  assert.equal(results.aggregateMetrics.relationSymmetryRate, 0);
});

// ---------------------------------------------------------------- 爬梯判定

test('全绿时 L2/L3/L4 都放行', () => {
  for (const level of [1, 2, 3, 4]) {
    assert.equal(isGatePassed(allGreen, level).passed, true, `L${level} 应该通过`);
  }
});

test('L0 不需要任何指标', () => {
  const empty = { ...allGreen, schemaPassRate: 0 };
  assert.equal(isGatePassed(empty, 0).passed, true);
});

test('门禁是累积的：要 L3 就必须同时满足 L1 与 L2', () => {
  const brokenSchema = { ...allGreen, schemaPassRate: 0.9 };
  const result = isGatePassed(brokenSchema, 3);

  assert.equal(result.passed, false);
  assert.ok(result.missingMetrics.some((m) => m.name === 'schemaPassRate'));
});

test('要素覆盖不到 95% 挡住 L2，并报出实际值与门槛', () => {
  const result = isGatePassed({ ...allGreen, coverageRate: 0.8 }, 2);

  assert.equal(result.passed, false);
  const missing = result.missingMetrics.find((m) => m.name === 'coverageRate');
  assert.equal(missing?.actual, 0.8);
  assert.equal(missing?.required, 0.95);
});

test('有碰撞挡住 L3', () => {
  assert.equal(isGatePassed({ ...allGreen, collisionRate: 0.02 }, 3).passed, false);
});

test('寻路不通挡住 L3', () => {
  assert.equal(isGatePassed({ ...allGreen, pathfindingConnectedRate: 0.9 }, 3).passed, false);
});

test('溯源不到 100% 挡住 L4——这是最硬的一条', () => {
  const result = isGatePassed({ ...allGreen, traceabilityRate: 0.99 }, 4);
  assert.equal(result.passed, false);
  assert.ok(result.missingMetrics.some((m) => m.name === 'traceabilityRate'));
});

test('回放哈希不一致挡住 L4', () => {
  assert.equal(isGatePassed({ ...allGreen, replayHashConsistencyRate: 0.9 }, 4).passed, false);
});

test('通过的结论里 missingMetrics 是空的，不报噪音', () => {
  assert.deepEqual(isGatePassed(allGreen, 3).missingMetrics, []);
});
