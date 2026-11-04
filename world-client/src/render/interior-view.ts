/**
 * 内景视图：**一层一张烘焙贴图 + 一块不透明暗场**，画在**屏幕坐标**上。
 *
 * 为什么不用世界坐标：世界相机带 zoom（1/1.5/2/3 四档）。内景若按世界坐标摆，
 * 2 倍镜下 232 格尺的房间会铺成 928×608 CSS，超出 480×320 的画布——第一次
 * 取证拍到的「房间缩在左上角」其实是**裁切**，不是摆歪。
 * 内景是「另一套画面」，本来就不该跟着街景的倍率缩放：一律 `scrollFactor 0` +
 * `scale = 2 / zoom`，1 texel 恒等于 2 屏幕像素，与街景 2 倍镜同一档手感。
 *
 * 深度自成一套，不套 `ALTITUDE`：街景那套是「越高越靠前」的 y-sort，
 * 内景是盖在它上面的一块独立画面，本来就不该参与那条排序。
 *
 * 为什么烘焙：房间是静态的（家具由 `wallSeed` 派生，同一份存档不变），
 * 每帧重画一张 232×152 的 Graphics 要近百条指令。烘成纹理后每帧只有一个 quad——
 * 与地形、迷雾同一条通道（`bakeLayer`）。
 *
 * 人会动、楼梯反馈会闪，这两样留在两张小 Graphics 上，按需重画。
 */

import Phaser from 'phaser';
import { bakeLayer, type BakedLayer } from './bake.ts';
import { WORLD } from '../world/palette-data.ts';
import type { PlacedBuilding } from '../world/types.ts';
import {
  INTERIOR_ROOM_H,
  INTERIOR_ROOM_W,
  interiorLayoutFor,
  seatFor,
  type InteriorLayout,
} from './interior-layout.ts';

/** 内景的深度基座。整块画面压在一切街景之上，内部再分三层。 */
export const INTERIOR_DEPTH = 20_000;
const INTERIOR_BACKDROP_DEPTH = INTERIOR_DEPTH;
const INTERIOR_ROOM_DEPTH = INTERIOR_DEPTH + 10;
const INTERIOR_ACTOR_DEPTH = INTERIOR_DEPTH + 20;
const INTERIOR_HINT_DEPTH = INTERIOR_DEPTH + 30;

/** 1 个内景 texel 显示成几个屏幕像素（内部 480×320 坐标，不是 CSS）。 */
export const INTERIOR_PIXEL = 2;

/** 暗场的半边长（局部像素）。2048 见方在 1 倍镜下也盖得满。 */
const BACKDROP_HALF = 1024;

/** 楼梯提示闪多少帧。与过渡一样按帧计，不读墙钟。 */
const STAIRS_HINT_FRAMES = 60;

/** 相机给内景摆位用的三个数。 */
export interface InteriorCamera {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

export interface InteriorView {
  /** 当前摆的是哪栋楼；没进过就是 null。 */
  readonly buildingId: string | null;
  /** 楼梯提示还剩几帧（0 = 没闪）。点击反馈的验收读数。 */
  readonly hintFrames: number;
  /** 验收读数：贴图的实际显示尺寸，以及它相对画布左上的偏移。 */
  readonly debug: {
    readonly scale: number;
    readonly image: {
      readonly x: number;
      readonly y: number;
      readonly displayWidth: number;
      readonly displayHeight: number;
      readonly alpha: number;
      readonly visible: boolean;
    } | null;
    readonly backdrop: {
      readonly alpha: number;
      readonly visible: boolean;
    };
  };
  show(building: PlacedBuilding, camera: InteriorCamera): void;
  hide(): void;
  /** 交叉淡入：0 = 街景，1 = 室内。 */
  setReveal(alpha: number): void;
  /** 传**已经按 id 排序**的在场居民；空数组就是空房间，不造假人。 */
  setOccupants(ids: readonly string[]): void;
  tick(): void;
  flashStairs(): void;
  /**
   * 点到的是门、楼梯还是别处。
   *
   * 入参是**画布内部坐标**（`pointer.x` / `pointer.y`），不是世界坐标：
   * 内景是屏幕坐标画的，换算回世界坐标只会把 zoom 又绕回来。
   */
  hitTest(pointerX: number, pointerY: number): 'door' | 'stairs' | null;
  readonly layout: InteriorLayout | null;
  destroy(): void;
}

function drawWindow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(WORLD.warmLight, 1);
  g.fillRect(x, y, w, h);
  g.fillStyle(WORLD.amber, 1);
  g.fillRect(x, y, w, 3);
  g.fillStyle(WORLD.trim, 1);
  g.fillRect(x + Math.floor(w / 2), y, 2, h);
  g.fillRect(x, y + Math.floor(h / 2), w, 2);
  // 窗台外沿
  g.fillStyle(WORLD.timber, 1);
  g.fillRect(x - 2, y + h, w + 4, 2);
}

