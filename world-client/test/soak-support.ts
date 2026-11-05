/**
 * 长周期联合浸泡测试的夹具。**不是测试文件**（文件名不带 `.test`）。
 *
 * 这一份把「真实的世界」搭起来，让四个子系统同时跑满 30 个世界日：
 *
 * 1. 5 名居民（默认环线，`hasExplicitRoutine = false`）——睡/醒、打水、市面四拍；
 * 2. 天气三档（晴 / 雨 / 暴雨，见 `weatherPlan`）与自然潮汐；
 * 3. 造物主：第 0/3 天（L0/L1）被熔断拒绝，第 6 天用真实观测爬梯到 L3，
 *    之后每 3 天拆掉一栋再提一次（含落地与 7 日观测）；
 * 4. 记忆层：每个 `world.event` 都翻成观察，跨日关账，关系账本与事实库一起长。
 *
 * 夹具只记录事实，不写期望。读数与断言分别留在 `scripts/soak-30d.ts`
 * 与 `test/soak-30d.todo.test.ts` 里。
 *
 * 三条纪律：
 * - 步长固定 6000ms（= 默认倍率 60，一世界日 24 分钟）；不 sleep、不等真实时间；
 * - 不接模型、不读墙钟（`wallClock` 注入固定值），同种子逐项可复现；
 * - 不替世界补行为：造物提案走真实 `CreatorEngine`，落地走 `sim.enqueue`。
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import type { SettingPack } from '../src/settings/types.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import { biomeRingAllows, checkPlacement, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import { minuteOfDay } from '../src/world/timetable.ts';
import type { Weather } from '../src/world/types.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

import { CreatorEngine, type CreatorWorldView } from '../src/creator/engine.ts';
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
  observationOf as observationOfLanding,
  proposalFingerprint,
  type CreationRecord,
} from '../src/creator/ledger.ts';
import { checkLandedBuilding, creationCoverage } from '../src/creator/business-rules.ts';
import {
  freezeCreatorView,
  landingReachable,
  verifyCreationReplay,
  type LandedCreation,
} from '../src/creator/landing.ts';
import { JsonlLedgerFile } from '../src/creator/ledger-file.ts';

export const STEP_MS = 6000;
export const STEPS_PER_DAY = DAY_MS / STEP_MS;
export const SOAK_RESIDENTS = ['迷路人', '汐', '灯笼头', '炉匠', '沉灯夫人'] as const;
export const CREATOR_ROLE = 'mapper';

/**
 * 天气排班：每 3 天拨一次。三档都在一圈里出现；
 * 引擎只有 clear / rain / storm 三档（「雾」按最重的一档 storm 计）。
 */
export const DEFAULT_WEATHER_PLAN: ReadonlyMap<number, Weather> = new Map([
  [2, 'rain'],
  [5, 'storm'],
  [8, 'clear'],
  [11, 'rain'],
  [14, 'clear'],
  [17, 'rain'],
  [20, 'storm'],
  [23, 'clear'],
  [26, 'rain'],
  [29, 'storm'],
]);

export interface SoakOptions {
  readonly seed: string;
  readonly totalDays: number;
  /** 造物账本落盘位置；用临时目录时可以给 `mkdtemp` 的路径。 */
  readonly ledgerPath: string;
  readonly weatherPlan?: ReadonlyMap<number, Weather>;
  /** 每隔几天提一次造物案（默认 3）。 */
  readonly proposeEveryDays?: number;
  /** 从第几天开始允许「拆掉上一栋再提」；默认 6（爬到 L3 之后）。 */
  readonly rebuildFromDay?: number;
  /** 爬梯日：默认 6（在提案之前）。 */
  readonly climbDay?: number;
  /** 居民名；默认取设定集前五个人。 */
  readonly villagerNames?: readonly string[];
}

/** 一世界日的行为计数（按步采样，不是按拍）。 */
export interface BehaviorCounts {
  /** 有人正在走的步数（5 人合计）。 */
  readonly walkSteps: number;
  /** 从「停」变「走」的次数（5 人合计）。 */
  readonly departures: number;
  /** 22:00–05:00 里还在走的步数。 */
  readonly nightWalkSteps: number;
  /** 街头互动增量（`livelinessStats().total` 的日差）。 */
  readonly interactions: number;
  /** 会改关系账本的三类街头小事（撞翻 / 抢水 / 帮忙）增量。 */
  readonly incidents: number;
  /** 牌子含「摊」或「市」的步数（出摊/看摊的可见时段）。 */
  readonly stallSteps: number;
  /** `daily_water` 事件条数。 */
  readonly waterEvents: number;
  /** 真正走到水边的 `daily_water` 条数。 */
  readonly waterReached: number;
  /** 22:00–05:00 里牌子写着「睡下」的步数。 */
  readonly sleepSteps: number;
  /** 这一天里出现过的天气档（按小时拨动后可能不止一档）。 */
  readonly weatherSeen: readonly Weather[];
  /** 市面四拍各自的事件条数。 */
  readonly marketEvents: Readonly<
    Record<'market_open' | 'work_end' | 'night_market' | 'market_close', number>
  >;
}

