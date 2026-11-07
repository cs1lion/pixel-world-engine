import type { RawSettingPack } from '../types.ts';
import type { VillagerArchive } from '../../world/villager-archive.ts';
import { lampStreetScenery } from './lamp-street.ts';
import { sceneArtbookScenery } from './scene-artbook.ts';

/** 设定集页码与造型事实：只在这份包数据里引用原片角色名。 */
export interface CastArtbookRef {
  /** PDF 扫描件页码（从 1 起）。 */
  readonly pdfPages: readonly number[];
  /** 书页页脚印的页码。 */
  readonly bookPages: readonly string[];
  /** 设定集里确认过的造型事实。 */
  readonly notes: readonly string[];
}

export const DENGCHAO_CAST_ARTBOOK: Readonly<Record<string, CastArtbookRef>> = {
  迷路人: {
    pdfPages: [42, 44, 59],
    bookPages: ['82–83', '86–87', '116–117'],
    notes: ['棕色马尾与齐刘海', '朱红工作和服 + 白色前襟/束带', '深蓝短裤、赤脚、提水桶'],
  },
  汐: {
    pdfPages: [42, 43],
    bookPages: ['82–83', '84–85'],
    notes: ['深色齐颌短发、平直刘海', '白/浅青长袍，腰间一道蓝色束带', '长袍下摆逐级外扩、盖住赤脚（书页 84–85 的垂坠）'],
  },
  炉匠: {
    pdfPages: [48],
    bookPages: ['94–95'],
    notes: ['秃顶、两鬓白毛、长白须', '圆框眼镜', '深紫/灰紫长袍，六条手臂撑宽上身，袍摆直下收成围裙'],
  },
  沉灯夫人: {
    pdfPages: [53],
    bookPages: ['104–105'],
    notes: ['极高的白发髻、大鼻、深眼窝', '深蓝长裙，披风在肩背最宽、向下收到脚踝', '金耳饰/金色束带，矮而宽'],
  },
  灯笼头: {
    pdfPages: [58],
    bookPages: ['114–115'],
    notes: ['高领/兜帽在上，黑色/半透明长袍窄到及地（不画脚）', '白色面具、紫黑眼口', '细手臂，无脸'],
  },
};

