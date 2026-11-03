/** 无头回放：世界、记忆、造物三层一起重建，产出三枚指纹与事件区间摘要。
 *
 * 这里**不认识浏览器**：不 import Phaser、不碰 DOM、不读 `Date.now()`。
 * 世界时钟只有 `initialNow + stepMs × 拍数`，外部注入按世界时刻进队，
 * 和被玩家亲眼看着跑时走的是同一个 `Simulation.enqueue()`。
 *
 * 指纹 = 状态投影的 sha256：
 *   - 世界：人、楼、任务、摆件、天气、潮位、信仰、交付；
 *   - 记忆：`MemoryRuntime.toSnapshot()` 的完整快照（facts / entries / claims /
 *     beliefs / holders / turningPoints …，情绪字段在条目里）；
 *   - 造物：日终关账、提议、落地读数、角色门禁计数。
 *
 * 两次独立回放**三枚指纹逐字相同**才算可重放。
 */

import { performance } from 'node:perf_hooks';
import {
  canonicalJson,
  compatibilityOf,
  digestOfInput,
  inputOf,
  orderedInjections,
  sha256Hex,
  TraceFormatError,
  validateTrace,
} from './format.ts';
import type {
  TraceBusiness,
  TraceCheckpoint,
  TraceCreatorBusiness,
  TraceFile,
  TraceInput,
  TraceRecorded,
  TraceEventRange,
  TraceMemoryBusiness,
} from './format.ts';
import { TraceRuntime, projectWorld } from './runtime.ts';
import type { CapturedEvent, StepCheckpoint } from './runtime.ts';
import { DAY_MS } from '../world/memory/config.ts';

/** 每多少拍留一个检查点。用于「第一处分歧」的定位，不参与终局指纹。 */
export const CHECKPOINT_EVERY = 250;

export interface ReplayBusiness extends TraceBusiness {}

export interface ReplayRun {
  /** 终局投影的规范字节串。比较「逐字相同」时用它，不只用哈希。 */
  readonly finalProjection: string;
  readonly fingerprint: string;
  /** 每一拍的世界指纹哈希，用来找第一处分歧。 */
  readonly stepFingerprints: readonly string[];
  readonly events: readonly CapturedEvent[];
  readonly eventCount: number;
  readonly eventDigest: string;
  readonly business: ReplayBusiness;
  readonly now: number;
  readonly memory: {
    readonly fingerprint: string;
    readonly business: TraceMemoryBusiness;
  } | null;
  readonly creator: {
    readonly fingerprint: string;
    readonly business: TraceCreatorBusiness;
  } | null;
  /** 开局（第 0 拍）的三枚指纹。 */
  readonly initial: StepCheckpoint;
  /** 检查点：开局 + 每 250 拍 + 终局。 */
  readonly checkpoints: readonly StepCheckpoint[];
}

export interface Divergence {
  readonly step: number;
  readonly atWorldMs: number;
  readonly path: string;
  readonly left: string;
  readonly right: string;
  /** 分叉发生在哪一层。 */
  readonly kind: 'world' | 'memory' | 'creator';
}

export type ReplayStatus = 'replayable' | 'unreplayable' | 'recorded-mismatch' | 'tampered';

export interface TraceVerification {
  readonly status: ReplayStatus;
  readonly inputDigest: string;
  /** 两次独立回放是否逐字相同（世界 + 外环）。 */
  readonly deterministic: boolean;
  readonly fingerprint: string;
  readonly secondFingerprint: string;
  readonly eventCount: number;
  readonly eventDigest: string;
  readonly business: ReplayBusiness;
  readonly memory: {
    readonly fingerprint: string;
    readonly secondFingerprint: string;
    readonly deterministic: boolean;
    readonly matchesRecorded: boolean;
    readonly business: TraceMemoryBusiness;
  } | null;
  readonly creator: {
    readonly fingerprint: string;
    readonly secondFingerprint: string;
    readonly deterministic: boolean;
    readonly matchesRecorded: boolean;
    readonly business: TraceCreatorBusiness;
  } | null;
  readonly compatibility: ReturnType<typeof compatibilityOf>;
  readonly checks: {
    readonly integrity: boolean;
    readonly deterministic: boolean;
    readonly fingerprint: boolean;
    readonly eventCount: boolean;
    readonly eventDigest: boolean;
    readonly business: boolean;
    readonly memory: boolean;
    readonly creator: boolean;
  };
  readonly divergence: Divergence | null;
  readonly message: string;
  readonly firstRunMs: number;
  readonly secondRunMs: number;
}

