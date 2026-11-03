/**
 * 日常活动功能测试的公共夹具。**不是测试文件**（文件名不带 `.test`），
 * 只被 L1/L2/L3 三层测试与 BUGS_FOUND 的最小复现脚本共用。
 *
 * 这里做的事只有三件：
 * 1. 用默认大世界 + 一名居民跑真实 `Simulation`（步长 6 世界秒，即默认倍率 60）；
 * 2. 把「走了 / 停了 / 停多久 / 每一拍」从快照里抽出来，供三层各自断言；
 * 3. 可选地接上 `MemoryRuntime` 与灯油模型，让跨日关账与灯油消耗能一起量。
 *
 * 断言本身一条都不写在这里——夹具只记录事实，期望值留在各层测试里。
 */

import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import {
  LARGE_ALTAR,
  LARGE_WORLD_SPEC,
  buildLargeWorld,
  buildWorldFromSave,
} from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import type { WorldVitals } from '../src/world/memory/types.ts';
import { beatsBetween, isQuietAt, minuteOfDay, type TimetableId } from '../src/world/timetable.ts';
import { PACE, worldMinutes } from '../src/world/pace.ts';
import { LAMP_DRY, LAMP_FULL, advanceLamp, lampDayOf, newLamp } from '../src/world/lampoil.ts';
import { lampActivityOf } from '../src/render/lampoil-view.ts';
import type { GridPoint, VillagerSnapshot, WorldEvent } from '../src/world/types.ts';
import type { WorldSave } from '../src/world/save.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

export const STEP_MS = 6000;
export const STEPS_PER_DAY = 14400;
export const ONE_RESIDENT = '莞尔';
export const LAMP_STREET_LAMP_COUNT = 28;

type Blueprints = ReturnType<typeof parseBlueprintTable>;
type World = ReturnType<typeof buildLargeWorld>;

let cachedBlueprints: Blueprints | undefined;

/** 默认大世界的蓝图表。只读一次；测试之间共享同一份不可变表。 */
export function dailyBlueprints(): Blueprints {
  cachedBlueprints ??= parseBlueprintTable(
    JSON.parse(
      readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
    ) as Record<string, Record<string, unknown>>,
  );
  return cachedBlueprints;
}

export function buildDailyWorld(): World {
  return buildLargeWorld(dailyBlueprints());
}

/** `onChange` 信封：改变本身 + 世界时间。`WorldChange` 的载荷里没有 `at`。 */
export interface ChangeRecord {
  readonly change: WorldChange;
  readonly at: number;
}

export interface DwellRecord {
  readonly arriveAt: number;
  readonly leaveAt: number;
  readonly ms: number;
  readonly label: string | null;
  readonly pos: GridPoint;
  readonly quietOverlap: boolean;
}

export interface DepartureRecord {
  readonly at: number;
  readonly minute: number;
  readonly quiet: boolean;
  readonly routine: string | null;
  readonly from: GridPoint;
}

export interface ArrivalRecord {
  readonly at: number;
  readonly minute: number;
  readonly label: string | null;
  readonly pos: GridPoint;
}

export interface BeatHit {
  readonly id: TimetableId;
  readonly at: number;
  readonly beforeNow: number;
  readonly minute: number;
  readonly villager: VillagerSnapshot;
  readonly changes: readonly ChangeRecord[];
  readonly events: readonly WorldEvent[];
}

export interface DailyRunOptions {
  readonly withMemory?: boolean;
  readonly worldId?: string;
  readonly world?: World;
  readonly villagerNames?: readonly string[];
  /** 从存档重开（模拟「关掉页面再打开」）；与 `world` 互斥。 */
  readonly save?: WorldSave;
}

/**
 * 一名居民 + 默认世界的一天。每步都从同一份快照里抽事实，避免各层
 * 自己写一套「她动没动」的判据。
 */
