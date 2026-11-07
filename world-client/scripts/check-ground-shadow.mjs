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
 * 判据（G0–G3）
 * -------------
 * - G0：本节读数（同刻/跨 t+1s/暂停/确定性/夜间影长/峰值指令）任一不达标即红；
 *   只读**本次运行**的值，不读 `eval/screens/ground-shadow.json`（11-04 的，陈旧即无效）。
 *   峰值指令走两级口径：设计目标 30,000 不动；本记录器自己的天花板见 `PEAK_CEILING`
 *   （来源：同配置连跑 2 次峰值均 34,666、极差 0；**不套 render-budget 的 33,445/33,488**）。
 * - G2：**每个有影相位**（晨 / 午 / 昏）都量三段阶梯：「内 > 中 > 外」，相邻两段相对落差
 *   ≥25%（来源见断言旁注释）。只测黄昏分不清「按相位根锚定」与「把问题反向搬了一次」。
 * - G3：墙角接触暗部按**基底 token** 多样本量 ΔL；钉住的样本必须落在 6–14，**双向**判红
 *   （太淡读不出 / 太深像第二层影子）。**任何样本（含放弃的）ΔL 必须 > 0**——接触暗部
 *   不许把基底提亮；这条在把阴影色改浅时会红。放弃样本按原因**分开登记**：
 *   `dark` = 深底（grass/mud，永远进不了带）、`occluded` = 遮挡（基底够亮但墙角被压住，
 *   换机位也不变；只有改层次才可复测）。它们只要求留读数、不参与带内判定。
 * - G1：4× 同框只作人工裁决证据，不进断言。
 *
 * 抓拍前提（fail-closed）
 * ---------------------
 * 所有用于比较的帧都先过 `shotStable`（连续 8 帧逐字节相同）。等不到就打印
 * `[判据前提不成立] …` 并以非 0 退出，**不回退成「拍一张算了」**。为什么需要：
 * 撤回记录里 30 轮 4 红（13.3%）都是「首张同刻图抓拍早于整屏调色收敛」——
 * 同刻两页确实冻住了世界，只是第一张落在 `FADE_MS = 900` 的渐变中途。判据没变，
 * 变的是「先证画面停住，再取字节」。
 *
 * G0 的接线顺序（**现在只做「能红」，还没接 CI**）
 * -------------------------------------------------
 * 1. 等 `chore/orphan-gates` 合并（它要改 `.github/workflows/ci.yml`、从允许清单删条目）；
 * 2. 合并后**单独一条分支**给 ci.yml 加这一步，并同时把本脚本从「允许清单」里删掉；
 * 3. 两条分支不要同时改 ci.yml——会冲突；「从允许清单删掉」也不能早于接线。
 *
 * 输出只写 `tmp/screens/check-ground-shadow/`（未跟踪），不写 `eval/screens`。
 *
 * 跑法：
 *   cd world-client && npm run dev -- --port 5211
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-ground-shadow.mjs
 *   # G0 红样例：GROUND_SHADOW_PEAK_CEILING=1 ...
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';
import { resolveShotDir } from './lib/shot-output.mjs';
import { assertSurfacePresent } from './lib/measure-surface.mjs';
import { shotStable } from './lib/shot-stable.mjs';
import {
  assertSameFrames,
  frameClockInitScript,
  pinClock,
  premiseFailure,
  readFrame,
  stepFrames,
  waitForFrames,
} from './lib/frame-clock.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = resolveShotDir('check-ground-shadow');
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const STEADY_A = 1090 * MIN;
/** 设计目标。G0 的目标线，不是本记录器的天花板。 */
const DESIGN_TARGET = 30_000;
/**
 * 本记录器自己的峰值天花板。**不许套 render-budget 的 33,445 / 33,488**：两个记录器的
 * 机位（400/470 vs 默认）、分辨率（1010×700）、相位集合（四相位/潮位/天气）都不同。
 * 来源：同一配置连跑 2 次，峰值均为 34,666、极差 0 → 天花板 = 34,666 + 0。
 * 峰值在 (30,000, 34,666] 记账不红；> 34,666 才红（零余量，任何新增都要重新记账）。
 */
const PEAK_CEILING = Number(process.env.GROUND_SHADOW_PEAK_CEILING ?? 34_666);

/**
 * 抓拍前提的上限（不是判据阈值）。见 `scripts/lib/shot-stable.mjs`：
 * 8 帧逐字节相同才算停住；等不到就是前提不成立，红。
 */
const PREMISE_TIMEOUT_MS = 30_000;

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
const PHASES = ['dawn', 'noon', 'dusk', 'night'];

/**
 * 相位参数（全部由本闸门给，库 `scripts/lib/frame-clock.mjs` 里没有这些数字）。
 * - `FRAME_MS`：步进时每帧注入的固定 dt。60fps 的稳态就是 `1000 / 60`；只钉帧号
 *   不注入 dt，`TimeStep` 会算出接近 0 的 delta，测的是另一个东西。
 * - `PIN_FRAME`：两页共同的对齐帧号，必须大于开页时真实跑出的帧数（实测 135–180）。
 * - `SETTLE_FRAMES`：对齐之后再多走 90 帧。`FADE_MS = 900` → 54 帧，留一半余量。
 * - `REQUIRE_IDENTICAL_FRAMES`：抓拍前提「连续 N 帧逐字节相同」，N 不动（8）。
 * - `DETERMINISM_SAMPLES` / `DETERMINISM_SETTLE_STEPS`：确定性判据的采样点数与
 *   每步沉降帧数，两遍必须完全一致。
 */
const FRAME_MS = 1000 / 60;
const PIN_FRAME = 1000;
const SETTLE_FRAMES = 90;
const REQUIRE_IDENTICAL_FRAMES = 8;
const DETERMINISM_SAMPLES = 13;
const DETERMINISM_SETTLE_STEPS = 3;

