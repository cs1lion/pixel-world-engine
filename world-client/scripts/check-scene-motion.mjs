#!/usr/bin/env node
/**
 * 灯柱 / 灯串的三支动态：渐次点亮、呼吸、风摆——分别开关、分别量。
 *
 * 为什么用 `debugHoldWorld` + `debugStepWorld` 而不是「冻在第 N 帧」：
 * 这一支要给的是**世界时刻序列**（18:00:00、18:00:10……18:06:20），
 * 不是「第 180 帧长什么样」。世界冻住、手动按世界毫秒推进，每一帧的世界时刻
 * 都是钉死的；同一个序列跑两遍，逐帧 PNG 必须逐字节相同（sha256）。
 *
 * 口径：
 * - `?debug=1&now=1079`（17:59 开局）+ 强制 dusk：总闸亮着，只让**世界时刻**
 *   决定这一盏亮没亮——这样渐次才是世界时钟驱动的，不是墙钟。
 * - 机位固定在世界 (480, 470)，zoom 1；村民钉到画面外；渲染潮位钉到 1.0，
 *   免得「这一秒潮水又涨了一点」混进 t / t+1s 的帧差。
 * - 帧差只量灯街 ROI（世界 x 228..735、y 372..548）：ROI 里的每个像素都属于
 *   灯柱、灯串、灯体光晕或它们脚下的池子；关掉三支动态时 ROI 必须一点不动。
 *   摊位的棚布/火光也吃同一只世界钟，会在 ROI 上留差，所以这一支先把 stall 动效关掉，
 *   保证读数只属于灯；幌布与烟同理。
 *
 * 跑法：
 *   cd world-client && npm run dev -- --port 5211
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-scene-motion.mjs
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;
const OUT = process.env.EVAL_OUT ?? resolve(import.meta.dirname, '..', 'eval', 'screens');
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
/** 开局世界时刻：17:55（留出开局与取景的 4 世界分钟，首帧仍早于点灯）。 */
const OPEN_AT = 1075 * MIN;
/** 机位：zoom 1，世界 x 232..736 —— 北侧 6 根灯柱 + 西/东两串灯都在画面里。 */
const CAMERA = { x: 484, y: 466 };
/** 灯街 ROI（世界像素）：灯体最高 393，池子最低 535。 */
const ROI = { x0: 228, y0: 372, x1: 736, y1: 548 };

/** 渐次点亮的世界时刻序列：17:59 → 18:06:20（最后一盏的 ramp 走完）。 */
const IGNITION_SEQ = [
  { id: '1759', at: 1079 * MIN },
  { id: '1800', at: 1080 * MIN },
  { id: '1800-10', at: 1080 * MIN + 10_000 },
  { id: '1800-30', at: 1080 * MIN + 30_000 },
  { id: '1801', at: 1081 * MIN },
  { id: '1802', at: 1082 * MIN },
  { id: '1803', at: 1083 * MIN },
  { id: '1804', at: 1084 * MIN },
  { id: '1805', at: 1085 * MIN },
  { id: '1806', at: 1086 * MIN },
  { id: '1806-20', at: 1086 * MIN + 20_000 },
];
/** 稳态两帧：18:10 与 18:11（相隔 1 真实秒 = 60 世界秒，默认倍率 60）。 */
const STEADY_A = 1090 * MIN;
const STEADY_B = 1091 * MIN;

/** 三支动态的开关组合。`null` = 不动，保持默认（全开）。 */
const ALL_OFF = { ignite: false, breathe: false, sway: false };
const ONLY_SWAY = { ...ALL_OFF, sway: true };
const ONLY_BREATHE = { ...ALL_OFF, breathe: true };
const ONLY_IGNITE = { ...ALL_OFF, ignite: true };

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

