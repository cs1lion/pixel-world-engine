import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biasFor, MEMORY_BIASES, misremember } from '../src/world/memory/distort.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { MemoryContent } from '../src/world/memory/types.ts';

const content: MemoryContent = {
  what: '有人交了一单活',
  who: ['v0'],
  where: 'place:workshop',
  when: 0,
  detailLevel: 3,
  valence: 0.3,
  arousal: 0.4,
};

test('四种偏差各改一处，并留下类型标记', () => {
  const detail = misremember(content, 'detail-substitution');
  assert.equal(detail.bias, 'detail-substitution');
  assert.equal(detail.content.where, '某个地方');
  assert.equal(detail.content.detailLevel, 1);

  const causal = misremember(content, 'causal-mismatch');
  assert.match(causal.content.what, /因果记反了/);
  assert.equal(causal.content.where, content.where);

  const time = misremember(content, 'time-shift');
  assert.equal(time.content.when, DAY_MS / 2);

  const person = misremember(content, 'wrong-person');
  assert.deepEqual(person.content.who, ['某人']);
  assert.equal(MEMORY_BIASES.length, 4);
});

test('同一事件 + 同一持有者永远得到同一种偏差（可回放）', () => {
  const first = biasFor('evt-x', 'v1');
  const second = biasFor('evt-x', 'v1');
  assert.equal(first, second);
  assert.ok(first === null || MEMORY_BIASES.includes(first));
});

test('听到的记忆会带偏差标记，eventRefs 仍指向真实事件', () => {
  const memory = new MemoryRuntime({ worldId: 'misremember-wiring', occlusion: { isWalkable: () => true } });
  memory.syncHolders([
    { holderId: 'worker', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'listener', type: 'character', at: { x: 12, y: 10 } },
  ]);
  // 找一条确定性会记错的 id，避免测试依赖运气。
  let eventId = '';
  for (let index = 0; index < 200; index += 1) {
    const candidate = `evt-bias-${index}`;
    if (biasFor(candidate, 'listener') !== null) {
      eventId = candidate;
      break;
    }
  }
  assert.notEqual(eventId, '', '应当能找到一条会记错的事件 id');

  memory.world.ingest({
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
  const view = memory.viewOf('listener');
  assert.ok(view !== null);
  const heard = view!.memories.find((entry) => entry.sourceMode === 'heard');
  assert.ok(heard !== undefined);
  assert.equal(heard!.bias, biasFor(eventId, 'listener'));
  assert.deepEqual(heard!.eventRefs, [eventId]);
});
