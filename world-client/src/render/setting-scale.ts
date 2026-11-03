/**
 * 灯潮界立面的尺度常量（设定集 p16/p37/p39/p40）。
 *
 * 纯数据、不引 Phaser——单测在 Node 里直接验算比例，证据脚本的标尺也读这份，
 * 不另抄一份数字。渲染层 `setting-scenery.ts` 只按这里给的像素画。
 *
 * **落地线不动**：所有竖直方向的增长都往天上长。石脚底边仍是 `y + 32`，
 * 所以占地、碰撞格、光池落点、深度判据一格都没变；改的只是墙上半身。
 */

import { TILE_PX } from '../world/setup.ts';
import { VILLAGER_H } from './villager-layout.ts';

/**
 * 店面立面的尺度（p37/p40）：墙 48px = 人 30px 的 1.6 倍。
 *
 * 墙顶从瓦片上沿往上抬 `SHOPFRONT_TOP`，石脚仍在 `y + 28 .. y + 32`。
 */
export const SHOPFRONT_TOP = 16;
export const SHOPFRONT_WALL_H = 44;
export const SHOPFRONT_STONE_H = 4;
/** 石脚底边到瓦片上沿的距离：44 - 16 + 4 = 32，与改尺度之前逐像素一致。 */
export const SHOPFRONT_BASE_H = SHOPFRONT_WALL_H - SHOPFRONT_TOP + SHOPFRONT_STONE_H;

/**
 * 街灯柱的尺度（p16/p39）：柱顶离地 58px（人 30px 的 1.93 倍），
 * 灯体下沿离地 43px，比人的头顶再高 13px——灯下走过的人不会「顶头」。
 *
 * `LAMP_BODY_BOTTOM` 是从柱脚（`y + TILE_PX`）量到灯体下沿的像素数。
 */
export const LAMP_POST_TOP = 42;
export const LAMP_BODY_H = 12;
export const LAMP_BODY_BOTTOM = 27;

/** 立面与街灯的实际像素尺寸。证据脚本拿它画标尺，尺子读渲染常量。 */
export interface SettingSceneryMetrics {
  /** 人高（`VILLAGER_H`），用来给比例做分母。 */
  readonly personH: number;
  /** 店面墙高：灰泥 + 石脚。 */
  readonly shopfrontH: number;
  /** 墙顶高出瓦片上沿的像素。 */
  readonly shopfrontTop: number;
  /** 街灯柱顶离地高度。 */
  readonly lampPostH: number;
  /** 灯体下沿离地高度。 */
  readonly lampBodyBottom: number;
}

/** 由常量算出的读数：渲染、证据脚本、单测共用同一个式子。 */
export function settingSceneryMetrics(): SettingSceneryMetrics {
  return {
    personH: VILLAGER_H,
    shopfrontH: SHOPFRONT_WALL_H + SHOPFRONT_STONE_H,
    shopfrontTop: SHOPFRONT_TOP,
    lampPostH: LAMP_POST_TOP + TILE_PX,
    lampBodyBottom: LAMP_BODY_BOTTOM + TILE_PX,
  };
}
