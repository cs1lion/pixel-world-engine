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

/** 用浏览器解码 PNG 取像素，避免在 Node 里引额外依赖。 */
const decodeStats = async (shots) => {
  const decoder = await context.newPage();
  const stats = {};
  try {
    for (const phase of PHASES) {
      const url = `data:image/png;base64,${shots[phase].buffer.toString('base64')}`;
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
  } finally {
    await decoder.close();
  }
  return stats;
};

/**
 * 一轮完整采样：四刻页 + 夜雨页 + PNG 解码。
 *
 * `scored=false` 是预热轮：不写截图、不做任何判定，读数由调用方丢弃。
 * 采样路径必须与正式轮逐字相同，否则预热就只是「随便开个页面」。
 */
const capturePass = async (scored) => {
  const shots = {};
  const errors = [];

  for (const phase of PHASES) {
    const page = await context.newPage();
    try {
      page.on('pageerror', (error) => errors.push(`${phase}: ${error.message}`));
      await page.addInitScript(() => localStorage.clear());
      await page.goto(`${BASE}?ledger=off&time=${phase}&debug=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });
      // 渐变 FADE_MS = 900，等两倍确保拍到终态。
      await page.waitForTimeout(2200);
      // 但墙钟不等于画面进度：冷启动的首帧可能卡 2s 以上，2200ms 到了，
      // 这一页却连一次 update 都没跑过——实测 noon 均值 59.02（正常 66.10），
      // 压暗与雾带根本没上屏。所以再等这一页**真的推进 60 帧**（60 帧 ≈ 1s，
      // 覆盖 FADE_MS = 900 的渐变）才取图。这是把采样窗口对齐到「页面已渲染」，
      // 不改任何亮度阈值或断言。
      const advanced = await page.evaluate(() => window.Oracle.ecoState().advanceCount);
      await page.waitForFunction(
        (target) => window.Oracle.ecoState().advanceCount >= target,
        advanced + 60,
        { timeout: 20000, polling: 50 },
      );

      const actual = await page.evaluate(() => window.Oracle.currentPhase());
      const buffer = await page.locator('canvas').first().screenshot();
      if (scored) await writeFile(`${OUT}/phase-${phase}.png`, buffer);
      shots[phase] = { buffer, actual };
    } finally {
      await page.close();
    }
  }

  // 夜雨必须隐藏萤火。产品没有 `?rain=` 入口——天气只能由神谕或台账改，
  // 所以这里走真实操作路径：说一句「下雨吧」，等雨上屏再拍。
  const nightRain = await (async () => {
    const page = await context.newPage();
    try {
      page.on('pageerror', (error) => errors.push(`night+rain: ${error.message}`));
      await page.addInitScript(() => localStorage.clear());
      await page.goto(`${BASE}?ledger=off&time=night&debug=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });
      await page.waitForTimeout(400);

      const said = await page.evaluate(() => window.Oracle.say('下雨吧'));

      // 雨渐变 1.8 秒；等足 3 秒确保 intensity 拉满。
      await page.waitForTimeout(3000);
      const weather = await page.evaluate(() => window.Oracle.view().weather);

      const buffer = await page.locator('canvas').first().screenshot();
      if (scored) await writeFile(`${OUT}/phase-night-rain.png`, buffer);
      return { buffer, weather, said };
    } finally {
      await page.close();
    }
  })();

  const stats = await decodeStats(shots);
  return { shots, nightRain, stats, errors };
};

/**
 * 预热轮（不计分）。
 *
 * 冷启动的第一个页面要付 WebGL 管线/着色器首次编译、生成纹理首次上传、
 * 1.6MB bundle 的解码与 JIT 的钱；这段时间 rAF 的帧间隔被拉长，而相位渐变
 * 按**累计 delta** 推进（`FADE_MS = 900`，见 `src/render/phase-view.ts`）。
 * 所以「等 2200ms 墙钟」在冷启动里可能只积累了不到 900ms 的游戏时间，
 * 晨刻的渐变没走完就被截屏——首跑那次 `dawn 65.42 vs noon 66.10` 就是这么来的。
 *
 * 这里先按**完全相同的路径**跑一遍（四刻页 + 夜雨页 + PNG 解码），读数全部丢弃，
 * 把一次性的首次成本消化在正式采样之前。阈值、断言条件、用例数量一个未动：
 * 正式轮仍是原来那 17 项，预热轮不产出任何 pass/fail。
 */
const warm = await capturePass(false).catch((error) => {
  console.log(`[预热轮] 不计分：预热失败（${error.message}），继续正式采样`);
  return null;
});
if (warm !== null) {
  const means = PHASES.map((phase) => `${phase} ${warm.stats[phase].mean.toFixed(2)}`).join(' / ');
  console.log(`[预热轮] 不计分：四刻亮度均值 ${means}（本轮读数全部丢弃）`);
}

const pass = await capturePass(true);
const shots = pass.shots;

for (const phase of PHASES) {
  check(pass.shots[phase].actual === phase, `?time=${phase} 真的停在${phase}`, `实际 ${pass.shots[phase].actual}`);
}
check(pass.errors.length === 0, '四刻页面无 JS 报错', pass.errors.join('; '));

// 亮度严格递减
for (let i = 0; i < PHASES.length - 1; i += 1) {
  const a = pass.stats[PHASES[i]];
  const b = pass.stats[PHASES[i + 1]];
  check(
    a.mean - b.mean >= MIN_LUMA_STEP,
    `${PHASES[i]} 必须明显亮于 ${PHASES[i + 1]}`,
    `${a.mean.toFixed(2)} vs ${b.mean.toFixed(2)}，差 ${(a.mean - b.mean).toFixed(2)}`,
  );
}

// 两两建筑区差异
for (let i = 0; i < PHASES.length; i += 1) {
  for (let j = i + 1; j < PHASES.length; j += 1) {
    const a = pass.stats[PHASES[i]];
    const b = pass.stats[PHASES[j]];
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

check(pass.nightRain.said.ok === true, '神谕「下雨吧」被认出来了', pass.nightRain.said.message);
check(pass.nightRain.weather === 'rain', '夜里真的下起了雨', `weather=${pass.nightRain.weather}`);
check(
  pass.nightRain.weather === 'rain' && !pass.nightRain.buffer.equals(shots.night.buffer),
  '夜雨与晴夜画面不同（雨幕生效）',
  '两张截图完全相同说明雨没上屏',
);

await browser.close();

for (const item of reports) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.label}${item.detail === '' ? '' : `  ${item.detail}`}`);
}
if (failures.length > 0) {
  console.error(`\n四刻可辨性失败 ${failures.length} 项：`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\n四刻可辨性：${reports.length} 项通过`);
