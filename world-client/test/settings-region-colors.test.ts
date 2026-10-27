import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
 * **规格表现读，不在本文件里手抄一份。** 第一版是手抄的（一张 `DECLARED`
 * 表），于是「规格表改了」与「我抄错了」在输出上完全一样——都是本文件里的
 * 一个旧值，没有任何东西对着文档核。更要命的是末尾那句「六 = 五 + 一」：
 * 两个操作数都写在本文件里，那是一句**同义反复**，规格表加一行它也照绿。
 * 所以现在三个数三个出处：表来自文档，声明来自包，刻意不声明来自下面那张表。
 *
 * **类型与装载期能保证的，这里不写用例**——写了就是永远绿的摆设，而本仓的
 * 规矩是摆设比没有更糟（它让人以为有人看着）：
 *   - 三个槽位在不在：`SettingPack.regions` 里它们是必填，漏一个编译不过。
 *   - 值是不是 24 色的 token 名：类型只帮得了 TS 作者——`as never` 绕得过
 *     （本仓自己在 `settings.test.ts` 里就这么写 `requires: 'torch' as never`）。
 *     这一条**已经由装载期兜住**（`load.ts` 那个循环对着 `TOKENS` 查），
 *     用例在 `settings.test.ts` 的「三色槽位写错一个字母」。原来这里写着
 *     「写错编译不过、装载器没有校验可做」——两句都是假的，`as never` 与
 *     那条新校验各自否掉一句。
 *
 * 所以这条只钉两类事：**值与规格表逐格一致**，与**有没有漏声明**（包里几道、
 * 表里几道、刻意不声明几道）。
 */

const SPEC_V2 = readFileSync(new URL('../../docs/SPEC_V2.md', import.meta.url), 'utf8');

/**
 * `docs/SPEC_V2.md` §4.1 那张表：区域名 → [主色, 点缀, 禁用]。
 *
 * 两道判据，**每一道都单独承重**（变异量过，删哪一道「六道」那条都红）：
 *
 *   - **节边界**：到下一个 `###` 就停。删了它，§4.2 那张手册色映射表会跟着
 *     进来——那张表四列，行首是一个手册色名（夜青 / 潮灰蓝 / …），于是「六道
 *     区域」变成十三行，多出来的七行一道都不在包里，漏声明那条会以「少了七道」
 *     的面目红，指向完全错误的方向。
 *   - **第三格像 token 名**（`^[a-z][a-zA-Z]*$`）：它拦的是 §4.1 自己那张表的
 *     表头（第三格「主色」）与 `|---|` 分隔行（第三格「---」）。删了它 → 八行。
 *     按形状认、不按字面认：明天有人把「主色」改成「地面色」，解析器照旧。
 *
 * 第一版这里还有第三道 `cells.length < 7`，**量过是多余的**（变异实测：把它加回去、
 * 再删掉节边界，四条全绿——它替节边界干活，而节边界本来就在干），删了。留一道
 * 没有任何变异能触发的判据，比不留更糟——下一个人会以为它在干活。
 *
 * 上面那句「§4.2 的行已被两道各自拦下」是**假话**，2026-10-28 由子 agent 挑出来、
 * 我复量确认：删掉节边界时 §4.2 漏进来七行，而它们的第三格正好是
 * `water` / `copper` / `terracotta` / `amber` / `ink` / `charcoal` / `moss`——
 * **token 形状判据一道都拦不住**。拦 §4.2 的只有节边界；token 判据拦的是 §4.1
 * 自己的表头与分隔行。两道都承重，但承的不是同一份重量。
 */
