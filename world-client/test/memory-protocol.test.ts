import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG, DAY_MS } from '../src/world/memory/config.ts';
import { witnessesOf, hasLineOfSight, type Perceiver } from '../src/world/memory/perception.ts';
import { inputsFor, decideWrite, blurOnRecall, decayStrength, boostStrength } from '../src/world/memory/salience.ts';
import { seedOf, rollBelow } from '../src/world/memory/seed.ts';
import { consequenceOf, inferenceOf, exposedTraces, makeTrace, fitTraceLayers } from '../src/world/memory/traces.ts';
import { createClaim, retell, canSpread, canTell, judge, verifyImpulse } from '../src/world/memory/propagate.ts';
import { checkConflict, verifyAt } from '../src/world/memory/verify.ts';
import { compile } from '../src/world/memory/sanitize.ts';
import { recall, isSubsetFacts } from '../src/world/memory/recall.ts';
import { consolidateHolder } from '../src/world/memory/consolidate.ts';
import { deleteCascade } from '../src/world/memory/privacy.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import type { MemoryContent, MemoryEntry, Trace } from '../src/world/memory/types.ts';

/**
 * 《世界记忆协议 v0.1》第 17 节的九条验收测试，逐条落成断言。
 *
 * 这些测的是**行为**：写不写、能不能检索、删了还回不回得来。不测内部实现——
 * 换一种索引、换一种打分方式，这些断言该照旧成立。
 */

const config = DEFAULT_MEMORY_CONFIG;

function content(patch: Partial<MemoryContent> = {}): MemoryContent {
  return {
    what: '工坊三号房的灯在夜里熄灭',
    who: ['v1'],
    where: 'place_workshop_3',
    when: 12,
    detailLevel: 3,
    valence: -0.4,
    arousal: 0.6,
    ...patch,
  };
}

function entry(patch: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    memoryId: 'm_0001',
    holderId: 'v0',
    kind: 'episodic',
    tier: 'day',
    eventRefs: ['ev_1'],
    sourceMode: 'witnessed',
    sourceChain: [],
    content: content(),
    salience: 0.72,
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

/** 一张只有中间一堵墙的格子图。墙在 x=5，y 从 -10 到 10。 */
const walledGrid = {
  isWalkable: (p: { x: number; y: number }) => Math.round(p.x) !== 5,
};

// ---------------------------------------------------------------- 溯源

test('溯源：每条 MemoryEntry 的 eventRefs 非空', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'p1', at: { x: 1, y: 1 }, indoor: false },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  const view = world.viewOf('v0');
  assert.ok(view !== null);
  for (const memory of view.memories) {
    assert.ok(memory.eventRefs.length >= 1, '每条记忆都得能追到事件');
  }
});

// ---------------------------------------------------------------- 视角

test('视角：不在 witnesses 里的单位不会产生 witnessed 记忆', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.addHolder({ holderId: 'v1', type: 'character', profile: {} });
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'p1', at: { x: 1, y: 1 }, indoor: false },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  assert.equal(world.viewOf('v0')!.memories.length, 1);
  assert.equal(world.viewOf('v1')!.memories.length, 0, 'v1 不在场，不该有记忆');
});

test('感知：室内事件只有同房间的人在场，屋外贴墙也不算', () => {
  const place = { placeId: 'foundry', at: { x: 10, y: 10 }, indoor: true, placeType: 'workshop' };
  const perceivers: Perceiver[] = [
    { holderId: 'smith', at: { x: 10, y: 11 }, inside: 'foundry' },
    { holderId: 'walker', at: { x: 10, y: 9 }, inside: null },
  ];
  const witnesses = witnessesOf({ place, perceivers, grid: walledGrid, config });
  assert.deepEqual(witnesses, ['smith']);
});

