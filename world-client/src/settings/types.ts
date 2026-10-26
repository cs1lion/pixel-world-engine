/** 一套设定集的外部数据。运行时由 loadSettingPack 校验、编译。 */
import type { GridSpec } from '../world/grid.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import type { CarryItem, GridPoint, PrefabBlueprint, TerrainId } from '../world/types.ts';

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
   * 省略就是「不留白」：莞尔镇的地域从来没有这一项。
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
  }[];
  readonly blueprints: ReadonlyMap<string, PrefabBlueprint>;
  readonly placements: readonly SettingPlacement[];
  readonly hub: GridPoint;
  readonly villagers: readonly CompiledVillager[];
  readonly scenery: readonly SettingScenery[];
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
}
