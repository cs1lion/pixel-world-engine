#!/usr/bin/env node
/**
 * 真实命令闭环的浏览器验收。
 *
 * 验的是用户屏幕上能看到的四件事，**全部走真实 HTTP**：
 *
 *   1. 打开页面，世界自己跑，状态行说上游在线
 *   2. 一句话 → 服务端 → 白名单 → 回到世界 → 世界里真的多了一栋楼
 *   3. 一句世界办不到的话 → 具体原因出现在回执上，世界一动没动
 *   4. 世界改的事进了事件日志；刷新后世界还是那样
 *   5. 停掉服务端：世界照常过日子，状态行说上游离线
 *
 * 模型是本地桩：一个假的 OpenAI 兼容端点。这样验收不花 Key、不联网，
 * 但**服务端那条路是真的**——`env_caller` 真发 HTTP、白名单真校验、
 * 信封真序列化。用注入 `app.state.model_caller` 会绕过其中的一大半。
 *
 * 隔离：自己的端口、自己的事件库（`tmp/`），不碰开发时在跑的 8000/5188，
 * 也不碰 `data/events.db`。
 *
 * 跑法：`npm run test:live`（前置只需 `npm ci` 与一个能用的 python）
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const CLIENT_DIR = resolve(import.meta.dirname, '..');
const ROOT = resolve(CLIENT_DIR, '..');
const SERVER_DIR = join(ROOT, 'server');
const OUT = join(CLIENT_DIR, 'eval', 'live');

const API_PORT = Number(process.env.LIVE_API_PORT ?? 8011);
const CLIENT_PORT = Number(process.env.LIVE_CLIENT_PORT ?? 5191);
const STUB_PORT = Number(process.env.LIVE_STUB_PORT ?? 8012);

/** 这次验收要盖的那栋楼。大世界里这一格是合规的工业区空地。 */
const PLOT = { x: 18, y: 22 };

/**
 * 灯潮界那一条：渡口码头上的空地。
 *
 * 必须自己挑一格，不能沿用默认世界的坐标——两个地图尺寸与地形都不同
 * （64×48 对 96×72）。这一格是石砌码头，永远在潮线之上，涨潮也不会被淹。
 */
const DENGCHAO_PLOT = { x: 20, y: 15 };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const portOpen = (port) =>
  new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      done(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    setTimeout(() => finish(false), 500);
  });

async function waitHttp(url, label, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok || (response.status >= 400 && response.status < 500)) return;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`等 ${label} 超时：${url}`);
    await sleep(250);
  }
}

function killTree(child) {
  if (child === undefined || child.exitCode !== null) return;
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
}

// ---------------------------------------------------------------- 模型桩
//
// 只认这几句话，其余一律 unknown。这样「哪句话该翻成什么」在验收里是
// **声明**，不是模型的概率。

const STUB_ANSWERS = new Map([
  [
    // 规则认不出（句首没有建/盖/造）→ 一定会落到服务端。
    '张罗一间歇脚的工坊',
    { commands: [{ command: 'building.add', args: { prefabId: 'workshop_plot', at: PLOT } }] },
  ],
  [
    // 世界之外的东西：雪不在天气的三档里。白名单应当拒，且说清可选什么。
    '让天上掉雪',
    { commands: [{ command: 'weather.set', args: { value: 'snow' } }] },
  ],
  [
    // 灯潮界这一句同样以「建」以外的词打头，一定会落到服务端。
    '在渡口张罗一座候车亭',
    { commands: [{ command: 'building.add', args: { prefabId: 'waiting_shelter', at: DENGCHAO_PLOT } }] },
  ],
]);

function startStub() {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      let utterance = '';
      let messages = [];
      try {
        const parsed = JSON.parse(body);
        messages = parsed.messages ?? [];
        utterance = messages[messages.length - 1]?.content ?? '';
      } catch {
        /* 桩也会被喂坏 JSON，回 unknown 比崩掉好 */
      }
      // 留完整请求：只证明「问过原话」，还不能证明世界现状真的送到了模型。
      calls.push({ utterance, messages });
      const answer = STUB_ANSWERS.get(utterance) ?? {
        commands: [],
        narrative: '这句话没有要求世界做任何事',
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answer) } }],
        }),
      );
    });
  });
  return new Promise((done) => {
    server.listen(STUB_PORT, '127.0.0.1', () => done({ server, calls }));
  });
}

