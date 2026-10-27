import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import type { MemoryEvent } from '../src/world/memory/types.ts';

/**
 * 断言在事件进来时自己诞生。
 *
 * 这一层是**传播的地基**，而它曾经整个不存在：`createClaimFrom` 在测试之外
 * 一个调用方都没有，`diffuseDay` 遍历的 `this.claims` 永远是空的。于是三天跑
 * 下来零次交谈、熵恒为 0、所有人被算成孤立——交谈、广播、书面、求证四条通道
 * 全都建在这层上面，一起是死的，而且不报错。单元测试全绿，因为每一层自己
 * 都测过了，只是没有人把它们接起来。
 *
 * 这一组测的是**接线本身**：断言会不会自己长出来，长在谁身上，长几条。
 */

function world(events: MemoryEvent[] = []): MemoryWorld {
  return new MemoryWorld({ emit: (event) => events.push(event) });
}

function incident(w: MemoryWorld, eventId: string, witnesses: readonly string[], at = 1000): void {
  w.ingest({
    eventId,
    at,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: [witnesses[0] ?? 'a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses,
  });
}

test('事件进来，断言自己就诞生了——不需要谁手工去造', () => {
  const w = world();
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  incident(w, 'ev_1', ['a']);
  // 断言一诞生，传播就有东西可传：跑一天，a 说给旁边的人听。
  w.addHolder({ holderId: 'b', type: 'character', profile: {}, at: { x: 1, y: 0 } });
  w.dayClosed(0, DAY_MS);

  assert.equal(
    w.viewOf('b')!.beliefs.length,
    1,
    '断言没有自己诞生——传播层会静默地整层失效',
  );
});

test('断言诞生在目击者身上，不在事件身上', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'b', type: 'character', profile: {}, at: { x: 1, y: 0 } });
  incident(w, 'ev_1', ['b', 'a']);

  const created = events.find((event) => event.kind === 'claim.created');
  assert.ok(created !== undefined, '该发出 claim.created');
  assert.equal(
    created.payload['originHolderId'],
    'b',
    '起源者按 witnesses 顺序取第一个——那是事件发生时最先在场的人',
  );
});

test('没人记住的事不诞生断言——没人会去讲一件自己都没当回事的事', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  // 显著度极低的事，且没有目击者：写不进任何人的记忆。
  w.ingest({
    eventId: 'ev_faint',
    at: 1000,
    kind: 'unknown',
    place: { placeId: 'p', at: { x: 0, y: 0 }, indoor: false },
    actors: [],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0,
    parentEventId: null,
    witnesses: [],
  });
  assert.equal(events.filter((event) => event.kind === 'claim.created').length, 0);
});

test('一件事只诞生一条断言：重复 ingest 同一个事件不会多出第二种说法', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  incident(w, 'ev_1', ['a']);
  incident(w, 'ev_1', ['a']);

  const created = events.filter((event) => event.kind === 'claim.created');
  assert.equal(created.length, 1, `同一个事件诞生了 ${created.length} 条断言`);
});

test('手工造过之后，事件进来不会再补一条', () => {
  const w = world();
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'b', type: 'character', profile: {}, at: { x: 1, y: 0 } });
  incident(w, 'ev_1', ['a']);
  const first = w.createClaimFrom('ev_1', 'a', 1000)!;
  const second = w.createClaimFrom('ev_1', 'b', 1100)!;
  assert.equal(second.claimId, first.claimId, '第二次该拿回同一条断言');
});

test('private_to_player 不诞生断言：村里的单位没有版本可讲', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  w.ingest({
    eventId: 'ev_secret',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false },
    actors: ['a'],
    outcome: { what: '有人改了点什么' },
    visibility: 'private_to_player',
    source: 'agent',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
  assert.equal(events.filter((event) => event.kind === 'claim.created').length, 0);
});

test('跑着的世界会自己传起来：三天之后不再全员孤立', () => {
  // 这条是端到端的：走 `MemoryRuntime`，只调 `observe()`，不手工造断言。
  // 之前这里的结果是「熵恒为 0、所有人孤立」——而那是一个看起来很正常的心电图。
  const vitals: { infoEntropy: number; isolatedHoldersCount: number }[] = [];
  const rt = new MemoryRuntime({ worldId: 'birth-e2e', onVitals: (vitals_) => vitals.push(vitals_) });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'c', type: 'character', at: { x: 2, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_1',
      kind: 'workshop_accident',
      placeId: 'p',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 1,
    },
    undefined,
    1000,
  );
  for (let day = 1; day <= 3; day += 1) rt.tick(day * DAY_MS);

  const known = ['a', 'b', 'c'].filter((id) => rt.viewOf(id)!.beliefs.length > 0).length;
  assert.ok(known > 1, `三天之后只有 ${known} 个人知道——断言没有诞生，或者传播没跑`);
  const last = vitals[vitals.length - 1]!;
  assert.ok(last.infoEntropy > 0, '有人在传，熵就不该是 0');
  assert.ok(last.isolatedHoldersCount < 3, '说过话的人不该被算成孤立');
});

test('显式给的效价，断言与记忆同一个数——不能一个 0.3 一个 0.8', () => {
  // `ingest` 里那条三级取值（显式 > 编译器 > kind 先验）算出来的 valence，
  // 原来**只在这个函数里用一次**：进了显著度与痕迹强度，却没有落进事实。
  // 事实里存的是 `input.voice` 原样，于是事后任何读 `contentForFact(fact)`
  // 的人——断言的内容就是其中一个——都只拿得到 kind 先验值。
  //
  // 结果：一次庆典显式给了 valence 0.3，目击者的记忆是 0.3，
  // 而同一条事件的断言是 `defaultValence('celebration')` 的 0.8。
  // 一件事两个版本，而 `ingest` 上面那段注释防的正是这个。
  const w = world();
  for (const id of ['a', 'b']) {
    w.addHolder({ holderId: id, type: 'character', profile: {}, at: { x: 0, y: 0 } });
  }
  w.ingest({
    eventId: 'ev_party',
    at: 1000,
    kind: 'celebration',
    place: { placeId: 'plaza', at: { x: 0, y: 0 }, indoor: false, placeType: 'plaza' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
    // 显式给一个**不是**先验值的数：celebration 的先验是 0.8。
    valence: 0.3,
    arousal: 0.55,
  });

  const claim = w.createClaimFrom('ev_party', 'a', 1000)!;
  const memory = w.viewOf('a')!.memories[0]!;

  assert.equal(claim.content.valence, 0.3, '断言该用显式给的效价');
  assert.equal(claim.content.arousal, 0.55, '断言该用显式给的唤醒度');
  assert.equal(
    claim.content.valence,
    memory.content.valence,
    '同一件事，断言与记忆的效价必须同一个数',
  );
  assert.equal(
    claim.content.arousal,
    memory.content.arousal,
    '同一件事，断言与记忆的唤醒度必须同一个数',
  );
  assert.notEqual(claim.content.valence, 0.8, '不该退回 kind 先验值');
});
