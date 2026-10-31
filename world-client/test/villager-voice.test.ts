import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, memoryVoice } from '../src/world/memory/voice.ts';
import type { RecallHit } from '../src/world/memory/recall.ts';
import type { MemoryContent, MemoryEntry } from '../src/world/memory/types.ts';

/**
 * 读侧的最后一步：检索结果 → 她说得出口的话。
 *
 * 两条纪律各钉一条：`what` 原样不改写（改写就是造事实），顺序就是检索顺序
 * （排在前面的才是她此刻最先想起来的）。空数组是常态，不是错误。
 */

function content(patch: Partial<MemoryContent> = {}): MemoryContent {
  return {
    what: '汐在旧站牌下认路',
    who: ['v1'],
    where: 'place:18,22',
    when: 12,
    detailLevel: 3,
    valence: 0.1,
    arousal: 0.25,
    ...patch,
  };
}

function entry(patch: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    memoryId: 'm_0001',
    holderId: 'v1',
    // `MemoryEntry.kind` 是闭集；`routine_done` 只是 `RuntimeObservation.kind` 上的
    // 开放字符串，落进记忆库时已经被归成 episodic。这条测试验的是 `what` 原样与
    // `age`，与 kind 无关——用一个合法值，别让夹具替类型系统说话。
    kind: 'episodic',
    tier: 'day',
    eventRefs: ['ev_1'],
    sourceMode: 'witnessed',
    sourceChain: [],
    content: content(),
    salience: 0.5,
    confidence: 0.9,
    strength: 1,
    createdDay: 12,
    lastRecalledDay: 12,
    recallCount: 0,
    flashbulb: false,
    pinned: false,
    redacted: false,
    derivedFrom: { memoryIds: [], claimIds: [] },
    generatedBy: { by: 'rule', rulesetVersion: 'r1', inputHash: '1', seed: 1 },
    archived: false,
    ...patch,
  };
}

const hit = (e: MemoryEntry, score: number): RecallHit => ({ entry: e, score });

test('没想起什么就是空数组——空不是错', () => {
  assert.deepEqual(memoryVoice([], 12), []);
});

test('原文照搬：世界写下的那句不改写', () => {
  const lines = memoryVoice([hit(entry(), 0.8)], 12);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, '汐在旧站牌下认路', '改写记忆的措辞就是造事实');
  assert.equal(lines[0]!.memoryId, 'm_0001', '要能指回那一条');
});

test('顺序就是检索顺序，不重排', () => {
  const lines = memoryVoice(
    [
      hit(entry({ memoryId: 'm_1', content: content({ what: '甲' }) }), 0.9),
      hit(entry({ memoryId: 'm_2', content: content({ what: '乙' }) }), 0.7),
      hit(entry({ memoryId: 'm_3', content: content({ what: '丙' }) }), 0.5),
    ],
    12,
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    ['甲', '乙', '丙'],
    '排在前面的才是她此刻最先想起来的',
  );
});

test('距今多久说成人话', () => {
  assert.equal(ageLabel(0), '今天');
  assert.equal(ageLabel(1), '昨天');
  assert.equal(ageLabel(3), '3 天前');
  // 时钟不该倒着走；真倒了也不必编一个未来。
  assert.equal(ageLabel(-2), '今天');
});

test('age 按条目自己的创建日算', () => {
  const lines = memoryVoice([hit(entry({ createdDay: 10 }), 0.6)], 12);
  assert.equal(lines[0]!.age, '2 天前');
});
