/**
 * 雾团那一串渲染预算的数，得一直按得出来。
 *
 * `fog-view.ts` 的 `update` 里有一段长注释，讲为什么雾团用 8px 一块而不是 4px，
 * 中间一排数：「4px 时一团要 317～841 块」「14 团一共 7684 块 = 15368 条指令」
 * 「换 8px 是 1931 块 = 3862 条」「3.98 倍」「再加 11506 条」。这些数从前只能
 * 靠手按——`prose-numbers.ts` 至今还把 `fog-view.ts` 列在「没有任何测试 import 它」
 * 那一档，而它 import Phaser，Node 里跑不起来。
 *
 * 可这些数依赖的东西全是**纯的**：`fog-drift.ts` 不 import 任何东西（只 import 一个
 * 类型），`TILE_PX` 在 `setup.ts`。所以不需要把绘制逻辑搬出来，只需要把两个常量
 * （`PUFF_RADII_TILES`、`PUFF_CELL_PX`）从散落的位置提成命名导出，再把那段循环
 * 在这里照着写一遍。**照写**这件事本身要说清：它复制的是绘制循环的形状，
 * 不是它的实现——真的实现还在 `fog-view.ts`，改绘制方式而不同步这里，
 * 这条会红，而红的意思是回来改这里，不是把断言改松。
 *
 * 盖不住的那一块：`MAX_COMMANDS`（30000）与「烘焙后实测约 2 万」在
 * `scripts/check-render-budget.mjs`，那是个 Playwright 脚本、要开着 dev server 跑，
 * 不在 `npm test` 里。所以这里只核**雾团这一层**的账，整帧那条不归这儿管。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { codeOf } from './source-scan.ts';
import { DRIFT_PUFFS, PUFF_RADII_TILES } from '../src/world/fog-drift.ts';
import { TILE_PX } from '../src/world/setup.ts';

/**
 * `PUFF_CELL_PX` 住在 import Phaser 的 `fog-view.ts` 里，Node 里 import 不进来。
 * 所以扫源码读它——与 `ambience-view.test.ts` 同一道墙、同一个解法。
 * 注释已经由 `codeOf` 剔掉，所以上面那段解释性的长注释不会干扰。
 */
const RENDER_DIR = new URL('../src/render/', import.meta.url);
const PUFF_CELL_PX = Number(
  codeOf(new URL('fog-view.ts', RENDER_DIR)).match(/const PUFF_CELL_PX\s*=\s*(\d+)/)![1],
);

/** 与 `fog-view.ts` 的绘制循环同一个形状：按 `cell` 铺满一个圆，数多少块。 */
function blocksInCircle(radiusPx: number, cell: number): number {
  let n = 0;
  for (let dy = -radiusPx; dy <= radiusPx; dy += cell) {
    for (let dx = -radiusPx; dx <= radiusPx; dx += cell) {
      if (Math.hypot(dx, dy) / radiusPx > 1) continue;
      n += 1;
    }
  }
  return n;
}

/** 三类半径（像素）。注释里写的是 40 / 53 / 66——取整后的显示值。 */
const RADII_PX = PUFF_RADII_TILES.map((tiles) => tiles * TILE_PX);

/** 每一类半径在 14 团里各出现几次。 */
function countOf(radiusPx: number): number {
  let n = 0;
  for (let i = 0; i < DRIFT_PUFFS; i += 1) {
    if (RADII_PX[i % RADII_PX.length] === radiusPx) n += 1;
  }
  return n;
}

/** 某个 cell 下，雾团这一层一共多少块、多少条指令。 */
function tally(cell: number): { readonly blocks: number; readonly commands: number } {
  let blocks = 0;
  for (const radiusPx of RADII_PX) blocks += blocksInCircle(radiusPx, cell) * countOf(radiusPx);
  return { blocks, commands: blocks * 2 };
}

const AT_4 = tally(4);
const AT_8 = tally(8);

test('半径是 2.5 / 3.3 / 4.1 格，乘上图块正好是注释里那三个像素数', () => {
  assert.deepEqual(
    RADII_PX.map((r) => Math.round(r)),
    [40, 53, 66],
    '注释写「三类半径 40/53/66 px」——按不出来了，回去改那段注释',
  );
});

test('4px 下一团 317～841 块：三类各自多少，注释里那三个数是对的', () => {
  const per = RADII_PX.map((r) => blocksInCircle(r, 4));
  assert.deepEqual(per, [317, 547, 841], '注释写「一团要 317～841 块（三类各多少不一样）」');
});

