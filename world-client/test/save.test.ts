import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, buildWorldFromSave, placeBlueprint } from '../src/world/setup.ts';
import { Simulation, completedAtMs } from '../src/world/simulation.ts';
import { assertSave, migrateSave, SAVE_SETTLED_KEYS, SAVE_TASK_KEYS, type WorldSave } from '../src/world/save.ts';
import type { PlacedBuilding, WorldProp } from '../src/world/types.ts';
import { syncCommand } from './feed-helpers.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

function makeSim(wallClock: () => number = () => 1000): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock,
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

function depsFromSave(save: WorldSave, wallClock: () => number = () => 1000) {
  const world = buildWorldFromSave(save.world.buildings);
  return {
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: save.world.villagers[0]?.name ?? '莞尔',
    wallClock,
  };
}

function fromSave(save: WorldSave): Simulation {
  const clone = JSON.parse(JSON.stringify(save)) as WorldSave;
  return Simulation.fromSave(clone, depsFromSave(clone));
}

test('续跑等价：toSave → fromSave → 再跑 50 拍，快照一致', () => {
  let wall = 5000;
  const a = makeSim(() => (wall += 1));
  a.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  a.update(16);
  for (let index = 0; index < 30; index += 1) a.update(100);
  const save = a.toSave();

  const b = fromSave(save);
  for (let index = 0; index < 50; index += 1) {
    a.update(100);
    b.update(100);
  }
  const pick = (sim: Simulation): string => {
    const snapshot = sim.snapshot();
    return JSON.stringify({
      now: snapshot.now,
      villagers: snapshot.villagers,
      tasks: snapshot.tasks,
      pending: snapshot.pending,
      props: snapshot.props,
      roads: snapshot.roads,
      faith: snapshot.faith,
      deliveries: snapshot.deliveries,
      deliveriesByVillager: snapshot.deliveriesByVillager,
      weather: snapshot.weather,
      intensity: sim.weatherIntensity(),
      constructions: snapshot.constructions,
      workstations: snapshot.workstations,
    });
  };
  assert.equal(pick(b), pick(a));
});

test('settled 时钟不混用：本地=wall clock，上游=事件带来的时间或 null', () => {
  let wall = 1000;
  const mockSim = makeSim(() => (wall += 1));
  mockSim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (mockSim.snapshot().deliveries.local !== 1) {
    mockSim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  const mockSettled = mockSim.toSave().world.settled[0];
  assert.equal(mockSettled?.source, 'mock');
  assert.equal(mockSettled?.completedAtClock, 'local');
  assert.equal(typeof mockSettled?.completedAt, 'number');

  const ledgerSim = makeSim();
  ledgerSim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }] }));
  guard = 0;
  while (ledgerSim.snapshot().villager.mode !== 'working') {
    ledgerSim.update(100);
    if ((guard += 1) > 200) throw new Error('没走到铺子');
  }
  ledgerSim.enqueue(syncCommand({ finished: ['c_1'] }));
  ledgerSim.update(16);
  const ledgerSettled = ledgerSim.toSave().world.settled.find((item) => item.id === 'c_1');
  assert.equal(ledgerSettled?.source, 'ledger');
  assert.equal(ledgerSettled?.completedAtClock, 'ledger');
  assert.equal(ledgerSettled?.completedAt, null, '事件没带时间就记 null，不拿本地时间顶替');
});

test('事件带的时间：秒与毫秒都认，缺失或非法记 null——绝不拿本地时间顶替', () => {
  // 事件流约定给毫秒；但老日志与别的写入方可能给秒，所以有一层归一。
  // 这条是 `completedAtMs` 的回归锁：秒 ×1000、毫秒原样、其余一律 null。
  assert.equal(completedAtMs(1_792_377_786), 1_792_377_786_000, '秒级时间放大到毫秒');
  assert.equal(completedAtMs(1_792_377_786_000), 1_792_377_786_000, '毫秒原样');
  assert.equal(completedAtMs(null), null);
  assert.equal(completedAtMs(undefined), null);
  assert.equal(completedAtMs(Number.NaN), null);
  assert.equal(completedAtMs(Number.POSITIVE_INFINITY), null);

  // 端到端：事件带的是秒，落进 settled 的必须是毫秒。
  const sim = makeSim(() => 999_999);
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }] }));
  let guard = 0;
  while (sim.snapshot().villager.mode !== 'working') {
    sim.update(100);
    if ((guard += 1) > 200) throw new Error('没走到铺子');
  }
  sim.enqueue(syncCommand({ finished: [{ id: 'c_1', completedAt: 1_792_377_786 }] }));
  sim.update(16);
  const settled = sim.toSave().world.settled.find((item) => item.id === 'c_1');
  assert.equal(settled?.completedAt, 1_792_377_786_000);
  assert.equal(settled?.completedAtClock, 'ledger', '时间来自事件，不是本地看的钟');
});

