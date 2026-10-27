import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildWorld, buildLargeWorld, TILE_PX } from '../src/world/setup.ts';
import { WorldGrid } from '../src/world/grid.ts';
import type { TerrainId } from '../src/world/types.ts';
import {
  sideMask,
  cornerMask,
  SIDE_BIT,
  CORNER_BIT,
  type EdgeNeighbors,
} from '../src/render/terrain-edges.ts';

/**
 * `terrain-edges.ts` 的 `DARK` 注释里那串像素计数，现在有机器在算了。
 *
 * 那串数的来路：`tree` 的底色本身就是 soil，暗边也用 soil，落差 0.0，等于白画。
 * 为了说明「这批像素有多少、值不值得管」，注释里报了一批计数——而它们报了三次
 * 错三次（`git log` 里 `a624d36`、`6e7f84b` 两次重测，加上更早那次的 48=96÷2）。
 * 第三次错得最安静：分子漏数、分母没漏，两个口径不齐的数被除在一起。
 *
 * 所以这个文件不测「边画得对不对」——那是 `terrain-edges.test.ts` 与
 * `terrain-edge-visibility.test.ts` 的事。它只做一件事：**把注释里每个像素数
 * 按同一口径重算一遍，对不上就红。**
 *
 * 三条口径，写在这儿免得下次又混：
 *   1. **边写入面积**（`fillRect` 面积和）：一格同时画南和西时，(px, py+15)
 *      先被暗边写一次、再被亮边写一次，算两回。注释里的 29387 / 2576 是这个。
 *   2. **去重像素**：同一个像素只算一次。29003 / 2575。
 *   3. **tree 整批**：tree 的暗边 + tree 的暗内凹角。11568 / 738。
 *      漏掉内凹角是上一笔的错——11392 只数边，而它要当分子。
 *
 * **为什么敢把数写死。** 世界一改这些数就全变，看起来是冤判磁铁。但注释把它们
 * 当作事实陈述写着，没有锁的话它们只会静静烂掉，而烂掉的样子正是这个仓库反复
 * 吃亏的样子：一个数对不上任何数法，却读起来像在描述这个世界。所以这里的红
 * 一律指向注释——**来改数，不是来改测试**。每条断言的 message 都写了该改哪句。
 *
 * 判据里没有任何阈值。阈值会在世界慢慢长大时悄悄漂移，而漂移本身不会红。
 */

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/**
 * 八邻材质。与 `tilemap.ts` 的 `neighborsOf` 逐字一致——那边是绘制路径，这边是
 * 复算路径，两边必须是同一套规则，否则数出来的不是画出去的。
 */
function neighborsOf(grid: WorldGrid, x: number, y: number): EdgeNeighbors {
  const terrainAt = (dx: number, dy: number): TerrainId | null =>
    grid.at({ x: x + dx, y: y + dy })?.terrain ?? null;
  return {
    north: terrainAt(0, -1),
    northEast: terrainAt(1, -1),
    east: terrainAt(1, 0),
    southEast: terrainAt(1, 1),
    south: terrainAt(0, 1),
    southWest: terrainAt(-1, 1),
    west: terrainAt(-1, 0),
    northWest: terrainAt(-1, -1),
  };
}

interface EdgeCensus {
  /** 全部地形的边写入面积（口径 1）。 */
  readonly writePx: number;
  /** 全部地形的去重边像素（口径 2）。 */
  readonly uniquePx: number;
  readonly darkPx: number;
  readonly brightPx: number;
  /** tree 格画了暗边的格数。 */
  readonly treeDarkTiles: number;
  /** tree 的暗边条数（两边都画的格算两条）。 */
  readonly treeDarkSides: number;
  /** tree 两边都画暗边的格数。 */
  readonly treeBothSides: number;
  /** tree 的暗边像素 = treeDarkSides × 16。 */
  readonly treeSidePx: number;
  /** tree 补的暗内凹角个数。 */
  readonly treeCornerPx: number;
  /** tree 整批 = treeSidePx + treeCornerPx（口径 3）。 */
  readonly treeBatchPx: number;
  /** tree 整批按去重像素算。 */
  readonly treeUniquePx: number;
}

/**
 * 重放 `drawTileEdge` 的每一次 `fillRect`，按上面三条口径分别计数。
 *
 * 复算是**逐像素**的：`put` 把每次写入按坐标记进一张表，后写覆盖先写（与
 * `drawTileEdge` 里「先暗边、再亮边、最后补角」的顺序一致），所以「去重像素」
 * 拿到的是屏幕上真正留下的颜色，不是写入次数。
 */
