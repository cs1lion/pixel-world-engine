/** 设定集里的静态像素构件。坐标来自网格，碰撞与潮水仍由世界层决定。
 *
 * 分层是这一层的契约，不是随手调的数值：
 * - 轨道/铺装 depth 1：铺在地上，潮水（depth 3）要能盖住它；退潮只让水退开，不删轨道。
 * - 桥 depth 4：桥面在水面之上，人走桥上。
 * - 街面光池 depth 3.2：落在**地面**上的椭圆暖光，压在铺装（1/1.5）与潮水
 *   （3）之上、桥与构件（4 起）之下——涨潮时灯影落在水面，退潮时落在砖上，
 *   两种情况都读得出来（满潮时若被水盖掉，「潮位越高灯越亮」这条就成了空话）。
 *   半径与强度由 `lamp-pool.ts` 的纯函数按潮位算，见 `lampPoolBands`。
 * - 灯体光芯 depth 700：灯罩周围那一圈亮，在地面之上、建筑与人物之下。
 * - 立着的街面构件（灯柱、灯串、店面、摊位、幌布、竖招牌、碑、像）按**落地行**排：
 *   `sceneryDepth(item.at.y, altitude)`。人物 depth 是 `altitude + (row+1)*16 + 8`，
 *   所以同一行的人在构件前、上一行的人在构件后——「站在摊位前应盖住、站在摊位后
 *   应被挡住」由 `scenery-depth.ts` 的纯函数钉住，不靠截图猜。
 * - 落地碎堆走 depth 1050：它是地上的杂物，不进遮挡排序。
 * - 建筑构件 depth 1400：叠浪楼的红栏要压在街面人流之前。
 * - 蒸汽 depth 1399：**压在建筑层之下**。烟只从烟囱口往上飘，锚点已抬到楼顶之上；
 *   万一与楼体像素重叠，楼体先画、把烟盖住——烟因此不可能盖住楼体轮廓，
 *   也不可能"穿过"一面墙跑到墙前面。原来它在 8010（最前），会糊住楼体轮廓。
 *
 * 一个 Graphics 只有一个 depth，所以不同深度段的构件不能用同一个对象：
 * 早先共享一张 `statics` 时，最后设置的 depth 会把轨道一起抬到人物前面。
 * 现在街面构件**按落地行合并**：同一行的灯柱、摊位、店面共用一张 Graphics——
 * 行内本来就不需要再分先后，行与行之间才需要。
 *
 * 灯态不在这里判断「几点该亮」：`world/lamp-street.ts` 是那条纯函数，
 * 本层只拿它的结果画亮或暗。这样 18:00 的判据能在 node 下被单测钉住，
 * 而不是靠截图猜。
 */
import Phaser from 'phaser';
import type { SettingPack } from '../settings/types.ts';
import { TILE_PX } from '../world/setup.ts';
import { lampStreetLitAt, type LampPhase } from '../world/lamp-street.ts';
import {
  LAMP_MOTION_ON,
  lampBreathAt,
  lampBrightnessAt,
  lampIgnitionProgress,
  lampSwayAt,
  type LampMotion,
} from '../world/lamp-motion.ts';
import {
  STALL_MOTION_ON,
  stallClothSwayAt,
  stallFireAt,
  type StallMotion,
} from '../world/stall-motion.ts';
import {
  BANNER_MOTION_ON,
  bannerShadowAt,
  bannerSwayAt,
  type BannerMotion,
} from '../world/banner-motion.ts';
import {
  SMOKE_MOTION_ON,
  smokePuffsAt,
  smokePuffsStill,
  type SmokeMotion,
} from '../world/smoke-motion.ts';
import { createSceneArtbook, type ArtbookPoint } from './scene-artbook.ts';
import {
  GROUND_SHADOW_DEPTH,
  GROUND_SHADOW_MOTION_ON,
  groundShadowAt,
  shadowSegments,
  type GroundShadowMotion,
} from '../world/ground-shadow.ts';
import { sceneryDepth } from './scenery-depth.ts';
import { LAMP_POOL_DEPTH } from './layer-depth.ts';
import { lampPoolBands, wideLampPoolBands } from './lamp-pool.ts';
import {
  LAMP_BODY_BOTTOM,
  LAMP_BODY_H,
  LAMP_POST_TOP,
  SHOPFRONT_BASE_H,
  SHOPFRONT_STONE_H,
  SHOPFRONT_TOP,
  SHOPFRONT_WALL_H,
  settingSceneryMetrics,
  type SettingSceneryMetrics,
} from './setting-scale.ts';

export interface SettingSceneryView {
  update(level: number, now: number, clock: SettingSceneryClock): void;
  destroy(): void;
  /**
   * 立面与街灯的实际像素尺寸。证据脚本拿它画标尺：尺子读的就是渲染用的
   * 那几个常量，不另抄一份数字。
   */
  readonly metrics: SettingSceneryMetrics;
  /**
   * 这一帧画下的地面光池指令数。光池每帧先 `clear`、只在亮灯分支里重画，
   * 所以灯灭时必须为 0——有残留就说明上一帧的暖斑没被擦掉。
   */
  readonly poolCommands: () => number;
  /** 街灯总盏数（灯柱 10 + 灯串 3×6）。证据脚本报「第几盏」时不用另数一遍。 */
  readonly lampCount: () => number;
  /** 全街 28 盏的渐次顺序与坐标：证据脚本据此报「第几盏、在哪个世界位置」。 */
  readonly lampUnits: () => readonly { order: number; x: number; y: number; hanging: boolean }[];
  /**
   * 摊位的动态读数（本帧）：棚布摆了几像素、火盆亮到几成、焰有多高。
   * 雨天 `awningSway` 必须为 0——摆动交给盖布（`weather-stalls`），
   * 两件不能同时摆，否则就是「盖布落下但棚布还在飘」。
   */
  readonly stallUnits: () => readonly {
    order: number;
    x: number;
    y: number;
    awningSway: number;
    fireLevel: number;
    fireHeight: number;
  }[];
  /**
   * 幌布的本帧读数：布身摆了几像素、沿墙投影有多长多浓。
   * 正午短、黄昏长、夜里几乎无——影子长度是相位给的，不是随机数。
   */
  readonly bannerUnits: () => readonly {
    order: number;
    x: number;
    y: number;
    swayDx: number;
    tilt: number;
    shadowDx: number;
    shadowSpan: number;
    shadowAlpha: number;
  }[];
  /**
   * 烟囱的本帧读数：每段烟团的位移与浓度，以及烟从哪个高度起飘。
   * `anchorY` 是**楼顶之上**的起飘高度，烟不会压在楼体轮廓上。
   */
  readonly smokeUnits: () => readonly {
    order: number;
    x: number;
    anchorY: number;
    puffs: readonly { dx: number; dy: number; width: number; height: number; alpha: number }[];
  }[];
  /**
   * 摊位落地投影的本帧读数：影子的横移、长度、浓淡。
   * 长度由相位给：正午短、黄昏长、夜里不做。
   */
  readonly groundShadowUnits: () => readonly {
    order: number;
    x: number;
    y: number;
    dx: number;
    span: number;
    alpha: number;
  }[];
}

