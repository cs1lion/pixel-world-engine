/**
 * 第四条：人物与摊位的**落地投影**随光照相位（正午短 / 黄昏长 / 夜里不做）。
 *
 * 口径与灯街、摊位、幌布、烟四条一致：
 * - 世界冻住后用 `debugStepWorld` 推进；同一时刻 → 同一帧；逐帧 sha256 判确定性。
 * - 灯三支全关、摊位两支全关、幌布两支全关、烟关、鸟藏、湾面低雾藏、
 *   潮位钉 1、天气钉晴（雨点会逐帧乱飘，单个取样点会被雨盖住）。
 * - 投影单独一层（depth 3.1，见 `world/ground-shadow.ts`）：比潮水高、比光池低、
 *   比人物/摊位低三个数量级；不改 `sceneryDepth` / `villagerDepthAt` 的公式。
 * - 对照闭合：同一时刻开 / 关两帧；关掉时跨 t / t+1s 的帧差必须是 0.00%。
 * - 相位三态各取「摊位 + 人物」两处；影长 1 / 7 / 0 px，夜里整层不画。
 * - 人物脚下放大裁图：世界脚底 ±16×±22，原尺寸 + 3×（最近邻，不糊边）。
 *
 * 跑法：
 *   cd world-client && npm run dev -- --port 5202
 *   PIXEL_WORLD_URL=http://127.0.0.1:5202/ node scripts/check-ground-shadow.mjs
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5202/';
const OUT = process.env.EVAL_OUT ?? resolve(import.meta.dirname, '..', 'eval', 'screens');
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const STEADY_A = 1090 * MIN;

/** 摊位机位：西侧摊位都在画面里（与 `check-stall-motion` 同一段街）。 */
const STALL_CAMERA = { x: 400, y: 470 };
const STALL_ROI = { x0: 225, y0: 390, x1: 575, y1: 555 };

/** 人物机位：把 0 号人物钉到固定格 (23,31)，相机跟着它的脚底。 */
const VILLAGER_CAMERA = { x: 400, y: 470 };
// 固定格 (23,31)：前景街面，脚下无栏杆/柜台遮挡，黄昏影子 56 px 全部可见。
// 用 'self' 会随机落到街后栏杆后面（脚被挡住，裁图看不到鞋），已踩过。
const VILLAGER_CELL = { x: 23, y: 31 };

const LAMPS_OFF = { ignite: false, breathe: false, sway: false };
const STALLS_OFF = { cloth: false, fire: false };
const BANNERS_OFF = { sway: false, shadow: false };
const SMOKE_OFF = { drift: false };
const PHASES = ['noon', 'dusk', 'night'];

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

async function openScene(browser, { phase, camera, villagerCell }) {
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

  await page.evaluate(() => {
    for (const selector of [
      '#topbar', '#status', '#minimap', '#queue', '#oracle', '#maintenance',
      '#debug-panel', '#world-overlay', '#chronicle',
    ]) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) element.style.visibility = 'hidden';
    }
  });

  await waitFrames(page, 24);
  // 页面冷启动会吃掉数量不定的帧，世界钟因此每次落点不同；人物钉在「当时的自格」，
  // 影子就可能一会儿被别的摊位影子压住（0.12% 与 0.17% 两跑）。先冻住世界、再统一
  // 推到 18:10:00，让村民位置只由种子决定，再钉人、再量。
  // 注意 `debugStepWorld` 只在 `debugHoldWorld(true)` 之后才推进；不先冻住，这一步是空操作。
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await page.evaluate((target) => {
    const now = window.Oracle.debugStepWorld(0);
    if (target > now) window.Oracle.debugStepWorld(target - now);
  }, STEADY_A);
  await waitFrames(page, 2);
  const chosenCamera = await page.evaluate(([camera, villagerCell]) => {
    for (const villager of window.Oracle.view().villagers) {
      window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
    }
    let lens = camera;
    const target = window.Oracle.view().villagers[0];
    if (target !== undefined && villagerCell === 'self') {
      // 钉在它自己的格子上：那一格必然是能走的街面，不会被建筑或道具盖住。
      window.Oracle.debugPinVillager(target.id, { x: target.pos.x, y: target.pos.y });
      const unit = window.Oracle.debugGroundShadowUnits().villagers.find((item) => item.id === target.id);
      if (unit !== undefined) lens = { x: unit.x, y: unit.y - 70 };
    } else if (target !== undefined && villagerCell !== null) {
      window.Oracle.debugPinVillager(target.id, villagerCell);
    }
    window.Oracle.debugPinTide(1);
    window.Oracle.debugSetWeather?.('clear');
    window.Oracle.debugHideAmbience(true);
    window.Oracle.debugHideBayMist(true);
    window.Oracle.debugLampMotion({ ignite: false, breathe: false, sway: false });
    window.Oracle.debugStallMotion({ cloth: false, fire: false });
    window.Oracle.debugBannerMotion({ sway: false, shadow: false });
    window.Oracle.debugSmokeMotion({ drift: false });
    window.Oracle.centerCameraOn(lens.x, lens.y);
    return lens;
  }, [camera, villagerCell]);
  await waitFrames(page, 40);
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await waitFrames(page, 2);
  return {
    page,
    box,
    errors,
    camera: await page.evaluate(() => window.Oracle.camera()),
    lens: chosenCamera,
  };
}