export interface RelationReading {
  readonly count: number;
  readonly meanTrust: number;
  readonly meanWarmth: number;
}

export interface MemoryReading {
  readonly entries: number;
  readonly byHolder: Readonly<Record<string, number>>;
  readonly summaries: number;
  readonly impressions: number;
  readonly bonds: number;
  readonly events: number;
  readonly consolidated: number;
  readonly archived: number;
  readonly dropped: number;
  readonly promoted: number;
  readonly trimmedTimelineEntries: number;
  readonly unknownPlaceEntries: number;
  /** 面板会写「时刻不明」的格子数（事实被裁或摘要日号）。 */
  readonly unknownWhenEntries: number;
  readonly dayIndexWhenEntries: number;
  /** 预算淘汰总条数（`memory.pruned` 累计）。 */
  readonly pruned: number;
  /** 每一层被淘汰的条数与原因。 */
  readonly prunedByLayer: Readonly<Record<string, PrunedLayer>>;
  /** 日层显著度的**总体**分布（跨全部持有者、全部日期合并）。 */
  readonly salience: {
    readonly count: number;
    readonly p50: number;
    readonly p90: number;
    readonly p99: number;
    readonly max: number;
    /** 取到三位小数的频次表。分位数看不出「分布有几个峰」，频次表看得出。 */
    readonly byValue: Readonly<Record<string, number>>;
    /** 几个候选门槛各自的越线次数。调 `T_promote` 时直接看这一行。 */
    readonly above: Readonly<Record<string, number>>;
  };
}

/** 某一层累计淘汰了多少、因为哪道约束。 */
export interface PrunedLayer {
  readonly evicted: number;
  readonly byCount: number;
  readonly byBytes: number;
}

export interface PerformanceReading {
  readonly steps: number;
  readonly simP50: number;
  readonly simP95: number;
  readonly memP50: number;
  readonly memP95: number;
  /** 跨日那一拍的记忆关账（含 consolidate）耗时。 */
  readonly dayCloseMs: number;
  /** 造物主日结算耗时。 */
  readonly creatorCloseMs: number;
  readonly dayWallMs: number;
}

/** 记忆库分项：每一类库的字节数与条数（30 日读数里「存档为什么涨」的构成）。 */
export interface MemoryPart {
  readonly bytes: number;
  readonly count: number;
}

export interface DaySample {
  readonly day: number;
  readonly now: number;
  readonly weather: Weather;
  readonly tide: number;
  readonly eventCount: number;
  readonly worldEvents: number;
  readonly buildingCount: number;
  readonly demolitions: number;
  readonly memoryJsonBytes: number;
  readonly memoryParts: Readonly<Record<string, MemoryPart>>;
  readonly saveBytes: number;
  readonly saveKBPerCharacterYear: number;
  readonly memoryKBPerCharacterYear: number;
  readonly ledgerRows: number;
  readonly ledgerBytes: number;
  readonly creationRecords: number;
  readonly landingRecords: number;
  readonly observationRecords: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly memory: MemoryReading;
  /** 当天结束时，各居民时间轴上 `createdDay === day` 的条目总数（回溯分母）。 */
  readonly timelineToday: number;
  readonly relations: RelationReading;
  readonly behaviors: BehaviorCounts;
  readonly perf: PerformanceReading;
}

export interface SoakSummary {
  readonly seed: string;
  readonly days: readonly DaySample[];
  readonly fingerprints: {
    readonly world: string;
    readonly memory: string;
    readonly creator: string;
    readonly events: string;
  };
  readonly violations: readonly { readonly day: number; readonly rule: string; readonly detail: string }[];
}

