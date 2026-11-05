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
// 选一栋**至少两层**的楼：块 2 要验楼梯切层，单层楼切不出东西来。
// `interior()` 里每栋楼都带 `floors`（由剪影派生，视图读法），这里只读不猜。
const first =
  (await street.evaluate(() => window.Oracle.interior().buildings)).find(
    (building) => building.floors >= 2,
  ) ?? (await street.evaluate(() => window.Oracle.interior().buildings[0]));
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

/** 盯着切层：数到目标层落地为止，返回走过的最大帧号。只数帧、不看毫秒。 */
async function watchFloor(page, target) {
  return page.evaluate((floor) => new Promise((resolve) => {
    let frames = 0;
    let iterations = 0;
    const tick = () => {
      const state = window.Oracle.interior();
      frames = Math.max(frames, state.frames);
      if (state.mode === 'inside' && state.floor === floor) {
        resolve({ frames, state, timeout: false });
        return;
      }
      iterations += 1;
      if (iterations > 240) {
        resolve({ frames, state, timeout: true });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), target);
}

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

// 再推 9 帧进第 1 层：室内基准帧。
await stepPage.evaluate(() => window.Oracle.stepInterior(9));
await stepPage.waitForFunction(() => window.Oracle.interior().mode === 'inside', null, { timeout: 20000 });
await stepPage.waitForTimeout(150);
await shot(stepPage, 'interior');
const floorOneState = await stepPage.evaluate(() => window.Oracle.interior());
const floorOneStats = await stepPage.evaluate(() => window.Oracle.renderStats());
const floorOnePose = poseOf(await stepPage.evaluate(() => window.Oracle.camera()));

// 切层中点：暗场全黑，换图看不见接缝。
await roomClick(stepPage, floorOneState.stairUp);
await stepPage.evaluate(() => window.Oracle.stepInterior(9));
await stepPage.waitForTimeout(200);
await shot(stepPage, 'switch-mid');
const switchMid = await stepPage.evaluate(() => window.Oracle.interior());
await stepPage.evaluate(() => window.Oracle.stepInterior(9));
await stepPage.waitForTimeout(150);
await shot(stepPage, 'interior-f2');
const floorTwoState = await stepPage.evaluate(() => window.Oracle.interior());
const floorTwoStats = await stepPage.evaluate(() => window.Oracle.renderStats());
const floorTwoPose = poseOf(await stepPage.evaluate(() => window.Oracle.camera()));

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

// --- 7. 真点：楼梯上下两段、边界反馈、门退出 -------------------------------
const layoutOne = await transition.evaluate(() => window.Oracle.interior());
// 同一页、同一层的基准读数：跨页比会被环境（行人、光照）带偏 ±几帧。
const transitionGroundStats = await transition.evaluate(() => window.Oracle.renderStats());
const stairsUpPoint = await roomClick(transition, layoutOne.stairUp);
const switchUp = await watchFloor(transition, 2);
await shot(transition, 'interior-f2-live');
const floorTwoLive = await transition.evaluate(() => window.Oracle.interior());
const floorTwoLiveStats = await transition.evaluate(() => window.Oracle.renderStats());
const floorTwoLivePose = poseOf(await transition.evaluate(() => window.Oracle.camera()));

// 顶层再点上半：楼层不变，只闪提示（不绕回底层）。
const topUpPoint = await roomClick(transition, floorTwoLive.stairUp);
const topAttempt = await transition.evaluate(() => window.Oracle.interior());

// 点下半下楼：回到第 1 层。
const stairsDownPoint = await roomClick(transition, floorTwoLive.stairDown);
const switchDown = await watchFloor(transition, 1);
const groundAgainStats = await transition.evaluate(() => window.Oracle.renderStats());

// 底层再点下半：同样不动，只闪提示。
const layoutGround = await transition.evaluate(() => window.Oracle.interior());
const bottomDownPoint = await roomClick(transition, layoutGround.stairDown);
await shot(transition, 'stairs-hint');
const bottomAttempt = await transition.evaluate(() => window.Oracle.interior());

// 门：从第 1 层退出，位姿必须逐字回到进门之前。
const doorPoint = await roomClick(transition, layoutGround.door);
await transition.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });
const poseAfterDoor = poseOf(await transition.evaluate(() => window.Oracle.camera()));

// --- 8. 边界：屋里此刻有谁 ----------------------------------------------
// 夜里居民回家，才可能取到非空 `occupants`。逐个民居试，取不到就如实记空房——
// 空房也是合法结果，绝不摆假人凑数。
const night = await openPage(browser, 'time=night&debug=1&interior=instant');
const living = (await night.evaluate(() => window.Oracle.interior().buildings))
  .filter((candidate) => candidate.zone === 'living');
const occupancyProbes = [];
let occupied = null;
for (const candidate of living.slice(0, 6)) {
  await night.evaluate((id) => window.Oracle.enterInterior(id), candidate.id);
  const state = await night.evaluate(() => window.Oracle.interior());
  occupancyProbes.push({
    id: candidate.id,
    name: candidate.name,
    mode: state.mode,
    occupants: state.occupants,
  });
  if (state.occupants.length > 0) {
    occupied = { id: candidate.id, name: candidate.name, occupants: state.occupants };
    break;
  }
  await night.evaluate(() => window.Oracle.exitInterior());
  await night.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });
}
let occupiedStats = null;
if (occupied !== null) {
  await night.waitForTimeout(200);
  await shot(night, 'interior-occupied');
  occupiedStats = await night.evaluate(() => {
    const stats = window.Oracle.renderStats();
    const state = window.Oracle.interior();
    return {
      occupants: state.occupants,
      graphicsObjects: stats.graphicsObjects,
      totalCommands: stats.totalCommands,
    };
  });
  await night.evaluate(() => window.Oracle.exitInterior());
}

