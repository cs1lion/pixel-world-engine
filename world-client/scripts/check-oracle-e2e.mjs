/**
 * 神谕端到端：真实服务进程 + 真实 HTTP + 真实世界。
 *
 * 跑法：
 *   node scripts/check-oracle-e2e.mjs
 *
 * 自己起三样东西，谁也不碰：
 *   1. 一个 **OpenAI 兼容的假模型**（本进程内，127.0.0.1:8931）。这台机器上没有
 *      `server/.env`，也就没有真模型的 Key；能验的是「服务进程 → HTTP → 模型接口
 *      → 意图 → 世界 → 事件日志 → 存档」这条链，模型本身是外部依赖，换成桩。
 *      报告里「模型是桩」这句必须跟着读数一起说，不能省。
 *   2. 真服务进程（`python -m uvicorn main:app`，127.0.0.1:8932，隔离的事件库与
 *      记忆目录）。
 *   3. 一份独立的 Vite（127.0.0.1:5291），`PIXEL_WORLD_API` 指向上面的 8932。
 *      开发时在跑的 5188/5189 一概不碰。
 *
 * 断言四件事：
 *   - 绕过 UI 直接 POST 超长 / 控制字符 → 422 + 理由（不是 200 + unknown）；
 *   - 面板发一句合法神谕 → 回执成功、天气真的变了、事件日志多一条天气记录、
 *     写出的存档 schemaVersion 仍是 5；
 *   - 客户端直接调 `Oracle.say` 送超长 → 服务端的 4xx 回执照抄到屏上，不吞；
 *   - 面板那条路收到 4xx（用 route 注入真服务端会回的那种 422）→ 原句回到输入框。
 *     这条是「版本漂移」的形状：旧前端上限 500、新服务端 200，面板照样能发出去。
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(CLIENT, '..', 'server');
const MODEL_PORT = Number(process.env.PWE_E2E_MODEL_PORT ?? 8931);
const API_PORT = Number(process.env.PWE_E2E_API_PORT ?? 8932);
const CLIENT_PORT = Number(process.env.PWE_E2E_CLIENT_PORT ?? 5291);
const API = `http://127.0.0.1:${API_PORT}`;
const BASE = `http://127.0.0.1:${CLIENT_PORT}/`;
const SAVE_KEY = 'xiaoxi.pixel-world.save.v1';

const results = [];
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}：期望「${expected}」，实得「${actual}」`);
}

/** 轮询直到 `probe()` 为真（或抛出），不用固定 sleep 赌时间。 */
async function until(probe, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等到超时：${label}${last === null ? '' : `（最后一次错误：${last.message}）`}`);
}

async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

async function postIntent(utterance, templates = []) {
  const response = await fetch(`${API}/api/world/intent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ utterance, templates }),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForHttp(url, label, timeoutMs = 20000) {
  return until(
    async () => {
      const response = await fetch(url).catch(() => null);
      return response !== null && response.status < 500;
    },
    label,
    timeoutMs,
  );
}

const children = [];
let modelServer = null;
let tempRoot = null;