async function openScene(browser, { phase, camera, villagerCell, extraQuery = '' }) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(frameClockInitScript, { freezeAt: 0, frameMs: FRAME_MS });
  await page.goto(
    `${BASE}?world=dengchao&time=${phase}&feed=off&ledger=off&debug=1&now=1075${extraQuery}`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });
  const canvas = page.locator('canvas').first();
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('找不到 canvas');

  // 测量面契约（scripts/lib/measure-surface.mjs）：隐藏 UI chrome 与逐帧会动的
  // 名字/气泡，保留区域名/露话这类场景内文字。守卫会立刻报出改名/失效的选择器。
  await assertSurfacePresent(page);

  await waitForFrames(page, 24);
  // 页面冷启动会吃掉数量不定的帧，世界钟因此每次落点不同；人物钉在「当时的自格」，
  // 影子就可能一会儿被别的摊位影子压住（0.12% 与 0.17% 两跑）。先冻住世界、再统一
  // 推到 18:10:00，让村民位置只由种子决定，再钉人、再量。
  // 注意 `debugStepWorld` 只在 `debugHoldWorld(true)` 之后才推进；不先冻住，这一步是空操作。
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await page.evaluate((target) => {
    const now = window.Oracle.debugStepWorld(0);
    if (target > now) window.Oracle.debugStepWorld(target - now);
  }, STEADY_A);
  await waitForFrames(page, 2);
  const opened = await page.evaluate(([camera, villagerCell]) => {
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
    // #11：天气钩子不在就不能钉天气——读数里的影子也就无法排除「雨还留着」。
    const weatherHook = typeof window.Oracle.debugSetWeather === 'function';
    const weatherBefore = window.Oracle.view().weather ?? null;
    let weatherRequested = null;
    if (weatherHook) weatherRequested = window.Oracle.debugSetWeather('clear') ?? null;
    window.Oracle.debugHideAmbience(true);
    window.Oracle.debugHideBayMist(true);
    window.Oracle.debugLampMotion({ ignite: false, breathe: false, sway: false });
    window.Oracle.debugStallMotion({ cloth: false, fire: false });
    window.Oracle.debugBannerMotion({ sway: false, shadow: false });
    window.Oracle.debugSmokeMotion({ drift: false });
    window.Oracle.centerCameraOn(lens.x, lens.y);
    return {
      lens,
      diagnostics: {
        weatherHook,
        weatherBefore,
        weatherRequested,
        storageError: window.__CAPTURE_STATE__?.storageError ?? null,
      },
    };
  }, [camera, villagerCell]);
  await waitForFrames(page, 40);
  await page.evaluate(() => window.Oracle.debugHoldWorld(true));
  await waitForFrames(page, 2);
  // 天气落定后再读一次：钩子调用的返回值是「下命令那一刻」，这里才是「画面里到底是晴是雨」。
  const weatherAfter = await page.evaluate(() => window.Oracle.view().weather ?? null);
  const diagnostics = { ...opened.diagnostics, weatherAfter };
  // #11：钩子不在就红——不钉天气，灰罩/雨滴/雾会随存档飘进来，所有影子读数都无法解释。
  if (!diagnostics.weatherHook) {
    premiseFailure(
      `${phase} 天气钉死`,
      'window.Oracle.debugSetWeather 不存在，无法把天气钉成 clear；影子读数无法排除雨天残留',
    );
  }
  // 天气没落成 clear 也是红；但要把「清存储失败」与「雨从别处进来」分开说，不能都归到「忽略」。
  if (diagnostics.weatherAfter !== 'clear') {
    const storageNote =
      diagnostics.storageError === null
        ? '存储已清空，雨不是从存档带进来的'
        : `存储清理失败（${diagnostics.storageError}），雨可能是存档带进来的`;
    premiseFailure(
      `${phase} 天气钉死`,
      `请求 clear 后读到的天气仍是 ${String(diagnostics.weatherAfter)}（命令返回 ${String(
        diagnostics.weatherRequested,
      )}，进入前是 ${String(diagnostics.weatherBefore)}）；${storageNote}。雨留在场景里，影子读数不可用`,
    );
  }
  if (diagnostics.storageError !== null) {
    // 存储清不掉但天气确实是 clear：雨没留在场景里，只把这件事记出来，不判红。
    console.log(
      `[前提] ${phase} localStorage 清理失败（${diagnostics.storageError}）；天气已确认为 clear，雨不留在场景里。`,
    );
  }
  return {
    page,
    box,
    errors,
    camera: await page.evaluate(() => window.Oracle.camera()),
    lens: opened.lens,
    diagnostics,
  };
}

const hashOf = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * 先证画面停住，再取字节。等不到就把「前提」判红并中止——不拿一张可能还在渐变的
 * 图去和另一张比。`shotStable` 返回的 buffer 就是满足判据的那一帧，直接写盘。
 *
 * 传 `advance` 走步进模式：步进恰好 `REQUIRE_IDENTICAL_FRAMES` 帧、逐帧比，帧数
 * 固定，两页才走同样的帧序列。
 */
async function stableShot(page, box, label, { advance } = {}) {
  const premise = await shotStable(page, {
    clip: box,
    requireIdenticalFrames: REQUIRE_IDENTICAL_FRAMES,
    timeoutMs: PREMISE_TIMEOUT_MS,
    ...(advance === undefined ? {} : { advance }),
  });
  if (!premise.stable) premiseFailure(label, String(premise.reason));
  return premise;
}

async function shot(page, box, id) {
  const premise = await stableShot(page, box, id);
  const file = join(OUT, `ground-shadow-${id}.png`);
  writeFileSync(file, premise.buffer);
  const buf = premise.buffer;
  const meta = await page.evaluate(() => ({
    now: window.Oracle.debugStepWorld(0),
    weather: window.Oracle.view().weather,
    units: window.Oracle.debugGroundShadowUnits(),
    stats: window.Oracle.renderStats(),
    camera: window.Oracle.camera(),
  }));
  return { id, file, buf, sha256: hashOf(buf), frame: await readFrame(page), ...meta };
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

/**
 * 沿影长切段（内 / 中 / 外），与 `world/ground-shadow.ts` 的 `shadowSegments`
 * **同一套段数、取整与朝向**：≤2px 单段、≤4px 两段（0.6/0.4）、更长三段（0.4/0.35/0.25）；
 * **内段永远贴着物体**——`dir>0`（晨/午，影朝右）内段在左端，`dir<0`（黄昏，影朝左）内段在右端。
 * 少了朝向这一层，黄昏会把「梢」读成「芯」；少了段数这一层，晨相的 4px 影会被切成
 * 不存在的三段，读数跟实现对不上。
 */
function splitShadowSpan(x, span, dir) {
  const ratios = span <= 2 ? [1] : span <= 4 ? [0.6, 0.4] : [0.4, 0.35, 0.25];
  let remaining = span;
  const widths = ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return remaining;
    const width = Math.max(1, Math.round(span * ratio));
    remaining -= width;
    return width;
  });
  const names = ['inner', 'mid', 'outer'];
  let cursor = dir > 0 ? x : x + span;
  return widths.map((width, index) => {
    if (dir > 0) {
      const segment = { name: names[index], x0: cursor, x1: cursor + width };
      cursor += width;
      return segment;
    }
    cursor -= width;
    return { name: names[index], x0: cursor, x1: cursor + width };
  });
}

