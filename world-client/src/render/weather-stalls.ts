/** 雨天的摊子：收棚、盖布。
 *
 * 摊子本体由 `setting-scenery.ts` 画在 props 层（depth 1050）。本文件不改它，
 * 只在同一个位置叠一块 1051 的盖布——下雨时把棚与货盖住，晴了整块清掉。
 * 这样场景线那边改摊子的画法时，不必知道「雨天还有一层」。
 *
 * 开关量由世界层给（`stallsPackedFor(weather)`），这里不判天气。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import type { SettingPack } from '../settings/types.ts';

export interface WeatherStallsView {
  update(packed: boolean): void;
  destroy(): void;
}

export function createWeatherStallsView(scene: Phaser.Scene, pack: SettingPack): WeatherStallsView {
  const cover = scene.add.graphics().setDepth(1051).setVisible(false);
  const c = pack.palette;
  const stalls = pack.scenery.filter((item) => item.kind === 'stall');

  return {
    update(packed: boolean): void {
      cover.clear();
      cover.setVisible(packed);
      if (!packed) return;
      for (const stall of stalls) {
        const x = stall.at.x * TILE_PX;
        const y = stall.at.y * TILE_PX;
        // 盖布比摊子四周各宽一格：布边压住柜台边缘，才读成「收起来了」。
        cover.fillStyle(c.ink, 0.96);
        cover.fillRect(x - 3, y - 15, 31, 31);
        // 两道折痕 + 一条压边：不是一整块黑，仍能读出「布」。
        cover.fillStyle(c.timberDark, 1);
        cover.fillRect(x + 5, y - 15, 2, 31);
        cover.fillRect(x + 16, y - 15, 2, 31);
        cover.fillStyle(c.trim, 0.7);
        cover.fillRect(x - 3, y - 15, 31, 2);
      }
    },
    destroy(): void {
      cover.destroy();
    },
  };
}
