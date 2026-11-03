/** 轨迹文件格式：只描述「跑世界需要哪些输入」，不含任何渲染/浏览器状态。
 *
 * 为什么要一份显式的格式而不是直接把命令数组存下来：
 * 回放要在**无头 Node** 里跑，输入必须能脱离 Phaser、脱离墙钟、
 * 脱离服务端与模型独立重建世界。所以这里只有六样东西：
 *
 *   1. `worldId`：选哪套设定集（`default` / `dengchao`）。
 *   2. `worldSeed`：世界身份的种子。裸 `Simulation` 不消费它
 *      （`ce92d97` 上创世/记忆层没有接进回放器），它由 `inputDigest` 保护；
 *      接入外环后会成为 `seedOf(worldSeed, …)` 的第一段。
 *   3. `initialNow`：开局世界时刻（毫秒，从世界零点算，不是日历时间）。
 *   4. `stepMs` / `steps`：固定步长的时钟。`initialNow + steps × stepMs`
 *      就是这次轨迹的终点，**没有一次 `Date.now()`**。
 *   5. `injections`：外部注入的天气 / 意图 / 命令，每条带世界时刻与先后序号。
 *   6. `eventRange`：这条轨迹覆盖的世界事件序号区间 `[from, to)`。
 *
 * `recorded` 是录制时算出来的期望值（指纹、事件摘要、业务读数、检查点），
 * 回放器拿它判断「这次重放还是不是那一次世界」。它不是输入，不参与 `inputDigest`。
 *
 * 字段名本身说明语义，`description` 再把上面这段写成一句人话。
 */

import { createHash } from 'node:crypto';
import type { Weather } from '../world/types.ts';

export const TRACE_FORMAT = 'pwe-trace/1';
export const TRACE_VERSION = 1;
/** 防御性上限：一条轨迹最多这么多拍，避免读入一个把内存吃光的文件。 */
export const MAX_TRACE_STEPS = 5_000_000;

export type TraceInjection =
  | {
      readonly seq: number;
      readonly atWorldMs: number;
      readonly kind: 'weather';
      readonly payload: { readonly weather: Weather };
    }
  | {
      readonly seq: number;
      readonly atWorldMs: number;
      readonly kind: 'intent';
      readonly payload: { readonly raw: string };
    }
  | {
      readonly seq: number;
      readonly atWorldMs: number;
      readonly kind: 'command';
      readonly payload: { readonly command: TraceCommand };
    };

/**
 * 命令注入的取值范围。
 *
 * 这里**不复用** `WorldCommand`：回放轨迹要跨版本读，而 `WorldCommand`
 * 是内部联合类型，随时会加成员。白名单只收「能把世界推到另一条路上」的
 * 那几种；`oracle` / `intentFromModel` 走 `intent` 注入，不在这里。
 */
export type TraceCommand =
  | { readonly kind: 'setWeather'; readonly weather: Weather }
  | { readonly kind: 'setTideLevel'; readonly level: number; readonly durationMs: number }
  | {
      readonly kind: 'build';
      readonly prefabId: string;
      readonly instanceId: string;
      readonly at?: { readonly x: number; readonly y: number };
    }
  | {
      readonly kind: 'miracle';
      readonly miracle: 'light' | 'tree' | 'cat';
      readonly at?: { readonly x: number; readonly y: number };
    }
  | { readonly kind: 'demolish'; readonly instanceId: string };

export interface TraceEventRange {
  /** 含。世界事件序号从 0 起，构造那一条「世界醒来」就是 0。 */
  readonly from: number;
  /** 不含。 */
  readonly to: number;
}

export interface TraceInput {
  readonly format: string;
  readonly traceVersion: number;
  readonly description: string;
  readonly worldId: string;
  readonly worldSeed: string;
  readonly initialNow: number;
  readonly stepMs: number;
  readonly steps: number;
  readonly eventRange: TraceEventRange;
  readonly injections: readonly TraceInjection[];
}

