import type { RawSettingPack } from '../types.ts';

const prefab = (
  id: string,
  displayName: string,
  w: number,
  h: number,
  roof: string,
  silhouette: 'gable' | 'tower' | 'flat' = 'gable',
): unknown => ({
  id, displayName, zone: 'industry', footprint: { w, h }, clearMargin: 1,
  door: { x: Math.floor(w / 2), y: h },
  workSpots: [{ x: Math.floor(w / 2), y: Math.floor(h / 2) }],
  chimney: { x: w - 1.2, y: 0.4 }, accent: 'smoke', silhouette, boundTask: null,
  palette: { body: 'timber', roof, trim: 'trim', window: 'amber' },
});

/** 原创灯潮界的首张户外地图；所有坐标都是可审计的数据，不是随机布景。 */
export const DENGCHAO_RAW: RawSettingPack = {
  id: 'dengchao', name: '灯潮界', saveKey: 'dengchao.pixel-world.save.v1',
  palette: {
    // 24 个槽必须各占一个不同的色值：`grassLit` 早先与 `stone` 都填 `#52666a`，
    // 于是"草地受光面"这个槽在画面上根本不存在，而装载器以为 24 色都占着。
    // 这里给它一个真正比 grass 亮、又和苔(moss)/石(stone)拉得开的值。
    ink: '#111821', soil: '#202b35', grass: '#30454a', grassLit: '#4a6152',
    stone: '#52666a', plaza: '#7d8984', farm: '#3d5154', timber: '#7c4a40',
    timberDark: '#412d32', trim: '#dfbd7a', amber: '#f0a44b', skin: '#d5b28c',
    cloak: '#48727b', cloakDark: '#293f50', ember: '#bf5441', pale: '#d1d7bd',
    plaster: '#b9b294', terracotta: '#a4483d', copper: '#53736d', water: '#294f60',
    moss: '#47645c', deepShade: '#1b303b', warmLight: '#f4d596', charcoal: '#2c3439',
  },
  terrainColors: {
    grass: 'grass', stone: 'stone', plaza: 'plaza', farm: 'farm', tree: 'soil',
    // 浅滩底色**不能**等于水色：两者一样时，退潮露出的滩涂和满潮的水面在屏幕上
    // 是同一块蓝，潮汐就只剩下 HUD 上的一个数字。这里用湿滩的苔绿，
    // 水面叠上去才会真的变深、变蓝。
    //
    // 2026-10-30：从 `copper` 换成 `moss`。原来取 `copper` 有两个问题：
    //
    // 1. **它同时是 `shoal` 的主色**（§4.1）。`region-paint.ts` 拿 `palette[primary]`
    //    去盖 `terrainColors[terrain]`，两者同值 ⇒ 画了等于没画。实测 806 格里只有
    //    65 格（那 65 格压在 stone 上）看得见，其余 741 格的主色斑块全是空转。
    // 2. 换一个不撞主色的底色，得同时满足四个条件，24 色里只有 `moss` 全过
    //    （候选与读数见 `region-paint.ts` 那段「浅滩轨道那一处」）：
    //    - 对 `copper` 主色可辨（ΔE 6.15，过下限 6，但是在**画得出的那四道
    //      区域里最低的**：渡口 10.16、灯街 33.42、叠浪楼 52.96）
    //    - 色相离水色 35°（`moss` 163°、`water` 199°），叠水之后仍读得出「变深」
    //    - 不与任何其它地形底色撞 token
    //    - 不撞本区点缀色 `plaster`、不禁用色 `terracotta`
    //
    // `moss` 的语义也正：湿滩上长的苔。原本那个 `copper` 的注释说它「是湿沙的灰绿」，
    // 可 `copper` 在色板里的本义是铜绿**屋顶**，用它当滩涂本来就是借的。
    shallow: 'moss', mud: 'soil', coal: 'charcoal',
  },
  grid: {
    width: 64, height: 48, border: 1,
    zones: [
      { id: 'industry', x: 1, y: 1, w: 62, h: 46 },
      { id: 'street', x: 30, y: 14, w: 5, h: 32 },
    ],
  },
  terrain: [
    { x: 1, y: 1, w: 62, h: 14, terrain: 'shallow' },
    // 站台必须站在石砌码头上：直接压在浅滩上会读成"房子漂在水里"，也说不清人怎么上去。
    { x: 7, y: 9, w: 13, h: 6, terrain: 'stone' },
    { x: 1, y: 15, w: 62, h: 19, terrain: 'grass' },
    { x: 1, y: 34, w: 62, h: 13, terrain: 'coal' },
    { x: 28, y: 14, w: 9, h: 24, terrain: 'stone' },
    { x: 1, y: 28, w: 62, h: 4, terrain: 'plaza' },
    { x: 8, y: 15, w: 48, h: 4, terrain: 'stone' },
    // 叠浪楼门前的一道水口：涨潮灌满、退潮露出一线湿床，朱红桥横跨其上。
    { x: 28, y: 27, w: 9, h: 1, terrain: 'shallow' },
    { x: 28, y: 34, w: 9, h: 12, terrain: 'stone' },
    { x: 39, y: 35, w: 18, h: 8, terrain: 'mud' },
  ],
  // 三色槽位（主色/点缀/禁用）逐个照 `docs/SPEC_V2.md` §4.1 那张表抄，
  // 不自己推——那张表是用户 2026-10-25 确认过的。五个都在表里，一格不差。
  // 表里还有第六道「炉底层」（charcoal / ember / pale），这本设定集**没有**
  // 把它声明成地域：加了它就多一道区域，画面上多一片归属，那已经不是「不改变
  // 渲染结果」。缺的这一道记在案上，不在这儿补。
  regions: [
    { id: 'ferry', name: '渡口站台', x: 5, y: 8, w: 20, h: 10, primary: 'deepShade', accent: 'amber', forbidden: 'terracotta' },
    // 浅滩轨道是这本设定集的**呼吸段**（SPEC_V2 §4.7）：水面的轨道、孤站牌、
    // 倒影——紧张段之后的那一屏。这里不派活、不出急件，萤火与猫照常。
    //
    // 它压在渡口站台上头（后画的盖先画的），所以站台 200 格里只有 80 格还归自己：
    // y∈[14,17] 那四行。剩下 120 格（20×6）归浅滩轨道，于是那一片是呼吸段。
    // 这不是顺手排的——呼吸问的是「这一格属于哪道区域」，重叠处归后声明的那道。
    // `settings-regions.test.ts` 钉着这 120 格：重叠是允许的，一整道区域被吃得
    // 一格不剩才是装载期的错。
    { id: 'shoal', name: '浅滩轨道', x: 1, y: 1, w: 62, h: 13, breathing: true, primary: 'copper', accent: 'plaster', forbidden: 'terracotta' },
    { id: 'lampstreet', name: '灯街', x: 12, y: 19, w: 40, h: 15, primary: 'timber', accent: 'warmLight', forbidden: 'water' },
    { id: 'sootbank', name: '积尘滩', x: 37, y: 34, w: 23, h: 13, primary: 'soil', accent: 'moss', forbidden: 'amber' },
    // 叠浪楼**声明在灯街之后**，这不是随手排的：地域按声明顺序画上去，
    // 后画的盖先画的（`grid.ts` 那道循环）。灯街压着叠浪楼同一块地，
    // 叠浪楼写在前面时它里头一百来格归了灯街——给它上一道门，
    // 那一整片门会消失，只剩顶上两行，而且静悄悄。
    // 楼是具体的，街是通向它的，所以街先画、楼后画。
    //
    // 要的是灯：汐的第一个作息点「点亮楼前的长灯」就在这楼里，她兜里有灯；
    // 迷路人那个「在叠浪楼外等潮水退去」说的本来就是外头。门落在楼上，
    // 落在灯街就会把镇心 (32,29) 和两位居民的出生点一起关在门后。
    { id: 'bathhouse', name: '叠浪楼', x: 27, y: 17, w: 12, h: 11, requires: 'lamp', primary: 'terracotta', accent: 'trim', forbidden: 'grassLit' },
  ],
  prefabs: {
    wave_house: prefab('wave_house', '叠浪楼', 7, 6, 'terracotta', 'tower'),
    lamp_lodge: prefab('lamp_lodge', '迎灯舍', 5, 4, 'copper'),
    tea_stall: prefab('tea_stall', '潮声茶摊', 5, 4, 'terracotta', 'flat'),
    ferry_station: prefab('ferry_station', '旧渡口站台', 6, 4, 'copper', 'flat'),
    lamp_workshop: prefab('lamp_workshop', '补灯铺', 4, 4, 'terracotta'),
    boiler_annex: prefab('boiler_annex', '炉底入口', 4, 3, 'charcoal', 'flat'),
    // 候车亭是这张图上**唯一开局不落位**的模板，这不是遗漏。
    // 世界拒绝「同一种铺子建第二栋」，所以六个模板全落位之后，
    // 白名单里的 building.add 在这张图上永远只能被拒——那句话就成了
    // 摆设。留一个设定集里本来就有的构件（渡口站台的瓦片母题写着「候车亭」），
    // 让「建一座候车亭」在这张图上真的能建成。
    waiting_shelter: prefab('waiting_shelter', '候车亭', 4, 3, 'copper', 'flat'),
  },
  placements: [
    { prefabId: 'wave_house', at: { x: 28, y: 20 } },
    { prefabId: 'lamp_lodge', at: { x: 18, y: 22 } },
    { prefabId: 'tea_stall', at: { x: 40, y: 22 } },
    { prefabId: 'ferry_station', at: { x: 10, y: 10 } },
    { prefabId: 'lamp_workshop', at: { x: 43, y: 34 } },
    { prefabId: 'boiler_annex', at: { x: 29, y: 14 } },
  ],
  hub: { x: 32, y: 29 },
  // 露话池（SPEC_V2 §4.6 的清洗即还原）：每类摆件底下压着的那几句。
  // 它们是**设定集的话**，不是引擎的话——所以写在这儿，不写进 `grime.ts`。
  // 一件摆件落地时按「世界上已经有几件」取一句，于是同一个存档回放出同一句。
  //
  //  wash 才看得见：落下来的时候是脏的，话在脏底下。洗到干净，话才露出来。
  // 灯潮界一页写不完的旧事都搁在这儿——轨道、灯芯、被盐咬掉的幡。
  propReveals: {
    lamp: [
      '灯芯是退潮后从滩上拾回来的，拾它的那个人没再来过。',
      '这盏灯点过三次，前两次都是替别人点的。',
      '灯罩里那道缝补过的痕，是它第三次差点沉下去的地方。',
    ],
    tree: [
      '根须缠着一只鞋，鞋是干的。',
      '它长在祭坛边，可它记得的海在另一边。',
      '树底下埋过一张渡船的票，日期被潮气泡花了。',
    ],
    banner: [
      '幡上那行字被盐咬掉了，只剩一个「等」。',
      '这面旗是给退潮的人看的，涨潮时就没人记得它写过什么。',
      '旗杆是三段接起来的，接缝处还留着上一个人的名字。',
    ],
  },
  villagers: [
    { name: '迷路人', at: { x: 23, y: 29 }, style: { cloak: 'cloak', scarf: 'pale', lamp: false }, routine: [
      { x: 19, y: 15, label: '在旧站牌下认路', dwellMs: 6500 },
      { x: 24, y: 29, label: '沿着灯街找一盏认识的灯', dwellMs: 4800 },
      { x: 21, y: 7, label: '趁退潮看浅滩上的旧轨道', dwellMs: 6500, tide: 'low' },
      { x: 36, y: 29, label: '在叠浪楼外等潮水退去', dwellMs: 5000 },
    ] },
    { name: '汐', at: { x: 36, y: 29 }, style: { cloak: 'terracotta', scarf: 'trim', lamp: true }, routine: [
      { x: 32, y: 27, label: '点亮楼前的长灯', dwellMs: 5800 },
      { x: 19, y: 29, label: '在迎灯舍前照看来客', dwellMs: 5200 },
      { x: 39, y: 29, label: '满潮时收起滩边的灯', dwellMs: 4800, tide: 'high' },
      { x: 50, y: 42, label: '趁退潮拾回还能用的灯芯', dwellMs: 6000, tide: 'low' },
    ] },
  ],
  scenery: [
    // 叠浪楼门前的朱红桥：横跨楼前那道水口，潮水从桥下过。
    { kind: 'bridge', at: { x: 28, y: 27 }, length: 9 },
    // 浅滩轨道横贯整片浅滩，退潮时才完全露出来。
    { kind: 'track', at: { x: 2, y: 8 }, length: 60 },
    { kind: 'sign', at: { x: 19, y: 15 } },
    { kind: 'statue', at: { x: 26, y: 28 } },
    // 灯街的灯沿街两侧排，站在街边而不是草地深处：灯是街的，不是野地的。
    ...Array.from({ length: 10 }, (_, i) => ({
      kind: 'lantern' as const,
      at: { x: 15 + i * 4, y: i % 2 === 0 ? 27 : 32 },
    })),
    // 摊位与幌布补上设定集里「有人做买卖」的街面，不做成通栏招牌墙。
    { kind: 'stall', at: { x: 17, y: 26 } },
    { kind: 'stall', at: { x: 24, y: 33 } },
    { kind: 'stall', at: { x: 34, y: 26 } },
    { kind: 'banner', at: { x: 21, y: 27 } },
    { kind: 'banner', at: { x: 30, y: 33 } },
    { kind: 'banner', at: { x: 46, y: 27 } },
    // 积尘滩的废弃物堆只出现在滩上，不越到灯街。
    ...Array.from({ length: 7 }, (_, i) => ({
      kind: 'debris' as const,
      at: { x: 40 + i * 2, y: 41 + (i % 3) },
    })),
    { kind: 'steam', at: { x: 34, y: 18 } },
    { kind: 'steam', at: { x: 45, y: 37 } },
  ],
};
