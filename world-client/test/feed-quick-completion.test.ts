/**
 * 上游的短活不自己交付：完成权唯一来源是上游，`quick` 也不例外。
 *
 * 这条纪律 `completeManually` 早就写着，`unsettled-event-stuck.test.ts` 也钉着
 * 铺子里那三种活。漏的是 `quick`：它不走铺子，走 `startInPlace` 原地办，而
 * 那条路的收尾只看 `buildingId === null`，不问这单是谁派来的。于是上游的
 * `quick` 成了全世界唯一一种「世界自己宣布干完」的上游活——
 *
 *   - 报告说「已有交付」，还把它算成**上游**交付（`recordDelivery` 按 `source`
 *     分支，`ledger` 就记 `feedDeliveries`）；
 *   - 名字进她的功劳簿，信仰点数照发；
 *   - 上游从头到尾没说过这单成了，`ledgerCompletedAt` 还是 `null`，
 *     而 `SettledRecord` 存了一条 `completedAtClock: 'ledger'`、时间为 null 的记录；
 *   - 她手上那句急件（`blockedQuestion`）被无条件擦掉——世界刚请用户回答。
 *
 * 最难看的是不对称：同一个世界，对这条活拒绝人工交付（「这单的完成权在上游」），
 * 转头自己就交付了。用户点「交付」被拒，屏幕却说办好了。
 *
 * 修法是给 `stepWorking` 补一道 `source` 守卫，与 `stepWorkstations` 的
 * `determinate` 同源：本地单自己结束，上游单等 `task.settled`。
 *
 * 真实上游今天发不发 `kind: 'quick'`，没有服务器侧样本能证明（折叠层收，
 * `TASK_PROFILES` 也只是不让它进铺子）。所以这可能是潜伏而非现行——可那句
 * 注释上的假话、和这条能走通的路，都得在这儿钉住。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { composeReport } from '../src/world/report.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { TASK_PROFILES } from '../src/world/tasks.ts';
import { syncCommand } from './feed-helpers.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 短活的工期。测的就是「工期过了之后」发生了什么，所以拿真值，不写死。 */
const QUICK_MS = TASK_PROFILES.quick.estimateMs;

function sim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
}

/** 跑到她真的动起来（或超时）。返回是否等到。 */
function tickUntilWorking(s: Simulation, done: () => boolean = () => s.snapshot().villager.mode === 'working', limitMs = 20000): boolean {
  for (let t = 0; t < limitMs; t += 100) {
    if (done()) return true;
    s.update(100);
  }
  return done();
}

/** 把工期过去：一拍 100ms，拍到真值过去再补几拍，宁可多等不可少等。 */
function tickPastEstimate(s: Simulation, estimateMs: number): void {
  for (let t = 0; t <= estimateMs + 500; t += 100) s.update(100);
}

test('上游的 quick 工期过了也不自己交付：上游没说成，就不算成', () => {
  const s = sim();
  s.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'quick', title: '顺手查一件小事' }] }));

  assert.ok(
    tickUntilWorking(s),
    '前置：她该接下这单并原地开始干',
  );

  // 工期过去很久，远超 1200ms。
  tickPastEstimate(s, QUICK_MS);

  const after = s.snapshot();
  assert.equal(after.deliveries.feed, 0, '上游没说成的单不算上游交付');
  assert.equal(after.deliveries.local, 0, '也不是本地交付');
  assert.equal(after.faith.points, 0, '没成功就不发信仰');
  assert.equal(
    after.tasks.find((task) => task.id === 'c_1')?.status,
    'in_progress',
    '她还在干，活没收',
  );
  assert.equal(after.villager.taskId, 'c_1', '人还在这单上，没被莫名收走');
  assert.equal(after.villager.mode, 'working', '屏上是个正在干活的人，不是空闲');
  assert.equal(
    s.toSave().world.settled.some((record) => record.id === 'c_1'),
    false,
    '世界不替上游写这条收工事件',
  );
  const report = composeReport(after);
  assert.equal(
    report.lines.some((line) => line.includes('已有交付')),
    false,
    '报告不能说「已有交付」——那一句是假的',
  );
});

test('本地的 quick 照旧自己结束：守卫拦的是上游，不是这类活', () => {
  // 反方向必须同时钉，否则把修正做成「短活永远不交」又是另一个假沉默。
  const s = sim();
  s.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });

  assert.ok(
    tickUntilWorking(s, () => s.snapshot().deliveries.local >= 1),
    '本地短活该自己结束',
  );
  const after = s.snapshot();
  assert.equal(after.deliveries.local, 1, '本地单记本地交付');
  assert.equal(after.deliveries.feed, 0, '不掺上游的账');
  assert.equal(after.villager.mode, 'idle', '干完回到空闲');
});

test('上游后来说了成：那一刻才结算，时间戳用上游的', () => {
  const s = sim();
  s.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'quick', title: '顺手查一件小事' }] }));
  assert.ok(tickUntilWorking(s), '前置：她该在干');

  // 上游带时间戳结算。foldTaskEvents 的 completedAt 是世界对齐的依据。
  const ledgerAt = 1_792_377_786_000;
  s.enqueue(
    syncCommand({
      finished: [{ id: 'c_1', completedAt: ledgerAt }],
    }),
  );
  s.update(100);

  const after = s.snapshot();
  assert.equal(after.deliveries.feed, 1, '上游说了成才算上游交付');
  const record = s.toSave().world.settled.find((item) => item.id === 'c_1');
  assert.ok(record !== undefined, '该有一条结算记录');
  assert.equal(record.completedAt, ledgerAt, '时间戳是上游那个，不是本地时钟顶替的');
  assert.equal(record.completedAtClock, 'ledger', '时钟来源记的是上游');
  assert.equal(record.source, 'ledger', '来源记的是上游');
});

test('上游的 quick 带着急件：那句问题不被擦掉', () => {
  // 世界刚对用户说「在等你的答复」，一秒后不能自己说这单办完了。
  const s = sim();
  s.enqueue(
    syncCommand({
      tasks: [{ id: 'c_1', kind: 'quick', title: '顺手查一件小事', question: '要查哪一天的？' }],
    }),
  );
  assert.ok(tickUntilWorking(s), '前置：她该在干');

  tickPastEstimate(s, QUICK_MS);
  const task = s.snapshot().tasks.find((item) => item.id === 'c_1');
  assert.equal(task?.status, 'in_progress', '还没成');
  assert.equal(
    task?.blockedQuestion,
    '要查哪一天的？',
    '那句急件得留着，用户还等着答它',
  );
});