interface PendingObservation {
  readonly proposalId: string;
  readonly buildingId: string;
  readonly landed: LandedCreation;
  readonly dueDay: number;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 记忆库的八大分项：字节与条数。口径与 `memory-30d.json` 逐项对齐。 */
const MEMORY_PART_KEYS = [
  'entries',
  'facts',
  'claims',
  'written',
  'beliefs',
  'cooldowns',
  'tells',
  'legends',
  'digests',
] as const;

function memoryPartsOf(memoryJson: string): Record<string, MemoryPart> {
  const parsed = JSON.parse(memoryJson) as { world?: Record<string, unknown> };
  const parts: Record<string, MemoryPart> = {};
  for (const key of MEMORY_PART_KEYS) {
    const value = parsed.world?.[key];
    parts[key] = {
      bytes: Buffer.byteLength(JSON.stringify(value ?? null), 'utf8'),
      count: Array.isArray(value) ? value.length : 0,
    };
  }
  return parts;
}

/** 当天结束时可读的居民时间轴（按 `createdDay` 归日）。 */
function timelineEntriesOf(memoryJson: string, day: number): number {
  const parsed = JSON.parse(memoryJson) as {
    world?: { entries?: { createdDay?: number }[] };
  };
  return (parsed.world?.entries ?? []).filter((entry) => entry.createdDay === day).length;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 跨日合并后的显著度分布。**必须拿原值合，不能拿分位数合**——
 * 把 30 个 `p90` 平均起来不是 30 天的 `p90`，它会被样本少的那几天拖走。
 */
function pooledCensus(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const byValue: Record<string, number> = {};
  for (const value of sorted) {
    const key = value.toFixed(3);
    byValue[key] = (byValue[key] ?? 0) + 1;
  }
  const thresholds = [0.45, 0.48, 0.495, 0.5, 0.55, 0.6];
  const above: Record<string, number> = {};
  for (const t of thresholds) above[String(t)] = sorted.filter((value) => value >= t).length;
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1]!,
    byValue,
    above,
  };
}

/** 设定集与地图。只读一次（测试之间共享）。 */
let cachedPack: SettingPack | undefined;
export function soakPack(): SettingPack {
  cachedPack ??= loadSettingPack(DENGCHAO_RAW);
  return cachedPack;
}

export function soakWorld(pack: SettingPack): BuiltWorld {
  return buildSettingWorld(pack);
}

/**
 * 联合浸泡跑。构造即开局；`run()` 一次跑完所有天。
 */
export class SoakRun {
  readonly pack: SettingPack;
  readonly world: BuiltWorld;
  readonly sim: Simulation;
  readonly memory: MemoryRuntime;
  readonly ledger: JsonlLedgerFile;
  readonly engine: CreatorEngine;

  private readonly seedName: string;
  private nowValue = 0;
  private lastWalking: boolean[];
  private lastEventCount = 0;
  private readonly allWorldEvents: string[] = [];
  private readonly pending: PendingObservation[] = [];
  private readonly removed = new Set<string>();
  private readonly violations: { day: number; rule: string; detail: string }[] = [];
  private readonly samples: DaySample[] = [];
  private serial = 0;
  private lastActoredTotal = 0;
  private lastIncidentTotal = 0;
  private waterEvents = 0;
  private waterReached = 0;
  private marketEvents = {
    market_open: 0,
    work_end: 0,
    night_market: 0,
    market_close: 0,
  };
  private readonly memoryEventCounts = {
    consolidated: 0,
    archived: 0,
    dropped: 0,
    promoted: 0,
    events: 0,
    pruned: 0,
    prunedByLayer: {} as Record<string, { evicted: number; byCount: number; byBytes: number }>,
    /** 全部持有者、全部日期的日层显著度，按时间顺序累积。 */
    salienceValues: [] as number[],
  };
  private lastLedgerPrefix = '';
  private demolitions = 0;
  private placeSignature = '';
  private readonly creatorBuildings = new Set<string>();

  constructor(options: SoakOptions) {
    this.seedName = options.seed;
    this.pack = soakPack();
    this.world = soakWorld(this.pack);
    const names = options.villagerNames ?? SOAK_RESIDENTS;
    this.sim = new Simulation({
      grid: this.world.grid,
      buildings: this.world.buildings,
      altar: this.world.altar,
      villagerName: names[0]!,
      villagerNames: names,
      authored: true,
      worldSeed: options.seed,
      wallClock: () => 0,
      blueprints: this.pack.blueprints,
      spawnBuilding: (prefabId, instanceId, at, source) => {
        const blueprint = this.pack.blueprints.get(prefabId);
        if (blueprint === undefined) return null;
        return placeBlueprint(this.world.grid, blueprint, instanceId, this.world.altar, at, source);
      },
      onChange: (change, at) => this.recordChange(change, at),
    });

    this.memory = new MemoryRuntime({
      worldId: options.seed,
      occlusion: this.world.grid,
      onVitals: () => {},
      onEvent: (event) => {
        this.memoryEventCounts.events += 1;
        if (event.kind === 'memory.archived') {
          this.memoryEventCounts.archived += 1;
          return;
        }
        if (event.kind === 'memory.pruned') {
          const payload = event.payload as {
            layer?: string;
            evicted?: number;
            byCount?: number;
            byBytes?: number;
          };
          const layer = payload.layer ?? 'unknown';
          const bucket = (this.memoryEventCounts.prunedByLayer[layer] ??= {
            evicted: 0,
            byCount: 0,
            byBytes: 0,
          });
          const evicted = payload.evicted ?? 0;
          bucket.evicted += evicted;
          bucket.byCount += payload.byCount ?? 0;
          bucket.byBytes += payload.byBytes ?? 0;
          this.memoryEventCounts.pruned += evicted;
          return;
        }
        if (event.kind !== 'memory.consolidated') return;
        this.memoryEventCounts.consolidated += 1;
        const stats = event.payload.stats as
          | {
              archived?: number;
              dropped?: number;
              promoted?: number;
              droppedByCount?: number;
              droppedByBytes?: number;
              salience?: { values?: readonly number[] };
            }
          | undefined;
        this.memoryEventCounts.archived += stats?.archived ?? 0;
        this.memoryEventCounts.dropped += stats?.dropped ?? 0;
        this.memoryEventCounts.promoted += stats?.promoted ?? 0;
        for (const value of stats?.salience?.values ?? []) {
          this.memoryEventCounts.salienceValues.push(value);
        }
      },
    });

    this.ledger = new JsonlLedgerFile(options.ledgerPath, {
      clock: () => new Date('2026-11-04T00:00:00.000Z'),
    });

    this.engine = new CreatorEngine(this.pack, {
      worldSeed: options.seed,
      worldTime: () => this.sim.snapshot().now,
      world: this.world,
    });

    this.nowValue = this.sim.snapshot().now;
    this.lastWalking = this.sim.snapshot().villagers.map((villager) => villager.walking);
  }

