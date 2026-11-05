/**
 * 渲染预算里「切到后台真的降频」这一条的判据（纯函数，无浏览器依赖）。
 *
 * 2026-11-05 之前只有比例条件：`back <= front / 3`。
 * 这条在慢 runner 上会假红——前台只有 19 帧时，要求后台降到 6.3 帧以下，
 * 而省电模式的下限本来就在 10 帧附近（10 帧已经是明显的降载）。
 *
 * 现在的规则是**双条件**：
 *   1. `back < front`：后台必须比前台慢（这条不许退让）；
 *   2. `back <= front / 3` **或** `back <= 12`：要么按比例降，要么已降到 12 帧的地板以下。
 *
 * 12 帧是**地板**，不是按实测比例倒推的数：低于它已经不需要再证明「降频」。
 * 注意这条只放宽了 12 帧这个地板，**没有放宽比例条件**：前台 60 帧时，
 * 后台 21 帧仍然红（21 > 60/3 = 20 且 21 > 12）。
 */

/** 后台帧率相对前台的除法分母（比例条件）。 */
export const MIN_BACKGROUND_DIVISOR = 3;
/** 后台帧率的绝对地板（帧/秒）：降到这个数以下即算降频。 */
export const BACKGROUND_FLOOR_FPS = 12;

/** 后台降频判定：必须比前台慢，且（降到前台 1/3 以下，或已低于绝对地板）。 */
export function backgroundThrottleOk(front: number, back: number): boolean {
  if (!Number.isFinite(front) || !Number.isFinite(back)) return false;
  if (!(back < front)) return false;
  return back <= front / MIN_BACKGROUND_DIVISOR || back <= BACKGROUND_FLOOR_FPS;
}
