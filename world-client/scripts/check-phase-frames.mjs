#!/usr/bin/env node
/**
 * 丙类 18 张相位帧的弱判据：差分是否被限制在预期区域内。
 *
 * 判据（三条，全过才算 ok）：
 *   1. 区域外差异像素 = 0（逐像素 RGBA 严格比较，无压缩噪声，容差取 0）；
 *   2. 区域内差异连通块数 ≤ 三跑并集块数 × 1.5；
 *   3. 区域内差异总面积 ≤ 三跑并集面积 × 1.4。
 * 阈值基准与区域清单在 scripts/lib/phase-regions.json，推导见
 * docs/evidence/animation-express/PHASE_FRAME_CRITERIA.md。
 *
 * 用法：
 *   node scripts/check-phase-frames.mjs --ref eval/screens --cur ../tmp/anim-verify/r1/screens
 *   node scripts/check-phase-frames.mjs --self-test --ref ../tmp/anim-verify/r1/screens --cur ../tmp/anim-verify/r2/screens
 *
 * --self-test 造两类必红样本：把差区整体搬到区域外、把区内面积放大到并集的 1.5 倍。
 * 退出码：全过 0；任一非 ok 或自检未按预期变红 1；用法错误 2。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const CONFIG = JSON.parse(readFileSync(new URL('./lib/phase-regions.json', import.meta.url), 'utf8'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const selfTest = flag('--self-test');
const refDir = resolve(opt('--ref') ?? join(import.meta.dirname, '..', 'eval', 'screens'));
const curDir = opt('--cur') ? resolve(opt('--cur')) : null;
const only = opt('--only');

if (!selfTest && !curDir) {
  console.error('用法：node scripts/check-phase-frames.mjs --ref <基目录> --cur <新跑目录> [--only 文件]');
  console.error('      node scripts/check-phase-frames.mjs --self-test --ref <基目录> --cur <新跑目录>');
  process.exit(2);
}

const limitsOf = (img) => ({
  outsidePixels: CONFIG.outsidePixels ?? 0,
  maxArea: Math.ceil(img.observed.unionPixels * CONFIG.margin.area),
  maxComponents: Math.ceil(img.observed.unionComponents * CONFIG.margin.components),
});

const dataUrl = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

async function judge(page, refUrl, candUrl, img) {
  return page.evaluate(async ({ refUrl, candUrl, regions, limits }) => {
    const decode = async (url) => {
      const el = new Image();
      el.src = url;
      await el.decode();
      const canvas = document.createElement('canvas');
      canvas.width = el.width;
      canvas.height = el.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(el, 0, 0);
      return { w: el.width, h: el.height, d: ctx.getImageData(0, 0, el.width, el.height).data };
    };
    const A = await decode(refUrl);
    const B = await decode(candUrl);
    if (A.w !== B.w || A.h !== B.h) return { size: [A.w, A.h, B.w, B.h] };

    const w = A.w;
    const h = A.h;
    const inside = new Uint8Array(w * h);
    for (const r of regions) {
      const [x0, y0, x1, y1] = r.bbox;
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) inside[y * w + x] = 1;
      }
    }

    const mask = new Uint8Array(w * h);
    let changed = 0;
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      if (A.d[i] !== B.d[i] || A.d[i + 1] !== B.d[i + 1] || A.d[i + 2] !== B.d[i + 2] || A.d[i + 3] !== B.d[i + 3]) {
        mask[p] = 1;
        changed += 1;
      }
    }

    // sel: 1 = 区域外，2 = 区域内
    const scan = (sel) => {
      const seen = new Uint8Array(w * h);
      const stack = new Int32Array(w * h);
      let area = 0;
      let comps = 0;
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      const wanted = (p) => (sel === 1 ? inside[p] !== 1 : inside[p] === 1);
      for (let p = 0; p < w * h; p += 1) {
        if (!mask[p] || seen[p] || !wanted(p)) continue;
        let sp = 0;
        stack[sp++] = p;
        seen[p] = 1;
        comps += 1;
        while (sp) {
          const q = stack[--sp];
          area += 1;
          const x = q % w;
          const y = (q - x) / w;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nq = ny * w + nx;
              if (!mask[nq] || seen[nq] || !wanted(nq)) continue;
              seen[nq] = 1;
              stack[sp++] = nq;
            }
          }
        }
      }
      return { area, comps, bbox: x1 >= 0 ? [x0, y0, x1 + 1, y1 + 1] : null };
    };

    const outside = scan(1);
    const insideStats = scan(2);
    const violations = [];
    if (outside.area > limits.outsidePixels) {
      const box = outside.bbox ? outside.bbox.join(',') : '—';
      violations.push(
        `区域外差异 ${outside.area}px / ${outside.comps} 个连通块 / bbox ${box}（要求 ${limits.outsidePixels}px）`,
      );
    }
    if (insideStats.area > limits.maxArea) {
      violations.push(`区域内差异面积 ${insideStats.area}px 超过上限 ${limits.maxArea}px`);
    }
    if (insideStats.comps > limits.maxComponents) {
      violations.push(`区域内差异连通块 ${insideStats.comps} 个超过上限 ${limits.maxComponents} 个`);
    }
    return { width: w, height: h, changed, outside, inside: insideStats, violations };
  }, { refUrl, candUrl, regions: img.regions, limits: limitsOf(img) });
}

/** 造两个合成样本：差区搬到区域外、区内面积放大到并集的 1.5 倍。 */
async function buildSynthetic(page, refUrl, candUrl, img) {
  return page.evaluate(async ({ refUrl, candUrl, regions, targetArea }) => {
    const decode = async (url) => {
      const el = new Image();
      el.src = url;
      await el.decode();
      const canvas = document.createElement('canvas');
      canvas.width = el.width;
      canvas.height = el.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(el, 0, 0);
      return { w: el.width, h: el.height, d: ctx.getImageData(0, 0, el.width, el.height).data };
    };
    const A = await decode(refUrl);
    const B = await decode(candUrl);
    const w = A.w;
    const h = A.h;
    const inside = new Uint8Array(w * h);
    for (const r of regions) {
      const [x0, y0, x1, y1] = r.bbox;
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) inside[y * w + x] = 1;
      }
    }
    const mask = new Uint8Array(w * h);
    let minx = w;
    let miny = h;
    let maxx = -1;
    let maxy = -1;
    let changed = 0;
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      if (A.d[i] !== B.d[i] || A.d[i + 1] !== B.d[i + 1] || A.d[i + 2] !== B.d[i + 2] || A.d[i + 3] !== B.d[i + 3]) {
        mask[p] = 1;
        changed += 1;
        const x = p % w;
        const y = (p - x) / w;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }

    const encode = (data) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const frame = ctx.createImageData(w, h);
      frame.data.set(data);
      ctx.putImageData(frame, 0, 0);
      return canvas.toDataURL('image/png');
    };

    // 1) 整体平移：把差区 bbox 搬到底部居中，落点像素写 A+1 保证与原图不同
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    const dx = Math.round((w - bw) / 2) - minx;
    const dy = h - 6 - bh - miny;
    const moved = new Uint8ClampedArray(A.d);
    for (let p = 0; p < w * h; p += 1) {
      if (!mask[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = (ny * w + nx) * 4;
      moved[j] = (A.d[j] + 1) & 0xff;
      moved[j + 1] = (A.d[j + 1] + 1) & 0xff;
      moved[j + 2] = (A.d[j + 2] + 1) & 0xff;
      moved[j + 3] = A.d[j + 3];
    }

    // 2) 放大：先写真实差，再沿四邻域补像素，直到达到 targetArea
    const grown = new Uint8ClampedArray(A.d);
    const added = new Uint8Array(w * h);
    let area = 0;
    for (let p = 0; p < w * h; p += 1) {
      if (!mask[p]) continue;
      const i = p * 4;
      grown[i] = B.d[i];
      grown[i + 1] = B.d[i + 1];
      grown[i + 2] = B.d[i + 2];
      grown[i + 3] = B.d[i + 3];
      added[p] = 1;
      area += 1;
    }
    const grow = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
      const nq = ny * w + nx;
      if (added[nq] || inside[nq] !== 1) return false;
      const j = nq * 4;
      grown[j] = (A.d[j] + 1) & 0xff;
      grown[j + 1] = (A.d[j + 1] + 1) & 0xff;
      grown[j + 2] = (A.d[j + 2] + 1) & 0xff;
      added[nq] = 1;
      area += 1;
      return true;
    };
    let progress = true;
    while (area < targetArea && progress) {
      progress = false;
      for (let p = 0; p < w * h && area < targetArea; p += 1) {
        if (!added[p]) continue;
        const x = p % w;
        const y = (p - x) / w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (area >= targetArea) break;
          if (grow(nx, ny)) progress = true;
        }
      }
    }

    return { moved: encode(moved), grown: encode(grown), changed, grownArea: area, origin: [minx, miny, maxx + 1, maxy + 1] };
  }, {
    refUrl,
    candUrl,
    regions: img.regions,
    targetArea: Math.ceil(img.observed.unionPixels * 1.5),
  });
}