  get now(): number {
    return this.nowValue;
  }

  /** 逐日跑完 `options.totalDays`，最后返回全部读数。 */
  async run(options: SoakOptions): Promise<SoakSummary> {
    const weatherPlan = options.weatherPlan ?? DEFAULT_WEATHER_PLAN;
    const proposeEvery = options.proposeEveryDays ?? 3;
    const rebuildFrom = options.rebuildFromDay ?? 6;
    const climbDay = options.climbDay ?? 6;
    const startDay = Math.floor(this.nowValue / DAY_MS);

    for (let day = startDay; day < startDay + options.totalDays; day += 1) {
      const dayStart = performance.now();

      const weather = weatherPlan.get(day);
      if (weather !== undefined) this.sim.enqueue({ kind: 'setWeather', weather });

      if (day === climbDay) this.climbToL3();

      if (day >= rebuildFrom && day % proposeEvery === 0) this.demolishOldest();

      if (day % proposeEvery === 0) await this.propose(day);

      this.serveObservation(day);

      const simDurations: number[] = [];
      const memDurations: number[] = [];
      let dayCloseMs = 0;
      const behaviors = this.emptyBehavior();
      const interactionsBase = this.lastActoredTotal;
      const incidentBase = this.lastIncidentTotal;
      const dayEnd = (day + 1) * DAY_MS;

      while (this.nowValue < dayEnd) {
        const simStart = performance.now();
        this.sim.update(STEP_MS);
        simDurations.push(performance.now() - simStart);

        const snap = this.sim.snapshot();
        this.nowValue = snap.now;
        this.trackMovement(snap.now, snap.weather, snap.villagers, behaviors);

        const memStart = performance.now();
        this.memory.syncHolders(
          snap.villagers.map((villager) => ({
            holderId: villager.id,
            type: 'character' as const,
            at: villager.pos,
          })),
        );
        // 地点不是每一步都在动：只在楼的门牌变了（造物主新建/拆除）时同步一次。
        const placeSignature = snap.buildings.map((building) => building.instanceId).join(',');
        if (placeSignature !== this.placeSignature) {
          this.placeSignature = placeSignature;
          this.memory.syncHolders(
            snap.buildings.map((building) => ({
              holderId: building.instanceId,
              type: 'place' as const,
              at: building.door,
              name: building.displayName,
            })),
          );
        }
        const vitals = this.memory.tick(snap.now);
        const memMs = performance.now() - memStart;
        memDurations.push(memMs);
        if (vitals.length > 0) dayCloseMs += memMs;
      }

      const interactions = this.sim.livelinessStats().total - interactionsBase;
      const incidents = this.sim.livelinessStats().incidents - incidentBase;

      const creatorCloseStart = performance.now();
      this.creatorDayClose();
      const creatorCloseMs = performance.now() - creatorCloseStart;

      this.lastActoredTotal = this.sim.livelinessStats().total;
      this.lastIncidentTotal = this.sim.livelinessStats().incidents;
      const sample = this.sampleDay(
        day,
        behaviors,
        { simDurations, memDurations, dayCloseMs, creatorCloseMs, dayWallMs: performance.now() - dayStart },
        interactions,
        incidents,
      );
      this.samples.push(sample);
    }

    return {
      seed: options.seed,
      days: this.samples,
      fingerprints: this.fingerprints(),
      violations: this.violations,
    };
  }

  private emptyBehavior(): BehaviorCounts {
    return {
      walkSteps: 0,
      departures: 0,
      nightWalkSteps: 0,
      interactions: 0,
      incidents: 0,
      stallSteps: 0,
      waterEvents: 0,
      waterReached: 0,
      sleepSteps: 0,
      weatherSeen: [],
      marketEvents: { market_open: 0, work_end: 0, night_market: 0, market_close: 0 },
    };
  }

