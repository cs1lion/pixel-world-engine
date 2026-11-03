/** 无头回放：把一份轨迹在 Node 里重建一遍，产出世界指纹与事件区间摘要。
 *
 * 这里**不认识浏览器**：不 import Phaser、不碰 DOM、不读 `Date.now()`。
 * 世界时钟只有 `initialNow + stepMs × 拍数`，外部注入按世界时刻进队，
 * 和被玩家亲眼看着跑时走的是同一个 `Simulation.enqueue()`。
 *
 * 指纹是「世界状态投影」的 sha256。投影只收世界自有事实（人、楼、任务、
 * 摆件、天气、潮位、信仰、交付），按键排序后序列化——两次回放逐字节相同，
 * 才算可重放。
 */

import { performance } from 'node:perf_hooks';
import { selectSetting, worldForSetting, routineProfiles } from '../settings/index.ts';
import { placeBlueprint } from '../world/setup.ts';
import { Simulation } from '../world/simulation.ts';
import type { NewBuilding, SimulationDeps } from '../world/simulation.ts';
import type { WorldEvent, WorldSnapshot } from '../world/types.ts';
import { DAY_MS } from '../world/memory/config.ts';
import {
  canonicalJson,
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
  TraceCommand,
  TraceFile,
  TraceInjection,
  TraceInput,
  TraceRecorded,
  TraceEventRange,
} from './format.ts';

/** 每多少拍留一个检查点。用于「第一处分歧」的定位，不参与终局指纹。 */
export const CHECKPOINT_EVERY = 250;
/** `Simulation` 的事件环窗口。一拍里超过这么多条，增量取事件会漏，明确报错。 */
const EVENT_WINDOW_FOR_TRACE = 60;

interface CollectedEvent {
  readonly seq: number;
  readonly at: number;
  readonly tone: WorldEvent['tone'];
  readonly text: string;
}

export interface ReplayBusiness extends TraceBusiness {}

export interface ReplayRun {
  /** 终局投影的规范字节串。比较「逐字相同」时用它，不只用哈希。 */
  readonly finalProjection: string;
  readonly fingerprint: string;
  /** 每一天的哈希，用来找第一处分歧。 */
  readonly stepFingerprints: readonly string[];
  readonly events: readonly CollectedEvent[];
  readonly eventCount: number;
  readonly eventDigest: string;
  readonly business: ReplayBusiness;
  readonly now: number;
}

export interface Divergence {
  readonly step: number;
  readonly atWorldMs: number;
  readonly path: string;
  readonly left: string;
  readonly right: string;
}

export type ReplayStatus = 'replayable' | 'unreplayable' | 'recorded-mismatch' | 'tampered';

export interface TraceVerification {
  readonly status: ReplayStatus;
  readonly inputDigest: string;
  /** 两次独立回放是否逐字节相同。 */
  readonly deterministic: boolean;
  /** 第一次回放的终局指纹。 */
  readonly fingerprint: string;
  /** 第二次回放的终局指纹。两次相同才叫可重放。 */
  readonly secondFingerprint: string;
  readonly eventCount: number;
  readonly eventDigest: string;
  readonly business: ReplayBusiness;
  readonly checks: {
    readonly integrity: boolean;
    readonly deterministic: boolean;
    readonly fingerprint: boolean;
    readonly eventCount: boolean;
    readonly eventDigest: boolean;
    readonly business: boolean;
  };
  /** 第一处分歧；没有分叉时为 null。 */
  readonly divergence: Divergence | null;
  readonly message: string;
  readonly firstRunMs: number;
  readonly secondRunMs: number;
}

/**
 * 按 `worldId` 重建一个空世界。
 *
 * 与 `SandboxScene` 的 `simDeps` 逐项对齐：同一个 `buildSettingWorld`、同一张
 * 蓝图注册表、同一个 `placeBlueprint`。区别只有三处，都是为了脱离浏览器：
 * 不给 `intentModel`（离线）、`wallClock` 固定 0（不读墙钟）、`onChange` 不接
 * 日志客户端（回放不该往服务端写东西）。
 */