export class DailyRun {
  readonly world: World;
  readonly changes: ChangeRecord[] = [];
  readonly events: WorldEvent[] = [];
  readonly vitals: WorldVitals[] = [];
  readonly dwells: DwellRecord[] = [];
  readonly departures: DepartureRecord[] = [];
  readonly arrivals: ArrivalRecord[] = [];
  readonly beatHits: BeatHit[] = [];
  readonly burnedByDay = new Map<number, number>();
  readonly minOilByDay = new Map<number, number>();
  readonly memory: MemoryRuntime | null;
  readonly sim: Simulation;
  lamp = newLamp();
  refills = 0;
  nightWalkingSteps = 0;

  private nowValue = 0;
  private lastWalking: boolean;
  private arrivedAt: number | null = null;
  private arrivalLabel: string | null = null;
  private arrivalPos: GridPoint | null = null;
  private readonly seenEvents = new Set<string>();
  private serial = 0;

  constructor(options: DailyRunOptions = {}) {
    if (options.save === undefined) {
      this.world = options.world ?? buildDailyWorld();
      this.sim = new Simulation({
        grid: this.world.grid,
        buildings: this.world.buildings,
        altar: this.world.altar,
        villagerName: ONE_RESIDENT,
        villagerNames: options.villagerNames ?? [ONE_RESIDENT],
        onChange: (change, at) => this.recordChange(change, at),
      });
    } else {
      const rebuilt = rebuildFromSave(options.save, (change, at) => this.recordChange(change, at));
      this.world = rebuilt.world;
      this.sim = rebuilt.sim;
    }
    this.memory = options.withMemory === true
      ? new MemoryRuntime({
          worldId: options.worldId ?? 'func-daily',
          occlusion: this.world.grid,
          onVitals: (vitals) => this.vitals.push(vitals),
        })
      : null;
    if (options.save !== undefined && this.memory !== null) {
      const restored = this.memory.fromJSON(options.save.world.memory);
      if (!restored) throw new Error('从存档重开时记忆层没能复原（world.memory 为空或版本不认识）');
    }
    this.nowValue = this.sim.snapshot().now;
    this.lastWalking = this.sim.snapshot().villagers[0]!.walking;
  }

  get now(): number {
    return this.nowValue;
  }

  get villager(): VillagerSnapshot {
    return this.sim.snapshot().villagers[0]!;
  }

  snapshot() {
    return this.sim.snapshot();
  }

  /** 推进 `count` 步；每步都做一次「事实归档」。 */
  step(count = 1): void {
    for (let i = 0; i < count; i += 1) this.stepOnce();
  }

  /** 推进到绝对世界时刻（毫秒）。目标应是 6000 的整数倍，保证不跨步。 */
  runTo(targetNow: number, maxSteps = 200000): void {
    for (let i = 0; i < maxSteps && this.nowValue < targetNow; i += 1) {
      if (targetNow - this.nowValue < STEP_MS) break;
      this.step();
    }
  }

  /** 推进到第 `day` 天的 `minute` 分（世界日分钟）。 */
  runToMinute(day: number, minute: number): void {
    this.runTo(day * DAY_MS + worldMinutes(minute));
  }

  setWeather(weather: 'clear' | 'rain' | 'storm'): void {
    this.sim.enqueue({ kind: 'setWeather', weather });
  }

  /** 某一拍在最后一天（或唯一一天）的命中记录。 */
  beat(id: TimetableId): BeatHit | undefined {
    return this.beatHits.filter((hit) => hit.id === id).at(-1);
  }

  /** 某一拍窗口里的世界改变。 */
  changesAt(id: TimetableId): readonly ChangeRecord[] {
    return this.beat(id)?.changes ?? [];
  }

  /** 该窗口里某一类 `world.event` 的条数。 */
  worldEventsOfKind(id: TimetableId, kind: string): number {
    return this.changesAt(id).filter(
      (record) => record.change.change === 'world.event' && record.change.kind === kind,
    ).length;
  }

  /** 记忆里某人的条目数；没接记忆就抛，免得静默返回 0。 */
  entryCount(holderId = 'v0'): number {
    if (this.memory === null) throw new Error('DailyRun 未接记忆层，不能取条目数');
    return this.memory.timelineFor(holderId).length;
  }

  memoryJson(): string {
    if (this.memory === null) throw new Error('DailyRun 未接记忆层，不能取记忆快照');
    return this.memory.toJSON();
  }

