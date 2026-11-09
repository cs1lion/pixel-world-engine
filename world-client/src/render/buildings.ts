/** 建筑层：每栋铺子拆成三层容器（地面 / 楼体 / 前檐），状态变化只改部件颜色与可见性。
 *
 * 为什么拆三层
 * ------------
 * 单容器只有一个 depth，整栋楼要么整体压在角色前面、要么整体在角色后面，做不出
 * 「站在门口时头顶被屋檐压住」这种「进屋」的读法。拆成三层各给一个 depth 之后：
 *
 *   back  地面投影 + 门口光池，压在楼体之下 → 楼「坐」在地上，不是浮在草地上
 *   body  墙体 / 屋面 / 窗 / 烟囱 / 招牌 / 进度 / 门口台阶，depth = ALTITUDE + baseY
 *   front 前檐 2px + 门框外侧 1px，depth 比站门口的角色高一档 → 檐压人
 *
 * 2026-10-20 视觉语法重做：
 * - 墙体不再是一块平色：地基、檐影、木梁、立面套件（工坊炉口 / 书阁书堆 / 抄书斋纸屏）。
 * - 屋顶加瓦垄、屋脊、苔；窗加 1px 框、窗台花箱、亮/暗两态；门加宽到 14px。
 * - 所有坐标取整；不用 fillCircle / fillEllipse 画建筑。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import type { PlacedBuilding, WorkstationSnapshot } from '../world/types.ts';
import { paletteFor, type WorldColor, type WorldPalette } from '../world/theme.ts';
import { BUILDING_DEPTH, buildingBaseY, layerDepth } from './building-depth.ts';
import { DOOR, doorRect, type DoorMetrics } from './building-proportions.ts';
import { drawDecal, roofHeight } from './decal.ts';
import { shouldDrawContactAo } from './contact-ao.ts';
import type { NarrativeHint } from '../world/memory/hints.ts';

export { BUILDING_DEPTH };

/**
 * 调试口子：`?contactAO=0`（或 `off`）关掉楼底接触暗部，默认开。
 *
 * 为什么用 URL 参数而不是 Oracle 开关：楼是一次性烘焙的静态层，没有逐帧重绘的钩子；
 * 开一页关着烘焙、同机位再开一页，拿两张同 ROI 的读数相减，才是这一块自己的 ΔL。
 * 非浏览器环境（单测）没有 window，按开处理。
 */
function contactAoEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const value = new URLSearchParams(window.location.search).get('contactAO');
  return value !== '0' && value !== 'off';
}

export { contactAoUnknownBaseCount, lumaOf } from './contact-ao.ts';

/**
 * 静态层的绘制载体：bake 前是 Graphics，bake 后是 Image。
 *
 * 调用方只用到 `setAlpha` / `setVisible`，两种类型都有；类型放宽是为了让
 * 「逐层烘焙」不必把整套 BuildingView 拆成两份。
 */
export type BuildingLayer = Phaser.GameObjects.Graphics | Phaser.GameObjects.Image;

/**
 * 逐层烘焙的留白：楼体外框之外的静态内容全在这个范围里。
 *
 * - 上 32：屋脊塔尖与烟囱顶（最上一笔在 `-22` 附近，留 10px 余量）。
 * - 下 10：接地影铺到 `h + 4`、门口光池到 `doorY + 4`。
 * - 左右各 8：接地影右侧铺到 `w + 4`、屋面挑檐到 `w + 3`。
 *
 * 为什么**按楼统一留白**而不是逐层求紧包围盒：紧包围盒要由每层的绘制常量反推，
 * 一旦某层加一笔就悄悄越界（被裁 1px 不会有任何报错）；统一盒的代价只是每张
 * 纹理多几 KB 透明边。越界由 `scripts/check-building-bake.mjs` 的「内容不得贴边」
 * 断言兜住。
 */
const BAKE_PAD = { left: 8, right: 8, top: 32, bottom: 10 } as const;

export interface BuildingBakeBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一张烘焙 Image 的自检读数（`?debug=1` 的 `debugBuildingBake` 上报）。 */
export interface BuildingBakeLayerReading {
  readonly key: string;
  readonly layer: string;
  readonly x: number;
  readonly y: number;
  readonly originX: number;
  readonly originY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly frameW: number | null;
  readonly frameH: number | null;
  /** 纹理四边最大 alpha；`null` = 读不到（不算通过）。 */
  readonly borderAlpha: number | null;
}

export interface BuildingBakeReading {
  readonly instanceId: string;
  readonly w: number;
  readonly h: number;
  readonly box: BuildingBakeBox;
  readonly layers: readonly BuildingBakeLayerReading[];
}

/** 一栋楼的统一烘焙盒（楼体局部坐标）。 */
export function buildingBakeBox(w: number, h: number): BuildingBakeBox {
  return {
    x: -BAKE_PAD.left,
    y: -BAKE_PAD.top,
    w: w + BAKE_PAD.left + BAKE_PAD.right,
    h: h + BAKE_PAD.top + BAKE_PAD.bottom,
  };
}

/**
 * 纹理四边的最大 alpha（0–255）。自检用：内容贴边 = 留白不够，已经被裁了 1px，
 * 而画面不会报任何错。纹理源不是可读画布时返回 `null`——"读不到"不算通过。
 */
export function textureBorderAlpha(scene: Phaser.Scene, key: string): number | null {
  const source = scene.textures.get(key)?.getSourceImage() as HTMLCanvasElement | undefined;
  if (!source || typeof source.getContext !== 'function') return null;
  const ctx = source.getContext('2d');
  if (ctx === null) return null;
  const { width, height } = source;
  const edge = (x: number, y: number, w: number, h: number): number => {
    const data = ctx.getImageData(x, y, w, h).data;
    let max = 0;
    for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i]!);
    return max;
  };
  return Math.max(
    edge(0, 0, width, 1),
    edge(0, height - 1, width, 1),
    edge(0, 0, 1, height),
    edge(width - 1, 0, 1, height),
  );
}

/**
 * 把一静态层烘成一张 Image：绘制仍走原来那一笔，只是画进离屏 Graphics 再转纹理。
 *
 * 对齐口径：`translateCanvas(-box.x, -box.y)` 把局部坐标平移进纹理的正象限，
 * Image 再放回 `(box.x, box.y)`。所以**纹理像素 1:1 落在原来的世界坐标上**，
 * 不做任何取整/缩放；`box` 一变就必须同时改 Image 落点，二者是一对。
 *
 * 为什么逐层烘、不合并：各层 depth 不同，人物按落地行排序，会被夹在层与层之间。
 * 合并层 = 静默改遮挡，所以这张函数只画一层。
 */
