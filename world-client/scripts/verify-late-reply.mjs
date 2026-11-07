#!/usr/bin/env node
/**
 * 一次性的活体验证：迟到的模型答复，不许把用户刚说那句话的回执盖掉。
 *
 * 验的是 `intent-async.test.ts` 里那三条的单测得不见的那一半——屏上那一行
 * 真的只有一行，而模型的答复要过网络。
 *
 * 复现过的毛病（修好之前，每次必现）：
 *   0ms    「这句话规则认不出，正在问模型……」   ← 第一句，送进模型
 *   100ms  「雨落下来了。」                      ← 第二句，规则认得出，当场办
 *   4800ms 「你只是在感叹天气……所以世界不动」     ← 第一句的答复迟到，落在同一行
 * 而屏上正在下雨。那不是盖掉一句话的事，是一句假话：回执说世界没动，世界动了。
 * 正是这个仓库最不容的那一件（「说谎比不去更糟」，`docs/SPEC.md`）。
 *
 * 修好之后，第三行不该出现：那一行归用户最新那句话，迟到的答复把世界改了
 * （潮照样拨、石板照样刻），话不往那一行上说。
 *
 * rAF 替身与 `scripts/smoke-ego.mjs` 同一套：无头 Chromium 里页面不合成时
 * rAF 一次都不触发，Phaser 场景不会 `create()`，世界时间停在 0。
 *
 * 用法：node scripts/verify-late-reply.mjs   （前置：dev server 在跑）
 */

import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5199/';

await assertTreeIdentity(BASE);

/**
 * 记下「答复落地」的时刻：包一层 `fetch`，只认 `/api/world/intent`。
 *
 * 为什么要在页面里记而不是在 Node 里监听 `page.on('response')`：答复可能在
 * 「等雨落下」那段就已经回来，那时 Node 侧还没开始数点；记在页面里，
 * 先落的答复也不会漏。成功、HTTP 失败、网络失败（含 10s 超时）都算落地——
 * 失败的答复一样会往那一行写字，一样得被拦。
 */
const LANDING_PATCH = `(() => {
  window.__intentLandings = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0]);
    const isIntent = url.includes('/api/world/intent');
    // 这一跑要的是「晚于客户端 10s 超时」的答复。abort signal 留着的话，10s 一到
    // 先落地的是超时（也算落地），仲裁测到的就不是迟到那条。只对意图请求摘掉。
    if (isIntent && args[1] && typeof args[1] === 'object') {
      const init = { ...args[1] };
      delete init.signal;
      args[1] = init;
    }
    try {
      const response = await realFetch(...args);
      if (isIntent) window.__intentLandings.push({ at: performance.now(), ok: response.ok });
      return response;
    } catch (error) {
      if (isIntent) window.__intentLandings.push({ at: performance.now(), ok: false, error: String(error) });
      throw error;
    }
  };
})();`;

/** 这一跑不等客户端的 10s 超时：答复由脚本自造（见 `LATE_REPLY_MS`）。 */
/** 响应到达后给 `response.json()` 与下一拍命令队列落字的时间。 */
const SETTLE_MS = 300;
/**
 * 上限是「自造的迟到答复最晚什么时候一定已经落地」：LATE_REPLY_MS 10.2s + 1.8s 余量
 * （100ms 轮询、300ms 落字、浏览器与队列抖动）。到了上限还没看到落地，
 * 就不许当作答复没来——那是「无法判定」，要红。
 */
const CAP_MS = 12_000;
/**
 * 迟到答复的固定延迟：场景自己造，不靠这台机器上的意图服务碰巧慢或碰巧快。
 * 10.2s 晚于「第二句之后的那一跑」该看到的即时回执，也晚于旧脚本固定的 10s 窗口；
 * 仍在 CAP_MS 内，所以「等到落地」能等到它。它比客户端的 10s 超时还晚，
 * 因此 `fetch` 那层要去掉 abort signal（见 `LANDING_PATCH`）——否则先落地的是超时，
 * 测到的就不是「迟到的答复」。
 */
const LATE_REPLY_MS = 10_200;
/** MessageChannel 门控到 60fps。测试专用，不进产物。 */
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
// 迟到的答复自己造：固定 10.2s 后回一份合法的 unknown。判据要测的是「迟到的答复
// 到得晚不晚」与「到了之后翻不翻那一行」，不该由这台机器的意图服务状态决定。
await page.route('**/api/world/intent', async (route) => {
  await new Promise((resolve) => setTimeout(resolve, LATE_REPLY_MS));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      intent: { kind: 'unknown', reason: '听起来你在感叹天气，所以世界不动。' },
      model: 'stub',
      source: 'stub',
    }),
  });
});
await page.addInitScript(RAF_PATCH);
await page.addInitScript(LANDING_PATCH);
await page.addInitScript(() => {
  try { localStorage.clear(); } catch { /* 隐私模式等场景忽略 */ }
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__rafPatched === '60fps', null, { timeout: 10000 });
await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });
await page.waitForFunction(() => (window.Oracle?.view().now ?? 0) > 0, null, { timeout: 20000 });

// 第一句：规则认不出，送进模型。这句话的答复要过网络，会慢好几秒。
await page.fill('#utterance', '今天天气不错');
await page.click('button[type="submit"]');
// 紧接着第二句：规则认得出，当场就办。不等第一句的答复。
await page.fill('#utterance', '下雨了');
await page.click('button[type="submit"]');
// 雨还在下的时候就把天气记下来：世界时钟比墙钟快（见下面第四条），
// 等到底就什么都看不到了。
const rained = await page
  .waitForFunction(() => window.Oracle.view().weather === 'rain', null, { timeout: 8000, polling: 200 })
  .then(() => true)
  .catch(() => false);

