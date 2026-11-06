#!/usr/bin/env node
/**
 * 摊位 6 件：棚布摆动、雨天盖布摆动、火盆火光跳动——分别开关、分别量。
 *
 * 口径与灯街那条（`check-scene-motion.mjs`）一致：
 * - 世界冻住后用 `debugStepWorld` 按世界毫秒推进；t / t+1s 相隔 60 世界秒
 *   （默认倍率 60 下是 1 真实秒）。同一时刻 → 同一帧；逐帧像素 sha256 判确定性。
 * - 灯街三支动态全关（`debugLampMotion(ALL_OFF)`），否则灯的呼吸/风摆会混进摊位 ROI。
 * - 只量摊位 ROI（世界 x 225..575、y 390..555）：5 个摊位的棚布、盖布、火盆都在里面。
 * - 「火光是否落到地面」用同一页、同一世界时刻的开关对照；不跨页比，
 *   免得把既有的逐页雾罩差异（约 1%、max 10）算进火光。
 * - 雨幕由帧间隔驱动，世界冻住时它仍会动，不能进帧差；所以：
 *   · 真实雨态只取**单帧**与读数（证明 packed=true、盖布在摆、棚布不摆）；
 *   · 盖布的 t / t+1s 像素差用「晴天 + 钉死已盖」的同一态量布料本身。
 *
 * 跑法：
 *   cd world-client && npm run dev -- --port 5211
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-stall-motion.mjs
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5211/';
const OUT = process.env.EVAL_OUT ?? resolve(import.meta.dirname, '..', 'eval', 'screens');
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const STEADY_A = 1090 * MIN;
const STEADY_B = 1091 * MIN;
/** 机位：世界 x 160..640 —— 西侧 5 个摊位都在画面里。 */
const CAMERA = { x: 400, y: 470 };
/** 摊位 ROI：棚布最高 y≈402，火盆最低 y≈435，横向 x 237..572。 */
const ROI = { x0: 225, y0: 390, x1: 575, y1: 555 };
/** 火盆脚下的地面取样点（摊位 (17,26) 的火盆正下方）。 */
const GROUND_ROI = { x0: 289, y0: 436, x1: 298, y1: 441 };

const LAMPS_OFF = { ignite: false, breathe: false, sway: false };
const BOTH_OFF = { cloth: false, fire: false };
const ONLY_CLOTH = { cloth: true, fire: false };
const ONLY_FIRE = { cloth: false, fire: true };
const BOTH_ON = { cloth: true, fire: true };

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

/** 开局、钉住世界：灯全关动态、村民出画、潮位钉 1、鸟藏起。 */
async function openScene(browser, { stalls = null, packed = null, weather = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(initScript, { freezeAt: 0 });
  await page.goto(
    `${BASE}?world=dengchao&time=dusk&feed=off&ledger=off&debug=1&now=1075`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });
  const canvas = page.locator('canvas').first();
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('找不到 canvas');

  // `screenshot({clip})` 截的是页面区域，DOM 叠层也在里面：顶栏的在线状态/帧计数
  // 每页会差一个字符（12 像素、max 3），混进哈希就误判"场景不确定"。先把叠层藏起来。
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
  await page.evaluate(([camera, stalls]) => {
    for (const villager of window.Oracle.view().villagers) {
      window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
    }
    window.Oracle.debugPinTide(1);
    window.Oracle.debugHideAmbience(true);
    // 灯的三支动态全关：量摊位时 ROI 里只允许摊位在动。
    window.Oracle.debugLampMotion({ ignite: false, breathe: false, sway: false });
    // 幌布与烟也在 ROI 里（第三条加的），量摊位时必须一起关：
    // 它们随世界时刻摆动/漂移，t 与 t+1s 不是同相，会把「全关」从 0.00% 抬到 0.08%。
    window.Oracle.debugBannerMotion({ sway: false, shadow: false });
    window.Oracle.debugSmokeMotion({ drift: false });
    if (stalls !== null) window.Oracle.debugStallMotion(stalls);
    window.Oracle.centerCameraOn(camera.x, camera.y);
  }, [CAMERA, stalls]);
  await waitFrames(page, 40);
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await waitFrames(page, 1);
  if (packed !== null) {
    await page.evaluate((on) => window.Oracle.debugForcePacked(on), packed);
  }
  if (weather !== null) {
    await page.evaluate((value) => window.Oracle.debugSetWeather(value), weather);
  }
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
  const file = join(OUT, `stall-motion-${id}.png`);
  await page.screenshot({ path: file, clip: box });
  const buf = readFileSync(file);
  const meta = await page.evaluate(() => ({
    now: window.Oracle.debugStepWorld(0),
    frame: window.__CAPTURE_STATE__.frame,
    stalls: window.Oracle.debugStallUnits(),
    stats: window.Oracle.renderStats(),
    poolCommands: window.Oracle.debugLampPool(),
    camera: window.Oracle.camera(),
  }));
  return {
    id,
    file,
    buf,
    sha256: createHash('sha256').update(buf).digest('hex'),
    ...meta,
  };
}

