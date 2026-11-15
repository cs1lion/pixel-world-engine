/** L3 边界：重复模板、0 分母、账本容量/去重/重启，以及熔断降级不越级。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CreatorHarness, gateOf } from './fixtures/creator-functional.ts';
import {
  buildCreationRecord,
  coverageAfterBuild,
  evaluateLandingGates,
  evaluateProposalGates,
  ladderSnapshot,
  type LedgerRecord,
} from '../src/creator/ledger.ts';
import { createCreationLedgerOutbox, type CreationLedgerClient } from '../src/creator/ledger-client.ts';
import {
  MemoryLedgerQueueStorage,
  type LedgerQueueStorage,
} from '../src/creator/ledger-queue.ts';
import { JsonlLedgerFile } from '../src/creator/ledger-file.ts';
import { creationCoverage } from '../src/creator/business-rules.ts';
import { buildSettingWorld } from '../src/settings/load.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { SettingPack } from '../src/settings/types.ts';
import { biomeRingAllows, checkPlacement } from '../src/world/setup.ts';
import { AutonomyLevel } from '../src/world/creator/fuse.ts';

test('[L3] 同 prefabId 第二栋：真实 Simulation 必须拒绝，建筑数不变', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  assert.equal(plan.templateId, 'waiting_shelter');
  await h.landManual(plan, 0);
  assert.equal(h.snapshot().buildings.filter((b) => b.prefabId === 'waiting_shelter').length, 1);
  assert.equal(h.engine.planCreation(h.view(0)), null, '同一模板已在场，planCreation 不再提它');

  // 找一个别的合规落点，证明拒绝原因是「同模板」，不是「位置放不下」。
  let alternate: { x: number; y: number } | null = null;
  for (let y = 0; y < h.world.grid.height && alternate === null; y += 1) {
    for (let x = 0; x < h.world.grid.width; x += 1) {
      if (x === plan.at.x && y === plan.at.y) continue;
      const at = { x, y };
      if (
        checkPlacement(h.world.grid, h.blueprint('waiting_shelter'), at).ok
        && biomeRingAllows('waiting_shelter', at, h.world.altar)
      ) {
        alternate = at;
        break;
      }
    }
  }
  assert.ok(alternate !== null, '地图上应还有第二个合规落点');

  const countBefore = h.snapshot().buildings.length;
  const second = h.buildCommand({ ...plan, at: alternate });
  assert.equal(second.result.ok, false);
  assert.equal(second.result.message, '这种铺子已经有一栋了。');
  assert.equal(h.snapshot().buildings.length, countBefore);
  assert.equal(h.landedOf(second.instanceId), null);
  assert.equal(
    h.events.filter((event) => event.change === 'building.built' && event.instanceId === second.instanceId).length,
    0,
  );
});

test('[L3] 覆盖率分母为 0：账本记 not_measured，不是 0/1', (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const zero = coverageAfterBuild(new Set(), 0, 'waiting_shelter');
  assert.equal(zero.observed, null);
  assert.equal(zero.detail.includes('分母为 0'), true);

  const gates = evaluateProposalGates({
    origin: 'auto',
    schemaPassed: true,
    placementPassed: true,
    builtPrefabIds: new Set(),
    blueprintCount: 0,
    templateId: 'waiting_shelter',
    fuseAction: 'allow',
    fuseReason: '只看覆盖率',
    traceable: true,
  });
  const coverage = gateOf(gates, 'coverage');
  assert.equal(coverage.passed, null);
  assert.equal(coverage.observed, null);
  assert.equal(coverage.reason, 'not_measured');

  const state = h.engine.getRoleState('mapper');
  assert.ok(state !== undefined);
  const creation = buildCreationRecord({
    recordId: 'zero-coverage',
    worldId: 'func-creator',
    seed: 'dengchao',
    day: 0,
    at: 0,
    templateId: 'waiting_shelter',
    templateName: h.blueprint('waiting_shelter').displayName,
    templateKind: h.blueprint('waiting_shelter').zone,
    intentText: null,
    target: { x: 1, y: 1 },
    origin: 'auto',
    gates,
    ladder: ladderSnapshot(state, h.engine.getFuseDecision('mapper')),
    replay: {
      seed: 'dengchao',
      eventFrom: 0,
      eventTo: 0,
      dayFrom: 0,
      dayTo: 0,
      fingerprint: 'zero-coverage',
    },
  });
  assert.equal(creation.verdict, 'rejected');
  assert.equal(creation.rejectionGate, 'coverage');
  assert.equal(creation.rejection?.kind, 'not_measured');
  assert.equal(creation.rejection?.observed, null);

  // 分母不为 0 时才是「比例」，而且一条未落地的新模板只占 1/10，不是 0/1。
  const measured = coverageAfterBuild(new Set(), 10, 'waiting_shelter');
  assert.equal(measured.observed, 1 / 10);
});

test('[L3] creationCoverage 在 0 分母时给 null，落地门禁与计数器都记 not_measured', () => {
  const h = new CreatorHarness();
  const emptyPack: SettingPack = {
    ...h.pack,
    blueprints: new Map(),
    placements: [],
    // 场所里有建筑锚（`wave_house#1`）；一栋楼都不落时它解析不到，
    // 而 `buildSettingWorld` 对未知建筑一律 throw。空世界连居民一起清掉，
    // 测的是「蓝图数为 0」这一件事，不是「半份包能不能装」。
    sites: [],
    villagers: [],
  };
  const emptyWorld = buildSettingWorld(emptyPack);
  const emptySim = new Simulation({
    grid: emptyWorld.grid,
    buildings: emptyWorld.buildings,
    altar: emptyWorld.altar,
    villagerName: '空世界',
    wallClock: () => 0,
    blueprints: emptyPack.blueprints,
    spawnBuilding: () => null,
  });
  try {
    // 业务规则侧：分母为 0 是「没测」，不是「0 分」。
    assert.equal(creationCoverage(emptySim.snapshot(), emptyPack.blueprints), null);

    // 生产落地门禁：null 必须落成 passed=null / reason=not_measured，
    // 不能走 `coverage >= 0.95` 的 false 分支。
    const landingCoverage = evaluateLandingGates({
      origin: 'manual',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: new Set(),
      blueprintCount: 0,
      templateId: 'waiting_shelter',
      fuseAction: 'not_applicable',
      fuseReason: '人工入口不走自动放行门禁',
      traceable: true,
      actualCoverageRate: null,
    }).find((gate) => gate.name === 'coverage');
    assert.ok(landingCoverage !== undefined);
    assert.equal(landingCoverage.passed, null);
    assert.equal(landingCoverage.reason, 'not_measured');

    // 引擎计数器：null 不碰 coverageChecks，否则会把「没测」当 0 分记一次观测。
    h.engine.submitHumanApproval('mapper', 'empty-coverage', true, undefined, {
      coverageRate: null,
    });
    assert.equal(h.engine.getRoleState('mapper')?.metrics.coverageChecks, 0);
  } finally {
    h.dispose();
  }
});

test('[L3] 账本去重：recordId 重复返回旧记录 duplicate=true，文件不二次追加', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const plan = h.engine.planCreation(h.view(0));
  assert.ok(plan !== null);
  await h.landManual(plan, 0);

  const first = h.ledger.readAll()[0];
  assert.ok(first !== undefined);
  const bytesBefore = h.ledger.bytes;
  const recordsBefore = h.ledger.readAll().length;
  const again = h.ledger.append(first as LedgerRecord);
  assert.equal(again.duplicate, true);
  assert.equal(again.record.recordId, first.recordId);
  assert.equal(again.record.seq, first.seq);
  assert.equal(h.ledger.readAll().length, recordsBefore);
  assert.equal(h.ledger.bytes, bytesBefore, '重复 recordId 不应再写一行');

  const fresh = h.ledger.append({
    ...(first as LedgerRecord),
    recordId: 'fresh-id',
  } as LedgerRecord);
  assert.equal(fresh.duplicate, false);
  assert.equal(fresh.record.seq, recordsBefore + 1, 'seq 接在文件末尾而不是接在第一条后面');
  assert.equal(h.ledger.readAll().length, recordsBefore + 1);
});

test('[L3] 队列上限：丢最旧并记 dropped，存储只留最新两条', (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  // 三条都是真实 L0 拒绝记录，只有 recordId 不同。
  const records: LedgerRecord[] = [];
  for (const item of [h.proposeAuto(), h.proposeAuto(), h.proposeAuto()]) {
    if (item !== null) records.push(item.creation);
  }
  assert.equal(records.length, 3);

  const storage = new MemoryLedgerQueueStorage();
  const sent: string[] = [];
  const client: CreationLedgerClient = {
    async append(record: LedgerRecord) {
      sent.push(record.recordId);
      return {
        ok: true as const,
        record: { ...record, seq: sent.length, recordedAt: '2026-11-03T00:00:00.000Z' },
        duplicate: false,
      };
    },
    async list() {
      return { ok: false as const, reason: '队列用例不查询', status: null };
    },
  };
  const outbox = createCreationLedgerOutbox(client, { storage, maxItems: 2 });
  for (const record of records) outbox.enqueue(record);
  assert.equal(outbox.size, 2);
  assert.equal(outbox.dropped, 1);
  const persisted = (storage as LedgerQueueStorage).load();
  assert.deepEqual(persisted?.records.map((record) => record.recordId), [
    records[1]?.recordId,
    records[2]?.recordId,
  ]);
  assert.equal(persisted?.dropped, 1);
});

test('[L3] 队列出队：被丢的最旧不会发出，剩下两条按序发出', async (t) => {
  const h = new CreatorHarness();
  t.after(() => h.dispose());

  const records: LedgerRecord[] = [];
  for (const item of [h.proposeAuto(), h.proposeAuto(), h.proposeAuto()]) {
    if (item !== null) records.push(item.creation);
  }
  const sent: string[] = [];
  const client: CreationLedgerClient = {
    async append(record: LedgerRecord) {
      sent.push(record.recordId);
      return {
        ok: true as const,
        record: { ...record, seq: sent.length, recordedAt: '2026-11-03T00:00:00.000Z' },
        duplicate: false,
      };
    },
    async list() {
      return { ok: false as const, reason: '队列用例不查询', status: null };
    },
  };
  const outbox = createCreationLedgerOutbox(client, { maxItems: 2 });
  for (const record of records) outbox.enqueue(record);
  await outbox.flush();
  await outbox.flush();
  assert.deepEqual(sent, [records[1]?.recordId, records[2]?.recordId]);
  assert.equal(sent.includes(records[0]?.recordId ?? ''), false);
  assert.equal(outbox.size, 0);
});

test('[L3] 重启：seq 从文件续号，recordedAt 不因时钟回拨而倒退', (t) => {
  const h = new CreatorHarness();
  const dir = mkdtempSync(join(tmpdir(), 'pwe-func-restart-'));
  t.after(() => {
    h.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  const records: LedgerRecord[] = [];
  for (const item of [h.proposeAuto(), h.proposeAuto(), h.proposeAuto()]) {
    if (item !== null) records.push(item.creation);
  }
  assert.equal(records.length, 3);

  const path = join(dir, 'ledger.jsonl');
  const firstProcess = new JsonlLedgerFile(path, {
    clock: () => new Date('2026-11-03T12:00:00.000Z'),
  });
  const a = firstProcess.append(records[0]!);
  const b = firstProcess.append(records[1]!);
  assert.equal(a.record.seq, 1);
  assert.equal(b.record.seq, 2);

  // 重启并让注入时钟往回走：序号必须接 3，时间必须不低于上一条。
  const secondProcess = new JsonlLedgerFile(path, {
    clock: () => new Date('2025-01-01T00:00:00.000Z'),
  });
  const c = secondProcess.append(records[2]!);
  assert.equal(c.record.seq, 3);
  assert.equal(c.record.recordedAt, b.record.recordedAt);
  assert.equal(c.record.recordedAt < b.record.recordedAt, false);

  const all = secondProcess.readAll();
  assert.deepEqual(all.map((record) => record.seq), [1, 2, 3]);
  for (let i = 1; i < all.length; i += 1) {
    assert.equal(all[i]!.recordedAt < all[i - 1]!.recordedAt, false);
  }
});

test('[L3] 熔断降级不能把 L0 升成 L1', (t) => {
  const h = new CreatorHarness({ targetLevel: AutonomyLevel.L1 });
  t.after(() => h.dispose());

  const before = h.engine.getRoleState('mapper');
  assert.ok(before !== undefined);
  assert.equal(before.currentLevel, 0);
  assert.equal(before.isFused, false);

  h.engine.submitHumanApproval('mapper', 'reject-1', false);

  const after = h.engine.getRoleState('mapper');
  assert.ok(after !== undefined);
  assert.equal(after.isFused, true, '拒绝率 100% 应当熔断');
  assert.equal(after.currentLevel, 0, '降级不能把 L0 升成 L1');
});
