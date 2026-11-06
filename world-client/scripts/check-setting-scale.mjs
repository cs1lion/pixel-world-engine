#!/usr/bin/env node
/**
 * 尺度的证据脚本：同一机位、同一冻结帧，拍店面墙、街灯柱与一个人的实际像素，
 * 再把「墙 / 人 / 柱」三把标尺画在图上，并附像素扫描读数。
 *
 * 为什么读数要看像素而不只看常量：常量和画法可能各自都对，但叠在一起读错
 * （例如墙顶抬了 16px、石脚却跟着上移）。扫描直接从截图里量：
 *   - 灰泥连续段的高度（plaster）；
 *   - 石脚连续段的高度（stone）；
 *   - 灯柱在灯体以下那段连续涂装的高度。
 * 常量读数也一并给出，两者能对上才算数。
 *
 * 拍「改前」：先 `git stash` 掉 `src/` 的改动（脚本与单测是未跟踪文件，不受影响），
 * 用 HEAD 的旧尺度拍，再 `git stash pop` 拍「改后」。同一支脚本、同一机位，
 * 两张图只差尺度这一件事。
 *
 * 跑法：
 *   cd world-client && npm run dev
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ SCALE_LABEL=before node scripts/check-setting-scale.mjs
 *   # 恢复改动后
 *   SCALE_LABEL=after node scripts/check-setting-scale.mjs
 *
 * 改后那一跑发现 before / after 都在，会额外合成并排图 `setting-scale.png`。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = process.env.EVAL_OUT ?? resolve(import.meta.dirname, '..', 'eval', 'screens');
const LABEL = process.env.SCALE_LABEL ?? 'after';
mkdirSync(OUT, { recursive: true });

/** 冻结帧：与光池证据同一口径，随机数与时间都锁在帧号上。 */
const FREEZE_AT = 180;
const PIN_AT = 100;

/** 机位：正对 shopfront_mid（576..624）与 lamp_post_7（624），人站在两者前面。 */
const CAMERA = { x: 600, y: 425 };
const ZOOM = 2;
/** 店面：`shopfront_mid` at (36,27)；落地线 = 27*16 + 32 = 464。 */
const SHOP = { x: 576, base: 464, id: 'shopfront_mid' };
/** 街灯：`lamp_post_7` at (39,27)；柱脚 = 27*16 + 16 = 448。 */
const LAMP = { x: 624, base: 448, id: 'lamp_post_7' };
/** 扫描列：店面左木框（`x .. x+2`，从墙顶连续涂到石脚底边，量到的就是墙高）。 */
const SCAN_SHOP_X = 577;
/** 扫描列：灯柱本体（`x + 7 .. x + 9`），两个人都不站在这两列上。 */
const SCAN_LAMP_X = 632;
/** 石脚扫描列：色带只有 4px，且不在木框、门、窗、招牌上。 */
const SCAN_STONE_X = 578;

/** 主角钉在店面正前方（第 28 行，脚底与石脚底边同一条线 464）。 */
const HERO = '沉灯夫人';
const HERO_CELL = { x: 37, y: 28 };
/** 第二个人钉在第 27 行（脚底与柱脚同一条线 448），站在灯柱左边一格，不遮灯柱。 */
const UNDER_LAMP_CELL = { x: 38, y: 27 };

/**
 * 改前的尺度（HEAD 上没有 `debugSettingScale` 这个口子，用这份基线常量画标尺）。
 * `lampBodyBottom` 取 24 而不是旧代码注释里的 25：旧画法把灯体底下的 1px `ink`
 * 衬线画在灯体外面，25 量的是衬线的下边、净空其实只有 24；新画法把衬线收进
 * 灯体最后一格，43 就是净空。以扫描为准，两图同一口径。
 */