  /** 每个逻辑步抽一次「看得见的行为」。 */
  private trackMovement(
    now: number,
    weather: Weather,
    villagers: readonly { readonly walking: boolean; readonly routine: string | null }[],
    behavior: BehaviorCounts,
  ): void {
    const mutable = behavior as unknown as {
      walkSteps: number;
      departures: number;
      nightWalkSteps: number;
      stallSteps: number;
      sleepSteps: number;
      weatherSeen: Weather[];
    };
    if (!mutable.weatherSeen.includes(weather)) mutable.weatherSeen.push(weather);
    const minute = minuteOfDay(now);
    const night = minute >= 22 * 60 || minute < 5 * 60;
    villagers.forEach((villager, index) => {
      if (villager.walking) {
        mutable.walkSteps += 1;
        if (night) mutable.nightWalkSteps += 1;
      }
      if (!this.lastWalking[index]! && villager.walking) mutable.departures += 1;
      this.lastWalking[index] = villager.walking;
      const label = villager.routine ?? '';
      if (label.includes('摊') || label.includes('市')) mutable.stallSteps += 1;
      if (night && label.includes('睡下')) mutable.sleepSteps += 1;
    });
  }

  /** 世界回写 → 记忆观察。与 `DailyRun` 同一条路径。 */
  private recordChange(change: WorldChange, at: number): void {
    if (change.change === 'world.event') {
      this.allWorldEvents.push(`${at}|${change.kind}|${change.text}`);
      if (change.kind === 'daily_water') {
        this.waterEvents += 1;
        if (!change.text.includes('没走到') && !change.text.includes('没有能下脚')) this.waterReached += 1;
      }
      if (
        change.kind === 'market_open' ||
        change.kind === 'work_end' ||
        change.kind === 'night_market' ||
        change.kind === 'market_close'
      ) {
        this.marketEvents[change.kind] += 1;
      }
    }
    if (change.change !== 'world.event') return;

    const snap = this.sim.snapshot();
    this.serial += 1;
    const observation = observationOf(change, `soak-${this.serial}`, {
      atOfHolder: (holderId) => {
        const holder = snap.villagers.find((villager) => villager.id === holderId);
        return holder === undefined ? undefined : { x: holder.pos.x, y: holder.pos.y };
      },
      atOfBuilding: (instanceId) => {
        const building =
          this.sim.buildingById(instanceId) ?? snap.buildings.find((item) => item.instanceId === instanceId);
        return building === undefined ? undefined : { x: building.door.x, y: building.door.y };
      },
      buildingOfTask: (taskId) => snap.tasks.find((task) => task.id === taskId)?.buildingId ?? undefined,
    });
    if (observation !== null) this.memory.observe(observation, undefined, at);
  }

  // ------------------------------------------------------------- 造物主