/** t / t+1s：同一组开关、同一页，只让世界时间走 60 秒。 */
async function capturePair(browser, { stalls, packed = null, from, to, tag }) {
  const { page, box, errors } = await openScene(browser, { stalls, packed });
  const a = await (stepTo(page, from).then(() => shot(page, box, `${tag}-t`)));
  await stepTo(page, to);
  const b = await shot(page, box, `${tag}-t1`);
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { a, b };
}

/** 同一页、同一世界时刻：火光从开到关，取地面取样点的变化。 */
async function captureFireGround(browser) {
  const { page, box, errors } = await openScene(browser, { stalls: ONLY_FIRE });
  await stepTo(page, STEADY_A);
  const on = await shot(page, box, 'fire-on');
  await page.evaluate(() => window.Oracle.debugStallMotion({ cloth: false, fire: false }));
  await waitFrames(page, 2);
  const off = await shot(page, box, 'fire-off');
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { on, off };
}

async function capturePause(browser) {
  const { page, box } = await openScene(browser, { stalls: BOTH_ON });
  await stepTo(page, STEADY_A);
  const a = await shot(page, box, 'pause-a');
  const framesBefore = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  await page.waitForTimeout(1000);
  const framesAfter = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  const b = await shot(page, box, 'pause-b');
  await page.close();
  return { a, b, framesAdvanced: framesAfter - framesBefore, nowA: a.now, nowB: b.now };
}