export interface RunOptions {
  /** 只在这个拍（1 起）留下投影，供定位分歧时逐字段比较。 */
  readonly captureStep?: number;
}

export interface RunWithCapture extends ReplayRun {
  readonly capturedProjection: string | null;
}

export interface RecordOptions {
  /** 额外把终局 v5 存档交回来（造基线用）。 */
  readonly captureSave?: boolean;
}

export interface RecordedTrace extends TraceFile {
  /** 只有 `captureSave` 为 true 时才有。 */
  readonly artifacts?: { readonly save?: ReturnType<TraceRuntime['save']> };
}

/** 跑一次轨迹。每次调用都从空世界/存档基线重新开始，不共享任何状态。 */
export async function runTrace(input: TraceInput, options: RunOptions = {}): Promise<RunWithCapture> {
  validateTrace(input);
  const runtime = new TraceRuntime(input);
  const initial = fingerprintsAt(runtime, 0, runtime.snapshot().now);
  const injections = orderedInjections(input);
  let nextInjection = 0;
  const stepFingerprints: string[] = [];
  const checkpoints: StepCheckpoint[] = [initial];
  let capturedProjection: string | null = null;
  let finalProjection = '';

  for (let step = 1; step <= input.steps; step += 1) {
    const worldNow = input.initialNow + step * input.stepMs;
    while (nextInjection < injections.length && injections[nextInjection]!.atWorldMs <= worldNow) {
      runtime.applyInjection(injections[nextInjection]!);
      nextInjection += 1;
    }
    await runtime.step(input.stepMs);
    const snapshot = runtime.snapshot();
    const projection = canonicalJson(projectWorld(snapshot));
    stepFingerprints.push(sha256Hex(projection));
    if (step === input.steps) finalProjection = projection;
    if (options.captureStep === step) capturedProjection = projection;
    if (step % CHECKPOINT_EVERY === 0 || step === input.steps) {
      checkpoints.push(fingerprintsAt(runtime, step, snapshot.now));
    }
  }

  if (nextInjection < injections.length) {
    throw new TraceFormatError(
      `有 ${injections.length - nextInjection} 条注入没赶上轨迹终点：` +
        `最后一条在 ${injections[nextInjection]!.atWorldMs}，世界只走到 ${runtime.sim.snapshot().now}`,
    );
  }

  const snapshot = runtime.snapshot();
  const ranged = eventsInRange(runtime.events, input.eventRange);
  const memoryFingerprint = runtime.memoryFingerprint();
  const memoryBusiness = runtime.memoryBusiness();
  const creatorFingerprint = runtime.creatorFingerprint();
  const creatorBusiness = runtime.creatorBusiness();

  return {
    finalProjection,
    fingerprint: sha256Hex(finalProjection),
    stepFingerprints,
    events: ranged,
    eventCount: ranged.length,
    eventDigest: digestOfEvents(ranged),
    business: businessOf(snapshot, ranged.length),
    now: snapshot.now,
    memory:
      memoryFingerprint === null || memoryBusiness === null
        ? null
        : { fingerprint: memoryFingerprint, business: memoryBusiness },
    creator:
      creatorFingerprint === null || creatorBusiness === null
        ? null
        : { fingerprint: creatorFingerprint, business: creatorBusiness },
    initial,
    checkpoints,
    capturedProjection,
  };
}

