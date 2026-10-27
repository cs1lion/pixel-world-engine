import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { MemoryEvent, WorldVitals } from '../src/world/memory/types.ts';

/**
 * 接线：记忆世界挂到世界循环上的那几根线，以及《补充设计》§0 那条边界。
 *
 * 本组只被允许做两件与世界外部有关的事——**收** `source = agent / genesis`
 * 的事件，和在 `DayClosed` 时**抛**一份心电图。这两件事都必须真的够得着，
 * 否则「预留了入口」就只是注释里的一句话。
 */

function runtime(): {
  rt: MemoryRuntime;
  vitals: WorldVitals[];
  events: MemoryEvent[];
} {
  const vitals: WorldVitals[] = [];
  const events: MemoryEvent[] = [];
  const rt = new MemoryRuntime({
    worldId: 'test',
    onVitals: (item) => vitals.push(item),
    onEvent: (event) => events.push(event),
  });
  return { rt, vitals, events };
}

test('位置同步：站在一起的两个人能传上话，隔开之后就不能', () => {
  const { rt } = runtime();
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'e1',
      kind: 'workshop_accident',
      placeId: 'p1',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 0.9,
    },
    ['a'],
    DAY_MS - 1,
  );
  rt.world.createClaimFrom('e1', 'a', DAY_MS - 1);
  rt.tick(DAY_MS);
  assert.equal(rt.viewOf('b')!.beliefs.length, 1, '隔一格该听得见');

  // 换一个世界：两人隔 10 格，说什么都听不见。
  const far = runtime();
  far.rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 10, y: 0 } },
  ]);
  far.rt.observe(
    {
      eventId: 'e1',
      kind: 'workshop_accident',
      placeId: 'p1',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 0.9,
    },
    ['a'],
    DAY_MS - 1,
  );
  far.rt.world.createClaimFrom('e1', 'a', DAY_MS - 1);
  far.rt.tick(DAY_MS);
  assert.equal(far.rt.viewOf('b')!.beliefs.length, 0, '隔 10 格不该听见');
});

test('DayClosed：跨过日界就关一次账，并把心电图抛出去', () => {
  const { rt, vitals } = runtime();
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);

  assert.deepEqual(rt.tick(DAY_MS - 1), [], '第 0 天还没过完，不关账');
  assert.equal(rt.closedThroughDay, -1, '一天都还没关');

  const closed = rt.tick(DAY_MS);
  assert.equal(closed.length, 1, '跨进第 1 天，第 0 天该关账');
  assert.equal(vitals.length, 1, '心电图必须抛出去——那是本组唯一被允许的对外输出');
  assert.equal(vitals[0]!.day, 0);
  assert.equal(typeof vitals[0]!.infoEntropy, 'number');
  assert.equal(typeof vitals[0]!.isolatedHoldersCount, 'number');
});

test('DayClosed：一次跨好几天，每天各关一次，不挤在同一刻', () => {
  const { rt, vitals } = runtime();
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);
  const closed = rt.tick(4 * DAY_MS);
  assert.equal(closed.length, 4, '跨了四天就该关四次账');
  assert.deepEqual(
    vitals.map((item) => item.day),
    [0, 1, 2, 3],
  );
  assert.equal(rt.closedThroughDay, 3);
});

test('心电图不回流：抛出去的东西，世界一个字段都没拿回来用', () => {
  // 边界红线里「只广播、不据此做决定」在代码上的样子：`dayClosed` 的返回值
  // 不参与任何判定，`MemoryRuntime` 也不留它。再关一次账，结果与上次无关。
  const { rt } = runtime();
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);
  const first = rt.tick(DAY_MS)[0]!;
  const second = rt.tick(2 * DAY_MS)[0]!;
  assert.equal(first.day, 0);
  assert.equal(second.day, 1);
  // 同一个空世界，两天的读数该一样——没有任何东西在把上一天的结果喂回来。
  assert.equal(first.infoEntropy, second.infoEntropy);
  assert.equal(first.isolatedHoldersCount, second.isolatedHoldersCount);
});

test('边界入口：source = agent 的上游动作能进世界，且被编译过', () => {
  const { rt, events } = runtime();
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);

  const fact = rt.ingestUpstream(
    { topology: 'execute', status: 'retrying', retries: 2, elapsedMs: 30_000, difficulty: 'hard' },
    1000,
    { placeId: 'place_foundry', at: { x: 0, y: 0 } },
    ['a'],
  );

  assert.ok(fact !== null, '上游事件必须进得来——本组预留的就是这个入口');
  assert.equal(fact.source, 'agent');
  assert.equal(fact.kind, 'workshop_accident');
  // 编译之后的事件里没有一处能带上游的业务文本。
  assert.deepEqual(Object.keys(fact.outcome).sort(), ['obstacle', 'retries']);
  // 进了世界还不够，得**真的有人记住**。早先这里把在场者写死成空数组，
  // 事件进来了、痕迹也落了，却一条记忆都没有——入口通着，屋里没人。
  assert.ok(fact.witnesses.includes('a'), '参与这件事的人按定义就在场');
  assert.ok(events.some((event) => event.kind === 'memory.written'), '目击者该记下这一条');
  assert.equal(rt.viewOf('a')!.memories.length, 1);
});

test('边界入口：表里没有的拓扑进不来，世界什么都不会发生', () => {
  const { rt, events } = runtime();
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);
  const before = events.length;
  // 一次顺利的检索：编译结果就是 `null`——世界宁可安静。
  assert.equal(
    rt.previewUpstream({
      topology: 'retrieve',
      status: 'ok',
      retries: 0,
      elapsedMs: 1000,
      difficulty: 'easy',
    })?.kind,
    'expedition_done',
  );
  // 而一个真正的空结果（表里没有的拓扑）在类型上就进不来；这里测的是
  // 「编译失败 ⇒ 不写世界」这条，用一个必然返回 null 的入口验证。
  assert.equal(rt.ingestUpstream(
    // 越过白名单强行塞一个拓扑：运行时会查表，查不到就返回 null。
    { topology: 'unknown' as never, status: 'ok', retries: 0, elapsedMs: 0, difficulty: 'easy' },
    1000,
    { placeId: 'p', at: { x: 0, y: 0 } },
    ['a'],
  ), null);
  assert.equal(events.length, before, '没编译出事件，就一条日志都不该多');
});

test('genesis 事件与本地事件走同一条路', () => {
  // 边界红线的另一半：造物主从同一个口子进来，之后与本地事件**没有区别**。
  const { rt } = runtime();
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
  ]);
  rt.world.ingest({
    eventId: 'g1',
    at: 1000,
    kind: 'celebration',
    place: { placeId: 'p', at: { x: 0, y: 0 }, indoor: false },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'genesis',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['a'],
  });
  rt.world.createClaimFrom('g1', 'a', 1000);
  rt.tick(DAY_MS);
  assert.equal(rt.viewOf('a')!.memories.length, 1, '创世事件也该被记住');
  assert.equal(rt.viewOf('b')!.beliefs.length, 1, '也该像本地事件一样传出去');
});
