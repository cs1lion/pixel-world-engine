/** 设定集场景补绘（2026-11-03）。数据与页码在 `settings/dengchao/scene-artbook.ts`。
 *
 * 为什么单开一层而不是继续往 `setting-scenery.ts` 里塞分支：
 * - 叠浪楼的正立面是**覆盖在通用楼体上**画的一整套形制，和"桥/摊/灯"这种
 *   单件构件不是一回事；
 * - 这些形制各自要落在不同的 depth（地面、水面、远景、楼体立面），合在一张
 *   Graphics 上会被最后一个 depth 抬走——`setting-scenery.ts` 头部那条教训。
 *
 * 所有颜色都走 `pack.palette` 的 24 色槽位，没有新增依赖，也没有字面量色值。
 */
import Phaser from 'phaser';
import type { SettingPack } from '../settings/types.ts';
import { TILE_PX } from '../world/setup.ts';
import { lampStreetLitAt, type LampPhase } from '../world/lamp-street.ts';
import { markDofStatic } from './dof-view.ts';

export interface SceneArtbookClock {
  readonly phase: LampPhase;
  readonly autoAdvancing: boolean;
  /** 调试灯态：给了就压过时钟判据（与 `SettingSceneryClock` 同一个口子）。 */
  readonly litOverride?: boolean;
  /**
   * 藏掉湾面低雾（`debugHideBayMist` 写这个口子）。雾条按世界时刻横移，
   * 会在「烟关掉」的对照里留下一条 420×5 的像素差；只为证据隔离，与藏鸟同一类。
   */
  readonly hideBayMist?: boolean;
}

export interface ArtbookPoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneArtbookView {
  update(level: number, now: number, clock: SceneArtbookClock): void;
  destroy(): void;
}

/**
 * @param windows 既有店面格窗的灯点（`setting-scenery.ts` 维护）；补绘的窗火直接追加进去。
 * @param reflectors 夜间水面倒影的锚点；桥头灯在 `setting-scenery.ts` 里追加。
 */
export function createSceneArtbook(
  scene: Phaser.Scene,
  pack: SettingPack,
  windows: ArtbookPoint[],
  reflectors: ArtbookPoint[],
  hallAt?: ArtbookPoint,
): SceneArtbookView {
  // depth 1.5：石阶/石沟压在铺装（1）之上，又被潮水（3）盖住。
  // 贴地三张（ground / backdrop / quay）在创建时画一遍就不再动，进 P2 糊图闭包；
  // water / farLight / fog 是每帧重画的动态层，不标。
  const ground = markDofStatic(scene.add.graphics().setDepth(1.5));
  // depth 3.4：水面灯影贴在水面（3）上，桥（4）仍压在它前面。
  const water = scene.add.graphics().setDepth(3.4);
  // depth 5：对岸屋脊/钟塔压在水面，又让渡口石堤（6）站在它前面。
  const backdrop = markDofStatic(scene.add.graphics().setDepth(5));
  // depth 5.2：对岸窗火压在屋脊上，仍在水面与雾之下。
  const farLight = scene.add.graphics().setDepth(5.2);
  const quay = markDofStatic(scene.add.graphics().setDepth(6));
  // depth 1370：街市山墙在既有店铺立面之前、木构挑檐之后。
  const facade = scene.add.graphics().setDepth(1370);
  // depth 1417：叠浪楼补绘压在通用楼体（1416）之上，门洞挑檐（1448）仍在它前面。
  const architecture = scene.add.graphics().setDepth(1417);
  const fog = scene.add.graphics().setDepth(7995);
  const c = pack.palette;
  const farWindows: ArtbookPoint[] = [];

  for (const item of pack.scenery) {
    const x = item.at.x * TILE_PX;
    const y = item.at.y * TILE_PX;
    if (item.kind === 'ridge') {
      drawFarRidge(backdrop, x, y, item.length ?? 0, c, farWindows, reflectors);
    } else if (item.kind === 'far_tower') {
      drawFarTower(backdrop, x, y, c, farWindows);
    } else if (item.kind === 'quay') {
      drawQuay(quay, x, y, item.length ?? 0, c);
    } else if (item.kind === 'steps') {
      drawSteps(ground, x, y, item.length ?? 0, c);
    } else if (item.kind === 'drain') {
      drawDrain(ground, x, y, item.length ?? 0, c);
    } else if (item.kind === 'street_paving') {
      drawStreetPaving(ground, x, y, item.length ?? 0, c);
    } else if (item.kind === 'shopfront_gable') {
      drawGableShopfront(facade, x, y, item.length ?? 4, c, windows);
    } else if (item.kind === 'boiler') {
      drawBoiler(facade, x, y, c);
    } else if (item.kind === 'coal_heap') {
      drawCoalHeap(facade, x, y, c);
    }
  }

  // 主楼补绘：位置由 `setting-scenery.ts` 从摆放取后传进来，这里不写第二份坐标。
  if (hallAt !== undefined) {
    drawBathhouse(architecture, hallAt.x, hallAt.y, c, windows);
  }

  return {
    update(_level, now, clock) {
      const lit = clock.litOverride ?? lampStreetLitAt(now, clock.phase, clock.autoAdvancing);
      water.clear();
      fog.clear();
      farLight.clear();
      drawWaterLight(water, reflectors, lit, c);
      if (lit) drawFarWindows(farLight, farWindows, c);
      if (clock.hideBayMist !== true) drawMist(fog, now, clock.phase, c);
    },
    destroy() {
      for (const layer of [ground, water, backdrop, farLight, quay, facade, architecture, fog]) {
        layer.destroy();
      }
    },
  };
}

