/** 天气雾视图：一层压暗 + 图内漂移的雾团。
 *
 * 与 `fog-view.ts`（探索迷雾）分开：
 * - 探索迷雾的雾团沿「揭示半径」绕圈，圆心可以落在图外；这里只画**图内**的团；
 * - 这里的团来自 `world/weather-fog.ts`，坐标全部过边界夹取，圆心与半径都在图内；
 * - 深度 7997：压在世界与人物之上、雨幕（7999+）之下。雾天不落雨点，
 *   所以这两层不会同时出现。
 *
 * 密度由世界层给（`Simulation.weatherFogDensity()`），渲染层不自己判天气。
 *
 * ── 2026-11-07：逐方块 Graphics 改成烘焙纹理 ─────────────────────────────
 * 旧写法每帧 `puffs.clear()` 后重画 18 团、每团按 8px 方块铺满圆盘：实测
 * 2,646 块 × 8 条 commandBuffer（`fillStyle` 3 + `fillRect` 5）= 21,168 条，
 * 占整场景峰值 52,125 的 40%。雾团形状只由半径决定（三档），每帧变的是位置
 * 与整体透明度——这正是可以烘的：三张按半径烘好的纹理，18 个 Image 每帧只挪
 * 位置、改 alpha，不再产生任何绘制指令。
 *
 * 与旧读数的差别：纹理按 8px 网格烘焙，方块落点用 `round(dx)`；旧写法是
 * 逐块 `round(cx + dx)`。两者可能差 1px（雾是半透明覆盖层，肉眼不可见）。
 */

import Phaser from 'phaser';
import { WORLD } from '../world/palette-data.ts';
import { TILE_PX } from '../world/setup.ts';
import { weatherFogPuffs } from '../world/weather-fog.ts';

const VEIL_DEPTH = 7996;
const PUFF_DEPTH = 7997;
/** 雾块边长，与探索迷雾同口径：8px 在 2 倍显示下看不出阶梯。 */
const BLOCK_PX = 8;
/** 纹理里单块的基准 alpha；运行时再乘 `puff.alpha * shown`。 */
const BLOCK_ALPHA = 0.32;
/** 密度变化的最短过渡（毫秒）：天气切成晴时，雾幕 0.3 秒内退完。 */
const FADE_MS = 300;
const PUFF_TEX_PREFIX = 'weather-fog-puff';

export interface WeatherFogView {
  /** `density` 0..1；`timeMs` 是世界时间，驱动雾团漂移。 */
  update(density: number, timeMs: number): void;
  destroy(): void;
}

/** 按半径烘一张雾团纹理：圆盘内 8px 方块，alpha = 0.32 × falloff。 */
function bakePuffTexture(scene: Phaser.Scene, radiusCells: number): string {
  const key = `${PUFF_TEX_PREFIX}-${radiusCells}`;
  const r = radiusCells * TILE_PX;
  const size = Math.ceil(r) * 2 + 16;
  const center = size / 2;
  const g = scene.make.graphics({}, false);
  for (let dy = -r; dy <= r; dy += BLOCK_PX) {
    for (let dx = -r; dx <= r; dx += BLOCK_PX) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      const falloff = (1 - d) * (1 - d);
      g.fillStyle(WORLD.water, BLOCK_ALPHA * falloff);
      g.fillRect(center + Math.round(dx), center + Math.round(dy), BLOCK_PX, BLOCK_PX);
    }
  }
  // 同名纹理会被 generateTexture 直接复用，旧内容就留在画面上。
  if (scene.textures.exists(key)) scene.textures.remove(key);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
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

  // 半径只由团序号决定，形状不随时间变：启动时按半径烘三张，之后只挪精灵。
  const initial = weatherFogPuffs(seed, grid, 0);
  const keys = new Map<number, string>();
  for (const puff of initial) {
    if (!keys.has(puff.radius)) keys.set(puff.radius, bakePuffTexture(scene, puff.radius));
  }
  const puffs = initial.map((puff) =>
    scene.add
      .image(0, 0, keys.get(puff.radius) as string)
      .setDepth(PUFF_DEPTH)
      .setVisible(false),
  );

  let shown = 0;
  let lastTimeMs: number | null = null;

  const hidePuffs = (): void => {
    for (const sprite of puffs) sprite.setVisible(false);
  };

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
      if (!visible) {
        hidePuffs();
        return;
      }

      veil.setFillStyle(WORLD.water, 0.3 * shown);
      const current = weatherFogPuffs(seed, grid, timeMs);
      for (let index = 0; index < puffs.length; index += 1) {
        const sprite = puffs[index] as Phaser.GameObjects.Image;
        const puff = current[index];
        if (puff === undefined) {
          sprite.setVisible(false);
          continue;
        }
        // 圆心对齐整像素：旧写法逐块 round，纹理只在局部固定网格上铺。
        sprite.setPosition(Math.round(puff.at.x * TILE_PX), Math.round(puff.at.y * TILE_PX));
        sprite.setAlpha(puff.alpha * shown);
        sprite.setVisible(true);
      }
    },
    destroy(): void {
      veil.destroy();
      for (const sprite of puffs) sprite.destroy();
      for (const key of keys.values()) {
        if (scene.textures.exists(key)) scene.textures.remove(key);
      }
    },
  };
}
