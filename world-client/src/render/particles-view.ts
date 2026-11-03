/** 粒子绘制：尘埃（pale，普通叠加）+ 萤火（warmLight/amber，ADD）。
 *
 * 两层分开是为了 blend mode 不同：尘是「空气里的灰」，不该发光；
 * 萤火是光源。合成一个 Graphics 就得二选一。
 */

import Phaser from 'phaser';
import { WORLD } from '../world/palette-data.ts';
import type { Weather } from '../world/types.ts';
import { dustPoints, dustVisible, firefliesVisibleAt, fireflyPoints } from './particles.ts';
import type { ViewRect } from './light-pools.ts';

const DUST_DEPTH = 8013;
const FIREFLY_DEPTH = 8014;

export interface AmbientViewState {
  readonly dim: number;
  readonly glow: number;
  readonly fireflies: boolean;
}

export interface ParticleView {
  update(view: ViewRect, ambient: AmbientViewState, weather: Weather, nowMs: number): void;
}

export function createParticleView(
  scene: Phaser.Scene,
  isWalkable: (point: { x: number; y: number }) => boolean,
): ParticleView {
  const dust = scene.add.graphics();
  dust.setDepth(DUST_DEPTH);
  const fireflies = scene.add.graphics();
  fireflies.setDepth(FIREFLY_DEPTH);
  fireflies.setBlendMode(Phaser.BlendModes.ADD);
  let key = '';

  return {
    update(view, ambient, weather, nowMs): void {
      // 夜 = dim 0.46。白天越亮，尘埃越浓：空气的厚度也分四刻。
      const dayLight = 1 - Math.min(1, ambient.dim / 0.46);
      const showDust = dustVisible(dayLight, weather);
      const showFireflies = firefliesVisibleAt(ambient.fireflies, weather);
      const next = `${Math.round(view.x)}:${Math.round(view.y)}:${Math.round(dayLight * 100)}:${showDust ? 1 : 0}:${showFireflies ? 1 : 0}:${Math.floor(nowMs / 300)}`;
      if (next === key) return;
      key = next;

      dust.clear();
      if (showDust) {
        for (const mote of dustPoints(view, nowMs, dayLight)) {
          dust.fillStyle(WORLD.pale, mote.alpha);
          dust.fillRect(mote.x, mote.y, mote.size, mote.size);
        }
      }

      fireflies.clear();
      if (showFireflies) {
        for (const fly of fireflyPoints(view, nowMs, isWalkable)) {
          fireflies.fillStyle(WORLD.warmLight, fly.alpha);
          fireflies.fillRect(fly.x, fly.y, 1, 1);
          fireflies.fillStyle(WORLD.amber, fly.alpha * 0.55);
          fireflies.fillRect(fly.x + 1, fly.y, 1, 1);
        }
      }
    },
  };
}