function bakeStaticLayer(
  scene: Phaser.Scene,
  building: PlacedBuilding,
  layer: string,
  box: BuildingBakeBox,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): BuildingLayer {
  const key = `building-bake:${building.instanceId}:${layer}`;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const offscreen = scene.make.graphics({}, false);
  offscreen.translateCanvas(-box.x, -box.y);
  draw(offscreen);
  offscreen.generateTexture(key, box.w, box.h);
  offscreen.destroy();
  return scene.add.image(box.x, box.y, key).setOrigin(0, 0);
}

export interface BuildingView {
  /** 地面层：三步投影 + 门口光池，depth = ALTITUDE + baseY - 2。 */
  readonly back: Phaser.GameObjects.Container;
  /** 楼体层：墙 / 屋面 / 窗 / 烟囱 / 招牌 / 进度，depth = ALTITUDE + baseY。 */
  readonly container: Phaser.GameObjects.Container;
  /** 前檐层：前檐 + 门框外侧，depth = ALTITUDE + baseY + 32，压住站在门口的人。 */
  readonly front: Phaser.GameObjects.Container;
  /**
   * 痕迹层：记忆层交下来的叙事装饰（焦痕、补板、花环……），
   * depth = ALTITUDE + baseY + 16——在楼体之后、站门口的人（+24）之前。
   * 痕迹是墙上的东西，人走过去该挡住它。
   */
  readonly decal: Phaser.GameObjects.Graphics;
  readonly chimney: BuildingLayer;
  readonly window: BuildingLayer;
  readonly progress: Phaser.GameObjects.Graphics;
  /** 招牌图标（静态文字已改图标，D5-A）。 */
  readonly sign: BuildingLayer;
  /**
   * 屋面层：屋顶 + 屋脊 + 烟囱口，**单独一张层**。
   *
   * 原来它和墙画在同一张 `g` 里，于是「进屋」时想收起屋顶就只能连墙一起收。
   * 拆开之后，剖面视图（屋顶可开 / 立面淡出 / 内景替换）才有地方下手——
   * 三层的绘制顺序不变，画面逐像素相同。
   */
  readonly roof: BuildingLayer;
  /** 烟囱口的场景坐标，粒子发射器挂在这里。 */
  readonly chimneyWorld: Phaser.Math.Vector2;
  /** 屋顶上沿，Y-Sort 用。 */
  readonly baseY: number;
}

export function createBuilding(
  scene: Phaser.Scene,
  building: PlacedBuilding,
  originX: number,
  originY: number,
  /** AO 落点那一格的地形底色（0xRRGGBB）；给了才能保证「只压暗、不提亮」。 */
  groundBase?: number,
): BuildingView {
  const px = originX + building.origin.x * TILE_PX;
  const py = originY + building.origin.y * TILE_PX;
  const w = building.footprint.w * TILE_PX;
  const h = building.footprint.h * TILE_PX;
  // 三层容器同一个 (px, py)：内部坐标与单容器时代完全一致，只有 depth 不同。
  const back = scene.add.container(px, py);
  const container = scene.add.container(px, py);
  const front = scene.add.container(px, py);

  const box = buildingBakeBox(w, h);
  const { roof, trim, window: windowColor } = building.palette;
  const roofH = roofHeight(h);
  const doorX = building.door.x * TILE_PX - px;
  // 门洞：所有楼统一用 `DOOR`（22×27）。样板阶段只对 `lamp_lodge` 生效的那一版
  // 已经用截图验证过锚点（门底贴墙底、门框不穿模、门口台阶不被 front 层横穿），
  // 这里才批量。尺寸依据见 `building-proportions.ts`。
  const doorMetrics = DOOR;

  // 静态层逐层烘焙：每层仍是自己的 Graphics 笔画，只是画进离屏纹理再换成 Image。
  // **一层一张，不合并**——各层 depth 不同，人会被夹在层与层之间（见 bakeStaticLayer）。
  const backLayer = scene.add.graphics();
  drawGroundShadow(backLayer, building, w, h, px, py, groundBase);
  back.add([backLayer]);

  // 墙体层拆成「烘 → 活 → 烘 → 活 → 烘」五段，**顺序与原来那一支 drawWall 完全一致**。
  //
  // 为什么不能整层烘一张：板缝 / 木纹刺 / 石基砌缝是 α<1 的叠色，Canvas2D 烘焙
  // 与 WebGL 直接绘制在半透明合成上有 ±1 的舍入差（实测 984 px / max 1，全落在
  // 16px 节拍的板缝行上）。把这几笔留在活的 Graphics 上、只烘 α=1 的实体块，
  // 就能逐字节等价。**不预乘、不手算混色**——那要靠猜 GPU 的舍入方式，换一套
  // 设定集就可能悄悄差 1。
  const wallBody = bakeStaticLayer(scene, building, 'wall-body', box, (target) =>
    drawWallBody(target, building, w, h, roofH),
  );
  const wallDetail = scene.add.graphics();
  drawWallDetail(wallDetail, building, w, h, roofH);
  const wallBase = bakeStaticLayer(scene, building, 'wall-base', box, (target) =>
    drawWallBase(target, w, h),
  );
  const wallBaseSeam = scene.add.graphics();
  drawWallBaseSeams(wallBaseSeam, building, w, h);
  const wallStruct = bakeStaticLayer(scene, building, 'wall-struct', box, (target) =>
    drawWallStructure(target, building, w, h, roofH, doorX),
  );
  // 屋面单独一张：见 `BuildingView.roof` 的注释。绘制顺序（墙 → 屋面 → 烟囱）
  // 与拆开之前一致，所以街景那一帧不该有任何像素变化。
  const roofG = bakeStaticLayer(scene, building, 'roof', box, (target) => {
    drawRoof(target, building.silhouette, w, roofH, roof, trim);
    drawChimney(target, w, roof, trim);
  });

  const chimney = bakeStaticLayer(scene, building, 'chimney', box, (target) => {
    target.fillStyle(paletteFor().charcoal, 1);
    target.fillRect(w - 16, -10, 9, 14);
    target.fillStyle(paletteFor().soil, 1);
    target.fillRect(w - 15, -10, 7, 2);
    target.fillStyle(paletteFor().trim, 1);
    target.fillRect(w - 16, -2, 9, 2);
    target.fillStyle(paletteFor().ink, 1);
    target.fillRect(w - 14, -9, 3, 2);
    target.fillStyle(paletteFor().ember, 0.7);
    target.fillRect(w - 13, -8, 1, 1);
    target.fillStyle(paletteFor().warmLight, 0.8);
    target.fillRect(w - 12, -8, 1, 1);
  });

  const windowG = bakeStaticLayer(scene, building, 'window', box, (target) => {
    drawWindows(target, building, w, h, roofH, windowColor);
    drawDoor(target, doorX, h, windowColor, doorMetrics);
  });

  // 施工进度条：**不烘**。`updateBuilding` 每帧按工位状态（working / cooling /
  // broken）重画，长度还跟着 `workstation.progress` 走、冷却时按 `time.now` 呼吸。
  // 真要走烘焙，触发点是 `updateBuilding` 里这三态的切换（键要带 `进度档位`），
  // 按帧呼吸的那一段只能留在活的 Graphics 上——否则进度条会永远停在第 0 帧。
  const progress = scene.add.graphics();
  progress.setVisible(false);

  // 痕迹层单独一张 Graphics，**不进任何容器**——它要有自己的 depth
  // （在 body 与 front 之间），而容器里的子对象共用容器的 depth。
  // 位置与容器相同，内部坐标就与楼体那一套一致。
  //
  // **不烘焙，且不许「顺手烘掉」**：这一层的内容会变 —— `drawBuildingDecals`
  // 每次被调用都 `clear()` 重画（铺面痕迹跟着单子/契约走）。真要走烘焙，唯一
  // 合法的触发点是那次 `drawBuildingDecals` 调用：取消单子、换契约、放新痕迹
  // 都必须让这张纹理失效重建（键里要带痕迹集合的版本），否则世界会把痕迹钉死
  // 在第一次画出来的那一天，而且不报错。重建理由同 `bakeLayer`：版本变了才重画。
  const decal = scene.add.graphics();
  decal.setPosition(px, py);

  // 静态招牌：不再画中文，按接的活画一枚像素图标（D5-A）。
  // 民居不挂牌：招牌是"这栋楼对外承接什么"的招牌，住家没有这回事。
  //
  // **不烘**：牌底是 `ink` α 0.55 的叠色，且 `updateBuilding` 会按忙闲改整块的
  // `setAlpha`（1 / 0.72）。烘成纹理会把这两层 α 乘在一起再量化一次（实测
  // 5,052 px / max 31），所以这一层留在活的 Graphics 上。
  const sign = scene.add.graphics();
  if (building.zone !== 'living') drawSignIcon(sign, building, w);

  // 容器内按数组顺序绘制：墙体五段保持原绘制顺序，屋面紧接在墙后（压在墙上）。
  container.add([wallBody, wallDetail, wallBase, wallBaseSeam, wallStruct, roofG, chimney, windowG, progress, sign]);

  // 台阶：门洞口外侧 2px，落在门口格最上面 2px。**放在 body 层**而不是 front：
  // 角色站门口时脚在门口格底边（baseY+16），台阶在 baseY..baseY+2，物理上角色离
  // 观察者更近，台阶必须在他之后；放进 front（depth 比角色高）会盖住他的胸口。
  const stepG = bakeStaticLayer(scene, building, 'step', box, (target) =>
    drawDoorStep(target, doorX, h, doorMetrics),
  );
  container.add([stepG]);

  // 前檐层：前檐 3px + 门框外侧 1px —— 这两样才该压在角色身上。
  const frontG = bakeStaticLayer(scene, building, 'front', box, (target) =>
    drawFrontLayer(target, w, h, doorX, roof, trim, doorMetrics),
  );
  front.add([frontG]);

  return {
    back,
    container,
    front,
    decal,
    chimney,
    window: windowG,
    progress,
    sign,
    roof: roofG,
    chimneyWorld: new Phaser.Math.Vector2(px + w - 12, py - 4),
    // baseY 用纯函数算，测试与实现共用同一个算式，不会各写一套而漂移。
    baseY: buildingBaseY(py, building.footprint.h),
  };
}

