import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { innerVoiceOf } from '../src/world/memory/inner-voice.ts';
import type { MemoryEntry, Mood } from '../src/world/memory/types.ts';

const grid = { isWalkable: () => true };

function pair(): MemoryRuntime {
  const memory = new MemoryRuntime({ worldId: 'bonds-mood', occlusion: grid });
  memory.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'v1', type: 'character', at: { x: 12, y: 10 } },
    { holderId: 'v2', type: 'character', at: { x: 14, y: 10 } },
  ]);
  return memory;
}

function event(memory: MemoryRuntime, id: string, actor: string, valence: number, at: number, witnesses: string[]): void {
  memory.observe(
    {
      eventId: id,
      kind: 'task_done',
      placeId: 'place:workshop',
      at: { x: 10, y: 10 },
      actors: [actor],
      outcome: { what: `${actor} 完成了一件事` },
      importanceHint: 0.5,
      valence,
      indoor: false,
    },
    witnesses,
    at,
  );
}

test('Bond 方向性：A 三次正向目击只改 A→B，B→A 不变', () => {
  const memory = pair();
  for (let i = 0; i < 3; i += 1) {
    event(memory, `pos-${i}`, 'v1', 0.3, 1000 + i * 1000, ['v0', 'v1']);
  }
  const aToB = memory.bondOf('v0', 'v1');
  assert.ok(aToB !== null);
  assert.ok(aToB!.warmth > 0.2, `A→B warmth 应变好，实际 ${aToB!.warmth}`);
  assert.ok(aToB!.trust > 0.05, `A→B trust 应变好，实际 ${aToB!.trust}`);
  assert.equal(memory.bondOf('v1', 'v0'), null, 'B 没有目击 A，B→A 不该出现');
});

test('Bond 负向：三次负向变差但不清零，且不自动对称', () => {
  const memory = pair();
  for (let i = 0; i < 3; i += 1) {
    event(memory, `pos-${i}`, 'v1', 0.3, 1000 + i * 1000, ['v0', 'v1']);
  }
  const before = memory.bondOf('v0', 'v1')!;
  for (let i = 0; i < 3; i += 1) {
    event(memory, `neg-${i}`, 'v1', -0.6, 10_000 + i * 1000, ['v0', 'v1']);
  }
  const after = memory.bondOf('v0', 'v1')!;
  assert.ok(after.warmth < before.warmth, '负向之后 A→B 应变差');
  assert.ok(after.trust < before.trust, '负向之后 A→B 信任应变差');
  assert.notEqual(after.trust, 0, '不清零');
  assert.equal(memory.bondOf('v1', 'v0'), null, '仍然不该有 B→A');
});

function greet(memory: MemoryRuntime, day: number, index: number): void {
  memory.observe(
    {
      eventId: `greet-${day}-${index}`,
      kind: 'street_greet',
      placeId: 'place:street',
      at: { x: 10, y: 10 },
      actors: ['v0', 'v1'],
      outcome: { what: 'v0 朝 v1 点了下头' },
      importanceHint: 0.38,
      valence: 0.2,
      indoor: false,
    },
    ['v0', 'v1'],
    day * DAY_MS + index * 1000,
  );
}

test('日常照面：当天见 5 次也只积一次，不是 5 次', () => {
  const memory = pair();
  for (let index = 0; index < 5; index += 1) greet(memory, 0, index);
  memory.tick(DAY_MS);
  const bond = memory.bondOf('v0', 'v1');
  assert.ok(bond !== null, '见过一面就该留下关系账');
  assert.ok(bond!.warmth > 0 && bond!.warmth < 0.1, `一天只该积一小步，实际 ${bond!.warmth}`);
});

test('日常照面：天天见面 30 天有账但不满格，信任不动', () => {
  const memory = pair();
  for (let day = 0; day < 30; day += 1) {
    for (let index = 0; index < 3; index += 1) greet(memory, day, index);
    memory.tick((day + 1) * DAY_MS);
  }
  const bond = memory.bondOf('v0', 'v1');
  assert.ok(bond !== null, '30 天见面应当有账');
  assert.ok(bond!.warmth > 0.15 && bond!.warmth < 0.45, `warmth 应小额累积，实际 ${bond!.warmth}`);
  assert.ok(
    bond!.familiarity > 0.3 && bond!.familiarity < 0.9,
    `familiarity 应到熟识但不满格，实际 ${bond!.familiarity}`,
  );
  assert.equal(bond!.trust, 0, '日常照面不该改信任');
  assert.ok(memory.bondOf('v1', 'v0') !== null, '关系账双向都该有');
  assert.equal(memory.bondOf('v0', 'v2'), null, '没见过的不该凭空有账');
});

