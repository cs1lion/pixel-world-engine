/** 语义动作帧表：把一个村民的快照翻译成「该显示哪一格」。
 *
 * 纪律与设计文档 `docs/adr/ADR_ACTIONS_INTERACTION_20261112.md` 的 D1 一致：
 *  - 动作是**一类行为**，不是随便播的动画；七个动作与动作表的 6 行 1:1
 *    （第 1 行前两帧是赶路、后两帧是搬运，拆成两个语义）。
 *  - 全部输入来自 `VillagerSnapshot`（mode / walking / carrying）与世界时间，
 *    不读墙钟、不用随机数、不写视图状态：冻结世界后帧索引不再变，
 *    `check-ground-shadow` 的 `shotStable` 连 8 帧逐字节相同才成立。
 *  - 纯函数，不 import Phaser；帧注册单独放在 `registerActionFrames`。
 *
 * 没有动作表纹理时调用方退回单张立绘、再退回程序化小人，
 * 所以「素材缺一件不该让世界缺一块」这条边界仍成立。
 */

import Phaser from 'phaser';
import type { VillagerMode } from '../world/types.ts';

export const ACTION_IDS = ['idle', 'walk', 'work', 'rest', 'pour', 'cheer'] as const;
export type ActionId = (typeof ACTION_IDS)[number];

/** 动作表网格：与 11-11 的 `villager-sprite-sheet.png` 同形，4 列 × 6 行。 */
export const SHEET_COLS = 4;
export const SHEET_ROWS = 6;

/** 每行 → 动作 / 有效帧数 / 起始列。走路独占一行四帧。 */
export interface ActionRow {
  readonly action: ActionId;
  readonly row: number;
  readonly colOffset: number;
  readonly frames: number;
}

export const ACTION_ROWS: readonly ActionRow[] = [
  { action: 'idle', row: 0, colOffset: 0, frames: 3 },
  // 走路必须占满一行四帧：接触 / 下沉 / 经过 / 抬起。两帧正面步态读不出
  // 抬脚，屏幕上就是平移——这是实测被指出的缺陷，别再退回两帧。
  { action: 'walk', row: 1, colOffset: 0, frames: 4 },
  { action: 'work', row: 2, colOffset: 0, frames: 4 },
  { action: 'rest', row: 3, colOffset: 0, frames: 2 },
  { action: 'pour', row: 4, colOffset: 0, frames: 4 },
  { action: 'cheer', row: 5, colOffset: 0, frames: 4 },
];

/**
 * 每个动作的身体起伏（整数像素，负 = 抬高）。
 *
 * 与帧号绑定而不是与连续时间绑定：步态的「抬脚」正好落在经过帧上，
 * 身体在那一帧抬高 1px，读成一步一顿。时间驱动的起伏会和位图帧错位，
 * 看的人只见到整块抖动。
 */
const ACTION_BOB: Readonly<Record<ActionId, readonly number[]>> = {
  idle: [0, -1, 0],
  walk: [0, -1, 0, -1],
  work: [0, 0, -1, 0],
  rest: [0, 0],
  pour: [0, 0, -1, 0],
  cheer: [0, -1, -1, 0],
};

/** 该动作某一帧的身体起伏（px，负值向上）。 */
export function actionBob(action: ActionId, frame: number): number {
  const curve = ACTION_BOB[action];
  const i = ((Math.trunc(frame) % curve.length) + curve.length) % curve.length;
  return curve[i]!;
}

const ROW_OF: Readonly<Record<ActionId, ActionRow>> = Object.fromEntries(
  ACTION_ROWS.map((entry) => [entry.action, entry]),
) as Readonly<Record<ActionId, ActionRow>>;

/** 与 `villager-frames.ts` 同一个采样率。 */
export const ACTION_FPS = 12;

export function actionFrameCount(action: ActionId): number {
  return ROW_OF[action].frames;
}

export function actionFrameName(action: ActionId, frame: number): string {
  const count = actionFrameCount(action);
  const i = ((Math.trunc(frame) % count) + count) % count;
  return `act:${action}:${i}`;
}

/** 帧在纹理上的矩形；cellW/cellH 由纹理实际尺寸除以网格数得到。 */
export function actionFrameRect(
  action: ActionId,
  frame: number,
  cellW: number,
  cellH: number,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const row = ROW_OF[action];
  const i = ((Math.trunc(frame) % row.frames) + row.frames) % row.frames;
  return {
    x: (row.colOffset + i) * cellW,
    y: row.row * cellH,
    w: cellW,
    h: cellH,
  };
}

/** 快照 → 动作。表会漏、路不会：走路只看 `walking`，不看 mode。 */
export function actionOf(snapshot: {
  readonly mode: VillagerMode;
  readonly walking: boolean;
  readonly carrying: string | null;
}): ActionId {
  const carrying = snapshot.carrying !== null;
  // 走路只有一套帧：拿着东西也在走，步态本来就该照常摆动。
  if (snapshot.walking) return 'walk';
  if (snapshot.mode === 'working') return 'work';
  if (snapshot.mode === 'saluting') return 'idle'; // 行礼是姿态叠加，不另占一行
  if (snapshot.mode === 'sheltering') return 'rest';
  if (snapshot.mode === 'delivering') return 'cheer';
  if (carrying) return 'pour'; // 拿着东西站着：倾倒 / 展示
  return 'idle';
}

/** 世界时间 → 帧号。冻结时 nowMs 不推进，帧号就不变。 */
export function actionFrameAt(action: ActionId, nowMs: number): number {
  const count = actionFrameCount(action);
  const step = Math.floor(nowMs / (1000 / ACTION_FPS));
  return ((step % count) + count) % count;
}

/** 位图动作表的纹理 key，与 `artKey` 同前缀但独立一类。 */
export function actionTextureKey(villagerId: string): string {
  return `art:action:${villagerId}`;
}

/**
 * 在一张 4×6 的整图上注册 21 个帧，之后 `Image.setFrame(name)` 即可切格。
 * 只在首次访问时注册一次；重复调用是幂等的。
 */
export function registerActionFrames(scene: Phaser.Scene, villagerId: string): boolean {
  const key = actionTextureKey(villagerId);
  if (!scene.textures.exists(key)) return false;
  const texture = scene.textures.get(key);
  const source = texture.getSourceImage() as { width: number; height: number } | undefined;
  if (source === undefined) return false;
  const cellW = Math.floor(source.width / SHEET_COLS);
  const cellH = Math.floor(source.height / SHEET_ROWS);
  for (const row of ACTION_ROWS) {
    for (let frame = 0; frame < row.frames; frame += 1) {
      const name = actionFrameName(row.action, frame);
      if (texture.has(name)) continue;
      const rect = actionFrameRect(row.action, frame, cellW, cellH);
      texture.add(name, 0, rect.x, rect.y, rect.w, rect.h);
    }
  }
  return true;
}
