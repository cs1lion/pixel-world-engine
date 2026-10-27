/**
 * 萤火的位置真的落在空地上吗。
 *
 * 这条规矩原来只在 `fireflies.ts` 的注释里说了一句「只放在空地上」，没有任何机器
 * 在看。而它坏起来是无声的：往列表里加一枚坐标、或者改动世界生成让某处长出建筑，
 * 画面都不会报错，只会出现「萤火出现在树干里/屋顶上」——而在 1px 的点上，
 * 这种事在缩略图里几乎看不出来。
 *
 * 数据原来住在 `phase-view.ts`，那个文件 import Phaser，node 测试碰不得，
 * 所以这条规矩想守也守不了。已把 `FIREFLIES` 搬到 `src/render/fireflies.ts`
 * （不 import Phaser），这道闸才立得起来。
 *
 * 坐标是像素不是格，所以这里自己除 `TILE_PX` 取所在格。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIREFLIES } from '../src/render/fireflies.ts';
import { buildLargeWorld, TILE_PX } from '../src/world/setup.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

const world = buildLargeWorld(blueprints);

test('萤火一共八枚——加位置可以，但得先过下面那条', () => {
  assert.equal(FIREFLIES.length, 8);
});

test('每一枚都落在默认大世界里可行走、无建筑、不越界的格子上', () => {
  const bad: string[] = [];
  for (const f of FIREFLIES) {
    const tx = Math.floor(f.x / TILE_PX);
    const ty = Math.floor(f.y / TILE_PX);
    const p = { x: tx, y: ty };
    const inWorld = tx >= 0 && tx < world.grid.width && ty >= 0 && ty < world.grid.height;
    if (!inWorld) {
      bad.push(`(${f.x},${f.y}) -> (${tx},${ty}) 越界：世界是 ${world.grid.width}×${world.grid.height}`);
      continue;
    }
    if (!world.grid.isWalkable(p)) bad.push(`(${f.x},${f.y}) -> (${tx},${ty}) 不可走`);
    if (world.grid.at(p)?.occupant !== null && world.grid.at(p)?.occupant !== undefined) {
      bad.push(`(${f.x},${f.y}) -> (${tx},${ty}) 有占用者 ${world.grid.at(p)?.occupant}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('坐标都是正的、在画布内的像素值（不是格）', () => {
  for (const f of FIREFLIES) {
    assert.ok(f.x > 0 && f.y > 0, `(${f.x},${f.y}) 不是正数`);
    assert.ok(f.x < world.grid.width * TILE_PX, `x=${f.x} 超出世界像素宽`);
    assert.ok(f.y < world.grid.height * TILE_PX, `y=${f.y} 超出世界像素高`);
  }
});

test('没有两枚落在同一格里——否则夜里会看到一个 2px 的点', () => {
  const cells = FIREFLIES.map((f) => `${Math.floor(f.x / TILE_PX)},${Math.floor(f.y / TILE_PX)}`);
  assert.equal(new Set(cells).size, cells.length, `有重复的格：${cells.join(' ')}`);
});
