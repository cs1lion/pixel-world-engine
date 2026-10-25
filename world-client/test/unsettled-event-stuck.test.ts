import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { foldTaskEvents, type TaskFoldState } from '../src/world/task-events.ts';
import { syncCommand } from './feed-helpers.ts';

/** 上游说了世界听不懂的话时，人不能卡住（6473b96 的回归锁，事件流版本）。
 *
 * 原始缺陷：上游把一单标成 `ready_to_report`（"等老板验收"），世界把它当成
 * "完成"——于是角色被收走、交付被记上，其实活还没验收。修法是把"什么算成功"
 * 收窄到唯一一种：上游明确说成了。
 *
 * 事件流把这条纪律变得更硬：世界不再猜状态字符串的含义，只认四种事件。
 * 别的 kind（上游将来加的 `task.ready_to_report`、或写错的拼写）走 default 分支
 * 被原样忽略——**不结算、不撤单、不改任何状态**。
 *
 * 为什么必须从折叠层进：世界收的是折叠结果，判断全在 `foldTaskEvents` 里。
 * 直接给世界塞一份手搓的 `TaskFoldState` 就绕过了要测的那一步。
 */

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);
const STEP = 100;

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

/** 把一条活推进世界，然后跑到角色进屋干活。返回当时的折叠状态（游标接着往后排）。 */
function runUntilWorking(sim: Simulation): TaskFoldState {
  const command = syncCommand({ tasks: [{ id: 'c_rr', kind: 'writing', title: '整理便笺' }] });
  sim.enqueue(command);
  for (let i = 0; i < 900; i += 1) {
    if (sim.snapshot().villager.mode === 'working') return command.fold;
    sim.update(STEP);
  }
  throw new Error('没能把角色送进工位：' + JSON.stringify(sim.snapshot().villager));
}

test('不认识的事件 kind 既不结算也不撤单：角色照常干活，不加信仰不计交付', () => {
  const sim = makeSim();
  const fold = runUntilWorking(sim);

  const before = sim.snapshot();
  assert.equal(before.villager.mode, 'working', '前置：应在干活');
  assert.equal(before.villager.visible, false, '前置：干活时不可见');

  // 上游发了一条世界没学过的事件。
  const unknown = foldTaskEvents(fold, [
    { id: fold.cursor + 1, at: 0, kind: 'task.ready_to_report', actor: 'upstream', payload: { id: 'c_rr' } },
  ]);
  assert.deepEqual(
    unknown.open.map((task) => task.id),
    ['c_rr'],
    '不认识的事件不该把活从 open 里挪走',
  );
  assert.equal(unknown.settled.length, 0, '更不该当成收工');
  assert.equal(unknown.cancelled.length, 0, '也不该当成撤单');

  sim.enqueue({ kind: 'syncEvents', fold: unknown, connected: true });
  for (let i = 0; i < 1200; i += 1) sim.update(STEP);
  const after = sim.snapshot();

  assert.equal(after.faith.points, 0, '没验收就不是成功，不该加信仰点');
  assert.equal(after.deliveries.feed, 0, '不该被算作上游交付');
  // 关键：她还在这单上，而不是被莫名其妙地收走或卡在不可见状态。
  assert.equal(after.villager.taskId, 'c_rr', '她仍在这单上');
  assert.notEqual(after.villager.mode, 'idle', '不该被这条事件收手');
  assert.equal(
    after.villagers.filter((v) => v.mode === 'working' && !v.visible).length,
    1,
    '干活时本来就不可见——这不是卡死，是正常状态',
  );
});

test('给一条世界没见过的 id 发 settled：不凭空造活，也不影响正在干活的人', () => {
  const sim = makeSim();
  const fold = runUntilWorking(sim);

  // 上游结算了一条世界从没见过 `task.opened` 的活（例如日志缺了前半段）。
  const orphan = foldTaskEvents(fold, [
    { id: fold.cursor + 1, at: 0, kind: 'task.settled', actor: 'upstream', payload: { id: 'c_ghost' } },
  ]);
  assert.deepEqual(orphan.settled.map((item) => item.id), ['c_ghost'], '折叠层照实记下');

  sim.enqueue({ kind: 'syncEvents', fold: orphan, connected: true });
  sim.update(STEP);
  const after = sim.snapshot();

  assert.equal(
    after.tasks.some((task) => task.id === 'c_ghost'),
    false,
    '没见过的 id 不该凭空造出一条活',
  );
  assert.equal(after.villager.taskId, 'c_rr', '正在干活的人不受影响');
  assert.equal(after.deliveries.feed, 0, '不存在的活不产生交付');
});

test('认得出的事件才改世界：settled 到达时角色正常收手，不留在工位', () => {
  const sim = makeSim();
  const fold = runUntilWorking(sim);

  const settled = foldTaskEvents(fold, [
    { id: fold.cursor + 1, at: 0, kind: 'task.settled', actor: 'upstream', payload: { id: 'c_rr' } },
  ]);
  sim.enqueue({ kind: 'syncEvents', fold: settled, connected: true });
  sim.update(STEP);
  assert.equal(sim.snapshot().deliveries.feed, 1, '认得出的收工事件才算交付');

  for (let i = 0; i < 400; i += 1) sim.update(STEP);
  const after = sim.snapshot();
  assert.equal(after.villager.mode, 'idle', '交付完回到空闲');
  assert.equal(after.villager.visible, true, '必须恢复可见，否则人看不见也动不了');
  assert.equal(
    after.villagers.filter((v) => v.mode === 'working' && !v.visible).length,
    0,
    '不该有角色永久不可见地卡在 working',
  );
});
