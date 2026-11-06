/**
 * 要点 4 / 8 的读数脚本 —— **只测，不判**。
 *
 * 阈值（0.18 / 2 / 8 / 4）仍是暂定值，今天写成 pass/fail 只会制造红着没人修的
 * 孤儿闸门。这个脚本先把数报出来；等标定图落地，再按
 * docs/DESIGN_ACCEPTANCE.md 的口径另建闸门。
 *
 * 用法：
 *   node scripts/measure-design-readouts.mjs <截图.png> [--rect=x,y,w,h]
 *
 * 无第三方依赖：只支持 Playwright/浏览器截出来的 8-bit 非隔行 PNG
 * （灰度 / RGB / RGBA）。索引色、16-bit、隔行一律直接报错，不静默猜。
 * 退出码恒为 0（文件读不到除外）。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function decodePng(buf) {
  if (buf.length < 8 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('不是 PNG 文件');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG（interlace=1）');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += len + 12;
  }
  const channels = CHANNELS[colorType];
  if (depth !== 8 || !channels) {
    throw new Error(`只支持 8-bit 灰度/RGB/RGBA：bitDepth=${depth}, colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`未知 PNG 行过滤类型 ${filter}`);
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const lumaAt = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
};

function parseRect(raw, img) {
  if (!raw) {
    const w = Math.min(400, img.width);
    const h = Math.min(120, img.height);
    return { x: Math.floor((img.width - w) / 2), y: Math.floor((img.height - h) / 2), w, h };
  }
  const parts = raw.split(',').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('--rect 需要 x,y,w,h 四个整数');
  }
  const [x, y, w, h] = parts;
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > img.width || y + h > img.height) {
    throw new Error(`--rect 越界：图像 ${img.width}x${img.height}`);
  }
  return { x, y, w, h };
}

function meanLuma(img, x0, y0, w, h) {
  let sum = 0;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) sum += lumaAt(img, x, y);
  }
  return sum / (w * h);
}

function brightestPixel(img, rect) {
  let best = { x: rect.x, y: rect.y, l: -1 };
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const l = lumaAt(img, x, y);
      if (l > best.l) best = { x, y, l };
    }
  }
  return best;
}

/** 要点 4：8x8 patch 与其外 32x32 环形 annulus 的亮度差。 */
function patchAnnulus(img, center, rect) {
  const patchSize = 8;
  const outer = 32;
  const px0 = Math.max(rect.x, Math.round(center.x - patchSize / 2));
  const py0 = Math.max(rect.y, Math.round(center.y - patchSize / 2));
  const px1 = Math.min(rect.x + rect.w, px0 + patchSize);
  const py1 = Math.min(rect.y + rect.h, py0 + patchSize);
  const ox0 = Math.max(rect.x, Math.round(center.x - outer / 2));
  const oy0 = Math.max(rect.y, Math.round(center.y - outer / 2));
  const ox1 = Math.min(rect.x + rect.w, Math.round(center.x + outer / 2));
  const oy1 = Math.min(rect.y + rect.h, Math.round(center.y + outer / 2));

  let patchSum = 0;
  let patchN = 0;
  let annulusSum = 0;
  let annulusN = 0;
  const levels = new Set();
  for (let y = oy0; y < oy1; y += 1) {
    for (let x = ox0; x < ox1; x += 1) {
      const l = lumaAt(img, x, y);
      const inPatch = x >= px0 && x < px1 && y >= py0 && y < py1;
      if (inPatch) {
        patchSum += l;
        patchN += 1;
        levels.add(Math.round(l));
      } else {
        annulusSum += l;
        annulusN += 1;
      }
    }
  }
  const patch = patchN ? patchSum / patchN : 0;
  const annulus = annulusN ? annulusSum / annulusN : 0;
  return {
    patch,
    annulus,
    ratio: (patch - annulus) / 255,
    patchLevels: levels.size,
    patchBox: [px0, py0, px1 - px0, py1 - py0],
    annulusBox: [ox0, oy0, ox1 - ox0, oy1 - oy0],
  };
}

/** 要点 8：窗口内 5 条竖直扫描线的最大相邻灰度跳变、级数、标准差。 */
function gradientReadout(img, rect) {
  const columns = 5;
  const deltas = [];
  for (let i = 0; i < columns; i += 1) {
    const x = Math.min(rect.x + rect.w - 1, rect.x + Math.round(((i + 0.5) * rect.w) / columns));
    let prev = null;
    let maxDelta = 0;
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      const l = lumaAt(img, x, y);
      if (prev !== null) maxDelta = Math.max(maxDelta, Math.abs(l - prev));
      prev = l;
    }
    deltas.push({ x, maxDelta });
  }
  const levels = new Set();
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const l = lumaAt(img, x, y);
      levels.add(Math.round(l));
      sum += l;
      sumSq += l * l;
      n += 1;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const sorted = deltas.map((d) => d.maxDelta).sort((a, b) => a - b);
  return {
    columns: deltas,
    maxDelta: Math.max(...sorted),
    medianDelta: sorted[Math.floor(sorted.length / 2)],
    levels: levels.size,
    std,
  };
}

const fmt = (n, digits = 2) => Number(n).toFixed(digits);

const file = process.argv[2];
const rectArg = process.argv.find((arg) => arg.startsWith('--rect='))?.slice(7);
if (!file) {
  console.error('用法: node scripts/measure-design-readouts.mjs <截图.png> [--rect=x,y,w,h]');
  process.exit(2);
}

const img = decodePng(readFileSync(file));
const rect = parseRect(rectArg, img);
const center = brightestPixel(img, rect);
const p4 = patchAnnulus(img, center, rect);
const p8 = gradientReadout(img, rect);

console.log(`图像 ${img.width}x${img.height}  取样窗 ${rect.w}x${rect.h} @ (${rect.x},${rect.y})`);
console.log('阈值未钉，以下只报数，不判红绿。');
console.log('');
console.log('【要点 4｜发光靠压低周边】');
console.log(`  最亮像素        (${center.x},${center.y})  L=${fmt(center.l)}`);
console.log(`  patch 8×8       [${p4.patchBox.join(',')}]  meanL=${fmt(p4.patch)}  levels=${p4.patchLevels}`);
console.log(`  annulus 32×32   [${p4.annulusBox.join(',')}]  meanL=${fmt(p4.annulus)}`);
console.log(`  亮度差比值      ${fmt(p4.ratio, 3)}   （暂定阈值 0.18，未判定）`);
console.log('');
console.log('【要点 8｜大面积渐变】');
console.log(`  5 列最大跳变    ${p8.columns.map((c) => `x=${c.x}:${fmt(c.maxDelta, 1)}`).join('  ')}`);
console.log(`  全窗最大/中位   ${fmt(p8.maxDelta, 1)} / ${fmt(p8.medianDelta, 1)}   （暂定阈值 ≤2，未判定）`);
console.log(`  灰度级数        ${p8.levels}   （暂定阈值 ≥8，未判定）`);
console.log(`  灰度标准差      ${fmt(p8.std, 2)}   （暂定阈值 ≥4，未判定）`);
