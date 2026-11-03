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
      return canonicalJson(actual) === canonicalJson(expected);
    case 'ne':
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
    'creator.business': creator,
    'creator.fingerprint': run.creator?.fingerprint ?? null,
  };
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