async function cleanup() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // 已经退出了。
    }
  }
  if (modelServer !== null) await new Promise((resolve) => modelServer.close(resolve));
  if (tempRoot !== null) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  tempRoot = await mkdtemp(join(tmpdir(), 'pwe-oracle-e2e-'));
  const eventDb = join(tempRoot, 'events.db');
  const memoryDir = join(tempRoot, 'memory');

  // 假模型：任何请求都回一条「天气换成 storm」的意图。
  const modelReply = JSON.stringify({
    commands: [{ command: 'weather.set', args: { value: 'storm' } }],
    narrative: '听懂了。',
  });
  modelServer = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: modelReply } }],
      }));
      void body;
    });
  });
  await new Promise((resolve) => modelServer.listen(MODEL_PORT, '127.0.0.1', resolve));
  console.log(`  假模型  http://127.0.0.1:${MODEL_PORT}/v1`);

  const api = spawn(process.env.PYTHON ?? 'python', [
    '-m', 'uvicorn', 'main:app',
    '--host', '127.0.0.1',
    '--port', String(API_PORT),
  ], {
    cwd: SERVER,
    env: {
      ...process.env,
      LLM_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
      LLM_API_KEY: 'stub-key-for-e2e',
      LLM_MODEL: 'stub-model',
      PIXEL_WORLD_EVENT_DB: eventDb,
      PIXEL_WORLD_MEMORY_DIR: memoryDir,
    },
    stdio: 'ignore',
  });
  children.push(api);
  await waitForHttp(`${API}/api/events?limit=1`, '服务进程起来');
  console.log(`  真服务  ${API}（事件库 ${eventDb}）`);

  const vite = spawn(process.execPath, [join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: CLIENT,
    env: {
      ...process.env,
      PIXEL_WORLD_API: API,
      PIXEL_WORLD_CLIENT_PORT: String(CLIENT_PORT),
    },
    stdio: 'ignore',
  });
  children.push(vite);
  await waitForHttp(BASE, '前端起来');
  console.log(`  前端    ${BASE}→ ${API}`);

  // ------------------------------------------------------------ 服务端闸（旁路）
  await checkAsync('E2E-1a', '绕过 UI 直接 POST 250 字 → 422 + 上限理由', async () => {
    const response = await postIntent('字'.repeat(250));
    eq(response.status, 422, '250 字应当 422');
    assert(typeof response.body.detail === 'string', '422 的 detail 应当是人话');
    assert(response.body.detail.includes('250 字'), `回执要说实际长度，实得「${response.body.detail}」`);
    assert(response.body.detail.includes('上限 200 字'), `回执要说上限，实得「${response.body.detail}」`);
    return `250 字 → 422「${response.body.detail}」`;
  });

  await checkAsync('E2E-1b', '绕过 UI 直接 POST 10000 字 → 422（不是 200 + unknown）', async () => {
    const response = await postIntent('字'.repeat(10_000));
    eq(response.status, 422, '10000 字应当 422');
    eq(response.body.intent?.kind ?? 'none', 'none', '被拒的请求不该带意图');
    return `10000 字 → 422「${response.body.detail}」`;
  });

  await checkAsync('E2E-1c', '绕过 UI 直接 POST 控制字符 → 422 + 个数', async () => {
    const response = await postIntent('拆\u0000掉祭坛\u007f');
    eq(response.status, 422, '带控制字符应当 422');
    assert(response.body.detail.includes('控制字符'), response.body.detail);
    assert(response.body.detail.includes('2 个'), response.body.detail);
    return `「拆\\u0000掉祭坛\\u007f」→ 422「${response.body.detail}」`;
  });

  await checkAsync('E2E-1d', '恰好 200 字 → 200 + setWeather（正例，不是只钉拒收）', async () => {
    // 前三条的 templates 是空的——它们在长度/字符那道闸就被拒了，走不到
    // 「没有模板表」那一关；这条要真到模型面前，模板得给。
    const templates = [{ id: 'hut', displayName: '小屋', boundTask: 'build' }];
    const response = await postIntent('字'.repeat(200), templates);
    eq(response.status, 200, '200 字应当收下');
    eq(response.body.intent?.kind, 'setWeather', '模型桩该被请求到');
    eq(response.body.intent?.weather, 'storm', '意图落到 storm');
    return `200 字 → 200，intent=${JSON.stringify(response.body.intent)}`;
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 900, height: 600 },
  });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${BASE}?time=noon&speed=1&debug=1`, { waitUntil: 'load' });
  await until(() => page.evaluate(() => window.Oracle !== undefined), '场景挂上 window.Oracle');
  // 首帧之后世界才有村民与天气可读。
  await until(() => page.evaluate(() => window.Oracle.view().villagers.length > 0), '村民上场');
  const weatherStart = await page.evaluate(() => window.Oracle.view().weather);

  // ------------------------------------------------------- 浏览器旁路（真 4xx）
  await checkAsync('E2E-2a', '页面里绕过面板直接调 Oracle.say(250 字) → 屏上是服务端的 422 理由', async () => {
    const before = await page.evaluate(() => document.querySelector('#reply').textContent);
    const said = await page.evaluate(() => window.Oracle.say('字'.repeat(250)));
    assert(said.ok, '投递本身是同步成功（回执要等上游）');
    const receipt = await until(
      async () => {
        const text = await page.evaluate(() => document.querySelector('#reply').textContent);
        return text !== before && text.includes('上限 200 字') ? text : null;
      },
      '屏上出现服务端的 4xx 回执',
    );
    const bad = await page.evaluate(() => document.querySelector('#reply').classList.contains('bad'));
    assert(bad, `4xx 回执应当带错误样式，实际「${receipt}」`);
    return `回执「${receipt}」`;
  });

  // -------------------------------------------- 真服务在线：合法神谕成功闭环
  const beforeEvents = await getJson(`${API}/api/events?limit=1`);
  const baselineId = beforeEvents.body.latestId;

  await checkAsync('E2E-3a', '面板发合法神谕 → 回执成功、世界真的变了', async () => {
    await page.fill('#utterance', '让云把水倒下来');
    await page.press('#utterance', 'Enter');
    const weather = await until(
      async () => {
        const current = await page.evaluate(() => window.Oracle.view().weather);
        return current === 'storm' ? current : null;
      },
      `天气从 ${weatherStart} 变成 storm`,
    );
    const reply = await page.evaluate(() => ({
      text: document.querySelector('#reply').textContent,
      bad: document.querySelector('#reply').classList.contains('bad'),
    }));
    assert(!reply.bad, `成功回执不该是错误样式：${reply.text}`);
    assert(reply.text.length > 0, '成功也要有一句回执，不能空着');
    return `weather ${weatherStart}→${weather}，回执「${reply.text}」`;
  });

  await checkAsync('E2E-3b', '事件日志多一条天气记录（且只有这一条）', async () => {
    const events = await until(
      async () => {
        const page = await getJson(`${API}/api/events?since=${baselineId}&limit=50`);
        const weather = page.body.events.filter((event) => event.payload?.change === 'weather');
        return weather.length > 0 ? page.body.events : null;
      },
      '日志里出现天气改变',
    );
    const weather = events.filter((event) => event.payload?.change === 'weather');
    eq(weather.length, 1, '这一次神谕应当且只应当记一条天气改变');
    eq(weather[0].payload.weather, 'storm', '记下的天气是执行后的那一档');
    assert(Number(weather[0].id) > baselineId, `新事件 id 应当大于游标 ${baselineId}`);
    return `id ${baselineId}→${weather[0].id}，payload=${JSON.stringify(weather[0].payload)}；本页新增 ${events.length} 条`;
  });

  await checkAsync('E2E-3c', '存档写盘后 schemaVersion 仍是 5', async () => {
    await page.click('#save-now');
    const saved = await until(
      async () => {
        const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
        return raw === null ? null : raw;
      },
      '存档写入 localStorage',
    );
    const save = JSON.parse(saved);
    eq(save.schemaVersion, 5, '存档 schemaVersion');
    const status = await page.evaluate(() => window.Oracle.saveStatus());
    eq(status.schemaVersion, 5, 'saveStatus 的 schemaVersion');
    return `存档 ${save.schemaVersion}，saveStatus ${status.schemaVersion}`;
  });

  // ------------------------------------------- 面板收到 4xx：不吞错、输入保留
  await checkAsync('E2E-4a', '面板收到 422 → 回执照抄、原句回到输入框（版本漂移形状）', async () => {
    // 面板的 200 上限让正常路径发不出会被服务端拒收的句子。能造出这一幕的
    // 是版本漂移：缓存里的旧前端（上限 500）配新服务端（上限 200）。
    // route 注入的正是真服务端会回的那段 422 文本。
    const reason = '这句话 250 字，超过上限 200 字；删短再发';
    await page.route('**/api/world/intent', (route) => route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ detail: reason }),
    }));
    try {
      await page.fill('#utterance', '让云把水倒下来');
      await page.press('#utterance', 'Enter');
      eq(await page.inputValue('#utterance'), '', '投递时先清空（旧行为不变）');
      const reply = await until(
        async () => {
          const text = await page.evaluate(() => document.querySelector('#reply').textContent);
          return text.includes('上限 200 字') ? text : null;
        },
        '屏上出现 422 回执',
      );
      assert(reply.includes(reason), `回执要原样带上服务端理由，实得「${reply}」`);
      const restored = await until(
        async () => {
          const value = await page.inputValue('#utterance');
          return value === '让云把水倒下来' ? value : null;
        },
        '原句回到输入框',
      );
      const bad = await page.evaluate(() => document.querySelector('#reply').classList.contains('bad'));
      assert(bad, '4xx 回执应当带错误样式');
      return `回执「${reply}」；输入框恢复「${restored}」`;
    } finally {
      await page.unroute('**/api/world/intent');
    }
  });

  await checkAsync('E2E-4b', '整局没有 pageerror', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' | '));
    return `0 个 pageerror`;
  });

  await browser.close();
}

main()
  .catch((error) => {
    failures += 1;
    console.log(`  FAIL E2E-0 端到端脚本 — ${error?.message ?? error}`);
    console.error(error);
  })
  .finally(async () => {
    await cleanup();
    const total = results.length;
    console.log(`\n${failures === 0 ? '通过' : '失败'}：${total} 项，失败 ${failures} 项`);
    process.exit(failures === 0 ? 0 : 1);
  });
