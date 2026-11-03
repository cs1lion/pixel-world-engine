/** 设定集里的静态像素构件。坐标来自网格，碰撞与潮水仍由世界层决定。
 *
 * 分层是这一层的契约，不是随手调的数值：
 * - 轨道/铺装 depth 1：铺在地上，潮水（depth 3）要能盖住它；退潮只让水退开，不删轨道。
 * - 桥 depth 4：桥面在水面之上，人走桥上。
 * - 灯池/灯光 depth 700：在地面之上、建筑与人物之下——光是地面上的亮，不遮挡人。
 * - 建筑构件 depth 1400：叠浪楼的红栏要压在街面人流之前。
 * - 蒸汽 depth 8010：飘在屋顶上方的空气，必须在最前。
 *
 * 一个 Graphics 只有一个 depth，所以不同层的构件不能用同一个对象：
 * 早先共享一张 `statics` 时，最后设置的 depth 会把轨道一起抬到人物前面。
 *
 * 灯态不在这里判断「几点该亮」：`world/lamp-street.ts` 是那条纯函数，
 * 本层只拿它的结果画亮或暗。这样 18:00 的判据能在 node 下被单测钉住，
 * 而不是靠截图猜。
 */
import Phaser from 'phaser';
import type { SettingPack } from '../settings/types.ts';
import { TILE_PX } from '../world/setup.ts';
import { lampStreetLitAt, type LampPhase } from '../world/lamp-street.ts';
import { createSceneArtbook, type ArtbookPoint } from './scene-artbook.ts';

export interface SettingSceneryView {
  update(level: number, now: number, clock: SettingSceneryClock): void;
  destroy(): void;
}

/** 灯态时钟：相位与「是不是自动推进」。强制相位（`?time=`）下两者都要用上。 */
export interface SettingSceneryClock {
  readonly phase: LampPhase;
  readonly autoAdvancing: boolean;
}

interface LightPoint {
  readonly x: number;
  readonly y: number;
}

/** 灯串每 2 格挂一盏；与 `settings/dengchao/lamp-street.ts` 的计数同一口径。 */
const LANTERNS_PER_STRING = 6;

