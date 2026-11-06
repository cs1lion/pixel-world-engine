#!/usr/bin/env node
/**
 * 反向用例：压暗层永不收敛时，闸门**必须**判红。
 *
 * 为什么需要它：`check-phases.mjs` 把「夜间压暗 6 秒内收敛」的门槛改成了
 * 8 秒（2026-11-06）。只改数字、不证明判据还能红，就等于把判据调松。
 *
 * 做法：夜里先让它下雨（雨幕逐帧都在动），再跑与 `check-phases.mjs` 同款的
 * `waitFadeSettled`（默认上限 8 秒），并按同款 `check(...)` 口径打印判定。
 * 雨幕下探针永远不收敛，所以 8 秒后必须拿到 `settled:false` 并打印 FAIL。
 *
 * **这个脚本期望红（退出码 1）**。它不进 CI 绿闸；它的用途是把「8 秒仍然
 * 会红」这件事跑给人看。若哪天它变绿（`settled:true`），说明探针退化成
 * 永远绿，反而要修。
 *
 * 跑法：
 *   1. node node_modules/vite/bin/vite.js --port 5211 --strictPort
 *   2. PIXEL_WORLD_URL=http://127.0.0.1:5211 node scripts/check-phases-negative.mjs
 */
import { chromium } from '@playwright/test';
import { waitFadeSettled } from './lib/capture.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5211/';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
const page = await context.newPage();
try {
  page.on('pageerror', (error) => console.error(`[反例] 页面报错：${error.message}`));
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE}?ledger=off&time=night&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });

  const box = await page.locator('canvas').first().boundingBox();
  const said = await page.evaluate(() => window.Oracle.say('下雨吧'));
  // 雨渐变 1.8 秒；等 3 秒让 intensity 拉满。此后雨幕逐帧在动。
  await page.waitForTimeout(3000);
  const weather = await page.evaluate(() => window.Oracle.view().weather);

  // 样区取整块画布：150 颗雨滴撒在 480×320 世界里，小样区经常连续三帧
  // 没有一颗雨滴穿过，会「假收敛」；整块画布逐帧都在变，抽不到同帧。
  const fade = await waitFadeSettled(page, box, {
    patch: { dx: 0, dy: 0, width: Math.round(box.width), height: Math.round(box.height) },
  });
  const red = !(weather === 'rain' && fade.settled);

  console.log(`[反例] weather=${weather} say=${said.ok ? 'ok' : said.message}`);
  console.log(
    `[反例] probe waitedMs=${fade.waitedMs} frames=${fade.frames} capMs=${fade.capMs} settled=${fade.settled}`,
  );
  console.log(
    `${red ? 'FAIL' : 'ok  '} night（雨幕）压暗层 8 秒内收敛  等待 ${fade.waitedMs}ms / ${fade.frames} 帧`,
  );
  if (red) {
    console.error('[反例] 反例成立：雨幕逐帧在动，8 秒后仍未收敛 → 闸门判红。');
    process.exitCode = 1;
  }
} finally {
  await page.close();
  await context.close();
  await browser.close();
}
