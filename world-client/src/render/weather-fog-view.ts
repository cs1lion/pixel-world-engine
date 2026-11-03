/** 天气雾视图：一层压暗 + 图内漂移的雾团。
 *
 * 与 `fog-view.ts`（探索迷雾）分开：
 * - 探索迷雾的雾团沿「揭示半径」绕圈，圆心可以落在图外；这里只画**图内**的团；
 * - 这里的团来自 `world/weather-fog.ts`，坐标全部过边界夹取，圆心与半径都在图内；
 * - 深度 7997：压在世界与人物之上、雨幕（7999+）之下。雾天不落雨点，
 *   所以这两层不会同时出现。
 *
 * 密度由世界层给（`Simulation.weatherFogDensity()`），渲染层不自己判天气。
 */

import Phaser from 'phaser';
import { WORLD } from '../world/palette-data.ts';
import { TILE_PX } from '../world/setup.ts';
import { weatherFogPuffs } from '../world/weather-fog.ts';

const VEIL_DEPTH = 7996;
const PUFF_DEPTH = 7997;
/** 雾块边长，与探索迷雾同口径：8px 在 2 倍显示下看不出阶梯。 */
const BLOCK_PX = 8;
/** 密度变化的最短过渡（毫秒）：天气切成晴时，雾幕 0.3 秒内退完。 */
const FADE_MS = 300;

export interface WeatherFogView {
  /** `density` 0..1；`timeMs` 是世界时间，驱动雾团漂移。 */
  update(density: number, timeMs: number): void;
  destroy(): void;
}

export function createWeatherFogView(
  scene: Phaser.Scene,
  grid: { readonly width: number; readonly height: number },
  seed: string,
): WeatherFogView {
  const worldWidth = grid.width * TILE_PX;
  const worldHeight = grid.height * TILE_PX;
  const veil = scene.add.rectangle(0, 0, worldWidth, worldHeight, WORLD.water, 0);
  veil.setOrigin(0, 0).setDepth(VEIL_DEPTH).setVisible(false);
  const puffs = scene.add.graphics().setDepth(PUFF_DEPTH).setVisible(false);

  let shown = 0;
  let lastTimeMs: number | null = null;

  return {
    update(density: number, timeMs: number): void {
      const target = Math.min(1, Math.max(0, density));
      // 用两帧世界时间的差做平滑；第一帧没有差值就按到位算。
      const delta = lastTimeMs === null ? FADE_MS : Math.max(0, timeMs - lastTimeMs);
      lastTimeMs = timeMs;
      const step = Math.min(1, delta / FADE_MS);
      shown += (target - shown) * step;
      if (Math.abs(target - shown) < 0.01) shown = target;

      const visible = shown > 0.01;
      veil.setVisible(visible);
      puffs.setVisible(visible);
      if (!visible) {
        puffs.clear();
        return;
      }

      veil.setFillStyle(WORLD.water, 0.3 * shown);
      puffs.clear();
      for (const puff of weatherFogPuffs(seed, grid, timeMs)) {
        const cx = puff.at.x * TILE_PX;
        const cy = puff.at.y * TILE_PX;
        const r = puff.radius * TILE_PX;
        for (let dy = -r; dy <= r; dy += BLOCK_PX) {
          for (let dx = -r; dx <= r; dx += BLOCK_PX) {
            const d = Math.hypot(dx, dy) / r;
            if (d > 1) continue;
            const px = Math.round(cx + dx);
            const py = Math.round(cy + dy);
            // 只画图内的砖：即使未来有人改了半径/边距，也不会在画布外留半团。
            if (px < 0 || py < 0 || px >= worldWidth || py >= worldHeight) continue;
            const falloff = (1 - d) * (1 - d);
            puffs.fillStyle(WORLD.water, puff.alpha * shown * 0.32 * falloff);
            puffs.fillRect(px, py, BLOCK_PX, BLOCK_PX);
          }
        }
      }
    },
    destroy(): void {
      veil.destroy();
      puffs.destroy();
    },
  };
}
