/** 造物**落地之后**的两项观测：门到镇心的可达性、回放指纹一致性。
 *
 * 这两项的共同点是「落位前算不准」：
 * - 可达性：楼还没占格，干跑 `doorReaches` 会把围死的门判成可达；
 * - 回放：落地后「已有哪些模板」变了，重跑的就不是同一个计划。
 *
 * 所以测试也分两个方向：正常落地 → `true`；把门围死 → `false`。
 * 只测 `true` 等于没测——那正是这条观测之前报 `null` 的原因。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { CreatorEngine, type CreatorWorldView } from '../src/creator/engine.ts';
import {
  creationFingerprint,
  freezeCreatorView,
  landingReachable,
  verifyCreationReplay,
  type LandedCreation,
} from '../src/creator/landing.ts';
import { Simulation } from '../src/world/simulation.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../src/world/setup.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import type { SettingPack } from '../src/settings/types.ts';
import type { CreationPlan } from '../src/world/creator-schema.ts';
import type { AutonomousFuseController } from '../src/world/creator/fuse.ts';

const WORLD_SEED = 'dengchao';

function freshWorld(): { pack: SettingPack; world: BuiltWorld } {
  const pack = loadSettingPack(DENGCHAO_RAW);
  return { pack, world: buildSettingWorld(pack) };
}

function engineOf(pack: SettingPack, world: BuiltWorld): CreatorEngine {
  return new CreatorEngine(pack, { worldSeed: WORLD_SEED, worldTime: () => 0, world });
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

/** 把一份计划真的落进世界，返回世界快照里那一栋。 */
function land(
  pack: SettingPack,
  world: BuiltWorld,
  plan: CreationPlan,
): { sim: Simulation; landed: LandedCreation } {
  const sim = simOf(pack, world);
  const instanceId = sim.nextInstanceId(plan.templateId);
  sim.enqueue({
    kind: 'build',
    prefabId: plan.templateId,
    instanceId,
    at: plan.at,
    source: { taskId: 'landing-test', summary: '测试落地' },
  });
  const result = sim.update(16)[0];
  assert.equal(result?.ok, true, result?.message);

  const building = sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
  assert.ok(building !== undefined, '计划应当真的落地');
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

// ---------------------------------------------------------------- 可达性：true

test('正常落地之后，门到镇心可达 → true', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);

  const { landed } = land(pack, world, plan);
  assert.equal(landingReachable(world, landed), true);
});

// ---------------------------------------------------------------- 可达性：false

/**
 * 把门围死：落地之后，在门口的四邻再放一圈 1×1 的占位楼。
 *
 * 门口上方那一格通常就是主楼自己的占地（落地时已经占了），剩下三个方向
 * 各补一栋。1×1 楼的门口指向**背离**门口的方向，所以这几栋不会顺手给
 * 目标门口连出一条新路。
 */
function encloseDoor(world: BuiltWorld, door: { x: number; y: number }): number {
  const directions = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];
  let walls = 0;
  for (const { dx, dy } of directions) {
    const cell = { x: door.x + dx, y: door.y + dy };
    const placed = world.grid.place({
      instanceId: `wall#${walls + 1}`,
      origin: cell,
      w: 1,
      h: 1,
      // 门口背离目标门口：不在这面墙旁边新造一块可走格。
      door: { x: cell.x + dx, y: cell.y + dy },
    });
    if (placed) walls += 1;
  }
  return walls;
}

test('落地后把门口围死 → 判定为 false（这条证明不是恒真）', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);

  const { landed } = land(pack, world, plan);
  assert.equal(landingReachable(world, landed), true, '落地那一刻应当可达');

  const walls = encloseDoor(world, landed.door);
  assert.ok(walls >= 2, `围门至少要立起两面墙，实际 ${walls}`);
  assert.equal(landingReachable(world, landed), false, '门口被围死之后必须报 false');
});

// ---------------------------------------------------------------- 判定时机

test('判定发生在落地之后：同一份计划，落位前乐观、落地后按真实网格算', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);
  const blueprint = pack.blueprints.get(plan.templateId);
  assert.ok(blueprint !== undefined);

  // 落位前：楼还没占格。门口到镇心「看起来」可达——这正是不能拿它记指标的原因。
  const before: LandedCreation = {
    instanceId: 'not-placed',
    prefabId: plan.templateId,
    origin: plan.at,
    door: { x: plan.at.x + blueprint.door.x, y: plan.at.y + blueprint.door.y },
  };
  assert.equal(landingReachable(world, before), true);

  const { sim, landed } = land(pack, world, plan);
  encloseDoor(world, landed.door);
  assert.equal(landingReachable(world, landed), false);

  // 计数器在结算之前没有任何寻路观测：判定确实晚于落地。
  const controller = (engine as any).fuseController as AutonomousFuseController;
  assert.equal(
    controller.getRoleState('mapper')?.metrics.pathfindingChecks,
    0,
    '还没结算时，寻路这一项必须是「没测过」',
  );
  assert.ok(sim.snapshot().buildings.some((building) => building.instanceId === landed.instanceId));

  engine.submitHumanApproval('mapper', landed.instanceId, true, undefined, {
    pathfindingConnected: landingReachable(world, landed),
  });
  assert.equal(controller.getRoleState('mapper')?.metrics.pathfindingChecks, 1);
  assert.equal(controller.getRates('mapper')?.pathfindingConnectedRate, 0, '围死的门要真的记成 0');
});

