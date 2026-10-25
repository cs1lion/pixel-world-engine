import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { EMPTY_FOLD, foldTaskEvents } from '../src/world/task-events.ts';
import {
  WORLD_CHANGE_KINDS,
  toEnvelope,
  type WorldChange,
} from '../src/world/world-changes.ts';
import { createEventsClient, WORLD_CHANGES_URL } from '../src/world/events-client.ts';
import { syncCommand } from './feed-helpers.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 接住世界交出来的每一条改变。 */
function makeSim(): { sim: Simulation; changes: WorldChange[] } {
  const world = buildWorld(blueprints);
  const changes: WorldChange[] = [];
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
    onChange: (change) => {
      changes.push(change);
    },
  });
  return { sim, changes };
}

// ------------------------------------------------------- 世界真的写回了吗

test('交付一单就写回一条 task.delivered', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  const delivered = changes.filter((item) => item.change === 'task.delivered');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.change, 'task.delivered');
  if (delivered[0]?.change === 'task.delivered') {
    assert.equal(delivered[0].summary, '顺手看一眼');
    assert.equal(delivered[0].source, 'local');
    assert.equal(delivered[0].taskKind, 'quick');
    assert.equal(delivered[0].workerId, 'v0');
  }
});

test('上游单交付记成 source=feed，本地单记成 local——与交付统计同口径', () => {
  const { sim, changes } = makeSim();
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'writing', title: '整理便笺' }] }));
  let guard = 0;
  while (sim.snapshot().villager.mode !== 'working') {
    sim.update(100);
    if ((guard += 1) > 600) throw new Error('没走到铺子');
  }
  sim.enqueue(syncCommand({ finished: ['c_1'] }));
  sim.update(16);
  const delivered = changes.find(
    (item) => item.change === 'task.delivered' && item.taskId === 'c_1',
  );
  assert.ok(delivered !== undefined);
  if (delivered?.change === 'task.delivered') assert.equal(delivered.source, 'feed');
  assert.equal(sim.snapshot().deliveries.feed, 1);
});

test('同一条活只写回一次：重复的收工事件不重复记', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  // 再跑很久：交付已经发生过了，不该再写。
  for (let i = 0; i < 200; i += 1) sim.update(100);
  assert.equal(
    changes.filter((item) => item.change === 'task.delivered').length,
    1,
    'recordDelivery 只在首次交付时进',
  );
});

test('被拒的命令不写回：世界没变，就没什么可记', () => {
  const { sim, changes } = makeSim();
  sim.update(16);
  // 没有在干活的人，人工交付会被拒。
  sim.enqueue({ kind: 'complete' });
  const rejected = sim.update(16);
  assert.equal(rejected[0]?.ok, false);
  assert.deepEqual(changes, [], '被拒的命令不该留下任何痕迹');
});

test('读日志不写回：syncEvents 是读，不是改世界', () => {
  const { sim, changes } = makeSim();
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }] }));
  sim.update(16);
  assert.deepEqual(changes, [], '上游来活不是世界改变');
});

test('造物与拆楼各写回一条', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#1' });
  sim.update(16);
  const built = changes.find((item) => item.change === 'building.built');
  assert.ok(built !== undefined, '新起的楼要记');
  if (built?.change === 'building.built') {
    assert.equal(built.instanceId, 'plot#1');
    assert.equal(built.summary, null, '没有来由的楼记 null，不编一个');
  }

  // 施工中不能拆，先等它落成。
  for (let i = 0; i < 60; i += 1) sim.update(100);
  sim.enqueue({ kind: 'demolish', instanceId: 'plot#1' });
  sim.update(16);
  const removed = changes.find((item) => item.change === 'building.removed');
  assert.ok(removed !== undefined);
  if (removed?.change === 'building.removed') assert.equal(removed.instanceId, 'plot#1');
});

test('拆不掉的楼不写回', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'demolish', instanceId: '根本不存在' });
  sim.update(16);
  assert.deepEqual(changes, []);
});

test('神迹写回落点：世界侧叫 light，日志里写 lamp', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'miracle', miracle: 'light' });
  sim.update(16);
  const miracle = changes.find((item) => item.change === 'miracle');
  assert.ok(miracle !== undefined);
  if (miracle?.change === 'miracle') {
    assert.equal(miracle.miracle, 'lamp', '摆件就叫 lamp，日志用它的名字');
    assert.ok(Number.isInteger(miracle.at.x) && Number.isInteger(miracle.at.y), '落点是整数格');
  }
});

test('天气写回两档', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  sim.update(16);
  sim.enqueue({ kind: 'setWeather', weather: 'clear' });
  sim.update(16);
  assert.deepEqual(
    changes.filter((item) => item.change === 'weather').map((item) => item.change === 'weather' && item.weather),
    ['rain', 'clear'],
  );
});

test('已经是雨天时再叫下雨：世界没变，不写回', () => {
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  sim.update(16);
  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  sim.update(16);
  assert.equal(changes.filter((item) => item.change === 'weather').length, 1);
});

test('回写回调抛异常也不能让世界停摆', () => {
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    onChange: () => {
      throw new Error('日志服务炸了');
    },
  });
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().deliveries.local < 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  assert.equal(sim.snapshot().deliveries.local, 1, '写日志失败不该影响世界');
});

