/**
 * 日摘要（SOAK-BUG-5）。
 *
 * 90 天实跑的读数：条目层 `day` 桶每人 16 格，旧日片段被强度排序挤掉，
 * 回溯第 20 / 45 / 60 天的居民时间轴缺失 100% / 98.4% / 96.5%。日历还在，
 * 「那天怎么过的」没了。这一层在**每天关账时**把当天的时间轴压成一条
 * `DayDigest`，按浓度分三档：
 *
 * | 档 | 天龄 | 存什么 |
 * | --- | --- | --- |
 * | 近档 | 0–6 天 | 逐条时间轴（现成条目，本模块不参与） |
 * | 中档 | 7–30 天 | 全量摘要：人 / 地点 / 事件表 / 拍子 / 异常原句（≤3） |
 * | 远档 | >30 天 | 浓缩：地点表与异常原句清空，事件表只留 id + kind |
 *
 * **每天至多一条**，键是 `day`。三条硬边界：
 *
 * 1. 异常原句 ≤ `DIGEST_MAX_ANOMALIES`，指针 ≤ `DIGEST_MAX_POINTERS`——
 *    否则「摘要」只是换了个名字的膨胀。
 * 2. 字段只有枚举与 id 列表，不收自由文本；唯一放句子的是异常原句。
 * 3. 压掉的是句子和地点细节，**不是拍子**：`beats` 保留「谁记下了哪一拍」，
 *    这是回溯分母（当天的条目数）能对上的唯一依据。
 *
 * 预算见 `config.libraryBudget.digests`：条数 120、字节 160 KB。90 天实测
 * 约 1.1–1.6 KB/天（远档更小），整段落在 160 KB 以内。
 */

import type { DayDigest, DayFlag, MemoryEntry, WorldFact } from './types.ts';

/** 超过这个天龄的摘要进「远档」，压缩掉地点表与异常原句。 */
export const DIGEST_FULL_DAYS = 30;
/** 每天最多留几条异常原句。 */
export const DIGEST_MAX_ANOMALIES = 3;
/** 每天最多留几个「重要事件」指针。 */
export const DIGEST_MAX_POINTERS = 3;
/** `importanceHint` 到这条线算「大事」。与 `T_promote` 无关，别把两件事混了。 */
const MAJOR_IMPORTANCE = 0.6;

const DISPUTE_KINDS = /(conflict|quarrel|argue|fight|dispute|scold|clash)/i;
const ANOMALY_KINDS = /(accident|fire|collapse|crash|flood|theft|steal|injur|damage|demolish)/i;
const WORK_KINDS = /(work|market|craft|harvest|build|trade|forge)/i;
const SOCIAL_KINDS = /(greet|talk|chat|meet|together|yield|visit|gather|encounter)/i;

/**
 * 把一天（关账后的条目视图）压成一条摘要。当天一条条目都没有时返回 `null`——
 * 「没有这一天」比「空摘要」诚实。
 *
 * 传进来的 `entries` 应当是**整理之后、预算裁剪之前**的全库；此时当天的片段
 * 还没被 `enforceBudgets` 挤掉，压出来的拍子数才对得上当天应有的条数。
 */
export function buildDayDigest(
  day: number,
  entries: readonly MemoryEntry[],
  facts: ReadonlyMap<string, WorldFact>,
): DayDigest | null {
  const todays = entries.filter((entry) => entry.createdDay === day);
  if (todays.length === 0) return null;

  const people = [...new Set(todays.map((entry) => entry.holderId))].sort(compareId);
  const holderIndex = new Map(people.map((holderId, index) => [holderId, index]));

  const eventTicks = new Map<string, number>();
  const eventKinds = new Map<string, string>();
  const eventPlaces = new Map<string, string>();
  const beatsByEvent = new Map<string, number[]>();
  const extras = people.map(() => 0);

  for (const entry of todays) {
    const holderIdx = holderIndex.get(entry.holderId);
    if (holderIdx === undefined) continue;
    if (entry.kind !== 'episodic') {
      extras[holderIdx] = (extras[holderIdx] ?? 0) + 1;
      continue;
    }
    const eventId = entry.eventRefs[0];
    if (eventId === undefined) continue;
    if (!eventKinds.has(eventId)) {
      const fact = facts.get(eventId);
      eventKinds.set(eventId, fact?.kind ?? 'unknown');
      eventPlaces.set(eventId, fact?.placeId ?? entry.content.where);
      eventTicks.set(eventId, fact?.tick ?? 0);
    }
    const bucket = beatsByEvent.get(eventId) ?? [];
    bucket.push(holderIdx);
    beatsByEvent.set(eventId, bucket);
  }

  const ordered = [...eventKinds.keys()].sort((a, b) => {
    const diff = (eventTicks.get(a) ?? 0) - (eventTicks.get(b) ?? 0);
    return diff === 0 ? compareId(a, b) : diff;
  });

  const places = [...new Set(ordered.map((eventId) => eventPlaces.get(eventId) ?? ''))].filter(
    (placeId) => placeId !== '',
  ).sort(compareId);
  const placeIndex = new Map(places.map((placeId, index) => [placeId, index]));

  const kinds = ordered.map((eventId) => eventKinds.get(eventId) ?? 'unknown');
  const flags = flagsOf(kinds, ordered, facts);
  const anomalies = anomaliesOf(ordered, kinds, facts);
  const pointers = ordered
    .filter((eventId) => (facts.get(eventId)?.importanceHint ?? 0) >= MAJOR_IMPORTANCE)
    .slice(0, DIGEST_MAX_POINTERS);

  return {
    day,
    people,
    firstEvent: ordered[0] ?? null,
    lastEvent: ordered[ordered.length - 1] ?? null,
    places,
    flags,
    events: ordered.map((eventId, index) => [
      eventId,
      kinds[index] ?? 'unknown',
      placeIndex.get(eventPlaces.get(eventId) ?? '') ?? -1,
    ] as const),
    beats: ordered.map((eventId) => [...(beatsByEvent.get(eventId) ?? [])]),
    extras,
    anomalies,
    pointers,
    compact: false,
  };
}

