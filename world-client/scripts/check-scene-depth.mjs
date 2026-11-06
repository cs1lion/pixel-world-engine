#!/usr/bin/env node
/**
 * 遮挡的可复现摆位验收：把「迷路人」按固定格钉在摊位的后一格 / 前一格，
 * 冻结帧各截一张，两张并排成一张对照图，并把两处的 depth 读数写进图注。
 *
 * 为什么要摆位而不是等路线自己走到：冻结帧（第 150 帧）里没有任何人的路线
 * 正好停在 `stall_north_1`（17,26）的后面。判据（`render/scenery-depth.ts`）
 * 已经有单测，但「人被挡住」不能只有断言，得有一张人能一眼看懂的实拍。
 *
 * 钉子只改这一帧要画的那份快照（`render/villager-pin.ts`），不写世界、不进存档。
 *
 * 跑法：
 *   cd world-client && npm run dev
 *   node scripts/check-scene-depth.mjs
 *
 * 端口可用 `PIXEL_WORLD_URL` 覆盖；截图目录用 `EVAL_OUT` 覆盖
 * （默认写 `world-client/eval/screens`，CI 指到 runner 临时目录）。
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';
import { resolveShotDir } from './lib/shot-output.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = resolveShotDir('check-scene-depth');
mkdirSync(OUT, { recursive: true });

/** 冻结帧：150 帧 ≈ 2.5s 世界时间；随机数与时间都锁在帧号上。 */
const STOP_AT = 150;
const SET_CAMERA_AT = 70;
const PIN_AT = 100;

/** 摊位与镜头：`stall_north_1` 在 (17,26)，格子左上角 = (272,416)。 */
const STALL = { name: 'stall_north_1' };
/** 摊位构件 depth：`sceneryDepth(26, ALTITUDE=1000)` = 1000 + 26*16 + 12。 */
const STALL_DEPTH = 1000 + 26 * 16 + 12;
const CAMERA = { x: 280, y: 420 };

const VARIANTS = [
  {
    id: 'behind',
    cell: { x: 17, y: 25 },
    label: '摊位后一格（17,25）',
    verdict: 'depth 1424 < 摊位 1428：摊位先画，布棚压过胸口——人被挡住。',
  },
  {
    id: 'front',
    cell: { x: 17, y: 27 },
    label: '摊位前一格（17,27）',
    verdict: 'depth 1456 > 摊位 1428：人后画，盖住柜台——人在前面。',
  },
];
/** 被摆上去的村民：`pale` 浅色衣，压在棕色木立面上一眼分得开。 */
const WALKER = '沉灯夫人';
/** 摊位可视框：`drawStall` 在 (17,26) 的布棚顶到柜台底（世界像素）。 */
const STALL_BOX = { x: 270, y: 402, w: 28, h: 30 };

function initScript({ stopAt }) {
  try {
    localStorage.clear();
  } catch {
    /* 忽略 */
  }
  // 与证据脚本同一套确定性：随机数种子固定、时间只走帧号、到帧就停。
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
    if (state.frozen || state.frame >= stopAt) return 0;
    return realRaf(() => {
      state.frame += 1;
      cb(state.frame * frameMs);
    });
  };
}

const browser = await chromium.launch({ headless: true });
const shots = [];

