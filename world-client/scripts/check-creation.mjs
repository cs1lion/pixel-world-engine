#!/usr/bin/env node
/**
 * 造物模式回归：进入、悬停、非法拒绝、回车建成、Esc 取消、世界暂停与恢复。
 *
 * 走真实鼠标与键盘，不走 API 捷径——输入层正是这一片最容易坏的地方。
 *
 * 跑法：
 *   1. npm run dev
 *   2. node scripts/check-creation.mjs
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cellToCanvasPoint } from './lib/camera-projection.mjs';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const OUT = 'eval/screens';
const PREFAB = 'workshop_plot';

const reports = [];
const failures = [];
const check = (ok, label, detail = '') => {
  reports.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail === '' ? '' : `（${detail}）`}`);
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1010, height: 1100 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.addInitScript(() => localStorage.clear());
await page.goto(`${BASE}?feed=off&time=noon&debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });
await page.waitForTimeout(600);

const box = await page.locator('canvas').first().boundingBox();
const canvasSize = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return { width: canvas.width, height: canvas.height };
});

const currentCamera = () => page.evaluate(() => window.Oracle.camera());

/** 世界格中心 → 页面坐标。换算走脚本层共享的 `cellToCanvasPoint`。 */
const pointForCell = (cell, cam) => {
  const point = cellToCanvasPoint(
    cell,
    cam,
    { width: box.width, height: box.height },
    canvasSize,
  );
  return { x: box.x + point.x, y: box.y + point.y };
};

/**
 * 把**世界格坐标**换成页面坐标，移动真实鼠标。
 *
 * 大世界里画布只是世界的一小块，必须减掉相机偏移；否则点的是屏幕上那个位置，
 * 世界坐标却完全在别处。`scroll` 是镜头中心，换到屏幕要先用视野原点
 * （`cellToCanvasPoint`），否则 zoom≠1 时会偏半个视野。
 */
const hover = async (x, y) => {
  // 先把镜头对准目标格：目标可能在视野之外（工业区离祭坛有十几格）。
  // 不这么做，换算出来的屏幕坐标会是负数，鼠标落在画布外。
  await page.evaluate(
    (cell) => window.Oracle.centerCameraOn(cell.x * 16, cell.y * 16),
    { x, y },
  );
  await page.waitForTimeout(120);
  const cam = await currentCamera();
  const point = pointForCell({ x, y }, cam);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(180);
};

/** 祭坛坐标：大世界里它是世界中心 (40,30)，不再是 (15,9)。 */
const ALTAR = await page.evaluate(() => window.Oracle.view().altar);

/**
 * 找一个真的能建的位置。
 *
 * 大世界里 `workshop_plot` 属于工业区，而工业区不在祭坛旁边——小世界那套
 * 「往祭坛旁边一放就行」的假设不成立了。这里直接扫描工业区，用真实校验找点。
 */
const LEGAL = await page.evaluate(() => {
  window.Oracle.beginCreation('workshop_plot');
  let found = null;
  for (let y = 8; y < 26 && found === null; y += 1) {
    for (let x = 30; x < 52; x += 1) {
      // 只查询，不确认：确认会真的建一栋楼，把后面的用例全部污染。
      if (window.Oracle.canPlaceAt({ x, y })) {
        found = { x, y };
        break;
      }
    }
  }
  window.Oracle.cancelCreation();
  return found;
});
if (LEGAL === null) throw new Error('大世界里找不到合法的造物位置');

// ------------------------------------------------------------------ 进入
await page.click(`button[data-create="${PREFAB}"]`);
await page.waitForTimeout(300);
check(
  (await page.evaluate(() => window.Oracle.creation())) !== null,
  '点按钮进入造物模式',
);

// ------------------------------------------------------------------ 暂停
const t0 = await page.evaluate(() => window.Oracle.view().now);
await page.waitForTimeout(1200);
const t1 = await page.evaluate(() => window.Oracle.view().now);
check(t0 === t1, '造物模式下世界暂停', `now ${t0} → ${t1}`);

// ------------------------------------------------------------------ 悬停
await hover(ALTAR.x - 1, ALTAR.y - 1);
const hovered = await page.evaluate(() => window.Oracle.creation());
check(
  hovered !== null && hovered.ghostAt !== null &&
    hovered.ghostAt.x === ALTAR.x - 1 && hovered.ghostAt.y === ALTAR.y - 1,
  '鼠标移动更新幽灵位置',
  JSON.stringify(hovered?.ghostAt),
);

// ------------------------------------------------------------------ 非法位置
await hover(ALTAR.x, ALTAR.y); // 祭坛正中：不可建
const rejected = await page.evaluate(() => window.Oracle.confirmCreation());
check(rejected.ok === false, '非法位置确认被拒', rejected.message);
check(
  typeof rejected.message === 'string' && rejected.message.length > 0,
  '拒绝时给出可读理由',
  rejected.message,
);
await page.screenshot({ path: `${OUT}/creation-rejected.png` });

// ------------------------------------------------------------------ Esc 取消
// 先记下进入模式前的建筑数，Esc 之后必须还是这个数。
const buildingsBeforeEsc = await page.evaluate(() => window.Oracle.view().buildings.length);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const afterEsc = await page.evaluate(() => ({
  creating: window.Oracle.creation(),
  buildings: window.Oracle.view().buildings.length,
  now: window.Oracle.view().now,
}));
check(afterEsc.creating === null, 'Esc 退出造物模式');
check(
  afterEsc.buildings === buildingsBeforeEsc,
  '取消后没有新建筑',
  `${afterEsc.buildings} vs ${buildingsBeforeEsc}`,
);
await page.waitForTimeout(800);
check(
  (await page.evaluate(() => window.Oracle.view().now)) > afterEsc.now,
  '取消后世界恢复推进',
);