  /** 世界 + 记忆的一份存档；重开走 `new DailyRun({ save, withMemory: true })`。 */
  save(): WorldSave {
    return this.sim.toSave(this.memory === null ? '' : this.memory.toJSON());
  }

  /**
   * 重开一致性用的逐字摘要：世界快照 + 记忆快照一起序列化。
   * 不含存档 `meta`（`savedAtWallClock` 是墙钟，本来就会变）。
   */
  digest(): string {
    return JSON.stringify({ snapshot: this.sim.snapshot(), memory: this.memoryJson() });
  }

  private stepOnce(): void {
    const beforeNow = this.nowValue;
    this.sim.update(STEP_MS);
    const snap = this.sim.snapshot();
    this.nowValue = snap.now;
    const villager = snap.villagers[0]!;

    this.trackMovement(beforeNow, villager);
    this.trackBeats(beforeNow, snap.now, villager, snap.events);
    this.trackEvents(beforeNow, snap.events);
    this.trackLamp(snap.now, villager);

    if (this.memory !== null) {
      this.memory.syncHolders(
        snap.villagers.map((v) => ({ holderId: v.id, type: 'character' as const, at: v.pos })),
      );
      this.memory.syncHolders(
        snap.buildings.map((b) => ({
          holderId: b.instanceId,
          type: 'place' as const,
          at: b.door,
          name: b.displayName,
        })),
      );
      this.memory.tick(snap.now);
    }
  }

  private trackMovement(beforeNow: number, villager: VillagerSnapshot): void {
    const walking = villager.walking;
    const minute = minuteOfDay(this.nowValue);
    if (!this.lastWalking && walking) {
      if (this.arrivedAt !== null && this.arrivalLabel !== null && this.arrivalPos !== null) {
        this.dwells.push({
          arriveAt: this.arrivedAt,
          leaveAt: this.nowValue,
          ms: this.nowValue - this.arrivedAt,
          label: this.arrivalLabel,
          pos: this.arrivalPos,
          quietOverlap: quietOverlap(this.arrivedAt, this.nowValue),
        });
      }
      this.departures.push({
        at: this.nowValue,
        minute,
        quiet: isQuietAt(this.nowValue),
        routine: villager.routine,
        from: { ...villager.pos },
      });
      this.arrivedAt = null;
      this.arrivalLabel = null;
      this.arrivalPos = null;
    }
    if (this.lastWalking && !walking) {
      this.arrivedAt = this.nowValue;
      this.arrivalLabel = villager.routine;
      this.arrivalPos = { ...villager.pos };
      this.arrivals.push({
        at: this.nowValue,
        minute,
        label: villager.routine,
        pos: { ...villager.pos },
      });
    }
    if (walking && (minute >= 22 * 60 || minute < 5 * 60)) {
      this.nightWalkingSteps += 1;
    }
    this.lastWalking = walking;
    void beforeNow;
  }

  private trackBeats(
    beforeNow: number,
    now: number,
    villager: VillagerSnapshot,
    events: readonly WorldEvent[],
  ): void {
    for (const beat of beatsBetween(beforeNow, now)) {
      this.beatHits.push({
        id: beat.id,
        at: now,
        beforeNow,
        minute: minuteOfDay(now),
        villager: { ...villager, pos: { ...villager.pos } },
        changes: this.changes.filter((record) => record.at > beforeNow && record.at <= now),
        events: events.filter((event) => event.at > beforeNow && event.at <= now),
      });
    }
  }

  private trackEvents(beforeNow: number, events: readonly WorldEvent[]): void {
    for (const event of events) {
      if (event.at <= beforeNow || event.at > this.nowValue) continue;
      const key = `${event.at}|${event.tone}|${event.text}`;
      if (this.seenEvents.has(key)) continue;
      this.seenEvents.add(key);
      this.events.push(event);
    }
  }

