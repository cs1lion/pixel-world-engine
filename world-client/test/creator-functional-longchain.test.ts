/** 造物长链路：20+ 世界日里提案、落地、观测、拆除、重建，账本只增不改。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CreatorHarness } from './fixtures/creator-functional.ts';
import type { StoredLedgerRecord } from '../src/creator/ledger.ts';

type StoredObservation = Extract<StoredLedgerRecord, { kind: 'observation' }>;

function fileText(h: CreatorHarness): string {
  return readFileSync(h.ledger.path, 'utf-8');
}

function lineCount(text: string): number {
  return text.split('\n').filter((line) => line !== '').length;
}

function observations(h: CreatorHarness): StoredObservation[] {
  return h.ledger.readAll().filter((record): record is StoredObservation =>
    record.kind === 'observation'
  );
}

test('[长链路] 20+ 世界日：提案→落地→观测→拆除→重建，账本只增、proposalId 全挂回、观测不提前', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  // ---------- 第 0 日：真实提案 + 人工审批 + 真实 build + 落地门禁 ----------
  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null, '开局应当缺一个模板');
  const first = await h.landManual(plan, 0);
  assert.equal(h.snapshot().buildings.filter((item) => item.prefabId === plan.templateId).length, 1);

  const beforeObservation = fileText(h);
  assert.equal(lineCount(beforeObservation), 2, '一次造物只有 creation + landing');
  assert.equal(observations(h).length, 0, '第 0 日不该有观测');

  // ---------- 第 6 日：观测窗口未到，一行都不许写 ----------
  for (let index = 0; index < 6; index += 1) h.advanceDay();
  assert.equal(h.worldDay, 6);
  assert.equal(fileText(h), beforeObservation, '第 6 日账本必须逐字节不变');
  assert.equal(observations(h).length, 0, '第 6 日不许提前写观测');

  // ---------- 第 7 日：观测才落，day 与 dueDay 都是 7 ----------
  h.advanceDay();
  assert.equal(h.worldDay, 7);
  const firstObservation = observations(h);
  assert.equal(firstObservation.length, 1);
  assert.equal(firstObservation[0]?.day, 7);
  assert.equal(firstObservation[0]?.dueDay, 7);
  assert.equal(firstObservation[0]?.proposalId, first.creation.recordId);
  const afterObservation = fileText(h);
  assert.equal(lineCount(afterObservation), 3);
  assert.ok(
    afterObservation.startsWith(beforeObservation),
    '旧的 creation + landing 两行必须原样保留',
  );

  // ---------- 第 20 日：拆除不写账本；原地重建再写两条 ----------
  for (let index = 0; index < 13; index += 1) h.advanceDay();
  assert.equal(h.worldDay, 20);
  assert.equal(fileText(h), afterObservation, '跨日结算没有新观测就不写盘');

  const beforeDemolish = fileText(h);
  let demolished = h.demolishCommand(first.instanceId);
  if (!demolished.ok) {
    // 还有活指着楼时等一拍，仍用真实 demolish 命令。
    h.advanceDay();
    demolished = h.demolishCommand(first.instanceId);
  }
  assert.equal(demolished.ok, true, '真实 demolish 应成功');
  assert.equal(fileText(h), beforeDemolish, '拆除不是造物账本事件，不能写行');
  assert.equal(h.landedOf(first.instanceId), null);

  const rebuildDay = h.worldDay;
  const rebuilt = await h.landManual(plan, rebuildDay);
  assert.notEqual(rebuilt.instanceId, first.instanceId, '重建领新的实例号，旧号已被用掉');
  assert.notEqual(rebuilt.creation.recordId, first.creation.recordId, '重建是新提案，新 proposalId');
  const afterRebuild = fileText(h);
  assert.equal(lineCount(afterRebuild), 5, '重建再写 creation + landing 两条');
  assert.ok(afterRebuild.startsWith(beforeDemolish), '拆除前的三行必须原样保留');

  // ---------- 重建后的第 6 日仍不许提前写观测 ----------
  for (let index = 0; index < 6; index += 1) h.advanceDay();
  assert.equal(h.worldDay, rebuildDay + 6);
  assert.equal(fileText(h), afterRebuild, '重建后的第 6 日也不许写观测');
  assert.equal(observations(h).length, 1, '此时只应有第一次的观测');

  // ---------- 重建后的第 7 日：第二条观测落，dueDay 仍是 +7 ----------
  h.advanceDay();
  assert.equal(h.worldDay, rebuildDay + 7);
  const allObservations = observations(h);
  assert.equal(allObservations.length, 2);
  const secondObservation = allObservations.find(
    (record) => record.proposalId === rebuilt.creation.recordId,
  );
  assert.ok(secondObservation !== undefined, '第二次观测必须挂回第二次提案');
  assert.equal(secondObservation.day, rebuildDay + 7);
  assert.equal(secondObservation.dueDay, rebuildDay + 7);

  // ---------- 总账：行数只增、seq 连续、旧行未被改写、proposalId 全挂回 ----------
  const finalText = fileText(h);
  assert.equal(lineCount(finalText), 6);
  assert.ok(finalText.startsWith(afterRebuild), '重建后的旧行仍逐字节不变');

  const records = h.ledger.readAll();
  assert.deepEqual(records.map((record) => record.seq), [1, 2, 3, 4, 5, 6]);
  const creations = records.filter((record) => record.kind === 'creation');
  const landings = records.filter((record) => record.kind === 'landing');
  assert.equal(creations.length, 2);
  assert.equal(landings.length, 2);
  assert.equal(observations(h).length, 2);
  assert.equal(new Set(creations.map((record) => record.recordId)).size, 2);

  for (const creation of creations) {
    assert.equal(
      landings.filter((record) => record.proposalId === creation.recordId).length,
      1,
      `proposalId ${creation.recordId} 应恰有一条 landing`,
    );
    assert.equal(
      observations(h).filter((record) => record.proposalId === creation.recordId).length,
      1,
      `proposalId ${creation.recordId} 应恰有一条 observation`,
    );
  }
  for (const record of [...landings, ...observations(h)]) {
    assert.ok(
      creations.some((creation) => creation.recordId === record.proposalId),
      `${record.kind} ${record.recordId} 的 proposalId 必须挂回某次 admission`,
    );
  }

  // 两次 landing 的门禁都是落地后真实补测，覆盖率不是沿用提案时预测。
  for (const landing of landings) {
    assert.equal(landing.landed, true);
    assert.ok(landing.gates.some((gate) => gate.name === 'coverage' && gate.phase === 'landing'));
  }
});
