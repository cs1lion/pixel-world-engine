/**
 * 回家：夜里她真的走进自家门，街面上只看见「走到门口、然后不见了」。
 *
 * 这套测试钉四件事：
 * 1. **翻转的时机**：位置先到自家门口格，下一拍才 `visible = false`；
 *    位置落在占地里（室内视图按占地判人，门口格会判成街上）。
 * 2. **天亮出门**：`visible` 翻回 true、人站在门口格上，不是从街角冒出来。
 * 3. **在屋里的不接活**：夜里派下去的单不会落到一个看不见的人头上。
 * 4. **确定性**：同一初始时刻两跑，逐拍的 pos 与 visible 逐字相同。
 *
 * 用 `buildLargeWorld`：它带着五栋 `zone = living` 的民居；小世界没有住宅，
 * 那一组用来钉「没有家就不进屋」（不能把「回家」写成一到夜里就消失）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import {
  HOME_BEDTIME_MINUTE,
  homeFor,
  homesOf,
  insideSpotOf,
} from '../src/world/homecoming.ts';
import type { WorldChange } from '../src/world/world-changes.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { perceives } from '../src/world/memory/perception.ts';

const MINUTE = 60_000;

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(initialNow: number): Simulation {
  const world = buildLargeWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    initialNow,
    wallClock: () => 1000,
  });
}

test('夜里先走到自家门口，下一拍才翻不可见，位置落在占地里', () => {
  const sim = makeSim(HOME_BEDTIME_MINUTE * MINUTE - 5 * MINUTE);
  const homes = homesOf(sim.snapshot().buildings);
  assert.equal(homes.length, 5, '大世界该有五栋民居');

  let prev = sim.snapshot().villagers[0]!;
  let flipTick = -1;
  let doorBeforeFlip: { x: number; y: number } | null = null;
  for (let tick = 1; tick <= 120; tick += 1) {
    sim.update(MINUTE);
    const now = sim.snapshot().villagers[0]!;
    if (prev.visible && !now.visible) {
      flipTick = tick;
      doorBeforeFlip = { x: prev.pos.x, y: prev.pos.y };
    }
    prev = now;
  }

  assert.ok(flipTick > 0, '入夜后她该进屋');
  const home = homeFor('v0', homes);
  assert.ok(home !== null, 'v0 该有家');
  assert.deepEqual(
    doorBeforeFlip,
    { x: home.door.x, y: home.door.y },
    `翻转前那一拍她该站在自家门口格，实得 ${JSON.stringify(doorBeforeFlip)}`,
  );

  const final = sim.snapshot().villagers[0]!;
  const spot = insideSpotOf(home);
  assert.deepEqual(
    { x: final.pos.x, y: final.pos.y },
    spot,
    '`visible = false` 之后位置要落在占地里，否则室内视图认不出这栋楼有人',
  );
  assert.ok(
    spot.x >= home.origin.x
      && spot.x < home.origin.x + home.footprint.w
      && spot.y >= home.origin.y
      && spot.y < home.origin.y + home.footprint.h,
    '落脚点必须在占地里',
  );
});

test('天亮她站在门口格上出现，不是从街角冒出来', () => {
  // 23:00 起跑：她先走回家睡下，再等 06:00 的起床。从 05:50 起跑不行——
  // 走到门口时已经过了 06:00，那一段只会看到她「半路折返」，不是起床。
  const sim = makeSim(23 * 60 * MINUTE);
  let prev = sim.snapshot().villagers[0]!;
  let wakePos: { x: number; y: number } | null = null;
  for (let tick = 1; tick <= 480; tick += 1) {
    sim.update(MINUTE);
    const now = sim.snapshot().villagers[0]!;
    if (!prev.visible && now.visible && wakePos === null) {
      wakePos = { x: now.pos.x, y: now.pos.y };
    }
    prev = now;
  }
  assert.ok(wakePos !== null, '过了 06:00 她该出门');
  const homes = homesOf(sim.snapshot().buildings);
  const home = homeFor('v0', homes);
  assert.ok(home !== null);
  assert.deepEqual(wakePos, { x: home.door.x, y: home.door.y }, '出现在自家门口，不是别处');
});

test('被神谕点到名的人从门口出来，不在屋里原地开工', () => {
  // 「在屋里就永远不接活」会把开局六个小时的神谕派活全部堵死：世界从
  // 00:00 起跑，`test:browser` 的第二单因此死等。指派前先把人叫到门口，
  // 翻转仍发生在门口——不是让谁在街角凭空出现。
  const sim = makeSim(HOME_BEDTIME_MINUTE * MINUTE - 5 * MINUTE);
  for (let tick = 1; tick <= 40; tick += 1) sim.update(MINUTE);
  const home = homeFor('v0', homesOf(sim.snapshot().buildings));
  assert.ok(home !== null);
  const asleep = sim.snapshot().villagers[0]!;
  assert.equal(asleep.visible, false, '前提：她已经进屋');
  assert.deepEqual({ x: asleep.pos.x, y: asleep.pos.y }, insideSpotOf(home));

  sim.enqueue({ kind: 'oracle', raw: '写个脚本' });
  sim.update(MINUTE);
  const worker = sim.snapshot().villagers.find((villager) => villager.taskId !== null);
  assert.ok(worker !== undefined, '夜里也该有人接下这一单');
  assert.equal(worker.visible, true, '接了活就该在街上看得见');
  assert.deepEqual(
    { x: worker.pos.x, y: worker.pos.y },
    { x: home.door.x, y: home.door.y },
    '是从自家门口走出来的，不是在屋里原地开工',
  );
});

test('没有住宅就不进屋：小世界整夜照常在街上', () => {
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    initialNow: HOME_BEDTIME_MINUTE * MINUTE - 5 * MINUTE,
    wallClock: () => 1000,
  });
  for (let tick = 1; tick <= 40; tick += 1) {
    sim.update(MINUTE);
    assert.equal(sim.snapshot().villagers[0]!.visible, true, `第 ${tick} 拍她不该消失`);
  }
});

test('同一初始时刻两跑：逐拍 pos 与 visible 逐字相同', () => {
  const run = (): string => {
    const sim = makeSim(HOME_BEDTIME_MINUTE * MINUTE - 5 * MINUTE);
    const frames: string[] = [];
    for (let tick = 0; tick < 40; tick += 1) {
      sim.update(MINUTE);
      const villager = sim.snapshot().villagers[0]!;
      frames.push(`${villager.pos.x},${villager.pos.y},${villager.visible ? 1 : 0}`);
    }
    return frames.join('|');
  };
  assert.equal(run(), run());
});

test('进门那一幕按室外记账：门口八格内的街上人看得见，屋里的人看不见', () => {
  const home = homeFor('v0', homesOf(buildLargeWorld(blueprints).buildings));
  assert.ok(home !== null);
  const change: WorldChange = {
    change: 'world.event',
    kind: 'home_entry',
    text: '莞尔走进了橡木小屋，门在身后合上。',
    placeId: home.instanceId,
    where: home.door,
    actorId: 'v0',
  };
  const observation = observationOf(change, 'mem_1', {
    atOfHolder: () => undefined,
    atOfBuilding: () => undefined,
    buildingOfTask: () => undefined,
  });
  assert.ok(observation !== null);
  // 门口的 `where` 在占地外，但 `placeId` 绑着住宅。生产接线的 `placeIndoor`
  // 只看 placeId，会把这一幕误判成室内；必须由观测本身显式写 false。
  assert.equal(observation.indoor, false, '门口是室外：`indoor` 必须显式 false');

  const place = { placeId: home.instanceId, at: home.door, indoor: observation.indoor ?? true };
  const grid = { isWalkable: () => true };
  const street = { holderId: 'v1', at: { x: home.door.x - 2, y: home.door.y + 7 }, inside: null };
  assert.equal(perceives(street, place, grid, DEFAULT_MEMORY_CONFIG), true, '街上七格外的人看得见她进屋');
  const indoors = { holderId: 'v0', at: insideSpotOf(home), inside: home.instanceId };
  assert.equal(perceives(indoors, place, grid, DEFAULT_MEMORY_CONFIG), false, '屋里的人看不见室外的事');
});
