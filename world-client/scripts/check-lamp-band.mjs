#!/usr/bin/env node
/**
 * 夜街全景：整条街看过去，灯光是**连续暖带**还是**一圈一圈孤立的斑**。
 *
 * 为什么单独一支：光池的单点读数（灯亮/灯灭、衰减）只能证明「灯下那一点亮」，
 * 证明不了「灯与灯之间的地面」；这一支把镜头拉到 zoom 1，横向扫过 5 根灯柱，
 * 逐列量「灯亮 vs 灯灭」的亮度差，直接量出暗带的位置与宽度。
 *
 * 口径（**每条读数都必须带这一整行**，见 docs/evidence/scene-motion/README.md 开头）：
 * - 机位 x368/y470、zoom 1、视口 1010×700、带段 x240..560 × y435..535、1pp 阈值；
 * - 夜间（`?time=night` 强制相位）、满潮（`debugPinTide(1)`）、**真晴**
 *   （`?now=720` 落自然 clear 槽，且断言 `rainStrength < 0.05`）、同一冻结帧（frame 180）；
 *   村民钉到画面外（只改画面，不挡地面）。
 * - 载入种子必须钉（`BAND_SEED`，写进 URL 的 `debugPinSeed` 与 `window.__RAIN_SEED__`）：
 *   页面每次载入的雨滴种子不同，不钉的话同一构建同参数也会散（75.94 / 75.63 / 76.88）。
 * - **默认 `BAND_NOW=720`、`BAND_SEED=20261019`**；照默认跑就是真晴。若 `rainStrength >= 0.05`
 *   或读不到强度，脚本直接报错退出，不写读数——未钉真晴的量不进入判据。
 *   注意：`SETUP_AT=80` 调 clear 的旧协议到 frame180 也会淡到 0，断言拦不住「中途下过雨」；
 *   所以默认 `now=720` 才是口径，不能靠断言把过渡协议洗成真晴。
 * - 基线树（**39cff04**）没有强度口子：显式 `BAND_ALLOW_UNMEASURED=1` 才放行 `rainStrength=null`，
 *   晴按槽位间接确认（`now=720` → 第 3 槽、无 `debugSetWeather` 可调、frame180 `kind=clear`），
 *   并把这条写进 JSON 的 `protocol.clearBasis`。默认不给这个变量时仍直接报错。
 * - 覆盖 = ΔY ≥ 1pp 的列占比；暗带 = 连续 < 1pp 的最长一段（按格算，16 列 = 1 格）。
 *
 * 跑法：
 *   cd world-client && npm run dev
 *   # 默认拍「改后」；只有在半径改动之前才需要先拍改前基线
 *   # 输出默认落 tmp/screens/check-lamp-band/；「改前」三件从 eval/screens/ 读，
 *   # 要写回仓库基线须显式 --write-baseline 或 EVAL_OUT=eval/screens
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ BAND_SEED=20261019 BAND_NOW=720 BAND_LABEL=before node scripts/check-lamp-band.mjs
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ BAND_SEED=20261019 BAND_NOW=720 node scripts/check-lamp-band.mjs
 *   # 两次都在时，合成页会多一行「before / after 差异」
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';
import { BASELINE_DIR, resolveShotDir } from './lib/shot-output.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = resolveShotDir('check-lamp-band');
// 默认拍「改后」：`before` 是半径改动之前拍的一次性基线，重跑不该覆盖它。
// 现在默认写 tmp，`before` 三件常从 `eval/screens/` 只读复用。
const LABEL = process.env.BAND_LABEL ?? 'after';
mkdirSync(OUT, { recursive: true });

/** 截图/回归的载入种子：同一种子下，载入期随机不取墙钟。 */
const SEED = Number.parseInt(process.env.BAND_SEED ?? '20261019', 10);
if (!Number.isFinite(SEED)) throw new Error(`BAND_SEED 不是整数：${process.env.BAND_SEED}`);
/** 默认的世界分钟入口（`?now=<0..1439>`）：720 = 12:00，自然 clear 槽，不靠淡出。
 *
 * 默认必须落在真晴：否则裸跑会从 00:00 雨槽开局、中途调 clear，冻结帧虽已淡到 0，
 * 但这一组只是过渡协议（旧 JSON 也没有强度字段），不能当钉晴基线写进 `lamp-band-after.json`。
 */
