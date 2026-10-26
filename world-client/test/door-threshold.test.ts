/**
 * 她站在门槛上的时候，那一单必须办得下。
 *
 * `pathFor` 的空数组有两种意思：她人已经在那儿，和根本走不到。
 * 混成一种，世界就会说假话——「门口走不过去」会拒掉一单本该办的神谕，
 * 而她正站在门口格上。渡有仪式让「走不到」真的会出现，所以这不是理论上的。
 *
 * 怎么走到那个状态：上游撤一单正在屋里干的活，`restoreOutOfBuilding`
 * 会把她放在那栋楼的门口格上（`simulation.ts` 里那句话：「恢复可见 + 移出建筑」）。
 * 紧接着一单同类的新神谕，还是会派到同一栋楼——她就在门槛上。
 *
 * 这条链子在修好之前是红的：实测 `{"ok":false,"message":"炼码工坊 门口走不过去。"}`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { WorldGrid } from '../src/world/grid.ts';
import type { PlacedBuilding } from '../src/world/types.ts';
import { syncCommand } from './feed-helpers.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
}

test('她站在门槛上：新神谕办得下，不说「门口走不过去」', () => {
  const sim = makeSim();
  // 一单上游的活，让她进屋干活。
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写个脚本' }] }));
  for (let i = 0; i < 40; i += 1) sim.update(100);
  assert.equal(sim.snapshot().villagers[0]!.mode, 'working', '前提：她人在工坊里');

  // 上游撤了它——她被放回门口格，idle。
  sim.enqueue(syncCommand({ tasks: [], cancelled: ['c_1'] }));
  sim.update(16);
  const standing = sim.snapshot().villagers[0]!;
  assert.equal(standing.mode, 'idle');
  const door = sim.snapshot().buildings.find((b) => b.instanceId === 'code_forge#1')!.door;
  assert.equal(standing.pos.x, door.x, '前提：她正站在门口格上');
  assert.equal(standing.pos.y, door.y);

  // 一单同类的新神谕。修好之前这里回 `{ok:false, message:'炼码工坊 门口走不过去。'}`。
  sim.enqueue({ kind: 'oracle', raw: '写个脚本' });
  const results = sim.update(16);
  const last = results[results.length - 1]!;
  assert.equal(last.ok, true, `站在门槛上的她被拒了：${last.message}`);
  assert.equal(sim.snapshot().villagers[0]!.mode, 'saluting', '人接着就往工坊去');
});

test('真过不去的时候，照实说「门口走不过去」', () => {
  // 上面那条放过的是「她人已经在那儿」，不是「一律放过」。
  // 渡有仪式让这一条真的会出现：门后的工坊，她兜里没有凭证。
  const grid = new WorldGrid({
    width: 12,
    height: 10,
    border: 1,
    zones: [],
    // x=6 整列要灯。工坊在右岸，她住在左岸。
    regions: [{ id: 'tide_gate', x: 6, y: 1, w: 1, h: 8, requires: 'lamp' }],
  });
  const building: PlacedBuilding = {
    instanceId: 'code_forge#1',
    prefabId: 'code_forge',
    displayName: '炼码工坊',
    zone: 'industry',
    origin: { x: 8, y: 3 },
    footprint: { w: 2, h: 2 },
    door: { x: 9, y: 6 },
    workSpot: { x: 9, y: 4 },
    chimney: { x: 9, y: 3 },
    accent: 'smoke',
    silhouette: 'flat',
    boundTask: 'code',
    palette: { body: 0x8a5a3b, roof: 0xb5562f, trim: 0xd8c9a3, window: 0xf2c14e },
  };
  assert.ok(grid.place({ instanceId: building.instanceId, origin: building.origin, w: 2, h: 2, door: building.door }));
  const sim = new Simulation({
    grid,
    buildings: [building],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    wallClock: () => 1000,
  });

  const results = sim.update(16);
  sim.enqueue({ kind: 'oracle', raw: '写个脚本' });
  const last = [...results, ...sim.update(16)].at(-1)!;
  assert.equal(last.ok, false, '没带凭证就不该办得下');
  assert.match(last.message, /门口走不过去/, '而且原因要说清楚');
});