export function createSettingScenery(scene: Phaser.Scene, pack: SettingPack): SettingSceneryView {
  const track = scene.add.graphics().setDepth(1);
  const street = scene.add.graphics().setDepth(1);
  const bridge = scene.add.graphics().setDepth(4);
  const lampLight = scene.add.graphics().setDepth(700);
  const props = scene.add.graphics().setDepth(1050);
  const architecture = scene.add.graphics().setDepth(1400);
  const steam = scene.add.graphics().setDepth(8010);
  const c = pack.palette;
  const lights: LightPoint[] = [];
  const windows: LightPoint[] = [];
  // 水面倒影锚点：只在对岸窗火处追加，补绘层在 `scene-artbook.ts` 里画。
  const reflectors: ArtbookPoint[] = [];

  for (const item of pack.scenery) {
    if (item.kind === 'steam') continue;
    const x = item.at.x * TILE_PX;
    const y = item.at.y * TILE_PX;
    if (item.kind === 'track') {
      // 铁轨画在地面上，潮水盖在其上；退潮不会重铺或删除它。
      for (const dx of [4, 11]) {
        track.fillStyle(c.charcoal, 1);
        track.fillRect(x, y + dx, item.length! * TILE_PX, 2);
      }
      for (let i = 0; i < item.length!; i += 1) {
        track.fillStyle(c.timberDark, 1);
        track.fillRect(x + i * TILE_PX + 2, y + 2, 3, 13);
        if (i % 5 === 0) {
          track.fillStyle(c.grassLit, 0.7);
          track.fillRect(x + i * TILE_PX, y + 12, 6, 3);
        }
      }
    } else if (item.kind === 'paving') {
      drawPaving(street, x, y, item.length ?? 0, c);
    } else if (item.kind === 'lantern') {
      drawLantern(props, x, y, c);
      lights.push({ x: x + 8, y: y - 14 });
    } else if (item.kind === 'lamp_string') {
      const length = item.length ?? 0;
      const span = length * TILE_PX;
      // 灯绳：一根带高光的横线 + 两端短桩，挂在街面上方。
      props.fillStyle(c.trim, 0.55);
      props.fillRect(x, y - 23, span, 1);
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x, y - 22, span, 1);
      props.fillRect(x, y - 22, 1, 22);
      props.fillRect(x + span - 1, y - 22, 1, 22);
      for (let i = 0; i < LANTERNS_PER_STRING; i += 1) {
        const lx = x + TILE_PX / 2 + i * (span / LANTERNS_PER_STRING);
        drawHangingLantern(props, lx, y, c, i);
        lights.push({ x: lx + 4, y: y - 12 });
      }
    } else if (item.kind === 'shopfront') {
      const width = (item.length ?? 5) * TILE_PX;
      const lanterns = drawShopfront(props, x, y, width, c);
      // 店面那扇格窗也吃灯态：白天是暗琥珀，点灯后透出暖光。
      windows.push({ x: x + (width >= 64 ? width / 4 : 18), y: y + 19 });
      // 檐下红灯比街灯小一档，用 `windows` 的 14x10 光芯就够，不再开大灯池。
      for (const lx of lanterns) windows.push({ x: lx + 2, y: y - 1 });
    } else if (item.kind === 'signpost') {
      drawSignpost(props, x, y, c);
    } else if (item.kind === 'bridge') {
      for (const lx of drawBridge(bridge, x, y, item.length ?? 0, c)) {
        lights.push({ x: lx, y: y - 16 });
      }
    } else if (item.kind === 'sign') {
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 3, y - 15, 3, 31);
      props.fillStyle(c.copper, 1);
      props.fillRect(x - 8, y - 17, 25, 13);
      props.fillStyle(c.trim, 1);
      props.fillRect(x - 3, y - 12, 13, 2);
      props.fillRect(x + 7, y - 14, 2, 6);
    } else if (item.kind === 'debris') {
      props.fillStyle(c.ink, 1);
      props.fillRect(x + 2, y + 5, 13, 7);
      props.fillStyle(c.charcoal, 1);
      props.fillRect(x + 4, y + 3, 8, 7);
      props.fillStyle(c.copper, 0.8);
      props.fillRect(x + 6, y + 4, 2, 5);
    } else if (item.kind === 'stall') {
      // 摊位：矮柜台 + 布棚。柜台压在人腰以下，棚顶高过人头，街面才有前后层次。
      props.fillStyle(c.ink, 1);
      props.fillRect(x - 1, y + 5, 26, 11);
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x, y + 6, 24, 8);
      props.fillStyle(c.terracotta, 1);
      props.fillRect(x + 1, y + 6, 22, 3);
      props.fillStyle(c.trim, 1);
      props.fillRect(x + 2, y + 7, 20, 1);
      // 棚：两根细杆撑起一条布，布边留 1px 缺口，读成被风掀着。
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 2, y - 12, 1, 19);
      props.fillRect(x + 21, y - 12, 1, 19);
      props.fillStyle(c.copper, 1);
      props.fillRect(x - 2, y - 14, 29, 4);
      props.fillStyle(c.pale, 0.85);
      props.fillRect(x - 1, y - 13, 27, 1);
      props.fillStyle(c.ember, 1);
      props.fillRect(x - 2, y - 11, 29, 1);
      // 夜市摊上的小货堆：三个色块，读成「有东西在卖」。
      props.fillStyle(c.plaster, 1);
      props.fillRect(x + 3, y + 3, 5, 3);
      props.fillStyle(c.amber, 1);
      props.fillRect(x + 10, y + 2, 4, 4);
      props.fillStyle(c.moss, 1);
      props.fillRect(x + 17, y + 3, 5, 3);
    } else if (item.kind === 'banner') {
      // 幌布：斜挑一根杆，两幅布长短不一，避免整条街变成同一种竖线。
      props.fillStyle(c.timberDark, 1);
      props.fillRect(x + 6, y - 26, 1, 28);
      props.fillRect(x + 6, y - 26, 9, 1);
      props.fillStyle(c.ember, 1);
      props.fillRect(x + 8, y - 25, 6, 11);
      props.fillStyle(c.trim, 1);
      props.fillRect(x + 8, y - 25, 6, 1);
      props.fillStyle(c.pale, 1);
      props.fillRect(x + 9, y - 21, 3, 1);
      props.fillStyle(c.terracotta, 1);
      props.fillRect(x + 15, y - 25, 4, 8);
    } else if (item.kind === 'stele') {
      // 碑压在 props 层（1050），与 statue 同层：它是一块立在广场上的石头，
      // 不该像楼那样压在人身上。碑面刻痕是三条横线——**不是字**：中文不进
      // canvas（D5-A），碑文由确认面板渲染，这里只画"这块石头上有东西"。
      props.fillStyle(c.ink, 1);
      props.fillRect(x - 1, y + 12, 18, 4);
      props.fillStyle(c.stone, 1);
      props.fillRect(x + 1, y, 14, 13);
      props.fillStyle(c.plaza, 1);
      props.fillRect(x + 2, y + 1, 12, 3);
      props.fillStyle(c.copper, 1);
      props.fillRect(x + 3, y + 6, 10, 1);
      props.fillRect(x + 3, y + 9, 10, 1);
      props.fillStyle(c.trim, 0.8);
      props.fillRect(x + 6, y + 1, 1, 3);
    } else if (item.kind === 'statue') {
      props.fillStyle(c.stone, 1);
      props.fillRect(x, y + 8, 16, 8);
      props.fillRect(x + 4, y - 3, 8, 12);
      props.fillStyle(c.plaza, 1);
      props.fillRect(x + 5, y - 2, 3, 8);
      props.fillStyle(c.water, 1);
      props.fillRect(x + 2, y + 4, 12, 2);
    }
  }

  // 主楼的红栏与逐层窗火独立于通用建筑轮廓，避免它被当成另一栋普通小屋。
  const hall = pack.placements.find((p) => p.prefabId === 'wave_house');
  if (hall !== undefined) {
    const x = hall.at.x * TILE_PX;
    const y = hall.at.y * TILE_PX;
    architecture.fillStyle(c.terracotta, 1);
    for (const dy of [23, 44, 65]) {
      architecture.fillRect(x - 3, y + dy, 118, 3);
      for (let i = 0; i < 8; i += 1) architecture.fillRect(x + i * 15, y + dy, 2, 10);
    }
  }

  // 设定集补绘：主楼正立面、炉底、渡口、街面分段、对岸屋脊。
  // 锚点从这里传进去，场景补绘文件里不再写一份主楼坐标。
  const artbook = createSceneArtbook(
    scene,
    pack,
    windows,
    reflectors,
    hall === undefined ? undefined : { x: hall.at.x * TILE_PX, y: hall.at.y * TILE_PX },
  );

  return {
    update(level, now, clock) {
      lampLight.clear();
      steam.clear();
      const lit = lampStreetLitAt(now, clock.phase, clock.autoAdvancing);
      for (const point of lights) {
        if (lit) {
          // 亮：三层离散光池 + 灯芯。灯芯最亮的一档在灯体中心。
          lampLight.fillStyle(c.amber, 0.08 + level * 0.02);
          lampLight.fillRect(point.x - 15, point.y - 6, 30, 13);
          lampLight.fillStyle(c.amber, 0.13 + level * 0.02);
          lampLight.fillRect(point.x - 7, point.y - 4, 14, 9);
          lampLight.fillStyle(c.warmLight, 0.95);
          lampLight.fillRect(point.x - 2, point.y - 3, 4, 6);
        } else {
          // 暗：只把纸灯压一档，不做整屏压暗——白天街灯仍然有形。
          lampLight.fillStyle(c.ink, 0.28);
          lampLight.fillRect(point.x - 3, point.y - 5, 6, 8);
        }
      }
      // 店面窗：点灯后透一点暖光，与街灯同一拍亮/灭。
      for (const point of windows) {
        if (!lit) continue;
        lampLight.fillStyle(c.warmLight, 0.20);
        lampLight.fillRect(point.x - 7, point.y - 5, 14, 10);
        lampLight.fillStyle(c.amber, 0.10);
        lampLight.fillRect(point.x - 11, point.y - 8, 22, 16);
      }
      for (const item of pack.scenery) {
        if (item.kind !== 'steam') continue;
        const x = item.at.x * TILE_PX;
        const y = item.at.y * TILE_PX;
        const drift = Math.floor(now / 300 + item.at.x) % 9;
        steam.fillStyle(c.pale, 0.14);
        steam.fillRect(x + drift, y - 24, 7, 9);
        steam.fillRect(x + 6 + drift, y - 36, 10, 8);
        steam.fillStyle(c.deepShade, 0.15);
        steam.fillRect(x + 1 + drift, y - 15, 10, 6);
      }
      // 设定集补绘的动态层：水面灯影、对岸窗火、湾面低雾。
      artbook.update(level, now, clock);
    },
    destroy() {
      artbook.destroy();
      for (const layer of [track, street, bridge, lampLight, props, architecture, steam]) layer.destroy();
    },
  };
}

