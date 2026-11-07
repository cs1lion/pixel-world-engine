/**
 * KB 要点 4 的可测判据：**发光块的亮度比 + 周边材质数**。
 *
 * KB 原文（D:\project\pixel-world-engine 的 docs/DESIGN_ACCEPTANCE.md，另一棵只读树，不在本仓）：
 *   「黄昏固定机位下，以最亮窗/灯为中心取 8×8 patch、其外 32×32 环形 annulus，要求
 *     (meanL(patch) − meanL(annulus)) / 255 ≥ 0.18；同一机位 noon 相位的同一 patch 该比值
 *     必须 < 0.10；annulus 内至少出现 3 种地形 token 色。」
 *
 * 可测形式（本条判据的取样区域 / 阈值 / 比较对象）
 * ----------------------------------------------
 * - **取样区域**：固定机位 = `lamp_post_10` 的池心 (832,522)，zoom 1，视口 1010×700。
 *   在该帧 `debugLampUnits()` 里逐盏量灯体 8×8 世界像素，取最亮的一盏，再以它 8×8 内
 *   最亮的像素为**中心**。patch = 中心 ±4 世界 px；annulus = 中心 ±16 世界 px 的方框
 *   减去 patch（即「其外」）。
 * - **单位**：8×8 / 32×32 按**世界像素**（= 设计像素）取。截图是 2× 渲染，所以截图里
 *   patch 16×16、annulus 64×64。理由：截图像素口径下 annulus 只有 16×16 世界 px（一格），
 *   一格只有一种地形，KB 的「≥3 种地形 token」永远不可能满足——两条要求只在设计像素
 *   口径下自洽。另报一份截图像素口径（4×4 / 16×16 世界 px）作为灵敏度参照，不参与判定。
 * - **阈值**：dusk `ratio ≥ 0.18`；noon `ratio < 0.10`；annulus 内 ≥3 种地形 token
 *   （按最近 token 色分类，覆盖 ≥1% annulus 像素才算「出现」）。阈值原样照抄，不改。
 * - **比较对象**：noon 用**同一个世界中心**、同一机位、同一 patch/annulus；灯在 noon
 *   强制关（`debugForceLamps(false)`），否则「白天的灯还亮着」会把 noon 对照废掉。
 * - **亮度**：Rec.601 `0.299R+0.587G+0.114B`，与 KB 的读数脚本
 *   measure-design-readouts.mjs 同口径（那一份也在另一棵只读树里）。
 *
 * **ratio 的定义式（可反解，不是一句「实测 0.012」）**
 * ------------------------------------------------
 * `ratio = (meanL(patch) − meanL(annulus)) / 255`
 *   - `meanL` = 对**最终帧**逐像素取 Rec.601 加权亮度，再做算术平均；
 *   - 取的是浏览器截图里的 **8 位 sRGB 值**（R/G/B 0..255），**不做线性化**、不取亮度 Y；
 *   - 所有合成（全屏 dim、alpha、ADD 光池、灯体）都已在这张最终帧里，不再拆层重算。
 *
 * 因此阈值 0.18 等价于 `patch − annulus = 45.9 luma`。反解（给定 patch 与阈值）：
 * `annulus_target = patch − 0.18 × 255`。本脚本把这两个数直接写进结果，
 * 改光池时以它为靶子，而不是拿「尽量亮」当目标。
 *
 * **读数满足 ≠ 机制实现了「局部压低周边」。** 本实现的机制是**全屏 dim + ADD 光池**：
 * annulus 没有被局部压暗，它只是在全局 dim 下一起变暗。脚本把
 * `mechanism` 单独写进结果，不用 `ratio` 通过来冒充机制通过。
 *
 * 输出只写 `tmp/screens/check-glow-contrast/`，不写 `eval/screens`。
 * 跑法：
 *   cd world-client && npm run dev -- --port 5301
 *   PIXEL_WORLD_URL=http://127.0.0.1:5301/ node scripts/check-glow-contrast.mjs
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';
import { resolveShotDir } from './lib/shot-output.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;
await assertTreeIdentity(BASE);
const OUT = resolveShotDir('check-glow-contrast');
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const STEADY_A = 1090 * MIN;
/** 与 `check-lamp-pool.mjs` 的 SAMPLE 同一点：灯柱 (51,32) 的池心。 */
const CAMERA = { x: 832, y: 522 };
const PATCH_W = 8;
const ANNULUS_W = 32;
const DUSK_MIN = 0.18;
const NOON_MAX = 0.10;
const TOKEN_MIN = 3;
/** KB 反例护栏：patch 内不同颜色级数 ≥4（防止「提亮成纯白」把细节抹平）。 */
const PATCH_LEVEL_MIN = 4;
/**
 * 「局部压低周边」的最小可测回升量（luma）。
 *
 * 同一冻结帧、只拨 `debugLampLocalShade` 一个开关、annulus 由 960 个像素取平均：
 * 量化噪声上限 ~0.01 luma，1.0 luma 已是几十倍余量。门槛不取 0 是为了挡住
 * 「关掉后画面上什么都没变，却因取整抖动判真」。
 */
const SUPPRESSION_MIN_LUMA = 1.0;
/**
 * `setting-scenery.ts` 里 `LAMP_SHADE_RINGS` 的镜像（世界 px / alpha），用来把实测回升
 * 反解成「几何覆盖率」再给压暗上限：外端 17 被 annulus 边 16 截断。两处必须同步改。
 */