function fingerprintsAt(runtime: TraceRuntime, step: number, atWorldMs: number): StepCheckpoint {
  const world = sha256Hex(canonicalJson(projectWorld(runtime.snapshot())));
  return {
    step,
    atWorldMs,
    world,
    memory: runtime.memoryFingerprint(),
    creator: runtime.creatorFingerprint(),
  };
}

/** 录制：把一次真实运行冻结成轨迹文件。期望值全部来自同一次运行。 */
export async function recordTrace(input: TraceInput, options: RecordOptions = {}): Promise<RecordedTrace> {
  validateTrace(input);
  if (input.eventRange.from !== 0) {
    throw new TraceFormatError('录制必须从事件序号 0 开始（世界构造的那一条「世界醒来」）');
  }
  const runtime = new TraceRuntime(input);
  const captured = await runTraceWithRuntime(input, runtime);
  if (captured.events.length !== input.eventRange.to - input.eventRange.from) {
    throw new TraceFormatError(
      `eventRange 应覆盖 ${input.eventRange.to - input.eventRange.from} 条，实际 ${captured.events.length} 条`,
    );
  }
  const recorded: TraceRecorded = {
    inputDigest: digestOfInput(input),
    fingerprint: captured.fingerprint,
    eventCount: captured.eventCount,
    eventDigest: captured.eventDigest,
    business: captured.business,
    checkpoints: captured.checkpoints.map((checkpoint) => ({
      step: checkpoint.step,
      atWorldMs: checkpoint.atWorldMs,
      fingerprint: checkpoint.world,
      ...(checkpoint.memory === null ? {} : { memoryFingerprint: checkpoint.memory }),
      ...(checkpoint.creator === null ? {} : { creatorFingerprint: checkpoint.creator }),
    })),
    ...(captured.memory === null
      ? {}
      : { memory: { fingerprint: captured.memory.fingerprint, business: captured.memory.business } }),
    ...(captured.creator === null
      ? {}
      : { creator: { fingerprint: captured.creator.fingerprint, business: captured.creator.business } }),
  };
  const file: TraceFile = { ...inputOf(input), recorded };
  return options.captureSave === true
    ? { ...file, artifacts: { save: runtime.save() } }
    : file;
}

/**
 * 内部入口：复用已经构造好的运行时跑一遍。
 *
 * `recordTrace` 要拿同一份运行时导出存档，所以不能重新构造第二个世界——
 * 那会让「录下来的存档」和「算出来的指纹」属于两个不同的运行。
 */
export async function runTraceWithRuntime(
  input: TraceInput,
  runtime: TraceRuntime,
  options: RunOptions = {},
): Promise<RunWithCapture> {
  const snapshot = runtime.snapshot();
  const initial = fingerprintsAt(runtime, 0, snapshot.now);
  const injections = orderedInjections(input);
  let nextInjection = 0;
  const stepFingerprints: string[] = [];
  const checkpoints: StepCheckpoint[] = [initial];
  let capturedProjection: string | null = null;
  let finalProjection = '';

  for (let step = 1; step <= input.steps; step += 1) {
    const worldNow = input.initialNow + step * input.stepMs;
    while (nextInjection < injections.length && injections[nextInjection]!.atWorldMs <= worldNow) {
      runtime.applyInjection(injections[nextInjection]!);
      nextInjection += 1;
    }
    await runtime.step(input.stepMs);
    const after = runtime.snapshot();
    const projection = canonicalJson(projectWorld(after));
    stepFingerprints.push(sha256Hex(projection));
    if (step === input.steps) finalProjection = projection;
    if (options.captureStep === step) capturedProjection = projection;
    if (step % CHECKPOINT_EVERY === 0 || step === input.steps) {
      checkpoints.push(fingerprintsAt(runtime, step, after.now));
    }
  }
  if (nextInjection < injections.length) {
    throw new TraceFormatError(
      `有 ${injections.length - nextInjection} 条注入没赶上轨迹终点：` +
        `最后一条在 ${injections[nextInjection]!.atWorldMs}，世界只走到 ${runtime.sim.snapshot().now}`,
    );
  }
  const after = runtime.snapshot();
  const ranged = eventsInRange(runtime.events, input.eventRange);
  const memoryFingerprint = runtime.memoryFingerprint();
  const memoryBusiness = runtime.memoryBusiness();
  const creatorFingerprint = runtime.creatorFingerprint();
  const creatorBusiness = runtime.creatorBusiness();
  return {
    finalProjection,
    fingerprint: sha256Hex(finalProjection),
    stepFingerprints,
    events: ranged,
    eventCount: ranged.length,
    eventDigest: digestOfEvents(ranged),
    business: businessOf(after, ranged.length),
    now: after.now,
    memory:
      memoryFingerprint === null || memoryBusiness === null
        ? null
        : { fingerprint: memoryFingerprint, business: memoryBusiness },
    creator:
      creatorFingerprint === null || creatorBusiness === null
        ? null
        : { fingerprint: creatorFingerprint, business: creatorBusiness },
    initial,
    checkpoints,
    capturedProjection,
  };
}

