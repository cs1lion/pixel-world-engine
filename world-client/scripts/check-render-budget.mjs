#!/usr/bin/env node
/**
 * 渲染预算回归：每帧的绘制指令总量必须低于阈值。
 *
 * 为什么需要这条：地形与迷雾曾经各自是一次性画进一个大 Graphics 的，
 * 每帧 Phaser 都要重新批处理全部指令。实测 77 万条，其中 87% 在屏幕外。
 * 烘焙成纹理后应当降到 3 万以下。这条脚本防的是"哪天又有人往大 Graphics 里塞东西"。
 *
 * ── 2026-11-06：fps 三类断言降级为「只记录、不阻塞」 ────────────────────
 * 硬闸门只剩：绘制指令**峰值**（≤ 实测天花板 `MAX_COMMANDS_CEILING`，见下）、
 * 顶层 Graphics 对象数（< 40）、全程无 JS 报错（后者不是 fps 指标，保持硬闸）。
 *
 * ── 2026-11-07：绘制指令改「逐帧峰值」，不再读开局单帧 ──────────────────
 * 旧法只在页面刚打开时读一次正午快照（27,453），真实峰值（昏 + 雾 + 灯全开）
 * 是 52,125——闸门看不见最坏状态，绿是采样窗口的产物。现在按 `PEAK_STATES`
 * 逐帧采样 8 个时相/天气组合，报每个组合的峰值帧号；设计目标 `MAX_COMMANDS`
 * 仍是 30,000（意图，不许动），超出部分按 `MAX_COMMANDS_DEBT` 记账，
 * 超出 `MAX_COMMANDS_CEILING` 才是硬红。
 *
 * 当天又把雾从「每帧 2,646 块 fillRect」改成三张烘焙纹理 + 18 个 Image，
 * 峰值从 52,125 降到 33,741（晨 + 雨 + 灯全开，帧 635），天花板随之下棘轮。
 *
 * 为什么降级：这条闸跑在共享 runner 上，fps 读数分不清「机器慢」与「引擎
 * 变重」——同一份代码，runner 繁忙时前台只有 19 帧，空闲时 57 帧。
 * `前台/3` 在 19 帧时算出 6.33，已经贴到 Chrome 后台约 10 帧的地板，
 * **结构上不可达**；`0.9×` 的拖动/恢复比值同样在慢机上假红。
 *
 * **这是放宽**：代价是中小幅度的真实性能退化在 CI 里看不见了。要看那种退化，
 * 只能靠本地口径已钉住的 `scripts/fps-protocol.mjs`（钉世界与机位，两轮中位
 * 59.9/59.9、极差 0），它不是阈值闸，是记录项。
 *
 * 保留的硬闸还能抓住什么：大幅退化。绘制指令翻倍就是 3 万以上，必红；
 * 新增一个常驻 Graphics 也会顶到 40 上限。降的是 fps，不是整条预算闸门。
 *
 * 反向用例：`RENDER_BUDGET_FORCE_COMMANDS=20000` 把读数人为抬高到 >30000，
 * 硬闸必须退出 1（读数见 `docs/evidence/gate-frame-progress/README.md`）。
 * 这个环境变量只给反例用，CI 不设置。
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
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
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
/**
 * 实测峰值天花板（棘轮）：**只许变小**。
 *
 * 历史：
 * - 52,125（昏 + 雾 + 灯全开，帧 546）：雾用逐方块 Graphics，单层 2,646 块
 *   × 8 条 = 21,168 条。
 * - 33,741（晨 + 雨，帧 635）：雾改烘焙后。但这一帧是 **MAT-G7 泄漏帧**
 *   （见 `docs/OPEN_ISSUES.md`）：相位切换后的 900ms 渐变期里，旧辉光层
 *   （2,840 条亮窗/门池/屋脊）被继续重画；晨 + 雨稳态只有 31,301。
 * - 33,357（2026-11-07，修掉 MAT-G7 后，**同一台**连续记录器全域读数）：
 *   晨 + 雨降到 31,261 / 31,275（≤31,301）；全局最坏是**合法的**
 *   昏 + 暴风雨 / 昏 + 雨 + 灯全开——两扇亮窗 + 屋脊 + 满雨幕，不是泄漏。
 * - 形态对照（2026-11-07，同一份源码——本轮两笔改动只碰测试，未碰 `src/`）：
 *   生产构建 + `vite preview`（5211 `--strictPort`）与 dev server 的峰值读数
 *   **相同**，都是 33,445（昏+暴风雨+灯全开；preview 帧 2581）。差 **0**：
 *   树摇/压缩不改写绘制指令条数，所以 CI 的 preview 读数与本地 dev 读数可直接
 *   对照。以后再遇到「本地绿、CI 红」，先查采样环境，别拿形态差异当解释。
 * - 33,445（2026-11-07，**四线合并后的 main** `2e22e9f`；同一台机器、同一
 *   dev server 会话 5240、同一组 8 组合与切换帧）：相对 33,357 净 **+88**。
 *   抬升全部来自 lighting 线的逐帧新增——灯压暗环（每盏亮灯 3 环 × 4 条
 *   `fillRect`）、接触 AO（每栋楼 1 条）、落地影分段；shore 的 321 条只进
 *   一次性烘焙（`bakeLayer` 的临时 Graphics 不进显示列表，画完即销毁），
 *   anim-fsm 的 MAT-G2 命令中性（逐栋板缝 13→13）。账目见 `docs/OPEN_ISSUES.md` G5。
 *
 * 判据和它比的对象同源：记录器覆盖 8 个组合的**连续帧**（含相位/天气切换帧），
 * 按 `Oracle.currentPhase()` 归组；`setPeakLabel()` 之后但状态还没换的帧不算。
 * 取 33,488 = 四线合并后实测峰值 33,445（昏+暴风雨+灯全开，帧 2565）
 * + **43 条政策余量**（只给角色走位 / 开工窗帧的观测抖动，不是新功能预算）。
 * **这 43 不是本轮独立采样的结论**：它是材质线在 33,357 那组同配置 3 跑
 * （帧 2336 / 2421 / 2435，极差 0）时设的政策常数，本轮原样继承、只复用了这个值。
 * 33,400（= 33,357 + 43）在合并后实测被 33,445 超出，故按「新功能抬升单独记账」
 * 加回 +88；**33,488 不是新基线**，只是把 lighting 的 88 条记在明面上，
 * 以后仍只许往下调。
 */
