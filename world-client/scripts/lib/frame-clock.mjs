/**
 * 帧时钟：把「渲染帧」变成可钉住、可复现、可断言的量。
 *
 * 为什么需要这一层
 * ----------------
 * 世界冻住不等于画面冻住。`canvas` 里有一处按**渲染帧**推进、不随世界钟推进的
 * 微动（OPEN_ISSUES E12）：同一世界时刻下，画面按帧号分成若干量化平台。于是
 * 「同一时刻 → 同一像素」这条判据，只有在两页**帧号相等**时才成立；各页自己
 * 「等到连续 N 帧相同」再比，比较对象根本没有同相（实测 135 vs 179）。
 *
 * 这个模块给像素闸门三件事，且只给这三件事：
 * 1. `frameClockInitScript`：页面加载前装的帧时钟（`performance.now` 与 rAF
 *    时间戳同源成 `frame × frameMs`）；
 * 2. `freezeFrameClock` / `stepFrames` / `pinClock`：冻结真实 rAF，按**正常 dt**
 *    逐帧步进到调用方指定的帧号；
 * 3. `premiseFailure` / `assertSameFrames`：前提不成立就打印、置非 0、中止。
 *
 * 参数一律由调用方给：钉到第几帧（`targetFrame`）、之后沉降多少帧
 * （`settleFrames`）、要求连续几帧相同（`requireIdenticalFrames`，在 shot-stable）、
 * 确定性取几个采样点——本模块里**没有** 1000 / 90 / 8 / 13 这类数字。写死在本
 * 模块里就等于把某一次运行的机位当成了判据语义。
 *
 * 覆盖是「加载前」装的（要回答的第一个问题）
 * ------------------------------------------
 * `frameClockInitScript` 通过 `page.addInitScript` 注入，执行时机是**页面脚本
 * 之前**，不是页面就绪之后。因此整页生命周期里 `performance.now()` 都是这条
 * 帧量化时钟，不是只从 `pinClock` 开始。
 * - **它不会把加载期冻住**：冻结前真实 rAF 照常跑，`frame` 每帧 +1，
 *   `performance.now()` 也照常前进（每真实帧前进 `frameMs`）。
 * - 差别有两条，且都只在这条脚本生效时成立：(a) 首帧之前恒为 0——任何在
 *   boot 阶段读 `performance.now()` 取绝对时间的代码会看到 0；(b) 去掉了
 *   亚帧抖动，同一帧内多次读取恒等。
 * - 不受影响：`setTimeout` / `Date.now()` 走的是真实墙钟，加载期的超时与
 *   竞态不会被这条覆盖掩盖。若哪天某个闸门依赖「亚帧级」时间差，那是这条
 *   覆盖的已知边界，要在那个闸门里单独说明，而不是回来放宽这里。
 *
 * `smoothStep` 的残留（要回答的第二个问题）
 * ----------------------------------------
 * 渲染循环吃的是 rAF 时间戳的**差值**（Phaser `TimeStep.step` 里
 * `delta = Math.max(0, time - lastTime)`），并且默认开 `smoothStep`：把最近
 * `deltaSmoothingMax = 10` 帧的 delta 取平均。所以：
 * - **`pinClock` 之前，这份历史里装的是真实时钟的 delta**（含加载期抖动）。
 *   它是残留，但不是隐患：`pinClock` 之后还要再步进 `targetFrame - frozenAt +
 *   settleFrames` 帧，实测 `frozenAt` 在 135–180、`targetFrame + settleFrames`
 *   ≥ 1000，即至少 800 帧远大于 10 帧的窗口，历史被 `frameMs` 完全覆盖之后
 *   才轮到第一次比较。残留能影响的只有 pin 之后的前 ~10 帧，而那时还没有
 *   任何一次抓拍。
 * - **注入值必须是真实播放的稳态**：60fps 下每帧均值就是 `1000 / 60` ms。
 *   只钉帧号而不注入 dt，会让 `time - lastTime ≈ 0`，测到的是「几乎不推进的
 *   循环」，那是另一个东西。`TimeStep` 还有一条兜底：`delta > 1000 / minFps`
 *  （默认 5fps → 200ms）时退回历史值；`frameMs` 远低于它，不会触发。
 *
 * 退化边界
 * --------
 * 帧源是渲染循环自己在每帧末尾排队的 rAF 回调。若某个闸门在冻结后没有人再
 * 排队（帧源断了），`stepFrames` 步不满就按前提不成立处理——不静默少走几帧，
 * 也不拿「等一会儿」冒充步进。
 */

/** 前提不成立：打印一行、置非 0 退出码、中止——不降级、不重试换绿。 */
export function premiseFailure(label, reason) {
  const line = `[判据前提不成立] ${label}：${reason}`;
  console.log(line);
  process.exitCode = 1;
  throw new Error(line);
}

/**
 * 页面加载前注入的帧时钟。`page.addInitScript(frameClockInitScript, { freezeAt, frameMs })`。
 *
 * - `frameMs`：每帧注入的固定 dt（ms）。调用方给 `1000 / 60` 才是 60fps 稳态。
 * - `freezeAt`：大于 0 时真实 rAF 走到这一帧就自行冻住（本仓库的闸门都用 0，
 *   由 `freezeFrameClock` 显式冻结，避免「什么时候冻的」取决于机器快慢）。
 * @param {{ freezeAt: number, frameMs: number }} options
 */
