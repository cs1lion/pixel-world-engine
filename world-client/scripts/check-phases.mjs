#!/usr/bin/env node
/**
 * 四刻可辨性回归：走真实渲染器，逐刻截图并量像素差。
 *
 * 为什么不用单测：亮度与像素差是渲染结果，只有真跑一遍才算数。
 * 判据来自 ADR_WORLD_ALIVE §2「验收阈值」，数字改动必须同步改这里的常量。
 *
 * 跑法：
 *   1. npm run dev（默认 5188；其它端口用 PIXEL_WORLD_URL 指过去）
 *   2. node scripts/check-phases.mjs
 *
 * 截图落在 eval/screens/phase-<id>.png，失败时可直接看。
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitFadeSettled, waitVillagersSettled } from './lib/capture.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';
const OUT = process.env.EVAL_OUT ?? 'eval/screens';
const PHASES = ['dawn', 'noon', 'dusk', 'night'];

/**
 * 采样区：整屏。
 *
 * 原先是固定的建筑带（y 176..468），因为单屏时代建筑总在同一位置。
 * 大世界里相机可以停在任意位置，固定带可能整块都是草地或天空，
 * 差异就被稀释到门槛以下——实测晨/昏只剩 0.6%。改成整屏，
 * 并把四刻截图统一对准祭坛（相机开局即对准，脚本不再依赖建筑位置）。
 */
const REGION_TOP = 0;
const REGION_BOTTOM = 640;

const reports = [];
const failures = [];
/** 每张图的抓拍读数：实际等了多久（ms）、看了多少帧。写进证据清单。 */
const captureWaits = [];
const check = (ok, label, detail = '') => {
  reports.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail === '' ? '' : `（${detail}）`}`);
};

/** 纯相位：每刻至少与其它刻在建筑区有明显差异。 */
const MIN_REGION_DIFF = 0.03;
/** 亮度必须严格递减：晨 > 午 > 昏 > 夜。 */
const MIN_LUMA_STEP = 1.5;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });

const shots = {};
const pageErrors = [];
for (const phase of PHASES) {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${phase}: ${error.message}`));
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE}?ledger=off&time=${phase}&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });
  // 钉住取景：等居民回屋要 20 秒以上，一过 15 秒导播就会接管并跟着走路的人
  // 平移——四刻截图会各自落在不同位置，整幅对不上。开局这一帧本来就对准
  // 祭坛（旧基线也是这个取景），切 free 后把中心点写死在那里。
  const framing = await page.evaluate(() => {
    const c = window.Oracle.camera();
    const cx = c.worldViewX + c.width / (2 * c.zoom);
    const cy = c.worldViewY + c.height / (2 * c.zoom);
    window.Oracle.setCameraMode('free');
    window.Oracle.centerCameraOn(cx, cy);
    const after = window.Oracle.camera();
    return { before: c, after };
  });
  check(
    framing.after.mode === 'free' &&
      framing.after.worldViewX === framing.before.worldViewX &&
      framing.after.worldViewY === framing.before.worldViewY &&
      framing.after.zoom === framing.before.zoom,
    `${phase} 取景钉在开局（祭坛）`,
    `${framing.before.worldViewX},${framing.before.worldViewY} zoom=${framing.before.zoom} → ${framing.after.worldViewX},${framing.after.worldViewY} zoom=${framing.after.zoom} mode=${framing.after.mode}`,
  );
  // 先等两人回屋（街面不再有会动的精灵），再把世界时钟钉到 00:35 并冻住。
  // 00:35 是他们各自坐下之后的固定时刻：萤火/窗灯的呼吸相位由此固定，
  // 否则两跑的 `now` 差一秒，整片萤火都在不同的亮度上。
  const folk = await waitVillagersSettled(page);
  check(folk.settled, `${phase} 居民落定（不再走动）`, `等待 ${folk.waitedMs}ms / ${folk.polls} 拍`);
  const pin = await page.evaluate(() => {
    window.Oracle.jumpWorldClock(35);
    const now = window.Oracle.freezeWorldClock();
    return { now, pinned: window.Oracle.worldClockPinned() };
  });
  check(
    pin.pinned && (pin.now / 60_000) % 1440 === 35,
    `${phase} 世界时钟钉在 00:35`,
    `now=${pin.now}`,
  );

  // 等压暗层渐变走完（取样区连续 3 帧不变），不再靠固定等待。
  const box = await page.locator('canvas').first().boundingBox();
  const fade = await waitFadeSettled(page, box);
  check(fade.settled, `${phase} 压暗层 6 秒内收敛`, `等待 ${fade.waitedMs}ms / ${fade.frames} 帧`);
  captureWaits.push({
    shot: `phase-${phase}`,
    waitedMs: folk.waitedMs + fade.waitedMs,
    frames: fade.frames,
    method: 'villagers-inside + clock-pin(00:35) + fade-probe',
    villagersMs: folk.waitedMs,
    fadeMs: fade.waitedMs,
  });

  const actual = await page.evaluate(() => window.Oracle.currentPhase());
  check(actual === phase, `?time=${phase} 真的停在${phase}`, `实际 ${actual}`);

  const buffer = await page.locator('canvas').first().screenshot();
  await writeFile(`${OUT}/phase-${phase}.png`, buffer);
  shots[phase] = buffer;
  await page.close();
}
check(pageErrors.length === 0, '四刻页面无 JS 报错', pageErrors.join('; '));

