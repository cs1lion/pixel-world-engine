/** 拒绝的连续性、观测 missing 的账本口径，以及 proposalId 挂回。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CreatorHarness } from './fixtures/creator-functional.ts';
import {
  buildObservationRecord,
  foldLedger,
  observationOf,
} from '../src/creator/ledger.ts';

test('[拒绝] 连续三个世界日被同一道 fuse 门禁拒绝：三条 rejected 各自挂 proposalId，不落 landing/观测', (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const outcomes = [];
  for (let index = 0; index < 3; index += 1) {
    const outcome = h.proposeAuto();
    assert.ok(outcome !== null, `第 ${index + 1} 次仍应能提出候补`);
    outcomes.push(outcome);
    h.advanceDay();
  }
  assert.equal(h.worldDay, 3);

  const creations = h.ledger.readAll().filter((record) => record.kind === 'creation');
  assert.equal(creations.length, 3, '三次拒绝应留下三条只增行');
  assert.equal(h.ledger.readAll().length, 3, '拒绝不写 landing / observation');
  const recordIds = creations.map((record) => record.recordId);
  assert.equal(new Set(recordIds).size, 3, '每次拒绝的 proposalId 必须不同');
  assert.deepEqual(h.ledger.readAll().map((record) => record.seq), [1, 2, 3]);

  for (const [index, outcome] of outcomes.entries()) {
    assert.equal(outcome?.creation.verdict, 'rejected');
    assert.equal(outcome?.creation.rejectionGate, 'fuse');
    assert.equal(outcome?.creation.rejection?.kind, 'below_requirement');
    assert.equal(outcome?.creation.ladder.action, 'requireReview');
    assert.equal(
      creations[index]?.recordId,
      outcome?.creation.recordId,
      '读回的行就是本次拒绝的 proposalId',
    );
  }

  const folded = foldLedger(h.ledger.readAll());
  assert.equal(folded.length, 3);
  for (const entry of folded) {
    assert.equal(entry.landing, null, '被拒的提案不该有 landing');
    assert.equal(entry.observations.length, 0, '被拒的提案不该有观测');
  }
});

test('[观测] missing：第 6 日不写；快照找不到且无拆除记录时记 missing，proposalId 仍挂回创建', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const first = await h.landManual(plan, 0);
  assert.equal(h.ledger.readAll().length, 2);

  // 世界还没跑到第 7 日：不许提前写，账本仍是 creation + landing。
  for (let index = 0; index < 6; index += 1) h.advanceDay();
  assert.equal(h.worldDay, 6);
  assert.equal(h.ledger.readAll().length, 2);
  assert.equal(
    h.ledger.readAll().filter((record) => record.kind === 'observation').length,
    0,
  );

  // 真实命令无法制造「楼突然消失、又没有 building.removed」的世界状态；
  // 这里只验账本口径：把同一个 expected 交给判定函数，结果必须是 missing。
  const outcome = observationOf({
    expected: {
      prefabId: plan.templateId,
      origin: plan.at,
      door: plan.at,
    },
    current: null,
    removed: false,
    renamedTo: null,
  });
  assert.equal(outcome.status, 'missing');
  assert.match(outcome.detail, /没有拆除记录/);

  const record = buildObservationRecord({
    proposalId: first.creation.recordId,
    worldId: 'dengchao',
    day: 7,
    at: 7 * 86400000,
    dueDay: 7,
    buildingId: first.instanceId,
    status: outcome.status,
    detail: outcome.detail,
  });
  h.ledger.append(record);

  const observations = h.ledger.readAll().filter((entry) => entry.kind === 'observation');
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, 'missing');
  assert.equal(observations[0]?.proposalId, first.creation.recordId);
  assert.equal(observations[0]?.day, 7);
  assert.equal(observations[0]?.dueDay, 7);

  // proposalId 挂回后，折叠仍是一条造物，observations 里是刚写的 missing。
  const entry = foldLedger(h.ledger.readAll()).find(
    (item) => item.recordId === first.creation.recordId,
  );
  assert.ok(entry !== undefined);
  assert.equal(entry.landing?.landed, true);
  assert.equal(entry.observations.length, 1);
  assert.equal(entry.lastObservation?.status, 'missing');
});
