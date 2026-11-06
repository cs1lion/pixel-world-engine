#!/usr/bin/env node
/**
 * 暗带盲区复算：旧「1 格」阈对 16 列（=1 格）以内的暗带变化全盲。
 *
 * 不重拍新图，直接读本轮的 `lamp-band-after-{lit,dark}.png`，套 `check-lamp-band.mjs`
 * 同一套逐列 ΔY 剖面（机位/带段/阈值全部从 `lamp-band-after.json` 的 `cam` 与写死口径来），
 * 人为把主暗带向右加宽 15 列（灯亮图对应列的带段像素替换成灯灭图）：
 * - runA：不补偿 → 覆盖同时掉 15 列（4.6875pp），只用来单独看暗带指标的盲区；
 * - runB：补亮 15 个暗列（主暗带外 4 列 + 主暗带最左 11 列）→ 覆盖逐位回到原值，
 *   主暗带净加宽 4 列（0.25 格）。
 *
 * 默认参数即复算证据 JSON 里的两组数；算不出那两组就直接报错，不写文件。
 *
 * 跑法（先有 `lamp-band-after` 的图与 JSON）：
 *   BAND_SEED=20261019 BAND_NOW=720 PIXEL_WORLD_URL=http://127.0.0.1:5211/ npm run test:lamp-band
 *   node scripts/check-lamp-blindspot.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const SCREENS = process.env.EVAL_OUT ?? join(ROOT, 'eval', 'screens');
const AFTER_JSON = join(SCREENS, 'lamp-band-after.json');
const LIT_PNG = join(SCREENS, 'lamp-band-after-lit.png');
const DARK_PNG = join(SCREENS, 'lamp-band-after-dark.png');
const OUT = process.env.BLINDSPOT_OUT
  ?? resolve(ROOT, '..', 'docs', 'evidence', 'scene-motion', 'lamp-band-threshold-blindspot.json');
/** 人为加宽的列数；默认 15 = 旧阈 16 列盲区之内（改动量本身检不出来）。 */
const WIDEN = Number.parseInt(process.env.BLINDSPOT_WIDEN ?? '15', 10);
if (!Number.isInteger(WIDEN) || WIDEN <= 0) throw new Error(`BLINDSPOT_WIDEN 必须是正整数：${process.env.BLINDSPOT_WIDEN}`);

for (const file of [AFTER_JSON, LIT_PNG, DARK_PNG]) {
  if (!existsSync(file)) throw new Error(`缺 ${file}；先用 check-lamp-band 拍 after 图，再跑本脚本。`);
}

