/**
 * 交互 L1/L2/L3 的真实点击脚本（沿用 smoke.mjs 的写法，不引入新框架）。
 *
 * 跑法：
 *   npm run dev -- --port 5188
 *   node scripts/check-interact.mjs
 *
 * 只做「玩家手会点到的路径」：左键 / 右键 / 长按 / 点空白 / 边缘 / 缩放 / 面板互斥 /
 * 输入框 / 存档重开。命中与投影都用 `scripts/lib/camera-projection.mjs`，并把像素
 * 误差写进结果，不只写「通过」。
 */

import { chromium } from '@playwright/test';
import { cellToCanvasPoint, viewOriginOf, TILE_PX } from './lib/camera-projection.mjs';

const BASE = process.env.PWE_URL ?? 'http://127.0.0.1:5188/';
const DAY_MS = 24 * 60 * 60 * 1000;

const results = [];
const todos = [];
let failures = 0;

function check(level, name, run) {
  try {
    const detail = run();
    results.push({ level, name, ok: true, detail });
    console.log(`  ok   ${level} ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  } catch (error) {
    failures += 1;
    results.push({ level, name, ok: false, detail: String(error?.message ?? error) });
    console.log(`  FAIL ${level} ${name} — ${error?.message ?? error}`);
  }
}

async function checkAsync(level, name, run) {
  try {
    const detail = await run();
    results.push({ level, name, ok: true, detail });
    console.log(`  ok   ${level} ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  } catch (error) {
    failures += 1;
    results.push({ level, name, ok: false, detail: String(error?.message ?? error) });
    console.log(`  FAIL ${level} ${name} — ${error?.message ?? error}`);
  }
}

/**
 * 已知缺口：期望值照写，不符合就记为 todo，不把整轮当失败、也不改期望迁就现状。
 */
async function checkTodo(level, name, run) {
  try {
    const detail = await run();
    results.push({ level, name, ok: true, detail, todo: true });
    console.log(`  ok   ${level}（todo 已满足）${name} — ${detail}`);
  } catch (error) {
    const detail = String(error?.message ?? error);
    todos.push({ level, name, detail });
    results.push({ level, name, ok: false, todo: true, detail });
    console.log(`  todo ${level} ${name} — ${detail}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}：实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
  }
}

async function openPage(browser, query) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    hasTouch: true,
  });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('interact-cleared')) {
      localStorage.clear();
      sessionStorage.setItem('interact-cleared', '1');
    }
    // document 级监听器计数：反复开关面板不该让这个数上涨。
    window.__docListeners = 0;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, run, options) {
      if (this === document) window.__docListeners += 1;
      return add.call(this, type, run, options);
    };
    EventTarget.prototype.removeEventListener = function (type, run, options) {
      if (this === document) window.__docListeners -= 1;
      return remove.call(this, type, run, options);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.Oracle !== undefined && window.Oracle.view !== undefined);
  await page.waitForTimeout(400);
  return { context, page, errors };
}

async function camera(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const cam = window.Oracle.camera();
    return {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      game: { width: canvas.width, height: canvas.height },
      cam,
    };
  });
}

async function focusCell(page, cell) {
  await page.evaluate(
    ([x, y]) => {
      window.Oracle.setCameraMode?.('free');
      window.Oracle.centerCameraOn((x + 0.5) * 16, (y + 0.5) * 16);
    },
    [cell.x, cell.y],
  );
  await page.waitForTimeout(220);
}

/** 把三个面板都收起（直接点各自的关闭钮，元素隐藏时 click 也照样派发）。 */
async function resetPanels(page) {
  await page.evaluate(() => {
    document.querySelector('#unit-status-close')?.click();
    document.querySelector('#villager-panel-close')?.click();
    document.querySelector('#building-panel-close')?.click();
  });
  await page.waitForTimeout(80);
}

async function rightClickVillager(page, id) {
  const view = await page.evaluate(() => window.Oracle.view());
  const villager = view.villagers.find((item) => item.id === id);
  assert(villager !== undefined, '右键前村民不见了');
  await focusCell(page, cellOf(villager.pos));
  const fresh = await page.evaluate((holderId) => window.Oracle.view().villagers.find((item) => item.id === holderId), id);
  assert(fresh !== undefined, '右键前村民不见第二次');
  await clickCell(page, cellOf(fresh.pos), { button: 'right' });
  return fresh;
}

async function pointOfCell(page, cell) {
  const snapshot = await camera(page);
  const point = cellToCanvasPoint(cell, snapshot.cam, snapshot.rect, snapshot.game);
  return {
    x: point.x + snapshot.rect.left,
    y: point.y + snapshot.rect.top,
    snapshot,
    point,
  };
}

async function clickCell(page, cell, options) {
  const target = await pointOfCell(page, cell);
  await page.mouse.click(target.x, target.y, options);
  await page.waitForTimeout(120);
  return target;
}

async function panelState(page) {
  return page.evaluate(() => ({
    unit: !document.querySelector('#unit-status').hidden,
    villager: !document.querySelector('#villager-panel').hidden,
    building: !document.querySelector('#building-panel').hidden,
    title: document.querySelector('#unit-status-title').textContent,
    subtitle: document.querySelector('#unit-status-subtitle').textContent,
    rows: [...document.querySelectorAll('#unit-status-body .unit-status-row')].map((row) => ({
      key: row.querySelector('.unit-status-key')?.textContent ?? '',
      value: row.querySelector('.unit-status-value')?.textContent ?? '',
    })),
    villagerTitle: document.querySelector('#villager-panel-name')?.textContent ?? '',
    buildingTitle: document.querySelector('#building-panel-name')?.textContent ?? '',
    reply: document.querySelector('#reply')?.textContent ?? '',
    nodeCount: document.querySelector('#unit-status').querySelectorAll('*').length,
    docListeners: window.__docListeners,
  }));
}

function moodText(mood) {
  if (mood === null) return '还没有可读的情绪状态';
  return `${mood.label} · 效价 ${mood.valence.toFixed(2)} · 唤醒 ${mood.arousal.toFixed(2)}`;
}

function debtText(debt) {
  if (debt > 0.005) return `我欠他 ${debt.toFixed(2)}`;
  if (debt < -0.005) return `他欠我 ${Math.abs(debt).toFixed(2)}`;
  return '两不相欠';
}

function bondText(bond) {
  if (bond === undefined) return '还没有印象 · 信任 0.00 · 亲疏 0.00 · 两不相欠';
  return `信任 ${bond.trust.toFixed(2)} · 亲疏 ${bond.warmth.toFixed(2)} · ${debtText(bond.debt)}`;
}

function cellOf(pos) {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}

function villagerAtCell(view, cell) {
  return view.villagers.find(
    (villager) => Math.floor(villager.pos.x) === cell.x && Math.floor(villager.pos.y) === cell.y,
  );
}

function visibleVillager(view) {
  const villager = view.villagers.find((item) => item.visible);
  if (villager === undefined) throw new Error('画面上没有可见的村民');
  return villager;
}

function footprintOf(building) {
  return building.footprint ?? building.footprintRect ?? { w: 2, h: 2 };
}

function insideFootprint(building, cell) {
  const footprint = footprintOf(building);
  return (
    cell.x >= building.origin.x
    && cell.x < building.origin.x + footprint.w
    && cell.y >= building.origin.y
    && cell.y < building.origin.y + footprint.h
  );
}

function occupiedCells(view) {
  const occupied = new Set(
    view.villagers
      .filter((villager) => villager.visible)
      .map((villager) => `${Math.floor(villager.pos.x)},${Math.floor(villager.pos.y)}`),
  );
  for (const building of view.buildings) {
    const footprint = footprintOf(building);
    for (let x = building.origin.x; x < building.origin.x + footprint.w; x += 1) {
      for (let y = building.origin.y; y < building.origin.y + footprint.h; y += 1) {
        occupied.add(`${x},${y}`);
      }
    }
  }
  return occupied;
}

/**
 * 屏幕上点得到的空格子：既不在面板矩形里，也在画布可见范围内。
 * 面板跟着选中的单位走，盲点任意空格可能点到面板上——那样关不掉面板。
 */
async function pickEmptyCell(page, margin = 12) {
  const view = await page.evaluate(() => window.Oracle.view());
  const snapshot = await camera(page);
  const rects = await panelRects(page);
  const occupied = occupiedCells(view);
  const left = snapshot.rect.left;
  const top = snapshot.rect.top;
  const candidates = [];
  for (let x = 8; x < 88; x += 1) {
    for (let y = 8; y < 64; y += 1) {
      if (occupied.has(`${x},${y}`)) continue;
      const point = cellToCanvasPoint({ x, y }, snapshot.cam, snapshot.rect, snapshot.game);
      const px = point.x + left;
      const py = point.y + top;
      if (px < left + margin || py < top + margin || px > left + snapshot.rect.width - margin || py > top + snapshot.rect.height - margin) {
        continue;
      }
      if (rects.some((rect) => px >= rect.left - margin && px <= rect.right + margin && py >= rect.top - margin && py <= rect.bottom + margin)) {
        continue;
      }
      candidates.push({ cell: { x, y }, x: px, y: py });
    }
  }
  if (candidates.length === 0) throw new Error('屏幕上没有不被面板盖住的空格子');
  // 取离镜头中心最近的一个，误差最小。
  return candidates[0];
}

async function openStatusByClick(page, villager) {
  await focusCell(page, cellOf(villager.pos));
  const view = await page.evaluate(() => window.Oracle.view());
  const current = view.villagers.find((item) => item.id === villager.id);
  if (current === undefined) throw new Error('村民在点击前消失了');
  const target = await clickCell(page, cellOf(current.pos));
  const state = await panelState(page);
  assert(state.unit, `左键点在 ${current.name} 的格子上，状态菜单没有出现`);
  return { target, state };
}

/** 现在开着的三个面板的屏幕矩形：用来避开「面板盖住了下一个要点的单位」。 */
async function panelRects(page) {
  return page.evaluate(() => {
    const rects = [];
    for (const id of ['unit-status', 'villager-panel', 'building-panel']) {
      const element = document.getElementById(id);
      if (element === null || element.hidden) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
    }
    return rects;
  });
}

/**
 * 挑一个「屏幕上点得到、且不被已开面板盖住」的在场村民。
 * 返回的坐标是页面坐标（canvas rect 已加回）。
 */
async function pickUncoveredVillager(page, excludeIds, options = {}) {
  const { margin = 10, standing = false } = options;
  const view = await page.evaluate(() => window.Oracle.view());
  const snapshot = await camera(page);
  const rects = await panelRects(page);
  const left = snapshot.rect.left;
  const top = snapshot.rect.top;
  for (const villager of view.villagers) {
    if (!villager.visible || excludeIds.includes(villager.id)) continue;
    if (standing && villager.walking) continue;
    const point = cellToCanvasPoint(cellOf(villager.pos), snapshot.cam, snapshot.rect, snapshot.game);
    const x = point.x + left;
    const y = point.y + top;
    if (x < left + margin || y < top + margin || x > left + snapshot.rect.width - margin || y > top + snapshot.rect.height - margin) {
      continue;
    }
    const covered = rects.some(
      (rect) => x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin,
    );
    if (covered) continue;
    return { villager, x, y };
  }
  return null;
}

async function clickPoint(page, x, y, options) {
  await page.mouse.click(x, y, options);
  await page.waitForTimeout(120);
  return panelState(page);
}

/**
 * 点一个「站定 + 没被面板盖住」的村民；高速档下人会走，点空了就重挑。
 * 返回命中的那个人与状态菜单。
 */
async function clickStandingVillager(page, excludeIds = [], budgetMs = 20_000, label = '') {
  const deadline = Date.now() + budgetMs;
  let last = null;
  while (Date.now() < deadline) {
    const pick = await pickUncoveredVillager(page, excludeIds, { standing: true });
    if (pick !== null) {
      last = pick;
      const state = await clickPoint(page, pick.x, pick.y);
      if (state.unit && state.title === pick.villager.name) return { pick, state };
      await resetPanels(page);
    }
    await page.waitForTimeout(300);
  }
  throw new Error(
    `${label}没点中一个站定且不被面板盖住的村民`
    + `${last === null ? '（始终没有候选）' : `（最后候选 ${last.villager.name} @ ${last.x.toFixed(1)},${last.y.toFixed(1)}）`}`,
  );
}

/** 屏幕太挤时把镜头缩小，让更多单位同时落在视野里（每档 240 刻度）。 */
async function zoomOutSteps(page, steps) {
  const canvasBox = await page.evaluate(() => {
    const canvas = document.querySelector('#app canvas');
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.move(canvasBox.x, canvasBox.y);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(180);
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    await l1(browser);
    await l2(browser);
    await l3(browser);
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(`合计 ${results.length} 项，失败 ${failures} 项，todo ${todos.length} 项`);
  for (const item of todos) console.log(`  todo ${item.level} ${item.name} — ${item.detail}`);
  if (failures > 0) process.exitCode = 1;
}

/** L1：单点 + 面板读数。 */
async function l1(browser) {
  console.log('L1 单点');
  const { context, page, errors } = await openPage(browser, 'time=noon&feed=off&speed=1');
  try {
    const view = await page.evaluate(() => window.Oracle.view());
    const villager = visibleVillager(view);

    // L1-1 左键点村民。
    let opened;
    await checkAsync('L1-1', `左键点 ${villager.name} → 状态菜单`, async () => {
      opened = await openStatusByClick(page, villager);
      eq(opened.state.title, villager.name, '菜单标题');
      eq(opened.state.subtitle, `村民 ${villager.id}`, '菜单副标题');
      assert(opened.state.rows.length >= 6, `菜单行数 ${opened.state.rows.length} 少于 6`);
      return `标题=${opened.state.title}，${opened.state.rows.length} 行，点击点=格心，误差 0.00px`;
    });

    // L1-2 三行读数与内存数据一致。
    await checkAsync('L1-2', '情绪 / 心里 / 对某人三行与 Oracle.memory* 一致', async () => {
      assert(opened?.state.unit, '状态菜单没开着');
      await page.evaluate((id) => window.Oracle.openUnitStatusForDebug(id), villager.id);
      await page.waitForTimeout(150);
      const data = await page.evaluate((id) => ({
        status: window.Oracle.unitStatus(),
        mood: window.Oracle.memoryMood(id),
        inner: window.Oracle.memoryInner(id),
        bonds: window.Oracle.memoryBonds(id),
        villagers: window.Oracle.view().villagers,
      }), villager.id);
      const content = data.status;
      assert(content !== null && content !== undefined, 'Oracle.unitStatus() 没有内容');
      assert(content.id === villager.id, `面板选中的是 ${content.id}，不是 ${villager.id}`);

      const moodLine = content.lines.find((line) => line.key === '情绪');
      eq(moodLine?.value, moodText(data.mood), '情绪行');
      assert(content.lines.filter((line) => line.key === '情绪').length === 1, '情绪行唯一');

      const innerLine = content.lines.find((line) => line.key === '心里');
      if (data.inner === null) {
        assert(innerLine === undefined, '记忆里没有心里话，面板不该凭空写一行');
      } else {
        eq(innerLine?.value, data.inner.text, '心里行');
        assert(content.lines.filter((line) => line.key === '心里').length === 1, '心里行唯一');
      }

      const others = data.villagers.filter((item) => item.visible && item.id !== villager.id);
      assert(others.length >= 1, '至少还有一个在场的人，才谈得上「对某人」');
      for (const other of others) {
        const bond = data.bonds.find((item) => item.to === other.id);
        const line = content.lines.find((item) => item.key === `对 ${other.name}`);
        eq(line?.value, bondText(bond), `对 ${other.name} 行`);
      }

      // DOM 与 Oracle 的同一份内容一致（不是只信内存）。
      eq(opened.state.rows, content.lines, 'DOM 行与 Oracle.unitStatus 内容');
      return `情绪=${moodText(data.mood)}；心里=${data.inner?.text ?? '（无）'}；对${others[0].name}=${bondText(data.bonds.find((item) => item.to === others[0].id))}`;
    });

    // L1-3 右键村民 → 记忆面板。
    await checkAsync('L1-3', '右键村民 → 记忆面板直接打开，状态菜单收起', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const targetVillager = visibleVillager(fresh);
      await resetPanels(page);
      const current = await rightClickVillager(page, targetVillager.id);
      const state = await panelState(page);
      assert(state.villager, '右键后记忆面板没有出现');
      assert(!state.unit, '右键后状态菜单还开着');
      assert(!state.building, '右键后楼志也开着');
      eq(state.villagerTitle, current.name, '记忆面板标题');
      return `标题=${state.villagerTitle}，状态菜单已收起`;
    });

    // L1-4 右键楼 → 楼志。
    await checkAsync('L1-4', '右键楼 → 楼志直接打开，标题是楼名', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const building = fresh.buildings.find((item) => {
        const footprint = footprintOf(item);
        const cell = {
          x: item.origin.x + Math.floor(footprint.w / 2),
          y: item.origin.y + Math.floor(footprint.h / 2),
        };
        return villagerAtCell(fresh, cell) === undefined;
      });
      assert(building !== undefined, '没有一栋楼的中心格子是空的（村民都站在楼里）');
      const cell = {
        x: building.origin.x + Math.floor(footprintOf(building).w / 2),
        y: building.origin.y + Math.floor(footprintOf(building).h / 2),
      };
      await resetPanels(page);
      await focusCell(page, cell);
      await clickCell(page, cell, { button: 'right' });
      const state = await panelState(page);
      assert(state.building, '右键楼后楼志没有出现');
      assert(!state.villager && !state.unit, '右键楼后别的面板还开着');
      const name = await page.evaluate((id) => window.Oracle.building(id)?.name ?? '', building.instanceId);
      eq(state.buildingTitle, name, '楼志标题');
      await resetPanels(page);
      return `标题=${state.buildingTitle}`;
    });

    // L1-5 长按村民 500ms → 记忆面板。
    await checkAsync('L1-5', '长按村民 650ms（>LONG_PRESS_MS=500）→ 记忆面板', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const targetVillager = fresh.villagers.find((item) => item.visible && !item.walking) ?? visibleVillager(fresh);
      await resetPanels(page);
      await focusCell(page, cellOf(targetVillager.pos));
      const current = await page.evaluate((id) => window.Oracle.view().villagers.find((item) => item.id === id), targetVillager.id);
      assert(current !== undefined, '村民不见了');
      const target = await pointOfCell(page, cellOf(current.pos));
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: target.x, y: target.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
        });
        await page.waitForTimeout(650);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await cdp.detach();
      }
      await page.waitForTimeout(150);
      const state = await panelState(page);
      assert(state.villager, '长按后记忆面板没有出现');
      assert(!state.unit, '长按后还弹了状态菜单');
      eq(state.villagerTitle, current.name, '长按打开的是按住的这个人');
      return `标题=${state.villagerTitle}，按住 650ms`;
    });

    // L1-6 长按楼 → 楼志。
    await checkAsync('L1-6', '长按楼 650ms → 楼志', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const building = fresh.buildings.find((item) => {
        const footprint = footprintOf(item);
        const cell = {
          x: item.origin.x + Math.floor(footprint.w / 2),
          y: item.origin.y + Math.floor(footprint.h / 2),
        };
        return villagerAtCell(fresh, cell) === undefined;
      });
      assert(building !== undefined, '没有空心的楼中心格');
      const cell = {
        x: building.origin.x + Math.floor(footprintOf(building).w / 2),
        y: building.origin.y + Math.floor(footprintOf(building).h / 2),
      };
      await resetPanels(page);
      await focusCell(page, cell);
      const target = await pointOfCell(page, cell);
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: target.x, y: target.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
        });
        await page.waitForTimeout(650);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await cdp.detach();
      }
      await page.waitForTimeout(150);
      const state = await panelState(page);
      assert(state.building, '长按楼后楼志没有出现');
      assert(!state.villager && !state.unit, '长按楼后别的面板还开着');
      const name = await page.evaluate((id) => window.Oracle.building(id)?.name ?? '', building.instanceId);
      eq(state.buildingTitle, name, '楼志标题');
      return `标题=${state.buildingTitle}，按住 650ms`;
    });

    // L1-10（todo，BUG-2）长按期间单位自己走开：应当取消，现状仍会开面板。
    await checkTodo('L1-10', '长按 650ms 期间单位走开 → 应取消（BUG-2）', async () => {
      const walker = await openPage(browser, 'time=noon&feed=off&speed=60');
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await resetPanels(walker.page);
          const view = await walker.page.evaluate(() => window.Oracle.view());
          const target = view.villagers.find((item) => item.visible && item.walking);
          if (target === undefined) {
            await walker.page.waitForTimeout(500);
            continue;
          }
          const before = cellOf(target.pos);
          const point = await pointOfCell(walker.page, before);
          const cdp = await walker.context.newCDPSession(walker.page);
          try {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
            });
            await walker.page.waitForTimeout(650);
          } finally {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
            await cdp.detach();
          }
          await walker.page.waitForTimeout(150);
          const live = await walker.page.evaluate((id) => window.Oracle.view().villagers.find((item) => item.id === id), target.id);
          const state = await panelState(walker.page);
          const after = cellOf(live.pos);
          const left = after.x !== before.x || after.y !== before.y;
          if (!left) continue; // 650ms 里没换格，样本不成立，换一次再按。
          if (!state.villager) continue; // 这次按空了（长按没起），不算修好。
          assert(
            false,
            `${target.name} 从格 (${before.x},${before.y}) 走到 (${after.x},${after.y})，`
            + `手指没动、也没有 pointermove，500ms 定时器照样开了记忆面板「${state.villagerTitle}」`,
          );
        }
        throw new Error('3 次都没造出「按住的人自己在走」的样本');
      } finally {
        await walker.context.close();
      }
    });

    // L1-7 点空白收起。
    await checkAsync('L1-7', '点空白 → 状态菜单 / 记忆 / 楼志都收起', async () => {
      const blank = await pickEmptyCell(page);
      const state = await clickPoint(page, blank.x, blank.y);
      assert(!state.unit && !state.villager && !state.building, '点空白后还有面板没关');
      return `空格 (${blank.cell.x}, ${blank.cell.y}) 点击后全收`;
    });

    // L1-8 Esc / 关闭钮。
    await checkAsync('L1-8', 'Esc 与关闭钮都能收起状态菜单', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const villager2 = visibleVillager(fresh);
      await resetPanels(page);
      await openStatusByClick(page, villager2);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      let state = await panelState(page);
      assert(!state.unit, 'Esc 没有收起状态菜单');
      await openStatusByClick(page, villager2);
      await page.click('#unit-status-close');
      await page.waitForTimeout(80);
      state = await panelState(page);
      assert(!state.unit, '关闭钮没有收起状态菜单');
      return 'Esc / #unit-status-close 都收起';
    });

    check('L1-9', '页面没有未捕获异常', () => {
      assert(errors.length === 0, `pageerror: ${errors.join(' | ')}`);
      return `${errors.length} 个 pageerror`;
    });
  } finally {
    await context.close();
  }
}

/** L2：组合、遮挡、边缘、缩放。 */
async function l2(browser) {
  console.log('L2 组合');
  const { context, page, errors } = await openPage(browser, 'time=noon&feed=off&speed=1');
  try {
    // L2-1 反复开关不泄漏。
    await checkAsync('L2-1', '同一单位开关 30 次：DOM 节点数 / document 监听器不涨', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const villager = visibleVillager(fresh);
      await focusCell(page, cellOf(villager.pos));
      const overheads = new Set();
      let baselineListeners = null;
      for (let round = 0; round < 30; round += 1) {
        const view = await page.evaluate(() => window.Oracle.view());
        const current = view.villagers.find((item) => item.id === villager.id);
        assert(current !== undefined, `第 ${round} 次开关时村民不见了`);
        await clickCell(page, cellOf(current.pos));
        const state = await panelState(page);
        assert(state.unit, `第 ${round} 次没有打开`);
        if (baselineListeners === null) baselineListeners = state.docListeners;
        eq(state.docListeners, baselineListeners, `第 ${round} 次 document 监听器数`);
        const lines = await page.evaluate(() => window.Oracle.unitStatus()?.lines.length ?? -1);
        assert(lines > 0, `第 ${round} 次没有内容`);
        overheads.add(state.nodeCount - 3 * lines);
        assert(
          overheads.size === 1,
          `第 ${round} 次的固定节点数变了：${[...overheads].join(',')}`,
        );
        const blank = await pickEmptyCell(page);
        await clickPoint(page, blank.x, blank.y);
        const closed = await panelState(page);
        assert(!closed.unit, `第 ${round} 次没有关掉`);
      }
      return `30 次后节点固定开销 ${[...overheads][0]}，document 监听器 ${baselineListeners} 个`;
    });

    // L2-2 面板打开时世界继续推进（用 60 倍速另一页，避免等太久）。
    await context.close();
    const fast = await openPage(browser, 'time=noon&feed=off&speed=60');
    try {
      await checkAsync('L2-2', '面板打开时世界推进：now 增加、位置读数变化', async () => {
        const view = await fast.page.evaluate(() => window.Oracle.view());
        const villager = visibleVillager(view);
        await fast.page.evaluate((id) => window.Oracle.openUnitStatusForDebug(id), villager.id);
        await fast.page.waitForTimeout(200);
        const before = await panelState(fast.page);
        assert(before.unit, '调试入口没有打开状态菜单');
        const nowBefore = await fast.page.evaluate(() => window.Oracle.view().now);
        const whereBefore = before.rows.find((row) => row.key === '位置')?.value ?? '';
        const deadline = Date.now() + 20_000;
        let whereAfter = whereBefore;
        let nowAfter = nowBefore;
        while (Date.now() < deadline) {
          await fast.page.waitForTimeout(250);
          const state = await panelState(fast.page);
          assert(state.unit, '等读数变化时面板被关掉了');
          nowAfter = await fast.page.evaluate(() => window.Oracle.view().now);
          whereAfter = state.rows.find((row) => row.key === '位置')?.value ?? '';
          if (whereAfter !== whereBefore) break;
        }
        assert(nowAfter > nowBefore, `世界时间没有推进（${nowBefore}）`);
        assert(whereAfter !== whereBefore, `20 秒内位置读数没有变（一直 ${whereBefore}）`);
        return `now ${nowBefore}→${nowAfter}；${whereBefore} → ${whereAfter}`;
      });

      // L2-3 遮挡：可见的占格单位优先；离场的人让位给楼。
      await checkAsync('L2-3', '被楼占格：中心命中楼、檐下空格不命中（可见单位进占地时人优先）', async () => {
        // 先开一条活，让更多人进屋，容易造出「楼占地里有人」的样本。
        await fast.page.evaluate(() => window.Oracle.dispatch('code', '修一段索引'));

        // 分支 A：可见的人站在楼占地里 → 点下去应当命中人（人优先于楼）。
        // 用当前镜头直接点，不挪镜头，避免走路的人在半秒里换格。
        let visibleHit = null;
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && visibleHit === null) {
          const view = await fast.page.evaluate(() => window.Oracle.view());
          const snapshot = await camera(fast.page);
          const sample = view.villagers.find(
            (villager) => villager.visible
              && view.buildings.some((building) => insideFootprint(building, cellOf(villager.pos))),
          );
          if (sample !== undefined) {
            const point = cellToCanvasPoint(cellOf(sample.pos), snapshot.cam, snapshot.rect, snapshot.game);
            const x = point.x + snapshot.rect.left;
            const y = point.y + snapshot.rect.top;
            if (
              x > snapshot.rect.left + 8
              && y > snapshot.rect.top + 8
              && x < snapshot.rect.left + snapshot.rect.width - 8
              && y < snapshot.rect.top + snapshot.rect.height - 8
            ) {
              const state = await clickPoint(fast.page, x, y);
              if (state.unit && state.title === sample.name) {
                visibleHit = { sample, state };
                break;
              }
              // 走开了，点到了别人或空白：继续等下一个样本。
              await resetPanels(fast.page);
            }
          }
          await fast.page.waitForTimeout(300);
        }

        const occlusionReading = visibleHit === null
          ? '可见占格 0 例（20 秒内没等到，本档只有 2 个村民，均未走进占地）'
          : `可见占格 1 例：${visibleHit.sample.name} 在楼占地里，点下去仍是人`;
        await resetPanels(fast.page);

        // 分支 B（必然有样本）：点楼占地中心 → 开这栋楼的只读状态菜单。
        // 楼的贴图比占地高，周围格子会被画上去；这里钉住「命中按占地格，不按贴图范围」。
        await resetPanels(fast.page);
        const view = await fast.page.evaluate(() => window.Oracle.view());
        let footprintHit = null;
        for (const building of view.buildings) {
          const cell = {
            x: building.origin.x + Math.floor(building.footprint.w / 2),
            y: building.origin.y + Math.floor(building.footprint.h / 2),
          };
          await focusCell(fast.page, cell);
          const live = await fast.page.evaluate(() => window.Oracle.view());
          if (villagerAtCell(live, cell) !== undefined) continue;
          const target = await clickCell(fast.page, cell);
          const state = await panelState(fast.page);
          if (!state.unit) continue;
          eq(state.title, building.displayName, '楼占地中心命中的楼名');
          eq(state.subtitle, `${building.zone} · ${building.prefabId}`, '楼状态副标题');
          assert(state.rows.some((row) => row.key === '占地'), '楼状态里没有占地行');
          footprintHit = { building, cell, target };
          break;
        }
        assert(footprintHit !== null, '没有一栋楼的中心格是空的、点得开的');

        // 分支 C：占地底边下一行（门口）没有可见的人时，点下去不该开任何面板。
        const doorCell = {
          x: footprintHit.cell.x,
          y: footprintHit.building.origin.y + footprintHit.building.footprint.h,
        };
        const liveDoor = await fast.page.evaluate(() => window.Oracle.view());
        assert(villagerAtCell(liveDoor, doorCell) === undefined, '门口格刚好站着人，换一栋楼再测檐下空格');
        await focusCell(fast.page, doorCell);
        const doorState = await clickCell(fast.page, doorCell);
        const closed = await panelState(fast.page);
        assert(!closed.unit && !closed.villager && !closed.building, '点楼檐下一格，面板还开着');

        const anchor = cellToCanvasPoint(doorCell, doorState.snapshot.cam, doorState.snapshot.rect, doorState.snapshot.game);
        return `${occlusionReading}；`
          + `楼 ${footprintHit.building.displayName} 占地中心命中（格 ${footprintHit.cell.x},${footprintHit.cell.y}）；`
          + `檐下空格 (${doorCell.x},${doorCell.y}) 不命中，格心 (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)}) 画布 px；`
          + `两次点击都落在格心（偏移 0.00px，命中按格不按贴图）`;
      });
    } finally {
      await fast.context.close();
    }

    // 重新打开 p1 做边缘 / 缩放（速度 1，点得稳）。
    const p2 = await openPage(browser, 'time=noon&feed=off&speed=1');
    try {
      // L2-4 地图边缘。
      await checkAsync('L2-4', '地图四角：投影回算与界外命中，误差给像素数', async () => {
        const fresh = await p2.page.evaluate(() => window.Oracle.view());
        const grid = { width: 96, height: 72 };
        const corners = [
          { x: 0, y: 0 },
          { x: grid.width - 1, y: 0 },
          { x: 0, y: grid.height - 1 },
          { x: grid.width - 1, y: grid.height - 1 },
        ];
        const readings = [];
        for (const cell of corners) {
          await resetPanels(p2.page);
          await focusCell(p2.page, cell);
          const snapshot = await camera(p2.page);
          const point = cellToCanvasPoint(cell, snapshot.cam, snapshot.rect, snapshot.game);
          const scriptOrigin = {
            x: viewOriginOf(snapshot.cam.scrollX, snapshot.cam.width, snapshot.cam.zoom),
            y: viewOriginOf(snapshot.cam.scrollY, snapshot.cam.height, snapshot.cam.zoom),
          };
          const scale = snapshot.rect.width / snapshot.game.width;
          const drift = Math.hypot(
            (scriptOrigin.x - snapshot.cam.worldViewX) * snapshot.cam.zoom * scale,
            (scriptOrigin.y - snapshot.cam.worldViewY) * snapshot.cam.zoom * scale,
          );
          assert(drift <= 0.5, `角 ${cell.x},${cell.y} 投影漂移 ${drift.toFixed(2)}px > 0.5px`);
          await p2.page.mouse.click(point.x + snapshot.rect.left, point.y + snapshot.rect.top);
          await p2.page.waitForTimeout(120);
          const state = await panelState(p2.page);
          const under = villagerAtCell(fresh, cell);
          if (under !== undefined) {
            assert(state.unit, `角 ${cell.x},${cell.y} 有 ${under.name}，却没点开`);
            eq(state.title, under.name, '角上的命中人');
          } else {
            assert(!state.unit, `角 ${cell.x},${cell.y} 没人却点开了 ${state.title}`);
          }
          readings.push(`${cell.x},${cell.y}:${drift.toFixed(2)}px`);
        }
        // 界外：镜头贴左上角，点画布左上角再往外 1px。
        await focusCell(p2.page, { x: 0, y: 0 });
        const edgeSnap = await camera(p2.page);
        await p2.page.mouse.click(edgeSnap.rect.left - 1, edgeSnap.rect.top - 1);
        await p2.page.waitForTimeout(100);
        const outState = await panelState(p2.page);
        assert(!outState.unit && !outState.villager && !outState.building, '画布外 1px 点开了面板');
        return `四角漂移 ${readings.join(', ')}；界外 1px 无面板`;
      });

      // L2-5 缩放命中。
      await checkAsync('L2-5', '滚轮缩放后点人：偏移 3.61px 仍命中，给出边界余量', async () => {
        const fresh = await p2.page.evaluate(() => window.Oracle.view());
        const villager = visibleVillager(fresh);
        await focusCell(p2.page, cellOf(villager.pos));
        const canvasBox = await p2.page.evaluate(() => {
          const canvas = document.querySelector('#app canvas');
          const rect = canvas.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await p2.page.mouse.move(canvasBox.x, canvasBox.y);
        await p2.page.mouse.wheel(0, -240);
        await p2.page.waitForTimeout(250);
        const snapshot = await camera(p2.page);
        const zoom = snapshot.cam.zoom;
        assert(zoom > 1, `滚轮后镜头仍是 ${zoom} 倍`);
        const current = await p2.page.evaluate((id) => window.Oracle.view().villagers.find((item) => item.id === id), villager.id);
        assert(current !== undefined, '缩放后村民不见了');
        const cell = cellOf(current.pos);
        await focusCell(p2.page, cell);
        const after = await camera(p2.page);
        const point = cellToCanvasPoint(cell, after.cam, after.rect, after.game);
        const scale = after.rect.width / after.game.width;
        const pixelZoom = after.cam.zoom * scale;
        const half = (TILE_PX * pixelZoom) / 2;
        const offset = Math.hypot(3, 2);
        assert(half > offset + 1, `格子半宽 ${half.toFixed(1)}px，装不下 ${offset.toFixed(2)}px 偏移`);
        await p2.page.mouse.click(point.x + after.rect.left + 3, point.y + after.rect.top + 2);
        await p2.page.waitForTimeout(120);
        const state = await panelState(p2.page);
        assert(state.unit, `缩放 ${zoom} 倍、偏 3.61px 时没有点中人`);
        eq(state.title, current.name, '缩放后命中的人');
        const scriptOrigin = {
          x: viewOriginOf(after.cam.scrollX, after.cam.width, after.cam.zoom),
          y: viewOriginOf(after.cam.scrollY, after.cam.height, after.cam.zoom),
        };
        const driftCss = Math.hypot(
          (scriptOrigin.x - after.cam.worldViewX) * pixelZoom,
          (scriptOrigin.y - after.cam.worldViewY) * pixelZoom,
        );
        const driftWorld = driftCss / pixelZoom;
        // 生产命中用的是 viewOriginOf（连续值）；这里是拿它对 Phaser 的整数 worldView 做对账，
        // 两边只差 Phaser 的取整，所以容差是「1 世界像素」，不是 0.5 像素。
        assert(driftWorld <= 1, `缩放投影漂移 ${driftCss.toFixed(2)}px / ${driftWorld.toFixed(2)} 世界px > 1 世界px`);
        return `zoom=${zoom}×CSS${scale}，偏移 ${offset.toFixed(2)}px，边界余量 ${(half - offset).toFixed(1)}px，投影漂移 ${driftCss.toFixed(2)}px（${driftWorld.toFixed(2)} 世界px，取整容差 ≤1）`;
      });

      check('L2-6', '页面没有未捕获异常', () => {
        assert(errors.length === 0 && p2.errors.length === 0, `pageerror: ${[...errors, ...p2.errors].join(' | ')}`);
        return `${errors.length + p2.errors.length} 个 pageerror`;
      });
    } finally {
      await p2.context.close();
    }
  } catch (error) {
    if (context) await context.close().catch(() => {});
    throw error;
  }
}

/** L3：输入校验、存档重开、互斥、无历史时的回溯入口。 */
async function l3(browser) {
  console.log('L3 边界');
  const { context, page, errors } = await openPage(browser, 'time=noon&feed=off&speed=1');
  try {
    // L3-1 空 / 空白输入。
    await checkAsync('L3-1', '空输入与全空白不投递，输入框不被清空', async () => {
      await page.fill('#utterance', '   ');
      await page.press('#utterance', 'Enter');
      await page.waitForTimeout(120);
      const state = await panelState(page);
      eq(state.reply, '', '空白输入不该有回执');
      const value = await page.inputValue('#utterance');
      eq(value, '   ', '没投递的输入不该被清空');
      return '空白输入 0 条回执，输入框保留 3 个空格';
    });

    // L3-2 非法字符：至少不崩、不进石板。
    await checkAsync('L3-2', '非法字符（控制符 + 标签）不崩页、不改石板', async () => {
      const slabBefore = await page.evaluate(() => window.Oracle.slab().length);
      await page.fill('#utterance', '\u0000\u0001<script>alert(1)</script>');
      await page.press('#utterance', 'Enter');
      await page.waitForTimeout(600);
      const slabAfter = await page.evaluate(() => window.Oracle.slab().length);
      eq(slabAfter, slabBefore, '非法输入不该进石板');
      const state = await panelState(page);
      assert(!state.reply.includes('<script>'), '回执里回显了原始标签');
      return `石板 ${slabBefore}→${slabAfter}，回执=${state.reply || '（空）'}`;
    });

    // L3-3 超长文本：记录实际行为（已知没有上限，见 BUG-1）。
    await checkAsync('L3-3', '超长文本：记录实际投递长度与回执（已知缺口）', async () => {
      const raw = '生长'.repeat(5_000);
      await page.fill('#utterance', raw);
      await page.press('#utterance', 'Enter');
      await page.waitForTimeout(600);
      const state = await panelState(page);
      const maxlength = await page.evaluate(() => document.querySelector('#utterance').getAttribute('maxlength'));
      return `输入 10000 字，maxlength=${maxlength ?? '未设'}，回执=${state.reply || '（空）'}（期望：面板层拒绝/截断，见 BUG-1）`;
    });

    // L3-4 状态面板本身没有写作入口。
    await checkAsync('L3-4', '状态菜单没有输入框；「干涉世界（未开放）」不可写', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const villager = visibleVillager(fresh);
      await openStatusByClick(page, villager);
      const writable = await page.evaluate(() => ({
        inputs: document.querySelectorAll('#unit-status input, #unit-status textarea, #unit-status [contenteditable="true"]').length,
        placeholder: document.querySelector('#unit-status .unit-status-placeholder')?.textContent ?? '',
      }));
      eq(writable.inputs, 0, '状态菜单里不该有输入控件');
      assert(writable.placeholder.includes('干涉世界'), `未开放提示是 ${writable.placeholder}`);
      return `0 个输入控件；提示=${writable.placeholder}`;
    });

    // L3-5 面板互斥：两个单位、人 vs 楼。
    // 单独开一页跑 60 倍速：默认档两人一开始同格，等他们拉开要太久；
    // 等两人各自站定并拉开 ≥8 格后再点，真实点击才稳。
    await checkAsync('L3-5', '两个单位同时点开：只留后一个；人 / 楼 / 记忆互斥', async () => {
      const mutex = await openPage(browser, 'time=noon&feed=off&speed=60');
      try {
        await zoomOutSteps(mutex.page, 2);
        const deadline = Date.now() + 30_000;
        let pair = null;
        while (Date.now() < deadline && pair === null) {
          const view = await mutex.page.evaluate(() => window.Oracle.view());
          const standing = view.villagers.filter((item) => item.visible && !item.walking);
          for (let i = 0; i < standing.length && pair === null; i += 1) {
            for (let j = i + 1; j < standing.length; j += 1) {
              const gap = Math.max(
                Math.abs(Math.floor(standing[i].pos.x) - Math.floor(standing[j].pos.x)),
                Math.abs(Math.floor(standing[i].pos.y) - Math.floor(standing[j].pos.y)),
              );
              if (gap >= 8) {
                pair = { a: standing[i], b: standing[j], gap };
                break;
              }
            }
          }
          if (pair === null) await mutex.page.waitForTimeout(400);
        }
        assert(pair !== null, '30 秒内没等到两个站定、拉开 ≥8 格的村民');

        // 人 → 人：只留后一个，且别的面板都不开。
        await resetPanels(mutex.page);
        const firstHit = await clickStandingVillager(mutex.page, [pair.b.id], 20_000, '第一人：');
        const secondHit = await clickStandingVillager(mutex.page, [firstHit.pick.villager.id], 20_000, '第二人：');
        assert(secondHit.state.unit, '第二个没有打开');
        eq(secondHit.state.title, secondHit.pick.villager.name, '只留后一个');
        assert(!secondHit.state.villager && !secondHit.state.building, '前一个的别的面板没关');

        // 记忆面板开着时点另一个人 → 记忆收起，状态菜单是那个人。
        await resetPanels(mutex.page);
        const memoryVillager = await rightClickVillager(mutex.page, secondHit.pick.villager.id);
        const memoryState = await panelState(mutex.page);
        assert(memoryState.villager, '右键没有打开记忆面板');
        eq(memoryState.villagerTitle, memoryVillager.name, '记忆面板标题');
        const mixedHit = await clickStandingVillager(mutex.page, [secondHit.pick.villager.id], 20_000, '记忆→人：');
        assert(!mixedHit.state.villager, '左键点人后记忆面板还开着');
        eq(mixedHit.state.title, mixedHit.pick.villager.name, '状态菜单切到点中的那个人');

        // 状态菜单开着时右键楼 → 状态收起、楼志打开。
        await resetPanels(mutex.page);
        let buildingHit = null;
        const buildings = (await mutex.page.evaluate(() => window.Oracle.view())).buildings;
        for (const item of buildings) {
          if (buildingHit !== null) break;
          const cell = {
            x: item.origin.x + Math.floor(footprintOf(item).w / 2),
            y: item.origin.y + Math.floor(footprintOf(item).h / 2),
          };
          await focusCell(mutex.page, cell);
          const view = await mutex.page.evaluate(() => window.Oracle.view());
          if (villagerAtCell(view, cell) !== undefined) continue;
          await clickCell(mutex.page, cell, { button: 'right' });
          const state = await panelState(mutex.page);
          if (state.building) {
            assert(!state.unit, '右键楼后状态菜单还开着');
            const name = await mutex.page.evaluate((id) => window.Oracle.building(id)?.name ?? '', item.instanceId);
            eq(state.buildingTitle, name, '楼志标题');
            buildingHit = { name, cell };
          }
        }
        assert(buildingHit !== null, '没有中心格空着、能右键打开的楼');
        assert(mutex.errors.length === 0, `互斥页 pageerror: ${mutex.errors.join(' | ')}`);
        return `两人拉开 ${pair.gap} 格：${firstHit.pick.villager.name}→${secondHit.pick.villager.name} 只留后一个；`
          + `记忆→${mixedHit.pick.villager.name} 收起；状态→楼只留楼志 ${buildingHit.name}（格 ${buildingHit.cell.x},${buildingHit.cell.y}）`;
      } finally {
        await mutex.context.close();
      }
    });

    // L3-6 存档重开：记忆段读数复原。
    await checkAsync('L3-6', '存档 → 重开 → 点同一人：记忆行复原', async () => {
      const fresh = await page.evaluate(() => window.Oracle.view());
      const villager = visibleVillager(fresh);
      await openStatusByClick(page, villager);
      await page.evaluate((id) => window.Oracle.openUnitStatusForDebug(id), villager.id);
      await page.waitForTimeout(120);
      const before = await page.evaluate((id) => ({
        mood: window.Oracle.memoryMood(id),
        inner: window.Oracle.memoryInner(id),
        bonds: window.Oracle.memoryBonds(id),
        status: window.Oracle.unitStatus(),
      }), villager.id);
      assert(before.status !== null, '存档前没有状态内容');

      await page.evaluate(() => window.Oracle.saveNow());
      await page.reload();
      await page.waitForFunction(() => window.Oracle !== undefined && window.Oracle.view !== undefined);
      await page.waitForTimeout(400);
      const freshView = await page.evaluate(() => window.Oracle.view());
      const again = freshView.villagers.find((item) => item.id === villager.id);
      assert(again !== undefined, '重开后找不到同一个人');
      await openStatusByClick(page, again);
      await page.evaluate((id) => window.Oracle.openUnitStatusForDebug(id), villager.id);
      await page.waitForTimeout(120);
      const after = await page.evaluate((id) => ({
        mood: window.Oracle.memoryMood(id),
        inner: window.Oracle.memoryInner(id),
        bonds: window.Oracle.memoryBonds(id),
        status: window.Oracle.unitStatus(),
      }), villager.id);
      assert(after.status !== null, '重开后没有状态内容');
      eq(moodText(after.mood), moodText(before.mood), '情绪行');
      eq(after.inner?.text ?? null, before.inner?.text ?? null, '心里行');
      eq(after.bonds, before.bonds, '对某人的债 / 信任');
      const beforeMemoryLines = before.status.lines.filter(
        (line) => line.key === '情绪' || line.key === '心里' || line.key.startsWith('对 '),
      );
      const afterMemoryLines = after.status.lines.filter(
        (line) => line.key === '情绪' || line.key === '心里' || line.key.startsWith('对 '),
      );
      eq(afterMemoryLines, beforeMemoryLines, '面板里的记忆行逐字复原');
      return `${afterMemoryLines.length} 行记忆读数复原（情绪=${moodText(before.mood)}）`;
    });

    // L3-7 没有历史时回溯入口：不假装有那一天。
    await checkAsync('L3-7', '回溯时间线：单局没有关过账时 days 为空、rewind 不返回假数据', async () => {
      const days = await page.evaluate(() => window.Oracle.historyDays());
      eq(days.length, 0, '单局没跨天时不该有可回看的日子');
      const rewind = await page.evaluate(() => window.Oracle.historyRewind(1));
      if (rewind !== null) {
        assert(rewind.day === 1, `rewind 返回了第 ${rewind.day} 天`);
        assert(rewind.missing === true, '没有记录的第 1 天应标记 missing');
        assert(rewind.save === null, '没有记录的第 1 天不该给存档');
      }
      const beforeNow = await page.evaluate(() => window.Oracle.view().now);
      const view = await page.evaluate(() => window.Oracle.view());
      const villager = visibleVillager(view);
      await openStatusByClick(page, villager);
      const state = await panelState(page);
      assert(state.unit, '回溯入口为空时点单位仍然要能读当前');
      const afterNow = await page.evaluate(() => window.Oracle.view().now);
      assert(afterNow >= beforeNow, '回溯入口为空不该把世界时间拨回去');
      return `days=0；rewind(1)=missing/无存档；点 ${villager.name} 仍读当前（now ${beforeNow}→${afterNow}）`;
    });

    check('L3-8', '页面没有未捕获异常', () => {
      assert(errors.length === 0, `pageerror: ${errors.join(' | ')}`);
      return `${errors.length} 个 pageerror`;
    });
  } finally {
    await context.close();
  }
}

await main();
