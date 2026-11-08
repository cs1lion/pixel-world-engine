import Phaser from 'phaser';
import { boxBlurRGBA, countNonOpaque, focusWindow } from './dof-blur.ts';

/**
 * P2 纯烘焙移轴：把**贴地带**的静态层烘成一张糊图，运行期只做行裁切窗。
 *
 * 为什么不用运行时 pass：任何滤镜 / stack 都会差 1 LSB，进不了「`?dof=off` 像素
 * 一格不动」的闸。这里的一切都在 CPU 上做整数平均，产物是确定的。
 *
 * 闭包里有什么：地形纹理 + 所有标了 `markDofStatic` 的**贴地**绘制入口
 * （铁轨/铺装/桥、渡口木栈与船、滩涂补绘……）。调 `generateTexture` 取的是各自
 * Graphics 的命令缓冲，不复制绘制代码。
 *
 * 为什么只到贴地带：糊图要盖在原件上才看得见，所以它的 depth 必须高于闭包里的
 * 所有层。depth 一旦过了 1000 就会盖住人物与建筑——而人物/建筑的 depth 是逐行
 * 交错的（`sceneryDepth` 按落地行，`villagerDepthAt` 也按落地行），一张平面图
 * 不可能同时"压在建筑上、垫在人物下"。所以闭包的上界钉在贴地带最上面一层
 * （`DOF_DEPTH` 与 1000 之间），立体构件留给 S-4。
 *
 * 生命周期（见 §13.5）：
 * - 首次 `setVersion`（场景全建完之后的第一帧）烘一次；
 * - 之后只在版本向量 `(terrainVersion, structuresVersion)` 变化时重建；
 * - 双缓冲 `world-blur-a/b`，先写非当前图、再 `setTexture`，**永不** `textures.remove`
 *   （同 key 重建会停在上一版，正是 `bake.ts` 当初踩过的坑）；
 * - 人物 / 潮位 / 雾 / 雨不进闭包：潮位是更低的 depth（3），不从这张产物里来，
 *   也就不可能被糊到。
 */

const KEY_A = 'world-blur-a';
const KEY_B = 'world-blur-b';

/** `scene.children.list` 的静态类型只有基类；这里补上收集/绘制真正要用的那几个混入。 */
type DofStaticObject = Phaser.GameObjects.GameObject & {
  depth: number;
  visible: boolean;
  alpha: number;
  x: number;
  y: number;
};

/** 静态绘制入口的标记键：`markDofStatic` 写它，烘图时按它收集。 */
export const DOF_STATIC_DATA = 'dofStatic';

/**
 * 声明「这是贴地静态层」：进糊图闭包。
 * 只给创建一次、之后不再逐帧重画的绘制入口用；它的 depth 必须低于 `DOF_DEPTH`。
 */
export function markDofStatic<T extends Phaser.GameObjects.GameObject>(object: T): T {
  object.setData(DOF_STATIC_DATA, true);
  return object;
}

export interface DofViewOptions {
  /** 世界像素宽高。 */
  readonly width: number;
  readonly height: number;
  /** 静态层的地形贴图 key —— S-0 断言就钉在它身上。 */
  readonly terrainKey: string;
  /** drawable depth：贴地带之上、人物与立体构件之下。 */
  readonly depth: number;
  /** box blur 半径（backing px），k = 2r+1。 */
  readonly blurRadius: number;
}

export interface DofStats {
  readonly builds: number;
  readonly composeMs: number;
  readonly blurMs: number;
  readonly textureBytes: number;
  readonly cropY: number;
  readonly cropHeight: number;
  readonly focusLineY: number;
  readonly visible: boolean;
  readonly version: readonly [number, number];
  /** 进闭包的静态绘制入口数（Graphics 按张计）。 */
  readonly sources: number;
}

export interface DofView {
  /** 版本变化才重建；由场景在帧首调用。 */
  setVersion(terrainVersion: number, structuresVersion: number): void;
  /** 行裁切窗只由相机纵向位置与倍率决定。 */
  update(worldTopY: number, zoom: number, viewportHeight: number): void;
  readonly stats: () => DofStats;
  destroy(): void;
}

/** S-0：糊图的唯一输入源必须能拿 2D context 读像素。失败就停，不靠人记住。 */
function assertReadableTerrain(scene: Phaser.Scene, key: string): HTMLCanvasElement {
  const source = scene.textures.get(key).getSourceImage();
  if (!(source instanceof HTMLCanvasElement)) {
    throw new Error(
      `P2/S-0 失败：${key} 的源不是 HTMLCanvasElement（${Object.prototype.toString.call(source)}）。` +
        'Phaser 升级后若把 generateTexture 换成 GPU readback，这条路径必须关掉，不许静默降级。',
    );
  }
  return source;
}

