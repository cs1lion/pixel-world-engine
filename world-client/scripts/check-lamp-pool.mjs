#!/usr/bin/env node
/**
 * 街面光池的证据脚本：同一冻结帧、同一机位，取「灯亮 / 灯灭」两态的地面读数，
 * 再沿街取距灯 0/1/2/3/4/6 格的衰减，最后给两档潮位的对照截图。
 *
 * 为什么必须在同一帧里换灯态：日夜两拍之间，雾、水、蒸汽都在动，直接比两张
 * 「白天 / 晚上」的图，读到的是相位差不是灯。`debugForceLamps` 只压过渲染层
 * 的灯态，世界时钟与快照都不动，所以两张图只差光池这一层。
 *
 * 取样页把村民钉到画面外（`debugPinVillager` 的调试摆位，只改画面）：
 * 读的是地面光池，不能让人挡住取样点。潮位对照页同样处理，理由同上。
 *
 * 跑法：
 *   cd world-client && npm run dev
 *   PIXEL_WORLD_URL=http://127.0.0.1:5200/ node scripts/check-lamp-pool.mjs
 *
 * 端口可用 `PIXEL_WORLD_URL` 覆盖；截图目录用 `EVAL_OUT` 覆盖。
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';
const OUT = process.env.EVAL_OUT ?? resolve(import.meta.dirname, '..', 'eval', 'screens');
mkdirSync(OUT, { recursive: true });

/** 冻结帧：180 帧 ≈ 3s 世界时间；随机数与时间都锁在帧号上。 */
const SETUP_AT = 80;
/** 灯态/潮位在冻结前 10 帧落下：世界的「潮位」覆盖只保 60s 世界时间，
 *  它跑得比墙钟快（这里约 70 倍），提前太多就过期了。 */
const ACTION_AT = 170;
const FREEZE_AT = 180;

/** 取样点：`lamp_post_10`（51,32）池心右侧半格（832,522）——在池芯里，又避开灯柱本体。 */
const SAMPLE = { x: 832, y: 522 };
/** 衰减测量：同一条灯柱，沿池心那条地平线 y=522 向右取 0.5..6 格。 */
const CURVE = { lampX: 51, lampY: 32, y: 522 };
/** 取样距离（格）：0.5 起是为了避开灯柱，末端 4/6 格用来证明光真的衰减到零。
 *  2.5 格是外圈半径（40px）落点，用它证明「2 格不再是 0」的接缝已经被填上。 */
const DISTANCES = [0.5, 1, 1.5, 2, 2.5, 3, 4, 6];
/** 潮位对照机位：贴着取样点看同一片池子在退潮/满潮两态的大小与亮度。 */
const STREET = SAMPLE;

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
      // 冻在这一帧本身：帧号走满就把后续 rAF 全拒掉，画面停在 freezeAt 那一刻。
      if (state.frame >= freezeAt) {
        state.frozen = true;
        cb(state.frame * frameMs);
        return;
      }
      cb(state.frame * frameMs);
    });
  };
}