test('世界不读自己写的东西：world.changed 不参与折叠', () => {
  // 这条是闭环不会变成回路的证明。回写出去的事件如果又被折叠成任务，
  // 世界就会把自己的行为当成上游的指令，一圈一圈自己转。
  const fold = foldTaskEvents(EMPTY_FOLD, [
    {
      id: 1,
      at: 0,
      kind: 'world.changed',
      actor: 'world',
      payload: { change: 'task.delivered', taskId: 'c_1', summary: '写爬虫' },
    },
  ]);
  assert.deepEqual(fold.open, []);
  assert.deepEqual(fold.settled, []);
  assert.deepEqual(fold.cancelled, []);
  assert.equal(fold.cursor, 1, '游标照常前进，只是什么都没折叠');
});

// ------------------------------------------------------- 信封与传输

test('信封把世界时间与载荷分开：神迹坐标不会顶掉 at', () => {
  const envelope = toEnvelope({ change: 'miracle', miracle: 'lamp', at: { x: 3, y: 4 } }, 42);
  assert.equal(envelope.at, 42);
  assert.equal(envelope.change, 'miracle');
  assert.deepEqual(envelope.payload, { miracle: 'lamp', at: { x: 3, y: 4 } });
});

test('白名单与服务端那份逐个对上', () => {
  // 两边不一致时，世界会写出服务端拒收的事件——上线才发现，很难查。
  // 服务端那份在 server/events/world_changes.py 的 WORLD_CHANGE_CHECKS。
  assert.deepEqual(
    [...WORLD_CHANGE_KINDS].sort(),
    ['building.built', 'building.removed', 'miracle', 'task.delivered', 'weather'],
  );
});

test('docs/world-changes.sample.json 里的每一条都造得出（跨语言冻结）', () => {
  // 这份样例是白名单的冻结产物：服务端 `test_world_changes.py` 断言全都收得下，
  // 客户端这里断言自己造得出同样的形状。两边各自冻结，改协议时两边同时红。
  const sample = JSON.parse(
    readFileSync(new URL('../../docs/world-changes.sample.json', import.meta.url), 'utf8'),
  ) as { changes: { at: number; change: string; payload: Record<string, unknown> }[] };

  assert.deepEqual(
    sample.changes.map((item) => item.change).sort(),
    [...WORLD_CHANGE_KINDS].sort(),
    '样例必须覆盖白名单的每一项，多一项少一项都说明两端分叉了',
  );

  const byChange = new Map(sample.changes.map((item) => [item.change, item]));

  // 逐种显式构造：样例里的字段名一旦与 `WorldChange` 联合类型分叉，
  // 这几行会直接编译不过——比断言字符串更早发现。
  const delivered = byChange.get('task.delivered')!.payload;
  const built = byChange.get('building.built')!.payload;
  const removed = byChange.get('building.removed')!.payload;
  const miracle = byChange.get('miracle')!.payload;
  const weather = byChange.get('weather')!.payload;

  const changes: WorldChange[] = [
    {
      change: 'task.delivered',
      taskId: String(delivered.taskId),
      summary: String(delivered.summary),
      workerId: String(delivered.workerId),
      source: delivered.source as 'feed' | 'local',
      taskKind: delivered.taskKind as 'code' | 'research' | 'writing' | 'quick',
    },
    {
      change: 'building.built',
      instanceId: String(built.instanceId),
      prefabId: String(built.prefabId),
      displayName: String(built.displayName),
      summary: built.summary === null ? null : String(built.summary),
    },
    {
      change: 'building.removed',
      instanceId: String(removed.instanceId),
      displayName: String(removed.displayName),
    },
    {
      change: 'miracle',
      miracle: miracle.miracle as 'lamp' | 'tree' | 'cat',
      at: miracle.at as { x: number; y: number },
    },
    { change: 'weather', weather: weather.weather as 'clear' | 'rain' },
  ];

  for (const change of changes) {
    const item = byChange.get(change.change)!;
    assert.deepEqual(
      toEnvelope(change, item.at),
      { at: item.at, change: item.change, payload: item.payload },
      `${change.change} 的信封形状与样例不一致`,
    );
  }
});

test('record 发的是 POST，body 是信封形状', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createEventsClient({
    writeUrl: 'http://x/api/world/changes',
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ id: 7 }) } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  const result = await client.record({ change: 'weather', weather: 'rain' }, 1000);
  assert.deepEqual(result, { ok: true, id: 7 });
  assert.equal(calls[0]?.url, 'http://x/api/world/changes');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    at: 1000,
    change: 'weather',
    payload: { weather: 'rain' },
  });
});

test('record 失败降级成 ok:false，不抛', async () => {
  const client = createEventsClient({
    writeUrl: 'http://x',
    fetchImpl: (async () => ({ ok: false, status: 422 }) as unknown as Response) as unknown as typeof fetch,
  });
  const result = await client.record({ change: 'weather', weather: 'rain' }, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 422);
});

test('record 的响应没有 id 也算失败：没法确认它真落进去了', async () => {
  const client = createEventsClient({
    writeUrl: 'http://x',
    fetchImpl: (async () =>
      ({ ok: true, status: 201, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch,
  });
  const result = await client.record({ change: 'weather', weather: 'rain' }, 1);
  assert.equal(result.ok, false);
});

test('默认回写地址与客户端常量一致', () => {
  assert.equal(WORLD_CHANGES_URL, '/api/world/changes');
});