export function createDofView(scene: Phaser.Scene, options: DofViewOptions): DofView {
  const { width, height, terrainKey, depth, blurRadius } = options;
  const terrain = assertReadableTerrain(scene, terrainKey);

  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const raw = work.getContext('2d', { willReadFrequently: true });
  if (!raw) throw new Error('P2/S-0 失败：离屏 canvas 拿不到 2d context');
  const ctx: CanvasRenderingContext2D = raw;

  const textures: Phaser.Textures.CanvasTexture[] = [KEY_A, KEY_B].map((key) => {
    const texture = scene.textures.createCanvas(key, width, height);
    if (!texture) throw new Error(`P2: 建不出 ${key}`);
    return texture;
  });

  const image = scene.add.image(0, 0, KEY_A).setOrigin(0, 0).setDepth(depth).setScrollFactor(1);

  let active = 0;
  let builds = 0;
  let composeMs = 0;
  let blurMs = 0;
  let lastCropY = Number.NaN;
  let lastCropHeight = Number.NaN;
  let focusLineY = 0;
  let visible = true;
  let sources = 0;
  let version: [number, number] | null = null;

  function staticSources(): DofStaticObject[] {
    return (scene.children.list as DofStaticObject[])
      .filter((child) => child !== image && child.getData(DOF_STATIC_DATA) === true)
      .map((child, index) => ({ child, index }))
      // 稳定排序：depth 相同按显示列表顺序，和渲染器的口径一致。
      .sort((a, b) => a.child.depth - b.child.depth || a.index - b.index)
      .map((entry) => entry.child);
  }

  let scratch = 0;
  /** 把一个 Graphics 的当前命令缓冲画进合成画布；坐标口径由调用方给。 */
  function drawGraphics(source: Phaser.GameObjects.Graphics, dx: number, dy: number): void {
    const key = `dof-src-${scratch}`;
    scratch += 1;
    source.generateTexture(key, width, height);
    const canvas = scene.textures.get(key).getSourceImage();
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('P2/S-0 失败：generateTexture 的产物不是 HTMLCanvasElement');
    }
    ctx.drawImage(canvas, dx, dy);
    // 临时纹理只活到这一笔；双缓冲的 a/b 两张不在这里，永不删。
    scene.textures.remove(key);
  }

  function drawStatic(): number {
    let drawn = 0;
    for (const source of staticSources()) {
      if (!source.visible || source.alpha <= 0) continue;
      if (source instanceof Phaser.GameObjects.Graphics) {
        ctx.globalAlpha = source.alpha;
        drawGraphics(source, source.x, source.y);
        drawn += 1;
      } else if (source instanceof Phaser.GameObjects.Container) {
        for (const child of source.list) {
          if (!(child instanceof Phaser.GameObjects.Graphics)) continue;
          if (!child.visible || child.alpha <= 0) continue;
          ctx.globalAlpha = source.alpha * child.alpha;
          drawGraphics(child, source.x + child.x, source.y + child.y);
          drawn += 1;
        }
      } else if (source instanceof Phaser.GameObjects.Image) {
        const canvas = source.texture.getSourceImage();
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error(`P2/S-0 失败：${source.texture.key} 不是 HTMLCanvasElement`);
        }
        ctx.globalAlpha = source.alpha;
        ctx.drawImage(
          canvas,
          source.x - source.displayOriginX * source.scaleX,
          source.y - source.displayOriginY * source.scaleY,
          canvas.width * source.scaleX,
          canvas.height * source.scaleY,
        );
        drawn += 1;
      } else {
        // 静态层里出现别的对象类型说明标记用错了；宁可炸掉也不静默少一层。
        throw new Error(`P2: dofStatic 只接受 Graphics / Container / Image，收到 ${source.type}`);
      }
    }
    ctx.globalAlpha = 1;
    return drawn;
  }

  function bake(): void {
    // 墙钟用 Date.now()：截图闸门会把 performance.now() 换成帧量化时钟（frame-clock），
    // 拿它测烘焙耗时只会永远读到 0。
    const startedCompose = Date.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(terrain, 0, 0);
    sources = drawStatic();
    const frame = ctx.getImageData(0, 0, width, height);
    composeMs = Date.now() - startedCompose;

    const opaqueBreaks = countNonOpaque(frame.data);
    if (opaqueBreaks !== 0) {
      throw new Error(`P2/M-15 失败：静态层有 ${opaqueBreaks} 个像素 alpha ≠ 255，糊图会透底色`);
    }

    const startedBlur = Date.now();
    const blurred = boxBlurRGBA(frame.data, width, height, blurRadius);
    blurMs = Date.now() - startedBlur;

    active = (active + 1) % textures.length;
    const output = ctx.createImageData(width, height);
    output.data.set(blurred);
    textures[active].putData(output, 0, 0);
    textures[active].refresh();
    image.setTexture(active === 0 ? KEY_A : KEY_B);
    builds += 1;
    lastCropY = Number.NaN;
    lastCropHeight = Number.NaN;
    console.info(
      `[dof] build#${builds} sources=${sources} compose=${composeMs.toFixed(1)}ms ` +
        `blur=${blurMs.toFixed(1)}ms tex=${((width * height * 4) / 1048576).toFixed(2)}MiB/time`,
    );
  }

  return {
    setVersion(terrainVersion, structuresVersion): void {
      // 首次调用发生在场景全建完之后的第一帧：这时静态入口才齐。
      if (version === null) {
        version = [terrainVersion, structuresVersion];
        bake();
        return;
      }
      if (terrainVersion === version[0] && structuresVersion === version[1]) return;
      version = [terrainVersion, structuresVersion];
      bake();
    },
    update(worldTopY, zoom, viewportHeight): void {
      const window = focusWindow(worldTopY, zoom, viewportHeight);
      if (!window) {
        if (visible) {
          image.setVisible(false);
          visible = false;
        }
        return;
      }
      if (!visible) {
        image.setVisible(true);
        visible = true;
      }
      focusLineY = window.focusLineY;
      if (window.cropY === lastCropY && window.cropHeight === lastCropHeight) return;
      lastCropY = window.cropY;
      lastCropHeight = window.cropHeight;
      image.setCrop(0, window.cropY, width, window.cropHeight);
    },
    stats: () => ({
      builds,
      composeMs,
      blurMs,
      // 双缓冲：两张全图纹理常驻，谁也不算「临时」。
      textureBytes: width * height * 4 * textures.length,
      cropY: lastCropY,
      cropHeight: lastCropHeight,
      focusLineY,
      visible,
      version: version ?? [-1, -1],
      sources,
    }),
    destroy(): void {
      image.destroy();
      for (const texture of textures) scene.textures.remove(texture.key);
    },
  };
}
