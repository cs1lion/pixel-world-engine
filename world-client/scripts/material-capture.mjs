/* 材质证据截图：整张「工作表」+ 固定帧，前后各跑一次即可逐像素对比。
 *
 * 为什么拍整张工作表而不是每格单独裁：
 *   相机跟随玩家，两次运行的停点不同；即便把镜头压到同一世界点，也可能被
 *   世界边界夹住。这里只拍**画布原尺寸**（480×320 世界像素 = 960×640 CSS），
 *   记下 scrollX/scrollY，裁图交给 `material-analyze.py` 按世界坐标切——
 *   取景坐标只存在于一处，前后两遍必然逐像素对齐。
 *
 * 为什么要固定 rAF：
 *   世界从固定 dt 步进；只有帧号相同，村民的姿势、摊位火光的相位才逐像素一致。
 *   本脚本不停帧，而是让帧号跑到同一个 N 再截图。
 *
 * 用法：先 `npm run dev -- --port 5191`，再
 *   node scripts/material-capture.mjs --label before
 * 产物：<仓库根>/docs/evidence/material-upgrade/<label>/*-sheet-2x.png + index.json
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// 证据放仓库根 docs/，不放在 world-client/docs：README/审计脚本都从仓库根读。
const EVIDENCE = resolve(HERE, '..', '..', 'docs', 'evidence', 'material-upgrade');

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5191/';
const LABEL = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'before';
const OUT = resolve(EVIDENCE, LABEL);
const FRAME_MS = 1000 / 60;
/** 跑到第几帧再截图：开局四秒，村民已离开锚点、摊位火光进入中段相位。 */
const SETTLE_FRAME = 240;

/** 清存档 + 固定 dt 的 rAF（不停帧，靠帧号对齐两遍运行）。 */
function initScript({ frameMs }) {
  try {
    localStorage.clear();
  } catch {
    /* 隐私模式忽略 */
  }
  window.__MATERIAL_SEED__ = 20261104;
  let rng = 20261104 >>> 0;
  Math.random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const state = { frame: 0 };
  window.__MATERIAL_STATE__ = state;
  const realRaf = window.requestAnimationFrame.bind(window);
  const now = () => state.frame * frameMs;
  performance.now = now;
  window.requestAnimationFrame = (cb) =>
    realRaf(() => {
      state.frame += 1;
      cb(now());
    });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.addInitScript(initScript, { frameMs: FRAME_MS });

async function openWorld(world, time) {
  const url = `${BASE}?world=${world}&time=${time}&feed=off&ledger=off&now=495&debug=0`;
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.Oracle !== undefined, undefined, { timeout: 30000 });
  // 只留画布：顶栏、侧栏、调试面板都盖住取景。
  await page.addStyleTag({
    content: `
      html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; }
      /* 只关叠层，不动画布的尺寸与位置：Phaser 监听 resize，改画布尺寸会重排取景。 */
      #world-overlay, #minimap, #topbar, #oracle, #reply, #paper, #slab, #status,
      #queue, #decree, #debug-panel, #unit-status, #chronicle, #villager-panel,
      #stele-panel, #building-panel, #clock-align, #camera-bar, footer, #save-io-reply,
      #world-state, #hud { display: none !important; }
    `,
  });
  await page.evaluate(() => window.Oracle.setCameraMode('free'));
  await waitFrames(SETTLE_FRAME);
}

const waitFrames = (n) =>
  page.waitForFunction((target) => window.__MATERIAL_STATE__.frame >= target, n, {
    timeout: 60000,
  });

/**
 * 拍一张整幅工作表：相机压到 (worldX, worldY)（被世界边界夹住也不要紧，
 * 裁图读的是实际 scroll）。整幅图正好是 480×320 世界像素，2× CSS。
 */
