/** 账本进世界：跑若干世界日，条数守恒、该拒被拒、该过被过、重启可读。
 *
 * 这一组用**真实的** `Simulation` + `CreatorEngine`，不是给账本编一份假数据。
 * 样本仍是灯潮界：开局缺 `waiting_shelter`，正好是一件真实可提议的造物。
 *
 * 世界日节奏：
 *   - 第 0–4 天：角色还在 L0，自动提议**只会被熔断拒绝**（该拒被拒）。
 *   - 之后把爬梯推到 L3（用真实的观测计数，不直接改等级）。
 *   - 第 5–12 天：每天拆掉再建一次候车亭，自动提议被放行（该过被过）。
 *   - 第 13–20 天：不再拆，等第 7 个世界日观测；最后那一栋应记「仍在」，
 *     前面几栋应记「被拆」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { CreatorEngine, type CreatorWorldView } from '../src/creator/engine.ts';
import { Simulation } from '../src/world/simulation.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../src/world/setup.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import type { SettingPack } from '../src/settings/types.ts';
import {
  buildCreationRecord,
  buildLandingRecord,
  buildObservationRecord,
  evaluateLandingGates,
  evaluateProposalGates,
  ladderSnapshot,
  landingFingerprint,
  newRecordId,
  observationDueDay,
  observationOf,
  proposalFingerprint,
  queryLedger,
  type CreationRecord,
  type ObservationStatus,
} from '../src/creator/ledger.ts';
import { checkLandedBuilding, creationCoverage } from '../src/creator/business-rules.ts';
import {
  freezeCreatorView,
  landingReachable,
  verifyCreationReplay,
  type LandedCreation,
} from '../src/creator/landing.ts';
import { JsonlLedgerFile } from '../src/creator/ledger-file.ts';

const WORLD_SEED = 'dengchao';
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET = 'waiting_shelter';

function freshWorld(): { pack: SettingPack; world: BuiltWorld } {
  const pack = loadSettingPack(DENGCHAO_RAW);
  return { pack, world: buildSettingWorld(pack) };
}

function simOf(pack: SettingPack, world: BuiltWorld): Simulation {
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '测试',
    wallClock: () => 0,
    blueprints: pack.blueprints,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = pack.blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
  });
}

function viewOf(
  sim: Simulation,
  world: BuiltWorld,
  pack: SettingPack,
  day: number,
): CreatorWorldView {
  const snapshot = sim.snapshot();
  return {
    day,
    builtPrefabIds: new Set(snapshot.buildings.map((building) => building.prefabId)),
    width: world.grid.width,
    height: world.grid.height,
    canPlace: (prefabId, at) => {
      const blueprint = pack.blueprints.get(prefabId);
      if (blueprint === undefined) return false;
      return checkPlacement(world.grid, blueprint, at).ok
        && biomeRingAllows(prefabId, at, world.altar);
    },
  };
}

/** 用真实观测计数把 `mapper` 推到 L3；与 `creator-wire.test.ts` 同一套路径。 */
function climbToL3(engine: CreatorEngine): void {
  const observe = (extra: Record<string, unknown> = {}): void => {
    engine.submitHumanApproval('mapper', 'climb', true, undefined, {
      coverageRate: 1,
      hasConflict: false,
      invariantViolated: false,
      ...extra,
    });
  };
  const days = (count: number, extra: Record<string, unknown> = {}): void => {
    for (let index = 0; index < count; index += 1) {
      observe(extra);
      engine.closeWorldDay();
    }
  };
  days(14);
  days(14);
  days(14, { hasCollision: false, spatialConstraintSatisfied: true, traceable: true, replayHashConsistent: true });
  days(14, {
    pathfindingConnected: true,
    hasCollision: false,
    spatialConstraintSatisfied: true,
    traceable: true,
    replayHashConsistent: true,
  });
  assert.equal(engine.getRoleState('mapper')?.currentLevel, 3, '爬梯应当到 L3');
}

interface PendingObservation {
  readonly proposalId: string;
  readonly buildingId: string;
  readonly landed: LandedCreation;
  readonly dueDay: number;
  readonly displayName: string;
}

