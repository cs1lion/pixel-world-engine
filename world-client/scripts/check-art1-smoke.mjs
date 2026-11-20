#!/usr/bin/env node
/**
 * `?art=1` 表现层（art1 图集 + 灯光 + fx-ambient 微动效）的无头冒烟。
 *
 * 与 `check-art-assets.mjs`（单件位图素材装载）的分工：那条管「图装上了没有」，
 * 这条管「表现层三条线真的接管了吗」——读的是运行时 `window.Oracle.debugArt1()`
 * 的自证读数，不靠截图。截图只能证明这一帧看起来还行，证明不了图层在跑；
 * 反过来「一格都没贴」的画面也可以很好看。
 *
 * 判据六条：
 *   1. `?art=1`：图集地面层 active 且烘的格数 = 全图格数（缺件回退的口径见
 *      `src/render/art1/atlas-registry.ts`：那一层必须整层接管或整层不接管）；
 *   2. 图集岸带层 active 且格数 > 0（莞尔镇有水陆界，为 0 说明清单/装载坏了）；
 *   3. 光照层 active：槽容量 > 0、有请求、挤掉的灯数如实记账（不许静默丢）；
 *   4. 微动效层在画（草/波/点至少一类非零，且不是 hidden）；
 *   5. **`?art=0` 全部读数回落**：图集两层 active=false、光照 active=false、
 *      微动效 hidden=true——基线模式一个字节都不许动，这条是 screens-diff 的前提；
 *   6. 两跑都无 pageerror；帧节奏（rAF 间隔）中位贴住 60Hz 的 vsync、p95 不掉出
 *      一帧半。真正的绘制预算闸门是 `check-render-budget.mjs`（指令条数硬顶），
 *      这里只回答「表现层上线后帧还是 60Hz 吗」。
 *
 * 世界用 `world=dengchao`（设定集镇）：它有 28 盏街灯、有岸线，三条线都有东西
 * 可接管；默认莞尔镇街灯为 0，光照层会静默退化成「只有微动效在跑」。
 *
 * 跑法：
 *   cd world-client && npm run build && npm run preview -- --port 5211 --strictPort
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-art1-smoke.mjs
 */

import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);

const browser = await chromium.launch();
const failures = [];

/**
 * 帧节奏读数：连续 90 帧的 rAF 间隔，取中位与 p95。
 *
 * 这条**不是**「单拍渲染耗时」——rAF 间隔被 vsync 钉死在 16.67ms（60Hz），
 * 拿 16.6 当上限是假判据：正常页也永远不过。真正的绘制预算闸门在
 * `check-render-budget.mjs`（数 Graphics 指令条数，硬顶 33,488），这里只回答
 * 一个更窄的问题：**表现层上线后，帧节奏还是 60Hz 吗**。所以判据是
 * 「中位贴着 vsync、p95 不许掉出一帧以上」。掉一帧 = 33.3ms。
 */
