/** 痕迹上屏：把 `NarrativeHint` 画成墙上的几笔。
 *
 * 与 `building-depth.ts` 同一个理由单独成文件：`buildings.ts` 运行时 import 了
 * Phaser，Node 里跑不起来，而这里的位置算术值得被直接验。本文件**完全不提 Phaser**
 * ——它只要求一个能 `fillStyle` / `fillRect` 的东西（`DecalCanvas`），
 * 于是 `test/decal.test.ts` 拿一个记账的假画布就能验「画在哪、画了几笔」。
 *
 * 三条纪律：
 *
 * 1. **只用现有 24 色 token**，不造新色——`audit-palette --strict` 管着预算。
 * 2. **alpha 就是 `visibility`**。风化在画面上只降可见度（协议 §11），这是那句话
 *    唯一的像素证据。浓淡另由 `intensity` 决定（画几笔、画多大），不参与 alpha：
 *    两道同样旧的痕迹，重的那道该更浓，不该更清楚。
 * 3. **位置是确定的**。同一个 `traceId` 永远落在同一处——回放要看得出同一面墙，
 *    而 `Math.random()` 会让每次刷新都换一张脸。
 */

import type { NarrativeHint } from '../world/memory/hints.ts';
import { WORLD } from '../world/palette-data.ts';

/** 画痕迹需要的最小画布。Phaser 的 `Graphics` 结构上满足它。 */
export interface DecalCanvas {
  fillStyle(color: number, alpha?: number): unknown;
  fillRect(x: number, y: number, w: number, h: number): unknown;
}

/**
 * 屋面高度。与 `createBuilding` 里那一行是同一个算式——它决定墙从哪开始，
 * 痕迹要落在墙上而不是瓦上，所以两处必须是同一个数。改这里就是改那儿。
 */
export function roofHeight(h: number): number {
  return Math.max(10, Math.round(h * 0.34));
}

/** 一道痕迹落在墙面上的位置（相对楼体左上角）。 */
export interface DecalSpot {
  readonly x: number;
  readonly y: number;
}

/** 按 traceId 散开的确定位移。只用来让同层的几道痕迹不叠在同一处。 */
function drift(traceId: string): number {
  let hash = 0;
  for (let i = 0; i < traceId.length; i += 1) hash = (hash * 31 + traceId.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * 一道痕迹画在哪。
 *
 * 三种痕迹贴着自己的位置：花环在檐下、磨损在墙脚、其余在墙面中部。
 * 横向按 `traceId` 散开，纵向在各自那一条带子里散开——散开是为了不叠，
 * 但不能散出墙外。
 */
export function decalSpot(hint: NarrativeHint, w: number, h: number, roofH: number): DecalSpot {
  const top = roofH + 3;
  const bottom = Math.max(top + 1, h - 7);
  const bandTop =
    hint.layer === 'garland' ? roofH + 2 : hint.layer === 'worn_path' ? bottom : top + 2;
  const bandHeight = Math.max(1, (hint.layer === 'worn_path' ? h - 4 : bottom) - bandTop);
  const seed = drift(hint.traceId);
  const x = 2 + Math.round(((seed % 97) / 97) * Math.max(1, w - 8));
  const y = bandTop + Math.round((((seed >>> 7) % 89) / 89) * Math.max(0, bandHeight - 4));
  return { x, y };
}

/**
 * 画一道痕迹。每一种层一个固定画法，只用现有 token。
 *
 * 不返回笔数：那是个手维护的数，改了画法就过期，而测试能直接数 `fillRect`。
 * 本仓最不容的就是「读起来像真的、其实没人量过」的常数。
 */
export function drawDecal(
  g: DecalCanvas,
  hint: NarrativeHint,
  w: number,
  h: number,
  roofH: number,
): void {
  const alpha = Math.max(0, Math.min(1, hint.visibility));
  if (alpha === 0) return;
  const { x, y } = decalSpot(hint, w, h, roofH);
  const strength = Math.max(0, Math.min(1, hint.intensity));

  switch (hint.layer) {
    case 'scorch': {
      // 焦痕：一块暗斑 + 一粒余烬。余烬只在烧得狠时露头。
      g.fillStyle(WORLD.ink, alpha);
      g.fillRect(x, y, 5, 4);
      g.fillRect(x + 1, y - 1, 3, 1);
      if (strength >= 0.5) {
        g.fillStyle(WORLD.ember, alpha * 0.8);
        g.fillRect(x + 2, y + 1, 1, 1);
      }
      break;
    }
    case 'damage': {
      // 裂口：一道斜着往下断的缝。
      g.fillStyle(WORLD.timberDark, alpha);
      for (let i = 0; i < 4; i += 1) g.fillRect(x + i, y + i, 1, 2);
      break;
    }
    case 'patch': {
      // 补板：一块新木头压在旧墙上，上缘一条压边。
      g.fillStyle(WORLD.timber, alpha);
      g.fillRect(x, y, 6, 4);
      g.fillStyle(WORLD.timberDark, alpha);
      g.fillRect(x, y, 6, 1);
      break;
    }
    case 'garland': {
      // 花环：檐下一串琥珀点，隔一个点一粒浅色。
      g.fillStyle(WORLD.amber, alpha);
      for (let i = 0; i < 4; i += 1) g.fillRect(x + i * 2, y, 1, 1);
      g.fillStyle(WORLD.pale, alpha * 0.6);
      g.fillRect(x + 1, y + 1, 1, 1);
      break;
    }
    case 'worn_path': {
      // 磨损的小径：墙脚两行石头，越走越亮。
      g.fillStyle(WORLD.stone, alpha);
      g.fillRect(x, y, 6, 1);
      g.fillStyle(WORLD.plaza, alpha * 0.7);
      g.fillRect(x + 1, y + 1, 4, 1);
      break;
    }
    case 'inscription': {
      // 刻痕：一列短记号，像有人在这里记过数。
      g.fillStyle(WORLD.trim, alpha);
      for (let i = 0; i < 3; i += 1) g.fillRect(x, y + i * 2, 1, 1);
      break;
    }
  }
}
