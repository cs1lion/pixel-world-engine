/**
 * 回家这条线的取证：逐拍轨迹 / 翻转时刻 / 屋里的人 / 门外目击者的记忆。
 *
 * 跑法（`world-client/` 下）：
 *
 *     node scripts/homecoming-trace.ts
 *
 * 输出 `docs/evidence/homecoming/readings.json`。两跑同初始时刻，把逐拍序列、
 * 翻转拍、门格、记忆文本、快照指纹都算两遍再比——**逐字相同才算通过**。
 *
 * 世界用 `buildLargeWorld`：五栋 `zone = living` 的民居。时钟从 21:00 起，
 * 22:00 入夜；跑 120 分钟（到 23:00），覆盖「走回家 → 进门 → 留在屋里」。
 */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import type { ObservationContext } from '../src/world/observation-rules.ts';
import type { WorldChange } from '../src/world/world-changes.ts';
import type { GridPoint } from '../src/world/types.ts';
import {
  HOME_BEDTIME_MINUTE,
  homeFor,
  homesOf,
  insideSpotOf,
} from '../src/world/homecoming.ts';

const OUT = 'D:/project/pwe-material/docs/evidence/homecoming';
const MINUTE = 60_000;
const START_MINUTE = 21 * 60;

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function buildingIdAt(buildings: readonly { origin: GridPoint; footprint: { w: number; h: number }; instanceId: string }[], point: GridPoint): string | null {
  for (const building of buildings) {
    if (
      point.x >= building.origin.x
      && point.y >= building.origin.y
      && point.x < building.origin.x + building.footprint.w
      && point.y < building.origin.y + building.footprint.h
    ) {
      return building.instanceId;
    }
  }
  return null;
}

interface RunReadings {
  readonly sequence: readonly string[];
  readonly flipTick: number | null;
  readonly doorAtFlip: GridPoint | null;
  readonly insideSpot: GridPoint | null;
  readonly occupants: Record<string, readonly string[]>;
  readonly homeId: string;
  readonly memories: readonly {
    readonly holder: string;
    readonly what: string;
    readonly where: string;
    readonly tier: string;
    readonly salience: number;
  }[];
  readonly eventTexts: readonly string[];
  readonly witnessesAtFlip: readonly {
    readonly id: string;
    readonly pos: GridPoint;
    readonly chebyshev: number;
    readonly visible: boolean;
  }[];
  readonly snapshotHash: string;
}