// ---------------------------------------------------------------- 回放：true

test('同种子、同输入重跑 → 回放一致，记 true', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const view = viewOf(pack, world, 3);
  const frozen = freezeCreatorView(
    view,
    [...pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
  );
  const plan = engine.planCreation(frozen);
  assert.ok(plan !== null);

  const { landed } = land(pack, world, plan);
  // 用**落地前冻住的 view** 重跑：活网格已经多了新楼的占地，直接重算会挑下一个位置。
  const replayed = engine.planCreation(frozen);
  assert.ok(replayed !== null);

  const consistent = verifyCreationReplay({
    plan,
    replayed,
    landed,
    day: view.day,
    blueprints: pack.blueprints,
  });
  assert.equal(consistent, true);

  engine.submitHumanApproval('mapper', landed.instanceId, true, undefined, {
    replayHashConsistent: consistent ?? undefined,
  });
  const controller = (engine as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRoleState('mapper')?.metrics.replayChecks, 1);
  assert.equal(controller.getRates('mapper')?.replayHashConsistencyRate, 1);
});

// ---------------------------------------------------------------- 回放：false

test('篡改重跑计划的落点 → 指纹不一致，记 false', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const view = viewOf(pack, world, 3);
  const frozen = freezeCreatorView(
    view,
    [...pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
  );
  const plan = engine.planCreation(frozen);
  assert.ok(plan !== null);

  const { landed } = land(pack, world, plan);
  const replayed = engine.planCreation(frozen);
  assert.ok(replayed !== null);

  const tampered: CreationPlan = { ...replayed, at: { x: replayed.at.x + 1, y: replayed.at.y } };
  assert.equal(
    verifyCreationReplay({ plan, replayed: tampered, landed, day: view.day, blueprints: pack.blueprints }),
    false,
    '落点被改过，回放不可能一致',
  );

  engine.submitHumanApproval('mapper', landed.instanceId, true, undefined, {
    replayHashConsistent: false,
  });
  const controller = (engine as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRoleState('mapper')?.metrics.replayChecks, 1);
  assert.equal(controller.getRates('mapper')?.replayHashConsistencyRate, 0);
});

test('篡改实际落地的位置 → 指纹不一致，记 false', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const view = viewOf(pack, world, 3);
  const frozen = freezeCreatorView(
    view,
    [...pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
  );
  const plan = engine.planCreation(frozen);
  assert.ok(plan !== null);

  const { landed } = land(pack, world, plan);
  const replayed = engine.planCreation(frozen);
  assert.ok(replayed !== null);

  const moved: LandedCreation = { ...landed, origin: { x: landed.origin.x + 1, y: landed.origin.y } };
  assert.equal(
    verifyCreationReplay({ plan, replayed, landed: moved, day: view.day, blueprints: pack.blueprints }),
    false,
    '落地点对不上计划，回放不可能一致',
  );
  // 指纹真的覆盖了落点：改一处原点，哈希就变了。
  assert.notEqual(
    creationFingerprint(plan, landed, view.day),
    creationFingerprint(plan, moved, view.day),
  );
});

// ---------------------------------------------------------------- 回放：null

test('没跑回放就不记录：指标仍是 null', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  engine.submitHumanApproval('mapper', 'cmd#no-replay', true);

  const controller = (engine as any).fuseController as AutonomousFuseController;
  assert.equal(controller.getRates('mapper')?.replayHashConsistencyRate, null);
});

test('跑不了（模板不在蓝图注册表里）也报 null，不报通过', () => {
  const { pack } = freshWorld();
  const plan: CreationPlan = {
    templateId: 'not_in_table',
    at: { x: 1, y: 1 },
    palette: { body: 0, roof: 0, trim: 0, window: 0 },
  };
  const replayed: CreationPlan = { ...plan };
  assert.equal(
    verifyCreationReplay({
      plan,
      replayed,
      landed: { instanceId: '', prefabId: 'not_in_table', origin: { x: 1, y: 1 }, door: { x: 1, y: 1 } },
      day: 1,
      blueprints: pack.blueprints,
    }),
    null,
  );
});
