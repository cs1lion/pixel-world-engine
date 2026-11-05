/**
 * 日摘要（SOAK-BUG-5）：
 *
 * 1. 每天关账压成**一条**摘要，字段是枚举与 id 列表，不是散文；
 * 2. 异常原句至多 3 条，指针至多 3 条——「摘要」不能变成换名的膨胀；
 * 3. 天龄超 30 天的摘要进远档：地点表与异常原句清空，事件表只留 id + kind；
 * 4. 条目被裁之后，`dayTimelineFor` 仍能从摘要补回当天的拍子；
 * 5. 读档能恢复摘要；删一条事件会把它从摘要里摘掉，不借着摘要复活。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DAY_MS } from '../src/world/memory/config.ts';
import { DIGEST_PROTECTED_DAYS, digestRank } from '../src/world/memory/digest.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { DayDigest, MemoryEvent } from '../src/world/memory/types.ts';

function makeRuntime(): { runtime: MemoryRuntime; events: MemoryEvent[] } {
  const events: MemoryEvent[] = [];
  const runtime = new MemoryRuntime({ onEvent: (event) => events.push(event) });
  for (const holderId of ['v0', 'v1']) {
    runtime.world.addHolder({
      holderId,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: 0, y: 0 },
    });
  }
  return { runtime, events };
}

function ingest(
  runtime: MemoryRuntime,
  eventId: string,
  at: number,
  kind: string,
  what: string,
  importanceHint: number,
): void {
  runtime.world.ingest({
    eventId,
    at,
    kind,
    place: { placeId: 'street', at: { x: 0, y: 0 }, indoor: false, placeType: 'street' },
    actors: ['v0'],
    outcome: { what },
    visibility: 'world',
    source: 'world',
    importanceHint,
    parentEventId: null,
    witnesses: ['v0', 'v1'],
  });
}

test('每天一条摘要：人是枚举 id，拍子是事件 id，异常原句至多 3 条', () => {
  const { runtime } = makeRuntime();
  const offset = DAY_MS / 2;
  ingest(runtime, 'ev_greet', offset, 'street_greet', '两人在街口照了面', 0.38);
  for (let index = 0; index < 4; index += 1) {
    ingest(runtime, `ev_quarrel_${index}`, offset + 1000 + index * 1000, 'conflict', `第${index}次争吵`, 0.7);
  }
  runtime.world.dayClosed(0, DAY_MS - 1);

  const digest = runtime.world.dayDigestOf(0);
  assert.notEqual(digest, null, '关账当天必须压出一条摘要');
  assert.deepEqual([...digest!.people], ['v0', 'v1'], '人是 id 列表');
  assert.equal(digest!.compact, false, '中档不压缩');
  assert.equal(digest!.events.length, 5, '五条事件各占一行');
  assert.deepEqual([...digest!.events.map(([eventId]) => eventId)], [
    'ev_greet',
    'ev_quarrel_0',
    'ev_quarrel_1',
    'ev_quarrel_2',
    'ev_quarrel_3',
  ]);
  assert.equal(digest!.firstEvent, 'ev_greet');
  assert.equal(digest!.lastEvent, 'ev_quarrel_3');
  assert.deepEqual([...digest!.places], ['street']);
  assert.ok(digest!.flags.includes('dispute'), '争执日要能被一眼扫出来');
  assert.ok(digest!.flags.includes('major'), '有大事的日子要带 major');
  assert.equal(digest!.anomalies.length, 3, '异常原句硬上限 3 条');

  const digests = runtime.world.dayDigests();
  assert.equal(digests.filter((item) => item.day === 0).length, 1, '同一天至多一条');
});

test('条目被裁之后，dayTimelineFor 从摘要补回当天的拍子', () => {
  const { runtime } = makeRuntime();
  const offset = DAY_MS / 2;
  for (let index = 0; index < 3; index += 1) {
    ingest(runtime, `ev_${index}`, offset + index, 'street_together', `第${index}次同行`, 0.38);
  }
  runtime.world.dayClosed(0, DAY_MS - 1);
  const rows = runtime.dayTimelineFor('v0', 0);
  assert.equal(rows.length, 3, '关账当天逐条时间轴仍在（近档）');

  // 模拟「旧日片段被裁掉」：条目清空，摘要留着。
  const snapshot = JSON.parse(runtime.toJSON()) as {
    world: { entries: unknown[] };
  };
  snapshot.world.entries = [];
  const restored = new MemoryRuntime();
  assert.equal(restored.fromJSON(JSON.stringify(snapshot)), true, '摘要段要能读档');
  const fromDigest = restored.dayTimelineFor('v0', 0);
  assert.equal(fromDigest.length, 3, '缺了几格就补几格');
  assert.ok(
    fromDigest.every((row) => row.memoryId.startsWith('d_0_')),
    '补回来的行要认得出是摘要行',
  );
});

test('天龄超 30 天进远档：地点与异常原句清空，事件只留 id + kind', () => {
  const { runtime } = makeRuntime();
  const offset = DAY_MS / 2;
  ingest(runtime, 'ev_fire', offset, 'fire', '仓房起了火', 0.8);
  ingest(runtime, 'ev_talk', offset + 100, 'street_greet', '两人照面', 0.38);
  runtime.world.dayClosed(0, DAY_MS - 1);

  assert.equal(runtime.world.dayDigestOf(0)!.compact, false);
  runtime.world.dayClosed(31, DAY_MS * 32 - 1);
  const compact = runtime.world.dayDigestOf(0)!;
  assert.equal(compact.compact, true, '31 天后转远档');
  assert.equal(compact.places.length, 0, '远档不留地点表');
  assert.equal(compact.anomalies.length, 0, '远档只回答有没有事，不留原句');
  assert.ok(
    compact.events.every(([, , placeIdx]) => placeIdx === -1),
    '远档事件表不带地点',
  );
  assert.deepEqual([...compact.events.map(([eventId]) => eventId)], ['ev_fire', 'ev_talk']);
  assert.equal(compact.flags.length > 0, true, '远档仍能回答「那天有没有事」');
});

test('删一条事件会把它从摘要里摘掉', () => {
  const { runtime } = makeRuntime();
  const offset = DAY_MS / 2;
  ingest(runtime, 'ev_a', offset, 'street_greet', '照面', 0.38);
  ingest(runtime, 'ev_b', offset + 100, 'street_together', '同行', 0.38);
  runtime.world.dayClosed(0, DAY_MS - 1);

  runtime.world.delete({ kind: 'event', id: 'ev_a' });
  const digest = runtime.world.dayDigestOf(0);
  assert.notEqual(digest, null);
  assert.deepEqual([...digest!.events.map(([eventId]) => eventId)], ['ev_b'], '删掉的拍子不能留着');
  assert.equal(digest!.firstEvent, 'ev_b', 'firstEvent 要重排');
});

function fakeDigest(day: number, flags: DayDigest['flags'] = []): DayDigest {
  return {
    day,
    people: ['v0'],
    firstEvent: `ev_${day}`,
    lastEvent: `ev_${day}`,
    places: ['street'],
    flags,
    events: [[`ev_${day}`, 'street_greet', 0]],
    beats: [[0]],
    extras: [],
    anomalies: [],
    pointers: [],
    compact: false,
  };
}

test('摘要超预算：开天前 30 天保底，中段普通日先削，异常日优先留', () => {
  const digests = Array.from({ length: 90 }, (_, day) => fakeDigest(day));
  const ranked = [...digests].sort(digestRank).slice(0, 60);
  const kept = new Set(ranked.map((digest) => digest.day));

  for (let day = 0; day < DIGEST_PROTECTED_DAYS; day += 1) {
    assert.equal(kept.has(day), true, `开天第 ${day} 天不能淘汰`);
  }
  assert.equal(kept.has(89), true, '同权重时留更近的日子');
  assert.equal(kept.has(45), false, '中段普通日先削');

  const withAnomaly = digests.map((digest) =>
    digest.day === 45
      ? fakeDigest(45, ['anomaly'])
      : digest,
  );
  const rankedAnomaly = [...withAnomaly].sort(digestRank).slice(0, 60);
  const keptAnomaly = new Set(rankedAnomaly.map((digest) => digest.day));
  assert.equal(keptAnomaly.has(45), true, '中段那一天出了异常，必须优先于普通近月日');
  assert.equal(keptAnomaly.has(89), true, '近月仍在保留端');
  assert.equal(keptAnomaly.has(60), false, '被它顶掉的是中段里最靠外的普通日');
});
