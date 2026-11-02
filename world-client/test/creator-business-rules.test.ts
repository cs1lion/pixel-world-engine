/** 落地后的第二重门禁：真跑业务规则，并把 true/false 记成真观测。
 *
 * 三条反向用例分开：
 * ① 正常落地 → `hasConflict = false` 且**检查次数 +1**（0 是「测过且为零」）；
 * ② 冲突 → `conflictCount > 0`，L2 门禁不通过；
 * ③ 不变式违反 → `invariantViolationCount > 0`，L2 门禁不通过（并立即熔断）。
 *
 * 另外逐条走一遍实现的五条不变式，以及「覆盖率窗口清零后没有下一次造物」这个
 * 结构性限制。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import {
  CreatorEngine,
  type CreatorWorldView,
  type HumanApprovalObservation,
} from '../src/creator/engine.ts';
import {
  checkLandedBuilding,
  type BusinessWorld,
} from '../src/creator/business-rules.ts';
import { landingReachable, type LandedCreation } from '../src/creator/landing.ts';
import { Simulation } from '../src/world/simulation.ts';
import {
  biomeRingAllows,
  checkPlacement,
  placeBlueprint,
} from '../src/world/setup.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import type { SettingPack } from '../src/settings/types.ts';
import type { AutonomousFuseController } from '../src/world/creator/fuse.ts';
import type { CreationPlan } from '../src/world/creator-schema.ts';
import type { PrefabBlueprint } from '../src/world/types.ts';

const WORLD_SEED = 'dengchao';

function freshWorld(): { pack: SettingPack; world: BuiltWorld } {
  const pack = loadSettingPack(DENGCHAO_RAW);
  return { pack, world: buildSettingWorld(pack) };
}

function engineOf(pack: SettingPack, world: BuiltWorld, targetLevel?: 2 | 3): CreatorEngine {
  return new CreatorEngine(pack, {
    worldSeed: WORLD_SEED,
    worldTime: () => 0,
    world,
    ...(targetLevel === undefined ? {} : { targetLevel }),
  });
}

function viewOf(pack: SettingPack, world: BuiltWorld, day: number): CreatorWorldView {
  return {
    day,
    builtPrefabIds: new Set(world.buildings.map((building) => building.prefabId)),
    width: world.grid.width,
    height: world.grid.height,
    canPlace: (prefabId, at) => {
      const blueprint = pack.blueprints.get(prefabId);
      if (blueprint === undefined) return false;
      return checkPlacement(world.grid, blueprint, at).ok
        && biomeRingAllows(prefabId, at, world.altar);
    },
  };
}

function simOf(pack: SettingPack, world: BuiltWorld): Simulation {
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '测试',
    wallClock: () => 0,
    blueprints: pack.blueprints,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = pack.blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
  });
}

function land(pack: SettingPack, world: BuiltWorld, plan: CreationPlan): { sim: Simulation; landed: LandedCreation } {
  const sim = simOf(pack, world);
  const instanceId = sim.nextInstanceId(plan.templateId);
  sim.enqueue({
    kind: 'build',
    prefabId: plan.templateId,
    instanceId,
    at: plan.at,
    source: { taskId: 'rules-test', summary: '规则测试' },
  });
  const result = sim.update(16)[0];
  assert.equal(result?.ok, true, result?.message);
  const building = sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
  assert.ok(building !== undefined);
  return {
    sim,
    landed: {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    },
  };
}

function businessWorldOf(
  pack: SettingPack,
  world: BuiltWorld,
  sim: Simulation,
): BusinessWorld {
  return {
    snapshot: sim.snapshot(),
    grid: world.grid,
    altar: world.altar,
    blueprints: pack.blueprints,
  };
}

/** 每个世界日：一次观测 + 一次结算（与场景的跨日链同形）。 */
function days(
  engine: CreatorEngine,
  count: number,
  observation: HumanApprovalObservation,
): void {
  for (let i = 0; i < count; i += 1) {
    engine.submitHumanApproval('mapper', 'obs', true, undefined, observation);
    engine.closeWorldDay();
  }
}

const GOOD_OBSERVATION: HumanApprovalObservation = {
  coverageRate: 1,
  hasConflict: false,
  invariantViolated: false,
  hasCollision: false,
  spatialConstraintSatisfied: true,
  traceable: true,
  pathfindingConnected: true,
  replayHashConsistent: true,
};

// ---------------------------------------------------------------- 正常：0 是测过

test('正常落地：检查次数 +1、冲突是真实 0，L2 门禁放行', async () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);
  const { sim, landed } = land(pack, world, plan);

  const check = await checkLandedBuilding(businessWorldOf(pack, world, sim), landed);
  assert.equal(check.passed, true);
  assert.equal(check.hasConflict, false);
  assert.equal(check.invariantViolated, false);

  const controller = (engine as any).fuseController as AutonomousFuseController;
  engine.submitHumanApproval('mapper', landed.instanceId, true, undefined, {
    hasConflict: check.hasConflict,
    invariantViolated: check.invariantViolated,
  });
  assert.equal(controller.getRoleState('mapper')?.metrics.conflictChecks, 1);
  assert.equal(controller.getRoleState('mapper')?.metrics.conflictCount, 0);
  assert.equal(controller.getRates('mapper')?.conflictChecks, 1);
  assert.equal(controller.getRoleState('mapper')?.metrics.invariantChecks, 1);
  assert.equal(controller.getRoleState('mapper')?.metrics.invariantViolationCount, 0);

  // 门禁真的放行：两个窗口、每个窗口 14 天，L0 → L1 → L2。
  const ladder = engineOf(pack, world, 2);
  days(ladder, 14, GOOD_OBSERVATION);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1);
  days(ladder, 14, GOOD_OBSERVATION);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 2);
});