/**
 * 叠浪楼门桥（PDF p16/p39/p46）：朱红桥面、方眼格子栏板、两端方灯。
 *
 * 桥同占水口（x28..37,y27），桥面把水面整段盖住，所以桥下不画倒影；
 * 这里的灯只进 `lights`，不往 `reflectors` 里塞。
 */
function drawBridge(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: SettingPack['palette'],
): number[] {
  const span = length * TILE_PX;
  // 桥台：浅色条石，比桥面宽一档（p16 的入口石阶）。
  g.fillStyle(c.ink, 0.35);
  g.fillRect(x - 8, y + 18, span + 16, 4);
  g.fillStyle(c.plaza, 1);
  g.fillRect(x - 8, y + 2, 10, 18);
  g.fillRect(x + span - 2, y + 2, 10, 18);
  g.fillStyle(c.stone, 1);
  g.fillRect(x - 8, y + 18, 10, 2);
  g.fillRect(x + span - 2, y + 18, 10, 2);
  // 桥面：朱红横板，板缝每 8px。
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x, y + 2, span, 16);
  g.fillStyle(c.timberDark, 1);
  for (let i = 0; i < span; i += 8) g.fillRect(x + i, y + 2, 1, 16);
  g.fillStyle(c.trim, 0.55);
  g.fillRect(x, y + 2, span, 1);
  // 上下两道横枋
  g.fillStyle(c.ember, 1);
  g.fillRect(x, y - 6, span, 3);
  g.fillRect(x, y + 16, span, 3);
  // 立柱：每 8px 一根，柱头压金。
  for (let i = 0; i <= span; i += 8) {
    g.fillStyle(c.ember, 1);
    g.fillRect(x + i, y - 8, 2, 26);
    g.fillStyle(c.trim, 1);
    g.fillRect(x + i - 1, y - 9, 4, 2);
  }
  // 方眼格：两道斜线，每格 8px。
  for (let i = 0; i <= span; i += 8) {
    for (let k = 0; k < 12; k += 4) {
      g.fillStyle(c.terracotta, 0.9);
      g.fillRect(x + i + k, y - 3 + k, 2, 1);
      g.fillRect(x + i + k, y + 15 - k, 2, 1);
    }
  }
  // 两端望柱 + 方形纸灯。
  const lanterns: number[] = [];
  for (const px of [x - 6, x + span - 2]) {
    g.fillStyle(c.timberDark, 1);
    g.fillRect(px, y - 20, 4, 40);
    g.fillStyle(c.trim, 1);
    g.fillRect(px - 1, y - 22, 6, 2);
    g.fillStyle(c.ember, 1);
    g.fillRect(px - 3, y - 32, 10, 12);
    g.fillStyle(c.trim, 1);
    g.fillRect(px - 3, y - 32, 10, 1);
    g.fillStyle(c.warmLight, 1);
    g.fillRect(px, y - 26, 4, 4);
    g.fillStyle(c.ink, 1);
    g.fillRect(px - 3, y + 2, 10, 1);
    lanterns.push(px + 2);
  }
  return lanterns;
}

