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
