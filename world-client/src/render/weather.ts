/** 雨幕、水洼与低雾。浓淡来自世界快照的 0..1，渲染层只插值，不判断天气。
 *
 * 2026-10-20 视觉语法重做：
 * - 雨分远/中/近三层，远近不同长度与透明度；不再是一排同质的白色斜线。
 * - 地面水洼固定在地面层（depth 2），有 pale 反光与涟漪；不会盖住角色。
 * - 底部低雾用 1px 横带，不用 blur/渐变。
 */

import Phaser from 'phaser';
import { paletteFor } from '../world/theme.ts';
import { TILE_PX } from '../world/setup.ts';
import type { WeatherPin } from './pin-shot-state.ts';

const DROPS = 150;

/** 截图/回归用的确定性雨滴种子。默认 null = 线上行为不变（Math.random）。 */
let rainSeed: number | null = null;
let rainState = 0;

/** 打开确定性雨滴：同一个 seed 得到同一串雨滴序列（截图对比、复跑用）。 */
export function setRainSeed(seed: number | null): void {
  rainSeed = seed === null ? null : seed >>> 0;
  rainState = rainSeed ?? 0;
}

/** 关掉确定性种子，回到 Math.random。 */
export function resetRainRng(): void {
  setRainSeed(null);
}

function rainRandom(): number {
  if (rainSeed === null) return Math.random();
  // LCG（数值常数与截图注入的那一份一致）：跨浏览器/跨帧都稳定。
  rainState = (Math.imul(rainState === 0 ? 0x9e3779b9 : rainState, 1664525) + 1013904223) >>> 0;
  return rainState / 4294967296;
}

/** 固定水洼：只放在建筑下方的空地/路缘，避免落在屋面上。 */
const PUDDLES: readonly { x: number; y: number; w: number }[] = [
  { x: 58, y: 236, w: 18 },
  { x: 104, y: 172, w: 13 },
  { x: 198, y: 252, w: 22 },
  { x: 240, y: 204, w: 16 },
  { x: 296, y: 168, w: 19 },
  { x: 356, y: 272, w: 16 },
  { x: 414, y: 222, w: 13 },
  { x: 146, y: 286, w: 11 },
];

export interface WeatherView {
  readonly drops: Phaser.GameObjects.Graphics;
  readonly dim: Phaser.GameObjects.Rectangle;
  readonly splash: Phaser.GameObjects.Graphics;
  /**
   * `pin` 是**呈现态**（快照之外）：钉住后浓淡用 `pin.intensity`，雨滴从种子
   * 重建后只推进 `pin.frames` 个固定步，之后每帧画同一张雨幕。默认 null =
   * 原路径（读实时浓淡、按 delta 累加），行为与没有它时逐字节相同。
   */
  readonly update: (intensity: number, delta: number, pin?: WeatherPin | null) => void;
}

/**
 * 雨与雾覆盖**整个世界**，不是画布：大世界里雨要下在整片地图上，
 * 镜头移动时不能出现"只有视野在下雨"的边界。
 */
