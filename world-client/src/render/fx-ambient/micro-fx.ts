/** 环境微动效（草摆 / 雨涟漪 / 夜萤火 / 昼鸟影）——纯装饰层。
 *
 * 三条硬规矩（`test/layer-guard.test.ts` 守前两条，第三条写在 `budgetFor` 里）：
 *   1. **不 import `src/world/`**：本层只收普通读数（格坐标数组、可见区、
 *      时刻、雨强），不认识 WorldGrid / TerrainId，也就写不了世界；
 *   2. **不许出现 `WorldState` 标识符**：碰了类型迟早碰写入；
 *   3. **每帧开销有上限**：只画可见区内的东西，条数由调用方给的视野格数
 *      决定，不由世界大小决定。
 *
 * 时间与随机见 `visual-clock.ts`（本层唯一入口）。一格的像素边长也是入参：
 * 它只是画尺，不是判据，所以宁可让调用方递进来也不越过第 1 条边界。
 */

import Phaser from 'phaser';

import { cyclePhase, swing, visualNoise } from './visual-clock.ts';

/** 当前世界的画尺（一格 16 像素）。缺省值与 `world/setup.ts#TILE_PX` 同数，
 *  但**不 import 它**——那条 import 会撞本层的防火墙（见文件头第 1 条）。 */
export const DEFAULT_TILE_PX = 16;

/** 视野（格坐标）：本层眼里只有「哪几格在屏幕上」。 */
export interface FxView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 一格的草相：位置与「这格长不长草」由调用方给，摆幅由本层算。 */
export interface GrassBlade {
  readonly x: number;
  readonly y: number;
  /** 摆幅（像素）：草尖水平位移。 */
  readonly dx: number;
  /** 相位偏移 0..1：让相邻的草不同时摆，才读成「一阵风过去」。 */
  readonly offset: number;
}

/**
 * 从「哪些格是草地」翻出草相。返回半数：全铺会糊成一片绿雾，
 * 留白才透气，也让风的走向读得出来。
 */
export function grassBladesFor(
  cells: readonly { readonly x: number; readonly y: number; readonly grass: boolean }[],
): GrassBlade[] {
  const out: GrassBlade[] = [];
  for (const cell of cells) {
    if (!cell.grass) continue;
    const noise = visualNoise(cell.x, cell.y);
    if (noise < 0.45) continue;
    out.push({
      x: cell.x,
      y: cell.y,
      // 摆幅 1/2 两档：全 2 会像集体做操，全 1 又看不出 gust。
      dx: noise > 0.85 ? 2 : 1,
      offset: noise,
    });
  }
  return out;
}

/**
 * 这一帧草尖的水平位移（整数像素）。
 *
 * 整数是硬要求：亚像素摆动在 1× 缩放下只是糊边，读起来像抖动而不是风。
 */
export function grassSwayPx(blade: GrassBlade, nowMs: number, windGain: number): number {
  const phase = cyclePhase(nowMs, 2400) + blade.offset;
  const raw = Math.round(swing(phase) * blade.dx * windGain);
  // `Math.round(-0)` 是 `-0`，像素上与 0 同值：归一掉，别让严格比较假红。
  return raw === 0 ? 0 : raw;
}

/** 雨涟漪：落点按格哈希固定，出现与消散由时刻决定。 */
export interface RainRipple {
  readonly x: number;
  readonly y: number;
  /** 0..1：半径进度（0 = 刚落地，1 = 散尽）。 */
  readonly progress: number;
}

/**
 * 可见区里的涟漪。`density` 是「一格有几成概率正在起一圈」（0 就不画）。
 * 每格按自己的哈希错峰，否则整片地皮会同时跳。
 */
export function rainRipplesFor(view: FxView, nowMs: number, density: number): RainRipple[] {
  if (density <= 0) return [];
  const out: RainRipple[] = [];
  const phase = cyclePhase(nowMs, 700);
  for (let cy = view.y; cy < view.y + view.height; cy += 1) {
    for (let cx = view.x; cx < view.x + view.width; cx += 1) {
      const noise = visualNoise(cx, cy);
      if (noise > density) continue;
      out.push({ x: cx, y: cy, progress: (phase + noise) % 1 });
    }
  }
  return out;
}

/** 会飘的小点（夜萤火 / 昼鸟影）：位置 = 锚点 + 由时刻算的漂移。 */
export interface DriftDot {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
}

export function driftDotsFor(
  anchors: readonly { readonly x: number; readonly y: number; readonly phase: number }[],
  nowMs: number,
  kind: 'firefly' | 'bird',
): DriftDot[] {
  const period = kind === 'firefly' ? 3600 : 6000;
  const amp = kind === 'firefly' ? 3 : 2;
  return anchors.map((anchor) => {
    const phase = cyclePhase(nowMs, period) + anchor.phase;
    const dx = Math.round(swing(phase) * amp);
    // 萤火上下快、鸟上下慢：两种节奏一混就分不清是虫还是鸟。
    const dy = Math.round(swing(phase * (kind === 'firefly' ? 1.7 : 0.5)) * (kind === 'firefly' ? 2 : 1));
    const blink = kind === 'firefly' ? 0.35 + 0.65 * Math.abs(swing(phase * 2.3)) : 0.8;
    return { x: anchor.x + dx, y: anchor.y + dy, alpha: blink };
  });
}