/** 录制时留下的期望值。回放器逐项核对，不是「跑完就算过」。 */
export interface TraceRecorded {
  /** 输入内容的摘要。轨迹被改一个字，这里就对不上。 */
  readonly inputDigest: string;
  /** 终局世界指纹（sha256，十六进制）。 */
  readonly fingerprint: string;
  /** `eventRange` 里世界事件条数。 */
  readonly eventCount: number;
  /** `eventRange` 里世界事件摘要（sha256）。 */
  readonly eventDigest: string;
  /** 业务读数：生成回归用例时至少断言其中一项。 */
  readonly business: TraceBusiness;
  /** 每 `checkpointEvery` 拍记一次指纹，用来定位第一处分歧。 */
  readonly checkpoints: readonly TraceCheckpoint[];
}

export interface TraceCheckpoint {
  /** 跑完第几拍（1 起）。 */
  readonly step: number;
  /** 那一拍的世界时刻。 */
  readonly atWorldMs: number;
  readonly fingerprint: string;
}

export interface TraceBusiness {
  /** 世界日序号（`floor(now / DAY_MS)`）。跨日轨迹的起点与终点会差 1。 */
  readonly day: number;
  readonly now: number;
  readonly buildings: number;
  readonly tasksTotal: number;
  readonly tasksCompleted: number;
  readonly weather: Weather;
  readonly faithPoints: number;
  readonly deliveries: { readonly feed: number; readonly local: number };
  readonly eventCount: number;
}

export interface TraceFile extends TraceInput {
  readonly recorded: TraceRecorded;
}

export class TraceFormatError extends Error {}

/** 稳定序列化：对象键递归排序，数组保持原顺序。同一份状态永远同一串字节。 */
export function canonicalJson(value: unknown): string {
  return writeCanonical(value);
}

function writeCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TraceFormatError(`不能序列化非有限数：${value}`);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(writeCanonical).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const item = record[key];
      if (item === undefined) throw new TraceFormatError(`字段 ${key} 是 undefined，不能进指纹`);
      parts.push(`${JSON.stringify(key)}:${writeCanonical(item)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new TraceFormatError(`不能序列化 ${typeof value}`);
}

/** sha256 十六进制。用 Node 内置 crypto，不引外部依赖。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 只取输入字段，丢掉 `recorded`。顺序固定，所以摘要可复算。 */
export function inputOf(trace: TraceInput): TraceInput {
  return {
    format: trace.format,
    traceVersion: trace.traceVersion,
    description: trace.description,
    worldId: trace.worldId,
    worldSeed: trace.worldSeed,
    initialNow: trace.initialNow,
    stepMs: trace.stepMs,
    steps: trace.steps,
    eventRange: trace.eventRange,
    injections: trace.injections,
  };
}

export function digestOfInput(trace: TraceInput): string {
  return sha256Hex(canonicalJson(inputOf(trace)));
}

/** 读入一份轨迹后先过这一关：形状不对就别开始跑世界。 */
export function validateTrace(input: unknown): asserts input is TraceInput {
  const problems = traceProblems(input);
  if (problems.length > 0) {
    throw new TraceFormatError(`轨迹格式不对：\n- ${problems.join('\n- ')}`);
  }
}

export function traceProblems(input: unknown): string[] {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null) return ['顶层不是对象'];
  const raw = input as Record<string, unknown>;

  if (raw.format !== TRACE_FORMAT) problems.push(`format 必须是 ${TRACE_FORMAT}`);
  if (raw.traceVersion !== TRACE_VERSION) problems.push(`traceVersion 必须是 ${TRACE_VERSION}`);
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    problems.push('description 必须是非空字符串');
  }
  if (typeof raw.worldId !== 'string' || raw.worldId.trim() === '') {
    problems.push('worldId 必须是非空字符串');
  }
  if (typeof raw.worldSeed !== 'string') problems.push('worldSeed 必须是字符串');
  if (!isInteger(raw.initialNow) || raw.initialNow < 0) {
    problems.push('initialNow 必须是非负整数（世界毫秒）');
  }
  if (!isInteger(raw.stepMs) || raw.stepMs <= 0) problems.push('stepMs 必须是正整数');
  if (!isInteger(raw.steps) || raw.steps <= 0 || raw.steps > MAX_TRACE_STEPS) {
    problems.push(`steps 必须是 1..${MAX_TRACE_STEPS} 的整数`);
  }
  const range = raw.eventRange;
  if (typeof range !== 'object' || range === null) {
    problems.push('eventRange 必须是 { from, to }');
  } else {
    const { from, to } = range as Record<string, unknown>;
    if (!isInteger(from) || from < 0) problems.push('eventRange.from 必须是非负整数');
    if (!isInteger(to) || to < 0) problems.push('eventRange.to 必须是非负整数');
    if (isInteger(from) && isInteger(to) && to < from) {
      problems.push('eventRange.to 不能小于 eventRange.from');
    }
  }

  const injections = raw.injections;
  if (!Array.isArray(injections)) {
    problems.push('injections 必须是数组');
    return problems;
  }
  const seen = new Set<number>();
  const end = isInteger(raw.initialNow) && isInteger(raw.stepMs) && isInteger(raw.steps)
    ? raw.initialNow + raw.stepMs * raw.steps
    : null;
  for (const [index, item] of injections.entries()) {
    const label = `injections[${index}]`;
    if (typeof item !== 'object' || item === null) {
      problems.push(`${label} 不是对象`);
      continue;
    }
    const injection = item as Record<string, unknown>;
    if (!isInteger(injection.seq) || injection.seq <= 0) problems.push(`${label}.seq 必须是正整数`);
    else if (seen.has(injection.seq)) problems.push(`${label}.seq 与前面重复：${injection.seq}`);
    else seen.add(injection.seq);
    if (!isInteger(injection.atWorldMs)) problems.push(`${label}.atWorldMs 必须是整数`);
    else {
      if (injection.atWorldMs < (raw.initialNow as number)) {
        problems.push(`${label}.atWorldMs 不能早于 initialNow`);
      }
      if (end !== null && injection.atWorldMs > end) {
        problems.push(`${label}.atWorldMs 超出轨迹终点 ${end}`);
      }
    }
    if (injection.kind !== 'weather' && injection.kind !== 'intent' && injection.kind !== 'command') {
      problems.push(`${label}.kind 只能是 weather / intent / command`);
      continue;
    }
    const payload = injection.payload;
    if (typeof payload !== 'object' || payload === null) {
      problems.push(`${label}.payload 不是对象`);
      continue;
    }
    const body = payload as Record<string, unknown>;
    if (injection.kind === 'weather') {
      if (body.weather !== 'clear' && body.weather !== 'rain' && body.weather !== 'storm') {
        problems.push(`${label}.payload.weather 只能是 clear / rain / storm`);
      }
    } else if (injection.kind === 'intent') {
      if (typeof body.raw !== 'string' || body.raw.trim() === '') {
        problems.push(`${label}.payload.raw 必须是非空字符串`);
      }
    } else {
      const command = body.command;
      if (typeof command !== 'object' || command === null) {
        problems.push(`${label}.payload.command 不是对象`);
      } else {
        const kind = (command as Record<string, unknown>).kind;
        if (
          kind !== 'setWeather'
          && kind !== 'setTideLevel'
          && kind !== 'build'
          && kind !== 'miracle'
          && kind !== 'demolish'
        ) {
          problems.push(`${label}.payload.command.kind 不在轨迹白名单里`);
        }
      }
    }
  }
  return problems;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** 按世界时刻、再按录制顺序排。回放和录制用同一把尺。 */
export function orderedInjections(trace: TraceInput): readonly TraceInjection[] {
  return [...trace.injections].sort((a, b) =>
    a.atWorldMs === b.atWorldMs ? a.seq - b.seq : a.atWorldMs - b.atWorldMs,
  );
}
