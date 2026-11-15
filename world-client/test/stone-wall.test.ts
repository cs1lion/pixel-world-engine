/**
 * 花径矮石垣（设定集 p110–111 的「石垣」）：`stone_wall` 必须在闭集里、在包里、
 * 落在花床**北缘**、而且是一段**连续**的墙。
 *
 * 这一条钉四件事：
 *
 * 1. **闭集**：`stone_wall` 是合法构件，装载期不判「未知构件」；
 * 2. **落地**：都在花径口袋 `x2..11 × y19..27` 里，行号**只能是 y20**——那是
 *    两列花床（y21..24）的北缘。墙跑到别处，就不是「花床背后的挡土墙」；
 * 3. **连续**：x 上一段不带缺口。中间缺一格，1:1 下读成两截断墙，而不是一道墙
 *    上开了个门洞（真要门洞，得单独做一个门柱，不能靠漏摆件）；
 * 4. **回归**：认不出的 kind 仍然在装载期 throw——闭集是开了一格，不是拆了门。
 *
 * 动态 import 与 `fence.test.ts` 同理由：base 上没有 `stone_wall`，测试必须红在
 * **断言**上（`assert.fail`），不能变成 module / compile 错误。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

type SceneryItem = {
  readonly kind: string;
  readonly at: { readonly x: number; readonly y: number };
};
type RawPack = { readonly scenery: readonly SceneryItem[] };
type LoadModule = { readonly loadSettingPack?: (raw: RawPack) => RawPack };
type PackModule = { readonly DENGCHAO_RAW?: RawPack };

/** 花径口袋外框（含端点）。与 `flower-bed.test.ts` / `fence.test.ts` 同一个框。 */
const POCKET = { x0: 2, y0: 19, x1: 11, y1: 27 } as const;

/** 石垣所在的落地行：两列花床（y21..24）的北缘。 */
const WALL_ROW = 20;

test('花径：stone_wall 合法、在包里、只在花床北缘、且连续；未知 kind 仍 throw', async () => {
  const load = (await import('../src/settings/load.ts')) as unknown as LoadModule;
  const loadPack = load.loadSettingPack;
  if (loadPack === undefined) assert.fail('loadSettingPack 缺失');

  const packModule = (await import('../src/settings/dengchao/pack.ts')) as PackModule;
  const raw = packModule.DENGCHAO_RAW;
  if (raw === undefined) assert.fail('DENGCHAO_RAW 缺失');

  const walls = raw.scenery.filter((item) => item.kind === 'stone_wall');
  if (walls.length === 0) assert.fail('花径没有石垣：包里 stone_wall 为 0 件');
  assert.ok(
    walls.length >= 6,
    `石垣太短：${walls.length} 件——两列花床（x4..9）各占 2 格，墙至少要盖住它们`,
  );

  for (const wall of walls) {
    const inside = wall.at.x >= POCKET.x0 && wall.at.x <= POCKET.x1
      && wall.at.y >= POCKET.y0 && wall.at.y <= POCKET.y1;
    assert.ok(
      inside,
      `石垣越出口袋：(${wall.at.x}, ${wall.at.y}) 不在 x${POCKET.x0}..${POCKET.x1} × y${POCKET.y0}..${POCKET.y1}`,
    );
    assert.equal(
      wall.at.y,
      WALL_ROW,
      `石垣落在 y${wall.at.y}：只在花床北缘 y${WALL_ROW} 站得住——`
        + '南北向的墙在这套投影里只剩一条竖带（见 docs/evidence/fence/）',
    );
  }

  // 连续：排序后 x 必须逐格递增，不许断口。
  const xs = [...new Set(walls.map((wall) => wall.at.x))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i += 1) {
    assert.equal(
      xs[i] - xs[i - 1],
      1,
      `石垣在 x${xs[i - 1]} 与 x${xs[i]} 之间断了口：一段墙中间缺一格，1:1 下读成两截断墙`,
    );
  }

  // 覆盖两列花床：墙的两端都要够到花床外侧（x4..9），否则它只是某一列花床的靠背。
  assert.ok(xs[0] <= 4, `石垣西端只到 x${xs[0]}，没盖住西侧花床（x4..5）`);
  assert.ok(xs[xs.length - 1] >= 9, `石垣东端只到 x${xs[xs.length - 1]}，没盖住东侧花床（x8..9）`);

  // 跨度钉死：比花床左右各宽一格（x3..10，共 8 件）。只钉「连续 + 两端够到」
  // 的话，6 段（x4..9）或 10 段（x2..11）都能过，而前者不是「围起来的边界」、
  // 后者会压到北篱两侧的其它构件。
  assert.deepEqual(
    xs,
    [3, 4, 5, 6, 7, 8, 9, 10],
    `石垣跨度不是 x3..10：${xs.join('/')}`,
  );

  // 装载期校验：stone_wall 不被判「未知构件」。
  const loaded = loadPack(raw);
  assert.equal(
    loaded.scenery.filter((item) => item.kind === 'stone_wall').length,
    walls.length,
    '装载前后的石垣件数不一致',
  );

  // 回归：未知 kind 仍然 throw，口径是装载期的「未知构件」。
  const bogus: RawPack = { ...raw, scenery: [...raw.scenery, { kind: 'dry_moat', at: { x: 5, y: 20 } }] };
  assert.throws(() => loadPack(bogus), /未知构件 dry_moat/);
});