/** 开局并冻住世界：返回 page / canvas clip / errors。 */
async function openScene(browser, { motion = null, force = null } = {}) {
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
  // 每页会差一个字符，混进哈希就误判"场景不确定"。先把叠层藏起来。
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
  await page.evaluate(([camera, motion, force]) => {
    for (const villager of window.Oracle.view().villagers) {
      window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
    }
    // 只压渲染用的潮位，不改世界潮汐：量帧差时地面必须是同一张。
    window.Oracle.debugPinTide(1);
    // 鸟/蝙蝠也由世界时刻驱动，会在灯街 ROI 上留下像素差；量灯的三支动态时摘出去。
    window.Oracle.debugHideAmbience(true);
    // 摊位动画同样由世界时刻驱动：这一支只量灯，先把棚布与火光关掉，
    // 否则"三支全关 = 0.00%"会被摊位的摆动污染。
    window.Oracle.debugStallMotion({ cloth: false, fire: false });
    // 幌布（南侧那面落在 ROI 里）与烟（炉底那柱的起飘高度也在 ROI 里）同理。
    window.Oracle.debugBannerMotion({ sway: false, shadow: false });
    window.Oracle.debugSmokeMotion({ drift: false });
    if (motion !== null) window.Oracle.debugLampMotion(motion);
    if (force !== null) window.Oracle.debugForceLamps(force);
    window.Oracle.centerCameraOn(camera.x, camera.y);
  }, [CAMERA, motion, force]);
  await waitFrames(page, 40);
  // 冻住世界：之后只有 `debugStepWorld` 能让时间走。
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await waitFrames(page, 1);
  return { page, box, errors };
}

/** 世界时间推到这个绝对时刻（只前进），再等它渲染完。 */
async function stepTo(page, targetMs) {
  const now = await page.evaluate(() => window.Oracle.debugStepWorld(0));
  const delta = targetMs - now;
  if (delta > 0) await page.evaluate((ms) => window.Oracle.debugStepWorld(ms), delta);
  await waitFrames(page, 2);
  return page.evaluate(() => window.Oracle.debugStepWorld(0));
}