const NOW = process.env.BAND_NOW ?? '720';
const NOW_MIN = Number.parseInt(NOW, 10);
if (!Number.isInteger(NOW_MIN) || NOW_MIN < 0 || NOW_MIN > 1439) {
  throw new Error(`BAND_NOW 必须是 0..1439 的整数分钟：${process.env.BAND_NOW}`);
}
const NOW_PARAM = `&now=${NOW_MIN}`;
/** 真晴阈值：`kind=clear` 不算，雨幕强度必须低于这个值（写死，与 README 一致）。 */
const RAIN_CLEAR_MAX = 0.05;
/** 基线树（`39cff04`）没有 `debugWeatherIntensity`。只有显式给 `BAND_ALLOW_UNMEASURED=1` 才放行
 * `rainStrength=null`，并按槽位**间接**确认晴：`now=720` 落在第 3 槽，基线又没有 `debugSetWeather`
 * 可调，冻结帧 `kind=clear` 只能是「开局就排到 clear 槽」，不是中途淡出。默认仍拒绝、不写读数。 */
const ALLOW_UNMEASURED = process.env.BAND_ALLOW_UNMEASURED === '1';
/** 天气槽长：`world/weather-cycle.ts` 的 `WEATHER_SLOT_MS = worldHours(4)` = 240 世界分钟。 */
const WEATHER_SLOT_MINUTES = 240;
const WEATHER_SLOT = Math.floor(NOW_MIN / WEATHER_SLOT_MINUTES);
const WORLD = 'dengchao';
const SETUP_AT = 80;
const ACTION_AT = 170;
const FREEZE_AT = 180;
/** 机位：zoom 1，世界 x 128..608，覆盖北侧灯 15/23/31 与南侧灯 19/27/35。 */
const CAMERA = { x: 368, y: 470 };
/** 街段：第一根灯柱到最后一根灯柱之间（世界 x 240..560）。 */
const STREET_X0 = 240;
const STREET_X1 = 560;
/** 扫描带：两排池子的地面 y 段。 */
const BAND_Y0 = 435;
const BAND_Y1 = 535;
/** 判定「有光」的阈值：灯亮比灯灭高 1 个百分点。 */
const LIGHT_DY = 0.01;

function initScript({ freezeAt, seed }) {
  try {
    localStorage.clear();
  } catch {
    /* 忽略 */
  }
  let rng = seed >>> 0;
  Math.random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  // 雨滴种子（`render/weather.ts` 的 `__RAIN_SEED__`）必须在任何模块执行前钉住，
  // 否则每次载入的雨态像素都不同——75.94 / 75.63 / 76.88 三组就是它的三个采样。
  window.__RAIN_SEED__ = seed;
  const state = { frame: 0, frozen: false };
  window.__CAPTURE_STATE__ = state;
  const realRaf = window.requestAnimationFrame.bind(window);
  const frameMs = 1000 / 60;
  performance.now = () => state.frame * frameMs;
  window.requestAnimationFrame = (cb) => {
    if (state.frozen) return 0;
    return realRaf(() => {
      state.frame += 1;
      if (state.frame >= freezeAt) {
        state.frozen = true;
        cb(state.frame * frameMs);
        return;
      }
      cb(state.frame * frameMs);
    });
  };
}