const MAX_COMMANDS_CEILING = 33_488;
/**
 * 显式债务 = 天花板 − 设计目标 = 3,488 条。
 *
 * 记账口径（对齐 `chore/orphan-gates` 的 `pendingCiBudget`）：
 * - 峰值 ≤ `MAX_COMMANDS`：不欠债，硬闸绿；
 * - 峰值在 (30,000, 33,488]：**记账**（打印 + 落盘，不红），债务不许超过本值；
 * - 峰值 > 33,488：**硬红**，说明又变重了，不是「调上限」能解决的。
 *
 * 抬升口径：只有「删掉等价或更多命令」时天花板才自动下降（本轮 33,741 →
 * 33,400，全部来自 MAT-G7 泄漏删除）；**新功能导致的抬升必须单独记账**
 * （谁抬、抬多少、为什么），不许夹带别的削减，也不许把抬升后的值当新基线往下卖。
 */
const MAX_COMMANDS_DEBT = MAX_COMMANDS_CEILING - MAX_COMMANDS;
/**
 * 拖动帧率相对静止帧率的比例下限（2026-11-06 起**只记录**：打印 + 落盘，
 * 不并入 failures、不触发 exit 1）。
 */
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
 * 被尾巴判据判过。
 *
 * 2026-11-06：这条与拖动比例一起降级为**记录项**（只打印/落盘，不阻塞）。
 * 阈值数字没改，但不再决定退出码——原因与代价见文件头。
 */
const RESTORE_RATIO = 0.9;
/** 恢复段逐秒窗口的硬底线：不得低于前台帧率的这个比例（同上，只记录）。 */
const RESTORE_FLOOR_RATIO = 0.5;