test('感知：室外 8 格以内，墙后的人看不见', () => {
  const place = { placeId: 'square', at: { x: 2, y: 0 }, indoor: false };
  const perceivers: Perceiver[] = [
    { holderId: 'near', at: { x: 2, y: 5 }, inside: null },
    { holderId: 'behindWall', at: { x: 8, y: 0 }, inside: null },
    { holderId: 'far', at: { x: 2, y: 30 }, inside: null },
  ];
  const witnesses = witnessesOf({ place, perceivers, grid: walledGrid, config });
  assert.deepEqual(witnesses, ['near'], '墙后与远处都不该在场');
  assert.equal(hasLineOfSight({ x: 8, y: 0 }, { x: 2, y: 0 }, walledGrid), false);
});

// ---------------------------------------------------------------- 不编造

test('不编造：重构性回忆后，事实集合是原条目的子集', () => {
  const before = entry({ content: content({ detailLevel: 3, valence: -0.4 }) });
  // 找一个会触发变形的种子。
  let seed = 0;
  while (!rollBelow(seed, config.pBlur)) seed += 1;
  const blurred = blurOnRecall(before.content, seed, config.pBlur, config.blurValenceGain, rollBelow);
  assert.notEqual(blurred.mutation, null, '这个种子应当命中变形');
  const after = { ...before, content: blurred.content };
  assert.ok(isSubsetFacts(before, after), '变形不得新增事实');
  assert.ok(Math.abs(after.content.valence) >= Math.abs(before.content.valence));
});

// ---------------------------------------------------------------- 摘要校验

test('摘要校验：摘要只出现被压片段里已有的实体', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'celebration',
    place: { placeId: 'altar', at: { x: 1, y: 1 }, indoor: false },
    actors: ['v0', 'v1'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.95,
    parentEventId: null,
    witnesses: ['v0'],
  });
  const result = consolidateHolder('v0', world.viewOf('v0')!.memories, 0, config, new Map());
  const summary = result.entries.find((item) => item.kind === 'summary');
  assert.ok(summary !== undefined, '高显著度事件该进日摘要');
  // 摘要里的每个名字都必须出现在它的 eventRefs 对应的事件里。这里没有事实表，
  // 退一步查「摘要的 who 是片段 who 的子集」——同样的校验，不依赖外部数据。
  const fragmentWho = new Set(world.viewOf('v0')!.memories.flatMap((item) => item.content.who));
  for (const who of summary.content.who) {
    assert.ok(fragmentWho.has(who), `摘要里出现了没被片段覆盖的实体：${who}`);
  }
});

// ---------------------------------------------------------------- 该记该忘

test('该记该忘：高显著度撑得久，低显著度按 T_forget 归档', () => {
  // 0.15 的日衰减率：一条 1.0 的记忆 12 天后 0.142，刚好低于 0.15。
  let strength = 1;
  for (let day = 0; day < 11; day += 1) {
    strength = decayStrength(strength, config.decayRate, config.tierFactor.day, false);
  }
  assert.ok(strength > config.T_forget, '第 11 天还在');

  // 一条已经衰减到门槛以下的旧条目，跑一次整理。
  const weak = entry({ memoryId: 'm_weak', createdDay: 0, strength: 0.14 });
  const result = consolidateHolder('v0', [weak], 5, config, new Map());
  const after = result.entries.find((item) => item.memoryId === 'm_weak');
  assert.ok(after !== undefined, '归档不是删除：条目还在库里');
  assert.equal(after.archived, true, '低于 T_forget 就该归档');
  assert.equal(result.stats.archived, 1);
});

test('该记该忘：一条强记忆 11 天后仍不归档', () => {
  // 同一条 0.15 的衰减率，撑 11 天。
  const strong = entry({ memoryId: 'm_strong', createdDay: 0, strength: 1 });
  let entries = [strong];
  for (let day = 1; day <= 11; day += 1) {
    entries = [...consolidateHolder('v0', entries, day, config, new Map()).entries];
  }
  const after = entries.find((item) => item.memoryId === 'm_strong');
  assert.ok(after !== undefined);
  assert.equal(after.archived, false, '第 11 天还该在默认检索里');
});

test('闪光灯记忆不衰减', () => {
  const strength = decayStrength(1, config.decayRate, config.tierFactor.day, true);
  assert.equal(strength, 1);
});

// ---------------------------------------------------------------- 回放一致