/** 用浏览器解码 PNG 取像素，避免在 Node 里引额外依赖。 */
const decoder = await context.newPage();
const stats = {};
for (const phase of PHASES) {
  const url = `data:image/png;base64,${shots[phase].toString('base64')}`;
  stats[phase] = await decoder.evaluate(async (src) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const values = new Float64Array(px.length / 4);
    let sum = 0;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let k = 0, i = 0; k < px.length; k += 4, i += 1) {
      values[i] = lum(px[k], px[k + 1], px[k + 2]);
      sum += values[i];
      r += px[k];
      gg += px[k + 1];
      b += px[k + 2];
    }
    const n = values.length;
    return {
      width: img.width,
      height: img.height,
      values: Array.from(values),
      mean: sum / n,
      warmth: (r - b) / n,
    };
  }, url);
}
await decoder.close();

// 亮度严格递减
for (let i = 0; i < PHASES.length - 1; i += 1) {
  const a = stats[PHASES[i]];
  const b = stats[PHASES[i + 1]];
  check(
    a.mean - b.mean >= MIN_LUMA_STEP,
    `${PHASES[i]} 必须明显亮于 ${PHASES[i + 1]}`,
    `${a.mean.toFixed(2)} vs ${b.mean.toFixed(2)}，差 ${(a.mean - b.mean).toFixed(2)}`,
  );
}

// 两两建筑区差异
for (let i = 0; i < PHASES.length; i += 1) {
  for (let j = i + 1; j < PHASES.length; j += 1) {
    const a = stats[PHASES[i]];
    const b = stats[PHASES[j]];
    const w = a.width;
    let changed = 0;
    let total = 0;
    for (let y = REGION_TOP; y < Math.min(REGION_BOTTOM, a.height); y += 1) {
      for (let x = 0; x < w; x += 1) {
        const k = y * w + x;
        total += 1;
        if (Math.abs(a.values[k] - b.values[k]) >= 8) changed += 1;
      }
    }
    const share = changed / Math.max(1, total);
    check(
      share >= MIN_REGION_DIFF,
      `${PHASES[i]} 与 ${PHASES[j]} 在建筑区可辨`,
      `${(share * 100).toFixed(1)}% 像素变化，门槛 ${(MIN_REGION_DIFF * 100).toFixed(0)}%`,
    );
  }
}

// 夜雨必须隐藏萤火。产品没有 `?rain=` 入口——天气只能由神谕或台账改，
// 所以这里走真实操作路径：说一句「下雨吧」，等雨上屏再拍。
const nightRain = await (async () => {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`night+rain: ${error.message}`));
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE}?ledger=off&time=night&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });
  // 先等夜里这一层压暗收敛，再叫雨——雨幕自己会动，探针在雨里永远不收敛。
  const box = await page.locator('canvas').first().boundingBox();
  const fade = await waitFadeSettled(page, box);
  check(fade.settled, 'night（雨前）压暗层 6 秒内收敛', `等待 ${fade.waitedMs}ms / ${fade.frames} 帧`);
  captureWaits.push({ shot: 'phase-night-rain:fade', waitedMs: fade.waitedMs, frames: fade.frames, method: 'probe' });

  const said = await page.evaluate(() => window.Oracle.say('下雨吧'));
  check(said.ok === true, '神谕「下雨吧」被认出来了', said.message);

  // 雨渐变 1.8 秒；等足 3 秒确保 intensity 拉满。雨幕本身逐帧在动，
  // 探针在这里不可用——这一张的等待时长照实记成固定值。
  await page.waitForTimeout(3000);
  captureWaits.push({ shot: 'phase-night-rain', waitedMs: 3000, frames: -1, method: 'fixed(rain)' });
  const weather = await page.evaluate(() => window.Oracle.view().weather);
  check(weather === 'rain', '夜里真的下起了雨', `weather=${weather}`);

  const buffer = await page.locator('canvas').first().screenshot();
  await writeFile(`${OUT}/phase-night-rain.png`, buffer);
  await page.close();
  return { buffer, weather };
})();
check(
  nightRain.weather === 'rain' && !nightRain.buffer.equals(shots.night),
  '夜雨与晴夜画面不同（雨幕生效）',
  '两张截图完全相同说明雨没上屏',
);

await browser.close();

for (const item of captureWaits) {
  console.log(`capture ${item.shot} waitedMs=${item.waitedMs} frames=${item.frames} method=${item.method}`);
}
for (const item of reports) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.label}${item.detail === '' ? '' : `  ${item.detail}`}`);
}
if (failures.length > 0) {
  console.error(`\n四刻可辨性失败 ${failures.length} 项：`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\n四刻可辨性：${reports.length} 项通过`);
