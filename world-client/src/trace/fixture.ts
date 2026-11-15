/** 预制夹具（`pwe-fixture/1`）：一条真实轨迹 + 一组可读断言。
 *
 * 夹具不是「另一个存档格式」：`trace` 字段就是 `pwe-trace/2` 文件，
 * 回放走的是同一个 `TraceRuntime` / `runTraceWithRuntime`。这里只多写三样：
 *
 *   1. `purpose` / `covers` / `doesNotCover`：这条夹具到底能证明什么、明确
 *      证明不了什么（比「跑绿了」重要）；
 *   2. `expectedMs`：单条回放的耗时预算（验收要求 3 秒内）；
 *   3. `assertions`：业务读数断言。录制值（世界/记忆/造物指纹、事件摘要）
 *      由运行器逐项核对，断言只补「人能读懂的那几个数」。
 *
 * 断言不做自然语言判断，也不执行任意代码：`source` 是闭集，`path` 只认
 * `a.b[0].c` 这种取值路径，`op` 只认六个比较。
 */

import { canonicalJson, traceProblems } from './format.ts';
import type { TraceFile } from './format.ts';
import type { ReplayRun } from './replay.ts';
import type { TraceRuntime } from './runtime.ts';
import { DAY_MS } from '../world/memory/config.ts';
import type { WorldFact } from '../world/memory/types.ts';

export const FIXTURE_FORMAT = 'pwe-fixture/1';
export const FIXTURE_VERSION = 1;

export const FIXTURE_SOURCES = [
  'world',
  'world.business',
  'world.fingerprint',
  'events',
  'memory.snapshot',
  'memory.business',
  'memory.fingerprint',
  'memory.consolidated',
  'memory.eventCounts',
  'memory.factsByKind',
  'memory.kindReadings',
  'memory.beatOrder',
  'creator.business',
  'creator.fingerprint',
] as const;
export type FixtureSource = (typeof FIXTURE_SOURCES)[number];

export const FIXTURE_OPS = ['eq', 'ne', 'gte', 'lte', 'contains', 'exists'] as const;
export type FixtureOp = (typeof FIXTURE_OPS)[number];

export interface FixtureAssertion {
  /** 人读的一句话：这条断言在验什么。 */
  readonly note: string;
  readonly source: FixtureSource;
  /** 取值路径，例如 `world.bonds[0].trust`、`proposals[0].accepted`。 */
  readonly path: string;
  readonly op: FixtureOp;
  /** `exists` 之外必填。 */
  readonly value?: unknown;
}

export interface FixtureFile {
  readonly format: string;
  readonly fixtureVersion: number;
  readonly name: string;
  readonly purpose: string;
  /** 单条回放的耗时预算（毫秒）。 */
  readonly expectedMs: number;
  readonly covers: readonly string[];
  readonly doesNotCover: readonly string[];
  /** 可选：相对 `world-client/` 的 v5 存档路径。给了就从真实存档起步。 */
  readonly baselinePath?: string;
  readonly trace: TraceFile;
  readonly assertions: readonly FixtureAssertion[];
}

/** 结构校验。文件系统里存档是否存在由调用方另查（这里不碰磁盘）。 */
export function fixtureProblems(input: unknown): string[] {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null) return ['顶层不是对象'];
  const raw = input as Record<string, unknown>;

  if (raw.format !== FIXTURE_FORMAT || raw.fixtureVersion !== FIXTURE_VERSION) {
    problems.push(`format/fixtureVersion 必须是 ${FIXTURE_FORMAT}/${FIXTURE_VERSION}`);
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    problems.push('name 必须是非空字符串');
  }
  if (typeof raw.purpose !== 'string' || raw.purpose.trim() === '') {
    problems.push('purpose 必须是非空字符串');
  }
  if (typeof raw.expectedMs !== 'number' || !Number.isFinite(raw.expectedMs) || raw.expectedMs <= 0) {
    problems.push('expectedMs 必须是正数');
  }
  for (const key of ['covers', 'doesNotCover'] as const) {
    const list = raw[key];
    if (!Array.isArray(list) || list.length === 0) {
      problems.push(`${key} 必须是非空数组`);
    } else if (list.some((item) => typeof item !== 'string' || item.trim() === '')) {
      problems.push(`${key} 的每一项都必须是非空字符串`);
    }
  }
  if (raw.baselinePath !== undefined) {
    if (typeof raw.baselinePath !== 'string' || raw.baselinePath.trim() === '') {
      problems.push('baselinePath 给了就必须是非空字符串');
    }
  }

  if (typeof raw.trace !== 'object' || raw.trace === null) {
    problems.push('trace 必须是 pwe-trace/2 文件');
  } else {
    problems.push(...traceProblems(raw.trace).map((item) => `trace: ${item}`));
  }

  const assertions = raw.assertions;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    problems.push('assertions 必须是非空数组（每条夹具至少证明一件事）');
  } else {
    for (const [index, item] of assertions.entries()) {
      problems.push(...assertionProblems(item, `assertions[${index}]`));
    }
  }
  return problems;
}

