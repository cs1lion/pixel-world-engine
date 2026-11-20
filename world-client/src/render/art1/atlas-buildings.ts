/** 图集建筑的层几何与呈现（`buildings.ts` 的图集分支用）。
 *
 * 图集给每栋楼四个格：back（墙脚基座）、body（屋体）、front（前檐）、
 * **roof（独立屋顶层）**。独立屋顶是这一支存在的理由：位图单件
 * （`art-assets.ts`）的整栋楼是一张图，掀屋顶对它不成立；把屋面拆成单独
 * 一格之后，`?art=1` 的楼也能进 PR-A 的掀屋顶状态机——`roofLifts` 一行不用改。
 *
 * 格是图集的一格材质（16 或 32 像素见 `atlas-registry.ts`），一栋
 * footprint `w×h` 格数的楼按「几格乘几格」平铺。本模块只算**每一层要占的
 * 矩形、平铺的格数、以及这一层归哪个容器**，烘焙与贴图交给
 * `atlas-tiles.ts#composeAtlasCells`。
 *
 * 层序与 depth 一字不改：`back` / `container` / `front` 三层的既有分层就是
 * Y-Sort 的依据（见 `render/building-depth.ts`），图集分支只换「楼本身
 * 长什么样」。
 */

import Phaser from 'phaser';

import { TILE_PX } from '../../world/setup.ts';
import type { PlacedBuilding } from '../../world/types.ts';
import { roofHeight } from '../decal.ts';
import {
  atlasManifestOf,
  atlasSheetKey,
  buildingFramesOf,
  hasTileAtlas,
  type TileBuildingFrames,
} from './atlas-registry.ts';
import { composeAtlasCells, type AtlasCell } from './atlas-tiles.ts';

/** 这一层进哪个容器（三个容器名与 `buildings.ts` 的字段同名）。 */
export type AtlasBuildingLayerTarget = 'back' | 'body' | 'front';

/** 一层：平铺用的格集合 + 该层在楼体坐标系里的位置。 */
export interface AtlasBuildingLayerPlan {
  /** 层名（日志与测试用）。 */
  readonly name: 'back' | 'body' | 'roof' | 'front';
  readonly target: AtlasBuildingLayerTarget;
  /** 烘焙纹理键（按 instanceId + 层名唯一）。 */
  readonly textureKey: string;
  /** 层矩形的左上角（楼体坐标系：楼体左上角 = 0,0，屋顶为负 y）。 */
  readonly x: number;
  readonly y: number;
  readonly wPx: number;
  readonly hPx: number;
  /** 平铺这一层的格（以层自己的格坐标计）。 */
  readonly cells: readonly AtlasCell[];
  /** 切片高（逻辑像素）：给了就只取图集格最下面这么多像素，不压扁。 */
  readonly sliceBottomPx?: number;
}

/** 屋顶高的口径：`decal.ts#roofHeight` 同一公式，两处必须一样。 */
export function atlasRoofHeight(hPx: number): number {
  return roofHeight(hPx);
}

/**
 * 四层各自的矩形与平铺格数。body 是屋体（不含顶），roof 骑在它上面。
 *
 * 前檐只有 3px 高（与 `drawFrontLayer` 同高：那一层要压在站在门口的人身上，
 * 整格 16px 会盖到胸口）。图集没有 3px 的格，所以取**格的底边 3 行像素**
 * 原尺度贴进去（`sliceBottomPx`）——压扁会破坏像素刻度，不能干。
 */
export function atlasBuildingLayerBoxes(
  wPx: number,
  hPx: number,
  frames: TileBuildingFrames,
): readonly {
  readonly name: AtlasBuildingLayerPlan['name'];
  readonly target: AtlasBuildingLayerTarget;
  readonly x: number;
  readonly y: number;
  readonly wPx: number;
  readonly hPx: number;
  readonly frame: number;
  readonly sliceBottomPx?: number;
}[] {
  const roofH = atlasRoofHeight(hPx);
  const cols = Math.max(1, Math.ceil(wPx / TILE_PX));
  const layer = (
    name: AtlasBuildingLayerPlan['name'],
    target: AtlasBuildingLayerTarget,
    y: number,
    height: number,
    frame: number,
    sliceBottomPx?: number,
  ) => ({
    name,
    target,
    x: 0,
    y,
    wPx: cols * TILE_PX,
    hPx: height,
    frame,
    sliceBottomPx,
  });
  return [
    // back：墙脚基座带，贴地面那一行高。
    layer('back', 'back', hPx - TILE_PX, TILE_PX, frames.back),
    // body：从屋顶底边一直铺到楼底（图集的 body 格是墙材质，不含顶）。
    layer('body', 'body', 0, hPx, frames.body),
    // roof：独立屋顶层，进 body 容器——层序与程序化那一支一致。
    layer('roof', 'body', -roofH, roofH, frames.roof),
    // front：前檐 3px，取格的底边 3 行像素原尺度贴。
    layer('front', 'front', hPx - 3, 3, frames.front, 3),
  ];
}

