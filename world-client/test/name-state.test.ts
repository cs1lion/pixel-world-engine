import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { assertSave, type WorldSave } from '../src/world/save.ts';
import { syncCommand } from './feed-helpers.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(): { sim: Simulation; world: ReturnType<typeof buildLargeWorld> } {
  const world = buildLargeWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
  });
  return { sim, world };
}

/** 走一条命令，拿它的结算结果。命令入口是 enqueue + update，apply 是私有的。 */
function run(sim: Simulation, command: Parameters<Simulation['enqueue']>[0]) {
  sim.enqueue(command);
  const results = sim.update(16);
  return results[results.length - 1]!;
}

function pawn(sim: Simulation, villagerId: string): void {
  run(sim, { kind: 'setNameState', villagerId, nameState: 'pawned' });
}

/** 走一趟 toSave → fromSave。抵押是世界自有的事实，读档后不该复位。 */
function throughSave(sim: Simulation, world: ReturnType<typeof buildLargeWorld>): Simulation {
  const save = sim.toSave();
  assert.doesNotThrow(() => assertSave(save), '存档必须过得去当前版本校验');
  return Simulation.fromSave(
    JSON.parse(JSON.stringify(save)) as WorldSave,
    {
      grid: world.grid,
      buildings: save.world.buildings,
      altar: world.altar,
      villagerName: '莞尔',
      wallClock: () => 1000,
    },
  );
}

// ------------------------------------------------------------------ 派活

test('名字被抵押的角色接不到新活，活落到没抵押的人头上', () => {
  const { sim } = makeSim();
  pawn(sim, 'v0');

  const snapshot = sim.snapshot();
  assert.equal(snapshot.villagers[0]!.nameState, 'pawned');
  assert.equal(snapshot.villagers[1]!.nameState, 'held');

  const result = run(sim, { kind: 'dispatch', taskKind: 'code', summary: '修水管' });
  assert.equal(result.ok, true, '世界上还有能干的人，这条神谕不该被拒');

  const after = sim.snapshot();
  assert.equal(after.villagers[0]!.taskId, null, '抵押者不该被派活');
  assert.notEqual(after.villagers[1]!.taskId, null, '活应该落到另一个人头上');
});

test('每个人都抵押了名字：派活被拒，不塞进永远不会执行的队列', () => {
  const { sim } = makeSim();
  pawn(sim, 'v0');
  pawn(sim, 'v1');

  const result = run(sim, { kind: 'dispatch', taskKind: 'code', summary: '修水管' });
  assert.equal(result.ok, false);
  assert.match(result.message, /抵押/);

  // 塞进队列就等于把单子埋了：队列只在角色空闲时才抽，抵押者永远「有空」。
  assert.equal(sim.snapshot().pending.length, 0, '不能把活埋进队列');
});

test('抵押只拦新活：已经在干的活继续干完', () => {
  const { sim } = makeSim();
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '修水管' });
  const worker = sim.snapshot().villagers.find((v) => v.taskId !== null);
  assert.ok(worker !== undefined, '先得有人接到活');

  pawn(sim, worker.id);
  const after = sim.snapshot().villagers.find((v) => v.id === worker.id)!;
  assert.equal(after.taskId, worker.taskId, '手上的活不该被抵押打断');
  assert.notEqual(after.mode, 'idle', '人也不该被扔回空闲');
});

test('赎回名字之后又能接活了', () => {
  const { sim } = makeSim();
  pawn(sim, 'v0');
  run(sim, { kind: 'setNameState', villagerId: 'v0', nameState: 'held' });

  const result = run(sim, { kind: 'dispatch', taskKind: 'code', summary: '修水管' });
  assert.equal(result.ok, true);
  assert.notEqual(sim.snapshot().villagers[0]!.taskId, null, '赎回了就该接得到');
});

// ------------------------------------------------------------------ 上游派活

test('上游同步派活也绕过抵押者：活给没抵押的人', () => {
  const { sim } = makeSim();
  pawn(sim, 'v0');

  run(
    sim,
    syncCommand({
      tasks: [{ id: 'c_1', kind: 'code', title: '上游的活' }],
      connected: true,
    }),
  );
  // 上游同步是同步结算的：这一拍就有人接下上游的活。
  const after = sim.snapshot();
  assert.equal(after.villagers[0]!.taskId, null, '抵押者不该接上游的活');
  assert.notEqual(after.villagers[1]!.taskId, null, '上游的活该落到另一个人头上');
});