test('8px 下一团 81～209 块', () => {
  const per = RADII_PX.map((r) => blocksInCircle(r, PUFF_CELL_PX));
  assert.deepEqual(per, [81, 138, 209], '注释写「换 8px 是 1931 块」——先看三类各自多少');
});

test('14 团：4px 是 7684 块 = 15368 条，8px 是 1931 块 = 3862 条', () => {
  assert.equal(AT_4.blocks, 7684, '注释写「14 团一共 7684 块」');
  assert.equal(AT_4.commands, 15368, '注释写「7684 块 = 15368 条指令」');
  assert.equal(AT_8.blocks, 1931, '注释写「换 8px 是 1931 块」');
  assert.equal(AT_8.commands, 3862, '注释写「1931 块 = 3862 条」');
  assert.equal(DRIFT_PUFFS, 14, '团数变了，上面四个数全变');
});

test('3.98 倍，不是「正好四分之一」——那句话的方向对，数不对', () => {
  const ratio = AT_4.commands / AT_8.commands;
  assert.ok(
    Math.abs(ratio - 3.98) < 0.005,
    `15368/3862 实为 ${ratio.toFixed(3)}，注释写的 3.98 失真了`,
  );
  // 「降到四分之一」要求比值 >= 4。3.98 差 0.5%——方向对，数不对。
  assert.ok(ratio < 4, '比值已经到 4 了，「不是整四分之一」这半句成了假话');
});

test('7684 / 4 该是 1921、实得 1931：三类各自除 4 方向不一致', () => {
  // 这一条钉的是注释里最容易被人当成「约等于」的那一句。它不是约等于：
  // 按团数加权后，4px 一共 7684 块、8px 一共 1931 块，而 1931×4 = 7724 ≠ 7684。
  // 逐类看方向：317/81 = 3.91（8px×4 更多）、547/138 = 3.96（更多）、
  // 841/209 = 4.02（更少）——两个往上、一个往下，所以整体既不等于 4 倍也不等于 1/4。
  const per4 = RADII_PX.map((r) => blocksInCircle(r, 4));
  const per8 = RADII_PX.map((r) => blocksInCircle(r, PUFF_CELL_PX));
  const weighted4 = per4.reduce((sum, n, i) => sum + n * countOf(RADII_PX[i]!), 0);
  const scaled8 = per8.reduce((sum, n, i) => sum + n * 4 * countOf(RADII_PX[i]!), 0);
  assert.equal(weighted4, 7684, '4px 加权合计');
  assert.equal(scaled8, 7724, '8px 各自乘 4 再加权合计');
  assert.notEqual(
    scaled8,
    weighted4,
    '8px×4 与 4px 现在相等了——注释里「方向还不一致」那半句成了假话',
  );
  assert.equal(Math.floor(weighted4 / 4), 1921, '7684/4 向下取整是 1921，注释里那个「该是」');
  // 逐类看方向：两个往上（4px 少于 8px×4）、一个往下。
  const dirs = per4.map((n, i) => Math.sign(n - per8[i]! * 4));
  assert.deepEqual(dirs, [-1, -1, 1], '注释写「两个往上取、一个往下」');
});

test('换回 4px 要再加 11506 条', () => {
  assert.equal(AT_4.commands - AT_8.commands, 11506, '注释写「15368−3862 = 11506」');
});

/**
 * 上面每一条都可能因为改一个常量而红。这里证明它们**真的会红**——
 * 拿假常量喂同一个 `tally`，看数是不是跟着变。
 *
 * 不改 `fog-view.ts` / `fog-drift.ts`：那两个文件一个 import Phaser、一个是
 * 渲染数据的源头，为了验证测试去改它们不值得。这里验的是「这些数由这两个常量
 * 决定」，而这一点用假常量就够。
 */
test('闸门不是空的：换个 cell、换个半径，上面的数全跟着动', () => {
  const bigger = tally(PUFF_CELL_PX * 2);
  assert.ok(bigger.blocks < AT_8.blocks, `cell 翻倍，块数该掉下来（实为 ${bigger.blocks}）`);

  // 半径整体加一格，块数该上去。**按团数加权**——不加权的话三类裸和只有
  // 几百，跟 1931 那个加权总数没法比，那是这道题自己的坑。
  const widePer = PUFF_RADII_TILES.map((t) => blocksInCircle((t + 1) * TILE_PX, PUFF_CELL_PX));
  const wideBlocks = widePer.reduce((sum, n, i) => sum + n * countOf(RADII_PX[i]!), 0);
  assert.ok(wideBlocks > AT_8.blocks, `半径整体加一格，块数该上去（实为 ${wideBlocks}）`);
});
