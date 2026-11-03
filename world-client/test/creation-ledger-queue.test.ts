/** 账本队列的持久化、容量上限、去重，以及「POST 失败 → 关页面 → 重开 → 补发」。
 *
 * 补发那一条用两个真实的 Node HTTP 服务：第一个回 500，第二个回 201。
 * 中间不重用出队器——那正是「关页面再开」的语义。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
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
  LEDGER_QUEUE_MAX_ITEMS,
  LEDGER_QUEUE_KEY_PREFIX,
  MemoryLedgerQueueStorage,
  createLocalStorageLedgerQueue,
  ledgerQueueBytes,
} from '../src/creator/ledger-queue.ts';
import { AutonomousFuseController } from '../src/world/creator/fuse.ts';

function record(id: string): CreationRecord {
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
    recordId: id,
    worldId: 'dengchao',
    seed: 'dengchao',
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
      seed: 'dengchao',
      eventFrom: 0,
      eventTo: 0,
      dayFrom: 3,
      dayTo: 3,
      fingerprint: proposalFingerprint('dengchao', 3, plan),
    },
  });
}

/** 一个只回固定状态码的本地服务；它把请求体原样记下来供断言。 */
async function serve(status: number, bodyOf: (parsed: unknown) => unknown): Promise<{
  url: string;
  requests: unknown[];
  close: () => Promise<void>;
}> {
  const requests: unknown[] = [];
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const parsed = raw === '' ? null : JSON.parse(raw);
      requests.push(parsed);
      response.statusCode = status;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(bodyOf(parsed)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/api/creation-ledger/entries`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    }),
  };
}

// ---------------------------------------------------------------- 去重与容量

test('同一个 recordId 重复入队只留一条', () => {
  const storage = new MemoryLedgerQueueStorage();
  const outbox = createCreationLedgerOutbox(
    createCreationLedgerClient({ fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch }),
    { storage },
  );
  outbox.enqueue(record('same'));
  outbox.enqueue(record('same'));
  assert.equal(outbox.size, 1);
  assert.equal(storage.load()?.records.length, 1);
});

test('容量上限：超过条数会丢最旧的未发送记录，并保留 dropped 计数', () => {
  const storage = new MemoryLedgerQueueStorage();
  const outbox = createCreationLedgerOutbox(
    createCreationLedgerClient({ fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch }),
    { storage, maxItems: 3, maxBytes: Number.POSITIVE_INFINITY },
  );
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) outbox.enqueue(record(id));
  assert.equal(outbox.size, 3);
  assert.equal(outbox.dropped, 2);
  assert.deepEqual(
    storage.load()?.records.map((item) => item.recordId),
    ['r3', 'r4', 'r5'],
  );
  assert.equal(storage.load()?.dropped, 2);
});

test('容量上限：超过字节数也会裁，`pendingBytes` 与容量判定同一个口径', () => {
  const storage = new MemoryLedgerQueueStorage();
  const cap = ledgerQueueBytes([record('bytes-1'), record('bytes-2')]);
  const outbox = createCreationLedgerOutbox(
    createCreationLedgerClient({ fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch }),
    { storage, maxItems: 100, maxBytes: cap },
  );
  outbox.enqueue(record('bytes-1'));
  outbox.enqueue(record('bytes-2'));
  outbox.enqueue(record('bytes-3'));
  assert.ok(outbox.size <= 2);
  assert.ok(outbox.pendingBytes <= cap);
  assert.ok(outbox.dropped >= 1);
});

// ---------------------------------------------------------------- localStorage

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

test('localStorage 队列按世界分键，重开能读回；存坏的重复条目会去重', () => {
  const storage = new FakeStorage();
  const key = `${LEDGER_QUEUE_KEY_PREFIX}:dengchao`;
  const first = createLocalStorageLedgerQueue('dengchao', storage);
  assert.ok(first !== null);
  first.save({
    version: 1,
    records: [record('a'), record('a'), record('b')],
    dropped: 1,
  });
  assert.equal(storage.getItem(key) !== null, true);

  const second = createLocalStorageLedgerQueue('dengchao', storage);
  assert.ok(second !== null);
  const loaded = second.load();
  assert.deepEqual(loaded?.records.map((item) => item.recordId), ['a', 'b']);
  assert.equal(loaded?.dropped, 1);
});

test('没有 localStorage 就返回 null，不假装已经持久化', () => {
  assert.equal(createLocalStorageLedgerQueue('dengchao', null), null);
});

test('队列默认上限是 200 条', () => {
  assert.equal(LEDGER_QUEUE_MAX_ITEMS, 200);
});

// ---------------------------------------------------------------- 真实 HTTP 补发

test('POST 失败 → 关页面 → 重开 → 记录补发，且只补发一次', async () => {
  // 用生产同一条 localStorage 适配器（配一个假 Storage），而不是内存桩。
  const browserStorage = new FakeStorage();
  const queueStorage = createLocalStorageLedgerQueue('dengchao', browserStorage);
  assert.ok(queueStorage !== null);

  const failed = await serve(500, () => ({ detail: 'down' }));
  try {
    const first = createCreationLedgerOutbox(
      createCreationLedgerClient({ appendUrl: failed.url }),
      { storage: queueStorage },
    );
    first.enqueue(record('resend'));
    const outcome = await first.flush();
    assert.equal(outcome?.ok, false);
    assert.equal(first.size, 1, '失败不能出队');
    assert.equal(queueStorage.load()?.records.length, 1, '失败必须落进 localStorage');
  } finally {
    await failed.close();
  }

  // 「关页面」：第一个出队器与第一个 storage 适配器都不再使用；
  // 重新从同一份 localStorage 建一个新的，模拟下一次页面加载。
  const reopenedStorage = createLocalStorageLedgerQueue('dengchao', browserStorage);
  assert.ok(reopenedStorage !== null);

  const live = await serve(201, (parsed) => ({
    duplicate: false,
    record: { ...(parsed as CreationRecord), seq: 1, recordedAt: '2026-11-03T00:00:00.000Z' },
  }));
  try {
    const reopened = createCreationLedgerOutbox(
      createCreationLedgerClient({ appendUrl: live.url }),
      { storage: reopenedStorage },
    );
    assert.equal(reopened.size, 1, '重开时必须从 localStorage 读回那一条');
    const resent = await reopened.flush();
    assert.equal(resent?.ok, true);
    assert.equal(reopened.size, 0);
    assert.equal(reopenedStorage.load()?.records.length, 0);
    assert.equal(live.requests.length, 1, '只补发一次');
    assert.equal((live.requests[0] as CreationRecord).recordId, 'resend');
  } finally {
    await live.close();
  }
});