const BEFORE = { personH: 30, shopfrontH: 32, shopfrontTop: 0, lampPostH: 37, lampBodyBottom: 24 };

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
      if (state.frame >= freezeAt) {
        state.frozen = true;
        cb(state.frame * frameMs);
        return;
      }
      cb(state.frame * frameMs);
    });
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(initScript, { freezeAt: FREEZE_AT });
await page.goto(`${BASE}?world=dengchao&time=noon&feed=off&ledger=off`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });

const canvas = page.locator('canvas').first();
await canvas.waitFor();
const box = await canvas.boundingBox();
if (box === null) throw new Error('找不到 canvas');

await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let step = 0; step < 4; step += 1) {
  if ((await page.evaluate(() => window.Oracle.camera().zoom)) >= ZOOM) break;
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(160);
}
await page.evaluate(([x, y]) => window.Oracle.centerCameraOn(x, y), [CAMERA.x, CAMERA.y]);

await page.waitForFunction((n) => window.__CAPTURE_STATE__.frame >= n, PIN_AT, { timeout: 30000 });
/** 摆位：主角在店面正前、第二个在灯柱正下，其余人钉到画面外。 */
const pins = await page.evaluate(({ hero, heroCell, lampCell }) => {
  const villagers = window.Oracle.view().villagers;
  const second = villagers.find((villager) => villager.name !== hero);
  const out = {};
  for (const villager of villagers) {
    const cell = villager.name === hero
      ? heroCell
      : (second !== undefined && villager.id === second.id ? lampCell : { x: 2, y: 2 });
    out[villager.name] = window.Oracle.debugPinVillager(villager.id, cell);
  }
  return { hero: out[hero], underLamp: second === undefined ? null : out[second.name], second: second?.name };
}, { hero: HERO, heroCell: HERO_CELL, lampCell: UNDER_LAMP_CELL });
await page.waitForFunction(() => window.__CAPTURE_STATE__.frozen === true, null, { timeout: 20000 });
await page.waitForTimeout(300);

const cam = await page.evaluate(() => window.Oracle.camera());
const stats = await page.evaluate(() => window.Oracle.renderStats());
/** 改后的渲染常量读数；HEAD 没有这个口子时退回基线常量。 */
const metrics = await page.evaluate(() => window.Oracle.debugSettingScale?.() ?? null);

const clip = { x: box.x + box.width / 2 - 240, y: box.y + box.height / 2 - 160, width: 480, height: 320 };
const file = join(OUT, `setting-scale-${LABEL}.png`);
await page.screenshot({ path: file, clip });

/** 把 PNG 还给浏览器解码，取样与扫描都在同一页做，别在 node 里自己解 PNG。 */
const reader = await browser.newPage();
const buf = readFileSync(file);
const b64 = buf.toString('base64');
const scanned = await reader.evaluate(async ({ b64, columns, metricsDriven }) => {
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
  if (ctx === null) throw new Error('没有 2d 上下文');
  ctx.drawImage(image, 0, 0);
  const px = (x, y) => ctx.getImageData(x, y, 1, 1).data;
  const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
  /** 从 `fromRow` 向上数连续等于 `ref` 的像素，返回世界像素（4 图中像素 = 1 世界像素）。 */
  const run = (x, fromRow, ref) => {
    let count = 0;
    for (let y = fromRow; y >= 0; y -= 1) {
      if (near(px(x, y), ref, 6)) count += 1;
      else break;
    }
    return count / 4;
  };
  const frameRef = px(columns.frameX, columns.frameRefRow);
  const stoneRef = px(columns.stoneX, columns.stoneRow);
  const postRef = px(columns.lampX, columns.postRow);
  return {
    frameH: run(columns.frameX, columns.frameRow, frameRef),
    stoneH: run(columns.stoneX, columns.stoneRow, stoneRef),
    /** 柱脚到灯体下沿的连续涂装：灯体挂在柱顶，这一段是全高里「人能不能顶到」的那一截。 */
    bodyBottomH: run(columns.lampX, columns.postRow, postRef),
    refs: { frame: [...frameRef].slice(0, 3), stone: [...stoneRef].slice(0, 3), post: [...postRef].slice(0, 3) },
    metricsDriven,
  };
}, {
  b64,
  metricsDriven: metrics !== null,
  /** 世界像素 → 截图中像素：`(wy - worldViewY) * 2 * zoom - 160`；扫描从该像素的底行起。 */
  columns: {
    frameX: Math.round((SCAN_SHOP_X - cam.worldViewX) * 2 * ZOOM - 240),
    frameRow: Math.round((464 - cam.worldViewY) * 2 * ZOOM - 160) - 1,
    frameRefRow: Math.round((454 - cam.worldViewY) * 2 * ZOOM - 160),
    stoneX: Math.round((SCAN_STONE_X - cam.worldViewX) * 2 * ZOOM - 240),
    stoneRow: Math.round((464 - cam.worldViewY) * 2 * ZOOM - 160) - 1,
    lampX: Math.round((SCAN_LAMP_X - cam.worldViewX) * 2 * ZOOM - 240),
    postRow: Math.round((448 - cam.worldViewY) * 2 * ZOOM - 160) - 1,
  },
});
await reader.close();
await page.close();
await browser.close();