const SHADE_RINGS = [
  { from: 5, to: 9, alpha: 0.20 },
  { from: 9, to: 13, alpha: 0.13 },
  { from: 13, to: 16, alpha: 0.08 },
];
/** 调色板能拿到的最暗色（`palette-data.ts` 的 ink 0x14110d）。压暗的下限就是它。 */
const INK_RGB = [0x14, 0x11, 0x0d];
const INK_LUMA = 0.299 * INK_RGB[0] + 0.587 * INK_RGB[1] + 0.114 * INK_RGB[2];
/** 灯芯可用的最亮既有色（`palette-data.ts` 的 warmLight 0xf2c879），不新增色的天花板。 */
const WARM_RGB = [0xf2, 0xc8, 0x79];
const WARM_LUMA = 0.299 * WARM_RGB[0] + 0.587 * WARM_RGB[1] + 0.114 * WARM_RGB[2];
/** 「灯影响到的像素」判据：同一帧开灯/关灯 luma 差 ≥5。 */
const FOOTPRINT_DELTA = 5.0;
/** 灯潮界的 7 个地形 token 色（`settings/dengchao/pack.ts` 的 terrainColors 解析结果）。 */
const TERRAIN_TOKENS = [
  { id: 'grass', rgb: [0x30, 0x45, 0x4a] },
  { id: 'stone', rgb: [0x52, 0x66, 0x6a] },
  { id: 'plaza', rgb: [0x7d, 0x89, 0x84] },
  { id: 'farm', rgb: [0x3d, 0x51, 0x54] },
  { id: 'soil(tree/mud)', rgb: [0x20, 0x2b, 0x35] },
  { id: 'moss(shallow)', rgb: [0x47, 0x64, 0x5c] },
  { id: 'charcoal(coal)', rgb: [0x2c, 0x34, 0x39] },
];

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

async function openPage(browser, { phase, lampsOn }) {
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
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await page.evaluate((target) => {
    const now = window.Oracle.debugStepWorld(0);
    if (target > now) window.Oracle.debugStepWorld(target - now);
  }, STEADY_A);
  await waitFrames(page, 2);
  await page.evaluate(([camera, lampsOn]) => {
    for (const villager of window.Oracle.view().villagers) {
      window.Oracle.debugPinVillager(villager.id, { x: 2, y: 2 });
    }
    window.Oracle.debugPinTide(1);
    window.Oracle.debugSetWeather?.('clear');
    window.Oracle.debugHideAmbience(true);
    window.Oracle.debugHideBayMist(true);
    window.Oracle.debugLampMotion({ ignite: false, breathe: false, sway: false });
    window.Oracle.debugStallMotion({ cloth: false, fire: false });
    window.Oracle.debugBannerMotion({ sway: false, shadow: false });
    window.Oracle.debugSmokeMotion({ drift: false });
    window.Oracle.debugForceLamps(lampsOn);
    window.Oracle.centerCameraOn(camera.x, camera.y);
  }, [CAMERA, lampsOn]);
  await waitFrames(page, 40);
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await waitFrames(page, 2);
  return {
    page,
    box,
    errors,
    camera: await page.evaluate(() => window.Oracle.camera()),
    lamps: await page.evaluate(() => window.Oracle.debugLampUnits()),
  };
}

const hashOf = (buf) => createHash('sha256').update(buf).digest('hex');

async function shot(page, box, id) {
  const file = join(OUT, `glow-${id}.png`);
  await page.screenshot({ path: file, clip: box });
  const buf = readFileSync(file);
  return { file, buf, sha256: hashOf(buf), ...(await page.evaluate(() => ({
    now: window.Oracle.debugStepWorld(0),
    frame: window.__CAPTURE_STATE__.frame,
    stats: window.Oracle.renderStats(),
    camera: window.Oracle.camera(),
  }))) };
}

/** 在给定世界方框内找最亮像素；返回截图内的像素中心。 */
async function brightest(page, buf, cam, rectWorld) {
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64, cam, rectWorld }) => {
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
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const px = (wx) => (wx - cam.worldViewX) * 2 * cam.zoom;
    const py = (wy) => (wy - cam.worldViewY) * 2 * cam.zoom;
    const x0 = Math.max(0, Math.round(px(rectWorld.x0)));
    const x1 = Math.min(c.width, Math.round(px(rectWorld.x1)));
    const y0 = Math.max(0, Math.round(py(rectWorld.y0)));
    const y1 = Math.min(c.height, Math.round(py(rectWorld.y1)));
    let best = { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), l: -1 };
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * c.width + x) * 4;
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (l > best.l) best = { x, y, l };
      }
    }
    return best;
  }, { b64, cam, rectWorld });
}

/**
 * 通道裁剪检查：任一通道到 255 就是「靠 ADD 叠到饱和」，是这条改动的红线。
 * 只统计世界帧（UI 已隐藏）；`pale` 最亮 216，不该有任何 255。
 */
async function channelStats(page, buf) {
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64 }) => {
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
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let maxR = 0;
    let maxG = 0;
    let maxB = 0;
    let clipped = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > maxR) maxR = r;
      if (g > maxG) maxG = g;
      if (b > maxB) maxB = b;
      if (r >= 255 || g >= 255 || b >= 255) clipped += 1;
    }
    return { maxR, maxG, maxB, clipped, pixels: data.length / 4 };
  }, { b64 });
}

