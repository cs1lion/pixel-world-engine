#!/usr/bin/env node
/**
 * 雨帧呈现态回归：三跑逐像素 0 差 + 反向用例必须判红。
 *
 * 构图沿用调色板对照的「同机位」夹具（`capture-palette.mjs` 的三把锁）：
 *   1) `__RAIN_SEED__` 固定（雨滴序列可重建）；
 *   2) `Math.random` 用同一 LCG 覆盖（世界/仿真随机也定住）；
 *   3) rAF 帧计数 + 固定时间戳：第 30 帧按雨，第 240 帧应用呈现态钉。
 * 这三把锁原本只保证「世界怎么跑」；雨幕的浓淡（`sim.weatherIntensity()` 实时
 * 0.85～0.87）和雨滴相位仍不在快照里。本脚本在第 240 帧调用
 * `Oracle.pinWeather(intensity, frames)`，把这两样也钉成常量。
 *
 * 产物（EVAL_OUT 下）：
 *   baseline-1/rain-pin.png  baseline-2/rain-pin.png  baseline-3/rain-pin.png
 *   shift-frame/rain-pin.png      （frames = 24 + 1，故意错开一帧）
 *   shift-intensity/rain-pin.png  （intensity = 0.86 + 0.01）
 * 之后用 `screens-diff.py` 配对；三组基线必须 0/0/0，两条扰动必须非零。
 *
 * 跑法：
 *   node node_modules/vite/bin/vite.js --port 5211 --strictPort
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211 EVAL_OUT=$env:TEMP/pwe-rain-pin node scripts/check-rain-pin.mjs
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5211/';
const OUT = process.env.EVAL_OUT;
if (!OUT) {
  console.error('必须给 EVAL_OUT（建议放临时目录，别写进仓库的 eval/screens）');
  process.exit(1);
}
const SEED = Number(process.env.PALETTE_SEED ?? 20261019);
const FRAME_MS = 1000 / 60;
const RAIN_CLICK_AT = 30;
const PIN_AT = 240;
const STOP_AT = PIN_AT + 1;
const PIN_FRAMES = 24;
const PIN_INTENSITY = 0.86;

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16);

/** 与 capture-palette.mjs 相同的三把锁；多一把：在第 PIN_AT 帧应用呈现态钉。 */
function initScript({ seed, frameMs, rainAt, pinAt, pinFrames, pinIntensity }) {
  try {
    localStorage.clear();
  } catch {
    /* 忽略 */
  }
  window.__RAIN_SEED__ = seed;
  let rng = seed >>> 0;
  Math.random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const state = { frame: 0, done: false };
  window.__CAPTURE_STATE__ = state;
  window.__RAIN_PIN_STATE__ = { applied: false };
  const realRaf = window.requestAnimationFrame.bind(window);
  const now = () => state.frame * frameMs;
  performance.now = now;
  window.requestAnimationFrame = (cb) => {
    if (state.frame >= pinAt + 1) {
      state.done = true;
      return 0;
    }
    return realRaf(() => {
      state.frame += 1;
      if (state.frame === rainAt) document.querySelector('#rain')?.click();
      if (state.frame === pinAt) {
        const oracle = window.Oracle;
        if (oracle && typeof oracle.pinWeather === 'function') {
          oracle.pinWeather(pinIntensity, pinFrames);
          window.__RAIN_PIN_STATE__ = { applied: true, intensity: pinIntensity, frames: pinFrames };
        }
      }
      cb(now());
    });
  };
}

async function capture(browser, { label, pinFrames, pinIntensity }) {
  const dir = join(OUT, label);
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.addInitScript(initScript, {
      seed: SEED,
      frameMs: FRAME_MS,
      rainAt: RAIN_CLICK_AT,
      pinAt: PIN_AT,
      pinFrames,
      pinIntensity,
    });
    await page.goto(`${BASE}?ledger=off&time=noon&debug=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CAPTURE_STATE__?.done === true, null, { timeout: 30000 });
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => ({
      weather: window.Oracle.view().weather,
      pin: window.__RAIN_PIN_STATE__,
    }));
    if (state.weather !== 'rain') throw new Error(`[${label}] 冻结时不是雨天：${state.weather}`);
    if (!state.pin.applied) throw new Error(`[${label}] Oracle.pinWeather 没生效`);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    const png = await page.screenshot({
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    });
    const file = join(dir, 'rain-pin.png');
    await writeFile(file, png);
    console.log(
      `[${label}] weather=${state.weather} pin=${state.pin.intensity}/${state.pin.frames} ` +
        `bytes=${png.length} sha=${sha(png)} -> ${file}`,
    );
  } finally {
    await page.close();
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await capture(browser, { label: 'baseline-1', pinFrames: PIN_FRAMES, pinIntensity: PIN_INTENSITY });
  await capture(browser, { label: 'baseline-2', pinFrames: PIN_FRAMES, pinIntensity: PIN_INTENSITY });
  await capture(browser, { label: 'baseline-3', pinFrames: PIN_FRAMES, pinIntensity: PIN_INTENSITY });
  await capture(browser, { label: 'shift-frame', pinFrames: PIN_FRAMES + 1, pinIntensity: PIN_INTENSITY });
  await capture(browser, { label: 'shift-intensity', pinFrames: PIN_FRAMES, pinIntensity: PIN_INTENSITY + 0.01 });
} finally {
  await browser.close();
}
