/**
 * P2 纯烘焙移轴的**纯函数**部分：整数 box blur + 行裁切窗。
 *
 * 这里没有任何 Phaser 依赖，Node 测试可以直接跑。
 *
 * 模糊由「静态层原像素 + 整数平均」唯一确定：
 * - 可分离两趟（横 / 纵），横 pass 存 16 位原和，纵 pass 才做唯一一次除法；
 * - 边缘复制（clamp），否则四边会暗一圈；
 * - 核宽 k = 2r+1 恒为奇数，单次迭代；
 * - alpha 全程整数平均，输入 255 时输出必为 255。
 *
 * 注意：横 pass 存的是 k 个像素的**原和**，所以纵 pass 的除数是 k²（不是 k）。
 * 报告 §13.3 里写的 `(sum+r)/k` 是笔误——除以 k 会把亮度放大 k 倍。
 */
export function boxBlurRGBA(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (!Number.isInteger(width) || width <= 0) throw new Error(`boxBlurRGBA: 宽度非法 ${width}`);
  if (!Number.isInteger(height) || height <= 0) throw new Error(`boxBlurRGBA: 高度非法 ${height}`);
  if (!Number.isInteger(radius) || radius < 0) throw new Error(`boxBlurRGBA: 半径非法 ${radius}`);
  if (src.length !== width * height * 4) {
    throw new Error(`boxBlurRGBA: 数据长度 ${src.length} ≠ ${width}×${height}×4`);
  }

  const k = radius * 2 + 1;
  const denom = k * k;
  const round = Math.floor(denom / 2);
  const horizontal = new Uint32Array(src.length);
  const prefix = new Uint32Array(Math.max(width, height) + 1);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let c = 0; c < 4; c++) {
      prefix[0] = 0;
      let acc = 0;
      for (let x = 0; x < width; x++) {
        acc += src[(row + x) * 4 + c];
        prefix[x + 1] = acc;
      }
      for (let x = 0; x < width; x++) {
        const lo = x - radius < 0 ? 0 : x - radius;
        const hi = x + radius >= width ? width - 1 : x + radius;
        // 边缘复制：窗外缺的样本重复最边上一列，不能把窗口直接缩掉（那会暗一圈）。
        const padLeft = lo - (x - radius);
        const padRight = x + radius - hi;
        horizontal[(row + x) * 4 + c] =
          prefix[hi + 1] -
          prefix[lo] +
          padLeft * src[row * 4 + c] +
          padRight * src[(row + width - 1) * 4 + c];
      }
    }
  }

  const out = new Uint8ClampedArray(src.length);
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) {
      prefix[0] = 0;
      let acc = 0;
      for (let y = 0; y < height; y++) {
        acc += horizontal[(y * width + x) * 4 + c];
        prefix[y + 1] = acc;
      }
      for (let y = 0; y < height; y++) {
        const lo = y - radius < 0 ? 0 : y - radius;
        const hi = y + radius >= height ? height - 1 : y + radius;
        const padTop = lo - (y - radius);
        const padBottom = y + radius - hi;
        const sum =
          prefix[hi + 1] -
          prefix[lo] +
          padTop * horizontal[x * 4 + c] +
          padBottom * horizontal[((height - 1) * width + x) * 4 + c];
        // Uint8ClampedArray 的赋值会四舍五入，这里必须显式取整（只除这一次）。
        out[(y * width + x) * 4 + c] = Math.floor((sum + round) / denom);
      }
    }
  }
  return out;
}

/** 数一遍 alpha ≠ 255 的像素。糊图必须整张不透明，否则四边会透出底色。 */
export function countNonOpaque(src: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] !== 255) count += 1;
  }
  return count;
}

/** 行裁切窗。`worldTopY` 是相机视野上沿（`camera.worldView.y`），不是 scroll。 */
export interface FocusWindow {
  /** 焦线：这一行往下都清晰。 */
  readonly focusLineY: number;
  /** 糊图裁切窗的上沿（世界像素，含）。 */
  readonly cropY: number;
  /** 糊图裁切窗的高。焦线上一行是隔离行，不糊。 */
  readonly cropHeight: number;
}

/**
 * 只由相机纵向位置与倍率决定，不读时间 / 随机 / 雾浓度。
 *
 * 倍率表（480×320 画布）：1 倍 → 视野 480×320，焦点带 160；2 倍 → 视野 240×160，
 * 焦点带 80。其余倍率（1.5 / 3）P2 不支持，返回 null 让调用方整层隐藏。
 */
export function focusWindow(
  worldTopY: number,
  zoom: number,
  viewportHeight: number,
): FocusWindow | null {
  if (zoom !== 1 && zoom !== 2) return null;
  const focusHeight = viewportHeight / (2 * zoom);
  if (!Number.isInteger(focusHeight) || focusHeight < 2) return null;
  const top = Math.round(worldTopY);
  return {
    focusLineY: top + focusHeight,
    cropY: top,
    cropHeight: focusHeight - 1,
  };
}
