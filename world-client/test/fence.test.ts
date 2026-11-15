/**
 * 花径木栅（设定集 p110–111 的「夹道栅栏」）：`fence` 必须在闭集里、在包里、
 * 落在花床的南端面上。
 *
 * 这一条钉三件事：
 *
 * 1. **闭集**：`fence` 是合法构件，装载期不判「未知构件」；
 * 2. **落地**：包里真的有栅栏，而且都在花径口袋 `x2..11 × y19..27` 里，
 *    行号**只能是 y25**——那是两列花床（y21..24）的南端面。栅栏跑到别处，
 *    就不是「花床前的矮栏」，是草地上一段孤零零的木条；
 * 3. **回归**：认不出的 kind 仍然在装载期 throw——闭集是开了一格，不是拆了门。
 *
 * 动态 import 与 `flower-bed.test.ts` 同理由：base 上没有 `fence`，测试必须红在
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

/** 花径口袋外框（含端点）。与 `flower-bed.test.ts` 是同一个框，改一处要改两处。 */
const POCKET = { x0: 2, y0: 19, x1: 11, y1: 27 } as const;

/** 栅栏所在的落地行：两列花床（y21..24）的南端面。 */
const FENCE_ROW = 25;

test('花径：fence 合法、在包里、只在花床南端面；未知 kind 仍 throw', async () => {
  const load = (await import('../src/settings/load.ts')) as unknown as LoadModule;
  const loadPack = load.loadSettingPack;
  if (loadPack === undefined) assert.fail('loadSettingPack 缺失');

  const packModule = (await import('../src/settings/dengchao/pack.ts')) as PackModule;
  const raw = packModule.DENGCHAO_RAW;
  if (raw === undefined) assert.fail('DENGCHAO_RAW 缺失');

  const fences = raw.scenery.filter((item) => item.kind === 'fence');
  if (fences.length === 0) assert.fail('花径没有木栅：包里 fence 为 0 件');
  assert.ok(
    fences.length >= 4,
    `木栅太少：${fences.length} 件——两列花床各 2 格宽，一面至少两段`,
  );

  for (const fence of fences) {
    const inside = fence.at.x >= POCKET.x0 && fence.at.x <= POCKET.x1
      && fence.at.y >= POCKET.y0 && fence.at.y <= POCKET.y1;
    assert.ok(
      inside,
      `木栅越出口袋：(${fence.at.x}, ${fence.at.y}) 不在 x${POCKET.x0}..${POCKET.x1} × y${POCKET.y0}..${POCKET.y1}`,
    );
    assert.equal(
      fence.at.y,
      FENCE_ROW,
      `木栅落在 y${fence.at.y}：只在花床南端面 y${FENCE_ROW} 站得住，`
        + '南北向的长栏在 1:1 下读成「一根带节的木杆」（见 docs/evidence/fence/）',
    );
  }

  // 位置钉死：两列花床的南端面各 2 格（x4/5、x8/9），中央 x6/7 是穿行净空。
  // 只钉「两侧都有」不够——整排搬到 x6/7 也能过，而那就把入口堵上了；
  // 挪成 x5/9 各两条同样能过，但那不再是「花床的端面」。
  assert.deepEqual(
    fences.map((fence) => fence.at.x).sort((a, b) => a - b),
    [4, 5, 8, 9],
    `木栅落位不是 x4/5 + x8/9：${fences.map((fence) => fence.at.x).join('/')}`,
  );

  // 两列都要有：只有一列是画歪了，不是形制。
  const sides = new Set(fences.map((fence) => (fence.at.x < 6 ? 'west' : 'east')));
  assert.equal(sides.size, 2, `木栅只落在一列：${[...sides].join('/')}`);

  // 装载期校验：fence 不被判「未知构件」。
  const loaded = loadPack(raw);
  assert.equal(
    loaded.scenery.filter((item) => item.kind === 'fence').length,
    fences.length,
    '装载前后的木栅件数不一致',
  );

  // 回归：未知 kind 仍然 throw，口径是装载期的「未知构件」。
  const bogus: RawPack = { ...raw, scenery: [...raw.scenery, { kind: 'hedgerow', at: { x: 5, y: 25 } }] };
  assert.throws(() => loadPack(bogus), /未知构件 hedgerow/);
});
