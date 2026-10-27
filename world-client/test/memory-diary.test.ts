import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import type { MemoryEvent } from '../src/world/memory/types.ts';

/**
 * 日终写日记。
 *
 * 协议第 7 节把日记列为整理的**表现产物**之一。`diary.written` 这个事件类型
 * 从第一版就在 `MemoryEventKind` 里，但除了手工调用 `writeDiary()` 之外
 * 从来没有在日终发生过——也就是说，这个世界里从来没有人写过日记。
 *
 * 这一组测的是「日终真的会写」，以及几条边界：不写摘要、不写听来的事、
 * 没亲历就不写。
 */

function world(events: MemoryEvent[] = []): MemoryWorld {
  return new MemoryWorld({ emit: (event) => events.push(event) });
}

function incident(w: MemoryWorld, eventId: string, at: number, witnesses: readonly string[]): void {
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

test('日终会写日记：亲历过的人有一条 diary.written', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  incident(w, 'ev_1', 1000, ['a']);
  w.dayClosed(0, DAY_MS - 1);

  const diaries = events.filter((event) => event.kind === 'diary.written');
  assert.equal(diaries.length, 1, `该有一条日记，实际 ${diaries.length} 条`);
  assert.equal(diaries[0]!.payload['authorId'], 'a');
});

test('什么都没亲历的人不写日记', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'hermit', type: 'character', profile: {}, at: { x: 200, y: 200 } });
  incident(w, 'ev_1', 1000, ['a']);
  w.dayClosed(0, DAY_MS - 1);

  const authors = events
    .filter((event) => event.kind === 'diary.written')
    .map((event) => event.payload['authorId']);
  assert.deepEqual(authors, ['a'], '离得远、什么都没看见的人没有日记可写');
});

test('日记不收摘要，只收当天的片段', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  // 显著度 1 的事，整理时会被挑中压成日摘要。
  incident(w, 'ev_1', 1000, ['a']);
  w.dayClosed(0, DAY_MS - 1);

  const diary = w.writtenOf('a').find((record) => record.kind === 'diary');
  assert.ok(diary !== undefined, '该有日记');
  assert.ok(diary.claims.length > 0);
  // 每一条都得能追到那件亲历的事，而不是追到一条摘要。
  for (const claim of diary.claims) {
    assert.deepEqual(claim.eventRefs, ['ev_1'], `日记里混进了摘要：${claim.eventRefs.join(',')}`);
  }
});

test('日记只有本人读得到，日终写的也一样', () => {
  const w = world();
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'b', type: 'character', profile: {}, at: { x: 1, y: 0 } });
  incident(w, 'ev_1', 1000, ['a']);
  w.dayClosed(0, DAY_MS - 1);

  const diary = w.writtenOf('a').find((record) => record.kind === 'diary')!;
  assert.deepEqual(w.writtenOf('b'), [], 'b 不该读得到 a 的日记');
  assert.equal(w.readWritten('b', diary.recordId, 2000).length, 0);
});

test('日终写的日记跨日还在，读回来是原样的', () => {
  const w = world();
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  incident(w, 'ev_1', 1000, ['a']);
  w.dayClosed(0, DAY_MS - 1);

  const diary = w.writtenOf('a').find((record) => record.kind === 'diary')!;
  const beliefs = w.readWritten('a', diary.recordId, 2 * DAY_MS);
  assert.ok(beliefs.length > 0, '第二天的自己该读得到第一天的日记');
  // 书面通道不随跳数衰减：读到的跳数是 0，可信度是写下来时的样子。
  for (const belief of beliefs) assert.equal(belief.hop, 0);
});

test('日记每天一条，不叠加', () => {
  const events: MemoryEvent[] = [];
  const w = world(events);
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  incident(w, 'ev_1', 1000, ['a']);
  w.dayClosed(0, DAY_MS - 1);
  incident(w, 'ev_2', DAY_MS + 1000, ['a']);
  w.dayClosed(1, 2 * DAY_MS - 1);

  const diaries = events.filter((event) => event.kind === 'diary.written');
  assert.equal(diaries.length, 2, '两天两条');
  assert.deepEqual(
    diaries.map((event) => event.at),
    [DAY_MS - 1, 2 * DAY_MS - 1],
    '每条记在它自己的日界时刻，不挤在同一刻',
  );
});
