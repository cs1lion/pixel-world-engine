import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

const grid = { isWalkable: () => true };

test('个人时间线按天/时刻排序，每条都能对回事件 id', () => {
  const memory = new MemoryRuntime({ worldId: 'timeline', occlusion: grid });
  memory.syncHolders([{ holderId: 'v0', type: 'character', at: { x: 10, y: 10 } }]);
  memory.world.ingest({
    eventId: 'evt-late',
    at: 2 * 24 * 60 * 60 * 1000,
    kind: 'milestone',
    place: { placeId: 'place:altar', at: { x: 10, y: 10 }, indoor: false },
    actors: ['v0'],
    outcome: { what: '第二天的事' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
    valence: 0.5,
  });
  memory.world.ingest({
    eventId: 'evt-early',
    at: 60_000,
    kind: 'milestone',
    place: { placeId: 'place:altar', at: { x: 10, y: 10 }, indoor: false },
    actors: ['v0'],
    outcome: { what: '第一分钟的事' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
    valence: 0.5,
  });

  const timeline = memory.timelineFor('v0');
  assert.equal(timeline.length, 2);
  assert.deepEqual(
    timeline.map((entry) => entry.eventId),
    ['evt-early', 'evt-late'],
  );
  assert.ok(timeline.every((entry) => entry.memoryId.startsWith('m')));
});

test('今日时间线带上地点、对象与那句话，点开能对回记忆条目', () => {
  const memory = new MemoryRuntime({ worldId: 'today-timeline', occlusion: grid });
  memory.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'v1', type: 'character', at: { x: 11, y: 10 } },
  ]);
  memory.world.ingest({
    eventId: 'evt-street',
    at: 10 * 60_000,
    kind: 'street_tumble',
    place: { placeId: 'place:10,10', at: { x: 10, y: 10 }, indoor: false },
    actors: ['v0', 'v1'],
    outcome: { what: '甲撞翻了乙的担子。' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.65,
    parentEventId: null,
    witnesses: ['v0', 'v1'],
    valence: -0.5,
  });

  const today = memory.dayTimelineFor('v1', 0);
  assert.equal(today.length, 1, '今天经历过的事没有进时间线');
  assert.equal(today[0]!.eventId, 'evt-street');
  assert.equal(today[0]!.placeId, 'place:10,10');
  assert.deepEqual(today[0]!.actors, ['v0', 'v1']);
  assert.equal(today[0]!.what, '甲撞翻了乙的担子。');
  assert.ok(today[0]!.memoryId.startsWith('m'), '这一格没有记忆条目，面板点开无处可去');
});