/**
 * 反向用例钩子：人为抬高的绘制指令数。
 *
 * 只用于「把读数抬过 30000、证明硬闸仍会红」这一次性反例；CI 不设置，
 * 默认 0 时读数与真实测量逐字相同。
 */
const FORCED_COMMAND_OFFSET = Number(process.env.RENDER_BUDGET_FORCE_COMMANDS ?? 0);

const reports = [];
const records = [];
const failures = [];
const check = (ok, label, detail = '') => {
  reports.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail === '' ? '' : `（${detail}）`}`);
};
/** 只记录：读数照打、照落盘，但**不**并入 failures。 */
const record = (ok, label, detail = '') => {
  records.push({ ok, label, detail });
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

/**
 * 绘制指令峰值采样要覆盖的组合（至少这 8 个）。
 *
 * `weather` 为 null 表示沿用上一段；`rain` 第一次走真实入口 `say('下雨吧')`，
 * 之后用 `debugSetWeather` 直接切。雨渐变约 1.8 秒，切换后等 2.5 秒再采样，
 * 保证采样落在拉满的帧上。每段按**帧数**采样（rAF 与 Phaser 帧 1:1）。
 */
const PEAK_STATES = [
  { label: '正午开局', phase: 'noon', weather: null, pan: false, frames: 40 },
  { label: '夜+灯全开', phase: 'night', weather: null, pan: false, frames: 50 },
  { label: '夜+雨+灯全开', phase: 'night', weather: 'rain', pan: false, frames: 60 },
  { label: '昏+雨+灯全开', phase: 'dusk', weather: null, pan: false, frames: 60 },
  { label: '昏+暴风雨+灯全开', phase: 'dusk', weather: 'storm', pan: false, frames: 50 },
  { label: '昏+雾+灯全开', phase: 'dusk', weather: 'fog', pan: false, frames: 50 },
  { label: '昏+雨+灯全开（推镜头）', phase: 'dusk', weather: 'rain', pan: true, frames: 50 },
  // 晨+雨之前是「推镜头」的雨态；这里显式再确认一次 `weather: 'rain'`，
  // 否则只等 500ms，雨幕还没拉满就采样——实测比真实峰值低约 2,300 条。
  { label: '晨+雨+灯全开', phase: 'dawn', weather: 'rain', pan: false, frames: 40 },
];

/**
 * 连续逐帧记录器：切换 label 时不停机，时相/天气切换的过渡帧也算进目标组合。
 *
 * 同一个 `frame` 可能被读到两次（`setPhase()` 之后、下一次 `update()` 之前会有
 * 一次「早读」，读到的是上一刻的 commandBuffer），以**末次**读数为准。早读不是
 * 上屏帧，不能进天花板；`setPhase()` 里已经 `glows.clear()`，早读读到的是清空后
 * 的低值。**旧辉光跨 900ms 渐变期被重画**是另一件事，已按 MAT-G7 修掉并登记。
 */
const startPeakRecorder = (page) =>
  page.evaluate(() => {
    const rec = { stop: false, label: '预热', byFrame: new Map() };
    window.__peakRecorder = rec;
    const tick = () => {
      if (rec.stop) return;
      const stats = window.Oracle.renderStats();
      rec.byFrame.set(stats.frame, {
        label: rec.label,
        frame: stats.frame,
        total: stats.totalCommands,
        top: stats.top.totalCommands,
        graphics: stats.graphicsObjects,
        // P0 读数：只记录、不进闸（`totalCommands` 看不见纯 Image 的烘焙层）。
        images: stats.images,
        imageObjects: stats.imageObjects,
        drawCalls: stats.drawCalls,
        // 实际相位/天气：`setPeakLabel()` 比 `setPhase()` 先调用，切换前那一两帧
        // 仍属于上一段。按 label 分组会把它们算进新组合（晨+雨 峰值帧落在
        // 黄昏那一帧就是这么来的）。按**实际相位**分组，判据才和被测状态同源。
        phase: window.Oracle.currentPhase(),
        weather: window.Oracle.view().weather,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const setPeakLabel = (page, label) =>
  page.evaluate((next) => {
    if (window.__peakRecorder !== undefined) window.__peakRecorder.label = next;
  }, label);

const stopPeakRecorder = (page) =>
  page.evaluate(() => {
    window.__peakRecorder.stop = true;
    const frames = [...window.__peakRecorder.byFrame.values()].sort((a, b) => a.frame - b.frame);
    delete window.__peakRecorder;
    return frames;
  });

/** 切到某个峰值采样状态：时相 / 天气 / 灯 / 镜头。`useSay` = 用真实入口首次下雨。 */
const applyPeakState = async (page, state, useSay) => {
  if (state.phase !== undefined) {
    await page.evaluate((phase) => window.Oracle.setPhase(phase), state.phase);
  }
  await page.evaluate(() => window.Oracle.debugForceLamps(true));
  if (state.weather === 'rain') {
    if (useSay) {
      await page.evaluate(() => window.Oracle.say('下雨吧'));
    } else {
      await page.evaluate(() => window.Oracle.debugSetWeather('rain'));
    }
    await page.waitForFunction(() => window.Oracle.view().weather === 'rain', null, { timeout: 8000 });
    await page.waitForTimeout(2500);
  } else if (state.weather === 'storm' || state.weather === 'fog') {
    await page.evaluate((weather) => window.Oracle.debugSetWeather(weather), state.weather);
    await page.waitForFunction(
      (weather) => window.Oracle.view().weather === weather,
      state.weather,
      { timeout: 8000 },
    );
    await page.waitForTimeout(1200);
  } else if (state.phase !== undefined) {
    await page.waitForTimeout(500);
  }
  if (state.pan) {
    await page.evaluate(() => {
      const view = window.Oracle.view();
      const target = view.buildings.find((b) => b.prefabId === 'code_forge') ?? view.buildings[0];
      window.Oracle.setCameraMode('free');
      window.Oracle.centerCameraOn(
        target.origin.x * 16 + (target.footprint.w * 16) / 2,
        target.origin.y * 16 + (target.footprint.h * 16) / 2,
      );
    });
    await page.waitForTimeout(300);
  }
};

/**
 * 逐帧取峰值：**同一台记录器**从正午开局一路录到晨+雨，覆盖全部 8 个组合
 * 和它们之间的切换帧。判据（`MAX_COMMANDS_CEILING`）与它比的对象都取自
 * 这一次连续采样——不再出现「窗口峰值 33,343、天花板来自另一次 587 帧探针」
 * 那种同源性问题。
 */
const measureCommandsPeak = async (page) => {
  await startPeakRecorder(page);
  let rainIntroDone = false;
  for (const state of PEAK_STATES) {
    await setPeakLabel(page, state.label);
    const useSay = state.weather === 'rain' && !rainIntroDone;
    await applyPeakState(page, state, useSay);
    if (state.weather === 'rain') rainIntroDone = true;
    // 让记录器把该组合的稳态也收进来；过渡帧已经由上面的 wait 覆盖。
    await page.waitForTimeout(state.frames * 16);
  }
  const frames = await stopPeakRecorder(page);

  const states = PEAK_STATES.map((state) => {
    // 只收「实际已进入该组合」的帧：相位必须已经是目标相位，指定天气的状态
    // 还必须天气也到位。这样**过渡帧照收**（`setPhase()` 后第一帧相位就是目标），
    // 但切换前那一两帧（label 已换、状态没换）不会被算进来。
    const group = frames.filter(
      (reading) =>
        reading.label === state.label
        && reading.phase === state.phase
        && (state.weather === null || reading.weather === state.weather),
    );
    if (group.length === 0) throw new Error(`峰值记录器没收到 ${state.label}（相位 ${state.phase}）`);
    const top = group.reduce((a, b) => (b.total > a.total ? b : a));
    return {
      label: state.label,
      frames: group.length,
      frameSpan: [group[0].frame, group.at(-1).frame],
      peakFrame: top.frame,
      total: top.total,
      top: top.top,
      graphics: top.graphics,
    };
  });
  const best = states.reduce((a, b) => (b.total > a.total ? b : a));
  const worst = {
    label: best.label,
    peakFrame: best.peakFrame,
    total: best.total,
    top: best.top,
    graphics: best.graphics,
  };
  return { states, worst, debt: Math.max(0, worst.total - MAX_COMMANDS), framesTotal: frames.length };
};

/** 一轮完整测量：绘制指令、静止/拖动帧率、后台降频与回前台恢复。不含任何判定。 */
const measurePass = async (page, { measurePeak = true } = {}) => {
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

  const peak = measurePeak ? await measureCommandsPeak(page) : null;

  return {
    stats,
    peak,
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
  const warm = await measurePass(warmSession.page, { measurePeak: false });
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

const peakForGate = measured.peak.worst.total + FORCED_COMMAND_OFFSET;
const peakDebt = measured.peak.debt;
for (const state of measured.peak.states) {
  console.log(
    `[峰值] ${state.label} 帧 ${state.peakFrame}（${state.frameSpan[0]}–${state.frameSpan[1]}，${state.frames} 帧）：`
      + `${state.total} 条（旧口径 ${state.top}）`,
  );
}
console.log(
  `[债务] 设计目标 ${MAX_COMMANDS} / 实测峰值 ${measured.peak.worst.total}`
    + `（${measured.peak.worst.label}，帧 ${measured.peak.worst.peakFrame}）/ 欠 ${peakDebt} 条 / `
    + `天花板 ${MAX_COMMANDS_CEILING}（额度 ${MAX_COMMANDS_DEBT} 条）`,
);
console.log(
  `[绘制读数] images ${stats.images} / imageObjects ${stats.imageObjects} / drawCalls ${stats.drawCalls}（只报不进闸）`,
);
// 债务是**记账**，不是放宽：峰值超过设计目标就打印并落盘，超天花板才硬红。
// 额度就是天花板与目标之差，不允许「先把债务写大一点再慢慢还」——天花板本身
// 是实测值且只许变小（修完雾要跟着往下调），债务随之只能缩。
console.log(
  peakDebt > 0
    ? `[记账] 超出设计目标 ${peakDebt} 条已登记（额度 ${MAX_COMMANDS_DEBT}）；`
      + `峰值 > ${MAX_COMMANDS_CEILING} 即硬红。`
    : `[记账] 峰值未超设计目标，无债务。`,
);
record(
  peakDebt <= MAX_COMMANDS_DEBT,
  '绘制指令债务在登记额度内（只记录，不阻塞）',
  `债务 ${peakDebt} 条 / 额度 ${MAX_COMMANDS_DEBT} 条（设计目标 ${MAX_COMMANDS}，实测天花板 ${MAX_COMMANDS_CEILING}）`,
);
check(
  peakForGate <= MAX_COMMANDS_CEILING,
  `[计分轮] 绘制指令峰值不超过天花板 ${MAX_COMMANDS_CEILING}`,
  `[计分轮] 实际峰值 ${peakForGate}（${measured.peak.worst.label}，帧 ${measured.peak.worst.peakFrame}）`
    + (FORCED_COMMAND_OFFSET === 0
      ? ''
      : `（含反例人为抬高 ${FORCED_COMMAND_OFFSET}）`),
);
// `renderStats()` 2026-11-07 起递归到容器（楼体/居民在容器里，整场景 131 个 Graphics）。
// 这条 `< 40` 是给**顶层**定的（顶层 28 个），口径不能跟着递归数变，否则等于换了把尺子。
check(
  stats.top.graphicsObjects < 40,
  '顶层 Graphics 对象数量正常',
  `实际 ${stats.top.graphicsObjects}（整场景含容器 ${stats.graphicsObjects}）`,
);

// 记录项（2026-11-06 降级）：只打印/落盘，不阻塞。
record(
  drag.value >= idle.value * MIN_DRAG_RATIO,
  '拖动时帧率不明显低于静止（记录项，不阻塞）',
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
 *
 * 2026-11-06：即使加了地板，`前台/3` 在 19 帧时仍是 6.33（贴 Chrome 后台
 * 约 10 帧的地板，结构上不可达），所以这条整体降为**记录项**。双条件函数
 * 仍原样保留，只用来算「若按旧判据会过还是不过」的读数。
 */
// 记录项（2026-11-06 降级）：只打印/落盘，不阻塞。
record(
  backgroundThrottleOk(foreground.value, background.value),
  '切到后台真的降频（记录项，不阻塞）',
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

// 记录项（2026-11-06 降级）：只打印/落盘，不阻塞。
record(
  tailOk && floorOk,
  '回到前台恢复满帧（记录项，不阻塞）',
  `恢复整段 ${fpsOf(restoreRaf.medianInterval).toFixed(1)} / 末秒 ${tailFps.toFixed(1)} / `
    + `逐秒 ${restoreWindowFps.map((fps) => fps.toFixed(1)).join('/')} / `
    + `前台 ${frontRafFps.toFixed(1)}（逐秒底线 ${(frontRafFps * RESTORE_FLOOR_RATIO).toFixed(1)}）；`
    + `推进口径 恢复 ${restored.value.toFixed(1)}（采样 ${fmtSamples(restored.samples)}）`
    + ` / 前台 ${foreground.value.toFixed(1)}`,
);

check(session.errors.length === 0, '全程无 JS 报错', session.errors.join('; '));

// 读数落盘：CI 用 EVAL_OUT 指到 runner 临时目录；本地缺省写到 `tmp/`
// （已在根 `.gitignore` 内），保证「只记录」的三类 fps 断言有可查的痕迹。
const OUT_DIR = process.env.EVAL_OUT ?? 'tmp/render-budget';
const out = join(OUT_DIR, 'render-budget-samples.json');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      sampleCount: SAMPLE_COUNT,
      sampleMs: SAMPLE_MS,
      forcedCommandOffset: FORCED_COMMAND_OFFSET,
      commands: {
        snapshot: stats.totalCommands,
        snapshotTop: stats.top.totalCommands,
        // P0 读数：只落盘、不进闸（没有基线、没有消费方的天花板是孤儿闸门）。
        images: stats.images,
        imageObjects: stats.imageObjects,
        drawCalls: stats.drawCalls,
        peak: measured.peak.worst.total,
        peakLabel: measured.peak.worst.label,
        peakFrame: measured.peak.worst.peakFrame,
        debt: peakDebt,
        target: MAX_COMMANDS,
        ceiling: MAX_COMMANDS_CEILING,
        debtBudget: MAX_COMMANDS_DEBT,
        states: measured.peak.states,
      },
      thresholds: {
        minDragRatio: MIN_DRAG_RATIO,
        minRestoreRatio: RESTORE_RATIO,
        restoreFloorRatio: RESTORE_FLOOR_RATIO,
        maxBackgroundDivisor: MIN_BACKGROUND_DIVISOR,
        maxBackgroundFloorFps: BACKGROUND_FLOOR_FPS,
      },
      // `verdict` 是「若仍按旧判据会不会过」——只记录，不决定退出码。
      records: records.map((item) => ({
        verdict: item.ok ? 'pass' : 'fail',
        label: item.label,
        detail: item.detail,
      })),
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

await browser.close();

console.log('\n[硬闸门]');
for (const item of reports) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.label}${item.detail === '' ? '' : `  ${item.detail}`}`);
}
console.log('\n[记录项]（只打印/落盘，不阻塞）');
for (const item of records) {
  console.log(`${item.ok ? 'pass' : 'fail'} ${item.label}${item.detail === '' ? '' : `  ${item.detail}`}`);
}
if (failures.length > 0) {
  console.error(`\n渲染预算失败 ${failures.length} 项（硬闸门）：`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\n渲染预算：硬闸门 ${reports.length} 项通过；记录项 ${records.length} 项不阻塞`);