export function buildHeadlessSimulation(input: TraceInput): Simulation {
  const search = input.worldId === 'default' ? '' : `?world=${encodeURIComponent(input.worldId)}`;
  let pack;
  try {
    pack = selectSetting(search);
  } catch (error) {
    throw new TraceFormatError(
      `worldId=${input.worldId} 没有对应的设定集：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const world = worldForSetting(pack);
  const blueprints = pack.blueprints;
  const deps: SimulationDeps = {
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: pack.villagers[0]?.name ?? '莞尔',
    wallClock: () => 0,
    blueprints,
    worldSize: { width: world.grid.width, height: world.grid.height },
    spawnBuilding: (
      prefabId: string,
      instanceId: string,
      at?: { readonly x: number; readonly y: number },
      source?: { readonly taskId: string; readonly summary: string },
    ): NewBuilding | null => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
    ...(pack.villagers.length > 0
      ? {
          villagerNames: pack.villagers.map((villager) => villager.name),
          villagerProfiles: routineProfiles(pack),
        }
      : {}),
    ...(pack.regions.length > 0
      ? { regionNames: new Map(pack.regions.map((region) => [region.id, region.name])) }
      : {}),
    ...(pack.propReveals !== undefined ? { propReveals: pack.propReveals } : {}),
    ...(pack.authored === true ? { authored: true } : {}),
  };
  return new Simulation({ ...deps, initialNow: input.initialNow });
}

/** 轨迹里的一条注入 → 世界命令。没有第二条入口。 */
function commandOf(injection: TraceInjection): { readonly kind: 'enqueue'; readonly command: WorldCommandLike } {
  if (injection.kind === 'weather') {
    return { kind: 'enqueue', command: { kind: 'setWeather', weather: injection.payload.weather } };
  }
  if (injection.kind === 'intent') {
    return { kind: 'enqueue', command: { kind: 'oracle', raw: injection.payload.raw } };
  }
  return { kind: 'enqueue', command: toWorldCommand(injection.payload.command) };
}

type WorldCommandLike = Parameters<Simulation['enqueue']>[0];

function toWorldCommand(command: TraceCommand): WorldCommandLike {
  switch (command.kind) {
    case 'setWeather':
      return { kind: 'setWeather', weather: command.weather };
    case 'setTideLevel':
      return { kind: 'setTideLevel', level: command.level, durationMs: command.durationMs };
    case 'build':
      return {
        kind: 'build',
        prefabId: command.prefabId,
        instanceId: command.instanceId,
        ...(command.at === undefined ? {} : { at: command.at }),
      };
    case 'miracle':
      return {
        kind: 'miracle',
        miracle: command.miracle,
        ...(command.at === undefined ? {} : { at: command.at }),
      };
    case 'demolish':
      return { kind: 'demolish', instanceId: command.instanceId };
  }
}

/**
 * 世界状态投影。
 *
 * 只收能复算的事实，数组按稳定键排序：楼按实例 id、任务按任务 id、
 * 摆件按 id、角色按 id。排序不是为了好看，是为了让「同一状态」在两次回放里
 * 序列化成同一串字节——插入顺序来自运行路径，排序把它从哈希里拿掉。
 */
export function projectWorld(snapshot: WorldSnapshot): Record<string, unknown> {
  return {
    now: snapshot.now,
    weather: snapshot.weather,
    tide: {
      level: snapshot.tide.level,
      rising: snapshot.tide.rising,
      overridden: snapshot.tide.overridden,
    },
    faith: snapshot.faith,
    deliveries: snapshot.deliveries,
    deliveriesByVillager: [...snapshot.deliveriesByVillager].sort((a, b) =>
      a.villagerId.localeCompare(b.villagerId),
    ),
    buildings: [...snapshot.buildings]
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
      .map((building) => ({
        instanceId: building.instanceId,
        prefabId: building.prefabId,
        displayName: building.displayName,
        zone: building.zone,
        origin: building.origin,
        footprint: building.footprint,
        door: building.door,
        workSpot: building.workSpot,
        boundTask: building.boundTask,
        sourceTaskId: building.sourceTaskId ?? null,
        sourceSummary: building.sourceSummary ?? null,
      })),
    villagers: [...snapshot.villagers]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((villager) => ({
        id: villager.id,
        name: villager.name,
        mode: villager.mode,
        pos: villager.pos,
        facing: villager.facing,
        visible: villager.visible,
        taskId: villager.taskId,
        bubble: villager.bubble,
        routine: villager.routine,
        walking: villager.walking,
        carrying: villager.carrying,
        lampOil: villager.lampOil,
        nameState: villager.nameState,
        carries: [...villager.carries].sort(),
      })),
    tasks: [...snapshot.tasks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({
        id: task.id,
        kind: task.kind,
        summary: task.summary,
        buildingId: task.buildingId,
        source: task.source,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        workerId: task.workerId,
        blockedQuestion: task.blockedQuestion,
      })),
    pending: [...snapshot.pending]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        requestedAt: item.requestedAt,
        source: item.source,
        summary: item.summary,
        villagerId: item.villagerId,
      })),
    props: [...snapshot.props]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((prop) => ({
        id: prop.id,
        kind: prop.kind,
        at: prop.at,
        label: prop.label,
        sourceTaskKind: prop.sourceTaskKind,
        sourceTaskId: prop.sourceTaskId,
        sourceSummary: prop.sourceSummary,
        grime: prop.grime,
        reveal: prop.reveal,
      })),
    constructions: [...snapshot.constructions].sort((a, b) =>
      a.buildingId.localeCompare(b.buildingId),
    ),
    oracle: snapshot.oracle,
    critters: snapshot.critters,
    fog: snapshot.fog,
    roads: snapshot.roads,
    trails: snapshot.trails,
  };
}

function eventsInRange(events: readonly CollectedEvent[], range: TraceEventRange): readonly CollectedEvent[] {
  return events.filter((event) => event.seq >= range.from && event.seq < range.to);
}

function digestOfEvents(events: readonly CollectedEvent[]): string {
  return sha256Hex(events.map((event) => `${event.seq}|${event.at}|${event.tone}|${event.text}`).join('\n'));
}

function businessOf(snapshot: WorldSnapshot, eventCount: number): ReplayBusiness {
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

export interface RunOptions {
  /** 只在这个拍（1 起）留下投影，供定位分歧时逐字段比较。 */
  readonly captureStep?: number;
}

export interface RunWithCapture extends ReplayRun {
  readonly capturedProjection: string | null;
}

/** 跑一次轨迹。纯函数式：每次调用都从空世界重新开始，不共享任何状态。 */
export function runTrace(input: TraceInput, options: RunOptions = {}): RunWithCapture {
  validateTrace(input);
  const events: CollectedEvent[] = [];
  const sim = buildHeadlessSimulation(input);
  let capturedSeq = 0;
  /** 按序号增量取事件。取不到说明一拍里超过 60 条，明确报错而不是补零。 */
  const collect = (): void => {
    const total = sim.eventCount();
    for (let seq = capturedSeq; seq < total; seq += 1) {
      const event = sim.eventAt(seq);
      if (event === null) {
        throw new TraceFormatError(
          `世界事件 #${seq} 已被 ${EVENT_WINDOW_FOR_TRACE} 条窗口挤掉；这一拍的事件太密，回放会漏。`,
        );
      }
      events.push({ seq, at: event.at, tone: event.tone, text: event.text });
    }
    capturedSeq = total;
  };
  const injections = orderedInjections(input);
  let nextInjection = 0;
  const stepFingerprints: string[] = [];
  let capturedProjection: string | null = null;
  let finalProjection = '';

  for (let step = 1; step <= input.steps; step += 1) {
    const worldNow = input.initialNow + step * input.stepMs;
    while (nextInjection < injections.length && injections[nextInjection]!.atWorldMs <= worldNow) {
      const { command } = commandOf(injections[nextInjection]!);
      sim.enqueue(command);
      nextInjection += 1;
    }
    sim.update(input.stepMs);
    const snapshot = sim.snapshot();
    collect();
    const projection = canonicalJson(projectWorld(snapshot));
    stepFingerprints.push(sha256Hex(projection));
    if (step === input.steps) finalProjection = projection;
    if (options.captureStep === step) capturedProjection = projection;
  }

  if (nextInjection < injections.length) {
    throw new TraceFormatError(
      `有 ${injections.length - nextInjection} 条注入没赶上轨迹终点：` +
        `最后一条在 ${injections[nextInjection]!.atWorldMs}，世界只走到 ${sim.snapshot().now}`,
    );
  }

  collect();
  const snapshot = sim.snapshot();
  const ranged = eventsInRange(events, input.eventRange);
  return {
    finalProjection,
    fingerprint: sha256Hex(finalProjection),
    stepFingerprints,
    events: ranged,
    eventCount: ranged.length,
    eventDigest: digestOfEvents(ranged),
    business: businessOf(snapshot, ranged.length),
    now: snapshot.now,
    capturedProjection,
  };
}