try {
  for (const variant of VARIANTS) {
    const page = await browser.newPage({ viewport: { width: 1010, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(initScript, { stopAt: STOP_AT });
    await page.goto(`${BASE}?world=dengchao&time=noon&feed=off&ledger=off`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Oracle?.view !== undefined, null, { timeout: 30000 });
    await page.waitForFunction(
      (n) => window.__CAPTURE_STATE__.frame >= n,
      SET_CAMERA_AT,
      { timeout: 30000 },
    );

    const canvas = page.locator('canvas').first();
    await canvas.waitFor();
    const box = await canvas.boundingBox();
    if (box === null) throw new Error('找不到 canvas');
    // 先把镜头推到 2 倍（屏幕 4px / 世界 1px）：人物 24×30 在图上就是 96×120，一眼能看清。
    // 滚轮缩放以指针为中心，所以先对准画布中心，再 centerCameraOn 把摊位挪到中心。
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 4; step += 1) {
      const zoom = await page.evaluate(() => window.Oracle.camera().zoom);
      if (zoom >= 2) break;
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(160);
    }
    await page.evaluate(([x, y]) => window.Oracle.centerCameraOn(x, y), [CAMERA.x, CAMERA.y]);
    const camera0 = await page.evaluate(() => window.Oracle.camera());
    await page.waitForFunction(
      (n) => window.__CAPTURE_STATE__.frame >= n,
      PIN_AT,
      { timeout: 30000 },
    );

    const pinned = await page.evaluate(({ name, cell }) => {
      const villager = window.Oracle.view().villagers.find((item) => item.name === name);
      if (villager === undefined) return null;
      const foot = window.Oracle.debugPinVillager(villager.id, cell);
      return { id: villager.id, name: villager.name, cell, ...foot };
    }, { name: WALKER, cell: variant.cell });
    if (pinned === null) throw new Error(`快照里找不到「${WALKER}」，摆位截不了`);

    await page.waitForFunction(
      (n) => window.__CAPTURE_STATE__.frame >= n,
      STOP_AT,
      { timeout: 30000 },
    );
    await page.evaluate(() => {
      window.__CAPTURE_STATE__.frozen = true;
    });
    await page.waitForTimeout(250);

    const file = join(OUT, `placement-${variant.id}.png`);
    // 只截摊位周围 120×80 世界像素 = 480×320 CSS 像素（4 屏像素 / 世界像素）。
    await page.screenshot({
      path: file,
      clip: {
        x: box.x + box.width / 2 - 240,
        y: box.y + box.height / 2 - 160,
        width: 480,
        height: 320,
      },
    });
    await page.close();

    shots.push({ ...variant, file, pinned, camera: camera0, errors });
  }

  // 并排：一张 HTML 把两张图放在一起，虚线框标出摊位与人的可视范围，图注写 depth 读数。
  const composite = await browser.newPage({
    viewport: { width: 1010, height: 520 },
    deviceScaleFactor: 2,
  });
  const encode = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  const cards = shots
    .map((shot) => {
      const { camera } = shot;
      const centerX = camera.worldViewX + 240 / camera.zoom;
      const centerY = camera.worldViewY + 160 / camera.zoom;
      const scale = 2 * camera.zoom;
      const at = (wx, wy) => ({ left: 240 + (wx - centerX) * scale, top: 160 + (wy - centerY) * scale });
      const stall = at(STALL_BOX.x, STALL_BOX.y);
      const walker = at(shot.pinned.x - shot.pinned.w / 2, shot.pinned.y - shot.pinned.h);
      return `
      <figure>
        <div class="frame">
          <img src="${encode(shot.file)}" alt="${shot.label}" />
          <div class="box stall" style="left:${stall.left}px;top:${stall.top}px;
               width:${STALL_BOX.w * scale}px;height:${STALL_BOX.h * scale}px"></div>
          <div class="box walker" style="left:${walker.left}px;top:${walker.top}px;
               width:${shot.pinned.w * scale}px;height:${shot.pinned.h * scale}px"></div>
        </div>
        <figcaption>
          <b>${shot.label}</b><br />
          ${shot.pinned.name} ${shot.pinned.id} · 脚底 (${shot.pinned.x}, ${shot.pinned.y}) ·
          depth <b>${shot.pinned.depth}</b>；摊位 depth <b>${STALL_DEPTH}</b><br />
          <span class="verdict">${shot.verdict}</span>
        </figcaption>
      </figure>`;
    })
    .join('');
  await composite.setContent(
    `<!doctype html><meta charset="utf-8" />
     <style>
       body { margin: 0; background: #0f1216; color: #d8dad3;
              font: 13px/1.6 "Microsoft YaHei", "Noto Sans SC", sans-serif; }
       h1 { font-size: 15px; margin: 16px 20px 4px; font-weight: 600; }
       p.note { margin: 0 20px 12px; color: #8b9691; }
       main { display: flex; gap: 16px; padding: 0 20px 20px; }
       figure { margin: 0; }
       .frame { position: relative; width: 480px; height: 320px; }
       img { width: 480px; height: 320px; image-rendering: pixelated;
             border: 1px solid #2a3138; display: block; }
       .box { position: absolute; box-sizing: border-box; border: 1px dashed; }
       .box.stall { border-color: #f4d596; }
       .box.walker { border-color: #7fe3ff; }
       figcaption { padding-top: 8px; color: #c9d1cc; }
       .verdict { color: #9fe3b0; }
       b { color: #f4d596; font-weight: 600; }
     </style>
     <h1>摊位前后一格：谁的 depth 大，谁就在前面</h1>
     <p class="note">
       同一冻结帧（第 150 帧）、同一机位、同一套随机种子；只把「${WALKER}」钉到两格上。
       摊位 ${STALL.name} 在 (17,26)。虚线 <span style="color:#f4d596">琥珀框 = 摊位</span>、
       <span style="color:#7fe3ff">青框 = 人（24×30）</span>。
     </p>
     <main>${cards}</main>`,
  );
  await composite.screenshot({ path: join(OUT, 'placement-stall.png'), fullPage: true });
  await composite.close();
} finally {
  await browser.close();
}

for (const shot of shots) {
  console.log(
    `${shot.id}: ${shot.pinned.name} @ (${shot.pinned.cell.x},${shot.pinned.cell.y}) → `
      + `脚底 (${shot.pinned.x},${shot.pinned.y}) depth ${shot.pinned.depth}；`
      + `摊位 depth ${STALL_DEPTH}；camera zoom ${shot.camera.zoom}`
      + `${shot.errors.length === 0 ? '' : `；报错 ${shot.errors.join('; ')}`}`,
  );
}
console.log(`两张并排：${join(OUT, 'placement-stall.png')}`);