/**
 * 两次独立回放 + 与录制值逐项核对。
 *
 * 三种失败分开报，因为它们说的是三件不同的事：
 *   - `tampered`：输入被改过（连 `inputDigest` 都对不上），世界还没跑就已经不是同一条轨迹。
 *   - `unreplayable`：两次回放的指纹不是逐字相同。世界、记忆、造物任一层不一致都算。
 *   - `recorded-mismatch`：两次一致，但和录制时不一致。轨迹本身是确定的，是代码/数据变了。
 */
export async function verifyTrace(trace: TraceFile): Promise<TraceVerification> {
  validateTrace(trace);
  assertRecorded(trace);
  const integrity = digestOfInput(trace) === trace.recorded.inputDigest;
  const compatibility = compatibilityOf(trace);

  const startedAt = performance.now();
  const first = await runTrace(trace);
  const firstRunMs = performance.now() - startedAt;
  const startedSecond = performance.now();
  const second = await runTrace(trace);
  const secondRunMs = performance.now() - startedSecond;

  const worldDeterministic = first.finalProjection === second.finalProjection
    && first.stepFingerprints.join('\n') === second.stepFingerprints.join('\n');
  const memoryDeterministic = sameOuter(first.memory, second.memory);
  const creatorDeterministic = sameOuter(first.creator, second.creator);
  const deterministic = worldDeterministic && memoryDeterministic && creatorDeterministic;

  let divergence: Divergence | null = null;
  if (!deterministic) {
    if (!worldDeterministic) {
      const step = firstDivergentStep(first.stepFingerprints, second.stepFingerprints);
      divergence = await locateWorldDivergence(trace, step);
    } else {
      divergence = firstOuterDivergence(first.checkpoints, second.checkpoints);
    }
  }

  const checks = {
    integrity,
    deterministic,
    fingerprint: first.fingerprint === trace.recorded.fingerprint,
    eventCount: first.eventCount === trace.recorded.eventCount,
    eventDigest: first.eventDigest === trace.recorded.eventDigest,
    business: canonicalJson(first.business) === canonicalJson(trace.recorded.business),
    memory: first.memory === null
      ? true
      : trace.recorded.memory !== undefined
        && first.memory.fingerprint === trace.recorded.memory.fingerprint
        && canonicalJson(first.memory.business) === canonicalJson(trace.recorded.memory.business),
    creator: first.creator === null
      ? true
      : trace.recorded.creator !== undefined
        && first.creator.fingerprint === trace.recorded.creator.fingerprint
        && canonicalJson(first.creator.business) === canonicalJson(trace.recorded.creator.business),
  };

  const memoryCheck = first.memory === null || second.memory === null
    ? null
    : {
        fingerprint: first.memory.fingerprint,
        secondFingerprint: second.memory.fingerprint,
        deterministic: memoryDeterministic,
        matchesRecorded: checks.memory,
        business: first.memory.business,
      };
  const creatorCheck = first.creator === null || second.creator === null
    ? null
    : {
        fingerprint: first.creator.fingerprint,
        secondFingerprint: second.creator.fingerprint,
        deterministic: creatorDeterministic,
        matchesRecorded: checks.creator,
        business: first.creator.business,
      };

  if (!deterministic) {
    return {
      status: 'unreplayable',
      inputDigest: digestOfInput(trace),
      deterministic,
      fingerprint: first.fingerprint,
      secondFingerprint: second.fingerprint,
      eventCount: first.eventCount,
      eventDigest: first.eventDigest,
      business: first.business,
      memory: memoryCheck,
      creator: creatorCheck,
      compatibility,
      checks,
      divergence,
      message: divergence === null
        ? '不可重放：两次回放的指纹不是逐字相同。'
        : `不可重放：两次回放在第 ${divergence.step} 拍（世界 ${divergence.atWorldMs}）` +
          `第一次分叉（${divergence.kind}），字段 ${divergence.path}：` +
          `${divergence.left} / ${divergence.right}`,
      firstRunMs,
      secondRunMs,
    };
  }

  if (!integrity) {
    return {
      status: 'tampered',
      inputDigest: digestOfInput(trace),
      deterministic,
      fingerprint: first.fingerprint,
      secondFingerprint: second.fingerprint,
      eventCount: first.eventCount,
      eventDigest: first.eventDigest,
      business: first.business,
      memory: memoryCheck,
      creator: creatorCheck,
      compatibility,
      checks,
      divergence,
      message: '轨迹被改动过：inputDigest 与录制时对不上（先查 worldSeed / 注入序列 / 基线存档 / 时钟参数）。',
      firstRunMs,
      secondRunMs,
    };
  }

  if (
    !checks.fingerprint
    || !checks.eventCount
    || !checks.eventDigest
    || !checks.business
    || !checks.memory
    || !checks.creator
  ) {
    const checkpoint = firstRecordedDivergence(trace, first.checkpoints);
    const fields = [
      ...(checks.fingerprint ? [] : ['世界终局指纹']),
      ...(checks.eventCount ? [] : ['事件条数']),
      ...(checks.eventDigest ? [] : ['事件摘要']),
      ...(checks.business ? [] : ['世界业务读数']),
      ...(checks.memory ? [] : ['记忆指纹/读数']),
      ...(checks.creator ? [] : ['造物账指纹/摘要']),
    ].join('、');
    return {
      status: 'recorded-mismatch',
      inputDigest: digestOfInput(trace),
      deterministic,
      fingerprint: first.fingerprint,
      secondFingerprint: second.fingerprint,
      eventCount: first.eventCount,
      eventDigest: first.eventDigest,
      business: first.business,
      memory: memoryCheck,
      creator: creatorCheck,
      compatibility,
      checks,
      divergence: checkpoint,
      message:
        `重放结果与记录不符：${fields}。` +
        (checkpoint === null
          ? '检查点全部一致，分歧只出现在终局之后。'
          : `第一处检查点分歧在第 ${checkpoint.step} 拍（世界 ${checkpoint.atWorldMs}，${checkpoint.kind}）。`),
      firstRunMs,
      secondRunMs,
    };
  }

  return {
    status: 'replayable',
    inputDigest: digestOfInput(trace),
    deterministic,
    fingerprint: first.fingerprint,
    secondFingerprint: second.fingerprint,
    eventCount: first.eventCount,
    eventDigest: first.eventDigest,
    business: first.business,
    memory: memoryCheck,
    creator: creatorCheck,
    compatibility,
    checks,
    divergence: null,
    message: compatibility.outerSupported
      ? '可重放：世界、记忆、造物三枚指纹两次逐字相同，且与录制值逐项一致。'
      : '可重放（仅世界层）：旧格式轨迹不支持外环字段，外环未参与校验。',
    firstRunMs,
    secondRunMs,
  };
}