// 不等一个猜出来的固定秒数：等到「答复落地」再留一小段落字时间；最晚到 CAP_MS。
// 落地可能发生在上面「等雨落下」那段，那时本轮还没开始数点——所以先把已落地的读出来，
// 它的落地时刻在 `at` 里，不会因为数点晚而漏掉。
const pole = await page.evaluate(`(async () => {
  const CAP_MS = ${CAP_MS};
  const SETTLE_MS = ${SETTLE_MS};
  const started = performance.now();
  const seen = [];
  let last = null;
  let landed = null;
  while (true) {
    const now = (document.querySelector('#reply')?.textContent ?? '').trim();
    if (now !== last) {
      seen.push({ at: Math.round(performance.now() - started), text: now });
      last = now;
    }
    const hit = (window.__intentLandings ?? [])[0];
    if (hit !== undefined) {
      if (landed === null) landed = { at: Math.round(hit.at - started), ok: hit.ok };
      if (performance.now() - hit.at >= SETTLE_MS) break;
    }
    if (performance.now() - started >= CAP_MS) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { seen, landed, elapsed: Math.round(performance.now() - started) };
})()`);

const timeline = pole.seen;
console.log('那一行翻过的值：');
for (const step of timeline) console.log(`  ${String(step.at).padStart(5)}ms  ${JSON.stringify(step.text)}`);
console.log(
  `等到 ${pole.elapsed}ms 收手：` +
    (pole.landed === null
      ? `答复在 ${CAP_MS}ms 上限内没有落地`
      : `答复在 ${pole.landed.at}ms 落地（ok=${pole.landed.ok}）`),
);

const final = await page.evaluate(`({
  reply: (document.querySelector('#reply')?.textContent ?? '').trim(),
  weather: window.Oracle.view().weather,
  slab: window.Oracle.view().oracle.length,
})`);
console.log(`\n收尾：回执 ${JSON.stringify(final.reply)}  天气 ${final.weather}  石板 ${final.slab} 条`);

// 判据前提：绿只能来自「我们真的观察到一个迟到的答复落地」。这台机器上意图服务
// 即时失败时，答复会在开始数点之前就落地——那一跑既没有迟到、也没有不迟到，
// 什么都没测到，不能算过；答复本身失败（ok=false）也一样，仲裁没拿到可判的东西。
const premise = [];
if (pole.landed === null) {
  premise.push(`等了 ${CAP_MS}ms 仍未看到意图答复落地（无响应、无失败）：上限外无法判定`);
} else {
  if (pole.landed.at < 0) {
    premise.push(
      `答复在取样开始前 ${-pole.landed.at}ms 就已落地：没观察到迟到过程，这一跑什么都没测到`,
    );
  }
  if (pole.landed.ok !== true) {
    premise.push(`答复不算一次成功响应（ok=${pole.landed.ok}）：没有可判的模型答复，仲裁没被测到`);
  }
}

if (premise.length === 0) {
  // 一、第二句的回执得来过的。
  if (!timeline.some((step) => step.text === '雨落下来了。')) {
    problems.push('说了「下雨了」，那一行没出现过「雨落下来了。」');
  }
  // 二、那一行最后归它。迟到的答复不许再翻它。
  const last = timeline[timeline.length - 1];
  if (last === undefined || last.text !== '雨落下来了。') {
    problems.push(`答复落地后那一行是「${last?.text ?? ''}」，不是第二句的回执——被迟到的答复盖了`);
  }
  // 三、盖它的正是那句天气答复：认得出它来，才证明等的就是它。
  const clobber = timeline.find(
    (step) => step.text.includes('天气') && step.text.length > 0 && step.text !== '雨落下来了。',
  );
  if (clobber !== undefined) {
    problems.push(`${clobber.at}ms 出现了答给第一句的话：「${clobber.text}」`);
  }
  // 三·三、收尾那一刻也要比，而不只是打印。答复可能恰好在数点结束后才翻那一行：
  // 只看到 timeline 的最后一条会漏掉它，final.reply 是最后一道闸。
  if (final.reply !== '雨落下来了。') {
    problems.push(`收尾时那一行是「${final.reply}」，不是第二句的回执——迟到的答复翻了它`);
  }
  // 四、世界那一侧没被顺手关掉。
  //
  // 天气得在**雨还下着的时候**查：默认走真实时钟 1:1，45 秒的雨还不会到期；
  // 若给页面加了 `?clock=fast`/`?speed=`，世界会走得更快，这句就更要趁早查。
  // 所以它在第二步之后就查，见 `rained`。
  if (!rained) problems.push('说了「下雨了」，天气没变成 rain');
  // 石板是世界自己的记忆，不归回执那一行管——迟到的答复可以不说话，事得记着。
  if (final.slab === 0) problems.push('石板是空的——世界效果被一起拦掉了');
}

if (errors.length > 0) console.log(`页面异常：${errors.join(' / ')}`);
await browser.close();

console.log('');
if (premise.length > 0) {
  for (const text of premise) console.log(`[判据前提不成立] ${text}`);
  process.exitCode = 1;
} else if (problems.length === 0) {
  console.log(`过了：前提成立（答复在 ${pole.landed.at}ms 落地，ok=true），落地后那一行没有翻。`);
} else {
  console.log(`不过的 ${problems.length} 条：`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
