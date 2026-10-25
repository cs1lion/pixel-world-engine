import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, buildWorldFromSave, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { EMPTY_FOLD, foldTaskEvents, type TaskEvent, type TaskFoldState } from '../src/world/task-events.ts';
import { FeedClient } from '../src/world/feed.ts';
import { createEventsClient, type EventsClient, type EventsResult } from '../src/world/events-client.ts';
import type { WorldSave } from '../src/world/save.ts';

/** 世界从日志启动与恢复（#5 的验收：空日志能起，有内容的日志能恢复）。
 *
 * 两条路都是**同一个折叠**：`since=0` 从头折一遍就是当前状态。
 * 这里不造假数据，用的是真实的 `FeedClient` → `foldTaskEvents` → `Simulation`
 * 那条链，只把 HTTP 换成内存里的一个只增数组。
 */

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 一个只增的假日志，形状与服务端 `GET /api/events` 一致。 */
function makeLog(): { rows: TaskEvent[]; append: (event: Omit<TaskEvent, 'id'>) => void; client: EventsClient } {
  const rows: TaskEvent[] = [];
  const append = (event: Omit<TaskEvent, 'id'>): void => {
    rows.push({ ...event, id: rows.length + 1 });
  };
  const client = createEventsClient({
    fetchImpl: (async (url: string) => {
      const parsed = new URL(url, 'http://x');
      const since = Number(parsed.searchParams.get('since') ?? '0');
      const limit = Number(parsed.searchParams.get('limit') ?? '200');
      const page = rows.filter((row) => row.id > since).slice(0, limit);
      const latestId = rows.length === 0 ? 0 : rows[rows.length - 1]!.id;
      const hasMore = page.length > 0 && page[page.length - 1]!.id < latestId;
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: page, latestId, hasMore }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  return { rows, append, client };
}

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

/** 把 FeedClient 的一轮读取接进世界，返回折叠结果。 */
async function syncOnce(feed: FeedClient, sim: Simulation): Promise<TaskFoldState> {
  await feed.poll();
  const fold = feed.state();
  sim.enqueue({ kind: 'syncEvents', fold, connected: true });
  sim.update(16);
  return fold;
}

// ---------------------------------------------------------------- 空日志

test('空日志：世界能启动，读到的是一份空折叠', async () => {
  const log = makeLog();
  const sim = makeSim();
  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });

  const fold = await syncOnce(feed, sim);
  assert.equal(fold.cursor, 0);
  assert.deepEqual(fold.open, []);
  assert.deepEqual(fold.settled, []);
  assert.deepEqual(fold.cancelled, []);

  const snapshot = sim.snapshot();
  assert.equal(snapshot.tasks.length, 0, '空日志不该凭空长出活');
  assert.equal(snapshot.feed.connected, true);
  assert.equal(snapshot.feed.reconciled, true, '读过一轮就算对过账');
  assert.equal(snapshot.feed.cursor, 0);
});

test('空日志上世界照常过日子：本地单能派能交', async () => {
  const log = makeLog();
  const sim = makeSim();
  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });
  await syncOnce(feed, sim);

  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  assert.equal(sim.snapshot().deliveries.local, 1);
});

// ---------------------------------------------------------------- 有内容的日志

test('有内容的日志：一次 since=0 就把当前状态全折出来', async () => {
  const log = makeLog();
  log.append({ at: 1, kind: 'task.opened', actor: 'up', payload: { id: 'c_1', kind: 'code', title: '写爬虫' } });
  log.append({ at: 2, kind: 'task.opened', actor: 'up', payload: { id: 'c_2', kind: 'research', title: '查资料' } });
  log.append({ at: 3, kind: 'task.blocked', actor: 'up', payload: { id: 'c_2', question: '要删掉 ./tmp 吗？' } });
  log.append({ at: 4, kind: 'task.opened', actor: 'up', payload: { id: 'c_3', kind: 'writing', title: '整理便笺' } });
  log.append({ at: 5, kind: 'task.settled', actor: 'up', payload: { id: 'c_3', completedAt: 5 } });

  const sim = makeSim();
  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });
  const fold = await syncOnce(feed, sim);

  assert.deepEqual(fold.open.map((task) => task.id), ['c_1', 'c_2']);
  assert.deepEqual(fold.settled.map((item) => item.id), ['c_3']);

  const snapshot = sim.snapshot();
  assert.deepEqual(snapshot.tasks.map((task) => task.id).sort(), ['c_1', 'c_2']);
  const blocked = snapshot.tasks.find((task) => task.id === 'c_2');
  assert.equal(blocked?.blockedQuestion, '要删掉 ./tmp 吗？', '问题原样带过来');
  assert.equal(snapshot.feed.cursor, 5);
});

test('有内容的日志：世界把折出来的活派下去', async () => {
  const log = makeLog();
  log.append({ at: 1, kind: 'task.opened', actor: 'up', payload: { id: 'c_1', kind: 'writing', title: '整理便笺' } });

  const sim = makeSim();
  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });
  await syncOnce(feed, sim);

  let guard = 0;
  while (sim.snapshot().villager.mode !== 'working') {
    sim.update(100);
    if ((guard += 1) > 600) throw new Error('没把活派下去');
  }
  assert.equal(sim.snapshot().villager.taskId, 'c_1');
});

// ---------------------------------------------------------------- 断点续读

