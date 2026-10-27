/** 等场景把 `window.Oracle` 挂上，挂上了就交付。
 *
 * 为什么不用 `requestAnimationFrame`：它是「下一帧再试」，可这里等的其实是
 * Phaser 场景的 `create()`——另一个时钟，而且是个**会停**的时钟。页面不在
 * 合成中时（后台标签页、被遮住的窗口、无头浏览器里没聚焦的窗口），Chromium
 * 把 rAF 节流到近乎不触发；`scripts/smoke-ego.mjs` 记着实测「3 秒真实时间
 * 世界时间只走了 +0ms」，为此专门写了个 60fps 的 rAF 替身——那是为了让
 * Phaser 的世界循环跑起来，测试专用，不进产物。
 *
 * 可界面的绑定不需要帧：它只想知道「世界醒了没有」。用 rAF 等，就是把界面
 * 的生死绑在合成上——帧不来的地方，神谕面板永远停在「世界正在醒来…」：
 * 用户那句话世界照办（输入框确实清了），回执却一个字都不显示。那不是加载
 * 慢，是屏上的一句空话。
 *
 * `setTimeout` 与合成无关：后台页里它会被节流，但照样会来。所以这里用它。
 * `schedule` 可注入，只为测试能替掉时钟——见 `when-api.test.ts`。
 */

/** 安排下一次尝试。默认 `setTimeout`，测试可换成可控的假时钟。 */
export type Schedule = (run: () => void, delayMs: number) => void;

/** 两次尝试之间的间隔。场景通常在几百毫秒内挂上，这个粒度够了。 */
const RETRY_MS = 50;

export function whenApi<T>(getApi: () => T | undefined, ready: (api: T) => void, schedule: Schedule = (run, delayMs) => { setTimeout(run, delayMs); }): void {
  const attempt = (): void => {
    const api = getApi();
    if (api === undefined) {
      schedule(attempt, RETRY_MS);
      return;
    }
    ready(api);
  };
  attempt();
}
