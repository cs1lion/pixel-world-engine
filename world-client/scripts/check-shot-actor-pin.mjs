/**
 * 第五枚钉子（角色位置与姿态）的负控夹具。
 *
 * 要证明的事：**等待时长不再进入画面**。
 *
 * 对照组：
 *   - 四钉（时刻 / 潮位 / 相机 / 缩放）+ 冻结前等待 1200ms 与 2800ms
 *     —— 这是钉住之前的三跑 0 差来源：等站定等来的，等待一变就破；
 *   - 五钉（再加 `pinActors`）+ 等待 1200 / 2800 / 5000ms
 *     —— 三档必须逐像素 0 差；
 *   - 反向用例：五钉里把莞尔的坐标故意偏移 1 格，必须判红，且差异块落在
 *     该角色的屏幕包围盒内。
 *
 * 只拍 `#app canvas`：DOM overlay（名字/气泡）与纸面不在画布里，第五枚钉子
 * 管的是渲染层；画布正好 960×640，两跑尺寸必须一致。
 *
 * 跑法：
 *   1. `node node_modules/vite/bin/vite.js --port 5211 --strictPort`
 *   2. `node scripts/check-shot-actor-pin.mjs`
 *   3. 用 `scripts/screens-diff.py` 对三组图出三层读数（精确 / 可见 / 结构）。
 *
 * 环境变量：`PIXEL_WORLD_URL`（默认 http://127.0.0.1:5211/）、
 * `EVAL_OUT`（默认 eval/screens/actor-pin）。
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5211/';
const OUT = process.env.EVAL_OUT ?? 'eval/screens/actor-pin';

/** 默认大世界 05:00 开局；等待时长就是这之后到冻结之间的那段。 */
const WORLD_URL = `${BASE}?feed=off&debug=1&time=dawn&now=300&speed=30`;
const TILE_PX = 16;
const DAY_MS = 86_400_000;
/** 画面钉在当天 07:34（dawn），与 01 构图同一口径。 */
const SHOT_MINUTE_MS = 7 * 3_600_000 + 34 * 60_000;
/** 相机对准莞尔所在的河湾格。 */
const ANCHOR = { x: 52, y: 32 };
/** 等灯相位/压暗层走完的固定收尾：这段时间只让渲染动画收敛，不推进世界。 */
const SETTLE_MS = 2600;

const FOUR_WAITS = [1200, 2800];
const FIVE_WAITS = [1200, 2800, 5000];

/**
 * 第六枚钉：地面痕迹。三档等待**钉同一个常量**，冻结时刻才不进入画面。
 * 坐标取自实测：坞口前那一格 (49,36)，强度 2（恰好只画第一道短横）。
 */
const TRAIL_PINS = [{ at: { x: 49, y: 36 }, strength: 2 }];
/** trail 反向用例：只把这一格往西挪一格，其余一字不动。 */
const TRAIL_SHIFT = [{ at: { x: 48, y: 36 }, strength: 2 }];

/** 把 `#stage` 的绘制原点钉到整数 CSS 像素（与 smoke.mjs 同口径）。 */
const snapStage = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector('#stage');
    stage.style.transformOrigin = 'top left';
    stage.style.transform = '';
    const rect = stage.getBoundingClientRect();
    const snap = {
      dx: Math.round(rect.left) - rect.left,
      dy: Math.round(rect.top) - rect.top,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const tx = snap.dx === 0 && snap.dy === 0 ? '' : `translate(${snap.dx}px, ${snap.dy}px)`;
    stage.style.transform = tx;
    return snap;
  });

/**
 * 五钉的角色值：位置/朝向/mode/walking/帧号/visible 全部写死。
 * 帧号 0/1 是两组不同姿态；它们与真实世界此刻的帧号无关——这正是要点。
 */
const actorPins = (shift = 0) => [
  {
    id: 'v0',
    pos: { x: ANCHOR.x + shift, y: ANCHOR.y },
    facing: 'down',
    mode: 'idle',
    walking: false,
    frame: 0,
    visible: true,
  },
  {
    id: 'v1',
    pos: { x: 48, y: 36 },
    facing: 'up',
    mode: 'idle',
    walking: false,
    frame: 1,
    visible: true,
  },
];

const browser = await chromium.launch({ headless: true });
const results = [];
/** 原始 PNG 字节，只用于结尾的逐字节断言（不进 runs.json）。 */
const pngBytes = new Map();

/**
 * 一次抓拍。`pin` 为 null = 只四钉；否则是五钉的角色集合。
 */
