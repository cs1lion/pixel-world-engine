/** 人物与摊位的**落地投影**：只读光照相位，表驱动整数像素。
 *
 * 与灯街、摊位、幌布、烟同一套口径：不读墙钟、不存上一帧，相位由 `snapshot.now`
 * 推出来的世界时钟给（`?time=` 强制相位时同样成立）。
 *
 * 为什么单独一层、单独一个 depth
 * ------------------------------
 * 落地投影既要在**地面之上**（铺装 1 / 街面 1 / 潮水 3），又要在**人物与摊位之下**
 * （人物 depth ≥ `altitude + footY + 8`，构件 ≥ `sceneryDepth`，都在 1000 以上）。
 * 唯一不打架的落点是 **3.1**：比潮水高，比街面光池（3.2）低——暖光池仍旧盖在影子上，
 * 光池读数不会被一条新影子改写；离人物/构件的 1000+ 差着三个数量级。
 * 这里不碰 `sceneryDepth` / `villagerDepthAt` 的公式，只新增一个独立常量。
 *
 * 影子只**朝一侧铺开**，宽度取整数像素；夜里 `span=0 / alpha=0` 不画——
 * 灯下本来就没有太阳投出来的那条影，也避免往夜街扫描带里塞暗像素。
 *
 * 方向与「太阳语义」的口径
 * ------------------------
 * 这里的 `dx` 是**相位影**：清晨朝右、正午只偏 1px、黄昏朝左。它只描述这一层，
 * 不要拿它去和建筑接地影 / 地形边共用一句「光从左上打」——那两层是**固定的作图约定**
 * （接触/结构影，方向不随相位变），两处注释已在 G1 一并改成各自的口径。
 */

export interface GroundShadowMotion {
  readonly on: boolean;
}

export const GROUND_SHADOW_MOTION_ON: GroundShadowMotion = { on: true };

export const GROUND_SHADOW_MOTION_OFF: GroundShadowMotion = { on: false };

/** 落地投影的渲染层 depth，见文件头的分层推导。 */
export const GROUND_SHADOW_DEPTH = 3.1;

export type GroundShadowPhase = 'dawn' | 'noon' | 'dusk' | 'night';

interface ShadowShape {
  /** 影子的横移（像素）：正值朝右，负值朝左。 */
  readonly dx: number;
  /** 影子的长度（像素）：0 表示不画。 */
  readonly span: number;
  /** 影子最外沿的透明度；`ink` 内芯再压一档。 */
  readonly alpha: number;
}

/** 正午短、黄昏长、夜里不做。长度是像素，取整数，不按帧插值。 */
const SHADOW: Readonly<Record<GroundShadowPhase, ShadowShape>> = {
  dawn: { dx: 3, span: 4, alpha: 0.20 },
  noon: { dx: 1, span: 1, alpha: 0.14 },
  dusk: { dx: -6, span: 7, alpha: 0.26 },
  night: { dx: 0, span: 0, alpha: 0 },
};

/** 影子的一阶阶梯：自左向右的整数像素段，`alpha` 逐段递减。 */
export interface ShadowSegment {
  readonly x: number;
  readonly width: number;
  readonly alpha: number;
}

/** 阶梯比例（内 → 外）。外梢 0.35 与幌布 6 行渐隐的最淡一档同量级。 */
const SHADOW_LADDER = [1, 0.65, 0.35] as const;

/**
 * 把一条影子切成 1–3 段阶梯（内深外淡），返回**自左向右**的像素段。
 *
 * - `x0` 是整条影子最左一像素，`span` 是整数像素长度；
 * - `dir` 是投影朝向（1 朝右、-1 朝左），决定**哪一端算内段**：
 *   `dir>0` 内段在左端（贴着物体），`dir<0` 内段在右端；
 * - 段数由长度定：≤2 单段、≤4 两段、更长三段。
 *
 * **锚定规则（一句话）**：内芯锚在**相位的根**——即贴物体那一端，不是固定左/右端；
 * 根在哪由 `dx` 的符号决定（晨/午 `dx≥0` 根在左，黄昏 `dx<0` 根在右）。
 *
 * 绘制端在**内段**再叠 1px `ink` 内芯，所以 α 层最多 = 3 阶 + 1 内芯 = 4；
 * 「α 层数 ≤ 4」由此处的结构钉住，不靠数像素亮度。
 */
export function shadowSegments(
  x0: number,
  span: number,
  alpha: number,
  dir: number,
): ShadowSegment[] {
  if (span <= 0 || alpha <= 0) return [];
  const ratios = span <= 2 ? [1] : span <= 4 ? [0.6, 0.4] : [0.4, 0.35, 0.25];
  let remaining = span;
  const widths = ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return remaining;
    const width = Math.max(1, Math.round(span * ratio));
    remaining -= width;
    return width;
  });
  const parts = widths.map((width, index) => ({
    width,
    alpha: alpha * SHADOW_LADDER[index],
  }));
  // 反转只改「哪端是内段」，段的形状与左→右坐标都不变。
  const ordered = dir >= 0 ? parts : [...parts].reverse();
  let cursor = x0;
  return ordered.map((part) => {
    const segment = { x: cursor, width: part.width, alpha: part.alpha };
    cursor += part.width;
    return segment;
  });
}

/** 某一相位的影子形状。证据脚本拿它核对「正午短 / 黄昏长 / 夜里不做」。 */
export function groundShadowAt(phase: GroundShadowPhase): ShadowShape {
  return SHADOW[phase];
}

/** 相位影长，给单测与证据脚本读；与绘制共用同一张表。 */
export function groundShadowSpan(phase: GroundShadowPhase): number {
  return SHADOW[phase].span;
}
