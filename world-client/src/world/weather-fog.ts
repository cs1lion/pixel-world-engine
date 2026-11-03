/** 天气雾的雾团：**全部长在图内**，并按世界时间漂移。
 *
 * 这条与探索迷雾的 `fog-drift.ts` 是两套东西：那是一张「没去过」的暗角，
 * 在整张已揭示的设定集图上，它的雾团沿揭示半径绕圈，圆心天然落在图外；
 * 这里的是**天气雾**，从种子抽出一组图内坐标，只在图内漂。
 *
 * 三个可测的量：
 * - `WEATHER_FOG_PUFFS`：雾团总数，全部在图内；
 * - `weatherFogPuffs(seed, grid, t)`：给定时刻的各团圆心与半径；
 * - 同一团在 `t` 与 `t + 10s` 的圆心距离，可测漂移。
 */

import type { GridPoint } from './types.ts';
import { seedOf, unitFromSeed } from './memory/seed.ts';

/** 雾团总数。18 团铺满 64×48 的设定集图，镜头里不会出现大片空白。 */
export const WEATHER_FOG_PUFFS = 18;

/** 三档半径（格），按序轮换，避免 18 团看起来是同一枚印章。 */
export const WEATHER_FOG_RADII = [2.6, 3.4, 4.2] as const;

/** 雾团圆心距图边至少这么多格：半径 4.2 + 漂移 2.4 + 1 格余量 = 7.6，取 8。 */
export const WEATHER_FOG_MARGIN_CELLS = 8;

/** 漂移振幅（格）。 */
const DRIFT_X = 1.4;
const DRIFT_Y = 1.2;

/** 雾团的漂移速度：10 秒走约 0.5–1.3 格，肉眼看得见，又不至于扫出图外。 */
const DRIFT_RATE_X = 0.055;
const DRIFT_RATE_Y = 0.04;

export interface WeatherFogPuff {
  readonly at: GridPoint;
  readonly radius: number;
  readonly alpha: number;
}

const COLS = 6;
const ROWS = 3;

/**
 * 某一时刻的雾团。
 *
 * 圆心由「6 列 × 3 行的格心 + 种子抖动 + 正弦漂移」得到；抖动与相位都过 `seedOf`，
 * 同一 `seed` 与 `timeMs` 两次调用逐项相同，换种子整组换位。
 */
export function weatherFogPuffs(
  seed: string,
  grid: { readonly width: number; readonly height: number },
  timeMs: number,
): readonly WeatherFogPuff[] {
  const seconds = Math.max(0, timeMs) / 1000;
  const width = Math.max(1, grid.width);
  const height = Math.max(1, grid.height);
  const margin = Math.min(WEATHER_FOG_MARGIN_CELLS, Math.min(width, height) / 2);
  const usableW = Math.max(1, width - margin * 2);
  const usableH = Math.max(1, height - margin * 2);
  const cellW = usableW / COLS;
  const cellH = usableH / ROWS;

  const puffs: WeatherFogPuff[] = [];
  for (let index = 0; index < WEATHER_FOG_PUFFS; index += 1) {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    // 抖动只占半格，保证每团都落在自己的格子里，不叠成一团。
    const jitterX = (unitFromSeed(seedOf(seed, 'weather-fog', index, 'x')) - 0.5) * 0.5;
    const jitterY = (unitFromSeed(seedOf(seed, 'weather-fog', index, 'y')) - 0.5) * 0.5;
    const baseX = margin + (col + 0.5 + jitterX) * cellW;
    const baseY = margin + (row + 0.5 + jitterY) * cellH;
    const phase = unitFromSeed(seedOf(seed, 'weather-fog', index, 'phase')) * Math.PI * 2;
    const ampX = DRIFT_X + unitFromSeed(seedOf(seed, 'weather-fog', index, 'amp')) * 0.6;
    const radius = WEATHER_FOG_RADII[index % WEATHER_FOG_RADII.length] as number;

    const x = clamp(baseX + Math.sin(seconds * DRIFT_RATE_X + phase) * ampX, radius + 1, width - radius - 1);
    const y = clamp(
      baseY + Math.cos(seconds * DRIFT_RATE_Y + phase * 1.7) * (ampX * DRIFT_Y / DRIFT_X),
      radius + 1,
      height - radius - 1,
    );

    puffs.push({
      at: { x, y },
      radius,
      alpha: 0.32 + unitFromSeed(seedOf(seed, 'weather-fog', index, 'alpha')) * 0.28,
    });
  }
  return puffs;
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return (low + high) / 2;
  return Math.min(high, Math.max(low, value));
}