/**
 * 把记忆层交下来的痕迹画到墙上。
 *
 * 补充设计 §10：「表现层只消费 ExpressionHint，不直接读记忆库」。所以这个函数
 * 收的是**单子**（`NarrativeHint[]`），不是 `Traces`——它没有能力去翻库，
 * 也就不可能绕开 `traceExposedLayers` 那道闸。
 *
 * 调用方（`SandboxScene`）只在单子变了的时候调它：痕迹一天才风化一次，
 * 每拍重画是白烧。`clear()` 在画之前，所以传空单子就是擦干净。
 *
 * `palette` 是**这一次**这套设定集的 24 色（楼体自己那几笔读的是
 * `building.palette`，痕迹读这个）。必填，不给缺省值：上一版漏了这一步，
 * 灯潮界的墙上就一直画着莞尔镇的石头色。
 */
export function drawBuildingDecals(
  view: BuildingView,
  hints: readonly NarrativeHint[],
  building: PlacedBuilding,
  palette: WorldPalette,
): void {
  const w = building.footprint.w * TILE_PX;
  const h = building.footprint.h * TILE_PX;
  const roofH = roofHeight(h);
  view.decal.clear();
  for (const hint of hints) drawDecal(view.decal, hint, w, h, roofH, palette);
}

/**
 * 地面层：三步阶梯接地影 + 墙角接触暗部 + 门口光池。
 *
 * **方向口径（G1）**：这一层是**静态结构/接触影**，方向固定朝右下，不跟随光照相位，
 * 不来自哪一侧的太阳。动态相位影（黄昏朝左下、清晨朝右）住在 `world/ground-shadow.ts`，
 * 是另一层、另一条公式；此前这行注释写「光从左上打（与角色接触阴影同向）」，
 * 把两层的方向混成了一句话，已按 4× 对照的结论改掉。
 *
 * 三步 α 0.16 / 0.32 / 0.55：越靠墙越深、越往外越淡，读成「楼坐在地上」而不是
 * 底下垫了一块灰板。不用 blur——像素画里模糊边缘会变成脏灰带。
 *
 * 左下角另加一块 4×4 的接触暗部（α 0.12）：右侧已有接地影，左侧墙脚原本是干的，
 * 楼会像浮在地上。这一块与太阳无关，只补「墙面与地面相接」的那口气。
 *
 * 阴影色为什么是 `ink`（#111821，Rec.709 亮度 23.16）而不是 `deepShade`：
 * `deepShade` 的亮度是 44.33，**高于最深的 mud 基底（soil #202b35，41.38）**，
 * 叠上去会把那块地提亮（实测 −0.79）——一个叫「接触暗部」的东西做出变亮结果
 * 是语义错误。`ink` 是 24 色里最暗的一档，比所有地形基底都暗，任何基底都只会变暗。
 *
 * α 0.12 由 G3 的实测带 [6,14] 定（详见 `docs/evidence/lighting-gaps/README.md`）：
 * `ink` 下可读基底里最暗的 stone（90.55）读 8.09、最亮的 plaza（134.09）读 13.28；
 * 抬 α 会把 plaza 推出上限，降 α 会让 stone 跌破下限。
 *
 * 兜底（判在 `contact-ao.ts`）：合成后若比基底亮（有人把阴影色改浅到比基底还亮），
 * **直接不产出这块矩形**，而不是画一块提亮的矩形。判据脚本里另有断言「对任一基底 ΔL > 0」
 * 会把这种情况判红。**基底未知（调用方没传落点那格）同样不画，并计数**——把「不知道」
 * 当「安全」放行等于默认它是亮底；`renderStats().contactAoUnknownBase` 断言为 0，
 * 出现即说明 `terrainBaseOf(...)` 取错位置，是红事，不是缺省行为。
 */
