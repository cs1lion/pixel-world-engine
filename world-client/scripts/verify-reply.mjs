#!/usr/bin/env node
/**
 * 一次性的活体验证：回执那一条链路，在真的浏览器里走一遍。
 *
 * 验的是两笔，都只有这一步能看见：
 *   - `00e46bf`：场景挂上与界面订阅之间那段时间里产生的结果，从前整条丢掉。
 *   - `c25f4f1`：上游轮询每 4 秒回一句「上游已同步」，把用户那句话的回执擦掉。
 * 单测里没人断言过那句话，所以它一直绿灯；是这一跑先把屏上那一行打出来，
 * 才看见「雨落下来了。」从来没在用户眼前出现过。
 *
 * 这个洞在 preview 面板里复现不出来——那儿的页面不合成，rAF 一次都不触发，
 * 于是连场景都不会 `create()`（世界时间停在 0，见 `scripts/smoke-ego.mjs`
 * 开头记着的同一件事）。所以要一个能合成的浏览器，并且按那个脚本的办法用
 * MessageChannel 把 rAF 门控回 60fps。
 *
 * 三步，每步都是一句用户看得见的话：
 *   1. 说一句会改世界的话 → 回执那一行出现那句话，且不被轮询擦掉。
 *   2. 上游连着来 20 个空结果 → 回执那一行**不被擦**，也不换成心跳。
 *   3. 认输那一句：另开一个把 `window.Oracle` 藏起来的页面，等满 45 秒，
 *      看「世界正在醒来…」有没有被换成一句真话。
 *
 * 每一步各起一个浏览器：多个页面挤在一个浏览器里时，Chromium 会把不是当前
 * 标签的那几个的定时器节流到 1 秒一拍，`whenApi` 的 400 次尝试就排到几百秒
 * 之后——实测第三步因此在 45 秒超时，而那句话本来第 24 秒就到了。分开起
 * 不是为了好看，是为了让等待测的是代码，不是浏览器怎么调度后台标签。
 *
 * 用法：node scripts/verify-reply.mjs   （前置：dev server 在跑）
 */

import { chromium } from '@playwright/test';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5199/';

/** 与 `smoke-ego.mjs` 同一套：MessageChannel 门控到 60fps。测试专用，不进产物。 */
const RAF_PATCH = `(() => {
  const realNow = performance.now.bind(performance);
  const channel = new MessageChannel();
  const cbs = [];
  let scheduled = false;
  let last = -1e9;
  const FRAME = 1000 / 60;
  const pump = () => {
    const t = realNow();
    if (t - last < FRAME) { channel.port2.postMessage(0); return; }
    last = t;
    scheduled = false;
    const batch = cbs.splice(0, cbs.length);
    for (const cb of batch) { try { cb(t); } catch (e) {} }
  };
  channel.port1.onmessage = () => { pump(); };
  window.requestAnimationFrame = (cb) => { cbs.push(cb); if (!scheduled) { scheduled = true; channel.port2.postMessage(0); } return cbs.length; };
  window.cancelAnimationFrame = () => {};
  window.__rafPatched = '60fps';
})();`;

const problems = [];

/**
 * 三段 DOM 读法，写成源码字符串。
 *
 * 不写成 JS 函数再传给 `page.evaluate`：Playwright 的参数要能序列化，函数过不去
 * （实测 `Attempting to serialize unexpected value`）。字符串表达式它照收。
 */
const REPLY_SRC = `(document.querySelector('#reply')?.textContent ?? '').trim()`;
const HUD_SRC = `(document.querySelector('#hud-load')?.textContent ?? '').trim()`;
const STATUS_SRC = `(document.querySelector('#status')?.textContent ?? '').trim()`;

/** 起一个只有一页的浏览器，跑完就关。`raf` 决定装不装 rAF 替身。 */
async function withPage(run, { raf = true } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (raf) await page.addInitScript(RAF_PATCH);
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch { /* 隐私模式等场景忽略 */ }
    });
    await page.goto(BASE, { waitUntil: 'load' });
    return await run(page, errors);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- 一、正常回执