export const DENGCHAO_CAST_ARCHIVES = {
  迷路人: {
    aliases: ['找路的女孩', '少女'],
    identity: '外来者，不隶属灯潮界任何一铺',
    generation: '约十岁，初来者',
    origin: '从海那边搭末班渡船，在浅滩旧轨道尽头搁浅；攥着写有自己名字的名牌走进灯街，回程船已经走了。',
    cares: ['找回自己的名字', '赶上回渡口的末班船'],
    taboos: ['别人替她答名', '别人替她点灯'],
    routine: '06:30 旧站牌下认潮痕；09:00 沿灯街找一盏认识的灯；退潮时 14:00 去浅滩看旧轨道；17:30 回叠浪楼外等潮。',
    voice: '短句，先问“这条路通到哪儿”。',
    bonds: [
      { to: '汐', trust: 0.35, warmth: 0.4, debt: 0, familiarity: 0.45 },
      { to: '炉匠', trust: 0.2, warmth: 0.3, debt: 0.1, familiarity: 0.3 },
    ],
  },
  汐: {
    aliases: ['白衣渡守', '白衣少年'],
    identity: '渡守，隶属渡口站台与迎灯舍',
    generation: '少年，约十二岁',
    origin: '在浅滩轨道尽头的雾里被渡口老人拾起；名牌被潮水泡烂，只记得醒来时手里有一盏没点的灯。',
    cares: ['灯芯够不够', '来客手里有没有灯'],
    taboos: ['满潮时提他醒来前的雾', '问他真名'],
    routine: '05:30 点亮楼前长灯；08:00 迎灯舍前照看来客；满潮时 11:00 收滩边灯；退潮时 15:00 拾还能用的灯芯。',
    voice: '轻声，先报潮位再说话。',
    bonds: [
      { to: '迷路人', trust: 0.3, warmth: 0.35, debt: 0, familiarity: 0.45 },
      { to: '沉灯夫人', trust: 0.25, warmth: 0.1, debt: 0.15, familiarity: 0.5 },
    ],
  },
  炉匠: {
    aliases: ['锅炉房老人', '炉边老人'],
    identity: '炉匠铺炉工，隶属叠浪楼炉底入口',
    generation: '老年，炉边辈分最高',
    origin: '年轻时是积尘滩废船上的烧炭工；船拆了以后被沉灯夫人收进炉底，从此没离开过炉火。',
    cares: ['炉火不能断', '六只手仍不够用'],
    taboos: ['碰他的饭盒', '说他老'],
    routine: '06:00 炉匠铺门口抖灰；09:30 镇心石边歇脚；13:00 炉底入口搬炭；18:00 街边喝一碗热的。',
    voice: '粗声，三句不离火和灰。',
    bonds: [
      { to: '迷路人', trust: 0.25, warmth: 0.35, debt: -0.1, familiarity: 0.3 },
      { to: '灯笼头', trust: 0.15, warmth: -0.1, debt: 0, familiarity: 0.4 },
    ],
  },
  沉灯夫人: {
    aliases: ['掌柜', '沉灯的人'],
    identity: '叠浪楼掌柜，掌灯潮旧例',
    generation: '老年，镇上辈分最长者之一',
    origin: '灯潮界第一次涨潮那年，她从叠浪楼顶层下来，用一盏沉灯镇住倒灌的潮水；此后守着镇心石。',
    cares: ['沉灯仪式不能断', '旧潮的故事有人听'],
    taboos: ['问她欠了谁', '提她的真名'],
    routine: '07:00 镇心石边沉灯；10:00 镇心石边讲那年的潮；14:00 沿街巡灯；17:00 茶摊前坐一会儿。',
    voice: '慢，先讲旧例，再给结论。',
    bonds: [
      { to: '汐', trust: 0.4, warmth: 0.2, debt: 0, familiarity: 0.55 },
      { to: '灯笼头', trust: 0.2, warmth: -0.05, debt: -0.1, familiarity: 0.5 },
    ],
  },
  灯笼头: {
    aliases: ['无面者', '点灯人'],
    identity: '点灯人，隶属灯街与迎灯舍',
    generation: '中年，无名辈',
    origin: '灯街第一盏灯亮起时他就在灯下；脸上没有五官，只有一张借来的白面具，没人记得他何时来。',
    cares: ['灯桩数目对不上', '有人替他数灯'],
    taboos: ['叫他“无面”', '拿灯照他的脸'],
    routine: '05:00 镇心把街灯一盏盏点亮；08:30 迎灯舍前数新到的灯罩；退潮时 13:30 去浅滩点数旧灯桩；18:30 滩边挑还能补的灯壳。',
    voice: '不答话，只敲三下灯杆。',
    bonds: [
      { to: '炉匠', trust: 0.2, warmth: 0.2, debt: 0, familiarity: 0.4 },
      { to: '沉灯夫人', trust: 0.3, warmth: 0, debt: 0.1, familiarity: 0.5 },
    ],
  },
} satisfies Readonly<Record<string, VillagerArchive>>;

/**
 * 一栋楼的模板。`accent` 与 `boundTask` **必须成对**，这是 `blueprints.ts`
 * 那三条配对的同一条规则在设定集这一侧的写法：`code` ⇒ `smoke`、
 * `research` ⇒ `pages`、`writing` ⇒ `ink`。写错装载期当场拒（`parseBlueprint`
 * 的「代码活必须冒烟」那三条），不会带着一栋冒错烟的楼开工。
 *
 * 三种 accent 在 `render/smoke.ts` 的 `TEXTURE_KEYS` 里都实现了，所以楼接活
 * 这件事**不需要改渲染层**——三栋新楼只是数据。
 */
