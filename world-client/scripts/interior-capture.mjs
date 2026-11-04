/**
 * 内景这条线的验收取数：街景 / 过渡中点 / 室内三张裁图 + 相机位姿往返 + 指令增量。
 *
 * 跑法（在 `world-client/` 下先开本 worktree 的 dev server）：
 *   npx vite --port 5191 --strictPort
 *   node scripts/interior-capture.mjs
 *
 * 只读页面、只点页面暴露的 `window.Oracle`，不写存档、不碰世界。
 * 取证机位固定 `?time=noon&debug=1`，关掉过渡用 `?interior=instant`——
 * 这一条是必须的：过渡帧会把「前后裁图」的像素差全搅成动画噪声。
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = 'D:/project/pwe-material/docs/evidence/interior-view';
const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5191/';
const VIEW = { width: 960, height: 640 };

/** 相机位姿的三个原值：逐字相同才叫「回到原点」。 */
function poseOf(camera) {
  return {
    scrollX: camera.scrollX,
    scrollY: camera.scrollY,
    zoom: camera.zoom,
  };
}

function samePose(a, b) {
  return a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.zoom === b.zoom;
}

async function openPage(browser, query) {
  const page = await browser.newPage({ viewport: VIEW });
  await page.goto(`${BASE}?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  return page;
}

const browser = await chromium.launch();
await mkdir(`${OUT}/shots`, { recursive: true });

/** 主画布有 480×320 的后备尺寸 + CSS 2 倍；小地图也是 canvas，必须写死取哪个。 */
async function shot(page, name) {
  await page.locator('#app canvas').screenshot({ path: `${OUT}/shots/${name}.png` });
}

const report = {
  capturedAt: '2026-11-04',
  baseUrl: BASE,
  results: {},
};

// --- 1. 街景基线 -----------------------------------------------------------
const street = await openPage(browser, 'time=noon&debug=1&interior=instant');
const first = await street.evaluate(() => {
  const state = window.Oracle.interior();
  return state.buildings[0];
});
const streetPose = poseOf(await street.evaluate(() => window.Oracle.camera()));
const streetStats = await street.evaluate(() => window.Oracle.renderStats());
await shot(street, 'street');

// --- 2. 进屋（关过渡）-------------------------------------------------------
await street.evaluate((id) => window.Oracle.enterInterior(id), first.id);
await street.waitForFunction(() => window.Oracle.interior().mode === 'inside', null, { timeout: 20000 });
await shot(street, 'interior');
const insideStats = await street.evaluate(() => window.Oracle.renderStats());
const insideState = await street.evaluate(() => window.Oracle.interior());
const insideCamera = await street.evaluate(() => window.Oracle.camera());

// --- 3. 冻结 1 秒：室内画面必须 0 差异 -------------------------------------
await shot(street, 'frozen-a');
await street.waitForTimeout(1000);
await shot(street, 'frozen-b');

// --- 4. 连进连出 10 次：位姿逐字回到原点 -----------------------------------
const cycles = [];
for (let index = 0; index < 10; index += 1) {
  await street.evaluate(() => window.Oracle.exitInterior());
  await street.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });
  const pose = poseOf(await street.evaluate(() => window.Oracle.camera()));
  cycles.push({ cycle: index + 1, pose, matches: samePose(pose, streetPose) });
  await street.evaluate((id) => window.Oracle.enterInterior(id), first.id);
  await street.waitForFunction(() => window.Oracle.interior().mode === 'inside', null, { timeout: 20000 });
}
// 最后一次退出，让页面回到街景，便于对照。
await street.evaluate(() => window.Oracle.exitInterior());
await street.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });
const finalPose = poseOf(await street.evaluate(() => window.Oracle.camera()));
const finalStats = await street.evaluate(() => window.Oracle.renderStats());
await shot(street, 'street-after');

// --- 5. 过渡：固定帧数与中点帧 ---------------------------------------------
const transition = await openPage(browser, 'time=noon&debug=1');
const transitionPose = poseOf(await transition.evaluate(() => window.Oracle.camera()));
await transition.evaluate(() => window.Oracle.setInteriorTransition(true));
const timing = await transition.evaluate((id) => new Promise((resolve) => {
  const started = performance.now();
  let maxFrames = 0;
  window.Oracle.enterInterior(id);
  const tick = () => {
    const state = window.Oracle.interior();
    maxFrames = Math.max(maxFrames, state.frames);
    if (state.mode === 'inside') {
      resolve({ maxFrames, elapsedMs: performance.now() - started });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), first.id);

// 中点帧必须**钉住帧号**：截图要几百毫秒，自走的过渡早跑到第 18 帧了
// （第一次取证拍到的「中点帧」其实与室内帧逐像素相同，就是这个原因）。
// `?interior=step` 下过渡不自走，`stepInterior(9)` 推 9 帧即可。
const stepPage = await openPage(browser, 'time=noon&debug=1&interior=step');
await stepPage.evaluate((id) => window.Oracle.enterInterior(id), first.id);
await stepPage.evaluate(() => window.Oracle.stepInterior(9));
await stepPage.waitForTimeout(250);
await shot(stepPage, 'transition-mid');
const midState = await stepPage.evaluate(() => window.Oracle.interior());

// --- 6. 真点：街景点门进屋 ------------------------------------------------
// 门格是世界坐标里的一格，换算回屏幕要经过相机的 zoom，所以先把镜头摆到楼中心，
// 再从 `Oracle.camera()` 读回**实际的** scroll，别用公式现算现信。
const clickPage = await openPage(browser, 'time=noon&debug=1&interior=instant');
await clickPage.evaluate((center) => window.Oracle.centerCameraOn(center.x, center.y), {
  x: (first.origin.x + first.footprint.w / 2) * 16,
  y: (first.origin.y + first.footprint.h / 2) * 16,
});
await clickPage.waitForTimeout(400);
const clickCam = await clickPage.evaluate(() => window.Oracle.camera());
const clickBox = await clickPage.locator('#app canvas').boundingBox();
const clickScale = clickBox.width / clickCam.width;
const doorWorld = { x: first.door.x * 16 + 8, y: first.door.y * 16 + 8 };
const doorPointStreet = {
  x: clickBox.x + ((doorWorld.x - (clickCam.scrollX + clickCam.width / 2)) * clickCam.zoom + clickCam.width / 2) * clickScale,
  y: clickBox.y + ((doorWorld.y - (clickCam.scrollY + clickCam.height / 2)) * clickCam.zoom + clickCam.height / 2) * clickScale,
};
await clickPage.mouse.click(doorPointStreet.x, doorPointStreet.y);
await clickPage.waitForFunction(() => window.Oracle.interior().mode === 'inside', null, { timeout: 20000 });
const enterByClick = await clickPage.evaluate(() => window.Oracle.interior());

// --- 7. 真点：楼梯要有反馈，门要能退出 -------------------------------------
// 内景画在屏幕坐标上，坐标换算写死在这里：内景 1 texel = 2 内部像素，
// 画布 480×320、CSS 2 倍；房间左上 = (240 - 232, 160 - 152) = (8, 8) 内部像素。
const roomLeft = 240 - 232;
const roomTop = 160 - 152;
/**
 * 点房间里的某个图元。
 *
 * **每次都要重新读 canvas 的位置**：`locator.screenshot()` 会把元素滚进视口，
 * 页面纵向位置跟着变；拿截图前的 box 去点门，落点会偏到门外的地面上
 * （取证时就是这样：楼梯点到了，门点空了）。
 */
async function roomClick(page, rect) {
  const box = await page.locator('#app canvas').boundingBox();
  const k = box.width / 480;
  const point = {
    x: box.x + (roomLeft + (rect.x + rect.w / 2) * 2) * k,
    y: box.y + (roomTop + (rect.y + rect.h / 2) * 2) * k,
  };
  await page.mouse.click(point.x, point.y);
  return point;
}
const layoutInfo = await transition.evaluate(() => window.Oracle.interior());
const stairsPoint = await roomClick(transition, layoutInfo.stairs);
await shot(transition, 'stairs-hint');
const stairsClick = await transition.evaluate(() => window.Oracle.interior());
const doorPoint = await roomClick(transition, layoutInfo.door);
await transition.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });
const poseAfterDoor = poseOf(await transition.evaluate(() => window.Oracle.camera()));

const world = await street.evaluate(() => {
  window.Oracle.saveNow();
  const parsed = JSON.parse(window.localStorage.getItem('xiaoxi.pixel-world.save.v1') ?? '{}');
  return {
    villagers: parsed.world?.villagers?.length ?? null,
    buildings: parsed.world?.buildings?.length ?? null,
    memoryLength: typeof parsed.world?.memory === 'string' ? parsed.world.memory.length : null,
    schemaVersion: parsed.schemaVersion ?? null,
    schemaFingerprint: parsed.meta?.schemaFingerprint ?? null,
  };
});

report.results = {
  building: {
    id: first.id,
    name: first.name,
    door: first.door,
    origin: first.origin,
    footprint: first.footprint,
  },
  street: {
    pose: streetPose,
    graphicsObjects: streetStats.graphicsObjects,
    totalCommands: streetStats.totalCommands,
  },
  interior: {
    pose: poseOf(insideCamera),
    canvas: { width: insideCamera.width, height: insideCamera.height },
    graphicsObjects: insideStats.graphicsObjects,
    totalCommands: insideStats.totalCommands,
    mode: insideState.mode,
    floor: insideState.floor,
    room: insideState.room,
    door: insideState.door,
    stairs: insideState.stairs,
    view: insideState.view,
  },
  delta: {
    graphicsObjects: insideStats.graphicsObjects - streetStats.graphicsObjects,
    totalCommands: insideStats.totalCommands - streetStats.totalCommands,
  },
  afterTenCycles: {
    pose: finalPose,
    matches: samePose(finalPose, streetPose),
    poseIdentical: JSON.stringify(finalPose) === JSON.stringify(streetPose),
    graphicsObjects: finalStats.graphicsObjects,
    totalCommands: finalStats.totalCommands,
    cycles,
  },
  transition: {
    framesToInside: timing.maxFrames,
    elapsedMs: Math.round(timing.elapsedMs),
    midFrames: midState.frames,
    midMode: midState.mode,
    cameraMid: poseOf(await stepPage.evaluate(() => window.Oracle.camera())),
  },
  enterByDoorClick: {
    doorPoint: doorPointStreet,
    mode: enterByClick.mode,
    buildingId: enterByClick.buildingId,
    frames: enterByClick.frames,
  },
  clicks: {
    stairsPoint,
    doorPoint,
    stairsHintFramesAfterClick: stairsClick.hintFrames,
    stairsMode: stairsClick.mode,
    modeAfterDoor: 'street',
    poseAfterDoor,
    poseAfterDoorMatches: samePose(poseAfterDoor, transitionPose),
  },
  world: world,
};

report.summary = {
  poseRoundTrip: samePose(finalPose, streetPose) ? 'PASS' : 'FAIL',
  allTenCyclesSame: report.results.afterTenCycles.cycles.every((item) => item.matches),
  transitionFrames: timing.maxFrames,
  commandsWithinBudget: insideStats.totalCommands < 30000,
};

await writeFile(`${OUT}/readings.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));
console.log(`sha256(readings.json) = ${createHash('sha256').update(JSON.stringify(report)).digest('hex')}`);

await browser.close();
