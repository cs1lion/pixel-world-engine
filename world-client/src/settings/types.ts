/** 一套设定集的外部数据。运行时由 loadSettingPack 校验、编译。 */
import type { GridSpec } from '../world/grid.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import type { VillagerArchive } from '../world/villager-archive.ts';
import type { VillagerLookInput } from '../world/villager-look.ts';
import type { CarryItem, GridPoint, PrefabBlueprint, PropKind, TerrainId } from '../world/types.ts';
import type { ActivityId, SiteKind } from '../world/timetable.ts';

export interface SettingPlacement {
  readonly prefabId: string;
  readonly at: GridPoint;
}

/**
 * 场所锚点：作息按**场所**解析落点，不再写死坐标。
 *
 * `x/y` 不是「人站的那一格」，而是场所的锚——运行时由 `nearestWalkable` 落到
 * 最近的可走格（`settings/index.ts` 的 `siteTargetResolver`）。锚写进包里而不写进
 * 作息里，是因为同一处会被多条作息引用：坐标一改就得改每一处，迟早漏一条。
 *
 * 两种锚互斥，装载期校验：
 * - **坐标锚** `{ x, y }`：给没有建筑承载的场所（如一条街的集市）。
 * - **建筑锚** `{ building }`：`id` **必须等于**该建筑的 `instanceId`，落点取
 *   `PlacedBuilding.door`。建筑是既有身份，不为它再造一个场所 id。
 */
export type SettingSite = SettingSiteBase & (
  | { readonly x: number; readonly y: number }
  | { readonly building: string }
);

export interface SettingSiteBase {
  readonly id: string;
  /** 闭集 `SITE_KINDS` 的元素；装载期校验，不在闭集里当场 throw。 */
  readonly kind: SiteKind;
}

/** 落点里与「去哪」无关的那些字。 */
export interface SettingRoutineWords {
  readonly label: string;
  /**
   * 赶路时牌子说的那句。省略就说「赶路」。
   *
   * `label` 是她到了之后在做什么，这一句是她此刻正往那儿去——同一拍的两半，
   * 缺一半屏上就在演「她已经站在那儿了」。设定集不写也能跑，只是每个人
   * 赶路时都只说「赶路」。
   */
  readonly going?: string;
  readonly dwellMs?: number;
  /** low = 只在退潮去；high = 涨潮时改去别处。 */
  readonly tide?: 'low' | 'high';
}

/**
 * 作息落点：**要么给坐标，要么给场所 id**，两者只取其一。
 *
 * 同时给就是两个事实（场所挪了、坐标没挪），装载期会拒掉。只给 `site` 的落点
 * 由 `sites` 表解析；解析不到就 throw，不许静默落到 (0,0)。
 *
 * **给 `site` 就必须给 `activity`**（类型层面挡死）：到了场所之后做什么，不许
 * 由行为层按 kind 猜，也不许只靠 `label` 的文字。装载期还会交叉校验
 * 「这个词这个场所允不允许」，不匹配就 throw。
 */
export type SettingRoutineStop = SettingRoutineWords &
  ({ readonly site: string; readonly activity: ActivityId } | GridPoint);

export interface SettingVillager {
  readonly name: string;
  readonly at: GridPoint;
  readonly routine: readonly SettingRoutineStop[];
  readonly style?: SettingVillagerStyle;
  /** 主要人物才有：面板可读、开局注入记忆的设定档案。 */
  readonly archive?: VillagerArchive;
}

/**
 * 编译后的居民：开局带什么凭证已经算好，下游不用再问 `style`。
 *
 * 为什么不直接给 `SettingVillager` 加一个 `carries`：那是两个字段说同一件事，
 * 就得永远对齐，而对不上的表现是「她明明提着灯，那道门就是不认」。
 * 装着灯的是 `style.lamp`（设定集写定的那一句），`carries` 是世界的机制——
 * 由装载器从前者派生一次，往后只有这一个事实。
 */
