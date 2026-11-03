#!/usr/bin/env node
/**
 * 渲染预算回归：每帧的绘制指令总量必须低于阈值。
 *
 * 为什么需要这条：地形与迷雾曾经各自是一次性画进一个大 Graphics 的，
 * 每帧 Phaser 都要重新批处理全部指令。实测 77 万条，其中 87% 在屏幕外。
 * 烘焙成纹理后应当降到 3 万以下。这条脚本防的是"哪天又有人往大 Graphics 里塞东西"。
 *
 * 跑法：
 *   1. npm run dev
 *   2. node scripts/check-render-budget.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';

/**
 * 指令上限。原来这里写「烘焙后实测约 2 万；给一倍余量」。
 *
 * 2026-10-28：那个数**无从复核**——仓里没有任何地方记着它是什么时候、在哪张图上
 * 测的，`git log` 里也查不到：这个文件自 `996cbd3` 之后还被动过两笔（`cff1bed` 只改了
 * playwright 的 import 路径，`d5edcc5` 就是这一笔），**可这几个数在此前一行都没被碰
 * 过**——动过不等于记下了量的那一刻。而世界从那一笔起长了潮汐、迷雾、记忆层、造物主
 * 一大批东西。更要紧的不是 2 万准不准，是
 * **「给一倍余量」那句话**：它拿实测值当分母。真实值一旦爬到 1.5 万以上，
 * 这句「一倍余量」就成了假话，而它读起来像一句设计说明。
 *
 * 所以现在这儿只留一条：上限 30000 是**绝对天花板**（超了就是渲染预算失控），
 * 不是按某个实测比例倒推的。要问余量还有多少，跑这个脚本现看 `reports` 里那条，
 * 别信这一行。本脚本自己会打出来。
 */
const MAX_COMMANDS = 30_000;
/** 拖动帧率相对静止帧率的比例下限。 */
const MIN_DRAG_RATIO = 0.9;

const reports = [];
const failures = [];
const check = (ok, label, detail = '') => {
  reports.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail === '' ? '' : `（${detail}）`}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1010, height: 1100 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.addInitScript(() => localStorage.clear());