/** 一个世界 ROI 的平均亮度（Rec.709 权重，只看源像素，不模拟 alpha）。 */
async function lumaStats(page, buf, cam, roi) {
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64, roi, cam }) => {
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
    const px = (wx) => (wx - cam.worldViewX) * 2 * cam.zoom;
    const py = (wy) => (wy - cam.worldViewY) * 2 * cam.zoom;
    const x0 = Math.max(0, Math.round(px(roi.x0)));
    const x1 = Math.min(c.width, Math.round(px(roi.x1)));
    const y0 = Math.max(0, Math.round(py(roi.y0)));
    const y1 = Math.min(c.height, Math.round(py(roi.y1)));
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let n = 0;
    let min = 255;
    let max = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * c.width + x) * 4;
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += l;
        n += 1;
        if (l < min) min = l;
        if (l > max) max = l;
      }
    }
    return { pixels: n, mean: n === 0 ? 0 : sum / n, min, max };
  }, { b64, roi, cam });
}

/** 一次解码，多个世界 ROI 一起量；G3 逐栋找干净墙角时用。 */
async function lumaStatsMany(page, buf, cam, rois) {
  const b64 = buf.toString('base64');
  return page.evaluate(async ({ b64, rois, cam }) => {
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
    const px = (wx) => (wx - cam.worldViewX) * 2 * cam.zoom;
    const py = (wy) => (wy - cam.worldViewY) * 2 * cam.zoom;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    return rois.map((roi) => {
      const x0 = Math.max(0, Math.round(px(roi.x0)));
      const x1 = Math.min(c.width, Math.round(px(roi.x1)));
      const y0 = Math.max(0, Math.round(py(roi.y0)));
      const y1 = Math.min(c.height, Math.round(py(roi.y1)));
      let sum = 0;
      let n = 0;
      let min = 255;
      let max = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * c.width + x) * 4;
          const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += l;
          n += 1;
          if (l < min) min = l;
          if (l > max) max = l;
        }
      }
      return { pixels: n, mean: n === 0 ? 0 : sum / n, min, max };
    });
  }, { b64, rois, cam });
}

