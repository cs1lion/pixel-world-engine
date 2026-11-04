/**
 * 单位状态菜单的四条：人 / 楼 / 空单位 / 空数据，以及 zoom=1/2/3 的坐标命中。
 *
 * 面板本身不改世界：所有断言都只读 `buildUnitStatus` 的返回值；坐标换算用
 * 既有的 `viewOriginOf` 视野原点公式，不写 `scrollX` 直算。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { viewOriginOf } from '../src/render/camera-math.ts';
import {
  anchorCellOf,
  LONG_PRESS_MS,
  buildUnitStatus,
  cellAtScreenPoint,
  longPressShouldFire,
  screenHitPointForCell,
  unitAtCell,
  type UnitMemoryReader,
  type UnitStatusWorld,
} from '../src/ui/unit-status.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined ? null : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

function worldOf(sim: Simulation): UnitStatusWorld {
  const snapshot = sim.snapshot();
  return snapshot;
}

test('村民：行为、目标、位置、情绪、携带、在场者态度都在，且不展开记忆原文', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const villager = snapshot.villagers[0]!;
  const other = snapshot.villagers[1]!;
  const memory: UnitMemoryReader = {
    viewOf: (holderId) => {
      if (holderId !== villager.id) return null;
      return {
        memories: [
          {
            kind: 'impression',
            who: [other.id],
            valence: 0.45,
            arousal: 0.3,
            createdDay: Math.floor(snapshot.now / 86_400_000),
            redacted: false,
          },
        ],
      };
    },
    moodOf: () => ({ label: '轻快', valence: 0.45, arousal: 0.3 }),
  };

  const content = buildUnitStatus(worldOf(sim), { kind: 'villager', id: villager.id }, memory);
  assert.ok(content !== null);
  assert.equal(content.title, villager.name);
  const label = (name: string): string =>
    content.lines.find((line) => line.key === name)?.value ?? '';
  assert.ok(label('行为').length > 0, '行为必须有一句人话');
  assert.equal(label('位置'), `格子 (${Math.floor(villager.pos.x)}, ${Math.floor(villager.pos.y)})`);
  assert.match(label('情绪'), /轻快/);
  assert.match(label('情绪'), /效价 0\.45/);
  assert.equal(label('携带'), '空手 · 无凭证');
  assert.equal(label(`对 ${other.name}`), '印象不错（1 条印象）');
  // 不展开记忆条目：原文那句「我看见……」不该出现在面板任何一行。
  assert.ok(!content.lines.some((line) => line.value.includes('我看见')));
});

test('建筑：状态、接活、在内的人与最近变化都可读', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const building = snapshot.buildings[0]!;
  const content = buildUnitStatus(worldOf(sim), { kind: 'building', id: building.instanceId });
  assert.ok(content !== null);
  assert.equal(content.title, building.displayName);
  const label = (name: string): string =>
    content.lines.find((line) => line.key === name)?.value ?? '';
  assert.ok(['空置', '冷却中', '过热'].includes(label('状态')) || label('状态').startsWith('营业'));
  assert.ok(label('当前的活').length > 0);
  assert.ok(label('在内的人').length > 0);
  assert.ok(label('最近变化').length > 0);
});

test('空单位 / 空数据：返回 null，不编占位', () => {
  const sim = makeSim();
  assert.equal(buildUnitStatus(worldOf(sim), { kind: 'villager', id: 'nobody' }), null);
  assert.equal(buildUnitStatus(worldOf(sim), { kind: 'building', id: 'nowhere' }), null);
  const empty: UnitStatusWorld = {
    now: 0,
    altar: { x: 0, y: 0 },
    villagers: [],
    buildings: [],
    tasks: [],
    workstations: [],
    constructions: [],
  };
  assert.equal(buildUnitStatus(empty, { kind: 'villager', id: 'v0' }), null);
  assert.equal(buildUnitStatus(empty, { kind: 'building', id: 'b0' }), null);
});

test('今日时间线展开条目写出「所以今天避开他」，并把拍数说清楚', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const villager = snapshot.villagers[0]!;
  const other = snapshot.villagers[1]!;
  const day = Math.floor(snapshot.now / 86_400_000);
  const memory: UnitMemoryReader = {
    viewOf: () => null,
    dayTimelineOf: (holderId) => (holderId !== villager.id ? [] : [{
      memoryId: 'm_0002',
      eventId: 'ev-street',
      kind: 'street_tumble',
      day,
      when: day * 86_400_000 + 10 * 60_000,
      placeId: 'place:0,0',
      actors: [other.id, villager.id],
      what: '甲撞翻了乙的担子。',
      why: `所以今天避开${other.name}（12 拍）`,
    }]),
  };
  const content = buildUnitStatus(worldOf(sim), { kind: 'villager', id: villager.id }, memory);
  assert.ok(content !== null);
  assert.equal(content.today?.length, 1, '今日这一段没接上适配器');
  assert.equal(content.today[0]!.what, '甲撞翻了乙的担子。');
  assert.equal(
    content.today[0]!.why,
    `所以今天避开${other.name}（12 拍）`,
    '记忆改了行为，展开条目里却没有那句因果',
  );
  assert.match(content.today[0]!.place, /街上/);
});

test('时刻站不住的那一格写「时刻不明」，不拿日号当 00:00', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const villager = snapshot.villagers[0]!;
  const day = Math.floor(snapshot.now / 86_400_000);
  const memory: UnitMemoryReader = {
    viewOf: () => null,
    dayTimelineOf: (holderId) => (holderId !== villager.id ? [] : [
      {
        memoryId: 'm_known',
        eventId: 'ev-known',
        kind: 'street_tumble',
        day,
        when: day * 86_400_000 + 10 * 3_600_000,
        placeId: null,
        actors: [],
        what: null,
      },
      {
        memoryId: 'm_unknown',
        eventId: 'ev-evicted',
        kind: 'summary',
        day,
        when: day,
        placeId: null,
        actors: [],
        what: null,
        // 事实被预算裁掉（或这一格是摘要，`when` 是日号）：时刻不可知。
        whenKnown: false,
      },
    ]),
  };
  const content = buildUnitStatus(worldOf(sim), { kind: 'villager', id: villager.id }, memory);
  assert.ok(content !== null);
  assert.equal(content.today?.[0]?.clock, '10:00', '事实还在的格子照常给时刻');
  assert.equal(content.today?.[1]?.clock, '时刻不明', '事实没了就不能编一个 00:00 出来');
});

test('长按约 500ms 才触发；移出单位立刻取消', () => {
  assert.equal(LONG_PRESS_MS, 500);
  assert.equal(longPressShouldFire(499, true), false);
  assert.equal(longPressShouldFire(500, true), true);
  assert.equal(longPressShouldFire(800, true), true);
  assert.equal(longPressShouldFire(800, false), false, '指针移出单位就不算长按');
});

test('zoom=1/2/3：屏幕坐标经视野原点公式回算，仍命中同一个人/同一栋楼', () => {
  const sim = makeSim();
  const world = worldOf(sim);
  const villager = world.villagers[0]!;
  const villagerCell = { x: Math.floor(villager.pos.x), y: Math.floor(villager.pos.y) };
  const building = world.buildings.find(
    (item) =>
      !(villagerCell.x >= item.origin.x && villagerCell.x < item.origin.x + item.footprint.w
        && villagerCell.y >= item.origin.y && villagerCell.y < item.origin.y + item.footprint.h),
  )!;
  const buildingCell = { x: building.origin.x, y: building.origin.y };
  const canvas = { left: 20, top: 30 };
  const scroll = 64;

  for (const zoom of [1, 2, 3]) {
    const viewport = {
      x: viewOriginOf(scroll, 480, zoom),
      y: viewOriginOf(scroll, 320, zoom),
    };
    const villagerScreen = screenHitPointForCell(villagerCell, viewport, zoom, canvas);
    assert.deepEqual(
      cellAtScreenPoint(villagerScreen, viewport, zoom, canvas),
      villagerCell,
      `zoom=${zoom} 时村民那格要能点回来`,
    );
    assert.deepEqual(unitAtCell(world, villagerCell.x, villagerCell.y), {
      kind: 'villager',
      id: villager.id,
    });

    const buildingScreen = screenHitPointForCell(buildingCell, viewport, zoom, canvas);
    assert.deepEqual(
      cellAtScreenPoint(buildingScreen, viewport, zoom, canvas),
      buildingCell,
      `zoom=${zoom} 时楼那格要能点回来`,
    );
    assert.deepEqual(unitAtCell(world, buildingCell.x, buildingCell.y), {
      kind: 'building',
      id: building.instanceId,
    });
  }

  assert.deepEqual(anchorCellOf(world, { kind: 'villager', id: villager.id }), villagerCell);
  assert.deepEqual(anchorCellOf(world, { kind: 'building', id: building.instanceId }), {
    x: building.origin.x + Math.floor(building.footprint.w / 2),
    y: building.origin.y,
  });
});