function assertionProblems(value: unknown, label: string): string[] {
  if (typeof value !== 'object' || value === null) return [`${label} 不是对象`];
  const raw = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof raw.note !== 'string' || raw.note.trim() === '') {
    problems.push(`${label}.note 必须是非空字符串`);
  }
  if (!FIXTURE_SOURCES.includes(raw.source as FixtureSource)) {
    problems.push(`${label}.source 不在闭集：${String(raw.source)}`);
  }
  if (typeof raw.path !== 'string') problems.push(`${label}.path 必须是字符串`);
  if (!FIXTURE_OPS.includes(raw.op as FixtureOp)) {
    problems.push(`${label}.op 不在闭集：${String(raw.op)}`);
  } else if (raw.op !== 'exists' && raw.value === undefined) {
    problems.push(`${label}.op=${String(raw.op)} 必须带 value`);
  }
  return problems;
}

/** 按 `a.b[0].c` 取值；数组上额外的 `length` 取长度。取不到返回 `undefined`。 */
export function readPath(value: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((part) => part !== '');
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (part === 'length') {
        current = current.length;
        continue;
      }
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export interface AssertionResult {
  readonly assertion: FixtureAssertion;
  readonly actual: unknown;
  readonly ok: boolean;
}

/** 断言求值。`sources` 由 `fixtureSources()` 按闭集生成。 */
export function evaluateAssertion(
  sources: Readonly<Record<string, unknown>>,
  assertion: FixtureAssertion,
): AssertionResult {
  const actual = readPath(sources[assertion.source], assertion.path);
  return { assertion, actual, ok: compare(actual, assertion.op, assertion.value) };
}

function compare(actual: unknown, op: FixtureOp, expected: unknown): boolean {
  switch (op) {
    case 'exists':
      return actual !== undefined;
    case 'eq':
      if (actual === undefined || expected === undefined) return actual === expected;
      return canonicalJson(actual) === canonicalJson(expected);
    case 'ne':
      if (actual === undefined || expected === undefined) return actual !== expected;
      return canonicalJson(actual) !== canonicalJson(expected);
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected);
      if (Array.isArray(actual)) return actual.some((item) => canonicalJson(item) === canonicalJson(expected));
      return false;
  }
}

/** 断言可读的来源表。全部是只读视图，不改运行时。 */
export function fixtureSources(
  runtime: TraceRuntime,
  run: ReplayRun,
): Record<string, unknown> {
  const memory = runtime.memorySnapshot();
  const creator = runtime.creatorBusiness();
  const consolidated = consolidationSums(runtime);
  const eventCounts: Record<string, number> = {};
  for (const event of runtime.memoryEvents) {
    eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
  }
  const byKind = factsByKind(runtime);
  return {
    world: runtime.snapshot(),
    'world.business': run.business,
    'world.fingerprint': run.fingerprint,
    events: run.events,
    'memory.snapshot': memory,
    'memory.business': run.memory?.business ?? null,
    'memory.fingerprint': run.memory?.fingerprint ?? null,
    'memory.consolidated': consolidated,
    'memory.eventCounts': eventCounts,
    'memory.factsByKind': byKind,
    'memory.kindReadings': kindReadings(byKind),
    'memory.beatOrder': beatOrder(byKind),
    'creator.business': creator,
    'creator.fingerprint': run.creator?.fingerprint ?? null,
  };
}

/**
 * 按 `kind` 分组的事实视图。
 *
 * 断言引擎没有筛选/计数能力（`path` 只认取值），所以「某类事件几次、
 * 落在哪些时段与地点、参与者是谁」必须先在这里摊成可读的只读视图。
 */
function factsByKind(runtime: TraceRuntime): Record<string, readonly WorldFact[]> {
  const facts = runtime.memorySnapshot()?.world.facts ?? [];
  const byKind: Record<string, WorldFact[]> = {};
  for (const fact of facts) {
    const list = byKind[fact.kind] ?? (byKind[fact.kind] = []);
    list.push(fact);
  }
  return byKind;
}

interface KindReading {
  readonly count: number;
  /** 去重后升序的世界日。 */
  readonly days: readonly number[];
  /** 去重后升序的「日内毫秒偏移」，用它对固定时刻表拍点。 */
  readonly tickOfDay: readonly number[];
  readonly tickOfDayMin: number;
  readonly tickOfDayMax: number;
  /** 去重后升序的 placeId。 */
  readonly places: readonly string[];
  /** placeId 为空的事实条数（应当恒为 0）。 */
  readonly emptyPlaces: number;
  /** 去重后升序的参与者人数。 */
  readonly actorCounts: readonly number[];
  /** 去重后升序的参与者组合（`v0+v1`）；无参与者的事件不列入。 */
  readonly actorPairs: readonly string[];
}

