/** `?art=1` 表现层的图集烘焙合成层（`atlas-registry.ts` 的渲染侧消费方）。
 *
 * 职责只有一件事：把「网格账本 / 楼体尺寸 → 图集格索引」翻出来，**一次烘焙**
 * 成纹理再贴进世界。它不持有任何判据：哪里是什么地形、哪里是水，全读生产
 * 网格；水陆界直接复用 `shore-band.ts` 的既有边表，不自算第二条。
 *
 * **缺件回退是这一层的底线**：清单缺一槽、sheet 缺一张、图集整体没装上，
 * 都回 `active: false` / `null` 让调用方落回程序化绘制——「素材缺一件不该让
 * 世界缺一块」在这里的含义是「图集缺一格不该让那一格消失」。
 *
 * 后端只有一种：`textures.createCanvas` 起一张离屏 canvas，按格 `drawImage`
 * 把图集格切区拷进去，`refresh()` 上传，再以一张 Image 贴出。Canvas 与 WebGL
 * 渲染器下这条路径等价（canvas 纹理两种渲染器都会上传），**每层每帧只有一条
 * draw 指令**——与 `bake.ts` 的产出同形态，所以图集不会把渲染预算按格数吹大
 * （预算口径见 `scripts/check-render-budget.mjs`）。不选 Blitter：Bob 不带
 * 缩放，32×32 图集在它手里没法缩回逻辑像素。
 *
 * 16×16 与 32×32 两种图集都支持：缩放在这一步一次做完，目标矩形恒为
 * `TILE_PX`，运行时零缩放开销（`atlasTileScale` 的口径落地的地方）。
 */

import Phaser from 'phaser';

import { TILE_PX } from '../../world/setup.ts';
import type { WorldGrid } from '../../world/grid.ts';
import {
  atlasManifestOf,
  atlasSheetKey,
  groundTileOf,
  hasTileAtlas,
  shoreTileOf,
  waterTileOf,
  type TileAtlasManifest,
} from './atlas-registry.ts';
import { waterLandEdgesFromGrid } from '../shore-band.ts';

/** 烘焙键：同一帧世界只有一张图集地面/岸带，键固定不随世界变。 */
const ATLAS_GROUND_KEY = 'art1:ground:baked';
const ATLAS_SHORE_KEY = 'art1:shore:baked';

/** 图集层的深度：压在程序化地形（-10）之上、一切装饰之前。 */
export const ATLAS_GROUND_DEPTH = -9;
export const ATLAS_SHORE_DEPTH = -8.5;

/** 一整层的格索引计划：纯查询；渲染与测试共用，不藏状态。 */
export interface AtlasTilePlan {
  readonly width: number;
  readonly height: number;
  /** (x, y) → 图集格索引；`null` = 这一格清单没登记，保留程序化底色。 */
  readonly frameAt: (x: number, y: number) => number | null;
}

/** 一格：目标格坐标 + 图集帧索引。 */
export interface AtlasCell {
  readonly x: number;
  readonly y: number;
  readonly frame: number;
}

/**
 * 地面层计划。水体（`water` 槽）优先于同名的地面格；石板路是
 * `zone === 'street'` 的 stone 地形改铺 `road` 槽——清单没给 `road`
 * 就整层退回 ground 槽，不做半层混铺。
 */
export function planAtlasGround(
  grid: Pick<WorldGrid, 'width' | 'height' | 'at'>,
  manifest: TileAtlasManifest,
): AtlasTilePlan {
  const frames = new Map<string, number>();
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.at({ x, y });
      if (cell === undefined) continue;
      // 水槽优先：水是叠加语义（潮位可淹没），清单给了就盖过地面格。
      const water = waterTileOf(manifest, cell.terrain);
      if (water !== null) {
        frames.set(`${x},${y}`, water);
        continue;
      }
      const base = groundTileOf(manifest, cell.terrain);
      if (base === null) continue;
      const road = manifest.road;
      const index =
        cell.zone === 'street' && cell.terrain === 'stone' && typeof road === 'number' ? road : base;
      frames.set(`${x},${y}`, index);
    }
  }
  return { width: grid.width, height: grid.height, frameAt: (x, y) => frames.get(`${x},${y}`) ?? null };
}

/**
 * 岸带层计划：水陆边陆格 → 岸型格索引。边表用 `waterLandEdgesFromGrid`
 * 的既有判据（水里侧 = `shallow`），键是陆侧地形——与 `shore-band.ts`
 * 的岸型选型同源，不另立第二条水陆界。
 */
export function planAtlasShore(
  grid: Pick<WorldGrid, 'width' | 'height' | 'at'>,
  manifest: TileAtlasManifest,
): AtlasTilePlan {
  const edges = waterLandEdgesFromGrid(grid, (terrain) => terrain === 'shallow');
  const frames = new Map<string, number>();
  for (const edge of edges) {
    // 边表的 `terrain` 在显式夹具里可以省略（那时只允许单一岸型），
    // 所以陆格地形自己再读一次——网格是唯一事实源。
    const terrain = edge.terrain ?? grid.at(edge.land)?.terrain;
    if (typeof terrain !== 'string') continue;
    const index = shoreTileOf(manifest, terrain);
    if (index !== null) frames.set(`${edge.land.x},${edge.land.y}`, index);
  }
  return { width: grid.width, height: grid.height, frameAt: (x, y) => frames.get(`${x},${y}`) ?? null };
}

