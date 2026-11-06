/** 阶段 1：高度字段的数据模型。
 *
 * 这一组钉住四件事，且**都不看渲染、不看可达性**——本阶段明确没有消费者：
 *   1. `level` 全 0 时，大型世界逐格与改动前（f11852c）的冻结读数一致；
 *   2. `GridSpec.levels` 补丁只改 `levelAt`，别的字段一个不动；
 *   3. `levelAt` 是唯一读入口：越界返回 0，不逼每个调用方各自兜底；
 *   4. `ramps` / `ladders` 只编译成两端的 `climb`，不碰可走性。
 *
 * 判据是**同一夹具下的结构对照**（积木式），不是两次运行的相位差。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid, type GridSpec } from '../src/world/grid.ts';
import { fnv1a64Hex } from '../src/world/save.ts';
import { LARGE_WORLD_SPEC } from '../src/world/setup.ts';
import type { GridPoint, TileCell } from '../src/world/types.ts';

/** 改动前（f11852c）在大型世界上实测的逐格摘要，只含旧字段，不含 level。 */
const LARGE_WORLD_LEGACY_DIGEST = 'd6620c210f852bab';

/** 与 `MAX_TERRAIN_LEVEL` 同值。写死在测试里是为了让 red-first 在 base 上红在断言，
 * 而不是因为静态 import 了一个 base 上还不存在的导出、整块变成模块错误。 */
const MAX_LEVEL = 3;

/** `levelAt` 是本次新增的唯一读入口；base 上没有它时红在断言上。 */
function readLevel(grid: WorldGrid, p: GridPoint): number {
  const fn = (grid as unknown as { levelAt?: (p: GridPoint) => number }).levelAt;
  assert.equal(typeof fn, 'function', 'WorldGrid 必须提供唯一的读入口 levelAt');
  return fn!.call(grid, p);
}

/** 旧字段摘要：刻意**不含** `level`，用来证明抬层没有改旧世界。 */
function legacyDigest(grid: WorldGrid): string {
  const lines: string[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.at({ x, y }) as TileCell;
      lines.push([
        x,
        y,
        cell.zone,
        cell.terrain,
        cell.walkable ? 1 : 0,
        cell.region ?? '',
        cell.occupant ?? '',
      ].join('|'));
    }
  }
  return fnv1a64Hex(lines.join('\n'));
}

const SMALL_SPEC: GridSpec = {
  width: 8,
  height: 8,
  zones: [{ id: 'living', x: 0, y: 0, w: 8, h: 8 }],
  border: 1,
};

test('level 全 0：大型世界仍与改动前逐格一致（旧字段摘要 + 6912 格）', () => {
  const grid = new WorldGrid(LARGE_WORLD_SPEC);
  assert.equal(grid.width * grid.height, 6912);
  assert.equal(legacyDigest(grid), LARGE_WORLD_LEGACY_DIGEST);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      assert.equal(readLevel(grid, { x, y }), 0, `(${x},${y}) 的 level 必须是 0`);
    }
  }
});

test('levels 补丁：命中的格子返回 1，邻格仍是 0，越界读回 0', () => {
  const grid = new WorldGrid({
    ...SMALL_SPEC,
    levels: [{ x: 2, y: 2, w: 2, h: 1, level: 1 }],
  });
  assert.equal(readLevel(grid, { x: 2, y: 2 }), 1);
  assert.equal(readLevel(grid, { x: 3, y: 2 }), 1);
  assert.equal(readLevel(grid, { x: 4, y: 2 }), 0);
  assert.equal(readLevel(grid, { x: 2, y: 3 }), 0);
  // 唯一读入口也管越界：不抛、不返回 undefined，按平面处理。
  assert.equal(readLevel(grid, { x: -1, y: 2 }), 0);
  assert.equal(readLevel(grid, { x: 99, y: 99 }), 0);
});

