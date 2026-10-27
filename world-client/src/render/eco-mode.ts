/** 省电模式：窗口不在前台时降频，视野外的东西不动画。
 *
 * 为什么必须做：这是个常驻桌面的窗口。用户切回 IDE 写代码时，如果它还跑满
 * 60fps、持续给屏幕外的工坊冒烟，笔记本会发烫、风扇会转——用户第一件事就是
 * 把它关掉。省电不是优化项，是能不能长期开着的前提。
 *
 * 纯函数部分放在这里，Phaser 相关接线在场景里。
 */

import type { GridPoint } from '../world/types.ts';

/** 前台帧率。像素动画不需要更高。 */
export const FOREGROUND_FPS = 60;
/** 后台帧率。像素动画本来就是低帧率风格，15 帧在余光里仍然流畅。 */
export const BACKGROUND_FPS = 12;

/** 视野边缘的余量（世界像素）：刚出界一点点的对象不该立刻停动画。 */
const VIEW_MARGIN = 32;

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 该跑多少帧。 */
export function targetFpsFor(focused: boolean): number {
  return focused ? FOREGROUND_FPS : BACKGROUND_FPS;
}

/**
 * 这个位置需不需要每帧动画。
 *
 * 只对**纯视觉**的东西用（烟雾、落叶、气泡）：它们的逻辑状态仍然每拍结算，
 * 只是看不见时不必绘制。世界逻辑本身永远不跳帧。
 */
export function shouldAnimateAt(point: GridPoint, view: ViewRect): boolean {
  return (
    point.x >= view.x - VIEW_MARGIN &&
    point.y >= view.y - VIEW_MARGIN &&
    point.x <= view.x + view.width + VIEW_MARGIN &&
    point.y <= view.y + view.height + VIEW_MARGIN
  );
}

/**
 * 这一帧推进世界吗（后台降频的闸门）。
 *
 * `lastAdvanceAt` 是上一次**推进过**的时刻，`0` 表示一次都还没推进。
 * 调用方的契约：放过时把它改成 `now`，跳过时原样留着。
 *
 * **一次都没推进过时必须放过。** 少了这一句，`lastAdvanceAt` 永远是 0，
 * 于是每一帧都落在「没有基准」那条路上——而那里能拿来当「已经过去的时间」
 * 的只有本帧 delta，60fps 下是 16.7ms，后台档要 83.3ms，永远判不过。
 * 调用方又只在放过时才记时间戳，基准因此永远立不起来：世界一步不走。
 *
 * 这不是假想的。失焦的无头面板里实测：Phaser 以 59.6fps 调 `update()`
 * （`updateCount` 14617），`advanceCount` 是 0。窗口失焦但仍在合成的两种情况
 * ——双屏里盯着另一块、页面刚加载完还没点回来——都会走进来。
 *
 * 前台（`backgroundMode` 为 false）不拦：拦了就是掉帧。
 */
export function shouldAdvanceFrame(
  lastAdvanceAt: number,
  now: number,
  backgroundMode: boolean,
  minFrameIntervalMs: number,
): boolean {
  if (!backgroundMode) return true;
  if (lastAdvanceAt === 0) return true;
  return now - lastAdvanceAt >= minFrameIntervalMs;
}
