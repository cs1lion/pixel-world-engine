/** 回放运行时：把世界、记忆、造物三层的接线从 `SandboxScene` 搬进无头 Node。
 *
 * 这里只搬运**场景已经做过的事**，不新写规则：
 *   - `Simulation.onChange` → `MemoryRuntime.observe`（`observationOf` 同一张翻译表）；
 *   - 每拍 `syncHolders` + 建筑地点 + `lookAtTraces`，再 `memory.tick(now)`；
 *   - 跨日 `onVitals` → `CreatorEngine.closeWorldDay` / `processDayClosed`，
 *     按熔断读数决定要不要自动提议，落地方走 `Simulation.enqueue({kind:'build'})`；
 *   - 之后按场景同一条事后判定回填 `submitHumanApproval` 的门禁读数。
 *
 * **只读 `creator/fuse.ts` 的公开输出**：`getFuseDecision`、`getAllRoleStates`、
 * `closeWorldDay`、`processDayClosed`、`planCreation`、`submitHumanApproval`。
 * 一条记账逻辑都没有改。
 */

import { selectSetting, worldForSetting, routineProfiles, siteTargetResolver } from '../settings/index.ts';
import type { SettingPack } from '../settings/types.ts';
import type { BuiltWorld } from '../world/setup.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../world/setup.ts';
import { Simulation } from '../world/simulation.ts';
import type { NewBuilding, SimulationDeps } from '../world/simulation.ts';
import { fogAt } from '../world/fog.ts';
import { footfallPlace, cellPlaceId } from '../world/ambient.ts';
import { DAY_MS } from '../world/memory/config.ts';
import { MemoryRuntime } from '../world/memory/runtime.ts';
import type { MemoryRuntimeSnapshot, RuntimeObservation } from '../world/memory/runtime.ts';
import type { MemoryEvent } from '../world/memory/types.ts';
import { observationOf } from '../world/memory/observe.ts';
import type { LandmarkEvent } from '../world/memory/landmark.ts';
import { CreatorEngine } from '../creator/engine.ts';
import type { CreatorWorldView } from '../creator/engine.ts';
import { checkLandedBuilding, creationCoverage } from '../creator/business-rules.ts';
import type { LandedCreation } from '../creator/landing.ts';
import { freezeCreatorView, landingReachable, verifyCreationReplay } from '../creator/landing.ts';
import type { CreationPlan } from '../world/creator-schema.ts';
import type { WorldChange } from '../world/world-changes.ts';
import type {
  GridPoint,
  PlacedBuilding,
  WorldEvent,
  WorldSnapshot,
} from '../world/types.ts';
import type { WorldSave } from '../world/save.ts';
import {
  canonicalJson,
  sha256Hex,
  TraceFormatError,
} from './format.ts';
import type {
  TraceCommand,
  TraceCreatorBusiness,
  TraceDayClose,
  TraceInjection,
  TraceInput,
  TraceLanding,
  TraceMemoryBusiness,
  TraceProposal,
} from './format.ts';

export interface CapturedEvent {
  readonly seq: number;
  readonly at: number;
  readonly tone: WorldEvent['tone'];
  readonly text: string;
}

interface PendingCreation {
  readonly plan: CreationPlan;
  readonly day: number;
  readonly traceable: boolean;
  readonly recompute: () => CreationPlan | null;
  readonly summary: string;
}

export interface RuntimeFingerprints {
  readonly world: string;
  readonly memory: string | null;
  readonly creator: string | null;
}

export interface StepCheckpoint extends RuntimeFingerprints {
  readonly step: number;
  readonly atWorldMs: number;
}

export class TraceRuntime {
  readonly input: TraceInput;
  readonly pack: SettingPack;
  readonly world: BuiltWorld;
  readonly sim: Simulation;
  readonly memory: MemoryRuntime | null;
  readonly creator: CreatorEngine | null;
  readonly events: CapturedEvent[] = [];
  readonly memoryEvents: MemoryEvent[] = [];
  readonly proposals: TraceProposal[] = [];
  readonly landings: TraceLanding[] = [];
  readonly dayCloses: TraceDayClose[] = [];
  readonly checkpoints: StepCheckpoint[] = [];