function sameOuter(
  left: { readonly fingerprint: string } | null,
  right: { readonly fingerprint: string } | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.fingerprint === right.fingerprint;
}

function firstDivergentStep(left: readonly string[], right: readonly string[]): number {
  const size = Math.min(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    if (left[index] !== right[index]) return index + 1;
  }
  return size + 1;
}

async function locateWorldDivergence(trace: TraceFile, step: number): Promise<Divergence> {
  const input = inputOf(trace);
  const left = await runTrace(input, { captureStep: step });
  const right = await runTrace(input, { captureStep: step });
  const atWorldMs = input.initialNow + step * input.stepMs;
  if (left.capturedProjection === null || right.capturedProjection === null) {
    return {
      step,
      atWorldMs,
      path: '(整段)',
      left: 'captured-missing',
      right: 'captured-missing',
      kind: 'world',
    };
  }
  const diff = firstDifference(JSON.parse(left.capturedProjection), JSON.parse(right.capturedProjection));
  return { step, atWorldMs, path: diff.path, left: diff.left, right: diff.right, kind: 'world' };
}

function firstOuterDivergence(
  left: readonly StepCheckpoint[],
  right: readonly StepCheckpoint[],
): Divergence | null {
  const size = Math.min(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.memory !== b.memory) {
      return outerDivergence(b, 'memory', a.memory, b.memory);
    }
    if (a.creator !== b.creator) {
      return outerDivergence(b, 'creator', a.creator, b.creator);
    }
  }
  return null;
}

