/* 神谕闭环的浏览器回归。
 *
 * 验的不是"能编译"，而是用户在屏幕上能看到的四件事：
 *   1. 开局小人在祭坛边自己走动
 *   2. 一句话神谕 → 行礼 → 走进对应铺子 → 铺子开工
 *   3. 交付 → 人出现在门口 → 回到祭坛
 *   4. 认不出的话不让世界动
 *
 * 两种模式：
 *   - 默认（?feed=off）：纯沙盒，不依赖本地服务
 *   - `FEED=1 node scripts/smoke.mjs`：接服务端事件流，验"上游的活能驱动这个世界"
 *
 * 真实 HTTP 那一条（意图端点 + 事件库 + 离线降级）在 `scripts/accept-live.mjs`，
 * 它自己起隔离的服务端与前端，不需要先跑 `npm run dev`。
 *
 * 跑法（先 `npm run dev:live` 把世界起起来）：
 *   node scripts/smoke.mjs                  # 沙盒模式
 *   FEED=1 node scripts/smoke.mjs           # 事件流模式（服务端那半也得在）
 *
 * 端口不是 5188 时用 `PIXEL_WORLD_URL` 指过去。
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { projectWorldToCanvas, TILE_PX } from './lib/camera-projection.mjs';

const URL_BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';
const OUT = process.env.EVAL_OUT ?? 'eval/screens';
// 事件流模式：先起服务端（8000），再 `FEED=1 node scripts/smoke.mjs`。
const FEED = process.env.FEED === '1';
// 显式注入的昼夜阶段。默认正午；要验「换一个本地时刻也成立」时
// `SMOKE_TIME=dawn|dusk|night` 各跑一次，脚本不再读 `Date.now()`。
const SMOKE_TIME = process.env.SMOKE_TIME ?? 'noon';
// `?time=` 只换画面光照，**模拟时钟**另算（默认从 00:00 起）。世界有了回家语义后，
// 夜里居民真的在屋里，脚本中段那些「户外的她」断言会落空。所以用 `?now=`
// 把模拟起点也钉到同一刻（调试层参数，整数世界分钟，见 `scenes/debug-now.ts`）。
//
// 正午这一档钉 **10:00（600 分）** 而不是 12:00：12:00–14:00 是安静段
// （`hasEnvironment('quiet')`），全镇回锚点坐着，「没人管的时候她会自己走动」
// 等 120 秒也等不到脚步。
// 06:30 / 10:00 / 18:00 / 22:30 → 390 / 600 / 1080 / 1350（整数分钟，唯一写法）。
const SMOKE_NOW_MINUTES = { dawn: 390, noon: 600, dusk: 1080, night: 1350 }[SMOKE_TIME] ?? 600;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

// 先清一次存档：上一次异常中断可能留下进行中的世界，会让“开局她在闲逛”误红。
// 用 addInitScript 在页面脚本之前清，且只清第一次导航（sessionStorage 标记）——
// 若改成“先 goto 再 clear”，第一份世界会在离开页面时把内存状态自动存档回来。
await page.addInitScript(() => {
  try {
    if (sessionStorage.getItem('xiaoxi.smoke.cleared') === null) {
      localStorage.clear();
      sessionStorage.setItem('xiaoxi.smoke.cleared', '1');
    }
  } catch {
    /* 隐私模式等场景忽略 */
  }
});

const checks = [];
const check = (ok, label) => {
  assert.ok(ok, label);
  checks.push(label);
};

const state = () => page.evaluate(() => window.Oracle.view());

/**
 * DOM overlay 与 canvas 的对齐读数。
 *
 * 期望坐标走脚本层共享的 `projectWorldToCanvas`（与生产 `viewOriginOf` /
 * `projectWorldToOverlay` 同式）：`scroll` 是**镜头中心**，overlay 摆的是
 * **视野原点**，且投影要乘相机 `zoom`。早先这里用 `(worldX - scrollX) * scale`，
 * zoom=2 时整层文字偏了半个视野。
 */
const measureOverlayFit = async () => {
  const raw = await page.evaluate(() => {
    const canvas = document.querySelector('#app canvas');
    const overlay = document.querySelector('#world-overlay');
    const names = [...document.querySelectorAll('#world-overlay .overlay-name')];
    const snapshot = window.Oracle.view();
    const canvasRect = canvas.getBoundingClientRect();
    const villager = snapshot.villagers[0];
    const nameEl = names[0];
    return {
      camera: window.Oracle.camera(),
      rect: { width: canvasRect.width, height: canvasRect.height },
      gameSize: { width: canvas.width, height: canvas.height },
      villagerPos: { x: villager.pos.x, y: villager.pos.y },
      actual: {
        x: Number.parseFloat(nameEl?.style.left ?? 'NaN'),
        y: Number.parseFloat(nameEl?.style.top ?? 'NaN'),
      },
      names: names.length,
      villagers: snapshot.villagers.length,
      text: nameEl?.textContent ?? '',
      expectedName: villager.name,
      overlayWidth: overlay?.getBoundingClientRect().width ?? 0,
      canvasWidth: canvasRect.width,
      bubblesVisible: [...document.querySelectorAll('#world-overlay .overlay-bubble')].filter(
        (node) => node.style.display !== 'none',
      ).length,
    };
  });
  const expected = projectWorldToCanvas(
    (raw.villagerPos.x + 0.5) * TILE_PX,
    (raw.villagerPos.y + 1) * TILE_PX - 40,
    raw.camera,
    raw.rect,
    raw.gameSize,
  );
  return {
    ...raw,
    zoom: raw.camera.zoom,
    error: Math.hypot(raw.actual.x - expected.x, raw.actual.y - expected.y),
    tolerance: Math.max(1, raw.rect.width / raw.gameSize.width),
  };
};

// 节奏 60 的观察窗口：步行一格 1 世界分钟 = 1 现实秒，镇内单程约 5 秒、
// 郊野单程约 25–30 秒；长活本身 code 30 分钟、research 20、writing 15。
// 「赶路 + 干活 + 回程」一轮可以到 80 秒以上，原来的 25 秒默认窗口是按
// 6 倍速定的。条件一个字不改，只把等待上限放宽到 120 秒。
const waitFor = async (predicate, label, timeout = 120000) => {
  const started = Date.now();
  // 进度日志：卡住时能看出停在哪一条等待上（只写 stdout，不影响画面）。
  console.log(`wait  ${label}`);
  for (;;) {
    const snapshot = await state();
    if (predicate(snapshot)) {
      checks.push(label);
      return snapshot;
    }
    if (Date.now() - started > timeout) {
      throw new Error(`超时：${label}\n最后状态 ${JSON.stringify(snapshot.villager)}`);
    }
    await page.waitForTimeout(120);
  }
};

/**
 * 截图前把镜头钉死。
 *
 * 导播闲置 15 秒后接管、有活就跟着干活的人平移——同码两跑的 01–06 因此
 * 取景不同（05-build 实测可见差 9%）。这一条在每张叙事图前把镜头切 free
 * 并对准那个人所在的**整格**：背景固定，人还在画面中间。
 */
const pinShotCamera = async () => {
  const pos = await page.evaluate(() => window.Oracle.view().villager.pos);
  await page.evaluate(
    ({ x, y }) => {
      window.Oracle.setCameraMode('free');
      window.Oracle.centerCameraOn(x, y);
    },
    { x: Math.round(pos.x) * TILE_PX, y: Math.round(pos.y) * TILE_PX },
  );
  await page.waitForTimeout(250);
};

/**
 * 等两人真正站定：`idle` + 不走 + 没活，且位置连拍三下不变（450ms）。
 *
 * 只看「位置指纹两次相同」会抓到两人在瓷砖之间停一拍的空档，冻下来的落点
 * 两跑能差半个画面（08 实测莞尔有时在祭坛前、有时在左下角）。
 * 06 原来只等主控空闲就冻钟，阿雾可能还在走，两跑差 0.19%（差在阿雾的
 * idle 姿态与位置）；07/08 与 06 现在共用这一条判据。
 */
const waitVillagersSettled = async (label = '两人迟迟没有站定') => {
  const started = Date.now();
  let previous = null;
  let same = 0;
  for (;;) {
    const snapshot = await page.evaluate(() => ({
      pos: window.Oracle.view().villagers.map((v) => `${v.name}:${v.pos.x},${v.pos.y}`).join('|'),
      standing: window.Oracle.view().villagers.every(
        (v) => v.mode === 'idle' && v.walking === false && v.taskId === null,
      ),
    }));
    same = previous !== null && snapshot.standing && snapshot.pos === previous ? same + 1 : 0;
    previous = snapshot.pos;
    if (same >= 3) return;
    if (Date.now() - started > 120000) throw new Error(label);
    await page.waitForTimeout(150);
  }
};

/**
 * 只测量用：把「呈现时刻 + 潮位 + 镜头」一起钉住（`PIN_SHOTS=1`）。
 *
 * 默认关闭，正常抓拍口径一字不改。打开时每张图拍完立刻解钉解冻，
 * 世界照原样往下跑，判据读的仍是真快照。
 *
 * `anchor` 给 `{x, y}` 时镜头钉在整格；`null` 表示沿用 `pinShotCamera()`
 * 刚对好的位置（那一步也是整格对齐）。
 */
const PIN_SHOTS = process.env.PIN_SHOTS === '1';
const SHOT_MINUTE_MS = 45_000_000; // 当天 12:30，与 07/08 同一口径

