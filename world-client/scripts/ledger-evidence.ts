/**
 * 造物账本的证据脚本：跑真实世界日、量体积、打印可复核的数字。
 *
 *   node --import ./test/phaser-hooks.mjs scripts/ledger-evidence.ts
 *
 * 产物落在 `tmp/creation-ledger/`（已在 `.gitignore`），不写进仓库。
 * 输出一段 JSON；报告里的数字都从这里来，手抄不过夜。
 */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { CreatorEngine, type CreatorWorldView } from '../src/creator/engine.ts';
import { Simulation } from '../src/world/simulation.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../src/world/setup.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import type { SettingPack } from '../src/settings/types.ts';
import { AutonomousFuseController } from '../src/world/creator/fuse.ts';
import {
  buildCreationRecord,
  buildLandingRecord,
  buildObservationRecord,
  creationVerdict,
  evaluateLandingGates,
  evaluateProposalGates,
  ladderSnapshot,
  landingFingerprint,
  observationOf,
  proposalFingerprint,
  queryLedger,
  type CreationRecord,
  type LadderSnapshot,
} from '../src/creator/ledger.ts';
import {
  freezeCreatorView,
  landingReachable,
  verifyCreationReplay,
  type LandedCreation,
} from '../src/creator/landing.ts';
import { checkLandedBuilding, creationCoverage } from '../src/creator/business-rules.ts';
import { JsonlLedgerFile } from '../src/creator/ledger-file.ts';

const WORLD_SEED = 'dengchao';
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET = 'waiting_shelter';
const OUT_DIR = join(import.meta.dirname, '..', 'tmp', 'creation-ledger');

function freshWorld(): { pack: SettingPack; world: BuiltWorld } {
  const pack = loadSettingPack(DENGCHAO_RAW);
  return { pack, world: buildSettingWorld(pack) };
}

function simOf(pack: SettingPack, world: BuiltWorld): Simulation {
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '证据',
    wallClock: () => 0,
    blueprints: pack.blueprints,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = pack.blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
  });
}

function viewOf(sim: Simulation, world: BuiltWorld, pack: SettingPack, day: number): CreatorWorldView {
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
  days(14, { pathfindingConnected: true, hasCollision: false, spatialConstraintSatisfied: true, traceable: true, replayHashConsistent: true });
}

interface RunSummary {
  readonly totalDays: number;
  readonly proposals: number;
  readonly creations: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly landings: number;
  readonly observations: number;
  readonly stillPresent: number;
  readonly removed: number;
  readonly modified: number;
  readonly missing: number;
  readonly bytes: number;
  readonly bytesPerProposal: number;
  readonly creationBytes: number;
  readonly firstRejected: CreationRecord | null;
  readonly firstAccepted: CreationRecord | null;
  readonly firstAcceptedLandingId: string | null;
  readonly lastAccepted: CreationRecord | null;
  readonly lastAcceptedLandingId: string | null;
  readonly lastAcceptedLandingInFinalWorld: boolean;
  readonly finalBuildingIds: readonly string[];
  readonly seqMonotonic: boolean;
  readonly recordedAtMonotonic: boolean;
}

