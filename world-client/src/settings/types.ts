/** 一套设定集的外部数据。运行时由 loadSettingPack 校验、编译。 */
import type { GridSpec } from '../world/grid.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import type { CarryItem, GridPoint, PrefabBlueprint, PropKind, TerrainId } from '../world/types.ts';

export interface SettingPlacement {
  readonly prefabId: string;
  readonly at: GridPoint;
}

export interface SettingRoutineStop extends GridPoint {
  readonly label: string;
  readonly dwellMs?: number;
  /** low = 只在退潮去；high = 涨潮时改去别处。 */
  readonly tide?: 'low' | 'high';
}

export interface SettingVillager {
  readonly name: string;
  readonly at: GridPoint;
  readonly routine: readonly SettingRoutineStop[];
  readonly style?: SettingVillagerStyle;
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
    | 'stall';
  readonly at: GridPoint;
  readonly length?: number;
}

/** 居民外观。斗篷与围巾只能是世界 24 色的 token 名，写错当场编译失败。 */
export interface SettingVillagerStyle {
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
   * 四个分区只定得出主色（分区 → `terrainFor` → `TERRAIN_COLORS` 一条链），
   * 点缀与禁用在现有画面上**没有对应物**——宁可不填，也不编两个数凑满三个槽。
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
}
