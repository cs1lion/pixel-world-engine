/** 高度层的画法（Phaser 侧）。判定全在 `height-view.ts`，这里只负责把结果画出来。
 *
 * 两条纪律：
 *   - **没有高度就不建层。** `stepsOf` 为空时直接返回 null，不在场景里多留一张
 *     纹理、一个 Image。平面世界打开 `?hd2d=on` 也必须是空操作——这是 166 张基线
 *     0 diff 的结构性理由。
 *   - **遮挡靠逐行裁剪条，不靠每帧判像素。** 每一行要压在人身上的那一条
 *     （世界 y ∈ `[row*16-16, row*16)`）直接从已经烘好的地形纹理与崖面纹理裁剪，
 *     depth 由 `occluderStripDepth(row)` 给死；运行期一个像素都不重算，也不看相机。
 *     裁剪而不是重画，是为了让「遮挡条里的像素」与「台面本体」结构性同一份——
 *     两条画法迟早会分叉。
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

/**
 * 从已完成纹理上裁剪一条 16px 高的带，贴在 `bandY`，depth 由行号给死。
 *
 * 不重烘、不重画：裁剪区随源纹理一起走，像素与台面本体同一份。
 * 源纹理只在开局烘一次，所以这里不需要 `rebake`。
 */
function cropBand(
  scene: Phaser.Scene,
  textureKey: string,
  width: number,
  bandY: number,
  depth: number,
): BakedLayer {
  // 位置必须是 (0,0)，不能是 (0, bandY)：Phaser 4 的裁剪把 crop 的偏移算进
  // quad 的局部左上角（`TransformerImage`：`x = -displayOriginX + crop.x`），
  // 贴图再放到 bandY 就成了 `2*bandY`，整条落到画面外。裁剪自己会把它送回原位。
  const image = scene.add.image(0, 0, textureKey).setOrigin(0, 0);
  image.setCrop(0, bandY, width, TILE_PX);
  image.setDepth(depth);
  return {
    image,
    rebake: () => {},
    destroy: () => image.destroy(),
  };
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
 *
 * `terrainKey` 是地形烘焙纹理的 key（`SandboxScene` 起的 `world-terrain-*`）；
 * 遮挡条从它裁剪，所以台面上移与遮挡条永远是同一份像素。
 * `occluders` 为 false 时只建崖面本体、不出裁剪条：O1 反向判据要靠它取「条不在」那一帧。
 */
export function createHeightView(
  scene: Phaser.Scene,
  key: string,
  grid: WorldGrid,
  originX: number,
  originY: number,
  altitude: number,
  terrainKey: string,
  occluders: boolean,
): HeightView | null {
  const steps = stepsOf(grid);
  if (steps.length === 0) return null;

  const width = grid.width * TILE_PX;
  const height = grid.height * TILE_PX;
  const layers: BakedLayer[] = [];
  const baseKey = `${key}-base`;

  // 台地本体：一层贴图，压在地形之上、在所有会动的东西之下。
  layers.push(
    bakeLayer(scene, baseKey, width, height, HEIGHT_LAYER_DEPTH, (g) => {
      paintSteps(g, grid, steps, originX, originY, 0);
    }),
  );

  // 逐行遮挡条：从地形纹理与崖面纹理各裁一条同位置的带，depth 由行号给死。
  // 一级台地：地形带里是抬起的台面；多级台地：崖面带里是上方那段墙。
  // 两条都裁，透明的那条不花像素、只花一个 Image。
  if (occluders) {
    for (const { row } of occluderRowsOf(grid)) {
      const bandY = row * TILE_PX - TILE_PX;
      if (bandY < 0) continue;
      const depth = occluderStripDepth(row, altitude);
      layers.push(cropBand(scene, terrainKey, width, bandY, depth));
      layers.push(cropBand(scene, baseKey, width, bandY, depth));
    }
  }

  return {
    images: layers.length,
    destroy() {
      for (const layer of layers) layer.destroy();
      layers.length = 0;
    },
  };
}