async function capture({
  name,
  waitMs,
  pin,
  shift = 0,
  trails = TRAIL_PINS,
}) {
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* 隐私模式忽略 */
    }
  });
  await page.goto(WORLD_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 15000 });
  await page.evaluate(() => {
    document.documentElement.style.scrollbarGutter = 'stable';
    document.documentElement.style.overflowY = 'scroll';
    document.documentElement.style.overflowX = 'hidden';
  });
  await snapStage(page);

  // 冻结前等待：这一档是自变量。
  await page.waitForTimeout(waitMs);

  const before = await page.evaluate(
    ({ actors, minuteMs, anchor, tile, dayMs, trailPins }) => {
      const snapshot = window.Oracle.view();
      window.Oracle.freezeWorldClock();
      const now = Math.floor(snapshot.now / dayMs) * dayMs + minuteMs;
      window.Oracle.pinShotState(now, 0);
      if (actors !== null) window.Oracle.pinActors(actors);
      if (trailPins !== null) window.Oracle.pinTrails(trailPins);
      window.Oracle.setCameraMode('free');
      window.Oracle.centerCameraOn(anchor.x * tile, anchor.y * tile);
      const cam = window.Oracle.camera();
      return {
        worldNow: snapshot.now,
        // 冻结那一刻**原始的快照**：渲染输入登记表的「随时刻变吗」就靠三档逐字段比。
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        villagers: snapshot.villagers.map((v) => ({
          id: v.id,
          name: v.name,
          pos: { x: v.pos.x, y: v.pos.y },
          mode: v.mode,
          walking: v.walking,
          facing: v.facing,
          visible: v.visible,
        })),
        camera: { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom },
        // 渲染还读两个不在快照里的 world 读数：相位与雨/雾强度。
        // 它们不是快照字段，登记表外列一行；三档是否同值由这里直接读。
        phase: window.Oracle.currentPhase(),
        weatherIntensity: window.Oracle.debugWeatherIntensity?.() ?? null,
        canvas: {
          width: document.querySelector('#app canvas').getBoundingClientRect().width,
          height: document.querySelector('#app canvas').getBoundingClientRect().height,
        },
      };
    },
    {
      actors: pin === null ? null : actorPins(shift),
      minuteMs: SHOT_MINUTE_MS,
      anchor: ANCHOR,
      tile: TILE_PX,
      dayMs: DAY_MS,
      trailPins: trails,
    },
  );

  await page.waitForTimeout(SETTLE_MS);
  const canvas = page.locator('#app canvas');
  const shot = await canvas.screenshot({ path: `${OUT}/${name}.png` });
  pngBytes.set(name, shot);
  await context.close();

  const record = {
    name,
    waitMs,
    fivePin: pin !== null,
    shift,
    trails,
    before,
    errors,
    bytes: shot.length,
  };
  results.push(record);
  console.log(
    `[${name}] 等待 ${waitMs}ms · 冻结时世界 ${Math.round(before.worldNow % DAY_MS / 60_000)} 分 · ` +
      `村民 ${before.villagers.map((v) => `${v.name}@${v.pos.x},${v.pos.y}`).join(' / ')} · ` +
      `画布 ${before.canvas.width}×${before.canvas.height}`,
  );
  if (errors.length > 0) throw new Error(`${name} 页面报错：${errors.join('；')}`);
  return record;
}

await mkdir(OUT, { recursive: true });

const first = await capture({
  name: 'four-1200',
  waitMs: FOUR_WAITS[0],
  pin: null,
  trails: null,
});
// 确认默认世界就是两个角色；多出来的角色没钉住会污染「等待无关」的结论。
if (first.before.villagers.length !== 2) {
  throw new Error(
    `默认世界应只有两个角色，实测 ${first.before.villagers.length} 个：` +
      first.before.villagers.map((v) => `${v.id}/${v.name}`).join('，'),
  );
}

for (const waitMs of FOUR_WAITS.slice(1)) {
  await capture({ name: `four-${waitMs}`, waitMs, pin: null, trails: null });
}
for (const waitMs of FIVE_WAITS) {
  await capture({ name: `five-${waitMs}`, waitMs, pin: true });
}
// 反向用例 1：同一档等待、同一套六钉，只把莞尔挪一格。
await capture({ name: 'five-shift', waitMs: FIVE_WAITS[0], pin: true, shift: 1 });
// 反向用例 2：只把钉住的那条痕迹往西挪一格，数量不变、位置变一处。
await capture({ name: 'trail-shift', waitMs: FIVE_WAITS[0], pin: true, trails: TRAIL_SHIFT });

await writeFile(`${OUT}/runs.json`, JSON.stringify(results, null, 2), 'utf8');
await browser.close();

/*
 * 逐字节负控：像素读数由 `screens-diff.py` 出，这里只做二值判定。
 *   - 三档等待：必须与 five-1200 逐字节相同（改一处就抛）；
 *   - 两条反向用例：必须与 five-1200 不同（变成空操作就抛）。
 * 判据用字节而不是「近似相等」：同一像素数组的 PNG 编码是确定的。
 */
const baseline = pngBytes.get('five-1200');
for (const name of ['five-2800', 'five-5000']) {
  if (!baseline.equals(pngBytes.get(name))) {
    throw new Error(`${name} 必须与 five-1200 逐字节相同，实测不同`);
  }
}
for (const name of ['five-shift', 'trail-shift']) {
  if (baseline.equals(pngBytes.get(name))) {
    throw new Error(`${name} 是反向用例，必须与 five-1200 不同，实测相同`);
  }
}
console.log('逐字节负控：三档等待全同；两条反向全异');
console.log(`\n抓拍完成：${OUT}`);