const pinForShot = async (anchor) => {
  if (!PIN_SHOTS) return;
  await page.evaluate(
    ({ anchor, minuteMs }) => {
      window.Oracle.freezeWorldClock();
      const snapshot = window.Oracle.view();
      window.Oracle.pinShotState(
        Math.floor(snapshot.now / 86400000) * 86400000 + minuteMs,
        0,
      );
      if (anchor !== null) {
        window.Oracle.setCameraMode('free');
        window.Oracle.centerCameraOn(anchor.x, anchor.y);
      }
    },
    { anchor, minuteMs: SHOT_MINUTE_MS },
  );
  await page.waitForTimeout(300);
};

const unpinForShot = async () => {
  if (!PIN_SHOTS) return;
  await page.evaluate((pin) => {
    if (pin) window.Oracle.unpinShotState();
    window.Oracle.unfreezeWorldClock();
  }, PIN_SHOTS);
};

const DAY_MS = 86_400_000;

/**
 * 01 的构图锚点（2026-11-06 用户裁决 A / 规则二）。
 *
 * 05:00–12:00 逐分钟扫默认大世界，含 `祭坛(48,36)` 的合法组合里离 07:05
 * 最近的是 **07:34**（实测 07:34–07:43 每分成立）：
 *   莞尔 河湾 (52,32)、阿雾 祭坛 (48,36)，两人都 `idle` / 不走 / 无活动任务、
 *   都可见、同框；祭坛投影也在画框内。
 * 次近的 07:51（街口+祭坛）晚 17 分钟，08:46（祭坛+河湾）晚 101 分钟。
 */
const SALUTE_PIN_MINUTE_MS = 7 * 3_600_000 + 34 * 60_000;
const SALUTE_ANCHOR = { x: 52, y: 32 };
const SALUTE_ALTAR = { x: 48, y: 36 };

const isStandingIdle = (villager) =>
  villager.walking === false && villager.mode === 'idle' && villager.taskId === null;

/**
 * 01 构图夹具：**独立页面从 05:00 开机**，等早晨的构图自然长出来。
 *
 * 为什么另起一页：主页面从 `?now=600`（10:00）开局，向前只能走，永远到不了
 * 当天早晨；`jumpWorldClock` 回拨只改 `now`、不重算世界（`rewindNow` 只动
 * 时钟），那等于伪造早晨。这里用与主页面同尺寸的独立 context，从 05:00 自然
 * 跑到 07:34，世界状态与扫描探针同一口径。
 *
 * 钉的是呈现时刻 07:34 + 潮位 0；`?time=dawn`——07:34 属 dawn（day-phase.ts
 * 的 5–9 点边界），画面必须是晨光，不能拿 noon 光照冒充晨时。旧基线用
 * noon 光照却钉 07:05（底栏晨时、画面正午），本轮作废重录。
 *
 * 硬超时：等构图 600 秒实时；派活后 120 秒内必须看到 `mode === 'saluting'`
 * （行礼的世界事实，渲染层据此下蹲 2px）。任一超时直接判红并打印现场，
 * 不降级拍别的构图。
 */
const captureSalute01 = async () => {
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
  const shotPage = await context.newPage();
  const shotErrors = [];
  shotPage.on('pageerror', (error) => shotErrors.push(error.message));
  await shotPage.addInitScript(() => {
    try {
      if (sessionStorage.getItem('xiaoxi.smoke.salute.cleared') === null) {
        localStorage.clear();
        sessionStorage.setItem('xiaoxi.smoke.salute.cleared', '1');
      }
    } catch {
      /* 隐私模式等场景忽略 */
    }
  });
  await shotPage.goto(
    `${URL_BASE}?feed=off&debug=1&time=dawn&now=300&speed=30`,
    { waitUntil: 'load' },
  );
  await shotPage.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 15000 });
  check(shotErrors.length === 0, '01 专用页面加载无 JS 报错');
  await shotPage.evaluate(() => {
    document.documentElement.style.scrollbarGutter = 'stable';
    document.documentElement.style.overflowY = 'scroll';
    document.documentElement.style.overflowX = 'hidden';
  });
  await snapStage(shotPage);

  const deadline = Date.now() + 600_000;
  let found = null;
  let lastMinute = -1;
  while (Date.now() < deadline) {
    const snapshot = await shotPage.evaluate(() => window.Oracle.view());
    const [wan, wu] = snapshot.villagers;
    const minute = Math.floor((snapshot.now % DAY_MS) / 60_000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      if (minute % 5 === 0) {
        const hh = Math.floor(minute / 60);
        const mm = String(minute % 60).padStart(2, '0');
        console.log(`01 等构图：第 ${minute} 分（${hh}:${mm}）`);
      }
    }
    const compositionOK =
      wan !== undefined && wu !== undefined &&
      isStandingIdle(wan) && isStandingIdle(wu) &&
      wan.visible && wu.visible &&
      Math.round(wan.pos.x) === SALUTE_ANCHOR.x &&
      Math.round(wan.pos.y) === SALUTE_ANCHOR.y &&
      Math.round(wu.pos.x) === SALUTE_ALTAR.x &&
      Math.round(wu.pos.y) === SALUTE_ALTAR.y;
    if (compositionOK) {
      found = snapshot;
      break;
    }
    await shotPage.waitForTimeout(250);
  }
  if (found === null) {
    const fail = await shotPage.evaluate(() => {
      const snapshot = window.Oracle.view();
      return {
        minute: Math.floor((snapshot.now % 86_400_000) / 60_000),
        villagers: snapshot.villagers.map((v) => ({
          name: v.name, pos: v.pos, mode: v.mode, walking: v.walking,
          taskId: v.taskId, visible: v.visible, routine: v.routine,
        })),
      };
    });
    console.error('01 构图夹具 600s 超时：', JSON.stringify(fail, null, 2));
    throw new Error(`01 构图夹具超时（600s）：第 ${fail.minute} 分`);
  }
  const [wan, wu] = found.villagers;
  check(Math.round(wan.pos.x) === SALUTE_ANCHOR.x && Math.round(wan.pos.y) === SALUTE_ANCHOR.y,
    `01 锚点：莞尔在河湾 (${SALUTE_ANCHOR.x},${SALUTE_ANCHOR.y})`);
  check(Math.round(wu.pos.x) === SALUTE_ALTAR.x && Math.round(wu.pos.y) === SALUTE_ALTAR.y,
    `01 锚点：阿雾在祭坛 (${SALUTE_ALTAR.x},${SALUTE_ALTAR.y})`);
  check(wan.visible && wu.visible, '01 锚点：两人都在户外可见');
  console.log(`01 构图成立：now=${found.now}`);

  // 冻钟 → 钉呈现态（07:34 / 潮位 0）→ 镜头对准莞尔（与 pinShotCamera 同口径）
  await shotPage.evaluate(
    ({ dayMs, minuteMs, tile }) => {
      const snapshot = window.Oracle.view();
      const now = Math.floor(snapshot.now / dayMs) * dayMs + minuteMs;
      window.Oracle.freezeWorldClock();
      window.Oracle.pinShotState(now, 0);
      const pos = snapshot.villager.pos;
      window.Oracle.setCameraMode('free');
      window.Oracle.centerCameraOn(Math.round(pos.x) * tile, Math.round(pos.y) * tile);
    },
    { dayMs: DAY_MS, minuteMs: SALUTE_PIN_MINUTE_MS, tile: TILE_PX },
  );
  await shotPage.waitForTimeout(300);

  // 规则一：祭坛必须真的在画框里（不是「名字叫祭坛」）。
  const frame = await shotPage.evaluate(({ altar }) => {
    const canvas = document.querySelector('#app canvas');
    const rect = canvas.getBoundingClientRect();
    const cam = window.Oracle.camera();
    const ox = cam.scrollX + cam.width / 2 - cam.width / (2 * cam.zoom);
    const oy = cam.scrollY + cam.height / 2 - cam.height / (2 * cam.zoom);
    const wx = (altar.x + 0.5) * 16;
    const wy = (altar.y + 0.5) * 16;
    return {
      x: (wx - ox) * cam.zoom * (rect.width / canvas.width),
      y: (wy - oy) * cam.zoom * (rect.height / canvas.height),
      w: rect.width,
      h: rect.height,
    };
  }, { altar: SALUTE_ALTAR });
  check(
    frame.x >= 0 && frame.x <= frame.w && frame.y >= 0 && frame.y <= frame.h,
    `01 锚点：祭坛在画框内（投影 ${Math.round(frame.x)},${Math.round(frame.y)} / ${frame.w}×${frame.h}）`,
  );

  // 派活 → 必须看到行礼（世界事实 mode=saluting + 气泡），超时判红。
  const salutePromise = shotPage.waitForFunction(() => {
    const snapshot = window.Oracle.view();
    if (snapshot.villager.mode !== 'saluting') return false;
    const bubbles = [...document.querySelectorAll('#world-overlay .overlay-bubble')];
    const shown = bubbles.filter((node) => node.style.display !== 'none');
    const names = [...document.querySelectorAll('#world-overlay .overlay-name')];
    return {
      snapshot,
      overlay: {
        texts: shown.map((node) => node.textContent),
        shown: shown.length,
        hiddenNames: names.filter((node) => node.style.display === 'none').length,
      },
    };
  }, null, { timeout: 120_000 });
  await shotPage.fill('#utterance', '帮我写个爬虫脚本');
  await shotPage.click('button[type="submit"]');
  const salute = await salutePromise.then((handle) => handle.jsonValue());
  check(salute.snapshot.villager.mode === 'saluting', '01 锚点上行礼真的出现（mode=saluting）');
  check(salute.snapshot.villager.bubble !== null, '行礼时头上有字');
  check(
    salute.overlay.shown >= 1 &&
      salute.overlay.texts.some((text) => (text ?? '').includes('吾神降旨')),
    '气泡在 DOM overlay 里显示（canvas 无中文）',
  );
  check(salute.overlay.hiddenNames >= 1, '有气泡时对应名字让位');
  check(await shotPage.evaluate(() => window.Oracle.worldClockPinned()), '01 抓拍前世界时钟已冻住');
  check(shotErrors.length === 0, '01 抓拍页面全程无 JS 报错');
  await shotPage.waitForTimeout(300);
  await shotPage.screenshot({ path: `${OUT}/01-salute.png` });
  await context.close();
};

