#!/usr/bin/env node
/**
 * 两跑 pixel ledger 逐条比对（跨进程自证入口）。
 *
 * 用法：
 *   node scripts/compare-ledger.mjs <左：目录或 *-pixel-ledger.json> <右：目录或同前缀文件>
 *
 * 目录输入按 `<script>` 前缀自动配对；两份 ledger 按 `file` 对齐，三态：
 *   - ok            逐像素 sha256 相同
 *   - pixel-diff    逐像素不同（附 changed 像素数与 bbox）
 *   - size-mismatch 尺寸不同
 * 另有 missing（某侧缺图）也按非 ok 处理。
 *
 * 任意一条非 ok → 退出码 1。注意：在 `pinShotState` 落地前出现 pixel-diff 是预期结果，
 * 说明工具确实抓到了世界没停住造成的漂移，不是工具故障。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SUFFIX = '-pixel-ledger.json';

function collect(input) {
  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`找不到输入：${path}`);
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((name) => name.endsWith(SUFFIX))
      .map((name) => ({ prefix: name.slice(0, -SUFFIX.length), file: join(path, name) }));
  }
  const name = basename(path);
  const prefix = name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : name.replace(/\.json$/, '');
  return [{ prefix, file: path }];
}

async function pixelDiff(page, aPath, bPath) {
  const toUrl = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  return page.evaluate(async ({ a, b }) => {
    const load = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { w: canvas.width, h: canvas.height, d: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const A = await load(a);
    const B = await load(b);
    if (A.w !== B.w || A.h !== B.h) return { size: [A.w, A.h, B.w, B.h] };
    let changed = 0;
    let x0 = A.w;
    let y0 = A.h;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < A.d.length; i += 4) {
      if (A.d[i] !== B.d[i] || A.d[i + 1] !== B.d[i + 1] || A.d[i + 2] !== B.d[i + 2] || A.d[i + 3] !== B.d[i + 3]) {
        changed += 1;
        const p = i / 4;
        const x = p % A.w;
        const y = Math.floor(p / A.w);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { width: A.w, height: A.h, changed, bbox: changed ? [x0, y0, x1 + 1, y1 + 1] : null };
  }, { a: toUrl(aPath), b: toUrl(bPath) });
}

const left = collect(process.argv[2] ?? '');
const right = collect(process.argv[3] ?? '');
const pairs = left
  .map((l) => ({ left: l, right: right.find((r) => r.prefix === l.prefix) }))
  .filter((pair) => pair.right);

if (!pairs.length) throw new Error('两侧没有同前缀的 *-pixel-ledger.json 可配对');

const counts = { ok: 0, 'pixel-diff': 0, 'size-mismatch': 0, missing: 0 };
let browser = null;
let page = null;

for (const { left: l, right: r } of pairs) {
  const a = JSON.parse(readFileSync(l.file, 'utf8')).shots ?? [];
  const b = JSON.parse(readFileSync(r.file, 'utf8')).shots ?? [];
  const bMap = new Map(b.map((row) => [row.file, row]));
  const aMap = new Map(a.map((row) => [row.file, row]));
  const files = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();

  console.log(`\n# ${l.prefix} (${a.length}) vs ${r.prefix} (${b.length})`);
  for (const file of files) {
    const ra = aMap.get(file);
    const rb = bMap.get(file);
    if (!ra || !rb) {
      counts.missing += 1;
      console.log(`missing\t${file}`);
      continue;
    }
    if (ra.size !== rb.size) {
      counts['size-mismatch'] += 1;
      console.log(`size-mismatch\t${file}\t${ra.size} vs ${rb.size}`);
      continue;
    }
    if (ra.sha256 === rb.sha256) {
      counts.ok += 1;
      console.log(`ok\t${file}`);
      continue;
    }

    const aPath = join(dirname(l.file), file);
    const bPath = join(dirname(r.file), file);
    if (!existsSync(aPath) || !existsSync(bPath)) {
      counts['pixel-diff'] += 1;
      console.log(`pixel-diff\t${file}\t(图缺失，无法算 bbox)`);
      continue;
    }
    if (!browser) {
      browser = await chromium.launch();
      page = await browser.newPage();
    }
    const d = await pixelDiff(page, aPath, bPath);
    counts['pixel-diff'] += 1;
    const detail = d.size
      ? `尺寸不同 ${d.size[0]}x${d.size[1]} vs ${d.size[2]}x${d.size[3]}`
      : `${d.changed}px / ${(d.changed / (d.width * d.height) * 100).toFixed(3)}% / bbox ${d.bbox[2] - d.bbox[0]}x${d.bbox[3] - d.bbox[1]} / ${d.bbox.join(',')}`;
    console.log(`pixel-diff\t${file}\t${detail}`);
  }
}

if (browser) await browser.close();
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
console.log(`\n总计 ${total}：ok ${counts.ok} / pixel-diff ${counts['pixel-diff']} / size-mismatch ${counts['size-mismatch']} / missing ${counts.missing}`);
process.exitCode = counts.ok === total ? 0 : 1;