await withPage(async (page) => {
  await page.waitForFunction(() => window.__rafPatched === '60fps', null, { timeout: 10000 });

  // 等世界真的在走：时间在涨，才谈得上回执。
  await page.waitForFunction(
    () => {
      const before = window.Oracle?.view().now ?? 0;
      return new Promise((resolve) => {
        setTimeout(() => resolve((window.Oracle?.view().now ?? 0) > before), 400);
      });
    },
    null,
    { timeout: 20000 },
  );

  // 点提交按钮，不在输入框上按回车：`smoke-ego.mjs` 用的就是这一手，而按回车
  // 靠的是浏览器的隐式提交——实测偶发不触发（输入框清了、命令没进队列），
  // 那种失败读起来像世界的毛病，其实是脚本的。
  await page.fill('#utterance', '下雨了');
  await page.click('button[type="submit"]');
  // 等回执那一行出现那句话，而不是死等一个固定秒数。
  await page
    .waitForFunction(() => (document.querySelector('#reply')?.textContent ?? '').includes('雨'), null, {
      timeout: 8000,
      polling: 200,
    })
    .catch(() => { /* 下面自己判，超时也把现场打出来 */ });

  const after = await page.evaluate(`({
    reply: ${REPLY_SRC},
    bad: document.querySelector('#reply')?.classList.contains('bad') ?? false,
    status: ${STATUS_SRC},
    input: document.querySelector('#utterance')?.value ?? '',
    weather: window.Oracle.view().weather,
    now: window.Oracle.view().now,
  })`);

  console.log(`[1] 回执：${JSON.stringify(after.reply)}`);
  console.log(`    天气：${JSON.stringify(after.weather)}  世界时间：${after.now}`);
  console.log(`    输入框：${JSON.stringify(after.input)}（该被清掉）`);
  console.log(`    状态行：${after.status}`);
  if (after.reply === '') problems.push('1：说了「下雨了」，回执那一行是空的');
  if (after.reply.includes('上游已同步')) {
    problems.push(`1：回执那一行是轮询的心跳，不是用户那句话：${after.reply}`);
  }
  if (after.input !== '') problems.push('1：认出了的话该把输入框清掉');
  if (after.weather !== 'rain') problems.push(`1：天气没变：${after.weather}`);

  // ------------------------------------------------ 二、空结果不擦回执
  // 上游轮询每次都带一个结果过来。回执那一行必须还留着用户那句话，
  // 也不许被换成一句心跳。
  const kept = await page.evaluate(`(async () => {
    const api = window.Oracle;
    for (let i = 0; i < 20; i += 1) {
      api.feed({ type: 'task.assigned', taskId: 'spam_' + i, taskKind: 'quick', summary: '轮询' });
      await new Promise((r) => setTimeout(r, 30));
    }
    return ${REPLY_SRC};
  })()`);
  console.log(`[2] 二十次上游消息之后回执：${JSON.stringify(kept)}`);
  if (kept === '') problems.push('2：空结果把用户那句话的回执擦了');
  if (kept.includes('上游已同步')) problems.push(`2：心跳把回执擦了：${kept}`);
});

// ---------------------------------------------------------------- 三、等不到就认输
await withPage(async (page, errors) => {
  // 这一页**不装** rAF 替身：要的就是「一帧都不合成」那个真场景——场景不会
  // create()，`window.Oracle` 永远不出现。再把 Oracle 藏死，保证它不会因为
  // 别的路子（HMR、调试面板）被补上。
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Oracle', { get: () => undefined, configurable: true });
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const wake = await page.evaluate(`({ hud: ${HUD_SRC}, status: ${STATUS_SRC} })`);
  console.log(`[3] 认输前：顶栏「${wake.hud}」/ 状态行「${wake.status}」`);

  // 400 次 × RETRY_MS(50ms)，实测落在第 24 秒左右（定时器被压到 ~60ms 一拍）。
  // 宁多勿少。轮询用定时不用默认的 raf：这一页的 rAF 也是死的。
  await page.waitForFunction(
    `${HUD_SRC}.includes('没有醒来') || ${REPLY_SRC}.includes('没有醒来')`,
    null,
    { timeout: 45000, polling: 250 },
  );
  const gave = await page.evaluate(`({ hud: ${HUD_SRC}, reply: ${REPLY_SRC} })`);
  console.log(`[3] 认输后：顶栏「${gave.hud}」/ 回执「${gave.reply}」`);
  if (!gave.hud.includes('没有醒来') && !gave.reply.includes('没有醒来')) {
    problems.push('3：等了 45 秒，屏上还是那句「正在醒来」');
  }
  // 场景那次赋值是会抛的（getter 没有 setter），那是这一页故意的。
  // 记下来但不判失败——要判的是「屏上有没有一句真话」，不是「有没有异常」。
  if (errors.length > 0) console.log(`[3] 这一页预期之内的异常：${errors[0]}`);
});

console.log('');
if (problems.length === 0) {
  console.log('三步都过了。');
} else {
  console.log(`不过的 ${problems.length} 条：`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
