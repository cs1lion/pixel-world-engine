#!/usr/bin/env node
/**
 * 本仓的一键启动：服务端 + 前端，各一个进程。
 *
 * 为什么需要它：在这之前，跑起这个世界要求你知道三个本仓没有写在任何地方的事实——
 * 服务端入口是 `server/main.py`（不是别的什么 app 模块）、前端在 5188、Vite 的
 * `/api` 代理指向 8000。少一个，页面上就只剩「上游离线」，而那句话不会告诉你
 * 是代理错了还是服务端没起。
 *
 * 三件刻意的克制：
 *
 * 1. **事件库指到 `tmp/`。** 演示与开发不写 `data/events.db`——那是给人看的历史，
 *    不该被一次试跑改写。`PIXEL_WORLD_EVENT_DB` 已经在服务端支持。
 * 2. **不读也不打印 Key。** Key 只在 `server/.env` 里，由服务端启动时自己读；
 *    这里只把它有没有配的结论转述出来。没有 Key 不是错误：世界照常跑，
 *    意图端点回 503，页面上看得见。
 * 3. **端口被占就直接说，不换端口。** 换端口会让 Vite 的代理指向一个没人听的
 *    地方，症状变成「上游一直离线」——比一句「8000 被占了」难查得多。
 *
 * 用法：
 *   node scripts/dev-live.mjs          # 起；Ctrl+C 一起停
 *   node scripts/dev-live.mjs --stop   # 兜底：按记录的 pid 停上一次起的进程
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';

const CLIENT_DIR = resolve(import.meta.dirname, '..');
const ROOT = resolve(CLIENT_DIR, '..');
const SERVER_DIR = join(ROOT, 'server');
const STATE_PATH = join(ROOT, 'tmp', 'dev-live.json');

// 端口可以显式指定，但**不会被自动挪开**：占着就报错。自动换端口会让
// Vite 的代理指向一个没人听的地方，症状从「8000 被占了」变成「上游一直离线」，
// 后者难查得多。
const SERVER_PORT = Number(process.env.PIXEL_WORLD_SERVER_PORT ?? 8000);
const CLIENT_PORT = Number(process.env.PIXEL_WORLD_CLIENT_PORT ?? 5188);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function portOpen(port) {
  return new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      done(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    setTimeout(() => finish(false), 500);
  });
}

/**
 * 按记录停掉上一次起的进程。
 *
 * 要**等 taskkill 真的返回**：先前的写法是 `spawn(...)` 之后立刻
 * `process.exit(0)`，子进程被一起带走，Vite 还活着、端口还占着——
 * 于是 `--stop` 之后紧接着再启动，报的却是「端口被占了」。
 */
async function stopRecorded() {
  if (!existsSync(STATE_PATH)) {
    console.log('没有上一次启动的记录。');
    return;
  }
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  const waits = [];
  for (const pid of [state.serverPid, state.clientPid]) {
    if (typeof pid !== 'number') continue;
    waits.push(
      new Promise((done) => {
        const child = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
        child.once('exit', done);
        child.once('error', done);
      }),
    );
  }
  await Promise.all(waits);
  // 端口真正空出来才算停完：taskkill 返回时句柄可能还没释放。
  for (const port of [state.serverPort, state.clientPort]) {
    if (typeof port !== 'number') continue;
    for (let i = 0; i < 40 && (await portOpen(port)); i += 1) await sleep(100);
  }
  console.log(`已停止 ${state.serverPid}/${state.clientPid}`);
}

async function waitHttp(url, label, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      // 端点存在但回非 2xx 也算起来了（比如没有 Key 时意图端点回 503）。
      if (response.status >= 400 && response.status < 500) return;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`等 ${label} 超时：${url}`);
    await sleep(250);
  }
}

if (process.argv.includes('--stop')) {
  await stopRecorded();
  process.exit(0);
}

if ((await portOpen(SERVER_PORT)) || (await portOpen(CLIENT_PORT))) {
  console.error(
    `端口被占了：${SERVER_PORT} ${(await portOpen(SERVER_PORT)) ? '在用' : '空'} / ` +
      `${CLIENT_PORT} ${(await portOpen(CLIENT_PORT)) ? '在用' : '空'}。\n` +
      '先在占用它的终端里停掉，或用 `--stop` 停掉上一次本脚本起的进程。',
  );
  process.exit(1);
}

mkdirSync(join(ROOT, 'tmp'), { recursive: true });
const eventDb = join(ROOT, 'tmp', 'dev-events.db');

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

const server = spawn(
  python,
  ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(SERVER_PORT)],
  {
    cwd: SERVER_DIR,
    env: { ...process.env, PIXEL_WORLD_EVENT_DB: eventDb },
    stdio: 'inherit',
  },
);

const client = spawn(
  process.execPath,
  [join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js')],
  {
    cwd: CLIENT_DIR,
    // 代理目标必须跟着服务端端口走：Vite 配置里默认是 8000，
    // 换了端口却没告诉它，页面会一直显示「上游离线」。
    env: {
      ...process.env,
      PIXEL_WORLD_API: `http://127.0.0.1:${SERVER_PORT}`,
      PIXEL_WORLD_CLIENT_PORT: String(CLIENT_PORT),
    },
    stdio: 'inherit',
  },
);

writeFileSync(
  STATE_PATH,
  JSON.stringify(
    {
      serverPid: server.pid,
      clientPid: client.pid,
      serverPort: SERVER_PORT,
      clientPort: CLIENT_PORT,
      eventDb,
    },
    null,
    2,
  ),
);

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  for (const child of [server, client]) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
};
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

try {
  await waitHttp(`http://127.0.0.1:${SERVER_PORT}/api/events`, '服务端');
  await waitHttp(`http://127.0.0.1:${CLIENT_PORT}/`, '前端');
  console.log(`\n世界在 http://127.0.0.1:${CLIENT_PORT}/ 跑着。`);
  console.log(`事件库：${eventDb}（不碰 data/events.db）`);
  console.log('Ctrl+C 一起停。\n');
} catch (error) {
  console.error(error.message);
  shutdown();
  process.exit(1);
}

for (const child of [server, client]) {
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`\n有一半退出了（code=${code}），把另一半也停掉。`);
    shutdown();
    process.exit(1);
  });
}