type Palette = SettingPack['palette'];

/**
 * 叠浪楼主楼的正立面（PDF p15/p16/p39/p46）。
 *
 * 覆盖通用楼体而不是新建一栋楼：占地、门洞、任务与光照仍归通用楼体，
 * 这里只补"它长什么样"。所以底层的门要在重绘墙面后自己补回来。
 */
function drawBathhouse(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: Palette,
  windows: ArtbookPoint[],
): void {
  const w = 112;
  const h = 96;
  const win = (wx: number, wy: number, ww: number, wh: number): void => {
    g.fillStyle(c.ink, 1);
    g.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
    g.fillStyle(c.amber, 0.62);
    g.fillRect(wx, wy, ww, wh);
    g.fillStyle(c.timberDark, 1);
    for (let i = 3; i < ww; i += 4) g.fillRect(wx + i, wy, 1, wh);
    g.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
    windows.push({ x: wx + ww / 2, y: wy + wh / 2 });
  };

  // 1. 下部墙体与腰线：赭红木骨 + 三道米白灰泥带（p15 的横向楼层线）。
  g.fillStyle(c.timber, 1);
  g.fillRect(x + 1, y, w - 2, h);
  g.fillStyle(c.timberDark, 0.85);
  for (let i = 8; i < w - 2; i += 10) g.fillRect(x + i, y, 1, h);
  for (const dy of [7, 39, 65]) {
    g.fillStyle(c.plaster, 1);
    g.fillRect(x + 1, y + dy, w - 2, 5);
    g.fillStyle(c.stone, 0.45);
    g.fillRect(x + 1, y + dy + 5, w - 2, 1);
  }

  // 2. 两侧窗列：入口凸出段（x+26..x+84）留空，窗只落在两翼。
  for (const dy of [16, 44]) {
    win(x + 4, y + dy, 9, 11);
    win(x + 15, y + dy, 9, 11);
    win(x + 88, y + dy, 9, 11);
    win(x + 99, y + dy, 9, 11);
  }

  // 3. 望楼栏杆：每层窗下压一道，柱子每 12px 一根（p15 的长阳台）。
  for (const dy of [29, 57]) {
    g.fillStyle(c.trim, 0.75);
    g.fillRect(x + 2, y + dy, w - 4, 1);
    g.fillStyle(c.terracotta, 1);
    g.fillRect(x + 2, y + dy + 1, w - 4, 2);
    for (let i = 0; i < w - 8; i += 12) g.fillRect(x + 5 + i, y + dy, 1, 4);
  }

  // 4. 上层：覆盖通用屋顶，加一排窗与檐下影。
  g.fillStyle(c.timber, 1);
  g.fillRect(x + 2, y - 30, w - 4, 30);
  g.fillStyle(c.timberDark, 0.85);
  for (let i = 10; i < w - 4; i += 10) g.fillRect(x + 2 + i, y - 30, 1, 30);
  g.fillStyle(c.plaster, 1);
  g.fillRect(x + 2, y - 27, w - 4, 5);
  for (let i = 0; i < 5; i += 1) win(x + 8 + i * 18, y - 19, 13, 11);
  g.fillStyle(c.trim, 0.7);
  g.fillRect(x + 2, y - 6, w - 4, 1);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 2, y - 5, w - 4, 2);
  for (let i = 0; i < w - 8; i += 12) g.fillRect(x + 5 + i, y - 6, 1, 4);

  // 5. 主屋面：五排逐层加宽的庑殿顶，檐角起翘（p15/p39 的铜绿大屋顶）。
  g.fillStyle(c.deepShade, 0.3);
  g.fillRect(x - 10, y - 32, w + 20, 3);
  for (let row = 0; row < 5; row += 1) {
    const rw = 96 + row * 8;
    g.fillStyle(c.copper, 1);
    g.fillRect(x + (w - rw) / 2, y - 44 + row * 3, rw, 3);
    g.fillStyle(c.deepShade, 0.28);
    g.fillRect(x + (w - rw) / 2, y - 31 + row * 3, rw, 1);
  }
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 8, y - 45, 96, 2);
  g.fillRect(x - 12, y - 33, 5, 2);
  g.fillRect(x + w + 7, y - 33, 5, 2);

  // 6. 上层小顶与宝顶：比主顶窄两档，坐在屋檐上。
  g.fillStyle(c.plaster, 1);
  g.fillRect(x + 20, y - 46, 72, 2);
  for (let row = 0; row < 4; row += 1) {
    const rw = 40 + row * 8;
    g.fillStyle(c.copper, 1);
    g.fillRect(x + (w - rw) / 2, y - 60 + row * 3, rw, 3);
    g.fillStyle(c.deepShade, 0.26);
    g.fillRect(x + (w - rw) / 2, y - 48 + row * 3, rw, 1);
  }
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 43, y - 61, 26, 2);
  g.fillRect(x + 55, y - 65, 2, 5);
  g.fillRect(x - 2, y - 47, 4, 2);
  g.fillRect(x + w - 2, y - 47, 4, 2);

  // 7. 入口门楼：凸出的弧形山墙 + 横匾 + 暖帘，门洞补回通用门的位置。
  for (let row = 0; row < 4; row += 1) {
    const rw = 30 + row * 8;
    g.fillStyle(c.copper, 1);
    g.fillRect(x + 56 - rw / 2, y + 18 + row * 3, rw, 3);
    g.fillStyle(c.deepShade, 0.24);
    g.fillRect(x + 56 - rw / 2, y + 30 + row * 3, rw, 1);
  }
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 44, y + 17, 24, 2);
  g.fillRect(x + 30, y + 28, 4, 2);
  g.fillRect(x + 78, y + 28, 4, 2);
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 26, y + 29, 4, 67);
  g.fillRect(x + 82, y + 29, 4, 67);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 38, y + 36, 36, 18);
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 39, y + 37, 34, 16);
  g.fillStyle(c.timberDark, 1);
  for (let i = 0; i < 3; i += 1) g.fillRect(x + 43 + i * 11, y + 41, 7, 8);
  g.fillStyle(c.terracotta, 1);
  for (let i = 0; i < 3; i += 1) g.fillRect(x + 45 + i * 11, y + 43, 3, 4);
  // 暖帘：三幅，帘脚停在门楣上，不遮门洞
  g.fillStyle(c.pale, 1);
  g.fillRect(x + 40, y + 54, 32, 14);
  g.fillStyle(c.ember, 1);
  g.fillRect(x + 40, y + 54, 32, 3);
  g.fillStyle(c.cloak, 0.8);
  g.fillRect(x + 40, y + 62, 32, 2);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 50, y + 57, 1, 11);
  g.fillRect(x + 61, y + 57, 1, 11);
  g.fillRect(x + 71, y + 57, 1, 11);
  // 门洞
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 43, y + 68, 26, 28);
  g.fillStyle(c.ember, 0.9);
  g.fillRect(x + 45, y + 70, 22, 23);
  g.fillStyle(c.warmLight, 0.85);
  g.fillRect(x + 50, y + 75, 12, 12);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 56, y + 70, 1, 23);
  g.fillStyle(c.stone, 1);
  g.fillRect(x + 40, y + 92, 32, 4);
  windows.push({ x: x + 56, y: y + 81 });

  // 8. 门旁一对方形纸灯（p46 桥头灯形制）。
  for (const lx of [x + 16, x + 92]) {
    g.fillStyle(c.timberDark, 1);
    g.fillRect(lx + 2, y + 52, 2, 44);
    g.fillRect(lx - 1, y + 52, 8, 1);
    g.fillStyle(c.ember, 1);
    g.fillRect(lx, y + 40, 6, 12);
    g.fillStyle(c.trim, 1);
    g.fillRect(lx, y + 40, 6, 1);
    g.fillStyle(c.warmLight, 1);
    g.fillRect(lx + 2, y + 45, 2, 3);
    g.fillStyle(c.ink, 1);
    g.fillRect(lx, y + 51, 6, 1);
    windows.push({ x: lx + 3, y: y + 46 });
  }
  // 门前那道水口整段被朱红桥盖住（pack 的地形与桥同占 x28..37,y27），
  // 所以这里不往水里塞倒影——倒影只画在真能看到水面的湾面（对岸窗火）。

  // 9. 独立砖烟囱：高出主楼一层檐，筒身每 24px 一道箍（p15）。
  const cx = x + w + 12;
  g.fillStyle(c.stone, 1);
  g.fillRect(cx - 4, y + 2, 18, 10);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(cx, y - 132, 10, 136);
  g.fillStyle(c.deepShade, 0.35);
  g.fillRect(cx, y - 132, 2, 136);
  for (let dy = -120; dy < 0; dy += 24) {
    g.fillStyle(c.trim, 0.75);
    g.fillRect(cx - 1, y + dy, 12, 2);
  }
  g.fillStyle(c.charcoal, 1);
  g.fillRect(cx - 3, y - 140, 16, 8);
  g.fillStyle(c.trim, 1);
  g.fillRect(cx - 3, y - 140, 16, 1);
  g.fillStyle(c.ink, 1);
  g.fillRect(cx + 1, y - 128, 2, 2);
  g.fillRect(cx + 5, y - 126, 2, 3);
  g.fillRect(cx + 1, y - 120, 3, 2);

  // 10. 左墙外的竖幌（p16 入口那张大幌）。
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x - 9, y - 38, 2, 44);
  g.fillRect(x - 9, y - 38, 10, 1);
  g.fillStyle(c.pale, 1);
  g.fillRect(x - 24, y - 36, 14, 46);
  g.fillStyle(c.trim, 0.8);
  g.fillRect(x - 24, y - 36, 14, 1);
  g.fillRect(x - 24, y + 9, 14, 1);
  g.fillStyle(c.ember, 1);
  g.fillRect(x - 24, y + 2, 14, 6);
  g.fillStyle(c.ink, 1);
  g.fillRect(x - 20, y - 28, 6, 6);
  g.fillRect(x - 19, y - 27, 4, 4);
}

