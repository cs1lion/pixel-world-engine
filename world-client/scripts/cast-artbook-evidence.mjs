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
import { mkdirSync, writeFileSync } from 'node:fs';
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

function drawSpriteRects(look, facing) {
  return villagerLayout(look, facing, POSE, false, 'idle', 0).map((item) => ({
    x: item.x + VILLAGER_W / 2,
    y: item.y + VILLAGER_H,
    w: item.w,
    h: item.h,
    color: pixelColor(item, look),
  }));
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
<script>
  window.__draw = () => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const name = canvas.dataset.look;
      const facing = canvas.dataset.facing;
      canvas.width = ${VILLAGER_W};
      canvas.height = ${VILLAGER_H};
      canvas.style.width = '${VILLAGER_W * 3}px';
      canvas.style.height = '${VILLAGER_H * 3}px';
      const ctx = canvas.getContext('2d');
      for (const block of window.__SPRITES__[name][facing]) {
        ctx.fillStyle = block.color;
        ctx.fillRect(block.x, block.y, block.w, block.h);
      }
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
  await page.evaluate(() => window.__draw());
  await page.waitForTimeout(100);
  for (let i = 0; i < looks.length; i += 1) {
    await page.locator(`#char-${i}`).screenshot({
      path: join(OUT, `${looks[i].name}-front-side-back-x3.png`),
    });
  }
  await page.locator('#contact').screenshot({
    path: join(OUT, 'cast-contact-sheet-x3.png'),
    fullPage: false,
  });
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
  namelessEvidence: MAIN.map((name) => `${name}-front-side-back-x3.png`),
}, null, 2), 'utf8');

console.log(JSON.stringify({ out: OUT, minPair, characters }, null, 2));