/** 装载完成后的视图：场景持有它；`active: false` 时一切方法都是空转。 */
export interface AtlasLayerView {
  /** 图集是否真的接管了这一层（false = 没装图集，场景保持程序化路径）。 */
  readonly active: boolean;
  /** 重贴整层（网格变化时调用；图集层是静态的，常规流程不会走到）。 */
  readonly rebuild: () => void;
  readonly destroy: () => void;
}

/**
 * 把一整层图集格贴进世界。图集没装上时返回 `active: false`，场景一个
 * 字节都不用改路径——这就是「缺图零报错回退」的落点。
 *
 * `kind = 'ground' | 'shore'` 共用同一套合成逻辑，只换计划函数、键与深度。
 */
export function createAtlasLayerView(
  scene: Phaser.Scene,
  grid: Pick<WorldGrid, 'width' | 'height' | 'at'>,
  kind: 'ground' | 'shore',
): AtlasLayerView {
  if (!hasTileAtlas(scene)) return inactive();
  const manifest = atlasManifestOf(scene);
  if (manifest === undefined) return inactive();
  const sheetKey = atlasSheetKey('ground');
  if (!scene.textures.exists(sheetKey)) return inactive();

  const plan = kind === 'ground' ? planAtlasGround(grid, manifest) : planAtlasShore(grid, manifest);
  const cells = collectCells(plan);
  // 整层一格都没登记：清单坏了/空的，不当成接管。
  if (cells.length === 0) return inactive();

  const key = kind === 'ground' ? ATLAS_GROUND_KEY : ATLAS_SHORE_KEY;
  const depth = kind === 'ground' ? ATLAS_GROUND_DEPTH : ATLAS_SHORE_DEPTH;
  const bake = (): Phaser.GameObjects.Image | null =>
    composeAtlasCells(scene, key, sheetKey, plan.width * TILE_PX, plan.height * TILE_PX, cells)
      ?.setDepth(depth) ?? null;

  const first = bake();
  if (first === null) return inactive();
  let image = first;
  return {
    active: true,
    rebuild: () => {
      image.destroy();
      const next = bake();
      if (next !== null) image = next;
    },
    destroy: () => {
      image.destroy();
      if (scene.textures.exists(key)) scene.textures.remove(key);
    },
  };
}

function inactive(): AtlasLayerView {
  return { active: false, rebuild: () => {}, destroy: () => {} };
}

/** 把整层计划展平成格数组（一次遍历，供烘焙与「有没有格」的判定共用）。 */
export function collectCells(plan: AtlasTilePlan): AtlasCell[] {
  const cells: AtlasCell[] = [];
  for (let y = 0; y < plan.height; y += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      const frame = plan.frameAt(x, y);
      if (frame !== null) cells.push({ x, y, frame });
    }
  }
  return cells;
}

/**
 * 把若干图集格烘进一张 `wPx × hPx` 的 canvas 纹理，返回贴出用的 Image
 * （origin 左上、尚未定位，由调用方 setDepth / 放进容器）。
 * 地面 / 岸带 / 建筑四层共用这一条。
 *
 * `opts.sliceBottomPx` 是「取这一格最下面 N 个逻辑像素」：前檐只需 3px 高
 * 的一条（与程序化层同高，不然会盖住站在门口的人的胸口），而图集里没有
 * 3px 的格。压扁会破坏像素刻度，所以从**格的底边**切 N 行像素、原尺度
 * 画进目标矩形。32 格图集按 `atlasTileScale` 换算成 2N 个源像素。
 *
 * 失败（纹理建不出来 / 源图拿不到）回 `null` 并清掉半张纹理，
 * 调用方回退到程序化绘制。
 */
export function composeAtlasCells(
  scene: Phaser.Scene,
  key: string,
  sheetKey: string,
  wPx: number,
  hPx: number,
  cells: readonly AtlasCell[],
  opts?: { readonly sliceBottomPx?: number },
): Phaser.GameObjects.Image | null {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, wPx, hPx);
  if (tex === null) return null;
  const ctx = tex.getContext();
  const sheet = scene.textures.get(sheetKey);
  // 图集只有一张源图（spritesheet），按它切帧；拿不到就是没装上。
  const source = sheet.getSourceImage() as CanvasImageSource | null;
  if (source === null || source === undefined) {
    scene.textures.remove(key);
    return null;
  }
  const slice = opts?.sliceBottomPx;
  for (const cell of cells) {
    const frame = sheet.get(cell.frame);
    if (frame === null) continue;
    // 切片高度是**源像素**：逻辑 3px 在 32 格图集里是 6 个源像素。
    const srcH = slice === undefined ? frame.cutHeight : sliceSourceHeight(frame.cutHeight, slice);
    const srcY = slice === undefined ? frame.cutY : frame.cutY + frame.cutHeight - srcH;
    ctx.drawImage(
      source,
      frame.cutX,
      srcY,
      frame.cutWidth,
      srcH,
      cell.x * TILE_PX,
      cell.y * TILE_PX,
      TILE_PX,
      slice === undefined ? TILE_PX : slice,
    );
  }
  tex.refresh();
  return scene.add.image(0, 0, key).setOrigin(0, 0);
}

/**
 * 把「逻辑像素的切片高」换算成源像素：图集格源高对逻辑高的倍数就是
 * `cutHeight / TILE_PX`（16 格是 1、32 格是 2）。取整不许超过源高。
 */
export function sliceSourceHeight(cutHeight: number, logicalPx: number): number {
  const ratio = cutHeight / TILE_PX;
  return Math.min(cutHeight, Math.max(1, Math.round(logicalPx * ratio)));
}