async function capture(browser, { id, force }) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(initScript, { freezeAt: FREEZE_AT, seed: SEED });
  await page.goto(`${BASE}?world=${WORLD}&time=night&feed=off&ledger=off&debug=1&debugPinSeed=${SEED}${NOW_PARAM}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });

  const canvas = page.locator('canvas').first();
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('找不到 canvas');

  await page.waitForFunction((n) => window.__CAPTURE_STATE__.frame >= n, SETUP_AT, { timeout: 30000 });
  await page.evaluate(([x, y]) => window.Oracle.centerCameraOn(x, y), [CAMERA.x, CAMERA.y]);
  // 天气与潮位在这条读数里必须钉住：新世界的天气按当日种子排，雨天雨点又逐帧乱飘，
  // 不钉就得不到同一条街的同一次测量（跨天、跨跑都对不上）。
  // 口子不在（拿 39cff04 基线对着同一份脚本跑时）就跳过，并把这个事实记进 params.pinned。
  const pinned = await page.evaluate(() => {
    const weather = typeof window.Oracle.debugSetWeather === 'function';
    const tide = typeof window.Oracle.debugPinTide === 'function';
    if (weather) window.Oracle.debugSetWeather('clear');
    if (tide) window.Oracle.debugPinTide(1);
    return { weather, tide };
  });
  await page.waitForFunction((n) => window.__CAPTURE_STATE__.frame >= n, ACTION_AT, { timeout: 30000 });
  await page.evaluate((force) => {
    for (const villager of window.Oracle.view().villagers) {
      window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
    }
    window.Oracle.say('潮位 100%');
    window.Oracle.debugForceLamps(force);
  }, force);
  await page.waitForFunction(() => window.__CAPTURE_STATE__.frozen === true, null, { timeout: 20000 });
  await page.waitForTimeout(300);

  const cam = await page.evaluate(() => window.Oracle.camera());
  const stats = await page.evaluate(() => window.Oracle.renderStats());
  const poolCommands = await page.evaluate(() => window.Oracle.debugLampPool());
  const tideLevel = await page.evaluate(() => window.Oracle.view().tide.level);
  const worldState = await page.evaluate(() => ({
    now: typeof window.Oracle.debugStepWorld === 'function' ? window.Oracle.debugStepWorld(0) : null,
    weather: window.Oracle.view().weather,
  }));
  // 「真晴」不能只看 kind：雨幕强度 `rainStrength` 还可能是 0.97。阈值 0.05 写死。
  const rainStrength = await page.evaluate(() =>
    typeof window.Oracle.debugWeatherIntensity === 'function' ? window.Oracle.debugWeatherIntensity() : null,
  );
  const file = join(OUT, `lamp-band-${LABEL}-${id}.png`);
  await page.screenshot({ path: file, clip: box });
  const buf = readFileSync(file);
  await page.close();
  return { id, file, buf, cam, stats, poolCommands, tideLevel, worldState, rainStrength, pinned, errors };
}

const toLinear = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/**
 * 逐列扫描：返回每一世界列的「灯亮 - 灯灭」最大 ΔY，以及暗带与覆盖。
 * 用同一个解码页把两张 PNG 拉回像素，避免在 node 里解 PNG。
 */
async function profile(page, litBuf, darkBuf, geometry) {
  const b64 = { lit: litBuf.toString('base64'), dark: darkBuf.toString('base64') };
  return page.evaluate(async ({ b64, geometry }) => {
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
      return ctx;
    };
    const toLinear = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (d) => 0.2126 * toLinear(d[0]) + 0.7152 * toLinear(d[1]) + 0.0722 * toLinear(d[2]);
    const [lit, dark] = await Promise.all([load(b64.lit), load(b64.dark)]);
    const { worldViewX, worldViewY, zoom, scale, x0, x1, y0, y1 } = geometry;
    const imgX = (wx) => (wx - worldViewX) * scale * zoom;
    const imgY = (wy) => (wy - worldViewY) * scale * zoom;
    const px = 2; // 1 世界像素 = 2 CSS 像素（Phaser scale zoom 2）

    const cols = [];
    for (let wx = x0; wx < x1; wx += 1) {
      let best = 0;
      for (let wy = y0; wy < y1; wy += 1) {
        const x = Math.round(imgX(wx));
        const y = Math.round(imgY(wy));
        const dl = lit.getImageData(x, y, 1, 1).data;
        const dd = dark.getImageData(x, y, 1, 1).data;
        const delta = lum(dl) - lum(dd);
        if (delta > best) best = delta;
      }
      cols.push({ wx, delta: best });
    }

    // 暗带：连续 ΔY < 阈值的最长一段。
    let gap = 0;
    let gapStart = null;
    let bestGap = 0;
    let bestGapStart = 0;
    for (const c of cols) {
      if (c.delta < geometry.threshold) {
        if (gapStart === null) gapStart = c.wx;
        gap += 1;
        if (gap > bestGap) {
          bestGap = gap;
          bestGapStart = gapStart;
        }
      } else {
        gap = 0;
        gapStart = null;
      }
    }
    const lit_cols = cols.filter((c) => c.delta >= geometry.threshold).length;
    const deltas = cols.map((c) => c.delta);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return {
      cols,
      coverage: lit_cols / cols.length,
      gapCells: bestGap / 16,
      gapAt: bestGapStart,
      min: Math.min(...deltas),
      max: Math.max(...deltas),
      avg,
      px,
    };
  }, { b64, geometry });
}

const browser = await chromium.launch({ headless: true });
const lit = await capture(browser, { id: 'lit', force: true });
// 真晴断言：读不到强度（基线缺口子）或强度 ≥0.05，都不许继续量、不许写 JSON。
const MEASURED_CLEAR = lit.rainStrength !== null && lit.rainStrength < RAIN_CLEAR_MAX;
const KIND_CLEAR = lit.worldState.weather === 'clear';
/** 有强度口子：只认实测；没有（基线）：仅当显式放行且冻结帧 kind=clear 时按槽位间接确认。 */
const TRUE_CLEAR = lit.rainStrength !== null ? MEASURED_CLEAR : (ALLOW_UNMEASURED && KIND_CLEAR);
const CLEAR_BASIS = lit.rainStrength !== null
  ? 'measured: rainStrength < 0.05'
  : ALLOW_UNMEASURED
    ? `slot-indirect: now=${NOW_MIN} → 第 ${WEATHER_SLOT} 槽（${WEATHER_SLOT_MINUTES} 世界分钟/槽，world/weather-cycle.ts:24），`
      + `基线无 debugSetWeather 可调，frame${FREEZE_AT} kind=clear；强度字段不可得`
    : 'unavailable';
if (lit.rainStrength === null && !ALLOW_UNMEASURED) {
  await browser.close();
  throw new Error('无法验证真晴：页面没有 debugWeatherIntensity 口子（基线树常见）。该读数不进入判据。'
    + '确需补基线时显式给 BAND_ALLOW_UNMEASURED=1，届时按槽位间接确认并写进 protocol.clearBasis。');
}
if (lit.rainStrength === null && ALLOW_UNMEASURED && !KIND_CLEAR) {
  await browser.close();
  throw new Error(`槽位间接确认失败：now=${NOW_MIN}（第 ${WEATHER_SLOT} 槽）、kind=${lit.worldState.weather}，`
    + '未调用 debugSetWeather 仍是这种天气，说明该槽不是 clear。');
}
if (!TRUE_CLEAR) {
  const nowText = lit.worldState.now === null ? 'unknown' : `${(lit.worldState.now / 60000).toFixed(2)} 世界分钟`;
  await browser.close();
  throw new Error(`真晴断言失败：now=${nowText}、kind=${lit.worldState.weather}、rainStrength=${lit.rainStrength.toFixed(3)}，需 < ${RAIN_CLEAR_MAX}。请检查 BAND_NOW 是否落在 clear 槽。`);
}
const dark = await capture(browser, { id: 'dark', force: false });
const reader = await browser.newPage();
const geometry = {
  worldViewX: lit.cam.worldViewX,
  worldViewY: lit.cam.worldViewY,
  zoom: lit.cam.zoom,
  scale: 2,
  x0: STREET_X0,
  x1: STREET_X1,
  y0: BAND_Y0,
  y1: BAND_Y1,
  threshold: LIGHT_DY,
};
const prof = await profile(reader, lit.buf, dark.buf, geometry);

/** 两张 PNG 逐像素比：只用作「改前 → 改后」的像素差（PNG 无损，差 0 就是没变）。 */
async function pixelDiff(page, beforeBuf, afterBuf) {
  const b64 = { before: beforeBuf.toString('base64'), after: afterBuf.toString('base64') };
  return page.evaluate(async ({ b64 }) => {
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
    const [a, b] = await Promise.all([load(b64.before), load(b64.after)]);
    if (a.w !== b.w || a.h !== b.h) return null;
    const pixels = a.w * a.h;
    let changed = 0;
    let sum = 0;
    let max = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < pixels; i += 1) {
      let dmax = 0;
      for (let k = 0; k < 3; k += 1) {
        const d = Math.abs(a.data[i * 4 + k] - b.data[i * 4 + k]);
        if (d > dmax) dmax = d;
        sum += d;
      }
      if (dmax > 0) {
        changed += 1;
        const x = i % a.w;
        const y = (i - x) / a.w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (dmax > max) max = dmax;
    }
    return {
      pixels,
      changed,
      ratio: changed / pixels,
      max,
      mean: sum / (pixels * 3),
      bbox: changed === 0 ? null : { x0, y0, x1, y1 },
    };
  }, { b64 });
}

// 改前 / 改后的像素差：灯亮图应只在池子附近变，灯灭图应一个像素都不变。
// 只有 `before` 与本次同种子、同为真晴时才比；否则是跨协议比较，按读数纪律不作数。
const beforeJsonFile = join(BASELINE_DIR, 'lamp-band-before.json');
const beforeLitFile = join(BASELINE_DIR, 'lamp-band-before-lit.png');
const beforeDarkFile = join(BASELINE_DIR, 'lamp-band-before-dark.png');
const beforeParams = existsSync(beforeJsonFile)
  ? (JSON.parse(readFileSync(beforeJsonFile, 'utf8')).params ?? null)
  : null;
const sameProtocol = beforeParams !== null && beforeParams.seed === SEED && beforeParams.trueClear === true;
let diff = null;
if (LABEL !== 'before' && sameProtocol && existsSync(beforeLitFile) && existsSync(beforeDarkFile)) {
  diff = {
    lit: await pixelDiff(reader, readFileSync(beforeLitFile), lit.buf),
    dark: await pixelDiff(reader, readFileSync(beforeDarkFile), dark.buf),
  };
}
await reader.close();

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const result = {
  label: LABEL,
  /** 读数口径（与 README 的「每条读数带全口径」要求一一对应）。 */
  params: {
    camera: { x: CAMERA.x, y: CAMERA.y },
    zoom: lit.cam.zoom,
    viewport: { width: 1010, height: 700 },
    street: { x0: STREET_X0, x1: STREET_X1 },
    band: { y0: BAND_Y0, y1: BAND_Y1 },
    threshold: LIGHT_DY,
    tide: lit.tideLevel,
    weather: lit.worldState.weather,
    /** 相位由 `?time=night` 强制（世界钟仍从 00:00 起算，不在夜晚窗口也不影响灯态）。 */
    phase: 'night',
    now: lit.worldState.now,
    freezeAt: FREEZE_AT,
    /** 载入种子：`?debug=1&debugPinSeed=` 与 initScript 的 LCG / `__RAIN_SEED__` 同值；跨种子比较必须先钉种子。 */
    seed: SEED,
    /** 雨幕强度（0..1）。只记 kind 不算钉晴；真晴要求 < 0.05。基线树无此口子，记 null。 */
    rainStrength: lit.rainStrength,
    trueClear: TRUE_CLEAR,
    /** 晴是怎么确认的：有口子=实测；基线=槽位间接（`BAND_ALLOW_UNMEASURED=1`）。 */
    clearBasis: CLEAR_BASIS,
    /** 天气/潮位是否真钉上了（39cff04 没有这两个口子，基线读数只能记实际天气/潮位）。 */
    pinned: lit.pinned,
  },
  /** 同一份口径的机器可读副本：字段名按抽查要求（seed / now / rainStrength / tide / frame / 视口）。 */
  protocol: {
    url: BASE,
    world: WORLD,
    query: `?world=${WORLD}&time=night&feed=off&ledger=off&debug=1&debugPinSeed=${SEED}&now=${NOW_MIN}`,
    seed: SEED,
    now: NOW_MIN,
    nowWorldMs: lit.worldState.now,
    weatherSlot: WEATHER_SLOT,
    weatherSlotMinutes: WEATHER_SLOT_MINUTES,
    rainStrength: lit.rainStrength,
    rainStrengthMeasured: lit.rainStrength !== null,
    rainClearMax: RAIN_CLEAR_MAX,
    trueClear: TRUE_CLEAR,
    clearBasis: CLEAR_BASIS,
    tide: lit.tideLevel,
    tidePinned: lit.pinned.tide,
    weatherPinned: lit.pinned.weather,
    phase: 'night',
    frame: FREEZE_AT,
    frames: { setupAt: SETUP_AT, actionAt: ACTION_AT, freezeAt: FREEZE_AT },
    viewport: { width: 1010, height: 700 },
    camera: { x: CAMERA.x, y: CAMERA.y },
    zoom: lit.cam.zoom,
    street: { x0: STREET_X0, x1: STREET_X1 },
    band: { y0: BAND_Y0, y1: BAND_Y1 },
    threshold: LIGHT_DY,
  },
  shots: { lit: lit.file.replace(/^.*eval[\\/]/, 'eval/'), dark: dark.file.replace(/^.*eval[\\/]/, 'eval/') },
  cam: lit.cam,
  stats: lit.stats,
  poolCommands: { lit: lit.poolCommands, dark: dark.poolCommands },
  tideLevel: lit.tideLevel,
  coverage: prof.coverage,
  gapCells: prof.gapCells,
  gapAt: prof.gapAt,
  min: prof.min,
  max: prof.max,
  avg: prof.avg,
  /** 逐列 ΔY（世界 x 240..560，单位 0.001），用来核对峰值是否对得上灯柱中心。 */
  profile: prof.cols.map((c) => Math.round(c.delta * 1000)),
  diff,
  errors: [...lit.errors, ...dark.errors],
};
writeFileSync(join(OUT, `lamp-band-${LABEL}.json`), `${JSON.stringify(result, null, 2)}\n`);

console.log(`[${LABEL}] 街段 x ${STREET_X0}..${STREET_X1}，覆盖 ${pct(prof.coverage)}，最长暗带 ${prof.gapCells.toFixed(1)} 格（起点 x ${prof.gapAt}）`);
console.log(`  ΔY min ${(prof.min * 100).toFixed(2)} / avg ${(prof.avg * 100).toFixed(2)} / max ${(prof.max * 100).toFixed(2)} pp`);
console.log(`  口径 机位 x${CAMERA.x}/y${CAMERA.y}、zoom ${lit.cam.zoom}、x${STREET_X0}..${STREET_X1}×y${BAND_Y0}..${BAND_Y1}、${LIGHT_DY * 100}pp、潮位 ${lit.tideLevel}、相位 night（?time=night 强制）、${lit.worldState.weather}（雨幕 ${lit.rainStrength === null ? '不可读' : lit.rainStrength.toFixed(3)}，${TRUE_CLEAR ? (lit.rainStrength === null ? '真晴·槽位间接' : '真晴') : '未达晴阈'}）、种子 ${SEED}（钉住）、天气口子 ${lit.pinned.weather ? '有' : '无'} / 潮位口子 ${lit.pinned.tide ? '有' : '无'}、视口 1010×700`);
console.log(`  指令 ${lit.stats.totalCommands} / Graphics ${lit.stats.graphicsObjects}；潮位 ${lit.tideLevel}`);
console.log(`  光池指令：灯亮 ${lit.poolCommands} / 灯灭 ${dark.poolCommands}`);
if (diff !== null) {
  for (const [key, label] of [['lit', '灯亮图'], ['dark', '灯灭图']]) {
    const row = diff[key];
    console.log(row === null
      ? `  像素差（${label}）：尺寸不一致，跳过`
      : `  像素差（${label}）：${row.changed} / ${row.pixels} 像素变化（${pct(row.ratio)}），最大差 ${row.max}，平均差 ${row.mean.toFixed(2)}`);
  }
}

// 全景 + 逐列曲线；改前 / 改后都在时多一行差异。
const compose = await browser.newPage({ viewport: { width: 1060, height: 760 }, deviceScaleFactor: 2 });
const encode = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const W = 480;
const H = 320;
const chart = (cols) => {
  const max = Math.max(0.04, ...cols.map((c) => c.delta));
  const pts = cols.map((c, i) => {
    const x = (i / (cols.length - 1)) * 940 + 10;
    const y = 110 - (c.delta / max) * 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const bars = cols.map((c, i) => {
    const x = (i / (cols.length - 1)) * 940 + 10;
    const h = (c.delta / max) * 100;
    return `<rect x="${x.toFixed(1)}" y="${(110 - h).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" fill="${c.delta >= LIGHT_DY ? '#f0a44b' : '#52666a'}"/>`;
  }).join('');
  return `<svg width="960" height="130" viewBox="0 0 960 130">
    <line x1="10" y1="110" x2="950" y2="110" stroke="#2a3138"/>
    <line x1="10" y1="${110 - (LIGHT_DY / max) * 100}" x2="950" y2="${110 - (LIGHT_DY / max) * 100}" stroke="#8b9691" stroke-dasharray="4 3"/>
    ${bars}
    <polyline points="${pts.join(' ')}" fill="none" stroke="#9fd0ff" stroke-width="1"/>
    <text x="10" y="126" fill="#8b9691" font-size="10">x ${STREET_X0}（西）→ ${STREET_X1}（东），灰线 = 1pp 阈值，蓝线 = 逐列最大 ΔY</text>
  </svg>`;
};

const beforeFile = join(BASELINE_DIR, 'lamp-band-before.json');
const afterFile = join(OUT, 'lamp-band-after.json');
let diffRow = '';
if (existsSync(beforeFile) && existsSync(afterFile)) {
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const b = read(beforeFile);
  const a = read(afterFile);
  const px = diff === null || diff.lit === null
    ? ''
    : `<br />像素差（灯亮图）：${pct(diff.lit.ratio)} 像素变化，最大差 ${diff.lit.max}；`
      + `灯灭图 ${pct(diff.dark.ratio)} 像素变化`;
  diffRow = `<div class="panel"><b>改前 → 改后</b><br />
    覆盖 ${pct(b.coverage)} → ${pct(a.coverage)}；最长暗带 ${b.gapCells.toFixed(1)} → ${a.gapCells.toFixed(1)} 格<br />
    ΔY 平均 ${(b.avg * 100).toFixed(2)} → ${(a.avg * 100).toFixed(2)} pp；峰值指令 ${b.stats.totalCommands} → ${a.stats.totalCommands}${px}</div>`;
}

await compose.setContent(
  `<!doctype html><meta charset="utf-8" />
   <style>
     body { margin: 0; background: #0f1216; color: #d8dad3; font: 13px/1.6 "Microsoft YaHei","Noto Sans SC",sans-serif; }
     h1 { font-size: 15px; margin: 14px 20px 2px; font-weight: 600; }
     p.note { margin: 0 20px 10px; color: #8b9691; }
     main { display: flex; gap: 16px; padding: 0 20px 18px; align-items: flex-start; }
     figure { margin: 0; }
     .shots { display: flex; flex-direction: column; gap: 12px; }
     .side { width: 330px; }
     img { image-rendering: pixelated; display: block; border: 1px solid #2a3138; }
     figcaption { padding-top: 4px; color: #c9d1cc; font-size: 12px; }
     .panel { border: 1px solid #2a3138; padding: 8px 10px; margin-bottom: 10px; font-size: 12px; }
     b { color: #f4d596; font-weight: 600; }
     .chart { border: 1px solid #2a3138; padding: 6px; }
   </style>
   <h1>夜街全景：灯光是不是连续暖带（满潮、夜间、zoom 1）</h1>
   <p class="note">同一冻结帧、同一机位；村民钉到画面外。逐列取地面 y ${BAND_Y0}..${BAND_Y1} 的「灯亮 - 灯灭」最大亮度差，ΔY ≥ 1pp 记为有光。</p>
   <main>
     <div class="shots">
       <figure>
         <img src="${encode(lit.file)}" style="width:${W}px;height:${H}px" />
         <figcaption>灯亮：覆盖 <b>${pct(prof.coverage)}</b>，最长暗带 <b>${prof.gapCells.toFixed(1)}</b> 格</figcaption>
       </figure>
       <figure>
         <img src="${encode(dark.file)}" style="width:${W}px;height:${H}px" />
         <figcaption>灯灭：地面不应有残留亮斑（同一帧，只压灯态）</figcaption>
       </figure>
     </div>
     <div class="side">
       <div class="panel"><b>读数</b><br />
         街段 x ${STREET_X0}..${STREET_X1}（5 根灯柱）<br />
         ΔY min ${(prof.min * 100).toFixed(2)} / avg ${(prof.avg * 100).toFixed(2)} / max ${(prof.max * 100).toFixed(2)} pp<br />
         覆盖 ${pct(prof.coverage)}；最长暗带 ${prof.gapCells.toFixed(1)} 格 @ x ${prof.gapAt}<br />
         指令 ${lit.stats.totalCommands} / Graphics ${lit.stats.graphicsObjects}<br />
         光池指令：灯亮 ${lit.poolCommands} / 灯灭 <b>${dark.poolCommands}</b>（应为 0）
       </div>
       ${diffRow}
       <div class="panel" style="color:#8b9691">
         暗带按世界格算（16px = 1 格）。<br />
         灯柱实际间距：同一排 8 格，两排交错 4 格。<br />
         若这是改后：外圈半径 2.5 格（40px），只在相邻两根之间重叠 16px。
       </div>
     </div>
   </main>
   <div class="chart">${chart(prof.cols)}</div>`,
);
await compose.screenshot({ path: join(OUT, `lamp-band-${LABEL}.png`), fullPage: true });
await compose.close();
await browser.close();
console.log(`图 ${join(OUT, `lamp-band-${LABEL}.png`)}`);