/** 每帧的绘制条数上限（按可见区格数算，世界再大也不涨）。 */
export function budgetFor(view: { readonly width: number; readonly height: number }): {
  readonly maxGrass: number;
  readonly maxRipples: number;
  readonly maxDots: number;
} {
  const cells = Math.max(1, view.width * view.height);
  return {
    // 与 `grassBladesFor` 的 0.45 阈值同口径：一半格子里长得出草。
    maxGrass: Math.ceil(cells * 0.5),
    // 涟漪封顶：雨暴时可见区全是圈会把地形糊掉。
    maxRipples: Math.min(600, Math.ceil(cells * 0.35)),
    maxDots: 64,
  };
}

/** 微动效层的一帧输入。全是读数，没有判据。 */
export interface MicroFxFrame {
  readonly nowMs: number;
  readonly view: FxView;
  readonly grass: readonly GrassBlade[];
  /** 0..1 风增益；无风也留 0.25 微摆，静止的草会读成塑料。 */
  readonly wind: number;
  readonly rainDensity: number;
  readonly dots: readonly { readonly x: number; readonly y: number; readonly phase: number }[];
  readonly night: boolean;
  /** 画尺：一格多少像素。缺省 16。 */
  readonly tilePx?: number;
}

/** 本帧实际画了多少（证据读数，不是判据）。 */
export interface MicroFxStats {
  readonly grass: number;
  readonly ripples: number;
  readonly dots: number;
  readonly hidden: boolean;
}

export interface MicroFxView {
  readonly update: (frame: MicroFxFrame) => void;
  readonly setHidden: (value: boolean) => void;
  /** 上一帧的实画条数：无头冒烟用它证明「这一层真的在跑，而不是挂着没画」。 */
  readonly stats: () => MicroFxStats;
  readonly destroy: () => void;
}

/**
 * 建微动效层。
 *
 * **一块常驻 Graphics**：`renderStats` 数的是顶层 Graphics，多开一层就多
 * 一条账；本层每帧 clear 重画，可见区内最多几百条 `fillRect`，与雨幕同量级。
 * 深度给一个「在地形与楼之上、HUD 与人物标签之下」的固定值——本层不认识
 * 世界的分层表，所以只写数不引表。
 */
export function createMicroFxView(
  scene: Phaser.Scene,
  palette: { readonly grassTint: number; readonly rippleTint: number; readonly dotTint: number },
  depth = 640,
): MicroFxView {
  const g = scene.add.graphics();
  g.setDepth(depth);
  let hidden = false;
  let last: MicroFxStats = { grass: 0, ripples: 0, dots: 0, hidden: false };

  return {
    stats: () => last,
    update(frame) {
      g.clear();
      if (hidden) {
        last = { grass: 0, ripples: 0, dots: 0, hidden: true };
        return;
      }
      const tilePx = frame.tilePx ?? DEFAULT_TILE_PX;
      const budget = budgetFor(frame.view);
      let grassDrawn = 0;
      let rippleDrawn = 0;

      // 草尖：2×1 的亮色短横，跟着风水平挪 0..2px。
      g.fillStyle(palette.grassTint, 0.5);
      let drawn = 0;
      for (const blade of frame.grass) {
        if (drawn >= budget.maxGrass) break;
        if (blade.x < frame.view.x || blade.x >= frame.view.x + frame.view.width) continue;
        if (blade.y < frame.view.y || blade.y >= frame.view.y + frame.view.height) continue;
        const dx = grassSwayPx(blade, frame.nowMs, frame.wind);
        g.fillRect(blade.x * tilePx + 6 + dx, blade.y * tilePx + 11, 2, 1);
        drawn += 1;
        grassDrawn += 1;
      }

      // 雨涟漪：1px 线宽的方框，尺寸随进度长到 8px。像素世界里四条短边
      // 比八分之一圆读得像水花，而且不需要抗锯齿。
      const ripples = rainRipplesFor(frame.view, frame.nowMs, frame.rainDensity).slice(0, budget.maxRipples);
      g.lineStyle(1, palette.rippleTint, 0.4);
      for (const ripple of ripples) {
        rippleDrawn += 1;
        const r = 1 + Math.round(ripple.progress * 4);
        g.strokeRect(ripple.x * tilePx + 8 - r, ripple.y * tilePx + 8 - r, r * 2, r * 2);
      }

      // 夜萤火 1px、昼鸟影 2px：闪烁由 alpha 给。
      const dots = driftDotsFor(frame.dots, frame.nowMs, frame.night ? 'firefly' : 'bird')
        .slice(0, budget.maxDots);
      for (const dot of dots) {
        g.fillStyle(palette.dotTint, dot.alpha);
        g.fillRect(dot.x, dot.y, frame.night ? 1 : 2, 1);
      }
      last = { grass: grassDrawn, ripples: rippleDrawn, dots: dots.length, hidden: false };
    },
    setHidden(value) {
      hidden = value;
      if (value) {
        g.clear();
        last = { grass: 0, ripples: 0, dots: 0, hidden: true };
      }
    },
    destroy() {
      g.destroy();
    },
  };
}
