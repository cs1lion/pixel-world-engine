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

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5199/';

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
await page.addInitScript(RAF_PATCH);
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

// 十秒里每 100ms 记一次那一行，看它翻过哪些值。模型那边实测约 4.8 秒回来。
const timeline = await page.evaluate(`(async () => {
  const seen = [];
  let last = null;
  for (let i = 0; i < 100; i += 1) {
    const now = (document.querySelector('#reply')?.textContent ?? '').trim();
    if (now !== last) {
      seen.push({ at: i * 100, text: now });
      last = now;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return seen;
})()`);

console.log('那一行翻过的值：');
for (const step of timeline) console.log(`  ${String(step.at).padStart(5)}ms  ${JSON.stringify(step.text)}`);

const final = await page.evaluate(`({
  reply: (document.querySelector('#reply')?.textContent ?? '').trim(),
  weather: window.Oracle.view().weather,
  slab: window.Oracle.view().oracle.length,
})`);
console.log(`\n收尾：回执 ${JSON.stringify(final.reply)}  天气 ${final.weather}  石板 ${final.slab} 条`);

// 一、第二句的回执得来过的。
if (!timeline.some((step) => step.text === '雨落下来了。')) {
  problems.push('说了「下雨了」，那一行没出现过「雨落下来了。」');
}
// 二、那一行最后归它。迟到的答复不许再翻它。
const last = timeline[timeline.length - 1];
if (last === undefined || last.text !== '雨落下来了。') {
  problems.push(`十秒后那一行是「${last?.text ?? ''}」，不是第二句的回执——被迟到的答复盖了`);
}
// 三、盖它的正是那句天气答复：认得出它来，才证明等的就是它。
const clobber = timeline.find(
  (step) => step.text.includes('天气') && step.text.length > 0 && step.text !== '雨落下来了。',
);
if (clobber !== undefined) {
  problems.push(`${clobber.at}ms 出现了答给第一句的话：「${clobber.text}」`);
}
// 四、世界那一侧没被顺手关掉。
//
// 天气得在**雨还下着的时候**查：世界时钟比墙钟快（`SandboxScene` 的
// `timeScale`，为的是潮汐几分钟里看得见涨落），十秒墙上约等于一分钟世界，
// 45 秒的雨到末态早到期了。所以这句在第二步之后就查，见 `rained`。
if (!rained) problems.push('说了「下雨了」，天气没变成 rain');
// 石板是世界自己的记忆，不归回执那一行管——迟到的答复可以不说话，事得记着。
if (final.slab === 0) problems.push('石板是空的——世界效果被一起拦掉了');

if (errors.length > 0) console.log(`页面异常：${errors.join(' / ')}`);
await browser.close();

console.log('');
if (problems.length === 0) {
  console.log('过了：那一行从头到尾是「雨落下来了。」，迟到的那句没有落上来。');
} else {
  console.log(`不过的 ${problems.length} 条：`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