function specRegionRows(): ReadonlyMap<string, readonly [string, string, string]> {
  const lines = SPEC_V2.split(/\r?\n/);
  const start = lines.findIndex((line) => /^### 4\.1(\s|$)/.test(line));
  assert.ok(start >= 0, 'docs/SPEC_V2.md 里找不到 §4.1 这一节——先回去看它还在不在，别改这条断言');
  const rows = new Map<string, readonly [string, string, string]>();
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s/.test(line)) break;
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim().replace(/`/g, ''));
    if (!/^[a-z][a-zA-Z]*$/.test(cells[3] ?? '')) continue;
    rows.set(cells[1], [cells[3], cells[4], cells[5]]);
  }
  return rows;
}

const SPEC = specRegionRows();

/**
 * 表里有、而灯潮界**刻意没有**声明成地域的那几道：名字 → 为什么不补。
 *
 * 不补的理由：加了它就多一道区域，画面上多一片归属，那就不是「不改变渲染
 * 结果」。规格表有六道、包里五道，这个差是账，不是漏洞。
 *
 * **这里只放刻意不补的。** 漏声明那条测试拿「表的总数」减「包里的数」对账，
 * 所以任何一道不在包里、又没登记在这儿的区域都会红——那时要么补进包，
 * 要么来这儿登记理由，没有第三条路。
 */
const NOT_DECLARED: Readonly<Record<string, string>> = {
  炉底层: '加了它就多一道区域、画面上多一片归属，那就不是「不改变渲染结果」',
};

/**
 * 闸门不能是空的：解析器一个行都没读出来时，后面每一条都会「因为集合相等
 * 而绿」——包里的区域与空表的差集正好也是空。所以第一条先问解析器本身。
 *
 * 「六道」是对**文档**的一个断言：规格表增删区域时这里红，逼人回去重读
 * §4.1，而不是让一个新区域安静地流进「包里没有、表里也没有」的缝里。
 */
test('规格表 §4.1 解析得出六道区域，每道三个色', () => {
  assert.equal(SPEC.size, 6, `§4.1 的表解析出 ${SPEC.size} 道——文档改了，或解析器认不出这张表了`);
  for (const [name, colors] of SPEC) {
    assert.equal(colors.length, 3, `${name} 那一行不是三列色`);
    for (const color of colors) {
      assert.match(String(color), /^[a-z][a-zA-Z]*$/, `${name} 的色 ${String(color)} 不像 token 名`);
    }
  }
});

test('灯潮界的三色槽位与 SPEC_V2 §4.1 的表逐格一致', () => {
  for (const region of DENGCHAO_RAW.regions) {
    const want = SPEC.get(region.name);
    assert.ok(
      want !== undefined,
      `${region.name}（${region.id}）不在 §4.1 那张表里——规格表没有它，就是抄错了对象`,
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
  // 反方向。包里有的每一道都得上账：要么在表里，要么登记在 NOT_DECLARED。
  const declared = DENGCHAO_RAW.regions.map((region) => region.name).sort();
  assert.deepEqual(
    declared,
    [...SPEC.keys()].filter((name) => !(name in NOT_DECLARED)).sort(),
    '灯潮界声明的地域与 SPEC_V2 §4.1 减去刻意不声明的那些，对不上',
  );
  // 账要对上：表的总数 = 包里声明的 + 刻意不声明的。
  // 三个数三个出处——表来自文档、声明来自包、不声明来自上面那张表。
  // 第一版这句是 `DECLARED.length + NOT_DECLARED.length === 6`，两个操作数
  // 都在本文件里，规格表加一行也照绿；现在左边的 6 是解析出来的。
  assert.equal(
    declared.length + Object.keys(NOT_DECLARED).length,
    SPEC.size,
    '§4.1 的表与「包里声明的 + 刻意不声明的」对不上——有新区域，或有人删了一道',
  );
  // 登记表里的每一道都真的在表里：登记一个表里没有的名字，等于把账做平。
  for (const name of Object.keys(NOT_DECLARED)) {
    assert.ok(SPEC.has(name), `${name} 登记为「刻意不声明」，可 §4.1 那张表里没有它`);
  }
});

test('莞尔镇一道地域都没有——这不是遗漏，是它定不出另外两个色', () => {
  const legacy = selectSetting('');
  assert.deepEqual(legacy.regions, []);
  // 莞尔镇的四个分区只定得出**主色**：分区 → `terrainFor` → `TERRAIN_COLORS`
  // 一条链，`grid.ts` 里写着。点缀与禁用在现有画面上没有对应物。
  // 宁可不填，也不编两个数凑满三个槽——那是本仓最不许的那件事。
  // 哪天要给莞尔镇也加地域，三个槽位一个都不能少，编译器会盯着。
});
