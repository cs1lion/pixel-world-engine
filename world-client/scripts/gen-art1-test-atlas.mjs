/**
 * 生成 `public/assets/art1/` 的内置测试图集与 manifest.json。
 *
 * 这是**程序化烘焙的 CC0 测试资产**（本脚本即作者，像素与配色全由代码确定
 * 性生成，无第三方素材、无版权遗留），用途是让 art1 图集管线在没有任何
 * 外部生图产出时也能跑通全链路：装载 → 查询 → 渲染 → 缺件回退。它不是
 * 视觉基准，只是链路验收的载体；真正的表现层图集以后整张热替换即可。
 *
 * 「高色深」体现在这里：每格用 8 位通道全量渐变与纹理点，色数远超 24 色板
 * 口径——表现层颜色不受 `audit-palette.mjs` 预算约束（art1/ 放行口径，
 * 见 `docs/adr/ADR_PRESENTATION_GATE_LAYERS.md`），这张图就是那条放行
 * 口径的活证据。
 *
 * 幂等：同输入同输出，可重复跑。
 *
 * 用法：`node scripts/gen-art1-test-atlas.mjs`
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ART1 = join(here, '..', 'public', 'assets', 'art1');

// ------------------------------------------------------------ 最小 PNG 编码器

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** rgba: Uint8Array(w*h*4)。输出合法 PNG（RGBA8、无隔行）。 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0; // filter: None
    rgba.copy(raw, y * (width + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ 确定性像素烘焙

/** mulberry32：测试图集要「每次生成都一样」，不靠 Math.random。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.w = cols * 16;
    this.h = rows * 16;
    this.px = Buffer.alloc(this.w * this.h * 4, 0);
  }
  set(col, row, x, y, r, g, b, a = 255) {
    const px = (row * 16 + y) * this.w * 4 + (col * 16 + x) * 4;
    this.px[px] = r; this.px[px + 1] = g; this.px[px + 2] = b; this.px[px + 3] = a;
  }
  /** 格内烘焙：基色 + 对角渐变 + 纹理点（高色深证据）。 */
  tile(col, row, base, seed) {
    const rand = rng(seed);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const shade = (x + y) / 32; // 对角渐变
        const jitter = rand() > 0.72 ? 18 : 0; // 纹理点
        this.set(
          col, row, x, y,
          Math.min(255, base[0] * (0.75 + shade * 0.5) + jitter),
          Math.min(255, base[1] * (0.75 + shade * 0.5) + jitter),
          Math.min(255, base[2] * (0.75 + shade * 0.5) + jitter),
        );
      }
    }
  }
}

// 地形 8 格 + 石板路 + 水体 2 + 海岸 2 = 12 格，落在 8x8 sheet 内。
const GROUND = [
  ['grass', [86, 148, 74]], ['stone', [138, 138, 150]], ['plaza', [196, 188, 172]],
  ['farm', [172, 152, 84]], ['tree', [52, 96, 62]], ['shallow', [94, 168, 196]],
  ['mud', [124, 96, 66]], ['coal', [58, 58, 66]],
  ['road', [168, 160, 146]], ['water-river', [58, 118, 196]], ['water-lake', [72, 138, 208]],
  ['shore-river', [118, 158, 176]], ['shore-lake', [128, 168, 186]], ['spare-1', [40, 40, 48]],
  ['spare-2', [48, 48, 56]], ['spare-3', [56, 56, 64]],
];

const ground = new Canvas(8, 8);
GROUND.forEach(([name, base], i) => ground.tile(i % 8, Math.floor(i / 8), base, 1000 + i));

// 建筑：12 栋 × back/body/front/roof 4 帧 = 48 格，落在 16x8 sheet 内。
const PREFABS = [
  'code_forge', 'star_archive', 'ink_house', 'workshop_plot', 'crawler_mine', 'ink_mill',
  'gear_tower', 'cottage_oak', 'cottage_plaster', 'cottage_stone', 'homestead_far', 'homestead_ridge',
];
const buildings = new Canvas(16, 8);
PREFABS.forEach((id, b) => {
  // 四层各有色相倾向：back 暗、body 主色、front 暖、roof 最高明度——
  // 测试图集只要格位可分辨即可，不追求美术。
  const hue = 180 + b * 22;
  const layers = [
    [hue, hue * 0.7, hue * 0.5],
    [hue * 0.9, hue * 0.55, hue * 0.35],
    [hue * 1.05, hue * 0.6, hue * 0.3],
    [Math.min(255, hue * 1.15), hue * 0.45, hue * 0.28],
  ];
  layers.forEach((base, f) => buildings.tile((b * 4 + f) % 16, Math.floor((b * 4 + f) / 16), base, 2000 + b * 4 + f));
});

// 村民：7 人 × 4 帧步态 = 28 格，落在 8x4 sheet 内。
const villagers = new Canvas(8, 4);
for (let v = 0; v < 7; v += 1) {
  for (let f = 0; f < 4; f += 1) {
    const phase = f / 4; // 步态相位：明暗交替即可分辨
    villagers.tile((v * 4 + f) % 8, Math.floor((v * 4 + f) / 8), [210 - phase * 60, 150 + phase * 40, 110], 3000 + v * 4 + f);
  }
}

// ------------------------------------------------------------ manifest

const manifest = {
  atlas: 'art1',
  version: 1,
  tile: { w: 16, h: 16 },
  sheets: {
    ground: { file: 'ground.png', tileWidth: 16, tileHeight: 16, columns: 8, rows: 8 },
    buildings: { file: 'buildings.png', tileWidth: 16, tileHeight: 16, columns: 16, rows: 8 },
    villagers: { file: 'villagers.png', tileWidth: 16, tileHeight: 16, columns: 8, rows: 4 },
  },
  ground: Object.fromEntries(GROUND.slice(0, 8).map(([name], i) => [name, i])),
  road: 8,
  water: { river: 9, lake: 10 },
  shore: { river: 11, lake: 12 },
  buildings: Object.fromEntries(
    PREFABS.map((id, b) => [id, { back: b * 4, body: b * 4 + 1, front: b * 4 + 2, roof: b * 4 + 3 }]),
  ),
  villagers: Object.fromEntries(
    Array.from({ length: 7 }, (_, v) => [`v${v}`, [v * 4, v * 4 + 1, v * 4 + 2, v * 4 + 3]]),
  ),
};

mkdirSync(ART1, { recursive: true });
writeFileSync(join(ART1, 'ground.png'), encodePng(ground.w, ground.h, ground.px));
writeFileSync(join(ART1, 'buildings.png'), encodePng(buildings.w, buildings.h, buildings.px));
writeFileSync(join(ART1, 'villagers.png'), encodePng(villagers.w, villagers.h, villagers.px));
writeFileSync(join(ART1, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `art1 test atlas baked: ${ground.w}x${ground.h}, ${buildings.w}x${buildings.h}, ${villagers.w}x${villagers.h} px; manifest written`,
);