/**
 * 水对岸的屋脊线与山影（PDF p3/p41）。
 *
 * 画在 depth 5：压在水面（3），又被渡口石堤（6）与整个镇子（1400+）盖住。
 * 只画"一条连续的横脊 + 两层山影"，不做具体房子；p3 的夜景里对岸也没有
 * 一栋能看清立面的房子，只有一排屋脊和零星窗火。
 */
function drawFarRidge(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: Palette,
  farWindows: ArtbookPoint[],
  reflectors: ArtbookPoint[],
): void {
  const span = length * TILE_PX;
  // 后层山影：更浅、更高、只在几段露出。
  for (let i = 0; i < 5; i += 1) {
    const cx = x + 110 + i * 190;
    for (let row = 0; row < 2; row += 1) {
      const rw = 130 - row * 40;
      g.fillStyle(c.charcoal, 0.42);
      g.fillRect(cx - rw / 2, y - 9 + row * 4, rw, 3);
    }
  }
  // 近层岸线：一条连续的暗带 + 两层低山。
  g.fillStyle(c.deepShade, 1);
  g.fillRect(x, y, span, 12);
  g.fillStyle(c.charcoal, 1);
  g.fillRect(x, y, span, 6);
  for (let i = 0; i < 6; i += 1) {
    const cx = x + 84 + i * 168;
    for (let row = 0; row < 2; row += 1) {
      const rw = 96 - row * 30;
      g.fillStyle(c.deepShade, 1);
      g.fillRect(cx - rw / 2, y - 6 + row * 3, rw, 3);
    }
  }
  // 屋脊：横脊为主，每 4 格一栋；窗只点在三栋里的一栋。
  for (let i = 0; i < length; i += 4) {
    const hx = x + i * TILE_PX;
    g.fillStyle(c.timberDark, 1);
    g.fillRect(hx + 2, y + 1, 30, 4);
    g.fillStyle(c.charcoal, 1);
    g.fillRect(hx + 6, y - 2, 22, 3);
    g.fillStyle(c.plaster, 0.5);
    g.fillRect(hx + 3, y + 5, 28, 2);
    if (i % 12 === 4) {
      g.fillStyle(c.amber, 0.45);
      g.fillRect(hx + 12, y + 2, 2, 2);
      farWindows.push({ x: hx + 13, y: y + 3 });
      reflectors.push({ x: hx + 13, y: y + 12 });
    }
  }
  // 岸线脚：一条更暗的线，把屋脚与水面切开。
  g.fillStyle(c.ink, 0.8);
  g.fillRect(x, y + 10, span, 2);
}

