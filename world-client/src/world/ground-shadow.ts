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

/** 某一相位的影子形状。证据脚本拿它核对「正午短 / 黄昏长 / 夜里不做」。 */
export function groundShadowAt(phase: GroundShadowPhase): ShadowShape {
  return SHADOW[phase];
}

/** 相位影长，给单测与证据脚本读；与绘制共用同一张表。 */
export function groundShadowSpan(phase: GroundShadowPhase): number {
  return SHADOW[phase].span;
}