// --- 9. 多栋楼：换一栋就换一间 ------------------------------------------
// 注册方式就是 `interior:<instanceId>:f<floor>` 这个键：同一套 232×152 剖面板，
// 家具按 `wallSeed(building)` 派生。这里只验证「换楼真的换图」，不新增楼型模板。
const multiPage = await openPage(browser, 'time=noon&debug=1&interior=instant');
const multiIds = ['cottage_oak#1', 'cottage_stone#1', 'homestead_far#1'];
const multi = [];
for (const id of multiIds) {
  const entered = await multiPage.evaluate((bid) => window.Oracle.enterInterior(bid), id);
  const state = await multiPage.evaluate(() => window.Oracle.interior());
  if (!entered || state.mode !== 'inside') {
    multi.push({ id, entered, mode: state.mode });
    continue;
  }
  await multiPage.waitForTimeout(200);
  const slug = id.split('#')[0];
  await shot(multiPage, `interior-${slug}`);
  const stats = await multiPage.evaluate(() => window.Oracle.renderStats());
  const entry = {
    id,
    name: state.buildingId,
    floors: state.floors,
    graphicsObjects: stats.graphicsObjects,
    totalCommands: stats.totalCommands,
  };
  // 三层的楼（塔楼剪影）再往上看一眼最顶层：楼层夹取的上边界只测过单测，这里补实图。
  if (state.floors >= 3) {
    await multiPage.evaluate(() => {
      window.Oracle.switchInteriorFloor(1);
      window.Oracle.switchInteriorFloor(1);
    });
    await multiPage.waitForTimeout(200);
    const top = await multiPage.evaluate(() => window.Oracle.interior());
    await shot(multiPage, `interior-${slug}-f3`);
    entry.topFloor = { floor: top.floor, floors: top.floors, canUp: top.canUp };
    await multiPage.evaluate(() => {
      window.Oracle.switchInteriorFloor(-1);
      window.Oracle.switchInteriorFloor(-1);
    });
  }
  multi.push(entry);
  await multiPage.evaluate(() => window.Oracle.exitInterior());
  await multiPage.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });
}

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
    floors: first.floors,
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
    floors: insideState.floors,
    occupants: insideState.occupants,
    room: insideState.room,
    door: insideState.door,
    stairs: insideState.stairs,
    stairUp: insideState.stairUp,
    stairDown: insideState.stairDown,
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
  /** 逐帧推出来的切层：第 1 层 → 中点暗场 → 第 2 层。 */
  floorSwitch: {
    from: { floor: floorOneState.floor, frames: floorOneState.frames, pose: floorOnePose,
      graphicsObjects: floorOneStats.graphicsObjects, totalCommands: floorOneStats.totalCommands },
    mid: { frames: switchMid.frames, mode: switchMid.mode, floor: switchMid.floor,
      imageAlpha: switchMid.view?.image?.alpha ?? null, imageVisible: switchMid.view?.image?.visible ?? null },
    to: { floor: floorTwoState.floor, frames: floorTwoState.frames, pose: floorTwoPose,
      graphicsObjects: floorTwoStats.graphicsObjects, totalCommands: floorTwoStats.totalCommands },
    // 相机在切层前后必须一个数字都不动：切层是同一间屋里的上下移动。
    poseIdentical: JSON.stringify(floorOnePose) === JSON.stringify(floorTwoPose),
    statsIdentical:
      floorOneStats.graphicsObjects === floorTwoStats.graphicsObjects
      && floorOneStats.totalCommands === floorTwoStats.totalCommands,
    deltaCommands: floorTwoStats.totalCommands - floorOneStats.totalCommands,
  },
  /** 同页对照：第 1 层读数在下楼前再取一次，分清「换层带来的差」与「环境在变」。 */
  groundReturn: {
    firstFloor: {
      graphicsObjects: transitionGroundStats.graphicsObjects,
      totalCommands: transitionGroundStats.totalCommands,
    },
    afterDown: {
      graphicsObjects: groundAgainStats.graphicsObjects,
      totalCommands: groundAgainStats.totalCommands,
    },
    sameAsFirstFloor:
      groundAgainStats.graphicsObjects === transitionGroundStats.graphicsObjects
      && groundAgainStats.totalCommands === transitionGroundStats.totalCommands,
    samePageFloorDelta: {
      graphicsObjects: floorTwoLiveStats.graphicsObjects - transitionGroundStats.graphicsObjects,
      totalCommands: floorTwoLiveStats.totalCommands - transitionGroundStats.totalCommands,
    },
  },
  /** 真点楼梯：上楼 18 帧、下楼 18 帧；顶层再上 / 底层再下只闪提示。 */
  clicks: {
    stairsUpPoint,
    switchUp: { frames: switchUp.frames, timeout: switchUp.timeout,
      floor: switchUp.state.floor, mode: switchUp.state.mode, pose: floorTwoLivePose },
    topUpPoint,
    topUpAttempt: { floor: topAttempt.floor, hintFrames: topAttempt.hintFrames, mode: topAttempt.mode },
    stairsDownPoint,
    switchDown: { frames: switchDown.frames, timeout: switchDown.timeout,
      floor: switchDown.state.floor, mode: switchDown.state.mode },
    bottomDownPoint,
    bottomDownAttempt: { floor: bottomAttempt.floor, hintFrames: bottomAttempt.hintFrames,
      mode: bottomAttempt.mode },
    doorPoint,
    modeAfterDoor: 'street',
    poseAfterDoor,
    poseAfterDoorMatches: samePose(poseAfterDoor, transitionPose),
  },
  /** 边界：夜里的屋里有谁（`insideAt` 现取）。没人就记空数组。 */
  occupancy: {
    time: 'night',
    livingBuildings: living.map((candidate) => ({ id: candidate.id, name: candidate.name })),
    probes: occupancyProbes,
    occupied,
    occupiedStats,
  },
  /** 多栋楼：同一套剖面板，换 instanceId 就换一张烘焙图。 */
  multiBuilding: multi,
  world: world,
};

report.summary = {
  poseRoundTrip: samePose(finalPose, streetPose) ? 'PASS' : 'FAIL',
  allTenCyclesSame: report.results.afterTenCycles.cycles.every((item) => item.matches),
  transitionFrames: timing.maxFrames,
  floorSwitchFrames: switchUp.frames,
  floorSwitchPoseIdentical: report.results.floorSwitch.poseIdentical,
  commandsWithinBudget: insideStats.totalCommands < 30000,
};

await writeFile(`${OUT}/readings.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));
console.log(`sha256(readings.json) = ${createHash('sha256').update(JSON.stringify(report)).digest('hex')}`);

await browser.close();
