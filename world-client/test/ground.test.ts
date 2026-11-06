/** 阶段 0 的组件口径：落地投影只能有一套写法，且 `level` 只有一个产出点。
 *
 * 这组测试不截图，只锁三件事：
 *   1. 公式逐字：`groundY` / `actorDepth` / `propFootAt` / `propDepthAt` 在 level 0/1/3
 *      下的数，一个格子都不许漂；
 *   2. 收敛：villager / prop / scenery / building 的既有导出都等于 ground 的结果，
 *      证明它们没有再写第二套算术；
 *   3. 单一产出点：`LEVEL_PX` / `DEPTH_LEVEL_EPS` 只出现在 `render/ground.ts`，
 *      且 `render/` 里没有任何 `levelAt(` —— level 由场景传参，渲染层不自己读格子。
 *
 * 模块用动态 import：red-first 把本文件套到 base 时，红必须红在断言上，
 * 而不是红在“base 上没有 ground.ts”的模块解析错误。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_PX } from '../src/world/setup.ts';

type GroundModule = typeof import('../src/render/ground.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

async function ground(): Promise<GroundModule> {
  const mod = (await import('../src/render/ground.ts').catch(() => null)) as GroundModule | null;
  assert.ok(mod !== null, 'render/ground.ts 必须存在：落地投影的唯一写法国');
  return mod;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const ALT = 1000;

test('常量同源：LEVEL_PX 跟 TILE_PX 走，深度预算翻不过一个格子', async () => {
  const g = await ground();
  assert.equal(g.LEVEL_PX, TILE_PX, '每抬一层 = 一格；改 TILE_PX 必须跟着改');
  assert.equal(g.MAX_LEVEL, 3);
  assert.equal(g.DEPTH_LEVEL_EPS, 0.5);
  assert.equal(g.ACTOR_DEPTH_OFFSET, 8);
  assert.equal(g.PROP_FOOT_INSET_PX, 0.2 * TILE_PX);
  assert.equal(g.SCENERY_DEPTH_OFFSET, 12);
  assert.ok(
    g.MAX_LEVEL * g.DEPTH_LEVEL_EPS < g.ACTOR_DEPTH_OFFSET,
    'level 对深度的总位移必须小于 +8 偏移，否则会翻到上一格的角色前面',
  );
});

test('groundY / groundTopY 逐字：level 0 是旧公式，level 1/3 各抬一格', async () => {
  const g = await ground();
  for (const row of [0, 5, 19]) {
    assert.equal(g.groundTopY(row, 0), row * TILE_PX, `row=${row} level=0 行顶`);
    assert.equal(g.groundY(row, 0), (row + 1) * TILE_PX, `row=${row} level=0 行底`);
    assert.equal(g.groundY(row, 0), g.groundTopY(row + 1, 0), '脚底 = 下一行行顶');
  }
  for (const level of [1, 3]) {
    assert.equal(g.groundY(5, level), 6 * TILE_PX - level * TILE_PX);
    assert.equal(g.groundTopY(5, level), 5 * TILE_PX - level * TILE_PX);
    assert.equal(g.groundY(0, level), TILE_PX - level * TILE_PX);
  }
});

test('actorDepth 锚在行号：level 只贡献 0.5 的亚像素，不跟着位置抬整格', async () => {
  const g = await ground();
  for (const row of [0, 5, 19]) {
    assert.equal(g.actorDepth(row, ALT, 0), ALT + (row + 1) * TILE_PX + 8);
  }
  for (const level of [1, 3]) {
    assert.equal(
      g.actorDepth(5, ALT, level),
      ALT + 6 * TILE_PX + 8 - level * 0.5,
      `level=${level} 的深度只能减 0.5/层`,
    );
  }
  // 反向：上层的人不能因为 depth 调整而翻到下一层人的后面。
  assert.ok(g.actorDepth(5, ALT, 3) < g.actorDepth(5, ALT, 0), '抬层必须略靠后');
  assert.ok(g.actorDepth(5, ALT, 3) > g.actorDepth(4, ALT, 0), '但翻不过一整格');
});

test('propFootAt / propDepthAt 逐字：落点跟位置抬，depth 只吃亚像素', async () => {
  const g = await ground();
  for (const row of [0, 3, 17]) {
    assert.equal(g.propFootAt(row, 0, 0), (row + 0.8) * TILE_PX);
    assert.equal(g.propDepthAt(row, ALT, 0, 0), ALT + (row + 0.8) * TILE_PX + 8);
  }
  assert.equal(g.propFootAt(3, 0, 1), (3 + 0.8) * TILE_PX - TILE_PX, '落点抬整格');
  assert.equal(g.propDepthAt(3, ALT, 0, 1), ALT + (3 + 0.8) * TILE_PX + 8 - 0.5, 'depth 只减 0.5');
  assert.equal(g.propFootAt(3, 32, 0), 32 + (3 + 0.8) * TILE_PX, 'originY 原样计入落点');
  assert.equal(g.propDepthAt(3, ALT, 32, 0), ALT + 32 + (3 + 0.8) * TILE_PX + 8);
});

test('既有导出全部收敛到 ground：不许再有第二套算术', async () => {
  const g = await ground();
  const villager = await import('../src/render/villager.ts');
  const prop = await import('../src/render/prop-depth.ts');
  const scenery = await import('../src/render/scenery-depth.ts');
  const building = await import('../src/render/building-depth.ts');

  assert.equal(villager.villagerFootAt({ x: 3, y: 7 }).y, g.groundY(7));
  assert.equal(villager.villagerFootAt({ x: 3, y: 7 }, 0, 0, 1).y, g.groundY(7, 1));

  const worldProp = {
    id: 'p',
    kind: 'tree',
    at: { x: 3, y: 7 },
    label: '树',
    sourceTaskKind: null,
    sourceTaskId: null,
    sourceSummary: null,
    grime: 0,
    reveal: null,
  } as Parameters<typeof prop.propFootY>[0];
  assert.equal(prop.propFootY(worldProp, 0), g.propFootAt(7, 0, 0));
  assert.equal(prop.propDepth(worldProp, 0, ALT), g.propDepthAt(7, ALT, 0, 0));
  assert.equal(prop.propDepth(worldProp, 0, ALT, 3), g.propDepthAt(7, ALT, 0, 3));

  assert.equal(scenery.sceneryFootY(7), g.groundTopY(7));
  assert.equal(scenery.sceneryDepth(7, ALT), ALT + g.groundTopY(7) + 12);
  assert.equal(scenery.actorDepthAtRow(7, ALT), g.actorDepth(7, ALT));
  assert.equal(scenery.actorDepthAtRow(7, ALT, 2), g.actorDepth(7, ALT, 2));

  assert.equal(building.actorDepthAt(7, ALT), g.actorDepth(7, ALT));
  assert.equal(building.actorDepthAt(7, ALT, 2), g.actorDepth(7, ALT, 2));
});

test('单一产出点：LEVEL_PX / DEPTH_LEVEL_EPS 只出现在 ground.ts，render 不读 levelAt', async () => {
  const files = walk(SRC).filter((path) => path.endsWith('.ts'));
  const owners = files.filter((path) => {
    const text = readFileSync(path, 'utf8');
    return text.includes('LEVEL_PX') || text.includes('DEPTH_LEVEL_EPS');
  });
  assert.deepEqual(
    owners.map((path) => relative(SRC, path).replaceAll('\\', '/')),
    ['render/ground.ts'],
    'level → 像素的换算只能写在 ground.ts；其它文件必须调用它，不能自己乘',
  );

  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const renderFiles = walk(join(SRC, 'render')).filter((path) => path.endsWith('.ts'));
  const offenders = renderFiles.filter((path) => stripComments(readFileSync(path, 'utf8')).includes('levelAt('));
  assert.deepEqual(
    offenders.map((path) => relative(SRC, path).replaceAll('\\', '/')),
    [],
    '渲染层不直接读 grid.levelAt：level 由场景算出后作为参数传进来',
  );
});