export function createWeatherView(
  scene: Phaser.Scene,
  worldWidth: number,
  worldHeight: number,
): WeatherView {
  const WIDTH = worldWidth;
  const HEIGHT = worldHeight;
  // 截图脚本在加载前写 window.__RAIN_SEED__；页面自身不设，只读。
  const injected = (globalThis as { __RAIN_SEED__?: unknown }).__RAIN_SEED__;
  if (typeof injected === 'number' && Number.isFinite(injected)) setRainSeed(injected);

  // 水洼在地面层：之后画角色/建筑时会自然压住它。
  const puddles = scene.add.graphics();
  puddles.setDepth(2);
  puddles.setVisible(false);

  // 低雾：1px 横带；不用模糊，靠密度与透明度分层。
  const mist = scene.add.graphics();
  mist.setDepth(7999);
  mist.setVisible(false);
  for (let y = HEIGHT - 30; y < HEIGHT; y += 3) {
    mist.fillStyle(paletteFor().water, 0.09);
    mist.fillRect(0, y, WIDTH, 1);
  }
  for (let y = HEIGHT - 18; y < HEIGHT; y += 4) {
    mist.fillStyle(paletteFor().pale, 0.025);
    mist.fillRect(0, y + 1, WIDTH, 1);
  }

  const dim = scene.add.rectangle(0, 0, WIDTH, HEIGHT, paletteFor().cloakDark, 0).setOrigin(0, 0);
  dim.setDepth(8000);

  const drops = scene.add.graphics();
  drops.setDepth(8001);

  const splash = scene.add.graphics();
  splash.setDepth(8002);

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < DROPS; i += 1) {
    xs.push(rainRandom() * WIDTH);
    ys.push(rainRandom() * HEIGHT);
  }
  let elapsed = 0;
  /** 已经应用过的呈现态钉；值不一致时重建雨滴场。 */
  let appliedPin: WeatherPin | null = null;

  /** 只推进雨滴位置与 elapsed，不画。固定步长由调用方决定。 */
  function advance(stepMs: number): void {
    elapsed += stepMs;
    const fall = (stepMs / 1000) * 260;
    for (let i = 0; i < DROPS; i += 1) {
      ys[i] = (ys[i] ?? 0) + fall * (i % 3 === 0 ? 1.25 : 1);
      if ((ys[i] ?? 0) > HEIGHT) {
        ys[i] = -rainRandom() * 40;
        xs[i] = rainRandom() * WIDTH;
      }
    }
  }

  /**
   * 从 `__RAIN_SEED__` 重建雨滴场，再推进 `frames` 个固定步（1000/60 ms/步）。
   * 这样相位只由帧数决定，与墙钟、这一跑实际渲染了多少次无关。
   *
   * **前提**：步长固定按 60Hz（1000/60 ms）理解。若改步进常量或换刷新率口径，
   * `WeatherPin.frames` 不再等价于同一相位，必须重钉一组读数。
   *
   * 没有注入种子时不重建（会把当前画面冻住，`frames` 无效）；截图夹具必须带种子。
   */
  function rebuildToFrames(frames: number): void {
    if (rainSeed === null) return;
    setRainSeed(rainSeed);
    xs.length = 0;
    ys.length = 0;
    for (let i = 0; i < DROPS; i += 1) {
      xs.push(rainRandom() * WIDTH);
      ys.push(rainRandom() * HEIGHT);
    }
    elapsed = 0;
    for (let f = 0; f < frames; f += 1) advance(1000 / 60);
  }

  /** 按当前雨滴场与 elapsed 画一帧。浓淡只影响透明度，不改变位置。 */
  function paint(intensity: number): void {
    drops.clear();

    // 三层雨：远层短、淡；中层主雨；近层长、亮，极少量。
    for (let i = 0; i < DROPS; i += 1) {
      const x = xs[i] ?? 0;
      const y = ys[i] ?? 0;
      if (i % 4 === 0) {
        // 远层：3px，低对比。
        drops.lineStyle(1, paletteFor().pale, 0.14 + intensity * 0.12);
        drops.lineBetween(x, y, x, y + 3);
      } else if (i % 5 === 0) {
        // 近层：7px，亮；画 1px 宽，避免整屏白线。
        drops.lineStyle(1, paletteFor().pale, 0.42 + intensity * 0.38);
        drops.lineBetween(x, y, x - 1, y + 7);
      } else {
        // 中层：5px，部分斜落。
        drops.lineStyle(1, paletteFor().pale, 0.28 + intensity * 0.3);
        drops.lineBetween(x, y, x - (i % 3 === 0 ? 1 : 0), y + 5);
      }
    }

    // 水洼：固定位置 + 涟漪；pale 反光，amber 借一点窗光。
    puddles.clear();
    for (let i = 0; i < PUDDLES.length; i += 1) {
      const p = PUDDLES[i]!;
      puddles.fillStyle(paletteFor().water, 1);
      puddles.fillRect(p.x, p.y, p.w, 2);
      puddles.fillStyle(paletteFor().deepShade, 1);
      puddles.fillRect(p.x + 1, p.y + 2, p.w - 2, 1);
      puddles.fillStyle(paletteFor().pale, 0.5 + intensity * 0.3);
      puddles.fillRect(p.x + 2, p.y, Math.max(2, p.w - 5), 1);
      // 涟漪：宽度按 elapsed 缓慢变化，确定性。
      const phase = Math.floor(elapsed / 500 + i * 2) % 6;
      if (phase < 3) {
        puddles.fillStyle(paletteFor().pale, 0.35);
        puddles.fillRect(p.x + 3 + phase, p.y + 1, Math.max(1, 3 - phase), 1);
      }
      if (i % 2 === 0) {
        puddles.fillStyle(paletteFor().warmLight, 0.4);
        puddles.fillRect(p.x + p.w - 4, p.y, 2, 1);
      }
    }

    // 水花：只在雨强时出现，位置固定在路面附近。
    splash.clear();
    for (let i = 0; i < 18; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const px = Math.abs(x) * WIDTH;
      const py = ((i * 97) % (HEIGHT / TILE_PX)) * TILE_PX + TILE_PX;
      const wobble = i % 3;
      splash.fillStyle(paletteFor().pale, 0.22 * intensity);
      splash.fillRect(px, py, 3 + wobble, 1);
      splash.fillRect(px + 1, py - 1, 1, 1);
    }
  }

  return {
    drops,
    dim,
    splash,
    update(rawIntensity, delta, pin = null) {
      const intensity = pin === null ? rawIntensity : pin.intensity;
      const visible = intensity > 0.02;
      drops.setVisible(visible);
      splash.setVisible(visible);
      puddles.setVisible(visible);
      mist.setVisible(visible);
      dim.setFillStyle(paletteFor().cloakDark, intensity * 0.28);
      if (!visible) {
        drops.clear();
        splash.clear();
        puddles.clear();
        appliedPin = null;
        return;
      }

      // 呈现态钉住：从种子重建到固定帧数，之后每帧只重画，不再推进。
      if (pin !== null) {
        if (appliedPin === null || appliedPin.intensity !== pin.intensity || appliedPin.frames !== pin.frames) {
          rebuildToFrames(pin.frames);
          appliedPin = { intensity: pin.intensity, frames: pin.frames };
        }
        paint(intensity);
        return;
      }

      appliedPin = null;
      // 种子模式按固定步长下落：截图/回归时不受帧 delta 抖动影响，同种子即同画面。
      advance(rainSeed === null ? delta : 1000 / 60);
      paint(intensity);
    },
  };
}
