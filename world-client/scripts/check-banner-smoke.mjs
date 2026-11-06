#!/usr/bin/env node
/**
 * 第三条：幌布（摆动 + 沿墙投影）与烟（分段漂移 + 消散）——各自开关、各自量。
 *
 * 口径与灯街、摊位两条一致：
 * - 世界冻住后用 `debugStepWorld` 按世界毫秒推进；同一时刻 → 同一帧；
 *   逐帧像素 sha256 判确定性（PNG 字节带编码差异，不作判据）。
 * - 灯的七支动态全关、摊位两支全关、村民出画、潮位钉 1、鸟藏起、DOM 叠层隐藏。
 * - 幌布两支分开量：`sway`（布身横摆）与 `shadow`（沿墙投影）。
 *   投影单独量时把布身定住——影子自己仍会跟着"布身该有的摆幅"横移（`bannerShadowAt`
 *   里影子跟布同源），所以 shadow-only 的帧差是真影子在动；全关是 0。
 * - 投影的长度/浓淡由相位给：正午 / 黄昏 / 夜三态各取一帧 + 读数（1 / 5 / 0 px）。
 * - 烟分两处量：主楼那两柱（世界 x≈528/576，y≈164/180）与炉底那柱（x≈720，y≈532）。
 *   t / t+2s 相隔 120 世界秒（默认倍率 60 下是 2 真实秒）。
 * - 「烟不盖楼体轮廓」用同一页、同一时刻的开/关对照，直接量楼体占地 bbox 里的变化像素；
 *   烟画在建筑层之下（depth 1399 < 1400），楼体像素先画、把烟盖住，bbox 里必须是 0。
 *
 * 跑法：
 *   cd world-client && npm run dev -- --port 5211
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-banner-smoke.mjs
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';
import { resolveShotDir } from './lib/shot-output.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = resolveShotDir('check-banner-smoke');
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const STEADY_A = 1090 * MIN;
const STEADY_B = STEADY_A + 60_000;
const SMOKE_B = STEADY_A + 120_000;

const BANNER_CAMERA = { x: 537, y: 470 };
/** 三面幌布的世界坐标 (336,432) / (480,528) / (736,432)，影子最远到 y≈406。 */
const BANNER_ROI = { x0: 300, y0: 390, x1: 780, y1: 545 };

const SMOKE_HIGH_CAMERA = { x: 560, y: 250 };
/** 主楼那两柱烟：起飘高度约 164 / 180，烟团往上 20px。 */
const SMOKE_HIGH_ROI = { x0: 500, y0: 130, x1: 770, y1: 300 };

const SMOKE_LOW_CAMERA = { x: 720, y: 470 };
/** 炉底那柱：起飘高度抬到补灯铺楼顶之上（≈532）。 */
const SMOKE_LOW_ROI = { x0: 660, y0: 495, x1: 790, y1: 542 };

/** 楼体占地（世界像素）：烟只能画在这些框之外，框里变化像素必须是 0。 */
const BUILDING_BBOXES = [
  { name: '叠浪楼', x0: 448, y0: 320, x1: 560, y1: 416 },
  { name: '炉底入口', x0: 464, y0: 224, x1: 528, y1: 272 },
  { name: '补灯铺', x0: 688, y0: 544, x1: 752, y1: 608 },
  { name: '炉匠铺', x0: 592, y0: 544, x1: 656, y1: 608 },
];

const LAMPS_OFF = { ignite: false, breathe: false, sway: false };
const STALLS_OFF = { cloth: false, fire: false };
const BANNERS_OFF = { sway: false, shadow: false };
const SMOKE_OFF = { drift: false };
const ONLY_SWAY = { sway: true, shadow: false };
const ONLY_SHADOW = { sway: false, shadow: true };
const BOTH_ON = { sway: true, shadow: true };

function initScript({ freezeAt }) {
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
  const state = { frame: 0, frozen: false };
  window.__CAPTURE_STATE__ = state;
  const realRaf = window.requestAnimationFrame.bind(window);
  const frameMs = 1000 / 60;
  performance.now = () => state.frame * frameMs;
  window.requestAnimationFrame = (cb) => {
    if (state.frozen) return 0;
    return realRaf(() => {
      state.frame += 1;
      if (freezeAt > 0 && state.frame >= freezeAt) {
        state.frozen = true;
        cb(state.frame * frameMs);
        return;
      }
      cb(state.frame * frameMs);
    });
  };
}