  private trackLamp(now: number, villager: VillagerSnapshot): void {
    const day = lampDayOf(now);
    const previousDay = this.lamp.day;
    const next = advanceLamp(
      this.lamp,
      LAMP_FULL,
      now,
      lampActivityOf(villager.mode, villager.walking),
      day,
    );
    if (day === this.lamp.day) {
      const burned = this.lamp.oil - next.oil;
      if (burned > 0) {
        this.burnedByDay.set(day, (this.burnedByDay.get(day) ?? 0) + burned);
      }
    } else if (this.lamp.seeded && day > previousDay) {
      this.refills += 1;
    }
    this.lamp = next;
    const previousMin = this.minOilByDay.get(day);
    if (previousMin === undefined || next.oil < previousMin) {
      this.minOilByDay.set(day, next.oil);
    }
  }

  private recordChange(change: WorldChange, at: number): void {
    this.changes.push({ change, at });
    if (change.change !== 'world.event' || this.memory === null) return;
    const snap = this.sim.snapshot();
    this.serial += 1;
    const observation = observationOf(change, `func-daily-${this.serial}`, {
      atOfHolder: (holderId) => {
        const holder = snap.villagers.find((v) => v.id === holderId);
        return holder === undefined ? undefined : { x: holder.pos.x, y: holder.pos.y };
      },
      atOfBuilding: (instanceId) => {
        const building =
          this.sim.buildingById(instanceId) ?? snap.buildings.find((b) => b.instanceId === instanceId);
        return building === undefined ? undefined : { x: building.door.x, y: building.door.y };
      },
      buildingOfTask: (taskId) => snap.tasks.find((task) => task.id === taskId)?.buildingId ?? undefined,
    });
    if (observation !== null) this.memory.observe(observation, undefined, at);
  }
}

/** 一段停留是否与 12:00–14:00 有交集（停留最长 120 世界分钟，忽略跨午夜）。 */
function quietOverlap(arriveAt: number, leaveAt: number): boolean {
  if (isQuietAt(arriveAt) || isQuietAt(leaveAt)) return true;
  const from = minuteOfDay(arriveAt);
  const to = minuteOfDay(leaveAt);
  if (from === to) return false;
  if (from < to) return from < 14 * 60 && to >= 12 * 60;
  return false;
}

/** 默认世界里「可走、且四邻有浅滩/泥地」的格子数。打水落点应当在这里。 */
export function wetWalkableCount(world: World): number {
  let count = 0;
  for (let y = 0; y < world.grid.height; y += 1) {
    for (let x = 0; x < world.grid.width; x += 1) {
      if (!world.grid.isWalkable({ x, y })) continue;
      const touchesWater = ([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const).some(([dx, dy]) => {
        const neighbor = world.grid.at({ x: x + dx, y: y + dy });
        return neighbor !== undefined && (neighbor.terrain === 'shallow' || neighbor.terrain === 'mud');
      });
      if (touchesWater) count += 1;
    }
  }
  return count;
}

/** 点是否正好落在某栋楼的门口。 */
export function doorAt(world: World, at: GridPoint): string | undefined {
  return world.buildings.find((building) => building.door.x === at.x && building.door.y === at.y)
    ?.instanceId;
}

/** 切比雪夫距离：网格上「走过去要几步」的口径。 */
export function gridDistance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 世界改变里按 change 名取条数。 */
export function changeCount(run: DailyRun, name: WorldChange['change']): number {
  return run.changes.filter((record) => record.change.change === name).length;
}

/** 一世界日的真实秒数（默认倍率 60 下应为 1440 秒）。 */
export function dayRealSeconds(timeScale: number): number {
  return DAY_MS / (1000 * timeScale);
}

/** 读档重建：与场景读档走同一套 `buildWorldFromSave` + `Simulation.fromSave`。 */
export function rebuildFromSave(
  save: WorldSave,
  onChange: (change: WorldChange, at: number) => void,
): { sim: Simulation; world: World } {
  const world = buildWorldFromSave(save.world.buildings, dailyBlueprints(), LARGE_WORLD_SPEC, LARGE_ALTAR);
  const sim = Simulation.fromSave(save, {
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: save.world.villagers[0]?.name ?? ONE_RESIDENT,
    onChange,
  });
  return { sim, world };
}

export { DAY_MS, PACE, LAMP_DRY, LAMP_FULL };