async function runRealDays(totalDays: number): Promise<RunSummary> {
  const path = join(OUT_DIR, `dayrun-${totalDays}d.jsonl`);
  rmSync(path, { force: true });
  const ledger = new JsonlLedgerFile(path);
  const { pack, world } = freshWorld();
  const sim = simOf(pack, world);
  const engine = new CreatorEngine(pack, {
    worldSeed: WORLD_SEED,
    worldTime: () => sim.snapshot().now,
    world,
  });

  interface Pending {
    readonly proposalId: string;
    readonly buildingId: string;
    readonly dueDay: number;
    readonly landed: LandedCreation;
  }
  const pending: Pending[] = [];
  const removed = new Set<string>();
  const observed = new Map<string, string>();
  let proposals = 0;
  let accepted = 0;
  let rejected = 0;
  let landings = 0;
  let firstRejected: CreationRecord | null = null;
  let firstAccepted: CreationRecord | null = null;
  let firstAcceptedLandingId: string | null = null;
  let lastAccepted: CreationRecord | null = null;
  let lastAcceptedLandingId: string | null = null;

  for (let day = 0; day < totalDays; day += 1) {
    if (day === 5) climbToL3(engine);
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
      if (blueprint === undefined) throw new Error(`没有蓝图 ${proposal.templateId}`);
      const frozen = freezeCreatorView(
        view,
        [...pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
      );
      const decision = engine.getFuseDecision('mapper');
      const state = engine.getRoleState('mapper');
      if (state === undefined) throw new Error('mapper 角色没有起来');
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
      const verdict = creationVerdict('auto', gates);
      const instanceId = verdict.verdict === 'accepted' ? sim.nextInstanceId(proposal.templateId) : null;
      const currentDay = Math.floor(sim.snapshot().now / DAY_MS);
      const recordId = instanceId !== null
        ? `${WORLD_SEED}:${instanceId}`
        : `${WORLD_SEED}:d${currentDay}:${proposal.templateId}:${proposals}`;
      const creation = buildCreationRecord({
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
      if (creation.verdict === 'rejected') {
        rejected += 1;
        firstRejected ??= creation;
      } else if (instanceId !== null) {
        accepted += 1;
        firstAccepted ??= creation;
        lastAccepted = creation;
        sim.enqueue({
          kind: 'build',
          prefabId: proposal.templateId,
          instanceId,
          at: proposal.at,
          source: { taskId: `creator-${proposal.templateId}`, summary: proposal.reason },
        });
        sim.update(16);
        const building = sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
        if (building === undefined) throw new Error(`放行的 ${instanceId} 没有落地`);
        const landed: LandedCreation = {
          instanceId,
          prefabId: building.prefabId,
          origin: building.origin,
          door: building.door,
        };
        const replayed = engine.planCreation(frozen);
        const replayConsistent = replayed === null
          ? null
          : verifyCreationReplay({ plan: proposal, replayed, landed, day: currentDay, blueprints: pack.blueprints });
        const coverageRate = creationCoverage(sim.snapshot(), pack.blueprints);
        const pathfindingConnected = landingReachable(world, landed);
        const business = await checkLandedBuilding(
          { snapshot: sim.snapshot(), grid: world.grid, altar: world.altar, blueprints: pack.blueprints },
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
        landings += 1;
        firstAcceptedLandingId ??= instanceId;
        lastAcceptedLandingId = instanceId;
        pending.push({ proposalId: creation.recordId, buildingId: instanceId, dueDay: currentDay + 7, landed });
      }
    }

    const closedDay = Math.floor(sim.snapshot().now / DAY_MS);
    for (const item of [...pending]) {
      if (closedDay < item.dueDay) continue;
      const current = sim.snapshot().buildings.find((building) => building.instanceId === item.buildingId);
      const outcome = observationOf({
        expected: { prefabId: item.landed.prefabId, origin: item.landed.origin, door: item.landed.door },
        current: current === undefined
          ? null
          : { prefabId: current.prefabId, origin: current.origin, door: current.door, displayName: current.displayName },
        removed: removed.has(item.buildingId),
        renamedTo: null,
      });
      ledger.append(buildObservationRecord({
        proposalId: item.proposalId,
        worldId: WORLD_SEED,
        day: closedDay,
        at: sim.snapshot().now,
        dueDay: item.dueDay,
        buildingId: item.buildingId,
        status: outcome.status,
        detail: outcome.detail,
      }));
      observed.set(item.proposalId, outcome.status);
      pending.splice(pending.indexOf(item), 1);
    }

    sim.update(DAY_MS);
    engine.closeWorldDay();
    engine.processDayClosed({ meanValence: 0, meanArousal: 0.5, infoEntropy: 0.5, isolatedHoldersCount: 0 });
  }

  const records = ledger.readAll();
  const entries = queryLedger(records);
  const creations = entries.length;
  const creationBytes = records
    .filter((record) => record.kind === 'creation')
    .reduce((total, record) => total + Buffer.byteLength(`${JSON.stringify(record)}\n`, 'utf8'), 0);
  const seqs = records.map((record) => record.seq);
  const stamps = records.map((record) => record.recordedAt);
  const statuses = [...observed.values()];
  const finalBuildingIds = sim.snapshot().buildings.map((building) => building.instanceId);

  return {
    totalDays,
    proposals,
    creations,
    accepted,
    rejected,
    landings,
    observations: statuses.length,
    stillPresent: statuses.filter((status) => status === 'still_present').length,
    removed: statuses.filter((status) => status === 'removed').length,
    modified: statuses.filter((status) => status === 'modified').length,
    missing: statuses.filter((status) => status === 'missing').length,
    bytes: statSync(path).size,
    bytesPerProposal: Math.round(statSync(path).size / Math.max(1, proposals)),
    creationBytes,
    firstRejected,
    firstAccepted,
    firstAcceptedLandingId,
    lastAccepted,
    lastAcceptedLandingId,
    lastAcceptedLandingInFinalWorld: lastAcceptedLandingId !== null
      && finalBuildingIds.includes(lastAcceptedLandingId),
    finalBuildingIds,
    seqMonotonic: seqs.every((value, index) => index === 0 || value > (seqs[index - 1] ?? 0)),
    recordedAtMonotonic: stamps.every((value, index) => index === 0 || value >= (stamps[index - 1] ?? '')),
  };
}

/** 体积读数：每天 3 次造物，每次 creation + landing + 第 7 天 observation。 */
function volumeForDays(days: number): { days: number; creations: number; lines: number; bytes: number } {
  const path = join(OUT_DIR, `volume-${days}d.jsonl`);
  rmSync(path, { force: true });
  const ledger = new JsonlLedgerFile(path);
  const controller = new AutonomousFuseController(() => 0);
  controller.initRole('mapper', '地图师', 3, 3);
  const state = controller.getRoleState('mapper');
  if (state === undefined) throw new Error('角色没起来');
  const ladder: LadderSnapshot = ladderSnapshot(state, { action: 'allow', reason: '放行' });
  const perDay = 3;
  const plan = {
    templateId: TARGET,
    at: { x: 40, y: 30 },
    palette: { body: 1, roof: 2, trim: 3, window: 4 },
  };
  const landed: LandedCreation = {
    instanceId: 'waiting_shelter#1',
    prefabId: TARGET,
    origin: { x: 40, y: 30 },
    door: { x: 42, y: 32 },
  };

  for (let day = 0; day < days; day += 1) {
    for (let slot = 0; slot < perDay; slot += 1) {
      const id = `${WORLD_SEED}:d${day}:s${slot}`;
      ledger.append(buildCreationRecord({
        recordId: id,
        worldId: WORLD_SEED,
        seed: WORLD_SEED,
        day,
        at: day * DAY_MS,
        templateId: TARGET,
        templateName: '候车亭',
        templateKind: 'industry',
        intentText: null,
        target: plan.at,
        origin: 'auto',
        gates: evaluateProposalGates({
          origin: 'auto',
          schemaPassed: true,
          placementPassed: true,
          builtPrefabIds: new Set(['ink_house', 'star_archive', 'workshop_plot']),
          blueprintCount: 4,
          templateId: TARGET,
          fuseAction: 'allow',
          fuseReason: '放行',
          traceable: true,
        }),
        ladder,
        replay: {
          seed: WORLD_SEED, eventFrom: 0, eventTo: 0, dayFrom: day, dayTo: day,
          fingerprint: proposalFingerprint(WORLD_SEED, day, plan),
        },
      }));
      ledger.append(buildLandingRecord({
        proposalId: id,
        worldId: WORLD_SEED,
        seed: WORLD_SEED,
        day,
        at: day * DAY_MS + 16,
        templateId: TARGET,
        landed: true,
        buildingId: `${landed.instanceId}-${slot}`,
        origin: landed.origin,
        door: landed.door,
        gates: evaluateLandingGates({
          origin: 'auto',
          schemaPassed: true,
          placementPassed: true,
          builtPrefabIds: new Set(['ink_house', 'star_archive', 'workshop_plot', TARGET]),
          blueprintCount: 4,
          templateId: TARGET,
          fuseAction: 'allow',
          fuseReason: '放行',
          traceable: true,
          actualCoverageRate: 1,
          pathfindingConnected: true,
          hasCollision: false,
          spatialConstraintSatisfied: true,
          invariantViolated: false,
          replayHashConsistent: true,
        }),
        replay: {
          seed: WORLD_SEED, eventFrom: 0, eventTo: 0, dayFrom: day, dayTo: day,
          fingerprint: landingFingerprint(WORLD_SEED, day, plan, landed),
        },
        failure: null,
      }));
      if (day >= 7) {
        ledger.append(buildObservationRecord({
          proposalId: id,
          worldId: WORLD_SEED,
          day,
          at: day * DAY_MS + 32,
          dueDay: day,
          buildingId: `${landed.instanceId}-${slot}`,
          status: 'still_present',
          detail: '仍立在 (40,30)',
        }));
      }
    }
  }
  return { days, creations: countCreations(ledger), lines: ledger.readAll().length, bytes: statSync(path).size };
}

function countCreations(ledger: JsonlLedgerFile): number {
  return ledger.readAll().filter((record) => record.kind === 'creation').length;
}

function coverageRejectionSample(): CreationRecord {
  const controller = new AutonomousFuseController(() => 0);
  controller.initRole('mapper', '地图师', 3, 3);
  const state = controller.getRoleState('mapper');
  if (state === undefined) throw new Error('角色没起来');
  const plan = {
    templateId: TARGET,
    at: { x: 40, y: 30 },
    palette: { body: 1, roof: 2, trim: 3, window: 4 },
  };
  return buildCreationRecord({
    recordId: `${WORLD_SEED}:coverage-rejected`,
    worldId: WORLD_SEED,
    seed: WORLD_SEED,
    day: 3,
    at: 3 * DAY_MS,
    templateId: TARGET,
    templateName: '候车亭',
    templateKind: 'industry',
    intentText: '在 (40,30) 建一间候车亭',
    target: plan.at,
    origin: 'auto',
    gates: evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      // 30 种模板里只落了 1 种；本提案补成 2 种 → 2/30 ≈ 0.067。
      builtPrefabIds: new Set(['ink_house']),
      blueprintCount: 30,
      templateId: TARGET,
      fuseAction: 'allow',
      fuseReason: '放行',
      traceable: true,
    }),
    ladder: ladderSnapshot(state, { action: 'allow', reason: '放行' }),
    replay: {
      seed: WORLD_SEED, eventFrom: 0, eventTo: 0, dayFrom: 3, dayTo: 3,
      fingerprint: proposalFingerprint(WORLD_SEED, 3, plan),
    },
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const real = await runRealDays(20);
  const v30 = volumeForDays(30);
  const v100 = volumeForDays(100);
  const coverageRejected = coverageRejectionSample();
  // 把「构造出来的该拒」也真写进一份 JSONL，证明账本接得住这条拒绝原因。
  const rejectedPath = join(OUT_DIR, 'constructed-rejections.jsonl');
  rmSync(rejectedPath, { force: true });
  const rejectedLedger = new JsonlLedgerFile(rejectedPath);
  rejectedLedger.append(coverageRejected);

  const output = {
    ok: true,
    real,
    coverageRejected,
    volume: { perDayCreations: 3, thirtyDays: v30, hundredDays: v100 },
    files: {
      real: join(OUT_DIR, 'dayrun-20d.jsonl'),
      constructedRejections: rejectedPath,
      volume30: join(OUT_DIR, 'volume-30d.jsonl'),
      volume100: join(OUT_DIR, 'volume-100d.jsonl'),
    },
  };
  // creation 记录里的 firstRejected / firstAccepted 可能很大；报告只取需要的字段。
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

// `countCreations` 既在模块级也在 volume 里；这里显式引用一下，避免 TS 报未使用。
void countCreations;

void main();
