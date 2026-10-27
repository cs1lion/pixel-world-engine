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

/**
 * 这一串小门小院的三色槽位。
 *
 * `c9d574d` 起三个槽必填，而本文件每一条测的都是「被整片盖住」「盖在后面赢」，
 * **一条都不断言颜色**。所以这里统一借渡口站台那一组（`docs/SPEC_V2.md` §4.1
 * 那张表的第一行），不为别的——借一处说得出处的，比六处各编三个好看，也比
 * 六处各抄一行的维护面小。
 *
 * 别再手抄这三个数：本文件原来有六处字面量各写各的，其中五处**干脆没写**，
 * 于是 `c9d574d` 把槽位改必填的那一笔留下 11 处编译错（全是这个文件的）。
 */
const FIXTURE_COLORS = {
  primary: 'deepShade', accent: 'amber', forbidden: 'terracotta',
} as const;

/** 一道要鞋的两格小门，声明在最后（重叠时它赢）。 */
const GATE = {
  id: 'deep', name: '深巷', x: 36, y: 30, w: 2, h: 2, requires: 'shoes' as const,
  ...FIXTURE_COLORS,
};

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

// ------------------------------------- 同一个病，从地域挪到分区与模板上

test('模板写进一个不存在的分区就拒：它一个落点也没有，一辈子建不出来', () => {
  // 分区的归属是**先声明者赢**（`grid.ts` 的 `zoneAt`），与地域的「后声明者赢」
  // 正好相反。所以在分区表里把一条窄巷写在一整块工坊区后面，它就一格也占不到。
  // 分区表自己死一格不致命；**蓝图**写进那个不存在的分区才致命：
  // `checkPlacement` 逐格比 `zoneOf`，对整张图恒为 `outOfZone`——
  // 探针数过全图 3072 个落点，0 个成功，2494 个 outOfZone、578 个 edge。
  // 界面照样给它按钮、提示词照样告诉模型这个名字能建，回执只有「没地方」。
  const school = raw({
    prefabs: {
      ...DENGCHAO_RAW.prefabs,
      night_school: {
        ...(DENGCHAO_RAW.prefabs.wave_house as object),
        id: 'night_school', displayName: '夜学堂', zone: 'scholarly',
      },
    },
    placements: [],
  });
  assert.throws(() => loadSettingPack(school as RawSettingPack), SettingPackError, 'scholarly 一格都没有');
});

test('一根一根数：分区表里那条被盖住的窄巷，确实一格也不占', () => {
  // 这条揭的是**数据本身**的一个事实，不是规则的假设：灯潮界的 `grid.zones`
  // 里写着 `street: x 30–34, y 14–45`（160 格），可 `industry`（x 1–62、y 1–46）
  // 声明在它前面、先声明的赢，于是 street 实占 0 格。
  //
  // 它今天不致命（六个模板全是 industry），但它是一句读起来像街、实际是死字的
  // 声明——把 `street` 挪到 `industry` 前面，六栋楼会全部因为落位不合法被拒。
  // 所以这条测试不要求它「有格子」，而是把「它现在没有」这件事写下来：
  // 谁哪天想靠这条巷子做点什么，测试会先告诉他那条巷子不存在。
  const world = buildSettingWorld(loadSettingPack(DENGCHAO_RAW));
  const owned = new Map<string, number>();
  for (let y = 0; y < DENGCHAO_RAW.grid.height; y += 1) {
    for (let x = 0; x < DENGCHAO_RAW.grid.width; x += 1) {
      const zone = world.grid.zoneOf({ x, y });
      owned.set(zone, (owned.get(zone) ?? 0) + 1);
    }
  }
  assert.equal(owned.get('street') ?? 0, 0, 'street 声明了 160 格，实占 0 格——先声明者赢');
  assert.ok((owned.get('industry') ?? 0) > 0);
});

test('呼吸段被整片盖住也拒：留白是绕着格子算的，一格不占就是整条链空转', () => {
  // 上一笔只查了 `requires`，漏了同一个结构的另一半。`breathing` 的留白
  // 走的是另一条链（`breathingAt` → 不派活、不出急件），可它同样按**格子**
  // 算：`breathingRegions()` 从 id 表里报，`breathingAt()` 从格子上的 region 查。
  // 两者不一致时，报告说「这片是留白」，而没有一格真的在呼吸——探针验过，
  // 一个被整片盖住的呼吸段仍然出现在 `breathingRegions()` 里。
  const INNER = { id: 'inner_court', name: '里院', x: 20, y: 24, w: 3, h: 3, breathing: true, ...FIXTURE_COLORS };
  // 声明在最前：后面每一道区域都盖在它上面，那 9 格一格也不归它。
  const buried = raw({ regions: [INNER, ...DENGCHAO_RAW.regions] });
  assert.throws(() => loadSettingPack(buried), SettingPackError, '里院的 9 格全被灯街盖住了');
});

test('一道地域同时要凭证又呼吸：两句话都成立就都查', () => {
  // 两个槽位是独立的（`types.ts` 里写了）。上面那条只覆盖单个说法，
  // 这条钉住「加起来查」——一道门加留白被盖住时，报错要把两句都说出来，
  // 而不是只挑一句。
  const BOTH = { id: 'inner_court', name: '里院', x: 20, y: 24, w: 3, h: 3, requires: 'lamp' as const, breathing: true, ...FIXTURE_COLORS };
  const buried = raw({ regions: [BOTH, ...DENGCHAO_RAW.regions] });
  assert.throws(
    () => loadSettingPack(buried),
    (error: Error) => error instanceof SettingPackError && error.message.includes('要 lamp') && error.message.includes('是呼吸段'),
    '两个说法都得出现在报错里',
  );
});

