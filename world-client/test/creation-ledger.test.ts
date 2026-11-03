/** 造物账本的纯函数面：门禁读数、拒绝原因、折叠、JSONL 与文件存储。
 *
 * 这一组不启动世界：它钉的是账本自己的语义。世界里的那三条证据在
 * `creation-ledger-dayrun.test.ts`。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CREATION_LEDGER_VERSION,
  buildCreationRecord,
  buildLandingRecord,
  buildObservationRecord,
  coverageAfterBuild,
  creationVerdict,
  evaluateLandingGates,
  evaluateProposalGates,
  observationDueDay,
  OBSERVATION_WINDOW_DAYS,
  foldLedger,
  ledgerByteLength,
  ladderSnapshot,
  landingFingerprint,
  newRecordId,
  observationOf,
  parseLedgerJsonl,
  proposalFingerprint,
  queryLedger,
  serializeLedgerRecord,
  type GateInput,
  type GateName,
  type LadderSnapshot,
} from '../src/creator/ledger.ts';
import { JsonlLedgerFile } from '../src/creator/ledger-file.ts';
import { AutonomousFuseController } from '../src/world/creator/fuse.ts';
import { DEFAULT_FAST_TIME_SCALE } from '../src/world/real-clock.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import type { CreationPlan } from '../src/world/creator-schema.ts';
import type { LandedCreation } from '../src/creator/landing.ts';

const PLAN: CreationPlan = {
  templateId: 'waiting_shelter',
  at: { x: 40, y: 30 },
  palette: { body: 1, roof: 2, trim: 3, window: 4 },
};

const LANDED: LandedCreation = {
  instanceId: 'waiting_shelter#7',
  prefabId: 'waiting_shelter',
  origin: { x: 40, y: 30 },
  door: { x: 42, y: 32 },
};

function ladder(action: 'allow' | 'requireReview' = 'allow'): LadderSnapshot {
  const controller = new AutonomousFuseController(() => 0);
  controller.initRole('mapper', '地图师', 3, 3);
  const state = controller.getRoleState('mapper');
  assert.ok(state !== undefined);
  return ladderSnapshot(state, { action, reason: action === 'allow' ? '放行' : '要人点头' });
}

function gateInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    origin: 'auto',
    schemaPassed: true,
    placementPassed: true,
    builtPrefabIds: new Set(['ink_house', 'star_archive', 'workshop_plot']),
    blueprintCount: 4,
    templateId: 'waiting_shelter',
    fuseAction: 'allow',
    fuseReason: '未抽中，自动放行',
    traceable: true,
    ...overrides,
  };
}

function creationOf(
  gates: ReturnType<typeof evaluateProposalGates>,
  origin: 'auto' | 'manual' = 'auto',
  recordId = 'dengchao:waiting_shelter#7',
) {
  return buildCreationRecord({
    recordId,
    worldId: 'dengchao',
    seed: 'dengchao',
    day: 3,
    at: 3 * 24 * 60 * 60 * 1000,
    templateId: 'waiting_shelter',
    templateName: '候车亭',
    templateKind: 'industry',
    intentText: null,
    target: PLAN.at,
    origin,
    gates,
    ladder: ladder(),
    replay: {
      seed: 'dengchao',
      eventFrom: 0,
      eventTo: 0,
      dayFrom: 3,
      dayTo: 3,
      fingerprint: proposalFingerprint('dengchao', 3, PLAN),
    },
  });
}

// ---------------------------------------------------------------- 覆盖率读数

test('覆盖率按「建完之后」算：补上最后一种模板 = 1.0', () => {
  const coverage = coverageAfterBuild(
    new Set(['ink_house', 'star_archive', 'workshop_plot']),
    4,
    'waiting_shelter',
  );
  assert.equal(coverage.observed, 1);
  assert.match(coverage.detail, /3\/4.*4\/4/);
});

test('分母为 0 时覆盖率是 null，不是 0 或 1', () => {
  const coverage = coverageAfterBuild(new Set(), 0, 'waiting_shelter');
  assert.equal(coverage.observed, null);
  assert.match(coverage.detail, /分母为 0/);
});

test('已经落地过的模板不把覆盖率虚抬一次', () => {
  const coverage = coverageAfterBuild(new Set(['waiting_shelter']), 4, 'waiting_shelter');
  assert.equal(coverage.observed, 0.25);
});

// ---------------------------------------------------------------- 拒绝原因

test('合法白名单但覆盖率不足 → 该拒被拒，记下实际值与阈值', () => {
  const gates = evaluateProposalGates(
    gateInput({ builtPrefabIds: new Set(['ink_house']), blueprintCount: 30 }),
  );
  const verdict = creationVerdict('auto', gates);
  assert.equal(verdict.verdict, 'rejected');
  assert.equal(verdict.rejection?.gate, 'coverage');
  assert.equal(verdict.rejection?.kind, 'below_requirement');
  assert.equal(verdict.rejection?.threshold, '>= 0.95');
  const actual = verdict.rejection?.observed;
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs((actual as number) - 2 / 30) < 1e-9);
  assert.match(verdict.rejection?.detail ?? '', /2\/30/);
});

test('分母为 0 的覆盖率记成 not_measured，与真不达标分开', () => {
  const gates = evaluateProposalGates(gateInput({ blueprintCount: 0 }));
  const verdict = creationVerdict('auto', gates);
  assert.equal(verdict.rejection?.gate, 'coverage');
  assert.equal(verdict.rejection?.kind, 'not_measured');
  assert.equal(verdict.rejection?.observed, null);
});

test('熔断说 requireReview → 该拒，原因是 fuse 而不是覆盖率', () => {
  const gates = evaluateProposalGates(
    gateInput({ fuseAction: 'requireReview', fuseReason: '需要人工逐项确认' }),
  );
  const verdict = creationVerdict('auto', gates);
  assert.equal(verdict.verdict, 'rejected');
  assert.equal(verdict.rejection?.gate, 'fuse');
  assert.equal(verdict.rejection?.observed, 'requireReview');
  assert.equal(verdict.rejection?.threshold, '= allow');
});

test('人工确认放行：覆盖率没达标只记 overrides，不拦', () => {
  const gates = evaluateProposalGates(
    gateInput({
      origin: 'manual',
      builtPrefabIds: new Set(['ink_house']),
      blueprintCount: 30,
      fuseAction: 'not_applicable',
    }),
  );
  const verdict = creationVerdict('manual', gates);
  assert.equal(verdict.verdict, 'accepted');
  assert.equal(verdict.rejection, null);
  assert.deepEqual(verdict.overrides, ['coverage']);
});

test('四项都过 → 该过被过', () => {
  const gates = evaluateProposalGates(
    gateInput({
      builtPrefabIds: new Set(['ink_house', 'star_archive', 'workshop_plot']),
      blueprintCount: 4,
    }),
  );
  const verdict = creationVerdict('auto', gates);
  assert.equal(verdict.verdict, 'accepted');
  assert.equal(verdict.rejection, null);
  assert.deepEqual(verdict.overrides, []);
});

test('提案阶段的落地项一律 not_measured，不冒充通过', () => {
  const gates = evaluateProposalGates(gateInput());
  for (const name of ['pathfinding', 'collision', 'constraint', 'invariant', 'replay'] as const) {
    const gate = gates.find((item) => item.name === name);
    assert.ok(gate !== undefined);
    assert.equal(gate.reason, 'not_measured');
    assert.equal(gate.passed, null);
    assert.equal(gate.phase, 'landing');
  }
});

test('落地后的补测带真实值：门被堵死时寻路记 false', () => {
  const gates = evaluateLandingGates({
    ...gateInput(),
    actualCoverageRate: 1,
    pathfindingConnected: false,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    invariantViolated: false,
    replayHashConsistent: true,
  });
  const pathfinding = gates.find((item) => item.name === 'pathfinding');
  assert.ok(pathfinding !== undefined);
  assert.equal(pathfinding.observed, false);
  assert.equal(pathfinding.passed, false);
  assert.equal(pathfinding.reason, 'below_requirement');
});

// ---------------------------------------------------------------- 记录

test('创建记录带上拒绝原因、门禁读数与爬梯快照', () => {
  const gates = evaluateProposalGates(
    gateInput({ builtPrefabIds: new Set(['ink_house']), blueprintCount: 30 }),
  );
  const record = creationOf(gates);
  assert.equal(record.kind, 'creation');
  assert.equal(record.ledgerVersion, CREATION_LEDGER_VERSION);
  assert.equal(record.verdict, 'rejected');
  assert.equal(record.rejectionGate, 'coverage');
  assert.equal(record.rejection?.observed, 2 / 30);
  assert.equal(record.landing, null);
  assert.equal(record.ladder.levelName, 'L3');
  assert.equal(record.ladder.action, 'allow');
  assert.equal(record.replay.fingerprint, proposalFingerprint('dengchao', 3, PLAN));
  const gateNames = record.gates.map((gate) => gate.name);
  assert.ok(gateNames.includes('schema'));
  assert.ok(gateNames.includes('coverage'));
  assert.ok(gateNames.includes('fuse'));
});

test('落地记录用 proposalId 挂回，建筑 id 与实例对得上', () => {
  const creation = creationOf(evaluateProposalGates(gateInput()));
  const landing = buildLandingRecord({
    proposalId: creation.recordId,
    worldId: 'dengchao',
    seed: 'dengchao',
    day: 3,
    at: creation.at + 16,
    templateId: creation.templateId,
    landed: true,
    buildingId: LANDED.instanceId,
    origin: LANDED.origin,
    door: LANDED.door,
    gates: evaluateLandingGates({
      ...gateInput(),
      actualCoverageRate: 1,
      pathfindingConnected: true,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      invariantViolated: false,
      replayHashConsistent: true,
    }),
    replay: {
      seed: 'dengchao',
      eventFrom: 0,
      eventTo: 0,
      dayFrom: 3,
      dayTo: 3,
      fingerprint: landingFingerprint('dengchao', 3, PLAN, LANDED),
    },
    failure: null,
  });
  assert.equal(landing.recordId, `${creation.recordId}:landing`);
  assert.equal(landing.buildingId, LANDED.instanceId);
  assert.equal(landing.landed, true);
});

test('回放指纹覆盖种子与落点：改一处就变', () => {
  const first = landingFingerprint('dengchao', 3, PLAN, LANDED);
  const moved = landingFingerprint('dengchao', 3, PLAN, { ...LANDED, origin: { x: 41, y: 30 } });
  const otherSeed = landingFingerprint('default', 3, PLAN, LANDED);
  assert.notEqual(first, moved);
  assert.notEqual(first, otherSeed);
});

// ---------------------------------------------------------------- 7 日观测

test('7 日观测三态：仍在 / 被拆 / 被改 / 下落不明', () => {
  const expected = { prefabId: LANDED.prefabId, origin: LANDED.origin, door: LANDED.door };
  const current = { ...expected, displayName: '候车亭' };
  assert.equal(observationOf({ expected, current, removed: false, renamedTo: null }).status, 'still_present');
  assert.equal(observationOf({ expected, current: null, removed: true, renamedTo: null }).status, 'removed');
  assert.equal(observationOf({ expected, current: null, removed: false, renamedTo: null }).status, 'missing');
  assert.equal(
    observationOf({ expected, current: { ...current, origin: { x: 41, y: 30 } }, removed: false, renamedTo: null }).status,
    'modified',
  );
  assert.equal(
    observationOf({ expected, current, removed: false, renamedTo: '雨亭' }).status,
    'modified',
  );
});

test('dueDay 按世界日加 7：节奏 60 只改现实时长，不改世界日', () => {
  assert.equal(OBSERVATION_WINDOW_DAYS, 7);
  assert.equal(observationDueDay(0), 7);
  assert.equal(observationDueDay(12), 19);
  // 一世界日 = 24 世界小时 = DAY_MS；默认倍率 60 下现实 24 分钟。
  assert.equal(DAY_MS, 24 * 60 * 60 * 1000);
  assert.equal(DEFAULT_FAST_TIME_SCALE, 60);
  assert.equal(DAY_MS / DEFAULT_FAST_TIME_SCALE / 60000, 24);
  assert.equal(7 * 24, 168, '7 个世界日 = 168 分钟现实；账本仍按 7 个世界日算');
});

test('观测记录按 dueDay 定 recordId，重复追加不产生第二条', () => {
  const observation = buildObservationRecord({
    proposalId: 'dengchao:waiting_shelter#7',
    worldId: 'dengchao',
    day: 10,
    at: 10 * 24 * 60 * 60 * 1000,
    dueDay: 10,
    buildingId: LANDED.instanceId,
    status: 'still_present',
    detail: '仍立在 (40,30)',
  });
  assert.equal(observation.recordId, 'dengchao:waiting_shelter#7:observation:10');
});

// ---------------------------------------------------------------- 折叠与查询

test('折叠成每件造物一条：creation + landing + 观测', () => {
  const creation = creationOf(evaluateProposalGates(gateInput()));
  const landing = buildLandingRecord({
    proposalId: creation.recordId,
    worldId: 'dengchao',
    seed: 'dengchao',
    day: 3,
    at: creation.at + 16,
    templateId: creation.templateId,
    landed: true,
    buildingId: LANDED.instanceId,
    origin: LANDED.origin,
    door: LANDED.door,
    gates: evaluateLandingGates({ ...gateInput(), actualCoverageRate: 1, pathfindingConnected: true }),
    replay: {
      seed: 'dengchao', eventFrom: 0, eventTo: 0, dayFrom: 3, dayTo: 3,
      fingerprint: landingFingerprint('dengchao', 3, PLAN, LANDED),
    },
    failure: null,
  });
  const observation = buildObservationRecord({
    proposalId: creation.recordId,
    worldId: 'dengchao',
    day: 10,
    at: 10 * 24 * 60 * 60 * 1000,
    dueDay: 10,
    buildingId: LANDED.instanceId,
    status: 'removed',
    detail: '世界发过 building.removed',
  });
  const entries = foldLedger([creation, landing, observation]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.creation.recordId, creation.recordId);
  assert.equal(entries[0]?.landing?.buildingId, LANDED.instanceId);
  assert.equal(entries[0]?.lastObservation?.status, 'removed');
});

test('按世界日 / 模板 / 拒绝原因查询', () => {
  const accepted = creationOf(
    evaluateProposalGates(
      gateInput({ builtPrefabIds: new Set(['ink_house', 'star_archive', 'workshop_plot']) }),
    ),
    'auto',
    'ok',
  );
  const rejected = creationOf(
    evaluateProposalGates(gateInput({ builtPrefabIds: new Set(['ink_house']), blueprintCount: 30 })),
    'auto',
    'bad',
  );
  assert.deepEqual(queryLedger([accepted, rejected], { day: 3 }).map((e) => e.recordId), ['ok', 'bad']);
  assert.deepEqual(queryLedger([accepted, rejected], { templateId: 'waiting_shelter' }).length, 2);
  assert.deepEqual(queryLedger([accepted, rejected], { rejectionGate: 'coverage' }).map((e) => e.recordId), ['bad']);
  assert.deepEqual(queryLedger([accepted, rejected], { verdict: 'accepted' }).map((e) => e.recordId), ['ok']);
});

// ---------------------------------------------------------------- JSONL 与文件

test('JSONL 一行一条，读回来逐字段相同', () => {
  const record = creationOf(evaluateProposalGates(gateInput()));
  const text = `${serializeLedgerRecord({ ...record, seq: 1, recordedAt: '2026-11-03T00:00:00.000Z' })}\n`;
  const parsed = parseLedgerJsonl(text);
  assert.equal(parsed.length, 1);
  const first = parsed[0];
  assert.equal(first?.kind, 'creation');
  if (first?.kind !== 'creation') throw new Error('读回来的不是 creation 记录');
  assert.deepEqual(first.target, PLAN.at);
  assert.equal(first.seq, 1);
});

test('坏行抛错，不静默跳过', () => {
  assert.throws(() => parseLedgerJsonl('{"kind":"creation"}\n'), /ledgerVersion|不是认识的记录/);
  assert.throws(() => parseLedgerJsonl('not json\n'), /不是合法 JSON/);
});

test('文件存储：只追加、同一 recordId 不写第二遍、字节数可读', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-ledger-'));
  try {
    const path = join(dir, 'dengchao.jsonl');
    const file = new JsonlLedgerFile(path);
    const creation = creationOf(evaluateProposalGates(gateInput()));

    const first = file.append(creation);
    assert.equal(first.duplicate, false);
    assert.equal(first.record.seq, 1);

    const second = file.append(creation);
    assert.equal(second.duplicate, true);
    assert.equal(second.record.seq, 1);

    assert.equal(file.readAll().length, 1);
    assert.ok(file.bytes > 0);
    assert.equal(ledgerByteLength(file.readAll()), file.bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('文件重启：序号接着数，写盘时刻不倒退', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-ledger-'));
  try {
    const path = join(dir, 'dengchao.jsonl');
    const times = [
      new Date('2026-11-03T00:00:00.000Z'),
      new Date('2026-11-03T00:00:01.000Z'),
    ];
    const first = new JsonlLedgerFile(path, { clock: () => times.shift()! });
    const creation = creationOf(evaluateProposalGates(gateInput()));
    first.append(creation);

    const second = new JsonlLedgerFile(path, {
      clock: () => new Date('2026-11-03T00:00:00.000Z'), // 倒退的时钟
    });
    const next = creationOf(evaluateProposalGates(gateInput()), 'auto', 'second');
    const outcome = second.append(next);
    assert.equal(outcome.record.seq, 2);
    assert.equal(outcome.record.recordedAt, first.readAll()[0]?.recordedAt);
    assert.ok(outcome.record.recordedAt >= (first.readAll()[0]?.recordedAt ?? ''));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('新记录 id 带前缀，且两次不同', () => {
  const first = newRecordId('dengchao');
  const second = newRecordId('dengchao');
  assert.match(first, /^dengchao:/);
  assert.notEqual(first, second);
});

test('门禁闭集就是这十个名字', () => {
  const names: GateName[] = [
    'schema', 'placement', 'coverage', 'pathfinding', 'collision',
    'constraint', 'traceability', 'invariant', 'replay', 'fuse',
  ];
  const gates = evaluateProposalGates(gateInput());
  const seen = new Set(gates.map((gate) => gate.name));
  for (const name of names) assert.ok(seen.has(name), `提案读数缺 ${name}`);
});