function census(grid: WorldGrid): EdgeCensus {
  const painted = new Map<number, 0 | 1>();
  const treePainted = new Map<number, 0 | 1>();
  const size = TILE_PX;
  const key = (px: number, py: number): number => py * 100000 + px;

  let writePx = 0;
  let treeDarkTiles = 0;
  let treeDarkSides = 0;
  let treeBothSides = 0;
  let treeCornerPx = 0;

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const self = grid.at({ x, y })?.terrain;
      if (self === undefined) continue;
      const around = neighborsOf(grid, x, y);
      const side = sideMask(self, around);
      const corner = cornerMask(self, around);
      const px = x * size;
      const py = y * size;

      const south = (side & SIDE_BIT.south) !== 0;
      const east = (side & SIDE_BIT.east) !== 0;
      const north = (side & SIDE_BIT.north) !== 0;
      const west = (side & SIDE_BIT.west) !== 0;

      if (south) {
        for (let i = 0; i < size; i += 1) painted.set(key(px + i, py + size - 1), 1);
        writePx += size;
      }
      if (east) {
        for (let i = 0; i < size; i += 1) painted.set(key(px + size - 1, py + i), 1);
        writePx += size;
      }
      if (north) {
        for (let i = 0; i < size; i += 1) painted.set(key(px + i, py), 0);
        writePx += size;
      }
      if (west) {
        for (let i = 0; i < size; i += 1) painted.set(key(px, py + i), 0);
        writePx += size;
      }
      if ((corner & CORNER_BIT.northWest) !== 0) { painted.set(key(px, py), 0); writePx += 1; }
      if ((corner & CORNER_BIT.northEast) !== 0) { painted.set(key(px + size - 1, py), 0); writePx += 1; }
      if ((corner & CORNER_BIT.southWest) !== 0) { painted.set(key(px, py + size - 1), 1); writePx += 1; }
      if ((corner & CORNER_BIT.southEast) !== 0) { painted.set(key(px + size - 1, py + size - 1), 1); writePx += 1; }

      if (self !== 'tree') continue;
      if (south || east) treeDarkTiles += 1;
      if (south && east) treeBothSides += 1;
      treeDarkSides += (south ? 1 : 0) + (east ? 1 : 0);
      // 与 drawTileEdge 同一顺序写：先暗边（下/右）再亮边（上/左）最后补角。
      // 顺序要紧——一格同时画西和西南角时，(px, py+15) 先亮后暗，留下来的颜色
      // 取决于谁后写。数「屏幕上留得下来的暗像素」就得按真顺序复算。
      if (south) for (let i = 0; i < size; i += 1) treePainted.set(key(px + i, py + size - 1), 1);
      if (east) for (let i = 0; i < size; i += 1) treePainted.set(key(px + size - 1, py + i), 1);
      if (north) for (let i = 0; i < size; i += 1) treePainted.set(key(px + i, py), 0);
      if (west) for (let i = 0; i < size; i += 1) treePainted.set(key(px, py + i), 0);
      if ((corner & CORNER_BIT.northWest) !== 0) treePainted.set(key(px, py), 0);
      if ((corner & CORNER_BIT.northEast) !== 0) treePainted.set(key(px + size - 1, py), 0);
      if ((corner & CORNER_BIT.southWest) !== 0) {
        treePainted.set(key(px, py + size - 1), 1);
        treeCornerPx += 1;
      }
      if ((corner & CORNER_BIT.southEast) !== 0) {
        treePainted.set(key(px + size - 1, py + size - 1), 1);
        treeCornerPx += 1;
      }
    }
  }

  let darkPx = 0;
  let brightPx = 0;
  for (const v of painted.values()) {
    if (v === 1) darkPx += 1;
    else brightPx += 1;
  }
  let treeUniquePx = 0;
  for (const v of treePainted.values()) if (v === 1) treeUniquePx += 1;

  return {
    writePx,
    uniquePx: darkPx + brightPx,
    darkPx,
    brightPx,
    treeDarkTiles,
    treeDarkSides,
    treeBothSides,
    treeSidePx: treeDarkSides * size,
    treeCornerPx,
    treeBatchPx: treeDarkSides * size + treeCornerPx,
    treeUniquePx,
  };
}