test('Bond 与 Mood 的 roundtrip：读档原样回来', () => {
  const memory = pair();
  event(memory, 'pos-0', 'v1', 0.4, 1000, ['v0', 'v1']);
  memory.tick(DAY_MS);
  const text = memory.toJSON();
  const restored = new MemoryRuntime({ worldId: 'bonds-mood-restored', occlusion: grid });
  assert.equal(restored.fromJSON(text), true);
  assert.deepEqual(restored.bondOf('v0', 'v1'), memory.bondOf('v0', 'v1'));
  assert.deepEqual(restored.moodOf('v0'), memory.moodOf('v0'));
  assert.deepEqual(restored.innerVoiceOf('v0'), memory.innerVoiceOf('v0'));
});

test('recall 关系权重：同一批记忆里，关系更近的人排在前面', () => {
  const memory = pair();
  for (let i = 0; i < 3; i += 1) {
    event(memory, `v1-${i}`, 'v1', 0.3, 1000 + i * 1000, ['v0', 'v1']);
  }
  event(memory, 'v2-0', 'v2', 0.3, 5000, ['v0', 'v2']);
  const outcome = memory.recallForDialogue('v0', {
    cues: {},
    commit: false,
    nowDay: 0,
    seedKey: 'recall-bonds',
  });
  assert.ok(outcome.hits.length > 0);
  assert.ok(outcome.hits[0]!.entry.content.who.includes('v1'), '关系更近的 v1 应排第一');
});

test('Mood：两条负事件后低于 -0.2；放 3 个世界日回到接近 0', () => {
  const memory = pair();
  event(memory, 'neg-0', 'v0', -0.6, 1000, ['v0']);
  event(memory, 'neg-1', 'v0', -0.6, 2000, ['v0']);
  memory.tick(DAY_MS);
  const afterDay = memory.moodOf('v0');
  assert.ok(afterDay !== null);
  assert.ok(afterDay!.valence < -0.2, `两条负事件后应 < -0.2，实际 ${afterDay!.valence}`);

  memory.tick(2 * DAY_MS);
  memory.tick(3 * DAY_MS);
  memory.tick(4 * DAY_MS);
  const afterThreeIdleDays = memory.moodOf('v0');
  assert.ok(afterThreeIdleDays !== null);
  assert.ok(
    Math.abs(afterThreeIdleDays!.valence) < 0.1,
    `放 3 个世界日应接近 0，实际 ${afterThreeIdleDays!.valence}`,
  );
});

test('inner-voice：同一事件在高低 mood 下模板 id 不同，且不改公开 bubble', () => {
  const entry: MemoryEntry = {
    memoryId: 'm-1',
    holderId: 'v0',
    kind: 'episodic',
    tier: 'day',
    eventRefs: ['e-1'],
    sourceMode: 'witnessed',
    sourceChain: [],
    content: {
      what: '炉匠修好了灯架',
      who: ['v1'],
      where: 'place:workshop',
      when: 1,
      detailLevel: 3,
      valence: 0.3,
      arousal: 0.4,
    },
    salience: 0.5,
    confidence: 1,
    strength: 1,
    createdDay: 0,
    lastRecalledDay: 0,
    recallCount: 0,
    flashbulb: false,
    pinned: false,
    redacted: false,
    derivedFrom: { memoryIds: [], claimIds: [] },
    generatedBy: { by: 'rule', rulesetVersion: 'test', inputHash: 'h', seed: 1 },
    archived: false,
  };
  const low: Mood = {
    holderId: 'v0', valence: -0.45, arousal: 0.7, label: '低落 · 紧绷',
    because: ['m-1'], updatedAt: 0, halfLifeDays: 1,
  };
  const high: Mood = {
    holderId: 'v0', valence: 0.45, arousal: 0.7, label: '轻快 · 紧绷',
    because: ['m-1'], updatedAt: 0, halfLifeDays: 1,
  };
  const bubble = '气泡原句：灯架稳了。';
  const lowVoice = innerVoiceOf('v0', low, [entry], []);
  const highVoice = innerVoiceOf('v0', high, [entry], []);
  assert.notEqual(lowVoice.templateId, highVoice.templateId, '同一事件在高/低 mood 下模板 id 必须不同');
  assert.ok(lowVoice.templateId.startsWith('inner.low.'));
  assert.ok(highVoice.templateId.startsWith('inner.high.'));
  assert.equal(bubble, '气泡原句：灯架稳了。', '内心生成不得改写公开气泡');
});