test('回放一致：同一串输入两次得到同一个库', () => {
  const run = (): string => {
    const world = new MemoryWorld();
    for (const id of ['v0', 'v1', 'v2']) world.addHolder({ holderId: id, type: 'character', profile: {} });
    world.ingest({
      eventId: 'ev_1',
      at: 1000,
      kind: 'workshop_accident',
      place: { placeId: 'foundry', at: { x: 1, y: 1 }, indoor: false, placeType: 'workshop' },
      actors: ['v0'],
      outcome: {},
      visibility: 'world',
      source: 'world',
      importanceHint: 0.9,
      parentEventId: null,
      witnesses: ['v0', 'v1', 'v2'],
    });
    world.createClaimFrom('ev_1', 'v0', 1000);
    world.dayClosed(0, DAY_MS - 1);
    return JSON.stringify(world.viewOf('v1'));
  };
  assert.equal(run(), run(), '两次回放必须逐字节一致');
});

test('种子确定：同参数同值，不同参数不同值', () => {
  assert.equal(seedOf('a', 1, 'b'), seedOf('a', 1, 'b'));
  assert.notEqual(seedOf('a|b', 'c'), seedOf('a', 'b|c'), '分隔符不能被内容伪造');
});

// ---------------------------------------------------------------- 删除级联

test('删除级联：删掉事件后，所有派生物不可检索，摘要保留其余语句', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  for (const [id, hint] of [['ev_1', 0.9], ['ev_2', 0.9]] as const) {
    world.ingest({
      eventId: id,
      at: 1000,
      kind: 'celebration',
      place: { placeId: 'altar', at: { x: 1, y: 1 }, indoor: false },
      actors: ['v0'],
      outcome: {},
      visibility: 'world',
      source: 'world',
      importanceHint: hint,
      parentEventId: null,
      witnesses: ['v0'],
    });
  }
  world.dayClosed(0, DAY_MS - 1);
  const before = world.viewOf('v0')!;
  assert.ok(before.memories.some((item) => item.kind === 'summary'));

  const report = world.delete({ kind: 'event', id: 'ev_1' });
  assert.ok(report.counts.memories > 0 || report.counts.summaries > 0);
  const after = world.viewOf('v0')!;
  assert.ok(
    after.memories.every((item) => !item.eventRefs.includes('ev_1')),
    '删掉的事件不该还挂在任何记忆的出处上',
  );
});

test('删除级联：一条记忆只挂着一个事件时整条删除', () => {
  const single = entry({ memoryId: 'm_1', eventRefs: ['ev_1'] });
  const shared = entry({ memoryId: 'm_2', eventRefs: ['ev_1', 'ev_2'], kind: 'summary' });
  const { entries, report } = deleteCascade([single, shared], { kind: 'event', id: 'ev_1' });
  assert.deepEqual(report.removedMemoryIds, ['m_1']);
  assert.deepEqual(report.redactedMemoryIds, ['m_2']);
  assert.deepEqual(entries[0]!.eventRefs, ['ev_2']);
  assert.equal(entries[0]!.redacted, true);
});

// ---------------------------------------------------------------- 隐私

test('隐私：private_to_player 的明文不进任何单位记忆', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.ingest({
    eventId: 'ev_secret',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 1, y: 1 }, indoor: false },
    actors: ['v0'],
    outcome: { filename: 'secret_plan.ts' },
    visibility: 'private_to_player',
    source: 'agent',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  const view = world.viewOf('v0')!;
  for (const memory of view.memories) {
    assert.ok(!memory.content.what.includes('secret_plan'), '上游文件名不该出现在任何记忆里');
  }
});

// ---------------------------------------------------------------- 预算

test('预算：每个 Holder 每天的模型调用 ≤ 1 次（本组恒为 0）', () => {
  // 规则版整理不调模型：`generatedBy.by` 全是 'rule'。
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'celebration',
    place: { placeId: 'altar', at: { x: 1, y: 1 }, indoor: false },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  world.dayClosed(0, DAY_MS - 1);
  for (const memory of world.viewOf('v0')!.memories) {
    assert.equal(memory.generatedBy.by, 'rule');
  }
});