function drawGroundShadow(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
  px: number,
  py: number,
  groundBase?: number,
): void {
  // 最贴地的一步最深、最窄；往外两层逐级变淡变宽，整体向右下错开 2px。
  g.fillStyle(paletteFor().ink, 0.55);
  g.fillRect(2, h - 2, w - 2, 2);
  g.fillStyle(paletteFor().deepShade, 0.32);
  g.fillRect(3, h, w - 1, 2);
  g.fillStyle(paletteFor().deepShade, 0.16);
  g.fillRect(4, h + 2, w, 2);
  // 左墙脚接触暗部：只补左侧（右侧三层已铺到墙外），4×4 与墙角 ROI 同尺寸。
  // `?contactAO=0` 关掉这一块，给证据脚本做同机位 on/off：ΔL 只由这一块贡献，
  // 不靠「旁边找一块看起来差不多的地」当基准（那种基准常落在另一个地形 token 上）。
  if (contactAoEnabled()) {
    const shade = paletteFor().ink;
    // 未知基底不画（并按「取错落点」计数）；已知基底只在确实会变暗时画。
    if (shouldDrawContactAo(groundBase, shade)) {
      g.fillStyle(shade, 0.12);
      g.fillRect(-4, h, 4, 4);
    }
  }

  // 门口光池：屋里有灯，光落在门前。两层 ── 外圈铺开、内芯更亮，都是琥珀的低透明度。
  const doorX = building.door.x * TILE_PX - px;
  const doorY = building.door.y * TILE_PX - py;
  g.fillStyle(paletteFor().amber, 0.08);
  g.fillRect(doorX - 11, doorY - 1, 22, 5);
  g.fillStyle(paletteFor().amber, 0.14);
  g.fillRect(doorX - 7, doorY, 14, 3);
}

/** 墙体材质的种子：由门位派生，同栋楼恒定，跨读档不重摆。 */
function wallSeed(building: PlacedBuilding): number {
  let hsh =
    Math.imul(building.door.x + 0x9e37, 0x85ebca6b) +
    Math.imul(building.door.y + 0x1234, 0xc2b2ae35);
  hsh ^= hsh >>> 13;
  return hsh >>> 0;
}

/** 板缝的纵向节拍（世界像素）。同一排建筑按这个节拍落缝，跨栋才不会错位。 */
export const WALL_SEAM_PITCH = 16;

/**
 * 墙面横板缝的局部 y 行（相对楼体左上角）。
 *
 * 位置**只由世界基线决定**：从 `(baseY + roofH + 3)` 向上取整到 16px 节拍，
 * 之后每 16px 一条，画到 `h - 8`（横梁上沿）。`seed` 不参与位置，只决定深浅，
 * 所以同排、同材质、不同 `roofH` 的相邻建筑，板缝落在同一组世界 y 上。
 */
export function wallSeamRows(baseY: number, roofH: number, h: number, seed: number): readonly number[] {
  const top = roofH + 3;
  const bottom = h - 8;
  if (bottom <= top) return [];
  const firstWorld = Math.ceil((baseY + top) / WALL_SEAM_PITCH) * WALL_SEAM_PITCH;
  const rows: number[] = [];
  for (let worldY = firstWorld; worldY <= baseY + bottom; worldY += WALL_SEAM_PITCH) {
    rows.push(worldY - baseY);
  }
  void seed;
  return rows;
}

/**
 * 墙体：平色 → 板壁木纹 + 地基砌缝 → 檐影 + 木梁 + 立面套件。
 *
 * 原来是一支 `drawWall`。拆成五段（body / detail / base / baseSeam / structure）
 * 只为逐字节烘焙：实体块去烘焙，α<1 的叠色留在活的 Graphics 上，顺序不变。
 * 五段的绘制内容与改写前一一对应，**任何一笔的位置/颜色都不许在这里顺手"整理"**。
 */
function drawWallBody(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
  roofH: number,
): void {
  const { body } = building.palette;
  g.fillStyle(body, 1);
  g.fillRect(0, roofH, w, h - roofH);
}

/** 板壁材质：横向板缝 + 短木纹刺。α 0.26–0.3，必须留在活的 Graphics 上。 */
function drawWallDetail(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
  roofH: number,
): void {
  // 位置全部由门位派生（同一栋楼每一帧、每次读档都是同一张脸，不读时钟）。
  // 只在梁与柱之间画，避免和结构线叠成一张格子。
  const seed = wallSeed(building);
  const bodyTop = roofH + 3;
  const bodyH = h - 8 - bodyTop;
  if (bodyH > 8) {
    const seams = wallSeamRows(building.origin.y * TILE_PX, roofH, h, seed);
    for (let i = 0; i < seams.length; i += 1) {
      g.fillStyle(paletteFor().timberDark, (i + (seed >>> 4)) % 2 === 0 ? 0.3 : 0.26);
      g.fillRect(1, seams[i]!, w - 2, 1);
    }
    g.fillStyle(paletteFor().timberDark, 0.26);
    const specks = Math.max(2, Math.floor(w / 14));
    for (let i = 0; i < specks; i += 1) {
      const sxp = 2 + ((seed >>> (i % 16)) % Math.max(1, w - 7));
      const syp = bodyTop + 1 + ((seed >>> ((i + 5) % 16)) % Math.max(1, bodyH - 2));
      g.fillRect(sxp, syp, 2 + (i % 3), 1);
    }
  }
}

/** 地基：3px 石基 + 1px 压顶。楼不再直接插在草里。 */
function drawWallBase(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
  g.fillStyle(paletteFor().stone, 1);
  g.fillRect(0, h - 3, w, 3);
  g.fillStyle(paletteFor().plaza, 1);
  g.fillRect(0, h - 3, w, 1);
  g.fillStyle(paletteFor().soil, 1);
  g.fillRect(0, h - 1, w, 1);
}

/** 石基砌缝：把压顶下的 3px 石带切成 8–13px 的石块（含 α 0.22 的暗缝）。 */
function drawWallBaseSeams(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
): void {
  const seed = wallSeed(building);
  // 缝只压 1px 高、ink 0.22：楼基是 `lamp-band` 逐列取 ΔY 的采样带之一，
  // 缝再深就会和灯池的暖光抢对比度（0.35 那版读数虽然没掉，但基线本身已
  // 由 76.9% 漂到 75.9%，不给自己多留暗像素）。
  for (let bx = 2 + (seed % 6); bx < w - 2; bx += 8 + ((seed >>> (bx % 9)) % 5)) {
    g.fillStyle(paletteFor().soil, 1);
    g.fillRect(bx, h - 2, 1, 1);
    g.fillStyle(paletteFor().ink, 0.22);
    g.fillRect(bx + 1, h - 2, 1, 1);
  }
}

