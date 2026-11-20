/** `?art=1` 表现层的可热替换 tile 图集注册表（路线 A 视觉升级，PR-B）。
 *
 * 与 `render/art-assets.ts` 的分工：那一套管的是**单件位图**（一栋楼一张
 * PNG、一张表情一张图），本模块管的是** tile 图集**——一张大 PNG 切 N×M 格，
 * 地面/石板路/水体/海岸、建筑 back/body/front/独立屋顶、居民 4 帧步态都从
 * 图集里按索引取格。图集可以整张热替换（换 `public/assets/art1/` 下的文件
 * 与 `manifest.json`），渲染代码不用改。
 *
 * **缺图零报错回退 `?art=0`**：与 `art-assets.ts` 同一口径——manifest 取不到、
 * sheet 装载失败、清单里没有这一件，查询函数一律回 `null`，调用方落到原来的
 * 程序化绘制路径。**素材缺一件不该让世界缺一块**。
 *
 * 图集支持 16×16 与 32×32 两种格（`manifest.tile.w/h` 声明）；32×32 的格在
 * 显示时按 `TILE_PX / tile.w` 缩回逻辑像素，口径与 `artScaleOf` 同源。
 *
 * 颜色不受 24 色板预算约束（`scripts/audit-palette.mjs` 的 `art1/` 放行口径，
 * 见 `docs/adr/ADR_PRESENTATION_GATE_LAYERS.md`）：图集是高色深视觉资产，
 * 色板只管 `?art=0` 兜底层与 UI Token。
 */

import Phaser from 'phaser';

import { TILE_PX } from '../../world/setup.ts';

/** 图集身份字段：防止把别的手写 JSON 当成图集清单加载。 */
export const ATLAS_KIND = 'art1';

/** 图集支持的格子边长（逻辑像素的倍数关系在装载时按 `TILE_PX` 归一）。 */
export const ATLAS_TILE_SIZES = [16, 32] as const;
export type AtlasTileSize = (typeof ATLAS_TILE_SIZES)[number];

/** 一张图集 sheet 在 manifest 里的登记项。 */
export interface TileAtlasSheetDef {
  /** 相对 `public/assets/art1/` 的文件名（如 `ground.png`）。 */
  readonly file: string;
  readonly tileWidth: AtlasTileSize;
  readonly tileHeight: AtlasTileSize;
  readonly columns: number;
  readonly rows: number;
}

/** 一栋建筑在图集里的四层格索引：back 贴地、body 屋体、front 前景、roof 独立屋顶层。 */
export interface TileBuildingFrames {
  readonly back: number;
  readonly body: number;
  readonly front: number;
  readonly roof: number;
}

/** 图集清单：槽位 → 格索引。索引是 `row * columns + col` 的帧号。 */
export interface TileAtlasManifest {
  readonly atlas: 'art1';
  readonly version: number;
  readonly tile: { readonly w: AtlasTileSize; readonly h: AtlasTileSize };
  readonly sheets: Readonly<Record<string, TileAtlasSheetDef>>;
  /** 地形 key（`grid.ts` 的 Terrain）→ ground sheet 格索引。 */
  readonly ground: Readonly<Record<string, number>>;
  /** 石板路格索引（road 地形与街道铺面共用）。 */
  readonly road: number;
  /** 水体 key → 格索引。键是**地形 id**：世界里「水」目前只有 `shallow` 一种
   *  地形（潮位淹没是叠加层，不是地形），所以清单里通常只有一项；
   *  以后多一种水体就加一个键，不需要改渲染代码。 */
  readonly water: Readonly<Record<string, number>>;
  /** 海岸过渡 key → 格索引。键是**陆侧地形 id**：岸型由水边那块地是什么
   *  决定（石岸与草岸不一样），这个读数与 `shore-band.ts` 的
   *  `waterLandEdgesFromGrid` 同源。 */
  readonly shore: Readonly<Record<string, number>>;
  /** 建筑 prefabId → 四层格索引。 */
  readonly buildings: Readonly<Record<string, TileBuildingFrames>>;
  /** 村民 id → 4 帧步态格索引（按行走步序轮转）。 */
  readonly villagers: Readonly<Record<string, readonly [number, number, number, number]>>;
}

/** manifest 的缓存键；与 `art-assets.ts` 的 `art-manifest` 同口径命名。 */
export const ATLAS_MANIFEST_KEY = 'art1-atlas-manifest';

/** 图集纹理键前缀：`art1:<sheet名>`，与单件位图的 `art:<kind>:<id>` 区开。 */
export const ATLAS_SHEET_PREFIX = 'art1:';

