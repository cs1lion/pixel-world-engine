/** 世界坐标 → DOM overlay 的纯投影/锚点数学（D5-A：按 canvas 实际位置统一换算）。
 *
 * 只做数学、不碰 DOM/Phaser，方便单测 100%–400%、滚动与相机缩放。
 * DOM 侧见 `world-overlay.ts`；本文件负责“同一个换算公式只写一次”。
 */

import { TILE_PX } from '../world/setup.ts';
import { GRIME_CLEAN } from '../world/grime.ts';
import type { VillagerSnapshot } from '../world/types.ts';

export interface OverlayRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Phaser 相机与画布在某一帧的实际口径。 */
export interface OverlayViewport {
  readonly rect: OverlayRect;
  readonly gameWidth: number;
  readonly gameHeight: number;
  readonly cameraWorldX: number;
  readonly cameraWorldY: number;
  readonly cameraZoom: number;
}

export interface OverlayPoint {
  readonly x: number;
  readonly y: number;
}

/** 世界像素 → overlay 内 CSS 像素（相对 overlay 左上角）。 */
export function projectWorldToOverlay(
  worldX: number,
  worldY: number,
  viewport: OverlayViewport,
): OverlayPoint {
  const internalX = (worldX - viewport.cameraWorldX) * viewport.cameraZoom;
  const internalY = (worldY - viewport.cameraWorldY) * viewport.cameraZoom;
  return {
    x: internalX * (viewport.rect.width / viewport.gameWidth),
    y: internalY * (viewport.rect.height / viewport.gameHeight),
  };
}

/** 取整到设备像素，避免非整数 DPR 下 1px 抖动。 */
export function snapToDevicePixel(cssValue: number, dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return Math.round(cssValue);
  return Math.round(cssValue * dpr) / dpr;
}

export interface LabelAnchors {
  readonly name: OverlayPoint | null;
  readonly bubble: OverlayPoint | null;
}

/**
 * 角色名字/气泡的锚点：与旧 canvas 文本相对容器的偏移一致
 * （名字 -30、气泡 -36，单位世界像素）；隐藏规则也沿用旧实现。
 */
export function villagerLabelAnchors(
  villager: VillagerSnapshot,
  viewport: OverlayViewport,
): LabelAnchors {
  if (!villager.visible) return { name: null, bubble: null };
  const worldX = (villager.pos.x + 0.5) * TILE_PX;
  const worldY = (villager.pos.y + 1) * TILE_PX;
  const bubble = projectWorldToOverlay(worldX, worldY - 36, viewport);
  if (villager.bubble !== null) {
    return { name: null, bubble };
  }
  return { name: projectWorldToOverlay(worldX, worldY - 30, viewport), bubble: null };
}

/** 屏幕像素下的对齐误差（逻辑像素），供 smoke/QA 断言用。 */
export function alignmentError(
  actual: OverlayPoint,
  expected: OverlayPoint,
  cssPerLogical = 1,
): number {
  const dx = actual.x - expected.x;
  const dy = actual.y - expected.y;
  return Math.hypot(dx, dy) / cssPerLogical;
}

/** 露话看得见吗（SPEC_V2 §4.6 的清洗即还原）。 */
export interface RevealState {
  readonly reveal: string | null;
  readonly grime: number;
}

/**
 * 这句话此刻看得见吗：底下的格子里得真有一句，而且泥已经洗干净了。
 *
 * 两个条件都不能少。只判 `reveal !== null` 的话，脏着的时候那句话就明面上
 * 摆着——「露」这个字就没有意义了，玩家洗之前就已经读完。
 * 只判 `grime` 的话，没有露话的摆件（莞尔镇全部）会在洗干净时显示一个空框。
 *
 * 阈值用 `GRIME_CLEAN` 而不是 `=== 0`：命令在世界时钟里生效，同一拍世界
 * 也往前走了，所以洗完立刻又有一丝灰尘。见 `grime.ts` 里那个数的来历。
 */
export function revealVisible(prop: RevealState): boolean {
  return prop.reveal !== null && prop.grime <= GRIME_CLEAN;
}

/**
 * 露话的锚点：摆件落点正上方，高过三种摆件的剪影。
 *
 * 0.8 与 `propFootY` 同一个落点偏移（站在格内偏下），27 是三种剪影的
 * 实测最高点（y=-23）再放几格——放得不够，话会压在灯罩上。
 */
export function revealAnchor(
  prop: { readonly at: { readonly x: number; readonly y: number } },
  viewport: OverlayViewport,
): OverlayPoint {
  return projectWorldToOverlay(
    (prop.at.x + 0.5) * TILE_PX,
    (prop.at.y + 0.8) * TILE_PX - REVEAL_LIFT_PX,
    viewport,
  );
}

/** 露话比落点高多少（世界像素）。与 `REVEAL_LIFT_PX` 同值，供测试引用。 */
export const REVEAL_LIFT_PX = 27;
