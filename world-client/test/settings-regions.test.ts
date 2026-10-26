import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack, SettingPackError } from '../src/settings/load.ts';
import type { RawSettingPack } from '../src/settings/types.ts';

/**
 * 地域与分区在装载期的一条静默失败。
 *
 * 重叠**不是**错误：灯潮界的 `ferry ∩ shoal` 有 20×6 格、`bathhouse ∩ lampstreet`
 * 有 12×9 格，后声明的赢。这是有意的写法，`pack.ts` 里写明了理由——楼要盖在街上，
 * 所以楼后声明。所以不能拿「区域不许重叠」当规则，那会把现有的包整体拒掉。
 *
 * 真正的错是重叠吃掉了**一道门**：那道地域在数据里写着要凭证、世界也照实把
 * 「有这么一道门」报给模型和界面，但它的每一格都归了后来者，于是没有任何一格
 * 真的要求凭证。一道只在数据里存在的门比没有门更糟——提示词会告诉模型它在那儿。
 */

const raw = (patch: Partial<RawSettingPack>): RawSettingPack => ({ ...DENGCHAO_RAW, ...patch });

/** 一道要鞋的两格小门，声明在最后（重叠时它赢）。 */
const GATE = { id: 'deep', name: '深巷', x: 36, y: 30, w: 2, h: 2, requires: 'shoes' as const };

test('整道地域被后声明的区域盖住时拒：那道门会变成数据里的一行字', () => {
  // 声明在最前，于是灯街的每一格都盖在它上面。
  const buried = raw({ regions: [GATE, ...DENGCHAO_RAW.regions] });
  assert.throws(() => loadSettingPack(buried), SettingPackError, '这道门一格都不占，装载就该拒');
});

test('盖在后面的门是好的：重叠不过是一道更具体的地域压在更大的上面', () => {
  // 反方向钉住「拒得准」。声明在最后，它赢，那块地归它，门是真的。
  const wins = raw({ regions: [...DENGCHAO_RAW.regions, GATE] });
  const pack = loadSettingPack(wins);
  const world = buildSettingWorld(pack);
  assert.equal(world.grid.at({ x: 36, y: 30 })?.region, 'deep');
  assert.equal(world.grid.requirementAt({ x: 36, y: 30 }), 'shoes');
});

test('未知分区 id 拒：它让这张图上一栋楼也建不成，而世界照常开门', () => {
  // 蓝图的分区只能是那六个词。分区表里写了第七个词，于是每一格的分区都不是
  // 任何蓝图认的那个，`checkPlacement` 对整张图恒为 outOfZone——
  // `building.add` 在这张图上永远只会被拒，而世界一声不响地开着。
  const harbor = raw({
    grid: { ...DENGCHAO_RAW.grid, zones: [{ id: 'harbor' as never, x: 1, y: 1, w: 62, h: 46 }] },
    placements: [],
  });
  assert.throws(() => loadSettingPack(harbor), SettingPackError, 'harbor 不是六个分区之一');
});

test('灯潮界本身的重叠是有意的：渡口压在浅滩上、楼的轮廓伸进灯街，都原样通过', () => {
  // 前面那两条规则的对照组。加上「区域不许重叠」会把它拒掉，而它是错的规则。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  // 浅滩声明在渡口之后，所以两者交界那一块归浅滩；渡口留着下半截（y 14..17）。
  assert.equal(world.grid.at({ x: 10, y: 10 })?.region, 'shoal');
  assert.equal(world.grid.at({ x: 10, y: 15 })?.region, 'ferry');
  // 叠浪楼声明在灯街之后，所以楼那一片归它。
  assert.equal(world.grid.at({ x: 32, y: 22 })?.region, 'bathhouse');
  // 唯一那道门（叠浪楼要灯）仍然占着它的格子。
  assert.equal(world.grid.requirementAt({ x: 32, y: 22 }), 'lamp');
});
