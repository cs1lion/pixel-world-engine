/**
 * 设定集人物的逐帧采样与读数。
 *
 * 帧号只由步进计数决定（`villagerPose` 的纯函数），矩形来自纯布局函数；
 * 这里不读真实时钟、不用 `Math.random`，同一输入两次采样必然逐格相同。
 *
 * 「帧差」分两种口径：
 *   - `raw`：按渲染原样比，含 1px 整体上下浮；
 *   - `structural`：先减掉该帧的 `offsetY` 再比，只留帧内动作。
 * 只有 structural 能证明「不是拿整体位移糊过去」。
 */
import type { VillagerSnapshot } from '../world/types.ts';
import type { VillagerLook } from '../world/villager-look.ts';
import {
  FRAME_MS,
  IDLE_FRAMES,
  WALK_FRAMES,
  villagerPose,
  type VillagerPose,
} from './villager-frames.ts';
import { VILLAGER_H, VILLAGER_W, villagerLayout, type PixelRect } from './villager-layout.ts';
import { maskFromRects, type SilhouetteMask } from './silhouette-match.ts';

export const CAST_MOTION_VIEWS = ['down', 'right', 'up'] as const;
export type CastMotionView = (typeof CAST_MOTION_VIEWS)[number];
export const CAST_MOTION_FRAMES = { idle: IDLE_FRAMES, walk: WALK_FRAMES } as const;

/** 第 `index` 帧的姿态：时间只用来落在第 index 个步进里，不读真实时钟。 */
export function castFramePose(walking: boolean, index: number): VillagerPose {
  return villagerPose('idle', walking, index * FRAME_MS + FRAME_MS / 2);
}

export function castFrameRects(
  look: VillagerLook,
  facing: CastMotionView,
  walking: boolean,
  index: number,
): readonly PixelRect[] {
  return villagerLayout(
    look,
    facing as VillagerSnapshot['facing'],
    castFramePose(walking, index),
    walking,
    'idle',
    0,
  );
}

/** 减掉整体上下浮，只留帧内动作。 */
export function structuralRects(
  look: VillagerLook,
  facing: CastMotionView,
  walking: boolean,
  index: number,
): readonly PixelRect[] {
  const lift = castFramePose(walking, index).offsetY;
  return castFrameRects(look, facing, walking, index).map((item) => ({ ...item, y: item.y - lift }));
}

/** 某一帧的剪影；与静止母本同一套 24×30 画布。 */
export function castFrameMask(
  look: VillagerLook,
  facing: CastMotionView,
  walking: boolean,
  index: number,
): SilhouetteMask {
  return maskFromRects(structuralRects(look, facing, walking, index));
}

/** 某一帧画完后的逐格颜色（key = "x,y"），用来算帧间像素差。 */
export function castFramePixels(
  look: VillagerLook,
  facing: CastMotionView,
  walking: boolean,
  index: number,
): Map<string, string> {
  const pixels = new Map<string, string>();
  for (const item of structuralRects(look, facing, walking, index)) {
    for (let y = item.y; y < item.y + item.h; y += 1) {
      const gy = y + VILLAGER_H;
      if (gy < 0 || gy >= VILLAGER_H) continue;
      for (let x = item.x; x < item.x + item.w; x += 1) {
        const gx = x + VILLAGER_W / 2;
        if (gx < 0 || gx >= VILLAGER_W) continue;
        pixels.set(`${gx},${gy}`, item.paint);
      }
    }
  }
  return pixels;
}

/** 两帧之间「位置或颜色」不同的格子数。 */
export function framePixelDiff(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): number {
  let diff = 0;
  for (const [key, paint] of a) {
    if (b.get(key) !== paint) diff += 1;
  }
  for (const key of b.keys()) {
    if (!a.has(key)) diff += 1;
  }
  return diff;
}

/** 每行最左/最右/宽度；行宽复测与证据表都用它。 */
export function rowExtents(mask: SilhouetteMask): {
  readonly lefts: readonly number[];
  readonly rights: readonly number[];
  readonly widths: readonly number[];
} {
  const lefts = new Array<number>(VILLAGER_H).fill(-1);
  const rights = new Array<number>(VILLAGER_H).fill(-1);
  const widths = new Array<number>(VILLAGER_H).fill(0);
  for (let y = 0; y < VILLAGER_H; y += 1) {
    for (let x = 0; x < VILLAGER_W; x += 1) {
      if (mask.cells[y * VILLAGER_W + x] !== 1) continue;
      if (lefts[y] === -1) lefts[y] = x;
      rights[y] = x;
    }
    const left = lefts[y] as number;
    const right = rights[y] as number;
    widths[y] = right < 0 ? 0 : right - left + 1;
  }
  return { lefts, rights, widths };
}

/** 某一帧相对母本（静止 frame 0）的最大单行宽度差。 */
export function maxRowWidthDelta(
  base: SilhouetteMask,
  frame: SilhouetteMask,
): { readonly delta: number; readonly row: number } {
  const a = rowExtents(base).widths;
  const b = rowExtents(frame).widths;
  let delta = 0;
  let row = -1;
  for (let y = 0; y < VILLAGER_H; y += 1) {
    const change = Math.abs((b[y] as number) - (a[y] as number));
    if (change > delta) {
      delta = change;
      row = y;
    }
  }
  return { delta, row };
}
