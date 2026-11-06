/* 确定性读数：把世界时钟钉死（performance.now 恒定 + 帧号不再前进），
 * 隔 1 真实秒截两张图；再新开一个页面跑到同一帧号截第三张。
 *
 * 用途：材质改动只允许由世界时钟与 seedOf 驱动，这条把两件事量出来——
 *   1) 冻结世界 1 秒，全画面与 ROI 帧差是否为 0.00%；
 *   2) 同一帧号两遍运行，逐像素是否一致（本引擎在载入期有 Date.now 参与
 *      的种子，两遍会有 ~0.15% 的散布，基线同样如此，见 evidence 的说明）。
 *
 * 用法：dev server 起在 5211 后 `node scripts/material-determinism.mjs <label>`，
 * 产物写到 <仓库根>/docs/evidence/material-upgrade/<label>/det-*.png。
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', '..', 'docs', 'evidence', 'material-upgrade',
  process.argv[2] ?? 'after');
const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;
const FRAME_MS = 1000 / 60;

function pinClock({ frameMs }) {
  try {
    localStorage.clear();
  } catch {
    /* 隐私模式忽略 */
  }
  const state = { frame: 0, freeze: false };
  window.__DET__ = state;
  const realRaf = window.requestAnimationFrame.bind(window);
  // 冻结后 now 恒为 0：Phaser 的 delta 归零，世界时钟不再前进。
  performance.now = () => (state.freeze ? 0 : state.frame * frameMs);
  window.requestAnimationFrame = (cb) =>
    realRaf(() => {
      if (!state.freeze) state.frame += 1;
      cb(state.freeze ? 0 : state.frame * frameMs);
    });
}

const URL = `${BASE}?world=dengchao&time=noon&feed=off&ledger=off&now=495&debug=0`;
const clip = { x: 25, y: 69, width: 960, height: 640 };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function run(file) {
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
  const page = await context.newPage();
  await page.addInitScript(pinClock, { frameMs: FRAME_MS });
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.Oracle !== undefined, undefined, { timeout: 30000 });
  await page.addStyleTag({
    content: `#world-overlay,#minimap,#topbar,#oracle,#clock-align,#camera-bar,footer{display:none!important}`,
  });
  await page.evaluate(() => window.Oracle.setCameraMode('free'));
  await page.waitForFunction(() => window.__DET__.frame >= 240, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    window.__DET__.freeze = true;
  });
  await page.waitForTimeout(200);
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('#app canvas');
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });
  await page.screenshot({ path: `${OUT}/${file}.png`, clip: rect });
  await context.close();
  return rect;
}

const rect = await run('det-frozen-1');
const realClip = rect.width === clip.width && rect.height === clip.height ? rect : clip;
await (async () => {
  // 第二张：同一页面再等 1 真实秒。为此重开一次并在冻结后连拍。
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
  const page = await context.newPage();
  await page.addInitScript(pinClock, { frameMs: FRAME_MS });
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.Oracle !== undefined, undefined, { timeout: 30000 });
  await page.addStyleTag({
    content: `#world-overlay,#minimap,#topbar,#oracle,#clock-align,#camera-bar,footer{display:none!important}`,
  });
  await page.evaluate(() => window.Oracle.setCameraMode('free'));
  await page.waitForFunction(() => window.__DET__.frame >= 240, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    window.__DET__.freeze = true;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/det-run2-a.png`, clip: realClip });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/det-run2-b.png`, clip: realClip });
  await context.close();
})();
await browser.close();
console.log('determinism shots ->', OUT);