export interface CompiledVillager {
  readonly name: string;
  readonly at: GridPoint;
  readonly routine: readonly SettingRoutineStop[];
  readonly style?: SettingVillagerStyle;
  readonly carries: readonly CarryItem[];
  readonly archive?: VillagerArchive;
}

/**
 * 岸型预设 id。闭集与 `render/shore-band.ts` 的 `SHORE_PRESETS` 对齐：
 * 加一种岸型要两处同时加，装载期会拒掉认不出的词。
 */
export type ShoreStyleId = 'straight' | 'inset';

/** 岸带的一段色阶。`depthPx` 是沿法线的长度，8 起、%8 === 0。 */
export interface SettingShoreStep {
  readonly token: WorldColor;
  readonly depthPx: number;
}

/**
 * 一组岸型的参数：适用哪些陆地地形、哪套预设、多宽、怎么错位、色阶分几段。
 *
 * 为什么按 `land` 分组而不是一个 token 通吃：`plaza` 是铺装色，铺在草岸上
 * 会把岸读成码头/硬边（不是「看不见」，是材质词义不对）。石板段与草岸段
 * 各有独立三档，选取按陆格地形查表，渲染层不写分支。
 *
 * 缺席 = 这本人不画岸带（旧设定集路径），画面与加这个组件之前逐字节一致。
 */
export interface SettingShore {
  /** 适用哪些陆地地形。 */
  readonly land: readonly TerrainId[];
  readonly style: ShoreStyleId;
  /** 基线总宽（世界像素）= `steps` 之和；8..48 且必须是 8 的整数倍。 */
  readonly depthPx: number;
  /** 错位步长，4 或 8（1/4 或半格）。 */
  readonly staggerPx: number;
  /** 错位档数，2..4。 */
  readonly staggerLevels: number;
  /** 错位加在哪一段；v3 取最后一段。 */
  readonly staggerStep: number;
  /** 允许的截断像素上限；灯潮界 0。 */
  readonly maxTruncatedPx: number;
  /** 允许被裁掉的重叠面积上限；灯潮界 0。 */
  readonly maxOverlapPx: number;
  /** 2..3 段，每段 ≥8 且 %8 === 0，和 = depthPx。 */
  readonly steps: readonly SettingShoreStep[];
}