/** 远档：清空地点表与异常原句，事件表的地点下标一律 `-1`。幂等。 */
export function compactDayDigest(digest: DayDigest): DayDigest {
  if (digest.compact) return digest;
  return {
    ...digest,
    places: [],
    events: digest.events.map(([eventId, kind]) => [eventId, kind, -1] as const),
    anomalies: [],
    compact: true,
  };
}

/** 这一档该不该压缩。`closedDay` 是刚关账的那一天。 */
export function shouldCompact(digest: DayDigest, closedDay: number): boolean {
  return !digest.compact && closedDay - digest.day > DIGEST_FULL_DAYS;
}

/**
 * 某个人在某天的压后时间轴。**只读摘要，不读条目**。
 *
 * 行数与当天条目数对得上：`beats` 里的重复下标各算一行，`extras` 里的摘要
 * 各算一行。`placeId` 只在全量档给得出（远档返回 `null`，面板照旧写「地点不明」）。
 */
export function digestTimelineOf(
  digest: DayDigest,
  holderId: string,
): readonly { readonly eventId: string; readonly kind: string; readonly placeId: string | null }[] {
  const holderIdx = digest.people.indexOf(holderId);
  if (holderIdx < 0) return [];
  const rows: { eventId: string; kind: string; placeId: string | null }[] = [];
  digest.events.forEach(([eventId, kind, placeIdx], index) => {
    const beats = digest.beats[index] ?? [];
    for (const beat of beats) {
      if (beat !== holderIdx) continue;
      rows.push({
        eventId,
        kind,
        placeId: placeIdx >= 0 ? digest.places[placeIdx] ?? null : null,
      });
    }
  });
  const extras = digest.extras[holderIdx] ?? 0;
  for (let i = 0; i < extras; i += 1) {
    rows.push({ eventId: `m_sum_${holderId}_${digest.day}`, kind: 'summary', placeId: null });
  }
  return rows;
}

/**
 * 删一条事件时把它从摘要里摘掉。删掉的事件不该借着摘要复活。
 *
 * 摘空（事件与附加条目都不剩）时返回 `null`，调用方把这一条也丢掉。
 */
export function stripDigestEvent(digest: DayDigest, eventId: string): DayDigest | null {
  const index = digest.events.findIndex(([id]) => id === eventId);
  if (index < 0) return digest;
  const events = digest.events.filter((_, i) => i !== index);
  const beats = digest.beats.filter((_, i) => i !== index);
  const pointers = digest.pointers.filter((id) => id !== eventId);
  if (events.length === 0 && digest.extras.every((count) => count === 0)) return null;
  return {
    ...digest,
    events,
    beats,
    pointers,
    firstEvent: digest.firstEvent === eventId ? (events[0]?.[0] ?? null) : digest.firstEvent,
    lastEvent: digest.lastEvent === eventId ? (events[events.length - 1]?.[0] ?? null) : digest.lastEvent,
  };
}

function flagsOf(
  kinds: readonly string[],
  ordered: readonly string[],
  facts: ReadonlyMap<string, WorldFact>,
): DayFlag[] {
  const flags = new Set<DayFlag>();
  if (kinds.length === 0) flags.add('quiet');
  for (const kind of kinds) {
    if (DISPUTE_KINDS.test(kind)) flags.add('dispute');
    if (ANOMALY_KINDS.test(kind)) flags.add('anomaly');
    if (WORK_KINDS.test(kind)) flags.add('work');
    if (SOCIAL_KINDS.test(kind)) flags.add('social');
  }
  if (ordered.some((eventId) => (facts.get(eventId)?.importanceHint ?? 0) >= MAJOR_IMPORTANCE)) {
    flags.add('major');
  }
  if (kinds.length > 0 && flags.size === 0) flags.add('other');
  return [...flags].sort(compareId) as DayFlag[];
}

/** 异常原句：只从「争执 / 异常 / 大事」里挑，最多 3 条，去重。 */
function anomaliesOf(
  ordered: readonly string[],
  kinds: readonly string[],
  facts: ReadonlyMap<string, WorldFact>,
): string[] {
  const sentences: string[] = [];
  ordered.forEach((eventId, index) => {
    if (sentences.length >= DIGEST_MAX_ANOMALIES) return;
    const kind = kinds[index] ?? '';
    const important = (facts.get(eventId)?.importanceHint ?? 0) >= MAJOR_IMPORTANCE;
    if (!important && !DISPUTE_KINDS.test(kind) && !ANOMALY_KINDS.test(kind)) return;
    const what = String((facts.get(eventId)?.outcome as { what?: unknown } | undefined)?.what ?? '');
    if (what === '' || sentences.includes(what)) return;
    sentences.push(what);
  });
  return sentences;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
