#!/usr/bin/env node
/**
 * 反向用例：压暗层在帧上限内不收敛时，闸门**必须**判红。
 *
 * 为什么需要它：`check-phases.mjs` 的收敛判据 2026-11-06 从「墙钟 8 秒」改成
 * 「帧进度 60 帧」（见 `lib/capture.mjs` 的 `waitFadeSettled`）。只把判据换个
 * 名字、不证明它还能红，就等于判据还是空判。
 *
 * 做法（同一页，两段）：
 *   1. **正控**：night 页加载后、下雨之前，用默认取样区跑同一个探针。
 *      真实会收敛，必须在 60 帧内拿到 `settled:true`——证明上限没有紧到
 *      连正常压暗都判红。
 *   2. **反例**：再让它下雨（雨幕逐帧都在动），用**整块画布**跑同款探针。
 *      画面永远不静止，必须在**第 60 帧**（恰好等于上限）拿到
 *      `settled:false`，并打印与 `check-phases.mjs` 同款的 FAIL。
 *
 * 整块画布的理由：150 颗雨滴撒在 480×320 世界里，26×26 的小样区经常连续
 * 三帧没有一颗雨滴穿过，会「假收敛」；整块画布逐帧都在变，抽不到同帧。
 *
 * **口径**：脚本自己退出 0 表示「反例成立」——即闸门在帧上限处真的判红、
 * 正控也在上限内收敛。退出 1 表示反例失效（探针退化成永远绿/永远红），
 * 那才是要修的问题。它不进 CI 绿闸，只用来跑给人看。
 *
 * 跑法：
 *   1. node node_modules/vite/bin/vite.js --port 5211 --strictPort
 *   2. PIXEL_WORLD_URL=http://127.0.0.1:5211 node scripts/check-phases-negative.mjs
 */
import { chromium } from '@playwright/test';
import { waitFadeSettled } from './lib/capture.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5211/';
/** 与 `check-phases.mjs` / `waitFadeSettled` 的默认上限保持同一口径。 */
const MAX_FRAMES = 60;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
const page = await context.newPage();
const failures = [];
try {
  page.on('pageerror', (error) => console.error(`[反例] 页面报错：${error.message}`));
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE}?ledger=off&time=night&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });

  const box = await page.locator('canvas').first().boundingBox();

  // 正控：雨前的夜，压暗会真的收敛。
  const sunny = await waitFadeSettled(page, box, { maxFrames: MAX_FRAMES });
  console.log(
    `[正控] probe frames=${sunny.frames} maxFrames=${sunny.maxFrames} `
      + `waitedMs=${sunny.waitedMs} settled=${sunny.settled}`,
  );
  console.log(
    `${sunny.settled ? 'ok  ' : 'FAIL'} night（雨前）压暗层 ${MAX_FRAMES} 帧内收敛  `
      + `等待 ${sunny.frames} 帧（墙钟 ${sunny.waitedMs}ms，仅作读数）`,
  );
  if (!sunny.settled) {
    failures.push('正控未在上限内收敛：上限可能过紧，或压暗真的没走完');
  }

  const said = await page.evaluate(() => window.Oracle.say('下雨吧'));
  // 雨渐变 1.8 秒；等 3 秒让 intensity 拉满。此后雨幕逐帧在动。
  await page.waitForTimeout(3000);
  const weather = await page.evaluate(() => window.Oracle.view().weather);

  const fade = await waitFadeSettled(page, box, {
    maxFrames: MAX_FRAMES,
    patch: { dx: 0, dy: 0, width: Math.round(box.width), height: Math.round(box.height) },
  });
  const gateRed = !fade.settled;

  console.log(`[反例] weather=${weather} say=${said.ok ? 'ok' : said.message}`);
  console.log(
    `[反例] probe frames=${fade.frames} maxFrames=${fade.maxFrames} `
      + `waitedMs=${fade.waitedMs} settled=${fade.settled}`,
  );
  console.log(
    `${gateRed ? 'FAIL' : 'ok  '} night（雨幕）压暗层 ${MAX_FRAMES} 帧内收敛  `
      + `等待 ${fade.frames} 帧（墙钟 ${fade.waitedMs}ms，仅作读数）`,
  );

  if (weather !== 'rain') failures.push(`雨天没上屏（weather=${weather}），反例不成立`);
  if (!gateRed) failures.push('反例失效：雨幕下探针竟然收敛了');
  // 反例必须**恰好撞在上限**，才能证明红是「帧进度用尽」而不是别的路径。
  if (gateRed && fade.frames !== fade.maxFrames) {
    failures.push(`反例红了但没跑满上限：frames=${fade.frames} maxFrames=${fade.maxFrames}`);
  }

  if (failures.length === 0) {
    console.log(
      `[反例] 反例成立：雨幕逐帧在动，第 ${fade.frames} 帧（上限 ${fade.maxFrames}）仍未收敛 → 闸门判红。`,
    );
  }
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n反向用例失效 ${failures.length} 项：`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exitCode = 1;
}
