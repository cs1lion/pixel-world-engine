/**
 * 内景布局：**只读、纯函数**，不碰世界状态、不碰存档。
 *
 * 这一版只做「看得见里面」：每栋楼按层烘一张内景图，楼梯只登记坐标与画图元，
 * 不切层。所以这里算出来的东西全部是**视图**——丢了可以重算，不会让世界变化。
 *
 * 家具与站位一律由 `wallSeed(building)` 派生：同一个楼、同一次读档，位置逐像素相同。
 * 不读墙钟、不取 `Math.random`——这一条是硬约束，不是风格偏好。
 *
 * 房间坐标是**局部像素坐标**，原点在房间贴图左上角（`INTERIOR_ROOM_W/H`）。
 */

import type { PlacedBuilding } from '../world/types.ts';

/** 内景画布尺寸（世界像素）。232×152 在 2 倍镜下刚好留一圈暗场。 */
export const INTERIOR_ROOM_W = 232;
export const INTERIOR_ROOM_H = 152;

/** 第一版只有一层。楼层是视图概念，不进世界状态。 */
export const INTERIOR_FIRST_FLOOR = 1;

/** 进门 / 退出的固定帧数。每帧固定推进 1/N，不读墙钟。 */
export const INTERIOR_TRANSITION_FRAMES = 18;

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface InteriorLayout {
  /** 层号。第一版恒为 1。 */
  readonly floor: number;
  /** 烘焙纹理名：一栋楼一层一张。 */
  readonly key: string;
  /** 楼梯格：登记了坐标、画了图元，第一版点了只给反馈，不切层。 */
  readonly stairs: PixelRect;
  /** 出口：点它退回街景。 */
  readonly door: PixelRect;
  /** 炉口 / 灶台。民居没有。 */
  readonly hearth: PixelRect | null;
  /** 室内站位：按居民 id 排序依次分配，**没人就不摆人**。 */
  readonly seats: readonly { readonly x: number; readonly y: number }[];
  /** 派生种子，画墙缝与家具抖动用。 */
  readonly seed: number;
}

/**
 * 一栋楼的稳定种子。
 *
 * FNV-1a over `instanceId`，再混进原点格——只为了两栋同名楼不长得一模一样。
 * 不用 `Math.random`：那会让同一份存档每次打开都换房间。
 */
export function wallSeed(building: PlacedBuilding): number {
  let hash = 0x811c9dc5;
  const id = building.instanceId;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  hash = Math.imul(hash ^ building.origin.x, 0x9e3779b1);
  hash = Math.imul(hash ^ building.origin.y, 0x85ebca77);
  return hash >>> 0;
}

/** 同一种子的第 n 档派生值：换一层、换一件家具都用它，别各写一份取模。 */
export function seedAt(seed: number, salt: number): number {
  let value = Math.imul(seed ^ (salt + 0x165667b1), 0x27d4eb2d) >>> 0;
  value ^= value >>> 15;
  return value >>> 0;
}

export function interiorLayoutFor(
  building: PlacedBuilding,
  floor: number = INTERIOR_FIRST_FLOOR,
): InteriorLayout {
  const seed = seedAt(wallSeed(building), floor);
  const stairs: PixelRect = { x: 12, y: 26, w: 34, h: 54 };
  const door: PixelRect = {
    x: Math.floor(INTERIOR_ROOM_W / 2) - 14,
    y: INTERIOR_ROOM_H - 30,
    w: 28,
    h: 30,
  };
  const hearth: PixelRect | null =
    building.zone === 'living' ? null : { x: 150, y: 34, w: 42, h: 26 };

  // 三个座位：贴着桌面，横向各错 0–4px，别排成一条尺子。
  const seatBase = 70 + ((seed >>> 5) % 5);
  const seats = [
    { x: seatBase, y: 98 },
    { x: seatBase + 34 + ((seed >>> 9) % 4), y: 104 },
    { x: seatBase + 68 + ((seed >>> 13) % 4), y: 96 },
  ];

  return {
    floor,
    key: `interior:${building.instanceId}:f${floor}`,
    stairs,
    door,
    hearth,
    seats,
    seed,
  };
}

/**
 * 过渡进度：**固定帧数**，不读墙钟。
 *
 * 为什么不用世界毫秒：默认 `?speed=6` 会把世界毫秒放大六倍，300ms 的过渡在
 * 一帧里就结束了。帧序与倍率无关，也仍然可复现——同一串输入推进同样多帧。
 */
export function interiorTransitionProgress(frames: number): number {
  if (frames <= 0) return 0;
  if (frames >= INTERIOR_TRANSITION_FRAMES) return 1;
  return frames / INTERIOR_TRANSITION_FRAMES;
}

/** 平滑一点：两端慢、中间快。纯算术，不依赖任何缓动库的时序。 */
export function smoothStep(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * 一排座位里分配第 `index` 个人。
 *
 * 多出来的人不再叠放——回退到门口附近依次站开，而不是画一堆假人。
 * 超过 6 个（现实中一个屋里不会有）干脆不画。
 */
export function seatFor(
  layout: InteriorLayout,
  index: number,
): { readonly x: number; readonly y: number } | null {
  if (index < layout.seats.length) return layout.seats[index]!;
  if (index < 6) return { x: 40 + (index - layout.seats.length) * 16, y: 120 };
  return null;
}
