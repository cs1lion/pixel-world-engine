import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

const grid = { isWalkable: () => true };

test('印象有方向：A 看见 B 交活，只写 A 对 B 的印象', () => {
  const memory = new MemoryRuntime({ worldId: 'impression-direction', occlusion: grid });
  memory.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'v1', type: 'character', at: { x: 12, y: 10 } },
  ]);
  memory.observe(
    {
      eventId: 'evt-imp-1',
      kind: 'task_done',
      placeId: 'place:workshop',
      at: { x: 10, y: 10 },
      actors: ['v0'],
      outcome: { what: '有人交了一单活' },
      importanceHint: 0.5,
      valence: 0.4,
      indoor: false,
    },
    ['v0', 'v1'],
    0,
  );

  const v1 = memory.viewOf('v1');
  const v0 = memory.viewOf('v0');
  assert.ok(v1 !== null && v0 !== null);
  const aboutV0 = v1!.memories.filter(
    (entry) => entry.kind === 'impression' && entry.content.who.includes('v0'),
  );
  assert.equal(aboutV0.length, 1, 'v1 应当对 v0 形成一条印象');
  assert.equal(aboutV0[0]!.holderId, 'v1', '印象的持有者是看见的人');
  assert.equal(
    v0!.memories.filter((entry) => entry.kind === 'impression' && entry.content.who.includes('v1')).length,
    0,
    'v0 没有看见 v1 干活，不该反向生成印象',
  );
});
