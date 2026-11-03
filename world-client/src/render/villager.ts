/** 小人层：24×30 的分层像素精灵。排版在 `villager-layout.ts`（纯数据、可单测），
 * 这里只负责「把矩形变成 Graphics」与灯/伞/怀抱物的少量叠加。
 *
 * **为什么是 24×30、格径仍是 16**：24×30 的像素面积是旧 16×20 的 2.25 倍，
 * 头从 8×6 变成 12×10，脸从约 32px² 变成约 60px²——这是「一眼分得开」的最低
 * 成本；世界、地形、建筑、烘焙与截图口径全部不动。代价是角色会跨到上一格
 * 14px（悬垂），深度仍按**脚底**算（`altitude + py + 8`），所以站在楼前/楼后、
 * 树前/树后仍按脚下那一格排序，碰撞与命中仍按整格（`villagerAtCell`）。
 *
 * 外观的四个维度（体型/头型/衣型/配饰）住在 `world/villager-look.ts`；
 * 颜色槽仍只取世界 24 色的 token。**24 色是源色闭集，不是屏幕色闭集**：
 * 审计不单独计 alpha，八方那种光感不需要先放宽色数。
 *
 * 动画采样仍在 `villager-frames.ts`（12fps、纯函数、整数像素）；这里只按帧号画。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import type { Vec2, VillagerSnapshot } from '../world/types.ts';
import { paletteFor, type WorldPalette } from '../world/theme.ts';
import { advanceLamp, lampDayOf, newLamp, type LampState } from '../world/lampoil.ts';
import { drawLamp, lampActivityOf, lampBodyAlpha } from './lampoil-view.ts';
import {
  lampAnimationTime,
  pixelAt,
  villagerPose,
  type VillagerPose,
} from './villager-frames.ts';
import {
  VILLAGER_H,
  VILLAGER_W,
  villagerLayout,
  type PaintRole,
} from './villager-layout.ts';
import { DEFAULT_LOOK, resolveLook, type VillagerLook } from '../world/villager-look.ts';

export { VILLAGER_H, VILLAGER_W };

export interface VillagerView {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly shadow: Phaser.GameObjects.Graphics;
  /** 这盏灯的余量。跟着人走，不跟着帧——掉帧不该让油少烧。 */
  lamp: LampState;
}

/** 世界递下来的外观：设定集给的四个维度 + 颜色槽，以及「她提没提灯」。 */
export interface VillagerAppearance {
  readonly look: VillagerLook;
  readonly lamp: boolean;
}

export function createVillager(
  scene: Phaser.Scene,
  originX: number,
  originY: number,
): VillagerView {
  // 接地不能只有一枚椭圆：椭圆说明「这里有团暗」，但脚和地面没有接触点，
  // 走起来会像浮着。这里用阶梯像素块代替矢量椭圆，再加一条 1px 接触线压在脚底。
  // alpha 两档：外层 `deepShade` 0.3，接触线 `ink` 0.55。影子仍按 16px 格宽画，
  // 不做 24px 加宽——宽过一格会读成「两个人挨着」。
  const shadow = scene.add.graphics();
  shadow.fillStyle(paletteFor().deepShade, 0.3);
  shadow.fillRect(-6, 0, 12, 2);
  shadow.fillRect(-4, 2, 8, 1);
  shadow.fillStyle(paletteFor().ink, 0.55);
  shadow.fillRect(-4, 0, 8, 1);

  const body = scene.add.graphics();
  drawVillager(body, DEFAULT_LOOK, paletteFor(), 'down', villagerPose('idle', false, 0), 'idle', false, 0);

  // 名字/气泡已迁 DOM overlay（D5-A）：canvas 里不再画中文。
  const container = scene.add.container(originX, originY, [shadow, body]);
  return { container, body, shadow, lamp: newLamp() };
}

/** 脚底的世界像素：位置换算只写在这里，`updateVillager` 与调试摆位共用。 */
export function villagerFootAt(
  cell: Vec2,
  originX = 0,
  originY = 0,
): { readonly x: number; readonly y: number } {
  return {
    x: pixelAt(originX + (cell.x + 0.5) * TILE_PX),
    y: pixelAt(originY + (cell.y + 1) * TILE_PX),
  };
}

/** 人物 depth：脚底 + 8。上一行的人（脚底小 16px）因此比构件低 4。 */
export function villagerDepthAt(footY: number, altitude: number): number {
  return altitude + footY + 8;
}