/** 录制：把一次真实运行冻结成轨迹文件。期望值全部来自同一次运行。 */
export function recordTrace(input: TraceInput): TraceFile {
  validateTrace(input);
  if (input.eventRange.from !== 0) {
    throw new TraceFormatError('录制必须从事件序号 0 开始（空世界构造的那一条「世界醒来」）');
  }
  const run = runTrace(input);
  if (run.events.length !== input.eventRange.to - input.eventRange.from) {
    throw new TraceFormatError(
      `eventRange 应覆盖 ${input.eventRange.to - input.eventRange.from} 条，实际 ${run.events.length} 条`,
    );
  }
  const checkpoints: TraceCheckpoint[] = [];
  for (let step = CHECKPOINT_EVERY; step <= input.steps; step += CHECKPOINT_EVERY) {
    checkpoints.push({
      step,
      atWorldMs: input.initialNow + step * input.stepMs,
      fingerprint: run.stepFingerprints[step - 1]!,
    });
  }
  const recorded: TraceRecorded = {
    inputDigest: digestOfInput(input),
    fingerprint: run.fingerprint,
    eventCount: run.eventCount,
    eventDigest: run.eventDigest,
    business: run.business,
    checkpoints,
  };
  return { ...inputOf(input), recorded };
}

/**
 * 两次独立回放 + 与录制值逐项核对。
 *
 * 三种失败分开报，因为它们说的是三件不同的事：
 *   - `tampered`：输入被改过（连 `inputDigest` 都对不上），世界还没跑就已经不是同一条轨迹。
 *   - `unreplayable`：两次回放的指纹不是逐字相同。这不是「和记录不符」，是**这次跑出来的
 *     两个世界自己就不一致**——回放器不能把这种状态当成通过。
 *   - `recorded-mismatch`：两次一致，但和录制时不一致。轨迹本身是确定的，是代码/数据变了。
 */