function drawStairs(g: Phaser.GameObjects.Graphics, rect: InteriorLayout['stairs']): void {
  const steps = 7;
  const stepH = Math.max(2, Math.floor(rect.h / steps));
  for (let index = 0; index < steps; index += 1) {
    const inset = index * 2;
    g.fillStyle(index % 2 === 0 ? WORLD.stone : WORLD.plaza, 1);
    g.fillRect(rect.x + inset, rect.y + index * stepH, rect.w - inset, stepH);
    g.fillStyle(WORLD.ink, 1);
    g.fillRect(rect.x + inset, rect.y + index * stepH, rect.w - inset, 1);
  }
  // 扶手：一条 trim 的斜线，按 2px 一格落，不用画线函数。
  for (let index = 0; index < steps; index += 1) {
    g.fillStyle(WORLD.trim, 1);
    g.fillRect(rect.x + rect.w - 2, rect.y + index * stepH, 2, 2);
  }
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(rect.x - 1, rect.y + rect.h, rect.w + 2, 1);
}

function drawHearth(g: Phaser.GameObjects.Graphics, rect: NonNullable<InteriorLayout['hearth']>): void {
  g.fillStyle(WORLD.stone, 1);
  g.fillRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.fillStyle(WORLD.ember, 1);
  g.fillRect(rect.x + 4, rect.y + rect.h - 6, rect.w - 8, 4);
  g.fillStyle(WORLD.warmLight, 1);
  g.fillRect(rect.x + 8, rect.y + rect.h - 5, rect.w - 16, 2);
  g.fillStyle(WORLD.charcoal, 1);
  g.fillRect(rect.x - 3, rect.y - 8, rect.w + 6, 6);
}

/**
 * 静态房间画一遍，烘成一张贴图。
 *
 * **一律不透明**：这里不用 alpha。叠色会混出调色板外的 RGB
 * （第一次取证量到 321 色，绝大部分是 0.18/0.25/0.35 那几层填色叠出来的），
 * 「室内唯一色数 ≤ 调色板」这条就挂了。要浅一档就用暗部的现成色。
 */
function drawRoom(g: Phaser.GameObjects.Graphics, layout: InteriorLayout): void {
  const w = INTERIOR_ROOM_W;
  const h = INTERIOR_ROOM_H;
  const wallBottom = 44;

  // 背墙与地面
  g.fillStyle(WORLD.plaster, 1);
  g.fillRect(0, 0, w, wallBottom);
  g.fillStyle(WORLD.deepShade, 1);
  g.fillRect(0, 0, w, 3);
  g.fillStyle(WORLD.soil, 1);
  g.fillRect(0, wallBottom, w, h - wallBottom);

  // 墙板竖缝：每 16px 一道，位置不随种子动——墙是墙，房间变的是家具。
  g.fillStyle(WORLD.timberDark, 1);
  for (let x = 16; x < w; x += 16) g.fillRect(x, 3, 1, wallBottom - 3);

  // 窗
  drawWindow(g, 44, 10, 34, 22);
  drawWindow(g, 154, 10, 34, 22);

  // 地面板缝
  g.fillStyle(WORLD.stone, 1);
  for (let y = wallBottom + 8; y < h; y += 8) g.fillRect(0, y, w, 1);
  g.fillStyle(WORLD.ink, 1);
  for (let row = 0; row < 12; row += 1) {
    const y = wallBottom + 4 + row * 8;
    const offset = ((layout.seed >>> (row % 8)) & 15) + 8;
    for (let x = offset; x < w; x += 32) g.fillRect(x, y, 1, 4);
  }
  // 踢脚
  g.fillStyle(WORLD.trim, 1);
  g.fillRect(0, wallBottom - 2, w, 2);
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(0, wallBottom, w, 1);

  // 楼梯（登记在图元里；点击反馈由提示层画）
  drawStairs(g, layout.stairs);

  if (layout.hearth !== null) drawHearth(g, layout.hearth);

  // 桌椅：位置只由座位决定，桌子跟着中间那个座位走。
  const tableX = layout.seats[0]!.x - 6;
  const tableY = 84;
  g.fillStyle(WORLD.timberDark, 1);
  g.fillRect(tableX, tableY, 54, 4);
  g.fillRect(tableX + 3, tableY + 4, 3, 8);
  g.fillRect(tableX + 48, tableY + 4, 3, 8);
  g.fillStyle(WORLD.timber, 1);
  g.fillRect(tableX, tableY, 54, 2);
  g.fillStyle(WORLD.plaster, 1);
  g.fillRect(tableX + 8, tableY - 2, 6, 2);
  g.fillStyle(WORLD.amber, 1);
  g.fillRect(tableX + 9, tableY - 3, 2, 1);

  // 门：贴在底边，出去就是街景的那一格。
  const door = layout.door;
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(door.x - 3, door.y - 4, door.w + 6, door.h + 4);
  g.fillStyle(WORLD.timberDark, 1);
  g.fillRect(door.x - 2, door.y - 2, door.w + 4, door.h + 2);
  g.fillStyle(WORLD.charcoal, 1);
  g.fillRect(door.x, door.y, door.w, door.h);
  g.fillStyle(WORLD.trim, 1);
  g.fillRect(door.x - 2, door.y - 2, door.w + 4, 2);
  g.fillRect(door.x - 2, door.y - 2, 2, door.h + 2);
  g.fillRect(door.x + door.w, door.y - 2, 2, door.h + 2);
  // 门缝透进来的街光：一条暖高光，读法是「外面还是白天」。
  g.fillStyle(WORLD.trim, 1);
  g.fillRect(door.x, door.y + door.h - 2, door.w, 2);
}