function outerDivergence(
  b: StepCheckpoint,
  kind: 'memory' | 'creator',
  left: string | null,
  right: string | null,
): Divergence {
  return {
    step: b.step,
    atWorldMs: b.atWorldMs,
    path: kind === 'memory' ? '(记忆指纹)' : '(造物账指纹)',
    left: left ?? '(null)',
    right: right ?? '(null)',
    kind,
  };
}

/** 与录制值的第一处检查点分歧：世界 → 记忆 → 造物，按层报。 */
function firstRecordedDivergence(trace: TraceFile, actual: readonly StepCheckpoint[]): Divergence | null {
  const byStep = new Map(actual.map((item) => [item.step, item]));
  for (const expected of trace.recorded.checkpoints) {
    const got = byStep.get(expected.step);
    if (got === undefined) continue;
    if (got.world !== expected.fingerprint) {
      return {
        step: expected.step,
        atWorldMs: expected.atWorldMs,
        path: '(世界指纹)',
        left: expected.fingerprint,
        right: got.world,
        kind: 'world',
      };
    }
    if (expected.memoryFingerprint !== undefined && got.memory !== expected.memoryFingerprint) {
      return {
        step: expected.step,
        atWorldMs: expected.atWorldMs,
        path: '(记忆指纹)',
        left: expected.memoryFingerprint,
        right: got.memory ?? '(null)',
        kind: 'memory',
      };
    }
    if (expected.creatorFingerprint !== undefined && got.creator !== expected.creatorFingerprint) {
      return {
        step: expected.step,
        atWorldMs: expected.atWorldMs,
        path: '(造物账指纹)',
        left: expected.creatorFingerprint,
        right: got.creator ?? '(null)',
        kind: 'creator',
      };
    }
  }
  return null;
}