export function frameClockInitScript({ freezeAt, frameMs }) {
  try {
    localStorage.clear();
  } catch {
    /* 忽略 */
  }
  let rng = 20261019;
  Math.random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const state = { frame: 0, frozen: false, queued: null };
  window.__CAPTURE_STATE__ = state;
  const realRaf = window.requestAnimationFrame.bind(window);
  // 帧时钟：`performance.now()` 与喂给渲染循环的时间戳都取 `frame × frameMs`。
  // 渲染循环（Phaser TimeStep）吃的是 rAF 回调的**时间戳参数**，不是
  // `performance.now()`；这里两者同源，所以「帧号相同」= 「dt 序列相同」=
  // 「真实播放的稳态」。
  performance.now = () => state.frame * frameMs;
  window.requestAnimationFrame = (cb) => {
    state.queued = cb;
    if (state.frozen) return 0;
    return realRaf(() => {
      // 冻结发生在排队期间：这一帧作废，回调留在 `queued` 里等手动步进。
      if (state.frozen) return;
      state.frame += 1;
      if (freezeAt > 0 && state.frame >= freezeAt) {
        state.frozen = true;
        cb(state.frame * frameMs);
        return;
      }
      cb(state.frame * frameMs);
    });
  };
  /** 冻住真实 rAF，返回冻住那一刻的帧号（之后只能 `__stepFrames` 前进）。 */
  window.__pinFrame = () => {
    state.frozen = true;
    return state.frame;
  };
  /** 手动步进 n 帧，每帧照常注入 `frameMs`；返回步进后的帧号与实际步数。 */
  window.__stepFrames = (n) => {
    let stepped = 0;
    for (let k = 0; k < n; k += 1) {
      const cb = state.queued;
      if (typeof cb !== 'function') break;
      state.queued = null;
      state.frame += 1;
      cb(state.frame * frameMs);
      stepped += 1;
    }
    return { frame: state.frame, stepped };
  };
}

/** 当前帧号。 */
export async function readFrame(page) {
  return page.evaluate(() => window.__CAPTURE_STATE__.frame);
}

/** 等真实 rAF 再走 `count` 帧（冻结前用；冻结后帧号不动，别用它）。 */
export async function waitForFrames(page, count) {
  const from = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  await page.waitForFunction(
    ({ from, count }) => window.__CAPTURE_STATE__.frame >= from + count,
    { from, count },
    { timeout: 20000 },
  );
}

/** 冻住真实 rAF，返回冻住那一刻的帧号。 */
export async function freezeFrameClock(page) {
  return page.evaluate(() => window.__pinFrame());
}

/** 手动推进 `count` 帧；步不满就是帧源断了，按前提不成立处理。 */
export async function stepFrames(page, count, label = 'stepFrames') {
  const result = await page.evaluate((n) => window.__stepFrames(n), count);
  if (result.stepped !== count) {
    premiseFailure(label, `只步进了 ${result.stepped}/${count} 帧（帧源断了，没有排队的 rAF 回调）`);
  }
  return result.frame;
}

/**
 * 冻住真实 rAF，从当前帧一路**正常 dt 步进**到 `targetFrame + settleFrames`。
 * 不用「把帧号一把拨过去」：那会给渲染循环一个几百秒的 delta，测的是另一个东西。
 *
 * 帧号已经超过 `targetFrame` 时拨不回去（时钟只进不退），判前提不成立。
 * @param {import('@playwright/test').Page} page
 * @param {{ targetFrame: number, settleFrames: number, label: string }} options
 */
export async function pinClock(page, { targetFrame, settleFrames, label }) {
  if (!Number.isInteger(targetFrame) || targetFrame < 1) {
    throw new Error(`pinClock 需要正整数 targetFrame，收到 ${String(targetFrame)}`);
  }
  if (!Number.isInteger(settleFrames) || settleFrames < 0) {
    throw new Error(`pinClock 需要非负整数 settleFrames，收到 ${String(settleFrames)}`);
  }
  const frozenAt = await freezeFrameClock(page);
  if (frozenAt > targetFrame) {
    premiseFailure(`${label}-pin`, `冻住时帧号 ${frozenAt} 已超过 targetFrame=${targetFrame}，拨不回同一相位`);
  }
  const target = targetFrame + settleFrames;
  const frame = await stepFrames(page, target - frozenAt, `${label}-settle`);
  if (frame !== target) {
    premiseFailure(`${label}-pin`, `步进后帧号 ${frame}，期望 ${target}`);
  }
  return frame;
}

/**
 * 逐项断言两组采样点的帧号相等：**比较之前**先证同相，不等就是前提不成立，
 * 后面比出来的不等不能算判据红。
 */
export function assertSameFrames(left, right, { label = 'frames' } = {}) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (left[index] !== right[index]) {
      premiseFailure(
        `${label}-${index}`,
        `两页帧号不等（a=${String(left[index])}，b=${String(right[index])}）——比较对象没有同相`,
      );
    }
  }
  console.log(`[相位] 两遍帧号一致：${left[0]}…${left[left.length - 1]}（${count} 个采样点）`);
}