  private capturedSeq = 0;
  private memoryEventSerial = 0;
  private seenDay = -1;
  private readonly seenToday = new Set<string>();
  private placeHolders: ReadonlySet<string> = new Set();
  /**
   * 上一拍结束时还在场的建筑（按实例 id 记一份副本）。
   *
   * `onChange` 发生在 `sim.update()` 内部：拆楼那一笔已经出了 `sim.buildings`，
   * 但这一拍的快照还没生成。只查实时世界的话，拆楼永远找不到门坐标，地标
   * 与「冲突」都落不了账。场景里用的是上一帧快照，这里存副本而不是引用，
   * 免得 `snapshot()` 返回的数组被同一个 update 改掉。
   */
  private lastBuildings: ReadonlyMap<string, PlacedBuilding> = new Map();
  private readonly pendingCreations = new Map<string, PendingCreation>();
  private settlementPromises: Promise<void>[] = [];
  private readonly isLegacyWorld: boolean;

  constructor(input: TraceInput) {
    this.input = input;
    this.isLegacyWorld = input.worldId === 'default';
    const search = input.worldId === 'default' ? '' : `?world=${encodeURIComponent(input.worldId)}`;
    try {
      this.pack = selectSetting(search);
    } catch (error) {
      throw new TraceFormatError(
        `worldId=${input.worldId} 没有对应的设定集：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const baseline = input.baseline;
    this.world = baseline === undefined
      ? worldForSetting(this.pack)
      : worldForSetting(this.pack, baseline.save.world.buildings);

    const outer = input.outer;
    this.memory = outer?.memory === true
      ? new MemoryRuntime({
          worldId: input.worldId,
          occlusion: this.world.grid,
          insideAt: (point) => this.buildingIdAt(point),
          placeIndoor: (placeId) =>
            this.sim.snapshot().buildings.some((building) => building.instanceId === placeId),
          onVitals: (vitals) => this.handleVitals(vitals),
          onEvent: (event) => this.memoryEvents.push(event),
        })
      : null;
    if (this.memory !== null && baseline !== undefined) {
      const text = baseline.save.world.memory;
      const restored = this.memory.fromJSON(text);
      if (!restored && text !== '') {
        throw new TraceFormatError('baseline 里的记忆段无法复原：形状不认识或版本高于当前');
      }
    }
    this.creator = outer?.creator === true
      ? new CreatorEngine(this.pack, {
          worldSeed: input.worldSeed,
          worldTime: () => this.sim.snapshot().now,
          world: this.world,
        })
      : null;

    this.sim = this.createSimulation(baseline?.save);
    this.cacheBuildings();
    if (this.memory !== null) {
      this.sim.connectVerification({
        probe: (holderId) =>
          this.memory!.pendingVerifications(holderId).map((plan) => ({
            placeId: plan.placeId,
            claimId: plan.claimId,
          })),
        settle: (holderId, claimId) => this.memory!.settleVerification(holderId, claimId),
      });
    }
  }

  private createSimulation(baseline: WorldSave | undefined): Simulation {
    const blueprints = this.pack.blueprints;
    const deps: SimulationDeps = {
      grid: this.world.grid,
      buildings: this.world.buildings,
      altar: this.world.altar,
      villagerName: this.pack.villagers[0]?.name ?? '莞尔',
      wallClock: () => 0,
      blueprints,
      worldSize: { width: this.world.grid.width, height: this.world.grid.height },
      spawnBuilding: (
        prefabId: string,
        instanceId: string,
        at?: GridPoint,
        source?: { readonly taskId: string; readonly summary: string },
      ): NewBuilding | null => {
        const blueprint = blueprints.get(prefabId);
        if (blueprint === undefined) return null;
        return placeBlueprint(this.world.grid, blueprint, instanceId, this.world.altar, at, source);
      },
      onChange: (change, at) => this.handleChange(change, at),
      ...(this.pack.villagers.length > 0
        ? {
            villagerNames: this.pack.villagers.map((villager) => villager.name),
            villagerProfiles: routineProfiles(this.pack, siteTargetResolver(this.pack, this.world.grid, this.world.buildings)),
          }
        : {}),
      ...(this.pack.regions.length > 0
        ? { regionNames: new Map(this.pack.regions.map((region) => [region.id, region.name])) }
        : {}),
      ...(this.pack.propReveals !== undefined ? { propReveals: this.pack.propReveals } : {}),
      ...(this.pack.authored === true ? { authored: true } : {}),
    };
    return baseline === undefined
      ? new Simulation({ ...deps, initialNow: this.input.initialNow })
      : Simulation.fromSave(baseline, deps);
  }

  /** 跑一拍：世界先走，落地观测结算，然后记忆层对齐与关账。 */
  async step(deltaMs: number): Promise<void> {
    this.cacheBuildings();
    this.sim.update(deltaMs);
    this.collectEvents();
    await this.settlePendingLandings();
    this.stepMemory();
  }

  /** 一条轨迹注入。世界命令走同一个 `enqueue`；造物走引擎校验后的 build。 */
  applyInjection(injection: TraceInjection): void {
    if (injection.kind === 'weather') {
      this.sim.enqueue({ kind: 'setWeather', weather: injection.payload.weather });
      return;
    }
    if (injection.kind === 'intent') {
      this.sim.enqueue({ kind: 'oracle', raw: injection.payload.raw });
      return;
    }
    if (injection.kind === 'command') {
      this.sim.enqueue(toWorldCommand(injection.payload.command));
      return;
    }
    if (injection.kind === 'memory') {
      this.applyMemoryObservation(injection.payload);
      return;
    }
    this.applyCreatorBuild(injection.payload);
  }

  /**
   * 一条记忆层注入：走 `MemoryRuntime.observe`，与场景 `remember()` 同一扇门。
   *
   * 显式给 `witnesses` 而不是靠感知模型：轨迹要能被单独复算，目击者名单
   * 必须是输入的一部分。没给时才退回感知模型。
   */
  private applyMemoryObservation(payload: {
    readonly eventId: string;
    readonly memoryKind: string;
    readonly placeId: string;
    readonly at: GridPoint;
    readonly actors: readonly string[];
    readonly witnesses?: readonly string[];
    readonly what?: string;
    readonly valence?: number;
    readonly arousal?: number;
    readonly importanceHint?: number;
  }): void {
    const memory = this.memory;
    if (memory === null) {
      throw new TraceFormatError('轨迹里有 memory 注入，但 outer.memory 不是 true');
    }
    memory.observe(
      {
        eventId: payload.eventId,
        kind: payload.memoryKind,
        placeId: payload.placeId,
        at: payload.at,
        actors: [...payload.actors],
        outcome: { what: payload.what ?? payload.eventId },
        importanceHint: payload.importanceHint ?? 0.6,
        ...(payload.valence === undefined ? {} : { valence: payload.valence }),
        ...(payload.arousal === undefined ? {} : { arousal: payload.arousal }),
      },
      payload.witnesses === undefined ? undefined : [...payload.witnesses],
      this.sim.snapshot().now,
    );
  }

  private applyCreatorBuild(payload: {
    readonly templateId: string;
    readonly at: GridPoint;
    readonly summary?: string;
  }): void {
    const creator = this.creator;
    if (creator === null) {
      throw new TraceFormatError('轨迹里有 creatorBuild，但 outer.creator 不是 true');
    }
    const snapshot = this.sim.snapshot();
    const day = Math.floor(snapshot.now / DAY_MS);
    const view = this.creatorWorldView(snapshot);
    const frozen = freezeCreatorView(
      view,
      [...this.pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
    );
    const plan = creator.proposeCreation({
      templateId: payload.templateId,
      at: payload.at,
      worldSize: { width: this.world.grid.width, height: this.world.grid.height },
    });
    const reason = payload.summary ?? `第 ${day} 天人工造物：${plan.templateId}`;
    const instanceId = this.sim.nextInstanceId(plan.templateId);
    this.pendingCreations.set(instanceId, {
      plan,
      day,
      traceable: true,
      recompute: () => creator.planCreation(frozen),
      summary: reason,
    });
    this.proposals.push({
      day,
      atWorldMs: snapshot.now,
      source: 'creatorBuild',
      templateId: plan.templateId,
      at: plan.at,
      reason,
      accepted: true,
      instanceId,
      fuseAction: creator.getFuseDecision('mapper').action,
    });
    this.sim.enqueue({
      kind: 'build',
      prefabId: plan.templateId,
      instanceId,
      at: plan.at,
      source: { taskId: `creator-${plan.templateId}`, summary: reason },
    });
  }

  /** 场景同款的 `onChange`：记忆记一条，造物落地后补事后判定。 */
  private handleChange(change: WorldChange, at: number): void {
    const memory = this.memory;
    if (memory !== null) {
      this.memoryEventSerial += 1;
      const observation = observationOf(change, `mem_${this.memoryEventSerial}`, {
        atOfHolder: (holderId) => {
          const villager = this.sim.snapshot().villagers.find((item) => item.id === holderId);
          return villager === undefined ? undefined : { x: villager.pos.x, y: villager.pos.y };
        },
        atOfBuilding: (instanceId) => {
          const live = this.sim.buildingById(instanceId);
          const building =
            live
            ?? this.lastBuildings.get(instanceId)
            ?? this.sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
          return building === undefined ? undefined : { x: building.door.x, y: building.door.y };
        },
        buildingOfTask: (taskId) =>
          this.sim.snapshot().tasks.find((item) => item.id === taskId)?.buildingId ?? undefined,
      });
      if (observation !== null) {
        const landmark = this.landmarkEventOf(change);
        const withLandmark: RuntimeObservation =
          landmark === undefined ? observation : { ...observation, landmark };
        memory.observe(withLandmark, undefined, at);
      }
    }
    if (change.change === 'building.built' && this.creator !== null) {
      // 先判「这是不是造物主自己提的案」，再交给对应的结算：
      // `settleLanding` 会把这个 id 从 pending 里删掉，顺序反了就永远判成「外来落地」。
      const wasPending = this.pendingCreations.has(change.instanceId);
      this.settlementPromises.push(this.settleLanding(change.instanceId));
      // 神谕 / 世界入口建的楼也走一遍落地后业务规则，与浏览器侧 `recordUnplannedLanding`
      // 同口径：世界层账记下来，但**不**喂外环门禁（那不是外环提的案）。
      if (!wasPending) this.settlementPromises.push(this.settleUnplannedLanding(change.instanceId));
    }
  }

  /**
   * 每拍开头把在场建筑记一份浅副本。拆楼发生在 `update()` 内部，实时世界
   * 已经查不到那栋楼，只能靠这一份。
   */
  private cacheBuildings(): void {
    const map = new Map<string, PlacedBuilding>();
    for (const building of this.sim.snapshot().buildings) {
      map.set(building.instanceId, {
        ...building,
        origin: { ...building.origin },
        door: { ...building.door },
        footprint: { ...building.footprint },
      });
    }
    this.lastBuildings = map;
  }

  private landmarkEventOf(change: WorldChange): LandmarkEvent | undefined {
    if (change.change !== 'building.built' && change.change !== 'building.removed') return undefined;
    const building =
      this.sim.buildingById(change.instanceId)
      ?? this.lastBuildings.get(change.instanceId)
      ?? this.sim.snapshot().buildings.find((item) => item.instanceId === change.instanceId);
    if (building === undefined) return undefined;
    return {
      change: change.change === 'building.built' ? 'built' : 'removed',
      displayName: change.displayName,
      origin: { x: building.origin.x, y: building.origin.y },
      footprint: { w: building.footprint.w, h: building.footprint.h },
    };
  }

  /** 落地之后的门禁读数，与 `SandboxScene.settleCreationObservation` 同一套。 */
  private async settleLanding(instanceId: string): Promise<void> {
    const pending = this.pendingCreations.get(instanceId);
    if (pending === undefined) return;
    this.pendingCreations.delete(instanceId);
    const creator = this.creator;
    if (creator === null) return;
    const snapshot = this.sim.snapshot();
    const building = snapshot.buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) return;
    const landed: LandedCreation = {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    };
    const replayed = pending.recompute();
    const replay =
      replayed === null
        ? null
        : verifyCreationReplay({
            plan: pending.plan,
            replayed,
            landed,
            day: pending.day,
            blueprints: this.pack.blueprints,
          });
    const pathfindingConnected = landingReachable(this.world, landed);
    const coverageRate = creationCoverage(snapshot, this.pack.blueprints);
    const business = await checkLandedBuilding(
      {
        snapshot,
        grid: this.world.grid,
        altar: this.world.altar,
        blueprints: this.pack.blueprints,
      },
      landed,
    );
    creator.submitHumanApproval('mapper', instanceId, true, undefined, {
      coverageRate,
      pathfindingConnected,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: pending.traceable,
      hasConflict: business.hasConflict,
      invariantViolated: business.invariantViolated,
      ...(replay === null ? {} : { replayHashConsistent: replay }),
    });
    this.landings.push({
      instanceId,
      templateId: pending.plan.templateId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
      coverageRate,
      pathfindingConnected,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: pending.traceable,
      replayHashConsistent: replay,
      hasConflict: business.hasConflict,
      invariantViolated: business.invariantViolated,
    });
  }

  /**
   * 非造物主提案的落地：跑一遍业务规则并记一条 landing，与浏览器侧同口径。
   *
   * 为什么必须有无头版本：同一个世界有两个执行器（`SandboxScene` 与 `TraceRuntime`）。
   * 只有浏览器会检查神谕建的楼时，「同种子回放哈希一致」这类门禁就建立在一个
   * 覆盖不全的账本上——两边都正常，数字不同。
   *
   * 不喂 fuse：`submitHumanApproval` / `recordCommandResult` 一次都不调。
   * 外环的通过率只算它自己提的案（`ADR_SCHEMA_PASS_RATE_SEMANTICS`）。
   */
  private async settleUnplannedLanding(instanceId: string): Promise<void> {
    const creator = this.creator;
    if (creator === null) return;
    const snapshot = this.sim.snapshot();
    const building = snapshot.buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) return;
    const landed: LandedCreation = {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    };
    // 全部读数在 await **之前**从这一份捕获快照算定。
    // 评审指出：若楼在结算期间被拆，`this.world.grid` 已经不是落地那一刻的网格，
    // await 之后再问 landingReachable 会拿到被改写过的答案。
    // 生产规则其实禁止施工期拆除，但把读数冻在同一份快照上更稳，且行为不变。
    const coverageRate = creationCoverage(snapshot, this.pack.blueprints);
    const pathfindingConnected = landingReachable(this.world, landed);
    const business = await checkLandedBuilding(
      {
        snapshot,
        grid: this.world.grid,
        altar: this.world.altar,
        blueprints: this.pack.blueprints,
      },
      landed,
    );
    // 场景可能已经换了世界；那这次结果不属于任何引擎。
    if (this.creator !== creator) return;
    // 这个入口没有冻住落地前的 view，回放一致性**没跑**，记 null。
    this.landings.push({
      instanceId,
      templateId: building.prefabId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
      coverageRate,
      pathfindingConnected,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: false,
      replayHashConsistent: null,
      hasConflict: business.hasConflict,
      invariantViolated: business.invariantViolated,
    });
  }

  private async settlePendingLandings(): Promise<void> {
    if (this.settlementPromises.length === 0) return;
    const pending = this.settlementPromises;
    this.settlementPromises = [];
    await Promise.all(pending);
  }

  /** 世界日关账：心电图 → 熔断结算 → 导演决策 → 当天的造物提议。 */
  private handleVitals(vitals: {
    readonly day: number;
    readonly meanValence: number;
    readonly meanArousal: number;
    readonly infoEntropy: number;
    readonly isolatedHoldersCount: number;
  }): void {
    const creator = this.creator;
    if (creator === null) return;
    creator.closeWorldDay();
    const decision = creator.processDayClosed({
      meanValence: vitals.meanValence,
      meanArousal: vitals.meanArousal,
      infoEntropy: vitals.infoEntropy,
      isolatedHoldersCount: vitals.isolatedHoldersCount,
    });
    const fuse = creator.getFuseDecision('mapper');
    const snapshot = this.sim.snapshot();
    const view = this.creatorWorldView(snapshot);
    const proposal = creator.planCreation(view);
    let autoEnqueued = false;
    if (fuse.action === 'allow' && proposal !== null) {
      const frozen = freezeCreatorView(
        view,
        [...this.pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
      );
      const instanceId = this.sim.nextInstanceId(proposal.templateId);
      this.pendingCreations.set(instanceId, {
        plan: proposal,
        day: view.day,
        traceable: true,
        recompute: () => creator.planCreation(frozen),
        summary: proposal.reason,
      });
      this.proposals.push({
        day: view.day,
        atWorldMs: snapshot.now,
        source: 'dayClose',
        templateId: proposal.templateId,
        at: proposal.at,
        reason: proposal.reason,
        accepted: true,
        instanceId,
        fuseAction: fuse.action,
      });
      this.sim.enqueue({
        kind: 'build',
        prefabId: proposal.templateId,
        instanceId,
        at: proposal.at,
        source: { taskId: `creator-${proposal.templateId}`, summary: proposal.reason },
      });
      autoEnqueued = true;
    } else if (proposal !== null) {
      this.proposals.push({
        day: view.day,
        atWorldMs: snapshot.now,
        source: 'dayClose',
        templateId: proposal.templateId,
        at: proposal.at,
        reason: proposal.reason,
        accepted: false,
        instanceId: null,
        fuseAction: fuse.action,
      });
    }
    this.dayCloses.push({
      day: view.day,
      vitals: {
        meanValence: vitals.meanValence,
        meanArousal: vitals.meanArousal,
        infoEntropy: vitals.infoEntropy,
        isolatedHoldersCount: vitals.isolatedHoldersCount,
      },
      shouldInject: decision.shouldInject,
      eventKind: decision.eventKind ?? null,
      reasoning: decision.reasoning,
      fuse: {
        action: fuse.action,
        reason: fuse.reason,
        suggestedLevel: fuse.suggestedLevel ?? null,
      },
      proposal: proposal === null
        ? null
        : { templateId: proposal.templateId, at: proposal.at, reason: proposal.reason },
      autoEnqueued,
    });
  }

  /** 喂给造物引擎的世界现状。与 `SandboxScene.creatorWorldView` 同一套判据。 */
  private creatorWorldView(snapshot: WorldSnapshot): CreatorWorldView {
    return {
      day: Math.floor(snapshot.now / DAY_MS),
      builtPrefabIds: new Set(snapshot.buildings.map((building) => building.prefabId)),
      width: this.world.grid.width,
      height: this.world.grid.height,
      canPlace: (prefabId: string, at: GridPoint) => {
        const blueprint = this.pack.blueprints.get(prefabId);
        if (blueprint === undefined) return false;
        if (fogAt(at, snapshot.fog)) return false;
        if (!checkPlacement(this.world.grid, blueprint, at).ok) return false;
        return biomeRingAllows(prefabId, at, this.world.altar);
      },
    };
  }

  /** 记忆层跟上世界：位置、地点名册、痕迹、跨日关账。 */
  private stepMemory(): void {
    const memory = this.memory;
    if (memory === null) return;
    const snapshot = this.sim.snapshot();
    memory.syncHolders(
      snapshot.villagers.map((villager) => ({
        holderId: villager.id,
        type: 'character' as const,
        at: { x: villager.pos.x, y: villager.pos.y },
      })),
    );
    this.sightsee(snapshot);
    memory.tick(snapshot.now);
  }

  private sightsee(snapshot: WorldSnapshot): void {
    const memory = this.memory;
    if (memory === null) return;
    const day = Math.floor(snapshot.now / DAY_MS);
    if (this.seenDay !== day) {
      this.seenDay = day;
      this.seenToday.clear();
    }
    const landmarkCells = this.landmarkCellsOf(snapshot);
    memory.syncHolders([
      ...snapshot.buildings.map((building) => ({
        holderId: building.instanceId,
        type: 'place' as const,
        at: { x: building.door.x, y: building.door.y },
        name: building.displayName,
      })),
      ...landmarkCells.map((cell) => ({
        holderId: cellPlaceId(cell),
        type: 'place' as const,
        at: { x: cell.x, y: cell.y },
      })),
    ]);
    const standing = new Set(snapshot.buildings.map((building) => building.instanceId));
    for (const placeId of this.placeHolders) {
      if (standing.has(placeId)) continue;
      memory.removePlace(placeId);
    }
    this.placeHolders = standing;
    const places = [...standing, ...landmarkCells.map((cell) => cellPlaceId(cell))];
    for (const villager of snapshot.villagers) {
      for (const placeId of places) {
        const key = `${villager.id}\u0000${placeId}`;
        if (this.seenToday.has(key)) continue;
        const inferred = memory.lookAtTraces(villager.id, placeId);
        if (inferred.length === 0) continue;
        this.seenToday.add(key);
      }
    }
  }

  /** 设定集作息落点里不归楼的那些；老世界（莞尔镇）一个都不登记。 */
  private landmarkCellsOf(snapshot: WorldSnapshot): readonly GridPoint[] {
    if (this.isLegacyWorld) return [];
    const doorways = snapshot.buildings.map((building) => ({
      instanceId: building.instanceId,
      x: building.door.x,
      y: building.door.y,
    }));
    const cells: GridPoint[] = [];
    const seen = new Set<string>();
    for (const villager of this.pack.villagers) {
      for (const stop of villager.routine) {
        // 场所落点不登记成地标：它由 `sites` 表解析，不是一格写死的坐标作息点。
        // 登记进去会凭空多一个 place holder，改掉记忆读数与夹具。
        if ('site' in stop) continue;
        const key = `${stop.x},${stop.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (footfallPlace(stop, doorways) !== cellPlaceId(stop)) continue;
        cells.push({ x: stop.x, y: stop.y });
      }
    }
    cells.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return cells;
  }

  private buildingIdAt(point: GridPoint): string | null {
    for (const building of this.sim.snapshot().buildings) {
      const { origin, footprint } = building;
      if (
        point.x >= origin.x
        && point.y >= origin.y
        && point.x < origin.x + footprint.w
        && point.y < origin.y + footprint.h
      ) {
        return building.instanceId;
      }
    }
    return null;
  }

  private collectEvents(): void {
    const total = this.sim.eventCount();
    for (let seq = this.capturedSeq; seq < total; seq += 1) {
      const event = this.sim.eventAt(seq);
      if (event === null) {
        throw new TraceFormatError(
          `世界事件 #${seq} 已被 60 条窗口挤掉；这一拍的事件太密，回放会漏。`,
        );
      }
      this.events.push({ seq, at: event.at, tone: event.tone, text: event.text });
    }
    this.capturedSeq = total;
  }

  snapshot(): WorldSnapshot {
    return this.sim.snapshot();
  }

  memorySnapshot(): MemoryRuntimeSnapshot | null {
    return this.memory === null ? null : this.memory.toSnapshot();
  }

  memoryBusiness(): TraceMemoryBusiness | null {
    const snapshot = this.memorySnapshot();
    if (snapshot === null) return null;
    return {
      lastClosedDay: snapshot.lastClosedDay,
      currentDay: snapshot.world.currentDay,
      holders: snapshot.world.holders.length,
      facts: snapshot.world.facts.length,
      entries: snapshot.world.entries.length,
      claims: snapshot.world.claims.length,
      beliefs: snapshot.world.beliefs.length,
      traces: snapshot.world.traces.reduce((sum, item) => sum + item.entries.length, 0),
      landmarks: snapshot.world.landmarks.length,
      turningPoints: snapshot.world.turningPoints.length,
      bonds: snapshot.world.bonds.length,
      moods: snapshot.world.moods.length,
      bondTrustSum: round6(snapshot.world.bonds.reduce((sum, bond) => sum + bond.trust, 0)),
      moodValenceSum: round6(snapshot.world.moods.reduce((sum, mood) => sum + mood.valence, 0)),
      legends: snapshot.world.legends.length,
      placeNames: snapshot.world.placeNames.length,
      announcements: snapshot.world.announcements.length,
      written: snapshot.world.written.length,
      credibility: snapshot.world.credibility.length,
      metToday: snapshot.world.metToday.length,
    };
  }

  memoryFingerprint(): string | null {
    const snapshot = this.memorySnapshot();
    return snapshot === null ? null : sha256Hex(canonicalJson(snapshot));
  }

  creatorBusiness(): TraceCreatorBusiness | null {
    const creator = this.creator;
    if (creator === null) return null;
    const roles = [...creator.getAllRoleStates().values()]
      .sort((a, b) => a.roleId.localeCompare(b.roleId))
      .map((role) => ({
        roleId: role.roleId,
        currentLevel: role.currentLevel,
        targetLevel: role.targetLevel,
        isFused: role.isFused,
        lastRegressionPassed:
          role.lastRegressionPassed === undefined ? null : role.lastRegressionPassed,
        batches: role.metrics.batches,
        days: role.metrics.days,
        totalCommands: role.metrics.totalCommands,
        schemaPassCount: role.metrics.schemaPassCount,
        conflictCount: role.metrics.conflictCount,
        conflictChecks: role.metrics.conflictChecks,
        invariantChecks: role.metrics.invariantChecks,
      }));
    return {
      dayCloses: this.dayCloses,
      proposals: this.proposals,
      landings: this.landings,
      roles,
    };
  }

  creatorFingerprint(): string | null {
    const business = this.creatorBusiness();
    return business === null ? null : sha256Hex(canonicalJson(business));
  }

  fingerprints(): RuntimeFingerprints {
    return {
      world: sha256Hex(canonicalJson(projectWorld(this.sim.snapshot()))),
      memory: this.memoryFingerprint(),
      creator: this.creatorFingerprint(),
    };
  }

  /** 只读导出：回放器要拿它当下一段轨迹的基线，不写回任何真实存档。 */
  save(): WorldSave {
    return this.sim.toSave(this.memory === null ? '' : this.memory.toJSON());
  }
}

/** 世界状态投影：只收可复算的事实，数组按稳定键排序。 */
export function projectWorld(snapshot: WorldSnapshot): Record<string, unknown> {
  return {
    now: snapshot.now,
    weather: snapshot.weather,
    tide: {
      level: snapshot.tide.level,
      rising: snapshot.tide.rising,
      overridden: snapshot.tide.overridden,
    },
    faith: snapshot.faith,
    deliveries: snapshot.deliveries,
    // 失败事件账是正式事件流的一部分，必须进投影：日报数它，回放也要逐字
    // 复现它。按 taskId 排序（每单最多一条，天然唯一），与其它数组同规矩。
    deliveryFailures: [...snapshot.deliveryFailures]
      .sort((a, b) => a.taskId.localeCompare(b.taskId))
      .map((failure) => ({
        at: failure.at,
        taskId: failure.taskId,
        summary: failure.summary,
        workerId: failure.workerId,
        source: failure.source,
        reason: failure.reason,
        repeat: failure.repeat,
        placeId: failure.placeId,
        where: failure.where,
      })),
    deliveriesByVillager: [...snapshot.deliveriesByVillager].sort((a, b) =>
      a.villagerId.localeCompare(b.villagerId),
    ),
    buildings: [...snapshot.buildings]
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
      .map(projectBuilding),
    villagers: [...snapshot.villagers]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((villager) => ({
        id: villager.id,
        name: villager.name,
        mode: villager.mode,
        pos: villager.pos,
        facing: villager.facing,
        visible: villager.visible,
        taskId: villager.taskId,
        bubble: villager.bubble,
        routine: villager.routine,
        walking: villager.walking,
        carrying: villager.carrying,
        lampOil: villager.lampOil,
        nameState: villager.nameState,
        carries: [...villager.carries].sort(),
      })),
    tasks: [...snapshot.tasks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({
        id: task.id,
        kind: task.kind,
        summary: task.summary,
        buildingId: task.buildingId,
        source: task.source,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        workerId: task.workerId,
        blockedQuestion: task.blockedQuestion,
      })),
    pending: [...snapshot.pending]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        requestedAt: item.requestedAt,
        source: item.source,
        summary: item.summary,
        villagerId: item.villagerId,
      })),
    props: [...snapshot.props]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((prop) => ({
        id: prop.id,
        kind: prop.kind,
        at: prop.at,
        label: prop.label,
        sourceTaskKind: prop.sourceTaskKind,
        sourceTaskId: prop.sourceTaskId,
        sourceSummary: prop.sourceSummary,
        grime: prop.grime,
        reveal: prop.reveal,
      })),
    constructions: [...snapshot.constructions].sort((a, b) =>
      a.buildingId.localeCompare(b.buildingId),
    ),
    oracle: snapshot.oracle,
    critters: snapshot.critters,
    fog: snapshot.fog,
    roads: snapshot.roads,
    trails: snapshot.trails,
  };
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function projectBuilding(building: PlacedBuilding): Record<string, unknown> {
  return {
    instanceId: building.instanceId,
    prefabId: building.prefabId,
    displayName: building.displayName,
    zone: building.zone,
    origin: building.origin,
    footprint: building.footprint,
    door: building.door,
    workSpot: building.workSpot,
    boundTask: building.boundTask,
    sourceTaskId: building.sourceTaskId ?? null,
    sourceSummary: building.sourceSummary ?? null,
  };
}

function toWorldCommand(command: TraceCommand): Parameters<Simulation['enqueue']>[0] {
  switch (command.kind) {
    case 'setWeather':
      return { kind: 'setWeather', weather: command.weather };
    case 'setTideLevel':
      return { kind: 'setTideLevel', level: command.level, durationMs: command.durationMs };
    case 'miracle':
      return {
        kind: 'miracle',
        miracle: command.miracle,
        ...(command.at === undefined ? {} : { at: command.at }),
      };
    case 'demolish':
      return { kind: 'demolish', instanceId: command.instanceId };
    case 'build':
      return {
        kind: 'build',
        prefabId: command.prefabId,
        instanceId: command.instanceId,
        ...(command.at === undefined ? {} : { at: command.at }),
      };
  }
}
