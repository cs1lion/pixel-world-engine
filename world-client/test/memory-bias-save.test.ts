import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biasFor } from '../src/world/memory/distort.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

const grid = { isWalkable: () => true };

test('bias 是可选的记忆字段：存档往返后仍在，时间线与事件 id 也对得上', () => {
  const source = new MemoryRuntime({ worldId: 'bias-save', occlusion: grid });
  source.syncHolders([
    { holderId: 'worker', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'listener', type: 'character', at: { x: 12, y: 10 } },
  ]);
  let eventId = '';
  for (let index = 0; index < 200; index += 1) {
    const candidate = `evt-save-bias-${index}`;
    if (biasFor(candidate, 'listener') !== null) {
      eventId = candidate;
      break;
    }
  }
  assert.notEqual(eventId, '', '需要一条会记错的事件 id');

  source.world.ingest({
    eventId,
    at: 0,
    kind: 'task_done',
    place: { placeId: 'place:street', at: { x: 10, y: 10 }, indoor: false },
    actors: ['worker'],
    outcome: { what: '有人交了一单活' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.5,
    parentEventId: null,
    witnesses: ['worker'],
    hearers: ['listener'],
    valence: 0.3,
  });

  const restored = new MemoryRuntime({ worldId: 'bias-save' });
  assert.equal(restored.fromJSON(source.toJSON()), true);
  restored.syncHolders([
    { holderId: 'worker', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'listener', type: 'character', at: { x: 12, y: 10 } },
  ]);

  const view = restored.viewOf('listener');
  assert.ok(view !== null);
  const heard = view!.memories.find((entry) => entry.sourceMode === 'heard');
  assert.ok(heard !== undefined, '往返后听来的条目还在');
  assert.equal(heard!.bias, biasFor(eventId, 'listener'), '偏差类型原样保留');
  assert.deepEqual(heard!.eventRefs, [eventId]);

  const timeline = restored.timelineFor('listener');
  assert.ok(timeline.some((entry) => entry.eventId === eventId));
});