const large = census(buildLargeWorld(blueprints).grid);
const small = census(buildWorld(blueprints).grid);

// ------------------------------------------------------------ 默认世界 96×72

test('默认世界：tree 暗边那批像素的计数，与 DARK 注释逐项对齐', () => {
  assert.equal(large.treeDarkTiles, 630, '注释「630 格画朝下/朝右的暗边」要改');
  assert.equal(large.treeBothSides, 82, '注释「其中 82 格两边都画」要改');
  assert.equal(large.treeDarkSides, 712, '注释「合 712 条边」要改');
  assert.equal(large.treeSidePx, 11392, '注释「边是 11392 px」要改');
  assert.equal(large.treeCornerPx, 176, '注释「还顺带补了 176 个暗内凹角」要改');
  assert.equal(large.treeBatchPx, 11568, '注释「整批 11568 px」要改');
});

test('默认世界：边写入总量的两个口径，与 DARK 注释逐项对齐', () => {
  assert.equal(large.writePx, 29387, '注释「边写入总量 29387 px」要改');
  assert.equal(large.uniquePx, 29003, '注释「去重后只有 29003 px」要改');
  // 面积和必须严格大于去重数——两者相等就说明「数了两回」这件事不再成立，
  // 那注释里解释口径的那整段都得重写。
  assert.ok(
    large.writePx > large.uniquePx,
    `写入 ${large.writePx} 不大于去重 ${large.uniquePx}，邻边共用像素的解释已失效`,
  );
});

test('默认世界：整批占比按同一口径算，是 39.4% 不是 38.8%', () => {
  const byWrite = (large.treeBatchPx / large.writePx) * 100;
  const byUnique = (large.treeUniquePx / large.uniquePx) * 100;
  assert.ok(
    Math.abs(byWrite - 39.4) < 0.05,
    `写入口径 ${byWrite.toFixed(2)}%，注释写的 39.4% 要改`,
  );
  assert.ok(
    Math.abs(byUnique - 38.9) < 0.05,
    `去重口径 ${byUnique.toFixed(2)}%，注释写的 38.9% 要改`,
  );
  // 上一笔的错就是这两个口径不齐：11392 只数边，29387 含全部内凹角。
  // 分子补上内凹角之后，占比从 38.8% 挪到 39.4%——差得不多，但「分子漏、分母
  // 不漏」这件事本身让原来的相除不成立。
  assert.ok(byWrite > byUnique, '写入口径该比去重口径高：写入把共用像素数了两回');
});

// ------------------------------------------------------------ 旧规格 30×20

test('小世界：另一套数同样逐项对齐，两套不许混用', () => {
  assert.equal(small.treeDarkTiles, 46, '注释「46 格画暗边」要改');
  assert.equal(small.treeBothSides, 0, '注释「没有一格两边都画」要改');
  assert.equal(small.treeSidePx, 736, '注释「736 px 边」要改');
  assert.equal(small.treeCornerPx, 2, '注释「2 px 内凹角」要改');
  assert.equal(small.treeBatchPx, 738, '注释「738 px」要改');
  assert.equal(small.writePx, 2576, '注释「2576 px 写入」要改');
  assert.equal(small.uniquePx, 2575, '注释「2575 去重」要改');
});

test('小世界：28.6% 是写入口径的数，去重口径是 28.7%', () => {
  const byWrite = (small.treeBatchPx / small.writePx) * 100;
  const byUnique = (small.treeUniquePx / small.uniquePx) * 100;
  assert.ok(Math.abs(byWrite - 28.6) < 0.05, `写入口径 ${byWrite.toFixed(2)}%，注释要改`);
  assert.ok(Math.abs(byUnique - 28.7) < 0.05, `去重口径 ${byUnique.toFixed(2)}%，注释要改`);
});

// ------------------------------------------------------------ 两套数不串台

test('两套数是两套：小世界的任何一个数都不等于默认世界', () => {
  // 上一笔之前的那次错，就是把小世界的 96 当成了默认世界的 tree 格数。
  // 这条不测具体值，只测「两套确实不同」——将来哪套改了，另一套不会被带着改。
  assert.notEqual(small.treeDarkTiles, large.treeDarkTiles);
  assert.notEqual(small.writePx, large.writePx);
  assert.notEqual(small.uniquePx, large.uniquePx);
  assert.notEqual(small.treeBatchPx, large.treeBatchPx);
});
