import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { judgeVerify, verifyAt } from '../src/world/memory/verify.ts';
import { createClaim } from '../src/world/memory/propagate.ts';
import type { Claim, MemoryEntry, Trace } from '../src/world/memory/types.ts';

/**
 * 求证成功之后，听说来的那条升级。
 *
 * 补充设计 §1.1 第 3 步有两半。前半句——「证实是假就发 `RumorDebunked`，
 * 可靠度下调 0.15」——一直是活的（`memory-credibility.test.ts` 那一组钉它）。
 * 后半句原先一处都没有：
 *
 *   「若在事发地目击到对应的物质痕迹（Trace），或在公告栏读到官方通告
 *     （AnnouncementRead），则将原 `heard` 记忆升级为 `witnessed / read`，
 *     置信度拉满。」
 *
 * 全仓 `sourceMode` 与 `confidence` 都只在条目**诞生**时写一次，之后再也不改。
 * 于是跑完一趟求证，他的记忆仍旧是 `heard`、可信度还是跳数打折后的那个数——
 * 「他亲自去现场看过」这件事在世界里没有留下任何痕迹。
 *
 * 这一组把后半句钉住：**痕迹定的案升 `witnessed`，公告定的案升 `read`**，
 * 两条路都通到 `confidence: 1`，而求证没成（辟谣、悬而未决）时记忆一动不动。
 */

/** 一条负面断言，和 `memory-credibility.test.ts` 里那条同形。 */
function rumor(claimId: string, confidence = 1): Claim {
  return createClaim({
    claimId,
    eventRef: 'ev_1',
    content: {
      what: '工坊炸了',
      who: ['v0'],
      where: 'foundry',
      when: 0,
      detailLevel: 3,
      valence: -0.4,
      arousal: 0.7,
    },
    originHolderId: 'v0',
    day: 0,
    confidence,
    secret: false,
  });
}

function scorch(traceId = 'tr_1'): Trace {
  return {
    traceId,
    placeId: 'foundry',
    eventRef: 'ev_1',
    layerType: 'scorch',
    intensity: 0.9,
    createdDay: 0,
    visibility: 1,
  };
}

/** 四个人加一间工坊。工坊必须在名册里且有落点——公告栏没地方站就没有广播。 */
function village(): MemoryWorld {
  const world = new MemoryWorld();
  for (let index = 0; index < 4; index += 1) {
    world.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  }
  world.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  return world;
}

/** 一件事只有 v0 在场，之后关一天门，让传言走出去。 */
function happen(world: MemoryWorld, eventId: string, kind: string, at: number): void {
  world.ingest({
    eventId,
    at,
    kind,
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['v0'],
  });
  world.createClaimFrom(eventId, 'v0', at);
  world.dayClosed(0, DAY_MS - 1);
}

/**
 * 第一个**听说**了这件事的人。
 *
 * 不能只挑「有信念的」——名册里那间工坊也挂着一条信念（`holderIds()` 还是按
 * id 排的，它排在所有人前面），而楼不会记住任何事，它的听下来的条目是空的。
 */
function hearerOf(world: MemoryWorld): string {
  const hearer = world.holderIds().find((id) => heardOf(world, id).length > 0);
  assert.ok(hearer !== undefined, '该有人听说这件事');
  return hearer;
}

/** 这个 Holder 听来的那些条目。 */
function heardOf(world: MemoryWorld, holderId: string): readonly MemoryEntry[] {
  return world.viewOf(holderId)!.memories.filter((entry) => entry.sourceMode === 'heard');
}

test('judgeVerify：定案的是痕迹还是公告，要多说一样', () => {
  const claim = rumor('claim_judge');

  const byTrace = judgeVerify({ traces: [scorch()], announcementClaims: [] }, claim);
  assert.equal(byTrace.outcome, 'confirmed');
  assert.equal(byTrace.evidence, 'trace', '现场有痕迹时是痕迹定的案');

  const posted = rumor('claim_posted');
  const byBoard = judgeVerify({ traces: [], announcementClaims: [posted] }, claim);
  assert.equal(byBoard.outcome, 'confirmed');
  assert.equal(byBoard.evidence, 'announcement', '现场干净、有公告时是公告定的案');

  const nothing = judgeVerify({ traces: [], announcementClaims: [] }, claim);
  assert.equal(nothing.outcome, 'inconclusive');
  assert.equal(nothing.evidence, null, '没人替他定案');

  // 薄门的契约一字未改：只问结果的人拿到的还是那三个词。
  assert.equal(verifyAt({ traces: [scorch()], announcementClaims: [] }, claim), 'confirmed');
  assert.equal(verifyAt({ traces: [], announcementClaims: [] }, claim), 'inconclusive');
});

