/** 环境光斑：远近景不同密度的阶梯光点。
 *
 * 为什么不是「再给每个窗/灯加一层光晕」：现有的 `phase-view` 光晕是**光源**，
 * 跟着窗、灯、祭坛走；这一层是**空气里的光**——没有具体光源，靠远近密度差
 * 把画面分出前后。远段（画面顶部）稀疏、小、淡；近段（画面底部）密、大、亮。
 *
 * 一切由「世界格坐标 + 时间档」哈希出来，不是逐帧随机：同一格、同一档永远
 * 同一串光点，截图可复现，镜头平移时也不会闪。
 *
 * 几何与颜色**分开**：本文件只产出矩形与 alpha（纯函数，Node 可测），
 * 绘制在 `light-pools-view.ts`。颜色只取 24 源色里的 `warmLight` / `amber`。
 */

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LightSpot {
  /** 光点中心（世界像素）。 */
  readonly x: number;
  readonly y: number;
  /** 光点核心尺寸（像素）。 */
  readonly size: number;
  /** 0..1；近景更亮。 */
  readonly alpha: number;
}

/** 画面纵向 6 段：0 最远（顶部）→ 5 最近（底部）。 */
export const LIGHT_BANDS = 6;

/** 各段的命中密度（0 = 没有光点，1 = 每格都有）。 */
export const LIGHT_DENSITY: readonly number[] = [0.035, 0.05, 0.08, 0.12, 0.17, 0.22];

/** 各段光点核心尺寸（像素）。远小近大。 */
export const LIGHT_SIZE: readonly number[] = [1, 2, 2, 3, 4, 5];

/** 一屏最多画多少枚：再密就变噪点，也白烧指令。 */
export const LIGHT_MAX = 48;

/** 32 位整数混合（与 `tilemap` 的确定性扰动同一路数，避免浮点哈希跨机漂移）。 */
function hash2(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * 一屏的光斑。`glow` 是时相层的暖光强度（0 正午 … 1 夜 / 1.2 黄昏）。
 *
 * 光斑在正午也有（阳光的浮尘/光叶），所以底数是 0.35，不做到 0。
 */
export function lightSpots(view: ViewRect, glow: number, nowMs: number): readonly LightSpot[] {
  const cell = 16;
  const x0 = Math.floor(view.x / cell);
  const x1 = Math.ceil((view.x + view.w) / cell);
  const y0 = Math.floor(view.y / cell);
  const y1 = Math.ceil((view.y + view.h) / cell);
  const height = Math.max(1, y1 - y0);
  const level = 0.35 + 0.65 * Math.max(0, glow);
  const twinkleBucket = Math.floor(nowMs / 600);
  const out: LightSpot[] = [];

  for (let gy = y0; gy < y1; gy += 1) {
    // 画面纵向归一：0 顶部（远），1 底部（近）。
    const depth = (gy - y0) / height;
    const band = Math.min(LIGHT_BANDS - 1, Math.floor(depth * LIGHT_BANDS));
    for (let gx = x0; gx < x1; gx += 1) {
      const roll = hash2(gx, gy, band);
      if (roll >= LIGHT_DENSITY[band]!) continue;
      const jx = hash2(gx, gy, 11);
      const jy = hash2(gx, gy, 23);
      const twinkle = hash2(gx, gy, twinkleBucket + 97);
      // 每格最多落一枚；偏移 0..11px，避免排成整齐的格点。
      const x = gx * cell + Math.round(jx * 12);
      const y = gy * cell + Math.round(jy * 12);
      const size = LIGHT_SIZE[band]!;
      // 近景 alpha 上限约 0.22：再亮就压过像素细节。
      const alpha = level * (0.07 + 0.15 * depth) * (0.7 + 0.3 * twinkle);
      out.push({ x, y, size, alpha });
    }
  }

  // 近的先画（后画的压在上面也没关系，ADD 是可交换的；排序只为可复现的截断）。
  out.sort((a, b) => b.y - a.y || a.x - b.x);
  return out.slice(0, LIGHT_MAX);
}