/** 一页 = 一态：同种子、同帧号、只换灯态 / 潮位。 */
async function capture(browser, { id, force, tide, camera, zoom }) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(initScript, { freezeAt: FREEZE_AT });
  await page.goto(`${BASE}?world=dengchao&time=night&feed=off&ledger=off`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });

  const canvas = page.locator('canvas').first();
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('找不到 canvas');

  await page.waitForFunction((n) => window.__CAPTURE_STATE__.frame >= n, SETUP_AT, { timeout: 30000 });
  // 滚轮以指针为中心，先对准画布中心，再 centerCameraOn 把取样区挪到中心。
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 4; step += 1) {
    const now = await page.evaluate(() => window.Oracle.camera().zoom);
    if (now >= zoom) break;
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(160);
  }
  await page.evaluate(([x, y]) => window.Oracle.centerCameraOn(x, y), [camera.x, camera.y]);
  // 天气必须钉：新世界的天气按当日种子排，雨天雨点逐帧乱飘，单个地面取样点也会被雨点盖住。
  // 口子不在（拿 39cff04 基线对着同一份脚本跑时）就跳过，并把这个事实记进读数。
  const pinned = await page.evaluate(() => {
    const weather = typeof window.Oracle.debugSetWeather === 'function';
    if (weather) window.Oracle.debugSetWeather('clear');
    return weather;
  });

  await page.waitForFunction((n) => window.__CAPTURE_STATE__.frame >= n, ACTION_AT, { timeout: 30000 });
  const applied = await page.evaluate(({ force, tide }) => {
    // 村民钉到画面外：取样页只读地面，不让人挡住取样点。
    if (force !== null || tide !== null) {
      for (const villager of window.Oracle.view().villagers) {
        window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
      }
    }
    if (force !== null) window.Oracle.debugForceLamps(force);
    if (tide !== null) window.Oracle.say(`潮位 ${tide}%`);
    return { force, tide };
  }, { force: force ?? null, tide: tide ?? null });

  await page.waitForFunction(() => window.__CAPTURE_STATE__.frozen === true, null, { timeout: 20000 });
  await page.waitForTimeout(300);

  const cam = await page.evaluate(() => window.Oracle.camera());
  const stats = await page.evaluate(() => window.Oracle.renderStats());
  const tideLevel = await page.evaluate(() => window.Oracle.view().tide.level);
  const villagers = await page.evaluate(() => window.Oracle.view().villagers.length);
  const weather = await page.evaluate(() => window.Oracle.view().weather);

  const clip = zoom >= 2
    ? { x: box.x + box.width / 2 - 240, y: box.y + box.height / 2 - 160, width: 480, height: 320 }
    : { x: box.x, y: box.y, width: box.width, height: box.height };
  const file = join(OUT, `lamp-pool-${id}.png`);
  await page.screenshot({ path: file, clip });
  const buf = readFileSync(file);

  const shots = { id, file, buf, cam, stats, tideLevel, zoom, clip, clipOffsetX: zoom >= 2 ? 240 : 0, clipOffsetY: zoom >= 2 ? 160 : 0, errors, applied, villagers, weather, pinned };
  await page.close();
  return shots;
}