test('盖在后面的呼吸段是好的：重叠本身不是错，只有整片被吃掉才是', () => {
  // 与前面那道门的对照组同一个意思。声明在最后，它赢，那 9 格真归它。
  const INNER = { id: 'inner_court', name: '里院', x: 20, y: 24, w: 3, h: 3, breathing: true, ...FIXTURE_COLORS };
  const wins = raw({ regions: [...DENGCHAO_RAW.regions, INNER] });
  const world = buildSettingWorld(loadSettingPack(wins));
  assert.equal(world.grid.at({ x: 20, y: 24 })?.region, 'inner_court');
  assert.equal(world.grid.breathingAt({ x: 20, y: 24 }), true);
});

// ---------------------------------------------- 灯潮界的呼吸段落在哪几格

test('浅滩轨道真的在呼吸：806 格，一格不多一格不少', () => {
  // 上面几条守的是「被吃掉的道/留白要拒」，没有一条断言**这本设定集自己**
  // 到底哪儿在呼吸。缺了它，`pack.ts` 把坐标写歪、或者后来一道区域悄悄
  // 压到浅滩上，测试全绿而世界一次都不安静——那个坑是静默的。
  //
  // 806 是 `pack.ts` 里声明的那个矩形自己算出来的：浅滩轨道 x∈[1,63)、
  // y∈[1,14)，即 62×13。没有任何别的区域与它相交（灯街 y≥19、积尘滩 y≥34、
  // 叠浪楼 y≥17），所以声明多少格就真的是多少格。
  const world = buildSettingWorld(loadSettingPack(DENGCHAO_RAW));
  let breathing = 0;
  for (let y = 0; y < world.grid.height; y += 1) {
    for (let x = 0; x < world.grid.width; x += 1) {
      if (world.grid.breathingAt({ x, y })) breathing += 1;
    }
  }
  assert.equal(breathing, 806, '浅滩轨道 62×13：写歪一个坐标这里就红');
});

test('渡口站台 200 格里 120 格归了浅滩轨道，只剩 y∈[14,17] 四行', () => {
  // 重叠是有意的（楼盖在街上，所以楼后声明），这里把**账**算清：
  // 站台 x∈[5,25)、y∈[8,18)，浅滩轨道 y<14，所以 y∈[8,14) 那 20×6 格
  // 归浅滩轨道。`pack.ts` 的注释与这条断言说的是同一笔账，改一处得改另一处。
  const world = buildSettingWorld(loadSettingPack(DENGCHAO_RAW));
  assert.equal(world.grid.at({ x: 10, y: 10 })?.region, 'shoal', '站台里头归浅滩轨道');
  assert.equal(world.grid.at({ x: 10, y: 16 })?.region, 'ferry', '站台沿子那四行还归自己');
  assert.equal(world.grid.at({ x: 10, y: 13 })?.region, 'shoal', 'y=13 是浅滩的最后一行');
  assert.equal(world.grid.at({ x: 10, y: 14 })?.region, 'ferry', 'y=14 起归站台');
  // 门落在楼里那半格算楼，落在留白那半格不算——这是呼吸段与区界要求
  // 两个槽位互不干涉的一处实证：bathhouse 要一盏灯，可它一格都不呼吸。
  assert.equal(world.grid.breathingAt({ x: 32, y: 27 }), false, '叠浪楼不呼吸');
  assert.equal(world.grid.requirementAt({ x: 32, y: 27 }), 'lamp', '但它要一盏灯');
});

test('旧渡口站台整栋落在呼吸段里，而它一本活都不接：没有活被困在留白', () => {
  // 这条看着像在给一个巧合背书，其实是在钉一个**前提**：哪本设定集给铺子
  // 写了 `boundTask` 又把它放进呼吸段，那类活就永远派不出去了——铺子在留白里，
  // 站在铺子门口的人也在留白里。灯潮界六栋模板的 `boundTask` 全是 null，
  // 所以这个前提现在成立。改坏了这里会红，而不是让一类活静静消失。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  const station = world.buildings.find((b) => b.prefabId === 'ferry_station');
  assert.ok(station !== undefined, '开局六栋模板各就各位');
  assert.equal(world.grid.breathingAt(station.origin), true, '站台落在浅滩轨道里');
  for (const building of world.buildings) {
    assert.equal(building.boundTask, null, `${building.prefabId} 不接活，所以没有活会被派进留白`);
  }
});

test('没有居民出生在呼吸段里：开局谁也躺不得', () => {
  // 出生点与镇心都在留白外头，所以「站在留白里的人」只能是**走着走着路过**的，
  // 而路过的人下一拍就被作息带走。这一条防的是把出生点写进浅滩轨道——
  // 那不会报错，只会让那个人在开局那一刻接不到任何活。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  for (const villager of pack.villagers) {
    assert.equal(
      world.grid.breathingAt(villager.at),
      false,
      `${villager.name} 不该出生在呼吸段里`,
    );
  }
  assert.equal(world.grid.breathingAt(pack.hub), false, '镇心不在呼吸段里');
});

/**
 * 到这里结束。**上面那三条「被盖住 / 两句都拒 / 盖在后面赢」各只有一份。**
 *
 * 本文件原来在末尾还有第二份：`d41cfed`（一笔 UI 文案的提交）往这个文件追加了
 * 94 行，其中三条与 `862c304` 已经加过的**逐字相同**，只少了注释、并把断言里的
 * 「是留白」按 `56290bc` 的改名写成了「是呼吸段」。两个会话各写了一遍同一批
 * 用例，谁都没发现对方已经提交了。已删，这里留一句记号——同名的用例再来一遍时，
 * 先 `git log -p` 看看是不是又撞了。
 */