/** 与 check-lamp-band 写死的口径一致；机位与 zoom 从 after JSON 取，避免两处漂移。 */
const after = JSON.parse(readFileSync(AFTER_JSON, 'utf8'));
const geometry = {
  worldViewX: after.cam.worldViewX,
  worldViewY: after.cam.worldViewY,
  zoom: after.cam.zoom,
  scale: 2,
  x0: 240,
  x1: 560,
  y0: 435,
  y1: 535,
  threshold: 0.01,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const measured = await page.evaluate(async ({ litB64, darkB64, geometry, widen }) => {
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
    return ctx.getImageData(0, 0, c.width, c.height);
  };
  const toLinear = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lumAt = (img, x, y) => {
    const i = (y * img.width + x) * 4;
    return 0.2126 * toLinear(img.data[i]) + 0.7152 * toLinear(img.data[i + 1]) + 0.0722 * toLinear(img.data[i + 2]);
  };
  const pxX = (wx) => Math.round((wx - geometry.worldViewX) * geometry.scale * geometry.zoom);
  const pxY = (wy) => Math.round((wy - geometry.worldViewY) * geometry.scale * geometry.zoom);

  /** 与 check-lamp-band 的 profile() 相同：逐列取带段内「灯亮 - 灯灭」最大 ΔY。 */
  const profile = (litImg, darkImg) => {
    const cols = [];
    for (let wx = geometry.x0; wx < geometry.x1; wx += 1) {
      let best = 0;
      for (let wy = geometry.y0; wy < geometry.y1; wy += 1) {
        const delta = lumAt(litImg, pxX(wx), pxY(wy)) - lumAt(darkImg, pxX(wx), pxY(wy));
        if (delta > best) best = delta;
      }
      cols.push({ wx, delta: best });
    }
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
    const litCols = cols.filter((c) => c.delta >= geometry.threshold).length;
    const deltas = cols.map((c) => c.delta);
    return {
      cols,
      coverage: litCols / cols.length,
      gapCells: bestGap / 16,
      gapAt: bestGapStart,
      min: Math.min(...deltas),
      max: Math.max(...deltas),
      avg: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    };
  };

  const clone = (img) => ({
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  });
  /** 把 `src` 的带段像素整列抄进 `dst` 的同一列：整列同色后该列 ΔY = 0（灯亮列变暗）。 */
  const copyBandColumn = (dst, src, wx) => {
    const x = pxX(wx);
    for (let wy = geometry.y0; wy < geometry.y1; wy += 1) {
      const y = pxY(wy);
      const si = (y * src.width + x) * 4;
      const di = (y * dst.width + x) * 4;
      for (let k = 0; k < 4; k += 1) dst.data[di + k] = src.data[si + k];
    }
  };
  /** 把 `src` 某一「亮列」的带段像素抄到 `dst` 的目标列：用来补亮原本暗的列。 */
  const copyBandColumnFrom = (dst, src, dstWx, srcWx) => {
    const sx = pxX(srcWx);
    const dx = pxX(dstWx);
    for (let wy = geometry.y0; wy < geometry.y1; wy += 1) {
      const y = pxY(wy);
      const si = (y * src.width + sx) * 4;
      const di = (y * dst.width + dx) * 4;
      for (let k = 0; k < 4; k += 1) dst.data[di + k] = src.data[si + k];
    }
  };
  const summary = (p) => ({
    coverage: p.coverage,
    gapCells: p.gapCells,
    gapAt: p.gapAt,
    min: p.min,
    max: p.max,
    avg: p.avg,
  });

  const [lit, dark] = await Promise.all([load(litB64), load(darkB64)]);

  // 1) 本轮真实截图的原剖面。主暗带 = 连续 ΔY < 阈的最长一段。
  const before = profile(lit, dark);
  const mainStart = before.gapAt;
  const mainLen = before.gapCells * 16;
  const mainEnd = mainStart + mainLen;
  const outsideDark = before.cols.filter((c) => c.delta < geometry.threshold && (c.wx < mainStart || c.wx >= mainEnd));

  // 2) runA：主暗带向右加宽 WIDEN 列（灯亮图这些列换成灯灭图的像素）。
  const widened = clone(lit);
  for (let i = 0; i < widen; i += 1) copyBandColumn(widened, dark, mainEnd + i);
  const runA = profile(widened, dark);

  // 3) runB：覆盖补偿。先把主暗带外那几列补亮，再从加宽后的主暗带最左端补亮剩下的列数，
  //    净加宽 = WIDEN - 补亮列数。补亮的像素取自原图最亮的一列（保证 ΔY 跨阈）。
  const brightWx = before.cols.reduce((a, b) => (b.delta > a.delta ? b : a)).wx;
  const compensated = clone(widened);
  let restored = 0;
  for (const c of outsideDark) {
    copyBandColumnFrom(compensated, lit, c.wx, brightWx);
    restored += 1;
  }
  for (let i = 0; restored < widen; i += 1, restored += 1) {
    copyBandColumnFrom(compensated, lit, mainStart + i, brightWx);
  }
  const runB = profile(compensated, dark);

  return {
    before,
    runA,
    runB,
    mainGap: { start: mainStart, columns: mainLen },
    outsideDarkColumns: outsideDark.map((c) => c.wx),
    summaries: { before: summary(before), runA: summary(runA), runB: summary(runB) },
  };
}, {
  litB64: readFileSync(LIT_PNG).toString('base64'),
  darkB64: readFileSync(DARK_PNG).toString('base64'),
  geometry,
  widen: WIDEN,
});
await page.close();
await browser.close();

/** 默认参数必须复算出证据里的两组数；对不上就停，不写文件。 */
const EXPECTED = {
  before: { coverage: 0.765625, gapCells: 4.4375, gapAt: 471 },
  runA: { coverage: 0.71875, gapCells: 5.375, gapAt: 471 },
  runB: { coverage: 0.765625, gapCells: 4.6875, gapAt: 482 },
};
const EPS = 1e-12;
for (const [run, want] of Object.entries(EXPECTED)) {
  const got = measured.summaries[run];
  for (const key of ['coverage', 'gapCells', 'gapAt']) {
    if (Math.abs(got[key] - want[key]) > EPS) {
      throw new Error(`${run}.${key} 复算不符：得 ${got[key]}，期望 ${want[key]}。`
        + `先确认 ${AFTER_JSON} 与图是 seed 20261019 / now=720 / 真晴 / frame180 的那一版。`);
    }
  }
}