await page.goto(`${BASE}?ledger=off&time=noon&debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 30000 });
await page.waitForTimeout(1200);
// 地形烘焙是异步的：冷启动（CI 每次都是干净的 profile）第一帧还在用未烘焙的
// 大 Graphics，指令数会短暂停在高位（实测 119074），约一两秒后才落到 16130。
// 这不是渲染预算变坏，是**读得太早**。等到它落到预算内再量；等不到就照常红。
await page
  .waitForFunction(
    (limit) => window.Oracle.renderStats().totalCommands < limit,
    MAX_COMMANDS,
    { timeout: 5000, polling: 100 },
  )
  .catch(() => {});

const stats = await page.evaluate(() => window.Oracle.renderStats());
check(
  stats.totalCommands < MAX_COMMANDS,
  `绘制指令低于 ${MAX_COMMANDS}`,
  `实际 ${stats.totalCommands}`,
);
check(
  stats.graphicsObjects < 40,
  'Graphics 对象数量正常',
  `实际 ${stats.graphicsObjects}`,
);

/**
 * 测量口径：每条指标采样 4 次，**丢掉第 1 次当预热，取后 3 次中位**。
 *
 * 2026-11-03 合并时同一道闸门两次红在不同指标（拖动 35.2 / 静止 43.6、
 * 前台恢复 37.3 / 46.7），重跑即绿、阈值未动。单次 1.5 秒采样把 runner 的
 * 瞬时争用直接当成代码回归。阈值语义一个字没改（拖动 >= 静止 × 0.9、
 * 后台 <= 前台 / 3、恢复 >= 前台 × 0.9），改的只是测量方式。
 *
 * 失败时原始采样会跟着读数一起打出来，并在 EVAL_OUT 存在时把同一个采样
 * 对象写成 JSON——让看红的人当场分清「机器慢」还是「代码慢」。
 */
const SAMPLE_COUNT = 4;
/** 单次采样时长；4 次 × 1s，丢弃首样本后取中位。 */
const SAMPLE_MS = 1000;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const fmtSamples = (values) => values.map((value) => value.toFixed(1)).join('/');

const measureFps = async () =>
  page.evaluate(
    (durationMs) =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          const elapsed = performance.now() - start;
          if (elapsed > durationMs) resolve((frames / elapsed) * 1000);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    SAMPLE_MS,
  );

/** 同一指标多采几次；首样本丢掉当预热，其余取中位。 */
const sampleFps = async () => {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) samples.push(await measureFps());
  return { value: median(samples.slice(1)), samples };
};

const idle = await sampleFps();

const box = await page.locator('canvas').first().boundingBox();
await page.mouse.move(box.x + 400, box.y + 300);
await page.mouse.down();
/** 一次采样期间持续拖动，避免「按下不动」被当成静止。 */
const sampleDrag = async () => {
  const motion = (async () => {
    for (let step = 0; step < 25; step += 1) {
      await page.mouse.move(
        box.x + 400 + Math.sin(step * 0.5) * 60,
        box.y + 300 + Math.cos(step * 0.5) * 40,
      );
      await page.waitForTimeout(40);
    }
  })();
  const fps = await measureFps();
  await motion;
  return fps;
};
const drag = { value: 0, samples: [] };
for (let index = 0; index < SAMPLE_COUNT; index += 1) drag.samples.push(await sampleDrag());
drag.value = median(drag.samples.slice(1));
await page.mouse.up();

check(
  drag.value >= idle.value * MIN_DRAG_RATIO,
  '拖动时帧率不明显低于静止',
  `静止 ${idle.value.toFixed(1)}（采样 ${fmtSamples(idle.samples)}）/ `
    + `拖动 ${drag.value.toFixed(1)}（采样 ${fmtSamples(drag.samples)}）`,
);
// 省电模式：切到后台必须真的降频。用 advanceCount（真正推进世界的帧数），
// 不能用 Phaser 的 update 调用次数——跳帧时它仍然每帧加一，看不出差别。
const countAdvances = async (ms) => {
  const before = await page.evaluate(() => window.Oracle.ecoState().advanceCount);
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => window.Oracle.ecoState().advanceCount);
  return ((after - before) / ms) * 1000;
};
const sampleAdvances = async () => {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) samples.push(await countAdvances(SAMPLE_MS));
  return { value: median(samples.slice(1)), samples };
};

const foreground = await sampleAdvances();
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(400);
const background = await sampleAdvances();

await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(400);
const restored = await sampleAdvances();

check(
  background.value <= foreground.value / 3,
  '切到后台真的降频',
  `前台 ${foreground.value.toFixed(1)}（采样 ${fmtSamples(foreground.samples)}）/ `
    + `后台 ${background.value.toFixed(1)}（采样 ${fmtSamples(background.samples)}）`,
);
check(
  restored.value >= foreground.value * 0.9,
  '回到前台恢复满帧',
  `恢复 ${restored.value.toFixed(1)}（采样 ${fmtSamples(restored.samples)}；`
    + `前台 ${foreground.value.toFixed(1)}）`,
);

check(errors.length === 0, '全程无 JS 报错', errors.join('; '));

// 原始采样落盘：只在 EVAL_OUT 存在时写（CI 指向 runner 临时目录，不弄脏仓库）。
if (process.env.EVAL_OUT) {
  const out = join(process.env.EVAL_OUT, 'render-budget-samples.json');
  mkdirSync(process.env.EVAL_OUT, { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        sampleCount: SAMPLE_COUNT,
        sampleMs: SAMPLE_MS,
        thresholds: { minDragRatio: MIN_DRAG_RATIO, minRestoreRatio: 0.9, maxBackgroundDivisor: 3 },
        fps: { idle, drag },
        advances: { foreground, background, restored },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`采样读数已落盘：${out}`);
}

await browser.close();

for (const item of reports) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.label}${item.detail === '' ? '' : `  ${item.detail}`}`);
}
if (failures.length > 0) {
  console.error(`\n渲染预算失败 ${failures.length} 项：`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\n渲染预算：${reports.length} 项通过`);