const hashOf = (buf) => createHash('sha256').update(buf).digest('hex');

async function shot(page, box, id) {
  const file = join(OUT, `ground-shadow-${id}.png`);
  await page.screenshot({ path: file, clip: box });
  const buf = readFileSync(file);
  const meta = await page.evaluate(() => ({
    now: window.Oracle.debugStepWorld(0),
    frame: window.__CAPTURE_STATE__.frame,
    weather: window.Oracle.view().weather,
    units: window.Oracle.debugGroundShadowUnits(),
    stats: window.Oracle.renderStats(),
    camera: window.Oracle.camera(),
  }));
  return { id, file, buf, sha256: hashOf(buf), ...meta };
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
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * a.w + x) * 4;
        let dmax = 0;
        for (let k = 0; k < 3; k += 1) {
          const d = Math.abs(a.data[i + k] - b.data[i + k]);
          if (d > dmax) dmax = d;
        }
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
    };
  }, { b64, roi, cam });
}

/** 从一帧里裁出世界框，按 `scale` 最近邻放大，返回 PNG 字节。 */
async function cropUpscale(page, buf, cam, roi, scale) {
  const b64 = buf.toString('base64');
  const dataUrl = await page.evaluate(async ({ b64, roi, cam, scale }) => {
    const image = new Image();
    await new Promise((res, rej) => {
      image.onload = res;
      image.onerror = rej;
      image.src = `data:image/png;base64,${b64}`;
    });
    const px = (wx) => (wx - cam.worldViewX) * 2 * cam.zoom;
    const py = (wy) => (wy - cam.worldViewY) * 2 * cam.zoom;
    const sx = Math.round(px(roi.x0));
    const sy = Math.round(py(roi.y0));
    const sw = Math.round(px(roi.x1)) - sx;
    const sh = Math.round(py(roi.y1)) - sy;
    const c = document.createElement('canvas');
    c.width = sw * scale;
    c.height = sh * scale;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, { b64, roi, cam, scale });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const pct = (value) => `${(value * 100).toFixed(2)}%`;

const browser = await chromium.launch({ headless: true });
const reader = await browser.newPage();

const phaseRows = [];
let peakCommands = 0;

for (const phase of PHASES) {
  // 摊位：同一时刻开 / 关。
  const stall = await openScene(browser, { phase, camera: STALL_CAMERA, villagerCell: null });
  const stallOn = await shot(stall.page, stall.box, `stall-${phase}-on`);
  await stall.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
  await waitFrames(stall.page, 2);
  const stallOff = await shot(stall.page, stall.box, `stall-${phase}-off`);
  const stallDiff = await diffPair(reader, stallOn.buf, stallOff.buf, stall.camera, STALL_ROI);
  peakCommands = Math.max(peakCommands, stallOn.stats.totalCommands, stallOff.stats.totalCommands);
  await stall.page.close();

  // 人物：同一时刻开 / 关。
  const villager = await openScene(browser, {
    phase,
    camera: VILLAGER_CAMERA,
    villagerCell: VILLAGER_CELL,
  });
  const villagerOn = await shot(villager.page, villager.box, `villager-${phase}-on`);
  await villager.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
  await waitFrames(villager.page, 2);
  const villagerOff = await shot(villager.page, villager.box, `villager-${phase}-off`);
  const foot = villagerOn.units.villagers[0] ?? { x: villager.lens.x, y: villager.lens.y + 70 };
  // ROI 跟着被钉的人走：脚底 ±48 / 上 70 / 下 16 世界像素。
  const villagerRoi = { x0: foot.x - 48, y0: foot.y - 70, x1: foot.x + 48, y1: foot.y + 16 };
  const villagerDiff = await diffPair(reader, villagerOn.buf, villagerOff.buf, villager.camera, villagerRoi);
  peakCommands = Math.max(peakCommands, villagerOn.stats.totalCommands, villagerOff.stats.totalCommands);

  let footCrop = null;
  if (phase === 'dusk') {
    const footRoi = { x0: foot.x - 22, y0: foot.y - 26, x1: foot.x + 22, y1: foot.y + 6 };
    const crop = await cropUpscale(reader, villagerOn.buf, villager.camera, footRoi, 1);
    const crop3x = await cropUpscale(reader, villagerOn.buf, villager.camera, footRoi, 3);
    const cropOff3x = await cropUpscale(reader, villagerOff.buf, villager.camera, footRoi, 3);
    writeFileSync(join(OUT, 'ground-shadow-foot-dusk.png'), crop);
    writeFileSync(join(OUT, 'ground-shadow-foot-dusk-3x.png'), crop3x);
    writeFileSync(join(OUT, 'ground-shadow-foot-dusk-off-3x.png'), cropOff3x);
    footCrop = { roi: footRoi, on3x: hashOf(crop3x), off3x: hashOf(cropOff3x) };
  }

  phaseRows.push({
    phase,
    stall: {
      on: stallOn.units,
      off: stallOff.units,
      diff: stallDiff,
      stats: { on: stallOn.stats, off: stallOff.stats },
    },
    villager: {
      on: villagerOn.units,
      off: villagerOff.units,
      diff: villagerDiff,
      stats: { on: villagerOn.stats, off: villagerOff.stats },
    },
    footCrop,
  });
  await villager.page.close();
}

// 关掉时：同一时刻开两页各拍一张，整画面必须一模一样（这是「关掉为 0」的判据）。
// 人物先钉出画——人物自身站姿随世界时间换帧，不属于这条投影。
const closed = await openScene(browser, { phase: 'dusk', camera: STALL_CAMERA, villagerCell: null });
await closed.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
const closedA = await shot(closed.page, closed.box, 'closed-a');
const closed2 = await openScene(browser, { phase: 'dusk', camera: STALL_CAMERA, villagerCell: null });
await closed2.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
const closed2Shot = await shot(closed2.page, closed2.box, 'closed-b');
const closedSameTime = await diffPair(
  reader,
  closedA.buf,
  closed2Shot.buf,
  closed.camera,
  { x0: -10000, y0: -10000, x1: 10000, y1: 10000 },
);
await closed2.page.close();

// 暂停世界：渲染帧继续走、世界时刻不动，画面必须不动。
// 放在推进世界之前测：此时两页仍在同一时刻。
await closed.page.evaluate(() => window.Oracle.debugGroundShadows({ on: true }));
await waitFrames(closed.page, 2);
const pauseA = await shot(closed.page, closed.box, 'pause-a');
await closed.page.waitForTimeout(1000);
const pauseB = await shot(closed.page, closed.box, 'pause-b');
const pauseDiff = await diffPair(reader, pauseA.buf, pauseB.buf, closed.camera, STALL_ROI);

// 同一页跨 t / t+1s：世界时刻推进到 18:10:00 后，那条时间驱动的 180×4 横条不在画面里，
// 关掉投影时这一步应为 0.00%；若哪天读数非 0，先查横条 bbox，再归因到这一层。
await closed.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
await closed.page.evaluate(() => window.Oracle.debugStepWorld(60_000));
await waitFrames(closed.page, 2);
const closedB = await shot(closed.page, closed.box, 'closed-t1');
const closedStep = await diffPair(
  reader,
  closedA.buf,
  closedB.buf,
  closed.camera,
  { x0: -10000, y0: -10000, x1: 10000, y1: 10000 },
);
await closed.page.close();

// 确定性：同一份配置开两个页面，各自从 18:10:00 起每 10 世界秒一帧，逐帧 sha256 比。
async function runPass(tag) {
  const scene = await openScene(browser, { phase: 'dusk', camera: STALL_CAMERA, villagerCell: null });
  await scene.page.evaluate(() => window.Oracle.debugGroundShadows({ on: true }));
  // 页面启动耗时不同会让世界钟停在不同的绝对时刻；先推到统一的 18:10:00，
  // 再等场景稳定（昼夜调色是帧驱动的），两遍才有同一组绝对帧。
  await scene.page.evaluate((target) => {
    const now = window.Oracle.debugStepWorld(0);
    window.Oracle.debugStepWorld(target - now);
  }, STEADY_A);
  await waitFrames(scene.page, 30);
  const hashes = [];
  let commands = 0;
  for (let i = 0; i < 13; i += 1) {
    if (i > 0) {
      await scene.page.evaluate(() => window.Oracle.debugStepWorld(10_000));
      await waitFrames(scene.page, 3);
    }
    hashes.push(hashOf(await scene.page.screenshot({ clip: scene.box, path: null })));
    commands = (await scene.page.evaluate(() => window.Oracle.renderStats())).totalCommands;
  }
  peakCommands = Math.max(peakCommands, commands);
  await scene.page.close();
  return hashes;
}

const pass1 = await runPass('a');
const hashes2 = await runPass('b');
await reader.close();
await browser.close();

const determinism = pass1.filter((hash, index) => hash === hashes2[index]).length;

const result = {
  params: {
    cameraStall: STALL_CAMERA,
    cameraVillager: VILLAGER_CAMERA,
    villagerCell: VILLAGER_CELL,
    roiStall: STALL_ROI,
    roiVillager: '脚底 ±48 / 上 70 / 下 16（跟着被钉的人走）',
    viewport: { width: 1010, height: 700 },
    tide: 1,
    weather: 'clear',
    phase: PHASES,
    now: STEADY_A,
    depth: 3.1,
  },
  phases: phaseRows,
  closed: { sameTime: closedSameTime, step: closedStep },
  pause: { diff: pauseDiff, framesAdvanced: pauseB.frame - pauseA.frame, nowA: pauseA.now, nowB: pauseB.now },
  determinism,
  determinismProbe: { pass1, pass2: hashes2 },
  peakCommands,
};

writeFileSync(join(OUT, 'ground-shadow.json'), `${JSON.stringify(result, null, 2)}\n`);

const row = (name, phase) => {
  const item = phaseRows.find((entry) => entry.phase === phase);
  return `${name} ${phase} 开/关 ${pct(item[name].diff.ratio)}`;
};
for (const item of phaseRows) {
  const spans = item.stall.on.stalls?.map((unit) => unit.span) ?? [];
  console.log(
    `${item.phase}: 摊位开/关 ${pct(item.stall.diff.ratio)}（${item.stall.diff.changed}px，影长 ${spans.join(',')}）`
    + ` / 人物开/关 ${pct(item.villager.diff.ratio)}（${item.villager.diff.changed}px）`,
  );
}
console.log(`全关同刻两页 ${pct(closedSameTime.ratio)}（${closedSameTime.changed}px）；跨 t/t+1s ${pct(closedStep.ratio)}（${closedStep.changed}px，既有横条）`);
console.log(`暂停 ${pct(pauseDiff.ratio)}（帧 +${pauseB.frame - pauseA.frame}）`);
console.log(`确定性 ${determinism}/13；峰值指令 ${peakCommands}`);
console.log(`口径 机位 摊位 x${STALL_CAMERA.x}/y${STALL_CAMERA.y}、人物 x${VILLAGER_CAMERA.x}/y${VILLAGER_CAMERA.y}、zoom ${closed.camera.zoom}、视口 1010×700、潮位 1、晴、相位 ${PHASES.join('/')}、depth 3.1`);
void row;
