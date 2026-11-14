/**
 * 造物主内环的毫秒级单测——**只测生产实现**。
 *
 * P0 之前这里测的是 spatial-executor.ts 的自研螺旋/BFS 和台账的逻辑拍倒计时；
 * 那两套已经删掉。现在钉住的是生产真入口：
 * `WorldGrid.findBestSlot`、`paveFrom` / `doorReaches`、`CONSTRUCTION_MS`，
 * 以及从存档建筑形状算指标的纯函数。
 *
 * 全是静态 import：这些模块在 Phase 1 的 base 上就存在（它们不是新增能力），
 * 所以本文件不负责 red-first 的红灯；那由 `creator-production-truth.test.ts` 承担。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldGrid } from '../src/world/grid.ts';
import { SMALL_WORLD_SPEC, paveFrom, doorReaches } from '../src/world/setup.ts';
import type { GridPoint, PrefabBlueprint } from '../src/world/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `audit-state.ts` 是本次才有的模块。red-first 把 test/ 的 diff 套到 base 时它不存在，
 * 静态 import 会变成 ERR_MODULE_NOT_FOUND（判 ERROR，不可采信）；动态取、只吞「文件不在」，
 * 让它红在断言上。模块本身写坏则原样抛出去。
 */
async function auditModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('../src/world/creator/audit-state.ts')) as Record<string, unknown>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') return {};
    throw error;
  }
}

/** findBestSlot 只读这四个字段；造最小形状，不拖整套蓝图解析器进来。 */
function blueprint(zone: string): PrefabBlueprint {
  return {
    footprint: { w: 2, h: 2 },
    clearMargin: 1,
    zone,
    door: { x: 0, y: 2 },
  } as unknown as PrefabBlueprint;
}

test('1. 生产选址 WorldGrid.findBestSlot：确定性、合法、避开已占格', () => {
  const grid = new WorldGrid(SMALL_WORLD_SPEC);
  const anchor = { x: 14, y: 10 };
  const prefab = blueprint('industry');

  const first = grid.findBestSlot(prefab, anchor);
  const second = grid.findBestSlot(prefab, anchor);
  assert.ok(first !== null, '空图上必须找得到落点');
  assert.deepEqual(first, second, '同网格同锚点两次选址必须逐字相同');
  assert.equal(grid.canPlace(first, 2, 2, prefab.clearMargin), true, '选出来的点要真的放得下');

  // 占掉首选项之后，下一次必须换地方，而不是压上去。
  const placed = grid.place({
    instanceId: 'probe-1', origin: first, w: 2, h: 2,
    door: { x: first.x, y: first.y + 2 },
  });
  assert.equal(placed, true);
  const next = grid.findBestSlot(prefab, anchor);
  assert.ok(next !== null);
  assert.notDeepEqual(next, first, '已占格不能再次被选中');
});

test('2. 生产铺路 paveFrom + doorReaches：门口连到锚点', () => {
  const grid = new WorldGrid(SMALL_WORLD_SPEC);
  const anchor = { x: 14, y: 10 };
  const prefab = blueprint('industry');
  const origin = grid.findBestSlot(prefab, anchor);
  assert.ok(origin !== null);
  grid.place({
    instanceId: 'probe-2', origin, w: 2, h: 2,
    door: { x: origin.x, y: origin.y + 2 },
  });
  const door = { x: origin.x + prefab.door.x, y: origin.y + prefab.door.y };
  const route = paveFrom(grid, door, anchor);
  assert.equal(doorReaches(grid, door, anchor), true, '生产判定：门口应连得到锚点');
  assert.ok(Array.isArray(route.road), 'paveFrom 要给出逐格小径');
  assert.equal(typeof route.reachable, 'boolean', 'reachable 是与 road 空不空无关的另一条信号');
});

test('3. 指标只从建筑形状算：重叠、留白、连通率、淹没格', async () => {
  const mod = await auditModule();
  const metricsOf = mod['metricsOf'] as
    | ((b: unknown[], d: boolean[], s: ReadonlySet<string>) => Record<string, number | boolean>)
    | undefined;
  const pointKey = mod['pointKey'] as ((p: GridPoint) => string) | undefined;
  assert.equal(typeof metricsOf, 'function', '指标函数还没落地——这正是 red-first 要的红灯');
  assert.equal(typeof pointKey, 'function', '格子键函数也没落地');

  const a = { origin: { x: 2, y: 2 }, footprint: { w: 2, h: 2 } };
  const b = { origin: { x: 8, y: 8 }, footprint: { w: 2, h: 2 } };
  const clean = metricsOf!([a, b], [true, true], new Set<string>());
  assert.equal(clean.overlapCount, 0);
  assert.equal(clean.pathfindingConnectivity, 1);
  assert.equal(clean.doorWalkableToAltar, true);
  assert.equal(clean.submergedBuildingCount, 0);

  const overlapping = { origin: { x: 3, y: 3 }, footprint: { w: 2, h: 2 } };
  const dirty = metricsOf!([a, overlapping], [true, false], new Set([pointKey!({ x: 4, y: 4 })]));
  assert.ok(Number(dirty.overlapCount) > 0, '真重叠了却报 0，指标就是摆设');
  assert.equal(dirty.pathfindingConnectivity, 0.5);
  assert.equal(dirty.doorWalkableToAltar, false);
  assert.equal(dirty.submergedBuildingCount, 1, '只有重叠那栋踩到 (4,4) 这块淹没格');
});

test('4. 施工时钟与存档路径：生产唯一的一份', () => {
  const simulation = readFileSync(join(ROOT, 'src/world/simulation.ts'), 'utf8');
  const save = readFileSync(join(ROOT, 'src/world/save.ts'), 'utf8');
  assert.match(simulation, /const CONSTRUCTION_MS = 3200/, '施工时长只能在 Simulation 定义一次');
  assert.match(save, /'world\.constructions\[\]'/, '施工剩余毫秒必须进存档路径集合');
  assert.doesNotMatch(simulation, /constructionTicksRemaining/, '生产里不该出现评测用的逻辑拍');
});

/** 让 TS 认出 GridPoint 在本文件被用过（断言形状时保持一致）。 */
export type _Point = GridPoint;