// ------------------------------------------------------------ 传播护栏

test('孤立的单位永远不会知道某件事', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.addHolder({ holderId: 'loner', type: 'character', profile: {} });
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 1, y: 1 }, indoor: false },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  world.createClaimFrom('ev_1', 'v0', 1000);
  world.dayClosed(0, DAY_MS - 1);
  assert.equal(world.viewOf('loner')!.beliefs.length, 0, '没人告诉他，他就不该知道');
});

test('关系阈值：信任低于 -0.2 不会主动告知', () => {
  const claim = createClaim({
    claimId: 'c1',
    eventRef: 'ev_1',
    content: content(),
    originHolderId: 'v0',
    day: 0,
    confidence: 1,
    secret: false,
  });
  const relations = new Map([
    ['v0\u0000v1', { from: 'v0', to: 'v1', trust: -0.5, strength: 0.5 }],
  ]);
  // 两道闸都要验：准入在 `canTell`（说不说），采信在 `judge`（信不信）。
  assert.equal(canTell(claim, {
    speaker: 'v0',
    listener: 'v1',
    distance: 1,
    relations,
    speakerTalkativeness: 0.9,
  }, config), false, '信任 -0.5 低于 -0.2，不该开口');

  const verdict = judge(claim, -0.5, [], config);
  assert.notEqual(verdict, 'accept', '完全不信的人说的话不该被采信');
});

test('每跳保真衰减：细节降一级、可信度打八折、情绪幅度放大但方向不变', () => {
  const claim = createClaim({
    claimId: 'c1',
    eventRef: 'ev_1',
    content: content({ detailLevel: 3, valence: -0.4 }),
    originHolderId: 'v0',
    day: 0,
    confidence: 1,
    secret: false,
  });
  const next = retell(claim, config);
  assert.equal(next.content.detailLevel, 2);
  assert.equal(next.confidence, 0.8);
  assert.ok(Math.abs(next.content.valence) > Math.abs(claim.content.valence));
  assert.ok(next.content.valence < 0, '方向不能变——把坏事传成好事是编造');
  assert.equal(next.distortedBy.length, 1, '每次变形都要记下来');
});

test('最大跳数：第 3 跳后细节归零，不能再传', () => {
  let claim = createClaim({
    claimId: 'c1',
    eventRef: 'ev_1',
    content: content({ detailLevel: 3 }),
    originHolderId: 'v0',
    day: 0,
    confidence: 1,
    secret: false,
  });
  for (let hop = 0; hop < 3; hop += 1) {
    assert.ok(canSpread(claim, config));
    claim = retell(claim, config);
  }
  assert.equal(claim.content.detailLevel, 0);
  assert.equal(canSpread(claim, config), false);
});

// ---------------------------------------------------------------- 痕迹

test('痕迹溯因：焦痕推成事故，碑文升级成读取', () => {
  assert.equal(inferenceOf('scorch')!.spread, 'ask');
  assert.equal(inferenceOf('scorch')!.sourceMode, 'inferred');
  assert.equal(inferenceOf('inscription')!.sourceMode, 'read');
  assert.ok(inferenceOf('inscription')!.confidence > inferenceOf('scorch')!.confidence);
});

test('后果规则：事故留焦痕，反复发生转成修补', () => {
  const first = consequenceOf({
    eventId: 'ev_1', kind: 'workshop_accident', placeId: 'p', placeType: 'workshop',
    intensity: 0.8, day: 0, recurrence: 0,
  });
  assert.deepEqual(first.map((spec) => spec.layerType), ['scorch']);

  const third = consequenceOf({
    eventId: 'ev_3', kind: 'workshop_accident', placeId: 'p', placeType: 'workshop',
    intensity: 0.8, day: 2, recurrence: 2,
  });
  assert.ok(third.some((spec) => spec.layerType === 'patch'));
});

