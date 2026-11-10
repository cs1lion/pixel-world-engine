/** 阶段 1：存档 v6 的 `world.terrainEdits` 建结构与序列化。
 *
 * 本阶段**没有编辑器、也没有消费者**：`terrainEdits` 只是被读回、被写出，
 * 不参与 `WorldGrid` 重建，也不影响 `levelAt`。这一条要在测试里说清楚，
 * 免得后来的人把「字段存在」误读成「高度已经生效」。
 *
 * 判据是同一夹具下的结构对照：v6 往返逐字、两次重建同哈希。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WorldGrid, type GridSpec } from '../src/world/grid.ts';
import { assertSave, type WorldSaveV8 } from '../src/world/save.ts';
import type { GridPoint, TerrainEdit } from '../src/world/types.ts';
import { LARGE_WORLD_SPEC, rebuildGridFromPlacements } from '../src/world/setup.ts';
import { parseSaveText } from '../src/ui/save-store.ts';
import { fnv1a64Hex } from '../src/world/save.ts';

/** 与 `SCHEMA_V8_FINGERPRINT` 同值。写死在测试里是为了让 red-first 在 base 上
 * 红在断言，而不是因为静态 import 了 base 上还不存在的导出而变成模块错误。 */
const V8_FINGERPRINT = '2b19c20ed864cf87';

const SAMPLE_URL = new URL('../../docs/save-v8.sample.json', import.meta.url);
let cachedSample: WorldSaveV8 | null = null;

/** 样例是新增文件。base 上它不存在时，这里红在断言上（而不是 ENOENT 崩溃）。 */
function sampleV8(): WorldSaveV8 {
  if (cachedSample !== null) return cachedSample;
  assert.ok(existsSync(SAMPLE_URL), 'docs/save-v8.sample.json 必须存在');
  cachedSample = JSON.parse(readFileSync(SAMPLE_URL, 'utf8')) as WorldSaveV8;
  return cachedSample;
}

/** `levelAt` 是本次新增的唯一读入口；base 上没有它时红在断言上。 */
function readLevel(grid: WorldGrid, p: GridPoint): number {
  const fn = (grid as unknown as { levelAt?: (p: GridPoint) => number }).levelAt;
  assert.equal(typeof fn, 'function', 'WorldGrid 必须提供唯一的读入口 levelAt');
  return fn!.call(grid, p);
}

const EDITS: readonly TerrainEdit[] = [
  { x: 3, y: 4, terrain: 'stone', level: 0 },
  { x: 5, y: 6, terrain: 'mud', level: 1 },
];

function withEdits(edits: readonly TerrainEdit[]): WorldSaveV8 {
  const sample = sampleV8();
  return {
    ...sample,
    world: { ...sample.world, terrainEdits: edits },
    meta: { ...sample.meta, schemaFingerprint: V8_FINGERPRINT },
  };
}

test('v7 往返逐字：JSON 文本 → 解析 → 再序列化，与原文一字不差', () => {
  const save = withEdits(EDITS);
  assert.doesNotThrow(() => assertSave(save), '非空 terrainEdits 必须合法');

  const once = JSON.stringify(save);
  const parsed = parseSaveText(once);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.reason);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.save.world.terrainEdits, EDITS);
  assert.equal(JSON.stringify(parsed.save), once, '往返必须逐字相同');
});

test('空 terrainEdits 也合法：刚开局没改过任何一格', () => {
  const save = withEdits([]);
  assert.doesNotThrow(() => assertSave(save));
  const parsed = parseSaveText(JSON.stringify(save));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.save.world.terrainEdits, []);
});

test('坏地形改动被拒：同格两条最终值 / level 越界 / 未知地形 / 缺键', () => {
  assert.throws(() => assertSave(withEdits([
    { x: 1, y: 1, terrain: 'stone', level: 0 },
    { x: 1, y: 1, terrain: 'mud', level: 0 },
  ])), /同一格 1,1 出现两次/);

  assert.throws(() => assertSave(withEdits([
    { x: 1, y: 1, terrain: 'stone', level: 4 },
  ])), /level 必须在 0\.\.3/);

  const sample = sampleV8();
  const unknown = {
    ...sample,
    world: {
      ...sample.world,
      terrainEdits: [{ x: 1, y: 1, terrain: 'lava', level: 0 }],
    },
    meta: { ...sample.meta, schemaFingerprint: V8_FINGERPRINT },
  } as unknown as WorldSaveV8;
  assert.throws(() => assertSave(unknown), /terrain 只能是/);

  const missing = {
    ...sample,
    world: {
      ...sample.world,
      terrainEdits: [{ x: 1, y: 1, level: 0 }],
    },
    meta: { ...sample.meta, schemaFingerprint: V8_FINGERPRINT },
  } as unknown as WorldSaveV8;
  assert.throws(() => assertSave(missing), /terrainEdits\[0\]\.terrain 缺失/);
});

function digestLevels(grid: WorldGrid): string {
  const lines: string[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      lines.push(`${x},${y},${readLevel(grid, { x, y })}`);
    }
  }
  return fnv1a64Hex(lines.join('\n'));
}

test('两次重建同哈希：同一 GridSpec 重放两次，逐格 level 摘要一致', () => {
  const spec: GridSpec = {
    ...LARGE_WORLD_SPEC,
    levels: [{ x: 10, y: 10, w: 3, h: 2, level: 1 }],
  };
  const first = rebuildGridFromPlacements([], spec);
  const second = rebuildGridFromPlacements([], spec);
  assert.equal(digestLevels(first), digestLevels(second));
  assert.equal(readLevel(first, { x: 10, y: 10 }), 1);
});

test('字段存在但无消费者：存档里的 terrainEdits 不覆盖 GridSpec 的高度', () => {
  // 同一格：设定集说 1 层，存档说 3 层。本阶段重建只认设定集，
  // 所以读档后仍是 1——这不是 bug，是阶段 1 明确「不接消费者」。
  const spec: GridSpec = {
    ...LARGE_WORLD_SPEC,
    levels: [{ x: 10, y: 10, w: 1, h: 1, level: 1 }],
  };
  const save = withEdits([{ x: 10, y: 10, terrain: 'stone', level: 3 }]);
  assert.doesNotThrow(() => assertSave(save));

  const bare = rebuildGridFromPlacements([], spec);
  const grid = rebuildGridFromPlacements(save.world.buildings, spec);
  assert.equal(readLevel(grid, { x: 10, y: 10 }), 1, '存档改动尚未接进网格');
  assert.equal(grid.at({ x: 10, y: 10 })?.terrain, bare.at({ x: 10, y: 10 })?.terrain);
});