/**
 * patch / annulus 读数。center 是**截图像素**，patchW / annulusW 是**世界像素**（8 / 32）。
 * annulus 取外框减 patch；地形 token 计数也在这里做（同一帧的颜色，避免另开一页口径漂）。
 */
async function readPatchAnnulus(page, buf, cam, center, patchW, annulusW) {
  const b64 = buf.toString('base64');
  // 环界在 Node 侧算好传进去（page.evaluate 里看不到模块级常量）。
  const ringEdges = annulusW >= 32
    ? [SHADE_RINGS[0].from, SHADE_RINGS[1].from, SHADE_RINGS[2].from, annulusW / 2]
    : [];
  return page.evaluate(async ({ b64, cam, center, patchW, annulusW, ringEdges, tokens }) => {
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
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const scale = 2 * cam.zoom;
    const halfPatch = Math.round((patchW * scale) / 2);
    const halfAnnulus = Math.round((annulusW * scale) / 2);
    // 分环：与 `setting-scenery.ts` 的三档压暗环一一对应，用来反解「几何覆盖率」与压暗上限。
    // 截图像素口径的灵敏度参照（annulus 16 世界 px）不分环，避免环界越界。
    const rings = ringEdges.slice(1).map((to, i) => ({ from: ringEdges[i], to, sum: 0, n: 0 }));
    const px0 = Math.max(0, center.x - halfPatch);
    const px1 = Math.min(c.width, center.x + halfPatch);
    const py0 = Math.max(0, center.y - halfPatch);
    const py1 = Math.min(c.height, center.y + halfPatch);
    const ox0 = Math.max(0, center.x - halfAnnulus);
    const ox1 = Math.min(c.width, center.x + halfAnnulus);
    const oy0 = Math.max(0, center.y - halfAnnulus);
    const oy1 = Math.min(c.height, center.y + halfAnnulus);
    let patchSum = 0;
    let patchN = 0;
    const patchLevels = new Set();
    let annulusSum = 0;
    let annulusN = 0;
    const counts = new Map(tokens.map((token) => [token.id, 0]));
    let classified = 0;
    for (let y = oy0; y < oy1; y += 1) {
      for (let x = ox0; x < ox1; x += 1) {
        const i = (y * c.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const inPatch = x >= px0 && x < px1 && y >= py0 && y < py1;
        if (inPatch) {
          patchSum += l;
          patchN += 1;
          patchLevels.add(`${r},${g},${b}`);
          continue;
        }
        annulusSum += l;
        annulusN += 1;
        const dWorld = Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) / scale;
        const ring = rings.find((row) => dWorld >= row.from && dWorld < row.to);
        if (ring !== undefined) {
          ring.sum += l;
          ring.n += 1;
        }
        // 最近 token 色；距离 > 60 视为「不是地形」（墙、窗、灯、阴影都别算进来）。
        let best = null;
        for (const token of tokens) {
          const d = Math.hypot(r - token.rgb[0], g - token.rgb[1], b - token.rgb[2]);
          if (best === null || d < best.d) best = { id: token.id, d };
        }
        if (best !== null && best.d <= 60) {
          counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
          classified += 1;
        }
      }
    }
    const patch = patchN ? patchSum / patchN : 0;
    const annulus = annulusN ? annulusSum / annulusN : 0;
    const tokenRows = [...counts.entries()]
      .map(([id, n]) => ({ id, pixels: n, share: annulusN === 0 ? 0 : n / annulusN }))
      .sort((a, b2) => b2.pixels - a.pixels);
    return {
      patch,
      annulus,
      ratio: (patch - annulus) / 255,
      patchBox: [px0, py0, px1 - px0, py1 - py0],
      annulusBox: [ox0, oy0, ox1 - ox0, oy1 - oy0],
      patchPixels: patchN,
      patchLevels: patchLevels.size,
      annulusPixels: annulusN,
      rings: rings.map((row) => ({ from: row.from, to: row.to, pixels: row.n, mean: row.n ? row.sum / row.n : 0 })),
      tokenRows,
      tokenCount: tokenRows.filter((row) => row.share >= 0.01).length,
      classifiedShare: annulusN === 0 ? 0 : classified / annulusN,
    };
  }, { b64, cam, center, patchW, annulusW, ringEdges, tokens: TERRAIN_TOKENS });
}

/**
 * patch 的亮度上限 —— 不新增色、不扩发光足迹时最多能做到多少。
 *
 * 「灯的地盘」= 同一帧开灯/关灯两张图里 luma 差 ≥5 的像素（灯芯、纸面、光池都算）。
 * 上限 = 把地盘内每个像素都推到 patch 内实测最亮的那一个；地盘外的像素按关灯帧不动。
 * 若这个上限仍低于反解需要的 patch，就说明「只调亮度到不了」，必须把发光块画得比
 * 灯体更大——那是美术边界，不是调参。
 */
