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

// ---------------------------------------------------------------- 从谁听来

/** 一张够用的名册。查不到的 id 一律返回 null——与场景那条 `?? null` 同一个口径。 */
const nameOf = (holderId: string): string | null =>
  ({ v1: '汐', v2: '炉匠', v3: '灯笼头' })[holderId] ?? null;

test('听来的记忆取来源链的末节——那是直接前手，不是最初的源头', () => {
  // `toldChainOf` 的返回形状是 `[claimId, ...上游, 讲的人]`：说话人排在最末。
  // 三跳的链是 `[claim, 甲, 乙, 讲的人]`，末节仍然是讲的人。
  const lines = memoryVoice(
    [
      hit(
        entry({
          sourceMode: 'heard',
          sourceChain: ['claim_7', 'v1', 'v2', 'v3'],
        }),
        0.8,
      ),
    ],
    12,
    nameOf,
  );
  assert.deepEqual(lines[0]!.heardFrom, { kind: 'person', name: '灯笼头' });
});

test('亲历、读到、从痕迹推出来的都没有「谁说的」', () => {
  for (const sourceMode of ['witnessed', 'read', 'inferred'] as const) {
    const lines = memoryVoice([hit(entry({ sourceMode }), 0.5)], 12, nameOf);
    assert.equal(lines[0]!.heardFrom, null, `${sourceMode} 不该有来源`);
  }
});

test('听来了，可那个人查不到：照实说查不到，不编一个名字', () => {
  const lines = memoryVoice(
    [hit(entry({ sourceMode: 'heard', sourceChain: ['claim_7', 'v9'] }), 0.5)],
    12,
    nameOf,
  );
  assert.deepEqual(
    lines[0]!.heardFrom,
    { kind: 'person', name: null },
    '查不到就是 null——面板那边会说「从一个不在这张图上的人听来」',
  );
});

test('空链是碑文，不是「查不到的人」：没有具体的人，是镇上的人都这么说', () => {
  // 全仓只有两处写 `sourceMode: 'heard'`：`rememberTold`（链至少两节）
  // 与 `inscribe`（碑文，链为空，注释原话是「大家都这么说，不是某一个人告诉我的」）。
  const lines = memoryVoice(
    [hit(entry({ sourceMode: 'heard', sourceChain: [], tier: 'legend' }), 0.5)],
    12,
    nameOf,
  );
  assert.deepEqual(lines[0]!.heardFrom, { kind: 'everyone' });
});

test('不给名册时一律查不到——默认值不假装认识谁', () => {
  const lines = memoryVoice([hit(entry({ sourceMode: 'heard', sourceChain: ['claim_7', 'v2'] }), 0.5)], 12);
  assert.deepEqual(lines[0]!.heardFrom, { kind: 'person', name: null });
});