/** 每个影段的「关−开」相对压暗；G2 判据读这一列。 */
async function segmentStrength(page, onBuf, offBuf, cam, segments) {
  const rows = [];
  for (const seg of segments) {
    const roiOn = { x0: seg.x0, x1: seg.x1, y0: seg.y0, y1: seg.y1 };
    const roiOff = { ...roiOn };
    const on = await lumaStats(page, onBuf, cam, roiOn);
    const off = await lumaStats(page, offBuf, cam, roiOff);
    const strength = off.mean === 0 ? 0 : (off.mean - on.mean) / off.mean;
    rows.push({
      name: seg.name,
      world: { x0: seg.x0, x1: seg.x1, y0: seg.y0, y1: seg.y1 },
      on: on.mean,
      off: off.mean,
      strength,
      onRange: on.max - on.min,
    });
  }
  return rows;
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
  await waitForFrames(stall.page, 2);
  const stallOff = await shot(stall.page, stall.box, `stall-${phase}-off`);
  const stallDiff = await diffPair(reader, stallOn.buf, stallOff.buf, stall.camera, STALL_ROI);
  peakCommands = Math.max(peakCommands, stallOn.stats.totalCommands, stallOff.stats.totalCommands);
  // G2 读数：每个有影的相位都沿影长切段，量「关−开」的相对压暗。
  // 只测黄昏分不清「按相位根锚定」和「把问题反向搬了一次」——晨相根在左、影朝右，
  // 正好是黄昏的镜像；午相 span=1 只剩单段，用来确认没有凭空多出阶梯。
  let stallSegments = null;
  {
    const unit = stallOn.units.stalls?.find((s) => s.order === 0) ?? stallOn.units.stalls?.[0];
    if (unit && unit.span > 0) {
      const dir = unit.dx >= 0 ? 1 : -1;
      const start = unit.x + 2 + unit.dx + (dir > 0 ? 0 : -unit.span);
      const segments = splitShadowSpan(start, 20 + unit.span, dir).map((seg) => ({
        ...seg,
        y0: unit.y + 16,
        y1: unit.y + 18,
      }));
      stallSegments = await segmentStrength(stall.page, stallOn.buf, stallOff.buf, stall.camera, segments);
    }
  }
  await stall.page.close();

  // 人物：同一时刻开 / 关。
  const villager = await openScene(browser, {
    phase,
    camera: VILLAGER_CAMERA,
    villagerCell: VILLAGER_CELL,
  });
  const villagerOn = await shot(villager.page, villager.box, `villager-${phase}-on`);
  await villager.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
  await waitForFrames(villager.page, 2);
  const villagerOff = await shot(villager.page, villager.box, `villager-${phase}-off`);
  // #1：脚底只能从「本次读数」里取。拿不到人物/影长就判前提失败——
  // 用镜头位置顶替脚底，会把「没取到读数」伪装成「取到了」。
  const villagerUnits = villagerOn.units?.villagers;
  if (!Array.isArray(villagerUnits) || villagerUnits.length === 0) {
    premiseFailure(
      `#1 ${phase} 人物脚底`,
      `debugGroundShadowUnits().villagers ${Array.isArray(villagerUnits) ? '为空' : '字段缺失'}，`
      + '取不到 0 号人物；不能用镜头位置顶替脚底',
    );
  }
  const foot = villagerUnits[0];
  if (!Number.isFinite(foot.x) || !Number.isFinite(foot.y)) {
    premiseFailure(
      `#1 ${phase} 人物脚底`,
      `0 号人物缺 x/y（x=${String(foot.x)}，y=${String(foot.y)}）；不能用镜头位置顶替脚底`,
    );
  }
  if (!Number.isFinite(foot.dx)) {
    premiseFailure(
      `#1 ${phase} 人物影向`,
      `0 号人物缺 dx（${String(foot.dx)}）：无法判定影子朝哪边，不能默认朝右`,
    );
  }
  if (typeof foot.span !== 'number' || !Number.isFinite(foot.span)) {
    premiseFailure(
      `#1 ${phase} 人物影长`,
      `0 号人物缺 span（${String(foot.span)}）：0 是合法值，缺失不是`,
    );
  }
  // ROI 跟着被钉的人走：脚底 ±48 / 上 70 / 下 16 世界像素。
  const villagerRoi = { x0: foot.x - 48, y0: foot.y - 70, x1: foot.x + 48, y1: foot.y + 16 };
  const villagerDiff = await diffPair(reader, villagerOn.buf, villagerOff.buf, villager.camera, villagerRoi);
  peakCommands = Math.max(peakCommands, villagerOn.stats.totalCommands, villagerOff.stats.totalCommands);
  // G2 读数：人物在每个有影的相位都量；晨相 span=4 只有两段、午相 span=1 只有单段。
  let villagerSegments = null;
  if (foot.span > 0) {
    const dir = foot.dx >= 0 ? 1 : -1;
    const start = foot.x + (dir > 0 ? 3 : -3 - foot.span);
    const segments = splitShadowSpan(start, foot.span, dir).map((seg) => ({
      ...seg,
      y0: foot.y + 3,
      y1: foot.y + 5,
    }));
    villagerSegments = await segmentStrength(
      villager.page,
      villagerOn.buf,
      villagerOff.buf,
      villager.camera,
      segments,
    );
  }

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
      segments: stallSegments,
    },
    villager: {
      on: villagerOn.units,
      off: villagerOff.units,
      diff: villagerDiff,
      stats: { on: villagerOn.stats, off: villagerOff.stats },
      segments: villagerSegments,
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
await waitForFrames(closed.page, 2);
const pauseA = await shot(closed.page, closed.box, 'pause-a');
await closed.page.waitForTimeout(1000);
const pauseB = await shot(closed.page, closed.box, 'pause-b');
const pauseDiff = await diffPair(reader, pauseA.buf, pauseB.buf, closed.camera, STALL_ROI);

// 同一页跨 t / t+1s：世界时刻推进到 18:10:00 后，那条时间驱动的 180×4 横条不在画面里，
// 关掉投影时这一步应为 0.00%；若哪天读数非 0，先查横条 bbox，再归因到这一层。
await closed.page.evaluate(() => window.Oracle.debugGroundShadows({ on: false }));
await closed.page.evaluate(() => window.Oracle.debugStepWorld(60_000));
await waitForFrames(closed.page, 2);
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
//
// **前提是「两页帧号相等」，不是「各自等到连续 8 帧相同」就开比。** 画面里有一处
// 按渲染帧推进、不随世界钟推进的微动（OPEN_ISSUES E12），量化平台由帧号决定：
// 实测两页各等到「连续 8 帧相同」时帧号是 135 / 179，13 张里 5 张不等。所以这里
// 在 `scripts/lib/frame-clock.mjs` 里冻结真实 rAF、把两页都步进到同一个 PIN_FRAME，
// 再逐帧比；帧号不等就判前提不成立。

async function runPass(tag) {
  const scene = await openScene(browser, { phase: 'dusk', camera: STALL_CAMERA, villagerCell: null });
  await scene.page.evaluate(() => window.Oracle.debugGroundShadows({ on: true }));
  // 页面启动耗时不同会让世界钟停在不同的绝对时刻；先推到统一的 18:10:00。
  await scene.page.evaluate((target) => {
    const now = window.Oracle.debugStepWorld(0);
    window.Oracle.debugStepWorld(target - now);
  }, STEADY_A);
  await waitForFrames(scene.page, 30);
  await pinClock(scene.page, { targetFrame: PIN_FRAME, settleFrames: SETTLE_FRAMES, label: tag });

  const hashes = [];
  const frames = [];
  let commands = 0;
  for (let i = 0; i < DETERMINISM_SAMPLES; i += 1) {
    if (i > 0) {
      await scene.page.evaluate(() => window.Oracle.debugStepWorld(10_000));
      // 与抓拍同样的帧预算：沉降帧 + 前提帧，两页完全一致。
      await stepFrames(scene.page, DETERMINISM_SETTLE_STEPS, `determinism-${tag}-${i}-step`);
    }
    // 确定性比较的是两遍同一帧；每一帧同样要先证停住，否则比的是两张渐变中途图。
    const frame = await stableShot(scene.page, scene.box, `determinism-${tag}-${i}`, {
      advance: () => stepFrames(scene.page, 1, `determinism-${tag}-${i}-advance`),
    });
    hashes.push(frame.hash);
    frames.push(await readFrame(scene.page));
    commands = (await scene.page.evaluate(() => window.Oracle.renderStats())).totalCommands;
  }
  peakCommands = Math.max(peakCommands, commands);
  await scene.page.close();
  return { hashes, frames };
}

const pass1 = await runPass('a');
const pass2 = await runPass('b');

// 前提断言：两遍的帧号必须逐项相等，否则「同一帧」这句话不成立，后面比出来的不等
// 不能算判据红。
assertSameFrames(pass1.frames, pass2.frames, { label: 'determinism-frame' });

// G3：建筑墙角的接触暗部。正午无 dim，ΔL 只由静态绘制决定。
//
// 阈值来源（先量现状，再定阈值）：
// - **测的**：同栋楼下方既有最外层阶梯（α 0.16，rows h+2..h+4）每次运行实测，
//   与同帧 plaza 空地比 ΔL = `stepDelta`（上一轮 14.00；理论 0.16×(134−44.3)=14.36）；
// - **推的**：上限 14 = 那一阶实测值 → 「超过就追平/超过既有最外阶、会读成第二层影子」；
// - **推的**：下限 6 = 0.4× 那一阶（14×0.4=5.6 进位）→ 「再淡在 24 色量化 + 抖动里读不出」。
// 这两句是推断，不是测量；`basis` 在输出里标成 `(推)`，别把它们读成实测结论。
//
// AO 压在**楼左侧地面**，不在墙面；本设定集所有 prefab 的墙体 `body` token 各自不同
// （terracotta / copper / charcoal / timberDark），但 AO 落点是地面格，所以「墙面 token」
// 在这条判据里真正变的是**基底地形 token**：AO 占 (origin.x−1, origin.y+footprint.h)
// 这一格，取该格的地形。样本按**基底 token** 取，覆盖最亮（plaza）到最深（mud）四档。
//
// 每栋楼的 ΔL 不是拿旁边空地当基准，而是同机位 `?contactAO=0` 再开一页：
// `ΔL = 关(基底) − 开`，只算这一块自己的贡献，不受邻格地形 token 干扰。
const AO_MIN = 6;
const AO_MAX = 14;
/** 与 `render/buildings.ts` 的 `ink, 0.12` **同一处 α / 同一个色**；改一处必须改两处。 */
const AO_ALPHA = 0.12;
/** ink `#111821` 的 Rec.709 亮度（23.16）；α 叠色后 ΔL = α×(L_base − 23.16)。 */
const AO_SHADE_LUMA = 23.16;
/** 0.12×(L−23.16) ≥ 6 ⇒ L ≥ 73.16：低于这个基底，任何全局 α 都到不了下限。 */
const AO_SUPPORTED_BASE = AO_SHADE_LUMA + AO_MIN / AO_ALPHA;
/**
 * **本判据是窄带判据。** 带 [6,14] 只有 8 宽，而 plaza 与最暗的可读基底只差 ~45 luma：
 * 上端余量 = `14 − 最大 pinned ΔL`，下端余量 = `最小 pinned ΔL − 6`。
 * 当前实测上端余量 1.07（7.7% of 14，lamp_archive plaza 12.93），下端 1.46（24.3% of 6，
 * ferry_station stone 7.46）。**任一端余量 <5% 都是触发线：触发时重新配平 α / 阴影色，
 * 不许放宽 [6,14]。** 会用掉余量的情形见 README「窄带声明」。
 */
/**
 * `role`：
 * - `pinned`：判据钉住的样本，必须落在 [6,14]；
 * - `dark`：**深底放弃**（grass / mud）。阴影色再淡也拉不回来，所以这一档永远测不到；
 *   只留在带外（<下限）——进带内说明分档理由失效，要重新审视。
 * - `occluded`：**遮挡放弃**（基底够亮，但墙角被压在上一层下面）。读数不是「AO 不工作」，
 *   而是 ROI 里只有一部分看得见；所以只登记读数与可见像素比例，**不参与**带内判定。
 *   换机位/换时刻都不改变（遮挡物是静态层，不是角色），只有改层次才可复测。
 */
const AO_SAMPLES = [
  { id: 'lamp_archive#1', base: 'plaza', role: 'pinned' },     // 最亮
  { id: 'soot_forge#1', base: 'stone', role: 'pinned' },       // 可读基底里最暗
  { id: 'ferry_station#1', base: 'stone', role: 'pinned' },    // 同档第二例（防单点）
  { id: 'boiler_annex#1', base: 'stone', role: 'occluded' },   // 遮挡：上层压住左半墙角
  { id: 'tea_stall#1', base: 'grass', role: 'dark' },          // 深底：放弃
  { id: 'lamp_workshop#1', base: 'mud', role: 'dark' },        // 最深：放弃（旧色曾压不暗）
];
const TILE = 16;
const catalogScene = await openScene(browser, { phase: 'noon', camera: { x: 504, y: 368 }, villagerCell: null });
const buildings = await catalogScene.page.evaluate(() => window.Oracle.interior().buildings);
await catalogScene.page.close();

const ao = { samples: [], min: AO_MIN, max: AO_MAX, supportedBase: AO_SUPPORTED_BASE };
// 探针模式：`GROUND_SHADOW_AO_SCAN=1` 逐栋扫一遍，用来挑「钉住」的样本；正式判据只跑 AO_SAMPLES。
const sampleList = process.env.GROUND_SHADOW_AO_SCAN === '1'
  ? buildings.map((building) => ({ id: building.id, base: 'scan' }))
  : AO_SAMPLES;
for (const sample of sampleList) {
  const building = buildings.find((item) => item.id === sample.id);
  if (building === undefined) {
    ao.samples.push({ ...sample, missing: true });
    continue;
  }
  const left = building.origin.x * TILE;
  const bottom = building.origin.y * TILE + building.footprint.h * TILE;
  const center = {
    x: Math.round(left + (building.footprint.w * TILE) / 2),
    y: Math.round(bottom - 90),
  };
  const roi = { x0: left - 4, x1: left, y0: bottom, y1: bottom + 4 };
  const offScene = await openScene(browser, {
    phase: 'noon',
    camera: center,
    villagerCell: null,
    extraQuery: '&contactAO=0',
  });
  const slug = sample.id.replace('#', '-');
  const offShot = await shot(offScene.page, offScene.box, `ao-off-${slug}`);
  const off = await lumaStats(offScene.page, offShot.buf, offShot.camera, roi);
  await offScene.page.close();
  const onScene = await openScene(browser, { phase: 'noon', camera: center, villagerCell: null });
  const onShot = await shot(onScene.page, onScene.box, `ao-on-${slug}`);
  const on = await lumaStats(onScene.page, onShot.buf, onShot.camera, roi);
  // 遮挡判定不靠猜：同 ROI 上 on/off 有多少像素真的变了。满 ROI 都变 = 没遮挡；
  // 只有一部分变 = 那块墙角被压在上一层下面（`occluded` 的读数就是这部分的混合值）。
  const onOffDiff = await diffPair(reader, offShot.buf, onShot.buf, onShot.camera, roi);
  // 既有最外层 α0.16 阶梯的当次实测（只在 plaza 的 lamp_archive 取，基底亮、读数稳）。
  let step = null;
  if (sample.id === 'lamp_archive#1') {
    const [openGround, stepBand] = await lumaStatsMany(onScene.page, onShot.buf, onShot.camera, [
      { x0: left - 12, x1: left - 8, y0: bottom, y1: bottom + 4 },
      { x0: left + 8, x1: left + 16, y0: bottom + 2, y1: bottom + 4 },
    ]);
    step = { delta: openGround.mean - stepBand.mean, openMean: openGround.mean, bandMean: stepBand.mean };
  }
  await onScene.page.close();
  ao.samples.push({
    ...sample,
    roi,
    baseMean: off.mean,
    afterMean: on.mean,
    delta: off.mean - on.mean,
    pixels: off.pixels,
    supported: off.mean >= AO_SUPPORTED_BASE,
    visible: onOffDiff === null
      ? null
      : { changed: onOffDiff.changed, pixels: onOffDiff.roi.pixels, ratio: onOffDiff.ratio },
    ...(step === null ? {} : { step }),
    // 「基底未知」计数：renderStats 里读，正常必须 0。非 0 = AO 落点那格取错了。
    // #2：不写 `?? null`——字段不存在时原样留 undefined，由下面的汇总单独报「字段缺失」。
    unknownBase: onShot.stats.contactAoUnknownBase,
  });
}
const aoStep = ao.samples.find((sample) => sample.step !== undefined)?.step ?? null;
ao.stepDelta = aoStep?.delta ?? null;
ao.alpha = AO_ALPHA;
ao.basis = {
  measured: `既有最外阶 α0.16 的同帧实测 ΔL ${(ao.stepDelta ?? NaN).toFixed(2)}`,
  inferred: [
    `上限 ${AO_MAX} = 追平该阶 → 超过会读成第二层影子`,
    `下限 ${AO_MIN} = 0.4×该阶（14×0.4=5.6 进位）→ 再淡读不出`,
  ],
};
// 钉住的样本不能只有一个：至少 3 例，且必须同时覆盖最暗（stone）与最亮（plaza）两档。
ao.pinnedCount = ao.samples.filter((sample) => sample.role === 'pinned' && !sample.missing).length;
ao.pinnedBases = [...new Set(ao.samples.filter((sample) => sample.role === 'pinned').map((sample) => sample.base))];
// 实测覆盖的基底 token：至少 3 档（plaza / stone / grass …），带外的档也要有读数。
ao.measuredBases = [...new Set(ao.samples.filter((sample) => !sample.missing).map((sample) => sample.base))];
// 窄带余量：两端到 [6,14] 的距离。任一 <5% 就是「刚好卡进去」，触发重新配平。
const aoPinned = ao.samples.filter((sample) => sample.role === 'pinned' && !sample.missing);
if (aoPinned.length > 0) {
  const lowest = Math.min(...aoPinned.map((sample) => sample.delta));
  const highest = Math.max(...aoPinned.map((sample) => sample.delta));
  ao.margins = {
    lower: lowest - AO_MIN,
    upper: AO_MAX - highest,
    lowerSample: aoPinned.find((sample) => sample.delta === lowest).id,
    upperSample: aoPinned.find((sample) => sample.delta === highest).id,
  };
}
// 「基底未知」不是缺省，是取错了落点：任何一次都得红。只在 AO 打开的页上计数
// （`?contactAO=0` 根本不进判定，计数天然为 0，不能拿来当证据）。
// #2：字段缺失与「计数为 0」是两件事。缺失不在求和里冒充 0，单独点名哪个样本缺字段。
const aoUnknownBaseMissing = ao.samples.filter(
  (sample) => !sample.missing && typeof sample.unknownBase !== 'number',
);
const aoUnknownBase = ao.samples.reduce(
  (sum, sample) => sum + (typeof sample.unknownBase === 'number' ? sample.unknownBase : 0),
  0,
);
ao.unknownBase = aoUnknownBase;
ao.unknownBaseMissing = aoUnknownBaseMissing.map((sample) => sample.id);

// G1：黄昏同机位，建筑与角色同时在框内，4× 对照。
// 机位：wave_house 左墙 + 钉在 (26,27) 的人同框；避开篝火/烟/长凳（前两版都被它们污染）。
const g1Scene = await openScene(browser, { phase: 'dusk', camera: { x: 480, y: 450 }, villagerCell: { x: 26, y: 27 } });
const g1Shot = await shot(g1Scene.page, g1Scene.box, 'g1-dusk');
// 裁到建筑墙脚：上一版下沿停在 495，楼底接地影正好被切掉，没法做同框对照。
const g1Roi = { x0: 380, y0: 405, x1: 550, y1: 540 };
const g1Buf = await cropUpscale(g1Scene.page, g1Shot.buf, g1Shot.camera, g1Roi, 4);
const g1Path = join(OUT, 'lighting-g1-dusk-4x.png');
writeFileSync(g1Path, g1Buf);
const g1 = {
  camera: { x: 480, y: 450 },
  villagerCell: { x: 26, y: 27 },
  roi: g1Roi,
  path: g1Path,
  hash: hashOf(g1Buf),
};
await g1Scene.page.close();

await reader.close();
await browser.close();

const determinism = pass1.hashes.filter((hash, index) => hash === pass2.hashes[index]).length;

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
  determinismProbe: { pass1: pass1.hashes, pass2: pass2.hashes, frames: pass1.frames },
  peakCommands,
  peakBudget: DESIGN_TARGET,
  peakCeiling: PEAK_CEILING,
  peakDebt: Math.max(0, peakCommands - DESIGN_TARGET),
  ao,
  g1,
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
console.log(`确定性 ${determinism}/13；峰值指令 ${peakCommands}（设计目标 ${DESIGN_TARGET} / 天花板 ${PEAK_CEILING}）`);
for (const item of phaseRows) {
  if (item.stall.segments) {
    const s = item.stall.segments.map((seg) => `${seg.name} ${(seg.strength * 100).toFixed(2)}%`).join(' / ');
    console.log(`  [G2 摊位 ${item.phase}] ${s}`);
  }
  if (item.villager.segments) {
    const s = item.villager.segments.map((seg) => `${seg.name} ${(seg.strength * 100).toFixed(2)}%`).join(' / ');
    console.log(`  [G2 人物 ${item.phase}] ${s}`);
  }
}
const AO_ROLE_LABEL = {
  pinned: '钉住·须在带内',
  dark: '深底·放弃',
  occluded: '遮挡·放弃',
};
for (const sample of ao.samples) {
  if (sample.missing) {
    console.log(`  [G3] ${sample.id} 不在建筑表`);
    continue;
  }
  const visible = sample.visible === null ? '' : `，可见 ${sample.visible.changed}/${sample.visible.pixels}px`;
  console.log(`  [G3] ${sample.id}（token ${sample.base}，${AO_ROLE_LABEL[sample.role] ?? '探针'}）基底 ${sample.baseMean.toFixed(2)}`
    + ` → 开 ${sample.afterMean.toFixed(2)} → ΔL ${sample.delta.toFixed(2)}${visible}`
    + `（${sample.supported ? '基底够亮' : '基底低于可读门槛'}）`);
}
console.log(`  [G3] 测量（非推断）：既有 α0.16 阶梯同帧实测 ΔL ${ao.stepDelta.toFixed(2)}；`
  + `本轮 α ${AO_ALPHA}、可读基底门槛 ${AO_SUPPORTED_BASE.toFixed(2)} (测+算)`);
console.log(`  [G3] 推断：上限 ${ao.max} = 追平该阶 → 超过会读成第二层影子；下限 ${ao.min} = 0.4×该阶 → 再淡读不出`);
if (aoUnknownBaseMissing.length > 0) {
  // 缺字段时不许打印一个由缺失伪造出来的 0：那会让「字段没了」看起来像「计数是 0」。
  console.log(
    `  [G3 基底未知] 字段缺失（${aoUnknownBaseMissing.map((sample) => sample.id).join(', ')}）：`
    + 'renderStats.contactAoUnknownBase 不存在，不能按 0 放行',
  );
} else {
  console.log(`  [G3 基底未知] ${aoUnknownBase} 次（须为 0；非 0 = AO 落点那格取错了）`);
}
console.log(`  [G3 样本] 钉住 ${ao.pinnedCount} 例，覆盖 token ${ao.pinnedBases.join('/')}；`
  + `实测覆盖 token ${ao.measuredBases.join('/')}`);
if (ao.margins) {
  const lowerPct = ao.margins.lower / AO_MIN;
  const upperPct = ao.margins.upper / AO_MAX;
  const lowerNarrow = ao.margins.lower >= 0 && lowerPct < 0.05;
  const upperNarrow = ao.margins.upper >= 0 && upperPct < 0.05;
  console.log(`  [G3 窄带] 下端余量 ${ao.margins.lower.toFixed(2)}（${(lowerPct * 100).toFixed(1)}% of ${AO_MIN}，`
    + `${ao.margins.lowerSample}）；上端余量 ${ao.margins.upper.toFixed(2)}（${(upperPct * 100).toFixed(1)}% of ${AO_MAX}，`
    + `${ao.margins.upperSample}）→ ${ao.margins.lower < 0 || ao.margins.upper < 0 ? '已越界（红）'
      : lowerNarrow || upperNarrow ? '窄带（触发即重新配平，不放宽阈值）' : '非窄带'}`);
}
console.log(`  [G1] ${g1.path} (${g1.hash})`);
console.log(`口径 机位 摊位 x${STALL_CAMERA.x}/y${STALL_CAMERA.y}、人物 x${VILLAGER_CAMERA.x}/y${VILLAGER_CAMERA.y}、zoom ${closed.camera.zoom}、视口 1010×700、潮位 1、晴、相位 ${PHASES.join('/')}、depth 3.1`);
void row;

// G0：把读数变成判据。只读本次运行产出的值，不读 11-04 的旧 JSON。
const failures = [];
const expectZero = (label, item) => {
  if (item.changed !== 0) failures.push(`${label} 应为 0.00%，实为 ${pct(item.ratio)}（${item.changed}px）`);
};
expectZero('全关同刻两页', closedSameTime);
expectZero('跨 t/t+1s', closedStep);
expectZero('暂停', pauseDiff);
if (determinism !== 13) failures.push(`确定性应为 13/13，实为 ${determinism}/13`);
// #3：夜间影长必须为 0。`?? []` / `?? 0` 会让「没这一行 / 没这个字段」静默变成「是 0」，
// 所以这里逐项确认读数在不在，缺哪个字段就点哪个字段。
const night = phaseRows.find((item) => item.phase === 'night');
if (night === undefined) {
  failures.push('夜间行缺失（PHASES 里没有 night）：无法评估「夜间影长必须为 0」');
} else {
  const nightStalls = night.stall.on.stalls;
  if (!Array.isArray(nightStalls) || nightStalls.length === 0) {
    failures.push(
      `夜间摊位 units.stalls ${Array.isArray(nightStalls) ? '为空' : '字段缺失'}：`
      + '无法证明夜间摊位影长为 0',
    );
  } else {
    const badSpans = nightStalls.filter((unit) => !Number.isFinite(unit.span));
    if (badSpans.length > 0) {
      failures.push(`夜间摊位 ${badSpans.length} 个单位缺 span 字段：无法证明夜间影长为 0`);
    } else if (nightStalls.some((unit) => unit.span > 0)) {
      failures.push(`夜间摊位影长应为 0，实为 ${nightStalls.map((unit) => unit.span).join(',')}`);
    }
  }
  const nightVillagers = night.villager.on.villagers;
  if (!Array.isArray(nightVillagers) || nightVillagers.length === 0) {
    failures.push(
      `夜间人物 units.villagers ${Array.isArray(nightVillagers) ? '为空' : '字段缺失'}：`
      + '无法证明夜间人物影长为 0',
    );
  } else {
    const nightFoot = nightVillagers[0];
    if (!Number.isFinite(nightFoot.span)) {
      failures.push('夜间人物 0 号缺 span 字段：无法证明夜间影长为 0');
    } else if (nightFoot.span > 0) {
      failures.push(`夜间人物影长应为 0，实为 ${nightFoot.span}`);
    }
  }
}
if (peakCommands > PEAK_CEILING) failures.push(`峰值指令 ${peakCommands} > 天花板 ${PEAK_CEILING}（设计目标 ${DESIGN_TARGET}）`);

// G2：三段阶梯必须是「内 > 中 > 外」，且相邻两段的落差够读得出来。
// 阈值来源：α 阶梯 [1, 0.65, 0.35] 的名义**相对**落差是 35%（内→中）与 46%（中→外）；
// 取 25% 作底线 ≈ 较小那个名义落差的 0.7 倍——给 2px 的短梢留出采样余量
// （绝对 pp 落差会随底色/角色所在材质漂，基线里人物 2px 外段就是这么只差 1.84pp 的）。
// 「α 层数 ≤4」不在这里数像素：由 `shadowSegments` 的结构（3 阶 + 1px 内芯）在单测里钉住。
const G2_MIN_REL_DROP = 0.25;
/**
 * 按实有的段数逐对检查：单段只要求「有压暗」，两段查内→中，三段再加查中→外。
 * 段数不是缺陷——`span<=2` 在设计上就是单段；但在晨/午相位上，摊位的影长
 * 20+span ≥21，永远有完整三段，所以「内→中、中→外各 ≥25%」这条在每个相位
 * 都能由摊位跑满，人物的短影只跑它够得到的对数。
 */
const checkLadder = (label, rows, span) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    failures.push(`${label} 缺读数`);
    return;
  }
  const weak = rows.filter((row) => row.strength <= 0);
  if (weak.length > 0) {
    failures.push(`${label} 有段没压暗：${rows.map((r) => `${r.name} ${pct(r.strength)}`).join(' / ')}`);
    return;
  }
  const relDrop = (from, to) => (from - to) / from;
  for (let index = 1; index < rows.length; index += 1) {
    const from = rows[index - 1];
    const to = rows[index];
    if (relDrop(from.strength, to.strength) < G2_MIN_REL_DROP) {
      failures.push(
        `${label}（影长 ${span}px，${rows.length} 段）${from.name}→${to.name} 只淡 `
        + `${(relDrop(from.strength, to.strength) * 100).toFixed(1)}% < ${G2_MIN_REL_DROP * 100}%`,
      );
    }
  }
};
// #1：亮相位本该有影。「没有段」不是「阶梯合格」，而是判据前提不成立——
// 段为 null 只可能是因为取不到单位或影长，沉默跳过等于把缺读数当成通过。
const LIT_PHASES = new Set(['dawn', 'noon', 'dusk']);
for (const item of phaseRows) {
  const stallSpan = item.stall.on.stalls?.[0]?.span ?? 0;
  const villagerSpan = item.villager.on.villagers?.[0]?.span ?? 0;
  if (LIT_PHASES.has(item.phase)) {
    if (item.stall.segments === null) {
      failures.push(`G2 摊位 ${item.phase} 没有段：判据前提不成立（取不到摊位单位或影长）`);
    } else {
      checkLadder(`G2 摊位 ${item.phase}`, item.stall.segments, 20 + stallSpan);
    }
    if (item.villager.segments === null) {
      failures.push(`G2 人物 ${item.phase} 没有段：判据前提不成立（取不到人物单位或影长）`);
    } else {
      checkLadder(`G2 人物 ${item.phase}`, item.villager.segments, villagerSpan);
    }
    continue;
  }
  if (item.stall.segments !== null || item.villager.segments !== null) {
    failures.push(`G2 ${item.phase} 没有光却切出了段：判据前提不成立（夜间影长应为 0）`);
  }
}