async function patchCeiling(page, onBuf, offBuf, cam, center, patchW) {
  return page.evaluate(async ({ onB64, offB64, cam, center, patchW, delta }) => {
    const load = async (b64) => {
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
      ctx.drawImage(image, 0, 0);
      return { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
    };
    const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const on = await load(onB64);
    const off = await load(offB64);
    const scale = 2 * cam.zoom;
    const half = Math.round((patchW * scale) / 2);
    const x0 = Math.max(0, center.x - half);
    const x1 = Math.min(on.width, center.x + half);
    const y0 = Math.max(0, center.y - half);
    const y1 = Math.min(on.height, center.y + half);
    let pixels = 0;
    let footprint = 0;
    let onSum = 0;
    let footprintSumOn = 0;
    let maxOn = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * on.width + x) * 4;
        const lOn = luma(on.data, i);
        const lOff = luma(off.data, i);
        pixels += 1;
        onSum += lOn;
        if (lOn > maxOn) maxOn = lOn;
        if (Math.abs(lOn - lOff) >= delta) {
          footprint += 1;
          footprintSumOn += lOn;
        }
      }
    }
    const restSum = onSum - footprintSumOn;
    return {
      pixels,
      footprintPixels: footprint,
      footprintShare: pixels === 0 ? 0 : footprint / pixels,
      patchOn: pixels === 0 ? 0 : onSum / pixels,
      maxOn,
      ceiling: pixels === 0 ? 0 : (restSum + footprint * maxOn) / pixels,
    };
  }, {
    onB64: onBuf.toString('base64'),
    offB64: offBuf.toString('base64'),
    cam,
    center,
    patchW,
    delta: FOOTPRINT_DELTA,
  });
}

const browser = await chromium.launch({ headless: true });

const duskScene = await openPage(browser, { phase: 'dusk', lampsOn: true });
const duskShot = await shot(duskScene.page, duskScene.box, 'dusk');
// 选「最亮的一盏」：逐盏量灯体 8×8 世界像素的最大亮度，取全局最大。
// 只看视口内的灯——视口外的灯被 clamp 到边缘，量到的不是它自己。
const view = {
  x0: duskShot.camera.worldViewX + 8,
  x1: duskShot.camera.worldViewX + duskShot.camera.width / (2 * duskShot.camera.zoom) - 8,
  y0: duskShot.camera.worldViewY + 8,
  y1: duskShot.camera.worldViewY + duskShot.camera.height / (2 * duskShot.camera.zoom) - 8,
};
const lampRows = [];
for (const lamp of duskScene.lamps) {
  if (lamp.x < view.x0 || lamp.x > view.x1 || lamp.y < view.y0 || lamp.y > view.y1) continue;
  const rect = { x0: lamp.x - 4, x1: lamp.x + 4, y0: lamp.y - 4, y1: lamp.y + 4 };
  const best = await brightest(duskScene.page, duskShot.buf, duskShot.camera, rect);
  lampRows.push({ order: lamp.order, hanging: lamp.hanging, world: { x: lamp.x, y: lamp.y }, best });
}
if (lampRows.length === 0) throw new Error('视口内没有灯，固定机位选错');
lampRows.sort((a, b) => b.best.l - a.best.l);
const chosen = lampRows[0];
const center = { x: chosen.best.x, y: chosen.best.y };
const worldCenter = {
  x: duskShot.camera.worldViewX + center.x / (2 * duskShot.camera.zoom),
  y: duskShot.camera.worldViewY + center.y / (2 * duskShot.camera.zoom),
};
const dusk = await readPatchAnnulus(duskScene.page, duskShot.buf, duskShot.camera, center, PATCH_W, ANNULUS_W);
const duskImagePx = await readPatchAnnulus(duskScene.page, duskShot.buf, duskShot.camera, center, PATCH_W / 2, ANNULUS_W / 2);
const duskChannels = await channelStats(duskScene.page, duskShot.buf);

// 机制对照：同一冻结帧、同一机位，只关掉「局部压低周边」。annulus 的回升量就是
// 「真把周边压暗」的证据；全屏 dim 在这一步完全不动，所以回升不可能来自 dim。
await duskScene.page.evaluate(() => window.Oracle.debugLampLocalShade(false));
const duskNoShadeShot = await shot(duskScene.page, duskScene.box, 'dusk-noshade');
const duskNoShade = await readPatchAnnulus(
  duskScene.page, duskNoShadeShot.buf, duskNoShadeShot.camera, center, PATCH_W, ANNULUS_W,
);
await duskScene.page.evaluate(() => window.Oracle.debugLampLocalShade(true));
const duskNoShadeChannels = await channelStats(duskScene.page, duskNoShadeShot.buf);
await duskScene.page.close();

// 环境对照：同一机位、同一中心、灯全关。把 annulus 拆成「环境底色 + 光池贡献」两部分：
// 光池只会往上加，所以关灯后的 annulus 是**任何光池改动都到不了的下限**。
const duskOffScene = await openPage(browser, { phase: 'dusk', lampsOn: false });
const duskOffShot = await shot(duskOffScene.page, duskOffScene.box, 'dusk-off');
const duskOff = await readPatchAnnulus(
  duskOffScene.page, duskOffShot.buf, duskOffShot.camera, center, PATCH_W, ANNULUS_W,
);
const duskOffChannels = await channelStats(duskOffScene.page, duskOffShot.buf);
// patch 上限：用同一帧的开灯/关灯两张图量「灯的地盘」，再把地盘推满到实测最亮像素。
const ceiling = await patchCeiling(
  duskOffScene.page, duskShot.buf, duskOffShot.buf, duskShot.camera, center, PATCH_W,
);
await duskOffScene.page.close();

