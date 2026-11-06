/**
 * 帧率取样口径（新指标，不进闸门）。
 *
 * 目的：给「升级有没有掉帧」一个有分辨力的读数，而不是拿 4 次 1 秒的
 * 闸门采样去猜。口径固定为：
 *   - 世界时刻钉在 12:30（`freezeWorldClock()` + `pinShotState`），采样期间不推进；
 *   - 相机钉在同一机位（zoom 2、scroll 592/352），角色位置也钉住；
 *   - 每格采样 4000ms，丢弃首个 1000ms 窗（首帧/首秒不进统计），其余窗按
 *     rAF 间隔中位取 fps，再取窗中位作为该格读数；
 *   - 每轮依次测 静止 / 拖动 / 后台；跑 ROUNDS 轮，跨轮给中位、p10、p90、
 *     极值与极差（极差/中位 = 相对离散度），全部落盘。
 *
 * 跑法：
 *   PIXEL_WORLD_URL=http://127.0.0.1:5210/ EVAL_OUT=.../run1 node scripts/fps-protocol.mjs
 *
 * 只读；不写 eval/screens，不改任何闸门阈值。
 */
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const require = createRequire(import.meta.url);
const PHASER_VERSION = require('phaser/package.json').version;

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5210/';

await assertTreeIdentity(BASE);
const OUT = process.env.EVAL_OUT ?? 'tmp/fps-protocol';
const ROUNDS = Number(process.env.ROUNDS ?? 6);
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 4000);
/** 每个采样段丢弃的头部时长（按 1000ms 窗计）。 */
const DISCARD_MS = Number(process.env.DISCARD_MS ?? 1000);
const WINDOW_MS = 1000;
const WARMUP_MS = 2000;
const CAMX = 832;
const CAMY = 512;

const DAY_MS = 86_400_000;
const PIN_MINUTE = 750; // 12:30

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};

/** 从 rAF 时间戳切窗；丢掉首个 DISCARD_MS 窗，其余窗按间隔中位转 fps。 */
const summarizeStamps = (stamps) => {
  const buckets = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const bucket = Math.floor((stamps[i] - stamps[0]) / WINDOW_MS);
    (buckets[bucket] ??= []).push(stamps[i] - stamps[i - 1]);
  }
  const dropWindows = Math.ceil(DISCARD_MS / WINDOW_MS);
  const windows = buckets
    .slice(dropWindows)
    .filter((slice) => Array.isArray(slice) && slice.length > 1)
    .map((slice) => ({ frames: slice.length, medianIntervalMs: median(slice), fps: 1000 / median(slice) }));
  const fps = windows.length ? median(windows.map((w) => w.fps)) : 0;
  return { windows, fps, droppedWindows: dropWindows, keptWindows: windows.length };
};

const collectStamps = async (page, durationMs) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const stamps = [];
        const start = performance.now();
        const tick = (now) => {
          stamps.push(now);
          if (now - start >= duration) resolve(stamps);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );

const setVisibility = (page, hidden) =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden ? 'hidden' : 'visible');

/**
 * 后台读数走 `advanceCount`，和 `check-render-budget.mjs` 同一口径。
 *
 * 无头 Chromium 里覆盖 `visibilityState` 不会真的掐掉 rAF（实测仍 59.9），
 * 但 Phaser 会按省电闸门跳掉「渲染 + 逻辑推进」，真正能看出降频的是
 * 每秒推进帧数。世界时钟仍冻着，`advanceCount` 照样计数，不影响钉住的画面。
 */
const sampleAdvances = async (page, durationMs) => {
  const perSecond = [];
  let previous = await page.evaluate(() => window.Oracle.ecoState().advanceCount);
  for (let elapsed = 0; elapsed < durationMs; elapsed += WINDOW_MS) {
    await page.waitForTimeout(WINDOW_MS);
    const current = await page.evaluate(() => window.Oracle.ecoState().advanceCount);
    perSecond.push((current - previous) * (1000 / WINDOW_MS));
    previous = current;
  }
  const kept = perSecond.slice(Math.ceil(DISCARD_MS / WINDOW_MS));
  return {
    windows: kept.map((fps) => ({ fps })),
    fps: kept.length ? median(kept) : 0,
    droppedWindows: Math.ceil(DISCARD_MS / WINDOW_MS),
    keptWindows: kept.length,
  };
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* 忽略 */
    }
  });