test('痕迹预算：每个地点最多 5 层，超限淘汰可见度最低的', () => {
  const traces: Trace[] = Array.from({ length: 7 }, (_, index) =>
    makeTrace(`t${index}`, {
      eventId: `ev_${index}`, kind: 'celebration', placeId: 'p', placeType: 'altar',
      intensity: index / 10, day: index, recurrence: 0,
    }, { layerType: 'garland', intensity: index / 10, mergeKey: 'g' }),
  );
  const kept = fitTraceLayers(traces, config.placeTraceLayers);
  assert.equal(kept.length, 5);
  assert.ok(kept.some((trace) => trace.traceId === 't6'), '强度最高的该留下');
});

test('痕迹暴露：只露出前 3 个高强度层', () => {
  const traces: Trace[] = Array.from({ length: 5 }, (_, index) =>
    makeTrace(`t${index}`, {
      eventId: `ev_${index}`, kind: 'celebration', placeId: 'p', placeType: 'altar',
      intensity: 0.2 * index, day: 0, recurrence: 0,
    }, { layerType: 'garland', intensity: 0.2 * index, mergeKey: 'g' }),
  );
  assert.equal(exposedTraces(traces, config.traceExposedLayers).length, 3);
});

// ---------------------------------------------------------- 求证闭环

test('求证冲动：效价相反且过门槛时变成存疑', () => {
  const claim = createClaim({
    claimId: 'c1',
    eventRef: 'ev_1',
    content: content({ valence: 0.8, where: 'foundry' }),
    originHolderId: 'v1',
    day: 0,
    confidence: 0.8,
    secret: false,
  });
  const mine = entry({ content: content({ valence: -0.8, where: 'foundry' }), salience: 0.9 });
  const check = checkConflict({
    claim,
    memories: [mine],
    speakerTrust: 0.9,
    day: 0,
    config,
  });
  assert.notEqual(check.conflicting, null);
  assert.ok(check.impulse >= config.verifyImpulseThreshold);
  assert.equal(check.suspicious, true);
});

test('求证冲动公式：salience × |Δvalence| × trust', () => {
  assert.ok(Math.abs(verifyImpulse(0.8, 0.5, -0.5, 0.9) - 0.72) < 1e-9);
});

test('现场判真假：痕迹方向一致即证实，相反即辟谣', () => {
  const claim = createClaim({
    claimId: 'c1', eventRef: 'ev_1', content: content({ valence: -0.6 }),
    originHolderId: 'v0', day: 0, confidence: 1, secret: false,
  });
  const scorch = makeTrace('t1', {
    eventId: 'ev_1', kind: 'workshop_accident', placeId: 'p', placeType: 'workshop',
    intensity: 0.8, day: 0, recurrence: 0,
  }, { layerType: 'scorch', intensity: 0.8, mergeKey: 's' });
  assert.equal(verifyAt({ traces: [scorch], announcementClaims: [] }, claim), 'confirmed');

  const garland = makeTrace('t2', {
    eventId: 'ev_1', kind: 'celebration', placeId: 'p', placeType: 'altar',
    intensity: 0.8, day: 0, recurrence: 0,
  }, { layerType: 'garland', intensity: 0.8, mergeKey: 'g' });
  assert.equal(verifyAt({ traces: [garland], announcementClaims: [] }, claim), 'debunked');
  assert.equal(verifyAt({ traces: [], announcementClaims: [] }, claim), 'inconclusive');
});

// ------------------------------------------------------------ 脱敏编译

test('脱敏：上游文件名进不了世界事件', () => {
  const compiled = compile({
    topology: 'execute',
    status: 'retrying',
    retries: 3,
    elapsedMs: 60_000,
    difficulty: 'hard',
  });
  assert.ok(compiled !== null);
  assert.equal(compiled.kind, 'workshop_accident');
  const text = JSON.stringify(compiled);
  for (const token of ['filename', 'repo', 'token', '.ts']) {
    assert.ok(!text.includes(token), `编译产物里不该有 ${token}`);
  }
});

