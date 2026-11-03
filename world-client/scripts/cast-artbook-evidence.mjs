/**
 * 设定集主要人物的像素证据：
 *   - 每人一张 3× 近景（正/侧/背），图上不写名字，供 1 秒遮名测试；
 *   - 一张写名字的对照表，供人物→页码核对；
 *   - readings.json：ΔE76 最小对差、剪影签名、包围盒。
 *
 * 像素直接来自 `villagerLayout()`，与游戏内是同一份分层数据；
 * 只是把它们按 24×30 画到 canvas，再用 CSS 放大 3 倍（最近邻）。
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DENGCHAO_CAST_ARTBOOK, DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { loadSettingPack } from '../src/settings/load.ts';
import { resolveLook } from '../src/world/villager-look.ts';
import {
  VILLAGER_H,
  VILLAGER_W,
  silhouetteOf,
  silhouetteSignature,
  villagerLayout,
} from '../src/render/villager-layout.ts';
import {
  facingSilhouettes,
  pairwiseSilhouettes,
  silhouetteBreakdown,
  silhouetteMask,
  silhouetteSimilarity,
} from '../src/render/silhouette-match.ts';
import {
  CAST_MOTION_FRAMES,
  CAST_MOTION_VIEWS,
  castFrameMask,
  castFramePixels,
  castFrameRects,
  framePixelDiff,
  maxRowWidthDelta,
} from '../src/render/cast-motion.ts';
import { ANIM_FPS, FRAME_MS } from '../src/render/villager-frames.ts';

const MAIN = ['迷路人', '汐', '炉匠', '沉灯夫人', '灯笼头'];
const OUT = resolve(import.meta.dirname, '..', '..', 'docs', 'evidence', 'cast-artbook');
const pack = loadSettingPack(DENGCHAO_RAW);
const POSE = { frame: 0, frameCount: 2, offsetY: 0, footLeft: 0, footRight: 0 };

function rgbToLab(value) {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const linear = [r, g, b].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

function deltaE76(a, b) {
  const left = rgbToLab(a);
  const right = rgbToLab(b);
  return Math.hypot(left.L - right.L, left.a - right.a, left.b - right.b);
}

function pixelColor(item, look) {
  const role = {
    base: look.cloak,
    shade: look.cloakDark,
    hair: look.hair,
    scarf: look.scarf,
    scarfLit: look.scarfLit,
  };
  const token = role[item.paint] ?? item.paint;
  const value = pack.palette[token];
  if (value === undefined) throw new Error(`没有色 ${token}`);
  return `#${value.toString(16).padStart(6, '0')}`;
}

function blocksOf(look, rects) {
  return rects.map((item) => ({
    x: item.x + VILLAGER_W / 2,
    y: item.y + VILLAGER_H,
    w: item.w,
    h: item.h,
    color: pixelColor(item, look),
  }));
}

function drawSpriteRects(look, facing) {
  return blocksOf(look, villagerLayout(look, facing, POSE, false, 'idle', 0));
}

const looks = MAIN.map((name) => {
  const villager = pack.villagers.find((item) => item.name === name);
  if (villager === undefined) throw new Error(`缺少 ${name}`);
  return { name, look: resolveLook(villager.style) };
});

const pairReadings = [];
for (let i = 0; i < looks.length; i += 1) {
  for (let j = i + 1; j < looks.length; j += 1) {
    pairReadings.push({
      a: looks[i].name,
      b: looks[j].name,
      deltaE: deltaE76(pack.palette[looks[i].look.cloak], pack.palette[looks[j].look.cloak]),
    });
  }
}
const minPair = pairReadings.reduce((min, item) => (item.deltaE < min.deltaE ? item : min));
const silhouettePairs = pairwiseSilhouettes(looks);
const samePersonFacings = looks.map(({ name, look }) => ({ name, readings: facingSilhouettes(look) }));
const maxSameFacing = silhouettePairs.reduce((max, item) => (item.similarity > max.similarity ? item : max));
const maxPairLooks = {
  a: looks.find((item) => item.name === maxSameFacing.a).look,
  b: looks.find((item) => item.name === maxSameFacing.b).look,
};
const maxPairBreakdown = silhouetteBreakdown(
  silhouetteMask(maxPairLooks.a, maxSameFacing.facing),
  silhouetteMask(maxPairLooks.b, maxSameFacing.facing),
);
const characters = looks.map(({ name, look }) => {
  const silhouette = silhouetteOf(look);
  const nearest = pairReadings
    .filter((pair) => pair.a === name || pair.b === name)
    .reduce((min, item) => (item.deltaE < min.deltaE ? item : min));
  return {
    name,
    design: `${look.build}/${look.head}/${look.outfit}/${look.accent}`,
    artbook: DENGCHAO_CAST_ARTBOOK[name],
    deltaEToNearest: Number(nearest.deltaE.toFixed(1)),
    nearest: nearest.a === name ? nearest.b : nearest.a,
    silhouetteSignature: silhouetteSignature(look),
    bboxW: silhouette.bboxW,
    bboxH: silhouette.bboxH,
    profile: silhouette.profile,
  };
});

// 改前读数（8942032）单独存成 baseline，脚本只读不写；这里拼成 30 组的逐对前后表。
const baselinePath = join(OUT, 'silhouette-baseline.json');
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : { pairs: [], samePerson: [] };
const beforeMap = new Map(
  baseline.pairs.map((pair) => [`${pair.a}|${pair.b}|${pair.facing}`, pair.similarity]),
);
const beforeAfter = silhouettePairs.map((pair) => ({
  ...pair,
  before: beforeMap.get(`${pair.a}|${pair.b}|${pair.facing}`) ?? null,
  delta: beforeMap.has(`${pair.a}|${pair.b}|${pair.facing}`)
    ? Number((pair.similarity - beforeMap.get(`${pair.a}|${pair.b}|${pair.facing}`)).toFixed(3))
    : null,
}));
const worstBefore = baseline.pairs.reduce(
  (max, pair) => (pair.similarity > max.similarity ? pair : max),
  { similarity: -1 },
);

// ── 第四轮「动起来」：逐帧帧差、行宽变化、动画帧剪影复测 ────────────────────
const FRAME_TAGS = [
  { tag: 'idle0', walking: false, index: 0 },
  { tag: 'idle1', walking: false, index: 1 },
  { tag: 'walk0', walking: true, index: 0 },
  { tag: 'walk1', walking: true, index: 1 },
  { tag: 'walk2', walking: true, index: 2 },
  { tag: 'walk3', walking: true, index: 3 },
];
const motionFrameDiff = looks.map(({ name, look }) => ({
  name,
  views: CAST_MOTION_VIEWS.map((facing) => {
    const pics = (walking, index) => castFramePixels(look, facing, walking, index);
    const base = castFrameMask(look, facing, false, 0);
    let worstRow = { row: -1, delta: 0 };
    for (const { walking, index } of FRAME_TAGS) {
      const delta = maxRowWidthDelta(base, castFrameMask(look, facing, walking, index));
      if (delta.delta > worstRow.delta) worstRow = delta;
    }
    return {
      facing,
      idle: framePixelDiff(pics(false, 0), pics(false, 1)),
      walk: [0, 1, 2].map((index) => framePixelDiff(pics(true, index), pics(true, index + 1))),
      walkFar: framePixelDiff(pics(true, 0), pics(true, 2)),
      maxRowWidthDelta: worstRow.delta,
      row: worstRow.row,
    };
  }),
}));

const motionPairs = [];
for (const { tag, walking, index } of FRAME_TAGS) {
  for (const facing of CAST_MOTION_VIEWS) {
    for (let i = 0; i < looks.length; i += 1) {
      for (let j = i + 1; j < looks.length; j += 1) {
        motionPairs.push({
          tag,
          a: looks[i].name,
          b: looks[j].name,
          facing,
          similarity: Number(silhouetteSimilarity(
            castFrameMask(looks[i].look, facing, walking, index),
            castFrameMask(looks[j].look, facing, walking, index),
          ).toFixed(4)),
        });
      }
    }
  }
}
const motionWorstPair = motionPairs.reduce((max, item) => (item.similarity > max.similarity ? item : max));
const motionSamePerson = looks.map(({ name, look }) => {
  let min = { similarity: 2, tag: '', a: '', b: '' };
  let max = { similarity: -1, tag: '', a: '', b: '' };
  for (const { tag, walking, index } of FRAME_TAGS) {
    const masks = new Map(CAST_MOTION_VIEWS.map((view) => [view, castFrameMask(look, view, walking, index)]));
    for (const [a, b] of [['down', 'right'], ['down', 'up'], ['right', 'up']]) {
      const item = { similarity: Number(silhouetteSimilarity(masks.get(a), masks.get(b)).toFixed(4)), tag, a, b };
      if (item.similarity < min.similarity) min = item;
      if (item.similarity > max.similarity) max = item;
    }
  }
  return { name, min, max };
});
const motionSprites = {};
for (const { name, look } of looks) {
  motionSprites[name] = {};
  for (const facing of CAST_MOTION_VIEWS) {
    motionSprites[name][facing] = {
      walk: [0, 1, 2, 3].map((index) => blocksOf(look, castFrameRects(look, facing, true, index))),
      idle: [0, 1].map((index) => blocksOf(look, castFrameRects(look, facing, false, index))),
    };
  }
}
const motionSheets = [
  ...CAST_MOTION_VIEWS.map((facing) => ({ id: `motion-walk-${facing}`, kind: 'walk', facing, title: `行走 4 帧 · ${({ down: '正面', right: '侧面', up: '背面' })[facing]}`, count: 4 })),
  { id: 'motion-idle-down', kind: 'idle', facing: 'down', title: '待机 2 帧 · 正面', count: 2 },
];

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #e9e5db; color: #23201b; font: 12px/1.4 "Microsoft YaHei", sans-serif; }
  .sheet { padding: 18px 20px 24px; }
  .char { display: inline-flex; gap: 14px; align-items: flex-end; padding: 10px 12px 6px; margin: 0 8px 12px 0; background: #e9e5db; }
  .cell { text-align: center; }
  canvas { display: block; width: ${VILLAGER_W * 3}px; height: ${VILLAGER_H * 3}px; image-rendering: pixelated; background: #f6f2e8; border: 1px solid #c9c1b0; }
  .dir { margin-top: 5px; color: #6c665a; letter-spacing: 0.08em; }
  .contact { border-collapse: collapse; }
  .contact td, .contact th { padding: 10px 14px; border-bottom: 1px solid #d2cab9; text-align: left; vertical-align: middle; }
  .contact th { color: #6c665a; font-weight: 500; }
  .contact h2 { margin: 0 0 4px; font-size: 15px; }
  .contact small { color: #6c665a; }
  .contact .sprites { display: flex; gap: 12px; }
  .frameRow { display: flex; align-items: flex-end; gap: 10px; margin: 0 0 10px; }
  .frameRow .who { width: 64px; color: #6c665a; }
  .sheet h2 { margin: 0 0 10px; font-size: 15px; }
</style></head>
<body>
<div class="sheet" id="nameless">
  ${looks.map(({ name, look }, index) => `<div class="char" id="char-${index}">
    ${['down', 'right', 'up'].map((facing, i) => `<div class="cell"><canvas data-look="${name}" data-facing="${facing}"></canvas><div class="dir">${['正面', '侧面', '背面'][i]}</div></div>`).join('')}
  </div>`).join('')}
</div>
<div class="sheet" id="contact">
  <h2>灯潮界主要人物 · 设定集对照（3× 像素近景，名字仅在本图出现）</h2>
  <table class="contact"><thead><tr><th>人物</th><th>三向</th><th>设定集</th><th>造型事实</th></tr></thead><tbody>
  ${looks.map(({ name, look }) => {
    const ref = DENGCHAO_CAST_ARTBOOK[name];
    return `<tr><td><h2>${name}</h2><small>${look.build}/${look.head}/${look.outfit}/${look.accent}</small></td>
      <td><div class="sprites">${['down', 'right', 'up'].map((facing) => `<canvas data-look="${name}" data-facing="${facing}"></canvas>`).join('')}</div></td>
      <td>PDF p.${ref.pdfPages.join(', ')}<br><small>书页 ${ref.bookPages.join(' / ')}</small></td>
      <td>${ref.notes.join('<br>')}</td></tr>`;
  }).join('')}
  </tbody></table>
</div>
${motionSheets.map((sheet) => `<div class="sheet" id="${sheet.id}">
  <h2>${sheet.title}（3× 放大，每人一行 ${sheet.count} 列）</h2>
  ${looks.map(({ name }) => `<div class="frameRow"><span class="who">${name}</span>${Array.from({ length: sheet.count }, (_, index) => `<div class="cell"><canvas data-motion="${name}" data-facing="${sheet.facing}" data-kind="${sheet.kind}" data-index="${index}"></canvas><div class="dir">${index + 1}/${sheet.count}</div></div>`).join('')}</div>`).join('')}
</div>`).join('')}
<script>
  window.__draw = () => {
    const paint = (canvas, blocks) => {
      canvas.width = ${VILLAGER_W};
      canvas.height = ${VILLAGER_H};
      canvas.style.width = '${VILLAGER_W * 3}px';
      canvas.style.height = '${VILLAGER_H * 3}px';
      const ctx = canvas.getContext('2d');
      for (const block of blocks) {
        ctx.fillStyle = block.color;
        ctx.fillRect(block.x, block.y, block.w, block.h);
      }
    };
    for (const canvas of document.querySelectorAll('canvas[data-look]')) {
      paint(canvas, window.__SPRITES__[canvas.dataset.look][canvas.dataset.facing]);
    }
    for (const canvas of document.querySelectorAll('canvas[data-motion]')) {
      paint(
        canvas,
        window.__FRAMES__[canvas.dataset.motion][canvas.dataset.facing][canvas.dataset.kind][Number(canvas.dataset.index)],
      );
    }
  };
</script>
</body></html>`;

const sprites = {};
for (const { name, look } of looks) {
  sprites[name] = {};
  for (const facing of ['down', 'right', 'up']) {
    sprites[name][facing] = drawSpriteRects(look, facing);
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate((payload) => { window.__SPRITES__ = payload; }, sprites);
  await page.evaluate((payload) => { window.__FRAMES__ = payload; }, motionSprites);
  await page.evaluate(() => window.__draw());
  await page.waitForTimeout(100);
  for (let i = 0; i < looks.length; i += 1) {
    await page.locator(`#char-${i}`).screenshot({
      path: join(OUT, `main-${String(i + 1).padStart(2, '0')}-front-side-back-x3.png`),
    });
  }
  await page.locator('#contact').screenshot({
    path: join(OUT, 'cast-contact-sheet-x3.png'),
    fullPage: false,
  });
  for (const sheet of motionSheets) {
    await page.locator(`#${sheet.id}`).screenshot({ path: join(OUT, `${sheet.id}-x3.png`) });
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT, 'readings.json'), JSON.stringify({
  canvas: `${VILLAGER_W}x${VILLAGER_H}`,
  zoom: 3,
  main: MAIN,
  minPair: { ...minPair, deltaE: Number(minPair.deltaE.toFixed(1)) },
  silhouetteClasses: new Set(characters.map((item) => item.silhouetteSignature)).size,
  characters,
  // 30 组同向两两读数：before 来自 8942032 的 baseline，after 是本次重画后的实测。
  silhouettePairs: beforeAfter,
  worstBefore,
  samePersonBefore: baseline.samePerson,
  samePersonFacings,
  maxSameFacing: { ...maxSameFacing, breakdown: maxPairBreakdown },
  // 遮名测试的盲号：图里不写名字，文件名也只有编号；对照表另存这张 key。
  blindKey: Object.fromEntries(
    MAIN.map((name, index) => [`main-${String(index + 1).padStart(2, '0')}`, name]),
  ),
  namelessEvidence: MAIN.map((_, index) => `main-${String(index + 1).padStart(2, '0')}-front-side-back-x3.png`),
  // 第四轮「动起来」：帧数、逐帧像素差、行宽变化、动画帧复测表。
  motion: {
    animFps: ANIM_FPS,
    frameMs: Number(FRAME_MS.toFixed(3)),
    idleFrames: CAST_MOTION_FRAMES.idle,
    walkFrames: CAST_MOTION_FRAMES.walk,
    views: [...CAST_MOTION_VIEWS],
    frameDiffMetric: 'structural（减掉姿态里的 1px 整体上下浮，只数帧内动作变动的格子）',
    frameDiff: motionFrameDiff,
    // 30 组跨人复测：同一 world step（同帧号）下 3 向 × 6 帧 × 10 对。
    retest: {
      tags: FRAME_TAGS.map((item) => item.tag),
      maxPairSimilarity: 0.78,
      samePersonRange: [0.6, 0.9],
      worstPair: motionWorstPair,
      pairs: motionPairs,
      samePerson: motionSamePerson,
      staticPairsUnchanged: beforeAfter.map((pair) => ({
        a: pair.a,
        b: pair.b,
        facing: pair.facing,
        similarity: pair.similarity,
      })),
    },
    sheets: motionSheets.map((sheet) => ({
      id: sheet.id,
      facing: sheet.facing,
      kind: sheet.kind,
      columns: sheet.count,
      file: `${sheet.id}-x3.png`,
    })),
  },
}, null, 2), 'utf8');

console.log(JSON.stringify({ out: OUT, minPair, maxSameFacing, characters }, null, 2));