export function verifyTrace(trace: TraceFile): TraceVerification {
  validateTrace(trace);
  assertRecorded(trace);
  const integrity = digestOfInput(trace) === trace.recorded.inputDigest;

  const startedAt = performance.now();
  const first = runTrace(trace);
  const firstRunMs = performance.now() - startedAt;
  const startedSecond = performance.now();
  const second = runTrace(trace);
  const secondRunMs = performance.now() - startedSecond;

  const deterministic = first.finalProjection === second.finalProjection
    && first.stepFingerprints.join('\n') === second.stepFingerprints.join('\n');

  let divergence: Divergence | null = null;
  if (!deterministic) {
    const step = firstDivergentStep(first.stepFingerprints, second.stepFingerprints);
    divergence = locateDivergence(step, inputOf(trace));
  }

  const checks = {
    integrity,
    deterministic,
    fingerprint: first.fingerprint === trace.recorded.fingerprint,
    eventCount: first.eventCount === trace.recorded.eventCount,
    eventDigest: first.eventDigest === trace.recorded.eventDigest,
    business: canonicalJson(first.business) === canonicalJson(trace.recorded.business),
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
      checks,
      divergence,
      message: divergence === null
        ? '不可重放：两次回放的指纹不是逐字相同。'
        : `不可重放：两次回放在第 ${divergence.step} 拍（世界 ${divergence.atWorldMs}）第一次分叉，` +
          `字段 ${divergence.path}：${divergence.left} / ${divergence.right}`,
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
      checks,
      divergence,
      message: '轨迹被改动过：inputDigest 与录制时对不上（先查 worldSeed / 注入序列 / 时钟参数）。',
      firstRunMs,
      secondRunMs,
    };
  }

  if (!checks.fingerprint || !checks.eventCount || !checks.eventDigest || !checks.business) {
    const checkpoint = firstCheckpointDivergence(first.stepFingerprints, trace.recorded.checkpoints);
    const fields = [
      ...(checks.fingerprint ? [] : ['终局指纹']),
      ...(checks.eventCount ? [] : ['事件条数']),
      ...(checks.eventDigest ? [] : ['事件摘要']),
      ...(checks.business ? [] : ['业务读数']),
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
      checks,
      divergence: checkpoint,
      message:
        `重放结果与记录不符：${fields}。` +
        (checkpoint === null
          ? '检查点全部一致，分歧只出现在终局之后。'
          : `第一处检查点分歧在第 ${checkpoint.step} 拍（世界 ${checkpoint.atWorldMs}）。`),
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
    checks,
    divergence: null,
    message: '可重放：两次回放逐字相同，且与录制值逐项一致。',
    firstRunMs,
    secondRunMs,
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
}

function firstDivergentStep(left: readonly string[], right: readonly string[]): number {
  const size = Math.min(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    if (left[index] !== right[index]) return index + 1;
  }
  return size + 1;
}

/** 在第 `step` 拍重跑两次并只留那一拍的投影，逐字段找出第一处分歧。 */
function locateDivergence(step: number, input: TraceInput): Divergence {
  const left = runTrace(input, { captureStep: step });
  const right = runTrace(input, { captureStep: step });
  const atWorldMs = input.initialNow + step * input.stepMs;
  if (left.capturedProjection === null || right.capturedProjection === null) {
    return { step, atWorldMs, path: '(整段)', left: 'captured-missing', right: 'captured-missing' };
  }
  const diff = firstDifference(JSON.parse(left.capturedProjection), JSON.parse(right.capturedProjection));
  return {
    step,
    atWorldMs,
    path: diff.path,
    left: diff.left,
    right: diff.right,
  };
}

function firstCheckpointDivergence(
  stepFingerprints: readonly string[],
  checkpoints: readonly TraceCheckpoint[],
): Divergence | null {
  for (const checkpoint of checkpoints) {
    const actual = stepFingerprints[checkpoint.step - 1];
    if (actual === checkpoint.fingerprint) continue;
    return {
      step: checkpoint.step,
      atWorldMs: checkpoint.atWorldMs,
      path: '(指纹)',
      left: checkpoint.fingerprint,
      right: actual ?? '(缺少这一拍)',
    };
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
      const diff = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (!sameLeaf(left[index], right[index])) return diff;
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


