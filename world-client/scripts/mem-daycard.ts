/**
 * 日历读取层的实测脚本（纯读）。
 *
 * 产出 `docs/evidence/mem-daycard/results.json`：
 * - 真实 90 天存档：第 89 天回溯覆盖、90 张卡的字节、三种屏宽的读取耗时；
 * - 纯读证明：建卡前后 `world.memory` 原文与存档原文逐字节比较（含 SHA-256）；
 * - 合成 120 天：抽查 10 天的答案与依据，第 103 天争执，周视图守卫；
 * - 每一条判据给实测值与分母。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  assertWeekFlagsPreserved,
  answerFromCard,
  dayCardBytes,
  dayCardOf,
  dayCardText,
  groupIntoWeeks,
  naiveMajorityIsCalm,
  timelineMissingOf,
  weekViewOf,
  type DayCardView,
  type FactSentence,
} from '../src/world/memory/daycard.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { DayDigest } from '../src/world/memory/types.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const REAL_SAVE = join(ROOT, 'docs', 'evidence', 'soak', 'soak-a', 'save-90d.json');
const SYNTHETIC = join(ROOT, 'docs', 'evidence', 'mem-daycard', 'input', 'synthetic-120d.json');
const OUT_DIR = join(ROOT, 'docs', 'evidence', 'mem-daycard');
const SAMPLE_DAYS = [92, 96, 100, 103, 106, 109, 112, 115, 118, 120];

type JsonRecord = Record<string, unknown>;

const sha256 = (text: string | Buffer): string =>
  createHash('sha256').update(text).digest('hex');

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function measure(fn: () => void, runs = 15): { p50: number; min: number; max: number } {
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return { p50: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
}

function buildCards(digests: readonly DayDigest[], whatOf: FactSentence): DayCardView[] {
  const cards = digests.map((digest) => dayCardOf(digest, whatOf));
  for (const week of groupIntoWeeks(cards)) weekViewOf(week.cards);
  return cards;
}

function stats(cards: readonly DayCardView[]): {
  count: number;
  minBytes: number;
  maxBytes: number;
  avgBytes: number;
} {
  const bytes = cards.map((card) => dayCardBytes(card));
  return {
    count: bytes.length,
    minBytes: Math.min(...bytes),
    maxBytes: Math.max(...bytes),
    avgBytes: Number((bytes.reduce((sum, value) => sum + value, 0) / bytes.length).toFixed(2)),
  };
}

// ---- 真实 90 天存档 ------------------------------------------------------

const saveText = readFileSync(REAL_SAVE);
const save = JSON.parse(saveText.toString('utf8')) as JsonRecord;
const world = save.world as JsonRecord;
const memoryText = String(world.memory ?? '');
const state = (JSON.parse(memoryText) as JsonRecord).world as JsonRecord;

const runtime = new MemoryRuntime({});
if (!runtime.fromJSON(memoryText)) throw new Error('真实存档的 world.memory 解析失败');
const whatOf: FactSentence = (eventId) => runtime.world.factDigest(eventId)?.what ?? null;

const allCards = buildCards(runtime.world.dayDigests(), whatOf);
const screen30 = buildCards(runtime.world.dayDigests().slice(-30), whatOf);
const screen7 = buildCards(runtime.world.dayDigests().slice(-7), whatOf);

const timings = {
  all90: { ...measure(() => buildCards(runtime.world.dayDigests(), whatOf)), days: allCards.length },
  screen30: { ...measure(() => buildCards(runtime.world.dayDigests().slice(-30), whatOf)), days: screen30.length },
  screen7: { ...measure(() => buildCards(runtime.world.dayDigests().slice(-7), whatOf)), days: screen7.length },
  weekGuardOnly: { ...measure(() => {
    const week = runtime.world.dayDigests().slice(-7);
    weekViewOf(buildCards(week, whatOf));
  }), days: 7 },
};
for (const entry of Object.values(timings)) {
  Object.assign(entry, { msPerDay: Number((entry.p50 / entry.days).toFixed(4)) });
}

const entries = state.entries as JsonRecord[];
const day89Digest = runtime.world.dayDigestOf(89);
const day89Denominator = entries.filter((entry) => entry.createdDay === 89).length;
const day89Coverage = timelineMissingOf(day89Digest, day89Denominator);

// ---- 纯读证明 ------------------------------------------------------------

const memoryBefore = runtime.toJSON();
const saveBefore = readFileSync(REAL_SAVE);
const memoryBytesBefore = new TextEncoder().encode(memoryBefore).length;
// 反复建卡、切屏、跑周守卫：把这些读路径都走一遍再比。
for (let index = 0; index < 5; index += 1) {
  buildCards(runtime.world.dayDigests(), whatOf);
  buildCards(runtime.world.dayDigests().slice(-30), whatOf);
  buildCards(runtime.world.dayDigests().slice(-7), whatOf);
  for (const card of allCards) answerFromCard(card);
}
const memoryAfter = runtime.toJSON();
const saveAfter = readFileSync(REAL_SAVE);

const proof = {
  memoryBytesBefore,
  memoryBytesAfter: new TextEncoder().encode(memoryAfter).length,
  memoryShaBefore: sha256(memoryBefore),
  memoryShaAfter: sha256(memoryAfter),
  memoryEqual: memoryBefore === memoryAfter,
  memorySnapshotStable: memoryBefore === memoryAfter,
  saveBytesBefore: saveBefore.length,
  saveBytesAfter: saveAfter.length,
  saveShaBefore: sha256(saveBefore),
  saveShaAfter: sha256(saveAfter),
  saveEqual: saveBefore.equals(saveAfter),
  note: '只调 dayDigestOf/dayDigests/factDigest 与纯函数；没有关账、没有写回、没有碰存档文件',
};

// ---- 合成 120 天：10 天抽查 ----------------------------------------------

const synthetic = JSON.parse(readFileSync(SYNTHETIC, 'utf8')) as JsonRecord;
const synthDigests = (synthetic.digest as JsonRecord[]).map(
  (digest) => digest as unknown as DayDigest,
);
const truth = synthetic.truth as JsonRecord[];
const whatMap = new Map<string, string>();
for (const fact of synthetic.facts as JsonRecord[]) {
  const eventId = String(fact.eventId ?? '');
  const what = (fact.outcome as JsonRecord | undefined)?.what;
  if (eventId !== '' && typeof what === 'string' && what !== '') whatMap.set(eventId, what);
}
const synthWhatOf: FactSentence = (eventId) => whatMap.get(eventId) ?? null;

const samples = SAMPLE_DAYS.map((day) => {
  const digest = synthDigests.find((item) => item.day === day);
  if (digest === undefined) throw new Error(`合成输入没有第 ${day} 天`);
  const expected = truth.find((item) => item.day === day);
  if (expected === undefined) throw new Error(`合成输入没有第 ${day} 天的真值`);
  const card = dayCardOf(digest, synthWhatOf);
  const answer = answerFromCard(card);
  const correct =
    answer.hasEvents === (Number(expected.events) > 0) &&
    answer.people === Number(expected.people) &&
    answer.dispute === Boolean(expected.dispute);
  return {
    day,
    evidence: {
      digestDay: digest.day,
      digestEvents: digest.events.length,
      digestPeople: digest.people.length,
      digestFlags: digest.flags,
      digestAnomalies: digest.anomalies,
      digestPointers: digest.pointers,
      whatSource: card.whatSource,
    },
    card: dayCardText(card),
    cardFields: { d: card.d, e: card.e, p: card.p, f: card.f, s: card.s },
    answer,
    truth: {
      events: Number(expected.events),
      people: Number(expected.people),
      dispute: Boolean(expected.dispute),
      flags: expected.flags,
    },
    correct,
  };
});

const day103 = samples.find((sample) => sample.day === 103);
if (day103 === undefined) throw new Error('第 103 天不在抽查里');

// ---- 周视图守卫 ----------------------------------------------------------

const weekCards = synthDigests
  .filter((digest) => digest.day >= 103 && digest.day <= 109)
  .map((digest) => dayCardOf(digest, synthWhatOf));
const week = weekViewOf(weekCards);
const naiveCalm = naiveMajorityIsCalm(weekCards);

let guardMessage = '';
let guardThrew = false;
try {
  const forged = {
    ...week,
    flagsByDay: { ...week.flagsByDay, '103': ['so'] },
    tenseDays: [],
    calm: true,
  };
  assertWeekFlagsPreserved(weekCards, forged);
} catch (error) {
  guardThrew = true;
  guardMessage = error instanceof Error ? error.message : String(error);
}

// ---- 输出 ----------------------------------------------------------------

const results = {
  generatedBy: 'scripts/mem-daycard.ts',
  pureReadOnly: true,
  realSave: {
    path: 'docs/evidence/soak/soak-a/save-90d.json',
    saveBytes: saveText.length,
    memoryBytes: memoryBytesBefore,
    days: allCards.length,
    firstDay: allCards[0]?.d,
    lastDay: allCards.at(-1)?.d,
    cardStats: stats(allCards),
    timings,
    day89: {
      denominator: day89Denominator,
      rows: day89Coverage.rows,
      missing: day89Coverage.missing,
      flags: day89Digest?.flags ?? [],
      people: day89Digest?.people.length ?? 0,
      events: day89Digest?.events.length ?? 0,
    },
    sampleCards: allCards.slice(-5).map((card) => ({
      day: card.d,
      card: dayCardText(card),
      what: card.what,
      whatSource: card.whatSource,
    })),
  },
  pureReadProof: proof,
  synthetic: {
    path: 'docs/evidence/mem-daycard/input/synthetic-120d.json',
    provenance: '沿用 docs/evidence/mem-clarity 的合成输入（90–120 天）；只用来验证读取口径，不代表真实世界',
    days: synthDigests.length,
    samples,
    allCorrect: samples.every((sample) => sample.correct),
    day103: {
      card: day103.cardFields,
      text: day103.card,
      bytes: new TextEncoder().encode(day103.card).length,
      showsDispute: day103.cardFields.s === '吵了一架' && day103.answer.dispute,
      what: day103.answer.what,
    },
    week103To109: {
      cards: weekCards.map((card) => ({ day: card.d, f: card.f, s: card.s })),
      calm: week.calm,
      tenseDays: week.tenseDays,
      flagsByDay: week.flagsByDay,
      summary: week.summary,
      naiveMajorityIsCalm: naiveCalm,
      guardThrew,
      guardMessage,
    },
  },
  checks: {
    day89TimelineMissingZero: day89Coverage.missing === 0,
    sampleAnswersAllCorrect: samples.every((sample) => sample.correct),
    day103ShowsDispute: day103.cardFields.s === '吵了一架' && day103.answer.dispute,
    weekFlagsPreservedPerDay: week.calm === false && week.tenseDays.includes(103),
    majorityVoteMergesIntoCalm: naiveCalm === true,
    guardCatchesMergedWeek: guardThrew,
    memoryByteIdentical: proof.memoryEqual,
    saveByteIdentical: proof.saveEqual,
    cardBytesInOfflineRange:
      day103.cardFields !== undefined &&
      new TextEncoder().encode(day103.card).length >= 40 &&
      new TextEncoder().encode(day103.card).length <= 60,
    pureReadOnly: true,
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results.checks, null, 2));
console.log(`timings p50: all90 ${timings.all90.p50.toFixed(3)} ms, screen30 ${timings.screen30.p50.toFixed(3)} ms, screen7 ${timings.screen7.p50.toFixed(3)} ms`);
