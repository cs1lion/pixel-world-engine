/** L1 单点：一次造物从计划到账本，以及十项门禁的正/反读数。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CreatorHarness, builtPrefabIdsOf, gateOf } from './fixtures/creator-functional.ts';
import {
  evaluateLandingGates,
  evaluateProposalGates,
  type GateInput,
} from '../src/creator/ledger.ts';
import { checkPlacement } from '../src/world/setup.ts';
import { checkLandedBuilding } from '../src/creator/business-rules.ts';
import { verifyCreationReplay } from '../src/creator/landing.ts';
import type { CreationPlan } from '../src/world/creator-schema.ts';

const GATE_NAMES = [
  'schema',
  'placement',
  'coverage',
  'pathfinding',
  'collision',
  'constraint',
  'traceability',
  'invariant',
  'replay',
  'fuse',
] as const;

function baseGateInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    origin: 'manual',
    schemaPassed: true,
    placementPassed: true,
    builtPrefabIds: new Set<string>(),
    blueprintCount: 10,
    templateId: 'waiting_shelter',
    fuseAction: 'not_applicable',
    fuseReason: '人工入口',
    traceable: true,
    actualCoverageRate: 1,
    pathfindingConnected: true,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    invariantViolated: false,
    replayHashConsistent: true,
    ...overrides,
  };
}

test('[L1] 单点链路：planCreation → 门禁读数 → enqueue → building.built → creation+landing 各一条', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null, '开局应当缺一个模板');
  assert.equal(plan.templateId, 'waiting_shelter');

  const outcome = await h.landManual(plan, 0);

  // 世界侧真的多了那一栋，而且事件来自真实 build 命令。
  assert.ok(h.landedOf(outcome.instanceId) !== null);
  const builtEvents = h.events.filter(
    (event) => event.change === 'building.built' && event.instanceId === outcome.instanceId,
  );
  assert.equal(builtEvents.length, 1, 'building.built 应当恰好一条');
  assert.equal(h.snapshot().buildings.filter((b) => b.prefabId === 'waiting_shelter').length, 1);

  // 账本：一次提案只有 creation + landing 两条；第 7 日观测还没到期。
  const records = h.ledger.readAll();
  assert.equal(records.filter((record) => record.kind === 'creation').length, 1);
  assert.equal(records.filter((record) => record.kind === 'landing').length, 1);
  assert.equal(records.length, 2, 'L1 单点只应有 creation + landing');
  const folded = h.ledger.query();
  assert.equal(folded.length, 1);
  assert.equal(folded[0]?.creation.verdict, 'accepted');
  assert.equal(folded[0]?.creation.rejectionGate, null);
  assert.equal(folded[0]?.landing?.landed, true);
  assert.equal(folded[0]?.observations.length, 0);

  // 提案记录带齐全十项读数：五项提案相位、五项落地相位。
  assert.deepEqual(
    outcome.creation.gates.map((gate) => gate.name).sort(),
    [...GATE_NAMES].sort(),
  );

  // 提案相位：schema / placement / coverage / traceability 正向；fuse 在人工入口是 not_applicable。
  for (const name of ['schema', 'placement', 'coverage', 'traceability'] as const) {
    assert.equal(gateOf(outcome.creation.gates, name).passed, true, `${name} 应通过`);
  }
  const fuse = gateOf(outcome.creation.gates, 'fuse');
  assert.equal(fuse.passed, null);
  assert.equal(fuse.reason, 'not_applicable');

  // 落地相位在提案时是 not_measured，不是提前算通过。
  for (const name of ['pathfinding', 'collision', 'constraint', 'invariant', 'replay'] as const) {
    const gate = gateOf(outcome.creation.gates, name);
    assert.equal(gate.passed, null, `${name} 提案时不该有结论`);
    assert.equal(gate.reason, 'not_measured');
  }

  // 落地门禁七项全部是真实读数且通过。
  assert.deepEqual(
    outcome.landingGates.map((gate) => gate.name).sort(),
    ['collision', 'constraint', 'coverage', 'invariant', 'pathfinding', 'replay', 'traceability'].sort(),
  );
  for (const gate of outcome.landingGates) {
    assert.equal(gate.passed, true, `${gate.name} 应通过，实际 ${String(gate.observed)}`);
  }
  assert.equal(gateOf(outcome.landingGates, 'coverage').observed, 1);
  assert.equal(outcome.business.hasConflict, false);
  assert.equal(outcome.business.invariantViolated, false);
  assert.equal(outcome.pathfindingConnected, true);
  assert.equal(outcome.replay, true, '冻结视图重跑应与实际落地一致');

  // 真实观测进了熔断窗口，而不是只写账本。
  assert.equal(h.engine.getRoleState('mapper')?.metrics.coverageChecks, 1);
  assert.equal(h.engine.getRoleState('mapper')?.metrics.conflictChecks, 1);
  assert.equal(h.engine.getRoleState('mapper')?.metrics.invariantChecks, 1);
  assert.equal(h.engine.getRoleState('mapper')?.metrics.replayChecks, 1);
});

test('[L1] 十项门禁：逐项钉正向与反向读数', async (t) => {
  const h = new CreatorHarness();
  const hNeg = new CreatorHarness();
  const hInvariant = new CreatorHarness();
  t.after(() => {
    h.dispose();
    hNeg.dispose();
    hInvariant.dispose();
  });

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  const positive = await h.landManual(plan, 0);

  // ---- schema：真实白名单校验通过；非法模板被拒。
  assert.equal(gateOf(positive.creation.gates, 'schema').passed, true);
  assert.throws(
    () => h.engine.proposeCreation({
      templateId: 'not_a_template',
      at: { x: 1, y: 1 },
      worldSize: { width: h.world.grid.width, height: h.world.grid.height },
    }),
    '非法模板应被白名单拒绝',
  );
  const schemaNeg = gateOf(
    evaluateProposalGates(baseGateInput({ schemaPassed: false, schemaDetail: '白名单拒绝' })),
    'schema',
  );
  assert.equal(schemaNeg.passed, false);
  assert.equal(schemaNeg.observed, false);

  // ---- placement：真实落点通过；同一格再落一次被占位判据拒绝。
  assert.equal(gateOf(positive.creation.gates, 'placement').passed, true);
  const occupied = checkPlacement(
    h.world.grid,
    h.blueprint(plan.templateId),
    positive.landed.origin,
  );
  assert.equal(occupied.ok, false, '落地后的原点已被占用');
  const placementNeg = gateOf(
    evaluateProposalGates(baseGateInput({ placementPassed: false, placementDetail: 'occupied' })),
    'placement',
  );
  assert.equal(placementNeg.passed, false);
  assert.equal(placementNeg.observed, false);

  // ---- coverage：新世界补最后一栋是 10/10；真实拆掉两栋后只剩 8/10。
  assert.equal(gateOf(positive.creation.gates, 'coverage').observed, 1);
  const removed = hNeg.demolishSome(2);
  assert.equal(removed.length, 2, '应能真实拆掉两栋');
  const afterDemolish = hNeg.snapshot();
  const builtAfter = builtPrefabIdsOf(afterDemolish, hNeg.pack);
  const coverageNeg = gateOf(
    evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: builtAfter,
      blueprintCount: hNeg.pack.blueprints.size,
      templateId: 'waiting_shelter',
      fuseAction: 'allow',
      fuseReason: '只看覆盖率',
      traceable: true,
    }),
    'coverage',
  );
  assert.equal(coverageNeg.passed, false);
  assert.equal(coverageNeg.observed, 8 / 10);
  assert.equal(coverageNeg.reason, 'below_requirement');

  // ---- pathfinding：真实落地门到镇心可达；反向分支用门禁输入（合法命令造不出围死的门）。
  assert.equal(gateOf(positive.landingGates, 'pathfinding').passed, true);
  const pathNeg = gateOf(
    evaluateLandingGates(baseGateInput({ pathfindingConnected: false })),
    'pathfinding',
  );
  assert.equal(pathNeg.passed, false);
  assert.equal(pathNeg.observed, false);

  // ---- collision：真实落地无重叠；反向喂「有重叠」。
  assert.equal(gateOf(positive.landingGates, 'collision').passed, true);
  const collisionNeg = gateOf(
    evaluateLandingGates(baseGateInput({ hasCollision: true })),
    'collision',
  );
  assert.equal(collisionNeg.passed, false);
  assert.equal(collisionNeg.observed, true);

  // ---- constraint：真实落位满足空间约束；反向喂不满足。
  assert.equal(gateOf(positive.landingGates, 'constraint').passed, true);
  const constraintNeg = gateOf(
    evaluateLandingGates(baseGateInput({ spatialConstraintSatisfied: false })),
    'constraint',
  );
  assert.equal(constraintNeg.passed, false);
  assert.equal(constraintNeg.observed, false);

  // ---- traceability：真实落位带来源；反向喂不可溯源。
  assert.equal(gateOf(positive.landingGates, 'traceability').passed, true);
  const traceNeg = gateOf(
    evaluateProposalGates(baseGateInput({ traceable: false })),
    'traceability',
  );
  assert.equal(traceNeg.passed, false);
  assert.equal(traceNeg.observed, false);

  // ---- invariant：真实落地不压摆件；反向用真实命令「先点灯再建楼」制造压件。
  assert.equal(gateOf(positive.landingGates, 'invariant').passed, true);
  const invariantPlan = hInvariant.engine.planCreation(hInvariant.view(0));
  assert.ok(invariantPlan !== null);
  hInvariant.sim.enqueue({ kind: 'miracle', miracle: 'light', at: invariantPlan.at });
  hInvariant.sim.update(16);
  const built = hInvariant.buildCommand(invariantPlan);
  assert.equal(built.result.ok, true, built.result.message);
  const invariantLanded = hInvariant.landedOf(built.instanceId);
  assert.ok(invariantLanded !== null);
  assert.ok(
    hInvariant.snapshot().props.some(
      (prop) => prop.at.x === invariantPlan.at.x && prop.at.y === invariantPlan.at.y,
    ),
  );
  const invariantBusiness = await checkLandedBuilding(
    hInvariant.businessWorld(),
    invariantLanded,
  );
  assert.equal(invariantBusiness.invariantViolated, true);
  const invariantNeg = gateOf(
    evaluateLandingGates(baseGateInput({
      invariantViolated: invariantBusiness.invariantViolated,
      pathfindingConnected: true,
    })),
    'invariant',
  );
  assert.equal(invariantNeg.passed, false);
  assert.equal(invariantNeg.observed, true);

  // ---- replay：真实冻结视图重跑一致；篡改重跑计划后不一致。
  assert.equal(gateOf(positive.landingGates, 'replay').passed, true);
  const tampered: CreationPlan = {
    ...positive.plan,
    at: { x: positive.plan.at.x + 1, y: positive.plan.at.y },
  };
  assert.equal(
    verifyCreationReplay({
      plan: positive.plan,
      replayed: tampered,
      landed: positive.landed,
      day: 0,
      blueprints: h.pack.blueprints,
    }),
    false,
  );
  const replayNeg = gateOf(
    evaluateLandingGates(baseGateInput({ replayHashConsistent: false })),
    'replay',
  );
  assert.equal(replayNeg.passed, false);
  assert.equal(replayNeg.observed, false);

  // ---- fuse：L0 真实决策是 requireReview；正向放行分支用同一份门禁输入钉住（真实 allow 在 L2 用例）。
  const decision = hNeg.engine.getFuseDecision('mapper');
  assert.equal(decision.action, 'requireReview');
  const fuseNeg = gateOf(
    evaluateProposalGates(baseGateInput({
      origin: 'auto',
      fuseAction: decision.action,
      fuseReason: decision.reason,
    })),
    'fuse',
  );
  assert.equal(fuseNeg.passed, false);
  assert.equal(fuseNeg.observed, 'requireReview');
  const fusePos = gateOf(
    evaluateProposalGates(baseGateInput({
      origin: 'auto',
      fuseAction: 'allow',
      fuseReason: '通过率足够高，可自动放行',
    })),
    'fuse',
  );
  assert.equal(fusePos.passed, true);
  assert.equal(fusePos.observed, 'allow');
});