test('痕迹定的案：听来的那条升成亲眼，可信度拉满，来源链清空', () => {
  const world = village();
  happen(world, 'ev_1', 'workshop_accident', 1000);
  const hearer = hearerOf(world);
  const claimId = world.viewOf(hearer)!.beliefs[0]!.claimId;

  const before = heardOf(world, hearer);
  assert.ok(before.length > 0, '该有一条听来的记忆');
  const heardConfidence = before[0]!.confidence;
  const heardChain = before[0]!.sourceChain;
  assert.ok(heardChain.length > 0, '听来的条目该挂着来源链');
  assert.ok(heardConfidence < 1, `听来的可信度该打过折，实际 ${heardConfidence}`);

  // 在事发地求证：事故自己的焦痕还留在那儿（−），与断言的负效价同向。
  const result = world.verify(hearer, claimId, 'foundry', 2 * DAY_MS);
  assert.equal(result.outcome, 'confirmed', '焦痕证实了事故传言');

  const after = world.viewOf(hearer)!.memories;
  const upgraded = after.find((entry) => entry.sourceMode !== 'heard' && entry.derivedFrom.claimIds.includes(claimId));
  assert.ok(upgraded !== undefined, '该有一条升级过的记忆');
  assert.equal(upgraded!.sourceMode, 'witnessed', '痕迹定的案升 witnessed');
  assert.equal(upgraded!.confidence, 1, '可信度拉满');
  assert.deepEqual(upgraded!.sourceChain, [], '亲眼看过就不再是转述，链该空着');
  assert.equal(upgraded!.memoryId, before[0]!.memoryId, '是同一条，不是新写一条');
  assert.equal(upgraded!.strength, before[0]!.strength, '强度不因求证而变');
  assert.deepEqual(upgraded!.content, before[0]!.content, '内容一字不动');

  // 报出来的 id 与真升了的那条对得上。
  assert.deepEqual(result.upgradedMemoryIds, [before[0]!.memoryId]);
});

test('公告定的案：听来的那条升成亲读', () => {
  // `expedition_done` 是正效价，而 `consequenceOf` 里没有它——它不留任何痕迹。
  // 于是现场是干净的，只能靠公告定案：这条路正好是 §1.1 后半句的另一半。
  const world = village();
  happen(world, 'ev_1', 'expedition_done', 1000);
  const hearer = hearerOf(world);
  const claimId = world.viewOf(hearer)!.beliefs[0]!.claimId;

  const before = heardOf(world, hearer);
  assert.ok(before.length > 0, '该有一条听来的记忆');

  const result = world.verify(hearer, claimId, 'foundry', 2 * DAY_MS);
  assert.equal(result.outcome, 'confirmed', '日报证实了这件事');

  const after = world.viewOf(hearer)!.memories;
  const upgraded = after.find((entry) => entry.derivedFrom.claimIds.includes(claimId) && entry.sourceMode !== 'heard');
  assert.ok(upgraded !== undefined, '该有一条升级过的记忆');
  assert.equal(upgraded!.sourceMode, 'read', '公告定的案升 read');
  assert.equal(upgraded!.confidence, 1, '可信度拉满');
  assert.deepEqual(upgraded!.sourceChain, [], '读过的记录不再是转述');
});