const prefab = (
  id: string,
  displayName: string,
  w: number,
  h: number,
  roof: string,
  silhouette: 'gable' | 'tower' | 'flat' = 'gable',
  accent: 'smoke' | 'pages' | 'ink' = 'smoke',
  boundTask: 'code' | 'research' | 'writing' | null = null,
): unknown => ({
  id, displayName, zone: 'industry', footprint: { w, h }, clearMargin: 1,
  door: { x: Math.floor(w / 2), y: h },
  workSpots: [{ x: Math.floor(w / 2), y: Math.floor(h / 2) }],
  chimney: { x: w - 1.2, y: 0.4 }, accent, silhouette, boundTask,
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
  // 岸线带（v3：构件化、跨 2–3 格，见 docs/P1_SHORE_BAND_DESIGN.md §6）：
  // 24px 基值 = 3 段 × 8px，沿法线跨 2 格落地，末段按 hash2 逐格错位 0/4/8/12px，
  // 总宽 24–36px。每组三档都是实色平铺，不叠 alpha。
  //
  // **石板段与草岸段是两组独立三档，不是一个 token 通吃**：`plaza` 是铺装色，
  // 铺在草岸上会把岸读成码头/硬边（材质词义不对，不是看不见）。所以 stone 用
  // `soil→farm→plaza`（`farm→plaza` 正午 23.0 / 22.21），grass 用
  // `soil→farm→copper`（`farm→copper` 正午 13.0 / 13.06）。读数与穷举见 §6.5。
  // 两组都用直岸（inset 0）：灯潮界行 15 的岸线是全格宽的北侧边，直岸段沿水线的
  // 覆盖宽度是整格 16px，段与段之间不留缝。
  //
  // `staggerStep` 取 0（湿端）：错位加宽放在贴水的那一段，末段固定 8px。v3 的初版
  // 把错位加在末段，正午 4× 下 `farm→plaza` 那一段被撑到 16~20px，读成一块亮板
  // （不是「读成带」，是亮面太大），所以按 §6.5 的退回方案把加宽挪到湿端。
  //
  // `maxTruncatedPx` 是 0：截断必须当场失败，不许悄悄少画一段——24px 带的三格
  // （行 15/16/17）在灯潮界都是陆格。
  // `maxOverlapPx` 不是 0：灯潮界有 4 个拐角格（(7,9) 北+西 / (19,9) 北+东 /
  // (28,14) 北+西 / (36,14) 北+东），北带与竖带必然在同一格的 `[d, d)²` 内相交，
  // 裁掉的重叠是拐角结构而不是缺陷。石材段实测 2656 px（草岸段不在拐角，0），
  // 这里写死实测基线当**回归棘轮**：重叠涨上去就抛，而不是放宽到某个安全大数。
  // 它是棘轮、不是合格线——只保证不许变大，不代表 2656 可接受（见设计稿 §6.4）。
  shore: [
    {
      land: ['stone'],
      style: 'straight',
      depthPx: 24,
      staggerPx: 4,
      staggerLevels: 4,
      staggerStep: 0,
      maxTruncatedPx: 0,
      maxOverlapPx: 2656,
      steps: [
        { token: 'soil', depthPx: 8 },
        { token: 'farm', depthPx: 8 },
        { token: 'plaza', depthPx: 8 },
      ],
    },
    {
      land: ['grass'],
      style: 'straight',
      depthPx: 24,
      staggerPx: 4,
      staggerLevels: 4,
      staggerStep: 0,
      maxTruncatedPx: 0,
      maxOverlapPx: 0,
      steps: [
        { token: 'soil', depthPx: 8 },
        { token: 'farm', depthPx: 8 },
        { token: 'copper', depthPx: 8 },
      ],
    },
  ],
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
    // 落在灯街就会把镇心 (32,29) 和居民们的出生点一起关在门后。
    { id: 'bathhouse', name: '叠浪楼', x: 27, y: 17, w: 12, h: 11, requires: 'lamp', primary: 'terracotta', accent: 'trim', forbidden: 'grassLit' },
  ],
  prefabs: {
    wave_house: prefab('wave_house', '叠浪楼', 7, 6, 'terracotta', 'tower'),
    lamp_lodge: prefab('lamp_lodge', '迎灯舍', 5, 4, 'copper'),
    tea_stall: prefab('tea_stall', '潮声茶摊', 5, 4, 'terracotta', 'flat'),
    ferry_station: prefab('ferry_station', '旧渡口站台', 6, 4, 'copper', 'flat'),
    lamp_workshop: prefab('lamp_workshop', '补灯铺', 4, 4, 'terracotta'),
    boiler_annex: prefab('boiler_annex', '炉底入口', 4, 3, 'charcoal', 'flat'),
    // 候车亭是这张图上**开局不落位**的模板，这不是遗漏。
    // 世界拒绝「同一种铺子建第二栋」，所以模板全落位之后，
    // 白名单里的 building.add 在这张图上永远只能被拒——那句话就成了
    // 摆设。留一个设定集里本来就有的构件（渡口站台的瓦片母题写着「候车亭」），
    // 让「建一座候车亭」在这张图上真的能建成。
    waiting_shelter: prefab('waiting_shelter', '候车亭', 4, 3, 'copper', 'flat'),

    // 三栋接活的楼。它们补的是「每类活各有一栋常驻铺子」这半张网——
    // `validateCoverage` 要求每种 `boundTask` 有 1–2 栋模板，而原来这张图上
    // 一栋都没有，于是上游派下来的每一条活都被拒，回执说「这座镇子没有接
    // code 的铺子」。楼的模板齐了，活才有地方去。
    //
    // 名字：账房与灯录阁是**这一仓起的**（文档列的是叠浪楼的楼层，不是铺名）。
    // 炉匠铺跟着文档点名的「炉匠」走，字面也是这一仓的。
    ledger_house: prefab('ledger_house', '账房', 4, 4, 'timberDark', 'gable', 'ink', 'writing'),
    lamp_archive: prefab('lamp_archive', '灯录阁', 4, 4, 'copper', 'gable', 'pages', 'research'),
    soot_forge: prefab('soot_forge', '炉匠铺', 4, 4, 'charcoal', 'flat', 'smoke', 'code'),
  },
  placements: [
    { prefabId: 'wave_house', at: { x: 28, y: 20 } },
    { prefabId: 'lamp_lodge', at: { x: 18, y: 22 } },
    { prefabId: 'tea_stall', at: { x: 40, y: 22 } },
    { prefabId: 'ferry_station', at: { x: 10, y: 10 } },
    { prefabId: 'lamp_workshop', at: { x: 43, y: 34 } },
    { prefabId: 'boiler_annex', at: { x: 29, y: 14 } },
    // 三栋接活的楼。坐标是逐格枚举出来的（`checkPlacement` + `doorReaches` +
    // `!breathingAt(door)` + 避开镇心/全部作息点/现有六栋的占地与留白），
    // 不是手挑的。三扇门都在 lampstreet / sootbank 里，都不呼吸。
    //
    // `lamp_archive` 落在灯街东段而不是镇心旁边：镇心周围 4×4 的空地被
    // 叠浪楼门口和账房门口夹住，两栋 4×4 塞不下（枚举里 40 个近处候选全部
    // `occupied`）。
    { prefabId: 'ledger_house', at: { x: 28, y: 28 } },
    { prefabId: 'lamp_archive', at: { x: 40, y: 27 } },
    { prefabId: 'soot_forge', at: { x: 37, y: 34 } },
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
  // 七位居民。前两位是原有的；后五位的**岗位与地点**来自 `SETTING_DENGCHAO.md`：
  // 文档点名了灯笼头、炉匠、沉灯夫人（后面跟着「等」），另一条「还没有做的」
  // 列着叠浪楼的六层（账房 / 宴席 / 浴池 / 大堂 / 洗衣仓 / 炉底层）——账房先生
  // 与洗衣妇就是从那两层推出来的。**只有字面是这一仓起的。**
  //
  // 为什么加到七个人，而不是原来那两个：传说要五个人讲同一件事讲满三天
  // （`legendHolders = 5`，`legendDays = 3`）。两个人时那条阈值**结构上够不着**
  // ——说话距离是 2 格，而世界里只有两个人物，最多三个 holder 会知道同一件事
  // （两个人物加一栋在广播半径里的楼）。七个人加九栋楼才有余量。
  //
  // 出生点全在镇心的空地上（x32..39, y28..31）。**一个都不能生在叠浪楼里**：
  // 那道门要灯（`requires: 'lamp'`），没有灯的人 t=0 就被关在门后，一步也动不了，
  // 而装载器拒的正是这种包。要进楼的四位（沉灯夫人、账房先生、洗衣妇，以及
  // 原有的汐）都写着 `lamp: true`。
  //
  // 作息点的落点集中在 (33..37, 28..31) 这一小片：`talkDistance = 2`，
  // 只有人真的凑到两格内才算照面。**挪开这批落点，信念就涨不动、传说立不起来
  // ——而那时所有单元测试还是绿的。** `test/legend-forms.test.ts` 量的正是这件事。
  villagers: [
    // 外观四维：这七个人靠「体型 / 头型 / 衣型 / 配饰」分开，不再挤两个色槽。
    // 衣色仍是 24 源色里的 token；七个底色两两 ΔE76 ≥ 10（灯潮界实测最小 15.5，
    // 见 `test/villager-identity.test.ts`）。灯是凭证（`lamp`），不是外观。
    // 设定集：少女（PDF p.42/44/59；书页 82–83/86–87/116–117）。
    // 朱红工作服、白前襟、深蓝短裤、棕色马尾、提水桶。
    { name: '迷路人', at: { x: 23, y: 29 }, archive: DENGCHAO_CAST_ARCHIVES['迷路人'], style: {
      cloak: 'ember', cloakDark: 'terracotta', scarf: 'pale', scarfLit: 'plaster', hair: 'timberDark',
      build: 'slim', head: 'ponytail', outfit: 'tunic', accent: 'bucket', lamp: false,
    }, routine: [
      { x: 19, y: 15, label: '在旧站牌下认路', dwellMs: 6500 },
      { x: 24, y: 29, label: '沿着灯街找一盏认识的灯', dwellMs: 4800 },
      { x: 21, y: 7, label: '趁退潮看浅滩上的旧轨道', dwellMs: 6500, tide: 'low' },
      { x: 36, y: 29, label: '在叠浪楼外等潮水退去', dwellMs: 5000 },
    ] },
    // 设定集：白衣少年（PDF p.42/43；书页 82–83/84–85）。
    // 深色齐颌短发、白/浅青长袍、蓝色束带、赤脚。
    { name: '汐', at: { x: 36, y: 29 }, archive: DENGCHAO_CAST_ARCHIVES['汐'], style: {
      cloak: 'pale', cloakDark: 'water', scarf: 'water', scarfLit: 'pale', hair: 'timberDark',
      build: 'young', head: 'bob', outfit: 'robe', accent: 'none', lamp: true,
    }, routine: [
      { x: 32, y: 27, label: '点亮楼前的长灯', dwellMs: 5800 },
      { x: 19, y: 29, label: '在迎灯舍前照看来客', dwellMs: 5200 },
      { x: 39, y: 29, label: '满潮时收起滩边的灯', dwellMs: 4800, tide: 'high' },
      { x: 50, y: 42, label: '趁退潮拾回还能用的灯芯', dwellMs: 6000, tide: 'low' },
    ] },
    // 设定集：无面者（PDF p.58；书页 114–115）。
    // 高而窄的黑袍、白面具、紫黑眼口、细手臂。灯杆是灯潮界的点灯凭证。
    { name: '灯笼头', at: { x: 33, y: 30 }, archive: DENGCHAO_CAST_ARCHIVES['灯笼头'], style: {
      cloak: 'charcoal', cloakDark: 'ink', scarf: 'charcoal', scarfLit: 'ink', hair: 'charcoal',
      build: 'tall', head: 'mask', outfit: 'robe', accent: 'staff', lamp: true,
    }, routine: [
      { x: 33, y: 29, label: '在镇心把街灯一盏盏点亮', dwellMs: 5200 },
      { x: 19, y: 26, label: '在迎灯舍前数新到的灯罩', dwellMs: 5000 },
      { x: 30, y: 12, label: '趁退潮去浅滩点数旧灯桩', dwellMs: 6200, tide: 'low' },
      { x: 48, y: 40, label: '在滩边挑还能补的灯壳', dwellMs: 5400 },
    ] },
    // 设定集：锅炉房老人（PDF p.48；书页 94–95）。
    // 秃顶白须、圆框眼镜、深紫灰长袍、六条手臂、矮壮。
    { name: '炉匠', at: { x: 38, y: 30 }, archive: DENGCHAO_CAST_ARCHIVES['炉匠'], style: {
      cloak: 'timber', cloakDark: 'timberDark', scarf: 'trim', scarfLit: 'warmLight', hair: 'pale',
      build: 'stoutShort', head: 'beard', outfit: 'robe', accent: 'none', lamp: false,
    }, routine: [
      { x: 39, y: 38, label: '在炉匠铺门口抖灰', dwellMs: 5600 },
      { x: 35, y: 30, label: '在镇心石边上歇脚', dwellMs: 5000 },
      { x: 33, y: 15, label: '到炉底入口边上搬炭', dwellMs: 6000 },
      { x: 24, y: 24, label: '在街边喝一碗热的', dwellMs: 4800 },
    ] },
    // 设定集：掌柜（PDF p.53；书页 104–105 的掌柜造型）。
    // 白发大髻、大鼻、深蓝长裙、金色束带，矮而宽。
    { name: '沉灯夫人', at: { x: 35, y: 31 }, archive: DENGCHAO_CAST_ARCHIVES['沉灯夫人'], style: {
      cloak: 'water', cloakDark: 'deepShade', scarf: 'trim', scarfLit: 'warmLight', hair: 'pale',
      build: 'stout', head: 'yubaba', outfit: 'cloak', accent: 'none', lamp: true,
    }, routine: [
      { x: 34, y: 29, label: '在镇心石边沉灯', dwellMs: 6000 },
      { x: 36, y: 29, label: '在镇心石边讲那年的潮', dwellMs: 5200 },
      { x: 27, y: 29, label: '沿街巡一遍还没灭的灯', dwellMs: 5000 },
      { x: 44, y: 28, label: '在茶摊前坐一会儿', dwellMs: 5600 },
    ] },
    { name: '账房先生', at: { x: 34, y: 28 }, style: {
      cloak: 'trim', cloakDark: 'charcoal', scarf: 'copper', scarfLit: 'pale', hair: 'timberDark',
      build: 'adult', head: 'bob', outfit: 'coat', accent: 'satchel', lamp: true,
    }, routine: [
      { x: 34, y: 30, label: '在镇心听人报今日的账', dwellMs: 4600 },
      { x: 30, y: 32, label: '在账房门口核今天的账', dwellMs: 5600 },
      { x: 23, y: 29, label: '去街口找人说一笔旧账', dwellMs: 5000 },
      { x: 17, y: 26, label: '在摊位间对一遍零钱', dwellMs: 4800 },
    ] },
    { name: '洗衣妇', at: { x: 37, y: 31 }, style: {
      cloak: 'copper', cloakDark: 'deepShade', scarf: 'pale', scarfLit: 'plaster', hair: 'soil',
      build: 'adult', head: 'ponytail', outfit: 'apron', accent: 'none', lamp: true,
    }, routine: [
      { x: 36, y: 30, label: '在镇心石边拧干最后一件', dwellMs: 5000 },
      { x: 33, y: 26, label: '上叠浪楼收洗好的衣裳', dwellMs: 5400 },
      { x: 52, y: 42, label: '把洗好的布晾在滩边', dwellMs: 6000, tide: 'low' },
      { x: 24, y: 31, label: '把干净衣裳送到街尾', dwellMs: 5400 },
    ] },
  ],
  scenery: [
    // 叠浪楼门前的朱红桥：横跨楼前那道水口，潮水从桥下过。
    { kind: 'bridge', at: { x: 28, y: 27 }, length: 9 },
    // 浅滩轨道横贯整片浅滩，退潮时才完全露出来。
    { kind: 'track', at: { x: 2, y: 8 }, length: 60 },
    { kind: 'sign', at: { x: 19, y: 15 } },
    { kind: 'statue', at: { x: 26, y: 28 } },
    // 碑立在镇心 (32,29) 旁边：世界共识刻在这儿，而不是刻在某栋楼的外墙上。
    // 碑上不写字（中文不进 canvas），字在 `#stele-panel` 里。
    { kind: 'stele', at: { x: 34, y: 28 } },
    // 灯街的专属资产：十根街灯、三串纸灯、一条街面铺装、三面店铺立面、
    // 六个夜市摊位、三幅幌布、三根竖招牌。清单与来源页码在 `lamp-street.ts`。
    ...lampStreetScenery(),
    // 设定集场景补绘：炉底、渡口石堤、街面分段、对岸屋脊与钟塔。
    // 每件资产的页码与形制在 `scene-artbook.ts`。
    ...sceneArtbookScenery(),
    // 积尘滩的废弃物堆只出现在滩上，不越到灯街。
    ...Array.from({ length: 7 }, (_, i) => ({
      kind: 'debris' as const,
      at: { x: 40 + i * 2, y: 41 + (i % 3) },
    })),
    // 主楼烟囱的烟挪到新烟囱顶（p15 的独立砖烟囱），旧坐标在屋顶上。
    { kind: 'steam', at: { x: 36, y: 11 } },
    { kind: 'steam', at: { x: 45, y: 37 } },
  ],
};