export interface SettingScenery {
  readonly kind:
    | 'lantern'
    | 'track'
    | 'statue'
    | 'bridge'
    | 'debris'
    | 'sign'
    | 'steam'
    /** 灯街的幌布：一根斜杆挂两幅布，给街面立起垂直节奏。 */
    | 'banner'
    /** 灯街的摊位：矮柜台 + 布棚，撑起"有人做买卖"的读法。 */
    | 'stall'
    /** 灯街的成串纸灯：一条横跨街面的灯绳，挂 6 盏。 */
    | 'lamp_string'
    /** 灯街的街面铺装：一段带石板缝的铺装带，只铺在地上。 */
    | 'paving'
    /** 灯街的店铺立面：灰泥墙 + 木框 + 格窗 + 暖帘 + 招牌。 */
    | 'shopfront'
    /** 灯街的竖招牌：木柱 + 竖板 + 三个自造字块。 */
    | 'signpost'
    /**
     * 设定集场景补绘（2026-11-03）：清单、页码与形制见
     * `settings/dengchao/scene-artbook.ts`。这些都是装饰构件，不占地、不接活。
     * - `boiler`：炉底入口旁的砖砌炉膛、烟道与烟囱；
     * - `coal_heap`：炉前煤堆与木桶；
     * - `quay`：渡口石砌突堤与下水踏步；
     * - `steps`：街面石阶；
     * - `drain`：街面石沟与铁格栅；
     * - `shopfront_gable`：带弧形山墙与圆窗的店铺立面；
     * - `ridge`：水对岸的屋脊线与山影；
     * - `far_tower`：对岸的钟塔剪影。
     */
    | 'boiler'
    | 'coal_heap'
    | 'quay'
    | 'steps'
    | 'drain'
    | 'street_paving'
    | 'shopfront_gable'
    | 'ridge'
    | 'far_tower'
    /**
     * 花径的花圃（设定集 p110–111）：沿小径两侧铺开的灌木花床。
     *
     * **降级**：24 色里没有粉紫，杜鹃 / 绣球做不出来，这一床只能画暖红＋米白；
     * 花墙形制已于 2026-11-09 改成「连贯、等高、平顶」的一版，仍是 B 档。
     * 石垣已于 2026-11-09 另开两笔做掉（含瓦顶，见 `docs/evidence/wall-roof/`）——
     * 与设定集之间的差距仍是差距，不是还原。
     * 清单见 `docs/OPEN_ISSUES.md` N 节。
     */
    | 'flower_bed'
    /**
     * 花径的木栅（设定集 p110–111 的「夹道栅栏」）。
     *
     * 一件 = **一格**栅栏段：栏杆在格内横贯、左右件首尾相接成一条直线，立柱每格
     * 一根。一件一格而不是一件带 `length` 的长条，是因为 depth 必须按行算
     * （`sceneryDepth`）：一根跨多格的长条只有一个 depth，就没法与站在不同行的人
     * 分别判前后。
     *
     * **只做东西向**：这套投影里「走向」与「高度」都落在屏幕竖直方向，南北向的
     * 栅栏栏杆与立柱在屏幕上都是竖线，实测四种画法都读成「一根带节的木杆」。
     * 所以栅栏只落在两列花床的南端面（y25）。A/B 图见 `docs/evidence/fence/`。
     *
     * **B 档**：依据只有仓库转述（本机画册 99 页、对不上 p110–111），
     * 形制是按转述推的近形，不宣称还原。清单见 `docs/OPEN_ISSUES.md` N 节。
     */
    | 'fence'
    /**
     * 花径的矮石垣（设定集 p110–111 的「石垣」）：花床北缘的一道挡土墙。
     *
     * 一件 = **一格**墙段：瓦葺压顶在上、墙身在下一格贯通，左右件首尾相接。
     * 与 `fence` 同一套规矩——一件一格而不是带 `length` 的长条，因为 depth 必须
     * 按行算（`sceneryDepth`），跨多格的长条只有一个 depth，没法与不同行的人
     * 分别判前后。
     *
     * **只做东西向**：与 `fence` 同源的限制。这套投影里「走向」与「高度」都落在
     * 屏幕竖直方向，南北向的墙在屏幕上只剩一条竖带，读不出「立着」。理由与实测
     * 见 `docs/evidence/fence/README.md`。
     *
     * **只做矮的**：总高 16px（压顶 3 + 墙身 11 + 墙脚影 2）。村民约 18–20px 高，
     * 所以这是齐腰的挡土墙，不是把人挡在外面的院墙——再高就会把花床后的视线全吃掉。
     *
     * **B 档**：依据只有仓库转述（本机画册 99 页、对不上 p110–111），形制按「石垣」
     * 二字推的近形，不宣称还原。**瓦顶只换压顶那 3px、不加高**（加高会伸进北篱那一行），
     * 读法是「亮瓦脊 / 暗瓦面」，见 `docs/evidence/wall-roof/README.md`。
     * 清单见 `docs/OPEN_ISSUES.md` N 节。
     */
    | 'stone_wall'
    /**
     * 碑：镇心旁边的一块矮石板，世界共识刻在上面。
     *
     * 它是一件**摆件而不是楼**，因为它不占地、不可建、不接活——世界对它做的事
     * 只有一件：传说立起来时，碑上就多一行字。字在 DOM 面板里，不在 canvas 上
     * （中文不进 canvas，D5-A），所以这一支画出来的只是那块石头。
     */
    | 'stele';
  readonly at: GridPoint;
  readonly length?: number;
}

