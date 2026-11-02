/** 造物引擎进生产路径：世界现状 → 计划 → `Simulation.enqueue` → 世界真的多了那栋楼。
 *
 * 这一组钉四件事：
 * ① `planCreation` 只补缺、落点合规，且**同一输入两次得到同一个计划**；
 * ② 计划经 `Simulation` 的既有 `build` 入口落地，不另造通道；
 * ③ 同一世界种子 + 同一输入序列跑两遍，世界的建筑位置逐栋一致；
 * ④ 人的确认与外环的自动提议之间隔着 `evaluateFuseDecision`——L0 不自动建造。
 *
 * 用灯潮界做样本：它有一栋**开局不落位**的 `waiting_shelter`，正好是「缺一个模板」
 * 的真实场景，不是为测试编出来的。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { CreatorEngine, type CreatorWorldView } from '../src/creator/engine.ts';
import { Simulation } from '../src/world/simulation.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../src/world/setup.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import type { SettingPack } from '../src/settings/types.ts';

const WORLD_SEED = 'dengchao';

function freshWorld(): { pack: SettingPack; world: BuiltWorld } {
  const pack = loadSettingPack(DENGCHAO_RAW);
  return { pack, world: buildSettingWorld(pack) };
}

function engineOf(pack: SettingPack, world: BuiltWorld): CreatorEngine {
  return new CreatorEngine(pack, {
    worldSeed: WORLD_SEED,
    worldTime: () => 0,
    world,
  });
}

/** 场景那边 `creatorWorldView()` 的同一份逻辑：已落地模板 + 同一套落位判据。 */
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

// ---------------------------------------------------------------- 计划本身

test('只补缺：计划挑中的是灯潮界唯一没落位的那栋', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);

  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null, '开局缺一栋，应当有提议');
  assert.equal(plan.templateId, 'waiting_shelter');
});

test('同一世界、同一天、同一现状 → 同一个计划（含落点）', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const view = viewOf(pack, world, 3);

  const first = engine.planCreation(view);
  const second = engine.planCreation(viewOf(pack, world, 3));
  assert.deepEqual(first, second, '两次提议必须逐字段相同');
});

test('计划里的色板是灯潮界的色值，不是莞尔镇的', () => {
  const { pack, world } = freshWorld();
  const plan = engineOf(pack, world).planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);
  const template = pack.blueprints.get(plan.templateId);
  assert.ok(template !== undefined);
  assert.deepEqual(plan.palette, template.palette, '模板配色已经按这套设定集解析过');
});

test('模板全立起来之后不再提议——不重复建同一种铺子', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const view: CreatorWorldView = {
    ...viewOf(pack, world, 1),
    builtPrefabIds: new Set(pack.blueprints.keys()),
  };
  assert.equal(engine.planCreation(view), null);
});

// ---------------------------------------------------------------- 落地

test('计划经 Simulation.enqueue 真的落进世界，且记下来由', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);

  const sim = simOf(pack, world);
  const before = sim.snapshot().buildings.length;
  const instanceId = sim.nextInstanceId(plan.templateId);
  sim.enqueue({
    kind: 'build',
    prefabId: plan.templateId,
    instanceId,
    at: plan.at,
    source: { taskId: 'creator-test', summary: '测试提议' },
  });
  const result = sim.update(16)[0];

  assert.equal(result?.ok, true, result?.message);
  assert.equal(sim.snapshot().buildings.length, before + 1);
  const built = sim.snapshot().buildings.find((building) => building.instanceId === instanceId);
  assert.ok(built !== undefined, '计划里的 instanceId 应当真的落地');
  assert.deepEqual({ x: built.origin.x, y: built.origin.y }, plan.at);
  assert.equal(built.sourceSummary, '测试提议');
  // 这是造物主提议，不是玩家说的一句话：不该刻到石板上。
  assert.equal(sim.snapshot().oracle.length, 0);
});

// ---------------------------------------------------------------- 回放一致

test('同种子 + 同一输入序列跑两遍，落地的建筑逐栋一致', () => {
  const fingerprint = (): string => {
    const { pack, world } = freshWorld();
    const engine = engineOf(pack, world);
    const plan = engine.planCreation(viewOf(pack, world, 5));
    assert.ok(plan !== null);

    const sim = simOf(pack, world);
    sim.enqueue({
      kind: 'build',
      prefabId: plan.templateId,
      instanceId: sim.nextInstanceId(plan.templateId),
      at: plan.at,
      source: { taskId: 'replay', summary: '回放' },
    });
    sim.update(16);
    return sim
      .snapshot()
      .buildings.map((building) => `${building.prefabId}@${building.origin.x},${building.origin.y}`)
      .join('|');
  };

  assert.equal(fingerprint(), fingerprint(), '同种子的两次回放必须得到同一个世界');
});

