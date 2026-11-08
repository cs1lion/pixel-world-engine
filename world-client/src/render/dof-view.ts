import Phaser from 'phaser';
import { boxBlurRGBA, countNonOpaque, focusWindow } from './dof-blur.ts';

/**
 * P2 纯烘焙移轴：把静态层烘成**一张**糊图，运行期只做行裁切窗。
 *
 * 为什么不用运行时 pass：任何滤镜 / stack 都会差 1 LSB，进不了「`?dof=off` 像素
 * 一格不动」的闸。这里的一切都在 CPU 上做整数平均，产物是确定的。
 *
 * 生命周期（见 §13.5）：
 * - 首次在 `create` 末尾烘一次；
 * - 之后只在版本向量 `(terrainVersion, structuresVersion)` 变化时重建；
 * - 双缓冲 `world-blur-a/b`，先写非当前图、再 `setTexture`，**永不** `textures.remove`
 *   （同 key 重建会停在上一版，正是 `bake.ts` 当初踩过的坑）；
 * - 人物 / 潮位 / 雾 / 雨不进闭包：它们由更低的 depth 或更高的 depth 决定，
 *   不从这张产物里来，也就不可能被糊到。
 */

const KEY_A = 'world-blur-a';
const KEY_B = 'world-blur-b';

export interface DofViewOptions {
  /** 世界像素宽高。 */
  readonly width: number;
  readonly height: number;
  /** 静态层的地形贴图 key —— S-0 断言就钉在它身上。 */
  readonly terrainKey: string;
  /** drawable depth：地形之上、痕迹与潮水之下。 */
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
  let version: [number, number] | null = null;

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
      `[dof] build#${builds} compose=${composeMs.toFixed(1)}ms blur=${blurMs.toFixed(1)}ms ` +
        `tex=${(width * height * 4 / 1048576).toFixed(2)}MiB/time`,
    );
  }

  bake();

  return {
    setVersion(terrainVersion, structuresVersion): void {
      // 首帧只登记基线：create 末尾已经烘过当前内容，不重复烘一次。
      if (version === null) {
        version = [terrainVersion, structuresVersion];
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
    }),
    destroy(): void {
      image.destroy();
      for (const texture of textures) scene.textures.remove(texture.key);
    },
  };
}