/**
 * 把 `#stage` 的绘制原点钉到整数 CSS 像素（用户决定三 / 戊类夹具）。
 *
 * 半像素来自 flex 居中：`(可用宽 - 962) / 2` 可能是 0.5px。画布本身是
 * `pixelated` 的，落点差半像素会让整幅图按不同的采样相位重采样——两跑之间
 * 出现一片「每像素只差 1 级」的差。这里量一次偏移，用 `translate` 补到整数；
 * 8 系列再在这个整数原点上做整数倍缩放。
 */
const snapStage = (target = page) =>
  target.evaluate(() => {
    const stage = document.querySelector('#stage');
    stage.style.transformOrigin = 'top left';
    stage.style.transform = '';
    const rect = stage.getBoundingClientRect();
    const snap = {
      dx: Math.round(rect.left) - rect.left,
      dy: Math.round(rect.top) - rect.top,
      // 缩放截图按「未缩放时的整数盒」裁：元素自己的包围盒会随 Phaser 重排
      // 漂 1～2 CSS px（3904/3888 就是这么来的），裁固定盒才稳。
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    window.__stageSnap = snap;
    // `#stage` 是 `width: fit-content`：8 系列换视口后会被子元素撑宽 2～6px
    // （实跑见过 963 → 967/969，4x 截图于是 3868/3876 漂移）。首次量到的
    // 整数盒直接钉死，之后任何视口都按同一个盒子裁。
    if (!stage.dataset.pinnedBox) {
      stage.style.width = `${snap.width}px`;
      stage.style.height = `${snap.height}px`;
      stage.style.flex = 'none';
      stage.dataset.pinnedBox = '1';
    }
    window.__applyStageZoom = (zoom) => {
      const tx = snap.dx === 0 && snap.dy === 0 ? '' : `translate(${snap.dx}px, ${snap.dy}px)`;
      const scale = zoom === 1 ? '' : `scale(${zoom})`;
      stage.style.transform = `${tx} ${scale}`.trim();
    };
    window.__applyStageZoom(1);
    return snap;
  });

const report = (title) => {
  console.log(`\n${title}：${checks.length} 项通过`);
  for (const label of checks) console.log(`  ok  ${label}`);
};

/** 事件流模式：验服务端那条只增日志真的能驱动这个世界。 */
async function runFeedSuite() {
  await waitFor((s) => s.feed.connected === true, '事件流连接建立', 15000);
  const linked = await state();
  check(linked.feed.lastReadAt !== null, '世界拿到过一次上游快照');
  await page.waitForFunction(
    () => (document.querySelector('#status')?.textContent ?? '').includes('上游在线'),
    null,
    { timeout: 5000 },
  );
  const statusText = await page.textContent('#status');
  check(
    statusText.includes('上游在线') || statusText.includes('上游离线'),
    '状态行读得出上游状态',
  );
  check(
    statusText.includes('上游在线') && !statusText.includes('仅本地活'),
    '上游在线时状态行不标「仅本地活」',
  );

  // 注入一条 task.opened，走与真实日志完全相同的折叠路径。不写服务端：
  // 这条链要验的是「事件 → 世界」，日志落库由 accept-live.mjs 验。
  const driven = await page.evaluate(async () => {
    window.Oracle.pushEvent({
      kind: 'task.opened',
      payload: { id: 'c_smoke_probe', kind: 'writing', title: '把便笺整理成三版标题' },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    return window.Oracle.view();
  });
  check(driven.tasks.some((t) => t.id === 'c_smoke_probe'), '上游单进了世界的活动清单');
  check(driven.villager.mode !== 'idle', '她停下日常，去干上游派的活');

  // 完成权在上游：上游单不许人工收尾，按 #finish 必须被拒且她继续干活。
  await waitFor((s) => s.villager.mode === 'working', '上游单进入干活态', 15000);
  await page.click('#finish');
  await page.waitForFunction(
    () => (document.querySelector('#reply')?.textContent ?? '').includes('完成权在上游'),
    null,
    { timeout: 5000 },
  );
  check(true, '上游单人工完成被拒，回执写明完成权在上游');
  check((await state()).villager.mode === 'working', '被拒后上游单继续跑');

  // 上游说收工，她走正常交付，不是凭空结束。
  const delivered = await page.evaluate(async () => {
    window.Oracle.pushEvent({
      kind: 'task.settled',
      payload: { id: 'c_smoke_probe' },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return window.Oracle.view();
  });
  check(
    delivered.villager.mode === 'delivering' || delivered.villager.mode === 'toAltar',
    '上游说收工，她走交付',
  );
  check(!delivered.tasks.some((t) => t.id === 'c_smoke_probe'), '收工的单退出活动清单');
  check(delivered.deliveries.feed === 1, '上游交付单独计入上游统计');
  check(delivered.deliveries.local === 0, '上游交付不混进本地统计');

  // blocked_question 只展示、不回答：进快照，状态行、回执与急件面板都能读到，
  // 之后上游发 `task.opened` 重述（问题为空）时清除。
  //
  // 问题故意用一句长而具体的：急件面板必须**一个字都不截**，用户要看着它做决定。
  const blockedQuestion = '要执行 rm -rf ./temp_build 吗？这个目录里有 3 个未提交的文件。';
  const blocked = await page.evaluate(async (question) => {
    window.Oracle.pushEvent({
      kind: 'task.opened',
      payload: { id: 'c_smoke_blocked', kind: 'writing', title: '清理临时目录' },
    });
    window.Oracle.pushEvent({
      kind: 'task.blocked',
      payload: { id: 'c_smoke_blocked', question },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    return window.Oracle.view();
  }, blockedQuestion);
  check(
    blocked.tasks.some((t) => t.blockedQuestion === blockedQuestion),
    'blocked_question 进了世界快照',
  );
  await page.waitForFunction(
    () => (document.querySelector('#status')?.textContent ?? '').includes('在等你的答复：'),
    null,
    { timeout: 5000 },
  );
  check(true, '状态行写出在等你的答复');
  check(
    (await page.textContent('#reply')).includes('在等你的答复：'),
    '同步回执写出在等你的答复',
  );

  // 急件请旨：同一张 blocked 单必须完整呈到纸面上。这一条只能在这里验——
  // 纯沙盒（`?feed=off`）断网时 `syncEvents` 会整帧丢弃折叠结果，
  // 注入的 blocked 单永远到不了急件面板。
  await page.waitForTimeout(400);
  const decreeState = await page.evaluate(() => ({
    decree: window.Oracle.decree(),
    panelHidden: document.querySelector('#decree')?.hidden,
    question: document.querySelector('#decree-question')?.textContent ?? '',
    title: document.querySelector('#decree-title')?.textContent ?? '',
  }));
  check(
    decreeState.decree?.question === blockedQuestion && decreeState.decree.taskId === 'c_smoke_blocked',
    '急件指向那张在等答复的单，问题原文完整',
    decreeState.decree?.question ?? 'null',
  );
  check(decreeState.panelHidden === false, '急件面板显示出来');
  check(
    decreeState.question === blockedQuestion,
    '纸面显示的是完整原文，没有截断',
    decreeState.question,
  );
  check(decreeState.title === '清理临时目录', '急件标题写清这单在做什么', decreeState.title);

  // 上游重述这条活（问题为空）：答复等待立刻清掉，不残留。
  const resumed = await page.evaluate(async () => {
    window.Oracle.pushEvent({
      kind: 'task.opened',
      payload: { id: 'c_smoke_blocked', kind: 'writing', title: '把便笺整理成三版标题' },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    return window.Oracle.view();
  });
  check(
    resumed.tasks.every((t) => t.blockedQuestion === null),
    '上游重述后答复等待被清除',
  );

  // 收工后这条单离开活动清单，问题不残留。
  await page.evaluate(async () => {
    window.Oracle.pushEvent({ kind: 'task.settled', payload: { id: 'c_smoke_blocked' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  check(
    !(await state()).tasks.some((t) => t.id === 'c_smoke_blocked'),
    '收工后带问题的单退出活动清单',
  );
}

/** 沙盒模式：神谕闭环 + 日常 + 天气 + 造物主 + 信仰 + 日报 + 外部桥接。 */
async function runSandboxSuite() {
  const opening = await state();
  check(opening.villagers.length === 2, '世界里有两个小人');
  check(
    opening.villagers[0]?.name !== opening.villagers[1]?.name &&
      opening.villagers[0]?.id !== opening.villagers[1]?.id,
    '两个角色各有独立 id 与名字',
  );
  check(opening.feed.connected === false, '纯沙盒模式在快照里标成未连上游');
  await page.waitForFunction(
    () => (document.querySelector('#status')?.textContent ?? '').includes('上游离线'),
    null,
    { timeout: 5000 },
  );
  const openingStatus = await page.textContent('#status');
  check(
    openingStatus.includes('上游离线') && openingStatus.includes('仅本地活'),
    '状态行标出上游离线、只剩本地活',
  );
  check(
    openingStatus.includes('莞尔：') && openingStatus.includes('阿雾：'),
    '状态行显示多角色摘要',
  );
  // 她自己会动，不是屏保。
  //
  // 场景开局时刻是 08:15（`?now=495`），不是默认的 00:00——默认 00:00 属夜间
  // 休息，她该回锚点睡下。这一条验的是白天无人时她仍按作息走动，断言不改。
  //
  // 节奏 60 之后不能再用「等 3.2 秒再取一次位置」：她走完一趟只要十来秒，
  // 之后会在落脚点待机到下一段行程（dwell 最长 40 世界分钟 = 40 现实秒），
  // 固定窗口正好落在待机段就会误判成屏保。改成从当前位置起等一次真实位移，
  // 判定条件（位移 > 0.2 格或离开 idle）不变，只把观察窗口放宽到 60 秒。
  const before = opening.villager.pos;
  const moved = await page
    .waitForFunction(
      ({ x, y }) => {
        const view = window.Oracle.view();
        const dx = view.villager.pos.x - x;
        const dy = view.villager.pos.y - y;
        return Math.hypot(dx, dy) > 0.2 || view.villager.mode !== 'idle';
      },
      { x: before.x, y: before.y },
      { timeout: 120000 },
    )
    .then(() => true)
    .catch(() => false);
  const wandering = await state();
  check(moved, '没人管的时候她会自己走动');
  check(
    wandering.villagers.every((item) => typeof item.routine === 'string'),
    '两个角色各自有独立作息',
  );

  // D5-A：动态中文走 DOM overlay，按 canvas 实际位置换算（≤1 逻辑像素）。
  const overlayFit = await measureOverlayFit();
  check(
    overlayFit.names === overlayFit.villagers && overlayFit.text === overlayFit.expectedName,
    'overlay 名字节点数与快照角色一致、文案正确',
  );
  check(
    overlayFit.error <= overlayFit.tolerance,
    `zoom=${overlayFit.zoom} 下 overlay 与 canvas 对齐误差 ${overlayFit.error.toFixed(2)}px ≤ ${overlayFit.tolerance}px`,
  );
  check(
    Math.abs(overlayFit.overlayWidth - overlayFit.canvasWidth) < 2,
    'overlay 与 canvas 同宽',
  );
  check(overlayFit.bubblesVisible <= overlayFit.villagers, '气泡节点不超过角色数');

  // 相机 zoom=1：滚轮下滚两档（默认 2 → 1.5 → 1），同一条对齐断言要成立。
  // 下面那组 100%/200%/400% 是**页面 CSS 缩放**，覆盖不到相机 zoom——偏的是后者。
  const canvasBox = await page.locator('#app canvas').boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  const fitZoom1 = await measureOverlayFit();
  check(
    fitZoom1.zoom === 1 && fitZoom1.error <= fitZoom1.tolerance,
    `zoom=1 下 overlay 与 canvas 对齐误差 ${fitZoom1.error.toFixed(2)}px ≤ ${fitZoom1.tolerance}px`,
  );
  // 滚回原倍率，后面的流程沿用原先的镜头。
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(400);
  const restoredZoom = await page.evaluate(() => window.Oracle.camera().zoom);
  check(restoredZoom === overlayFit.zoom, `镜头滚轮后恢复原倍率（${restoredZoom}）`);


  // 认不出的句子不让世界动。
  // `say()` 现在只表示"已投递"：解析在下一拍结算，所以这里等一拍再校验结果。
  const beforeUnknown = await state();
  await page.evaluate(() => window.Oracle.say('今天天气不错'));
  await page.waitForTimeout(600);
  const afterUnknown = await state();
  check(
    afterUnknown.tasks.length === beforeUnknown.tasks.length &&
      afterUnknown.villager.mode === beforeUnknown.villager.mode,
    '认不出的输入没有改变世界',
  );
  check(
    afterUnknown.oracle.length === beforeUnknown.oracle.length,
    '认不出的输入没有刻上石板',
  );

  // 一句代码活：行礼 → 赶路 → 开工。派活只叫一个人。
  //
  // 行礼与气泡在 60× 下只活一个逻辑步（约 60–100ms 实时）。**先把 rAF 采样
  // 装上、再点提交**：等 click 返回后才装，安装本身的 IPC 就可能跨过那一拍。
  // 采样把快照与 DOM overlay 一起取回来，回执随后再核对（它不会因晚读消失）。
  //
  // ── 抓拍口径：站定 → 冻钟 → 钉呈现态 ───────────────────────────
  // 原来这张图在「等回执」之后才拍，世界照跑：两跑落点差一个逻辑步，潮位就
  // 可能跨过草地的淹没阈值（grass 高度 0.3），整片暗地/植被多一层
  // `ink+water` 覆盖，蓝通道恒 +9。实测同码两跑可见差 24.7%，其中 92% 是
  // 这一对颜色。
  // 只冻在「看到行礼那一拍」还不够：另一个人（阿雾）可能正走在去街口的路上，
  // 她的像素位置随世界时刻连续漂，冻在哪一拍就差几像素（修后第三跑就差了
  // 0.95%）。所以先在采样回调里等**两个人都站定**，就地冻钟，再把呈现态钉死
  // （时刻取当天 12:30，与 07/08 同一口径；潮位取 0=退潮，与基线草地同色）。
  // 钉的只是画面，世界快照/判据/存档一概不变，拍完立刻解开。
  // 01 的画面在 PIN 模式下由 `captureSalute01()` 在独立的 05:00 早晨世界里拍
  // （见上方注释）；这里主页面只为判据把世界冻在「没人走路」那一拍。非 PIN
  // 模式这一拍同时就是 01 的抓拍点。
  await page.waitForFunction(
    () => {
      const snapshot = window.Oracle.view();
      if (snapshot.villagers.some((villager) => villager.walking)) return false;
      window.Oracle.freezeWorldClock();
      window.Oracle.pinShotState(
        Math.floor(snapshot.now / 86400000) * 86400000 + 45_000_000,
        0,
      );
      return true;
    },
    null,
    { timeout: 120000 },
  );
  const salutePromise = page.waitForFunction(
    () => {
      const snapshot = window.Oracle.view();
      if (snapshot.villager.mode !== 'saluting') return false;
      const bubbles = [...document.querySelectorAll('#world-overlay .overlay-bubble')];
      const shown = bubbles.filter((node) => node.style.display !== 'none');
      const names = [...document.querySelectorAll('#world-overlay .overlay-name')];
      return {
        snapshot,
        overlay: {
          texts: shown.map((node) => node.textContent),
          shown: shown.length,
          hiddenNames: names.filter((node) => node.style.display === 'none').length,
        },
      };
    },
    null,
    { timeout: 120000 },
  );
  // 行礼只活一个逻辑步：镜头必须**提前**钉在祭坛，不能在抓拍那一拍再操作。
  await pinShotCamera();
  await page.fill('#utterance', '帮我写个爬虫脚本');
  await page.click('button[type="submit"]');
  const salute = await salutePromise.then((handle) => handle.jsonValue());
  check(salute.snapshot.villager.mode === 'saluting', '她停下手里的事行礼');
  const saluting = salute.snapshot;
  const overlayBubble = salute.overlay;
  check(saluting.villager.bubble !== null, '行礼时头上有字');
  check(
    overlayBubble.shown >= 1 &&
      overlayBubble.texts.some((text) => (text ?? '').includes('吾神降旨')),
    '气泡在 DOM overlay 里显示（canvas 无中文）',
  );
  check(overlayBubble.hiddenNames >= 1, '有气泡时对应名字让位');
  check(await page.evaluate(() => window.Oracle.worldClockPinned()), '01 抓拍前世界时钟已冻住');
  await page.waitForFunction(
    () => (document.querySelector('#reply')?.textContent ?? '').includes('神谕已送达'),
    null,
    { timeout: 5000 },
  );
  check(true, '界面回了世界结算后的神谕回执');
  // 冻着的那一帧画面上是「行礼中」：气泡还在（`bubbleUntil` 不随冻钟走）。
  await page.waitForTimeout(300);
  // PIN 模式的 01 画面已在独立早晨页面里写过，别拿 10:00 开局的页面覆盖它。
  if (!PIN_SHOTS) {
    await page.screenshot({ path: `${OUT}/01-salute.png` });
  }
  // 拍完立刻解冻、解钉：后面的「走进铺子开工」照原样走，判据读的还是真快照。
  await page.evaluate(() => {
    window.Oracle.unpinShotState();
    window.Oracle.unfreezeWorldClock();
  });

  const working = await waitFor((s) => s.villager.mode === 'working', '她走进铺子开始干活');
  check(working.villager.visible === false, '进屋后人不在门外');
  check(
    working.villagers[1]?.mode !== 'working' && working.villagers[1]?.taskId === null,
    '派活只叫一个人，另一个还在祭坛',
  );
  const operating = working.workstations.filter((w) => w.activity.kind === 'operating');
  check(operating.length === 1, '恰好一台铺子在运转');
  const activeBuilding = working.buildings.find(
    (b) => b.instanceId === operating[0].buildingId,
  );
  check(activeBuilding?.boundTask === 'code', '开工的是接代码活的那栋');
  const workingStatus = await page.textContent('#status');
  check(workingStatus.includes('默认交付：莞尔'), '状态行写清默认交付对象');
  await page.waitForTimeout(700);
  await pinShotCamera();
  await pinForShot(null);
  await page.screenshot({ path: `${OUT}/02-working.png` });
  await unpinForShot();

  // 交付与冷却也在 60× 下只活一个逻辑步；抓「第一次进入 delivering」那一拍，
  // 否则冷却已经过期，后面的断言会读到空。
  const delivering = await page
    .waitForFunction(
      (pin) => {
        const snapshot = window.Oracle.view();
        if (snapshot.villager.mode !== 'delivering') return false;
        // 只测量：抓在「刚交付、人停在门口」这一拍就地冻钟。
        if (pin) window.Oracle.freezeWorldClock();
        return snapshot;
      },
      PIN_SHOTS,
      { timeout: 120000 },
    )
    .then((handle) => handle.jsonValue());
  checks.push('活干完，她出门交付');
  check(delivering.villager.visible === true, '交付时人重新出现在画面里');
  check(delivering.tasks[0]?.status === 'done', '世界的单列表里这单已完成');
  check(
    delivering.workstations.some((w) => w.activity.kind === 'cooling'),
    '铺子进入冷却',
  );
  if (PIN_SHOTS) {
    await pinShotCamera();
    await pinForShot(null);
  }
  await page.screenshot({ path: `${OUT}/03-deliver.png` });
  await unpinForShot();

  const back = await waitFor((s) => s.villager.mode === 'idle', '她回到祭坛恢复闲逛');
  check(back.villager.taskId === null, '回到祭坛后手上没有单');

  // 两个角色各接一单：第一单给主角色，第二单给空闲的助手。
  await page.click('button[data-kind="research"]');
  await waitFor((s) => s.villager.mode === 'working', '第二单能派出去');
  await page.click('button[data-kind="writing"]');
  const second = await waitFor(
    (s) => s.villagers[1]?.taskId !== null,
    '第二个角色接下了另一单',
  );
  check(second.villagers[0]?.taskId !== second.villagers[1]?.taskId, '派活不串任务');

  // 两个人都被占着时再派一单：进等待队列；回执与状态行必须说出来。
  await page.fill('#utterance', '再整理一份便笺');
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => (document.querySelector('#reply')?.textContent ?? '').includes('已排队'),
    null,
    { timeout: 5000 },
  );
  check(true, '两人都忙时新神谕进排队，回执写明第几位');
  const queuedView = await state();
  check(queuedView.tasks.length === 3, '排队的单没有立刻被派下去');
  check(queuedView.pending.length === 1, '排队单在快照 pending 里可见');
  await page.waitForFunction(
    () => (document.querySelector('#status')?.textContent ?? '').includes('排队 1 条'),
    null,
    { timeout: 5000 },
  );
  check(true, '状态行显示排队数');

  // 「现实完成」可指定角色（id 或名字）且只对沙盒单生效。
  // 人工交付的 delivering 同样只活一个逻辑步：先装 rAF 采样再 finish。
  const manualPromise = page.waitForFunction(
    () => {
      const snapshot = window.Oracle.view();
      return snapshot.villager.mode === 'delivering' ? snapshot : false;
    },
    null,
    { timeout: 120000 },
  );
  await page.evaluate(() => window.Oracle.finish('v0'));
  const manual = await manualPromise.then((handle) => handle.jsonValue());
  checks.push('人工交付也能结束这单');
  check(manual.tasks[1]?.status === 'done', '人工交付对沙盒单生效');
  const manualReply = await page.textContent('#reply');
  check(
    manualReply.includes('离线本地') && manualReply.includes('不计入上游'),
    '沙盒单人工交付回执标明离线本地、不计入上游',
  );
  check(manualReply.includes('莞尔'), '回执写清收的是谁的单');
  check(
    manual.deliveries.feed === 0 && manual.deliveries.local >= 2,
    '交付统计把本地单单独计，不混进上游',
  );
  check(manual.deliveriesByVillager[0]?.local >= 1, '交付归属到指定角色');

  // 按名字指定另一个人：只收阿雾那单。
  await waitFor((s) => s.villagers[1]?.mode === 'working', '助手也在干活');
  await page.evaluate(() => window.Oracle.finish('阿雾'));
  await page.waitForFunction(
    () => (document.querySelector('#reply')?.textContent ?? '').includes('阿雾'),
    null,
    { timeout: 5000 },
  );
  check(true, '按名字指定交付对象');
  const perWorker = await state();
  check(
    perWorker.deliveriesByVillager.every((item) => item.local >= 1),
    '两个角色都各自记了交付',
  );

  // 主角色空下来后，排队单自动开工，不需要再点任何按钮。
  const queuedStarted = await waitFor(
    (s) => s.tasks.length === 4 && s.tasks[3]?.status === 'in_progress',
    '排队的神谕在上一单交付后自动开工',
  );
  check(queuedStarted.tasks[3]?.summary === '再整理一份便笺', '自动开工的是排队的那条神谕');
  check(queuedStarted.pending.length === 0, '出队后 pending 清空');

  // 未知角色：明确拒绝，不碰任何人的活。
  await page.evaluate(() => window.Oracle.finish('v9'));
  await page.waitForFunction(
    () => (document.querySelector('#reply')?.textContent ?? '').includes('没有叫'),
    null,
    { timeout: 5000 },
  );
  check(true, '未知角色的交付被明确拒绝');

  // 把剩下的活逐单收尾，最后两个人都回到日常。
  for (let i = 0; i < 20; i += 1) {
    const snapshot = await state();
    if (
      snapshot.tasks.every((task) => task.status === 'done') &&
      snapshot.villagers.every((villager) => villager.mode === 'idle')
    ) {
      break;
    }
    await page.click('#finish');
    await page.waitForTimeout(500);
  }
  const settled = await state();
  check(settled.tasks.every((task) => task.status === 'done'), '所有单都收尾');
  const paperByWorker = await page.evaluate(() => window.Oracle.report());
  const workerLine = paperByWorker.lines.find((line) => line.includes('交付')) ?? '';
  check(
    workerLine.includes('莞尔交付') && workerLine.includes('阿雾交付'),
    '日报按角色分账，两个人都写清交付数',
  );
  await waitFor(
    (s) => s.villagers.every((item) => item.mode === 'idle'),
    '两个人都回到日常',
  );

  const routine = await waitFor(
    (s) => typeof s.villager.routine === 'string' && s.villager.routine.length > 0,
    '日常作息给出了一句可读的状态',
  );
  check(routine.villager.mode === 'idle', '日常状态不是被神谕打断的');

  await page.click('button[data-kind="quick"]');
  const quick = await waitFor((s) => s.villager.mode === 'working', '短活当场开始');
  check(
    quick.workstations.every((w) => w.activity.kind !== 'operating'),
    '短活没占用任何铺子',
  );
  await waitFor((s) => s.villager.mode === 'idle', '短活自己结束');

  // 世界法则：下雨 → 她躲雨 → 雨停。
  await page.click('#rain');
  const raining = await waitFor((s) => s.weather === 'rain', '神谕让世界下雨了');
  check(raining.villager.umbrella === true, '下雨时她撑起伞');
  check(raining.villager.mode === 'sheltering', '户外的她当场跑去躲雨');
  await page.waitForTimeout(500);
  await pinShotCamera();
  await pinForShot(null);
  await page.screenshot({ path: `${OUT}/04-rain.png` });
  await unpinForShot();
  await waitFor((s) => s.villager.mode === 'idle', '跑到屋檐下停住');
  await page.click('#clear');
  await waitFor((s) => s.weather === 'clear', '神谕让天放晴');

  // 造物主：扩建一栋，施工期间不接活，落成后进世界。
  //
  // 施工 3200 世界毫秒在 60× 下不足一个逻辑步（6000ms），快照只剩一拍；
  // 同样先装 rAF 采样再点建造，抓「新楼已出现且仍在施工」的同一拍。
  const beforeBuild = await state();
  const buildingPromise = page.waitForFunction(
    ({ count, pin }) => {
      const snapshot = window.Oracle.view();
      if (snapshot.buildings.length !== count + 1 || snapshot.constructions.length !== 1) {
        return false;
      }
      // 只测量：抓在「新楼已出现且仍在施工」这一拍就地冻钟。
      if (pin) window.Oracle.freezeWorldClock();
      return snapshot;
    },
    { count: beforeBuild.buildings.length, pin: PIN_SHOTS },
    { timeout: 120000 },
  );
  await page.click('button[data-build="workshop_plot"]');
  const building = await buildingPromise.then((handle) => handle.jsonValue());
  checks.push('造物主落下一栋新楼');
  check(building.constructions.length === 1, '新楼处于施工中');
  check(building.roads.length > beforeBuild.roads.length, '新楼自动铺出了一条路');
  // 施工只活不到一个逻辑步，抓拍后再钉镜头多半已经落成；钉到**新楼本身**
  // 的格子上，两跑至少取景同一栋、同一片街区。
  const built = await page.evaluate((id) => {
    const b = window.Oracle.view().buildings.find((candidate) => candidate.instanceId === id);
    return b === undefined
      ? null
      : { x: (b.origin.x + b.footprint.w / 2) * 16, y: (b.origin.y + b.footprint.h / 2) * 16 };
  }, building.constructions[0].buildingId);
  if (built !== null) {
    await page.evaluate(({ x, y }) => {
      window.Oracle.setCameraMode('free');
      window.Oracle.centerCameraOn(x, y);
    }, built);
    await page.waitForTimeout(250);
  }
  await pinForShot(null);
  await page.screenshot({ path: `${OUT}/05-build.png` });
  await unpinForShot();
  await waitFor((s) => s.constructions.length === 0, '施工结束，新楼落成');

  for (let i = 0; i < 2; i += 1) {
    await page.click('button[data-kind="quick"]');
    await waitFor((s) => s.villager.mode === 'working', `第 ${i + 1} 单短活开始`);
    await waitFor((s) => s.villager.mode === 'idle', `第 ${i + 1} 单短活结束`);
  }
  const withProp = await waitFor((s) => s.props.length > 0, '神恩攒够，世界多了一件东西');
  // 队列让交付多了一单，里程碑可能提前落到第 2 次：只要求确实记上了。
  check(withProp.faith.milestones >= 1, '里程碑记上了');
  await page.waitForTimeout(400);
  // 06 与 07/08 同一确定性口径：只等主控空闲就冻钟不够——阿雾可能还在走，
  // 冻下来的 idle 姿态与位置两跑能差 0.19%（差在阿雾的名字标签与身体）。
  // PIN 模式下先把世界推到 12:30 安静段（全镇回锚点坐定），再等两人真正站定
  // 才取景；默认口径一字不动，仍是抓真实运行中的一拍。
  if (PIN_SHOTS) {
    await waitFor(
      (s) => s.villagers.every((item) => item.mode === 'idle'),
      '06 抓拍前两人都空闲',
    );
    await page.evaluate(() => window.Oracle.jumpWorldClock(750));
    await waitVillagersSettled('06 抓拍前两人迟迟没有站定');
  }
  await pinShotCamera();
  await pinForShot(null);
  await page.screenshot({ path: `${OUT}/06-faith.png` });
  await unpinForShot();

  // 日报是纸面，读得到，且写的是真发生过的事。
  const paper = await page.evaluate(() => window.Oracle.report());
  check(paper.lines.some((line) => line.includes('交付')), '日报写了交付数');
  const paperText = await page.textContent('#paper');
  check(paperText.includes(paper.headline), '报纸把标题渲染到了纸面上');
  check(paperText.includes('神恩') || paperText.includes('路灯'), '报纸写了落地的东西');

  // 桥接放在 07/08 之后（见下）：`ext-1` 是 quick 单，会立刻被人接走；若在
  // 钉钟前注入，它会在 `jumpWorldClock` 里被跳过的这段时间里变成「已超期」，
  // 后面的「等两人空闲」要多等一百多个世界分钟。
  //
  // ── 钉住 07/08 的抓拍口径 ────────────────────────────────────────
  // 08（三档缩放）与 07（调试面板）必须是「同一世界时刻 + 同一镜头」的连拍。
  // 不钉的话导播在跟着人走、面板按真实时间重绘，同码两跑能差到 58%。
  // 12:30 是安静段（12:00–14:00），全镇回锚点坐定，落点固定；坐定后再冻钟。
  // 先等两人空闲：跳过的时钟会把进行中的活/相对定时器甩到位相之外，
  // 有活在身时既拍不到「坐定」，也会让后续的等待多等一大截。
  await waitFor(
    (s) => s.villagers.every((item) => item.mode === 'idle'),
    '07/08 抓拍前两人都空闲',
  );
  await page.evaluate(() => window.Oracle.jumpWorldClock(750));
  // 判据见 `waitVillagersSettled`：06 与 07/08 共用同一条「真的站定」定义。
  await waitVillagersSettled('钉钟后两人迟迟没有站定');
  const pinnedClock = await page.evaluate(({ pin, minuteMs }) => {
    // 站定之后把时钟**回拨到整点 12:30**再冻：等站定花掉的那十几分钟世界时间
    // 会让「莞尔：去祭坛 / 去农田边」这类状态行在两跑之间换词（06 实测就差这一行）。
    // 回拨只动 `now`，人已经站定，位置不回退。
    if (pin) window.Oracle.jumpWorldClock(minuteMs / 60_000);
    const now = window.Oracle.freezeWorldClock();
    // 戊类夹具（用户决定三，只在钉住口径下生效）：`freezeWorldClock` 只冻世界，
    // 画面仍按快照里的 `now` 上色。跳到 750 之后还会多跑半分钟，两跑的冻结点
    // 差几分钟，整幅光照就差 ±2 级（08 实测 37% 像素差 1～2 级）。把**呈现
    // 时刻**钉到整点 12:30，画面才与真实冻结点无关。默认关闭时口径一字不改。
    if (pin) {
      const day = Math.floor(now / 86400000) * 86400000;
      window.Oracle.pinShotState(day + minuteMs, 0);
    }
    return now;
  }, { pin: PIN_SHOTS, minuteMs: SHOT_MINUTE_MS });
  check(Number.isFinite(pinnedClock), `07/08 抓拍前世界时钟已冻住（now=${pinnedClock}）`);
  await page.evaluate(() => {
    window.Oracle.setCameraMode('free');
    window.Oracle.centerCameraOn(768, 576);
  });
  // `worldView` 要等下一帧 preRender 才刷新；这里读的是即时的 scroll（512,416 那组）。
  await page.waitForTimeout(300);
  const pinnedCamera = await page.evaluate(() => {
    const c = window.Oracle.camera();
    return { scrollX: c.scrollX, scrollY: c.scrollY, zoom: c.zoom, mode: c.mode };
  });
  check(
    pinnedCamera.mode === 'free' &&
      pinnedCamera.scrollX === 528 &&
      pinnedCamera.scrollY === 416 &&
      pinnedCamera.zoom === 2,
    `07/08 镜头钉在祭坛（scroll=${pinnedCamera.scrollX},${pinnedCamera.scrollY} zoom=${pinnedCamera.zoom}）`,
  );

  // 08-400% 的画布尺寸会被竖向滚动条的有无带偏；滚动条已在页面加载时钉成常驻，
  // 这里再把舞台原点重新量一次（上面 390px 往返回来过，居中余量可能变了）。
  await page.evaluate(() => {
    document.documentElement.style.overflowY = 'scroll';
  });

  const checkOverlayFit = async (zoom) => {
    const fit = await page.evaluate(() => {
      const canvas = document.querySelector('#app canvas');
      const overlay = document.querySelector('#world-overlay');
      const canvasRect = canvas.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      return {
        sameWidth: Math.abs(canvasRect.width - overlayRect.width) < 2,
        sameOrigin: Math.abs(canvasRect.left - overlayRect.left) < 2,
        contained: overlayRect.right <= canvasRect.right + 0.5,
      };
    });
    check(
      fit.sameWidth && fit.sameOrigin && fit.contained,
      `${zoom * 100}% 缩放下 overlay 仍贴合 canvas`,
    );
  };

  // D5-A：100%/200%/400% 缩放截图，验证 DOM overlay 仍贴合 canvas。
  if (PIN_SHOTS) {
    // 戊类夹具（用户决定三）：固定整型视口 + 整数裁剪盒，不依赖元素外接盒
    // （外接盒会随 Phaser 重排漂 1～2px，3904/3888 就是这么来的）。
    await page.evaluate(() => {
      // 投影会伸进元素截图的外接盒；8 系列只看画布贴合，先把投影摘掉。
      document.querySelector('#app').style.boxShadow = 'none';
      // 居中会在放大后把半幅图挪出视口；靠左排，裁剪盒才装得下。
      document.querySelector('#stage').style.alignSelf = 'flex-start';
    });
    for (const zoom of [1, 2, 4]) {
      await page.setViewportSize({
        width: Math.max(1010, 16 + 963 * zoom + 32),
        height: Math.max(940, 68 + 642 * zoom + 32),
      });
      await page.waitForTimeout(350);
      // `page.screenshot({clip})` 的裁剪盒是**文档坐标**：页面若还停在上一视图
      // 的滚动位置（8 系列实测偏了约 491px），裁出来只剩视口里那一条
      // （08-100 于是成了 963×219）。每次换视口先把页面滚回原点再量。
      await page.evaluate(() => window.scrollTo(0, 0));
      const snap = await snapStage();
      await page.evaluate((value) => window.__applyStageZoom(value), zoom);
      await page.waitForTimeout(300);
      await checkOverlayFit(zoom);
      await page.screenshot({
        path: `${OUT}/08-overlay-${zoom * 100}.png`,
        clip: { x: snap.left, y: snap.top, width: snap.width * zoom, height: snap.height * zoom },
      });
    }
    await page.evaluate(() => {
      window.__applyStageZoom(1);
      document.querySelector('#app').style.boxShadow = '';
      document.querySelector('#stage').style.alignSelf = '';
    });
  } else {
    for (const zoom of [1, 2, 4]) {
      await page.evaluate((value) => {
        const stage = document.querySelector('#stage');
        stage.style.transformOrigin = 'top left';
        stage.style.transform = value === 1 ? '' : `scale(${value})`;
      }, zoom);
      await page.waitForTimeout(300);
      await checkOverlayFit(zoom);
      await page.locator('#stage').screenshot({ path: `${OUT}/08-overlay-${zoom * 100}.png` });
    }
    await page.evaluate(() => {
      document.querySelector('#stage').style.transform = '';
    });
  }
  await page.setViewportSize({ width: 1010, height: 940 });
  await page.waitForTimeout(300);

  // 390px：overlay 不超出 canvas（页面级 960px canvas 溢出属既有 P3）。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const overlayNarrow = await page.evaluate(() => {
    const canvas = document.querySelector('#app canvas');
    const overlay = document.querySelector('#world-overlay');
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    return {
      contained: overlayRect.right <= canvasRect.right + 0.5,
      width: overlayRect.width,
      canvasWidth: canvasRect.width,
    };
  });
  check(
    overlayNarrow.contained && Math.abs(overlayNarrow.width - overlayNarrow.canvasWidth) < 2,
    '390px 下 overlay 不溢出 canvas',
  );
  await page.setViewportSize({ width: 1010, height: 940 });
  await page.waitForTimeout(250);
  if (PIN_SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await snapStage();
  }

  // 上帝调试面板（S2-3）：只读浮层，不改变仿真。
  const panelInitial = await page.evaluate(() => ({
    hidden: document.querySelector('#debug-panel')?.hidden ?? null,
  }));
  check(panelInitial.hidden === true, '调试面板默认收起');
  await page.click('#debug-toggle');
  const panelCounts = await page.evaluate(() => {
    const snapshot = window.Oracle.view();
    const rows = (kind) =>
      document.querySelectorAll(`#debug-panel [data-debug-row="${kind}"]`).length;
    return {
      hidden: document.querySelector('#debug-panel')?.hidden,
      villagers: rows('villager'),
      snapshotVillagers: snapshot.villagers.length,
      buildings: rows('building'),
      snapshotBuildings: snapshot.workstations.length,
      tasks: rows('task'),
      snapshotTasks: snapshot.tasks.length,
      events: rows('event'),
      snapshotEvents: window.Oracle.events(50).length,
      injectOpen: document.querySelector('#debug-inject')?.open ?? null,
    };
  });
  check(panelCounts.hidden === false, '快捷键/按钮能打开调试面板');
  check(
    panelCounts.villagers === panelCounts.snapshotVillagers &&
      panelCounts.buildings === panelCounts.snapshotBuildings &&
      panelCounts.tasks === panelCounts.snapshotTasks,
    '调试面板实体数量与快照一致',
  );
  check(
    panelCounts.events === Math.min(50, panelCounts.snapshotEvents),
    '事件流行数与只读事件数一致',
  );
  check(panelCounts.injectOpen === false, '调试注入默认折叠');
  await page.screenshot({ path: `${OUT}/07-debug-panel.png` });

  // P2 回归：注入区必须在面板刷新后仍然存在、按钮可用（独立于 #debug-content）。
  await page.waitForTimeout(400);
  const injectAt400 = await page.evaluate(() => {
    const details = document.querySelector('#debug-inject');
    const buttons = [...document.querySelectorAll('#debug-inject [data-debug-action]')];
    return {
      exists: details !== null,
      buttons: buttons.length,
      enabled: buttons.every((button) => !(button instanceof HTMLButtonElement) || !button.disabled),
      text: details?.textContent ?? '',
      open: details instanceof HTMLDetailsElement ? details.open : null,
      insideContent: document.querySelector('#debug-content #debug-inject') !== null,
    };
  });
  check(
    injectAt400.exists && injectAt400.buttons === 2 && injectAt400.enabled,
    '400ms 后注入区仍在且两个按钮可点',
  );
  check(
    injectAt400.text.includes('仅调试') && injectAt400.text.includes('不写日志'),
    '注入区文案标明仅调试、不写日志',
  );
  check(injectAt400.open === false && injectAt400.insideContent === false, '注入区默认折叠且在刷新区之外');
  await page.screenshot({ path: `${OUT}/07-debug-panel-400ms.png` });

  // 1 秒后注入区仍在（此刻只展开、不点按钮：注入的活要在解冻之后才做得完）。
  // 展开本身不碰世界，与旧基线的 1s 图（展开态）也保持同一纸面。
  await page.waitForTimeout(600);
  const injectAt1s = await page.evaluate(() => {
    const details = document.querySelector('#debug-inject');
    if (details instanceof HTMLDetailsElement) details.open = true;
    return {
      buttons: document.querySelectorAll('#debug-inject [data-debug-action]').length,
      open: details?.open ?? null,
    };
  });
  check(injectAt1s.buttons === 2, '1s 后注入区仍在');
  check(injectAt1s.open === true, '注入区可以展开');
  await page.screenshot({ path: `${OUT}/07-debug-panel-1s.png` });
  await page.selectOption('#debug-tone', 'info');
  await page.waitForTimeout(500);
  const filtered = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#debug-panel [data-debug-row="event"]')];
    return { total: rows.length, tones: [...new Set(rows.map((row) => row.dataset.tone))] };
  });
  check(
    filtered.total > 0 && filtered.tones.every((tone) => tone === 'info'),
    '事件过滤只显示所选 tone',
  );
  const injectAfterFilter = await page.evaluate(() => ({
    buttons: document.querySelectorAll('#debug-inject [data-debug-action]').length,
    open: document.querySelector('#debug-inject')?.open ?? null,
  }));
  check(
    injectAfterFilter.buttons === 2 && injectAfterFilter.open === true,
    '切过滤后注入区仍在且保持展开',
  );
  await page.screenshot({ path: `${OUT}/07-debug-panel-filtered.png` });

  // 07/08 的四张到此拍完，解冻并解钉——后面暂停测试要等注入的活真做完，
  // 冻着的话它永远停在 working，等待注定超时；钉着的话底栏时钟也不再走。
  await page.evaluate(() => {
    window.Oracle.unpinShotState();
    window.Oracle.unfreezeWorldClock();
  });
  check(
    (await page.evaluate(() => window.Oracle.worldClockPinned())) === false,
    '07/08 拍完后世界时钟已解冻',
  );

  // 桥接：外部消息进世界，结果能从快照里读回来。
  // 放在解冻之后：这条 quick 单要真能在正常的时钟下做完，否则下面的
  // 「等两人空闲」会被它拖住（详见 07/08 钉钟前的注释）。
  const bridged = await page.evaluate(async () => {
    const before = window.Oracle.view().tasks.length;
    window.Oracle.feed({
      type: 'task.assigned',
      taskId: 'ext-1',
      taskKind: 'quick',
      summary: '外部派来的小事',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { before, after: window.Oracle.view().tasks.length };
  });
  check(bridged.after === bridged.before + 1, '外部 Agent 的消息进了同一条命令队列');

  // 解冻后再点一次 feed：只进世界命令队列，不写事件日志。冻着的时候这单
  // 永远停在 working，后面的「等两人空闲」必超时。
  const tasksBeforeFeed = await page.evaluate(() => window.Oracle.view().tasks.length);
  await page.click('#debug-inject [data-debug-action="feed"]');
  await page.waitForTimeout(600);
  const feedResult = await page.evaluate(() => ({
    tasks: window.Oracle.view().tasks.length,
    open: document.querySelector('#debug-inject')?.open ?? null,
  }));
  check(feedResult.tasks > tasksBeforeFeed, '注入按钮可用（feed 进了世界队列）');
  check(feedResult.open === true, '展开状态在刷新后保留');

  // 暂停后不再重绘：先冻结，再派一单，面板内容不动。
  // 30× 下前一段注入的活可能还没做完；先等两个人都回到空闲，否则新单一进
  // 等待队列（pending），任务区不会多出行，断言会被误判。
  await waitFor(
    (s) => s.villagers.every((item) => item.mode === 'idle'),
    '调试面板暂停前两个人都空闲',
  );
  await page.click('#debug-pause');
  const frozen = await page.evaluate(() => ({
    tasks: document.querySelectorAll('#debug-panel [data-debug-row="task"]').length,
    stats: document.querySelector('#debug-stats')?.textContent ?? '',
  }));
  // 暂停期间派一单，面板内容不动。用 research（40 秒）而不是 quick（10 秒）：
  // 30× 下「暂停 700ms + 恢复 500ms」已经是 36 世界秒，quick 会在恢复前就做完，
  // 面板里看不到新增的行。这里验的是「恢复后继续刷新」，不是活的长短。
  await page.click('button[data-kind="research"]');
  await page.waitForTimeout(700);
  const stillFrozen = await page.evaluate(() => ({
    tasks: document.querySelectorAll('#debug-panel [data-debug-row="task"]').length,
    stats: document.querySelector('#debug-stats')?.textContent ?? '',
    injectButtons: document.querySelectorAll('#debug-inject [data-debug-action]').length,
  }));
  check(
    stillFrozen.tasks === frozen.tasks && stillFrozen.stats === frozen.stats,
    '暂停后调试面板不更新',
  );
  check(frozen.stats.includes('已暂停'), '暂停状态在面板可见');
  check(stillFrozen.injectButtons === 2, '暂停后注入区仍在');

  // 恢复后继续刷新，并验证 tone 过滤只留对应事件。
  await page.click('#debug-pause');
  await page.waitForTimeout(500);
  const resumed = await page.evaluate(
    () => document.querySelectorAll('#debug-panel [data-debug-row="task"]').length,
  );
  check(resumed > frozen.tasks, '恢复后面板继续刷新');

  // 390px 视口不横向溢出，面板也不遮挡主舞台布局。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const narrow = await page.evaluate(() => {
    const rect = document.querySelector('#debug-panel')?.getBoundingClientRect();
    return {
      panelWidth: rect?.width ?? 0,
      panelRight: rect?.right ?? 0,
      viewport: window.innerWidth,
    };
  });
  check(
    narrow.panelWidth <= 390 && narrow.panelRight <= narrow.viewport + 0.5,
    '390px 视口下调试面板自身不溢出',
  );
  await page.setViewportSize({ width: 1010, height: 940 });
  await page.click('#debug-close');
  const panelClosed = await page.evaluate(
    () => document.querySelector('#debug-panel')?.hidden ?? null,
  );
  check(panelClosed === true, '调试面板能关闭');

  // 存档：写单槽 → 刷新 → 世界恢复（BRIEF 验收目标 4）。
  const beforeSave = await state();
  const saveResult = await page.evaluate(() => window.Oracle.saveNow());
  check(saveResult.ok === true, '手动存档写入单槽');
  const savedRaw = await page.evaluate(() =>
    localStorage.getItem('xiaoxi.pixel-world.save.v1'),
  );
  const savedParsed = typeof savedRaw === 'string' ? JSON.parse(savedRaw) : null;
  // 版本号不写死：写档侧就是 `saveStore.lastSavedMeta().schemaVersion`
  // （`saveStatus()` 透出来的那个）。早先写死 `=== 3`，v5 之后这条必然红，
  // 而它想钉的是「单槽里是当前的 vN JSON」，不是某个历史版本号。
  const saveStatus = await page.evaluate(() => window.Oracle.saveStatus());
  check(
    savedParsed !== null && savedParsed.schemaVersion === saveStatus.schemaVersion,
    `单槽里是 v${savedParsed?.schemaVersion} JSON`,
  );
  // 石板与摆件来源是 v2 新增字段，写档必须带上；缺了就是字段漂移。
  check(
    savedParsed !== null &&
      Array.isArray(savedParsed.world?.oracle) &&
      savedParsed.world.props.every(
        (prop) => 'sourceTaskKind' in prop && 'sourceTaskId' in prop,
      ),
    'v2 存档带石板与摆件来源',
  );

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 15000 });
  const restored = await state();
  check(restored.buildings.length === beforeSave.buildings.length, '刷新后建筑数量恢复');
  check(restored.roads.length === beforeSave.roads.length, '刷新后道路恢复');
  check(restored.faith.milestones === beforeSave.faith.milestones, '刷新后神恩恢复');
  check(
    JSON.stringify(restored.deliveriesByVillager) ===
      JSON.stringify(beforeSave.deliveriesByVillager),
    '刷新后按角色交付统计恢复',
  );
  check(restored.feed.reconciled === false, '读档后标记未对账');
  await page.waitForFunction(
    () => (document.querySelector('#status')?.textContent ?? '').includes('读档未对账'),
    null,
    { timeout: 5000 },
  );
  check(true, '状态行标出读档未对账');

  // 清档 → 刷新 → 回到新世界。
  const cleared = await page.evaluate(() => window.Oracle.clearSave());
  check(cleared.ok === true, '清档入口可用');
  check(
    (await page.evaluate(() => localStorage.getItem('xiaoxi.pixel-world.save.v1'))) === null,
    '清档后单槽为空',
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 15000 });
  const freshWorld = await state();
  check(
    freshWorld.buildings.length >= 3 && freshWorld.faith.milestones === 0,
    '清档后从新世界开始',
  );

  // 时相是纯渲染态：可切到夜、状态保持，且不写世界/上游。
  // 页面按真实时间开局，所以先显式落到昼，再切夜，断言才与时刻无关。
  const nightWorldBefore = await state();
  await page.evaluate(() => window.Oracle.setPhase('noon'));
  const nightOn = await page.evaluate(() => window.Oracle.toggleNight());
  check(nightOn === true, '夜景可以打开');
  await page.waitForTimeout(800);
  check(
    (await page.evaluate(() => window.Oracle.nightEnabled())) === true,
    '夜景状态保持',
  );
  const nightWorldAfter = await state();
  check(
    JSON.stringify(nightWorldAfter.buildings) === JSON.stringify(nightWorldBefore.buildings) &&
      nightWorldAfter.weather === nightWorldBefore.weather &&
      JSON.stringify(nightWorldAfter.faith) === JSON.stringify(nightWorldBefore.faith),
    '夜景不写世界/上游',
  );
  // 关闭 = 交还给真实时间。真实时间此刻可能就是夜，所以不能断言「不再是夜」；
  // 断言的是「回到自动推进」，这才是这条开关的契约。
  await page.evaluate(() => window.Oracle.toggleNight());
  const afterOff = await page.evaluate(() => ({
    phase: window.Oracle.currentPhase(),
    auto: window.Oracle.isAutoPhase(),
  }));
  check(afterOff.auto === true, '关闭夜景后交还给真实时间');
  check(
    afterOff.phase === (await page.evaluate(() => window.Oracle.realPhase())),
    '关闭后停在真实时间对应的刻',
  );
}

try {
  await mkdir(OUT, { recursive: true });
  // PIN 口径的 01 画面在独立页面里拍：主页面从 10:00 开局，向前到不了当天早晨。
  if (PIN_SHOTS) await captureSalute01();
  await page.goto(
    // ?debug=1：维护条（派活按钮、造物、神迹、存档、调试面板）只在调试层出现，
    // 产品页默认没有它们。回归脚本要驱动它们，就必须显式打开这一层。
    // 时间必须由脚本注入，不读墙钟：
    // - `time=noon` 固定昼夜阶段，画面与光照不再随本机时刻变化；
    // - `speed=30` 是回归专用折中：1 世界分钟 = 2 现实秒，走路一格 2 秒、
    //   code 活 60 秒；同时一个逻辑步是 3000 世界毫秒，施工（3200）还能在
    //   快照里活一拍。按默认 60× 跑时步长 6000，施工会在同一拍内走完，
    //   「新楼处于施工中」这条根本采不到样；按 1:1 跑则长活变成几十分钟。
    FEED
      ? `${URL_BASE}?feed=on&debug=1&time=${SMOKE_TIME}&now=${SMOKE_NOW_MINUTES}&speed=30`
      : `${URL_BASE}?feed=off&debug=1&time=${SMOKE_TIME}&now=${SMOKE_NOW_MINUTES}&speed=30`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 15000 });
  check(errors.length === 0, '页面加载无 JS 报错');
  // `?now=` 的读数：脚本先用整数分钟把世界钉在四档之一，再从 Oracle 读回实际开局，
  // 免得「URL 里配了、解析器没认」被当成一次正常跑。读回时世界已按 speed=30
  // 走了 1–2 分钟，所以容差 ±2 分，并打印实际值进证据。
  {
    const posted = await page.evaluate(() => {
      const nowMs = window.Oracle.view().now;
      return Math.floor((nowMs % 86_400_000) / 60_000);
    });
    check(
      posted >= SMOKE_NOW_MINUTES && posted <= SMOKE_NOW_MINUTES + 2,
      `世界时钟按 ?now=${SMOKE_NOW_MINUTES} 开局（实测第 ${posted} 分钟）`,
    );
    console.log(
      `[smoke] time=${SMOKE_TIME} now=${SMOKE_NOW_MINUTES}（实测开局 ${posted} 分）`,
    );
  }

  // 戊类夹具（2026-11-05 用户决定三，只在钉住口径下生效）：
  //   1. 常驻滚动条：8 系列的画布宽度会随滚动条有无漂移，先把它钉成常驻；
  //   2. `#stage` 整数定位：flex 居中可能留下 0.5px，画布落点半像素就会整幅
  //      按不同采样相位重采样（「每像素只差 1 级」的那一大片）。
  if (PIN_SHOTS) {
    await page.evaluate(() => {
      document.documentElement.style.scrollbarGutter = 'stable';
      document.documentElement.style.overflowY = 'scroll';
      // 缩放后舞台会宽过视口；禁止横向滚动条，免得它反过来改视口尺寸。
      document.documentElement.style.overflowX = 'hidden';
    });
    await snapStage();
  }

  const opening = await state();
  // 大世界开局：镇内三铺 + 郊野三铺 + 五间民居。小世界只剩镇内三铺。
  //
  // 原来这条断言写成「建筑总数 == 接活的铺子数」，它默认世界里没有不接活的
  // 建筑。民居进来之后这个前提就不成立了——那不是数字过期，是断言的前提被
  // 推翻。所以拆成两条：铺子数与建筑总数各自校验，谁也不依赖谁。
  const counts = await page.evaluate(() => {
    const buildings = window.Oracle.view().buildings;
    return {
      total: buildings.length,
      workshops: buildings.filter((b) => b.boundTask !== null).length,
      homes: buildings.filter((b) => b.zone === 'living').length,
    };
  });
  check(counts.workshops >= 3, `世界里摆好了铺子（${counts.workshops} 栋接活）`);
  check(
    counts.total === counts.workshops + counts.homes,
    `建筑总数对得上（${counts.total} = ${counts.workshops} 铺 + ${counts.homes} 屋）`,
  );
  check(opening.buildings.length === counts.total, '快照与统计同源');
  check(opening.villager.mode === 'idle', '开局她在闲逛');

  if (FEED) {
    await runFeedSuite();
    report('事件流模式');
  } else {
    await runSandboxSuite();
    report('神谕闭环');
  }

  check(errors.length === 0, '全程无 JS 报错');
} catch (error) {
  console.error(`\n失败：${error.message}`);
  console.error(`已完成 ${checks.length} 项：`);
  for (const label of checks) console.error(`  ok  ${label}`);
  if (errors.length > 0) console.error(`页面报错：\n${errors.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