async function waitFrames(page, count) {
  const from = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  await page.waitForFunction(
    ({ from, count }) => window.__CAPTURE_STATE__.frame >= from + count,
    { from, count },
    { timeout: 20000 },
  );
}

async function openScene(browser, { phase = 'dusk', camera, banners, smoke } = {}) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(initScript, { freezeAt: 0 });
  await page.goto(
    `${BASE}?world=dengchao&time=${phase}&feed=off&ledger=off&debug=1&now=1075`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });
  const canvas = page.locator('canvas').first();
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('找不到 canvas');

  // `screenshot({clip})` 会把 DOM 叠层截进来（顶栏帧计数每页差一个字符），先藏起来。
  await page.evaluate(() => {
    for (const selector of [
      '#topbar',
      '#status',
      '#minimap',
      '#queue',
      '#oracle',
      '#maintenance',
      '#debug-panel',
      '#world-overlay',
      '#chronicle',
    ]) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) element.style.visibility = 'hidden';
    }
  });

  await waitFrames(page, 24);
  await page.evaluate(([camera, banners, smoke]) => {
    for (const villager of window.Oracle.view().villagers) {
      window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
    }
    window.Oracle.debugPinTide(1);
    // 与灯带/光池同一纪律：天气必须钉住（新世界 00:00 槽按当日种子排，雨点逐帧乱飘）。
    window.Oracle.debugSetWeather?.('clear');
    window.Oracle.debugHideAmbience(true);
    // 湾面低雾（artbook）也按世界时刻横移，会在「烟关掉」的对照里留下三条 420×5 的带；
    // 它不是烟，量烟之前先摘出去（与藏鸟同一类隔离，报告里注明）。
    window.Oracle.debugHideBayMist(true);
    window.Oracle.debugLampMotion({ ignite: false, breathe: false, sway: false });
    window.Oracle.debugStallMotion({ cloth: false, fire: false });
    if (banners !== null) window.Oracle.debugBannerMotion(banners);
    if (smoke !== null) window.Oracle.debugSmokeMotion(smoke);
    window.Oracle.centerCameraOn(camera.x, camera.y);
  }, [camera, banners, smoke]);
  await waitFrames(page, 40);
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await waitFrames(page, 2);
  return { page, box, errors };
}

async function stepTo(page, targetMs) {
  const now = await page.evaluate(() => window.Oracle.debugStepWorld(0));
  const delta = targetMs - now;
  if (delta > 0) await page.evaluate((ms) => window.Oracle.debugStepWorld(ms), delta);
  await waitFrames(page, 2);
  return page.evaluate(() => window.Oracle.debugStepWorld(0));
}

async function shot(page, box, id) {
  const file = join(OUT, `banner-smoke-${id}.png`);
  await page.screenshot({ path: file, clip: box });
  const buf = readFileSync(file);
  const meta = await page.evaluate(() => ({
    now: window.Oracle.debugStepWorld(0),
    frame: window.__CAPTURE_STATE__.frame,
    weather: window.Oracle.view().weather,
    banners: window.Oracle.debugBannerUnits(),
    smoke: window.Oracle.debugSmokeUnits(),
    stats: window.Oracle.renderStats(),
    camera: window.Oracle.camera(),
  }));
  return { id, file, buf, sha256: createHash('sha256').update(buf).digest('hex'), ...meta };
}

/** t / t+Ns：同一组开关、同一页，只让世界时间走。 */
async function capturePair(browser, { phase = 'dusk', camera, banners, smoke, from, to, tag }) {
  const { page, box, errors } = await openScene(browser, { phase, camera, banners, smoke });
  await stepTo(page, from);
  const a = await shot(page, box, `${tag}-t`);
  await stepTo(page, to);
  const b = await shot(page, box, `${tag}-t1`);
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { a, b };
}

/** 同一页、同一世界时刻：烟从开到关；先给关帧，再走到 t+2s 给关的另一帧。 */
async function captureSmoke(browser, { camera, tag }) {
  const { page, box, errors } = await openScene(browser, {
    camera,
    banners: BANNERS_OFF,
    smoke: { drift: true },
  });
  await stepTo(page, STEADY_A);
  const on = await shot(page, box, `${tag}-on`);
  await page.evaluate(() => window.Oracle.debugSmokeMotion({ drift: false }));
  await waitFrames(page, 2);
  const off = await shot(page, box, `${tag}-off`);
  await stepTo(page, SMOKE_B);
  const offLater = await shot(page, box, `${tag}-off-t2`);
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { on, off, offLater };
}