test('每个人都抵押时上游的活不落地，也不冒充「没人手」', () => {
  const { sim } = makeSim();
  pawn(sim, 'v0');
  pawn(sim, 'v1');

  run(
    sim,
    syncCommand({
      tasks: [{ id: 'c_1', kind: 'code', title: '上游的活' }],
      connected: true,
    }),
  );
  const after = sim.snapshot();
  assert.equal(after.villagers[0]!.taskId, null);
  assert.equal(after.villagers[1]!.taskId, null);
  // 上游的活还在日志里，只是没人接——不能假装它不存在，
  // 也不能因为「没人手」就把它改成 done。
  const open = after.tasks.filter(
    (task) => task.source === 'ledger' && task.status === 'assigned' && task.workerId === null,
  );
  assert.equal(open.length, 1, '上游的单还开着，等有资格的人');
});

// ------------------------------------------------------- 抵押时不埋排队的神谕

test('抵押的人手上排着的神谕不跟着烂掉：转交给还能接活的人', () => {
  const { sim } = makeSim();
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '甲' });
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '乙' });
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '丙' });

  const before = sim.snapshot();
  const queued = before.pending.find((item) => item.summary === '丙');
  assert.ok(queued !== undefined, '两条活都有人干了，第三条才该排队');
  const owner = before.villagers.find((v) => v.id === queued.villagerId)!;
  assert.notEqual(owner.taskId, null, '排队得排在手上有活的人名下');

  // 抵押她。她再也不会空出手来——这条神谕不能跟着她躺到存档过期。
  run(sim, { kind: 'setNameState', villagerId: owner.id, nameState: 'pawned' });

  const after = sim.snapshot();
  const moved = after.pending.find((item) => item.summary === '丙');
  assert.ok(moved !== undefined, '神谕不该凭空消失');
  const newOwner = after.villagers.find((v) => v.id === moved.villagerId)!;
  assert.equal(newOwner.nameState, 'held', '排队的神谕必须落到没抵押的人头上');
});

test('没人能接手时，带着排队神谕的抵押被拒：不造一条永远不会开工的单', () => {
  const { sim } = makeSim();
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '甲' });
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '乙' });
  run(sim, { kind: 'dispatch', taskKind: 'code', summary: '丙' });

  const before = sim.snapshot();
  const queued = before.pending.find((item) => item.summary === '丙');
  assert.ok(queued !== undefined);
  const owner = before.villagers.find((v) => v.id === queued.villagerId)!;
  const other = before.villagers.find((v) => v.id !== owner.id)!;

  // 另一个先抵押。再抵押手上排着神谕的这位，就没人可交了。
  pawn(sim, other.id);
  const result = run(sim, { kind: 'setNameState', villagerId: owner.id, nameState: 'pawned' });

  assert.equal(result.ok, false, '没人接得住这条神谕，抵押就该被拒');
  assert.match(result.message, /神谕/);
  assert.equal(sim.snapshot().villagers.find((v) => v.id === owner.id)!.nameState, 'held');
});

// ------------------------------------------------------------------ 存档

test('抵押状态进存档、读档后还在：不会每次读档把她放回来接活', () => {
  const { sim, world } = makeSim();
  pawn(sim, 'v0');

  const restored = throughSave(sim, world);
  assert.equal(restored.snapshot().villagers[0]!.nameState, 'pawned', '读档后抵押必须还在');
  assert.equal(restored.snapshot().villagers[1]!.nameState, 'held');

  // 而且读档之后她**仍然**接不到活——不然抵押就只在当次会话里有效。
  const result = run(restored, { kind: 'dispatch', taskKind: 'code', summary: '修水管' });
  assert.equal(result.ok, true);
  assert.equal(restored.snapshot().villagers[0]!.taskId, null, '读档后抵押者照样接不到活');
  assert.notEqual(restored.snapshot().villagers[1]!.taskId, null);
});