/** 街面铺装：石板缝 + 少量苔，不整块盖掉地形。 */
function drawPaving(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: SettingPack['palette'],
): void {
  for (let i = 0; i < length; i += 1) {
    const px = x + i * TILE_PX;
    g.fillStyle(c.ink, 0.18);
    g.fillRect(px, y, TILE_PX, 1);
    g.fillRect(px, y, 1, TILE_PX);
    g.fillStyle(c.stone, 0.55);
    g.fillRect(px + 1, y + 5, TILE_PX - 1, 1);
    g.fillRect(px + 1, y + 11, TILE_PX - 1, 1);
    g.fillRect(px + 7, y + 1, 1, TILE_PX - 1);
    if (i % 6 === 0) {
      g.fillStyle(c.moss, 0.35);
      g.fillRect(px + 3, y + 2, 2, 1);
      g.fillRect(px + 12, y + 13, 1, 2);
    }
  }
}

/** 街灯柱：杆 + 横臂 + 纸灯体。亮芯由动态层加，不在静态层画。 */
function drawLantern(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
): void {
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 7, y - 21, 2, 37);
  g.fillRect(x + 4, y - 22, 10, 2);
  g.fillStyle(c.ember, 1);
  g.fillRect(x + 5, y - 19, 7, 10);
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 5, y - 19, 7, 1);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 5, y - 9, 7, 1);
}