const scale = metrics ?? BEFORE;
const result = {
  label: LABEL,
  file,
  cam,
  zoom: ZOOM,
  clip,
  stats,
  metrics,
  metricsSource: metrics === null ? 'HEAD 基线常量（无 debugSettingScale）' : '渲染常量 setting-scale.ts',
  pins,
  scanned,
  errors,
  ancient: BEFORE,
};
writeFileSync(
  join(OUT, `setting-scale-${LABEL}.json`),
  // 落盘时不写本机绝对路径，换成仓库内的相对位置。
  `${JSON.stringify({ ...result, file: `eval/screens/setting-scale-${LABEL}.png` }, null, 2)}\n`,
);

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
console.log(`[${LABEL}] 机位 (${CAMERA.x}, ${CAMERA.y}) zoom ${cam.zoom} view ${cam.worldViewX},${cam.worldViewY}`);
console.log(`  常量：墙 ${scale.shopfrontH}（顶抬 ${scale.shopfrontTop}）/ 人 ${scale.personH} / 柱 ${scale.lampPostH} / 灯体下沿 ${scale.lampBodyBottom}`);
console.log(`  扫描：木框立柱 ${fmt(scanned.frameH)}（= 墙高）/ 石脚 ${fmt(scanned.stoneH)} / 柱脚→灯体下沿 ${fmt(scanned.bodyBottomH)}`);
console.log(`  指令 ${stats.totalCommands} / Graphics ${stats.graphicsObjects}`);
console.log(`  图 ${file}${errors.length === 0 ? '' : `（页面错误：${errors.join('; ')}）`}`);

// ---------------------------------------------------------------- 合成并排图