  private viewOf(day: number): CreatorWorldView {
    const snapshot = this.sim.snapshot();
    return {
      day,
      builtPrefabIds: new Set(snapshot.buildings.map((building) => building.prefabId)),
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

  /** 真实观测计数爬梯，与 `creation-ledger-dayrun.test.ts` 同一套路径。 */
  private climbToL3(): void {
    const engine = this.engine;
    const observe = (extra: Record<string, unknown> = {}): void => {
      engine.submitHumanApproval(CREATOR_ROLE, 'climb', true, undefined, {
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
    days(14, {
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: true,
      replayHashConsistent: true,
    });
    days(14, {
      pathfindingConnected: true,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: true,
      replayHashConsistent: true,
    });
  }

  /** 拆掉造物账本里最早还站着的那一栋；没有就跳过。 */
  private demolishOldest(): void {
    const snapshot = this.sim.snapshot();
    const candidate = snapshot.buildings
      .filter((building) => this.creatorBuildings.has(building.instanceId))
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId))[0];
    if (candidate === undefined) return;
    this.sim.enqueue({ kind: 'demolish', instanceId: candidate.instanceId });
    this.sim.update(16);
    if (!this.sim.snapshot().buildings.some((building) => building.instanceId === candidate.instanceId)) {
      this.removed.add(candidate.instanceId);
      this.creatorBuildings.delete(candidate.instanceId);
      this.demolitions += 1;
    }
  }

  private async propose(day: number): Promise<void> {
    const view = this.viewOf(day);
    const proposal = this.engine.planCreation(view);
    if (proposal === null) return;
    const blueprint = this.pack.blueprints.get(proposal.templateId);
    if (blueprint === undefined) return;

    const frozen = freezeCreatorView(
      view,
      [...this.pack.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
    );
    const decision = this.engine.getFuseDecision(CREATOR_ROLE);
    const state = this.engine.getRoleState(CREATOR_ROLE);
    if (state === undefined) return;

    const gates = evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: view.builtPrefabIds,
      blueprintCount: this.pack.blueprints.size,
      templateId: proposal.templateId,
      fuseAction: decision.action,
      fuseReason: decision.reason,
      traceable: true,
    });
    const currentDay = Math.floor(this.sim.snapshot().now / DAY_MS);
    const recordId = newRecordId(`${this.seedName}:d${currentDay}:${proposal.templateId}`);
    const creation: CreationRecord = buildCreationRecord({
      recordId,
      worldId: this.seedName,
      seed: this.seedName,
      day: currentDay,
      at: this.sim.snapshot().now,
      templateId: proposal.templateId,
      templateName: blueprint.displayName,
      templateKind: blueprint.zone,
      intentText: null,
      target: proposal.at,
      origin: 'auto',
      gates,
      ladder: ladderSnapshot(state, decision),
      replay: {
        seed: this.seedName,
        eventFrom: this.sim.snapshot().feed.cursor,
        eventTo: this.sim.snapshot().feed.cursor,
        dayFrom: currentDay,
        dayTo: currentDay,
        fingerprint: proposalFingerprint(this.seedName, currentDay, proposal),
      },
    });
    this.ledger.append(creation);
    if (creation.verdict !== 'accepted') return;

    const instanceId = this.sim.nextInstanceId(proposal.templateId);
    this.sim.enqueue({
      kind: 'build',
      prefabId: proposal.templateId,
      instanceId,
      at: proposal.at,
      source: { taskId: `creator-${proposal.templateId}`, summary: proposal.reason },
    });
    this.sim.update(16);
    const building = this.sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) return;
    this.creatorBuildings.add(instanceId);
    const landed: LandedCreation = {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    };
    const replayed = this.engine.planCreation(frozen);
    const replayConsistent = replayed === null
      ? null
      : verifyCreationReplay({
          plan: proposal,
          replayed,
          landed,
          day: currentDay,
          blueprints: this.pack.blueprints,
        });
    const coverageRate = creationCoverage(this.sim.snapshot(), this.pack.blueprints);
    const pathfindingConnected = landingReachable(this.world, landed);
    const business = await checkLandedBuilding(
      {
        snapshot: this.sim.snapshot(),
        grid: this.world.grid,
        altar: this.world.altar,
        blueprints: this.pack.blueprints,
      },
      landed,
    );
    this.ledger.append(
      buildLandingRecord({
        proposalId: creation.recordId,
        worldId: this.seedName,
        seed: this.seedName,
        day: currentDay,
        at: this.sim.snapshot().now,
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
          blueprintCount: this.pack.blueprints.size,
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
          seed: this.seedName,
          eventFrom: this.sim.snapshot().feed.cursor,
          eventTo: this.sim.snapshot().feed.cursor,
          dayFrom: currentDay,
          dayTo: currentDay,
          fingerprint: landingFingerprint(this.seedName, currentDay, proposal, landed),
        },
        failure: null,
      }),
    );
    this.engine.submitHumanApproval(CREATOR_ROLE, instanceId, true, undefined, {
      coverageRate,
      pathfindingConnected,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      traceable: true,
      hasConflict: business.hasConflict,
      invariantViolated: business.invariantViolated,
      ...(replayConsistent === null ? {} : { replayHashConsistent: replayConsistent }),
    });
    this.pending.push({
      proposalId: creation.recordId,
      buildingId: instanceId,
      landed,
      dueDay: observationDueDay(currentDay),
    });
  }

  /** 7 日观测：到期的就查一次现状，记「仍在 / 被拆 / 改名」。 */
  private serveObservation(day: number): void {
    const closedDay = Math.floor(this.sim.snapshot().now / DAY_MS);
    for (const item of [...this.pending]) {
      if (day < item.dueDay) continue;
      const current = this.sim.snapshot().buildings.find((building) => building.instanceId === item.buildingId);
      const outcome = observationOfLanding({
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
        removed: this.removed.has(item.buildingId),
        renamedTo: null,
      });
      this.ledger.append(
        buildObservationRecord({
          proposalId: item.proposalId,
          worldId: this.seedName,
          day: closedDay,
          at: this.sim.snapshot().now,
          dueDay: item.dueDay,
          buildingId: item.buildingId,
          status: outcome.status,
          detail: outcome.detail,
        }),
      );
      this.pending.splice(this.pending.indexOf(item), 1);
    }
  }

  private creatorDayClose(): void {
    this.engine.closeWorldDay();
    this.engine.processDayClosed({
      meanValence: 0,
      meanArousal: 0.5,
      infoEntropy: 0.5,
      isolatedHoldersCount: 0,
    });
  }

  // ------------------------------------------------------------- 采样