test('断点续读：第二轮只读新事件，拼起来不重不漏', async () => {
  const log = makeLog();
  log.append({ at: 1, kind: 'task.opened', actor: 'up', payload: { id: 'c_1', kind: 'code', title: '甲' } });

  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });
  await feed.poll();
  assert.deepEqual(feed.state().open.map((task) => task.id), ['c_1']);

  log.append({ at: 2, kind: 'task.opened', actor: 'up', payload: { id: 'c_2', kind: 'code', title: '乙' } });
  log.append({ at: 3, kind: 'task.settled', actor: 'up', payload: { id: 'c_1' } });
  await feed.poll();

  const state = feed.state();
  assert.deepEqual(state.open.map((task) => task.id), ['c_2'], 'c_1 收了，c_2 来了');
  assert.deepEqual(state.settled.map((item) => item.id), ['c_1']);
  assert.equal(state.cursor, 3);
});

test('读档后从空日志恢复：存档里的活保留，不被"没事件"判成撤单', async () => {
  // 这是事件流相对快照最要紧的一条：重启后日志里什么都没有，
  // 不代表存档里那些活被撤了。旧世界靠 `complete` 标志猜这件事。
  const a = makeSim();
  const emptyLog = makeLog();
  const feedA = new FeedClient({ client: emptyLog.client, onUpdate: () => {} });
  await syncOnce(feedA, a);
  a.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  let guard = 0;
  while (a.snapshot().villager.mode !== 'working') {
    a.update(100);
    if ((guard += 1) > 600) throw new Error('没进工位');
  }
  const save = a.toSave();
  assert.ok(save.world.tasks.length > 0, '存档里应有这条活');

  const rebuilt = buildWorldFromSave(save.world.buildings, blueprints);
  const b = Simulation.fromSave(JSON.parse(JSON.stringify(save)) as WorldSave, {
    grid: rebuilt.grid,
    buildings: rebuilt.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
  });
  assert.equal(b.snapshot().feed.reconciled, false, '读档后还没对账');

  // 上游一条事件都没有。
  const feedB = new FeedClient({ client: emptyLog.client, onUpdate: () => {} });
  await syncOnce(feedB, b);

  const after = b.snapshot();
  assert.equal(after.feed.reconciled, true);
  assert.ok(after.tasks.length > 0, '日志里没有事件 ≠ 存档里的活被撤了');
  assert.equal(
    after.villager.taskId,
    save.world.villagers[0]?.taskId,
    '她还在存档里那单上',
  );
});

// ---------------------------------------------------------------- 分页

test('日志比一页长时，一轮里连读到底', async () => {
  const log = makeLog();
  // 300 条 > 一页 200 条。
  for (let i = 0; i < 300; i += 1) {
    log.append({
      at: i,
      kind: 'task.opened',
      actor: 'up',
      payload: { id: `c_${String(i).padStart(3, '0')}`, kind: 'code', title: `第 ${i} 单` },
    });
  }
  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });
  await feed.poll();
  assert.equal(feed.state().open.length, 300, '两页都要读到');
  assert.equal(feed.state().cursor, 300);
});

test('读到一半日志又长了：用最后一条的 id 当游标，不跳事件', async () => {
  // 这是 #12 那条 bug 的回归锁：`latestId` 是日志的尽头，不是读到哪了。
  const log = makeLog();
  for (let i = 0; i < 3; i += 1) {
    log.append({ at: i, kind: 'task.opened', actor: 'up', payload: { id: `c_${i}`, kind: 'code', title: `第 ${i} 单` } });
  }
  const feed = new FeedClient({ client: log.client, onUpdate: () => {} });
  await feed.poll();
  assert.equal(feed.state().cursor, 3);

  // 日志继续长，下一次只读新的三条。
  for (let i = 3; i < 6; i += 1) {
    log.append({ at: i, kind: 'task.opened', actor: 'up', payload: { id: `c_${i}`, kind: 'code', title: `第 ${i} 单` } });
  }
  await feed.poll();
  assert.equal(feed.state().open.length, 6, '一条都不能漏');
});

test('读失败时世界照常过日子，只是标成离线', async () => {
  const failing: EventsClient = {
    fetchSince: async (): Promise<EventsResult> => ({ ok: false, reason: '连不上', status: null }),
    record: async () => ({ ok: false, reason: '连不上', status: null }),
  };
  const sim = makeSim();
  const feed = new FeedClient({ client: failing, onUpdate: () => {} });
  await feed.poll();
  sim.enqueue({ kind: 'syncEvents', fold: feed.state(), connected: false });
  sim.update(16);

  const snapshot = sim.snapshot();
  assert.equal(snapshot.feed.connected, false, '必须说出来是离线');
  assert.equal(snapshot.feed.reconciled, true, '离线不影响世界自己过日子');

  // 本地单照样能派能交。
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('离线时短活也该结束');
  }
});

test('折叠是增量的：分批喂与一次喂结果相同', () => {
  const events: TaskEvent[] = [
    { id: 1, at: 0, kind: 'task.opened', actor: 'up', payload: { id: 'a', kind: 'code', title: '甲' } },
    { id: 2, at: 0, kind: 'task.opened', actor: 'up', payload: { id: 'b', kind: 'code', title: '乙' } },
    { id: 3, at: 0, kind: 'task.blocked', actor: 'up', payload: { id: 'b', question: '问？' } },
    { id: 4, at: 0, kind: 'task.settled', actor: 'up', payload: { id: 'a' } },
  ];
  const oneShot = foldTaskEvents(EMPTY_FOLD, events);
  const incremental = events.reduce(
    (state, event) => foldTaskEvents(state, [event]),
    EMPTY_FOLD,
  );
  assert.deepEqual(incremental, oneShot);
});