// G3：双向判据 + 基底覆盖面。低于下限 = 白加，高于上限 = 读成第二层影子。
// 深底两档（grass 64.90 / mud 41.32）不是「α 没调够」，是单一全局 α 的物理不可能：
// ink（23.16）能压暗它们（ΔL 5.01 / 2.19，>0），但要把 grass 拉进 [6,14] 需 α ≥ 0.144，
// 同一 α 把 plaza（134.09）顶到 15.97 > 14；mud 需 α ≥ 0.329，plaza 会到 36 以上。
// 所以这两档明确**放弃**（深底），只要求 ΔL > 0 且留在带外；进带内说明分档理由失效。
if (ao.pinnedCount < 3) {
  failures.push(`G3 钉住的样本只有 ${ao.pinnedCount} 例，不足 3 例`);
}
for (const base of ['stone', 'plaza']) {
  if (!ao.pinnedBases.includes(base)) failures.push(`G3 钉住样本缺 ${base} 一档`);
}
if (ao.measuredBases.length < 3) {
  failures.push(`G3 实测只覆盖 ${ao.measuredBases.length} 档基底（${ao.measuredBases.join('/')}），不足 3 档`);
}
for (const sample of ao.samples) {
  if (sample.missing) {
    failures.push(`G3 样本 ${sample.id} 不在建筑表`);
    continue;
  }
  // 第一性断言：接触暗部只能压暗。ΔL ≤ 0 说明阴影色比基底还亮（钳制会跳过矩形 → ΔL=0），
  // 这是语义错误，不论该样本是 pinned / dark / occluded 都判红。
  if (sample.delta <= 0) {
    failures.push(`G3 ${sample.id}（${sample.base}，${sample.role}）ΔL ${sample.delta.toFixed(2)} ≤ 0：`
      + `接触暗部没有压暗基底（阴影色比基底亮，已钳制为不产出矩形）`);
    continue;
  }
  if (sample.role === 'pinned') {
    if (!sample.supported) {
      failures.push(`G3 ${sample.id}（${sample.base}）基底 ${sample.baseMean.toFixed(2)} 低于可读门槛 ${AO_SUPPORTED_BASE.toFixed(2)}`);
    } else if (sample.delta < AO_MIN) {
      failures.push(`G3 ${sample.id}（${sample.base}）ΔL ${sample.delta.toFixed(2)} < 下限 ${AO_MIN}（接触暗部读不出）`);
    } else if (sample.delta > AO_MAX) {
      failures.push(`G3 ${sample.id}（${sample.base}）ΔL ${sample.delta.toFixed(2)} > 上限 ${AO_MAX}（压太深，会读成第二层影子）`);
    }
    continue;
  }
  if (sample.role === 'dark') {
    // 深底：ΔL > 0 已由上面的第一性断言管住；这里只管「仍然进不了带」。
    if (sample.delta >= AO_MIN) {
      failures.push(`G3 ${sample.id}（${sample.base}，深底）ΔL ${sample.delta.toFixed(2)} 进了带内，放弃理由失效`);
    }
  }
  // occluded：只登记读数与可见像素比例，不判带内——它的 ROI 只有一部分可见，
  // 那个 ΔL 是可见部分的混合值，不能当干净墙角读。
}

// 「基底未知」不是缺省，是取错了落点：任何一次都得红（计算见 G3 汇总处）。
// #2：字段缺失 = 判据前提不成立，不能把缺失当 0 放行。
if (aoUnknownBaseMissing.length > 0) {
  failures.push(
    `G3 基底未知计数缺失（${aoUnknownBaseMissing.map((sample) => sample.id).join(', ')}）：`
    + 'contactAoUnknownBase 字段不存在 = 判据前提不成立，不许把缺失当 0',
  );
}
if (aoUnknownBase !== 0) {
  failures.push(`接触暗部「基底未知」${aoUnknownBase} 次：AO 落点那格取错了（正常必须为 0）`);
}

console.log(
  `[记账] 设计目标 ${DESIGN_TARGET} / 实测峰值 ${peakCommands} / 天花板 ${PEAK_CEILING}，债务 ${Math.max(0, peakCommands - DESIGN_TARGET)}`,
);
if (failures.length > 0) {
  console.log(`[判据] 红（${failures.length} 条）`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[判据] 绿');
}
