/**
 * 日卡读取层（纯读）。
 *
 * 这一层只做一件事：把已有的 `DayDigest` 读成「日历上每天一行」——
 * 有没有事 / 几个人 / 是不是争执日 / 大事是什么。**不压缩、不写回、
 * 不改存档结构**：`dayCard` 是视图对象，不是新的存储格式。
 *
 * 字段口径沿用离线实验（`docs/evidence/mem-clarity`）验过的那一套：
 * `d` 天、`e` 事件数、`p` 人数、`f` 旗子代码（`so+di`）、`s` 四字标签。
 * 一天 49–53 B 是对**存法**的读数；这里是纯读，内存里只有临时对象，
 * 进不了 `world.memory`。
 *
 * **周视图的硬边界：旗子按日保留。** 只允许合并计数与地点，
 * 不允许把「第 103 天吵过架」并进「那周很平静」。`weekViewOf` 返回前
 * 会跑 `assertWeekFlagsPreserved`——谁改成多数票合并，这里先红。
 */

import type { DayDigest, DayFlag } from './types.ts';

/** 离线实验的日卡字节区间。这里只用来给测试与审计对口径，不参与写入。 */
export const CARD_MIN_BYTES = 40;
export const CARD_MAX_BYTES = 60;

/** 旗子代码：与 `mem-clarity` 的 `FLAG_CODE` 同一口径，不另起一套。 */
export const FLAG_CODE: Readonly<Record<DayFlag, string>> = {
  quiet: 'qu',
  social: 'so',
  work: 'wo',
  dispute: 'di',
  anomaly: 'an',
  major: 'ma',
  other: 'ot',
};

/** 四字标签。`s` 只用这一张表，面板不另写文案。 */
export const LABEL_OF_FLAG: Readonly<Record<DayFlag, string>> = {
  quiet: '静了一天',
  social: '平常一天',
  work: '干活一天',
  dispute: '吵了一架',
  anomaly: '有点反常',
  major: '出了大事',
  other: '没什么',
};

/** 「大事」这一行的粗描述。远档没有原句时用它，不印「时刻不明」。 */
const COARSE_OF_FLAG: Readonly<Record<DayFlag, string>> = {
  quiet: '那天没什么人走动',
  social: '那天有人来往',
  work: '那天有人在干活',
  dispute: '那天有人争执',
  anomaly: '那天出了点反常的事',
  major: '那天有一件大事',
  other: '那天照常过着',
};

const FLAG_ORDER: readonly DayFlag[] = [
  'dispute',
  'anomaly',
  'major',
  'social',
  'work',
  'quiet',
  'other',
];

/** 哪几种旗子算「这一天不平静」。周视图与守卫共用这一张表。 */
export const TENSE_FLAGS: readonly DayFlag[] = ['dispute', 'anomaly', 'major'];
const TENSE_CODES: readonly string[] = TENSE_FLAGS.map((flag) => FLAG_CODE[flag]);

/** 一天的卡。字段名沿用离线实验，**不要重命名**。 */
export interface DayCard {
  readonly d: number;
  readonly e: number;
  readonly p: number;
  readonly f: string;
  readonly s: string;
}

/** 面板要读的视图：卡本身 + 当天旗子 + 一句粗描述。 */
export interface DayCardView extends DayCard {
  readonly flags: readonly DayFlag[];
  readonly disputed: boolean;
  readonly tense: boolean;
  /** 「那一天发生了什么」的粗描述。来源见 `whatSource`。 */
  readonly what: string;
  readonly whatSource: 'sentence' | 'pointer' | 'flag';
}

/** 从事件 id 取一句原话（`WorldFact.outcome.what`）。读不到返回 null。 */
export type FactSentence = (eventId: string) => string | null;

export interface WeekView {
  readonly fromDay: number;
  readonly toDay: number;
  /** 旗子按日保留：这一天有哪些代码，一天都不许并。 */
  readonly flagsByDay: Record<string, string[]>;
  readonly tenseDays: readonly number[];
  readonly calm: boolean;
  readonly summary: string;
}

export interface DayWeek {
  readonly fromDay: number;
  readonly toDay: number;
  readonly cards: readonly DayCardView[];
}

export interface CardAnswer {
  readonly hasEvents: boolean;
  readonly people: number;
  readonly dispute: boolean;
  readonly summary: string;
  readonly what: string;
}

function primaryFlag(flags: readonly DayFlag[]): DayFlag {
  for (const candidate of FLAG_ORDER) {
    if (flags.includes(candidate)) return candidate;
  }
  return 'other';
}

function describeDay(
  digest: DayDigest,
  whatOf?: FactSentence,
): { readonly text: string; readonly source: DayCardView['whatSource'] } {
  // 中档保留的异常原句是当事人的说法，优先用它——它比任何补写的句子都准。
  for (const sentence of digest.anomalies) {
    const text = sentence.trim();
    if (text !== '') return { text, source: 'sentence' };
  }
  // 远档清空了异常原句，但指针还在；指针能读回当天那件事的原话。
  for (const eventId of digest.pointers) {
    const text = whatOf?.(eventId)?.trim() ?? '';
    if (text !== '') return { text, source: 'pointer' };
  }
  return { text: COARSE_OF_FLAG[primaryFlag(digest.flags)], source: 'flag' };
}

/**
 * 把一条日摘要读成一天的卡。
 *
 * `whatOf` 只读事实层的一句原话；不传也能出卡（远档退到粗描述）。
 */