/** 截图内的像素取样：把 PNG 还给浏览器解码，比在 node 里自己解 PNG 稳。 */
async function sample(page, buf, points) {
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64, points }) => {
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
    return points.map((p) => {
      const d = ctx.getImageData(p.x, p.y, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  }, { b64, points });
}

const toLinear = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** 亮度（相对 Y）与色温（McCamy 近似）。两个数都从同一个 8bit 像素算。 */
function measure([r, g, b]) {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const X = 0.4124 * R + 0.3576 * G + 0.1913 * B;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const sum = X + Y + Z;
  const x = sum === 0 ? 0 : X / sum;
  const y = sum === 0 ? 0 : Y / sum;
  const n = (x - 0.332) / (0.1858 - y);
  const cct = 437 * n ** 3 + 3601 * n ** 2 + 6861 * n + 5514.7;
  return { luminance: Y, cct: Math.round(cct), rgb: [r, g, b] };
}

/** 世界像素 → 截图内 CSS 像素（画布 CSS 是逻辑尺寸的 2 倍；近景裁的是画布中心）。 */
const toImage = (shot, wx, wy) => ({
  x: (wx - shot.cam.worldViewX) * 2 * shot.cam.zoom - shot.clipOffsetX,
  y: (wy - shot.cam.worldViewY) * 2 * shot.cam.zoom - shot.clipOffsetY,
});

const browser = await chromium.launch({ headless: true });
const out = {};

try {
  // 1. 灯亮 / 灯灭：同一机位、同一取样点，只换灯态。
  const close = { camera: SAMPLE, zoom: 2 };
  out.lit = await capture(browser, { id: 'lit', force: true, tide: 100, ...close });
  out.dark = await capture(browser, { id: 'dark', force: false, tide: 100, ...close });

  // 2. 衰减：从灯柱脚下向右 0..6 格。
  const curveCam = { camera: { x: CURVE.lampX * 16 + 8, y: CURVE.y }, zoom: 1 };
  out.curveLit = await capture(browser, { id: 'curve-lit', force: true, tide: 100, ...curveCam });
  out.curveDark = await capture(browser, { id: 'curve-dark', force: false, tide: 100, ...curveCam });

  // 3. 两档潮位：同一机位、同一帧，只换潮位。
  out.tideLow = await capture(browser, { id: 'tide-10', force: true, tide: 10, camera: STREET, zoom: 2 });
  out.tideHigh = await capture(browser, { id: 'tide-100', force: true, tide: 100, camera: STREET, zoom: 2 });

  // 取样：每页都用一个临时浏览器页把 PNG 解码回像素。
  const reader = await browser.newPage();
  const sampleAt = async (shot, points) => sample(reader, shot.buf, points);

  const at = toImage(out.lit, SAMPLE.x, SAMPLE.y);
  const samplePoint = [{ x: Math.round(at.x), y: Math.round(at.y) }];
  const [litPixel] = await sampleAt(out.lit, samplePoint);
  const [darkPixel] = await sampleAt(out.dark, samplePoint);
  out.closeReading = { point: at, lit: measure(litPixel), dark: measure(darkPixel) };
  console.log(`[close] image ${Math.round(at.x)},${Math.round(at.y)} lit ${litPixel} dark ${darkPixel}`);

  const distances = DISTANCES;
  const curvePoints = distances.map((d) => {
    const p = toImage(out.curveLit, CURVE.lampX * 16 + 8 + d * 16, CURVE.y);
    return { d, x: Math.round(p.x), y: Math.round(p.y) };
  });
  const litCurve = await sampleAt(out.curveLit, curvePoints.map((p) => ({ x: p.x, y: p.y })));
  const darkCurve = await sampleAt(out.curveDark, curvePoints.map((p) => ({ x: p.x, y: p.y })));
  out.curve = distances.map((d, i) => {
    const l = measure(litCurve[i]);
    const k = measure(darkCurve[i]);
    return { d, lit: l, dark: k, delta: l.luminance - k.luminance, x: curvePoints[i].x, y: curvePoints[i].y };
  });

  const tidePoint = toImage(out.tideLow, SAMPLE.x, SAMPLE.y);
  const [lowPixel] = await sampleAt(out.tideLow, [{ x: Math.round(tidePoint.x), y: Math.round(tidePoint.y) }]);
  const [highPixel] = await sampleAt(out.tideHigh, [{ x: Math.round(tidePoint.x), y: Math.round(tidePoint.y) }]);
  out.tide = {
    low: { level: out.tideLow.tideLevel, value: measure(lowPixel) },
    high: { level: out.tideHigh.tideLevel, value: measure(highPixel) },
    point: tidePoint,
  };

  await reader.close();

  // 并排图：上排灯亮/灯灭，下排潮位两档，右侧是衰减曲线。
  const composite = await browser.newPage({ viewport: { width: 1420, height: 820 }, deviceScaleFactor: 2 });
  const encode = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  const marker = (shot, point, scale = 1) => `
    <div class="dot" style="left:${point.x * scale}px;top:${point.y * scale}px"></div>`;
  const fmt = (m) => `Y ${m.luminance.toFixed(3)} · ${m.cct}K · rgb(${m.rgb.join(',')})`;

  const card = (shot, label, note, w, h, scale = 1, point = null) => `
    <figure style="width:${w}px">
      <div class="frame" style="width:${w}px;height:${h}px">
        <img src="${encode(shot.file)}" alt="${label}" style="width:${w}px;height:${h}px" />
        ${point === null ? '' : marker(shot, point, scale)}
      </div>
      <figcaption><b>${label}</b><br />${note}</figcaption>
    </figure>`;

  const curveMax = Math.max(...out.curve.map((row) => row.delta), 0.0001);
  const barWidth = 30;
  const curveSvg = `
    <svg width="380" height="150" viewBox="0 0 380 150" role="img" aria-label="光池衰减曲线">
      ${out.curve.map((row, i) => {
        const hgt = Math.max(1, Math.round((row.delta / curveMax) * 110));
        const x = 26 + i * 43;
        return `<rect x="${x}" y="${130 - hgt}" width="${barWidth}" height="${hgt}" fill="#f0a44b" />
                <text x="${x + barWidth / 2}" y="146" fill="#8b9691" font-size="11" text-anchor="middle">${row.d} 格</text>
                <text x="${x + barWidth / 2}" y="${124 - hgt}" fill="#d8dad3" font-size="10" text-anchor="middle">${(row.delta * 100).toFixed(1)}</text>`;
      }).join('')}
      <text x="4" y="12" fill="#8b9691" font-size="10">Δ亮度（%Y，亮−灭）</text>
    </svg>`;

  await composite.setContent(
    `<!doctype html><meta charset="utf-8" />
     <style>
       body { margin: 0; background: #0f1216; color: #d8dad3;
              font: 13px/1.6 "Microsoft YaHei", "Noto Sans SC", sans-serif; }
       h1 { font-size: 15px; margin: 16px 20px 4px; font-weight: 600; }
       p.note { margin: 0 20px 12px; color: #8b9691; }
       main { display: flex; gap: 16px; padding: 0 20px 20px; align-items: flex-start; }
       .col { display: flex; flex-direction: column; gap: 14px; }
       figure { margin: 0; }
       .frame { position: relative; }
       img { image-rendering: pixelated; border: 1px solid #2a3138; display: block; }
       .dot { position: absolute; width: 9px; height: 9px; margin: -4px 0 0 -4px;
              border: 1px solid #7fe3ff; border-radius: 50%; background: rgba(127,227,255,.25); }
       figcaption { padding-top: 4px; color: #c9d1cc; }
       b { color: #f4d596; font-weight: 600; }
       .panel { border: 1px solid #2a3138; padding: 8px 10px; }
     </style>
     <h1>街面光池：灯亮/灯灭的地面读数与 0.5–6 格衰减（含 2.5 格）</h1>
     <p class="note">
       同一冻结帧（第 ${FREEZE_AT} 帧，锁种子 20261019）、同一机位；只换灯态或潮位。
       天气 ${out.lit.weather}（钉天气 ${out.lit.pinned ? '是' : '否'}）；取样机位 zoom ${out.lit.cam.zoom}。
       取样点 A = 世界 (${SAMPLE.x}, ${SAMPLE.y})，在 lamp_post_10 的池芯里、灯柱本体右边半格。
       村民已钉到画面外，读的是地面，不是人。
     </p>
     <main>
       <div class="col">
         ${card(out.lit, '灯亮（潮位 100%）', fmt(out.closeReading.lit), 480, 320, 1, out.closeReading.point)}
         ${card(out.dark, '灯灭（同一帧、同一机位）', fmt(out.closeReading.dark), 480, 320, 1, out.closeReading.point)}
       </div>
       <div class="col">
         ${card(out.tideLow, `潮位 ${(out.tide.low.level * 100).toFixed(0)}%（灯亮）`, fmt(out.tide.low.value), 480, 320, 1, out.tide.point)}
         ${card(out.tideHigh, `潮位 ${(out.tide.high.level * 100).toFixed(0)}%（灯亮）`, fmt(out.tide.high.value), 480, 320, 1, out.tide.point)}
       </div>
       <div class="col">
         <div class="panel"><b>距灯衰减（lamp_post_10，向右 0–6 格）</b><br />${curveSvg}</div>
         <div class="panel">
           <b>读数</b><br />
           亮：${fmt(out.closeReading.lit)}<br />
           灭：${fmt(out.closeReading.dark)}<br />
           ΔY = ${((out.closeReading.lit.luminance - out.closeReading.dark.luminance) * 100).toFixed(1)} 个百分点<br />
           潮位 ${(out.tide.low.level * 100).toFixed(0)}% → ${(out.tide.high.level * 100).toFixed(0)}%：
           ΔY = ${((out.tide.high.value.luminance - out.tide.low.value.luminance) * 100).toFixed(1)} 个百分点<br />
           绘制指令峰值 ${out.lit.stats.totalCommands} / Graphics ${out.lit.stats.graphicsObjects}
         </div>
       </div>
     </main>`,
  );
  await composite.screenshot({ path: join(OUT, 'lamp-pool.png'), fullPage: true });
  await composite.close();
} finally {
  await browser.close();
}

const fmt = (m) => `Y ${m.luminance.toFixed(3)} ${m.cct}K`;
for (const shot of Object.values(out)) {
  if (shot === null || typeof shot !== 'object' || !('cam' in shot)) continue;
  console.log(
    `[${shot.id}] zoom ${shot.cam.zoom} view ${shot.cam.worldViewX.toFixed(0)},${shot.cam.worldViewY.toFixed(0)}`,
  );
}
console.log(
  `灯亮 vs 灯灭（${SAMPLE.x},${SAMPLE.y}）：${fmt(out.closeReading.lit)} [${out.closeReading.lit.rgb.join(',')}] → `
    + `${fmt(out.closeReading.dark)} [${out.closeReading.dark.rgb.join(',')}]`,
);
for (const row of out.curve) {
  console.log(`  ${row.d} 格：ΔY ${(row.delta * 100).toFixed(2)}%（亮 ${fmt(row.lit)} / 灭 ${fmt(row.dark)}）`);
}
console.log(
  `潮位 ${(out.tide.low.level * 100).toFixed(0)}% vs ${(out.tide.high.level * 100).toFixed(0)}%：`
    + `${fmt(out.tide.low.value)} → ${fmt(out.tide.high.value)}`,
);
console.log(`绘制指令（灯亮满潮）：${out.lit.stats.totalCommands}，Graphics ${out.lit.stats.graphicsObjects}`);
console.log(`并排图：${join(OUT, 'lamp-pool.png')}`);