// ---------------------------------------------------------------- 起环境

async function startEnvironment(tempRoot) {
  const eventDb = join(tempRoot, 'events.db');
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const api = spawn(
    python,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(API_PORT)],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PIXEL_WORLD_EVENT_DB: eventDb,
        // 桩不走网络外呼，但这条钥匙必须存在，否则端点直接 503。
        LLM_API_KEY: 'stub-key',
        LLM_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        LLM_MODEL: 'stub-model',
        LLM_TIMEOUT_SECONDS: '5',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  api.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (text.includes('[pixel-world]')) process.stdout.write(text);
  });

  const client = spawn(
    process.execPath,
    [join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js')],
    {
      cwd: CLIENT_DIR,
      env: {
        ...process.env,
        PIXEL_WORLD_API: `http://127.0.0.1:${API_PORT}`,
        PIXEL_WORLD_CLIENT_PORT: String(CLIENT_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await waitHttp(`http://127.0.0.1:${API_PORT}/api/events`, '服务端');
  await waitHttp(`http://127.0.0.1:${CLIENT_PORT}/`, '前端');
  return { api, client, eventDb };
}

// ---------------------------------------------------------------- 断言工具

const checks = [];
const check = (ok, label) => {
  assert.ok(ok, label);
  checks.push(label);
};

const browserErrors = [];

async function main() {
  for (const port of [API_PORT, CLIENT_PORT, STUB_PORT]) {
    if (await portOpen(port)) throw new Error(`端口 ${port} 被占用了，验收不想抢它的活。`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'pixel-world-live-'));
  mkdirSync(OUT, { recursive: true });
  const stub = await startStub();
  const { api, client } = await startEnvironment(tempRoot);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
  const page = await context.newPage();
  const intentRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/world/intent') {
      intentRequests.push(request.postDataJSON());
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  // 只清第一次导航前的存档：每次导航都清，刷新那一步就验不出「读回来了」。
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('live.cleared') === null) {
        localStorage.clear();
        sessionStorage.setItem('live.cleared', '1');
      }
    } catch {
      /* 隐私模式忽略 */
    }
  });

  const state = () => page.evaluate(() => window.Oracle.view());
  const waitFor = async (predicate, label, timeout = 25_000) => {
    const started = Date.now();
    for (;;) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      if (Date.now() - started > timeout) {
        throw new Error(`超时：${label}`);
      }
      await page.waitForTimeout(120);
    }
  };

  const say = async (text) => {
    await page.fill('#utterance', text);
    await page.press('#utterance', 'Enter');
  };

  try {
    // ---- 1) 开局：世界自己在跑，上游在线
    await page.goto(`http://127.0.0.1:${CLIENT_PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20_000 });
    check(browserErrors.length === 0, '页面加载无 JS 报错');

    const opening = await state();
    check(opening.buildings.length > 0, '开局世界里有楼');
    await waitFor(
      (snapshot) => snapshot.feed.connected === true,
      '世界连上了事件流',
    );
    check(true, '状态行说上游在线');
    await page.waitForFunction(
      () => (document.querySelector('#hud-net')?.textContent ?? '') === '上游在线',
      null,
      { timeout: 10_000 },
    );
    check(true, '顶栏的连接状态是「上游在线」');
    await page.screenshot({ path: join(OUT, '01-online.png') });

    // ---- 2) 一句话 → 服务端 → 白名单 → 世界真的变了
    const before = await state();
    check(
      before.buildings.every((building) => building.prefabId !== 'workshop_plot'),
      '开局没有新工坊',
    );

    await say('张罗一间歇脚的工坊');
    const built = await waitFor(
      (snapshot) => snapshot.buildings.some((building) => building.prefabId === 'workshop_plot'),
      '新工坊出现在世界里',
    );
    const workshop = built.buildings.find((building) => building.prefabId === 'workshop_plot');
    check(workshop !== undefined, '世界里多了一栋新工坊');
    check(
      workshop.instanceId.startsWith('workshop_plot#') &&
        workshop.instanceId !== 'workshop_plot#1',
      `实例 id 由世界发且不撞号：${workshop.instanceId}`,
    );
    check(
      workshop.origin.x === PLOT.x && workshop.origin.y === PLOT.y,
      '建在了模型说的那一格',
    );
    await page.waitForFunction(
      () => (document.querySelector('#reply')?.textContent ?? '').includes('开工建造'),
      null,
      { timeout: 10_000 },
    );
    const builtReply = await page.textContent('#reply');
    check(
      builtReply !== null && builtReply.includes('开工建造'),
      `回执说清世界做了什么：${builtReply}`,
    );
    await page.screenshot({ path: join(OUT, '02-built.png') });

    // 模型确实被问过，且问的是原话——不然上面的「成功」可能是规则认出来的。
    const modelCall = stub.calls.find((call) => call.utterance === '张罗一间歇脚的工坊');
    check(
      modelCall !== undefined,
      '这一句真的走到了服务端那一路（规则认不出，问了模型）',
    );

    // 两端都验，不能只凭命令成功就宣布上下文已接通。
    const intentRequest = intentRequests.find(
      (request) => request.utterance === '张罗一间歇脚的工坊',
    );
    check(intentRequest !== undefined, '浏览器发出了完整意图请求');
    check(
      JSON.stringify(intentRequest?.worldSize) === JSON.stringify({ width: 96, height: 72 }),
      '生产世界尺寸随请求到了服务端',
    );
    const worldInstanceIds = before.buildings.map((building) => building.instanceId).sort();
    const contextInstanceIds = [
      ...(intentRequest?.context?.built?.town ?? []),
      ...(intentRequest?.context?.built?.wild ?? []),
    ].map((building) => building.instanceId).sort();
    check(
      JSON.stringify(contextInstanceIds) === JSON.stringify(worldInstanceIds),
      '请求里的实例 id 与生产世界一一对应',
    );
    const systemPrompt = modelCall?.messages.find((message) => message.role === 'system')?.content;
    check(
      typeof systemPrompt === 'string' &&
        worldInstanceIds.every((instanceId) => systemPrompt.includes(`instanceId=${instanceId}`)),
      '服务端给模型的提示词带着真实实例 id',
    );

    // ---- 3) 世界办不到的话：具体原因回到用户手上，世界一动没动
    const beforeRefusal = await state();
    await say('让天上掉雪');
    await page.waitForFunction(
      () => (document.querySelector('#reply')?.textContent ?? '').includes('snow'),
      null,
      { timeout: 20_000 },
    );
    const refusal = await page.textContent('#reply');
    check(
      refusal !== null && refusal.includes('clear') && refusal.includes('rain'),
      `拒绝理由说清可选什么，不是一句「没听懂」：${refusal}`,
    );
    check(
      (await page.getAttribute('#reply', 'class'))?.includes('bad') === true,
      '拒绝的回执标成失败',
    );
    const afterRefusal = await state();
    check(
      JSON.stringify(afterRefusal.buildings) === JSON.stringify(beforeRefusal.buildings) &&
        afterRefusal.weather === beforeRefusal.weather,
      '被拒之后世界一动没动',
    );
    check(
      afterRefusal.oracle.length === beforeRefusal.oracle.length,
      '被拒的话不刻石板：石板不是聊天记录',
    );
    await page.screenshot({ path: join(OUT, '03-refused.png') });

    // ---- 4) 世界改的事进了事件日志
    const log = await (
      await fetch(`http://127.0.0.1:${API_PORT}/api/events`)
    ).json();
    const builtEvent = log.events.find(
      (event) =>
        event.kind === 'world.changed' && event.payload.change === 'building.built',
    );
    check(builtEvent !== undefined, '造物这件事写进了只增日志');
    check(
      builtEvent.payload.instanceId === workshop.instanceId,
      '日志里的实例 id 与世界上那一栋一致',
    );

    // ---- 5) 刷新后世界还是那样
    const savedCount = (await state()).buildings.length;
    await page.evaluate(() => window.Oracle.saveNow());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20_000 });
    const restored = await waitFor(
      (snapshot) => snapshot.buildings.length === savedCount,
      '刷新后建筑数量恢复',
    );
    check(
      restored.buildings.some((building) => building.instanceId === workshop.instanceId),
      '刷新后那栋楼还是同一栋（实例 id 不变）',
    );

    // ---- 6) 换一套设定集，同一条闭环再走一遍
    //
    // 只验默认世界等于只验了协议，没验命是不是真能落到另一张图上：
    // 灯潮界的蓝图 id、区域、地形全不一样，模板表随请求换了一份。
    await page.goto(`http://127.0.0.1:${CLIENT_PORT}/?world=dengchao`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20_000 });
    check(browserErrors.length === 0, '灯潮界加载无 JS 报错');

    const denOpening = await state();
    check(denOpening.buildings.length > 0, '灯潮界开局有楼');
    check(
      denOpening.buildings.every((building) => building.prefabId !== 'waiting_shelter'),
      '灯潮界开局没有候车亭',
    );

    await say('在渡口张罗一座候车亭');
    const denBuilt = await waitFor(
      (snapshot) => snapshot.buildings.some((b) => b.prefabId === 'waiting_shelter'),
      '候车亭出现在灯潮界',
    );
    const shelter = denBuilt.buildings.find((b) => b.prefabId === 'waiting_shelter');
    check(shelter !== undefined, '灯潮界里真的多了一座候车亭');
    check(
      shelter.origin.x === DENGCHAO_PLOT.x && shelter.origin.y === DENGCHAO_PLOT.y,
      '建在了模型说的那一格（灯潮界自己的坐标）',
    );
    check(
      shelter.zone === 'industry',
      '新楼落在灯潮界声明的建造分区里',
    );
    const denReply = await page.textContent('#reply');
    check(
      denReply !== null && denReply.includes('开工建造'),
      `灯潮界的回执说清做了什么：${denReply}`,
    );

    // 模板表确实换了一份：服务端看到的是灯潮界的七种模板，不是默认世界那一套。
    // 断言按「含灯潮界的、不含默认世界的」来写，不钉总数——模板表还会长。
    const denRequest = intentRequests.find((r) => r.utterance === '在渡口张罗一座候车亭');
    check(denRequest !== undefined, '灯潮界那句话走到了服务端');
    const denTemplateIds = (denRequest?.templates ?? []).map((t) => t.id);
    check(
      denTemplateIds.includes('waiting_shelter') && !denTemplateIds.includes('workshop_plot'),
      `灯潮界发的是自己的模板表：${denTemplateIds.join(' / ')}`,
    );
    check(
      JSON.stringify(denRequest?.worldSize) === JSON.stringify({ width: 64, height: 48 }),
      '灯潮界的世界尺寸随请求到了服务端',
    );
    const denSystem = stub.calls
      .filter((call) => call.utterance === '在渡口张罗一座候车亭')
      .at(-1)?.messages.find((message) => message.role === 'system')?.content;
    check(
      typeof denSystem === 'string' && denSystem.includes('候车亭'),
      '服务端给模型的提示词里带着灯潮界的模板',
    );

    // 默认世界的存档不能因为打开过灯潮界就消失：两套槽各自独立。
    check(
      (await page.evaluate(() => localStorage.getItem('xiaoxi.pixel-world.save.v1'))) !== null,
      '打开灯潮界没有覆盖默认世界的存档',
    );
    await page.screenshot({ path: join(OUT, '05-dengchao-built.png') });

    // ---- 7) 停掉服务端：世界照常过日子，但状态行说实话
    killTree(api);
    await sleep(500);
    await page.waitForFunction(
      () => (document.querySelector('#hud-net')?.textContent ?? '') === '上游离线',
      null,
      { timeout: 30_000 },
    );
    check(true, '服务端停了，顶栏改说「上游离线」');

    const offlineA = await state();
    await sleep(1200);
    const offlineB = await state();
    check(offlineB.now > offlineA.now, '上游离线时世界照常在走');
    check(browserErrors.length === 0, '全程没有未捕获的页面错误');
    await page.screenshot({ path: join(OUT, '04-offline.png') });
  } finally {
    await browser.close();
    killTree(client);
    killTree(api);
    stub.server.close();
    // 只删自己建的临时目录；删不掉也不影响结论。
    try {
      if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* Windows 上刚关掉的库文件偶尔还被句柄占着 */
    }
  }
}

try {
  await main();
  console.log(`\n真实闭环验收通过（${checks.length} 项）：`);
  for (const label of checks) console.log(`  ok  ${label}`);
  console.log(`截图：${OUT}`);
} catch (error) {
  console.error(`\n失败：${error.message}`);
  console.error(`已完成 ${checks.length} 项：`);
  for (const label of checks) console.error(`  ok  ${label}`);
  if (browserErrors.length > 0) console.error(`页面报错：\n${browserErrors.join('\n')}`);
  process.exitCode = 1;
}
