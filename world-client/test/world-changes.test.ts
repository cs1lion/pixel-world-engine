import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { IntentModel } from '../src/world/intent-router.ts';
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

/** 接住世界交出来的每一条改变，连同它标的世界时间。 */
function makeSim(model?: IntentModel): {
  sim: Simulation;
  changes: WorldChange[];
  envelopes: { at: number }[];
} {
  const world = buildWorld(blueprints);
  const changes: WorldChange[] = [];
  const envelopes: { at: number }[] = [];
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    blueprints,
    intentModel: model,
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
    onChange: (change, at) => {
      changes.push(change);
      envelopes.push({ at });
    },
  });
  return { sim, changes, envelopes };
}

/** 推几拍，给异步的模型留出回来的时间。 */
async function settle(sim: Simulation, ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    sim.update(16);
  }
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

// ------------------------------------------------- 闭环：模型 → 世界 → 回写

test('闭环：模型给的意图真的改变世界，改变真的写回成一条能过的载荷', async () => {
  // #6 要证明的就是这一条链子中间没有断口：
  //
  //   造物主（模型）+ 那句话说出口
  //        → routeIntent → parseIntent（客户端校验）
  //        → 命令队列 → applyIntent（世界执行）
  //        → announce → toEnvelope → POST /api/world/changes
  //
  // 任何一段自己测自己都不算——那些早就有了。这条测试让**一条真实形状的
  // 模型意图**走完整条路，最后检查它落成的回写载荷，与世界改变白名单的
  // 冻结样例同形。样例那头由 `server/tests/test_world_changes.py` 断言
  // 服务端收得下，所以这里等于说：模型能说出来的事，服务端一定记得住。
  const model: IntentModel = {
    // 与 `docs/intent.sample.json` 里那条 tide 一致。模型只说意图，
    // `until` 由世界按它自己的时钟算出来——这正是「时间归世界」。
    classify: async () => ({ kind: 'setTide', level: 0.25, durationMs: 30_000 }),
  };
  const { sim, changes, envelopes } = makeSim(model);

  sim.enqueue({ kind: 'oracle', raw: '把潮水压下去一点' });
  await settle(sim);

  // 一、世界真的变了。
  assert.equal(sim.snapshot().tide.overridden, true, '模型说的话得让世界动');
  assert.equal(sim.snapshot().tide.level, 0.25);

  // 二、这件事真的被交出去写回了。
  const index = changes.findIndex((item) => item.change === 'tide');
  assert.ok(index >= 0, '世界变了就必须有一条回写，否则记忆里没有这件事');
  const event = changes[index]!;
  assert.ok(event.change === 'tide');
  assert.equal(event.level, 0.25);
  // 到期时刻按**世界时钟**算：覆盖落下的那一刻 + 模型给的时长。
  // 拿 `snapshot().now` 比会差几拍——那是"现在"，不是"当时"。
  assert.equal(event.until, envelopes[index]!.at + 30_000, 'until 是相对的，起点是世界自己的时钟');

  // 三、这条回写与冻结样例同形——所以服务端一定收得下。
  const sample = JSON.parse(
    readFileSync(new URL('../../docs/world-changes.sample.json', import.meta.url), 'utf8'),
  ) as { changes: { change: string; payload: Record<string, unknown> }[] };
  const frozen = sample.changes.find((item) => item.change === 'tide');
  assert.ok(frozen !== undefined, '样例里没有 tide，那这条闭环就没有对端可以对照');
  assert.deepEqual(
    Object.keys(toEnvelope(event, 0).payload).sort(),
    Object.keys(frozen.payload).sort(),
    '回写的字段与样例分叉了：服务端会 422，而世界只看到一次安静的写失败',
  );
});

test('闭环：模型说「暴雨」，世界与回写都不会退化成「雨」', async () => {
  // 三档天气穿过整条链子最容易掉档——路上任何一处 `=== 'rain' ? … : …`
  // 都会把 storm 静默说成 rain。回写是链子的最后一站，它说错了，
  // 日志里就永久留错了。
  const model: IntentModel = {
    classify: async () => ({ kind: 'setWeather', weather: 'storm' }),
  };
  const { sim, changes } = makeSim(model);
  sim.enqueue({ kind: 'oracle', raw: '雨再大一点吧' });
  await settle(sim);

  assert.equal(sim.snapshot().weather, 'storm');
  const weather = changes.filter((item) => item.change === 'weather');
  assert.equal(weather.length, 1);
  if (weather[0]?.change === 'weather') assert.equal(weather[0].weather, 'storm');
});

