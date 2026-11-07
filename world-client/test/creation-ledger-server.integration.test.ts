/**
 * 真实服务进程 + 真实客户端联调。
 *
 * 不拿同一进程里的两个并发请求冒充双客户端：这里起真的 `uvicorn main:app`，
 * 用两个独立的出队器（各自一份持久化队列）对着同一个进程补发。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import {
  buildCreationRecord,
  evaluateProposalGates,
  ladderSnapshot,
  proposalFingerprint,
  type CreationRecord,
} from '../src/creator/ledger.ts';
import {
  createCreationLedgerClient,
  createCreationLedgerOutbox,
} from '../src/creator/ledger-client.ts';
import {
  LEDGER_QUEUE_VERSION,
  MemoryLedgerQueueStorage,
  createLocalStorageLedgerQueue,
} from '../src/creator/ledger-queue.ts';
import { AutonomousFuseController } from '../src/world/creator/fuse.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(HERE, '..', '..', 'server');

function record(recordId: string, worldId = 'dengchao'): CreationRecord {
  const controller = new AutonomousFuseController(() => 0);
  controller.initRole('mapper', '地图师', 3, 3);
  const state = controller.getRoleState('mapper');
  assert.ok(state !== undefined);
  const plan = {
    templateId: 'waiting_shelter',
    at: { x: 40, y: 30 },
    palette: { body: 1, roof: 2, trim: 3, window: 4 },
  };
  return buildCreationRecord({
    recordId,
    worldId,
    seed: worldId,
    day: 3,
    at: 3 * 86400000,
    templateId: 'waiting_shelter',
    templateName: '候车亭',
    templateKind: 'industry',
    intentText: null,
    target: plan.at,
    origin: 'auto',
    gates: evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: new Set(['ink_house']),
      blueprintCount: 2,
      templateId: 'waiting_shelter',
      fuseAction: 'allow',
      fuseReason: '放行',
      traceable: true,
    }),
    ladder: ladderSnapshot(state, { action: 'allow', reason: '放行' }),
    replay: {
      seed: worldId,
      eventFrom: 0,
      eventTo: 0,
      dayFrom: 3,
      dayTo: 3,
      fingerprint: proposalFingerprint(worldId, 3, plan),
    },
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface RunningServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

interface StartupProbe {
  readonly lastStatus: number | null;
  readonly lastError: string | null;
  readonly msSinceSpawn: number;
}

/** 只补诊断：失败时把「最后一次 status / 错误码 / 距 spawn 毫秒」写进信息里。 */
function startupFailureMessage(reason: string, logs: string, probe: StartupProbe): string {
  const status = probe.lastStatus === null ? '无响应' : String(probe.lastStatus);
  const error = probe.lastError === null ? '无' : probe.lastError;
  return `${reason}（lastStatus=${status}，lastError=${error}，msSinceSpawn=${probe.msSinceSpawn}）：\n${logs}`;
}