/** 对岸钟塔（PDF p3）：方塔身、四面钟盘、攒尖顶。 */
function drawFarTower(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: Palette,
  farWindows: ArtbookPoint[],
): void {
  g.fillStyle(c.stone, 1);
  g.fillRect(x, y - 4, 26, 6);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 3, y - 52, 20, 50);
  g.fillStyle(c.deepShade, 0.35);
  g.fillRect(x + 3, y - 52, 4, 50);
  g.fillStyle(c.trim, 0.7);
  for (const dy of [-38, -22, -6]) g.fillRect(x + 3, y + dy, 20, 1);
  // 钟盘
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 7, y - 48, 14, 14);
  g.fillStyle(c.warmLight, 0.9);
  g.fillRect(x + 8, y - 47, 12, 12);
  g.fillStyle(c.charcoal, 1);
  g.fillRect(x + 13, y - 46, 1, 6);
  g.fillRect(x + 13, y - 41, 4, 1);
  // 下层两扇暖窗
  for (const dy of [-30, -14]) {
    g.fillStyle(c.amber, 0.65);
    g.fillRect(x + 9, y + dy, 3, 5);
    g.fillRect(x + 15, y + dy, 3, 5);
    farWindows.push({ x: x + 10, y: y + dy + 2 }, { x: x + 16, y: y + dy + 2 });
  }
  // 攒尖小顶
  for (let row = 0; row < 3; row += 1) {
    const rw = 26 - row * 6;
    g.fillStyle(c.charcoal, 1);
    g.fillRect(x + 13 - rw / 2, y - 58 + row * 3, rw, 3);
  }
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 12, y - 62, 2, 4);
  g.fillStyle(c.ember, 1);
  g.fillRect(x + 4, y - 5, 3, 2);
  g.fillRect(x + 19, y - 5, 3, 2);
}

