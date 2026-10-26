/**
 * 莞尔镇走 buildLargeWorld，LEGACY_PACK 的 authored 是 false——它不经配置包编译器，
 * 于是 loadSettingPack 那几条铁律在默认世界这条路上一次都没跑过。
 *
 * 这个文件不假装把编译器整条搬过来：LEGACY_PACK 的 villagers/terrain/regions/
 * placements/scenery 都是空的，本就不能通过 loadSettingPack 的居民规则——它是运行时
 * 由 buildWorld 程序化生成的那个世界的**描述符 stub**。这里只守它确实携带的几项数据
 * 不变量，且都是编译器会查、而默认这条路没人查的部分：
 *
 *   - palette 与 WORLD 同源（引用相等，不是会漂移的副本），且 24 个槽齐全
 *   - 八种地形各自落到 24 色里的一个槽（TERRAIN_COLORS ⊆ WORLD）
 *   - 世界中心是整数格且落在地图内
 *
 * 改 palette-data.ts 时若让地形色偏离 24 色、或让中心落到非整数格，默认世界会静默
 * 出错——而这些正是这条绕过的路上原本没人验的。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectSetting } from '../src/settings/index.ts';
import { WORLD } from '../src/world/palette-data.ts';

const pack = selectSetting('');

test('默认世界的 palette 与 WORLD 同源，且 24 个槽一个都不少', () => {
  // 引用相等：index.ts 一旦改成 {...WORLD} 副本，这条就红——两份真相会悄悄分叉。
  assert.equal(pack.palette, WORLD, 'LEGACY_PACK.palette 应当直接引用 WORLD');
  // 少一个槽不会报错，只会让渲染层对那个 token 静默换色。
  assert.equal(Object.keys(pack.palette).length, 24, '24 个色板槽一个都不能少');
});

test('八种地形各自落到 24 色里的一个槽：TERRAIN_COLORS 是 WORLD 的子集', () => {
  const paletteValues = new Set(Object.values(pack.palette));
  const terrains = Object.keys(pack.terrainColors);
  // 数量守着「静默滞后」：将来真加了第 9 种地形，这条会红，逼你回来显式认领它，
  // 而不是继续只验早先那几种。
  assert.equal(terrains.length, 8, `应有 8 种地形配色，现有 ${terrains.length}`);
  for (const [terrain, color] of Object.entries(pack.terrainColors)) {
    assert.ok(
      paletteValues.has(color),
      `地形 ${terrain} 的色 ${color} 不在 24 色里——缺了不报缺省色，只会在画面上拿别的地形顶替`,
    );
  }
});

test('世界中心是整数格，且落在地图内', () => {
  const { hub, grid } = pack;
  assert.ok(
    Number.isInteger(hub.x) && Number.isInteger(hub.y),
    `世界中心 (${hub.x},${hub.y}) 必须是整数格——loadSettingPack 的 assertPoint 会拒非整数`,
  );
  assert.ok(
    hub.x >= 0 && hub.y >= 0 && hub.x < grid.width && hub.y < grid.height,
    `世界中心 (${hub.x},${hub.y}) 越出 ${grid.width}×${grid.height} 的地图`,
  );
});