test('闭环断在模型那一头：世界照常运行，只是没写成', async () => {
  // 「造物主不可用时世界照常运行」不是一句口号，它要能在这条链子的
  // 每一个断点上成立。模型超时是第一个断点。
  const model: IntentModel = {
    classify: async () => {
      throw new Error('timeout');
    },
  };
  const { sim, changes } = makeSim(model);
  const before = sim.snapshot();

  sim.enqueue({ kind: 'oracle', raw: '把那份报告弄一下' });
  await settle(sim);
  // 世界还在走：再推几拍，时间照常前进。
  sim.update(16);
  sim.update(16);

  assert.deepEqual(changes, [], '没听懂就没有世界改变，也就没有可写的');
  assert.equal(sim.snapshot().weather, before.weather);
  assert.equal(sim.snapshot().buildings.length, before.buildings.length);
  assert.ok(sim.snapshot().now > before.now, '模型挂了不该让世界停摆');
});

test('闭环断在写回那一头：世界照常运行，日志少一条', async () => {
  // 第二个断点：回写请求失败。世界已经变了，这事无法回滚，也不该回滚——
  // 世界不因为日志服务挂了就撤销自己做过的事。
  const results: unknown[] = [];
  const client = createEventsClient({
    writeUrl: 'http://x/api/world/changes',
    fetchImpl: (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch,
  });
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    onChange: (change, at) => {
      // 与 `SandboxScene` 同一条接法：丢出去，不等，也不让异常冒回世界。
      void client.record(change, at).then((result) => results.push(result));
    },
  });

  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  sim.update(16);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sim.snapshot().weather, 'rain', '世界确实变了，写不进去也不撤销');
  assert.equal(results.length, 1, '回写真的发出去了，只是没落地');
  const outcome = results[0] as { ok: boolean; status: number | null };
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, null, '连不上时没有状态码');
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

test('天气三档都写回，暴雨不会退化成雨', () => {
  const { sim, changes } = makeSim();
  for (const weather of ['rain', 'storm', 'clear'] as const) {
    sim.enqueue({ kind: 'setWeather', weather });
    sim.update(16);
  }
  assert.deepEqual(
    changes
      .filter((item) => item.change === 'weather')
      .map((item) => (item.change === 'weather' ? item.weather : null)),
    ['rain', 'storm', 'clear'],
  );
});

test('拨潮水写回的是覆盖，不是当时的潮位', () => {
  // 潮位是 `now` 的纯函数，记下来等于记时钟。事件记的是「谁在什么时候
  // 把潮水压到多少、压到什么时候」——那才会留在世界状态里（进存档）。
  const { sim, changes } = makeSim();
  sim.enqueue({ kind: 'setTideLevel', level: 0.25, durationMs: 30_000 });
  sim.update(16);

  const tide = changes.filter((item) => item.change === 'tide');
  assert.equal(tide.length, 1);
  const event = tide[0];
  assert.ok(event?.change === 'tide');
  assert.equal(event.level, 0.25);
  // 覆盖的到期时刻是「落下的那一刻 + 时长」。落下的那一刻就是这拍的 now。
  assert.equal(event.until, sim.snapshot().now + 30_000);
});

test('被拒的拨潮不写回：世界没变就没什么可记', () => {
  const { sim, changes } = makeSim();
  sim.update(16);
  sim.enqueue({ kind: 'setTideLevel', level: 5, durationMs: 1000 });
  sim.update(16);
  assert.equal(changes.filter((item) => item.change === 'tide').length, 0);
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
  // 这一份**直接读那个文件**，不再手抄一份：抄的话这条测试只是在校对
  // 我刚刚写下的两个字面量，而它要校的是两端。
  const source = readFileSync(
    new URL('../../server/events/world_changes.py', import.meta.url),
    'utf8',
  );
  const table = /WORLD_CHANGE_CHECKS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(table !== null, '找不到 server/events/world_changes.py 的 WORLD_CHANGE_CHECKS');
  const serverKinds = [...table[1]!.matchAll(/"([a-z][a-z.]*)":/g)].map((match) => match[1]!);
  assert.deepEqual([...WORLD_CHANGE_KINDS].sort(), serverKinds.sort());
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
  const tide = byChange.get('tide')!.payload;
  const vitals = byChange.get('world.vitals')!.payload;

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
    { change: 'weather', weather: weather.weather as 'clear' | 'rain' | 'storm' },
    {
      change: 'tide',
      level: Number(tide.level),
      until: Number(tide.until),
    },
    {
      change: 'world.vitals',
      day: Number(vitals.day),
      meanValence: Number(vitals.meanValence),
      meanArousal: Number(vitals.meanArousal),
      infoEntropy: Number(vitals.infoEntropy),
      isolatedHoldersCount: Number(vitals.isolatedHoldersCount),
    },
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
