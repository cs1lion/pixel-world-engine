/**
 * 花径（设定集 p110–111）：`flower_bed` 必须在闭集里、在包里、落在口袋格内。
 *
 * 这一条钉三件事：
 *
 * 1. **闭集**：`flower_bed` 是合法构件，装载期不判「未知构件」；
 * 2. **落地**：包里真的有花圃，而且都在 x3..9 × y19..25 这个灌木带围合的口袋里
 *    （跑到口袋外就不是花径，是散在草地上的红点）；
 * 3. **回归**：认不出的 kind 仍然在装载期 throw——闭集是开了一格，不是拆了门。
 *
 * 动态 import 是刻意的：base 上包里一件 `flower_bed` 都没有，测试必须红在
 * **断言**上（`assert.fail`），不能变成 module / compile（`red:first` 会把
 * `ERR_MODULE_NOT_FOUND` 记成 ERROR，不算红）。
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

/** 花径口袋外框（含端点）：三边 2 格树篱，中间 3 格宽小径。 */
const POCKET = { x0: 3, y0: 19, x1: 9, y1: 25 } as const;

test('花径：flower_bed 合法、在包里、在口袋格内；未知 kind 仍 throw', async () => {
  const load = (await import('../src/settings/load.ts')) as unknown as LoadModule;
  const loadPack = load.loadSettingPack;
  if (loadPack === undefined) assert.fail('loadSettingPack 缺失');

  const packModule = (await import('../src/settings/dengchao/pack.ts')) as PackModule;
  const raw = packModule.DENGCHAO_RAW;
  if (raw === undefined) assert.fail('DENGCHAO_RAW 缺失');

  const beds = raw.scenery.filter((item) => item.kind === 'flower_bed');
  if (beds.length === 0) assert.fail('花径没有花圃：包里 flower_bed 为 0 件');
  assert.ok(beds.length >= 4, `花圃太少：${beds.length} 件——两侧各三床才算一条小径`);

  for (const bed of beds) {
    const inside = bed.at.x >= POCKET.x0 && bed.at.x <= POCKET.x1
      && bed.at.y >= POCKET.y0 && bed.at.y <= POCKET.y1;
    assert.ok(
      inside,
      `花圃越出口袋：(${bed.at.x}, ${bed.at.y}) 不在 x${POCKET.x0}..${POCKET.x1} × y${POCKET.y0}..${POCKET.y1}`,
    );
  }

  // 装载期校验：flower_bed 不被判「未知构件」。
  const loaded = loadPack(raw);
  assert.equal(
    loaded.scenery.filter((item) => item.kind === 'flower_bed').length,
    beds.length,
    '装载前后的花圃件数不一致',
  );

  // 回归：未知 kind 仍然 throw，口径是装载期的「未知构件」。
  const bogus: RawPack = { ...raw, scenery: [...raw.scenery, { kind: 'park', at: { x: 5, y: 21 } }] };
  assert.throws(() => loadPack(bogus), /未知构件 park/);
});
