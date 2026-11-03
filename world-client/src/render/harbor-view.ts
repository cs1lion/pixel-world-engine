/** 渡口的画：木栈、水线、灯影、船。
 *
 * 这一层只读世界算好的 `HarborState`（`world/harbor.ts`），不自己判潮位、
 * 不自己编船期。世界说「突堤露出 3 格、船搁浅」，这里就画成 3 格干木栈与
 * 一条歪在泥上的船。
 *
 * 分层：水面在 depth 3（`tide-view` 烘的纹理），灯影贴着水面 **3.2**，
 * 木栈与船 **4**（在桥同一层，人走在其上）。倒影必须在水面之上、木栈之下，
 * 否则会被水色整片压掉，读不出「长短随潮位变」。
 *
 * 颜色只从设定集的 24 色里取，不新增色值。
 */
import Phaser from 'phaser';
import type { SettingPack } from '../settings/types.ts';
import { TILE_PX } from '../world/setup.ts';
import { JETTY_CELLS, MAX_REFLECTION_CELLS, type HarborState } from '../world/harbor.ts';

export interface HarborSite {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 渡口地域 → 画布几何。
 *
 * 只有声明了 `ferry` 地域的设定集才有渡口。莞尔镇没有，于是返回 null，
 * 场景不创建这一层——不凭空长出一座码头。
 */
export function harborSiteOf(pack: SettingPack | null | undefined): HarborSite | null {
  const ferry = pack?.regions.find((region) => region.id === 'ferry');
  if (ferry === undefined) return null;
  return { x: ferry.x, y: ferry.y, w: ferry.w, h: ferry.h };
}

export interface HarborView {
  /** 每帧调一次；level 与世界算好的四件事一起进来。 */
  readonly update: (state: HarborState) => void;
  readonly destroy: () => void;
}

export function createHarborView(
  scene: Phaser.Scene,
  pack: SettingPack,
  site: HarborSite,
  originX: number,
  originY: number,
): HarborView {
  const c = pack.palette;
  const reflections = scene.add.graphics().setDepth(3.2);
  const fixtures = scene.add.graphics().setDepth(4);

  // 突堤从岸上伸进浅滩：shoreY 是岸线，tipY 是伸到水里的那一头。
  const shoreY = site.y + 1;
  const tipY = Math.max(1, shoreY - JETTY_CELLS + 1);
  const jettyX = site.x + Math.floor(site.w / 3);
  // 两根系缆灯：一根在木栈左侧，一根在右侧滩头。灯影从它们脚下出发。
  const lampXs = [jettyX - 1, jettyX + 3];

  let lastLevel = -1;
  let lastBoat: HarborState['boat'] | null = null;

  const draw = (state: HarborState): void => {
    reflections.clear();
    fixtures.clear();

    const waterlineY = tipY + Math.round(JETTY_CELLS * state.level);
    for (const cellX of lampXs) {
      const px = originX + cellX * TILE_PX + TILE_PX / 2;
      const py = originY + shoreY * TILE_PX;
      // 灯柱：一根短杆加一粒暖光。它在岸上，不随水位动。
      fixtures.fillStyle(c.timberDark, 1);
      fixtures.fillRect(px - 1, py - 22, 2, 24);
      fixtures.fillStyle(c.trim, 0.8);
      fixtures.fillRect(px - 3, py - 25, 6, 4);
      fixtures.fillStyle(c.warmLight, 0.95);
      fixtures.fillRect(px - 1, py - 24, 2, 2);

      // 灯影：从水线往上拉，长度 = 世界给的 `reflectionCells`。
      // 退潮没有水，一段也不画——不是把灯影变暗，是不存在。
      const cells = Math.min(MAX_REFLECTION_CELLS, state.reflectionCells);
      if (cells <= 0) continue;
      const startY = originY + Math.max(tipY - 1, waterlineY - 1) * TILE_PX;
      for (let i = 0; i < cells; i += 1) {
        const alpha = 0.66 - i * 0.08;
        // 一条 6px 宽的暖色带 + 中间一条更亮的心：远近都读得出「有灯影」。
        reflections.fillStyle(c.amber, Math.max(0.24, alpha));
        reflections.fillRect(px - 3, startY - i * 8, 6, 8);
        reflections.fillStyle(c.warmLight, Math.max(0.18, alpha * 0.75));
        reflections.fillRect(px - 1, startY - i * 8, 2, 5);
      }
    }

    // 木栈：一格一格地画干/湿两段。水线越靠岸，干的越短。
    const jettyPixelX = originX + jettyX * TILE_PX;
    const jettyPixelW = 2 * TILE_PX;
    for (let i = 0; i < JETTY_CELLS; i += 1) {
      const y = tipY + i;
      const py = originY + y * TILE_PX;
      const dry = y >= waterlineY;
      fixtures.fillStyle(dry ? c.trim : c.deepShade, dry ? 0.95 : 0.55);
      fixtures.fillRect(jettyPixelX, py + 3, jettyPixelW, TILE_PX - 4);
      fixtures.fillStyle(dry ? c.timberDark : c.ink, dry ? 0.9 : 0.45);
      fixtures.fillRect(jettyPixelX, py + TILE_PX - 3, jettyPixelW, 2);
      // 每隔一格两根桩：木栈看起来是架在水上的，不是浮在水面的。
      if (i % 2 === 0) {
        fixtures.fillStyle(c.timberDark, dry ? 0.95 : 0.4);
        fixtures.fillRect(jettyPixelX - 2, py + 2, 2, TILE_PX - 3);
        fixtures.fillRect(jettyPixelX + jettyPixelW, py + 2, 2, TILE_PX - 3);
      }
    }
    // 水线：一条浅色泡沫横在木栈上，和 `tide-view` 的水边同一种读法。
    if (waterlineY > tipY && waterlineY <= shoreY + 1) {
      fixtures.fillStyle(c.pale, 0.85);
      fixtures.fillRect(jettyPixelX - 1, originY + waterlineY * TILE_PX, jettyPixelW + 2, 1);
    }

    // 船：靠岸在栈头，往返在河心，搁浅歪在泥上。三种状态不靠颜色区分，
    // 靠位置与姿态——颜色只用来读「木头/船篷」。
    const boat = resolveBoat(state, jettyX, tipY);
    const bx = originX + boat.x * TILE_PX;
    const by = originY + boat.y * TILE_PX;
    const tilt = state.boat === 'grounded';
    drawBoat(fixtures, bx, by, c, tilt);
    if (state.boat === 'docked') {
      // 系缆绳：从船头拉到木栈边。
      fixtures.fillStyle(c.trim, 0.75);
      fixtures.fillRect(jettyPixelX + jettyPixelW, by + 6, Math.max(2, bx - jettyPixelX - jettyPixelW), 1);
    }
    if (state.boat === 'crossing') {
      // 尾迹：两段浅色短线，读成船在走。
      fixtures.fillStyle(c.pale, 0.5);
      fixtures.fillRect(bx - 14, by + 8, 10, 2);
      fixtures.fillRect(bx - 22, by + 10, 7, 1);
    }
  };

  return {
    update(state: HarborState): void {
      // 潮位变化很小，但船的状态或干湿段一变，画面就得重画。
      if (Math.abs(state.level - lastLevel) < 0.002 && state.boat === lastBoat) return;
      lastLevel = state.level;
      lastBoat = state.boat;
      draw(state);
    },
    destroy(): void {
      reflections.destroy();
      fixtures.destroy();
    },
  };
}

/** 船的位置。三档用三处可数的落点，不按帧插值。 */
function resolveBoat(
  state: HarborState,
  jettyX: number,
  tipY: number,
): { x: number; y: number } {
  switch (state.boat) {
    case 'docked':
      return { x: jettyX + 3, y: tipY + 1 };
    case 'crossing':
      // 河心在栈头往右 5 格：再远会滑到小地图浮层底下，读不到「船在走」。
      return { x: jettyX + 5, y: tipY + 2 };
    case 'grounded':
      return { x: jettyX + 2, y: tipY + 4 };
  }
}

/** 一条 20×7 像素的小船。`tilt` 时逐段下沉，读成搁浅歪在泥上。 */
function drawBoat(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  tilt: boolean,
): void {
  if (tilt) {
    // 泥上的影子，先画，压在船底。
    g.fillStyle(c.soil, 0.8);
    g.fillRect(x + 1, y + 8, 22, 3);
  }
  // 船壳：左低右高的两段，搁浅时右段再沉 2px。
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x, y + (tilt ? 5 : 3), 20, 4);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 2, y + (tilt ? 3 : 1), 16, 3);
  // 船篷。
  g.fillStyle(c.copper, 1);
  g.fillRect(x + 6, y - 3 + (tilt ? 2 : 0), 8, 5);
  g.fillStyle(c.trim, 0.9);
  g.fillRect(x + 7, y - 2 + (tilt ? 2 : 0), 6, 1);
  // 桅杆与船头。
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 15, y - 8 + (tilt ? 2 : 0), 1, 9);
  g.fillStyle(c.pale, tilt ? 0.35 : 0.85);
  g.fillRect(x + 12, y - 7 + (tilt ? 2 : 0), 3, 1);
}
