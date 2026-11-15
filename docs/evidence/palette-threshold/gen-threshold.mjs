#!/usr/bin/env node
/**
 * 可辨阈值色卡的生成器（可复跑）。
 *
 * 目的：把「相邻两段色带差多少才看得出来」固定成一组可复现的读数，
 * 以后判「这算不算读得出来」引用这张表，不靠肉眼碰运气。
 *
 * 方法（与 P1_SHORE_ROOTCAUSE.md §2.4 一致）：
 *   - 基色 = 灯潮界草色 #30454a（L* 27.79）；
 *   - 保持 a/b 不变，只把 L* 逐档加 ΔL* = 2/3/4/5/6/8/10/12；
 *   - 每行左右各 16×16 art px 平铺色块（左=基色，右=加档色），行高 16 px；
 *   - 整图 4× 最近邻放大（1 art px = 4 图内 px），输出 ramp-test-4x.png；
 *   - 同时输出 readings.json（每档的 hex、实际 L*、ΔL*、ΔE2000）。
 *
 * 复跑：
 *   node docs/evidence/palette-threshold/gen-threshold.mjs
 * 判读方式：在 4× 图上逐行看左右两块的边界——看不见 / 极弱缝 / 能指出分界 / 稳定可辨。
 * 这不是普适感知阈值，只保证「同一张卡、同一个人」可重复。
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReferencePairs,
  deltaE2000,
  hexToRgb,
  labToRgb,
  rgbToHex,
  rgbToLab,
} from './de2000.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_HEX = '#30454a';
const STEPS = [2, 3, 4, 5, 6, 8, 10, 12];
const BLOCK = 16;
const SCALE = 4;

assertReferencePairs();

// ------------------------------------------------------------------ PNG writer

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 3;
      const target = y * (width * 3 + 1) + 1 + x * 3;
      raw[target] = rgb[source];
      raw[target + 1] = rgb[source + 1];
      raw[target + 2] = rgb[source + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ build

const base = rgbToLab(hexToRgb(BASE_HEX));
const rows = STEPS.map((step) => {
  const shifted = labToRgb({ L: base.L + step, a: base.a, b: base.b });
  const lab = rgbToLab(shifted);
  return {
    deltaLTarget: step,
    hex: rgbToHex(shifted),
    L: Number(lab.L.toFixed(2)),
    a: Number(lab.a.toFixed(2)),
    b: Number(lab.b.toFixed(2)),
    deltaL: Number((lab.L - base.L).toFixed(2)),
    deltaE2000: Number(deltaE2000(base, lab).toFixed(2)),
  };
});

const artWidth = BLOCK * 2;
const artHeight = BLOCK * rows.length;
const width = artWidth * SCALE;
const height = artHeight * SCALE;
const pixels = Buffer.alloc(width * height * 3);
const baseRgb = hexToRgb(BASE_HEX);

for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
  const shifted = hexToRgb(rows[rowIndex].hex);
  for (let y = 0; y < BLOCK * SCALE; y += 1) {
    for (let x = 0; x < artWidth * SCALE; x += 1) {
      const color = x < BLOCK * SCALE ? baseRgb : shifted;
      const target = ((rowIndex * BLOCK * SCALE + y) * width + x) * 3;
      pixels[target] = color.r;
      pixels[target + 1] = color.g;
      pixels[target + 2] = color.b;
    }
  }
}

const readings = {
  base: BASE_HEX,
  baseLab: {
    L: Number(base.L.toFixed(2)),
    a: Number(base.a.toFixed(2)),
    b: Number(base.b.toFixed(2)),
  },
  method: {
    blockArtPx: BLOCK,
    scale: SCALE,
    rows: rows.length,
    outputPx: { width, height },
    direction: '保持 a/b 不变，只加 L*',
  },
  rows,
};

writeFileSync(path.join(HERE, 'ramp-test-4x.png'), encodePng(width, height, pixels));
writeFileSync(path.join(HERE, 'readings.json'), `${JSON.stringify(readings, null, 2)}\n`);
console.log(JSON.stringify(readings, null, 2));