// ---------------------------------------------------------------- 门禁

test('L0 的提议只是提议：角色还没拿到自动放行的资格', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);

  // 计划是算得出来的（它是「世界缺什么」的读数）……
  assert.ok(engine.planCreation(viewOf(pack, world, 1)) !== null);
  // ……但场景在写下世界之前会先问这一句，L0 的回答是「要人点头」。
  assert.equal(engine.getFuseDecision('mapper').action, 'requireReview');
});

test('两项观测拿到真值后，门禁能从 L2 推到 L3，并走 allow → enqueue', () => {
  const { pack, world } = freshWorld();
  // 目标等级 L3：这条测的正是「L2 → L3 之前卡住的那一格」。
  const engine = engineOf(pack, world);
  const role = 'mapper';

  const observe = (extra: Record<string, unknown>): void => {
    engine.submitHumanApproval(role, 'obs', true, undefined, {
      coverageRate: 1,
      // 落地后业务规则检查的真实结果；`false` 是「查过且没有」，与「没查」不同。
      hasConflict: false,
      invariantViolated: false,
      ...extra,
    });
  };
  /** 一个世界日 = 一次观测 + 一次按真实天的结算。 */
  const days = (count: number, extra: Record<string, unknown>): void => {
    for (let i = 0; i < count; i += 1) {
      observe(extra);
      engine.closeWorldDay();
    }
  };

  // L0 → L1：只要证据够（14 天）且通过率、人工修改率达标。
  days(14, {});
  assert.equal(engine.getRoleState(role)?.currentLevel, 1, '14 天后应到 L1');

  // L1 → L2：要素覆盖 ≥95%、冲突 0、不变式 0。
  days(14, {});
  assert.equal(engine.getRoleState(role)?.currentLevel, 2, '第二个 14 天应到 L2');

  // L2 → L3 的门禁是寻路 100% / 碰撞 0 / 空间约束 100%。
  // 先跑 14 天**不报寻路**的观测——这正是之前卡住的那种状态。
  days(14, {
    hasCollision: false,
    spatialConstraintSatisfied: true,
    traceable: true,
    replayHashConsistent: true,
  });
  assert.equal(
    engine.getRoleState(role)?.currentLevel,
    2,
    '寻路仍然只有 null 时，不该升到 L3——门禁真的在看这一项',
  );

  // 把落地后拿到的两个真值补进来。
  days(14, {
    pathfindingConnected: true,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    traceable: true,
    replayHashConsistent: true,
  });
  assert.equal(engine.getRoleState(role)?.currentLevel, 3, '真值补上后应升到 L3');

  // 走既有链路：L3 抽检放行之后，计划才入队，由 Simulation 真正落地。
  let decision = engine.getFuseDecision(role);
  for (let i = 0; i < 200 && decision.action !== 'allow'; i += 1) {
    decision = engine.getFuseDecision(role);
  }
  assert.equal(decision.action, 'allow', 'L3 抽检应当最终放行');

  const sim = simOf(pack, world);
  const plan = engine.planCreation(viewOf(pack, world, 1));
  assert.ok(plan !== null);
  const instanceId = sim.nextInstanceId(plan.templateId);
  sim.enqueue({
    kind: 'build',
    prefabId: plan.templateId,
    instanceId,
    at: plan.at,
    source: { taskId: 'gate', summary: '门禁放行之后' },
  });
  assert.equal(sim.update(16)[0]?.ok, true);
  assert.ok(
    sim.snapshot().buildings.some((building) => building.instanceId === instanceId),
    '放行之后必须真的落进世界',
  );
});

test('人工确认走引擎：确认一次就记下真实的落位观测', () => {
  const { pack, world } = freshWorld();
  const engine = engineOf(pack, world);

  const plan = engine.proposeCreation({
    templateId: 'waiting_shelter',
    at: { x: 40, y: 30 },
    palette: { body: 'timber', roof: 'copper', trim: 'trim', window: 'amber' },
    worldSize: { width: world.grid.width, height: world.grid.height },
  });
  assert.equal(plan.templateId, 'waiting_shelter');
  assert.equal(plan.palette.body, pack.palette.timber);

  engine.submitHumanApproval('mapper', 'shelter#1', true, undefined, {
    coverageRate: 0.9,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    traceable: true,
  });

  const state = engine.getRoleState('mapper');
  assert.equal(state?.metrics.totalCommands, 1);
  assert.equal(state?.metrics.coverageChecks, 1, '覆盖率是这次真的量过的');
  assert.equal(state?.metrics.pathfindingChecks, 0, '没查寻路就不该装作查过');
});
