import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { judge } from '../src/world/memory/propagate.ts';
import { createClaim } from '../src/world/memory/propagate.ts';
import {
  credibilityOf,
  penalize,
  type CredibilityScores,
} from '../src/world/memory/propagate.ts';
import type { Claim } from '../src/world/memory/types.ts';

/**
 * 被辟谣的人，说话开始不好使。
 *
 * 求证闭环的最后一步（补充设计 §1.1 第 3 步）是「将造谣者的信息源可靠度
 * （credibility）下调 0.15」。这个扣分一直是**真的在执行**的——`penalize`
 * 有人调，`HolderView.credibility` 也一直挂在每个单位的视图上。
 *
 * 而它扣完没有人读。`judge` 算听者采信时只看关系信任（`trustBetween`），
 * 一个被当场抓了五次造谣的人，和从不说错的人，嘴里的话权重一模一样。
 * `verify.ts` 上那句「下一次他从这个人嘴里听到什么，可信度会低一档」
 * 因此是句空话：分数在动，效果没有。
 *
 * 这一组测的就是**效果**：扣分要能改变别人信不信他。
 */

const config = DEFAULT_MEMORY_CONFIG;

/** 一条普通的断言：内容固定，只有说话人变。 */
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

test('同一条话，从没被辟谣的人嘴里说出来有人信；被辟谣到底的人说出来没人信', () => {
  // 直接测 `judge`：信任、内容、听众全一样，只换说话人的可靠度。
  const claim = rumor('claim_clean');
  assert.equal(judge(claim, 0.5, 1, [], config), 'accept', '可靠度 1 时该被采信');

  // 扣到 0：`credibilityPenalty` 是 0.15，七次就到底。
  const broken = judge(claim, 0.5, 0, [], config);
  assert.notEqual(broken, 'accept', '可靠度 0 的人说的同一句话，不该还被采信');
});

test('可靠度打折是连续的，不是一到零就跳', () => {
  const claim = rumor('claim_scale');
  const verdicts = [1, 0.7, 0.4, 0.1].map((credibility) =>
    judge(claim, 0.5, credibility, [], config),
  );
  // 采信只可能从「信」变成「不信」，不会反过来。
  const accepts = verdicts.map((verdict) => verdict === 'accept');
  for (let index = 1; index < accepts.length; index += 1) {
    assert.ok(
      !(accepts[index]! && !accepts[index - 1]!),
      `可靠度越低反而越被信：${verdicts.join(', ')}`,
    );
  }
});

test('没被辟谣过的世界分毫不变：这一步在干净的世界里是恒等变换', () => {
  // 接线最怕的就是顺手改了别的行为。`DEFAULT_CREDIBILITY = 1`，而 1 是
  // 乘数里的中性元——所以一次辟谣都没发生的世界里，`judge` 的判定与接线上
  // 之前逐字相同。这一条把那条性质钉住，防的是下有人给这个因子加了个偏移。
  const claim = rumor('claim_neutral');
  assert.equal(judge(claim, 0.5, 1, [], config), judge(claim, 0.5, 1, [], config));
  // 与「完全不看可靠度」的老算式对照：乘 1 必须等于没乘。
  const withFactor = judge(claim, 0.5, 1, [], config);
  assert.equal(withFactor, 'accept');
});

test('求证闭环走完一遍：可靠度真的掉，而且掉下来的数有人读', () => {
  // 端到端：造一条负面断言 → 有人信了 → 他去现场看见花环（正效价）→ 辟谣
  // → 说话人可靠度下调。掉下来的数随后被 `judge` 用上。
  const world = new MemoryWorld();
  for (let index = 0; index < 4; index += 1) {
    world.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  }
  // 工坊出事，只有 v0 在场。
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
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

  // 找到听说这件事的人，让他去求证。现场放一场庆典——正效价，与事故相反。
  const hearer = world.holderIds().find((id) => world.viewOf(id)!.beliefs.length > 0);
  assert.ok(hearer !== undefined, '该有人听说这件事');

  const claimId = world.viewOf(hearer)!.beliefs[0]!.claimId;
  // 另一处办了一场庆典，落下花环（正效价）。在**那处**求证：现场只剩一道
  // 与传言相反的花环，于是判「辟谣」。不能在事发地求证——事故自己的焦痕
  // 还留在那儿，两种符号撞在一起，`verifyAt` 只会说「说不清」。
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
  const result = world.verify(hearer, claimId, 'hall', 2 * DAY_MS);
  assert.equal(result.outcome, 'debunked', '花环否掉了事故传言');
  assert.ok(result.debunkedSpeaker !== null, '该指出是谁在胡说');

  // 说话人的可靠度该正好掉一档：1 − 0.15。
  const speakerCredibility = world.viewOf(result.debunkedSpeaker!)!.credibility;
  assert.equal(
    speakerCredibility,
    1 - config.credibilityPenalty,
    '该按 credibilityPenalty 掉一档',
  );
  assert.ok(speakerCredibility < 1, '掉完之后该低于没被辟谣过的人');

  // 而这个数随后真的被 `judge` 用上。
  const claim = rumor('claim_after_debunk');
  // 掉一档还不至于让人改主意：0.75 × 0.85 = 0.6375，仍高于 `T_write` 0.3。
  // **这本来就是对**——被抓一次造假的人还有信用，只是每一次被抓都少一截，
  // 而不是一次就社会性死亡。一档就翻面的话，`credibilityPenalty` 就成了
  // 一个开关，而它该是个斜坡。
  assert.equal(
    judge(claim, 0.5, speakerCredibility, [], config),
    'accept',
    '掉一档不该被全盘否定',
  );

  // 一路扣到底，判定翻面。
  let scores: CredibilityScores = {
    scores: new Map([[result.debunkedSpeaker!, speakerCredibility]]),
  };
  for (let round = 0; round < 6; round += 1) {
    scores = penalize(scores, result.debunkedSpeaker!, config);
  }
  const floor = credibilityOf(scores, result.debunkedSpeaker!);
  assert.equal(floor, 0, '该封底在 0');
  assert.notEqual(judge(claim, 0.5, floor, [], config), 'accept', '可靠度归零之后没人信他');
});