// ------------------------------------------------------------------ 倍率下的落点换算
// 旧写法 (world - scroll) * cssScale 在 zoom≠1 时差半个视野：zoom=2 偏 2 格、
// zoom=3 偏 3 格（实测见 tmp/live-check-20261102/coords-before.json）。
//
// 造物模式里滚轮被禁用（SandboxScene 的 wheel handler 在 creation 时直接 return），
// 所以每一档都先退出、切倍率、再进模式。探测格故意**不放在镜头正中**——
// `centerCameraOn` 居中会把半视野偏移抵消掉，那是这个 bug 藏到今天的原因。
const ZOOM_STEPS = [1, 1.5, 2, 3];
const ZOOM_PROBE = { x: ALTAR.x + 4, y: ALTAR.y };
const currentZoom = () => page.evaluate(() => window.Oracle.camera().zoom);
const setZoom = async (target) => {
  for (let guard = 0; guard < 8; guard += 1) {
    const current = await currentZoom();
    if (current === target) return;
    const ci = ZOOM_STEPS.indexOf(current);
    const ti = ZOOM_STEPS.indexOf(target);
    if (ci < 0 || ti < 0) throw new Error(`不认识的 zoom：${current} → ${target}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // dy>0 = 缩小，dy<0 = 放大。
    await page.mouse.wheel(0, ci < ti ? -100 : 100);
    await page.waitForTimeout(350);
  }
  throw new Error(`切不到 zoom=${target}（停在 ${await currentZoom()}）`);
};

const zoomHits = [];
for (const target of [1, 2, 3]) {
  await setZoom(target);
  await page.click(`button[data-create="${PREFAB}"]`);
  await page.waitForTimeout(250);
  await page.evaluate((cell) => window.Oracle.centerCameraOn(cell.x * 16, cell.y * 16), ALTAR);
  await page.waitForTimeout(180);
  const cam = await currentCamera();
  const point = pointForCell(ZOOM_PROBE, cam);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(200);
  const ghost = await page.evaluate(() => window.Oracle.creation()?.ghostAt ?? null);
  zoomHits.push({ zoom: cam.zoom, point, ghost });
  check(
    ghost !== null && ghost.x === ZOOM_PROBE.x && ghost.y === ZOOM_PROBE.y,
    `zoom=${cam.zoom} 下鼠标命中探测格`,
    JSON.stringify(ghost),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
check(
  zoomHits.length >= 2 &&
    new Set(zoomHits.map((row) => `${row.ghost?.x},${row.ghost?.y}`)).size === 1,
  'zoom=1/2/3 点击同一格的结果一致',
  JSON.stringify(zoomHits.map((row) => ({ zoom: row.zoom, ghost: row.ghost }))),
);
await setZoom(2);

// ------------------------------------------------------------------ 回车建成
await page.click(`button[data-create="${PREFAB}"]`);
await page.waitForTimeout(300);
await hover(LEGAL.x, LEGAL.y);
await page.screenshot({ path: `${OUT}/creation-ghost.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(900);

const built = await page.evaluate(() => ({
  buildings: window.Oracle.view().buildings.map((b) => ({ id: b.instanceId, origin: b.origin })),
  creating: window.Oracle.creation(),
}));
const plot = built.buildings.find((b) => b.id.startsWith(PREFAB));
check(plot !== undefined, '回车后新楼出现', JSON.stringify(built.buildings.map((b) => b.id)));
check(
  plot !== undefined && plot.origin.x === LEGAL.x && plot.origin.y === LEGAL.y,
  '新楼落在鼠标指定的位置',
  JSON.stringify(plot?.origin),
);
check(built.creating === null, '建成后自动退出造物模式');

// 迷雾区不能建：那是还没长出来的地方。
const fogCheck = await page.evaluate(() => {
  const fog = window.Oracle.view().fog;
  window.Oracle.beginCreation('workshop_plot');
  // 取一个明确在迷雾深处的位置：中心往外很远。
  const far = { x: fog.center.x, y: fog.center.y + fog.revealedRadius + 12 };
  const allowed = window.Oracle.canPlaceAt(far);
  window.Oracle.cancelCreation();
  return { allowed, far, radius: fog.revealedRadius };
});
check(fogCheck.allowed === false, '迷雾区不能建', JSON.stringify(fogCheck));

// 急件请旨（blocked 单完整呈现在纸面上）不在这里测：
// 它要的是**连着上游**的世界，本脚本起的是纯沙盒（`?feed=off`）。
// 断网时 `syncEvents` 会整帧丢弃折叠结果——这是对的（不能把"没读到"当成"全都撤了"），
// 但也就意味着沙盒里注入的 blocked 单永远到不了急件面板。
// 这条断言在 `scripts/smoke.mjs` 的 `FEED=1` 模式里（那边有真服务端）。

check(errors.length === 0, '全程无 JS 报错', errors.join('; '));

await browser.close();

for (const item of reports) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.label}${item.detail === '' ? '' : `  ${item.detail}`}`);
}
if (failures.length > 0) {
  console.error(`\n造物模式失败 ${failures.length} 项：`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\n造物模式：${reports.length} 项通过`);