/** 檐影 + 木梁 + 边饰 + 立面套件：全是 α=1，可整体烘焙。 */
function drawWallStructure(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
  roofH: number,
  doorX: number,
): void {
  // 檐下阴影：2px 实心暗木色，不用 alpha 做材质。
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(0, roofH, w, 2);

  // 木梁：上下横梁 + 每 14px 一根竖柱。比旧的每 7px 一条细线更像结构。
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(0, roofH + 2, w, 1);
  g.fillRect(0, h - 6, w, 1);
  for (let x = 6; x < w - 4; x += 14) {
    g.fillRect(x, roofH + 2, 2, h - roofH - 8);
  }
  // 抬升构件的固定边饰：上/左亮、下/右暗。这是**作图约定**，不是光照推导——
  // 镇里的建筑影是固定的右下静态结构/接触影，不来自太阳，所以「受光面/背光边」
  // 这类说法在这里没有依据。左列 1px 暖高光、右列 1px 暗木色，同一竖高、同一套规矩。
  const wallEdge = { x: 0, y: roofH + 2, w, h: h - roofH - 8 };
  g.fillStyle(paletteFor().warmLight, 1);
  g.fillRect(wallEdge.x, wallEdge.y, 1, wallEdge.h);
  for (const row of edgeRows('wall', wallEdge)) {
    g.fillStyle(paletteFor()[row.token], row.alpha);
    g.fillRect(row.x, row.y, row.w, row.h);
  }

  drawFacade(g, building, w, h, roofH, doorX);
}

/** 三栋常驻铺子 + 蓝顶扩建样板各自的立面识别件。 */
function drawFacade(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
  roofH: number,
  doorX: number,
): void {
  if (building.prefabId === 'code_forge') {
    // 炉口：黑框 + ember 内芯 + amber 火线；左侧再放一个铁砧。
    const fx = 6;
    const fy = h - 22;
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(fx - 1, fy - 1, 13, 15);
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(fx, fy, 11, 13);
    g.fillStyle(paletteFor().ember, 1);
    g.fillRect(fx + 2, fy + 7, 7, 4);
    g.fillStyle(paletteFor().amber, 1);
    g.fillRect(fx + 3, fy + 8, 5, 2);
    g.fillStyle(paletteFor().warmLight, 1);
    g.fillRect(fx + 3, fy + 8, 2, 1);
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(fx + 5, fy + 3, 1, 4);
    // 铁砧：两块叠起来的暗铁。
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(w - 20, h - 10, 10, 3);
    g.fillRect(w - 18, h - 7, 6, 2);
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(w - 19, h - 9, 8, 2);
    g.fillStyle(paletteFor().plaza, 1);
    g.fillRect(w - 20, h - 10, 10, 1);
    return;
  }

  if (building.prefabId === 'star_archive') {
    // 灰泥高窗 + 书堆 + 星形徽记。塔楼的识别靠高度，细节靠“书”。
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(4, roofH + 6, w - 8, 4);
    g.fillStyle(paletteFor().copper, 1);
    g.fillRect(4, roofH + 10, w - 8, 1);
    g.fillStyle(paletteFor().trim, 1);
    for (let i = 0; i < 5; i += 1) {
      g.fillRect(6 + i * 3, roofH + 3 + (i % 2), 2, 2);
    }
    // 门边书堆：3 摞，浅色书脊。
    for (let stack = 0; stack < 3; stack += 1) {
      const bx = w - 24 + stack * 6;
      const by = h - 10 - (stack % 2) * 3;
      g.fillStyle(paletteFor().ink, 1);
      g.fillRect(bx - 1, by - 1, 6, 8);
      g.fillStyle(paletteFor().timberDark, 1);
      g.fillRect(bx, by, 4, 6);
      g.fillStyle(stack === 0 ? paletteFor().plaster : stack === 1 ? paletteFor().trim : paletteFor().pale, 1);
      g.fillRect(bx, by + 1, 4, 1);
      g.fillRect(bx, by + 4, 4, 1);
    }
    return;
  }

  if (building.prefabId === 'ink_house') {
    // 纸屏：三扇 pale 屏风 + trim 木格，替代普通窗；门边晾纸架。
    for (let i = 0; i < 3; i += 1) {
      const sx = 6 + i * 14;
      g.fillStyle(paletteFor().ink, 1);
      g.fillRect(sx - 1, h - 26, 12, 14);
      g.fillStyle(paletteFor().pale, 1);
      g.fillRect(sx, h - 25, 10, 12);
      g.fillStyle(paletteFor().timberDark, 1);
      g.fillRect(sx + 4, h - 25, 1, 12);
      g.fillRect(sx, h - 20, 10, 1);
    }
    // 晾纸架：两根柱 + 三张垂下的纸。
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(w - 18, h - 18, 1, 12);
    g.fillRect(w - 8, h - 18, 1, 12);
    g.fillRect(w - 19, h - 19, 13, 1);
    g.fillStyle(paletteFor().pale, 1);
    for (let i = 0; i < 3; i += 1) g.fillRect(w - 17 + i * 4, h - 17, 3, 7);
    // 门边陶罐：terracotta 的小面积材料点缀。
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(w - 19, h - 7, 5, 5);
    g.fillStyle(paletteFor().terracotta, 1);
    g.fillRect(w - 18, h - 6, 3, 3);
    return;
  }

  // 民居：窗台花箱 + 门边柴堆。没有"承接什么"的立面，只有过日子的痕迹。
  if (building.zone === 'living') {
    drawCottageFacade(g, w, h, roofH);
    return;
  }

  // workshop_plot：木料堆 + 滑轮，蓝顶由 prefab palette 提供。
  g.fillStyle(paletteFor().timber, 1);
  g.fillRect(5, h - 12, 14, 3);
  g.fillRect(6, h - 9, 12, 3);
  g.fillStyle(paletteFor().trim, 1);
  g.fillRect(5, h - 12, 14, 1);
  g.fillStyle(paletteFor().ink, 1);
  g.fillRect(w - 14, roofH + 4, 1, 10);
  g.fillStyle(paletteFor().trim, 1);
  g.fillRect(w - 16, roofH + 3, 5, 2);
  g.fillRect(w - 18, roofH + 13, 9, 1);
  void doorX;
}

/**
 * 民居立面：柴堆、花箱、一口水缸。
 *
 * 三样东西都是"住着的证据"而不是"干活的证据"。
 *
 * 这里原先写「这是民居和铺子在立面上唯一需要拉开的地方」——不成立：招牌那处
 * 也是。上面挂招牌那段按 `building.zone !== 'living'` 决定画不画
 * `drawSignIcon`，民居不挂牌。所以立面上至少差两处：这一处摆什么，那一处
 * 挂不挂牌。两处各有各的理由、都写着，别并成一句"只有这里"。
 *
 * 全部用现有 24 色，不扩色。
 */