export function dayCardOf(digest: DayDigest, whatOf?: FactSentence): DayCardView {
  const codes = digest.flags.map((flag) => FLAG_CODE[flag] ?? 'ot');
  const primary = primaryFlag(digest.flags);
  const described = describeDay(digest, whatOf);
  const tense = digest.flags.some((flag) => TENSE_FLAGS.includes(flag));
  return {
    d: digest.day,
    e: digest.events.length,
    p: digest.people.length,
    f: codes.join('+'),
    s: LABEL_OF_FLAG[primary],
    flags: [...digest.flags],
    disputed: digest.flags.includes('dispute'),
    tense,
    what: described.text,
    whatSource: described.source,
  };
}

/** 按存档口径只取五个字段；视图上的附加字段不进这段 JSON。 */
export function dayCardText(card: DayCard): string {
  const record: DayCard = { d: card.d, e: card.e, p: card.p, f: card.f, s: card.s };
  return JSON.stringify(record);
}

export function dayCardBytes(card: DayCard): number {
  return new TextEncoder().encode(dayCardText(card)).length;
}

export function answerFromCard(card: DayCardView | DayCard): CardAnswer {
  const codes = card.f === '' ? [] : card.f.split('+');
  return {
    hasEvents: card.e > 0,
    people: card.p,
    dispute: codes.includes('di'),
    summary: card.s,
    what: 'what' in card ? card.what : card.s,
  };
}

/** 一天的行数：摘要的 `beats` 数组长度之和。 */
export function timelineRowsOf(digest: DayDigest | null): number {
  if (digest === null) return 0;
  return digest.beats.reduce((sum, beat) => sum + beat.length, 0);
}

/** 时间轴缺口 = 当天应有行数 − 摘要能还原的行数；负数按 0 算。 */
export function timelineMissingOf(
  digest: DayDigest | null,
  denominator: number,
): { readonly rows: number; readonly denominator: number; readonly missing: number } {
  const rows = timelineRowsOf(digest);
  return { rows, denominator, missing: Math.max(0, denominator - rows) };
}

/**
 * 周视图：只合并每日卡的计数与标签，旗子**原样按日**放回 `flagsByDay`。
 * `calm` 只有在整周没有争执/异常/大事日时才是 true。
 *
 * 返回前跑守卫：任何一天的 `di/an/ma` 丢了，直接抛——不允许静默合并。
 */
export function weekViewOf(cards: readonly DayCard[]): WeekView {
  if (cards.length === 0) throw new Error('周视图至少要有一张日卡');
  const days = cards.map((card) => card.d);
  const fromDay = Math.min(...days);
  const toDay = Math.max(...days);
  const flagsByDay: Record<string, string[]> = {};
  const tenseDays: number[] = [];
  for (const card of cards) {
    const codes = card.f === '' ? [] : card.f.split('+');
    flagsByDay[String(card.d)] = codes;
    if (codes.some((code) => TENSE_CODES.includes(code))) tenseDays.push(card.d);
  }
  const calm = tenseDays.length === 0;
  const view: WeekView = {
    fromDay,
    toDay,
    flagsByDay,
    tenseDays,
    calm,
    summary: calm
      ? `第 ${fromDay}–${toDay} 天这一周很平静`
      : `第 ${fromDay}–${toDay} 天这周不平静：第 ${tenseDays.join('、')} 天有事`,
  };
  assertWeekFlagsPreserved(cards, view);
  return view;
}

/**
 * 周视图守卫。**这是「多数票合并」的护栏**：
 * 只要有一天带 `di/an/ma`，它的代码必须原样出现在 `flagsByDay[day]`，
 * 那天必须在 `tenseDays`，整周不可能是 `calm`。
 *
 * 单独导出是为了让测试可以把一份「合并过的」假周视图递进来，看它红。
 */
export function assertWeekFlagsPreserved(
  cards: readonly DayCard[],
  view: WeekView,
): void {
  for (const card of cards) {
    const codes = card.f === '' ? [] : card.f.split('+');
    const stored = view.flagsByDay[String(card.d)] ?? [];
    for (const code of codes) {
      if (!stored.includes(code)) {
        throw new Error(`周视图把第 ${card.d} 天的 ${code} 旗子并掉了`);
      }
    }
    const tense = codes.some((code) => TENSE_CODES.includes(code));
    if (tense && !view.tenseDays.includes(card.d)) {
      throw new Error(`周视图把第 ${card.d} 天算成了平静日`);
    }
    if (tense && view.calm) {
      throw new Error(`第 ${card.d} 天有事，整周却写成平静`);
    }
  }
  if (view.calm && view.tenseDays.length > 0) {
    throw new Error('周视图写着平静，却留着有事的日子');
  }
}

/**
 * 反例：只按多数票合并旗子，会把「一天吵过架」读成安静的一周。
 * 保留它只给对照与守卫测试，**生产不用**。
 */
export function naiveMajorityIsCalm(cards: readonly DayCard[]): boolean {
  let social = 0;
  let tense = 0;
  for (const card of cards) {
    const codes = card.f === '' ? [] : card.f.split('+');
    if (codes.some((code) => TENSE_CODES.includes(code))) tense += 1;
    else social += 1;
  }
  return social > tense;
}

/** 按 7 天一块切周，返回按天升序的周列表；卡片不必齐全。 */
export function groupIntoWeeks(
  cards: readonly DayCardView[],
  weekSize = 7,
): readonly DayWeek[] {
  const buckets = new Map<number, DayCardView[]>();
  for (const card of cards) {
    const key = Math.floor(card.d / weekSize);
    const bucket = buckets.get(key) ?? [];
    bucket.push(card);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => {
      const days = bucket.map((card) => card.d);
      return {
        fromDay: Math.min(...days),
        toDay: Math.max(...days),
        cards: [...bucket].sort((a, b) => a.d - b.d),
      };
    })
    .sort((a, b) => a.fromDay - b.fromDay);
}