/** 每帧把快照画出来；坐标换算只在这里做一次，且结果取整到整数像素。 */
export function updateVillager(
  view: VillagerView,
  villager: VillagerSnapshot,
  nowMs: number,
  originX: number,
  originY: number,
  altitude: number,
  appearance?: VillagerAppearance,
  palette: WorldPalette = paletteFor(),
): void {
  const foot = villagerFootAt(villager.pos, originX, originY);
  const px = foot.x;
  const py = foot.y;
  view.container.setPosition(px, py);
  view.container.setVisible(villager.visible);
  view.container.setDepth(villagerDepthAt(py, altitude));

  // 灯油只在有灯的人身上成立；没提灯的人不受存档字段影响。
  // 推进发生在更新路径上，用的是 simulation 时间：世界暂停时灯也停，
  // 重放同一个存档灯走同一条曲线。`Simulation` 从头到尾不知道有这盏灯。
  view.lamp = advanceLamp(
    view.lamp,
    villager.lampOil,
    nowMs,
    lampActivityOf(villager.mode, villager.walking),
    lampDayOf(nowMs),
  );
  const withLamp = appearance?.lamp === true;
  const oil = withLamp ? view.lamp.oil : 1;
  // 油尽时人发灰、动作采样放慢——这是画面上的疲惫，不是世界里的减速：
  // 位置仍由 simulation 决定，这里只改同一帧号被取样的时刻。
  const pose = villagerPose(villager.mode, villager.walking, lampAnimationTime(oil, nowMs));
  // 每帧都显式写回 alpha：油补回来以后必须恢复，不能把上一帧的灰留在身上。
  view.body.setAlpha(lampBodyAlpha(oil));
  view.body.clear();
  drawVillager(
    view.body,
    appearance?.look ?? resolveLook(undefined),
    palette,
    villager.facing,
    pose,
    villager.mode,
    villager.walking,
    nowMs,
  );
  if (withLamp) {
    // 快照里的灯油只在这里影响画面；燃料不会变成任务或路径的隐藏条件。
    drawLamp(view.body, oil, palette);
  }
  if (villager.umbrella) drawUmbrella(view.body, pose.offsetY);
  if (villager.carrying !== null) drawCarried(view.body, villager.carrying, pose.offsetY);

  // 走路时整条阴影一起变淡：抬脚时接触减弱，落地时才压深。
  // 判据与步态同一个（`villager.walking`，即 `path.length > 0`），别另列 mode 表：
  // 走作息环线的人 mode 是 `'idle'`，表会漏、路不会。
  view.shadow.setAlpha(villager.walking ? 0.28 : 0.35);
}

/** 一个调色角色 → 当次色板的实色。只有颜色解析在这一处，排版不认识色值。 */
function paintColor(paint: PaintRole, look: VillagerLook, palette: WorldPalette): number {
  switch (paint) {
    case 'base':
      return palette[look.cloak];
    case 'shade':
      return palette[look.cloakDark];
    case 'hair':
      return palette[look.hair];
    case 'scarf':
      return palette[look.scarf];
    case 'scarfLit':
      return palette[look.scarfLit];
    default:
      return palette[paint];
  }
}

function drawVillager(
  g: Phaser.GameObjects.Graphics,
  look: VillagerLook,
  palette: WorldPalette,
  facing: VillagerSnapshot['facing'],
  pose: VillagerPose,
  mode: VillagerSnapshot['mode'],
  walking: boolean,
  nowMs: number,
): void {
  for (const item of villagerLayout(look, facing, pose, walking, mode, nowMs)) {
    g.fillStyle(paintColor(item.paint, look, palette), 1);
    g.fillRect(item.x, item.y, item.w, item.h);
  }
}

/**
 * 从郊野带回来的东西：抱在身前。
 *
 * 只画三种，对应三种活。位置在胸前偏下——抱着的姿态，不是举着。
 * 全用现有 24 色：卷轴 parchment 用 plaster、石料用 stone、纸用 pale。
 */
function drawCarried(
  g: Phaser.GameObjects.Graphics,
  kind: 'scroll' | 'stone' | 'paper',
  offsetY: number,
): void {
  const top = offsetY - 13;
  if (kind === 'scroll') {
    // 卷轴：浅色横卷 + 两端暗轴头 + 中间一条暗纹（读成"卷起来的纸"）。
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(-7, top, 15, 7);
    g.fillStyle(paletteFor().plaster, 1);
    g.fillRect(-6, top + 1, 13, 5);
    g.fillStyle(paletteFor().trim, 1);
    g.fillRect(-6, top + 1, 13, 1);
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(-7, top + 1, 2, 5);
    g.fillRect(6, top + 1, 2, 5);
    // 纸面暗纹：两条横线，读成"写过的纸"。
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(-3, top + 3, 6, 1);
    g.fillRect(-3, top + 4, 4, 1);
  } else if (kind === 'stone') {
    // 石料：带亮面的方石，轮廓更清楚。
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(-6, top, 13, 8);
    g.fillStyle(paletteFor().stone, 1);
    g.fillRect(-5, top + 1, 11, 6);
    g.fillStyle(paletteFor().plaza, 1);
    g.fillRect(-5, top + 1, 11, 2);
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(-5, top + 6, 11, 1);
  } else {
    // 纸：一叠薄纸，边缘有齿。
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(-7, top, 15, 7);
    g.fillStyle(paletteFor().pale, 1);
    g.fillRect(-6, top + 1, 13, 5);
    g.fillStyle(paletteFor().plaster, 1);
    g.fillRect(-3, top + 1, 1, 5);
    g.fillRect(1, top + 1, 1, 5);
    g.fillRect(4, top + 1, 1, 5);
  }
}

/** 伞只在下雨且她在户外时出现；世界给的事实，渲染层不自己判断天气。 */
function drawUmbrella(g: Phaser.GameObjects.Graphics, offsetY: number): void {
  const y = offsetY;
  // 伞面比旧版抬高 10px（头从 20 长到 30）：中间高、两侧低，右缘留一个缺口。
  g.fillStyle(paletteFor().ink, 1);
  g.fillRect(-7, -41 + y, 14, 3);
  g.fillStyle(paletteFor().ember, 1);
  g.fillRect(-6, -41 + y, 12, 2);
  g.fillRect(-4, -42 + y, 8, 1);
  g.fillStyle(paletteFor().trim, 1);
  g.fillRect(-5, -42 + y, 4, 1);
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(-5, -40 + y, 1, 2);
  g.fillRect(0, -40 + y, 1, 2);
  g.fillRect(4, -40 + y, 1, 2);
  g.fillRect(0, -38 + y, 1, 9);
  g.fillStyle(paletteFor().plaza, 1);
  g.fillRect(-1, -30 + y, 3, 1);
}