test('对账：已结算不重复、不复活；缺席不是撤单；撤单才撤', () => {
  const sample = JSON.parse(
    readFileSync(new URL('../../docs/save-v3.sample.json', import.meta.url), 'utf8'),
  ) as WorldSave;
  assertSave(sample);
  const demo = 'c_demo000001';
  const settledLedger = 'c_000000000001';
  // 样例里有一个已超过工时的 operating 单：先跑一拍把计时器落定，再作为计数基准。
  const fresh = (): Simulation => {
    const sim = fromSave(sample);
    sim.update(16);
    return sim;
  };
  const baseline = fresh().snapshot().deliveries;

  // 1) settled 里是已结算 id：不重复交付/计数。
  const finished = fresh();
  const before = finished.snapshot().deliveries;
  assert.deepEqual(before, baseline);
  finished.enqueue(syncCommand({ finished: [settledLedger] }));
  finished.update(16);
  assert.deepEqual(finished.snapshot().deliveries, before);

  // 2) 已结算 id 以 open 回来：不复活。
  const revive = fresh();
  revive.enqueue(
    syncCommand({ tasks: [{ id: settledLedger, kind: 'code', title: '不该复活' }] }),
  );
  revive.update(16);
  assert.equal(revive.snapshot().tasks.some((task) => task.id === settledLedger), false);
  assert.deepEqual(revive.snapshot().deliveries, before);

  // 3) 未结算单不在这一轮的事件里：**保留**。
  //    这是事件流相对快照最要紧的一条：缺席只说明"没有新事件"，
  //    不说明"它被撤了"。旧世界靠 `complete` 标志猜这件事，猜错就把活判没了。
  const kept = fresh();
  assert.ok(kept.snapshot().tasks.some((task) => task.id === demo));
  kept.enqueue(syncCommand({}));
  kept.update(16);
  assert.ok(
    kept.snapshot().tasks.some((task) => task.id === demo),
    '日志里没有新事件，不等于这条活被撤了',
  );

  // 4) 明确撤单：这才撤。
  const dropped = fresh();
  dropped.enqueue(syncCommand({ cancelled: [demo] }));
  dropped.update(16);
  assert.equal(dropped.snapshot().tasks.some((task) => task.id === demo), false);
  assert.deepEqual(dropped.snapshot().deliveries, before);

  // 5) 上游改标题：跟着改；对账完成后才恢复驱动。
  const overwritten = fresh();
  overwritten.enqueue(
    syncCommand({ tasks: [{ id: demo, kind: 'writing', title: '对账后的新标题' }] }),
  );
  overwritten.update(16);
  const task = overwritten.snapshot().tasks.find((item) => item.id === demo);
  assert.equal(task?.summary, '对账后的新标题');
  assert.equal(overwritten.snapshot().feed.reconciled, true);
});

