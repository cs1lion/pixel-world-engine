/**
 * 感官评测探针（上层模块，非 world 内核）。
 *
 * world 内核（`world/creator/debug-bridge.ts`）按 phase 纯净规则**不允许 import 上层**，
 * 于是「躲雨判定 / 行礼状态机 / 神谕光柱 / 7 人声线 / 程序化音效」这套感官评测面整体
 * 放这里：它自己拥有感官状态机（salute / beam / tickCount / forcedVillagers），
 * 世界规则判定（`evaluateRainShelterRule`）与音频/渲染从世界与上层各自 import。
 *
 * `CreatorDebugBridge`（world 内核）只保留造物命令与存档字节/状态读法；本探针把它作为
 * 引用透传给评测：除感官方法外，其余方法（dispatchCreatorCommand / exportSaveBytes /
 * inspectSaveBytes / reloadFromBytes / stateHash 等）直接委托桥，保证两条路径读同一份世界真值。
 */
import { Simulation, type SimulationDeps } from '../world/simulation.ts';
import { evaluateRainShelterRule } from '../world/behavior-rules.ts';
import type { TaskKind, Weather } from '../world/types.ts';
import {
  createOracleBeamSpec,
  OracleBeamFx,
  beginOracleSalute,
  stepOracleSalute,
  type OracleSaluteState,
} from '../render/fx-layer.ts';
import { VILLAGER_VOICE_PROFILES, computeAnimalesePitchSeries, type VillagerVoiceProfile } from '../audio/animalese.ts';
import { ProceduralSfxEngine } from '../audio/sfx.ts';
import { CreatorDebugBridge, type CreatorCommandOutcome } from '../world/creator/debug-bridge.ts';

/** 探针依赖：当前世界实例 + 重建用的设定集依赖 + 桥（透传造物/存档方法）。 */
export interface SensorProbeDeps {
  readonly sim: Simulation;
  readonly simDeps: SimulationDeps;
  readonly bridge: CreatorDebugBridge;
}

/** 感官评测探针：世界规则的确定性判定 + 感官状态机，评测面全部收敛在这里。 */
export class SensorProbe {
  private sim: Simulation;
  private readonly simDeps: SimulationDeps;
  private readonly bridge: CreatorDebugBridge;
  /** 强制神谕在身的角色（用于躲雨优先级判据）。 */
  private forcedVillagers = new Set<string>();
  /** 当前触发的神谕光柱。 */
  private beam: OracleBeamFx | null = null;
  /** 当前神谕行礼状态机（2 逻辑拍锁定）。 */
  private salute: OracleSaluteState | null = null;
  /** 自 resetWorld 起计的逻辑拍计数（确定性、无时间源）。 */
  private tickCount = 0;

  constructor(deps: SensorProbeDeps) {
    this.sim = deps.sim;
    this.simDeps = deps.simDeps;
    this.bridge = deps.bridge;
    this.salute = beginOracleSalute();
  }

  /** 评测专用：自 resetWorld 起计的逻辑拍计数（确定性、无时间源）。 */
  private resetTickCount(): void {
    this.forcedVillagers.clear();
    this.beam = null;
    this.salute = beginOracleSalute();
    this.tickCount = 0;
  }

  /** 重建干净世界（评测用）：同一份设定集依赖 + 指定种子与开局时刻，恢复确定性起点。 */
  resetWorld(deps: { readonly seed: number; readonly now: number }): void {
    const seedNum = Number(deps.seed) >>> 0;
    const nowNum = Number(deps.now) || 0;
    this.sim = new Simulation({
      ...this.simDeps,
      initialNow: nowNum,
      worldSeed: String(seedNum),
    });
    this.resetTickCount();
  }

  /** 切换天气（评测探针，世界内部走 `setWeather`）。 */
  setWeather(weather: Weather): void {
    this.sim.setWeather(weather);
  }

