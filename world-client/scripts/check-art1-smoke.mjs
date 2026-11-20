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
 *   1b. 建筑图集分支：至少一栋楼走图集，且走图集的屋面必须是**独立屋顶格**
 *       （`roofFromAtlas` 与 `roofIsWholeBuilding !== true` 同数）——这一条就是
 *       「掀屋顶在 ?art=1 也生效」的机器读数；
 *   2. 图集岸带层 active 且格数 > 0（莞尔镇有水陆界，为 0 说明清单/装载坏了）；
 *   3. 光照层 active：槽容量 > 0、有请求、挤掉的灯数如实记账（不许静默丢）；
 *   4. 微动效层在画（草/波/点至少一类非零，且不是 hidden）；
 *   5. **`?art=0` 全部读数回落**：图集两层 active=false、光照 active=false、
 *      微动效 hidden=true——基线模式一个字节都不许动，这条是 screens-diff 的前提；
 *   6. 两跑都无 pageerror；**art=1 的帧中位不许比 art=0 慢**（同轮相对对照）。
 *      不用绝对 16.6ms 上限：rAF 被 vsync 钉死，本机连 art=0 都有单次 33ms 的
 *      GC 停顿，绝对阈值测的是 runner 体质而不是表现层代价——同一教训见
 *      `check-render-budget.mjs` 的「fps 三类断言只记录不阻塞」。p95/max 只打印。
 *      真正的绘制预算闸门仍是指令条数那条。
 *
 * 世界用 `world=dengchao`（设定集镇）：它有 28 盏街灯、有岸线，三条线都有东西
 * 可接管；默认莞尔镇街灯为 0，光照层会静默退化成「只有微动效在跑」。
 *
 * `ATLAS_FIRST=1`（环境变量，不是 URL 参数）另跑一轮 `?atlas=1`：让 tile 图集
 * 抢在位图单件之前接管建筑与居民。默认那一轮要求图集分支 **0 栋/0 人**——
 * 「新管线不会悄悄盖掉已经过人眼验收的位图观感」这件事也得有读数。
 *
 * 跑法：
 *   cd world-client && npm run build && npm run preview -- --port 5211 --strictPort
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-art1-smoke.mjs
 */

import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;
/** `ATLAS_FIRST=1` 时额外跑一轮 `?atlas=1`，验图集建筑与可掀屋顶。 */
const ATLAS_FIRST = process.env.ATLAS_FIRST === '1';

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
/** 共享云 runner 无头软渲偶尔锁在 30Hz（2 × vsync = 33.33ms）；允许 60Hz/30Hz 宿主档位，掉档仍由 rhythmDelta 硬卡。 */
const MAX_RUNNER_VSYNC_MS = VSYNC_MS * 2;

async function run(art) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const query = `world=dengchao&ledger=off&time=night&debug=1${art === null ? '' : `&art=${art}`}${art === '1' && ATLAS_FIRST ? '&atlas=1' : ''}`;
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

// 1b. 建筑图集分支：至少一栋走图集，且走图集的屋面必须是独立格（可掀）
// 建筑图集分支默认**不**接管（位图单件是已验收观感，`?atlas=1` 才让位给图集）。
// 所以这一条按开关分别判：带 atlas=1 时必须全接管且屋面独立；不带时必须是 0，
// 证明「新管线不会悄悄盖掉验收过的画面」。
const vil = on.readout.atlasVillagers;
if (ATLAS_FIRST) {
  if (vil.atlas !== vil.total || !(vil.total > 0)) {
    failures.push(`atlas=1 居民只接了 ${vil.atlas}/${vil.total}（4 帧步态应当全员接管）`);
  }
} else if (vil.atlas !== 0) {
  failures.push(`没带 ?atlas=1 却有 ${vil.atlas} 个居民走了图集步态`);
}