test('v1→v2 迁移：样例级旧档完整可迁移，迁移后能过当前校验', () => {
  const v1 = JSON.parse(
    readFileSync(new URL('../../docs/save-v1.sample.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const migrated = migrateSave(v1);

  assert.doesNotThrow(() => assertSave(migrated), '迁移产物必须直接过当前版校验');
  // v1 的档要一路走到当前版本（v3），中间不会停在 v2。
  assert.equal(migrated.schemaVersion, 3);
});

test('v1→v2 迁移：老摆件没有来源，记 null 而不是编造', () => {
  const v1 = JSON.parse(
    readFileSync(new URL('../../docs/save-v1.sample.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const migrated = migrateSave(v1) as unknown as WorldSave;

  assert.ok(migrated.world.props.length > 0, 'v1 样例里有摆件可供断言');
  for (const prop of migrated.world.props) {
    assert.equal(prop.sourceTaskKind, null, '迁移不得给老摆件编造来源类型');
    assert.equal(prop.sourceTaskId, null, '迁移不得给老摆件编造来源单号');
    assert.ok(prop.label.length > 0, '原有字段不能在迁移里丢');
  }
});

test('v1→v2 迁移：石板从无到空数组，不是缺字段', () => {
  const v1 = JSON.parse(
    readFileSync(new URL('../../docs/save-v1.sample.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const migrated = migrateSave(v1) as unknown as WorldSave;

  assert.deepEqual(migrated.world.oracle, [], 'v1 没有石板，迁移后是空数组');
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.world, 'oracle'), true);
});

test('v1→v2 迁移：除新增字段外，世界状态逐字段不变', () => {
  const v1 = JSON.parse(
    readFileSync(new URL('../../docs/save-v1.sample.json', import.meta.url), 'utf8'),
  ) as unknown as WorldSave;
  const migrated = migrateSave(v1 as unknown as Record<string, unknown>) as unknown as WorldSave;

  const {
    oracle: _oracle,
    critters: _critters,
    // v3 的三个新字段单独断言（见下方），这里只比「迁移不该碰」的部分。
    tideOverride: _tideOverride,
    worldChangeVersion: _worldChangeVersion,
    props: migratedProps,
    buildings: migratedBuildings,
    villagers: migratedVillagers,
    ...migratedRest
  } = migrated.world;
  const { props: v1Props, buildings: v1Buildings, villagers: v1Villagers, ...v1Rest } = v1.world;
  assert.deepEqual(migratedRest, v1Rest, '迁移不能顺手改动别的世界状态');

  // v3 新增：灯油缺省满油，其余角色字段一个不动。
  const stripLampOil = (list: readonly { lampOil?: number }[]): unknown[] =>
    list.map((villager) => {
      const { lampOil: _oil, ...rest } = villager;
      return rest;
    });
  assert.deepEqual(
    stripLampOil(migratedVillagers),
    v1Villagers,
    '角色除灯油外必须逐字段一致',
  );
  assert.equal(migrated.world.tideOverride, null, 'v1 没有覆盖，迁移后是 null');
  assert.equal(migrated.world.worldChangeVersion, 0, 'v1 没记过改变次数，从零开始');

  const stripBuildings = (list: readonly PlacedBuilding[]): unknown[] =>
    list.map((building) => {
      const { sourceTaskId: _id, sourceSummary: _summary, ...rest } = building;
      return rest;
    });
  assert.deepEqual(
    stripBuildings(migratedBuildings),
    stripBuildings(v1Buildings),
    '建筑除来源外必须逐字段一致',
  );

  const strip = (props: readonly WorldProp[]): unknown[] =>
    props.map((prop) => {
      const { sourceTaskKind: _kind, sourceTaskId: _id, sourceSummary: _sum, ...rest } = prop;
      return rest;
    });
  assert.deepEqual(strip(migratedProps), strip(v1Props), '摆件除来源外必须逐字段一致');
});

test('迁移前的旧档要自证：被改过的假 v1 档不能靠迁移洗白', () => {
  const v1 = JSON.parse(
    readFileSync(new URL('../../docs/save-v1.sample.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown> & { world: Record<string, unknown> };
  v1.world.smuggledField = 1;

  assert.throws(() => migrateSave(v1), /字段漂移/, '越界的旧档必须在迁移前被拒');
});

// ---------------------------------------- v1 存档字段漂移防线（task-24）

test('toSave 剥离运行时字段：tasks[] 键集合=样例、done⊆settled、settled 键集合固定', () => {
  const sim = makeSim();
  // 上游单跑到 working 再按时收工。
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_led', kind: 'code', title: '写爬虫' }] }));
  let guard = 0;
  while (sim.snapshot().villager.mode !== 'working') {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('没走到铺子');
  }
  // 关键点：先在中途存档——此时这条活还没收尾，落盘的键集合必须与冻结样例一致。
  // `ledgerCompletedAt` 是运行时的中转字段（事件带来的时间在这里过一手），
  // 无论它此刻有没有值，都不得出现在存档里。
  const midSave = sim.toSave();
  const midTask = midSave.world.tasks.find((task) => task.id === 'c_led');
  assert.ok(midTask !== undefined, '中途存档里应有这条上游任务');
  assert.deepEqual(Object.keys(midTask).sort(), [...SAVE_TASK_KEYS].sort(),
    'tasks[] 键集合必须与 v1 冻结样例一致');
  assert.equal('ledgerCompletedAt' in midTask, false, '运行时字段 ledgerCompletedAt 不得落盘');
  assert.doesNotThrow(() => assertSave(midSave), '中途存档必须通过 v1 嵌套校验');

  sim.enqueue(syncCommand({ finished: [{ id: 'c_led', completedAt: 1_792_377_786 }] }));
  sim.update(16);
  while (sim.snapshot().villager.mode !== 'idle') {
    sim.update(100);
    if ((guard += 1) > 800) throw new Error('没回到 idle');
  }
  // 再交一单沙盒活，保证存档里既有 done 任务又有对应 settled。
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 1200) throw new Error('短活没结束');
  }

  const save = sim.toSave();
  assert.ok(save.world.settled.length >= 2, '上游与本地各有一条 settled');
  for (const task of save.world.tasks) {
    assert.deepEqual(
      Object.keys(task).sort(),
      [...SAVE_TASK_KEYS].sort(),
      'tasks[] 键集合必须与 v1 冻结样例一致',
    );
    assert.equal('ledgerCompletedAt' in task, false, '运行时字段 ledgerCompletedAt 不得落盘');
  }
  const settledIds = new Set(save.world.settled.map((record) => record.id));
  for (const task of save.world.tasks.filter((item) => item.status === 'done')) {
    assert.ok(settledIds.has(task.id), `done 任务 ${task.id} 必须能在 settled 找到`);
  }
  for (const record of save.world.settled) {
    assert.deepEqual(Object.keys(record).sort(), [...SAVE_SETTLED_KEYS].sort());
  }
  assert.doesNotThrow(() => assertSave(save), '运行时存档必须通过 v1 嵌套校验');
});

test('嵌套漂移防线：tasks[] 加字段 / done 缺 settled → assertSave 必红，还原后恢复', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  sim.update(16);
  const save = sim.toSave();
  assertSave(save);

  type MutableSave = WorldSave & { world: { tasks: Record<string, unknown>[] } };
  const withExtraKey = JSON.parse(JSON.stringify(save)) as MutableSave;
  withExtraKey.world.tasks[0].runtimeOnly = 1;
  assert.throws(() => assertSave(withExtraKey), /键集合与 v1 样例不一致/);
  delete withExtraKey.world.tasks[0].runtimeOnly;
  assertSave(withExtraKey);

  // done 必须能在 settled 找到：伪造一个「完成了但没结算」的任务。
  // task-32 后有两层都会拦：字段级校验先发现「done 却没有 completedAt」，
  // 补上完成时间后仍会被「done ⊆ settled」拦下——两层都要断言，避免只测到一层。
  const missingSettled = JSON.parse(JSON.stringify(save)) as MutableSave & {
    world: { settled: unknown[] };
  };
  missingSettled.world.tasks[0].status = 'done';
  missingSettled.world.settled = [];
  assert.throws(() => assertSave(missingSettled), /done 任务必须有完成时间/);

  const doneWithoutSettled = JSON.parse(JSON.stringify(save)) as MutableSave & {
    world: { settled: unknown[]; tasks: Record<string, unknown>[] };
  };
  doneWithoutSettled.world.tasks[0].status = 'done';
  doneWithoutSettled.world.tasks[0].completedAt = 5000;
  doneWithoutSettled.world.settled = [];
  assert.throws(() => assertSave(doneWithoutSettled), /缺少 settled 记录/);
});

// P2：指纹重算不能与「空数组」冲突——还没发生过 tasks/settled 的正常存档必须继续通过。
test('P2 契约：fresh toSave（空数组）与运行中 toSave 都通过 assertSave', () => {
  const fresh = makeSim();
  fresh.update(16);
  const save = fresh.toSave();
  assert.equal(save.world.settled.length, 0);
  assert.doesNotThrow(() => assertSave(save), '空 tasks/settled 的正常存档不能判成坏档');

  const running = makeSim();
  running.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  running.update(16);
  assert.doesNotThrow(() => assertSave(running.toSave()));
});

test('P2 契约：小人走路中（villagers[].path 非空）的存档仍通过 assertSave', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  let guard = 0;
  while (!sim.toSave().world.villagers.some((villager) => villager.path.length > 0)) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('没进入走路态');
  }
  const save = sim.toSave();
  assert.ok(save.world.villagers.some((villager) => villager.path.length > 0), '样例里没有的 path[].x/y 必须被允许');
  assert.doesNotThrow(() => assertSave(save));
});

test('P2 契约：满数据存档（settled / constructions / 队列非空）通过 assertSave', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  // 再开一栋，制造非空 constructions（施工中存档）。
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'workshop_plot#4' });
  sim.update(100);
  sim.update(100);
  const save = sim.toSave();
  assert.ok(save.world.settled.length > 0, '满数据档应有 settled');
  assert.ok(save.world.constructions.length > 0, '满数据档应有 constructions');
  assert.doesNotThrow(() => assertSave(save));
});

/* ------------------------------------------------ v3 扩位置：三个字段能存能读 */

test('v3：toSave 写出三个新字段，缺省是满油 / 无覆盖 / 零次改变', () => {
  const sim = makeSim();
  sim.update(16);
  const save = sim.toSave();

  assert.equal(save.schemaVersion, 3);
  for (const villager of save.world.villagers) {
    assert.equal(villager.lampOil, 1, '新世界开局满油');
  }
  assert.equal(save.world.tideOverride, null, '没有命令就没有覆盖');
  assert.equal(save.world.worldChangeVersion, 0, '还没改变过世界');
  assert.doesNotThrow(() => assertSave(save));
});

test('v3：三个新字段经 toSave → fromSave → 再 toSave 原样往返', () => {
  const a = makeSim();
  a.update(16);
  // 直接改存档里的值（这一版还没有写它们的命令），验证的是**搬运**而不是业务。
  const save = a.toSave() as unknown as {
    world: {
      villagers: { lampOil: number }[];
      tideOverride: { level: number; until: number } | null;
      worldChangeVersion: number;
    };
  };
  save.world.villagers[0].lampOil = 0.25;
  save.world.tideOverride = { level: 0.9, until: 12_345 };
  save.world.worldChangeVersion = 7;

  const restored = fromSave(save as unknown as WorldSave).toSave();
  assert.equal(restored.world.villagers[0]?.lampOil, 0.25, '灯油必须原样搬回来');
  assert.deepEqual(restored.world.tideOverride, { level: 0.9, until: 12_345 }, '覆盖必须原样搬回来');
  assert.equal(restored.world.worldChangeVersion, 7, '折返计数必须原样搬回来');
  assert.doesNotThrow(() => assertSave(restored));
});

test('v3：灯油不进世界的读路径（Simulation 不因它改变行为）', () => {
  // 这条是「灯油只在渲染层」那条硬约束的存档侧版本：
  // 把所有人的油抽干，世界跑出来的快照必须与满油时逐字段一致。
  const full = makeSim();
  const dry = makeSim();
  for (let index = 0; index < 30; index += 1) {
    full.update(100);
    dry.update(100);
  }
  const drySave = dry.toSave() as unknown as {
    world: { villagers: { lampOil: number }[] };
  };
  for (const villager of drySave.world.villagers) villager.lampOil = 0;

  const a = fromSave(drySave as unknown as WorldSave);
  const b = fromSave(full.toSave());
  for (let index = 0; index < 20; index += 1) {
    a.update(100);
    b.update(100);
  }
  const strip = (sim: Simulation): unknown => {
    const snapshot = sim.snapshot() as unknown as Record<string, unknown>;
    const villagers = (snapshot.villagers as Record<string, unknown>[]).map((villager) => ({ ...villager, lampOil: 0 }));
    return { ...snapshot, villager: { ...(snapshot.villager as Record<string, unknown>), lampOil: 0 }, villagers };
  };
  assert.deepEqual(strip(a), strip(b), '油多油少不能改变世界怎么走');
});
