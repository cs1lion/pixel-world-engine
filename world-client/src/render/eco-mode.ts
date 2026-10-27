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
/** 后台帧率。像素动画本来就是低帧率风格，12 帧在余光里仍然流畅。 */
export const BACKGROUND_FPS = 12;

/** 视野边缘的余量（世界像素）：刚出界一点点的对象不该立刻停动画。 */
const VIEW_MARGIN = 32;

/**
 * 一帧最多补进去多少毫秒的世界时间。
 *
 * 补齐是为了让世界按真实经过的时间走，而不是按帧数走——60fps 与 12fps 下
 * 村民都该在同一时刻走到同一格。但补齐得有上限：隐藏标签页被浏览器压到
 * 1fps 时一帧就是 1000ms，全补进去等于世界在玩家睡着的时候跑了一整天，
 * 回来时任务全交了、潮汐全落了，而玩家一秒都没看着。
 *
 * 所以超过这个数的部分**不补**：世界会实实在在地走慢，不拿一句「补齐了」
 * 骗人。由 `test/frame-pace.test.ts` 钉着。
 */
export const FRAME_CLAMP_MS = 250;

/** 一帧推进的结果。 */
export interface FramePace {
  /** 这一帧该跑几步。 */
  readonly steps: number;
  /** 跑完还剩多少毫秒，留给下一帧。 */
  readonly leftover: number;
}

/**
 * 真实过了 `elapsedMs`，这一帧推进几步、剩多少。
 *
 * 纯函数：只做加法、比较与减法，不碰 Phaser、不读墙钟。提出来的理由是这条
 * 算式原先长在 `SandboxScene.update()` 里，而场景引 Phaser，node 下连文件都
 * 加载不了——于是「补齐有 250ms 上限」与「一步最多跑几次」这两个数没有任何
 * 测试碰过，注释说它们是什么就是什么。放这儿就能离线钉。
 *
 * `carriedMs` 是上一帧剩下的，`stepMs` 是世界一步的长度，`maxSteps` 是帧预算。
 */
export function paceFrame(
  carriedMs: number,
  elapsedMs: number,
  stepMs: number,
  maxSteps: number,
): FramePace {
  // 负的间隔没有意义：Phaser 的 `time` 理论上只增，真出现回退时按 0 算，
  // 免得一个负的 leftover 把下一帧也拖成负的。
  const admitted = Math.min(Math.max(elapsedMs, 0), FRAME_CLAMP_MS);
  let pool = Math.max(0, carriedMs) + admitted;
  let steps = 0;
  while (pool >= stepMs && steps < maxSteps) {
    pool -= stepMs;
    steps += 1;
  }
  return { steps, leftover: pool };
}

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
 * 只对**纯视觉**的东西用（烟雾、落叶、气泡）：看不见时不必绘制它们，
 * 而它们的逻辑状态照旧每拍结算——这个函数跳的只是绘制。
 *
 * 别把上面那句读成「世界逻辑从不跳帧」。后台降频是另一道闸门
 * （`shouldAdvanceFrame`），它跳的是整帧，逻辑与渲染一起跳；而累加器补齐
 * 真实经过的时间时有 `FRAME_CLAMP_MS` 的上限（`paceFrame`），间隔超过它的
 * 场合世界会走慢。
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
 * **一次都没推进过时必须放过。** 少了这一句，开头上几十毫秒里 `now` 还不足
 * 一个间隔，第一帧会被跳过；调用方又只在放过时才记时间戳，于是它要等 `now`
 * 自己涨过一个间隔才动得起来（60fps 下约 5 帧）。世界不会就此永久冻住——
 * 把这一行删掉、光看这个函数，`now - 0` 大得离谱，照样放行——但会平白晚醒
 * 一会儿，这一句把那一段也省掉。
 *
 * 真正让世界**一步都不走**的是调用方原来的 `elapsed` 算式：
 * `lastAdvanceAt === 0 ? delta : time - lastAdvanceAt`。第一次推进时
 * `lastAdvanceAt` 是 0，能拿来当「已经过去的时间」的只有本帧 delta，
 * 60fps 下 16.7ms，后台档要 83.3ms，永远判不过；而调用方只在判过时记
 * 时间戳，基准因此永远立不起来。这不是假想的：失焦的无头面板里实测，
 * Phaser 以 59.6fps 调 `update()`（`updateCount` 14617），`advanceCount`
 * 是 0。窗口失焦但仍在合成的两种情况——双屏里盯着另一块、页面刚加载完
 * 还没点回来——都会走进来。
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