const round = (v, n = 6) => Number(v.toFixed(n));
const { before, runA, runB } = measured.summaries;
const gapDiffA = round(runA.gapCells - before.gapCells, 4);
const gapDiffB = round(runB.gapCells - before.gapCells, 4);
const oldThreshold = 1;
const newThreshold = 0.0625;
const verdict = (diff) => (diff > oldThreshold ? '检出' : '未检出');
const newVerdict = (diff) => (diff > newThreshold ? '检出' : '未检出');

const evidence = {
  question: '暗带阈从 1 格改成 0.0625 格，是否真的消除了 16 倍盲区',
  method: '脚本 scripts/check-lamp-blindspot.mjs 读取本轮真实截图 lamp-band-after-lit.png / -dark.png，'
    + '用与 check-lamp-band 相同的逐列 ΔY 剖面。人为把主暗带（x471 起、71 列）向右加宽 15 列：'
    + '把这些列的灯亮图像素替换成灯灭图像素。两轮：A 不做覆盖补偿；B 从其它暗列补亮 15 列'
    + '（补亮像素取原图最亮一列的带段像素），把覆盖固定回原值，只让最长暗带变化。默认参数即复算本文件。',
  rerun: 'cd world-client && node scripts/check-lamp-blindspot.mjs',
  source: {
    images: 'world-client/eval/screens/lamp-band-after-{lit,dark}.png',
    protocol: 'seed 20261019、?now=720、真晴（rainStrength=0）、满潮、frame180',
  },
  runA_rawWiden15Columns: {
    before: { coverage: before.coverage, gapCells: before.gapCells, gapAt: before.gapAt },
    after: { coverage: runA.coverage, gapCells: runA.gapCells, gapAt: runA.gapAt },
    gapDiffCells: gapDiffA,
    oldThresholdCells: oldThreshold,
    oldVerdict: `${verdict(gapDiffA)}（${gapDiffA} ≤ ${oldThreshold}，旧阈值放过）`,
    newThresholdCells: newThreshold,
    newVerdict: `${newVerdict(gapDiffA)}（${gapDiffA} > ${newThreshold}）`,
    note: `此轮覆盖率同时掉了 ${round((before.coverage - runA.coverage) * 100, 4)}pp，按覆盖率会另报；这里只说明暗带指标本身的盲区。`,
  },
  runB_coverageCompensated: {
    before: { coverage: before.coverage, gapCells: before.gapCells, gapAt: before.gapAt },
    after: { coverage: runB.coverage, gapCells: runB.gapCells, gapAt: runB.gapAt },
    gapDiffCells: gapDiffB,
    restoredColumns: WIDEN,
    oldThresholdCells: oldThreshold,
    oldVerdict: `${verdict(gapDiffB)}（${gapDiffB} ≤ ${oldThreshold}，旧阈值放过）`,
    newThresholdCells: newThreshold,
    newVerdict: `${newVerdict(gapDiffB)}（${gapDiffB} > ${newThreshold}）`,
    note: `只有 ${measured.outsideDarkColumns.length} 个暗列在主暗带之外，补亮 ${WIDEN} 列时有 `
      + `${WIDEN - measured.outsideDarkColumns.length} 列落在主暗带内，净加宽 `
      + `${measured.outsideDarkColumns.length} 列（${gapDiffB} 格）；覆盖率仍逐位回到原值。`,
  },
  conclusion: `旧「1 格」阈对 16 列以内的暗带变化全盲；0.0625 格阈在真实截图上抓住了 +${gapDiffA} 格（未补偿）`
    + `与 +${gapDiffB} 格（覆盖固定）两种变化。`,
};

writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[blindspot] 原图 ${before.coverage * 100}% / ${before.gapCells} 格 @ x ${before.gapAt}`);
console.log(`  runA 加宽 ${WIDEN} 列（未补偿）：${runA.coverage * 100}% / ${runA.gapCells} 格 @ x ${runA.gapAt}（Δ ${gapDiffA} 格）`);
console.log(`  runB 覆盖补偿（补亮 ${WIDEN} 列，其中主暗带外 ${measured.outsideDarkColumns.length} 列）：${runB.coverage * 100}% / ${runB.gapCells} 格 @ x ${runB.gapAt}（Δ ${gapDiffB} 格）`);
console.log(`  旧阈 ${oldThreshold} 格：两轮均未检出；新阈 ${newThreshold} 格：两轮均检出`);
console.log(`  JSON ${OUT}`);