async function diffPair(page, aBuf, bBuf, cam, roi = ROI) {
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

// ---------------------------------------------------------------- 晴：分别开关
const pairs = {};
pairs['both-on'] = await capturePair(browser, { stalls: BOTH_ON, from: STEADY_A, to: STEADY_B, tag: 'both-on' });
pairs['only-cloth'] = await capturePair(browser, { stalls: ONLY_CLOTH, from: STEADY_A, to: STEADY_B, tag: 'only-cloth' });
pairs['only-fire'] = await capturePair(browser, { stalls: ONLY_FIRE, from: STEADY_A, to: STEADY_B, tag: 'only-fire' });
pairs['both-off'] = await capturePair(browser, { stalls: BOTH_OFF, from: STEADY_A, to: STEADY_B, tag: 'both-off' });

const cam = pairs['both-on'].a.camera;
const diffs = {};
for (const [name, pair] of Object.entries(pairs)) {
  diffs[name] = await diffPair(reader, pair.a.buf, pair.b.buf, cam);
}

// ---------------------------------------------------------------- 雨：盖布摆动（钉死已盖，晴天底）
pairs['cover-on'] = await capturePair(browser, {
  stalls: ONLY_CLOTH,
  packed: true,
  from: STEADY_A,
  to: STEADY_B,
  tag: 'cover-on',
});
pairs['cover-off'] = await capturePair(browser, {
  stalls: BOTH_OFF,
  packed: true,
  from: STEADY_A,
  to: STEADY_B,
  tag: 'cover-off',
});
diffs['cover-on'] = await diffPair(reader, pairs['cover-on'].a.buf, pairs['cover-on'].b.buf, cam);
diffs['cover-off'] = await diffPair(reader, pairs['cover-off'].a.buf, pairs['cover-off'].b.buf, cam);

// ---------------------------------------------------------------- 雨：真实天气的单帧与读数
const rain = await openScene(browser, { stalls: BOTH_ON, weather: 'rain' });
await stepTo(rain.page, STEADY_A);
const rainShot = await shot(rain.page, rain.box, 'rain');
const rainUnits = rainShot.stalls;
const dryUnits = pairs['both-on'].a.stalls;
await rain.page.close();

// ---------------------------------------------------------------- 火光与地面：同一页开关
const fireGround = await captureFireGround(browser);
const fireDiff = await diffPair(reader, fireGround.on.buf, fireGround.off.buf, cam);
const fireGroundDiff = await diffPair(reader, fireGround.on.buf, fireGround.off.buf, cam, GROUND_ROI);

// ---------------------------------------------------------------- 暂停世界
const pause = await capturePause(browser);
const pauseDiff = await diffPair(reader, pause.a.buf, pause.b.buf, cam);

// ---------------------------------------------------------------- 确定性：同一对序列跑两遍
const repeat = await capturePair(browser, { stalls: ONLY_CLOTH, from: STEADY_A, to: STEADY_B, tag: 'repeat' });
const hashesA = [await pixelHash(reader, pairs['only-cloth'].a.buf), await pixelHash(reader, pairs['only-cloth'].b.buf)];
const hashesB = [await pixelHash(reader, repeat.a.buf), await pixelHash(reader, repeat.b.buf)];
const determinism = hashesA.map((hash, index) => ({ frame: index, a: hash, b: hashesB[index] ?? null, same: hash === hashesB[index] }));
const allSame = determinism.every((row) => row.same);
// 不一致时给出第一处差异的像素范围：定位比猜快。
const determinismProbe = allSame
  ? null
  : await diffPair(
      reader,
      pairs['only-cloth'].a.buf,
      repeat.a.buf,
      cam,
      { x0: 0, y0: 0, x1: 9999, y1: 9999 },
    );

await browser.close();

const peakCommands = Math.max(
  ...Object.values(pairs).flatMap((pair) => [pair.a.stats.totalCommands, pair.b.stats.totalCommands]),
  fireGround.on.stats.totalCommands,
  fireGround.off.stats.totalCommands,
  pause.a.stats.totalCommands,
);
const peakRainCommands = rainShot.stats.totalCommands;

const coverDx = rainUnits.covers.map((unit) => unit.dx);
const awningSway = rainUnits.stalls.map((unit) => unit.awningSway);
const coverMoving = coverDx.some((dx) => dx !== 0);
const awningStill = awningSway.every((dx) => dx === 0);

// ---------------------------------------------------------------- 合成页
const bufFigure = (buf, caption) => {
  const src = `data:image/png;base64,${buf.toString('base64')}`;
  return `<figure><img src="${src}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
};
const diffRows = Object.entries(diffs)
  .map(([name, value]) => `<tr><td>${name}</td><td>${pct(value.ratio)}</td><td>${value.changed}</td><td>${value.maxDelta}</td></tr>`)
  .join('');

const stallRows = rainUnits.stalls
  .map((unit) => `<tr><td>${unit.order}</td><td>(${unit.x}, ${unit.y})</td><td>${unit.awningSway}</td><td>${unit.fireLevel.toFixed(2)}</td><td>${unit.fireHeight}</td></tr>`)
  .join('');
const coverRows = rainUnits.covers
  .map((unit) => `<tr><td>${unit.order}</td><td>${unit.dx}</td><td>${unit.droop}</td></tr>`)
  .join('');

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>摊位动态证据</title>
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
<h1>摊位 6 件 · 棚布 / 盖布 / 火光</h1>
<p>世界 ${hhmmss(STEADY_A)} → ${hhmmss(STEADY_B)}（相隔 60 世界秒），机位世界 (${CAMERA.x}, ${CAMERA.y})，zoom 1。
灯的三支动态在全过程关闭，ROI 只允许摊位动；村民出画、潮位钉 1、鸟藏起。</p>

<h2>可数量：t / t+1s 帧差（ROI ${ROI.x0}..${ROI.x1}, ${ROI.y0}..${ROI.y1}）</h2>
<table><thead><tr><th>开关</th><th>变化占比</th><th>变化像素</th><th>最大通道差</th></tr></thead><tbody>${diffRows}</tbody></table>
<p>只开棚布、只开火光时都有差，全部关掉 <b>${pct(diffs['both-off'].ratio)}</b>；
盖布态只开布料有差 <b>${pct(diffs['cover-on'].ratio)}</b>，关掉布料 <b>${pct(diffs['cover-off'].ratio)}</b>。</p>

<h2>火盆与地面（同一页、同一世界时刻）</h2>
<p>摊位 ROI 内火光开关差 <b>${pct(fireDiff.ratio)}</b>（${fireDiff.changed} 像素，max ${fireDiff.maxDelta}）；
火盆脚下地面取样点（世界 ${GROUND_ROI.x0}..${GROUND_ROI.x1}, ${GROUND_ROI.y0}..${GROUND_ROI.y1}）
差 <b>${pct(fireGroundDiff.ratio)}</b>（${fireGroundDiff.changed} 像素）。火光不投地面光池，
所以夜街光带读数不被这条动画改写；灯池指令本帧仍为 ${fireGround.on.poolCommands}（灯亮态）。</p>
<div class="strip">${bufFigure(fireGround.on.buf, '火光开')}${bufFigure(fireGround.off.buf, '火光关（同一世界时刻）')}</div>

<h2>晴 / 雨两态：摆动对象交接</h2>
<p>晴：<code>packed=false</code>，摆的是棚布；雨：<code>packed=true</code>，棚布定住、摆的是盖布。
真实雨态（同样在世界 ${hhmmss(STEADY_A)}）读数：天气 <b>${rainUnits.weather}</b>、已盖 <b>${rainUnits.packed}</b>、
棚布摆幅全为 0 <b>${awningStill}</b>、盖布在摆 <b>${coverMoving}</b>（dx = ${JSON.stringify(coverDx)}）。
干态棚布摆幅 ${JSON.stringify(dryUnits.stalls.map((unit) => unit.awningSway))}。</p>
<div class="strip">${bufFigure(pairs['both-on'].a.buf, '晴：棚布在摆')}${bufFigure(pairs['cover-on'].a.buf, '已盖：盖布在摆（晴天底，只为量布料）')}${bufFigure(rainShot.buf, '真实雨态：盖布落下')}</div>
<p>盖布的像素差用「晴天 + 钉死已盖」量：雨幕由帧间隔驱动，世界冻住时它仍会动，混进帧差就不是布在动了。</p>
<table><thead><tr><th>摊位</th><th>坐标</th><th>棚布摆幅 px</th><th>火光亮度</th><th>焰高 px</th></tr></thead><tbody>${stallRows}</tbody></table>
<table><thead><tr><th>摊位</th><th>盖布 dx</th><th>下沿下垂</th></tr></thead><tbody>${coverRows}</tbody></table>

<h2>确定性与暂停</h2>
<p>同一条「只开棚布」序列跑两遍、逐帧像素 sha256：<b>${allSame ? '2/2 一致' : `有差异（首差 ${pct(determinismProbe?.ratio ?? 0)}，bbox ${JSON.stringify(determinismProbe?.bbox ?? null)}）`}</b>。
冻住世界后等 1 真实秒（渲染帧 +${pause.framesAdvanced}），世界时刻 ${hhmmss(pause.nowA)} → ${hhmmss(pause.nowB)}，
ROI 变化 <b>${pct(pauseDiff.ratio)}</b>、全画面 <b>${pct(pauseDiff.fullRatio)}</b>。</p>

<h2>指令</h2>
<p>本条黄昏峰值绘制指令（晴） <b>${peakCommands}</b>、真实雨态单帧 <b>${peakRainCommands}</b>（预算 29000）。</p>
</body></html>`;

writeFileSync(join(OUT, 'stall-motion.html'), html);
writeFileSync(
  join(OUT, 'stall-motion.json'),
  `${JSON.stringify({
    at: { a: STEADY_A, b: STEADY_B },
    camera: CAMERA,
    roi: ROI,
    groundRoi: GROUND_ROI,
    diffs,
    fire: { diff: fireDiff, groundDiff: fireGroundDiff, poolCommands: fireGround.on.poolCommands },
    rain: { weather: rainUnits.weather, packed: rainUnits.packed, covers: rainUnits.covers, stalls: rainUnits.stalls },
    dry: { packed: dryUnits.packed, stalls: dryUnits.stalls },
    pause: { diff: pauseDiff, framesAdvanced: pause.framesAdvanced, nowA: pause.nowA, nowB: pause.nowB },
    determinism,
    determinismProbe,
    peakCommands,
    peakRainCommands,
  }, null, 2)}\n`,
);

console.log('帧差', Object.fromEntries(Object.entries(diffs).map(([name, value]) => [name, pct(value.ratio)])));
console.log('火光', pct(fireDiff.ratio), '地面', pct(fireGroundDiff.ratio));
console.log('雨态', rainUnits.weather, 'packed', rainUnits.packed, '棚布摆幅', JSON.stringify(awningSway), '盖布 dx', JSON.stringify(coverDx));
console.log('暂停', pct(pauseDiff.ratio), '帧 +', pause.framesAdvanced, '确定性', allSame ? '2/2' : 'FAIL');
if (determinismProbe !== null) {
  console.log('确定性首差', pct(determinismProbe.ratio), '像素', determinismProbe.changed, 'max', determinismProbe.maxDelta, 'bbox', JSON.stringify(determinismProbe.bbox));
}
console.log('帧号', pairs['only-cloth'].a.frame, pairs['only-cloth'].b.frame, '/', repeat.a.frame, repeat.b.frame);
console.log('峰值指令 晴', peakCommands, '雨', peakRainCommands);