  private memoryReading(): MemoryReading {
    const holders = this.sim.snapshot().villagers.map((villager) => villager.id);
    const byHolder: Record<string, number> = {};
    let entries = 0;
    let summaries = 0;
    let impressions = 0;
    let trimmedTimelineEntries = 0;
    let unknownPlaceEntries = 0;
    let unknownWhenEntries = 0;
    let dayIndexWhenEntries = 0;
    for (const holderId of holders) {
      const timeline = this.memory.timelineFor(holderId);
      byHolder[holderId] = timeline.length;
      entries += timeline.length;
      for (const entry of timeline) {
        if (entry.kind === 'summary') {
          summaries += 1;
          // 摘要的 `when` 是日号而不是毫秒；面板 `clockOf` 会把它算成 00:00。
          if (entry.when === entry.day) dayIndexWhenEntries += 1;
        }
        if (entry.kind === 'impression') impressions += 1;
      }
      const dayTimeline = this.memory.dayTimelineFor(holderId, Math.floor(this.sim.snapshot().now / DAY_MS) - 1);
      for (const entry of dayTimeline) {
        if (entry.placeId === null && entry.what === null) trimmedTimelineEntries += 1;
        if (entry.placeId === null) unknownPlaceEntries += 1;
        // 时刻站不住：事实被预算裁掉，或这一格是摘要（`when` 是日号）。
        // 面板这两类都写「时刻不明」，不再把 00:00 当成真时刻。
        if (!entry.whenKnown) unknownWhenEntries += 1;
      }
    }
    let bonds = 0;
    for (const holderId of holders) bonds += this.memory.bondsOf(holderId).length;
    return {
      entries,
      byHolder,
      summaries,
      impressions,
      bonds,
      events: this.memoryEventCounts.events,
      consolidated: this.memoryEventCounts.consolidated,
      archived: this.memoryEventCounts.archived,
      dropped: this.memoryEventCounts.dropped,
      promoted: this.memoryEventCounts.promoted,
      trimmedTimelineEntries,
      unknownPlaceEntries,
      unknownWhenEntries,
      dayIndexWhenEntries,
      pruned: this.memoryEventCounts.pruned,
      prunedByLayer: { ...this.memoryEventCounts.prunedByLayer },
      salience: pooledCensus(this.memoryEventCounts.salienceValues),
    };
  }

  private relationReading(): RelationReading {
    const holders = this.sim.snapshot().villagers.map((villager) => villager.id);
    const trust: number[] = [];
    const warmth: number[] = [];
    for (const holderId of holders) {
      for (const bond of this.memory.bondsOf(holderId)) {
        trust.push(bond.trust);
        warmth.push(bond.warmth);
      }
    }
    return { count: trust.length, meanTrust: mean(trust), meanWarmth: mean(warmth) };
  }

  private sampleDay(
    day: number,
    behaviors: BehaviorCounts,
    perf: {
      simDurations: number[];
      memDurations: number[];
      dayCloseMs: number;
      creatorCloseMs: number;
      dayWallMs: number;
    },
    interactions: number,
    incidents: number,
  ): DaySample {
    const snapshot = this.sim.snapshot();
    const memoryJson = this.memory.toJSON();
    const saveText = JSON.stringify(this.sim.toSave(memoryJson));
    const memoryBytes = Buffer.byteLength(memoryJson, 'utf8');
    const memoryParts = memoryPartsOf(memoryJson);
    const daysElapsed = Math.max(1, day + 1);
    const years = daysElapsed / 365;
    const characters = snapshot.villagers.length;
    const ledgerRows = this.ledger.readAll();
    const creationRecords = ledgerRows.filter((record) => record.kind === 'creation').length;
    const landingRecords = ledgerRows.filter((record) => record.kind === 'landing').length;
    const observationRecords = ledgerRows.filter((record) => record.kind === 'observation').length;
    const accepted = ledgerRows.filter(
      (record) => record.kind === 'creation' && record.verdict === 'accepted',
    ).length;
    const rejected = ledgerRows.filter(
      (record) => record.kind === 'creation' && record.verdict === 'rejected',
    ).length;
    const sortedSim = [...perf.simDurations].sort((a, b) => a - b);
    const sortedMem = [...perf.memDurations].sort((a, b) => a - b);
    const saveBytes = Buffer.byteLength(saveText, 'utf8');
    const behaviorsFinal: BehaviorCounts = {
      ...behaviors,
      interactions,
      incidents,
      waterEvents: this.waterEvents,
      waterReached: this.waterReached,
      marketEvents: { ...this.marketEvents },
    };

    this.checkInvariants(day, saveText);
    this.checkLedgerAppendOnly(day);

    return {
      day,
      now: snapshot.now,
      weather: snapshot.weather,
      tide: snapshot.tide.level,
      eventCount: this.sim.eventCount(),
      worldEvents: this.allWorldEvents.length,
      buildingCount: snapshot.buildings.length,
      demolitions: this.demolitions,
      memoryJsonBytes: memoryBytes,
      memoryParts,
      saveBytes,
      saveKBPerCharacterYear: (saveBytes / 1024) / (characters * years),
      memoryKBPerCharacterYear: (memoryBytes / 1024) / (characters * years),
      ledgerRows: ledgerRows.length,
      ledgerBytes: this.ledger.bytes,
      creationRecords,
      landingRecords,
      observationRecords,
      accepted,
      rejected,
      memory: this.memoryReading(),
      timelineToday: timelineEntriesOf(memoryJson, day),
      relations: this.relationReading(),
      behaviors: behaviorsFinal,
      perf: {
        steps: perf.simDurations.length,
        simP50: percentile(sortedSim, 50),
        simP95: percentile(sortedSim, 95),
        memP50: percentile(sortedMem, 50),
        memP95: percentile(sortedMem, 95),
        dayCloseMs: perf.dayCloseMs,
        creatorCloseMs: perf.creatorCloseMs,
        dayWallMs: perf.dayWallMs,
      },
    };
  }

