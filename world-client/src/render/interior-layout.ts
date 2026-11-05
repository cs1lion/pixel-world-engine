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

/** 楼层是视图概念，不进世界状态；第一层恒为 1。 */
export const INTERIOR_FIRST_FLOOR = 1;

/** 进门 / 退出 / 切层的固定帧数。每帧固定推进 1/N，不读墙钟。 */
export const INTERIOR_TRANSITION_FRAMES = 18;

/**
 * 切层时**换贴图的那一帧**：正好落在过渡中点（画面全黑）。
 *
 * 提前或推后换都会让旧层的家具在新层的暗场里闪一下；中点换是唯一看不见接缝的位置。
 */
export const INTERIOR_SWITCH_SWAP_FRAME = INTERIOR_TRANSITION_FRAMES / 2;

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface InteriorLayout {
  /** 层号。夹在 `1..floors`，越界的入参在这里被收回。 */
  readonly floor: number;
  /** 这栋楼剖面上有几层（由剪影派生，见 `interiorFloorsFor`）。 */
  readonly floors: number;
  /** 烘焙纹理名：一栋楼一层一张。 */
  readonly key: string;
  /** 楼梯整块：登记坐标、画图元、给命中判定。 */
  readonly stairs: PixelRect;
  /** 楼梯上半：点它就是上楼。顶层没有这一段。 */
  readonly stairUp: PixelRect;
  /** 楼梯下半：点它就是下楼。底层没有这一段。 */
  readonly stairDown: PixelRect;
  /** 还能不能往上 / 往下（边界夹取在布局里就先算好，点击时不必再想）。 */
  readonly canUp: boolean;
  readonly canDown: boolean;
  /** 出口：点它退回街景。每一层都留着同一个门框——它是这栋房子的出口。 */
  readonly door: PixelRect;
  /** 炉口 / 灶台。民居没有，楼上也没有（灶在底层）。 */
  readonly hearth: PixelRect | null;
  /** 室内站位：按居民 id 排序依次分配，**没人就不摆人**。 */
  readonly seats: readonly { readonly x: number; readonly y: number }[];
  /** 派生种子，画墙缝与家具抖动用。 */
  readonly seed: number;
}

export type StairDirection = 'up' | 'down';

/**
 * 这栋楼剖面上有几层。
 *
 * 世界状态里没有层数（`PlacedBuilding` 不带这个字段），这里按**立面剪影**读：
 * `flat` 单层、`gable` 带阁楼两层、`tower` 带塔楼三层。这是视图读法，不是世界事实——
 * 它不参与寻路、不参与目击判定、不落档。真要做「居民分层生活」时，层数必须搬进
 * 世界状态（那才会改 v6），这一版刻意不开那个口子。
 */
export function interiorFloorsFor(building: PlacedBuilding): number {
  switch (building.silhouette) {
    case 'tower':
      return 3;
    case 'gable':
      return 2;
    default:
      return 1;
  }
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
  const floors = interiorFloorsFor(building);
  const actualFloor = Math.max(INTERIOR_FIRST_FLOOR, Math.min(Math.floor(floor), floors));
  const seed = seedAt(wallSeed(building), actualFloor);
  const stairs: PixelRect = { x: 12, y: 26, w: 34, h: 54 };
  // 楼梯一竖两段：上半上楼、下半下楼。两段互不重叠，点哪段就往哪边走。
  const stairHalf = Math.floor(stairs.h / 2);
  const stairUp: PixelRect = {
    x: stairs.x,
    y: stairs.y,
    w: stairs.w,
    h: stairHalf,
  };
  const stairDown: PixelRect = {
    x: stairs.x,
    y: stairs.y + stairHalf,
    w: stairs.w,
    h: stairs.h - stairHalf,
  };
  const door: PixelRect = {
    x: Math.floor(INTERIOR_ROOM_W / 2) - 14,
    y: INTERIOR_ROOM_H - 30,
    w: 28,
    h: 30,
  };
  // 灶只在底层：楼上没有炉口，这条同时是「这一层是不是楼上」的可见线索。
  const hearth: PixelRect | null =
    building.zone === 'living' || actualFloor > 1 ? null : { x: 150, y: 34, w: 42, h: 26 };

  // 三个座位：贴着桌面，横向各错 0–4px，别排成一条尺子。
  const seatBase = 70 + ((seed >>> 5) % 5);
  const seats = [
    { x: seatBase, y: 98 },
    { x: seatBase + 34 + ((seed >>> 9) % 4), y: 104 },
    { x: seatBase + 68 + ((seed >>> 13) % 4), y: 96 },
  ];

  return {
    floor: actualFloor,
    floors,
    key: `interior:${building.instanceId}:f${actualFloor}`,
    stairs,
    stairUp,
    stairDown,
    canUp: actualFloor < floors,
    canDown: actualFloor > INTERIOR_FIRST_FLOOR,
    door,
    hearth,
    seats,
    seed,
  };
}

/**
 * 点楼梯的哪一段。入参是**房间局部像素**，越界给 null。
 *
 * 上半上楼、下半下楼——不做「点一下循环切层」：上下两块本来就在图上分得开，
 * 点哪块走哪块才不会让人猜。顶层点了上半、底层点了下半，就该什么都不发生
 * （并由视图闪一下提示），而不是绕回另一头。
 */
export function stairDirectionAt(
  layout: InteriorLayout,
  localX: number,
  localY: number,
): StairDirection | null {
  const inside = (rect: PixelRect): boolean =>
    localX >= rect.x && localX < rect.x + rect.w
    && localY >= rect.y && localY < rect.y + rect.h;
  if (inside(layout.stairUp)) return 'up';
  if (inside(layout.stairDown)) return 'down';
  return null;
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
 * 切层的画面不透明度：**两端 1、中点 0**，走完一整段暗场再亮回来。
 *
 * 与进场不同：进场是街景→室内的一次交叉淡入，切层是室内→室内，中间必须
 * 真的黑到底，换贴图才看不见接缝。帧号仍是唯一输入，不读墙钟。
 */
export function interiorSwitchOpacity(frames: number): number {
  const progress = smoothStep(interiorTransitionProgress(frames));
  // |2p-1|：p=0 亮、p=0.5 全黑、p=1 又亮。写 `1-|2p-1|` 会得到相反的曲线
  // （中点全亮、两头全黑），第一次就写反了——单测把它钉在这里。
  return Math.abs(progress * 2 - 1);
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