/** 相位三态各取一帧（投影长度/浓淡只由相位给，世界时刻不变）。 */
async function capturePhase(browser, phase) {
  const { page, box, errors } = await openScene(browser, {
    phase,
    camera: BANNER_CAMERA,
    banners: ONLY_SHADOW,
    smoke: SMOKE_OFF,
  });
  await stepTo(page, STEADY_A);
  const frame = await shot(page, box, `shadow-${phase}`);
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return frame;
}

async function capturePause(browser) {
  const { page, box } = await openScene(browser, {
    camera: BANNER_CAMERA,
    banners: BOTH_ON,
    smoke: { drift: true },
  });
  await stepTo(page, STEADY_A);
  const a = await shot(page, box, 'pause-a');
  const framesBefore = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  await page.waitForTimeout(1000);
  const framesAfter = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  const b = await shot(page, box, 'pause-b');
  await page.close();
  return { a, b, framesAdvanced: framesAfter - framesBefore, nowA: a.now, nowB: b.now };
}

/** 13 帧：世界时刻 18:10:00 起每 10 世界秒一帧；两遍逐帧像素 sha256。 */
async function captureDeterminism(browser, tag) {
  const { page, box } = await openScene(browser, {
    camera: BANNER_CAMERA,
    banners: BOTH_ON,
    smoke: { drift: true },
  });
  await stepTo(page, STEADY_A);
  const hashes = [];
  let first = null;
  for (let i = 0; i < 13; i += 1) {
    if (i > 0) await stepTo(page, STEADY_A + i * 10_000);
    const buf = await page.screenshot({ clip: box });
    if (first === null) first = buf;
    hashes.push(await pixelHash(page, buf));
  }
  await page.close();
  return { hashes, first };
}

async function diffPair(page, aBuf, bBuf, cam, roi) {
  const b64 = { a: aBuf.toString('base64'), b: bBuf.toString('base64') };
  return page.evaluate(async ({ b64, roi, cam }) => {
    const load = async (src) => {
      const image = new Image();
      await new Promise((res, rej) => {
        image.onload = res;
        image.onerror = rej;
        image.src = `data:image/png;base64,${src}`;
      });
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      if (ctx === null) throw new Error('没有 2d 上下文');
      ctx.drawImage(image, 0, 0);
      return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    };
    const [a, b] = await Promise.all([load(b64.a), load(b64.b)]);
    if (a.w !== b.w || a.h !== b.h) return null;
    const px = (wx) => (wx - cam.worldViewX) * 2 * cam.zoom;
    const py = (wy) => (wy - cam.worldViewY) * 2 * cam.zoom;
    const x0 = Math.max(0, Math.round(px(roi.x0)));
    const x1 = Math.min(a.w, Math.round(px(roi.x1)));
    const y0 = Math.max(0, Math.round(py(roi.y0)));
    const y1 = Math.min(a.h, Math.round(py(roi.y1)));
    let changed = 0;
    let pixels = 0;
    let maxDelta = 0;
    let fullChanged = 0;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let y = 0; y < a.h; y += 1) {
      for (let x = 0; x < a.w; x += 1) {
        const i = (y * a.w + x) * 4;
        let dmax = 0;
        for (let k = 0; k < 3; k += 1) {
          const d = Math.abs(a.data[i + k] - b.data[i + k]);
          if (d > dmax) dmax = d;
        }
        if (dmax > 0) fullChanged += 1;
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        pixels += 1;
        if (dmax > 0) {
          changed += 1;
          if (dmax > maxDelta) maxDelta = dmax;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }
    }
    return {
      roi: { x0, y0, x1, y1, pixels },
      changed,
      ratio: changed / pixels,
      maxDelta,
      bbox: changed === 0 ? null : { x0: bx0, y0: by0, x1: bx1, y1: by1 },
      fullChanged,
      fullRatio: fullChanged / (a.w * a.h),
    };
  }, { b64, roi, cam });
}