async function sheet(name, worldX, worldY) {
  await page.evaluate(({ x, y }) => window.Oracle.centerCameraOn(x, y), { x: worldX, y: worldY });
  await waitFrames((await page.evaluate(() => window.__MATERIAL_STATE__.frame)) + 3);
  const info = await page.evaluate(() => {
    const camera = window.Oracle.camera();
    const canvas = document.querySelector('#app canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      camera,
      rect: { width: rect.width, height: rect.height, left: rect.left, top: rect.top },
      backing: { width: canvas.width, height: canvas.height },
    };
  });
  const scrollX = info.camera.scrollX;
  const scrollY = info.camera.scrollY;
  console.log(
    `${name}: want ${worldX},${worldY} scroll ${scrollX},${scrollY} cam ${info.camera.width}x${info.camera.height} rect ${info.rect.width}x${info.rect.height} backing ${info.backing.width}x${info.backing.height}`,
  );
  const clip = {
    x: Math.round(info.rect.left),
    y: Math.round(info.rect.top),
    width: Math.round(info.rect.width),
    height: Math.round(info.rect.height),
  };
  await page.screenshot({ path: `${OUT}/${name}-sheet-2x.png`, clip });
  return {
    name,
    camera: {
      scrollX,
      scrollY,
      width: info.camera.width,
      height: info.camera.height,
    },
    // 一个世界像素占几个 CSS 像素：裁图换算只用这个读数，不抄常量。
    cssPerWorld: info.rect.width / info.camera.width,
    rect: info.rect,
  };
}

const sheets = [];
await mkdir(OUT, { recursive: true });

// ─── 灯潮界 ─────────────────────────────────────────────────────────────
await openWorld('dengchao', 'noon');
// 灯街中段：铺装 + 广场 + 街面。
sheets.push(await sheet('street', 440, 472));
// 南段石板路：stone 带 x28..36 / y34..45。
sheets.push(await sheet('south-road', 520, 584));
// 东段空地：灯街资产止于 x≈51，x 53..62 是没被摊位压住的老广场。
sheets.push(await sheet('east-plaza', 880, 480));
// 西段广场：灯街起点 x=12 以西，x 2..11 是一片没有资产的空地。
sheets.push(await sheet('west-plaza', 200, 496));
// 积尘滩：mud x39..56 / y35..42，避开补灯铺(43,34 4×4)。
sheets.push(await sheet('mud-flat', 760, 616));
// 炉底入口（29,14，4×3）：楼压在内层 stone 带 x28..36 / y14..37，
// 石脚下面就是合法 stone 地形——BUG-1 跨世界配色的同框对照。
sheets.push(await sheet('boiler-base', 504, 276));

const villagers = await page.evaluate(() => window.Oracle.view().villagers ?? []);
const standing = villagers.find((v) => v.pos.y >= 28 && v.pos.y <= 31 && v.pos.x >= 14 && v.pos.x <= 46) ?? villagers[0];
if (standing !== undefined) {
  // `pos` 是格坐标；精灵脚底在 `(y + 1) * TILE_PX`，身高 30px 往上画。
  const px = (standing.pos.x + 0.5) * 16;
  const py = (standing.pos.y + 1) * 16 - 15;
  const shot = await sheet('villager', px, py);
  shot.villager = { id: standing.id, pos: standing.pos, feetWorld: { x: px, y: py } };
  sheets.push(shot);
}

// ─── 莞尔镇（默认世界）：房屋外立面另一套画法 ────────────────────────────
await openWorld('default', 'noon');
const dwView = await page.evaluate(() => window.Oracle.view());
const building = dwView.buildings?.[0] ?? null;
if (building !== null && building.origin !== undefined) {
  const { origin, footprint } = building;
  const shot = await sheet(
    'default-wall',
    (origin.x + footprint.w / 2) * 16,
    (origin.y + footprint.h - 1) * 16,
  );
  shot.building = { id: building.instanceId, origin, footprint };
  sheets.push(shot);
}

await writeFile(
  `${OUT}/index.json`,
  JSON.stringify({ label: LABEL, base: BASE, settleFrame: SETTLE_FRAME, sheets, errors }, null, 2),
);
console.log(`wrote ${sheets.length} sheets to ${OUT}`);
if (errors.length > 0) console.log('page errors:', errors);
await browser.close();