/** 每类事件的业务读数：数量、日子、时段、地点、参与者。 */
function kindReadings(
  byKind: Readonly<Record<string, readonly WorldFact[]>>,
): Record<string, KindReading> {
  const readings: Record<string, KindReading> = {};
  for (const [kind, list] of Object.entries(byKind)) {
    const ticks = uniqueNumbers(
      list.map((fact) => fact.tick - Math.floor(fact.tick / DAY_MS) * DAY_MS),
    );
    readings[kind] = {
      count: list.length,
      days: uniqueNumbers(list.map((fact) => fact.day)),
      tickOfDay: ticks,
      tickOfDayMin: ticks[0] ?? -1,
      tickOfDayMax: ticks[ticks.length - 1] ?? -1,
      places: uniqueStrings(list.map((fact) => fact.placeId)),
      emptyPlaces: list.filter((fact) => fact.placeId === '').length,
      actorCounts: uniqueNumbers(list.map((fact) => fact.actors.length)),
      actorPairs: uniqueStrings(
        list.filter((fact) => fact.actors.length > 0).map((fact) => fact.actors.join('+')),
      ),
    };
  }
  return readings;
}

/** 市面四拍的固定次序：开市 → 收工 → 夜市 → 闭市。 */
const MARKET_BEAT_ORDER = [
  'market_open',
  'work_end',
  'night_market',
  'market_close',
] as const;

interface BeatOrderDetail {
  readonly day: number;
  readonly expectedEarlier: string;
  readonly expectedLater: string;
  readonly earlierAt: number;
  readonly laterAt: number;
}

interface BeatOrderReading {
  /** 真正参与顺序核对的日子数（当天至少出现两拍）。 */
  readonly checkedDays: number;
  /** 逆序明细；空数组 = 所有被核对的日子都按固定次序发生。 */
  readonly details: readonly BeatOrderDetail[];
}

/**
 * 市面四拍的「同日顺序」读数。
 *
 * 只核对当天真的出现过的拍点：缺拍不伪造顺序，但 `checkedDays` 会告诉
 * 断言「这条夹具到底核对了几天」，避免夹具提前结束时顺序断言空过。
 */
function beatOrder(byKind: Readonly<Record<string, readonly WorldFact[]>>): BeatOrderReading {
  const days = uniqueNumbers(
    MARKET_BEAT_ORDER.flatMap((kind) => (byKind[kind] ?? []).map((fact) => fact.day)),
  );
  const details: BeatOrderDetail[] = [];
  let checkedDays = 0;
  for (const day of days) {
    const beats = MARKET_BEAT_ORDER.flatMap((kind) => {
      const fact = (byKind[kind] ?? []).find((item) => item.day === day);
      return fact === undefined ? [] : [{ kind, at: fact.tick }];
    });
    if (beats.length < 2) continue;
    checkedDays += 1;
    for (let index = 1; index < beats.length; index += 1) {
      const earlier = beats[index - 1]!;
      const later = beats[index]!;
      if (later.at <= earlier.at) {
        details.push({
          day,
          expectedEarlier: earlier.kind,
          expectedLater: later.kind,
          earlierAt: earlier.at,
          laterAt: later.at,
        });
      }
    }
  }
  return { checkedDays, details };
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/**
 * `memory.consolidated` 的合计：把每次日终关账里的 `stats` 加起来。
 *
 * 为什么不用终局快照数：预算淘汰与归档是**发生过**的事，而快照只保留
 * 还没被裁掉的那部分——归档条目会在之后被裁掉，终局 `archived` 常常是 0。
 * `archived` / `dropped` 必须是事件累计值。`events` 是关账次数。
 */
function consolidationSums(runtime: TraceRuntime): Record<string, number> {
  const sums: Record<string, number> = { events: 0 };
  for (const event of runtime.memoryEvents) {
    if (event.kind !== 'memory.consolidated') continue;
    sums.events = (sums.events ?? 0) + 1;
    const stats = event.payload.stats;
    if (typeof stats !== 'object' || stats === null) continue;
    for (const [key, value] of Object.entries(stats as Record<string, unknown>)) {
      if (typeof value !== 'number') continue;
      sums[key] = round6((sums[key] ?? 0) + value);
    }
  }
  return sums;
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** 把 `baselinePath` 读成 `trace.baseline` 时用的相对路径口径（入库一律 POSIX）。 */
export function baselineSourceOf(path: string): string {
  return path.split('\\').join('/');
}
