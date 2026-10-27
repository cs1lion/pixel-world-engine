import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectSetting } from '../src/settings/index.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';

/**
 * 区域的三色槽位（`docs/SPEC_V2.md` §4.1）：主色 / 点缀 / 禁用。
 *
 * 为什么单立一条：这三个值是**从规格表抄的**，不是从画面推的。抄就有抄错的
 * 可能，而抄错的表现是「设定集 B 长出一片不属于它的颜色」——等画面不对的
 * 时候，已经说不清是规格改了还是我抄错了。所以把规格表那份钉在这儿：
 * 改任何一个值，这条会红，逼人回去重读那份表。
 *
 * **类型已经保证的三件事，这里不写用例**——写了就是永远绿的摆设，而本仓的
 * 规矩是摆设比没有更糟（它让人以为有人看着）：
 *   - 三个槽位在不在：`SettingPack.regions` 里它们是必填，漏一个编译不过。
 *   - 值是不是 24 色的 token 名：类型是 `WorldColor`，写错编译不过。
 *   - 装载器 therefore 没有校验可做：原文那一层就是强类型的，没有「写错一个
 *     字母」的可能。这与 `propReveals` 那边正相反——那个刻意收成
 *     `Record<string, …>`，就是为了让错**有可能**写出来，装载期才拦得住。
 *
 * 所以这条只钉两类事：**值对不对**（与规格表逐格比）与**有没有漏声明**
 * （包里几道、表里几道）。
 */

/**
 * `docs/SPEC_V2.md` §4.1 那张表里，灯潮界**已经声明成地域**的五道：
 * 区域 id → [主色, 点缀, 禁用]。逐格抄自那张表。
 */
const DECLARED: Readonly<Record<string, readonly [string, string, string]>> = {
  ferry: ['deepShade', 'amber', 'terracotta'],
  lampstreet: ['timber', 'warmLight', 'water'],
  bathhouse: ['terracotta', 'trim', 'grassLit'],
  shoal: ['copper', 'plaster', 'terracotta'],
  sootbank: ['soil', 'moss', 'amber'],
};

/**
 * 表里有、而灯潮界**刻意没有**声明成地域的那一道。
 *
 * 不补的理由：加了它就多一道区域，画面上多一片归属，那就不是「不改变渲染
 * 结果」。规格表有六道、包里五道，这个差是账，不是漏洞。
 */
const NOT_DECLARED: Readonly<Record<string, readonly [string, string, string]>> = {
  boiler: ['charcoal', 'ember', 'pale'],
};

test('灯潮界的三色槽位与 SPEC_V2 §4.1 的表逐格一致', () => {
  for (const region of DENGCHAO_RAW.regions) {
    const want = DECLARED[region.id];
    assert.ok(
      want !== undefined,
      `${region.name}（${region.id}）不在这张表里——规格表没有它，就是抄错了对象`,
    );
    assert.deepEqual(
      [region.primary, region.accent, region.forbidden],
      [...want],
      `${region.name} 的三色与 SPEC_V2 §4.1 不一致：回去重读那张表，`
        + '抄错与规格改了在这里分不开，所以这条只负责「不一致就红」',
    );
  }
});

test('表里该声明的都声明了：少一道就是设定集缺一片', () => {
  // 反方向。只查 DECLARED——NOT_DECLARED 那道是刻意不声明的（见上）。
  assert.deepEqual(
    DENGCHAO_RAW.regions.map((region) => region.id).sort(),
    Object.keys(DECLARED).sort(),
    '灯潮界声明的地域与 SPEC_V2 §4.1 对不上',
  );
  // 账要对上：规格表六道 = 声明五道 + 刻意不声明一道。
  assert.equal(
    Object.keys(DECLARED).length + Object.keys(NOT_DECLARED).length,
    6,
    'SPEC_V2 §4.1 的表是六道区域——这个数变了，先去重读那份表',
  );
});

test('莞尔镇一道地域都没有——这不是遗漏，是它定不出另外两个色', () => {
  const legacy = selectSetting('');
  assert.deepEqual(legacy.regions, []);
  // 莞尔镇的四个分区只定得出**主色**：分区 → `terrainFor` → `TERRAIN_COLORS`
  // 一条链，`grid.ts` 里写着。点缀与禁用在现有画面上没有对应物。
  // 宁可不填，也不编两个数凑满三个槽——那是本仓最不许的那件事。
  // 哪天要给莞尔镇也加地域，三个槽位一个都不能少，编译器会盯着。
});