/**
 * 从「这栋楼的四个格索引」翻出四层各自的平铺计划。纯函数：不碰 Phaser。
 * 每层用图集里那一格反复平铺（图集是一格一材质，不是整栋楼切图）。
 */
export function planAtlasBuildingLayers(
  instanceId: string,
  wPx: number,
  hPx: number,
  frames: TileBuildingFrames,
): AtlasBuildingLayerPlan[] {
  return atlasBuildingLayerBoxes(wPx, hPx, frames).map((box) => {
    const cells: AtlasCell[] = [];
    // 切片层只需一行格（目标高 ≤ 一格高）；整格层按自己矩形行数铺满。
    const rows = box.sliceBottomPx === undefined
      ? Math.max(1, Math.ceil(box.hPx / TILE_PX))
      : 1;
    for (let ry = 0; ry < rows; ry += 1) {
      for (let rx = 0; rx < Math.ceil(box.wPx / TILE_PX); rx += 1) {
        cells.push({ x: rx, y: ry, frame: box.frame });
      }
    }
    return {
      name: box.name,
      target: box.target,
      textureKey: `art1:building:${instanceId}:${box.name}`,
      x: box.x,
      y: box.y,
      wPx: box.wPx,
      hPx: box.hPx,
      cells,
      ...(box.sliceBottomPx === undefined ? {} : { sliceBottomPx: box.sliceBottomPx }),
    };
  });
}

/** 图集建筑的呈现视图（容器由调用方建好递进来，本模块只往里加东西）。 */
export interface AtlasBuildingView {
  /** 独立屋顶层：`roofLifts` 淡出的对象就是它。 */
  readonly roof: Phaser.GameObjects.Image;
  readonly chimney: Phaser.GameObjects.Graphics;
  readonly window: Phaser.GameObjects.Graphics;
  readonly progress: Phaser.GameObjects.Graphics;
  readonly sign: Phaser.GameObjects.Graphics;
  readonly layers: readonly Phaser.GameObjects.Image[];
  readonly destroy: () => void;
}

/** 清单里有没有这栋楼的图集格；没登记回 `null`（调用方落回位图/程序化）。 */
export function buildingFramesFromScene(
  scene: Phaser.Scene,
  prefabId: string,
): TileBuildingFrames | null {
  if (!hasTileAtlas(scene)) return null;
  const manifest = atlasManifestOf(scene);
  if (manifest === undefined) return null;
  return buildingFramesOf(manifest, prefabId);
}

/**
 * 把一栋楼的四个图集层烘成纹理贴进三个容器。
 *
 * 烘不出来（sheet 没装上 / 纹理建不起来）回 `null`，并把已贴的层与纹理
 * 全部拆干净——不给画面留半栋楼，调用方据此落回原来的绘制路径。
 */
export function createAtlasBuildingView(
  scene: Phaser.Scene,
  building: PlacedBuilding,
  frames: TileBuildingFrames,
  wPx: number,
  hPx: number,
  back: Phaser.GameObjects.Container,
  container: Phaser.GameObjects.Container,
  front: Phaser.GameObjects.Container,
): AtlasBuildingView | null {
  const sheetKey = atlasSheetKey('buildings');
  if (!scene.textures.exists(sheetKey)) return null;

  const plans = planAtlasBuildingLayers(building.instanceId, wPx, hPx, frames);
  const images = new Map<AtlasBuildingLayerPlan['name'], Phaser.GameObjects.Image>();
  const posted: { readonly image: Phaser.GameObjects.Image; readonly textureKey: string }[] = [];
  for (const plan of plans) {
    const image = composeAtlasCells(
      scene,
      plan.textureKey,
      sheetKey,
      plan.wPx,
      plan.hPx,
      plan.cells,
      plan.sliceBottomPx === undefined ? undefined : { sliceBottomPx: plan.sliceBottomPx },
    );
    if (image === null) {
      // 半途失败：贴出去的全拆掉、纹理一并清，不给画面留半栋楼。
      for (const done of posted) {
        done.image.destroy();
        if (scene.textures.exists(done.textureKey)) scene.textures.remove(done.textureKey);
      }
      return null;
    }
    image.setPosition(plan.x, plan.y);
    (plan.target === 'back' ? back : plan.target === 'front' ? front : container).add(image);
    posted.push({ image, textureKey: plan.textureKey });
    images.set(plan.name, image);
  }

  // 烟囱 / 窗 / 招牌 / 进度：图集分支不画程序化那一套（材质格自带观感），
  // 但字段必须存在且为空——`updateBuildingDecals` 那系调用方拿到就是
  // 「没有东西可画」，不能是 undefined。
  const chimney = scene.add.graphics();
  const windowG = scene.add.graphics();
  const progress = scene.add.graphics();
  const sign = scene.add.graphics();
  progress.setVisible(false);
  container.add([chimney, windowG, progress, sign]);

  const roof = images.get('roof')!;
  return {
    roof,
    chimney,
    window: windowG,
    progress,
    sign,
    layers: posted.map((item) => item.image),
    destroy: () => {
      for (const { textureKey } of posted) {
        if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
      }
    },
  };
}
