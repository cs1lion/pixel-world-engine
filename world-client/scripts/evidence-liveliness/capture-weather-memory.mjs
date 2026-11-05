/** 面板截图：第 0 天淋过雨，第 1 天提前盖布，展开「今日」条目看 why 那句话。
 *
 * 跑法（在 `world-client/` 下，先 `npm run dev -- --port 5307 --strictPort`，
 * 并先用 `make-next-day-save.ts` 生成下一日存档（它写到本脚本的 `tmp` 工作目录））：
 *   node scripts/evidence-liveliness/capture-weather-memory.mjs
 * 产物直接写进 `docs/evidence/liveliness/`。
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// 端口按本 worktree 的 dev server 给：别用别的 worktree 挂在 5188 的实例。
const URL = process.env.CAPTURE_URL
  ?? 'http://127.0.0.1:5307/?world=dengchao&feed=off&time=noon&speed=60';
// 相对 cwd（world-client）写，不相对脚本位置：`mkdir` 用的是进程 cwd。
const OUT = '../docs/evidence/liveliness';
const SAVE_KEY = 'dengchao.pixel-world.save.v1';
const saveText = await readFile('tmp/next-day-save.json', 'utf8');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
await context.addInitScript(
  ({ key, text }) => {
    try {
      localStorage.setItem(key, text);
    } catch {
      /* 隐私模式忽略 */
    }
  },
  { key: SAVE_KEY, text: saveText },
);
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[page error]', message.text());
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 30000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  window.Oracle.setCameraMode('free');
  window.Oracle.centerCameraOn(27 * 16, 29 * 16);
});

/** 逐个人打开只读状态菜单，找到「提前把摊布盖上」那条带 why 的今日条目。 */
async function findEntry() {
  return page.evaluate(() => {
    const api = window.Oracle;
    const ids = api.view().villagers.map((villager) => villager.id);
    for (const id of ids) {
      if (!api.openUnitStatusForDebug(id)) continue;
      const content = api.unitStatus();
      if (content === null) continue;
      const hit = (content.today ?? []).find(
        (entry) => String(entry.what ?? '').includes('提前把摊布盖上') && entry.why !== null && entry.why !== undefined,
      );
      if (hit !== undefined) {
        const villager = api.view().villagers.find((item) => item.id === id);
        return { id, name: villager?.name ?? id, hit, content };
      }
    }
    return null;
  });
}

const deadline = Date.now() + 8 * 60 * 1000;
let found = await findEntry();
while (found === null && Date.now() < deadline) {
  await page.waitForTimeout(2000);
  found = await findEntry();
}
if (found === null) {
  await writeFile('tmp/screens/weather-memory-why.missing.txt', '8 分钟内没有出现「提前把摊布盖上」的今日条目\n', 'utf8');
  console.log(JSON.stringify({ ok: false, reason: 'timeout' }));
  await browser.close();
  process.exit(1);
}

// 面板已由最后一次 openUnitStatusForDebug 打开；等 DOM 渲染一帧，再把那条展开。
// 面板每帧重绘，`details[open]` 会被重绘冲掉；改用样式让那条明细一直露出来。
await page.addStyleTag({
  content: `.unit-status-today-item > .unit-status-today-detail { display: block !important; }`,
});
// 面板每秒按新快照重绘，<details open> 会被冲掉。把面板克隆一份钉在原地、
// 在克隆上展开那条明细再截图：内容与样式都来自真实面板，只是不随帧重绘。
await page.evaluate((what) => {
  const panel = document.querySelector('#unit-status');
  if (panel === null) return;
  const rect = panel.getBoundingClientRect();
  const clone = panel.cloneNode(true);
  clone.id = 'unit-status';
  clone.hidden = false;
  clone.style.position = 'fixed';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.transform = 'none';
  clone.style.margin = '0';
  clone.style.zIndex = '9000';
  clone.style.visibility = 'visible';
  for (const item of clone.querySelectorAll('details.unit-status-today-item')) {
    const summary = item.querySelector('summary');
    if (summary !== null && summary.textContent !== null && summary.textContent.includes(what)) {
      item.open = true;
    }
  }
  const section = clone.querySelector('details.unit-status-today');
  if (section !== null) section.open = true;
  panel.remove();
  document.body.append(clone);
}, '提前把摊布盖上');
// 设置完立刻截图。

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}/weather-memory-why.png`, fullPage: true });
const panelNode = await page.$('#unit-status');
if (panelNode !== null) await panelNode.screenshot({ path: `${OUT}/weather-memory-why-panel.png` });

// 窄屏：把同一份面板挪到 12px 处，看 360px 视口里「第 N 天 HH:MM · 长句」会不会溢出。
await page.setViewportSize({ width: 360, height: 780 });
await page.evaluate(() => {
  const panel = document.querySelector('#unit-status');
  if (panel === null) return;
  panel.style.left = '12px';
  panel.style.top = '12px';
});
await page.screenshot({ path: `${OUT}/weather-memory-why-narrow.png`, fullPage: true });
const narrowNode = await page.$('#unit-status');
if (narrowNode !== null) await narrowNode.screenshot({ path: `${OUT}/weather-memory-why-narrow-panel.png` });
const overflow = await page.evaluate(() => {
  const panel = document.querySelector('#unit-status');
  if (panel === null) return null;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rect: panel.getBoundingClientRect().toJSON(),
    scrollWidth: panel.scrollWidth,
    clientWidth: panel.clientWidth,
  };
});

const why = found.hit.why;
const readout = {
  ok: true,
  villager: found.name,
  clock: found.hit.clock,
  what: found.hit.what,
  why,
  memoryId: found.hit.memoryId,
  eventId: found.hit.eventId,
  todayCount: (found.content.today ?? []).length,
  ticks: (found.content.today ?? []).map((entry) => ({ clock: entry.clock, what: entry.what })),
  narrow: overflow,
};
await writeFile(`${OUT}/weather-memory-why.json`, JSON.stringify(readout, null, 2), 'utf8');
console.log(JSON.stringify(readout));

await browser.close();
