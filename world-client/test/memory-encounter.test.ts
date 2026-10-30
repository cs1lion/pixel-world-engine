import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';

/**
 * 日终那一格坐标不是一天。
 *
 * `spreadCandidates` 原先只问「此刻谁挨着谁」，而 `diffuseDay` 一天只跑一次
 * （日终）。于是整整一天的相处被压成子夜那一刻的位置：两个人在街上碰了一整天
 * 面，日终各自走开，这一天就等于谁也没见过谁。
 *
 * 这不是理论上的边角。灯潮界跑三个世界日，两个村民相距 2 格以内的拍数是
 * 89,242（100ms 一步，约两个半世界小时），而三个日终分别相距 13.5 / 14.0 /
 * 17.0 格——全部大于 `talkDistance = 2`。结果 `claims = 1`、`beliefs = 0`、
 * 有信念的楼 0 栋，`diffuseDay` 一次也没开过口。而所有覆盖率的测试都是绿的，
 * 因为它们自己把单位按 `TALK_DISTANCE` 摆成一排，测的是那张理想站位图。
 *
 * 现在按「今天照过面」算（`sampleEncounters` → `metToday`）。这一组钉四件事：
 * 白天碰过面的话传得出去、没碰过面的传不出去、昨天的照面不算今天的账、
 * 以及行为层只喂位置就够——不需要谁额外记得来调一次。
 */

/** 两个人。默认站在一起（1 格，够得着）。 */
function twoVillagers(): MemoryWorld {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: { talkativeness: 0.5 }, at: { x: 0, y: 0 } });
  world.addHolder({ holderId: 'v1', type: 'character', profile: { talkativeness: 0.5 }, at: { x: 1, y: 0 } });
  return world;
}

/** 一件有落点的事，目击者 v0。断言要有人真的记住了它才诞生。 */
function seedEvent(world: MemoryWorld, eventId: string, at: number): void {
  world.ingest({
    eventId,
    at,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  world.createClaimFrom(eventId, 'v0', at);
}

function believeCount(world: MemoryWorld, holderId: string): number {
  return world.viewOf(holderId)!.beliefs.length;
}

test('白天碰过面、日终走散了，话照样传得出去', () => {
  const world = twoVillagers();
  seedEvent(world, 'ev_1', 1000);

  // 白天：两人在一起。行为层每拍喂位置时就会记下这一笔。
  world.sampleEncounters();
  // 日终之前走散——这正是真实作息的样子，两个人不会恰好在子夜站在一起。
  world.moveHolder('v1', { x: 40, y: 0 });

  world.dayClosed(0, DAY_MS - 1);

  assert.ok(
    believeCount(world, 'v1') > 0,
    '白天碰过面的人，日终走散了也该听说过这件事——只按日终那一格算的话，这一天等于白过',
  );
});

test('一整天没碰过面，就不传', () => {
  const world = twoVillagers();
  seedEvent(world, 'ev_1', 1000);

  // 从头到尾隔着 40 格。一次照面都没有。
  world.moveHolder('v1', { x: 40, y: 0 });
  world.dayClosed(0, DAY_MS - 1);

  assert.equal(
    believeCount(world, 'v1'),
    0,
    '没照过面却听说了——那说明候选表退化成了全连接图，`talkDistance` 形同虚设',
  );
});

test('昨天的照面不算今天的账', () => {
  const world = twoVillagers();

  // 第一天在一起，第一条事传开了。
  seedEvent(world, 'ev_1', 1000);
  world.sampleEncounters();
  world.dayClosed(0, DAY_MS - 1);
  assert.ok(believeCount(world, 'v1') > 0, '第一天没传出去，后面那条断言就什么都没在验');

  // 第二天两人再没碰上，世界又出了一件事。
  world.moveHolder('v1', { x: 40, y: 0 });
  seedEvent(world, 'ev_2', DAY_MS + 1000);
  world.dayClosed(1, 2 * DAY_MS - 1);

  const knows = world
    .viewOf('v1')!
    .beliefs.some((belief) => belief.eventRefs.includes('ev_2'));
  assert.equal(knows, false, '昨天见过面，不等于今天还听得见——照面表必须在日终清空');
});

test('行为层只要喂位置就够了：`syncHolders` 自己会记照面', () => {
  // 这一条走的是生产那条线（`SandboxScene` 每拍调一次 `syncHolders`），
  // 而不是测试里手调 `sampleEncounters`——上面三条验的是规则，这条验的是接线。
  const runtime = new MemoryRuntime({ worldId: 'encounter-wiring' });
  runtime.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'v1', type: 'character', at: { x: 1, y: 0 } },
  ]);
  // 日终走散。
  runtime.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'v1', type: 'character', at: { x: 40, y: 0 } },
  ]);

  seedEvent(runtime.world, 'ev_1', 1000);
  runtime.world.dayClosed(0, DAY_MS - 1);

  assert.ok(
    believeCount(runtime.world, 'v1') > 0,
    '`syncHolders` 喂进来的位置没有变成照面记录——生产里没人会额外调 `sampleEncounters`',
  );
});