test('没查冲突与不变式 → L2 门禁不放行（白送消失）', () => {
  const { pack, world } = freshWorld();
  const ladder = engineOf(pack, world, 2);
  // 只报其它项，**不报**冲突与不变式——模拟「没人跑业务规则」的世界。
  const noChecks: HumanApprovalObservation = {
    coverageRate: 1,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    traceable: true,
    pathfindingConnected: true,
    replayHashConsistent: true,
  };

  days(ladder, 14, noChecks);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1, 'L0 → L1 不看这两项');

  days(ladder, 14, noChecks);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1, '没查过就不许升 L2');

  const controller = (ladder as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRates('mapper')?.conflictChecks, 0);
  assert.equal(controller.getRates('mapper')?.invariantChecks, 0);
});

// ---------------------------------------------------------------- 冲突

test('两栋楼占地重叠 → conflictCount > 0，L2 门禁不通过', async () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);
  const { sim, landed } = land(pack, world, plan);

  const snapshot = sim.snapshot();
  const actual = snapshot.buildings.find((building) => building.instanceId === landed.instanceId);
  assert.ok(actual !== undefined);
  // 造一个「另一栋楼压在同一块地上」的世界快照。正常落位不会产生它，
  // 但检查器的输入就是快照，所以这正是「导入/损坏的世界」会呈现的形状。
  const phantom = {
    ...actual,
    instanceId: 'phantom#overlap',
    origin: { x: actual.origin.x + 1, y: actual.origin.y },
  };
  const overlapping = { ...sim.snapshot(), buildings: [...snapshot.buildings, phantom] };

  const check = await checkLandedBuilding(
    { snapshot: overlapping, grid: world.grid, altar: world.altar, blueprints: pack.blueprints },
    landed,
  );
  assert.equal(check.hasConflict, true);
  assert.ok(
    check.violations.some((message) => message.includes('重叠') || message.includes('已被占用')),
    check.violations.join(' / '),
  );

  const ladder = engineOf(pack, world, 2);
  days(ladder, 14, GOOD_OBSERVATION);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1);

  // 第二个窗口：每一条观测都报冲突真值。
  days(ladder, 14, { ...GOOD_OBSERVATION, hasConflict: true });
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1, '冲突 > 0 不许升 L2');

  const controller = (ladder as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRoleState('mapper')?.metrics.conflictCount, 14);
  assert.equal(controller.getRoleState('mapper')?.metrics.conflictChecks, 14);
});

// ---------------------------------------------------------------- 不变式

test('落地压住既有摆件 → 不变式违反，L2 门禁不通过并熔断', async () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);

  const sim = simOf(pack, world);
  // 先在计划落点上点一盏灯；摆件不占格，所以落位检查不会因此拒绝这栋楼。
  sim.enqueue({ kind: 'miracle', miracle: 'light', at: plan.at });
  sim.update(16);
  const instanceId = sim.nextInstanceId(plan.templateId);
  sim.enqueue({
    kind: 'build',
    prefabId: plan.templateId,
    instanceId,
    at: plan.at,
    source: { taskId: 'rules-test', summary: '压住一盏灯' },
  });
  const result = sim.update(16)[0];
  assert.equal(result?.ok, true, result?.message);

  const building = sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
  assert.ok(building !== undefined);
  const landed: LandedCreation = {
    instanceId,
    prefabId: building.prefabId,
    origin: building.origin,
    door: building.door,
  };
  assert.ok(sim.snapshot().props.some((prop) => prop.at.x === plan.at.x && prop.at.y === plan.at.y));

  const check = await checkLandedBuilding(businessWorldOf(pack, world, sim), landed);
  assert.equal(check.invariantViolated, true);
  assert.ok(
    check.violations.some((message) => message.includes('既有摆件')),
    check.violations.join(' / '),
  );

  const ladder = engineOf(pack, world, 2);
  days(ladder, 14, GOOD_OBSERVATION);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1);

  days(ladder, 14, {
    ...GOOD_OBSERVATION,
    invariantViolated: true,
    hasConflict: false,
  });
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1, '不变式违反不许升 L2');
  assert.equal(ladder.getRoleState('mapper')?.isFused, true, '不变式违反一次就熔断');

  // 违反一次就熔断，旧窗口被 `triggerDowngrade` 整段作废——所以这里看到的是
  // 「窗口已清空」，而不是「1 次违反」。真正的证据是上面的 `isFused` 与等级没升。
  const controller = (ladder as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRoleState('mapper')?.metrics.invariantViolationCount, 0);
  assert.equal(controller.getRoleState('mapper')?.metrics.invariantChecks, 0);
});