  /** 下达神谕/面板动作：begin 行礼与光柱；`forced=true` 表示强制神谕在身（躲雨不覆盖）。 */
  dispatchOracle(raw: Record<string, unknown>, villagerId?: string): void {
    const id = villagerId ?? String(raw.villagerId ?? '');
    const resolved = this.resolveVillager(id);
    if (resolved === null) return;
    if (raw.forced === true) this.forcedVillagers.add(resolved.villager.id);
    this.salute = beginOracleSalute();
    this.beam = new OracleBeamFx(createOracleBeamSpec(resolved.villager.pos.x, resolved.villager.pos.y));
    this.beam.begin();
    // `assign` 只触行礼，不派真活；其余动词由世界按既有规则结算（用世界村民 id）。
    if (String(raw.kind ?? 'assign') !== 'assign') {
      this.sim.assignTo(resolved.villager.id, String(raw.kind) as TaskKind, String(raw.summary ?? ''));
    }
  }

  private resolveVillager(id: string) {
    const snap = this.sim.snapshot();
    const direct = snap.villagers.find((v) => v.id === id);
    if (direct !== undefined) {
      return { villager: { id: direct.id, pos: direct.pos, forced: this.forcedVillagers.has(direct.id) } };
    }
    // 语音 profile id（v_elder 等）映射到世界 7 位居民：按声线插入顺序对应。
    const profileIds = Object.keys(VILLAGER_VOICE_PROFILES);
    if (profileIds.length === 7 && snap.villagers.length === 7) {
      const index = profileIds.indexOf(id);
      if (index >= 0) {
        const villager = snap.villagers[index];
        if (villager !== undefined) {
          return { villager: { id: villager.id, pos: villager.pos, forced: this.forcedVillagers.has(villager.id) } };
        }
      }
    }
    return null;
  }

  /** 单个角色的感官状态投影：躲雨判定 + 行礼/光柱状态。 */
  getVillagerState(villagerId: string): {
    id: string;
    activeRule: 'rain-shelter' | null;
    targetIsBuildingDoor: boolean;
    shelterTargetId: string | null;
    bubbleTag: 'rain_shelter' | null;
    saluteTicksRemaining: number;
    isSaluting: boolean;
    actionBobPhase: number;
    hasForcedOracle: boolean;
  } | null {
    const resolved = this.resolveVillager(villagerId);
    if (resolved === null) return null;
    const snap = this.sim.snapshot();
    const decision = evaluateRainShelterRule({
      weather: snap.weather,
      villager: {
        id: resolved.villager.id,
        pos: resolved.villager.pos,
        isOutdoor: true,
        hasForcedOracle: resolved.villager.forced,
      },
      buildings: snap.buildings.map((b) => ({ id: b.instanceId, door: b.door })),
    });
    return {
      id: villagerId,
      activeRule: decision.rule,
      targetIsBuildingDoor: decision.triggered && Boolean(decision.targetDoor),
      shelterTargetId: decision.targetBuildingId,
      bubbleTag: decision.bubbleTag,
      saluteTicksRemaining: this.salute?.saluteTicksRemaining ?? 0,
      isSaluting: this.salute?.isSaluting ?? false,
      actionBobPhase: this.salute?.actionBobPhase ?? 0,
      hasForcedOracle: resolved.villager.forced,
    };
  }

  /** 7 位村民声线配置（枚举）。 */
  getVillagerVoiceProfiles(): readonly VillagerVoiceProfile[] {
    return Object.values(VILLAGER_VOICE_PROFILES) as readonly VillagerVoiceProfile[];
  }

  /** 确定性音高序列（评测用；零外部素材）。 */
  sampleAnimalesePitches(villagerId: string, text: string): number[] | undefined {
    return computeAnimalesePitchSeries(villagerId, text);
  }

  /** 光柱是否处于激活态。 */
  hasActiveFx(fxName: string): boolean {
    if (fxName !== 'oracle-beam') return false;
    return this.beam?.isActive() ?? false;
  }