/** 夜间对岸窗火：只在灯亮的那一拍画，白天完全消失。 */
function drawFarWindows(
  g: Phaser.GameObjects.Graphics,
  points: readonly ArtbookPoint[],
  c: Palette,
): void {
  for (const p of points) {
    // 芯一亮一暖两点：白天的窗格已经画死，夜里只补"亮着"的那一点，
    // 光晕由既有灯层负责，不在这里叠第二层方块（那一层很贵）。
    g.fillStyle(c.warmLight, 0.95);
    g.fillRect(p.x - 1, p.y - 1, 3, 3);
    g.fillStyle(c.amber, 0.55);
    g.fillRect(p.x - 2, p.y + 1, 5, 2);
  }
}

/** 水面灯影（PDF p41/p3）：竖向三档，越远越淡。只画在真能看到水面的湾面。 */
function drawWaterLight(
  g: Phaser.GameObjects.Graphics,
  points: readonly ArtbookPoint[],
  lit: boolean,
  c: Palette,
): void {
  if (!lit) return;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const lean = (i % 3) - 1;
    g.fillStyle(c.warmLight, 0.22);
    g.fillRect(p.x - 2 + lean, p.y, 4, 4);
    g.fillStyle(c.amber, 0.12);
    g.fillRect(p.x - 1 + lean, p.y + 4, 3, 8);
  }
}

/** 湾面低雾（PDF p41）：横向长条，缓慢横移；只盖屋脚与水面，不盖立面。 */
function drawMist(
  g: Phaser.GameObjects.Graphics,
  now: number,
  phase: LampPhase,
  c: Palette,
): void {
  const strength =
    phase === 'night' ? 1 : phase === 'dusk' ? 0.62 : phase === 'dawn' ? 0.5 : 0.18;
  for (let i = 0; i < 3; i += 1) {
    const drift = ((now / 95 + i * 233) % 1500) - 240;
    const yy = 40 + i * 56;
    g.fillStyle(c.pale, 0.025 + strength * 0.045);
    g.fillRect(drift, yy, 420, 5);
    g.fillStyle(c.plaza, 0.02 + strength * 0.025);
    g.fillRect(drift + 90, yy + 5, 260, 2);
  }
  // 屋脚那一线：把远岸的落地吃掉，p41 的对岸就是这么浮在水上的。
  g.fillStyle(c.pale, 0.03 + strength * 0.05);
  g.fillRect(0, 212, 1024, 4);
  g.fillStyle(c.plaza, 0.02 + strength * 0.03);
  g.fillRect(0, 216, 1024, 2);
}

/**
 * 渡口石砌突堤（PDF p41）：条石错缝、堤头三级踏步下水、两根系船石柱。
 *
 * 画在 depth 6：人在堤上走时，人物层（1400+）仍在他前面；水（3）在堤下。
 * `length` 是**沿岸的横向格数**（和 track/bridge 同口径）。早先按纵向口径画成
 * 2 格宽、4 格高，在渡口机位里读成一根石柱——堤是低而长的一条，不是塔。
 */