/**
 * 居民外观。四个形状维度（体型/头型/衣型/配饰）与五个颜色槽都可写；
 * 颜色只能是世界 24 色的 token 名，写错当场编译失败、装载期再查一遍。
 *
 * 四个维度是**可选**的：省略就走 `world/villager-look.ts` 的默认外观。
 * 但 7 位现有居民全部显式写满四个维度——「省略」是给外部/旧设定集的退路，
 * 不是给这 7 个人的写法。
 */
export interface SettingVillagerStyle extends VillagerLookInput {
  readonly cloak: WorldColor;
  readonly scarf: WorldColor;
  readonly lamp: boolean;
}

export interface SettingPack {
  readonly id: string;
  readonly name: string;
  readonly saveKey: string;
  readonly palette: WorldPalette;
  readonly terrainColors: Readonly<Record<TerrainId, number>>;
  readonly grid: GridSpec;
  readonly terrain: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly terrain: TerrainId }[];
  /**
   * 地域。比 `GridSpec.regions` 多一个 `name`：那是给界面看的，
   * 网格自己不显示名字，所以两边**不是**同一个形状。
   * 别为了「去重」把这边改成引用 `GridSpec`——那会逼着网格也背上显示名。
   *
   * `requires` 是渡有仪式的门（SPEC_V2 §4.6）：跨这道区界要带什么。
   *
   * `breathing` 是呼吸段（SPEC_V2 §4.7）：这一区里不派活、不出急件。
   * 与 `requires` 是两个独立的槽位——一道区域可以又要凭证又呼吸。
   * 省略就是「不呼吸」：莞尔镇的地域从来没有这一项。
   *
   * `primary` / `accent` / `forbidden` 是区域的三色槽位（SPEC_V2 §4.1）：
   * 主色、点缀、禁用。**三个都必填**——设定集 B 长不出自己的颜色，缺的正是
   * 这三个槽。设成可选的话，「写漏了一道区域的点缀色」这个错要到画面上才
   * 看得见，而那时候已经说不清是设定集漏了、还是引擎忘了读。
   *
   * 为什么只在这一层、不上 `GridSpec.regions`：颜色是设定集的事，网格只认
   * 几何与门。上面那句「两边不是同一个形状」说的就是这个——网格背上显示名
   * 已经不对，再背 24 色槽位更不对。
   *
   * 三个值都只能是世界 24 色的 token 名（`WorldColor`）。**类型帮 TS 作者
   * 当场指出来，但帮不了 runtime**：`as never` 绕得过它（`test/settings.test.ts`
   * 里 `requires: 'torch' as never` 就是本仓自己的写法），而非 TS 来源的包
   * 连类型都没有。所以 `loadSettingPack` 在装载期对着 `TOKENS` 再查一遍——
   * 与 `style.cloak`/`scarf`、`terrainColors` 同一个做法，理由写在 `load.ts`
   * 的循环里。
   *
   * **莞尔镇一道地域都没声明**（`regions: []`），所以这一层没有它的份。它的
   * 每个分区都定得出主色（分区 → `terrainFor` → `TERRAIN_COLORS` 一条链），
   * 点缀与禁用在现有画面上**没有对应物**——宁可不填，也不编两个数凑满三个槽。
   * （2026-10-28：这里原来写「四个分区」。`ZoneId` 是**六个**值
   * `street` / `altar` / `industry` / `scholarly` / `agriculture` / `living`，
   * 而 `terrainFor` 六个都返回一种地形，于是六个都有一条主色。同一个错在
   * `docs/SPEC_V2.md` §4.1 已经记过（2026-10-28 补记），这里是它在代码里的
   * 第二处，`test/settings-region-colors.test.ts` 还有第三处——都改成不写数。）
   */
  readonly regions: readonly {
    readonly id: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly requires?: CarryItem | null;
    readonly breathing?: boolean;
    /** 主色：这一区的地面与大块面积。 */
    readonly primary: WorldColor;
    /** 点缀：小面积提亮——招牌、幌布、灯。 */
    readonly accent: WorldColor;
    /** 禁用：这一区不许出现的颜色。 */
    readonly forbidden: WorldColor;
  }[];
  readonly blueprints: ReadonlyMap<string, PrefabBlueprint>;
  readonly placements: readonly SettingPlacement[];
  readonly hub: GridPoint;
  /** 场所锚点表：作息里的 `site` 落点按这张表解析。省略 = 这本设定集没有场所落点。 */
  readonly sites?: readonly SettingSite[];
  readonly villagers: readonly CompiledVillager[];
  readonly scenery: readonly SettingScenery[];
  /**
   * 编译后的露话池：摆件种类 → 它底下的那几句。
   *
   * 与 `blueprints` 同一条规矩——`RawSettingPack` 那边是 `Record<string, …>`
   * （未经校验的原文），这边是装载器编译出来的 `ReadonlyMap`，键已经收窄成
   * `PropKind`。校验（种类得是 lamp/tree/banner、每池至少一句）在装载时做，
   * 于是下游拿到手就是一个能直接 `.get(kind)` 的表，不用再各自 cast 一遍。
   *
   * 缺席（`undefined`）就是「这本设定集一句都没给」：那件摆件没有露话，
   * 也就没有什么要盖的，于是一件都不脏。莞尔镇就是这样。
   */
  readonly propReveals?: ReadonlyMap<PropKind, readonly string[]>;
  /** 岸线带参数。省略 = 不画（旧设定集与默认世界之外的包都走这条）。 */
  readonly shore?: readonly SettingShore[];
  readonly authored: boolean;
}