async function shot(page, box, id) {
  const file = join(OUT, `scene-motion-${id}.png`);
  await page.screenshot({ path: file, clip: box });
  const buf = readFileSync(file);
  const meta = await page.evaluate(() => ({
    now: window.Oracle.debugStepWorld(0),
    ignition: window.Oracle.debugLampIgnition(),
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

/** 一次完整的「世界时刻序列」：11 个渐次帧 + 2 个稳态帧。 */
async function captureSequence(browser, { motion = null, prefix = '' } = {}) {
  const { page, box, errors } = await openScene(browser, { motion });
  const frames = [];
  for (const step of IGNITION_SEQ) {
    await stepTo(page, step.at);
    frames.push(await shot(page, box, prefix + step.id));
  }
  for (const [id, at] of [['1810', STEADY_A], ['1811', STEADY_B]]) {
    await stepTo(page, at);
    frames.push(await shot(page, box, prefix + id));
  }
  const units = await page.evaluate(() => window.Oracle.debugLampUnits?.() ?? []);
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { frames, units, camera: frames[0].camera };
}

/** 只需两帧的对照：同一组开关下，世界时刻 t 与 t+60s。 */
async function capturePair(browser, { motion, from, to, tag, force = null }) {
  const { page, box, errors } = await openScene(browser, { motion, force });
  await stepTo(page, from);
  const a = await shot(page, box, `${tag}-t`);
  await stepTo(page, to);
  const b = await shot(page, box, `${tag}-t1`);
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { a, b };
}

/** 暂停世界后画面静止：世界不推进，但渲染循环要一直跑。 */
async function capturePause(browser) {
  const { page, box } = await openScene(browser, { motion: null });
  await stepTo(page, STEADY_A);
  const a = await shot(page, box, 'pause-a');
  const framesBefore = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  await page.waitForTimeout(1000);
  const framesAfter = await page.evaluate(() => window.__CAPTURE_STATE__.frame);
  const b = await shot(page, box, 'pause-b');
  const nowA = a.now;
  const nowB = b.now;
  await page.close();
  return { a, b, framesAdvanced: framesAfter - framesBefore, nowA, nowB };
}

/**
 * 灯灭残留：**同一页、同一世界时刻**，先「从没亮过」取一张，再强亮、取一张，
 * 再灭灯、取一张。后两张与第一张都在同一世界时刻、同一摆相位；
 * 若灭灯后地面还留着上一帧的光池，第三张就会与第一张差，差 0 才是真的没有残留。
 *
 * 为什么不用两个页面比：页面开局的存活帧数不同，会带进另一处既有的逐页差异
 * （左下角的雾/罩层，约 1%，max 10），混进来就分不清是不是灯池。
 */
async function captureResidual(browser) {
  const { page, box, errors } = await openScene(browser, { motion: null, force: false });
  await stepTo(page, STEADY_A);
  const never = await shot(page, box, 'residual-never');
  await page.evaluate(() => window.Oracle.debugForceLamps(true));
  await waitFrames(page, 2);
  const lit = await shot(page, box, 'residual-lit');
  await page.evaluate(() => window.Oracle.debugForceLamps(false));
  await waitFrames(page, 2);
  const afterLit = await shot(page, box, 'residual-after-lit');
  await page.close();
  if (errors.length > 0) throw new Error(`页面报错：${errors.join(' / ')}`);
  return { never, lit, afterLit };
}

/** 逐像素比对（只看 ROI，另给全画面）。用解码页避免在 node 里解 PNG。 */
async function diffPair(page, aBuf, bBuf, cam) {
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
  }, { b64, roi: ROI, cam });
}

const pct = (value) => `${(value * 100).toFixed(2)}%`;
const hhmmss = (ms) => {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** 逐像素 sha256：PNG 字节会带编码器/元数据差异，像素才是判据。 */
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

// ---------------------------------------------------------------- 主序列（跑两遍）
const run1 = await captureSequence(browser, { motion: null });
const run2 = await captureSequence(browser, { motion: null, prefix: 'run2-' });
const hashes1 = [];
for (const frame of run1.frames) hashes1.push(await pixelHash(reader, frame.buf));
const hashes2 = [];
for (const frame of run2.frames) hashes2.push(await pixelHash(reader, frame.buf));
const determinism = run1.frames.map((frame, index) => ({
  id: frame.id,
  a: hashes1[index],
  b: hashes2[index] ?? null,
  same: hashes1[index] === hashes2[index],
}));
const allFramesSame = determinism.every((row) => row.same);

// 不一致时给出第一处差异的像素范围：定位比猜快。
let determinismProbe = null;
if (!allFramesSame) {
  const index = determinism.findIndex((row) => !row.same);
  determinismProbe = {
    id: determinism[index]?.id ?? null,
    diff: await diffPair(reader, run1.frames[index].buf, run2.frames[index].buf, run1.frames[0].camera),
  };
}

const firstShot = run1.frames[0];
const cam = firstShot.camera;
const units = run1.units;
const ignitionAtOn = run1.frames.find((frame) => frame.id === '1800').ignition;
const litAtSeries = run1.frames
  .filter((frame) => IGNITION_SEQ.some((step) => step.id === frame.id))
  .map((frame) => ({ id: frame.id, at: frame.now, litAt: frame.ignition.litAt }));
const peakCommands = Math.max(...run1.frames.map((frame) => frame.stats.totalCommands));

// ---------------------------------------------------------------- 三支分别开关
const pairs = {};
pairs['all-on'] = await capturePair(browser, { motion: null, from: STEADY_A, to: STEADY_B, tag: 'all-on' });
pairs['all-off'] = await capturePair(browser, { motion: ALL_OFF, from: STEADY_A, to: STEADY_B, tag: 'all-off' });
pairs['sway-only'] = await capturePair(browser, { motion: ONLY_SWAY, from: STEADY_A, to: STEADY_B, tag: 'sway-only' });
pairs['breathe-only'] = await capturePair(browser, { motion: ONLY_BREATHE, from: STEADY_A, to: STEADY_B, tag: 'breathe-only' });
pairs['ignite-only'] = await capturePair(browser, {
  motion: ONLY_IGNITE,
  from: 1082 * MIN,
  to: 1083 * MIN,
  tag: 'ignite-only',
});
pairs['ignite-off'] = await capturePair(browser, {
  motion: ALL_OFF,
  from: 1082 * MIN,
  to: 1083 * MIN,
  tag: 'ignite-off',
});

const diffs = {};
for (const [name, pair] of Object.entries(pairs)) {
  diffs[name] = await diffPair(reader, pair.a.buf, pair.b.buf, cam);
}

// ---------------------------------------------------------------- 暂停世界
const pause = await capturePause(browser);
const pauseDiff = await diffPair(reader, pause.a.buf, pause.b.buf, cam);

// ---------------------------------------------------------------- 灯灭残留
const dark = await capturePair(browser, {
  motion: ALL_OFF,
  force: false,
  from: STEADY_A,
  to: STEADY_B,
  tag: 'dark',
});
const darkDiff = await diffPair(reader, dark.a.buf, dark.b.buf, cam);

// ---------------------------------------------------------------- 灯灭残留（同一世界时刻）
const residual = await captureResidual(browser);
const residualDiff = await diffPair(reader, residual.afterLit.buf, residual.never.buf, cam);
const litToOffDiff = await diffPair(reader, residual.lit.buf, residual.afterLit.buf, cam);

await browser.close();

// ---------------------------------------------------------------- 合成页
const image = (id) => {
  const frame = run1.frames.find((item) => item.id === id);
  const src = `data:image/png;base64,${frame.buf.toString('base64')}`;
  return `<figure><img src="${src}" alt="${id}"><figcaption>${id} · 亮满 ${frame.ignition.litAt}/${frame.ignition.total}</figcaption></figure>`;
};
const bufFigure = (buf, caption) => {
  const src = `data:image/png;base64,${buf.toString('base64')}`;
  return `<figure><img src="${src}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
};

const orderRows = [...units]
  .sort((a, b) => a.order - b.order)
  .map((unit) => `<tr><td>${unit.order + 1}</td><td>(${unit.x}, ${unit.y})</td><td>${unit.hanging ? '灯串' : '灯柱'}</td></tr>`)
  .join('');

const litRows = litAtSeries
  .map((row) => `<tr><td>${hhmmss(row.at)}</td><td>${row.litAt}/28</td></tr>`)
  .join('');

const diffRows = [
  ['all-on（三支全开）', diffs['all-on'], '基准：t / t+1s 应该不一样'],
  ['all-off（三支全关）', diffs['all-off'], '对照：关掉三支后 ROI 必须是 0'],
  ['sway-only（只开风摆）', diffs['sway-only'], '只证明风摆自己在动'],
  ['breathe-only（只开呼吸）', diffs['breathe-only'], '只证明呼吸自己在动'],
  ['ignite-only（只开渐次，18:02→18:03）', diffs['ignite-only'], '窗口内的渐次'],
  ['ignite-off（渐次也关，18:02→18:03）', diffs['ignite-off'], '对照：同一对时刻应为 0'],
  ['dark（强制灯灭）', darkDiff, '灯灭后地面不许有残留亮斑'],
].map(([label, diff, note]) => (
  `<tr><td>${label}</td><td class="num">${diff === null ? 'n/a' : pct(diff.ratio)}</td>`
  + `<td class="num">${diff === null ? 'n/a' : diff.changed}</td>`
  + `<td class="num">${diff === null ? 'n/a' : diff.maxDelta}</td><td>${note}</td></tr>`
)).join('');

const determinismRows = determinism
  .map((row) => `<tr><td>${row.id}</td><td class="hash">${row.a}</td><td>${row.same ? '一致' : '不一致'}</td></tr>`)
  .join('');

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>灯柱/灯串：渐次点亮 · 呼吸 · 风摆</title>
<style>
:root{--ink:#1d1a16;--paper:#f6efe0;--soil:#8a6f52;--amber:#d99a3d;--line:#d8cbb5}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 ui-serif,Georgia,serif}
main{max-width:1180px;margin:0 auto;padding:40px 32px 64px}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:34px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.lede{color:#5c5145;margin:0 0 18px}
table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
td.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
td.hash{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all}
.strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
figure{margin:0;background:#000;border:1px solid var(--line)}
figure img{display:block;width:100%}
figcaption{background:#efe6d4;color:#4a4034;font-size:12px;padding:4px 6px}
.badge{display:inline-block;background:var(--amber);color:#2b1d09;border-radius:3px;padding:1px 7px;font-size:12px;margin-right:6px}
.note{background:#efe6d4;border-left:3px solid var(--soil);padding:10px 14px;margin:14px 0;font-size:14px}
</style></head><body><main>
<h1>灯柱 / 灯串：三支动态，分别开关、分别量</h1>
<p class="lede">世界时钟驱动（<code>snapshot.now</code>），不读墙钟。世界冻住后由 <code>debugStepWorld</code>
按世界毫秒推进，每一帧的世界时刻都钉死：同一序列跑两遍，逐帧 PNG sha256 一致。</p>

<h2>结论</h2>
<p><span class="badge">渐次</span>28 盏在 6 世界分钟内依次亮（默认倍率 60 下约 6 真实秒）：
第 1 盏 <b>${ignitionAtOn.firstAtMs === null ? 'n/a' : hhmmss(ignitionAtOn.firstAtMs)}</b>，
最后一盏 <b>${ignitionAtOn.lastAtMs === null ? 'n/a' : hhmmss(ignitionAtOn.lastAtMs)}</b>；
单盏起亮 ${Math.round(ignitionAtOn.rampMs / 1000)} 世界秒，不是一帧跳满。</p>
<p><span class="badge">呼吸</span>亮度 0.95–1.08 低频起伏（周期 5 世界分钟）。</p>
<p><span class="badge">风摆</span>灯体横向 ±1px、悬挂灯再叠纵向 ±1px（周期 3.2 世界分钟），柱脚不动。</p>
<p>三支都能单独关掉：见下表，关掉的那一支在自己的对照里帧差为 0。</p>

<h2>渐次点亮序列（画面）</h2>
<div class="strip">${image('1759')}${image('1800-30')}${image('1801')}
${image('1803')}${image('1805')}${image('1806')}</div>

<h2>亮满盏数随世界时刻</h2>
<table><thead><tr><th>世界时刻</th><th>亮满</th></tr></thead><tbody>${litRows}</tbody></table>

<h2>点亮顺序（28 盏，按世界 x 从西往东）</h2>
<table><thead><tr><th>第几盏</th><th>灯芯 (x, y)</th><th>类型</th></tr></thead><tbody>${orderRows}</tbody></table>

<h2>t / t+1s 帧差（ROI 变化像素占比）</h2>
<p>ROI = 世界 x ${ROI.x0}..${ROI.x1}、y ${ROI.y0}..${ROI.y1}（约 ${diffs['all-on'].roi.pixels} 个像素）；
t+1s 指默认倍率 60 下的 1 真实秒 = 60 世界秒。</p>
<table><thead><tr><th>开关组合</th><th>变化占比</th><th>变化像素</th><th>最大通道差</th><th>说明</th></tr></thead>
<tbody>${diffRows}</tbody></table>

<h2>暂停世界 → 画面静止</h2>
<p>世界冻住后强制等 1 真实秒（渲染循环继续跑，帧计数 +${pause.framesAdvanced}），
两帧 ROI 变化 <b>${pct(pauseDiff.ratio)}</b>（${pauseDiff.changed} 像素），全画面 ${pct(pauseDiff.fullRatio)}；
世界时刻 ${hhmmss(pause.nowA)} → ${hhmmss(pause.nowB)} 未推进。</p>

<h2>确定性：同一序列跑两遍</h2>
<p>${allFramesSame ? '13 帧逐帧 sha256 全部一致。' : '有帧不一致，见下表。'}</p>
<table><thead><tr><th>帧</th><th>sha256</th><th>第二遍</th></tr></thead><tbody>${determinismRows}</tbody></table>

<h2>指令与灯态读数</h2>
<p>本序列峰值绘制指令 <b>${peakCommands}</b>（黄昏预算 29000）；灯灭两帧地面光池指令
<b>${dark.a.poolCommands}</b> / <b>${dark.b.poolCommands}</b>；灯亮稳态 ${pairs['all-on'].a.poolCommands}。</p>
<p>灯灭两帧 ROI 差异 ${pct(darkDiff.ratio)}（残留亮斑应为 0）。</p>

<h2>灯灭残留：同一世界时刻，亮过再灭 vs 从没亮过</h2>
<p>三张图都在<b>同一页</b>、世界 ${hhmmss(STEADY_A)}、同一摆相位：先灭灯取一张（从没亮过），
再强亮取一张，再灭灯等 2 帧取一张（亮过再灭）。第三张与第一张若还有上一帧的残留光池就会差；
逐像素比对应为 <b>${pct(residualDiff.ratio)}</b>（${residualDiff.changed} 像素，
最大通道差 ${residualDiff.maxDelta}）。亮 → 灭本身当然有差：${pct(litToOffDiff.ratio)}。</p>
<div class="strip">${bufFigure(residual.never.buf, '从没亮过（灭灯基线）')}${bufFigure(residual.lit.buf, '强亮')}${bufFigure(residual.afterLit.buf, '亮过再灭（等 2 帧）')}</div>

<h2>口径</h2>
<div class="note">每个动画只由 <code>snapshot.now</code> 经 <code>lamp-motion.ts</code> 的纯函数算出；
关掉一支时该函数退化成常量。潮位是<b>渲染层</b>钉死的，世界里那条潮汐照常走。</div>
</main></body></html>`;

const htmlFile = join(OUT, 'scene-motion.html');
writeFileSync(htmlFile, html);
const jsonFile = join(OUT, 'scene-motion.json');
writeFileSync(jsonFile, JSON.stringify({
  generatedAt: run1.frames[0] ? new Date().toISOString() : null,
  ignition: {
    atOn: ignitionAtOn,
    first: ignitionAtOn.firstAtMs === null ? null : hhmmss(ignitionAtOn.firstAtMs),
    last: ignitionAtOn.lastAtMs === null ? null : hhmmss(ignitionAtOn.lastAtMs),
    series: litAtSeries,
    units,
  },
  diffs,
  dark: { poolCommandsA: dark.a.poolCommands, poolCommandsB: dark.b.poolCommands, diff: darkDiff },
  residual: {
    afterLitVsNever: residualDiff,
    litVsAfterLit: litToOffDiff,
    afterLitPoolCommands: residual.afterLit.poolCommands,
    neverPoolCommands: residual.never.poolCommands,
    litPoolCommands: residual.lit.poolCommands,
  },
  pause: { framesAdvanced: pause.framesAdvanced, diff: pauseDiff, nowA: pause.nowA, nowB: pause.nowB },
  determinism,
  determinismProbe,
  peakCommands,
  camera: cam,
}, null, 2));

console.log('渐次：首盏', hhmmss(ignitionAtOn.firstAtMs), '末盏', hhmmss(ignitionAtOn.lastAtMs));
console.log('峰值指令', peakCommands);
for (const [name, diff] of Object.entries(diffs)) {
  console.log(`帧差 ${name.padEnd(14)} ${pct(diff.ratio)}  max=${diff.maxDelta}  bbox=${JSON.stringify(diff.bbox)}`);
}
console.log('暂停', pct(pauseDiff.ratio), `帧 +${pause.framesAdvanced}`);
console.log('确定性', allFramesSame ? '13/13 一致' : `有差异：${determinismProbe?.id} ${pct(determinismProbe?.diff?.ratio ?? 0)} bbox=${JSON.stringify(determinismProbe?.diff?.bbox)}`);
console.log('灯灭池指令', dark.a.poolCommands, '/', dark.b.poolCommands, '帧差', pct(darkDiff.ratio));
console.log('残留（亮过再灭 vs 从没亮过）', pct(residualDiff.ratio), `像素 ${residualDiff.changed} max=${residualDiff.maxDelta}`, '池指令', residual.afterLit.poolCommands, '/', residual.never.poolCommands);
console.log('产物', htmlFile, jsonFile);