test('五条不变式逐条都能报出来（含越界、门在占地内、覆盖镇心、门连不出去）', async () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);
  const { sim, landed } = land(pack, world, plan);
  const base = businessWorldOf(pack, world, sim);

  // 1. 占地越界
  const outOfWorld: LandedCreation = { ...landed, origin: { x: -1, y: -1 } };
  const bounds = await checkLandedBuilding(base, outOfWorld);
  assert.ok(bounds.violations.some((m) => m.includes('占地越界')), bounds.violations.join(' / '));

  // 2. 门口落在占地内：用一份门口在占地里的蓝图
  const badBlueprint: PrefabBlueprint = { ...pack.blueprints.get(plan.templateId)!, door: { x: 1, y: 1 } };
  const badTable = new Map(pack.blueprints);
  badTable.set(badBlueprint.id, badBlueprint);
  const inside = await checkLandedBuilding(
    { ...base, blueprints: badTable },
    { ...landed, prefabId: badBlueprint.id },
  );
  assert.ok(inside.violations.some((m) => m.includes('门口落在占地内')), inside.violations.join(' / '));

  // 3. 占地覆盖镇心。原点本身不能被别的楼占着，否则检查器会在「原点被占」处
  //    提前返回、轮不到不变式——所以这里先找一个原点空着、但占地压住镇心的落点。
  const blue = pack.blueprints.get(landed.prefabId)!;
  const occupied = new Set<string>();
  for (const building of base.snapshot.buildings) {
    for (let y = building.origin.y; y < building.origin.y + building.footprint.h; y += 1) {
      for (let x = building.origin.x; x < building.origin.x + building.footprint.w; x += 1) {
        if (building.instanceId !== landed.instanceId) occupied.add(`${x},${y}`);
      }
    }
  }
  let hubOrigin: { x: number; y: number } | undefined;
  for (let y = world.altar.y - blue.footprint.h + 1; y <= world.altar.y && hubOrigin === undefined; y += 1) {
    for (let x = world.altar.x - blue.footprint.w + 1; x <= world.altar.x; x += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      hubOrigin = { x, y };
      break;
    }
  }
  assert.ok(hubOrigin !== undefined);
  const hub = await checkLandedBuilding(base, { ...landed, origin: hubOrigin });
  assert.ok(hub.violations.some((m) => m.includes('镇心')), hub.violations.join(' / '));

  // 4. 压住既有摆件（上面那条已用真实落位证明；这里再在检查器层确认一次）
  const withProp = {
    ...base,
    snapshot: {
      ...base.snapshot,
      props: [
        ...base.snapshot.props,
        {
          id: 'prop#test',
          kind: 'lamp' as const,
          at: { ...landed.origin },
          label: '测试灯',
          sourceTaskKind: null,
          sourceTaskId: null,
          sourceSummary: null,
          grime: 1,
          reveal: null,
        },
      ],
    },
  };
  const prop = await checkLandedBuilding(withProp, landed);
  assert.ok(prop.violations.some((m) => m.includes('既有摆件')), prop.violations.join(' / '));

  // 5. 门口连不出去：把门口四邻围死之后，同一栋楼的可达性翻成 false
  assert.equal(landingReachable(world, landed), true);
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0]] as const) {
    const cell = { x: landed.door.x + dx, y: landed.door.y + dy };
    world.grid.place({
      instanceId: `wall#${dx}:${dy}`,
      origin: cell,
      w: 1,
      h: 1,
      door: { x: cell.x + dx, y: cell.y + dy },
    });
  }
  const enclosed = await checkLandedBuilding(base, landed);
  assert.ok(enclosed.violations.some((m) => m.includes('门口到不了镇心')), enclosed.violations.join(' / '));
});

// ---------------------------------------------------------------- 结构性卡死

test('升级清零窗口后没有下一次造物 → 覆盖率回 null，L1 结构上过不去', () => {
  const { pack, world } = freshWorld();
  const ladder = engineOf(pack, world, 2);

  // 第一个窗口：有造物可观测，覆盖率 1.0，14 天后升到 L1。
  days(ladder, 14, GOOD_OBSERVATION);
  assert.equal(ladder.getRoleState('mapper')?.currentLevel, 1);

  // 升级即清零：覆盖率不再是上次那个 1.0，而是「这一级还没观察过」。
  const controller = (ladder as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRates('mapper')?.coverageRate, null);
  assert.equal(controller.getRoleState('mapper')?.metrics.coverageChecks, 0);

  // 灯潮界模板已全部落地：没有下一次可观测的造物，只能继续关账。
  for (let i = 0; i < 14; i += 1) ladder.closeWorldDay();

  assert.equal(
    ladder.getRoleState('mapper')?.currentLevel,
    1,
    '没有新观测时，L1 → L2 会一直卡住（这是结构限制，不是门禁算错）',
  );
  assert.equal(controller.getRates('mapper')?.coverageRate, null, '覆盖率始终没有再被观测');
});