/** 灯串上的一盏：更小，挂在绳下。 */
function drawHangingLantern(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  index: number,
): void {
  const paper = index % 2 === 0 ? c.ember : c.terracotta;
  g.fillStyle(c.pale, 0.5);
  g.fillRect(x + 3, y - 22, 1, 4);
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 1, y - 18, 7, 1);
  g.fillStyle(paper, 1);
  g.fillRect(x + 1, y - 17, 7, 9);
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 1, y - 17, 7, 1);
  g.fillStyle(c.pale, 0.75);
  g.fillRect(x + 2, y - 9, 5, 1);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 1, y - 8, 7, 1);
}

/** 店铺立面：灰泥墙 + 木框 + 两扇格窗 + 暖帘 + 竖招牌。 */
function drawShopfront(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  c: SettingPack['palette'],
): number[] {
  // 檐
  g.fillStyle(c.ink, 0.22);
  g.fillRect(x - 3, y - 2, width + 6, 3);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x - 4, y - 8, width + 8, 7);
  g.fillStyle(c.trim, 0.8);
  g.fillRect(x - 4, y - 8, width + 8, 1);
  // 檐下布幔：橙红分条，幔脚压一道深线（p37/p40 的店檐）。每 6px 一条，
  // 48px 窄立面也不挤成一条实线，同时把三面店面的指令数压下来。
  for (let i = 0; i < width + 8; i += 6) {
    g.fillStyle(i % 8 === 0 ? c.warmLight : c.terracotta, 0.9);
    g.fillRect(x - 4 + i, y - 4, 3, 3);
  }
  g.fillStyle(c.ink, 0.5);
  g.fillRect(x - 4, y - 1, width + 8, 1);
  // 墙
  g.fillStyle(c.plaster, 1);
  g.fillRect(x, y, width, 28);
  // 斑驳：雨痕从檐口垂到窗上沿，露石与补板压在旧缝上（p40）。
  g.fillStyle(c.deepShade, 0.20);
  g.fillRect(x + 9, y + 2, 1, 10);
  g.fillRect(x + width - 19, y + 3, 1, 8);
  g.fillStyle(c.stone, 0.55);
  g.fillRect(x + 16, y + 4, 6, 4);
  g.fillStyle(c.timberDark, 0.55);
  g.fillRect(x + 3, y + 20, 8, 1);
  g.fillStyle(c.stone, 1);
  g.fillRect(x, y + 28, width, 4);
  // 贴地影：窄立面也要有落地的接触面，否则像一块浮着的板
  g.fillStyle(c.ink, 0.28);
  g.fillRect(x + 2, y + 32, width - 4, 2);
  // 木框：外框 + 内柱，让灰泥墙读成「木骨灰泥」而不是一块白板
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x, y, 2, 32);
  g.fillRect(x + width - 2, y, 2, 32);
  g.fillRect(x, y + 9, width, 1);
  g.fillRect(x, y + 24, width, 1);
  g.fillStyle(c.timberDark, 0.55);
  for (let i = 12; i < width - 2; i += 12) g.fillRect(x + i, y, 1, 24);
  if (width >= 64) {
    // 宽立面：两扇格窗
    const pane = Math.max(10, Math.floor((width - 18) / 2));
    drawLattice(g, x + 5, y + 13, pane, 12, c);
    drawLattice(g, x + width - pane - 5, y + 13, pane, 12, c);
  } else {
    // 窄立面：一扇窗 + 门，别把 48px 塞成四格
    drawLattice(g, x + 5, y + 13, width - 22, 12, c);
  }
  // 暖帘与门
  const doorX = width >= 64 ? x + Math.floor(width / 2) - 7 : x + width - 18;
  g.fillStyle(c.timberDark, 1);
  g.fillRect(doorX, y + 18, 14, 14);
  g.fillStyle(c.pale, 1);
  g.fillRect(doorX, y + 18, 14, 4);
  g.fillStyle(c.ember, 1);
  for (let i = 0; i < 3; i += 1) g.fillRect(doorX + 2 + i * 4, y + 22, 1, 9);
  // 竖招牌
  g.fillStyle(c.trim, 1);
  g.fillRect(x + width - 7, y + 12, 5, 16);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + width - 5, y + 14, 2, 2);
  g.fillRect(x + width - 5, y + 18, 2, 2);
  g.fillRect(x + width - 5, y + 22, 2, 1);
  // 檐下红灯：一排挂在檐口下面，是 p37/p40 店街最显眼的一层。
  const lanterns: number[] = [];
  const count = width >= 64 ? 4 : 2;
  for (let i = 0; i < count; i += 1) {
    const lx = x + 7 + i * (width - 18) / (count - 1);
    g.fillStyle(c.timberDark, 1);
    g.fillRect(lx + 2, y - 1, 1, 3);
    g.fillStyle(c.ember, 1);
    g.fillRect(lx, y + 2, 5, 7);
    g.fillStyle(c.trim, 1);
    g.fillRect(lx, y + 2, 5, 1);
    g.fillStyle(c.amber, 0.7);
    g.fillRect(lx + 2, y + 4, 1, 3);
    g.fillStyle(c.ink, 1);
    g.fillRect(lx, y + 8, 5, 1);
    lanterns.push(lx + 2);
  }
  return lanterns;
}

function drawLattice(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  c: SettingPack['palette'],
): void {
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(c.amber, 0.55);
  g.fillRect(x, y, w, h);
  for (let i = 3; i < w; i += 4) {
    g.fillStyle(c.timberDark, 1);
    g.fillRect(x + i, y, 1, h);
  }
  for (let j = 3; j < h; j += 4) {
    g.fillStyle(c.timberDark, 1);
    g.fillRect(x, y + j, w, 1);
  }
}

/** 竖招牌：木柱 + 竖板 + 三个自造字块（不是中文）。 */
function drawSignpost(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
): void {
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 7, y - 18, 2, 18);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + 3, y - 34, 12, 24);
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 4, y - 33, 10, 22);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 6, y - 30, 3, 3);
  g.fillRect(x + 10, y - 30, 2, 3);
  g.fillRect(x + 6, y - 25, 3, 1);
  g.fillRect(x + 10, y - 25, 2, 1);
  g.fillRect(x + 6, y - 21, 6, 1);
}
