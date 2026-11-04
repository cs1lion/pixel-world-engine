/** 雨天的摊子：收棚、盖布。
 *
 * 摊子本体由 `setting-scenery.ts` 画在 props 层（depth 1050）。本文件不改它，
 * 只在同一个位置叠一块 1051 的盖布——下雨时把棚与货盖住，晴了整块清掉。
 * 这样场景线那边改摊子的画法时，不必知道「雨天还有一层」。
 *
 * 开关量由世界层给（`stallsPackedFor(weather)`），这里不判天气。
 *
 * 盖布是会动的：落下之后由世界时刻驱动的横摆 + 下沿下垂。同一时刻棚布在
 * `setting-scenery` 里被 `packed` 定住，两件不会同时摆。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import { STALL_MOTION_ON, stallCoverSwayAt, type StallMotion } from '../world/stall-motion.ts';
import type { SettingPack } from '../settings/types.ts';

export interface WeatherStallsView {
  update(packed: boolean, now: number, motion?: StallMotion): void;
  destroy(): void;
  /** 本帧每块盖布的摆幅（证据脚本据此报「盖布在摆、棚布没摆」）。 */
  readonly coverUnits: () => readonly { order: number; dx: number; droop: number }[];
}

export function createWeatherStallsView(scene: Phaser.Scene, pack: SettingPack): WeatherStallsView {
  const cover = scene.add.graphics().setDepth(1051).setVisible(false);
  const c = pack.palette;
  const stalls = pack.scenery.filter((item) => item.kind === 'stall');
  let readout: { order: number; dx: number; droop: number }[] = [];

  return {
    coverUnits: () => readout.map((unit) => ({ ...unit })),
    update(packed: boolean, now: number, motion: StallMotion = STALL_MOTION_ON): void {
      cover.clear();
      cover.setVisible(packed);
      readout = [];
      if (!packed) return;
      stalls.forEach((stall, order) => {
        const x = stall.at.x * TILE_PX;
        const y = stall.at.y * TILE_PX;
        const sway = motion.cloth ? stallCoverSwayAt(now, order) : { dx: 0, droop: 0 };
        const dx = sway.dx;
        const droop = sway.droop;
        // 盖布比摊子四周各宽一格：布边压住柜台边缘，才读成「收起来了」。
        cover.fillStyle(c.ink, 0.96);
        cover.fillRect(x - 3 + dx, y - 15, 31, 31 + droop);
        // 两道折痕 + 一条压边：不是一整块黑，仍能读出「布」。
        cover.fillStyle(c.timberDark, 1);
        cover.fillRect(x + 5 + dx, y - 15, 2, 31 + droop);
        cover.fillRect(x + 16 + dx, y - 15, 2, 31 + droop);
        cover.fillStyle(c.trim, 0.7);
        cover.fillRect(x - 3 + dx, y - 15, 31, 2);
        readout.push({ order, dx, droop });
      });
    },
    destroy(): void {
      cover.destroy();
    },
  };
}
