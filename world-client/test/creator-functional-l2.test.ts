/** L2 跨日跨系统：拒绝入账、7 日观测三态、熔断爬梯、拆建后的覆盖率现算。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CreatorHarness, builtPrefabIdsOf, gateOf } from './fixtures/creator-functional.ts';
import { AutonomyLevel } from '../src/world/creator/fuse.ts';
import {
  evaluateLandingGates,
  evaluateProposalGates,
} from '../src/creator/ledger.ts';
import { checkLandedBuilding, creationCoverage } from '../src/creator/business-rules.ts';
import { landingReachable } from '../src/creator/landing.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

test('[L2] 熔断 requireReview：提案被拒，账本 rejectionGate=fuse，不落地', (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const before = h.snapshot().buildings.length;
  const outcome = h.proposeAuto();
  assert.ok(outcome !== null);

  assert.equal(outcome.creation.verdict, 'rejected');
  assert.equal(outcome.creation.rejectionGate, 'fuse');
  assert.equal(outcome.creation.rejection?.gate, 'fuse');
  assert.equal(outcome.creation.rejection?.kind, 'below_requirement');
  assert.equal(outcome.creation.rejection?.observed, 'requireReview');
  assert.equal(gateOf(outcome.gates, 'fuse').passed, false);
  assert.equal(gateOf(outcome.gates, 'coverage').passed, true, '覆盖率本身够，是熔断拦住');

  // 只记账，不产生落地记录，也不改世界。
  const records = h.ledger.readAll();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.kind, 'creation');
  assert.equal(h.snapshot().buildings.length, before);
  assert.equal(h.ledger.query({ rejectionGate: 'fuse' }).length, 1);
});

test('[L2] coverage 不足：真实拆掉两栋后提案被拒，账本 rejectionGate=coverage', (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const removed = h.demolishSome(2);
  assert.equal(removed.length, 2, '应能通过真实 demolish 命令拆掉两栋');
  assert.equal(h.snapshot().buildings.length, 7);

  const outcome = h.proposeAuto();
  assert.ok(outcome !== null);
  // 拆掉两栋后，缺的模板不止 waiting_shelter；planCreation 会挑当前缺的第一栋。
  assert.equal(h.pack.blueprints.has(outcome.creation.templateId), true);
  assert.equal(outcome.creation.verdict, 'rejected');
  assert.equal(outcome.creation.rejectionGate, 'coverage');
  assert.equal(outcome.creation.rejection?.kind, 'below_requirement');
  assert.equal(outcome.creation.rejection?.observed, 8 / 10);

  const coverage = gateOf(outcome.gates, 'coverage');
  assert.equal(coverage.passed, false);
  assert.equal(coverage.observed, 8 / 10);
  const fuse = gateOf(outcome.gates, 'fuse');
  assert.equal(fuse.passed, false, 'L0 同时也会 requireReview，但首个阻断项是 coverage');

  assert.equal(h.ledger.readAll().filter((record) => record.kind === 'landing').length, 0);
  assert.equal(h.ledger.query({ rejectionGate: 'coverage' }).length, 1);
});

test('[L2] 7 日观测 still_present：落地后第 7 世界日那栋还立着', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const outcome = await h.landManual(plan, 0);
  assert.equal(outcome.creation.day, 0);

  const day = h.advanceDays(7);
  assert.equal(day, 7);
  assert.equal(outcome.landing.replay.dayTo, 0);

  const folded = h.ledger.query({ templateId: 'waiting_shelter' });
  assert.equal(folded.length, 1);
  const observation = folded[0]?.lastObservation;
  assert.ok(observation !== null && observation !== undefined);
  assert.equal(observation.kind, 'observation');
  assert.equal(observation.status, 'still_present');
  assert.equal(observation.day, 7);
  assert.equal(observation.dueDay, 7);
  assert.equal(observation.buildingId, outcome.instanceId);
  assert.equal(h.removedIds.has(outcome.instanceId), false);
});

test('[L2] 7 日观测 removed：真实拆除后第 7 世界日记 removed', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const outcome = await h.landManual(plan, 0);

  // 等施工完成再用真实 demolish；等待也走世界时间。
  h.advanceDay();
  assert.equal(h.sim.snapshot().now, DAY_MS);
  const demolition = h.demolishCommand(outcome.instanceId);
  assert.equal(demolition.ok, true, demolition.message);
  assert.equal(h.removedIds.has(outcome.instanceId), true);
  assert.equal(h.landedOf(outcome.instanceId), null);

  const day = h.advanceDays(6);
  assert.equal(day, 7);
  const folded = h.ledger.query({ templateId: 'waiting_shelter' });
  const observation = folded[0]?.lastObservation;
  assert.ok(observation !== null && observation !== undefined);
  assert.equal(observation.status, 'removed');
  assert.equal(observation.day, 7);
  assert.equal(observation.dueDay, 7);
  assert.equal(observation.buildingId, outcome.instanceId);
});

test('[L2] 7 日观测 modified：记忆层改名后第 7 世界日记 modified', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const outcome = await h.landManual(plan, 0);

  const day6 = h.advanceDays(6);
  assert.equal(day6, 6);
  h.memory.setPlaceName(outcome.instanceId, '望江亭');
  assert.equal(h.memory.placeNameOf(outcome.instanceId)?.name, '望江亭');

  const day = h.advanceDay();
  assert.equal(day, 7);
  const folded = h.ledger.query({ templateId: 'waiting_shelter' });
  const observation = folded[0]?.lastObservation;
  assert.ok(observation !== null && observation !== undefined);
  assert.equal(observation.status, 'modified');
  assert.equal(observation.day, 7);
  assert.equal(observation.dueDay, 7);
  assert.equal(observation.detail.includes('望江亭'), true);
  // 楼还在，只是名字变了；不是 removed。
  assert.ok(h.landedOf(outcome.instanceId) !== null);
});

test('[L2] 熔断爬梯：真实造物到 L1；补真实覆盖率/冲突分母后第 14 天升 L2', async (t) => {
  const h = new CreatorHarness({ targetLevel: AutonomyLevel.L2 });
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const outcome = await h.landManual(plan, 0);
  assert.equal(h.engine.getRoleState('mapper')?.currentLevel, 0);

  // 第一扇窗：14 个世界日 + 一次真实落地的覆盖率/冲突/不变量证据。
  h.advanceDays(14);
  assert.equal(h.engine.getRoleState('mapper')?.currentLevel, 1, 'L0 → L1');
  assert.equal(h.engine.getRoleState('mapper')?.metrics.coverageChecks, 0, '升层后窗口清零');

  // 第二扇窗先只补 schema 证据，覆盖率/冲突分母仍是 0：13 天不能升 L2。
  h.engine.submitHumanApproval('mapper', 'schema-only', true);
  h.advanceDays(13);
  const stillL1 = h.engine.getRoleState('mapper');
  assert.equal(stillL1?.currentLevel, 1, '分母为 0 不算达标');
  assert.equal(stillL1?.metrics.conflictChecks, 0);
  assert.equal(stillL1?.metrics.invariantChecks, 0);

  // 第 14 天前，用真实世界现算一次覆盖率/冲突/不变量，再关日。
  const snapshot = h.snapshot();
  const landed = h.landedOf(outcome.instanceId);
  assert.ok(landed !== null);
  const business = await checkLandedBuilding(h.businessWorld(snapshot), landed);
  const coverage = creationCoverage(snapshot, h.pack.blueprints);
  const pathfindingConnected = landingReachable(h.world, landed);
  assert.equal(coverage, 1);
  assert.equal(business.hasConflict, false);
  h.engine.submitHumanApproval('mapper', 'real-observation', true, undefined, {
    coverageRate: coverage,
    pathfindingConnected,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    traceable: true,
    hasConflict: business.hasConflict,
    invariantViolated: business.invariantViolated,
    replayHashConsistent: true,
  });
  h.advanceDay();

  assert.equal(h.engine.getRoleState('mapper')?.currentLevel, 2, '补上真实分母后升 L2');

  // L2 放行要真实通过率：先补一条已批准的 schema 证据，再读真实 fuse 决策。
  h.engine.submitHumanApproval('mapper', 'schema-warmup', true);
  const decision = h.engine.getFuseDecision('mapper');
  assert.equal(decision.action, 'allow');
  const gates = evaluateProposalGates({
    origin: 'auto',
    schemaPassed: true,
    placementPassed: true,
    builtPrefabIds: builtPrefabIdsOf(h.snapshot(), h.pack),
    blueprintCount: h.pack.blueprints.size,
    templateId: 'waiting_shelter',
    fuseAction: decision.action,
    fuseReason: decision.reason,
    traceable: true,
  });
  const fuse = gateOf(gates, 'fuse');
  assert.equal(fuse.passed, true);
  assert.equal(fuse.observed, 'allow');
});

test('[L2] 拆掉再原地重建同模板：creationCoverage 现算 1.0→0.9→1.0，coverageChecks 递增', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const outcome = await h.landManual(plan, 0);
  assert.equal(creationCoverage(h.snapshot(), h.pack.blueprints), 1);

  // 等施工完成后真实拆除。
  h.sim.update(DAY_MS);
  const demolition = h.demolishCommand(outcome.instanceId);
  assert.equal(demolition.ok, true, demolition.message);
  assert.equal(h.snapshot().buildings.filter((b) => b.prefabId === 'waiting_shelter').length, 0);
  assert.equal(creationCoverage(h.snapshot(), h.pack.blueprints), 9 / 10);

  h.engine.submitHumanApproval('mapper', 'after-demolish', true, undefined, {
    coverageRate: 9 / 10,
    hasConflict: false,
    invariantViolated: false,
  });
  const coverageGateAfterRemove = gateOf(
    evaluateLandingGates({
      origin: 'manual',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: builtPrefabIdsOf(h.snapshot(), h.pack),
      blueprintCount: h.pack.blueprints.size,
      templateId: 'waiting_shelter',
      fuseAction: 'not_applicable',
      fuseReason: '人工入口',
      traceable: true,
      actualCoverageRate: creationCoverage(h.snapshot(), h.pack.blueprints),
      pathfindingConnected: true,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      invariantViolated: false,
      replayHashConsistent: true,
    }),
    'coverage',
  );
  assert.equal(coverageGateAfterRemove.passed, false);
  assert.equal(coverageGateAfterRemove.observed, 9 / 10);

  // 原地重建同模板：同 prefabId 在拆除后应当允许。
  const rebuilt = h.buildCommand(plan);
  assert.equal(rebuilt.result.ok, true, rebuilt.result.message);
  assert.equal(h.snapshot().buildings.filter((b) => b.prefabId === 'waiting_shelter').length, 1);
  assert.equal(creationCoverage(h.snapshot(), h.pack.blueprints), 1);

  h.engine.submitHumanApproval('mapper', 'after-rebuild', true, undefined, {
    coverageRate: creationCoverage(h.snapshot(), h.pack.blueprints),
    hasConflict: false,
    invariantViolated: false,
  });
  const metrics = h.engine.getRoleState('mapper')?.metrics;
  assert.equal(metrics?.coverageChecks, 3, '落地 1 次 + 拆后 1 次 + 重建 1 次');
  assert.equal(metrics?.coverageRate, 1);
});
