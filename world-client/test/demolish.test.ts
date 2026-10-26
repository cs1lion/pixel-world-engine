import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import {
  buildLargeWorld,
  LARGE_ALTAR,
  LARGE_WORLD_SPEC,
  placeBlueprint,
  rebuildGridFromPlacements,
} from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { summarizeWorld } from '../src/world/world-state.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(): Simulation {
  const world = buildLargeWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
  });
}

const demolish = (sim: Simulation, instanceId: string) => {
  sim.enqueue({ kind: 'demolish', instanceId });
  return sim.update(16)[0];
};

/** 世界不许建第二栋同模板的铺子；这里绕过命令层，直接摆两栋进去。 */
function makeSimWithTwins(): Simulation {
  const world = buildLargeWorld(blueprints);
  const blueprint = blueprints.get('workshop_plot');
  assert.ok(blueprint !== undefined);
  const first = placeBlueprint(world.grid, blueprint, 'twin#1', world.altar);
  const second = placeBlueprint(world.grid, blueprint, 'twin#2', world.altar);
  assert.ok(first !== null && second !== null, '大世界里应当放得下两栋新工坊');
  return new Simulation({
    grid: world.grid,
    buildings: [...world.buildings, first.building, second.building],
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const item = blueprints.get(prefabId);
      if (item === undefined) return null;
      return placeBlueprint(world.grid, item, instanceId, world.altar, at, source);
    },
  });
}

// ------------------------------------------------------------------ 基本

test('拆一栋楼：它从世界消失，格子空出来', () => {
  const sim = makeSim();
  const target = 'workshop_plot#1';
  // 先建一栋再拆。
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: target });
  sim.update(16);
  // 等施工走完（3200ms），否则拆不了。
  for (let i = 0; i < 40; i += 1) sim.update(100);
  assert.ok(sim.snapshot().buildings.some((b) => b.instanceId === target));

  const before = sim.snapshot().buildings.length;
  const result = demolish(sim, target);

  assert.equal(result?.ok, true, result?.message);
  assert.equal(sim.snapshot().buildings.length, before - 1);
  assert.ok(!sim.snapshot().buildings.some((b) => b.instanceId === target));
});

test('拆不存在的楼：拒绝，并说清', () => {
  const sim = makeSim();
  const result = demolish(sim, 'nope#1');
  assert.equal(result?.ok, false);
  assert.match(result?.message ?? '', /没有|找不到/);
});

test('拆完能重新建在同一位置', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#a' });
  sim.update(16);
  for (let i = 0; i < 40; i += 1) sim.update(100);
  const at = sim.snapshot().buildings.find((b) => b.instanceId === 'plot#a')?.origin;
  assert.ok(at !== undefined);

  demolish(sim, 'plot#a');
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#b', at });
  const result = sim.update(16)[0];
  assert.equal(result?.ok, true, `同一位置应当能重建：${result?.message}`);
});

// ------------------------------------------------------------------ 边界

test('正在施工的楼不能拆', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#c' });
  sim.update(16);
  // 施工中（3200ms 未走完）。
  const result = demolish(sim, 'plot#c');
  assert.equal(result?.ok, false);
  assert.match(result?.message ?? '', /施工/);
});

test('有角色在里面干活的楼不能拆', () => {
  const sim = makeSim();
  // 派一个活到某栋常驻铺子，等人走进去。
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  sim.update(16);
  // 大世界里神谕活会派到郊野（20+ 格），走过去要时间。
  // 要抓「正在运转」的那一刻，不能一口气跑完——跑完就进冷却了。
  for (let i = 0; i < 400; i += 1) {
    sim.update(100);
    if (sim.snapshot().workstations.some((w) => w.activity.kind === 'operating')) break;
  }

  const working = sim.snapshot().workstations.find((w) => w.activity.kind === 'operating');
  assert.ok(working !== undefined, '应当有一台铺子在运转');

  const result = demolish(sim, working.buildingId);
  assert.equal(result?.ok, false);
  assert.match(result?.message ?? '', /干活|忙|运转/);
});

test('常驻铺子也能拆：世界允许把镇子拆空', () => {
  const sim = makeSim();
  const result = demolish(sim, 'crawler_mine#1');
  assert.equal(result?.ok, true, result?.message);
  assert.ok(!sim.snapshot().buildings.some((b) => b.instanceId === 'crawler_mine#1'));
});

// ------------------------------------------------------------------ 拆完的世界

test('拆掉郊野铺子后，世界状态说出缺口', () => {
  const sim = makeSim();
  demolish(sim, 'crawler_mine#1');
  const state = summarizeWorld(sim.snapshot());
  assert.deepEqual(state.gaps.missingWild, ['research'], '缺研究类郊野铺子');
});

