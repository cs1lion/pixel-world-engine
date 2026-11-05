/**
 * 浏览器端 30 日末读数：把 `save-30d.json` 注进灯潮界的存档槽，让真页面读档起来，
 * 读帧率与实际绘制指令数。**端口必须显式指定**（本 worktree 用 5311；5188 是别的
 * worktree，串台会给出假读数）。
 *
 * 用法（自己起 vite，不依赖已开着的 dev server）：
 *   node scripts/soak-browser.mjs
 *   node scripts/soak-browser.mjs --port=5311 --seconds=20
 *
 * 产物写到 `docs/evidence/soak/browser-30d.json` 与 `browser-30d.png`；
 * 回执行会打印本次用的 URL，验收记录直接抄它。
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
const PORT = Number(argOf('port', '5311'));
const SECONDS = Number(argOf('seconds', '20'));
const MODE = argOf('mode', 'save'); // save：注 30 日存档；fresh：新世界（第 1 天对照）
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const SAVE_KEY = 'dengchao.pixel-world.save.v1';
const OUT_NAME = MODE === 'fresh' ? 'browser-day1' : 'browser-30d';

const root = resolve(process.cwd(), '..');
const evidence = join(root, 'docs/evidence/soak');
const saveText = readFileSync(join(evidence, 'soak-a/save-30d.json'), 'utf8');
const save = JSON.parse(saveText);

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

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

let browser;
try {
  await waitForServer(URL_BASE);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.clear();
        if (value !== null) localStorage.setItem(key, value);
      } catch {
        /* 隐私模式忽略 */
      }
    },
    { key: SAVE_KEY, value: MODE === 'fresh' ? null : saveText },
  );

  const url = `${URL_BASE}?world=dengchao&feed=off&debug=1&time=noon&speed=60`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });

  const restored = await page.evaluate(() => {
    const view = window.Oracle.view();
    return {
      now: view.now,
      dayIndex: Math.floor(view.now / 86_400_000),
      villagers: view.villagers.map((villager) => ({
        name: villager.name,
        walking: villager.walking,
        routine: villager.routine ?? null,
        pos: { x: villager.pos.x, y: villager.pos.y },
      })),
      buildings: view.buildings.length,
      weather: view.weather,
      memory: window.Oracle.memory(),
    };
  });

  // 帧率读的是 Phaser 的 actualFps：等它稳定（默认 20 秒）再采。
  await page.waitForTimeout(SECONDS * 1000);
  const readings = await page.evaluate(() => ({
    eco: window.Oracle.ecoState(),
    render: window.Oracle.renderStats(),
    view: {
      now: window.Oracle.view().now,
      walking: window.Oracle.view().villagers.filter((villager) => villager.walking).length,
    },
  }));

  const bytes = await page.evaluate((key) => localStorage.getItem(key)?.length ?? 0, SAVE_KEY);
  await page.screenshot({ path: join(evidence, `${OUT_NAME}.png`), fullPage: false });

  const result = {
    mode: MODE,
    url,
    saveKey: SAVE_KEY,
    port: PORT,
    restored,
    saveBytesInStorage: bytes,
    fps: {
      actualFps: readings.eco.actualFps,
      fpsLimit: readings.eco.fpsLimit,
      updateCount: readings.eco.updateCount,
      advanceCount: readings.eco.advanceCount,
      sampleSeconds: SECONDS,
    },
    render: readings.render,
    after: readings.view,
    pageErrors: errors,
    serverLogTail: serverLog.split('\n').slice(-6).join('\n'),
  };
  writeFileSync(join(evidence, `${OUT_NAME}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`[URL] ${url}`);
  console.log(`[读档] ${MODE === 'fresh' ? '新世界' : '第 30 日末'} · 世界日 ${restored.dayIndex}（now=${restored.now}）· 居民 ${restored.villagers.length} · 楼 ${restored.buildings} · 天气 ${restored.weather}`);
  console.log(`[帧率] actualFps=${readings.eco.actualFps.toFixed(1)} · fpsLimit=${readings.eco.fpsLimit} · updateCount=${readings.eco.updateCount}`);
  console.log(`[指令] graphicsObjects=${readings.render.graphicsObjects} · totalCommands=${readings.render.totalCommands} · largest=${readings.render.largest.join(',')}`);
  console.log(`[报错] ${errors.length === 0 ? '无' : errors.join(' | ')}`);
  if (errors.length > 0) process.exitCode = 1;
} finally {
  if (browser !== undefined) await browser.close();
  if (process.platform === 'win32' && server.pid !== undefined) {
    // npx 会再起一层 node；只 kill 自己这一层会把 vite 留在端口上。
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill();
  }
}