/** 递归找第一处不同的叶子。路径像 `villagers[0].pos.x`，报错时人照着改。 */
export function firstDifference(
  left: unknown,
  right: unknown,
  path = '$',
): { readonly path: string; readonly left: string; readonly right: string } {
  if (left === right) return { path, left: String(left), right: String(right) };
  if (Array.isArray(left) && Array.isArray(right)) {
    const size = Math.min(left.length, right.length);
    for (let index = 0; index < size; index += 1) {
      if (!sameLeaf(left[index], right[index])) {
        return firstDifference(left[index], right[index], `${path}[${index}]`);
      }
    }
    if (left.length !== right.length) {
      return {
        path: `${path}.length`,
        left: String(left.length),
        right: String(right.length),
      };
    }
    return { path, left: JSON.stringify(left), right: JSON.stringify(right) };
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      if (a[key] === undefined || b[key] === undefined) {
        return {
          path: `${path}.${key}`,
          left: JSON.stringify(a[key]),
          right: JSON.stringify(b[key]),
        };
      }
      if (!sameLeaf(a[key], b[key])) return firstDifference(a[key], b[key], `${path}.${key}`);
    }
    return { path, left: JSON.stringify(left), right: JSON.stringify(right) };
  }
  return { path, left: JSON.stringify(left), right: JSON.stringify(right) };
}

function sameLeaf(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function eventsInRange(events: readonly CapturedEvent[], range: TraceEventRange): readonly CapturedEvent[] {
  return events.filter((event) => event.seq >= range.from && event.seq < range.to);
}

function digestOfEvents(events: readonly CapturedEvent[]): string {
  return sha256Hex(events.map((event) => `${event.seq}|${event.at}|${event.tone}|${event.text}`).join('\n'));
}

function businessOf(
  snapshot: ReturnType<TraceRuntime['snapshot']>,
  eventCount: number,
): ReplayBusiness {
  return {
    day: Math.floor(snapshot.now / DAY_MS),
    now: snapshot.now,
    buildings: snapshot.buildings.length,
    tasksTotal: snapshot.tasks.length,
    tasksCompleted: snapshot.tasks.filter((task) => task.status === 'done').length,
    weather: snapshot.weather,
    faithPoints: snapshot.faith.points,
    deliveries: snapshot.deliveries,
    eventCount,
  };
}

/** `recorded` 是后来加的块：老轨迹文件可能没有，先判形状再读。 */
function assertRecorded(trace: TraceFile): void {
  const recorded = (trace as unknown as { recorded?: unknown }).recorded;
  if (typeof recorded !== 'object' || recorded === null) {
    throw new TraceFormatError('轨迹缺少 recorded 块——没有期望值就没有「回归」可言');
  }
  const value = recorded as Record<string, unknown>;
  for (const key of ['inputDigest', 'fingerprint', 'eventDigest'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') {
      throw new TraceFormatError(`recorded.${key} 必须是非空字符串`);
    }
  }
  if (!Number.isInteger(value.eventCount)) throw new TraceFormatError('recorded.eventCount 必须是整数');
  if (typeof value.business !== 'object' || value.business === null) {
    throw new TraceFormatError('recorded.business 必须是对象');
  }
  if (!Array.isArray(value.checkpoints)) throw new TraceFormatError('recorded.checkpoints 必须是数组');
  for (const [index, item] of value.checkpoints.entries()) {
    if (
      typeof item !== 'object'
      || item === null
      || !Number.isInteger((item as Record<string, unknown>).step)
      || typeof (item as Record<string, unknown>).fingerprint !== 'string'
    ) {
      throw new TraceFormatError(`recorded.checkpoints[${index}] 形状不对`);
    }
  }
  if (trace.traceVersion === 2 && trace.outer?.memory === true) {
    const memory = value.memory;
    if (typeof memory !== 'object' || memory === null || typeof (memory as Record<string, unknown>).fingerprint !== 'string') {
      throw new TraceFormatError('pwe-trace/2 + outer.memory 必须带 recorded.memory');
    }
  }
  if (trace.traceVersion === 2 && trace.outer?.creator === true) {
    const creator = value.creator;
    if (typeof creator !== 'object' || creator === null || typeof (creator as Record<string, unknown>).fingerprint !== 'string') {
      throw new TraceFormatError('pwe-trace/2 + outer.creator 必须带 recorded.creator');
    }
  }
}

/** 兼容 old import：旧的 v1 单测用这个常量对拍。 */
export type { TraceCheckpoint };