const bld = on.readout.atlasBuildings;
if (ATLAS_FIRST) {
  if (!(bld.atlas > 0)) failures.push('atlas=1 却没有一栋楼走图集分支（灯潮界 12 栋都在清单里）');
  if (bld.atlas !== bld.liftable) {
    failures.push(`图集楼 ${bld.atlas} 栋里有 ${bld.atlas - bld.liftable} 栋屋面不是独立格，掀屋顶不成立`);
  }
} else if (bld.atlas !== 0) {
  failures.push(`没带 ?atlas=1 却有 ${bld.atlas} 栋楼走了图集分支（位图观感被抢）`);
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
if (off.readout.atlasBuildings.atlas !== 0) failures.push('art=0 不该有楼走图集分支');
if (off.readout.atlasShore.active !== false) failures.push('art=0 图集岸带层不该接管');
if (off.readout.lighting.active !== false) failures.push('art=0 光照层不该接管');
if (off.readout.microFx.hidden !== true) failures.push('art=0 微动效层不该活着');

// 6. pageerror 与帧预算
for (const [label, pass] of [['art=1', on], ['art=0', off]]) {
  for (const err of pass.errors) failures.push(`${label} pageerror: ${err}`);
}
// 帧节奏：**同轮相对对照**——art=1 不许比 art=0 慢。
//
// 为什么不是「中位 ≤ 16.6ms / p95 ≤ 一帧半」这类绝对上限：rAF 间隔被 vsync
// 钉死，本机实测 art=0 也常有单次 33ms 的 GC 停顿（p95 33.30ms）。绝对阈值
// 在这种机器上恒红，而它测的是 runner 的体质，不是表现层的代价。仓库已经为
// 同一件事交过学费：`check-render-budget.mjs` 的三类 fps 断言因此降级为
// 「只记录不阻塞」。这里照同一口径：阻塞判据用同轮两跑的差值，p95/max 只打印。
const rhythmDelta = on.timing.median - off.timing.median;
if (!(rhythmDelta <= MEDIAN_TOLERANCE_MS)) {
  failures.push(
    `art=1 帧中位比 art=0 慢 ${rhythmDelta.toFixed(2)}ms（容差 ${MEDIAN_TOLERANCE_MS}ms）：表现层拖累了基线`,
  );
}
// 两跑的中位都必须在宿主 vsync 档位内（60Hz 或无头软渲 30Hz），跌破 30Hz 说明页面真正卡死；
// 若 art=0 在 60Hz 而 art=1 掉到 30Hz，已由上方 rhythmDelta 硬闸拦截。
for (const [label, pass] of [['art=1', on], ['art=0', off]]) {
  if (!(pass.timing.median <= MAX_RUNNER_VSYNC_MS + MEDIAN_TOLERANCE_MS)) {
    failures.push(`${label} 帧中位 ${pass.timing.median.toFixed(2)}ms 跌破 30Hz 最低档 ${MAX_RUNNER_VSYNC_MS.toFixed(2)}ms`);;
  }
}

console.log(
  `art=1: 地面 ${ground.cells} 格（${ground.widthPx}x${ground.heightPx}）/ 岸带 ${shore.cells} 格 / ` +
    `楼 ${bld.atlas}/${bld.total} 走图集（可掀 ${bld.liftable}）/ 居民 ${vil.atlas}/${vil.total} 走图集步态 / ` +
    `光照槽 ${light.capacity}（请求 ${light.requests}，挤掉 ${light.dropped}）/ ` +
    `微动效 g${fx.grass} r${fx.ripples} d${fx.dots}`,
);
console.log(
  `帧节奏（rAF 间隔 90 帧，p95/max 只记录）：art=1 中位 ${on.timing.median.toFixed(2)}ms` +
    `（p95 ${on.timing.p95.toFixed(2)} / max ${on.timing.max.toFixed(2)}）；` +
    `art=0 中位 ${off.timing.median.toFixed(2)}ms（p95 ${off.timing.p95.toFixed(2)}）；` +
    `差值 ${(on.timing.median - off.timing.median).toFixed(2)}ms，vsync ${VSYNC_MS.toFixed(2)}ms`,
);
console.log('art=0: 图集两层 off / 光照 off / 微动效 hidden（基线不受表现层影响）');

if (failures.length > 0) {
  console.error('\nart1 冒烟失败：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('art1 冒烟通过：图集两层整层接管、光照有灯有记账、微动效在画、art=0 全回落、帧预算内、无 pageerror。');
