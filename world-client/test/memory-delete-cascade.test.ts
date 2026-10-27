import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import {
  cascadeBeliefs,
  cascadeClaims,
  cascadeLegends,
  cascadeTraces,
  deleteCascade,
} from '../src/world/memory/privacy.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import type { Belief, Legend, MemoryEntry, Trace } from '../src/world/memory/types.ts';

/**
 * 删除级联的**另外四库**。
 *
 * 协议第 15 节第 1 条点名的派生物是五样：记忆、摘要、信念副本、痕迹、传说。
 * 原先 `delete()` 只调 `deleteCascade`，另外四样一样没碰，而
 * `counts.traces` / `counts.legends` 是写死的 0、`counts.claims` 是
 * `root.kind === 'claim' ? 1 : 0` 拍出来的——`memory.deleted` 于是向外面
 * 汇报「清了两条记忆，别的一切正常」。
 *
 * 这一组测的是那四样真的被清了，以及清完之后**删除的事件不会复活**。
 * 全部走公开 API：能透过 `HolderView` 看见的东西，就该能透过它验。
 */

/** 一个 10 人的村，加一块公告栏落点。人都撒在一片 4×3 的格子上。 */
function village(): MemoryWorld {
  const world = new MemoryWorld({ worldId: 'del-cascade', grid: { isWalkable: () => true } });
  for (let i = 0; i < 10; i += 1) {
    world.addHolder({
      holderId: `v${i}`,
      type: 'character',
      profile: {},
      at: { x: i % 4, y: Math.floor(i / 4) },
    });
  }
  world.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 1, y: 0 } });
  return world;
}