function run(): RunReadings {
  const world = buildLargeWorld(blueprints);
  const memory = new MemoryRuntime({
    occlusion: world.grid,
    insideAt: (point) => buildingIdAt(world.buildings, point),
    // 与 `SandboxScene` 的生产接线一字不差：只有「绑着某栋楼」这一条。
    // 进门事件若只靠它推 `indoor`，会被判成室内（门口那幕就没人看得见）；
    // 靠的是 `observationOf` 给 `home_entry` 显式写 `indoor = false`。
    placeIndoor: (placeId) => world.buildings.some((building) => building.instanceId === placeId),
  });
  let serial = 0;
  const eventTexts: string[] = [];
  const context: ObservationContext = {
    atOfHolder: (holderId) => {
      const villager = sim.snapshot().villagers.find((item) => item.id === holderId);
      return villager === undefined ? undefined : { x: villager.pos.x, y: villager.pos.y };
    },
    atOfBuilding: (instanceId) => {
      const building = sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
      return building === undefined ? undefined : { x: building.door.x, y: building.door.y };
    },
    buildingOfTask: (taskId) =>
      sim.snapshot().tasks.find((item) => item.id === taskId)?.buildingId ?? undefined,
  };
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    initialNow: START_MINUTE * MINUTE,
    wallClock: () => 1000,
    onChange: (change: WorldChange, at: number): void => {
      if (change.change !== 'world.event') return;
      eventTexts.push(`${at}:${change.kind}:${change.text}`);
      serial += 1;
      const observation = observationOf(change, `mem_${serial}`, context);
      if (observation !== null) memory.observe(observation, undefined, at);
    },
  });

  const home = homeFor('v0', homesOf(world.buildings));
  if (home === null) throw new Error('v0 没有家——大世界该有五栋民居');

  let previous = sim.snapshot().villagers[0]!;
  let flipTick: number | null = null;
  let doorAtFlip: GridPoint | null = null;
  let witnessesAtFlip: RunReadings['witnessesAtFlip'] = [];
  const sequence: string[] = [];

  for (let tick = 1; tick <= 120; tick += 1) {
    sim.update(MINUTE);
    memory.syncHolders(
      sim.snapshot().villagers.map((villager) => ({
        holderId: villager.id,
        type: 'character' as const,
        at: { x: villager.pos.x, y: villager.pos.y },
      })),
    );
    memory.tick(sim.snapshot().now);
    const villager = sim.snapshot().villagers[0]!;
    sequence.push(
      `${tick},${Math.floor(sim.snapshot().now / MINUTE)},${villager.visible ? 1 : 0},${villager.pos.x},${villager.pos.y},${villager.routine ?? ''}`,
    );
    if (previous.visible && !villager.visible && flipTick === null) {
      flipTick = tick;
      doorAtFlip = { x: previous.pos.x, y: previous.pos.y };
      witnessesAtFlip = sim.snapshot().villagers
        .filter((item) => item.id !== villager.id)
        .map((item) => ({
          id: item.id,
          pos: { x: item.pos.x, y: item.pos.y },
          chebyshev: Math.max(Math.abs(item.pos.x - previous.pos.x), Math.abs(item.pos.y - previous.pos.y)),
          visible: item.visible,
        }));
    }
    previous = villager;
  }

  const snapshot = sim.snapshot();
  const occupants: Record<string, readonly string[]> = {};
  for (const building of snapshot.buildings) {
    occupants[building.instanceId] = snapshot.villagers
      .filter((villager) => !villager.visible && buildingIdAt(snapshot.buildings, villager.pos) === building.instanceId)
      .map((villager) => villager.id);
  }

  const memories: { holder: string; what: string; where: string; tier: string; salience: number }[] = [];
  for (const villager of snapshot.villagers) {
    for (const entry of memory.viewOf(villager.id)?.memories ?? []) {
      if (entry.content.what.includes('走进了')) {
        memories.push({
          holder: villager.id,
          what: entry.content.what,
          where: entry.content.where,
          tier: entry.tier,
          salience: entry.salience,
        });
      }
    }
  }

  return {
    sequence,
    flipTick,
    doorAtFlip,
    insideSpot: insideSpotOf(home),
    occupants,
    homeId: home.instanceId,
    memories,
    eventTexts,
    witnessesAtFlip,
    snapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
  };
}

const first = run();
const second = run();

const report = {
  capturedAt: new Date().toISOString().slice(0, 10),
  world: 'large / five living homes',
  startMinute: START_MINUTE,
  bedtimeMinute: HOME_BEDTIME_MINUTE,
  flaps: {
    flipTick: first.flipTick,
    doorAtFlip: first.doorAtFlip,
    insideSpot: first.insideSpot,
    homeId: first.homeId,
  },
  occupants: first.occupants,
  witnessesAtFlip: first.witnessesAtFlip,
  /** 门格到每个目击者的距离（切比雪夫），含那一刻能不能看见（`visible`）。 */
  sequence: first.sequence,
  memories: first.memories,
  eventTexts: first.eventTexts.filter((item) => item.includes(':home_entry:')),
  determinism: {
    sequenceIdentical: first.sequence.join('|') === second.sequence.join('|'),
    flipTickIdentical: first.flipTick === second.flipTick,
    doorIdentical: JSON.stringify(first.doorAtFlip) === JSON.stringify(second.doorAtFlip),
    memoryIdentical: JSON.stringify(first.memories) === JSON.stringify(second.memories),
    snapshotHash: first.snapshotHash,
    snapshotHashSecond: second.snapshotHash,
    identical: first.snapshotHash === second.snapshotHash,
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/readings.json`, JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  flipTick: report.flaps.flipTick,
  door: report.flaps.doorAtFlip,
  insideSpot: report.flaps.insideSpot,
  homeId: report.flaps.homeId,
  occupants: report.occupants,
  homeEntryEvents: report.eventTexts.length,
  memories: report.memories,
  determinism: report.determinism,
}, null, 2));
