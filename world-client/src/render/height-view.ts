/** 高度层的纯几何：不算像素，只算「哪一格有阶面、哪一行要压在人身上」。
 *
 * 为什么单独一个文件
 * ------------------
 * ADR_TERRAIN_HEIGHT 的第一性要求是「高度只有一个来源」。所以这里**只读
 * `levelAt`**，不碰 `cell.level`，也不缓存任何展开后的高度表——多存一份就是
 * 多一条会和 `TileCell.level` 分叉的路。渲染（height-bake.ts）只消费这里的
 * 结果，不再自己判一遍。
 *
 * 不 import Phaser：这一层要能在 Node 里被测试钉住。画的部分在 height-bake.ts。
 */

import { TILE_PX } from '../world/setup.ts';
import { ACTOR_DEPTH_OFFSET } from './prop-depth.ts';
import type { GridPoint } from '../world/types.ts';

/** 一级高度占几个像素。取整格：ADR 的投影约定是「上移一格」，不是百分比。 */
export const LEVEL_PX = TILE_PX;

/**
 * 高度层自己贴图的 depth。
 *
 * 在地形烘焙层（-10）之上、在所有会动的东西之下：台地本体永远看一眼世界，
 * 而「压在人身上」的那部分由逐行裁剪条按行 depth 单独排，见 `occluderRowsOf`。
 */
export const HEIGHT_LAYER_DEPTH = -9;

/** 高度几何需要的全部世界信息。刻意只开这两个能力，别的都不给。 */
export interface LevelField {
  readonly width: number;
  readonly height: number;
  levelAt(p: GridPoint): number;
}

/** 一段可见阶面：`row` 行的台地比正南邻格高出 `drop` 级。 */
export interface HeightStep {
  readonly x: number;
  readonly row: number;
  readonly drop: number;
  /** 阶面矩形的顶边（世界像素，闭区间上沿）。 */
  readonly top: number;
  /** 阶面矩形的高度（像素）。 */
  readonly height: number;
}

/**
 * 所有可见阶面。判定只有一句：**本格比正南邻格高**。
 *
 * 南向是唯一方向（D2：不能旋转、不做侧立面），所以北/东/西三面的高差
 * 在这里不产生像素——它们只是同一个台地在南缘露出的同一条边。
 */
export function stepsOf(field: LevelField): HeightStep[] {
  const steps: HeightStep[] = [];
  for (let row = 0; row < field.height; row += 1) {
    for (let x = 0; x < field.width; x += 1) {
      const level = field.levelAt({ x, y: row });
      if (level <= 0) continue;
      const south = field.levelAt({ x, y: row + 1 });
      const drop = level - south;
      if (drop <= 0) continue;
      // 高过一格的部分越到上方行的地面上——H3 台面上移已做（tilemap 按 level 上移
      // 整格），所以阶面必须画满 `drop*LEVEL_PX`，不能再夹到一行；夹掉就会在
      // 台面上方留一条没有崖面的空洞。
      const height = drop * LEVEL_PX;
      steps.push({ x, row, drop, top: row * TILE_PX + TILE_PX - height, height });
    }
  }
  return steps;
}

/** 一行需要一条「压在上一行人身上」的裁剪条。 */
export interface OccluderRow {
  /** 裁剪条所在的格行（世界 y 行号）。 */
  readonly row: number;
  /** 这一行里最高的台地级数；只用于诊断读数，不参与排序。 */
  readonly level: number;
}

/**
 * 哪些格行要出裁剪条。
 *
 * 判定：这一行有台地，且**正北邻格更低**。只有这种「由北向南抬升」的行，
 * 才存在「站在北侧低处的人被这一行的台地挡住」的情形；台地内部相邻两行
 * 同高时什么都不挡，多切一条只是多一次绘制。
 */
export function occluderRowsOf(field: LevelField): OccluderRow[] {
  const rows: OccluderRow[] = [];
  for (let row = 0; row < field.height; row += 1) {
    let level = 0;
    for (let x = 0; x < field.width; x += 1) {
      const here = field.levelAt({ x, y: row });
      if (here <= 0) continue;
      if (here <= field.levelAt({ x, y: row - 1 })) continue;
      if (here > level) level = here;
    }
    if (level > 0) rows.push({ row, level });
  }
  return rows;
}

/**
 * 角色 depth：**按格行锚，不按视觉脚底锚**。
 *
 * 台面上移以后，站在 `(row, level)` 的人视觉脚底被抬高 `level*LEVEL_PX`，
 * 但排序必须仍按行——否则台地上的人会被自己行下的裁剪条盖住。
 * `level` 只贡献 **0.5px** 的分档（同一行里 level 高的人略靠后），
 * `level = 0` 时与旧公式 `altitude + (row+1)*TILE_PX + 8` 逐字相同。
 */
export function actorDepthOf(row: number, altitude = 0, level = 0): number {
  return altitude + (row + 1) * TILE_PX + ACTOR_DEPTH_OFFSET - level * 0.5;
}

/**
 * 裁剪条的 depth：**必须**落在 `row-1` 行的人与 `row` 行的人之间。
 *
 * 角色 depth 见 `actorDepthOf`：第 `r` 行的人是 `(r+1)*TILE_PX + 8 - level*0.5`。
 * 区间取到 level 0 的端点：`(row*16+8, row*16+24)`，这里取中点 `row*16+16`：
 * 北侧那行的人盖在它下面，南侧这行的人（哪怕 level 1）盖在它上面。
 * 取整像素，不随相机、缩放或帧时变化。
 */
export function occluderStripDepth(row: number, altitude = 0): number {
  return altitude + row * TILE_PX + ACTOR_DEPTH_OFFSET + TILE_PX / 2;
}
