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
import {
  BACKGROUND_FLOOR_FPS,
  MIN_BACKGROUND_DIVISOR,
  backgroundThrottleOk,
} from './render-budget-threshold.ts';

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
/**
 * 「回到前台恢复满帧」的比例下限（阈值一字未动）。
 *
 * 2026-11-03 起判据从「恢复段 3 样本中位（按 advanceCount）」换成
 * 「恢复段**最后 1 秒**的 rAF 间隔中位」：恢复段天生带一段爬升尾巴
 * （隐藏期间 rAF 被掐掉，回前台后 Phaser 步进与浏览器合成器都要重新起转），
 * 拿整段中位判它等于把「爬升慢」当「没恢复」。末尾 1 秒才是稳态。
 *
 * 另外加一条硬底线 `RESTORE_FLOOR_RATIO`：恢复段**任何一个 1 秒窗口**的
 * 帧率都不许低于前台的 0.5 倍，防止「先崩到 20 帧、末尾爬回 55 帧」
 * 被尾巴判据判过。这条只会更严，不放宽。
 */
const RESTORE_RATIO = 0.9;
/** 恢复段逐秒窗口的硬底线：不得低于前台帧率的这个比例。 */
const RESTORE_FLOOR_RATIO = 0.5;

const reports = [];
const failures = [];
const check = (ok, label, detail = '') => {
  reports.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail === '' ? '' : `（${detail}）`}`);
};

const browser = await chromium.launch({ headless: true });

/**
 * 一个测量会话：新开一页、等世界就绪、等烘焙落到预算内。
 *
 * 正式轮与预热轮各开一个**不同的页面**，互不继承相机位置、指针状态或页面缓存；
 * 共享的只有浏览器进程本身（GPU 进程、着色器缓存、脚本 JIT、CPU/GPU 频率）。
 */
const openSession = async () => {
  const page = await browser.newPage({ viewport: { width: 1010, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE}?ledger=off&time=noon&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  // 地形烘焙是异步的：冷启动（CI 每次都是干净的 profile）第一帧还在用未烘焙的
  // 大 Graphics，指令数会短暂停在高位（实测 119074），约一两秒后才落到预算内。
  // 这里**不写死某个数**：2026-11-04 在加入落地投影层（第 28 个 Graphics）后，
  // 计分轮实测两档 15514 / 16162（各 28 个 Graphics；本树 5 次计分轮
  // 15514/15514/16162/16162/16162，极差 648）。预热轮与计分轮**不一定同档**，
  // 同一构建上两档都可能出现——真正决定是否计分的是下面的轮次判定，不是数值大小。
  // 旧注释里的 16130 是更早的 CI 机位读数，本树复跑不出来，不再作为基线。
  // 这不是渲染预算变坏，是**读得太早**。等到它落到预算内再量；等不到就照常红。
  await page
    .waitForFunction(
      (limit) => window.Oracle.renderStats().totalCommands < limit,
      MAX_COMMANDS,
      { timeout: 5000, polling: 100 },
    )
    .catch(() => {});

  return { page, errors };
};

/**
 * 测量口径：每条指标采样 4 次，**丢掉第 1 次当预热，取后 3 次中位**。
 *
 * 2026-11-03 合并时同一道闸门两次红在不同指标（拖动 35.2 / 静止 43.6、
 * 前台恢复 37.3 / 46.7），重跑即绿、阈值未动。单次 1.5 秒采样把 runner 的
 * 瞬时争用直接当成代码回归。阈值语义一个字没改（拖动 >= 静止 × 0.9、
 * 后台 <= 前台 / 3、恢复 >= 前台 × 0.9），改的只是测量方式。
 * （后台那一条 2026-11-05 又加了个 12 帧地板，见 `render-budget-threshold.ts`；
 * 这里记的是 11-03 当时的判据，不改写历史。）
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

const measureFps = async (page) =>
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
const sampleFps = async (page) => {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) samples.push(await measureFps(page));
  return { value: median(samples.slice(1)), samples };
};

/**
 * 在页面上收一段 rAF 时间戳。
 *
 * 和 `sampleFps`（数帧数 / 墙钟）不同，这里留下**每一帧的时刻**，
 * 好让调用方按 1 秒切窗、算间隔中位——恢复段的「爬升慢」与「真崩」
 * 只有看逐秒轨迹才分得清。
 */
const collectRafStamps = async (page, durationMs) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const stamps = [];
        const start = performance.now();
        const tick = (now) => {
          stamps.push(now);
          if (now - start >= duration) resolve(stamps);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );

/**
 * 时间戳 → 整段间隔中位 + 逐秒窗口（每窗的帧数与间隔中位）。
 *
 * 窗口数写死成采样秒数（`windowCount`，默认 4），落在 4.000s 边界上的那一帧
 * 归进最后一窗——否则会多出个只有 1 帧的第 5 窗，读数表也不对齐。
 */
const rafSummary = (stamps, windowMs = SAMPLE_MS, windowCount = SAMPLE_COUNT) => {
  const intervals = [];
  const buckets = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const interval = stamps[i] - stamps[i - 1];
    intervals.push(interval);
    const bucket = Math.min(Math.floor((stamps[i] - stamps[0]) / windowMs), windowCount - 1);
    (buckets[bucket] ??= []).push(interval);
  }
  for (let i = 0; i < windowCount; i += 1) buckets[i] ??= [];
  return {
    medianInterval: median(intervals),
    windows: buckets.map((slice) => ({
      frames: slice.length,
      medianInterval: median(slice),
    })),
  };
};

const fpsOf = (intervalMs) => (intervalMs > 0 ? 1000 / intervalMs : 0);

/** 一轮完整测量：绘制指令、静止/拖动帧率、后台降频与回前台恢复。不含任何判定。 */
const measurePass = async (page) => {
  const stats = await page.evaluate(() => window.Oracle.renderStats());

  const idle = await sampleFps(page);

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
    const fps = await measureFps(page);
    await motion;
    return fps;
  };
  const drag = { value: 0, samples: [] };
  for (let index = 0; index < SAMPLE_COUNT; index += 1) drag.samples.push(await sampleDrag());
  drag.value = median(drag.samples.slice(1));
  await page.mouse.up();

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

  // 推进数与 rAF 间隔同时采：前台段既是「后台降频」的分母，也是「恢复末秒」的分母。
  const rafForegroundPromise = collectRafStamps(page, SAMPLE_COUNT * SAMPLE_MS);
  const foreground = await sampleAdvances();
  const rafForeground = rafSummary(await rafForegroundPromise);

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
  const rafRestoredPromise = collectRafStamps(page, SAMPLE_COUNT * SAMPLE_MS);
  const restored = await sampleAdvances();
  const rafRestored = rafSummary(await rafRestoredPromise);

  return {
    stats,
    idle,
    drag,
    foreground,
    background,
    restored,
    raf: { foreground: rafForeground, restored: rafRestored },
  };
};

/**
 * 预热轮（不计分）。
 *
 * 「回到前台恢复满帧」的抖动来自冷启动：第一页要付 WebGL 管线/着色器首次编译、
 * 生成纹理首次上传、1.6MB bundle 的解码与 JIT；这段时间里浏览器在隐藏/显示
 * 之间切换后，rAF 与 Phaser 步进都还没进入稳态，恢复段采样读到的就是爬升中的值
 * （CI 26–31 vs 前台 32–38，本机复跑 62）。这不是代码变坏，是**量得太早**。
 *
 * 这里先拿一个**完全独立**的页面跑一轮同样口径的完整测量（静止、拖动、后台、
 * 恢复），读数全部丢弃，只为把首次编译/上传/JIT/频率爬升消化在正式采样之前。
 * 正式轮另开新页，测量口径、阈值、断言条件与用例数量（6 项）一个都没动；
 * 预热轮不产出任何 pass/fail，也不写 EVAL_OUT 的采样文件。
 */
const warmSession = await openSession();
try {
  const warm = await measurePass(warmSession.page);
  console.log(
    `[预热轮] 不计分：绘制指令 ${warm.stats.totalCommands} / `
      + `静止 ${warm.idle.value.toFixed(1)} / 拖动 ${warm.drag.value.toFixed(1)} / `
      + `前台 ${warm.foreground.value.toFixed(1)} / 后台 ${warm.background.value.toFixed(1)} / `
      + `恢复 ${warm.restored.value.toFixed(1)} / `
      + `恢复末秒 rAF ${fpsOf(warm.raf.restored.windows.at(-1)?.medianInterval ?? 0).toFixed(1)}`
      + `（本轮读数全部丢弃）`,
  );
} catch (error) {
  console.log(`[预热轮] 不计分：预热失败（${error.message}），继续正式采样`);
} finally {
  await warmSession.page.close();
}

const session = await openSession();
const measured = await measurePass(session.page);
const { stats, idle, drag, foreground, background, restored } = measured;

check(
  stats.totalCommands < MAX_COMMANDS,
  `[计分轮] 绘制指令低于 ${MAX_COMMANDS}`,
  `[计分轮] 实际 ${stats.totalCommands}`,
);
check(
  stats.graphicsObjects < 40,
  'Graphics 对象数量正常',
  `实际 ${stats.graphicsObjects}`,
);

check(
  drag.value >= idle.value * MIN_DRAG_RATIO,
  '拖动时帧率不明显低于静止',
  `静止 ${idle.value.toFixed(1)}（采样 ${fmtSamples(idle.samples)}）/ `
    + `拖动 ${drag.value.toFixed(1)}（采样 ${fmtSamples(drag.samples)}）`,
);
/**
 * 后台降频判据（2026-11-05 起改成双条件，见 `render-budget-threshold.ts`）：
 * `后台 < 前台` 且（`后台 ≤ 前台/3` **或** `后台 ≤ 12 帧`）。
 *
 * 旧判据只有比例那一条，在慢 runner 上会假红：前台 19 帧时要求后台降到 6.3 以下，
 * 而省电模式的下限本就在 10 帧附近。加的是 12 帧地板，比例条件一个字没放宽
 * （前台 60 帧 / 后台 21 帧仍然红）。用例见 `test/render-budget-throttle.test.ts`。
 */
check(
  backgroundThrottleOk(foreground.value, background.value),
  '切到后台真的降频',
  `前台 ${foreground.value.toFixed(1)}（采样 ${fmtSamples(foreground.samples)}）/ `
    + `后台 ${background.value.toFixed(1)}（采样 ${fmtSamples(background.samples)}）`
    + `（要求：后台 < 前台，且 ≤ 前台/${MIN_BACKGROUND_DIVISOR} 或 ≤ ${BACKGROUND_FLOOR_FPS} 帧）`,
);
/**
 * 恢复满帧的判据（阈值未动，量法变了）。
 *
 * 1. **末秒**：恢复段最后 1 秒的 rAF 间隔中位 ≤ 前台间隔中位 / 0.9。
 *    换回帧率说就是「末秒帧率 ≥ 前台 × 0.9」。间隔越小越快，方向反过来写
 *    （间隔 ≥ 前台 × 0.9）会变成「恢复不许比前台快」，与 0.9 的原意相反。
 * 2. **逐秒底线**：恢复段每个 1 秒窗口的帧率 ≥ 前台 × 0.5。
 *    防「先崩后爬」被末秒判过。
 */
const frontRafFps = fpsOf(measured.raf.foreground.medianInterval);
const restoreRaf = measured.raf.restored;
const restoreWindowFps = restoreRaf.windows.map((window) => fpsOf(window.medianInterval));
const tailWindow = restoreRaf.windows.at(-1);
const tailFps = tailWindow ? fpsOf(tailWindow.medianInterval) : 0;
const tailOk = tailWindow ? tailWindow.medianInterval <= measured.raf.foreground.medianInterval / RESTORE_RATIO : false;
const floorOk = restoreWindowFps.length > 0
  && restoreWindowFps.every((fps) => fps >= frontRafFps * RESTORE_FLOOR_RATIO);

check(
  tailOk && floorOk,
  '回到前台恢复满帧',
  `恢复整段 ${fpsOf(restoreRaf.medianInterval).toFixed(1)} / 末秒 ${tailFps.toFixed(1)} / `
    + `逐秒 ${restoreWindowFps.map((fps) => fps.toFixed(1)).join('/')} / `
    + `前台 ${frontRafFps.toFixed(1)}（逐秒底线 ${(frontRafFps * RESTORE_FLOOR_RATIO).toFixed(1)}）；`
    + `推进口径 恢复 ${restored.value.toFixed(1)}（采样 ${fmtSamples(restored.samples)}）`
    + ` / 前台 ${foreground.value.toFixed(1)}`,
);

check(session.errors.length === 0, '全程无 JS 报错', session.errors.join('; '));

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
        thresholds: {
          minDragRatio: MIN_DRAG_RATIO,
          minRestoreRatio: RESTORE_RATIO,
          restoreFloorRatio: RESTORE_FLOOR_RATIO,
          maxBackgroundDivisor: MIN_BACKGROUND_DIVISOR,
          maxBackgroundFloorFps: BACKGROUND_FLOOR_FPS,
        },
        fps: { idle, drag },
        advances: { foreground, background, restored },
        raf: {
          foreground: { medianInterval: measured.raf.foreground.medianInterval },
          restored: {
            medianInterval: restoreRaf.medianInterval,
            windows: restoreRaf.windows,
          },
        },
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