await page.goto(`${BASE}?feed=off&debug=1&time=noon&now=${PIN_MINUTE}&speed=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });

const pinned = await page.evaluate(
  ({ minute, camX, camY }) => {
    const snapshot = window.Oracle.view();
    window.Oracle.freezeWorldClock();
    window.Oracle.pinShotState(Math.floor(snapshot.now / 86400000) * 86400000 + minute * 60000, 0);
    window.Oracle.pinActors(
      snapshot.villagers.map((v) => ({
        id: v.id, pos: { x: v.pos.x, y: v.pos.y }, facing: v.facing, mode: v.mode,
        walking: false, frame: v.frame ?? 0, visible: v.visible,
      })),
    );
    window.Oracle.pinTrails?.([]);
    window.Oracle.setCameraMode('free');
    window.Oracle.centerCameraOn(camX, camY);
    const cam = window.Oracle.camera();
    return {
      nowMinute: Math.round((snapshot.now % 86400000) / 60000),
      camera: { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom },
      villagers: snapshot.villagers.map((v) => ({ id: v.id, pos: v.pos, mode: v.mode })),
    };
  },
  { minute: PIN_MINUTE, camX: CAMX, camY: CAMY },
);

const stage = await page.evaluate(() => {
  const stageEl = document.querySelector('#stage');
  stageEl.style.transformOrigin = 'top left';
  stageEl.style.transform = '';
  const rect = stageEl.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
});

// 预热：只为把着色器编译/纹理上传/JIT 消化掉，读数不进统计。
await page.waitForTimeout(1200);
await collectStamps(page, WARMUP_MS);

const box = await page.locator('#app canvas').boundingBox();
const rounds = [];

for (let round = 1; round <= ROUNDS; round += 1) {
  await page.evaluate(({ x, y }) => window.Oracle.centerCameraOn(x, y), { x: CAMX, y: CAMY });
  await page.waitForTimeout(250);

  const idle = summarizeStamps(await collectStamps(page, SAMPLE_MS));

  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  let motionOn = true;
  const motion = (async () => {
    let step = 0;
    while (motionOn) {
      await page.mouse.move(box.x + 400 + Math.sin(step * 0.5) * 60, box.y + 300 + Math.cos(step * 0.5) * 40);
      step += 1;
      await page.waitForTimeout(40);
    }
  })();
  const drag = summarizeStamps(await collectStamps(page, SAMPLE_MS));
  motionOn = false;
  await motion;
  await page.mouse.up();

  await setVisibility(page, true);
  await page.waitForTimeout(400);
  const background = await sampleAdvances(page, SAMPLE_MS);
  await setVisibility(page, false);
  await page.waitForTimeout(400);

  rounds.push({ round, idle, drag, background });
  console.log(
    `round ${round}: 静止 ${idle.fps.toFixed(1)}（窗 ${idle.keptWindows}）` +
      ` / 拖动 ${drag.fps.toFixed(1)}（窗 ${drag.keptWindows}）` +
      ` / 后台 ${background.fps.toFixed(1)}（窗 ${background.keptWindows}）`,
  );
}

await context.close();
await browser.close();
if (errors.length > 0) throw new Error(`页面报错：${errors.join('；')}`);

const aggregate = (pick) => {
  const values = rounds.map(pick);
  const med = median(values);
  return {
    samples: values,
    median: med,
    p10: quantile(values, 0.1),
    p90: quantile(values, 0.9),
    min: Math.min(...values),
    max: Math.max(...values),
    spread: Math.max(...values) - Math.min(...values),
    relativeSpread: med > 0 ? (Math.max(...values) - Math.min(...values)) / med : 0,
  };
};

const summary = {
  idle: aggregate((r) => r.idle.fps),
  drag: aggregate((r) => r.drag.fps),
  background: aggregate((r) => r.background.fps),
};

await mkdir(OUT, { recursive: true });
const payload = {
  phaserVersion: PHASER_VERSION,
  url: `${BASE}?feed=off&debug=1&time=noon&now=${PIN_MINUTE}&speed=1`,
  protocol: {
    rounds: ROUNDS,
    sampleMs: SAMPLE_MS,
    discardMs: DISCARD_MS,
    windowMs: WINDOW_MS,
    warmupMs: WARMUP_MS,
    camera: { x: CAMX, y: CAMY, zoom: 2 },
    worldClock: `freezeWorldClock + pinShotState(minute=${PIN_MINUTE}, tide=0)`,
  },
  pinned,
  stage,
  rounds,
  summary,
};
await writeFile(`${OUT}/fps-protocol.json`, JSON.stringify(payload, null, 2), 'utf8');

console.log('\n跨轮统计（中位 / p10 / p90 / 极值 / 极差 / 相对离散度）');
for (const state of ['idle', 'drag', 'background']) {
  const s = summary[state];
  console.log(
    `${state.padEnd(10)} ${s.median.toFixed(1)} / ${s.p10.toFixed(1)} / ${s.p90.toFixed(1)}` +
      ` / ${s.min.toFixed(1)}~${s.max.toFixed(1)} / ±${(s.spread / 2).toFixed(1)} / ${(s.relativeSpread * 100).toFixed(1)}%`,
  );
}
console.log(`\n读数落盘：${OUT}/fps-protocol.json`);