function drawQuay(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: Palette,
): void {
  const w = length * TILE_PX;
  const h = 18;
  // 落影：堤脚压在水面上，不是浮着。
  g.fillStyle(c.ink, 0.35);
  g.fillRect(x + 3, y + 4, w, h);
  // 堤身：条石错缝，横缝每 6px，竖缝错开。
  g.fillStyle(c.stone, 1);
  g.fillRect(x, y, w, h);
  for (let row = 0; row < h / 6; row += 1) {
    const yy = y + row * 6;
    g.fillStyle(c.ink, 0.24);
    g.fillRect(x, yy, w, 1);
    for (let col = row % 2 === 0 ? 8 : 16; col < w; col += 24) {
      g.fillStyle(c.ink, 0.24);
      g.fillRect(x + col, yy, 1, 6);
    }
  }
  // 堤沿：上沿压亮边，下沿压深影，读成"比水面高一级"。
  g.fillStyle(c.plaza, 1);
  g.fillRect(x, y, w, 2);
  g.fillStyle(c.deepShade, 0.5);
  g.fillRect(x, y + h - 1, w, 1);
  // 堤头三级踏步：在东端往下走到水面，越靠外越亮。
  for (let step = 0; step < 3; step += 1) {
    g.fillStyle(step === 0 ? c.plaza : c.stone, 1);
    g.fillRect(x + w - 20 + step * 3, y + 2 + step * 4, 20 - step * 3, 4);
    g.fillStyle(c.ink, 0.3);
    g.fillRect(x + w - 20 + step * 3, y + 6 + step * 4, 20 - step * 3, 1);
  }
  // 系船石柱 + 绳：柱头只留一道浅檐，不做雕饰。
  for (const bx of [x + w / 4, x + (w * 3) / 4 - 4]) {
    g.fillStyle(c.charcoal, 1);
    g.fillRect(bx, y - 5, 4, 7);
    g.fillStyle(c.trim, 0.8);
    g.fillRect(bx - 1, y - 5, 6, 1);
    g.fillStyle(c.trim, 1);
    g.fillRect(bx + 4, y - 1, 5, 1);
    g.fillRect(bx + 8, y + 2, 1, 3);
  }
  // 候船石：一块更亮的石面，缝里长苔。
  g.fillStyle(c.plaza, 0.85);
  g.fillRect(x + 10, y + 4, 16, 9);
  g.fillStyle(c.moss, 0.35);
  g.fillRect(x + 11, y + 12, 6, 1);
  g.fillRect(x + 8, y + 16, 10, 1);
}

/** 街面南段铺装（PDF p40）：湿石错缝，靠摊位一侧更暗。 */
function drawStreetPaving(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: Palette,
): void {
  const w = length * TILE_PX;
  g.fillStyle(c.plaza, 1);
  g.fillRect(x, y, w, 16);
  // 每两块（32px）一组的错缝石板：竖缝一深一亮，比逐格画省一半指令，
  // 16px 的瓦片尺度仍是按石板对的，不是大色块。
  for (let px = x; px < x + w; px += 32) {
    g.fillStyle(c.stone, 0.55);
    g.fillRect(px, y, 1, 16);
    if ((px - x) % 96 === 0) {
      g.fillStyle(c.deepShade, 0.18);
      g.fillRect(px + 2, y + 2, 28, 6);
      g.fillStyle(c.moss, 0.25);
      g.fillRect(px + 2, y + 14, 9, 1);
    }
  }
  g.fillStyle(c.ink, 0.22);
  g.fillRect(x, y + 15, w, 1);
}

/** 街面石阶（PDF p35/p40）：四级踏步 + 两侧短挡墙。 */
function drawSteps(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: Palette,
): void {
  const w = length * TILE_PX;
  g.fillStyle(c.stone, 1);
  g.fillRect(x - 3, y, w + 6, 18);
  for (let step = 0; step < 4; step += 1) {
    g.fillStyle(step % 2 === 0 ? c.plaza : c.stone, 1);
    g.fillRect(x, y + step * 4, w, 4);
    g.fillStyle(c.ink, 0.32);
    g.fillRect(x, y + step * 4 + 4, w, 1);
    g.fillStyle(c.trim, 0.35);
    g.fillRect(x, y + step * 4, w, 1);
  }
  // 短挡墙：压住阶沿，墙头与地面同高。
  g.fillStyle(c.stone, 1);
  g.fillRect(x - 3, y - 2, 3, 20);
  g.fillRect(x + w, y - 2, 3, 20);
  g.fillStyle(c.ink, 0.35);
  g.fillRect(x - 3, y + 17, 3, 1);
  g.fillRect(x + w, y + 17, 3, 1);
  g.fillStyle(c.moss, 0.35);
  g.fillRect(x + 6, y + 5, 4, 1);
  g.fillRect(x + w - 12, y + 13, 5, 1);
}

