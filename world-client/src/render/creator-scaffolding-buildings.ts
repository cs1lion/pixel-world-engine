/** 脚手架施工的渲染对接：把审计台账里的施工阶段刷到 `buildings.ts` 的三层视图上。
 *
 * **它不改深度。** `buildings.ts` 的 back / container / front 三层是截图校验过的锚点
 * （门底贴墙底、台阶不被前檐横穿），72 张 building-bake 门禁盯着它们。这里只做
 * 「谁可见、谁半透明、进度条怎么画」，一个 depth 都不碰，也不新增容器。
 *
 * **只在 debug 评测会话里被调用。** 生产路径（`?debug` 没开）永远走不到这里，
 * 所以现有画面逐像素不变。
 *
 * 颜色全部取自 24 色板 token（`WORLD`），一个十六进制字面量都不写——
 * `audit-palette.mjs --strict` 盯的就是这个。
 */

import type * as Phaser from 'phaser';
import { WORLD } from '../world/palette-data.ts';
import type { BuildingView, BuildingLayer } from './buildings.ts';
import type { PlacedBuildingState } from '../world/creator/audit-state.ts';
import { constructionReadout } from '../world/creator/audit-state.ts';

export interface BuildingRenderSnapshot {
  readonly stage: PlacedBuildingState['stage'];
  readonly progressRatio: number;
  readonly scaffoldingVisible: boolean;
  readonly frontEavesVisible: boolean;
  readonly smokeActive: boolean;
}

const SCAFFOLD_MAIN = WORLD.trim;
const SCAFFOLD_SHADOW = WORLD.timberDark;
const SCAFFOLD_KNOT = WORLD.plaster;
const PROGRESS_BG = WORLD.ink;
const PROGRESS_FILL = WORLD.moss;

/**
 * 按施工状态刷新一栋楼的视图。
 *
 * 施工态：前檐收起、屋顶/窗半透、招牌不显示，在 `view.progress` 上画竹木线框
 * 与整数像素进度条；完工态：全部复原，`progress` 清空。
 * `smokeActive` 交回调用方去联动 `render/smoke.ts` 的施工烟尘（仓里没有
 * work-smoke.ts，那份名字来自外部草稿）。
 */
export function syncBuildingConstructionView(
  view: BuildingView,
  state: PlacedBuildingState,
  tilePixelSize = 16,
): BuildingRenderSnapshot {
  const pixelW = state.footprint.w * tilePixelSize;
  const pixelH = state.footprint.h * tilePixelSize;
  const readout = constructionReadout(state);

  view.front.setVisible(!readout.scaffoldingVisible);
  view.roof.setAlpha(readout.scaffoldingVisible ? 0.35 : 1);
  view.sign.setAlpha(readout.scaffoldingVisible ? 0 : 1);
  view.window.setAlpha(readout.scaffoldingVisible ? 0.25 : 1);

  view.progress.clear();
  if (readout.scaffoldingVisible) {
    drawProceduralScaffolding(view.progress, pixelW, pixelH);
    drawPixelProgressBar(view.progress, pixelW, -pixelH - 8, readout.progressRatio);
  }

  return {
    stage: state.stage,
    progressRatio: readout.progressRatio,
    scaffoldingVisible: readout.scaffoldingVisible,
    frontEavesVisible: !readout.scaffoldingVisible,
    smokeActive: readout.smokeActive,
  };
}

/** 把一栋楼的施工读数合进烟尘发射器的开关状态（供 `render/smoke.ts` 消费）。 */
export function scaffoldingSmokeOf(state: PlacedBuildingState): {
  readonly active: boolean;
  readonly intensity: number;
} {
  const readout = constructionReadout(state);
  return {
    active: readout.smokeActive,
    intensity: 0.4 + readout.progressRatio * 0.6,
  };
}

function setLayerAlpha(layer: BuildingLayer, alpha: number): void {
  layer.setAlpha(alpha);
}

/** 竹木立杆、横杆与绳结：整数像素对齐，纯程序化，`?art=0` 下零图片请求。 */
function drawProceduralScaffolding(
  gfx: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
): void {
  const left = -Math.floor(w / 2);
  const top = -h;

  gfx.fillStyle(SCAFFOLD_SHADOW, 1);
  for (let x = left + 2; x <= left + w - 2; x += 12) {
    gfx.fillRect(x + 1, top, 2, h);
  }

  gfx.fillStyle(SCAFFOLD_MAIN, 1);
  for (let x = left + 2; x <= left + w - 2; x += 12) {
    gfx.fillRect(x, top, 2, h);
  }
  for (let y = top + 4; y < 0; y += 10) {
    gfx.fillRect(left, y, w, 2);
  }

  gfx.fillStyle(SCAFFOLD_KNOT, 1);
  for (let x = left + 2; x <= left + w - 2; x += 12) {
    for (let y = top + 4; y < 0; y += 10) {
      gfx.fillRect(x, y, 2, 2);
    }
  }
}

function drawPixelProgressBar(
  gfx: Phaser.GameObjects.Graphics,
  w: number,
  topY: number,
  ratio: number,
): void {
  const barW = Math.max(24, Math.min(48, w - 8));
  const barH = 4;
  const startX = -Math.floor(barW / 2);

  gfx.fillStyle(PROGRESS_BG, 0.9);
  gfx.fillRect(startX - 1, topY - 1, barW + 2, barH + 2);
  const fillW = Math.round(barW * ratio);
  if (fillW > 0) {
    gfx.fillStyle(PROGRESS_FILL, 1);
    gfx.fillRect(startX, topY, fillW, barH);
  }
}

/** 未被使用会触发 noUnusedLocals；留一个显式出口给只改透明度的调用方。 */
export { setLayerAlpha };