  /** 固定步长推进生产世界（评测用：只推进世界与感官状态机，不另立时钟）。 */
  stepTicks(count: number): void {
    const times = Math.max(0, Math.min(5000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < times; i += 1) {
      this.sim.update(1000);
      this.tickCount += 1;
      if (this.salute !== null) this.salute = stepOracleSalute(this.salute);
      this.beam?.advance(1);
    }
  }

  /** 程序化音效触发（零外部音频网络请求；无 AudioContext 静默降级不抛异常）。 */
  triggerSfx(trigger: string): boolean {
    // 无头/SSR（window 或 AudioContext 都缺席）时传 null，引擎静默降级不抛异常。
    let audioContext: AudioContext | null = null;
    if (typeof window !== 'undefined' && typeof window.AudioContext === 'function') {
      try {
        audioContext = new window.AudioContext();
      } catch {
        audioContext = null;
      }
    }
    switch (trigger) {
      case 'rainAmbience': return new ProceduralSfxEngine(audioContext).setRainAmbience(true);
      case 'oracleChime': return new ProceduralSfxEngine(audioContext).playOracleChime();
      case 'buildComplete': return new ProceduralSfxEngine(audioContext).playBuildComplete();
      case 'footstep': return new ProceduralSfxEngine(audioContext).playFootstep();
      default: return false;
    }
  }

  /** 确定性状态哈希（评测 K3：同种子 + 同事件序列重放两次必须哈希一致；不碰时间源）。 */
  getStateHash(): string {
    const snap = this.sim.snapshot();
    const curated = {
      now: snap.now,
      weather: snap.weather,
      villagers: snap.villagers.map((v) => ({
        id: v.id,
        name: v.name,
        pos: `${v.pos.x}:${v.pos.y}`,
        bubble: v.bubble ?? null,
        taskId: v.taskId ?? null,
      })),
      buildings: snap.buildings.map((b) => b.instanceId),
      roads: snap.roads.length,
      salute: this.salute,
      beam: this.beam,
      forcedVillagers: [...this.forcedVillagers],
      tickCount: this.tickCount,
    };
    return JSON.stringify(curated);
  }

  /** 评测用存档字节视图：投影躲雨目标与行礼剩余拍数进 `world.sensory`。 */
  exportSaveJson(): string {
    const base = this.exportSaveBytes();
    const pkg = JSON.parse(base) as { readonly world?: Record<string, unknown>; };
    const world = (pkg.world ?? {}) as Record<string, unknown>;
    const snap = this.sim.snapshot();
    const villagerDecisions = snap.villagers.map((v) => {
      const buildings = snap.buildings.map((b) => ({ id: b.instanceId, door: b.door }));
      const decision = evaluateRainShelterRule({
        weather: snap.weather,
        villager: { id: v.id, pos: v.pos, isOutdoor: true, hasForcedOracle: false },
        buildings,
      });
      return decision;
    });
    const sensory = {
      saluteTicksRemaining: this.salute?.saluteTicksRemaining ?? 0,
      shelterTargetId: villagerDecisions.map((d) => d.targetBuildingId),
      activeRule: villagerDecisions.map((d) => d.rule),
      bubbleTag: villagerDecisions.map((d) => d.bubbleTag),
      beamActive: this.beam?.isActive() ?? false,
      hasForcedOracle: this.forcedVillagers.size > 0,
    };
    world.sensory = sensory;
    return JSON.stringify(pkg);
  }

  /** 委托桥：造物命令与存档字节/状态读法（world 内核的同一条读法）。 */
  dispatchCreatorCommand(raw: Record<string, unknown>): CreatorCommandOutcome {
    return this.bridge.dispatchCreatorCommand(raw);
  }
  inspectSaveBytes(bytes: string): Record<string, unknown> {
    return this.bridge.inspectSaveBytes(bytes);
  }
  reloadFromBytes(bytes: string): void {
    this.bridge.reloadFromBytes(bytes);
  }
  exportSaveBytes(): string {
    return this.bridge.exportSaveBytes();
  }
  stateHash(): string {
    return this.bridge.stateHash();
  }
  gridSnapshot(): string {
    return this.bridge.gridSnapshot();
  }
}