async function runDays(
  ledger: JsonlLedgerFile,
  totalDays: number,
): Promise<{
  proposals: number;
  creations: number;
  accepted: number;
  rejected: number;
  landingRecords: number;
  observations: ReadonlyMap<string, ObservationStatus>;
  buildingsAfter: number;
}> {
  const { pack, world } = freshWorld();
  const sim = simOf(pack, world);
  const engine = new CreatorEngine(pack, {
    worldSeed: WORLD_SEED,
    worldTime: () => sim.snapshot().now,
    world,
  });

  const pending: PendingObservation[] = [];
  const removed = new Set<string>();
  const observed = new Map<string, ObservationStatus>();
  let proposals = 0;
  let accepted = 0;
  let rejected = 0;
  let landingRecords = 0;

  for (let day = 0; day < totalDays; day += 1) {
    // 第 5 天开始把爬梯推到 L3：用真实的观测计数，不直接改等级。
    if (day === 5) climbToL3(engine);

    // 先拆掉昨天那一栋（只在需要反复重建的窗口里拆）。
    const previous = sim.snapshot().buildings.find((building) => building.prefabId === TARGET);
    if (day >= 5 && day <= 12 && previous !== undefined) {
      sim.enqueue({ kind: 'demolish', instanceId: previous.instanceId });
      sim.update(16);
      if (!sim.snapshot().buildings.some((building) => building.instanceId === previous.instanceId)) {
        removed.add(previous.instanceId);
      }
    }

    const view = viewOf(sim, world, pack, day);
    const proposal = engine.planCreation(view);
    if (proposal !== null) {
      proposals += 1;
      const blueprint = pack.blueprints.get(proposal.templateId);
      assert.ok(blueprint !== undefined);

      // 拆掉/重建时缓存可能刚好被 `planCreation` 挑中；落位许可先冻住。
      const frozen = freezeCreatorView(
        view,
        [...pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
      );
      const decision = engine.getFuseDecision('mapper');
      const state = engine.getRoleState('mapper');
      assert.ok(state !== undefined);

      const gates = evaluateProposalGates({
        origin: 'auto',
        schemaPassed: true,
        placementPassed: true,
        builtPrefabIds: view.builtPrefabIds,
        blueprintCount: pack.blueprints.size,
        templateId: proposal.templateId,
        fuseAction: decision.action,
        fuseReason: decision.reason,
        traceable: true,
      });
      const currentDay = Math.floor(sim.snapshot().now / DAY_MS);
      const recordId = newRecordId(`${WORLD_SEED}:d${currentDay}:${proposal.templateId}`);
      const creation: CreationRecord = buildCreationRecord({
        recordId,
        worldId: WORLD_SEED,
        seed: WORLD_SEED,
        day: currentDay,
        at: sim.snapshot().now,
        templateId: proposal.templateId,
        templateName: blueprint.displayName,
        templateKind: blueprint.zone,
        intentText: null,
        target: proposal.at,
        origin: 'auto',
        gates,
        ladder: ladderSnapshot(state, decision),
        replay: {
          seed: WORLD_SEED,
          eventFrom: sim.snapshot().feed.cursor,
          eventTo: sim.snapshot().feed.cursor,
          dayFrom: currentDay,
          dayTo: currentDay,
          fingerprint: proposalFingerprint(WORLD_SEED, currentDay, proposal),
        },
      });
      ledger.append(creation);
      if (creation.verdict === 'accepted') {
        accepted += 1;
        const instanceId = sim.nextInstanceId(proposal.templateId);
        sim.enqueue({
          kind: 'build',
          prefabId: proposal.templateId,
          instanceId,
          at: proposal.at,
          source: { taskId: `creator-${proposal.templateId}`, summary: proposal.reason },
        });
        sim.update(16);
        const building = sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
        assert.ok(building !== undefined, '放行的计划必须真的落地');
        const landed: LandedCreation = {
          instanceId,
          prefabId: building.prefabId,
          origin: building.origin,
          door: building.door,
        };
        const replayed = engine.planCreation(frozen);
        const replayConsistent = replayed === null
          ? null
          : verifyCreationReplay({
              plan: proposal,
              replayed,
              landed,
              day: currentDay,
              blueprints: pack.blueprints,
            });
        const coverageRate = creationCoverage(sim.snapshot(), pack.blueprints);
        const pathfindingConnected = landingReachable(world, landed);
        // 落地后的业务规则检查：真的跑，不拿落位预检冒充。
        const business = await checkLandedBuilding(
          {
            snapshot: sim.snapshot(),
            grid: world.grid,
            altar: world.altar,
            blueprints: pack.blueprints,
          },
          landed,
        );
        const landing = buildLandingRecord({
          proposalId: creation.recordId,
          worldId: WORLD_SEED,
          seed: WORLD_SEED,
          day: currentDay,
          at: sim.snapshot().now,
          templateId: proposal.templateId,
          landed: true,
          buildingId: instanceId,
          origin: building.origin,
          door: building.door,
          gates: evaluateLandingGates({
            origin: 'auto',
            schemaPassed: true,
            placementPassed: true,
            builtPrefabIds: view.builtPrefabIds,
            blueprintCount: pack.blueprints.size,
            templateId: proposal.templateId,
            fuseAction: 'allow',
            fuseReason: decision.reason,
            traceable: true,
            actualCoverageRate: coverageRate,
            pathfindingConnected,
            hasCollision: business.hasConflict,
            spatialConstraintSatisfied: true,
            invariantViolated: business.invariantViolated,
            replayHashConsistent: replayConsistent,
          }),
          replay: {
            seed: WORLD_SEED,
            eventFrom: sim.snapshot().feed.cursor,
            eventTo: sim.snapshot().feed.cursor,
            dayFrom: currentDay,
            dayTo: currentDay,
            fingerprint: landingFingerprint(WORLD_SEED, currentDay, proposal, landed),
          },
          failure: null,
        });
        ledger.append(landing);
        landingRecords += 1;

        engine.submitHumanApproval('mapper', instanceId, true, undefined, {
          coverageRate,
          pathfindingConnected,
          hasCollision: false,
          spatialConstraintSatisfied: true,
          traceable: true,
          hasConflict: business.hasConflict,
          invariantViolated: business.invariantViolated,
          ...(replayConsistent === null ? {} : { replayHashConsistent: replayConsistent }),
        });
        pending.push({
          proposalId: creation.recordId,
          buildingId: instanceId,
          landed,
          dueDay: observationDueDay(currentDay),
          displayName: blueprint.displayName,
        });
      } else {
        rejected += 1;
      }
    }

    // 第 7 个世界日到了就观测；不早不晚。
    const closedDay = Math.floor(sim.snapshot().now / DAY_MS);
    for (const item of [...pending]) {
      if (closedDay < item.dueDay) continue;
      const current = sim.snapshot().buildings.find(
        (building) => building.instanceId === item.buildingId,
      );
      const outcome = observationOf({
        expected: {
          prefabId: item.landed.prefabId,
          origin: item.landed.origin,
          door: item.landed.door,
        },
        current: current === undefined
          ? null
          : {
              prefabId: current.prefabId,
              origin: current.origin,
              door: current.door,
              displayName: current.displayName,
            },
        removed: removed.has(item.buildingId),
        renamedTo: null,
      });
      ledger.append(
        buildObservationRecord({
          proposalId: item.proposalId,
          worldId: WORLD_SEED,
          day: closedDay,
          at: sim.snapshot().now,
          dueDay: item.dueDay,
          buildingId: item.buildingId,
          status: outcome.status,
          detail: outcome.detail,
        }),
      );
      observed.set(item.proposalId, outcome.status);
      pending.splice(pending.indexOf(item), 1);
    }

    sim.update(DAY_MS);
    engine.closeWorldDay();
    engine.processDayClosed({
      meanValence: 0,
      meanArousal: 0.5,
      infoEntropy: 0.5,
      isolatedHoldersCount: 0,
    });
  }

  return {
    proposals,
    creations: queryLedger(ledger.readAll()).length,
    accepted,
    rejected,
    landingRecords,
    observations: observed,
    buildingsAfter: sim.snapshot().buildings.length,
  };
}

test('跑 20 个世界日：账本条数 = 提案条数，不丢不重复', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-ledger-run-'));
  try {
    const path = join(dir, 'dengchao.jsonl');
    const ledger = new JsonlLedgerFile(path, {
      clock: () => new Date('2026-11-03T00:00:00.000Z'),
    });
    const summary = await runDays(ledger, 20);

    assert.ok(summary.proposals >= 10, `提案太少（${summary.proposals}），这条测不出守恒`);
    assert.equal(summary.creations, summary.proposals, 'creation 记录必须与提案一一对应');
    assert.equal(summary.accepted + summary.rejected, summary.proposals);
    assert.ok(summary.rejected >= 1, '至少要有一次「该拒被拒」');
    assert.ok(summary.accepted >= 1, '至少要有一次「该过被过」');
    assert.equal(summary.landingRecords, summary.accepted, '每次放行都应有一条 landing');

    // 该过被过：落地记录里的建筑 id 真的在最后的世界里（或已被拆掉的那几栋）。
    const entries = queryLedger(ledger.readAll(), { verdict: 'accepted' });
    assert.equal(entries.length, summary.accepted);
    for (const entry of entries) {
      assert.ok(entry.landing !== null, '放行的提案必须有落地记录');
      assert.equal(entry.landing?.landed, true);
      assert.match(entry.landing?.buildingId ?? '', /^waiting_shelter#\d+$/);
    }

    // 7 日观测：前面的被拆，最后那一栋仍在。
    const statuses = [...summary.observations.values()];
    assert.ok(statuses.includes('still_present'), '最后那一栋应记仍在');
    assert.ok(statuses.includes('removed'), '前面被拆的应记被拆');

    // 重启可读：新实例读同一个文件，顺序与条数都还在。
    const reopened = new JsonlLedgerFile(path);
    assert.equal(queryLedger(reopened.readAll()).length, summary.proposals);
    const seqs = reopened.readAll().map((record) => record.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), '序号必须升序');
    assert.equal(new Set(seqs).size, seqs.length, '序号不能重复');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});



test('L0 的自动提议被熔断拒绝，账本写下是哪一项没过', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-ledger-l0-'));
  try {
    const path = join(dir, 'dengchao.jsonl');
    const ledger = new JsonlLedgerFile(path);
    const { pack, world } = freshWorld();
    const sim = simOf(pack, world);
    const engine = new CreatorEngine(pack, {
      worldSeed: WORLD_SEED,
      worldTime: () => sim.snapshot().now,
      world,
    });
    const view = viewOf(sim, world, pack, 0);
    const proposal = engine.planCreation(view);
    assert.ok(proposal !== null);
    assert.equal(engine.getFuseDecision('mapper').action, 'requireReview');

    const state = engine.getRoleState('mapper');
    assert.ok(state !== undefined);
    const gates = evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: view.builtPrefabIds,
      blueprintCount: pack.blueprints.size,
      templateId: proposal.templateId,
      fuseAction: 'requireReview',
      fuseReason: 'L0 阶段所有生成都要人工逐项确认',
      traceable: true,
    });
    const creation = buildCreationRecord({
      recordId: 'l0',
      worldId: WORLD_SEED,
      seed: WORLD_SEED,
      day: 0,
      at: 0,
      templateId: proposal.templateId,
      templateName: '候车亭',
      templateKind: 'industry',
      intentText: null,
      target: proposal.at,
      origin: 'auto',
      gates,
      ladder: ladderSnapshot(state, engine.getFuseDecision('mapper')),
      replay: {
        seed: WORLD_SEED,
        eventFrom: 0,
        eventTo: 0,
        dayFrom: 0,
        dayTo: 0,
        fingerprint: proposalFingerprint(WORLD_SEED, 0, proposal),
      },
    });
    ledger.append(creation);
    assert.equal(creation.verdict, 'rejected');
    assert.equal(creation.rejection?.gate, 'fuse');
    assert.equal(creation.rejection?.kind, 'below_requirement');
    assert.equal(creation.rejection?.observed, 'requireReview');
    assert.equal(creation.rejection?.threshold, '= allow');
    assert.equal(sim.snapshot().buildings.length, world.buildings.length, '被拒的提议不该改世界');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