const noonScene = await openPage(browser, { phase: 'noon', lampsOn: false });
const noonShot = await shot(noonScene.page, noonScene.box, 'noon');
// noon：同一世界中心 → 同一截图像素（相机/zoom 相同）。
const noon = await readPatchAnnulus(noonScene.page, noonShot.buf, noonShot.camera, center, PATCH_W, ANNULUS_W);
const noonImagePx = await readPatchAnnulus(noonScene.page, noonShot.buf, noonShot.camera, center, PATCH_W / 2, ANNULUS_W / 2);
const noonChannels = await channelStats(noonScene.page, noonShot.buf);
await noonScene.page.close();

// 第三相（dawn）只作读数：KB 阈值只定义了 dusk / noon 两端，这里补一相看「非阈值相」的比值，
// 防止把 dusk 的读数当成「所有相位都这样」。灯强制点亮——要量的是同一块发光在更亮的环境里
// 还剩多少对比，关灯就成了量一张死灯。
const dawnScene = await openPage(browser, { phase: 'dawn', lampsOn: true });
const dawnShot = await shot(dawnScene.page, dawnScene.box, 'dawn');
const dawn = await readPatchAnnulus(dawnScene.page, dawnShot.buf, dawnShot.camera, center, PATCH_W, ANNULUS_W);
const dawnChannels = await channelStats(dawnScene.page, dawnShot.buf);
await dawnScene.page.close();
await browser.close();

// 地形 token 在 **noon** 帧计数：dusk 的相位 dim 会把地形色整体压偏，最近 token 分类
// 会跟 dim 较劲；noon 无 dim，测的是材质本身。同一个 annulus 世界区域，只是换了相位。
const duskTokenCrossCheck = dusk.tokenRows;
const tokenRows = noon.tokenRows;

// 反解：阈值是 ratio，不是「annulus 绝对值」。给定 patch，ratio 就是一个 luma 差。
//   ratio ≥ 0.18 ⇔ patch − annulus ≥ 45.9 ⇔ annulus ≤ patch − 45.9
//   ratio < 0.10 ⇔ annulus > patch − 25.5（noon 是上界，反解给的是「不能低于多少」）
const GAP_DUSK = DUSK_MIN * 255;
const GAP_NOON = NOON_MAX * 255;
const inverse = {
  definition: 'ratio = (meanL(patch) − meanL(annulus)) / 255；meanL 是最终帧 8 位 sRGB 的 Rec.601 加权平均，不线性化',
  gapLumaDusk: GAP_DUSK,
  gapLumaNoon: GAP_NOON,
  dusk: {
    patch: dusk.patch,
    annulus: dusk.annulus,
    annulusTarget: dusk.patch - GAP_DUSK,
    annulusMustDrop: dusk.annulus - (dusk.patch - GAP_DUSK),
    ambientAnnulusLampsOff: duskOff.annulus,
    ambientPatchLampsOff: duskOff.patch,
    poolSpill: dusk.annulus - duskOff.annulus,
    ambientAtOrAboveTarget: duskOff.annulus >= dusk.patch - GAP_DUSK,
    patchNeededIfAnnulusFixed: dusk.annulus + GAP_DUSK,
    ringsOn: dusk.rings,
    ringsOff: duskNoShade.rings,
    ringsLampsOff: duskOff.rings,
  },
  noon: {
    patch: noon.patch,
    annulus: noon.annulus,
    annulusMustStayAbove: noon.patch - GAP_NOON,
    patchNeededIfAnnulusFixed: noon.annulus + GAP_NOON,
  },
};
// 机制：不是看 ratio，是看「关掉局部压暗后 annulus 回升多少」。回升 ≥1.0 luma 才算真压低。
const suppressionDelta = duskNoShade.annulus - dusk.annulus;
const mechanism = {
  implementation: '全屏相位 dim（压整帧）+ 灯/窗光池 + 每盏灯三档 ink 局部压暗（环带 5–17 世界 px）',
  localSurroundSuppression: suppressionDelta >= SUPPRESSION_MIN_LUMA,
  suppressionDelta,
  threshold: SUPPRESSION_MIN_LUMA,
  annulusWithShade: dusk.annulus,
  annulusWithoutShade: duskNoShade.annulus,
  patchWithShade: dusk.patch,
  patchWithoutShade: duskNoShade.patch,
  patchDelta: duskNoShade.patch - dusk.patch,
  note: '同一冻结帧、同一机位、同一全屏 dim，只拨 debugLampLocalShade；回升量即局部压低的净效应。',
};

