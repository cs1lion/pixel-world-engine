/** 门洞的绘制尺寸与锚点：纯算术，不碰 Phaser，可在 Node 里验算。
 *
 * **门只是贴图，不是碰撞格。** 占地、可走性、`checkPlacement` 的 `doorBlocked`
 * 与 `doorReaches` 读的都是 `building.door` 那个格坐标，与这里的宽高无关。
 * 改这张图里的数字，改的是「画多大」，不是「能不能走」。
 *
 * 尺寸依据（角色 24×30，格径仍 16）：
 *   - 高度按角色可见高度的 90% 反推：30 × 0.9 = 27；
 *   - 宽度按角色肩宽的 95% 反推：24 × 0.9 ≈ 22（比肩宽 15 宽，留出门框的余量）；
 *   - 与 48px 档的旧测算同一条比例：那边 96px 人要 61×86（≈0.9 / 0.95），
 *     这里只是把同一比例搬到 24×30 上。
 *   - 上界：最小的楼 3 格高（48px），门高 27 仍留 21px 墙；4 格（64px）留 37px。
 */

export interface DoorMetrics {
  /** 门洞宽（像素）。 */
  readonly w: number;
  /** 门洞高（像素）。 */
  readonly h: number;
  /** 门框外侧 1px 相对门洞中心的半宽。 */
  readonly frameHalf: number;
  /** 门外台阶宽。 */
  readonly stepW: number;
}

export const DOOR: DoorMetrics = { w: 22, h: 27, frameHalf: 11, stepW: 24 };

/** 旧门：14×18。只在样板阶段给一栋楼保留，批量之后应无引用。 */
export const LEGACY_DOOR: DoorMetrics = { w: 14, h: 18, frameHalf: 7, stepW: 16 };

/** 门洞矩形：底边与墙底对齐（墙覆盖 0..wallH-1），中心对齐 `doorX`。 */
export function doorRect(
  doorX: number,
  wallH: number,
  metrics: DoorMetrics = DOOR,
): { x: number; y: number; w: number; h: number } {
  return { x: doorX - Math.floor(metrics.w / 2), y: wallH - metrics.h, w: metrics.w, h: metrics.h };
}

/** 门洞底边 = 墙底；这条是「门底对齐占地边缘」的算术形式。 */
export function doorBottomAligned(doorX: number, wallH: number, metrics: DoorMetrics = DOOR): boolean {
  const rect = doorRect(doorX, wallH, metrics);
  return rect.y + rect.h === wallH;
}
