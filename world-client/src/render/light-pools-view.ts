/** 环境光斑的绘制：把 `light-pools.ts` 的纯数据画成 ADD 光点。
 *
 * 与 `phase-view` 的光晕分开：那一层画的是「有光源的地方」，这一层画的是
 * 「空气里的光」，depth 在光晕之上、天气/粒子之下。
 */

import Phaser from 'phaser';
import { WORLD } from '../world/palette-data.ts';
import { lightSpots, type LightSpot, type ViewRect } from './light-pools.ts';

const LIGHT_POOL_DEPTH = 8012;

export interface LightPoolView {
  update(view: ViewRect, glow: number, nowMs: number): void;
}

export function createLightPoolView(scene: Phaser.Scene): LightPoolView {
  const g = scene.add.graphics();
  g.setDepth(LIGHT_POOL_DEPTH);
  g.setBlendMode(Phaser.BlendModes.ADD);
  let key = '';

  const draw = (spots: readonly LightSpot[]): void => {
    g.clear();
    for (const spot of spots) {
      // 三级阶梯：外晕 → 中晕 → 暖白芯。像素语言里没有柔边，阶梯就是「柔」。
      g.fillStyle(WORLD.amber, spot.alpha * 0.25);
      g.fillRect(spot.x - 2, spot.y - 2, spot.size + 4, spot.size + 4);
      g.fillStyle(WORLD.amber, spot.alpha * 0.6);
      g.fillRect(spot.x - 1, spot.y - 1, spot.size + 2, spot.size + 2);
      g.fillStyle(WORLD.warmLight, spot.alpha);
      g.fillRect(spot.x, spot.y, spot.size, spot.size);
    }
  };

  return {
    update(view: ViewRect, glow: number, nowMs: number): void {
      const spots = lightSpots(view, glow, nowMs);
      // 镜头不动时每 600ms 才重画：闪烁只需要看起来在动，不必每帧烧指令。
      const next = `${Math.round(view.x)}:${Math.round(view.y)}:${Math.round(glow * 100)}:${Math.floor(nowMs / 600)}`;
      if (next === key) return;
      key = next;
      draw(spots);
    },
  };
}