  // ------------------------------------------------------------- 不变量

  private checkInvariants(day: number, saveText: string): void {
    const snapshot = this.sim.snapshot();
    const push = (rule: string, detail: string): void => {
      this.violations.push({ day, rule, detail });
    };
    if (!Number.isFinite(snapshot.now) || snapshot.now < 0) push('now-finite', String(snapshot.now));
    if (this.sim.eventCount() < this.lastEventCount) {
      push('event-count-monotonic', `${this.lastEventCount} → ${this.sim.eventCount()}`);
    }
    for (const villager of snapshot.villagers) {
      if (!Number.isFinite(villager.pos.x) || !Number.isFinite(villager.pos.y)) {
        push('villager-pos-finite', `${villager.id} @${villager.pos.x},${villager.pos.y}`);
      } else if (!this.world.grid.isWalkable(villager.pos)) {
        push('villager-on-walkable', `${villager.id} @${villager.pos.x},${villager.pos.y}`);
      }
    }
    const holders = new Set(snapshot.villagers.map((villager) => villager.id));
    for (const villager of snapshot.villagers) {
      for (const bond of this.memory.bondsOf(villager.id)) {
        if (!Number.isFinite(bond.trust) || !Number.isFinite(bond.warmth)) {
          push('bond-finite', `${villager.id}→${bond.to} trust=${bond.trust} warmth=${bond.warmth}`);
        }
        if (!holders.has(bond.to)) push('bond-to-known', `${villager.id}→${bond.to}`);
      }
    }
    try {
      const parsed = JSON.parse(saveText) as {
        schemaVersion?: number;
        world?: { villagers?: unknown[]; memory?: unknown };
      };
      if (parsed.schemaVersion !== 5) push('save-schema-v5', String(parsed.schemaVersion));
      if (parsed.world?.villagers?.length !== snapshot.villagers.length) {
        push('save-villager-count', String(parsed.world?.villagers?.length));
      }
      if (day >= 1 && typeof parsed.world?.memory !== 'string') push('save-memory-present', 'missing');
    } catch (error) {
      push('save-roundtrip', String(error));
    }
    const last = this.samples.at(-1);
    if (last !== undefined) {
      const rows = this.ledger.readAll();
      if (rows.length < last.ledgerRows) push('ledger-rows-monotonic', `${last.ledgerRows} → ${rows.length}`);
    }
  }

  /** 账本只追加：今天的文件必须以昨天的完整字节为前缀。 */
  private checkLedgerAppendOnly(day: number): void {
    let text = '';
    try {
      text = readFileSync(this.ledger.path, 'utf8');
    } catch {
      text = '';
    }
    if (!text.startsWith(this.lastLedgerPrefix)) {
      this.violations.push({
        day,
        rule: 'ledger-append-only',
        detail: `前缀不再相同（旧 ${this.lastLedgerPrefix.length} 字节，新 ${text.length} 字节）`,
      });
    }
    this.lastLedgerPrefix = text;
    this.lastEventCount = this.sim.eventCount();
  }

  // ------------------------------------------------------------- 指纹

  private fingerprints(): SoakSummary['fingerprints'] {
    const snapshot = this.sim.snapshot();
    const memory = this.memory.toJSON();
    // `recordId`/`proposalId` 由 `newRecordId` 的 randomUUID 生成（生产上用来防撞键），
    // 它们不是世界行为的一部分。造物指纹只覆盖「内容」：序号、判定、闸门、落地、
    // 回放指纹。原始账本字节是否一致另由 `determinismLedgerRaw` 单独记录。
    const ledger = this.ledger.readAll().map((record) => {
      const { recordId, proposalId, ...content } = record as unknown as Record<string, unknown> & {
        recordId?: string;
        proposalId?: string;
      };
      void recordId;
      void proposalId;
      return content;
    });
    return {
      world: sha(JSON.stringify(snapshot)),
      memory: sha(memory),
      creator: sha(JSON.stringify(ledger)),
      events: sha(JSON.stringify(this.allWorldEvents)),
    };
  }
}
