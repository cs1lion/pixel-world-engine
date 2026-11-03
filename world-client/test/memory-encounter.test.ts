import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

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

test('街头小事落成方向性账：被撞的人掉信任，撞人的人只多一点愧疚', () => {
  const memory = new MemoryRuntime({ worldId: 'street-bond' });
  memory.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'v1', type: 'character', at: { x: 1, y: 0 } },
  ]);
  const change: WorldChange = {
    change: 'world.event',
    kind: 'street_tumble',
    text: '甲撞翻了乙的担子。',
    placeId: 'place:0,0',
    where: { x: 0, y: 0 },
    actorId: 'v0',
    otherId: 'v1',
  };
  const observation = observationOf(change, 'ev-street', {
    atOfHolder: (holderId) => (holderId === 'v1' ? { x: 1, y: 0 } : { x: 0, y: 0 }),
    atOfBuilding: () => undefined,
    buildingOfTask: () => undefined,
  });
  assert.ok(observation !== null, '有落点、有两位当事人的街头小事不该被翻译漏掉');
  assert.equal(observation.importanceHint, 0.65);
  memory.observe(observation, ['v0', 'v1'], 1000);

  const victim = memory.bondsOf('v1').find((bond) => bond.to === 'v0');
  assert.ok(victim !== undefined, '被撞的那一位没有对撞人者形成关系账');
  assert.equal(victim.trust, -0.22, '被撞的人对撞人者的 trust 读数不对');
  assert.equal(victim.warmth, -0.16);
  assert.ok(victim.evidence.includes('ev-street'), '关系改了，却指不回是那件事改的');

  const bump = memory.bondsOf('v0').find((bond) => bond.to === 'v1');
  assert.ok(bump !== undefined, '撞人者对被撞者那一头也应该有一笔（愧疚）');
  assert.equal(bump.trust, 0.04, '两个方向写成了同一个数——方向性账本就退化成了一条');
  assert.equal(bump.warmth, 0.03);

  const today = memory.dayTimelineFor('v1', 0);
  assert.equal(today.length, 1, '街头小事没有进被撞者的今日时间线');
  assert.equal(today[0]!.eventId, 'ev-street');
});

test('有记忆 vs 无记忆：低信任的人会主动避开同一个锚点', () => {
  const memory = new MemoryRuntime({ worldId: 'avoid-compare' });
  memory.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'v1', type: 'character', at: { x: 1, y: 0 } },
  ]);
  const change: WorldChange = {
    change: 'world.event',
    kind: 'street_tumble',
    text: '甲撞翻了乙的担子。',
    placeId: 'place:0,0',
    where: { x: 0, y: 0 },
    actorId: 'v0',
    otherId: 'v1',
  };
  const observation = observationOf(change, 'ev-avoid', {
    atOfHolder: (holderId) => (holderId === 'v1' ? { x: 1, y: 0 } : { x: 0, y: 0 }),
    atOfBuilding: () => undefined,
    buildingOfTask: () => undefined,
  });
  assert.ok(observation !== null);
  memory.observe(observation, ['v0', 'v1'], 1000);
  const cold = memory.bondsOf('v1').find((bond) => bond.to === 'v0');
  assert.ok(cold !== undefined && cold.trust < -0.15, '前置条件：被撞者的信任必须已经压到阈值下');

  const target = { x: 12, y: 9 };
  const makeSim = (): Simulation => {
    const grid = new WorldGrid({ width: 24, height: 18, border: 1, zones: [], regions: [] });
    return new Simulation({
      grid,
      buildings: [],
      altar: { x: 20, y: 9 },
      villagerName: '甲',
      initialNow: 6 * 3_600_000,
      worldSeed: 'avoid-test',
      wallClock: () => 1000,
      villagerProfiles: [
        { at: target, routine: [{ id: 'altar', label: '在祭坛边', going: '去祭坛边', target, dwellMs: 5000 }] },
        { at: target, routine: [{ id: 'altar', label: '在祭坛边', going: '去祭坛边', target, dwellMs: 5000 }] },
      ],
    });
  };

  const plain = makeSim();
  plain.setSocialContext({ relations: [], avoid: [] });
  for (let i = 0; i < 120; i += 1) plain.update(60_000);

  const remembered = makeSim();
  remembered.setSocialContext({
    relations: [],
    avoid: [{ villagerId: 'v1', otherId: 'v0' }],
  });
  for (let i = 0; i < 120; i += 1) remembered.update(60_000);

  const without = plain.livelinessStats().avoidedBeats;
  const withMemory = remembered.livelinessStats().avoidedBeats;
  assert.equal(without, 0, '没有记忆的那一遍不该跳过任何一拍');
  assert.ok(
    withMemory > 0,
    '记忆里已经压到阈值以下，行为层却一拍也没让开——闭环没接上',
  );
  assert.ok(
    withMemory >= without + 10,
    `有/无记忆的读数差太小：无 ${without}，有 ${withMemory}`,
  );
});