export interface RawSettingPack {
  readonly id: string;
  readonly name: string;
  readonly saveKey: string;
  readonly palette: Readonly<Record<string, string>>;
  readonly terrainColors: Readonly<Record<string, string>>;
  readonly grid: GridSpec;
  readonly terrain: SettingPack['terrain'];
  readonly regions: SettingPack['regions'];
  /** 场所锚点的原文：`kind` 这里还是字符串，装载期才收窄进闭集；锚的两种形式也在装载期校验。 */
  readonly sites?: readonly {
    readonly id: string;
    readonly kind: string;
    readonly x?: number;
    readonly y?: number;
    readonly building?: string;
  }[];
  readonly prefabs: Record<string, unknown>;
  readonly placements: readonly SettingPlacement[];
  readonly hub: GridPoint;
  readonly villagers: readonly SettingVillager[];
  readonly scenery: readonly SettingScenery[];
  /**
   * 摆件种类 → 它底下的那几句露话（清洗即还原，SPEC_V2 §4.6）。
   *
   * **话是谁的就说谁拿着**：引擎不编设定集的内容，所以这一份由设定集给。
   * 某个种类缺席（或整份省掉）时，那类摆件没有露话，也就没有什么要盖的——
   * 于是一件都不脏。莞尔镇一份都没给，默认世界里因此没有一件摆件会脏。
   *
   * 这不是降级失败，是槽位空着：v2 只交付承载设定的槽位（SPEC_V2 §6）。
   * 与 `regions` 的 `name` 同一条规矩——显示名归拿着设定集的那一层。
   *
   * 原文一律按 `Record<string, …>` 收，不按 `PropKind`：写错一个种类
   * （`lanp`）必须**有可能**写出来，装载期才拦得住它。按 `PropKind` 收的
   * 话那个错在类型上就不存在，`compilePropReveals` 也就白写了。
   */
  readonly propReveals?: Readonly<Record<string, readonly string[]>>;
  /** 岸线带（原文，装载期校验）。省略 = 不画。 */
  readonly shore?: readonly SettingShore[];
}