// 压暗上限：把实测回升按 alpha 反解成「几何覆盖率」，再问「就算把 alpha 推到 1 全不透明，
// 这套几何（环带 5–16 世界 px、画在 lampLight 层）最多还能压多少」。
// 这一步是停手条件的判据：如果 alpha=1 都到不了 0.18，就不是调参问题。
const shadeBound = (() => {
  const rows = SHADE_RINGS.map((ring, i) => {
    const on = dusk.rings[i];
    const off = duskNoShade.rings[i];
    if (on === undefined || off === undefined || off.pixels === 0) return null;
    const drop = off.mean - on.mean;
    const headroom = off.mean - INK_LUMA;
    const coveredShare = ring.alpha > 0 && headroom > 0 ? Math.min(1, drop / (ring.alpha * headroom)) : 0;
    return {
      from: ring.from, to: ring.to, alpha: ring.alpha, pixels: on.pixels,
      meanWithShade: on.mean, meanWithoutShade: off.mean, drop, headroom, coveredShare,
      opaqueDrop: headroom * coveredShare,
    };
  }).filter((row) => row !== null);
  const pixels = rows.reduce((sum, row) => sum + row.pixels, 0);
  const maxDropLuma = pixels === 0 ? 0 : rows.reduce((sum, row) => sum + row.pixels * row.opaqueDrop, 0) / pixels;
  const annulusIfOpaque = dusk.annulus - maxDropLuma;
  return {
    note: 'coveredShare = 实测回落 / (当前 alpha ×（关压暗时该环均值 − ink luma）) = 这环真正被压到的像素占比；'
      + 'opaqueDrop = 该环在 alpha=1 时最多能压掉的 luma。',
    inkLuma: INK_LUMA,
    rings: rows,
    maxDropLuma,
    annulusIfOpaque,
    ratioIfOpaque: (dusk.patch - annulusIfOpaque) / 255,
    targetReachedAtOpaque: (dusk.patch - annulusIfOpaque) / 255 >= DUSK_MIN,
  };
})();

// patch 上限：不新增色、不把发光块画得比灯体更大时，patch 最多能到多少。
const patchBound = {
  note: 'footprint = 同一帧开灯/关灯 luma 差 ≥5 的像素；ceiling = 把 footprint 内全部推到实测最亮像素。',
  footprintPixels: ceiling.footprintPixels,
  footprintShare: ceiling.footprintShare,
  maxOnLuma: ceiling.maxOn,
  ceilLuma: ceiling.ceiling,
  warmLumaPalette: WARM_LUMA,
  requiredPatchVsCurrentAnnulus: inverse.dusk.patchNeededIfAnnulusFixed,
  requiredPatchVsAmbient: duskOff.annulus + GAP_DUSK,
  shortfallVsAmbient: duskOff.annulus + GAP_DUSK - ceiling.ceiling,
  enoughVsAmbient: ceiling.ceiling >= duskOff.annulus + GAP_DUSK,
};

// 通道裁剪归属：灯开/灯关两帧裁剪数一样 ⇒ 这是既有 ADD 窗光，不是本轮灯改动引入。
const clipping = {
  duskOn: duskChannels.clipped,
  duskOff: duskOffChannels.clipped,
  duskNoShade: duskNoShadeChannels.clipped,
  dawn: dawnChannels.clipped,
  noon: noonChannels.clipped,
  attributableToLamp: duskChannels.clipped !== duskOffChannels.clipped
    || duskChannels.maxR !== duskOffChannels.maxR
    || duskChannels.maxG !== duskOffChannels.maxG
    || duskChannels.maxB !== duskOffChannels.maxB,
};

const failures = [];
if (!(dusk.ratio >= DUSK_MIN)) failures.push(`dusk ratio ${dusk.ratio.toFixed(3)} < ${DUSK_MIN}`);
if (!(noon.ratio < NOON_MAX)) failures.push(`noon ratio ${noon.ratio.toFixed(3)} ≥ ${NOON_MAX}`);
// KB 的反例护栏：只把 patch 提亮成纯白会让比值达标、但材质细节归零。patch 内灰度级数 ≥4。
if (dusk.patchLevels < PATCH_LEVEL_MIN) {
  failures.push(`dusk patch 只有 ${dusk.patchLevels} 级色 < ${PATCH_LEVEL_MIN}：发光块被提亮成一片纯色`);
}
if (!mechanism.localSurroundSuppression) {
  failures.push(`局部压低周边未成立：关掉压暗后 annulus 只回升 ${suppressionDelta.toFixed(2)} < ${SUPPRESSION_MIN_LUMA}`
    + '（这是「全屏 dim + 亮灯芯」而不是「压低周边」）');
}
if (noon.tokenCount < TOKEN_MIN) {
  failures.push(`annulus 地形 token ${noon.tokenCount} < ${TOKEN_MIN}（noon 帧：`
    + `${tokenRows.filter((row) => row.share >= 0.01).map((row) => row.id).join('/') || '无'}）`);
}
// 红线：最坏帧不许出现通道 255 裁剪。灯芯若靠 ADD 叠到饱和，这里会红。
// 归属单独标：灯开/灯关两帧一样就是既有窗光，不是本轮灯改动引入——但**红条照留**，
// 「既有」不等于「可以接受」。
for (const [label, channels] of [
  ['dusk', duskChannels], ['dusk（灯关）', duskOffChannels],
  ['dusk（压暗关）', duskNoShadeChannels], ['dawn', dawnChannels], ['noon', noonChannels],
]) {
  if (channels.clipped !== 0) {
    const source = label === 'dusk' && !clipping.attributableToLamp
      ? '（灯关帧同样裁剪，属既有 ADD 窗光，非本轮灯改动）'
      : '';
    failures.push(`${label} 帧 ${channels.clipped} 个像素通道 ≥255`
      + `（max ${channels.maxR}/${channels.maxG}/${channels.maxB}）：ADD 叠到饱和，红线${source}`);
  }
}

