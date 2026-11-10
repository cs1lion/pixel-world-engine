/** 位图布景素材的渲染辅助（`?art=1` 时替代 scene-artbook 的程序化绘制）。
 *
 * 每件布景的包围盒与锚点偏移在 `SCENERY_BOXES` 里钉住——这些数来自
 * `scene-artbook.ts` 各 draw 函数的 fillRect 坐标范围，不是猜的。
 * 位图按包围盒宽缩放、底对齐到锚点 y，窗火锚点仍由程序化坐标给出
 * （位图里的窗位置与程序化不完全一致，但暖光叠层只要求"大致在窗上"）。
 *
 * `?art=0` 时 `hasArt` 恒 false，调用方走原程序化路径，一个字节不变。
 */

import Phaser from 'phaser';
import { artKey, artScaleOf, hasArt } from './art-assets.ts';
import type { ArtbookPoint } from './scene-artbook.ts';

/** 每件布景的包围盒（相对锚点 x,y 的偏移）与窗火锚点。
 *
 * `boxLeft/boxTop` 是包围盒左上角相对锚点的偏移（负值=在锚点左/上方）；
 * `boxW/boxH` 是包围盒宽高（逻辑像素）。
 * `windowOffsets` 是窗火锚点相对锚点的偏移（与程序化 draw 函数里的 windows.push 一致）。
 */
interface SceneryBox {
  readonly boxLeft: number;
  readonly boxTop: number;
  readonly boxW: number;
  readonly boxH: number;
  readonly windowOffsets: readonly ArtbookPoint[];
}

const SCENERY_BOXES: Readonly<Record<string, SceneryBox>> = {
  // drawBathhouse: x-24..x+142, y-140..y+96 -> 宽166 高236
  bathhouse_main: {
    boxLeft: -24, boxTop: -140, boxW: 166, boxH: 236,
    windowOffsets: [
      { x: 8.5, y: 21.5 }, { x: 19.5, y: 21.5 }, { x: 92.5, y: 21.5 }, { x: 103.5, y: 21.5 },
      { x: 8.5, y: 49.5 }, { x: 19.5, y: 49.5 }, { x: 92.5, y: 49.5 }, { x: 103.5, y: 49.5 },
      { x: 14.5, y: -13.5 }, { x: 32.5, y: -13.5 }, { x: 50.5, y: -13.5 }, { x: 68.5, y: -13.5 }, { x: 86.5, y: -13.5 },
      { x: 56, y: 81 }, { x: 19, y: 46 }, { x: 95, y: 46 },
    ],
  },
  // drawGableShopfront: x..x+w, y-52..y+4 -> 宽=w 高=56
  shopfront_gable: {
    boxLeft: 0, boxTop: -52, boxW: 64, boxH: 56,
    windowOffsets: [{ x: 32, y: -42 }, { x: 15, y: -1 }, { x: 35, y: -1 }, { x: 55, y: -1 }],
  },
  // drawBoiler: x-2..x+35, y-42..y+27 -> 宽37 高69
  boiler: {
    boxLeft: -2, boxTop: -42, boxW: 37, boxH: 69,
    windowOffsets: [],
  },
  // drawFarTower: x..x+26, y-62..y+2 -> 宽26 高64
  far_tower: {
    boxLeft: 0, boxTop: -62, boxW: 26, boxH: 64,
    windowOffsets: [{ x: 10, y: -28 }, { x: 16, y: -28 }, { x: 10, y: -12 }, { x: 16, y: -12 }],
  },
  // drawFarRidge: x..x+span, y-9..y+12 -> 宽=span 高=21
  far_ridge: {
    boxLeft: 0, boxTop: -9, boxW: 992, boxH: 21,
    windowOffsets: [], // 窗火锚点按 length 动态算，见 addSceneryImage
  },
  // drawQuay: x..x+w, y-5..y+18 -> 宽=w 高=23
  quay: {
    boxLeft: 0, boxTop: -5, boxW: 80, boxH: 23,
    windowOffsets: [],
  },
  // drawCoalHeap: x..x+33, y-1..y+14 -> 宽33 高15
  coal_heap: {
    boxLeft: 0, boxTop: -1, boxW: 33, boxH: 15,
    windowOffsets: [],
  },
};

/**
 * 在指定 depth 层放一张布景位图，返回是否成功放置。
 * 成功时把窗火锚点追加进 `windows`（与程序化 draw 函数的 windows.push 同口径）。
 * 失败（没素材）时返回 false，调用方走原程序化路径。
 *
 * @param scene Phaser 场景
 * @param id 布景素材 id（如 `bathhouse_main`）
 * @param x 锚点 x（逻辑像素）
 * @param y 锚点 y（逻辑像素）
 * @param depth 目标 depth
 * @param windows 窗火锚点数组（追加）
 * @param length 可选：ridge/quay/shopfront 的长度（格），用于动态算包围盒宽
 */
export function addSceneryImage(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  depth: number,
  windows: ArtbookPoint[],
  length?: number,
): boolean {
  if (!hasArt(scene, 'scenery', id)) return false;
  const box = SCENERY_BOXES[id];
  if (box === undefined) return false;

  const key = artKey('scenery', id);
  const frame = scene.textures.get(key)?.getSourceImage();
  if (frame === undefined) return false;

  // 包围盒宽：有 length 的按 length*16 算，否则用默认 boxW
  const boxW = length !== undefined ? length * 16 : box.boxW;
  const scale = (boxW * artScaleOf(scene)) / frame.width;

  // 位图左上角 = 锚点 + 包围盒偏移
  const imgX = x + box.boxLeft;
  const imgY = y + box.boxTop;
  scene.add.image(imgX, imgY, key)
    .setOrigin(0, 0)
    .setScale(scale / artScaleOf(scene))
    .setDepth(depth);

  // 窗火锚点：按包围盒宽缩放偏移
  const offsetXScale = boxW / box.boxW;
  for (const off of box.windowOffsets) {
    windows.push({ x: x + off.x * offsetXScale, y: y + off.y });
  }

  // far_ridge 的窗火锚点按 length 动态算（与 drawFarRidge 一致）
  if (id === 'far_ridge' && length !== undefined) {
    for (let i = 0; i < length; i += 4) {
      if (i % 12 === 4) {
        const hx = x + i * 16;
        windows.push({ x: hx + 13, y: y + 3 });
      }
    }
  }

  return true;
}