/** 灯态时钟：相位与「是不是自动推进」。强制相位（`?time=`）下两者都要用上。 */
export interface SettingSceneryClock {
  readonly phase: LampPhase;
  readonly autoAdvancing: boolean;
  /** 调试灯态：给了就压过时钟判据（`debugForceLamps` 写这个口子）。 */
  readonly litOverride?: boolean;
  /**
   * 局部压低周边的开关（`debugLampLocalShade` 写这个口子）。缺省开；
   * 证据脚本在同一帧上关掉它，量 annulus 掉了多少——这是「真压低」与
   * 「只是全屏 dim」的分界。
   */
  readonly localShade?: boolean;
  /**
   * 三支动态的开关（`debugLampMotion` 写这个口子）。缺省全开——夜街本来就该是活的；
   * 关掉哪一支，那一支就变成常量，证据脚本靠这个取「关掉时帧差为 0」的对照。
   */
  readonly motion?: LampMotion;
  /**
   * 摊位两支动态的开关（`debugStallMotion` 写这个口子）：棚布/盖布摆动、火光跳动。
   * 缺省全开；关掉哪一支，那一支就退化成常量。
   */
  readonly stalls?: StallMotion;
  /**
   * 摊子是否已经盖上（雨 / 暴雨，或记得昨天淋过雨今天提前盖）。
   * 为真时棚布**不摆**，摆的是 `weather-stalls` 那块盖布——两件交替，不同时动。
   */
  readonly packed?: boolean;
  /**
   * 幌布两支动态的开关（`debugBannerMotion` 写这个口子）：布身摆动、沿墙投影。
   * 缺省全开；关掉哪一支，那一支就退化成常量。
   */
  readonly banners?: BannerMotion;
  /**
   * 烟的分段漂移开关（`debugSmokeMotion` 写这个口子）。关掉后烟仍画在原地，
   * 但每一帧都是同一姿态——t 与 t+Ns 的帧差必须是 0。
   */
  readonly smoke?: SmokeMotion;
  /**
   * 藏掉设定集补绘的湾面低雾（`debugHideBayMist` 写这个口子）。
   * 低雾按世界时刻横移，会在「烟关掉」的对照里留下像素差；只为证据隔离，不关时不藏。
   */
  readonly hideBayMist?: boolean;
  /**
   * 摊位落地投影的开关（`debugGroundShadows` 写这个口子）。缺省全开；
   * 关掉后这一层不画任何像素，对照帧差必须为 0。
   */
  readonly groundShadows?: GroundShadowMotion;
}

interface LightPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * 一盏可动的灯：灯柱上一盏，或灯串上挂着的一盏。
 *
 * `order` 是全街 28 盏的**渐次点亮顺序**（按世界 x 从西往东排）；每帧只按
 * 这个序号算亮度与摆幅，不在渲染层存「上一帧亮没亮」。
 */
interface LampUnit {
  /** 灯芯中心（世界像素）：光晕画在这里。 */
  readonly x: number;
  readonly y: number;
  /** 灯体左上角：摆动时整个纸灯平移。 */
  readonly bodyX: number;
  readonly bodyY: number;
  readonly row: number;
  readonly hanging: boolean;
  /** 由落地后按 x 排序写入；0 = 第一盏亮。 */
  order: number;
}

/** 一串灯：六盏共用一个点亮进度（同一串一起亮，不把一串拆成六拍）。 */
interface LampGroup {
  readonly units: LampUnit[];
  /** 长条光池的下标；建池时回填。 */
  pool: number;
}

/** 光池落点：`halfWidth` 为 0 表示点光源，否则是长条光源的半跨度。 */
interface PoolAnchor {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
  /** 点光源只吃自己那一盏的亮度；长条光源吃整组的平均亮度。 */
  readonly unit: LampUnit | null;
  readonly group: LampGroup | null;
}

/** 一个摊位：棚布与火盆都画在按落地行分层的动态层里。 */
interface StallUnit {
  readonly x: number;
  readonly y: number;
  readonly row: number;
  /** 在设定集里的次序（雨天的盖布用同一序号取摆相位）。 */
  readonly order: number;
}

/** 摊位的本帧读数：证据脚本据此报「棚布摆了几像素 / 火盆亮到几成」。 */
interface StallReadout {
  order: number;
  x: number;
  y: number;
  awningSway: number;
  fireLevel: number;
  fireHeight: number;
}

/** 一面幌布：杆子钉在静态层，布身与沿墙投影画在按落地行分层的动态层里。 */
interface BannerUnit {
  readonly x: number;
  readonly y: number;
  readonly row: number;
  readonly order: number;
}

interface BannerReadout {
  order: number;
  x: number;
  y: number;
  swayDx: number;
  tilt: number;
  shadowDx: number;
  shadowSpan: number;
  shadowAlpha: number;
}

/**
 * 一柱烟：`anchorY` 是**起飘高度**。
 *
 * 烟囱口可能落在楼体占地之内（炉底那根砖烟囱就是），直接按 `at` 画会糊在墙面上。
 * 建场景时把起飘高度抬到所在楼的楼顶之上（见 `smokeAnchorY`），烟就只画在屋顶以上。
 */
interface SmokeUnit {
  readonly x: number;
  readonly anchorY: number;
  readonly order: number;
}

interface SmokeReadout {
  order: number;
  x: number;
  anchorY: number;
  puffs: readonly { dx: number; dy: number; width: number; height: number; alpha: number }[];
}

/** 光池椭圆的平滑档位：16px 瓦片下 12 段已够圆，多一段都是白烧的指令。 */
const POOL_SMOOTHNESS = 12;

/** 灯串每 2 格挂一盏；与 `settings/dengchao/lamp-street.ts` 的计数同一口径。 */
const LANTERNS_PER_STRING = 6;

/**
 * 灯周围「压低周边」的档位（世界 px）：`[inner, outer)` 的方框，alpha 由内到外递减。
 *
 * - 内端 5：避开 8×8 的 patch（±4）与 4×6 的灯芯（竖向 ±3），压暗不许把发光块本身算进去；
 * - 外端 17：盖住 KB 的 32×32 annulus（±16），再往外就不属于「周边」了；
 * - 三档而不是一档：单档方框会读成一个硬边黑框，分三档才像一圈渐隐的暗部。
 *
 * alpha 0.20/0.13/0.08 是在 1× 下「看得出来、但不抢灯芯」的上限（见证据脚本的通道检查：
 * 压暗只会降通道，不会产生 255 裁剪）。
 */
const LAMP_SHADE_RINGS = [
  { inner: 5, outer: 9, alpha: 0.20 },
  { inner: 9, outer: 13, alpha: 0.13 },
  { inner: 13, outer: 17, alpha: 0.08 },
] as const;

/** 画一圈方框（中心挖空到 `inner`）：四边各一条。像素风里方框比圆环更稳、更省指令。 */
function fillSquareRing(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  inner: number,
  outer: number,
): void {
  const side = outer - inner;
  g.fillRect(cx - outer, cy - outer, outer * 2, side);
  g.fillRect(cx - outer, cy + inner, outer * 2, side);
  g.fillRect(cx - outer, cy - inner, side, inner * 2);
  g.fillRect(cx + inner, cy - inner, side, inner * 2);
}

