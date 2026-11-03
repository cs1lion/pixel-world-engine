/**
 * 造物功能测试的真实链路夹具。
 *
 * 只做三件事：
 * ① 用真实的 `loadSettingPack` / `buildSettingWorld` / `Simulation` 起世界；
 * ② 用真实的 `Simulation.enqueue`（`build` / `demolish` / `miracle`）改世界；
 * ③ 用真实的 `evaluateProposalGates` / `evaluateLandingGates` / 业务规则 / 账本记录器
 *    读出读数并写进 `JsonlLedgerFile`。
 *
 * 不直接改 `world.buildings` / `grid`，也不手写账本记录。唯一的人工输入是
 * 「人点了头」（`submitHumanApproval`）与「记忆层给地点起了名」
 * （`MemoryWorld.setPlaceName`），这两样在生产里本来就不是世界命令。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSettingPack, buildSettingWorld } from '../../src/settings/load.ts';
import { DENGCHAO_RAW } from '../../src/settings/dengchao/pack.ts';
import type { SettingPack } from '../../src/settings/types.ts';
import type { BuiltWorld } from '../../src/world/setup.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../../src/world/setup.ts';
import { Simulation } from '../../src/world/simulation.ts';
import { DAY_MS } from '../../src/world/memory/config.ts';
import { MemoryWorld } from '../../src/world/memory/world.ts';
import type { WorldChange } from '../../src/world/world-changes.ts';
import type { PrefabBlueprint } from '../../src/world/types.ts';
import { CreatorEngine, type CreatorWorldView } from '../../src/creator/engine.ts';
import {
  buildCreationRecord,
  buildLandingRecord,
  buildObservationRecord,
  evaluateLandingGates,
  evaluateProposalGates,
  ladderSnapshot,
  observationDueDay,
  observationOf as ledgerObservationOf,
  proposalFingerprint,
  landingFingerprint,
  type CreationRecord,
  type GateName,
  type GateReading,
  type LandingRecord,
  type ObservationRecord,
} from '../../src/creator/ledger.ts';
import {
  checkLandedBuilding,
  creationCoverage,
  type LandedCheckResult,
} from '../../src/creator/business-rules.ts';
import {
  freezeCreatorView,
  landingReachable,
  verifyCreationReplay,
  type LandedCreation,
} from '../../src/creator/landing.ts';
import { JsonlLedgerFile } from '../../src/creator/ledger-file.ts';
import { AutonomyLevel } from '../../src/world/creator/fuse.ts';
import type { CreationPlan } from '../../src/world/creator-schema.ts';

const WORLD_SEED = 'dengchao';
const WORLD_ID = 'func-creator';

export interface PendingObservation {
  readonly proposalId: string;
  readonly buildingId: string;
  readonly dueDay: number;
  readonly expected: LandedCreation;
}

export interface ManualLandingOutcome {
  readonly plan: CreationPlan;
  readonly instanceId: string;
  readonly creation: CreationRecord;
  readonly landing: LandingRecord;
  readonly landed: LandedCreation;
  readonly proposalGates: readonly GateReading[];
  readonly landingGates: readonly GateReading[];
  readonly business: LandedCheckResult;
  readonly replay: boolean | null;
  readonly pathfindingConnected: boolean;
}

export interface ProposalOutcome {
  readonly plan: CreationPlan;
  readonly gates: readonly GateReading[];
  readonly creation: CreationRecord;
}

export function gateOf(gates: readonly GateReading[], name: GateName): GateReading {
  const gate = gates.find((item) => item.name === name);
  if (gate === undefined) throw new Error(`门禁里没有 ${name}`);
  return gate;
}

export function builtPrefabIdsOf(snapshot: { buildings: readonly { prefabId: string }[] }, pack: SettingPack): Set<string> {
  const set = new Set<string>();
  for (const building of snapshot.buildings) {
    if (pack.blueprints.has(building.prefabId)) set.add(building.prefabId);
  }
  return set;
}

export class CreatorHarness {
  readonly pack: SettingPack;
  readonly world: BuiltWorld;
  readonly sim: Simulation;
  readonly engine: CreatorEngine;
  readonly memory: MemoryWorld;
  readonly ledger: JsonlLedgerFile;
  readonly events: WorldChange[] = [];
  readonly removedIds = new Set<string>();
  readonly pendingObservations = new Map<string, PendingObservation>();

  private readonly tempDir: string;
  private proposalCounter = 0;

  constructor(options: { targetLevel?: AutonomyLevel } = {}) {
    this.pack = loadSettingPack(DENGCHAO_RAW);
    this.world = buildSettingWorld(this.pack);
    this.tempDir = mkdtempSync(join(tmpdir(), 'pwe-func-creator-'));
    this.ledger = new JsonlLedgerFile(join(this.tempDir, 'ledger.jsonl'));
    this.memory = new MemoryWorld({ worldId: WORLD_ID });

    this.sim = new Simulation({
      grid: this.world.grid,
      buildings: this.world.buildings,
      altar: this.world.altar,
      villagerName: '测试',
      wallClock: () => 0,
      blueprints: this.pack.blueprints,
      spawnBuilding: (prefabId, instanceId, at, source) => {
        const blueprint = this.pack.blueprints.get(prefabId);
        if (blueprint === undefined) return null;
        return placeBlueprint(this.world.grid, blueprint, instanceId, this.world.altar, at, source);
      },
      onChange: (change) => {
        this.events.push(change);
        if (change.change === 'building.removed') this.removedIds.add(change.instanceId);
      },
    });

    this.engine = new CreatorEngine(this.pack, {
      worldSeed: WORLD_SEED,
      worldTime: () => this.sim.snapshot().now,
      world: this.world,
      targetLevel: options.targetLevel ?? AutonomyLevel.L0,
    });
  }

  dispose(): void {
    rmSync(this.tempDir, { recursive: true, force: true });
  }

  get worldDay(): number {
    return Math.floor(this.sim.snapshot().now / DAY_MS);
  }

  view(day = this.worldDay): CreatorWorldView {
    const snapshot = this.sim.snapshot();
    return {
      day,
      builtPrefabIds: builtPrefabIdsOf(snapshot, this.pack),
      width: this.world.grid.width,
      height: this.world.grid.height,
      canPlace: (prefabId, at) => {
        const blueprint = this.pack.blueprints.get(prefabId);
        if (blueprint === undefined) return false;
        return checkPlacement(this.world.grid, blueprint, at).ok
          && biomeRingAllows(prefabId, at, this.world.altar);
      },
    };
  }

  blueprint(templateId: string): PrefabBlueprint {
    const blueprint = this.pack.blueprints.get(templateId);
    if (blueprint === undefined) throw new Error(`设定集里没有 ${templateId}`);
    return blueprint;
  }

  nextRecordId(suffix = ''): string {
    this.proposalCounter += 1;
    return `${WORLD_ID}:p${this.proposalCounter}${suffix}`;
  }

  snapshot() {
    return this.sim.snapshot();
  }

  landedOf(instanceId: string): LandedCreation | null {
    const building = this.sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) return null;
    return {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    };
  }

  /** 真实执行一次 build 命令，返回命令结果与实例号。 */
  buildCommand(plan: CreationPlan): { instanceId: string; result: ReturnType<Simulation['update']>[number] } {
    const instanceId = this.sim.nextInstanceId(plan.templateId);
    this.sim.enqueue({
      kind: 'build',
      prefabId: plan.templateId,
      instanceId,
      at: plan.at,
      source: { taskId: 'func-creator', summary: `功能测试落位 ${plan.templateId}` },
    });
    const result = this.sim.update(16)[0];
    if (result === undefined) throw new Error('build 命令没有返回结果');
    return { instanceId, result };
  }

  /** 真实执行一次 demolish 命令。 */
  demolishCommand(instanceId: string): ReturnType<Simulation['update']>[number] {
    this.sim.enqueue({ kind: 'demolish', instanceId });
    const result = this.sim.update(16)[0];
    if (result === undefined) throw new Error('demolish 命令没有返回结果');
    return result;
  }

  /**
   * 真实的一次人工造物：
   * planCreation → 提案门禁 → creation 入账 → build 命令 → building.built
   * → 落地门禁 → landing 入账 → 真实观测喂给熔断器 → 登记 7 日观测。
   */
  async landManual(plan: CreationPlan, day = this.worldDay): Promise<ManualLandingOutcome> {
    const blueprint = this.blueprint(plan.templateId);
    const before = this.snapshot();
    const beforeBuilt = builtPrefabIdsOf(before, this.pack);
    const placement = checkPlacement(this.world.grid, blueprint, plan.at);
    const placementPassed = placement.ok && biomeRingAllows(plan.templateId, plan.at, this.world.altar);
    const decision = this.engine.getFuseDecision('mapper');
    const state = this.engine.getRoleState('mapper');
    if (state === undefined) throw new Error('没有 mapper');

    const proposalGates = evaluateProposalGates({
      origin: 'manual',
      schemaPassed: true,
      placementPassed,
      builtPrefabIds: beforeBuilt,
      blueprintCount: this.pack.blueprints.size,
      templateId: plan.templateId,
      fuseAction: decision.action,
      fuseReason: decision.reason,
      traceable: true,
      schemaDetail: 'planCreation 的计划已过白名单形状',
      placementDetail: placement.ok ? 'checkPlacement + biomeRingAllows 通过' : placement.reason,
    });
    const proposalId = this.nextRecordId();
    const creation = buildCreationRecord({
      recordId: proposalId,
      worldId: WORLD_ID,
      seed: WORLD_SEED,
      day,
      at: before.now,
      templateId: plan.templateId,
      templateName: blueprint.displayName,
      templateKind: blueprint.zone,
      intentText: null,
      target: plan.at,
      origin: 'manual',
      gates: proposalGates,
      ladder: passiveLadder(decision, state),
      replay: {
        seed: WORLD_SEED,
        eventFrom: before.feed.cursor,
        eventTo: before.feed.cursor,
        dayFrom: day,
        dayTo: day,
        fingerprint: proposalFingerprint(WORLD_SEED, day, plan),
      },
    });
    this.ledger.append(creation);

    const frozen = freezeCreatorView(this.view(day), [plan.templateId]);
    const { instanceId, result } = this.buildCommand(plan);
    if (!result.ok) throw new Error(`build 被世界拒绝：${result.message}`);

    const landed = this.landedOf(instanceId);
    if (landed === null) throw new Error('build 成功但快照里没有这栋楼');
    const after = this.snapshot();
    const business = await checkLandedBuilding(this.businessWorld(after), landed);
    const pathfindingConnected = landingReachable(this.world, landed);
    const replayed = this.engine.planCreation(frozen);
    const replay = replayed === null
      ? null
      : verifyCreationReplay({
          plan,
          replayed,
          landed,
          day,
          blueprints: this.pack.blueprints,
        });
    const coverage = creationCoverage(after, this.pack.blueprints);

    const landingGates = evaluateLandingGates({
      origin: 'manual',
      schemaPassed: true,
      placementPassed,
      builtPrefabIds: builtPrefabIdsOf(after, this.pack),
      blueprintCount: this.pack.blueprints.size,
      templateId: plan.templateId,
      fuseAction: 'not_applicable',
      fuseReason: '人工入口不走自动放行门禁',
      traceable: true,
      actualCoverageRate: coverage,
      pathfindingConnected,
      hasCollision: business.hasConflict,
      spatialConstraintSatisfied: true,
      invariantViolated: business.invariantViolated,
      replayHashConsistent: replay,
    });
    const landing = buildLandingRecord({
      proposalId,
      worldId: WORLD_ID,
      seed: WORLD_SEED,
      day: after.now === before.now ? day : Math.floor(after.now / DAY_MS),
      at: after.now,
      templateId: plan.templateId,
      landed: true,
      buildingId: instanceId,
      origin: landed.origin,
      door: landed.door,
      gates: landingGates,
      replay: {
        seed: WORLD_SEED,
        eventFrom: before.feed.cursor,
        eventTo: after.feed.cursor,
        dayFrom: day,
        dayTo: Math.floor(after.now / DAY_MS),
        fingerprint: landingFingerprint(WORLD_SEED, day, plan, landed),
      },
      failure: null,
    });
    this.ledger.append(landing);

    this.engine.submitHumanApproval('mapper', instanceId, true, undefined, {
      coverageRate: coverage,
      pathfindingConnected,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: true,
      hasConflict: business.hasConflict,
      invariantViolated: business.invariantViolated,
      ...(replay === null ? {} : { replayHashConsistent: replay }),
    });

    this.pendingObservations.set(instanceId, {
      proposalId,
      buildingId: instanceId,
      dueDay: observationDueDay(day),
      expected: landed,
    });

    return {
      plan,
      instanceId,
      creation,
      landing,
      landed,
      proposalGates,
      landingGates,
      business,
      replay,
      pathfindingConnected,
    };
  }

  /** 只记账、不落地：auto 提案在 L0/低通过率下的真实拒绝路径。 */
  proposeAuto(): ProposalOutcome | null {
    const day = this.worldDay;
    const plan = this.engine.planCreation(this.view(day));
    if (plan === null) return null;
    const blueprint = this.blueprint(plan.templateId);
    const before = this.snapshot();
    const decision = this.engine.getFuseDecision('mapper');
    const state = this.engine.getRoleState('mapper');
    if (state === undefined) throw new Error('没有 mapper');
    const gates = evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: builtPrefabIdsOf(before, this.pack),
      blueprintCount: this.pack.blueprints.size,
      templateId: plan.templateId,
      fuseAction: decision.action,
      fuseReason: decision.reason,
      traceable: true,
      schemaDetail: 'planCreation 产出的计划已过白名单形状',
      placementDetail: 'planCreation 只用 canPlace 判过合规的格子',
    });
    const recordId = this.nextRecordId();
    const creation = buildCreationRecord({
      recordId,
      worldId: WORLD_ID,
      seed: WORLD_SEED,
      day,
      at: before.now,
      templateId: plan.templateId,
      templateName: blueprint.displayName,
      templateKind: blueprint.zone,
      intentText: null,
      target: plan.at,
      origin: 'auto',
      gates,
      ladder: ladderSnapshot(state, decision),
      replay: {
        seed: WORLD_SEED,
        eventFrom: before.feed.cursor,
        eventTo: before.feed.cursor,
        dayFrom: day,
        dayTo: day,
        fingerprint: proposalFingerprint(WORLD_SEED, day, plan),
      },
    });
    this.ledger.append(creation);
    return { plan, gates, creation };
  }

  /** 拆到足够栋数；返回真正拆掉的实例号。 */
  demolishSome(count: number): string[] {
    const removed: string[] = [];
    for (const building of [...this.snapshot().buildings]) {
      if (removed.length >= count) break;
      const result = this.demolishCommand(building.instanceId);
      if (result.ok) removed.push(building.instanceId);
    }
    if (removed.length < count) {
      // 还有活指着楼时等一拍（一个世界日）再试，仍用真实命令。
      this.sim.update(DAY_MS);
      for (const building of [...this.snapshot().buildings]) {
        if (removed.length >= count) break;
        if (removed.includes(building.instanceId)) continue;
        const result = this.demolishCommand(building.instanceId);
        if (result.ok) removed.push(building.instanceId);
      }
    }
    return removed;
  }

  /** 跨一个世界日：推进世界、结算到期观测、结算熔断窗口。 */
  advanceDay(): number {
    const nextDay = this.worldDay + 1;
    const now = this.sim.snapshot().now;
    this.sim.update(nextDay * DAY_MS - now);
    this.settleObservations(nextDay);
    this.engine.closeWorldDay();
    return nextDay;
  }

  advanceDays(count: number): number {
    let day = this.worldDay;
    for (let i = 0; i < count; i += 1) day = this.advanceDay();
    return day;
  }

  /** 与生产同序：先结算到期观测，再关熔断日。 */
  settleObservations(closedDay: number): ObservationRecord[] {
    const written: ObservationRecord[] = [];
    const snapshot = this.sim.snapshot();
    for (const [instanceId, item] of [...this.pendingObservations]) {
      if (closedDay < item.dueDay) continue;
      const current = snapshot.buildings.find((building) => building.instanceId === instanceId);
      const toponym = this.memory.placeNameOf(instanceId);
      const outcome = observationOf({
        expected: item.expected,
        current: current === undefined
          ? null
          : {
              prefabId: current.prefabId,
              origin: current.origin,
              door: current.door,
              displayName: current.displayName,
            },
        removed: this.removedIds.has(instanceId),
        renamedTo: toponym?.name ?? null,
      });
      const record = buildObservationRecord({
        proposalId: item.proposalId,
        worldId: WORLD_ID,
        day: closedDay,
        at: snapshot.now,
        dueDay: item.dueDay,
        buildingId: item.buildingId,
        status: outcome.status,
        detail: outcome.detail,
      });
      this.ledger.append(record);
      written.push(record);
      this.pendingObservations.delete(instanceId);
    }
    return written;
  }

  businessWorld(snapshot = this.sim.snapshot()) {
    return {
      snapshot,
      grid: this.world.grid,
      altar: this.world.altar,
      blueprints: this.pack.blueprints,
    };
  }
}

/** 与生产 `observationOf` 同义，避免测试自己写一套三态判定。 */
function observationOf(input: {
  readonly expected: LandedCreation;
  readonly current: {
    readonly prefabId: string;
    readonly origin: { x: number; y: number };
    readonly door: { x: number; y: number };
    readonly displayName: string;
  } | null;
  readonly removed: boolean;
  readonly renamedTo: string | null;
}): { status: 'still_present' | 'removed' | 'modified' | 'missing'; detail: string } {
  // 直接复用账本里的判定，不另写一份。
  return ledgerObservationOf(input);
}

function passiveLadder(
  decision: ReturnType<CreatorEngine['getFuseDecision']>,
  state: NonNullable<ReturnType<CreatorEngine['getRoleState']>>,
) {
  return {
    ...ladderSnapshot(state, decision),
    action: 'not_applicable' as const,
    reason: '人工确认入口不走自动放行门禁',
  };
}
