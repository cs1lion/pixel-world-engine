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
 * 的生死绑在合成上——帧不来的地方，神谕面板永远停在「世界正在醒来…」。
 *
 * `setTimeout` 与合成无关：后台页里它会被节流，但照样会来。所以这里用它。
 * `schedule` 可注入，只为测试能替掉时钟——见 `when-api.test.ts`。
 *
 * **可它换掉了沉默，没有消除沉默。** 场景自己也跑在 rAF 上（Phaser 的
 * `Game.step` 由 `TimeStep` 驱动），所以页面真的一帧都不合成时，场景压根
 * 不会 `create()`，`window.Oracle` 永远不会出现——`whenApi` 就永远等下去，
 * 屏上还是那句「世界正在醒来…」。那仍是一句没人来兑的承诺，只是换了个触发条件。
 *
 * 所以等是有尽头的：`giveUpAfter` 次尝试之后交付失败，由调用方说一句真话。
 * 一句「世界没有醒来」比一句永远在等的「正在醒来」诚实——后者假装事情在进行。
 */

/** 安排下一次尝试。默认 `setTimeout`，测试可换成可控的假时钟。 */
export type Schedule = (run: () => void, delayMs: number) => void;

/** 两次尝试之间的间隔。场景通常在几百毫秒内挂上，这个粒度够了。 */
const RETRY_MS = 50;

/**
 * 等多久就认输。
 *
 * 20 秒：一台上网的机器从打开页面到 Phaser 建好场景，慢也就几秒。压到 20 秒
 * 是为了让「真的不会来了」和「只是慢」拉开距离——认错太早，会把一台慢机器
 * 上的正常启动报成坏了。
 */
export const GIVE_UP_AFTER = 400;

export interface WhenApiOptions {
  readonly schedule?: Schedule;
  /** 等不到时调用。不说默认就是安静地放弃——调用方得自己决定说什么。 */
  readonly onGiveUp?: () => void;
}

export function whenApi<T>(
  getApi: () => T | undefined,
  ready: (api: T) => void,
  options: WhenApiOptions = {},
): void {
  const schedule = options.schedule ?? ((run, delayMs) => { setTimeout(run, delayMs); });
  let attempts = 0;
  const attempt = (): void => {
    const api = getApi();
    if (api === undefined) {
      attempts += 1;
      if (attempts >= GIVE_UP_AFTER) {
        // 不等了。屏上那句「正在醒来」留在这儿就是个谎，所以交给调用方换掉。
        options.onGiveUp?.();
        return;
      }
      schedule(attempt, RETRY_MS);
      return;
    }
    ready(api);
  };
  attempt();
}