/**
 * `?atlas=1`：让 **tile 图集**抢在位图单件（`art-assets.ts`）之前接管建筑与居民。
 *
 * 为什么默认关：位图单件是已经过人眼验收的观感（19→72 件素材、
 * `ADR_ART_DEFAULT_ON`），图集这条新管线一上线就把它盖掉，等于拿验收过的
 * 画面去赌新代码。默认关、显式开，两条路都能跑，冒烟与观感验收各查各的。
 *
 * 读数只在这里解析一次：建筑与居民两处都要它，写两份就会漂。
 */
export function atlasFirstEnabledOf(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get('atlas') === '1' || params.get('atlas') === 'on';
}

export function atlasSheetKey(sheet: string): string {
  return `${ATLAS_SHEET_PREFIX}${sheet}`;
}

/** 格边长只认 16/32，别的手写值进来就是清单坏了。 */
export function isAtlasTileSize(v: unknown): v is AtlasTileSize {
  return v === 16 || v === 32;
}

/**
 * 在场景 `preload` 里调用：先取清单，再按清单排队装 sheet。
 * 清单取不到（没生成过图集）就静默跳过——没有图集等于没开，调用方走
 * `hasTileAtlas` 查询后落回程序化绘制。与 `preloadArt` 同一套「缺件不回炸」口径。
 */
export function preloadTileAtlas(scene: Phaser.Scene): void {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const root = `${base}assets/art1/`;
  scene.load.json(ATLAS_MANIFEST_KEY, `${root}manifest.json`);
  scene.load.once(`filecomplete-json-${ATLAS_MANIFEST_KEY}`, (_key: string, _type: string, data: TileAtlasManifest) => {
    if (data?.atlas !== ATLAS_KIND) return;
    for (const [name, sheet] of Object.entries(data.sheets ?? {})) {
      if (!isAtlasTileSize(sheet.tileWidth) || !isAtlasTileSize(sheet.tileHeight)) continue;
      scene.load.spritesheet(atlasSheetKey(name), `${root}${sheet.file}`, {
        frameWidth: sheet.tileWidth,
        frameHeight: sheet.tileHeight,
      });
    }
  });
}

/** 图集是否可用：manifest 在、且至少一张 sheet 纹理装上了。 */
export function hasTileAtlas(scene: Phaser.Scene): boolean {
  if (scene.cache.json.get(ATLAS_MANIFEST_KEY) === undefined) return false;
  const manifest = atlasManifestOf(scene);
  if (manifest === undefined) return false;
  return Object.keys(manifest.sheets).some((name) => scene.textures.exists(atlasSheetKey(name)));
}

/** 读清单；没装或清单损坏回 `undefined`，调用方自行回退。 */
export function atlasManifestOf(scene: Phaser.Scene): TileAtlasManifest | undefined {
  const manifest = scene.cache.json.get(ATLAS_MANIFEST_KEY) as TileAtlasManifest | undefined;
  if (manifest === undefined || manifest.atlas !== ATLAS_KIND) return undefined;
  return manifest;
}

/** 图集格缩到世界逻辑像素的倍率（32 格 → 0.5，16 格 → 1）。纯函数，可单测。 */
export function atlasTileScale(tileSize: number): number {
  return TILE_PX / tileSize;
}

/** 地形 key → ground sheet 格索引；清单没有这格回 `null`（调用方走程序化）。 */
export function groundTileOf(manifest: TileAtlasManifest, terrain: string): number | null {
  return manifest.ground[terrain] ?? null;
}

/** 建筑 prefabId → 四层格索引；清单没有这栋楼回 `null`。 */
export function buildingFramesOf(manifest: TileAtlasManifest, prefabId: string): TileBuildingFrames | null {
  return manifest.buildings[prefabId] ?? null;
}

/** 水体地形 → 格索引；不是水（或清单没登记）回 `null`。 */
export function waterTileOf(manifest: TileAtlasManifest, terrain: string): number | null {
  return manifest.water[terrain] ?? null;
}

/** 岸型格索引：由水陆边的**陆侧地形**查。清单没有这种岸回 `null`，
 *  调用方保留原来的程序化岸带——不能因为图集缺一格就把岸画没了。 */
export function shoreTileOf(manifest: TileAtlasManifest, landTerrain: string): number | null {
  return manifest.shore[landTerrain] ?? null;
}

/**
 * 村民第 `step` 步的步态格索引：清单给的是 4 帧数组，按步序轮转取。
 * 帧数组不完整（不是 4 帧）回 `null`——宁可不画也不画错步态。
 */
export function villagerWalkFrameOf(
  manifest: TileAtlasManifest,
  villagerId: string,
  step: number,
): number | null {
  const frames = manifest.villagers[villagerId];
  if (frames === undefined || frames.length !== 4) return null;
  return frames[((step % 4) + 4) % 4]!;
}