/** 一件全员目击的大事。它会留下痕迹、诞生断言、扩散成传说。 */
function bigAccident(world: MemoryWorld, eventId = 'ev_big', at = 1000): void {
  world.ingest({
    eventId,
    at,
    kind: 'workshop_accident',
    place: { placeId: 'p1', at: { x: 1, y: 0 }, indoor: false },
    actors: ['v0', 'v1'],
    outcome: { what: '炉子炸了' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.95,
    parentEventId: null,
    witnesses: ['v0', 'v1', 'v2', 'v3', 'v4'],
  });
}

/** 跑够天数，让传说立起来。`qualifies` 要 `nowDay - firstDay >= 3`。 */
function runDays(world: MemoryWorld, days: number): void {
  for (let d = 0; d < days; d += 1) world.dayClosed(d, (d + 1) * DAY_MS);
}

function beliefsOn(world: MemoryWorld, eventId: string): readonly string[] {
  return world
    .holderIds()
    .flatMap((id) => world.viewOf(id)?.beliefs ?? [])
    .filter((belief) => belief.eventRefs.includes(eventId))
    .map((belief) => belief.holderId);
}

function tracesOn(world: MemoryWorld, placeId: string, eventId: string): readonly Trace[] {
  return (world.viewOf(placeId)?.traces ?? []).filter((trace) => trace.eventRef === eventId);
}

test('信念副本跟着走：删了事件，没人嘴里还当它是个真事', () => {
  const world = village();
  bigAccident(world);
  runDays(world, 7);
  assert.ok(beliefsOn(world, 'ev_big').length > 0, '前提：先得有人相信这件事');

  world.delete({ kind: 'event', id: 'ev_big' });
  assert.deepEqual(beliefsOn(world, 'ev_big'), [], '§15.1 把信念副本列在派生物名单里');
});

test('痕迹跟着走：删了事件，痕迹通道不再从它推断出事故', () => {
  const world = village();
  bigAccident(world);
  runDays(world, 7);
  assert.ok(tracesOn(world, 'p1', 'ev_big').length > 0, '前提：现场得先留下痕迹');

  world.delete({ kind: 'event', id: 'ev_big' });
  assert.deepEqual(tracesOn(world, 'p1', 'ev_big'), [], '§15.3：痕迹移除或中性化');
  // 这一条才是重点。痕迹不删，删掉的事会靠推断**复活**成一条新记忆。
  assert.deepEqual(world.lookAtTraces('v9', 'p1', 99 * DAY_MS), [], '现场没有那道焦痕了，不该还推断出东西');
});

test('别处的痕迹不动：删一个事件不碰别的落点', () => {
  const world = village();
  bigAccident(world, 'ev_big');
  world.ingest({
    eventId: 'ev_other',
    at: 2000,
    kind: 'celebration',
    place: { placeId: 'p1', at: { x: 1, y: 0 }, indoor: false },
    actors: ['v2'],
    outcome: { what: '开了个派对' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v2'],
  });
  runDays(world, 7);
  const otherBefore = tracesOn(world, 'p1', 'ev_other').length;
  assert.ok(otherBefore > 0, '前提：另一件事也得留下痕迹');

  world.delete({ kind: 'event', id: 'ev_big' });
  assert.equal(tracesOn(world, 'p1', 'ev_other').length, otherBefore, '不相干的那道该原样留着');
});

test('传说跟着走：一条传说只挂一个事件时整条删除', () => {
  const world = village();
  bigAccident(world);
  runDays(world, 7);
  assert.ok(world.legendsOf().length > 0, '前提：先得形成一条传说');

  world.delete({ kind: 'event', id: 'ev_big' });
  assert.deepEqual(world.legendsOf(), [], '§15.3：摘完空了就整条删');
});

test('传说摘而不删：还挂着别的事件时，只摘掉那一个出处', () => {
  // 走纯函数直接构造。多出处传说今天的来路是「摘要转成的断言」
  // （`claimOfEntry` 继承摘要的多 `eventRefs`），要凑齐那条链得跑十几天，
  // 而这里要钉的是规则本身。
  const legend: Legend = {
    legendId: 'legend_1',
    eventRefs: ['ev_a', 'ev_b'],
    variants: ['一句'],
    reach: 6,
    homePlaceId: 'p1',
    formedDay: 4,
  };
  const out = cascadeLegends([legend], { kind: 'event', id: 'ev_a' });
  assert.deepEqual(out.removed, [], '还剩一个出处，不该整条删');
  assert.deepEqual(out.stripped, ['legend_1']);
  assert.deepEqual(out.legends[0]!.eventRefs, ['ev_b'], '只摘掉被删的那一个');
});

test('断言跟着走，且删掉的事件再也生不出新断言', () => {
  const world = village();
  bigAccident(world);
  runDays(world, 7);

  world.delete({ kind: 'event', id: 'ev_big' });
  assert.equal(
    world.createClaimFrom('ev_big', 'v0', 99 * DAY_MS),
    null,
    '§15 末行：删了的事件不得再次被整理写回',
  );
});

test('counts 如实报告五样，不再有写死的 0', () => {
  const world = village();
  bigAccident(world);
  runDays(world, 7);

  const before = {
    beliefs: beliefsOn(world, 'ev_big').length,
    traces: tracesOn(world, 'p1', 'ev_big').length,
    legends: world.legendsOf().length,
  };
  const report = world.delete({ kind: 'event', id: 'ev_big' });

  assert.equal(report.counts.beliefs, before.beliefs, '报的数得等于真清了的数');
  assert.equal(report.counts.traces, before.traces);
  assert.equal(report.counts.legends, before.legends);
  assert.ok(report.counts.memories > 0, '记忆照旧在清');
  assert.equal(report.counts.claims, 1, '那件事的断言也该算一条');
});

test('断言根清信念副本：按 claimId 认，不按 eventRefs 猜', () => {
  const world = village();
  bigAccident(world);
  runDays(world, 7);
  const belief = (world.viewOf('v5')?.beliefs ?? []).find((b) => b.eventRefs.includes('ev_big'));
  assert.ok(belief !== undefined, '前提：得有个人信这件事');

  world.delete({ kind: 'claim', id: belief.claimId });
  assert.deepEqual(beliefsOn(world, 'ev_big'), [], '断言没了，从它听来的信念整条走');
});

test('记忆根沿 derived_from 级联：摘掉出处并标 redacted，不整条删', () => {
  const fragment = entry({ memoryId: 'm_frag', eventRefs: ['ev_1'] });
  const summary = entry({
    memoryId: 'm_sum',
    kind: 'summary',
    eventRefs: ['ev_1', 'ev_2'],
    derivedFrom: { memoryIds: ['m_frag', 'm_other'], claimIds: [] },
  });
  const out = deleteCascade([fragment, summary], { kind: 'memory', id: 'm_frag' });
  assert.deepEqual(out.report.removedMemoryIds, ['m_frag'], '被删的那条走');
  assert.deepEqual(out.report.redactedMemoryIds, ['m_sum'], '摘要留下，但标 redacted');
  const survivor = out.entries.find((e) => e.memoryId === 'm_sum')!;
  assert.deepEqual(survivor.derivedFrom.memoryIds, ['m_other'], '摘掉指向已删片段的那一环');
  assert.equal(survivor.redacted, true);
  // 它的 eventRefs 还撑着它——事件还在，整条删是删多了。
  assert.deepEqual(survivor.eventRefs, ['ev_1', 'ev_2']);
});

test('纯函数：信念只认两种根', () => {
  const belief: Belief = {
    holderId: 'v0',
    claimId: 'claim_1',
    eventRefs: ['ev_1'],
    confidence: 0.9,
    learnedDay: 1,
    sourceHolderId: 'v1',
    hop: 0,
    state: 'held',
  };
  assert.deepEqual(cascadeBeliefs([belief], { kind: 'event', id: 'ev_1' }).removed, ['claim_1']);
  assert.deepEqual(cascadeBeliefs([belief], { kind: 'claim', id: 'claim_1' }).removed, ['claim_1']);
  assert.deepEqual(cascadeBeliefs([belief], { kind: 'memory', id: 'm_1' }).removed, [], '记忆根碰不到信念');
  assert.deepEqual(cascadeBeliefs([belief], { kind: 'event', id: 'ev_2' }).removed, [], '别的事件不该顺手带走它');
});

test('纯函数：痕迹与断言都只认自己那一个 id', () => {
  const trace: Trace = {
    traceId: 't_1',
    placeId: 'p1',
    eventRef: 'ev_1',
    layerType: 'scorch',
    intensity: 0.8,
    createdDay: 1,
    visibility: 1,
  };
  assert.deepEqual(cascadeTraces([trace], { kind: 'event', id: 'ev_1' }).removed, ['t_1']);
  assert.deepEqual(cascadeTraces([trace], { kind: 'event', id: 'ev_2' }).removed, []);
  assert.deepEqual(
    cascadeClaims([{ claimId: 'c_1', eventRefs: ['ev_1', 'ev_2'] }], { kind: 'event', id: 'ev_2' }).removed,
    ['c_1'],
    '并集断言只要含被删事件就整条走——它讲的就是那件事',
  );
});

// ---------------------------------------------------------------- 帮手

function entry(patch: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    memoryId: 'm_0001',
    holderId: 'v0',
    kind: 'episodic',
    tier: 'day',
    eventRefs: ['ev_1'],
    sourceMode: 'witnessed',
    sourceChain: [],
    content: {
      what: '工坊三号房的灯在夜里熄灭',
      who: ['v1'],
      where: 'place_workshop_3',
      when: 12,
      detailLevel: 3,
      valence: -0.4,
      arousal: 0.6,
    },
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
    generatedBy: { by: 'rule', rulesetVersion: 'r1', inputHash: 'h', seed: 1 },
    archived: false,
    ...patch,
  };
}