function drawActor(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  index: number,
): void {
  // 10×16 的小人：只有斗篷两色 + 皮肤 + 轮廓，与街上那批村民同一套语言。
  const cloak = index % 3 === 0 ? WORLD.cloak : index % 3 === 1 ? WORLD.copper : WORLD.cloakDark;
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(x - 5, y - 14, 10, 16);
  g.fillStyle(cloak, 1);
  g.fillRect(x - 4, y - 13, 8, 13);
  g.fillStyle(WORLD.skin, 1);
  g.fillRect(x - 3, y - 12, 6, 5);
  g.fillStyle(WORLD.ink, 1);
  g.fillRect(x - 3, y - 13, 6, 2);
  g.fillStyle(WORLD.timberDark, 1);
  g.fillRect(x - 4, y - 1, 8, 2);
}

export function createInteriorView(scene: Phaser.Scene): InteriorView {
  // **不放进 Container**：`renderStats()` 只数 `children.list` 的顶层 Graphics，
  // 塞进容器就等于让内景的绘制指令在预算闸门里隐身。宁可多三个对象，
  // 也要让「进屋前后 Graphics 数 / 指令数」是真的对照。
  const backdrop = scene.add.graphics();
  backdrop.fillStyle(WORLD.ink, 1);
  backdrop.fillRect(-BACKDROP_HALF, -BACKDROP_HALF, BACKDROP_HALF * 2, BACKDROP_HALF * 2);
  backdrop.setDepth(INTERIOR_BACKDROP_DEPTH);
  backdrop.setScrollFactor(0);
  backdrop.setVisible(false);

  const actorG = scene.add.graphics();
  actorG.setDepth(INTERIOR_ACTOR_DEPTH);
  actorG.setScrollFactor(0);
  actorG.setVisible(false);

  const hintG = scene.add.graphics();
  hintG.setDepth(INTERIOR_HINT_DEPTH);
  hintG.setScrollFactor(0);
  hintG.setVisible(false);

  const layers: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Image)[] = [
    backdrop,
    actorG,
    hintG,
  ];

  let baked: BakedLayer | null = null;
  let bakedKey: string | null = null;
  let current: PlacedBuilding | null = null;
  let layout: InteriorLayout | null = null;
  /** 房间左上角在**画布内部像素**里的位置：`hitTest` 用它换算回贴图坐标。 */
  let screenLeft = 0;
  let screenTop = 0;
  /** `scrollFactor 0` 的对象不跟相机滚动，但仍吃 zoom——位置要按 1/zoom 折算。 */
  let anchorX = 0;
  let anchorY = 0;
  let displayScale = 1;
  let occupantSignature = '';
  let stairsHint = 0;

  /** 暗场 + 房间贴图 + 人 + 提示：淡入淡出与显隐都一起动，别漏掉贴图。 */
  const scenery = (): (Phaser.GameObjects.Graphics | Phaser.GameObjects.Image)[] =>
    baked === null ? layers : [...layers, baked.image];

  /** 内景在屏幕上恒为 `ROOM_W × INTERIOR_PIXEL` 内部像素，不随街景倍率变。 */
  const placeRoom = (): void => {
    for (const layer of [actorG, hintG]) {
      layer.setScale(displayScale);
      layer.setPosition(anchorX, anchorY);
    }
    baked?.image.setScale(displayScale).setPosition(anchorX, anchorY);
  };

  const drawHint = (): void => {
    hintG.clear();
    if (stairsHint <= 0 || layout === null) return;
    const pulse = 0.35 + 0.35 * ((stairsHint % 12) / 12);
    hintG.fillStyle(WORLD.amber, pulse);
    const rect = layout.stairs;
    hintG.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, 1);
    hintG.fillRect(rect.x - 2, rect.y + rect.h + 1, rect.w + 4, 1);
    hintG.fillRect(rect.x - 2, rect.y - 2, 1, rect.h + 4);
    hintG.fillRect(rect.x + rect.w + 1, rect.y - 2, 1, rect.h + 4);
  };

  const drawActors = (ids: readonly string[]): void => {
    actorG.clear();
    if (layout === null) return;
    ids.forEach((_id, index) => {
      const seat = seatFor(layout!, index);
      if (seat === null) return;
      drawActor(actorG, seat.x, seat.y + 16, index);
    });
  };

  return {
    get buildingId(): string | null {
      return current?.instanceId ?? null;
    },
    get hintFrames(): number {
      return stairsHint;
    },
    get debug(): InteriorView['debug'] {
      const image = baked?.image ?? null;
      return {
        scale: displayScale,
        image: image === null ? null : {
          x: image.x,
          y: image.y,
          displayWidth: image.displayWidth,
          displayHeight: image.displayHeight,
          alpha: image.alpha,
          visible: image.visible,
        },
        backdrop: { alpha: backdrop.alpha, visible: backdrop.visible },
      };
    },
    get layout(): InteriorLayout | null {
      return layout;
    },
    show(building: PlacedBuilding, camera: InteriorCamera): void {
      current = building;
      layout = interiorLayoutFor(building);
      // 恒定的屏幕尺寸：texel × 2 × zoom / zoom = 2 内部像素。
      displayScale = INTERIOR_PIXEL / camera.zoom;
      const halfW = (INTERIOR_ROOM_W * INTERIOR_PIXEL) / 2;
      const halfH = (INTERIOR_ROOM_H * INTERIOR_PIXEL) / 2;
      screenLeft = camera.width / 2 - halfW;
      screenTop = camera.height / 2 - halfH;
      // scrollFactor 0 的对象仍吃 zoom：屏幕位置 = (x - W/2)·zoom + W/2，
      // 所以想落在 `screenLeft` 就得把偏移再除以 zoom。
      anchorX = camera.width / 2 - halfW / camera.zoom;
      anchorY = camera.height / 2 - halfH / camera.zoom;
      // 暗场自己撑满：局部 2048 见方、按 1/zoom 缩，缩放后再乘 zoom 仍是整屏。
      backdrop.setScale(1 / camera.zoom);
      backdrop.setPosition(camera.width / 2, camera.height / 2);
      placeRoom();

      if (bakedKey !== layout.key) {
        baked?.destroy();
        baked = bakeLayer(
          scene,
          layout.key,
          INTERIOR_ROOM_W,
          INTERIOR_ROOM_H,
          INTERIOR_ROOM_DEPTH,
          (g) => drawRoom(g, layout!),
        );
        bakedKey = layout.key;
        placeRoom();
      }
      occupantSignature = '';
      stairsHint = 0;
      drawHint();
      for (const layer of scenery()) {
        layer.setScrollFactor(0);
        layer.setVisible(true);
      }
    },
    hide(): void {
      for (const layer of scenery()) {
        layer.setVisible(false);
        layer.setAlpha(0);
      }
      actorG.clear();
      hintG.clear();
      stairsHint = 0;
    },
    setReveal(alpha: number): void {
      const value = Math.max(0, Math.min(1, alpha));
      for (const layer of scenery()) {
        layer.setAlpha(value);
        layer.setVisible(value > 0);
      }
    },
    setOccupants(ids: readonly string[]): void {
      const signature = ids.join('|');
      if (signature === occupantSignature) return;
      occupantSignature = signature;
      drawActors(ids);
    },
    tick(): void {
      if (stairsHint <= 0) return;
      stairsHint -= 1;
      drawHint();
    },
    flashStairs(): void {
      stairsHint = STAIRS_HINT_FRAMES;
      drawHint();
    },
    hitTest(pointerX: number, pointerY: number): 'door' | 'stairs' | null {
      if (layout === null || current === null) return null;
      const localX = (pointerX - screenLeft) / INTERIOR_PIXEL;
      const localY = (pointerY - screenTop) / INTERIOR_PIXEL;
      const rect = layout.door;
      if (
        localX >= rect.x && localX < rect.x + rect.w
        && localY >= rect.y && localY < rect.y + rect.h
      ) {
        return 'door';
      }
      const stairs = layout.stairs;
      if (
        localX >= stairs.x && localX < stairs.x + stairs.w
        && localY >= stairs.y && localY < stairs.y + stairs.h
      ) {
        return 'stairs';
      }
      return null;
    },
    destroy(): void {
      baked?.destroy();
      baked = null;
      bakedKey = null;
      for (const layer of layers) layer.destroy();
    },
  };
}