export function createSettingScenery(
  scene: Phaser.Scene,
  pack: SettingPack,
  altitude: number,
): SettingSceneryView {
  const track = scene.add.graphics().setDepth(1);
  const street = scene.add.graphics().setDepth(1);
  const bridge = scene.add.graphics().setDepth(4);
  // 街面光池：压在铺装与潮水之上、桥与构件之下，见头部那条分层契约。
  const lampPool = scene.add.graphics().setDepth(LAMP_POOL_DEPTH);
  // 人物与摊位的落地投影：比潮水高、比光池低（暖光仍压在影子上），见 `ground-shadow.ts`。
  const groundShadow = scene.add.graphics().setDepth(GROUND_SHADOW_DEPTH);
  const lampLight = scene.add.graphics().setDepth(700);
  // 地上的杂物：不进遮挡排序，始终压在人物与立着的东西下面。
  const flat = scene.add.graphics().setDepth(1050);
  // 立着的构件按落地行分对象：同一行共用一张，行与行之间才需要 depth 差。
  const propRows = new Map<number, Phaser.GameObjects.Graphics>();
  const propLayer = (row: number): Phaser.GameObjects.Graphics => {
    let g = propRows.get(row);
    if (g === undefined) {
      g = scene.add.graphics().setDepth(sceneryDepth(row, altitude));
      propRows.set(row, g);
    }
    return g;
  };
  const architecture = scene.add.graphics().setDepth(1400);
  // 烟压在建筑层之下：楼体不透明的像素会把烟盖住，烟因此盖不到楼体轮廓，
  // 也不会"穿过"墙面跑到墙前。原来在 8010（最前）会糊住楼体。
  const steam = scene.add.graphics().setDepth(1399);
  const c = pack.palette;
  const lights: LightPoint[] = [];
  const windows: LightPoint[] = [];
  const pools: PoolAnchor[] = [];
  const lampUnits: LampUnit[] = [];
  const lampGroups: LampGroup[] = [];
  const stallUnits: StallUnit[] = [];
  const stallReadout: StallReadout[] = [];
  const groundShadowReadout: { order: number; x: number; y: number; dx: number; span: number; alpha: number }[] = [];
  const bannerUnits: BannerUnit[] = [];
  const bannerReadout: BannerReadout[] = [];
  const smokeUnits: SmokeUnit[] = [];
  const smokeReadout: SmokeReadout[] = [];
  /** 灯绳跨度：一串一条，摆动时按组里中间那盏的相位走。 */
  const stringSpans: { x: number; y: number; row: number; span: number; group: LampGroup }[] = [];
  // 水面倒影锚点：只在对岸窗火处追加，补绘层在 `scene-artbook.ts` 里画。
  const reflectors: ArtbookPoint[] = [];

  // 烟囱口 → 起飘高度。烟囱口落在楼体占地之内时（炉底那根砖烟囱就在墙里），
  // 直接按 `at` 画会糊在墙面上；抬到那栋楼的楼顶之上（楼顶 = 原点 y，烟囱高出屋顶 10px）。
  const smokeAnchorY = (atX: number, atY: number): number => {
    let top = atY * TILE_PX - 12;
    for (const placement of pack.placements) {
      const blueprint = pack.blueprints.get(placement.prefabId);
      if (blueprint === undefined) continue;
      const insideX = atX >= placement.at.x && atX < placement.at.x + blueprint.footprint.w;
      const insideY = atY >= placement.at.y && atY < placement.at.y + blueprint.footprint.h;
      if (!insideX || !insideY) continue;
      top = Math.min(top, placement.at.y * TILE_PX - 12);
    }
    return top;
  };

  for (const item of pack.scenery) {
    if (item.kind === 'steam') {
      smokeUnits.push({
        x: item.at.x * TILE_PX,
        anchorY: smokeAnchorY(item.at.x, item.at.y),
        order: smokeUnits.length,
      });
      continue;
    }
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
      // 柱与横臂是死的（钉在地上）；灯体交给动态层，风摆时整只纸灯平移 1px。
      drawLanternPole(propLayer(item.at.y), x, y, c);
      const unit: LampUnit = {
        x: x + 8,
        y: y - LAMP_BODY_BOTTOM - LAMP_BODY_H / 2,
        bodyX: x + 4,
        bodyY: y - LAMP_BODY_BOTTOM - LAMP_BODY_H,
        row: item.at.y,
        hanging: false,
        order: 0,
      };
      lampUnits.push(unit);
      // 池心在灯柱脚下的地面（本格中心偏下 2px），不是灯体高度。
      pools.push({ x: x + 8, y: y + 10, halfWidth: 0, unit, group: null });
    } else if (item.kind === 'lamp_string') {
      // 两端短桩是死的；灯绳与六盏纸灯都进动态层，跟着风一起摆。
      const g = propLayer(item.at.y);
      const length = item.length ?? 0;
      const span = length * TILE_PX;
      g.fillStyle(c.timberDark, 1);
      g.fillRect(x, y - 22, 1, 22);
      g.fillRect(x + span - 1, y - 22, 1, 22);
      const group: LampGroup = { units: [], pool: -1 };
      for (let i = 0; i < LANTERNS_PER_STRING; i += 1) {
        const lx = x + TILE_PX / 2 + i * (span / LANTERNS_PER_STRING);
        const unit: LampUnit = {
          x: lx + 4,
          y: y - 12,
          bodyX: lx + 1,
          bodyY: y - 17,
          row: item.at.y,
          hanging: true,
          order: 0,
        };
        lampUnits.push(unit);
        group.units.push(unit);
      }
      // 一串只落一片长光带：六盏灯各画一圈会把同一条街叠成六层，
      // 亮度没多出来，指令却翻六倍。
      group.pool = pools.length;
      pools.push({ x: x + span / 2, y: y + 10, halfWidth: span / 2, unit: null, group });
      lampGroups.push(group);
      stringSpans.push({ x, y, row: item.at.y, span, group });
    } else if (item.kind === 'shopfront') {
      const width = (item.length ?? 5) * TILE_PX;
      const lanterns = drawShopfront(propLayer(item.at.y), x, y, width, c);
      // 店面那扇格窗也吃灯态：白天是暗琥珀，点灯后透出暖光。
      windows.push({ x: x + (width >= 64 ? width / 4 : 18), y: y - SHOPFRONT_TOP + 12 });
      // 檐下红灯比街灯小一档，用 `windows` 的 14x10 光芯就够，不再开大灯池。
      for (const lx of lanterns) windows.push({ x: lx + 2, y: y - SHOPFRONT_TOP + 5 });
      // 檐下那一排灯只落一片贴墙的池子：池心在墙脚外沿（石脚底边再下 8px）。
      // 店面的池子不跟街灯渐次：它属于立面，立面没有「逐盏点着」这回事。
      pools.push({
        x: x + width / 2,
        y: y + SHOPFRONT_BASE_H + 8,
        halfWidth: width / 2,
        unit: null,
        group: null,
      });
    } else if (item.kind === 'signpost') {
      drawSignpost(propLayer(item.at.y), x, y, c);
    } else if (item.kind === 'bridge') {
      for (const lx of drawBridge(bridge, x, y, item.length ?? 0, c)) {
        lights.push({ x: lx, y: y - 16 });
      }
    } else if (item.kind === 'sign') {
      const g = propLayer(item.at.y);
      g.fillStyle(c.timberDark, 1);
      g.fillRect(x + 3, y - 15, 3, 31);
      g.fillStyle(c.copper, 1);
      g.fillRect(x - 8, y - 17, 25, 13);
      g.fillStyle(c.trim, 1);
      g.fillRect(x - 3, y - 12, 13, 2);
      g.fillRect(x + 7, y - 14, 2, 6);
    } else if (item.kind === 'debris') {
      flat.fillStyle(c.ink, 1);
      flat.fillRect(x + 2, y + 5, 13, 7);
      flat.fillStyle(c.charcoal, 1);
      flat.fillRect(x + 4, y + 3, 8, 7);
      flat.fillStyle(c.copper, 0.8);
      flat.fillRect(x + 6, y + 4, 2, 5);
    } else if (item.kind === 'stall') {
      // 摊位：矮柜台 + 布棚。柜台压在人腰以下，棚顶高过人头，街面才有前后层次。
      const g = propLayer(item.at.y);
      g.fillStyle(c.ink, 1);
      g.fillRect(x - 1, y + 5, 26, 11);
      g.fillStyle(c.timberDark, 1);
      g.fillRect(x, y + 6, 24, 8);
      g.fillStyle(c.terracotta, 1);
      g.fillRect(x + 1, y + 6, 22, 3);
      g.fillStyle(c.trim, 1);
      g.fillRect(x + 2, y + 7, 20, 1);
      // 棚：两根细杆撑起一条布。布在动态层里画（风摆时整条平移 1px），
      // 这里只留杆子；雨天棚布不摆，改由盖布接管（见 `weather-stalls.ts`）。
      g.fillStyle(c.timberDark, 1);
      g.fillRect(x + 2, y - 12, 1, 19);
      g.fillRect(x + 21, y - 12, 1, 19);
      // 火盆：摆在柜台面上（不落地）。火盆的墨块落在柜台影里，
      // 不给地面添新的暗像素——夜街光带的逐列读数才不会被这只盆改写。
      g.fillStyle(c.ink, 1);
      g.fillRect(x + 18, y + 13, 7, 3);
      g.fillStyle(c.trim, 1);
      g.fillRect(x + 18, y + 13, 7, 1);
      g.fillStyle(c.copper, 0.7);
      g.fillRect(x + 20, y + 12, 3, 1);
      // 夜市摊上的小货堆：三个色块，读成「有东西在卖」。
      g.fillStyle(c.plaster, 1);
      g.fillRect(x + 3, y + 3, 5, 3);
      g.fillStyle(c.amber, 1);
      g.fillRect(x + 10, y + 2, 4, 4);
      g.fillStyle(c.moss, 1);
      g.fillRect(x + 17, y + 3, 5, 3);
      stallUnits.push({ x, y, row: item.at.y, order: stallUnits.length });
    } else if (item.kind === 'banner') {
      // 幌布：斜挑一根杆，两幅布长短不一，避免整条街变成同一种竖线。
      // 杆子钉死在静态层；布身与沿墙投影画在动态层（`bannerRows`），跟着世界时刻摆。
      const g = propLayer(item.at.y);
      g.fillStyle(c.timberDark, 1);
      g.fillRect(x + 6, y - 26, 1, 28);
      g.fillRect(x + 6, y - 26, 9, 1);
      bannerUnits.push({ x, y, row: item.at.y, order: bannerUnits.length });
    } else if (item.kind === 'stele') {
      // 碑按落地行排（与 statue 同规矩）：它是一块立在广场上的石头，
      // 站在它后面的人该被它挡住。碑面刻痕是三条横线——**不是字**：中文不进
      // canvas（D5-A），碑文由确认面板渲染，这里只画"这块石头上有东西"。
      const g = propLayer(item.at.y);
      g.fillStyle(c.ink, 1);
      g.fillRect(x - 1, y + 12, 18, 4);
      g.fillStyle(c.stone, 1);
      g.fillRect(x + 1, y, 14, 13);
      g.fillStyle(c.plaza, 1);
      g.fillRect(x + 2, y + 1, 12, 3);
      g.fillStyle(c.copper, 1);
      g.fillRect(x + 3, y + 6, 10, 1);
      g.fillRect(x + 3, y + 9, 10, 1);
      g.fillStyle(c.trim, 0.8);
      g.fillRect(x + 6, y + 1, 1, 3);
    } else if (item.kind === 'statue') {
      const g = propLayer(item.at.y);
      g.fillStyle(c.stone, 1);
      g.fillRect(x, y + 8, 16, 8);
      g.fillRect(x + 4, y - 3, 8, 12);
      g.fillStyle(c.plaza, 1);
      g.fillRect(x + 5, y - 2, 3, 8);
      g.fillStyle(c.water, 1);
      g.fillRect(x + 2, y + 4, 12, 2);
    }
  }

  // 渐次点亮的顺序：全街按世界 x 从西往东（同一 x 走北侧先）。顺序只由坐标算，
  // 不写死在清单里——灯柱挪一格，顺序跟着挪，不用改第二份表。
  lampUnits.sort((a, b) => a.x - b.x || a.y - b.y || a.bodyY - b.bodyY);
  lampUnits.forEach((unit, index) => { unit.order = index; });

  // 可动的灯体按落地行分层，depth 与同行的静态构件**同一个式子**（`sceneryDepth`）：
  // 摆动只改几个像素，不能把「站在摊位后应被挡住」那条判据改了。
  const lampRows = new Map<number, Phaser.GameObjects.Graphics>();
  for (const unit of lampUnits) {
    if (lampRows.has(unit.row)) continue;
    lampRows.set(unit.row, scene.add.graphics().setDepth(sceneryDepth(unit.row, altitude)));
  }
  // 灯绳也在动态层：一串一段，摆动时按组里中间那盏的相位走（跨度在构建时已记下）。
  // 摊位的棚布与火焰同样按落地行分层，depth 与同行的静态构件同式。
  const stallRows = new Map<number, Phaser.GameObjects.Graphics>();
  for (const unit of stallUnits) {
    if (stallRows.has(unit.row)) continue;
    stallRows.set(unit.row, scene.add.graphics().setDepth(sceneryDepth(unit.row, altitude)));
  }
  // 幌布的布身与沿墙投影同样按落地行分层，depth 与同行的静态构件同式。
  const bannerRows = new Map<number, Phaser.GameObjects.Graphics>();
  for (const unit of bannerUnits) {
    if (bannerRows.has(unit.row)) continue;
    bannerRows.set(unit.row, scene.add.graphics().setDepth(sceneryDepth(unit.row, altitude)));
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
    metrics: settingSceneryMetrics(),
    poolCommands: () => lampPool.commandBuffer?.length ?? 0,
    lampCount: () => lampUnits.length,
    lampUnits: () => lampUnits.map((unit) => ({
      order: unit.order,
      x: unit.x,
      y: unit.y,
      hanging: unit.hanging,
    })),
    stallUnits: () => stallReadout.map((unit) => ({ ...unit })),
    bannerUnits: () => bannerReadout.map((unit) => ({ ...unit })),
    smokeUnits: () => smokeReadout.map((unit) => ({ ...unit })),
    groundShadowUnits: () => groundShadowReadout.map((unit) => ({ ...unit })),
    update(level, now, clock) {
      lampLight.clear();
      lampPool.clear();
      steam.clear();
      for (const layer of lampRows.values()) layer.clear();
      for (const layer of stallRows.values()) layer.clear();
      const override = clock.litOverride;
      const lit = override ?? lampStreetLitAt(now, clock.phase, clock.autoAdvancing);
      // 三支动态的开关：缺省全开；关掉哪一支，那一支就退化成常量。
      const motion = clock.motion ?? LAMP_MOTION_ON;
      // 局部压低周边的开关：缺省开（见 `SettingSceneryClock.localShade`）。
      const localShade = clock.localShade ?? true;
      const phase = clock.phase;
      // 摊位落地投影：一层独立 Graphics（depth 3.1），只按相位给形状，不随帧插值。
      const groundShadows = clock.groundShadows ?? GROUND_SHADOW_MOTION_ON;
      groundShadow.clear();
      groundShadowReadout.length = 0;
      if (groundShadows.on) {
        const shape = groundShadowAt(phase);
        for (const unit of stallUnits) {
          drawStallGroundShadow(groundShadow, unit.x, unit.y, c, shape);
          groundShadowReadout.push({
            order: unit.order,
            x: unit.x,
            y: unit.y,
            dx: shape.dx,
            span: shape.span,
            alpha: shape.alpha,
          });
        }
      }
      const total = lampUnits.length;
      // 亮度只按世界时刻算一遍：**同一世界时刻必然同一帧**。
      // 强制灯态（证据脚本）也走同一套渐次/呼吸，只是绕过相位总闸——
      // 「强制亮」说的是灯该亮，不是「把动画冻住」。
      const brightnessOf = (unit: LampUnit): number => {
        if (override === false) return 0;
        if (override === true) {
          const ignite = motion.ignite ? lampIgnitionProgress(now, unit.order, total) : 1;
          return ignite * (motion.breathe ? lampBreathAt(now, unit.order) : 1);
        }
        return lampBrightnessAt(now, unit.order, total, phase, clock.autoAdvancing, motion);
      };
      const swayOf = (unit: LampUnit): { dx: number; dy: number } => (
        motion.sway ? lampSwayAt(now, unit.order, unit.hanging) : { dx: 0, dy: 0 }
      );
      const brightness = new Map<LampUnit, number>();
      for (const unit of lampUnits) brightness.set(unit, brightnessOf(unit));

      // 地面光池：潮位同时定半径与强度（`lamp-pool.ts` 的纯函数），
      // 这里只负责按椭圆铺几圈、由内到外压淡。渐次与呼吸按灯/组各自的亮度
      // 压在 alpha 上——没点亮的那一盏，脚下不许先亮起来。
      if (lit) {
        for (const pool of pools) {
          const factor = pool.unit !== null
            ? brightness.get(pool.unit) ?? 0
            : pool.group !== null
              ? pool.group.units.reduce((sum, unit) => sum + (brightness.get(unit) ?? 0), 0)
                / Math.max(1, pool.group.units.length)
              : 1;
          if (factor <= 0) continue;
          const gain = Math.min(1.1, factor);
          const bands = pool.halfWidth > 0
            ? wideLampPoolBands(level, pool.halfWidth)
            : lampPoolBands(level);
          // 由外到内：外圈宽而淡，内圈窄而亮，中心才是叠起来的暖核。
          for (let i = 0; i < bands.length; i += 1) {
            const band = bands[i]!;
            lampPool.fillStyle(i === bands.length - 1 ? c.warmLight : c.amber, band.alpha * gain);
            lampPool.fillEllipse(pool.x, pool.y, band.rx * 2, band.ry * 2, POOL_SMOOTHNESS);
          }
        }
      }
      // 街灯的灯体画在自己的动态层（风摆时 1px 平移）；桥灯没有摆动，
      // 仍在 `lights` 里按亮/灭两态走。
      for (const unit of lampUnits) {
        const amount = brightness.get(unit) ?? 0;
        const sway = swayOf(unit);
        const layer = lampRows.get(unit.row);
        if (layer === undefined) continue;
        if (unit.hanging) {
          drawHangingLanternAt(layer, unit.bodyX + sway.dx, unit.bodyY + sway.dy, c, unit.order, lit, amount);
        } else {
          drawLampBodyAt(layer, unit.bodyX + sway.dx, unit.bodyY + sway.dy, c, lit, amount);
        }
      }
      // 灯绳：中间那段跟着摆，两端仍钉在短桩上。
      for (const rope of stringSpans) {
        const middle = rope.group.units[Math.floor(rope.group.units.length / 2)];
        const dx = middle === undefined ? 0 : swayOf(middle).dx;
        const layer = lampRows.get(rope.row);
        if (layer === undefined) continue;
        const segment = rope.span / 3;
        for (let i = 0; i < 3; i += 1) {
          const shift = i === 1 ? dx : 0;
          const sag = i === 1 ? 1 : 0;
          layer.fillStyle(c.trim, 0.55);
          layer.fillRect(rope.x + i * segment + shift, rope.y - 23 + sag, segment, 1);
          layer.fillStyle(c.timberDark, 1);
          layer.fillRect(rope.x + i * segment + shift, rope.y - 22 + sag, segment, 1);
        }
      }
      // 局部压低周边：三档方框，内圈重、外圈轻，中心 8×8（patch）那一块留空给灯芯。
      // 这一笔就是「发光靠压低周边」的实现：它压暗灯周围的既有颜色（ink 不新增色），
      // 不抬灯自己的亮度；同一帧关掉（`?lampLocalShade=0`）量 annulus 的回升，
      // 就是「真压低」与「只是全屏 dim」的分界（check-glow-contrast.mjs）。
      if (lit && localShade) {
        for (const unit of lampUnits) {
          const amount = Math.min(1, brightness.get(unit) ?? 0);
          if (amount <= 0.02) continue;
          const sway = swayOf(unit);
          for (const ring of LAMP_SHADE_RINGS) {
            lampLight.fillStyle(c.ink, ring.alpha * amount);
            fillSquareRing(lampLight, unit.x + sway.dx, unit.y + sway.dy, ring.inner, ring.outer);
          }
        }
      }
      // 灯体周围一圈光晕 + 灯芯；落地的那一圈在 lampPool 里，不在这里。
      if (lit) {
        for (const unit of lampUnits) {
          const amount = brightness.get(unit) ?? 0;
          if (amount <= 0.02) continue;
          const sway = swayOf(unit);
          lampLight.fillStyle(c.amber, (0.13 + level * 0.02) * Math.min(1, amount));
          lampLight.fillRect(unit.x - 5 + sway.dx, unit.y - 3 + sway.dy, 10, 7);
          lampLight.fillStyle(c.warmLight, 0.95 * Math.min(1, amount));
          lampLight.fillRect(unit.x - 2 + sway.dx, unit.y - 3 + sway.dy, 4, 6);
        }
      }
      for (const point of lights) {
        if (lit && localShade) {
          for (const ring of LAMP_SHADE_RINGS) {
            lampLight.fillStyle(c.ink, ring.alpha);
            fillSquareRing(lampLight, point.x, point.y, ring.inner, ring.outer);
          }
        }
        if (lit) {
          lampLight.fillStyle(c.amber, 0.13 + level * 0.02);
          lampLight.fillRect(point.x - 5, point.y - 3, 10, 7);
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
      // 烟：分段漂移 + 消散。关掉时画固定姿态（同一帧不变），差分才是 0。
      const smokeMotion = clock.smoke ?? SMOKE_MOTION_ON;
      const smokeStill = smokePuffsStill();
      smokeReadout.length = 0;
      for (const unit of smokeUnits) {
        const puffs = smokeMotion.drift ? smokePuffsAt(now, unit.order) : smokeStill;
        for (const puff of puffs) {
          steam.fillStyle(c.pale, puff.alpha);
          steam.fillRect(unit.x + puff.dx, unit.anchorY + puff.dy - puff.height, puff.width, puff.height);
        }
        smokeReadout.push({ order: unit.order, x: unit.x, anchorY: unit.anchorY, puffs });
      }
      // 幌布：布身横摆 1px；沿墙投影的长度/浓淡由相位给（正午短、黄昏长、夜里几乎无）。
      const bannerMotion = clock.banners ?? BANNER_MOTION_ON;
      bannerReadout.length = 0;
      for (const layer of bannerRows.values()) layer.clear();
      for (const unit of bannerUnits) {
        const sway = bannerMotion.sway
          ? bannerSwayAt(now, unit.order)
          : { dx: 0, tilt: 0 };
        const shadow = bannerMotion.shadow
          ? bannerShadowAt(now, unit.order, phase)
          : { dx: 0, span: 0, alpha: 0 };
        const layer = bannerRows.get(unit.row);
        if (layer !== undefined) {
          drawBannerShadowAt(layer, unit.x, unit.y, c, shadow.dx, shadow.span, shadow.alpha);
          drawBannerClothAt(layer, unit.x, unit.y, c, sway.dx, sway.tilt);
        }
        bannerReadout.push({
          order: unit.order,
          x: unit.x,
          y: unit.y,
          swayDx: sway.dx,
          tilt: sway.tilt,
          shadowDx: shadow.dx,
          shadowSpan: shadow.span,
          shadowAlpha: shadow.alpha,
        });
      }
      // 摊位：干天摆棚布；雨天棚布定住、由盖布接管（`weather-stalls` 那块布在同层之上）。
      // 火盆的焰与暖晕按世界时刻跳动；火不投地面光池，夜街光带读数不受影响。
      const stallMotion = clock.stalls ?? STALL_MOTION_ON;
      const packed = clock.packed ?? false;
      stallReadout.length = 0;
      for (const unit of stallUnits) {
        const layer = stallRows.get(unit.row);
        const cloth = stallMotion.cloth && !packed
          ? stallClothSwayAt(now, unit.order)
          : { dx: 0, lift: 0 };
        const fire = stallMotion.fire ? stallFireAt(now, unit.order) : { level: 0, height: 0 };
        if (layer !== undefined) {
          drawStallAwningAt(layer, unit.x, unit.y, c, cloth.dx, cloth.lift);
          drawStallFireAt(layer, unit.x, unit.y, c, fire.level, fire.height);
        }
        stallReadout.push({
          order: unit.order,
          x: unit.x,
          y: unit.y,
          awningSway: cloth.dx,
          fireLevel: fire.level,
          fireHeight: fire.height,
        });
      }
      // 设定集补绘的动态层：水面灯影、对岸窗火、湾面低雾。
      artbook.update(level, now, clock);
    },
    destroy() {
      artbook.destroy();
      for (const layer of [
        track,
        street,
        bridge,
        lampPool,
        lampLight,
        flat,
        ...propRows.values(),
        ...lampRows.values(),
        ...stallRows.values(),
        ...bannerRows.values(),
        architecture,
        steam,
      ]) layer.destroy();
      propRows.clear();
      lampRows.clear();
      stallRows.clear();
      bannerRows.clear();
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

/** 稳定整数哈希：铺装的错缝位置只由格序派生，同一条街永远是同一张脸。 */
function hash2(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 街面铺装：沿街走向的横向石缝 + 错缝竖缝 + 缝下受光唇。
 *
 * 旧版在每格画一条通栏横缝加一条通栏竖缝，一条街读成一张方格纸。
 * 这里只保留「沿街的横缝」（石材本来就该顺着路走），竖缝改成上下两排错开，
 * 且每格的错位由哈希派生，接缝不再落在格边上对齐。缝下压一档 plaza，
 * 让板有厚度；苔和磨损只给少数格。
 */
function drawPaving(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  length: number,
  c: SettingPack['palette'],
): void {
  for (let i = 0; i < length; i += 1) {
    const px = x + i * TILE_PX;
    const h = hash2(i, length);
    // 横缝的落位每格错 0–2px：缝仍是顺着街走的，但不再是一条逐格复位的水平线。
    // 48px 窗（3 格）在 1× 下读不出差别，成片铺开也像机切；错开后，
    // 相邻格的水平缝形成 1–2px 台阶，1× 就能看出「人工铺的」而不是印上去的。
    // 只挪位置、不改 alpha 与缝的条数：采样带里暗像素的数量不变。
    const j = h % 3;
    // 横缝：两道，顺着街。起止各收 1px，缝在格与格之间不断成一条通栏。
    g.fillStyle(c.stone, 0.55);
    g.fillRect(px + 1, y + 6 + j, TILE_PX - 2, 1);
    g.fillRect(px, y + 12 + j, TILE_PX - 1, 1);
    // 缝下受光唇：一档亮色贴着缝下沿，读成切过的板边。
    // 亮度停在 0.28：实测再压暗（0.18）会让 `lamp-band` 的列 ΔY 掉到 5.6pp、
    // 暗带拉到 4.6 格；0.28 与基线读数一致，不要再往下调。
    g.fillStyle(c.plaza, 0.28);
    g.fillRect(px + 1, y + 7 + j, TILE_PX - 2, 1);
    g.fillRect(px, y + 13 + j, TILE_PX - 1, 1);
    // 竖缝错缝：上中下三排各断在不同列，整条街不会出现一张网。
    g.fillStyle(c.ink, 0.16);
    g.fillRect(px + 7 + (h % 2), y + 1, 1, 5);
    g.fillRect(px + 4 + (h % 3), y + 7, 1, 5);
    g.fillRect(px + 10 + (h % 2), y + 13, 1, 3);
    // 磨损：少数格上带一块磨亮的斑，把平铺的板面打散。
    if (i % 9 === 0) {
      g.fillStyle(c.plaza, 0.22);
      g.fillRect(px + 2 + (h % 8), y + 3 + (h % 6), 3, 2);
    }
    // 骨料：换一根哈希轴，每 3–4 格才落一枚 2px 的浅/深石子。
    // 1× 下真正看得见的是这一档颗粒，不是缝的 alpha；密度压得很低，成片仍是石板。
    const gr = hash2(i * 13 + 7, length * 17 + 5);
    if (gr % 3 === 0) {
      g.fillStyle(c.plaza, 0.6);
      g.fillRect(px + 2 + (gr % 9), y + 2 + ((gr >>> 7) % 3), 2, 1);
    }
    if (gr % 7 === 0) {
      g.fillStyle(c.stone, 0.7);
      g.fillRect(px + 2 + ((gr >>> 11) % 9), y + 9 + ((gr >>> 3) % 2), 2, 1);
    }
    if (i % 6 === 0) {
      g.fillStyle(c.moss, 0.35);
      g.fillRect(px + 3, y + 2, 2, 1);
      g.fillRect(px + 12, y + 13, 1, 2);
    }
  }
}

/**
 * 街灯柱的**死件**：杆 + 横臂。柱脚落在瓦片下沿（`y + TILE_PX`），柱顶离地 58px。
 *
 * 纸灯体不在这里画了——它进了按行分层的动态层，风摆时整只灯平移 1px，
 * 柱子本身钉在地上不动。灯体下沿离地 43px，比人高 30px 再高 13px，
 * 人从灯下走过不会被灯体压住头（设定集 p16/p39）。
 */
function drawLanternPole(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
): void {
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x + 7, y - LAMP_POST_TOP, 2, LAMP_POST_TOP + TILE_PX);
  g.fillRect(x + 4, y - LAMP_POST_TOP, 10, 2);
}

/**
 * 灯柱灯体的动态一帧。`(x, y)` 是灯体左上角（已含风摆位移）。
 *
 * 白天（`lit === false`）就是一只纸灯，与旧静态画法一致；
 * 夜里没点亮时压成暗块，起亮时按 `amount` 从暗纸升到满亮，呼吸再叠 5% 上下。
 */
function drawLampBodyAt(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  lit: boolean,
  amount: number,
): void {
  if (!lit) {
    g.fillStyle(c.ember, 1);
    g.fillRect(x, y, 8, LAMP_BODY_H);
    g.fillStyle(c.ink, 0.28);
    g.fillRect(x + 1, y + 1, 6, 8);
  } else if (amount <= 0.02) {
    g.fillStyle(c.ink, 0.28);
    g.fillRect(x + 1, y + 1, 6, 8);
  } else {
    const glow = Math.min(1, amount);
    g.fillStyle(c.ember, 0.32 + 0.68 * glow);
    g.fillRect(x, y, 8, LAMP_BODY_H);
    // 同灯串：灯罩本身透暖高光，中央亮芯另在 lampLight 里画（`有芯的光`）。
    g.fillStyle(c.warmLight, 0.62 * glow);
    g.fillRect(x + 1, y + 1, 6, 10);
  }
  g.fillStyle(c.trim, 1);
  g.fillRect(x, y, 8, 1);
  g.fillStyle(c.ink, 1);
  g.fillRect(x, y + LAMP_BODY_H - 1, 8, 1);
}

/** 灯串上的一盏的动态一帧：`(bx, by)` 是纸灯左上角（已含风摆位移）。 */
function drawHangingLanternAt(
  g: Phaser.GameObjects.Graphics,
  bx: number,
  by: number,
  c: SettingPack['palette'],
  index: number,
  lit: boolean,
  amount: number,
): void {
  const paper = index % 2 === 0 ? c.ember : c.terracotta;
  g.fillStyle(c.pale, 0.5);
  g.fillRect(bx + 2, by - 5, 1, 4);
  g.fillStyle(c.timberDark, 1);
  g.fillRect(bx, by - 1, 7, 1);
  if (!lit) {
    g.fillStyle(paper, 1);
    g.fillRect(bx, by, 7, 9);
  } else if (amount <= 0.02) {
    g.fillStyle(c.ink, 0.5);
    g.fillRect(bx, by, 7, 9);
  } else {
    const glow = Math.min(1, amount);
    g.fillStyle(paper, 0.35 + 0.65 * glow);
    g.fillRect(bx, by, 7, 9);
    // 有芯的光：纸面本身透一层暖高光（既有 warmLight，不新增色）；中央亮芯另在
    // lampLight 里画。两层叠起来才读成「有芯」——只画芯、纸面还是暗红，灯就不发光。
    g.fillStyle(c.warmLight, 0.68 * glow);
    g.fillRect(bx + 1, by + 1, 5, 7);
  }
  g.fillStyle(c.trim, 1);
  g.fillRect(bx, by, 7, 1);
  g.fillStyle(c.pale, lit && amount <= 0.02 ? 0.35 : 0.75);
  g.fillRect(bx + 1, by + 8, 5, 1);
  g.fillStyle(c.ink, 1);
  g.fillRect(bx, by + 9, 7, 1);
}

/**
 * 摊位棚布的动态一帧。`(x, y)` 是摊位的落地格原点；`dx`/`lift` 是风摆的横移与
 * 上抬像素。布边与杆之间留 1px，读成被风掀着，而不是一整块贴在杆上。
 */
function drawStallAwningAt(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  dx: number,
  lift: number,
): void {
  const top = y - 14 - lift;
  g.fillStyle(c.copper, 1);
  g.fillRect(x - 2 + dx, top, 29, 4);
  g.fillStyle(c.pale, 0.85);
  g.fillRect(x - 1 + dx, top + 1, 27, 1);
  g.fillStyle(c.ember, 1);
  g.fillRect(x - 2 + dx, top + 3, 29, 1);
}

/**
 * 火盆的动态一帧：一圈暖晕 + 焰心。焰高与亮度只吃 `stallFireAt` 的档位，
 * **不画地面光池**——火光不落在地上，夜街光带读数就不会被这条动画改写。
 */
function drawStallFireAt(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  level: number,
  height: number,
): void {
  if (level <= 0 || height <= 0) return;
  const base = y + 13;
  g.fillStyle(c.ember, 0.30 * level);
  g.fillRect(x + 17, base - height - 2, 9, height + 3);
  g.fillStyle(c.ember, 0.9);
  g.fillRect(x + 20, base - height, 3, height);
  g.fillStyle(c.warmLight, 0.9 * level);
  g.fillRect(x + 21, base - height, 1, height);
}

/**
 * 幌布贴墙的投影：一道沿墙向上斜出的暗块。`span` 是影长、`alpha` 是浓淡，
 * 两者都由光照相位给（正午短、黄昏长、夜里为 0）；`dx` 跟着布身横移，
 * 影子比布多走 1px，才像同一块布投下来的。
 *
 * 夜里 `span`/`alpha` 为 0 时直接 return：南侧幌布的落影会落进夜街扫描带
 * （世界 y 435..535），灯下本来就没有这条影子，也不能让动画改写既有读数。
 */
function drawBannerShadowAt(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  dx: number,
  span: number,
  alpha: number,
): void {
  if (span <= 0 || alpha <= 0) return;
  // 影根在布脚（y-14），影梢往上斜出 span；越到梢上越淡，读成贴墙的一道斜影。
  const rows = 6;
  for (let i = 0; i < rows; i += 1) {
    const shift = dx + Math.round((span * i) / rows);
    g.fillStyle(c.ink, alpha * (1 - i / (rows * 2)));
    g.fillRect(x + 8 + shift, y - 14 - (rows - i) * 2, 11, 2);
  }
}

function drawStallGroundShadow(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  shape: { readonly dx: number; readonly span: number; readonly alpha: number },
): void {
  if (shape.span <= 0 || shape.alpha <= 0) return;
  // 柜台底是 y+16：影子从那一行往下铺两行，朝一侧随相位拉长（正午短、黄昏长）。
  const dir = shape.dx >= 0 ? 1 : -1;
  const start = x + 2 + shape.dx + (dir > 0 ? 0 : -shape.span);
  // 整条影子按影长切阶梯，**内段贴着柜台**；内芯也只压内段（压在梢上会读成倒挂）。
  const segments = shadowSegments(start, 20 + shape.span, shape.alpha, dir);
  for (const segment of segments) {
    g.fillStyle(c.deepShade, segment.alpha);
    g.fillRect(segment.x, y + 16, segment.width, 2);
  }
  const inner = segments.reduce<null | { x: number; width: number; alpha: number }>(
    (deepest, segment) => (deepest === null || segment.alpha > deepest.alpha ? segment : deepest),
    null,
  );
  if (inner !== null) {
    g.fillStyle(c.ink, inner.alpha * 0.9);
    g.fillRect(inner.x, y + 16, Math.min(16, inner.width), 1);
  }
  // 第二行下面那条 16px 外沿保持基 α（不参与阶梯）：它在地面更下一行，只做过渡。
  g.fillStyle(c.deepShade, shape.alpha);
  g.fillRect(start + (dir > 0 ? 0 : 4), y + 18, 16, 1);
}

/**
 * 幌布布身的动态一帧。两幅布长短不一（与旧静态画法同一套像素），
 * `dx` 横摆 1px、`tilt` 把短的那幅上沿抬 1px——只平移会读成"整块布在滑"。
 */
function drawBannerClothAt(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  c: SettingPack['palette'],
  dx: number,
  tilt: number,
): void {
  g.fillStyle(c.ember, 1);
  g.fillRect(x + 8 + dx, y - 25, 6, 11);
  g.fillStyle(c.trim, 1);
  g.fillRect(x + 8 + dx, y - 25, 6, 1);
  g.fillStyle(c.pale, 1);
  g.fillRect(x + 9 + dx, y - 21, 3, 1);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x + 15 + dx, y - 25 + tilt, 4, 8 - tilt);
}

/** 店铺立面：灰泥墙 + 木框 + 两扇格窗 + 暖帘 + 竖招牌。 */
function drawShopfront(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  c: SettingPack['palette'],
): number[] {
  // 墙顶往上抬 16px：立面长高，落地线（石脚底边 y+32）一格不动。
  const top = y - SHOPFRONT_TOP;
  const baseY = top + SHOPFRONT_WALL_H;
  // 檐
  g.fillStyle(c.ink, 0.22);
  g.fillRect(x - 3, top - 1, width + 6, 1);
  g.fillStyle(c.terracotta, 1);
  g.fillRect(x - 4, top - 8, width + 8, 7);
  g.fillStyle(c.trim, 0.8);
  g.fillRect(x - 4, top - 8, width + 8, 1);
  // 檐下布幔：橙红分条，幔脚压一道深线（p37/p40 的店檐）。每 6px 一条，
  // 48px 窄立面也不挤成一条实线，同时把三面店面的指令数压下来。
  for (let i = 0; i < width + 8; i += 6) {
    g.fillStyle(i % 8 === 0 ? c.warmLight : c.terracotta, 0.9);
    g.fillRect(x - 4 + i, top - 4, 3, 3);
    // 布褶：每条幔的右侧压 1px ember，3px 宽的条子才读成布，不是色块。
    g.fillStyle(c.ember, 0.55);
    g.fillRect(x - 4 + i + 2, top - 4, 1, 3);
  }
  g.fillStyle(c.ink, 0.5);
  g.fillRect(x - 4, top - 1, width + 8, 1);
  // 墙
  g.fillStyle(c.plaster, 1);
  g.fillRect(x, top, width, SHOPFRONT_WALL_H);
  // 立面材质种子：由立面的世界位置派生，同一面店墙每一帧同一张脸。
  const seed = hash2(x, y + width);
  // 斑驳：雨痕从檐口垂到窗上沿，露石与补板压在旧缝上（p40）。
  g.fillStyle(c.deepShade, 0.2);
  g.fillRect(x + 9, top + 2, 1, 10);
  g.fillRect(x + width - 19, top + 3, 1, 8);
  g.fillStyle(c.stone, 0.55);
  g.fillRect(x + 16, top + 4, 6, 4);
  g.fillStyle(c.timberDark, 0.55);
  g.fillRect(x + 3, top + 20, 8, 1);
  g.fillStyle(c.stone, 1);
  g.fillRect(x, baseY, width, SHOPFRONT_STONE_H);
  // 石脚砌缝：4px 石带压一道受光顶边，再按 6–9px 切成一排条石。
  // 旧的石脚是一条纯色灰边，读不出「砌起来的基座」。
  g.fillStyle(c.plaza, 0.9);
  g.fillRect(x, baseY, width, 1);
  for (let i = 3 + ((seed >>> 3) % 4); i < width - 2; i += 6 + ((seed >>> (i % 7)) % 4)) {
    g.fillStyle(c.deepShade, 0.5);
    g.fillRect(x + i, baseY, 1, SHOPFRONT_STONE_H);
    g.fillStyle(c.plaza, 0.3);
    g.fillRect(x + i + 1, baseY, 1, 1);
  }
  // 灰泥颗粒：亮粉是晒白的灰、暗点是泥渍。只铺在墙上，窗与门后面会盖住。
  g.fillStyle(c.pale, 0.5);
  for (let i = 0; i < 12; i += 1) {
    const gx = x + 3 + ((seed >>> (i % 16)) % Math.max(1, width - 6));
    const gy = top + 3 + ((seed >>> ((i + 9) % 16)) % (SHOPFRONT_WALL_H - 7));
    g.fillRect(gx, gy, 1 + (i % 2), 1);
  }
  g.fillStyle(c.stone, 0.3);
  for (let i = 0; i < 6; i += 1) {
    const gx = x + 3 + ((seed >>> ((i + 3) % 16)) % Math.max(1, width - 6));
    const gy = top + 9 + ((seed >>> ((i + 12) % 16)) % (SHOPFRONT_WALL_H - 14));
    g.fillRect(gx, gy, 1, 1);
  }
  // 贴地影：窄立面也要有落地的接触面，否则像一块浮着的板
  g.fillStyle(c.ink, 0.28);
  g.fillRect(x + 2, y + SHOPFRONT_BASE_H, width - 4, 2);
  // 木框：外框 + 内柱，让灰泥墙读成「木骨灰泥」而不是一块白板
  g.fillStyle(c.timberDark, 1);
  g.fillRect(x, top, 2, SHOPFRONT_WALL_H + SHOPFRONT_STONE_H);
  g.fillRect(x + width - 2, top, 2, SHOPFRONT_WALL_H + SHOPFRONT_STONE_H);
  g.fillRect(x, top + 20, width, 1);
  g.fillRect(x, top + 40, width, 1);
  g.fillStyle(c.timberDark, 0.55);
  for (let i = 12; i < width - 2; i += 12) g.fillRect(x + i, top, 1, 40);
  // 木纹：外框与竖柱上长短不一的 1px 木刺（一档更亮的 timber），
  // 让木骨读成木头，不是一条深色带。
  g.fillStyle(c.timber, 0.8);
  for (let i = 0; i < 4; i += 1) {
    g.fillRect(x + 1, top + 5 + i * 9 + ((seed >>> i) % 3), 1, 2);
    g.fillRect(x + width - 2, top + 7 + i * 9 + ((seed >>> (i + 4)) % 3), 1, 2);
  }
  for (let i = 12; i < width - 2; i += 24) {
    g.fillRect(x + i, top + 12 + ((seed >>> (i % 5)) % 14), 1, 2);
  }
  // 格窗开在墙的上半：窗底与门楣之间留一道横枋，立面才不会读成一块板。
  if (width >= 64) {
    // 宽立面：两扇格窗
    const pane = Math.max(10, Math.floor((width - 18) / 2));
    drawLattice(g, x + 5, top + 6, pane, 12, c);
    drawLattice(g, x + width - pane - 5, top + 6, pane, 12, c);
  } else {
    // 窄立面：一扇窗 + 门，别把 48px 塞成四格
    drawLattice(g, x + 5, top + 6, width - 22, 12, c);
  }
  // 暖帘与门
  const doorX = width >= 64 ? x + Math.floor(width / 2) - 7 : x + width - 18;
  g.fillStyle(c.timberDark, 1);
  g.fillRect(doorX, top + 26, 14, 14);
  g.fillStyle(c.pale, 1);
  g.fillRect(doorX, top + 26, 14, 4);
  g.fillStyle(c.ember, 1);
  for (let i = 0; i < 3; i += 1) g.fillRect(doorX + 2 + i * 4, top + 30, 1, 9);
  // 竖招牌
  g.fillStyle(c.trim, 1);
  g.fillRect(x + width - 7, top + 10, 5, 16);
  g.fillStyle(c.ink, 1);
  g.fillRect(x + width - 5, top + 12, 2, 2);
  g.fillRect(x + width - 5, top + 16, 2, 2);
  g.fillRect(x + width - 5, top + 20, 2, 1);
  // 檐下红灯：一排挂在檐口下面，是 p37/p40 店街最显眼的一层。
  const lanterns: number[] = [];
  const count = width >= 64 ? 4 : 2;
  for (let i = 0; i < count; i += 1) {
    const lx = x + 7 + i * (width - 18) / (count - 1);
    g.fillStyle(c.timberDark, 1);
    g.fillRect(lx + 2, top - 2, 1, 3);
    g.fillStyle(c.ember, 1);
    g.fillRect(lx, top + 2, 5, 7);
    g.fillStyle(c.trim, 1);
    g.fillRect(lx, top + 2, 5, 1);
    g.fillStyle(c.amber, 0.7);
    g.fillRect(lx + 2, top + 4, 1, 3);
    g.fillStyle(c.ink, 1);
    g.fillRect(lx, top + 8, 5, 1);
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