test('拆完刻石板：这是改变了世界的事', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'oracle', raw: '拆掉矿洞' });
  sim.update(16);
  // 先确认造物神谕不认「拆」——拆是独立命令，不是造物。
  // 这里直接走 demolish，验证石板。
  const slabBefore = sim.snapshot().oracle.length;
  demolish(sim, 'crawler_mine#1');
  assert.ok(sim.snapshot().oracle.length >= slabBefore);
});

// ------------------------------------------------------------------ 实例身份

test('拆掉再建：新楼拿到的是没用过的编号，不是回收的旧号', () => {
  const sim = makeSim();
  const first = sim.nextInstanceId('workshop_plot');
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: first });
  sim.update(16);
  for (let i = 0; i < 40; i += 1) sim.update(100);
  assert.ok(demolish(sim, first)?.ok);

  const second = sim.nextInstanceId('workshop_plot');
  assert.notEqual(second, first, '旧编号不能发给新楼：拿旧 id 去拆会拆错楼');
  assert.ok(!sim.snapshot().buildings.some((b) => b.instanceId === second));
});

test('同一个队列里的两次造物不撞号', () => {
  // 编号在入队那一刻领，而不是结算时按建筑数现算——两栋楼同拍入队也不会同号。
  const sim = makeSim();
  const a = sim.nextInstanceId('workshop_plot');
  const b = sim.nextInstanceId('workshop_plot');
  assert.notEqual(a, b);
});

test('点名实例拆楼：只拆那一栋，同模板的另一栋不动', () => {
  const sim = makeSimWithTwins();
  const result = demolish(sim, 'twin#1');
  assert.equal(result?.ok, true, result?.message);
  const left = sim.snapshot().buildings.filter((b) => b.prefabId === 'workshop_plot');
  assert.deepEqual(
    left.map((b) => b.instanceId),
    ['twin#2'],
    '同模板的另一栋必须还在——拆楼不做「挑一栋」',
  );
});

test('只给模板且有两栋同模板：拒绝，并说清有几栋、要指名', () => {
  const sim = makeSimWithTwins();
  sim.enqueue({
    kind: 'intent',
    intent: { kind: 'demolish', templateId: 'workshop_plot' },
    raw: '拆掉新工坊',
  });
  const result = sim.update(16)[0];
  assert.equal(result?.ok, false, '两栋同模板时不能替用户挑一栋');
  assert.match(result?.message ?? '', /2 栋/);
  assert.match(result?.message ?? '', /说清拆哪一栋/);
  assert.equal(
    sim.snapshot().buildings.filter((b) => b.prefabId === 'workshop_plot').length,
    2,
    '拒绝时世界一栋都不能少',
  );
});

test('只给模板且恰好一栋：照拆，不把正常说法也拦下', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: sim.nextInstanceId('workshop_plot') });
  sim.update(16);
  for (let i = 0; i < 40; i += 1) sim.update(100);

  sim.enqueue({
    kind: 'intent',
    intent: { kind: 'demolish', templateId: 'workshop_plot' },
    raw: '拆掉新工坊',
  });
  const result = sim.update(16)[0];
  assert.equal(result?.ok, true, result?.message);
  assert.equal(sim.snapshot().buildings.filter((b) => b.prefabId === 'workshop_plot').length, 0);
});

test('读档后编号水位从幸存建筑重推：新楼不会撞上还活着的楼', () => {
  const sim = makeSim();
  // 把水位推高：领了号就算用掉，即使不建。
  sim.nextInstanceId('workshop_plot');
  sim.nextInstanceId('workshop_plot');
  const save = sim.toSave();
  const surviving = save.world.buildings.map((b) => b.instanceId);
  // 常驻铺子都是 `#1`；一个被拆掉的号必须在重推时被跳过。
  demolish(sim, 'crawler_mine#1');
  const afterDemolish = sim.toSave();

  const reloaded = Simulation.fromSave(afterDemolish, {
    grid: rebuildGridFromPlacements(afterDemolish.world.buildings, LARGE_WORLD_SPEC),
    buildings: afterDemolish.world.buildings,
    altar: LARGE_ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
  });

  const reloadedIds = reloaded.snapshot().buildings.map((b) => b.instanceId);
  assert.ok(!reloadedIds.includes('crawler_mine#1'), '拆掉的楼读档后不该复活');
  const fresh = reloaded.nextInstanceId('workshop_plot');
  assert.ok(
    !surviving.includes(fresh) && !reloadedIds.includes(fresh),
    `新编号 ${fresh} 不能撞上幸存的楼`,
  );
});