const pct = (value) => `${(value * 100).toFixed(2)}%`;
const hhmmss = (ms) => {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

async function pixelHash(page, buf) {
  return page.evaluate(async (b64) => {
    const image = new Image();
    await new Promise((res, rej) => {
      image.onload = res;
      image.onerror = rej;
      image.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d');
    if (ctx === null) throw new Error('没有 2d 上下文');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }, buf.toString('base64'));
}

const browser = await chromium.launch({ headless: true });
const reader = await browser.newPage();
// 解码页要落在同源 http 上：about:blank 是不透明源，`crypto.subtle` 不可用。
await reader.goto(BASE, { waitUntil: 'domcontentloaded' });

// ---------------------------------------------------------------- 幌布：三组开关
const pairs = {};
pairs['banner-both'] = await capturePair(browser, { camera: BANNER_CAMERA, banners: BOTH_ON, smoke: SMOKE_OFF, from: STEADY_A, to: STEADY_B, tag: 'banner-both' });
pairs['banner-sway'] = await capturePair(browser, { camera: BANNER_CAMERA, banners: ONLY_SWAY, smoke: SMOKE_OFF, from: STEADY_A, to: STEADY_B, tag: 'banner-sway' });
pairs['banner-shadow'] = await capturePair(browser, { camera: BANNER_CAMERA, banners: ONLY_SHADOW, smoke: SMOKE_OFF, from: STEADY_A, to: STEADY_B, tag: 'banner-shadow' });
pairs['banner-off'] = await capturePair(browser, { camera: BANNER_CAMERA, banners: BANNERS_OFF, smoke: SMOKE_OFF, from: STEADY_A, to: STEADY_B, tag: 'banner-off' });

const cam = pairs['banner-both'].a.camera;
const diffs = {};
for (const [name, pair] of Object.entries(pairs)) {
  diffs[name] = await diffPair(reader, pair.a.buf, pair.b.buf, cam, BANNER_ROI);
}

// ---------------------------------------------------------------- 投影的相位三态
const phases = {
  noon: await capturePhase(browser, 'noon'),
  dusk: await capturePhase(browser, 'dusk'),
  night: await capturePhase(browser, 'night'),
};

// ---------------------------------------------------------------- 烟：两处、开与关
const smokeHigh = await captureSmoke(browser, { camera: SMOKE_HIGH_CAMERA, tag: 'smoke-high' });
const smokeLow = await captureSmoke(browser, { camera: SMOKE_LOW_CAMERA, tag: 'smoke-low' });
// t / t+2s：漂移开着、同一页只让世界时间走 120 秒。
const smokeHighPair = await capturePair(browser, {
  camera: SMOKE_HIGH_CAMERA,
  banners: BANNERS_OFF,
  smoke: { drift: true },
  from: STEADY_A,
  to: SMOKE_B,
  tag: 'smoke-high-pair',
});
const smokeLowPair = await capturePair(browser, {
  camera: SMOKE_LOW_CAMERA,
  banners: BANNERS_OFF,
  smoke: { drift: true },
  from: STEADY_A,
  to: SMOKE_B,
  tag: 'smoke-low-pair',
});

const smokeDiff = {
  high: await diffPair(reader, smokeHighPair.a.buf, smokeHighPair.b.buf, smokeHigh.on.camera, SMOKE_HIGH_ROI),
  low: await diffPair(reader, smokeLowPair.a.buf, smokeLowPair.b.buf, smokeLow.on.camera, SMOKE_LOW_ROI),
  highOff: await diffPair(reader, smokeHigh.off.buf, smokeHigh.offLater.buf, smokeHigh.on.camera, SMOKE_HIGH_ROI),
  lowOff: await diffPair(reader, smokeLow.off.buf, smokeLow.offLater.buf, smokeLow.on.camera, SMOKE_LOW_ROI),
};
// 同一页、同一时刻：烟从开到关，烟像素落在哪；楼体占地 bbox 里必须一点不动。
const smokeVisible = {
  high: await diffPair(reader, smokeHigh.on.buf, smokeHigh.off.buf, smokeHigh.on.camera, SMOKE_HIGH_ROI),
  low: await diffPair(reader, smokeLow.on.buf, smokeLow.off.buf, smokeLow.on.camera, SMOKE_LOW_ROI),
};
const wallDiff = {
  high: await Promise.all(
    BUILDING_BBOXES.slice(0, 2).map(async (bbox) => ({
      name: bbox.name,
      ...(await diffPair(reader, smokeHigh.on.buf, smokeHigh.off.buf, smokeHigh.on.camera, bbox)),
    })),
  ),
  low: await Promise.all(
    BUILDING_BBOXES.slice(2).map(async (bbox) => ({
      name: bbox.name,
      ...(await diffPair(reader, smokeLow.on.buf, smokeLow.off.buf, smokeLow.on.camera, bbox)),
    })),
  ),
};
const wallTotal = [...wallDiff.high, ...wallDiff.low].reduce((sum, row) => sum + row.changed, 0);

// ---------------------------------------------------------------- 暂停世界
const pause = await capturePause(browser);
const pauseDiff = await diffPair(reader, pause.a.buf, pause.b.buf, cam, BANNER_ROI);

// ---------------------------------------------------------------- 确定性：13 帧序列跑两遍
const runA = await captureDeterminism(browser, 'a');
const runB = await captureDeterminism(browser, 'b');
const determinism = runA.hashes.map((hash, index) => ({
  frame: index,
  a: hash,
  b: runB.hashes[index] ?? null,
  same: hash === runB.hashes[index],
}));
const allSame = determinism.every((row) => row.same);
const determinismProbe = allSame
  ? null
  : await diffPair(reader, runA.first, runB.first, cam, { x0: 0, y0: 0, x1: 9999, y1: 9999 });

await browser.close();

const peakCommands = Math.max(
  ...Object.values(pairs).flatMap((pair) => [pair.a.stats.totalCommands, pair.b.stats.totalCommands]),
  smokeHigh.on.stats.totalCommands,
  smokeHighPair.b.stats.totalCommands,
  smokeLow.on.stats.totalCommands,
  smokeLowPair.b.stats.totalCommands,
  pause.a.stats.totalCommands,
);

const anchorRows = smokeHigh.on.smoke
  .concat(smokeLow.on.smoke)
  .map((unit) => `<tr><td>(${unit.x}, ${unit.anchorY})</td><td>${unit.puffs.map((puff) => `${puff.dx}/${puff.dy}/${puff.width}x${puff.height}/α${puff.alpha.toFixed(3)}`).join(' · ')}</td></tr>`)
  .join('');
const bannerUnitRows = ['a', 'b']
  .map((which) => {
    const pair = pairs['banner-both'];
    const units = (which === 'a' ? pair.a : pair.b).banners;
    return `<tr><td>${which === 'a' ? 't' : 't+1s'}</td><td>${JSON.stringify(units.map((unit) => unit.swayDx))}</td><td>${JSON.stringify(units.map((unit) => unit.shadowDx))}</td></tr>`;
  })
  .join('');
const shadowRows = Object.entries(phases)
  .map(([phase, frame]) => {
    const units = frame.banners;
    const spans = units.map((unit) => unit.shadowSpan);
    const alphas = units.map((unit) => unit.shadowAlpha);
    return `<tr><td>${phase}</td><td>${JSON.stringify(spans)}</td><td>${JSON.stringify(alphas.map((value) => Number(value.toFixed(2))))}</td></tr>`;
  })
  .join('');
const wallRows = [...wallDiff.high, ...wallDiff.low]
  .map((row) => `<tr><td>${row.name}</td><td>${row.changed}</td><td>${pct(row.ratio)}</td></tr>`)
  .join('');

const bufFigure = (buf, caption) => {
  const src = `data:image/png;base64,${buf.toString('base64')}`;
  return `<figure><img src="${src}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
};
const diffRows = Object.entries(diffs)
  .map(([name, value]) => `<tr><td>${name}</td><td>${pct(value.ratio)}</td><td>${value.changed}</td><td>${value.maxDelta}</td></tr>`)
  .join('');

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>幌布与烟 · 动态证据</title>
<style>
  body { font: 14px/1.6 system-ui, "Noto Sans SC", sans-serif; margin: 24px; color: #1d2226; background: #f7f4ee; }
  h1 { font-size: 22px; margin: 0 0 6px; } h2 { font-size: 16px; margin: 28px 0 8px; }
  p { margin: 6px 0; } table { border-collapse: collapse; margin: 10px 0; }
  td, th { border: 1px solid #c9c1b4; padding: 3px 8px; font-variant-numeric: tabular-nums; }
  th { background: #ece5d8; }
  .strip { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
  .strip figure { margin: 0; } .strip img { width: 320px; image-rendering: pixelated; border: 1px solid #b5ac9d; }
  figcaption { font-size: 12px; color: #5c554b; }
  code { background: #e8e2d6; padding: 0 4px; }
</style></head><body>
<h1>幌布 3 件 + 烟（主楼烟囱 / 炉底）</h1>
<p>世界 ${hhmmss(STEADY_A)} → ${hhmmss(STEADY_B)}（60 世界秒）；烟走 ${hhmmss(STEADY_A)} → ${hhmmss(SMOKE_B)}（120 世界秒）。
灯七支与摊位两支动态全程关闭；村民出画、潮位钉 1、鸟藏起、DOM 叠层隐藏。
**湾面低雾也藏起**：它是既有设定集补绘，按世界时刻横移，会在「烟关掉」的对照里
留下三条 420×5 的像素带（实测 0.73%）——那不是烟，量烟之前先摘出去（与藏鸟同一类隔离）。</p>

<h2>幌布：t / t+1s 帧差（ROI ${BANNER_ROI.x0}..${BANNER_ROI.x1}, ${BANNER_ROI.y0}..${BANNER_ROI.y1}）</h2>
<table><thead><tr><th>开关</th><th>变化占比</th><th>变化像素</th><th>最大通道差</th></tr></thead><tbody>${diffRows}</tbody></table>
<p>只开布身 <b>${pct(diffs['banner-sway'].ratio)}</b>、只开投影 <b>${pct(diffs['banner-shadow'].ratio)}</b>、
两件一起 <b>${pct(diffs['banner-both'].ratio)}</b>；全关 <b>${pct(diffs['banner-off'].ratio)}</b>（投影关掉时就是这一对）。</p>
<table><thead><tr><th>时刻</th><th>三面布身 swayDx（px）</th><th>三面投影 shadowDx（px）</th></tr></thead><tbody>${bannerUnitRows}</tbody></table>
<div class="strip">${bufFigure(pairs['banner-sway'].a.buf, '只摆布身（t）')}${bufFigure(pairs['banner-shadow'].a.buf, '只开投影（t）')}${bufFigure(pairs['banner-both'].a.buf, '两件一起（t）')}</div>

<h2>投影随光照相位：正午短 / 黄昏长 / 夜里几乎无</h2>
<table><thead><tr><th>相位</th><th>影长 px（三面）</th><th>浓淡 α（三面）</th></tr></thead><tbody>${shadowRows}</tbody></table>
<div class="strip">${bufFigure(phases.noon.buf, '正午：短')}${bufFigure(phases.dusk.buf, '黄昏：长')}${bufFigure(phases.night.buf, '夜：几乎无')}</div>
<p>夜里影长与浓淡都是 0：南侧幌布的落影会落进夜街扫描带，灯下本来也没有这条影子。</p>

<h2>烟：分段漂移 + 消散（t / t+2s）</h2>
<p>主楼两柱 <b>${pct(smokeDiff.high.ratio)}</b>（${smokeDiff.high.changed} 像素，max ${smokeDiff.high.maxDelta}），
关掉漂移 <b>${pct(smokeDiff.highOff.ratio)}</b>；炉底那柱 <b>${pct(smokeDiff.low.ratio)}</b>
（${smokeDiff.low.changed} 像素），关掉 <b>${pct(smokeDiff.lowOff.ratio)}</b>。</p>
<p>烟像素（开/关同一时刻）主楼 <b>${pct(smokeVisible.high.ratio)}</b>、炉底 <b>${pct(smokeVisible.low.ratio)}</b>；
落进楼体占地 bbox 的变化像素合计 <b>${wallTotal}</b>：
烟画在建筑层之下（depth 1399 &lt; 1400），楼体先画、把烟盖住，所以烟盖不到楼体轮廓，也穿不过墙。</p>
<table><thead><tr><th>楼体占地</th><th>变化像素</th><th>占比</th></tr></thead><tbody>${wallRows}</tbody></table>
<div class="strip">${bufFigure(smokeHigh.on.buf, '主楼烟囱（t）')}${bufFigure(smokeHighPair.b.buf, '主楼烟囱（t+2s）')}${bufFigure(smokeLow.on.buf, '炉底（t）')}${bufFigure(smokeLowPair.b.buf, '炉底（t+2s）')}</div>
<table><thead><tr><th>烟囱口 (x, 起飘高度)</th><th>三段（dx / dy / 宽×高 / α）</th></tr></thead><tbody>${anchorRows}</tbody></table>

<h2>确定性与暂停</h2>
<p>13 帧序列（${hhmmss(STEADY_A)} 起每 10 世界秒一帧）跑两遍、逐帧像素 sha256：
<b>${allSame ? '13/13 一致' : `有差异（首差 ${pct(determinismProbe?.ratio ?? 0)}，bbox ${JSON.stringify(determinismProbe?.bbox ?? null)}）`}</b>。
冻住世界后等 1 真实秒（渲染帧 +${pause.framesAdvanced}），世界时刻 ${hhmmss(pause.nowA)} → ${hhmmss(pause.nowB)}，
ROI 变化 <b>${pct(pauseDiff.ratio)}</b>、全画面 <b>${pct(pauseDiff.fullRatio)}</b>。</p>

<h2>指令</h2>
<p>本条峰值绘制指令 <b>${peakCommands}</b>（预算 29000）。</p>
</body></html>`;

writeFileSync(join(OUT, 'banner-smoke.html'), html);
writeFileSync(
  join(OUT, 'banner-smoke.json'),
  `${JSON.stringify({
    at: { a: STEADY_A, smokeB: SMOKE_B },
    banner: {
      camera: BANNER_CAMERA,
      roi: BANNER_ROI,
      diffs,
      units: { t: pairs['banner-both'].a.banners, t1: pairs['banner-both'].b.banners },
    },
    shadow: Object.fromEntries(
      Object.entries(phases).map(([phase, frame]) => [phase, frame.banners]),
    ),
    smoke: {
      highCamera: SMOKE_HIGH_CAMERA,
      lowCamera: SMOKE_LOW_CAMERA,
      diffs: smokeDiff,
      visible: smokeVisible,
      wall: wallDiff,
      wallTotal,
      units: [...smokeHigh.on.smoke, ...smokeLow.on.smoke],
    },
    pause: { diff: pauseDiff, framesAdvanced: pause.framesAdvanced, nowA: pause.nowA, nowB: pause.nowB },
    determinism,
    determinismProbe,
    /** 口径（每条读数都配这一整行）：机位 / zoom / ROI / 潮位 / 相位 / 视口 / 天气 / 时刻。 */
    params: {
      banner: { camera: BANNER_CAMERA, zoom: pairs['banner-both'].a.camera.zoom, roi: BANNER_ROI },
      smokeHigh: { camera: SMOKE_HIGH_CAMERA, zoom: smokeHigh.on.camera.zoom, roi: SMOKE_HIGH_ROI },
      smokeLow: { camera: SMOKE_LOW_CAMERA, zoom: smokeLow.on.camera.zoom, roi: SMOKE_LOW_ROI },
      viewport: { width: 1010, height: 700 },
      tide: 1,
      weather: pairs['banner-both'].a.weather,
      phase: 'dusk（?time=dusk 强制，autoAdvancing=false）',
      now: { bannerA: STEADY_A, bannerB: STEADY_B, smokeB: SMOKE_B },
    },
    peakCommands,
  }, null, 2)}\n`,
);

console.log('幌布帧差', Object.fromEntries(Object.entries(diffs).map(([name, value]) => [name, pct(value.ratio)])));
console.log('布身读数', 't', pairs['banner-both'].a.banners.map((unit) => unit.swayDx), 't+1s', pairs['banner-both'].b.banners.map((unit) => unit.swayDx));
console.log('投影读数', 't', pairs['banner-both'].a.banners.map((unit) => unit.shadowDx), 't+1s', pairs['banner-both'].b.banners.map((unit) => unit.shadowDx));
console.log('相位影长', Object.fromEntries(Object.entries(phases).map(([phase, frame]) => [phase, frame.banners.map((unit) => unit.shadowSpan)])));
console.log('烟', '主楼', pct(smokeDiff.high.ratio), '关', pct(smokeDiff.highOff.ratio), '炉底', pct(smokeDiff.low.ratio), '关', pct(smokeDiff.lowOff.ratio));
console.log('楼体 bbox 变化像素', wallTotal);
console.log('暂停', pct(pauseDiff.ratio), '帧 +', pause.framesAdvanced, '确定性', allSame ? '13/13' : 'FAIL');
console.log('烟囱起飘高度', smokeHigh.on.smoke.map((unit) => unit.anchorY), smokeLow.on.smoke.map((unit) => unit.anchorY));
console.log('峰值指令', peakCommands);