function drawCottageFacade(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  roofH: number,
): void {
  // 门边柴堆：靠左墙码三根，截面朝外。
  const sx = 3;
  const sy = h - 13;
  g.fillStyle(paletteFor().ink, 1);
  g.fillRect(sx - 1, sy - 1, 9, 11);
  for (let row = 0; row < 3; row += 1) {
    const y = sy + row * 3;
    // 隔行往里缩一格：齐整的方垛读成货箱，错开才读成随手码的柴。
    const inset = row % 2 === 0 ? 0 : 1;
    g.fillStyle(paletteFor().timber, 1);
    g.fillRect(sx + inset, y, 7 - inset, 3);
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(sx + inset, y, 1, 3);
    g.fillStyle(paletteFor().trim, 1);
    g.fillRect(sx + inset + 1, y, 2, 1);
  }

  // 窗台花箱：从右墙往里量，避开窗户本体的位置。
  const fx = w - 20;
  const fy = roofH + 14;
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(fx - 1, fy, 12, 3);
  g.fillStyle(paletteFor().ember, 1);
  for (let i = 0; i < 4; i += 1) g.fillRect(fx + i * 3, fy - 1, 1, 1);
  g.fillStyle(paletteFor().moss, 1);
  g.fillRect(fx + 1, fy - 1, 1, 1);
  g.fillRect(fx + 7, fy - 1, 1, 1);

  // 水缸：屋角一口矮缸，缸口压一条亮边。
  if (w >= 4 * TILE_PX) {
    const jx = w - 9;
    const jy = h - 8;
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(jx, jy, 6, 6);
    g.fillStyle(paletteFor().charcoal, 1);
    g.fillRect(jx + 1, jy + 1, 4, 5);
    g.fillStyle(paletteFor().stone, 1);
    g.fillRect(jx + 1, jy + 1, 4, 1);
    g.fillStyle(paletteFor().water, 1);
    g.fillRect(jx + 2, jy + 2, 2, 1);
  }
}

/** 屋顶：剪影 + 瓦垄 + 屋脊 + 苔。坐标全部取整，避免半像素。 */
function drawRoof(
  g: Phaser.GameObjects.Graphics,
  silhouette: PlacedBuilding['silhouette'],
  w: number,
  roofH: number,
  roof: number,
  trim: number,
): void {
  if (silhouette === 'gable') {
    const rows = Math.max(4, Math.round(roofH / 3));
    for (let row = 0; row < rows; row += 1) {
      const inset = Math.round(((rows - 1 - row) / rows) * (w / 2));
      const x = -3 + inset;
      const rw = w + 6 - inset * 2;
      const y = Math.round((row * roofH) / rows);
      const rh = Math.round(roofH / rows) + 1;
      g.fillStyle(roof, 1);
      g.fillRect(x, y, rw, rh);
      // 瓦垄：每行下缘 1px 深土色（对 terracotta/copper/charcoal 都可辨），隔行加一段苔。
      g.fillStyle(paletteFor().soil, 1);
      g.fillRect(x, y + rh - 1, rw, 1);
      if (row % 2 === 0) {
        g.fillStyle(paletteFor().moss, 1);
        g.fillRect(x + 2 + ((row * 7) % Math.max(2, rw - 4)), y + rh - 1, 2, 1);
      }
    }
    // 屋脊：2px trim 从尖顶压到檐口，左缘加 1px 暖高光。
    g.fillStyle(trim, 1);
    g.fillRect(Math.round(w / 2) - 1, 0, 2, roofH);
    g.fillStyle(paletteFor().warmLight, 1);
    g.fillRect(Math.round(w / 2) - 1, 0, 1, roofH);
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(Math.round(w / 2) + 1, 0, 1, roofH);
    // 檐口：3px 出檐 + 1px 檐底阴影。
    g.fillStyle(roof, 1);
    g.fillRect(-4, roofH - 2, w + 8, 2);
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(-4, roofH, w + 8, 1);
    return;
  }

  if (silhouette === 'tower') {
    g.fillStyle(roof, 1);
    g.fillRect(-3, Math.round(roofH * 0.45), w + 6, Math.round(roofH * 0.55));
    // 塔身向上伸出屋面 12px：让 archive 在剪影上真的比另外两栋高。
    const towerX = Math.round(w * 0.32);
    const towerW = Math.round(w * 0.36);
    g.fillRect(towerX, -12, towerW, Math.round(roofH * 0.55) + 12);
    // 瓦垄：横线用冷影，和铜绿屋顶拉开；塔身与屋面同一套。
    for (let y = -9; y < roofH; y += 3) {
      g.fillStyle(paletteFor().deepShade, 1);
      if (y >= Math.round(roofH * 0.45)) {
        g.fillRect(-3, y, w + 6, 1);
      } else {
        g.fillRect(towerX + 1, y, towerW - 2, 1);
      }
      if (y % 6 === 0) {
        g.fillStyle(paletteFor().moss, 1);
        g.fillRect(towerX + 2, y, 3, 1);
      }
    }
    g.fillStyle(trim, 1);
    g.fillRect(towerX - 1, Math.round(roofH * 0.45), towerW + 2, 2);
    g.fillStyle(paletteFor().warmLight, 1);
    g.fillRect(towerX - 1, Math.round(roofH * 0.45), towerW + 2, 1);
    // 塔顶小尖顶 + 星窗。
    g.fillStyle(trim, 1);
    g.fillRect(Math.round(w * 0.5) - 1, -18, 2, 6);
    g.fillStyle(paletteFor().warmLight, 1);
    g.fillRect(Math.round(w * 0.5) - 1, -18, 1, 6);
    g.fillStyle(roof, 1);
    g.fillRect(Math.round(w * 0.5) - 3, -13, 6, 2);
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(Math.round(w * 0.5) - 3, Math.round(roofH * 0.22), 7, 8);
    g.fillStyle(paletteFor().amber, 1);
    g.fillRect(Math.round(w * 0.5) - 2, Math.round(roofH * 0.23), 5, 6);
    g.fillStyle(paletteFor().warmLight, 1);
    g.fillRect(Math.round(w * 0.5), Math.round(roofH * 0.23), 1, 5);
    g.fillRect(Math.round(w * 0.5) - 2, Math.round(roofH * 0.25), 5, 1);
    return;
  }

  // flat：平顶 + 竖肋 + 檐口。
  g.fillStyle(roof, 1);
  g.fillRect(-3, 0, w + 6, roofH);
  g.fillStyle(paletteFor().soil, 1);
  for (let x = 1; x < w + 4; x += 4) g.fillRect(x - 3, 2, 1, roofH - 4);
  for (let y = 3; y < roofH - 2; y += 3) {
    g.fillStyle(paletteFor().deepShade, 1);
    g.fillRect(-3, y, w + 6, 1);
    if (y % 6 === 0) {
      g.fillStyle(paletteFor().moss, 1);
      g.fillRect(4, y, 3, 1);
    }
  }
  g.fillStyle(trim, 1);
  g.fillRect(-3, roofH - 2, w + 6, 2);
  g.fillStyle(paletteFor().warmLight, 1);
  g.fillRect(-3, roofH - 2, w + 6, 1);
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(-3, roofH, w + 6, 1);
}