function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${message}（${code}）` : message;
}

async function startServer(dataDir: string): Promise<RunningServer> {
  const startedAt = Date.now();
  const port = await freePort();
  const child: ChildProcess = spawn(
    'python',
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PIXEL_WORLD_CREATION_LEDGER_DIR: dataDir,
        PIXEL_WORLD_EVENT_DB: join(dataDir, 'events.db'),
        PYTHONUNBUFFERED: '1',
      },
      // 不能用 'ignore'：Windows 上 Python 的 sys.stdout/stderr 会变成 None，
      // 服务端启动日志一 print 就崩。用管道并排空，既不刷屏也不堵缓冲。
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.resume();
  let logs = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    logs = `${logs}${chunk.toString('utf-8')}`.slice(-4000);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  const deadline = Date.now() + 20000;
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`服务进程提前退出：\n${logs}`);
    try {
      const response = await fetch(`${baseUrl}/api/creation-ledger/entries?worldId=probe`);
      lastStatus = response.status;
      if (response.status === 200) {
        return {
          baseUrl,
          async stop() {
            if (exited) return;
            child.kill();
            await Promise.race([
              once(child, 'exit'),
              new Promise((resolve) => setTimeout(resolve, 5000)),
            ]).catch(() => undefined);
            if (!exited) child.kill('SIGKILL');
          },
        };
      }
    } catch (error) {
      // 还没起来，继续等；但把最后一次的错误码留住，失败时才能报出来。
      lastError = describeFetchError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill('SIGKILL');
  throw new Error(startupFailureMessage('服务在 20 秒内没起来', logs, {
    lastStatus,
    lastError,
    msSinceSpawn: Date.now() - startedAt,
  }));
}

async function withServer<T>(run: (server: RunningServer, dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(join(tmpdir(), 'pwe-ledger-'));
  const server = await startServer(dataDir);
  try {
    return await run(server, dataDir);
  } finally {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
}

function outboxFor(baseUrl: string, storage: MemoryLedgerQueueStorage | null = null) {
  const client = createCreationLedgerClient({
    appendUrl: `${baseUrl}/api/creation-ledger/entries`,
    listUrl: `${baseUrl}/api/creation-ledger/entries`,
  });
  return createCreationLedgerOutbox(client, storage === null ? {} : { storage });
}

async function list(baseUrl: string, worldId: string): Promise<{ count: number; entries: unknown[] }> {
  const response = await fetch(
    `${baseUrl}/api/creation-ledger/entries?worldId=${encodeURIComponent(worldId)}`,
  );
  assert.equal(response.status, 200);
  return (await response.json()) as { count: number; entries: unknown[] };
}

test('真实双客户端同时补发同一 recordId：服务端 1 行，第二个 duplicate，两端队列都清空', async (t) => {
  await withServer(async (server) => {
    const same = record('dual-real-same');
    const left = new MemoryLedgerQueueStorage();
    const right = new MemoryLedgerQueueStorage();
    const outboxLeft = outboxFor(server.baseUrl, left);
    const outboxRight = outboxFor(server.baseUrl, right);
    outboxLeft.enqueue(same);
    outboxRight.enqueue(same);

    const [resultLeft, resultRight] = await Promise.all([
      outboxLeft.flush(),
      outboxRight.flush(),
    ]);
    assert.equal(resultLeft?.ok, true);
    assert.equal(resultRight?.ok, true);
    if (resultLeft === null || !resultLeft.ok || resultRight === null || !resultRight.ok) {
      throw new Error('两端都应成功（其中一端以 duplicate 自愈）');
    }
    const duplicates = [resultLeft.duplicate, resultRight.duplicate].filter(Boolean).length;
    t.diagnostic(`duplicate 次数=${duplicates}`);
    assert.equal(duplicates, 1, '恰有一端拿到 duplicate');
    assert.equal(outboxLeft.size, 0);
    assert.equal(outboxRight.size, 0);
    assert.deepEqual(left.load()?.records, [], '左端本地队列清空');
    assert.deepEqual(right.load()?.records, [], '右端本地队列清空');

    const page = await list(server.baseUrl, 'dengchao');
    assert.equal(page.count, 1);
    assert.equal(page.entries.length, 1, '服务端只收 1 行');
  });
});

test('一端成功后另一端拿着旧队列重开页面：duplicate 自愈，不写第二行', async () => {
  await withServer(async (server) => {
    const same = record('stale-queue');
    const first = outboxFor(server.baseUrl);
    first.enqueue(same);
    const result = await first.flush();
    assert.equal(result?.ok, true);
    if (result === null || !result.ok) throw new Error('第一次应成功');
    assert.equal(result.duplicate, false);

    // 另一端关页面前存下的旧队列；重开时仍原样带着这条。
    const stale = new MemoryLedgerQueueStorage();
    stale.save({ version: LEDGER_QUEUE_VERSION, records: [same], dropped: 0 });
    const reopened = outboxFor(server.baseUrl, stale);
    assert.equal(reopened.size, 1, '旧队列确实还有一条');
    const replay = await reopened.flush();
    assert.equal(replay?.ok, true);
    if (replay === null || !replay.ok) throw new Error('duplicate 也应算成功');
    assert.equal(replay.duplicate, true, '必须靠服务端 duplicate 自愈');
    assert.equal(reopened.size, 0);
    assert.deepEqual(stale.load()?.records, []);

    const page = await list(server.baseUrl, 'dengchao');
    assert.equal(page.count, 1, '仍然只有 1 行');
  });
});

test('真实服务 201 正常补发 / 422 非法 payload：客户端不吞错且记录留在队列', async () => {
  await withServer(async (server) => {
    const normal = outboxFor(server.baseUrl);
    normal.enqueue(record('real-201'));
    const ok = await normal.flush();
    assert.equal(ok?.ok, true);
    if (ok === null || !ok.ok) throw new Error('201 应成功');
    assert.equal(ok.record.seq, 1);

    const invalid = record('real-422');
    const broken = { ...invalid, gates: 'not-an-array' } as unknown as CreationRecord;
    const bad = outboxFor(server.baseUrl);
    bad.enqueue(broken);
    const rejected = await bad.flush();
    assert.equal(rejected?.ok, false);
    if (rejected === null || rejected.ok) throw new Error('422 不应被吞成成功');
    assert.equal(rejected.status, 422);
    assert.match(rejected.reason, /422/);
    assert.equal(bad.size, 1, '被拒记录必须留在队列');

    const page = await list(server.baseUrl, 'dengchao');
    assert.equal(page.count, 1, '非法 payload 不得落行');
  });
});

test('服务端进程重启后同一 recordId 再补发仍幂等', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pwe-ledger-restart-'));
  const same = record('restart-idempotent');
  try {
    const firstServer = await startServer(dataDir);
    const first = outboxFor(firstServer.baseUrl);
    first.enqueue(same);
    const accepted = await first.flush();
    assert.equal(accepted?.ok, true);
    if (accepted === null || !accepted.ok) throw new Error('首次应成功');
    await firstServer.stop();

    const restarted = await startServer(dataDir);
    try {
      const replay = outboxFor(restarted.baseUrl);
      replay.enqueue(same);
      const result = await replay.flush();
      assert.equal(result?.ok, true);
      if (result === null || !result.ok) throw new Error('重启后应识别 duplicate');
      assert.equal(result.duplicate, true);
      assert.equal(replay.size, 0);
      const page = await list(restarted.baseUrl, 'dengchao');
      assert.equal(page.count, 1, '重启前后总共仍只有 1 行');
    } finally {
      await restarted.stop();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('500 存储异常用桩：客户端不丢记录，队列原样保留', async () => {
  const storage = new MemoryLedgerQueueStorage();
  const client = createCreationLedgerClient({
    fetchImpl: (async () => new Response('server down', { status: 500 })) as typeof fetch,
  });
  const outbox = createCreationLedgerOutbox(client, { storage });
  outbox.enqueue(record('stub-500'));
  const result = await outbox.flush();
  assert.equal(result?.ok, false);
  if (result === null || result.ok) throw new Error('500 不该被当成成功');
  assert.equal(result.status, 500);
  assert.equal(outbox.size, 1);
  assert.deepEqual(
    storage.load()?.records.map((item) => item.recordId),
    ['stub-500'],
  );
});

test('两个 worldId 的账本与队列不串：同 recordId 各落各的，localStorage 键也不同', async () => {
  await withServer(async (server) => {
    const left = outboxFor(server.baseUrl);
    const right = outboxFor(server.baseUrl);
    left.enqueue(record('shared-record-id', 'world-left'));
    right.enqueue(record('shared-record-id', 'world-right'));
    const [leftResult, rightResult] = await Promise.all([left.flush(), right.flush()]);
    assert.equal(leftResult?.ok, true);
    assert.equal(rightResult?.ok, true);
    if (leftResult === null || !leftResult.ok || rightResult === null || !rightResult.ok) {
      throw new Error('两个世界都该收下');
    }
    assert.equal(leftResult.duplicate, false);
    assert.equal(rightResult.duplicate, false, '不同 worldId 不共享去重键');

    const leftPage = await list(server.baseUrl, 'world-left');
    const rightPage = await list(server.baseUrl, 'world-right');
    assert.equal(leftPage.count, 1);
    assert.equal(rightPage.count, 1);
    const leftWorld = (leftPage.entries[0] as { worldId: string }).worldId;
    const rightWorld = (rightPage.entries[0] as { worldId: string }).worldId;
    assert.equal(leftWorld, 'world-left');
    assert.equal(rightWorld, 'world-right');

    const keys = new Map<string, string>();
    const storage = {
      getItem: (key: string) => keys.get(key) ?? null,
      setItem: (key: string, value: string) => {
        keys.set(key, value);
      },
      removeItem: (key: string) => {
        keys.delete(key);
      },
      clear: () => keys.clear(),
      key: () => null,
      get length() {
        return keys.size;
      },
    } as unknown as Storage;
    const leftQueue = createLocalStorageLedgerQueue('world-left', storage);
    const rightQueue = createLocalStorageLedgerQueue('world-right', storage);
    assert.ok(leftQueue !== null && rightQueue !== null);
    leftQueue.save({ version: LEDGER_QUEUE_VERSION, records: [record('q-left', 'world-left')], dropped: 0 });
    rightQueue.save({ version: LEDGER_QUEUE_VERSION, records: [record('q-right', 'world-right')], dropped: 0 });
    assert.equal(keys.size, 2, '两个世界应各占一个 localStorage 键');
    assert.deepEqual(leftQueue.load()?.records.map((item) => item.recordId), ['q-left']);
    assert.deepEqual(rightQueue.load()?.records.map((item) => item.recordId), ['q-right']);
  });
});

test('启动超时的失败信息必须带 lastStatus / lastError / msSinceSpawn', () => {
  const message = startupFailureMessage(
    '服务在 20 秒内没起来',
    'INFO: Uvicorn running on http://127.0.0.1:1723\n',
    { lastStatus: 503, lastError: 'fetch failed（ECONNREFUSED）', msSinceSpawn: 20015 },
  );
  assert.match(message, /lastStatus=503/);
  assert.match(message, /lastError=fetch failed（ECONNREFUSED）/);
  assert.match(message, /msSinceSpawn=20015/);
  // 日志照旧附在后面：只有这三个读数、丢掉日志就查不了「服务到底起没起」。
  assert.match(message, /Uvicorn running on http:\/\/127\.0\.0\.1:1723/);

  // 一次都没拿到响应（B13 那次的现象）时也要显式写「无响应 / 无」，不能留空。
  const silent = startupFailureMessage('服务在 20 秒内没起来', '', {
    lastStatus: null,
    lastError: null,
    msSinceSpawn: 20001,
  });
  assert.match(silent, /lastStatus=无响应/);
  assert.match(silent, /lastError=无/);
  assert.match(silent, /msSinceSpawn=20001/);
});