const images = CONFIG.images.filter((img) => !only || img.file === only);
if (!images.length) {
  console.error(`没有匹配的配置项：${only}`);
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();
let failed = 0;
let passed = 0;
let missing = 0;

try {
  if (selfTest) {
    const img = images[0];
    const refPath = join(refDir, img.file);
    const candPath = join(curDir ?? refDir, img.file);
    console.log(`## 反向用例（合成） 基准：${img.file}  区内面积上限 ${limitsOf(img).maxArea}px`);
    console.log(`   ref=${refPath}`);
    console.log(`   cur=${candPath}`);
    const base = await judge(page, dataUrl(refPath), dataUrl(candPath), img);
    const baseOk = !base.size && base.violations.length === 0;
    console.log(`   原始对：${baseOk ? 'ok' : `FAIL ${base.violations.join('；')}`}`);

    const syn = await buildSynthetic(page, dataUrl(refPath), dataUrl(candPath), img);
    const moved = await judge(page, dataUrl(refPath), syn.moved, img);
    const movedOk = !moved.size && moved.violations.length > 0;
    console.log(`   [应红] 把差区搬到区域外（bbox ${syn.origin.join(',')} → 底部）：`);
    console.log(`     ${movedOk ? 'FAIL ✓' : 'PASS ✗（没有变红）'} ${moved.violations.join('；')}`);

    const grown = await judge(page, dataUrl(refPath), syn.grown, img);
    const grownOk = !grown.size && grown.violations.length > 0;
    console.log(`   [应红] 区内面积放大到并集 1.5 倍（目标 ${Math.ceil(img.observed.unionPixels * 1.5)}px，实得 ${syn.grownArea}px）：`);
    console.log(`     ${grownOk ? 'FAIL ✓' : 'PASS ✗（没有变红）'} ${grown.violations.join('；')}`);

    if (!baseOk || !movedOk || !grownOk) process.exitCode = 1;
  } else {
    for (const img of images) {
      const refPath = join(refDir, img.file);
      const candPath = join(curDir, img.file);
      if (!existsSync(refPath) || !existsSync(candPath)) {
        missing += 1;
        console.log(`missing\t${img.file}\t${existsSync(refPath) ? '' : 'ref 缺图'} ${existsSync(candPath) ? '' : 'cur 缺图'}`);
        continue;
      }
      const result = await judge(page, dataUrl(refPath), dataUrl(candPath), img);
      const limits = limitsOf(img);
      if (result.size) {
        failed += 1;
        console.log(`FAIL\t${img.file}\t尺寸不同 ${result.size[0]}x${result.size[1]} vs ${result.size[2]}x${result.size[3]}`);
        continue;
      }
      if (result.violations.length) {
        failed += 1;
        console.log(`FAIL\t${img.file}\t${result.violations.join('；')}`);
      } else {
        passed += 1;
        console.log(
          `ok\t${img.file}\t区外 ${result.outside.area}px / 区内 ${result.inside.area}px（上限 ${limits.maxArea}）/ 区内 ${result.inside.comps} 块（上限 ${limits.maxComponents}）`,
        );
      }
    }
    console.log(`\n总计 ${images.length}：ok ${passed} / FAIL ${failed} / missing ${missing}`);
    if (failed || missing) process.exitCode = 1;
  }
} finally {
  await browser.close();
}