/** 街面石沟（PDF p35 石作层叠；沟槽是按街面分段补的延伸件）。 */
function drawDrain(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: Palette,
): void {
  const w = length * TILE_PX;
  g.fillStyle(c.stone, 1);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + 4, w, 1);
  g.fillStyle(c.ink, 0.85);
  g.fillRect(x, y + 1, w, 3);
  g.fillStyle(c.water, 0.55);
  g.fillRect(x, y + 3, w, 1);
  // 格栅每 8 格一块：四边压石，栅条两道。
  for (let i = 0; i < length; i += 8) {
    const gx = x + i * TILE_PX;
    g.fillStyle(c.stone, 1);
    g.fillRect(gx + 2, y, 12, 5);
    g.fillStyle(c.charcoal, 1);
    g.fillRect(gx + 5, y + 1, 1, 3);
    g.fillRect(gx + 9, y + 1, 1, 3);
    g.fillStyle(c.moss, 0.3);
    g.fillRect(gx + 12, y + 5, 3, 1);
  }
}

/**
 * 街市弧形山墙店面（PDF p35/p40）：三级收分的弧形山墙 + 圆窗 + 竖招牌 + 檐下灯。
 *
 * 只做立面，不做占地与门：它是街市北侧的第二排"看得见的铺面"，
 * 让灯街从一条摊车带读成一条有进深的街。
 */
function drawGableShopfront(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: Palette,
  windows: ArtbookPoint[],
): void {
  const w = length * TILE_PX;
  // 墙脚与墙体
  g.fillStyle(c.ink, 0.3);
  g.fillRect(x + 1, y - 2, w - 2, 3);
  g.fillStyle(c.plaster, 1);
  g.fillRect(x, y - 30, w, 30);
  g.fillStyle(c.stone, 1);
  g.fillRect(x, y - 6, w, 6);
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x, y - 30, 2, 30);
  g.fillRect(x + w - 2, y - 30, 2, 30);
  g.fillRect(x, y - 18, w, 1);
  g.fillRect(x, y - 6, w, 1);
  // 弧形山墙：宽度按 w、w-6、w-16、w-28、w-40 收，前三行收得慢、后两行收得快，
  // 读成半个拱而不是阶梯金字塔；每行上沿压一道亮边（p35 的灰泥山墙）。
  const archWidths = [w, w - 6, w - 16, w - 28, w - 40];
  for (let row = 0; row < archWidths.length; row += 1) {
    const rw = archWidths[row];
    if (rw <= 0) continue;
    g.fillStyle(c.plaster, 1);
    g.fillRect(x + (w - rw) / 2, y - 34 - row * 4, rw, 4);
    g.fillStyle(row === archWidths.length - 1 ? c.trim : c.plaster, 0.5);
    g.fillRect(x + (w - rw) / 2, y - 34 - row * 4, rw, 1);
    g.fillStyle(c.stone, 0.45);
    g.fillRect(x + (w - rw) / 2, y - 31 - row * 4, rw, 1);
  }
  // 拱心石：一块竖压的浅色石，把拱顶的顶点钉住。
  g.fillStyle(c.trim, 0.8);
  g.fillRect(x + w / 2 - 1, y - 52, 3, 6);
  // 圆窗：方形切角，像素里读成圆形。
  const cx = x + w / 2 - 7;
  g.fillStyle(c.trim, 1);
  g.fillRect(cx, y - 49, 14, 14);
  g.fillStyle(c.ink, 1);
  g.fillRect(cx + 1, y - 48, 12, 12);
  g.fillStyle(c.amber, 0.6);
  g.fillRect(cx + 2, y - 47, 10, 10);
  g.fillStyle(c.timberDark, 1);
  g.fillRect(cx + 7, y - 47, 1, 10);
  g.fillRect(cx + 2, y - 42, 10, 1);
  windows.push({ x: cx + 7, y: y - 42 });
  // 两枚竖招牌：压深色自造字块。
  for (const sx of [x + 4, x + w - 10]) {
    g.fillStyle(c.ink, 1);
    g.fillRect(sx, y - 26, 7, 16);
    g.fillStyle(c.trim, 1);
    g.fillRect(sx + 1, y - 25, 5, 14);
    g.fillStyle(c.timberDark, 1);
    g.fillRect(sx + 2, y - 23, 3, 2);
    g.fillRect(sx + 2, y - 19, 3, 1);
    g.fillRect(sx + 2, y - 16, 3, 2);
  }
  // 底层格门
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + w / 2 - 14, y - 16, 28, 16);
  g.fillStyle(c.amber, 0.45);
  g.fillRect(x + w / 2 - 12, y - 14, 24, 13);
  g.fillStyle(c.timberDark, 1);
  for (let i = 0; i < 24; i += 6) g.fillRect(x + w / 2 - 12 + i, y - 14, 1, 13);
  // 檐下布幔：分条，幔脚掀一角（每 6px 一条，16px 瓦片尺度下仍读得出分条）。
  for (let i = 0; i < w; i += 6) {
    g.fillStyle(i % 8 === 0 ? c.warmLight : c.terracotta, 0.9);
    g.fillRect(x + i, y - 12, 3, 4);
  }
  g.fillStyle(c.ink, 0.5);
  g.fillRect(x, y - 8, w, 1);
  // 檐下三盏红灯
  for (let i = 0; i < 3; i += 1) {
    const lx = x + 12 + i * (w - 24) / 2;
    g.fillStyle(c.ember, 1);
    g.fillRect(lx, y - 4, 5, 7);
    g.fillStyle(c.trim, 1);
    g.fillRect(lx, y - 4, 5, 1);
    g.fillStyle(c.ink, 1);
    g.fillRect(lx, y + 3, 5, 1);
    windows.push({ x: lx + 3, y: y - 1 });
  }
  // 斑驳：雨痕、露石、补板。
  g.fillStyle(c.deepShade, 0.22);
  g.fillRect(x + 10, y - 28, 1, 14);
  g.fillRect(x + w - 16, y - 26, 1, 10);
  g.fillStyle(c.stone, 0.7);
  g.fillRect(x + w - 26, y - 24, 7, 5);
  g.fillStyle(c.timberDark, 0.8);
  g.fillRect(x + w - 24, y - 8, 12, 2);
}

