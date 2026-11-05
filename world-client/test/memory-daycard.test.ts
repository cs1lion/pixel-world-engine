/**
 * 日历读取层：日卡 / 周视图 / 纯读。
 *
 * 这一组只验读，不验写。四条硬判据：
 * 1. 第 89 天 `timelineMissing` 仍为 0（读取层不许让回溯回退）；
 * 2. 抽查 10 天（90 天以后）答「有没有事 / 几个人 / 争执日」10/10 对；
 * 3. 第 103 天显示「吵了一架」，多数票合并会被守卫拦下；
 * 4. 建卡前后 `world.memory` 逐字节相同。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  assertWeekFlagsPreserved,
  answerFromCard,
  dayCardBytes,
  dayCardOf,
  dayCardText,
  groupIntoWeeks,
  naiveMajorityIsCalm,
  timelineMissingOf,
  timelineRowsOf,
  weekViewOf,
  type DayCardView,
  type FactSentence,
} from '../src/world/memory/daycard.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { DayDigest } from '../src/world/memory/types.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const REAL_SAVE = join(ROOT, 'docs', 'evidence', 'soak', 'soak-a', 'save-90d.json');
const SYNTHETIC = join(ROOT, 'docs', 'evidence', 'mem-daycard', 'input', 'synthetic-120d.json');
const SAMPLE_DAYS = [92, 96, 100, 103, 106, 109, 112, 115, 118, 120];

type JsonRecord = Record<string, unknown>;

function realMemoryText(): string {
  const save = JSON.parse(readFileSync(REAL_SAVE, 'utf8')) as JsonRecord;
  const world = save.world as JsonRecord;
  return String(world.memory ?? '');
}

function realState(): JsonRecord {
  const memory = JSON.parse(realMemoryText()) as JsonRecord;
  return memory.world as JsonRecord;
}

function syntheticPayload(): {
  readonly digests: readonly DayDigest[];
  readonly truth: readonly JsonRecord[];
  readonly whatOf: FactSentence;
} {
  const payload = JSON.parse(readFileSync(SYNTHETIC, 'utf8')) as JsonRecord;
  const digests = (payload.digest as JsonRecord[]).map((digest) => digest as unknown as DayDigest);
  const truth = payload.truth as JsonRecord[];
  const what = new Map<string, string>();
  for (const fact of payload.facts as JsonRecord[]) {
    const eventId = String(fact.eventId ?? '');
    const outcome = fact.outcome as JsonRecord | undefined;
    const text = typeof outcome?.what === 'string' ? outcome.what : '';
    if (eventId !== '' && text !== '') what.set(eventId, text);
  }
  return {
    digests,
    truth,
    whatOf: (eventId) => what.get(eventId) ?? null,
  };
}

function cardOfDay(digests: readonly DayDigest[], day: number, whatOf?: FactSentence): DayCardView {
  const digest = digests.find((item) => item.day === day);
  assert.notEqual(digest, undefined, `没有第 ${day} 天的日摘要`);
  return dayCardOf(digest as DayDigest, whatOf);
}

test('第 89 天 timelineMissing 仍为 0：摘要能还原当天 68 行', () => {
  const state = realState();
  const digests = state.digests as DayDigest[];
  const entries = state.entries as JsonRecord[];
  const day89 = digests.find((digest) => digest.day === 89) ?? null;
  const denominator = entries.filter((entry) => entry.createdDay === 89).length;
  const coverage = timelineMissingOf(day89, denominator);

  assert.equal(denominator, 68, '第 89 天关账时应有 68 条条目');
  assert.equal(coverage.rows, 68, '摘要的拍子要能还原 68 行');
  assert.equal(coverage.missing, 0, '读取层不许让回溯回退');

  // 运行时那扇门读出来的也是同一条摘要。
  const runtime = new MemoryRuntime({});
  assert.equal(runtime.fromJSON(realMemoryText()), true);
  const fromRuntime = runtime.world.dayDigestOf(89);
  assert.notEqual(fromRuntime, null);
  assert.equal(timelineRowsOf(fromRuntime), 68);
});

test('抽查 10 天：有没有事 / 几个人 / 争执日 10/10 对，并留下依据', () => {
  const { digests, truth, whatOf } = syntheticPayload();
  const failures: string[] = [];
  for (const day of SAMPLE_DAYS) {
    const expected = truth.find((item) => item.day === day);
    if (expected === undefined) throw new Error(`合成输入没有第 ${day} 天的真值`);
    const card = cardOfDay(digests, day, whatOf);
    const answer = answerFromCard(card);
    const evidence = {
      day,
      digestEvents: card.e,
      digestPeople: card.p,
      digestFlags: card.flags,
      digestAnomalies: digests.find((item) => item.day === day)?.anomalies ?? [],
      whatSource: card.whatSource,
      what: card.what,
      card: dayCardText(card),
    };
    const ok =
      answer.hasEvents === (Number(expected.events) > 0) &&
      answer.people === Number(expected.people) &&
      answer.dispute === Boolean(expected.dispute);
    if (!ok) failures.push(`${day}: ${JSON.stringify({ answer, expected, evidence })}`);
  }
  assert.deepEqual(failures, [], `10 天里有答错的：\n${failures.join('\n')}`);

  // 第 103 天必须是一眼能读出来的争执日。
  const day103 = cardOfDay(digests, 103, whatOf);
  assert.equal(day103.d, 103);
  assert.equal(day103.s, '吵了一架', '第 103 天要显示「吵了一架」');
  assert.equal(day103.disputed, true);
  assert.ok(day103.f.split('+').includes('di'), `旗子代码应含 di：${day103.f}`);
  assert.ok(day103.what.includes('争执'), `大事要说清是争执：${day103.what}`);
});

test('日卡字段与字节区间沿用离线实验口径', () => {
  const { digests, whatOf } = syntheticPayload();
  const day103 = cardOfDay(digests, 103, whatOf);
  assert.deepEqual(
    { d: day103.d, e: day103.e, p: day103.p, f: day103.f, s: day103.s },
    { d: 103, e: day103.e, p: day103.p, f: 'so+di', s: '吵了一架' },
  );
  const text = dayCardText(day103);
  assert.equal(
    text,
    `{"d":103,"e":${day103.e},"p":${day103.p},"f":"so+di","s":"吵了一架"}`,
    '字段名与顺序沿用已验过的那一套',
  );
  assert.ok(dayCardBytes(day103) >= 40 && dayCardBytes(day103) <= 60, `字节数 ${dayCardBytes(day103)}`);
});

test('周 103–109：旗子按日保留；多数票会误判为平静', () => {
  const { digests, whatOf } = syntheticPayload();
  const weekCards = digests
    .filter((digest) => digest.day >= 103 && digest.day <= 109)
    .map((digest) => dayCardOf(digest, whatOf));
  const view = weekViewOf(weekCards);

  assert.equal(view.calm, false, '第 103 天有事，整周不能是平静');
  assert.deepEqual([...view.tenseDays], [103]);
  assert.ok(view.flagsByDay['103']?.includes('di'), '第 103 天的 di 旗子必须原样留着');
  assert.ok(view.summary.includes('103'), `周摘要要点名第 103 天：${view.summary}`);

  // 反例：按多数票合并，一周里 6 天安静、1 天吵架 → 它会说「平静」。
  assert.equal(naiveMajorityIsCalm(weekCards), true, '这就是被守卫拦下的那种合并');
});

test('守卫会把「合并过的周视图」拦红', () => {
  const { digests, whatOf } = syntheticPayload();
  const weekCards = digests
    .filter((digest) => digest.day >= 103 && digest.day <= 109)
    .map((digest) => dayCardOf(digest, whatOf));

  // 假视图一：把第 103 天的旗子并成 social-only，整周写平静。
  const forgedFlags = weekViewOf(weekCards);
  forgedFlags.flagsByDay['103'] = ['so'];
  assert.throws(
    () => assertWeekFlagsPreserved(weekCards, { ...forgedFlags, calm: true, tenseDays: [] }),
    /第 103 天的 di 旗子并掉了|第 103 天有事/,
  );

  // 假视图二：旗子留着，但把 `tenseDays` 清空、`calm` 写 true。
  assert.throws(
    () => assertWeekFlagsPreserved(weekCards, { ...forgedFlags, calm: true, tenseDays: [] }),
    /第 103 天/,
  );
});

test('纯读：建卡前后 world.memory 逐字节相同', () => {
  const memoryText = realMemoryText();
  const runtime = new MemoryRuntime({});
  assert.equal(runtime.fromJSON(memoryText), true);

  const before = runtime.toJSON();
  const day89Before = JSON.stringify(runtime.world.dayDigestOf(89));

  const cards = runtime.world
    .dayDigests()
    .map((digest) =>
      dayCardOf(digest, (eventId) => runtime.world.factDigest(eventId)?.what ?? null),
    );
  for (const week of groupIntoWeeks(cards)) weekViewOf(week.cards);
  for (const card of cards) answerFromCard(card);

  const after = runtime.toJSON();
  assert.equal(after, before, '建卡不许改 world.memory 的任何一个字节');
  assert.equal(
    JSON.stringify(runtime.world.dayDigestOf(89)),
    day89Before,
    '第 89 天的摘要要原样留着',
  );
  assert.equal(cards.length, runtime.world.dayDigests().length);
});