const result = {
  params: {
    camera: CAMERA,
    zoom: duskShot.camera.zoom,
    viewport: { width: 1010, height: 700 },
    now: STEADY_A,
    phase: ['dusk', 'noon', 'dawn'],
    lamps: { dusk: 'forced-on', noon: 'forced-off', dawn: 'forced-on（仅读数，KB 无阈值）' },
    units: { patch: `${PATCH_W}×${PATCH_W} 世界 px`, annulus: `${ANNULUS_W}×${ANNULUS_W} 世界 px`, render: '2×' },
    luma: 'Rec.601 0.299/0.587/0.114',
    tokenRule: '最近地形 token 色，RGB 距离 ≤60，覆盖 ≥1% annulus 像素',
  },
  sample: {
    rule: '该帧内 max(灯体 8×8 最亮像素) 的那一盏；中心 = 它 8×8 内最亮像素',
    lamp: { order: chosen.order, hanging: chosen.hanging, world: chosen.world },
    centerImagePx: center,
    centerWorld: worldCenter,
    maxLuma: chosen.best.l,
    lampCount: lampRows.length,
  },
  dusk: {
    patch: dusk.patch, annulus: dusk.annulus, ratio: dusk.ratio,
    patchBox: dusk.patchBox, annulusBox: dusk.annulusBox,
    tokenCountDuskFrame: dusk.tokenCount, tokensDuskFrame: duskTokenCrossCheck,
    classifiedShare: dusk.classifiedShare,
    imagePxVariant: { patch: duskImagePx.patch, annulus: duskImagePx.annulus, ratio: duskImagePx.ratio },
    patchLevels: dusk.patchLevels,
  },
  noon: {
    patch: noon.patch, annulus: noon.annulus, ratio: noon.ratio,
    tokenCount: noon.tokenCount, tokens: tokenRows, classifiedShare: noon.classifiedShare,
    imagePxVariant: { patch: noonImagePx.patch, annulus: noonImagePx.annulus, ratio: noonImagePx.ratio },
  },
  duskLampsOff: { patch: duskOff.patch, annulus: duskOff.annulus, ratio: duskOff.ratio },
  // 第三相只报读数：KB 只定义了 dusk ≥0.18 与 noon <0.10 两端，dawn 不参与判定。
  dawn: {
    patch: dawn.patch, annulus: dawn.annulus, ratio: dawn.ratio,
    patchLevels: dawn.patchLevels, tokenCount: dawn.tokenCount,
    note: '灯强制点亮；只作读数，不作判定（KB 无 dawn 阈值）',
  },
  inverse,
  shadeBound,
  patchBound,
  clipping,
  channels: { dusk: duskChannels, duskOff: duskOffChannels, duskNoShade: duskNoShadeChannels, dawn: dawnChannels, noon: noonChannels },
  thresholds: { duskMin: DUSK_MIN, noonMax: NOON_MAX, tokenMin: TOKEN_MIN, suppressionMinLuma: SUPPRESSION_MIN_LUMA },
  // 读数判定与机制判定分开写：阈值全过也不等于「局部压低周边」。
  criterion: {
    satisfied: failures.length === 0,
    failures,
  },
  mechanism,
  artifacts: {
    dusk: { file: duskShot.file, bytes: duskShot.buf.length, sha256: duskShot.sha256 },
    duskNoShade: { file: duskNoShadeShot.file, bytes: duskNoShadeShot.buf.length, sha256: duskNoShadeShot.sha256 },
    duskOff: { file: duskOffShot.file, bytes: duskOffShot.buf.length, sha256: duskOffShot.sha256 },
    noon: { file: noonShot.file, bytes: noonShot.buf.length, sha256: noonShot.sha256 },
    dawn: { file: dawnShot.file, bytes: dawnShot.buf.length, sha256: dawnShot.sha256 },
  },
  errors: [...duskScene.errors, ...duskOffScene.errors, ...noonScene.errors, ...dawnScene.errors],
};

writeFileSync(join(OUT, 'glow-contrast.json'), `${JSON.stringify(result, null, 2)}\n`);

const pct = (value) => `${(value * 100).toFixed(2)}%`;
console.log(`样本：第 ${chosen.order} 盏灯（${chosen.hanging ? '灯串' : '灯柱'}）@ 世界 ${chosen.world.x},${chosen.world.y}，`
  + `中心世界 ${worldCenter.x.toFixed(1)},${worldCenter.y.toFixed(1)}；候选 ${lampRows.length} 盏，峰值 ${chosen.best.l.toFixed(1)}`);
console.log(`dusk  patch ${dusk.patch.toFixed(2)} / annulus ${dusk.annulus.toFixed(2)} → ratio ${dusk.ratio.toFixed(3)}`
  + `（阈值 ≥${DUSK_MIN}，${dusk.ratio >= DUSK_MIN ? '过' : '不过'}）；patch ${dusk.patchLevels} 级色（≥${PATCH_LEVEL_MIN}）`);
console.log(`noon  patch ${noon.patch.toFixed(2)} / annulus ${noon.annulus.toFixed(2)} → ratio ${noon.ratio.toFixed(3)}`
  + `（阈值 <${NOON_MAX}，${noon.ratio < NOON_MAX ? '过' : '不过'}）`);