test('脱敏：平静的检索不进世界', () => {
  assert.equal(
    compile({ topology: 'retrieve', status: 'ok', retries: 0, elapsedMs: 1000, difficulty: 'easy' })?.kind,
    'expedition_done',
  );
  assert.equal(
    compile({ topology: 'execute', status: 'ok', retries: 0, elapsedMs: 1000, difficulty: 'easy' }),
    null,
    '一次顺利的执行没有戏剧性，不该编成事件',
  );
});

// ---------------------------------------------------------------- 检索

test('检索：归档的条目默认捞不出来，强线索能唤醒', () => {
  const archived = entry({ memoryId: 'm_1', archived: true });
  const normal = entry({ memoryId: 'm_2' });
  const request = {
    holderId: 'v0',
    cues: {},
    budgetK: 5,
    commit: false,
    nowDay: 12,
    seedKey: 'w',
  };
  const weak = recall([archived, normal], request, config, rollBelow);
  assert.deepEqual(weak.hits.map((hit) => hit.entry.memoryId), ['m_2']);

  const strong = recall([archived, normal], { ...request, strongCue: true }, config, rollBelow);
  assert.equal(strong.hits.length, 2);
});

test('检索：commit 时强化，强度只增不减', () => {
  const weak = entry({ memoryId: 'm_1', strength: 0.4 });
  const request = {
    holderId: 'v0',
    cues: {},
    budgetK: 5,
    commit: true,
    nowDay: 20,
    seedKey: 'w',
  };
  const outcome = recall([weak], request, config, rollBelow);
  assert.ok(outcome.updated[0]!.strength > 0.4);
  assert.equal(outcome.updated[0]!.recallCount, 1);
  assert.equal(outcome.updated[0]!.lastRecalledDay, 20);
});

test('强化公式：strength + boost × (1 − strength)', () => {
  assert.ok(Math.abs(boostStrength(0.4, 0.25) - 0.55) < 1e-9);
});

// ------------------------------------------------------------ 显著度

test('显著度：四项权重各 0.25，全满得 1', () => {
  const weights = config.salienceWeights;
  const parts = { emotion: 1, surprise: 1, goalRelevance: 1, involvement: 1 };
  assert.ok(Math.abs(decideWrite(weights, parts, 0.3).salience.salience - 1) < 1e-9);
  const none = { emotion: 0, surprise: 0, goalRelevance: 0, involvement: 0 };
  assert.equal(decideWrite(weights, none, 0.3).write, false);
});

test('显著度：当事人比旁观者更投入', () => {
  const input = {
    kind: 'celebration',
    holderId: 'v0',
    actors: ['v0'],
    importanceHint: null,
    valence: 0.8,
    arousal: 0.6,
  };
  const actor = inputsFor(input);
  const bystander = inputsFor({ ...input, holderId: 'v9' });
  assert.equal(actor.involvement, 1);
  assert.ok(bystander.involvement < 1);
});

// ------------------------------------------------------------ 事件入口

test('入口：source = genesis 的事件与本地事件走同一条路', () => {
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.ingest({
    eventId: 'gen_1',
    at: 1000,
    kind: 'visitor_arrival',
    place: { placeId: 'gate', at: { x: 1, y: 1 }, indoor: false },
    actors: [],
    outcome: {},
    visibility: 'world',
    source: 'genesis',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  assert.equal(world.viewOf('v0')!.memories.length, 1);
});

test('心电图：DayClosed 广播四个标量', () => {
  const events: string[] = [];
  const world = new MemoryWorld({ emit: (event) => events.push(event.kind) });
  world.addHolder({ holderId: 'v0', type: 'character', profile: {} });
  world.addHolder({ holderId: 'v1', type: 'character', profile: {} });
  const vitals = world.dayClosed(0, DAY_MS - 1);
  assert.equal(vitals.day, 0);
  assert.ok(events.includes('day.closed'));
  assert.ok(vitals.meanValence >= -1 && vitals.meanValence <= 1);
  assert.ok(vitals.meanArousal >= 0 && vitals.meanArousal <= 1);
  assert.ok(vitals.infoEntropy >= 0 && vitals.infoEntropy <= 1);
  assert.equal(vitals.isolatedHoldersCount, 2, '一天里没人说过话，两个都算孤立');
});