test('levels 补丁不改旧字段：同一世界的旧摘要逐字不变', () => {
  const flat = new WorldGrid(SMALL_SPEC);
  const raised = new WorldGrid({
    ...SMALL_SPEC,
    levels: [{ x: 2, y: 2, w: 2, h: 2, level: 1 }],
  });
  assert.equal(legacyDigest(raised), legacyDigest(flat));
  // 反向：把 level 计入摘要，必须变——证明上面的相等不是因为摘要把 level 丢了。
  const withLevel = (grid: WorldGrid): string => {
    const lines: string[] = [];
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        lines.push(`${x},${y},${grid.at({ x, y })?.level}`);
      }
    }
    return fnv1a64Hex(lines.join('\n'));
  };
  assert.notEqual(withLevel(raised), withLevel(flat));
});

test('level 没有消费者：抬层前后 path / isWalkable 逐字相同', () => {
  const flat = new WorldGrid(SMALL_SPEC);
  const raised = new WorldGrid({
    ...SMALL_SPEC,
    levels: [{ x: 2, y: 2, w: 2, h: 2, level: 1 }],
  });
  const from = { x: 1, y: 1 };
  const to = { x: 6, y: 6 };
  assert.ok(flat.path(from, to).length > 0, '夹具里这条路径必须真的走得通');
  assert.deepEqual(raised.path(from, to), flat.path(from, to));
  for (let y = 0; y < SMALL_SPEC.height; y += 1) {
    for (let x = 0; x < SMALL_SPEC.width; x += 1) {
      assert.equal(raised.isWalkable({ x, y }), flat.isWalkable({ x, y }));
    }
  }
});

test('levels 越界值 / 非整数：构造时就拒绝，不留半套高度', () => {
  assert.throws(
    () => new WorldGrid({ ...SMALL_SPEC, levels: [{ x: 1, y: 1, w: 1, h: 1, level: 1.5 }] }),
    /必须是 0\.\.3 的整数/,
  );
  assert.throws(
    () => new WorldGrid({ ...SMALL_SPEC, levels: [{ x: 1, y: 1, w: 1, h: 1, level: -1 }] }),
    /必须是 0\.\.3 的整数/,
  );
  assert.throws(
    () => new WorldGrid({
      ...SMALL_SPEC,
      levels: [{ x: 1, y: 1, w: 1, h: 1, level: MAX_LEVEL + 1 }],
    }),
    /必须是 0\.\.3 的整数/,
  );
});

test('坡：两端编译成 climb，且只跨 1 层；不改可走性', () => {
  const grid = new WorldGrid({
    ...SMALL_SPEC,
    levels: [{ x: 2, y: 1, w: 1, h: 1, level: 1 }],
    ramps: [{ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } }],
  });
  const low = grid.at({ x: 1, y: 1 });
  const high = grid.at({ x: 2, y: 1 });
  assert.deepEqual(low?.climb, { kind: 'ramp', to: { x: 2, y: 1 } });
  assert.deepEqual(high?.climb, { kind: 'ramp', to: { x: 1, y: 1 } });
  assert.equal(grid.isWalkable({ x: 1, y: 1 }), true);
  assert.equal(grid.isWalkable({ x: 2, y: 1 }), true);
});

test('梯：至少跨 2 层；坡跨 2 层 / 梯跨 1 层都拒绝', () => {
  assert.throws(
    () => new WorldGrid({
      ...SMALL_SPEC,
      levels: [{ x: 2, y: 1, w: 1, h: 1, level: 2 }],
      ramps: [{ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } }],
    }),
    /坡只能跨 1 层/,
  );
  assert.throws(
    () => new WorldGrid({
      ...SMALL_SPEC,
      levels: [{ x: 2, y: 1, w: 1, h: 1, level: 1 }],
      ladders: [{ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } }],
    }),
    /梯至少跨 2 层/,
  );
});

test('跨层边只留一条：一格接两条不同方向的边就直接报', () => {
  assert.throws(
    () => new WorldGrid({
      ...SMALL_SPEC,
      levels: [
        { x: 2, y: 1, w: 1, h: 1, level: 1 },
        { x: 1, y: 2, w: 1, h: 1, level: 1 },
      ],
      ramps: [
        { a: { x: 1, y: 1 }, b: { x: 2, y: 1 } },
        { a: { x: 1, y: 1 }, b: { x: 1, y: 2 } },
      ],
    }),
    /同一格不能有两条不同的跨层边/,
  );
});