async function frameTiming(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = [];
        let last = performance.now();
        let n = 0;
        const tick = (now) => {
          intervals.push(now - last);
          last = now;
          n += 1;
          if (n < 90) requestAnimationFrame(tick);
          else {
            const sorted = [...intervals].sort((a, b) => a - b);
            resolve({
              median: sorted[Math.floor(sorted.length / 2)] ?? Number.NaN,
              p95: sorted[Math.floor(sorted.length * 0.95)] ?? Number.NaN,
              max: sorted[sorted.length - 1] ?? Number.NaN,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** vsync 60Hz 的名义间隔与容差：中位允许 ±1.5ms 抖动。 */
const VSYNC_MS = 1000 / 60;
const MEDIAN_TOLERANCE_MS = 1.5;
/** p95 上限：一帧半——掉一整帧（33.3ms）就是掉帧，不该被中位掩盖。 */
const P95_LIMIT_MS = VSYNC_MS * 1.5;

async function run(art) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const query = `world=dengchao&ledger=off&time=night&debug=1${art === null ? '' : `&art=${art}`}`;
  await page.goto(`${BASE}?${query}`, { waitUntil: 'load' });
  // 等世界就绪 + 图集装载 + 一帧光照（夜相：灯全开，光照层才有请求可读）。
  await page.waitForFunction(() => typeof window.Oracle?.debugArt1 === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(3500);
  const readout = await page.evaluate(() => window.Oracle.debugArt1());
  const timing = await frameTiming(page);
  await page.close();
  return { art, readout, timing, errors };
}

const on = await run('1');
const off = await run('0');
await browser.close();

const ground = on.readout.atlasGround;
const shore = on.readout.atlasShore;
const light = on.readout.lighting;
const fx = on.readout.microFx;

// 1. 图集地面层整层接管（格数 = 纹理宽/高换算出来的全图格数）
if (ground.active !== true) {
  failures.push('art=1 图集地面层没接管（atlasGround.active=false）');
} else {
  const cellsOfWorld = (ground.widthPx / 16) * (ground.heightPx / 16);
  if (ground.cells !== cellsOfWorld) {
    failures.push(`art=1 地面层应整层接管：${ground.cells} 格 ≠ 全图 ${cellsOfWorld} 格`);
  }
}

// 2. 岸带层接管且有格
if (shore.active !== true) {
  failures.push('art=1 岸带层没接管（莞尔镇/灯潮界都有水陆界，这里应当整层接管）');
} else if (!(shore.cells > 0)) {
  failures.push('art=1 岸带层 active 但一格都没贴（清单里 shore 槽没对上陆侧地形）');
}

// 3. 光照接管 + 容量与记账
if (light.active !== true) {
  failures.push('art=1 光照层没接管（headless Chromium 走 WebGL，应当 active）');
} else {
  if (!(light.capacity > 0)) failures.push('光照槽容量为 0');
  if (!(light.requests > 0)) failures.push('夜相下一盏灯请求都没有（灯位表没装配上）');
  if (light.dropped < 0) failures.push('挤掉的灯数为负');
}

// 4. 微动效在画
if (fx.hidden === true) {
  failures.push('art=1 微动效层是隐藏态');
} else if (!(fx.grass > 0 || fx.ripples > 0 || fx.dots > 0)) {
  failures.push(`art=1 微动效一帧画了 0 条（grass=${fx.grass} ripples=${fx.ripples} dots=${fx.dots}）`);
}

// 5. art=0 全部回落
if (off.readout.atlasGround.active !== false) failures.push('art=0 图集地面层不该接管');
if (off.readout.atlasShore.active !== false) failures.push('art=0 图集岸带层不该接管');
if (off.readout.lighting.active !== false) failures.push('art=0 光照层不该接管');
if (off.readout.microFx.hidden !== true) failures.push('art=0 微动效层不该活着');

// 6. pageerror 与帧预算
for (const [label, pass] of [['art=1', on], ['art=0', off]]) {
  for (const err of pass.errors) failures.push(`${label} pageerror: ${err}`);
}
// 帧节奏：中位贴 vsync、p95 不许掉出一帧半；两跑都要守（基线也不许被拖慢）。
const rhythm = (label, pass) => {
  const { median, p95 } = pass.timing;
  if (!(median <= VSYNC_MS + MEDIAN_TOLERANCE_MS)) {
    failures.push(`${label} 帧中位 ${median.toFixed(2)}ms 偏离 vsync ${VSYNC_MS.toFixed(2)}ms 超过 ${MEDIAN_TOLERANCE_MS}ms`);
  }
  if (!(p95 <= P95_LIMIT_MS)) {
    failures.push(`${label} 帧 p95 ${p95.toFixed(2)}ms 超 ${P95_LIMIT_MS.toFixed(2)}ms（有掉帧）`);
  }
};
rhythm('art=1', on);
rhythm('art=0', off);

console.log(
  `art=1: 地面 ${ground.cells} 格（${ground.widthPx}x${ground.heightPx}）/ 岸带 ${shore.cells} 格 / ` +
    `光照槽 ${light.capacity}（请求 ${light.requests}，挤掉 ${light.dropped}）/ ` +
    `微动效 g${fx.grass} r${fx.ripples} d${fx.dots}`,
);
console.log(
  `帧节奏（rAF 间隔 90 帧）：art=1 中位 ${on.timing.median.toFixed(2)}ms / p95 ${on.timing.p95.toFixed(2)}ms；` +
    `art=0 中位 ${off.timing.median.toFixed(2)}ms / p95 ${off.timing.p95.toFixed(2)}ms` +
    `（vsync ${VSYNC_MS.toFixed(2)}ms）`,
);
console.log('art=0: 图集两层 off / 光照 off / 微动效 hidden（基线不受表现层影响）');

if (failures.length > 0) {
  console.error('\nart1 冒烟失败：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('art1 冒烟通过：图集两层整层接管、光照有灯有记账、微动效在画、art=0 全回落、帧预算内、无 pageerror。');
