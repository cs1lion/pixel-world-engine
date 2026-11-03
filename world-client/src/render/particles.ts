/** 空气里的粒子：白天尘埃、夜里萤火。纯数据，不碰 Phaser。
 *
 * 雨不在这一层：`weather.ts` 已经有 150 滴分层雨、水洼与溅点，它按天气强度走。
 * 这里只做「晴天」的两类，并把「下雨时没有尘/萤火」这条门放在纯函数里，
 * 好让测试真的能跑到红。
 *
 * 位置全部由「世界格 + 时间档」哈希得到；同一格、同一档必得同一串，
 * 镜头平移不闪、截图可复现。
 */

import type { Weather } from '../world/types.ts';
import type { ViewRect } from './light-pools.ts';

export interface Particle {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly alpha: number;
}

function hash2(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 白天有尘埃、夜里没有；下雨/暴雨一律没有。 */
export function dustVisible(dayLight: number, weather: Weather): boolean {
  return weather === 'clear' && dayLight > 0.08;
}

/** 夜里且晴天才有萤火。与 `day-phase.ts` 的 `firefliesVisible` 同一语义。 */
export function firefliesVisibleAt(ambientFireflies: boolean, weather: Weather): boolean {
  return ambientFireflies && weather === 'clear';
}

/** 一屏最多多少枚尘埃 / 萤火：再多是噪点，也白烧指令。 */
export const DUST_MAX = 40;
export const FIREFLY_MAX = 12;

/**
 * 尘埃。`dayLight` 0（夜）→ 1（正午）；浓度随它走，所以空气的厚度也分四刻。
 *
 * 漂移只用 sin/cos + 时间，不取随机数：同一时刻同一格仍是同一处，
 * 只是围着格心 ±2px 浮动。
 */
export function dustPoints(view: ViewRect, nowMs: number, dayLight: number): readonly Particle[] {
  if (!(dayLight > 0.08)) return [];
  const cell = 16;
  const x0 = Math.floor(view.x / cell);
  const x1 = Math.ceil((view.x + view.w) / cell);
  const y0 = Math.floor(view.y / cell);
  const y1 = Math.ceil((view.y + view.h) / cell);
  const out: Particle[] = [];
  for (let gy = y0; gy < y1; gy += 1) {
    for (let gx = x0; gx < x1; gx += 1) {
      // 每 4 格里最多一枚：疏密适中，不会盖住地形纹理。
      if (hash2(gx, gy, 401) >= 0.12) continue;
      const phase = hash2(gx, gy, 503) * Math.PI * 2;
      const driftX = Math.round(Math.sin(nowMs / 1400 + phase) * 2);
      const driftY = Math.round(Math.cos(nowMs / 1100 + phase) * 2);
      out.push({
        x: gx * cell + 4 + Math.round(hash2(gx, gy, 607) * 8) + driftX,
        y: gy * cell + 4 + Math.round(hash2(gx, gy, 709) * 8) + driftY,
        size: 1,
        alpha: (0.05 + 0.09 * dayLight) * (0.55 + 0.45 * hash2(gx, gy, 811)),
      });
    }
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out.slice(0, DUST_MAX);
}

/**
 * 萤火。只在**可行走**的格子上生成：否则会出现在屋顶/树干里。
 *
 * 判据由调用方递进来（渲染层不该拥有世界网格），纯函数只负责采样与脉冲。
 */
export function fireflyPoints(
  view: ViewRect,
  nowMs: number,
  isWalkable: (point: { x: number; y: number }) => boolean,
): readonly Particle[] {
  const cell = 16;
  const x0 = Math.floor(view.x / cell);
  const x1 = Math.ceil((view.x + view.w) / cell);
  const y0 = Math.floor(view.y / cell);
  const y1 = Math.ceil((view.y + view.h) / cell);
  const out: Particle[] = [];
  for (let gy = y0; gy < y1; gy += 1) {
    for (let gx = x0; gx < x1; gx += 1) {
      if (hash2(gx, gy, 907) >= 0.18) continue;
      if (!isWalkable({ x: gx, y: gy })) continue;
      const pulse = Math.sin(nowMs / 700 + hash2(gx, gy, 1009) * 6.28);
      if (pulse < -0.15) continue;
      out.push({
        x: gx * cell + 4 + Math.round(hash2(gx, gy, 1103) * 8),
        y: gy * cell + 4 + Math.round(hash2(gx, gy, 1201) * 8),
        size: 1,
        alpha: 0.22 + 0.5 * ((pulse + 1) / 2),
      });
    }
  }
  // 同一格只留一枚；按 y 排序后截断，顺序可复现。
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out.slice(0, FIREFLY_MAX);
}
