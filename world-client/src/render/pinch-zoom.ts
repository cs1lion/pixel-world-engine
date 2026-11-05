/** 两指捏合缩放：纯逻辑。不 import Phaser、不碰相机，可离线测。
 *
 * 这里只回答一个问题：「手指这一下张开 / 收拢，够不够跨一个档位」。
 * 档位本身仍归 `camera-math.ts` 的 `ZOOM_STEPS` / `stepZoomIndex`——不另造
 * 一套连续倍率，连续缩放会让 16px 图块的边落在半个像素上（见那个文件的理由）。
 *
 * 两个数决定手感：
 *   - `PINCH_MIN_BASE_PX`：两指挨得太近时先不起算。两指几乎并在一起落下去
 *     只是一次双指点击，不该顺手缩放；
 *   - `PINCH_STEP_RATIO`：张开到两倍才进一档、收拢到一半才退一档；**跨过就
 *     把基准重置成此刻的间距**，这就是迟滞——手指在阈值附近来回抖不会
 *     进进出出，想再跨一档必须再从当前间距翻一倍。
 */

/** 跨一档需要的间距比：张开两倍进一档，收拢一半退一档。 */
export const PINCH_STEP_RATIO = 2;

/** 两指起始间距小于这个数（世界像素）就不算捏合。 */
export const PINCH_MIN_BASE_PX = 24;

export interface PinchZoomState {
  /** 上一个基准间距；`null` = 两指还太近，等它们张开到阈值再起算。 */
  readonly baseDistance: number | null;
}

/** 两指落下时建立一次捏合会话。 */
export function beginPinchZoom(distance: number): PinchZoomState {
  return { baseDistance: distance >= PINCH_MIN_BASE_PX ? distance : null };
}

/**
 * 一次手指移动之后该不该跨档。
 *
 * 返回的 `state` 是下一拍的起点：跨档时基准换成当前间距，没跨档就原样带着走。
 * 一次移动最多跨一档，避免一帧之内的快速张开一次连跳两档。
 */
export function pinchZoomStep(
  state: PinchZoomState,
  distance: number,
): { readonly state: PinchZoomState; readonly direction: 1 | -1 | 0 } {
  if (state.baseDistance === null) {
    return distance >= PINCH_MIN_BASE_PX
      ? { state: { baseDistance: distance }, direction: 0 }
      : { state, direction: 0 };
  }
  // 两指重合时间距可能是 0：不能拿 0 当分母，否则 ratio 是 Infinity，一次误判就进一档。
  const base = Math.max(1, state.baseDistance);
  const ratio = distance / base;
  if (ratio >= PINCH_STEP_RATIO) {
    return { state: { baseDistance: distance }, direction: 1 };
  }
  if (ratio <= 1 / PINCH_STEP_RATIO) {
    return { state: { baseDistance: distance }, direction: -1 };
  }
  return { state, direction: 0 };
}