test('求证没成：记忆一动不动', () => {
  // 辟谣与悬而未决都只动信念（和可靠度），不动记忆。升级只在 `confirmed` 上发生。
  const world = village();
  happen(world, 'ev_1', 'workshop_accident', 1000);
  const hearer = hearerOf(world);
  const claimId = world.viewOf(hearer)!.beliefs[0]!.claimId;
  const before = heardOf(world, hearer)[0]!;

  // 另一处办了一场庆典：现场只剩一道与传言相反的花环 → 辟谣。
  world.ingest({
    eventId: 'ev_2',
    at: 2 * DAY_MS,
    kind: 'celebration',
    place: { placeId: 'hall', at: { x: 0, y: 3 }, indoor: false, placeType: 'plaza' },
    actors: ['v3'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.8,
    parentEventId: null,
    witnesses: ['v3'],
  });
  const debunked = world.verify(hearer, claimId, 'hall', 2 * DAY_MS);
  assert.equal(debunked.outcome, 'debunked');
  assert.deepEqual(debunked.upgradedMemoryIds, [], '辟谣不升级任何记忆');

  const afterDebunk = world.viewOf(hearer)!.memories.find((entry) => entry.memoryId === before.memoryId)!;
  assert.equal(afterDebunk.sourceMode, 'heard', '被辟谣的传闻还是听来的');
  assert.equal(afterDebunk.confidence, before.confidence, '可信度不动');

  // 一处什么都没有的地方：悬而未决。
  const nothing = world.verify(hearer, claimId, 'hill', 3 * DAY_MS);
  assert.equal(nothing.outcome, 'inconclusive');
  assert.deepEqual(nothing.upgradedMemoryIds, [], '悬而未决也不升级');

  const afterNothing = world.viewOf(hearer)!.memories.find((entry) => entry.memoryId === before.memoryId)!;
  assert.equal(afterNothing.sourceMode, 'heard', '没定案的传闻还是听来的');
  assert.equal(afterNothing.confidence, before.confidence, '可信度还是打折后那个数');
});

test('只升他自己听来的：别人的同一条传闻一动不动', () => {
  const world = village();
  happen(world, 'ev_1', 'workshop_accident', 1000);
  const hearer = hearerOf(world);
  const claimId = world.viewOf(hearer)!.beliefs[0]!.claimId;

  // 另一个也听说过的人。他的那条是他的，不因为第一个人跑了一趟就变成亲历。
  const other = world
    .holderIds()
    .find((id) => id !== hearer && heardOf(world, id).length > 0);
  if (other === undefined) return; // 这一局只有一个人听说，没什么可对照的
  const otherBefore = heardOf(world, other)[0]!;

  world.verify(hearer, claimId, 'foundry', 2 * DAY_MS);

  const otherAfter = world.viewOf(other)!.memories.find((entry) => entry.memoryId === otherBefore.memoryId)!;
  assert.equal(otherAfter.sourceMode, 'heard', '别人听来的还是听来的');
  assert.equal(otherAfter.confidence, otherBefore.confidence, '别人的可信度不动');
  assert.deepEqual(otherAfter.sourceChain, otherBefore.sourceChain, '别人的来源链不动');
});

test('亲眼记住的人不被这条路改动', () => {
  const world = village();
  happen(world, 'ev_1', 'workshop_accident', 1000);
  const hearer = hearerOf(world);
  const claimId = world.viewOf(hearer)!.beliefs[0]!.claimId;

  // v0 是当事人，他自己那条是 `witnessed`，而且 `derivedFrom.claimIds` 是空的——
  // 它不是听来的，求证这条路连筛选都过不去。
  const own = world.viewOf('v0')!.memories.find((entry) => entry.sourceMode === 'witnessed');
  if (own === undefined) return;
  const before = { mode: own.sourceMode, confidence: own.confidence, chain: own.sourceChain };

  world.verify(hearer, claimId, 'foundry', 2 * DAY_MS);

  const after = world.viewOf('v0')!.memories.find((entry) => entry.memoryId === own.memoryId)!;
  assert.equal(after.sourceMode, before.mode, '当事人自己的记忆不被动');
  assert.equal(after.confidence, before.confidence, '可信度不被动');
  assert.deepEqual(after.sourceChain, before.chain, '来源链不被动');
});

test('事件带上升级了哪几条', () => {
  const seen: { claimId: string; state: string; upgraded: readonly string[] }[] = [];
  const spy = new MemoryWorld({
    emit: (event) => {
      const payload = event.payload as { state?: unknown; claimId?: unknown; upgradedMemoryIds?: unknown };
      if (payload.state !== undefined) {
        seen.push({
          claimId: String(payload.claimId),
          state: String(payload.state),
          upgraded: (payload.upgradedMemoryIds as readonly string[] | undefined) ?? [],
        });
      }
    },
  });
  for (let index = 0; index < 4; index += 1) {
    spy.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  }
  spy.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  happen(spy, 'ev_1', 'workshop_accident', 1000);
  const hearer = hearerOf(spy);
  const claimId = spy.viewOf(hearer)!.beliefs[0]!.claimId;
  seen.length = 0;

  const result = spy.verify(hearer, claimId, 'foundry', 2 * DAY_MS);
  assert.equal(result.outcome, 'confirmed');

  const last = seen[seen.length - 1];
  assert.ok(last !== undefined, '求证该发一条 belief.updated');
  assert.equal(last.state, 'confirmed');
  assert.deepEqual(last.upgraded, result.upgradedMemoryIds, '事件里报的就是真升了的那几条');
  assert.ok(last.upgraded.length > 0, '至少该升了一条');
});
