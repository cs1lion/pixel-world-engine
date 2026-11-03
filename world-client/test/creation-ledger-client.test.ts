/** 账本 HTTP 运输与出队器：失败留在队里，成功才出队，同一条复用同一个 id。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
import { AutonomousFuseController } from '../src/world/creator/fuse.ts';

function record(id = 'dengchao:ledger-client#1'): CreationRecord {
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

test('append 走 POST，响应形状对得上', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = JSON.parse(String(init?.body)) as CreationRecord;
    return new Response(
      JSON.stringify({
        duplicate: false,
        record: { ...body, seq: 1, recordedAt: '2026-11-03T00:00:00.000Z' },
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    );
  };
  const client = createCreationLedgerClient({ fetchImpl: fetchImpl as typeof fetch });
  const result = await client.append(record());
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('append 应成功');
  assert.equal(result.record.seq, 1);
  assert.equal(result.duplicate, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/creation-ledger/entries');
  assert.equal(calls[0]?.init?.method, 'POST');
});

test('append 遇到 500 返回 ok:false，不抛', async () => {
  const client = createCreationLedgerClient({
    fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
  });
  const result = await client.append(record());
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('不该成功');
  assert.equal(result.status, 500);
  assert.match(result.reason, /500/);
});

test('出队器：失败留在队里，下一次成功才出队', async () => {
  let attempt = 0;
  const client = createCreationLedgerClient({
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) return new Response('down', { status: 503 });
      const body = JSON.parse(String(init?.body)) as CreationRecord;
      return new Response(
        JSON.stringify({
          duplicate: false,
          record: { ...body, seq: 1, recordedAt: '2026-11-03T00:00:00.000Z' },
        }),
        { status: 201 },
      );
    }) as typeof fetch,
  });
  const outbox = createCreationLedgerOutbox(client);
  outbox.enqueue(record());
  assert.equal(outbox.size, 1);

  const first = await outbox.flush();
  assert.equal(first?.ok, false);
  assert.equal(outbox.size, 1, '失败不能出队');

  const second = await outbox.flush();
  assert.equal(second?.ok, true);
  assert.equal(outbox.size, 0, '成功才出队');
});

test('出队器同一时刻只放一条在途', async () => {
  let release: () => void = () => {};
  const client = createCreationLedgerClient({
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      const body = JSON.parse(String(init?.body)) as CreationRecord;
      return new Response(
        JSON.stringify({
          duplicate: false,
          record: { ...body, seq: 1, recordedAt: '2026-11-03T00:00:00.000Z' },
        }),
        { status: 201 },
      );
    }) as typeof fetch,
  });
  const outbox = createCreationLedgerOutbox(client);
  outbox.enqueue(record('a'));
  outbox.enqueue(record('b'));
  const inFlight = outbox.flush();
  assert.equal(await outbox.flush(), null, '第二条不该在第一条回来前发出');
  release();
  await inFlight;
  assert.equal(outbox.size, 1);
});

test('list 按世界日/模板/拒绝原因拼查询串，并把原始记录折成每件造物一条', async () => {
  const urls: string[] = [];
  const body = record();
  const stored = { ...body, seq: 1, recordedAt: '2026-11-03T00:00:00.000Z' };
  const client = createCreationLedgerClient({
    fetchImpl: (async (url: string) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({ entries: [stored], count: 1, bytes: 1234 }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  const result = await client.list({
    worldId: 'dengchao',
    day: 3,
    template: 'waiting_shelter',
    reject: 'coverage',
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('list 应成功');
  assert.equal(result.page.count, 1);
  assert.equal(result.page.bytes, 1234);
  assert.equal(result.page.folded.length, 1);
  assert.equal(result.page.folded[0]?.creation.recordId, stored.recordId);
  const url = urls[0] ?? '';
  assert.match(url, /worldId=dengchao/);
  assert.match(url, /day=3/);
  assert.match(url, /template=waiting_shelter/);
  assert.match(url, /reject=coverage/);
});
