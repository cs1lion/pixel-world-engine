/** 高度层的画法（Phaser 侧）。判定全在 `height-view.ts`，这里只负责把结果画出来。
 *
 * 两条纪律：
 *   - **没有高度就不建层。** `stepsOf` 为空时直接返回 null，不在场景里多留一张
 *     纹理、一个 Image。平面世界打开 `?hd2d=on` 也必须是空操作——这是 166 张基线
 *     0 diff 的结构性理由。
 *   - **遮挡靠逐行纹理，不靠每帧判像素。** 每一行要压在人身上的那一小条单独烘成
 *     一张 16px 高的纹理，depth 由 `occluderStripDepth(row)` 给死；运行期一个像素
 *     都不重算，也不看相机。
 */

import Phaser from 'phaser';
import { bakeLayer, type BakedLayer } from './bake.ts';
import {
  HEIGHT_LAYER_DEPTH,
  LEVEL_PX,
  occluderRowsOf,
  occluderStripDepth,
  stepsOf,
  type HeightStep,
} from './height-view.ts';
import { paletteFor, terrainFor } from '../world/theme.ts';
import { TILE_PX } from '../world/setup.ts';
import type { WorldGrid } from '../world/grid.ts';

export interface HeightView {
  readonly images: number;
  readonly destroy: () => void;
}

/** 把一段阶面画进 Graphics；`offsetY` 用来把世界坐标落进只有一行高的纹理。 */
function paintSteps(
  g: Phaser.GameObjects.Graphics,
  grid: WorldGrid,
  steps: readonly HeightStep[],
  originX: number,
  originY: number,
  offsetY: number,
): void {
  const palette = paletteFor();
  const terrain = terrainFor();
  for (const step of steps) {
    const x = originX + step.x * LEVEL_PX;
    const top = originY + step.top - offsetY;
    const cell = grid.at({ x: step.x, y: step.row });
    // 台面取这一格自己的地形色：换设定集时阶面跟着换，不写死第二个色值。
    const face = cell === undefined ? palette.grass : terrain[cell.terrain];
    // 阶面：地形色压暗一档 + 一条受光边 + 一条接触线。三级下来仍然是同一条边，
    // 不额外画侧立面（D2：不能旋转、无侧立面）。
    g.fillStyle(face, 0.92);
    g.fillRect(x, top, LEVEL_PX, step.height);
    g.fillStyle(palette.ink, 0.34);
    g.fillRect(x, top, LEVEL_PX, step.height);
    g.fillStyle(face, 0.55);
    g.fillRect(x, top, LEVEL_PX, 1);
    g.fillStyle(palette.ink, 0.62);
    g.fillRect(x, top + step.height - 1, LEVEL_PX, 1);
  }
}

/**
 * 建高度层。平面世界返回 null（不建纹理、不加显示对象）。
 *
 * `altitude` 与角色 depth 同一套基准：裁剪条的 depth 必须落在
 * `altitude + row*16 + 8` 与 `altitude + (row+1)*16 + 8` 之间，否则压不住人。
 */
export function createHeightView(
  scene: Phaser.Scene,
  key: string,
  grid: WorldGrid,
  originX: number,
  originY: number,
  altitude: number,
): HeightView | null {
  const steps = stepsOf(grid);
  if (steps.length === 0) return null;

  const width = grid.width * TILE_PX;
  const height = grid.height * TILE_PX;
  const layers: BakedLayer[] = [];

  // 台地本体：一层贴图，压在地形之上、在所有会动的东西之下。
  layers.push(
    bakeLayer(scene, `${key}-base`, width, height, HEIGHT_LAYER_DEPTH, (g) => {
      paintSteps(g, grid, steps, originX, originY, 0);
    }),
  );

  // 逐行裁剪条：一行一张，depth 由行号给死。行内没有阶面才不切。
  for (const { row } of occluderRowsOf(grid)) {
    const inRow = steps.filter((step) => step.row === row);
    if (inRow.length === 0) continue;
    layers.push(
      bakeLayer(scene, `${key}-row-${row}`, width, TILE_PX, occluderStripDepth(row, altitude), (g) => {
        paintSteps(g, grid, inRow, originX, originY, row * TILE_PX);
      }),
    );
  }

  return {
    images: layers.length,
    destroy() {
      for (const layer of layers) layer.destroy();
      layers.length = 0;
    },
  };
}
