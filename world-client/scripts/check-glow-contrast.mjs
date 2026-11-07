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
 * patch / annulus 读数。center 是**截图像素**，patchW / annulusW 是**世界像素**（8 / 32）。
 * annulus 取外框减 patch；地形 token 计数也在这里做（同一帧的颜色，避免另开一页口径漂）。
 */
async function readPatchAnnulus(page, buf, cam, center, patchW, annulusW) {
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64, cam, center, patchW, annulusW, tokens }) => {
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
          continue;
        }
        annulusSum += l;
        annulusN += 1;
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
      annulusPixels: annulusN,
      tokenRows,
      tokenCount: tokenRows.filter((row) => row.share >= 0.01).length,
      classifiedShare: annulusN === 0 ? 0 : classified / annulusN,
    };
  }, { b64, cam, center, patchW, annulusW, tokens: TERRAIN_TOKENS });
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
await duskScene.page.close();

const noonScene = await openPage(browser, { phase: 'noon', lampsOn: false });
const noonShot = await shot(noonScene.page, noonScene.box, 'noon');
// noon：同一世界中心 → 同一截图像素（相机/zoom 相同）。
const noon = await readPatchAnnulus(noonScene.page, noonShot.buf, noonShot.camera, center, PATCH_W, ANNULUS_W);
const noonImagePx = await readPatchAnnulus(noonScene.page, noonShot.buf, noonShot.camera, center, PATCH_W / 2, ANNULUS_W / 2);
await noonScene.page.close();
await browser.close();

// 地形 token 在 **noon** 帧计数：dusk 的相位 dim 会把地形色整体压偏，最近 token 分类
// 会跟 dim 较劲；noon 无 dim，测的是材质本身。同一个 annulus 世界区域，只是换了相位。
const duskTokenCrossCheck = dusk.tokenRows;
const tokenRows = noon.tokenRows;
const failures = [];
if (!(dusk.ratio >= DUSK_MIN)) failures.push(`dusk ratio ${dusk.ratio.toFixed(3)} < ${DUSK_MIN}`);
if (!(noon.ratio < NOON_MAX)) failures.push(`noon ratio ${noon.ratio.toFixed(3)} ≥ ${NOON_MAX}`);
if (noon.tokenCount < TOKEN_MIN) {
  failures.push(`annulus 地形 token ${noon.tokenCount} < ${TOKEN_MIN}（noon 帧：`
    + `${tokenRows.filter((row) => row.share >= 0.01).map((row) => row.id).join('/') || '无'}）`);
}

const result = {
  params: {
    camera: CAMERA,
    zoom: duskShot.camera.zoom,
    viewport: { width: 1010, height: 700 },
    now: STEADY_A,
    phase: ['dusk', 'noon'],
    lamps: { dusk: 'forced-on', noon: 'forced-off' },
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
  },
  noon: {
    patch: noon.patch, annulus: noon.annulus, ratio: noon.ratio,
    tokenCount: noon.tokenCount, tokens: tokenRows, classifiedShare: noon.classifiedShare,
    imagePxVariant: { patch: noonImagePx.patch, annulus: noonImagePx.annulus, ratio: noonImagePx.ratio },
  },
  thresholds: { duskMin: DUSK_MIN, noonMax: NOON_MAX, tokenMin: TOKEN_MIN },
  // 读数判定与机制判定分开写：阈值全过也不等于「局部压低周边」。
  criterion: {
    satisfied: failures.length === 0,
    failures,
  },
  mechanism: {
    implementation: '全屏相位 dim（乘色压暗整帧）+ 灯/窗 ADD 光池',
    localSurroundSuppression: false,
    note: 'annulus 没有被局部压低；它随全屏 dim 一起变暗。ratio 通过只能说明「发光块在 dim 下浮出来」，'
      + '不能当成本条 KB 要点所要求的「发光靠压低周边」实现。',
  },
  artifacts: {
    dusk: { file: duskShot.file, bytes: duskShot.buf.length, sha256: duskShot.sha256 },
    noon: { file: noonShot.file, bytes: noonShot.buf.length, sha256: noonShot.sha256 },
  },
  errors: [...duskScene.errors, ...noonScene.errors],
};

writeFileSync(join(OUT, 'glow-contrast.json'), `${JSON.stringify(result, null, 2)}\n`);

const pct = (value) => `${(value * 100).toFixed(2)}%`;
console.log(`样本：第 ${chosen.order} 盏灯（${chosen.hanging ? '灯串' : '灯柱'}）@ 世界 ${chosen.world.x},${chosen.world.y}，`
  + `中心世界 ${worldCenter.x.toFixed(1)},${worldCenter.y.toFixed(1)}；候选 ${lampRows.length} 盏，峰值 ${chosen.best.l.toFixed(1)}`);
console.log(`dusk  patch ${dusk.patch.toFixed(2)} / annulus ${dusk.annulus.toFixed(2)} → ratio ${dusk.ratio.toFixed(3)}`
  + `（阈值 ≥${DUSK_MIN}，${dusk.ratio >= DUSK_MIN ? '过' : '不过'}）`);
console.log(`noon  patch ${noon.patch.toFixed(2)} / annulus ${noon.annulus.toFixed(2)} → ratio ${noon.ratio.toFixed(3)}`
  + `（阈值 <${NOON_MAX}，${noon.ratio < NOON_MAX ? '过' : '不过'}）`);
console.log(`annulus 地形 token ${noon.tokenCount} 种（noon 帧，阈值 ≥${TOKEN_MIN}）：`
  + `${tokenRows.filter((row) => row.share >= 0.01).map((row) => `${row.id} ${pct(row.share)}`).join(' / ') || '无'}`);
console.log(`  dusk 帧同区域交叉核对：${dusk.tokenCount} 种（dim 会压偏色，不作判定用）`);
console.log(`截图像素口径参照：dusk ${duskImagePx.ratio.toFixed(3)} / noon ${noonImagePx.ratio.toFixed(3)}`);
console.log(`机制：全屏 dim + ADD 光池；局部压低周边 = 否（读数通过不代表机制实现）`);
if (failures.length > 0) {
  console.log(`[判据] 红（${failures.length} 条）`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[判据] 绿（仅阈值读数；机制另见 mechanism）');
}
