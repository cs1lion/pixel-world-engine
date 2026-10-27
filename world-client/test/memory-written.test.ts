import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG, DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { writeDiary, writeLetter, canRead, readRecord } from '../src/world/memory/written.ts';
import { witnessesOf } from '../src/world/memory/perception.ts';

/**
 * 五类通道里最慢、保真度最高的那一条：书面。
 *
 * 前面几个测试测的是「传得开、传得慢、传得歪」，这一组测的是相反的极端——
 * **一个字都不许变**。信件与日记是这个世界里唯一能把一条断言原样留给
 * 后来人的通道；如果它也跟着 `retell`，那五类通道就只剩四种保真度，
 * 而「档案」这个概念就没了立足点。
 */

function villagerWorld(ids: readonly string[]): MemoryWorld {
  const world = new MemoryWorld();
  ids.forEach((holderId, index) => {
    world.addHolder({
      holderId,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  });
  return world;
}

function seed(world: MemoryWorld, witnesses: readonly string[], at = 1000): void {
  world.ingest({
    eventId: 'ev_1',
    at,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: [witnesses[0] ?? 'a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses,
  });
}

test('一封信只装一条断言：多一条就整封写不成，不静默截断', () => {
  const world = villagerWorld(['a', 'b']);
  seed(world, ['a']);
  // 第二件事：同一地点、另一次事故。两条断言都是真的，都在库里。
  world.ingest({
    eventId: 'ev_2',
    at: 1100,
    kind: 'conflict',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['a'],
  });
  const c1 = world.createClaimFrom('ev_1', 'a', 1000)!;
  const c2 = world.createClaimFrom('ev_2', 'a', 1100)!;

  // 一条：写得成。
  assert.ok(
    world.writeLetter({ authorId: 'a', recipientId: 'b', claimIds: [c1.claimId], placeId: 'p', at: 1000 }) !== null,
  );
  // 两条：写不成。**不是**写一封只装第一条的信——那会让写信的人以为都寄了。
  assert.equal(
    world.writeLetter({ authorId: 'a', recipientId: 'b', claimIds: [c1.claimId, c2.claimId], placeId: 'p', at: 1000 }),
    null,
  );
});

test('读信：保真度不衰减，跳数归零', () => {
  const world = villagerWorld(['a', 'b']);
  seed(world, ['a']);
  const claim = world.createClaimFrom('ev_1', 'a', 1000)!;
  const letter = world.writeLetter({
    authorId: 'a',
    recipientId: 'b',
    claimIds: [claim.claimId],
    placeId: 'post_office',
    at: 1000,
  })!;

  const beliefs = world.readWritten('b', letter.recordId, 2000);
  assert.equal(beliefs.length, 1);
  // 关键：细节与可信度原样。口耳相传到这里已经是 hop 1、detail 2、confidence 0.8。
  const read = world.viewOf('b')!.beliefs[0]!;
  assert.equal(read.hop, 0, '读信不是听传言，跳数归零');
  assert.equal(read.confidence, 1, '信上的字不会因为隔了一天就变不可信');
  assert.equal(world.viewOf('b')!.memories[0]?.content.detailLevel ?? 3, 3);
});

test('私信只有收发两人能读，第三方读到的是空', () => {
  const world = villagerWorld(['a', 'b', 'c']);
  seed(world, ['a']);
  const claim = world.createClaimFrom('ev_1', 'a', 1000)!;
  const letter = world.writeLetter({
    authorId: 'a',
    recipientId: 'b',
    claimIds: [claim.claimId],
    placeId: 'p',
    at: 1000,
  })!;

  assert.equal(canRead(letter, 'a'), true);
  assert.equal(canRead(letter, 'b'), true);
  assert.equal(canRead(letter, 'c'), false, '信不是公告');
  assert.deepEqual(world.readWritten('c', letter.recordId, 2000), []);
  assert.equal(world.viewOf('c')!.beliefs.length, 0);
});

test('日记只有本人能读', () => {
  const world = villagerWorld(['a', 'b']);
  seed(world, ['a']);
  const diary = world.writeDiary({ authorId: 'a', placeId: 'home', at: 1000 })!;
  assert.ok(diary !== null, 'a 亲历了，日记写得成');
  assert.equal(canRead(diary, 'a'), true);
  assert.equal(canRead(diary, 'b'), false, '日记不给人看');
  assert.deepEqual(world.readWritten('b', diary.recordId, 2000), []);
  assert.equal(world.viewOf('b')!.beliefs.length, 0);
});

test('日记只收亲历的条目：听来的事写不进日记', () => {
  // 听来的东西写进日记，第二天自己读回来就会当成亲历——那是一条伪造的
  // 记忆来源，而来源链是这个世界唯一能追责的东西。
  const heard = {
    memoryId: 'm_heard',
    holderId: 'a',
    kind: 'episodic' as const,
    tier: 'day' as const,
    eventRefs: ['ev_x'] as [string],
    sourceMode: 'heard' as const,
    sourceChain: [],
    content: { what: '听说的', who: [], where: 'p', when: 0, detailLevel: 2, valence: 0, arousal: 0.3 },
    salience: 0.9,
    confidence: 0.8,
    strength: 1,
    createdDay: 0,
    lastRecalledDay: 0,
    recallCount: 0,
    flashbulb: false,
    pinned: false,
    redacted: false,
    derivedFrom: { memoryIds: [], claimIds: [] },
    generatedBy: { by: 'rule' as const, rulesetVersion: 't', inputHash: '0', seed: 0 },
    archived: false,
  };
  assert.equal(
    writeDiary({
      recordId: 'd',
      authorId: 'a',
      entries: [heard],
      day: 0,
      placeId: 'p',
      config: DEFAULT_MEMORY_CONFIG,
    }),
    null,
    '一天里只有听来的事，就没有日记可写',
  );
});

test('日记超量按显著度截断，一天最多 3 条', () => {
  const world = villagerWorld(['a']);
  // 一天里五件事，显著度各不同。
  for (let index = 0; index < 5; index += 1) {
    world.ingest({
      eventId: `ev_${index}`,
      at: 1000 + index,
      kind: index === 0 ? 'workshop_accident' : 'task_done',
      place: { placeId: 'p', at: { x: 0, y: 0 }, indoor: false },
      actors: ['a'],
      outcome: {},
      visibility: 'world',
      source: 'world',
      importanceHint: index === 0 ? 1 : 0.5,
      parentEventId: null,
      witnesses: ['a'],
    });
  }
  const diary = world.writeDiary({ authorId: 'a', placeId: 'home', at: 1000 })!;
  assert.equal(diary.claims.length, DEFAULT_MEMORY_CONFIG.diaryClaimsPerDay);
  assert.equal(diary.claims.length, 3);
  // 最显著的那条（事故）必须留下。
  assert.equal(diary.claims[0]!.eventRefs[0], 'ev_0');
});

test('`written.ts` 的纯函数：读不到返回空数组，不是 null', () => {
  // 调用方不该被逼着区分「没这条记录」与「不归你读」——两种情况下
  // 他看到的本来就都是什么都没有。
  const claim = {
    claimId: 'c1',
    eventRefs: ['e1'] as [string],
    content: { what: 'x', who: [], where: 'p', when: 0, detailLevel: 3, valence: 0, arousal: 0 },
    confidence: 1,
    hop: 0,
    sourceChain: [],
    originHolderId: 'a',
    createdDay: 0,
    secret: false,
    distortedBy: [],
  };
  assert.equal(writeLetter({
    recordId: 'r', authorId: 'a', recipientId: 'b', claims: [], day: 0, placeId: 'p',
    config: DEFAULT_MEMORY_CONFIG,
  }), null, '空信不写');

  const letter = writeLetter({
    recordId: 'r', authorId: 'a', recipientId: 'b', claims: [claim], day: 0, placeId: 'p',
    config: DEFAULT_MEMORY_CONFIG,
  })!;
  assert.deepEqual(readRecord(letter, 'z'), []);
  assert.equal(readRecord(letter, 'b').length, 1);
  assert.deepEqual(
    writeDiary({ recordId: 'd', authorId: 'a', entries: [], day: 0, placeId: 'p', config: DEFAULT_MEMORY_CONFIG }),
    null,
    '什么都没记住的那天没有日记',
  );
});

test('周摘要：第七天把这一周的日摘要压成一条，日摘要让位', () => {
  // `weekLength = 7`，触发在第 6 天（0 基）。前面六天的日摘要该被吸收。
  const world = villagerWorld(['a']);
  for (let day = 0; day < 7; day += 1) {
    world.ingest({
      eventId: `ev_${day}`,
      at: day * DAY_MS + 1000,
      kind: 'task_done',
      place: { placeId: 'p', at: { x: 0, y: 0 }, indoor: false },
      actors: ['a'],
      outcome: {},
      visibility: 'world',
      source: 'world',
      importanceHint: 1,
      parentEventId: null,
      witnesses: ['a'],
    });
    world.dayClosed(day, (day + 1) * DAY_MS - 1);
  }

  const memories = world.viewOf('a')!.memories;
  const weekly = memories.filter((entry) => entry.memoryId.startsWith('m_week_'));
  assert.equal(weekly.length, 1, `第 6 天该出周摘要，实际 ${weekly.length} 条`);
  assert.equal(weekly[0]!.createdDay, 6);
  // 被压进去的日摘要不再单列。
  const dailies = memories.filter((entry) => entry.memoryId.startsWith('m_sum_'));
  assert.deepEqual(dailies, [], '日摘要被周摘要吸收后不该还在');
  // 周摘要追得到那几天的事件。
  //
  // 不逐天断言：日摘要只收显著度过 `T_promote` 的片段，而这七件事的
  // 显著度算下来并不是每天都过线——`task_done` 的情绪与意外度都低。
  // 逐天断言会逼着实现「每天都必须出摘要」，那反过来会让摘要变成流水账。
  assert.ok(weekly[0]!.eventRefs.length > 0, '周摘要至少得追到一件事');
  assert.ok(
    weekly[0]!.eventRefs.every((ref) => ref.startsWith('ev_')),
    `周摘要里混进了不是事件的引用：${weekly[0]!.eventRefs.join(',')}`,
  );
  assert.ok(
    weekly[0]!.derivedFrom.memoryIds.length > 0,
    '周摘要得记着它是哪几条日摘要压出来的——删除级联靠它往下走',
  );
});

test('周摘要不在非周末那天出现', () => {
  const world = villagerWorld(['a']);
  world.ingest({
    eventId: 'ev_0',
    at: 1000,
    kind: 'task_done',
    place: { placeId: 'p', at: { x: 0, y: 0 }, indoor: false },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
  world.dayClosed(0, DAY_MS - 1);
  assert.deepEqual(
    world.viewOf('a')!.memories.filter((entry) => entry.memoryId.startsWith('m_week_')),
    [],
    '第 0 天不是周末',
  );
});

test('对话注入取 dialogueTopK 条，一般回忆取 budgetK 条', () => {
  const world = villagerWorld(['a']);
  for (let index = 0; index < 10; index += 1) {
    world.ingest({
      eventId: `ev_${index}`,
      at: 1000 + index,
      kind: 'task_done',
      place: { placeId: 'p', at: { x: 0, y: 0 }, indoor: false },
      actors: ['a'],
      outcome: {},
      visibility: 'world',
      source: 'world',
      importanceHint: 0.8,
      parentEventId: null,
      witnesses: ['a'],
    });
  }
  const base = { cues: {}, commit: false, nowDay: 0, seedKey: 's' } as const;
  assert.equal(
    world.recallFor('a', { ...base, budgetK: DEFAULT_MEMORY_CONFIG.budgetK }).hits.length,
    5,
  );
  assert.equal(world.recallForDialogue('a', base).hits.length, 3, '对话只塞 3 条，多了变流水账');
});

test('痕迹：走到跟前才看得见，隔远了看不见', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  world.addHolder({ holderId: 'near', type: 'character', profile: {}, at: { x: 2, y: 0 } });
  world.addHolder({ holderId: 'far', type: 'character', profile: {}, at: { x: 40, y: 0 } });
  world.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });

  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });

  assert.ok(world.lookAtTraces('near', 'foundry', 2000).length > 0, '隔 2 格该看得见焦痕');
  assert.deepEqual(world.lookAtTraces('far', 'foundry', 2000), [], '隔 40 格看不见');
  assert.equal(world.viewOf('far')!.memories.length, 0);
});

test('室内同房间：`indoorSameRoom` 关掉之后退回半径判定', () => {
  const grid = { isWalkable: () => true };
  const place = { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: true };
  const perceivers = [
    { holderId: 'inside', at: { x: 0, y: 0 }, inside: 'foundry' },
    { holderId: 'outside', at: { x: 1, y: 0 }, inside: null },
  ];

  // 默认：只有同房间的人在场。屋外隔一格也看不见。
  assert.deepEqual(witnessesOf({ place, perceivers, grid, config: DEFAULT_MEMORY_CONFIG }), ['inside']);

  // 关掉之后：室内也按半径算，屋外一格的看得见。
  const open = { ...DEFAULT_MEMORY_CONFIG, indoorSameRoom: false };
  assert.deepEqual(witnessesOf({ place, perceivers, grid, config: open }), ['inside', 'outside']);
});
