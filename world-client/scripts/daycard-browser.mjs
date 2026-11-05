/**
 * 日历屏的浏览器验收：把存档注进灯潮界的槽，点开「日历」，给 1× 原生截图。
 *
 * 端口必须显式指定（本 worktree 用 5322；5188/5191/5202/5203/5321 是别的树或
 * 上一轮实验占过的口，禁止串台）。用法：
 *   node scripts/daycard-browser.mjs --port=5322 --mode=real
 *   node scripts/daycard-browser.mjs --port=5322 --mode=fixture
 *
 * real：真实 90 天存档（第 0–89 天）；
 * fixture：把合成摘要（90–110 天）拼进真实存档的**副本**，只为在屏幕上看到
 * 第 103 天「吵了一架」；不写回、不改存法、不参与纯读证明。
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = Number(argOf('port', '5322'));
const MODE = argOf('mode', 'real');
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const SAVE_KEY = 'dengchao.pixel-world.save.v1';

const here = process.cwd();
const root = resolve(here, '..');
const evidence = join(root, 'docs/evidence/mem-daycard');
const savePath =
  MODE === 'fixture'
    ? join(evidence, 'input/save-day111-fixture.json')
    : join(root, 'docs/evidence/soak/soak-a/save-90d.json');
const outName = MODE === 'fixture' ? 'daycard-103' : 'daycard-real-90d';
const saveText = readFileSync(savePath, 'utf8');

mkdirSync(evidence, { recursive: true });

async function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite 没在 ${timeoutMs}ms 内起来：${url}`);
}

/** 等自动存档停下来：连读两次相同才算稳定，避免把「载入时的迁移写盘」算到面板头上。 */
async function stableSave(page, key) {
  let last = await page.evaluate((slot) => localStorage.getItem(slot) ?? '', key);
  const started = Date.now();
  while (Date.now() - started < 3000) {
    await page.waitForTimeout(100);
    const now = await page.evaluate((slot) => localStorage.getItem(slot) ?? '', key);
    if (now === last) return now;
    last = now;
  }
  return last;
}

function stopServer() {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
}

const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(PORT), '--strictPort'],
  { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
);
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

let browser;
try {
  await waitForServer(URL_BASE);
  browser = await chromium.launch({ headless: true });
  // deviceScaleFactor 保持 1：截图是 1× 原生像素，不放大。
  const context = await browser.newContext({
    viewport: { width: 1010, height: 940 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.clear();
        localStorage.setItem(key, value);
      } catch {
        /* 隐私模式忽略 */
      }
    },
    { key: SAVE_KEY, value: saveText },
  );

  const url = `${URL_BASE}?world=dengchao&feed=off&debug=1&time=noon&speed=60`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });

  // 先把时间按住：截图期间世界不许关新的一天，存档原文才好比。
  const paused = await page.evaluate(() => {
    const box = document.querySelector('#debug-pause');
    if (box === null) return false;
    box.click();
    return true;
  });
  await page.waitForTimeout(200);

  const saveBefore = await stableSave(page, SAVE_KEY);
  const before = await page.evaluate(() => ({
    memory: window.Oracle.memory(),
    day: Math.floor(window.Oracle.view().now / 86_400_000),
  }));

  // 把「读存档原文 → 点开日历 → 再读存档原文」放在同一段同步脚本里：
  // 自动存档插不进来，前后不同就只能怪这一屏。
  const toggle = await page.evaluate((key) => {
    const beforeSave = localStorage.getItem(key) ?? '';
    document.querySelector('#daycard-open')?.click();
    const afterSave = localStorage.getItem(key) ?? '';
    return {
      beforeSave,
      afterSave,
      open: !(document.querySelector('#daycard')?.hidden ?? true),
    };
  }, SAVE_KEY);
  await page.waitForTimeout(150);

  const panel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#daycard-list .daycard-row')].map((row) =>
      row.textContent ?? '',
    );
    const weeks = [...document.querySelectorAll('#daycard-list .daycard-week')].map(
      (week) => week.textContent ?? '',
    );
    return {
      heading: document.querySelector('#daycard-heading')?.textContent ?? '',
      note: document.querySelector('#daycard-note')?.textContent ?? '',
      rowCount: rows.length,
      rows,
      weeks,
      proof: window.Oracle.dayCardProof(),
      cards: window.Oracle.dayCards(),
    };
  });
  const after = await page.evaluate(() => ({
    memory: window.Oracle.memory(),
    day: Math.floor(window.Oracle.view().now / 86_400_000),
  }));

  await page.screenshot({ path: join(evidence, `${outName}-1x.png`) });

  // 演示第 103 天时把那一行滚到面板中间：1× 截图里要能直接读到「吵了一架」。
  if (MODE === 'fixture') {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#daycard-list .daycard-row')].find((item) =>
        (item.textContent ?? '').includes('第 103 天'),
      );
      row?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(evidence, `${outName}-1x.png`) });
  }
  await page.locator('#daycard').screenshot({ path: join(evidence, `${outName}-panel-1x.png`) });

  const result = {
    mode: MODE,
    url,
    viewport: { width: 1010, height: 940, deviceScaleFactor: 1 },
    savePath: MODE === 'fixture'
      ? 'docs/evidence/mem-daycard/input/save-day111-fixture.json'
      : 'docs/evidence/soak/soak-a/save-90d.json',
    paused,
    beforeDay: before.day,
    afterDay: after.day,
    heading: panel.heading,
    note: panel.note,
    rowCount: panel.rowCount,
    weeks: panel.weeks,
    rows: panel.rows,
    day103: panel.rows.find((row) => row.includes('第 103 天')) ?? null,
    day103ShowsDispute:
      (panel.rows.find((row) => row.includes('第 103 天')) ?? '').includes('吵了一架'),
    proof: panel.proof,
    readMs: panel.cards?.readMs ?? null,
    cardsDays: panel.cards?.days ?? null,
    // 存档大小按 UTF-8 字节算：`.length` 是 UTF-16 码元数，中文会被少算，
    // 和「存档字节」不是同一个单位（两者在本存档上差 85,950）。
    saveBeforeBytes: new TextEncoder().encode(toggle.beforeSave).length,
    saveAfterBytes: new TextEncoder().encode(toggle.afterSave).length,
    saveRawEqual: toggle.beforeSave === toggle.afterSave,
    panelOpen: toggle.open,
    memoryViewEqual: JSON.stringify(before.memory) === JSON.stringify(after.memory),
    pageErrors: errors,
    serverLogTail: serverLog.slice(-2000),
  };
  writeFileSync(join(evidence, `browser-${MODE}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    mode: MODE,
    url,
    heading: result.heading,
    rowCount: result.rowCount,
    day103: result.day103,
    day103ShowsDispute: result.day103ShowsDispute,
    saveRawEqual: result.saveRawEqual,
    memoryViewEqual: result.memoryViewEqual,
    proof: result.proof,
    pageErrors: errors,
  }, null, 2));
} finally {
  await browser?.close();
  stopServer();
  process.exit(0);
}