/** 烟囱座：从屋顶长出来，带压顶和砖缝。 */
function drawChimney(
  g: Phaser.GameObjects.Graphics,
  w: number,
  roof: number,
  trim: number,
): void {
  g.fillStyle(roof, 1);
  g.fillRect(w - 18, -8, 12, 12);
  g.fillStyle(paletteFor().charcoal, 1);
  g.fillRect(w - 18, -8, 12, 2);
  g.fillRect(w - 18, -2, 12, 2);
  g.fillStyle(trim, 1);
  g.fillRect(w - 19, -10, 14, 2);
  g.fillStyle(paletteFor().warmLight, 1);
  g.fillRect(w - 19, -10, 14, 1);
  g.fillStyle(paletteFor().ink, 1);
  g.fillRect(w - 15, -9, 6, 2);
}

/** 窗：1px 黑框 + 1px 亮框 + 琥珀内芯；右侧窗不亮，避免整排发光。 */
function drawWindows(
  g: Phaser.GameObjects.Graphics,
  building: PlacedBuilding,
  w: number,
  h: number,
  roofH: number,
  windowColor: number,
): void {
  const positions = [6, w - 18];
  for (let i = 0; i < positions.length; i += 1) {
    const x = positions[i]!;
    const y = roofH + 7;
    const lit = i === 0 || building.prefabId === 'code_forge';
    g.fillStyle(paletteFor().ink, 1);
    g.fillRect(x - 1, y - 1, 10, 9);
    g.fillStyle(paletteFor().trim, 1);
    g.fillRect(x, y, 8, 7);
    g.fillStyle(lit ? windowColor : paletteFor().deepShade, 1);
    g.fillRect(x + 1, y + 1, 6, 5);
    if (lit) {
      g.fillStyle(paletteFor().warmLight, 1);
      g.fillRect(x + 1, y + 1, 3, 1);
    }
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(x + 4, y + 1, 1, 5);
    g.fillRect(x + 1, y + 4, 6, 1);
    // 窗台花箱：木箱 + 1px ember 花。
    g.fillStyle(paletteFor().timberDark, 1);
    g.fillRect(x - 1, y + 7, 10, 2);
    g.fillStyle(paletteFor().ember, 1);
    g.fillRect(x + 1, y + 6, 1, 1);
    g.fillRect(x + 4, y + 6, 1, 1);
    g.fillRect(x + 7, y + 6, 1, 1);
  }
  void h;
}

/**
 * 门：默认 22×27（`building-proportions.ts` 的 `DOOR`），底边与墙底对齐。
 *
 * 尺寸跟着 24×30 的角色走：门高 = 角色高的 90%（27/30），门宽 ≈ 0.9 角色宽。
 * 碰撞与可走性完全不看这里——那两样读的是 `building.door` 那个格。
 */
function drawDoor(
  g: Phaser.GameObjects.Graphics,
  doorX: number,
  h: number,
  windowColor: number,
  metrics: DoorMetrics,
): void {
  const { w: dw, h: dh } = metrics;
  const { x, y } = doorRect(doorX, h, metrics);
  g.fillStyle(paletteFor().ink, 1);
  g.fillRect(x - 1, y - 1, dw + 2, dh + 1);
  g.fillStyle(paletteFor().charcoal, 1);
  g.fillRect(x, y, dw, dh);
  g.fillStyle(paletteFor().trim, 1);
  g.fillRect(x, y, 1, dh);
  g.fillRect(x + dw - 1, y, 1, dh);
  g.fillRect(x, y, dw, 1);
  // 门内暖光：3×4 + 门缝 1px，读成“里面有人”。按门宽等比例放在右侧。
  const lightX = x + dw - Math.max(5, Math.round(dw * 0.4));
  g.fillStyle(windowColor, 1);
  g.fillRect(lightX, y + 4, 4, 5);
  g.fillStyle(paletteFor().warmLight, 1);
  g.fillRect(lightX, y + 4, 1, 1);
  g.fillStyle(paletteFor().amber, 1);
  g.fillRect(x + 1, h - 1, dw - 1, 1);
  // 门把手：靠右，随门高下移。
  g.fillStyle(paletteFor().trim, 1);
  g.fillRect(x + dw - 5, y + Math.round(dh * 0.52), 1, 1);
}

/**
 * 前檐层：前檐 3px（roof）+ 门框外侧 1px（trim）。
 *
 * depth = baseY + 32，而站在门口的角色是 baseY + 24（见 BUILDING_DEPTH 的推导），
 * 所以屋檐会压住她头顶 1–2px、门框会压住她身体两侧 1px —— 这就是「进屋」的读法；
 * 而站在门口再往下一格的人是 baseY + 40，不会被压到。
 */
function drawFrontLayer(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  doorX: number,
  roof: number,
  trim: number,
  metrics: DoorMetrics,
): void {
  // 前檐：楼体底边最后 3px，左右各出 3px（出檐），读成压在墙前的一道檐。
  g.fillStyle(roof, 1);
  g.fillRect(-3, h - 3, w + 6, 3);
  g.fillStyle(paletteFor().warmLight, 1);
  g.fillRect(-3, h - 3, w + 6, 1);
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(-3, h - 1, w + 6, 1);

  // 门框外侧 1px：贴着门洞再往外一列，加厚门框。门洞变大，框跟着变高变宽。
  const half = metrics.frameHalf;
  g.fillStyle(trim, 1);
  g.fillRect(doorX - half - 1, h - metrics.h, 1, metrics.h);
  g.fillRect(doorX + half + 1, h - metrics.h, 1, metrics.h);
  g.fillRect(doorX - half - 1, h - metrics.h - 1, half * 2 + 3, 1);
}

/**
 * 台阶：门口格最上面 2px，两级（plaza + stone）。
 *
 * **归 body 层，不进 front**：角色站门口时脚在门口格底边（baseY+16）、sprite 覆盖
 * baseY-4..baseY+16，台阶在 baseY..baseY+2 正落在她腰部高度。若放 front 层
 * （depth 比角色高）会横穿她的身体；放 body 层则她站在台阶「前面」，物理正确。
 */
function drawDoorStep(
  g: Phaser.GameObjects.Graphics,
  doorX: number,
  h: number,
  metrics: DoorMetrics,
): void {
  const half = Math.floor(metrics.stepW / 2);
  g.fillStyle(paletteFor().plaza, 1);
  g.fillRect(doorX - half, h, metrics.stepW, 1);
  g.fillStyle(paletteFor().stone, 1);
  g.fillRect(doorX - half + 1, h + 1, metrics.stepW - 2, 1);
  // 台阶底 1px：与地形暗边同一套规矩（朝下的一侧压暗），用既有的 soil，不新增色。
  const step = { x: doorX - half, y: h, w: metrics.stepW, h: 3 };
  for (const row of edgeRows('doorStep', step)) {
    g.fillStyle(paletteFor()[row.token], row.alpha);
    g.fillRect(row.x, row.y, row.w, row.h);
  }
}