console.log(`dawn  patch ${dawn.patch.toFixed(2)} / annulus ${dawn.annulus.toFixed(2)} → ratio ${dawn.ratio.toFixed(3)}`
  + `（仅读数，KB 无 dawn 阈值；灯强制点亮，annulus 更亮故比值必低于 dusk）`);
console.log(`annulus 地形 token ${noon.tokenCount} 种（noon 帧，阈值 ≥${TOKEN_MIN}）：`
  + `${tokenRows.filter((row) => row.share >= 0.01).map((row) => `${row.id} ${pct(row.share)}`).join(' / ') || '无'}`);
console.log(`  dusk 帧同区域交叉核对：${dusk.tokenCount} 种（dim 会压偏色，不作判定用）`);
console.log(`截图像素口径参照：dusk ${duskImagePx.ratio.toFixed(3)} / noon ${noonImagePx.ratio.toFixed(3)}`);
console.log(`反解（dusk）：patch ${inverse.dusk.patch.toFixed(2)} 固定 ⇒ ratio≥${DUSK_MIN} 需 annulus ≤ ${inverse.dusk.annulusTarget.toFixed(2)}`
  + `（现在 ${inverse.dusk.annulus.toFixed(2)}，还得降 ${inverse.dusk.annulusMustDrop.toFixed(2)}）`);
console.log(`  环境下限（灯全关）：annulus ${inverse.dusk.ambientAnnulusLampsOff.toFixed(2)} / patch ${inverse.dusk.ambientPatchLampsOff.toFixed(2)}`
  + `；光池贡献 ${inverse.dusk.poolSpill.toFixed(2)}；环境已达/超目标 = ${inverse.dusk.ambientAtOrAboveTarget ? '是（缩光池到 0 也到不了）' : '否'}`);
console.log(`  若 annulus 不动 ⇒ patch 需到 ${inverse.dusk.patchNeededIfAnnulusFixed.toFixed(2)}`);
console.log(`  环带衰减（世界 px，压暗开/关）：`
  + inverse.dusk.ringsOn.map((row, i) => `[${row.from},${row.to}) ${row.mean.toFixed(1)}/${inverse.dusk.ringsOff[i].mean.toFixed(1)}`).join('  '));
console.log(`反解（noon）：patch ${inverse.noon.patch.toFixed(2)} ⇒ ratio<${NOON_MAX} 需 annulus 不低于 ${inverse.noon.annulusMustStayAbove.toFixed(2)}`
  + `（现在 ${inverse.noon.annulus.toFixed(2)}）`);
console.log(`通道峰值：dusk ${duskChannels.maxR}/${duskChannels.maxG}/${duskChannels.maxB}（裁剪 ${duskChannels.clipped}）`
  + `；dawn ${dawnChannels.maxR}/${dawnChannels.maxG}/${dawnChannels.maxB}（裁剪 ${dawnChannels.clipped}）`
  + `；noon ${noonChannels.maxR}/${noonChannels.maxG}/${noonChannels.maxB}（裁剪 ${noonChannels.clipped}）`);
console.log(`  裁剪归属：灯开 ${clipping.duskOn} / 灯关 ${clipping.duskOff} / 压暗关 ${clipping.duskNoShade}`
  + ` ⇒ 本轮灯改动引入 = ${clipping.attributableToLamp ? '是' : '否（既有 ADD 窗光）'}`);
console.log(`patch 上限（不新增色、不扩发光足迹）：灯地盘 ${patchBound.footprintPixels} 像素`
  + `（${pct(patchBound.footprintShare)}），推满到 ${patchBound.maxOnLuma.toFixed(1)} ⇒ patch 最多 ${patchBound.ceilLuma.toFixed(2)}；`
  + `需 ${patchBound.requiredPatchVsAmbient.toFixed(2)}（annulus 取环境最低 ${inverse.dusk.ambientAnnulusLampsOff.toFixed(2)}）`
  + `，差 ${patchBound.shortfallVsAmbient.toFixed(2)} luma ⇒ ${patchBound.enoughVsAmbient ? '够' : '不够'}`);
console.log(`压暗上限（按 alpha 线性外推，偏松；实测 α=1 那轮给的是 0.093）：`
  + `${shadeBound.rings.map((row) => `[${row.from},${row.to}) α${row.alpha} 覆盖 ${pct(row.coveredShare)}`).join('  ')}`
  + ` ⇒ annulus 最多降到 ${shadeBound.annulusIfOpaque.toFixed(2)}，ratio 最多 ${shadeBound.ratioIfOpaque.toFixed(3)}`
  + `（${shadeBound.targetReachedAtOpaque ? '到 0.18' : '仍到不了 0.18'}）`);
console.log(`机制：局部压低周边 = ${mechanism.localSurroundSuppression ? '是' : '否'}；`
  + `关掉压暗后 annulus ${mechanism.annulusWithoutShade.toFixed(2)}（亮着时 ${mechanism.annulusWithShade.toFixed(2)}），`
  + `回升 ${suppressionDelta.toFixed(2)} luma（门槛 ${SUPPRESSION_MIN_LUMA}）；patch 变化 ${mechanism.patchDelta.toFixed(2)}`);

if (failures.length > 0) {
  console.log(`[判据] 红（${failures.length} 条）`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[判据] 绿（仅阈值读数；机制另见 mechanism）');
}