const beforeFile = join(OUT, 'setting-scale-before.png');
const afterFile = join(OUT, 'setting-scale-after.png');
if (existsSync(beforeFile) && existsSync(afterFile)) {
  const load = (label) => {
    const json = JSON.parse(readFileSync(join(OUT, `setting-scale-${label}.json`), 'utf8'));
    const fallback = json.metrics ?? json.ancient;
    return { ...json, file: join(OUT, `setting-scale-${label}.png`), scale: fallback };
  };
  const shots = { before: load('before'), after: load('after') };

  const c2 = await chromium.launch({ headless: true });
  const compose = await c2.newPage({ viewport: { width: 1440, height: 720 }, deviceScaleFactor: 2 });
  const encode = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  /** 世界像素 → 合成页里的图中像素：原图 480×320 按 1:1 显示，故每世界像素仍是 4 图中像素。 */
  const at = (shot, wx, wy) => ({
    x: (wx - shot.cam.worldViewX) * 2 * ZOOM - 240,
    y: (wy - shot.cam.worldViewY) * 2 * ZOOM - 160,
  });
  /** 显示尺寸：480×320 原图缩到 480×320 的 1:1，标尺与图同尺。 */
  const W = 480;
  const H = 320;
  const bracket = (x, yTop, yBottom, label, color = '#f4d596') => `
    <div class="bracket" style="left:${x}px;top:${yTop}px;height:${Math.max(1, yBottom - yTop)}px;color:${color}">
      <span>${label}</span>
    </div>`;
  const ruler = (shot) => {
    const s = shot.scale;
    const shopTop = at(shot, SHOP.x, SHOP.base - s.shopfrontH).y;
    const shopBase = at(shot, SHOP.x, SHOP.base).y;
    const lampTop = at(shot, LAMP.x + 8, LAMP.base - s.lampPostH).y;
    const lampBase = at(shot, LAMP.x + 8, LAMP.base).y;
    const bodyY = at(shot, LAMP.x + 8, LAMP.base - s.lampBodyBottom).y;
    const hero = shot.pins.hero ?? { x: HERO_CELL.x * 16 + 8, y: (HERO_CELL.y + 1) * 16, h: s.personH };
    const heroFoot = at(shot, 0, hero.y).y;
    return [
      bracket(at(shot, SHOP.x, 0).x - 10, shopTop, shopBase, `墙 ${s.shopfrontH}`),
      bracket(at(shot, hero.x, 0).x - 14, heroFoot - (hero.h ?? s.personH) * 4, heroFoot, `人 ${hero.h ?? s.personH}`, '#9fd0ff'),
      bracket(at(shot, LAMP.x + 8, 0).x + 10, lampTop, lampBase, `柱 ${s.lampPostH}`),
      `<div class="hline" style="left:${at(shot, LAMP.x - 4, 0).x}px;top:${bodyY}px;width:26px"></div>`,
    ].join('');
  };
  const card = (shot, title, note) => `
    <figure>
      <div class="frame" style="width:${W}px;height:${H}px">
        <img src="${encode(shot.file)}" style="width:${W}px;height:${H}px" />
        ${ruler(shot)}
      </div>
      <figcaption><b>${title}</b><br />${note}</figcaption>
    </figure>`;

  const ratio = (s) => (s.shopfrontH / s.personH).toFixed(2);
  const postRatio = (s) => (s.lampPostH / s.personH).toFixed(2);
  const readings = (shot) => {
    const s = shot.scale;
    const scan = shot.scanned;
    return `
      <tr><td>店面墙</td><td>${fmt(scan.frameH)} px（左木框连续涂装，到石脚底边）</td>
          <td>${s.shopfrontH} px（顶抬 ${s.shopfrontTop}）</td>
          <td>${ratio(shot.scale)}×</td></tr>
      <tr><td>其中石脚</td><td>${fmt(scan.stoneH)} px</td><td>4 px</td><td>落地线 y+32</td></tr>
      <tr><td>人</td><td>${shot.pins.hero?.h ?? s.personH} px</td><td>${s.personH} px</td><td>分母</td></tr>
      <tr><td>街灯柱</td><td>全高被灯体遮住，像素量不到；柱脚→灯体下沿见下行</td><td>${s.lampPostH} px</td><td>${postRatio(shot.scale)}×</td></tr>
      <tr><td>灯体下沿</td><td>${fmt(scan.bodyBottomH)} px（柱脚起连续涂装）</td><td>${s.lampBodyBottom} px</td><td>${s.lampBodyBottom - s.personH > 0 ? `+${s.lampBodyBottom - s.personH} vs 头顶` : `${s.lampBodyBottom - s.personH} vs 头顶`}</td></tr>`;
  };

  await compose.setContent(
    `<!doctype html><meta charset="utf-8" />
     <style>
       body { margin: 0; background: #0f1216; color: #d8dad3;
              font: 13px/1.6 "Microsoft YaHei", "Noto Sans SC", sans-serif; }
       h1 { font-size: 15px; margin: 16px 20px 4px; font-weight: 600; }
       p.note { margin: 0 20px 12px; color: #8b9691; }
       main { display: flex; gap: 18px; padding: 0 20px 20px; align-items: flex-start; }
       figure { margin: 0; }
       .frame { position: relative; }
       img { image-rendering: pixelated; border: 1px solid #2a3138; display: block; }
       .bracket { position: absolute; width: 0; border-left: 1px solid currentColor; }
       .bracket::before, .bracket::after { content: ""; position: absolute; left: -4px; width: 9px; height: 1px; background: currentColor; }
       .bracket::before { top: 0; }
       .bracket::after { bottom: 0; }
       .bracket span { position: absolute; left: -10px; top: 50%; transform: translate(-100%, -50%);
                       white-space: nowrap; font-size: 11px; color: #e9ece6;
                       background: rgba(15,18,22,.82); padding: 0 3px; }
       .hline { position: absolute; border-top: 1px dashed #f4d596; }
       figcaption { padding-top: 6px; color: #c9d1cc; }
       b { color: #f4d596; font-weight: 600; }
       table { border-collapse: collapse; font-size: 12px; }
       td, th { border-bottom: 1px solid #2a3138; padding: 4px 8px; text-align: left; }
       th { color: #8b9691; font-weight: 500; }
       .panel { border: 1px solid #2a3138; padding: 8px 10px; margin-bottom: 12px; }
     </style>
     <h1>灯潮界立面尺度：改前 / 改后，同一机位、同一冻结帧</h1>
     <p class="note">
       机位正对 shopfront_mid 与 lamp_post_7（世界 ${CAMERA.x}, ${CAMERA.y}，zoom ${ZOOM}）。
       标尺读的是渲染常量；表里的「扫描」是逐像素量出来的连续涂装长度，两者对得上才算数。
       落地的石脚底边两图都在 y+32，占地与碰撞格没动。
     </p>
     <main>
       ${card(shots.before, '改前', `墙 ${shots.before.scale.shopfrontH} / 柱 ${shots.before.scale.lampPostH} / 灯体下沿 ${shots.before.scale.lampBodyBottom}`)}
       ${card(shots.after, '改后', `墙 ${shots.after.scale.shopfrontH} / 柱 ${shots.after.scale.lampPostH} / 灯体下沿 ${shots.after.scale.lampBodyBottom}`)}
       <div>
         <div class="panel">
           <b>像素读数</b>
           <table>
             <tr><th>构件</th><th>改前（扫描）</th><th>改后（常量）</th><th>比例</th></tr>
             ${readings(shots.after)}
           </table>
         </div>
         <div class="panel">
           <b>改前 vs 改后</b><br />
           店面墙 ${shots.before.scale.shopfrontH} → ${shots.after.scale.shopfrontH} px（${ratio(shots.before.scale)}× → ${ratio(shots.after.scale)}×）<br />
           街灯柱 ${shots.before.scale.lampPostH} → ${shots.after.scale.lampPostH} px（${postRatio(shots.before.scale)}× → ${postRatio(shots.after.scale)}×）<br />
           灯体下沿 ${shots.before.scale.lampBodyBottom} → ${shots.after.scale.lampBodyBottom} px（净空）
           （头顶 ${shots.after.scale.personH}，${shots.before.scale.lampBodyBottom - shots.before.scale.personH < 0 ? `改前压头 ${shots.before.scale.personH - shots.before.scale.lampBodyBottom}px` : '改前不压头'}）<br />
           指令 ${shots.before.stats.totalCommands} → ${shots.after.stats.totalCommands}
         </div>
         <div class="panel" style="color:#8b9691">
           尺子：世界像素 × 4 = 图中像素（zoom ${ZOOM}），合成页按 1:1 显示。<br />
           蓝尺 = 人 ${shots.after.scale.personH}px，黄尺 = 墙 / 柱，虚线 = 灯体下沿。
         </div>
       </div>
     </main>`,
  );
  await compose.screenshot({ path: join(OUT, 'setting-scale.png'), fullPage: true });
  await compose.close();
  await c2.close();
  console.log(`并排图：${join(OUT, 'setting-scale.png')}`);
}