export type EdgeKind = 'doorStep' | 'wall';

export interface EdgeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface EdgeRow extends EdgeRect {
  readonly token: WorldColor;
  readonly alpha: number;
}

/**
 * 构件边饰的统一判据：**作图约定**，不是光照推导——抬升构件一律「上/左亮、下/右暗」。
 *
 * 镇里的建筑影是固定右下的静态结构/接触影，不来自太阳，所以这里的右列不是「背光边」，
 * 只是「构件右下收一档」。`drawDoorStep` 与 `drawWall` 都只消费本函数返回的计划。
 *
 * token 全是既有 24 色（`soil` / `timberDark`）；alpha 一律 1，和地形那条 1px 实线
 * 同一口径——半透明的暗边会被下面的石板色透上来，读成脏灰而不是台阶。
 */
export function edgeRows(kind: EdgeKind, rect: EdgeRect): readonly EdgeRow[] {
  if (kind === 'doorStep') {
    // 台阶：最下一级（stone）比上一级（plaza）窄 1px，暗行跟着同一宽度收边。
    return [
      {
        x: rect.x + 1,
        y: rect.y + rect.h - 1,
        w: Math.max(1, rect.w - 2),
        h: 1,
        token: 'soil',
        alpha: 1,
      },
    ];
  }
  // 墙：抬升构件的固定边饰——上/左亮、下/右暗（作图约定，方向与太阳无关）。
  return [
    { x: rect.x + rect.w - 1, y: rect.y, w: 1, h: rect.h, token: 'timberDark', alpha: 1 },
  ];
}

/** 招牌图标：<>（代码）/ 书（研究）/ 笔（写作）/ 锤（空工坊）。只用现有色。 */
function drawSignIcon(g: Phaser.GameObjects.Graphics, building: PlacedBuilding, w: number): void {
  const tower = building.silhouette === 'tower';
  const x = tower ? 4 : Math.round(w / 2) - 9;
  const y = tower ? -18 : -22;
  // 吊架：从牌子底边一直连到屋顶，不再让招牌悬空。
  g.fillStyle(paletteFor().timberDark, 1);
  g.fillRect(x + 8, y + 14, 1, Math.max(4, 4 - (y + 14)));
  g.fillRect(x + 8, 3, 6, 1);
  g.fillStyle(paletteFor().ink, 0.55);
  g.fillRect(x, y, 18, 14);
  g.fillStyle(building.palette.trim, 1);
  g.fillRect(x + 1, y + 1, 16, 1);
  g.fillRect(x + 1, y + 12, 16, 1);
  g.fillRect(x + 1, y + 1, 1, 12);
  g.fillRect(x + 16, y + 1, 1, 12);
  g.fillStyle(paletteFor().amber, 0.95);
  const cx = x + 9;
  if (building.boundTask === 'code') {
    // 两个折角：< >
    for (let step = 0; step < 3; step += 1) {
      g.fillRect(cx - 4 - step, y + 5 + step, 1, 1);
      g.fillRect(cx - 1 - step, y + 5 + step, 1, 1);
      g.fillRect(cx + 2 - step, y + 5 + step, 1, 1);
    }
    for (let step = 0; step < 3; step += 1) {
      g.fillRect(cx - 4 + step, y + 9 - step, 1, 1);
      g.fillRect(cx - 1 + step, y + 9 - step, 1, 1);
      g.fillRect(cx + 2 + step, y + 9 - step, 1, 1);
    }
  } else if (building.boundTask === 'research') {
    // 一本书：外框 + 书脊
    g.fillRect(cx - 5, y + 4, 10, 1);
    g.fillRect(cx - 5, y + 10, 10, 1);
    g.fillRect(cx - 5, y + 4, 1, 7);
    g.fillRect(cx + 4, y + 4, 1, 7);
    g.fillRect(cx - 1, y + 4, 1, 7);
  } else if (building.boundTask === 'writing') {
    // 一支笔：斜杆 + 笔尖
    for (let step = 0; step < 6; step += 1) g.fillRect(cx - 4 + step, y + 10 - step, 1, 2);
    g.fillRect(cx + 2, y + 4, 2, 2);
  } else {
    // 空工坊：锤子
    g.fillRect(cx - 4, y + 4, 8, 3);
    g.fillRect(cx - 1, y + 6, 2, 6);
  }
}

/** 干活时窗户亮起、门口挂上脉动的进度条；冷却时灯仍亮一小会儿。 */
export function updateBuilding(
  scene: Phaser.Scene,
  view: BuildingView,
  building: PlacedBuilding,
  workstation: WorkstationSnapshot | undefined,
  altitude: number,
): void {
  const activity = workstation?.activity ?? { kind: 'idle' as const };
  const working = activity.kind === 'operating';
  const cooling = activity.kind === 'cooling';
  const broken = activity.kind === 'overheating';
  const busy = working || broken;

  // 四层各自一个 depth（相对数值见 BUILDING_DEPTH）：
  //   back < body < decal(+16) < 站门口的角色(+24) < front(+32) < 门口下 1 格的人(+40)
  // 于是只有「站在门口」这一格会被檐压住，再往外走一格就恢复正常。
  view.back.setDepth(layerDepth('back', view.baseY, altitude));
  view.container.setDepth(layerDepth('body', view.baseY, altitude));
  view.decal.setDepth(layerDepth('decal', view.baseY, altitude));
  view.front.setDepth(layerDepth('front', view.baseY, altitude));
  view.sign.setAlpha(busy ? 1 : 0.72);
  view.chimney.setAlpha(busy ? 1 : 0);

  view.progress.clear();
  view.progress.setVisible(working || cooling || broken);
  const width = building.footprint.w * TILE_PX - 8;
  if (working) {
    const filled = Math.round((width - 2) * (workstation?.progress ?? 0));
    view.progress.fillStyle(paletteFor().ink, 0.8);
    view.progress.fillRect(4, -8, width, 3);
    view.progress.fillStyle(paletteFor().amber, 0.9);
    view.progress.fillRect(5, -7, Math.max(1, filled), 1);
    // 进度线在走之外再加一层脉动，远处也能看出这台机器还活着。
    view.progress.fillStyle(paletteFor().amber, 0.35 + 0.35 * Math.sin(scene.time.now / 240));
    view.progress.fillRect(5, -7, Math.max(1, filled), 1);
  } else if (cooling) {
    view.progress.fillStyle(paletteFor().amber, 0.8);
    view.progress.fillRect(4, -8, width, 3);
  } else if (broken) {
    // 故障：整条线闪红，不表示进度，只表示"这台机器坏了"。
    view.progress.fillStyle(paletteFor().ember, 0.9);
    view.progress.fillRect(4, -8, width, 3);
    view.progress.fillStyle(paletteFor().amber, 0.5 + 0.5 * Math.sin(scene.time.now / 120));
    view.progress.fillRect(4, -8, width, 3);
  }
}