/** 炉底炉膛（PDF p48）：砖砌炉口、铁皮烟道、砖烟囱。 */
function drawBoiler(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: Palette,
): void {
  g.fillStyle(c.ink, 0.35);
  g.fillRect(x - 2, y + 20, 40, 5);
  g.fillStyle(c.charcoal, 1);
  g.fillRect(x + 1, y - 2, 22, 26);
  g.fillStyle(c.deepShade, 0.5);
  g.fillRect(x + 1, y - 2, 4, 26);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 4, y + 5, 16, 13);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 7, y + 8, 10, 9);
  g.fillStyle(c.ember, 1);
  g.fillRect(x + 8, y + 9, 8, 7);
  g.fillStyle(c.warmLight, 1);
  g.fillRect(x + 10, y + 11, 4, 4);
  g.fillStyle(c.charcoal, 1);
  for (let i = 0; i < 8; i += 3) g.fillRect(x + 8 + i, y + 10, 1, 6);
  // 铁皮烟道：先横走再折上。
  g.fillStyle(c.charcoal, 1);
  g.fillRect(x + 20, y + 2, 12, 5);
  g.fillRect(x + 29, y - 26, 6, 33);
  g.fillStyle(c.trim, 0.7);
  g.fillRect(x + 29, y - 18, 6, 1);
  g.fillRect(x + 29, y - 6, 6, 1);
  // 砖烟囱
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 28, y - 38, 8, 16);
  g.fillStyle(c.trim, 0.7);
  g.fillRect(x + 27, y - 38, 10, 1);
  g.fillRect(x + 27, y - 31, 10, 1);
  g.fillStyle(c.charcoal, 1);
  g.fillRect(x + 26, y - 42, 12, 4);
  g.fillStyle(c.stone, 1);
  g.fillRect(x + 1, y + 22, 22, 4);
  g.fillStyle(c.moss, 0.3);
  g.fillRect(x + 2, y + 23, 6, 1);
}

/** 炉前煤堆（PDF p48/p23）：三层收顶 + 木桶。 */
function drawCoalHeap(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: Palette,
): void {
  const rows = [
    { w: 24, dx: 0, dy: 8 },
    { w: 18, dx: 3, dy: 4 },
    { w: 12, dx: 6, dy: 1 },
    { w: 6, dx: 9, dy: -1 },
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    g.fillStyle(i < 2 ? c.ink : c.charcoal, 1);
    g.fillRect(x + row.dx, y + row.dy, row.w, 4);
    g.fillStyle(c.deepShade, 0.6);
    g.fillRect(x + row.dx, y + row.dy + 3, row.w, 1);
  }
  g.fillStyle(c.ember, 0.45);
  g.fillRect(x + 2, y + 9, 3, 1);
  g.fillRect(x + 17, y + 6, 2, 1);
  // 木桶
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 26, y + 6, 7, 8);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 27, y + 7, 5, 6);
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 26, y + 8, 7, 1);
  g.fillRect(x + 26, y + 12, 7, 1);
}
