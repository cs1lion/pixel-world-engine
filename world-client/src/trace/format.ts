/** 轨迹文件格式：只描述「跑世界需要哪些输入」，不含任何渲染/浏览器状态。
 *
 * 版本策略（`pwe-trace/2`，2026-11-03）：
 *
 *   - **v1（`pwe-trace/1`）**：只覆盖世界层——`worldSeed` / 时钟 / 白名单注入。
 *     老轨迹继续可读，回放器只校验世界指纹，并明确报「不支持外环字段」。
 *   - **v2（`pwe-trace/2`）**：在 v1 之上加两样东西：
 *       `baseline`：一份只读的 v5 存档副本，回放从真实存档起步；
 *       `outer`：打开 `MemoryRuntime` 与 `CreatorEngine`，并把它们的指纹写进
 *       `recorded`。旧字段一个没改，所以 v1 读起来不需要迁移。
 *
 * 字段自解释：
 *   1. `worldId`：选哪套设定集（`default` / `dengchao`）。
 *   2. `worldSeed`：世界身份种子。v2 起它真的喂给 `CreatorEngine` 的
 *      `seedOf(worldSeed, day, 'creator', …)`，不再只是元数据。
 *   3. `initialNow`：开局世界时刻（毫秒，从世界零点算，不是日历时间）。
 *      给了 `baseline` 时必须等于存档里的 `world.now`。
 *   4. `stepMs` / `steps`：固定步长的时钟。`Date.now()` 一次都不读。
 *   5. `injections`：外部注入，每条带世界时刻与先后序号。
 *   6. `eventRange`：这条轨迹覆盖的世界事件序号区间 `[from, to)`。
 *   7. `baseline`：v5 存档副本（只读，不写回）。有它就从存档中途起步。
 *   8. `outer`：记忆 / 造物两层是否参与回放。v2 两条都为 true。
 *
 * `recorded` 是录制时算出来的期望值。它不是输入，不参与 `inputDigest`。
 */

import { createHash } from 'node:crypto';
import type { Weather } from '../world/types.ts';
import type { WorldSave } from '../world/save.ts';

export const TRACE_FORMAT_V1 = 'pwe-trace/1';
export const TRACE_FORMAT = 'pwe-trace/2';
export const TRACE_VERSION_V1 = 1;
export const TRACE_VERSION = 2;
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
    }
  | {
      /**
       * 一次走造物引擎的人类造物：先 `proposeCreation` 过白名单，再落成
       * `build` 命令。落地后按场景同一条事后判定回填门禁读数。
       */
      readonly seq: number;
      readonly atWorldMs: number;
      readonly kind: 'creatorBuild';
      readonly payload: {
        readonly templateId: string;
        readonly at: { readonly x: number; readonly y: number };
        /** 人给的来由。省略时用计划里的模板名。 */
        readonly summary?: string;
      };
    }
  | {
      /**
       * 记忆层注入：直接走 `MemoryRuntime.observe` 的公开边界。
       *
       * 为什么需要它：关系账本（`bonds`）只由「目击者看见某个角色做了高显著度
       * 的事」推动，而纯世界事件里的造物/天气 `actors` 是空的——不构造一条
       * 带 actor 与 witnesses 的观察，就没办法在轨迹里把正/负关系与情绪真的
       * 走一遍。这不是绕开世界：`observe` 本来就是世界把事交给记忆层的那扇门。
       */
      readonly seq: number;
      readonly atWorldMs: number;
      readonly kind: 'memory';
      readonly payload: {
        readonly eventId: string;
        readonly memoryKind: string;
        readonly placeId: string;
        readonly at: { readonly x: number; readonly y: number };
        readonly actors: readonly string[];
        readonly witnesses?: readonly string[];
        readonly what?: string;
        readonly valence?: number;
        readonly arousal?: number;
        readonly importanceHint?: number;
      };
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

/** v2：一份只读的 v5 存档副本。`source` 只用来告诉人它是哪来的。 */
export interface TraceBaseline {
  readonly source: string;
  readonly save: WorldSave;
}

/** v2：外环开关。两条都写着 true，表示摘要里必须有这两层的指纹。 */
export interface TraceOuterConfig {
  readonly memory: boolean;
  readonly creator: boolean;
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
  /** v2 才有。 */
  readonly baseline?: TraceBaseline;
  /** v2 才有。 */
  readonly outer?: TraceOuterConfig;
}

/** 记忆层的业务读数。指纹覆盖完整快照，这里只放一眼能读的计数。 */
export interface TraceMemoryBusiness {
  readonly lastClosedDay: number;
  readonly currentDay: number;
  readonly holders: number;
  readonly facts: number;
  readonly entries: number;
  readonly claims: number;
  readonly beliefs: number;
  readonly traces: number;
  readonly landmarks: number;
  readonly turningPoints: number;
  /** 方向性关系账本条数（`memorySchemaVersion >= 4`）。 */
  readonly bonds: number;
  /** 当前情绪条数（每个角色一条）。 */
  readonly moods: number;
  /** 所有 bond 的 trust 之和。只是读数，精确值由记忆指纹覆盖。 */
  readonly bondTrustSum: number;
  /** 所有 mood 的 valence 之和。只是读数，精确值由记忆指纹覆盖。 */
  readonly moodValenceSum: number;
  readonly legends: number;
  readonly placeNames: number;
  readonly announcements: number;
  readonly written: number;
  readonly credibility: number;
  readonly metToday: number;
}

/** 一次日终关账：心电图 + 导演决策 + 熔断读数 + 当天的造物提议。 */
export interface TraceDayClose {
  readonly day: number;
  readonly vitals: {
    readonly meanValence: number;
    readonly meanArousal: number;
    readonly infoEntropy: number;
    readonly isolatedHoldersCount: number;
  };
  readonly shouldInject: boolean;
  readonly eventKind: string | null;
  readonly reasoning: string;
  readonly fuse: {
    readonly action: string;
    readonly reason: string;
    readonly suggestedLevel: number | null;
  };
  readonly proposal: {
    readonly templateId: string;
    readonly at: { readonly x: number; readonly y: number };
    readonly reason: string;
  } | null;
  readonly autoEnqueued: boolean;
}

/** 一次造物提议（人工或日终自动）。 */
export interface TraceProposal {
  readonly day: number;
  readonly atWorldMs: number;
  readonly source: 'creatorBuild' | 'dayClose';
  readonly templateId: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly reason: string;
  readonly accepted: boolean;
  readonly instanceId: string | null;
  readonly fuseAction: string;
}

/** 一次造物落地后的真实读数。 */
export interface TraceLanding {
  readonly instanceId: string;
  readonly templateId: string;
  readonly prefabId: string;
  readonly origin: { readonly x: number; readonly y: number };
  readonly door: { readonly x: number; readonly y: number };
  readonly coverageRate: number;
  readonly pathfindingConnected: boolean;
  readonly hasCollision: boolean;
  readonly spatialConstraintSatisfied: boolean;
  readonly traceable: boolean;
  readonly replayHashConsistent: boolean | null;
  readonly hasConflict: boolean;
  readonly invariantViolated: boolean;
}

/** 造物账摘要。指纹是它的 sha256；数组顺序由回放顺序决定。 */
export interface TraceCreatorBusiness {
  readonly dayCloses: readonly TraceDayClose[];
  readonly proposals: readonly TraceProposal[];
  readonly landings: readonly TraceLanding[];
  readonly roles: readonly {
    readonly roleId: string;
    readonly currentLevel: number;
    readonly targetLevel: number;
    readonly isFused: boolean;
    readonly lastRegressionPassed: boolean | null;
    readonly batches: number;
    readonly days: number;
    readonly totalCommands: number;
    readonly schemaPassCount: number;
    readonly conflictCount: number;
    readonly conflictChecks: number;
    readonly invariantChecks: number;
  }[];
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
  /** v2：记忆层终局指纹与计数。 */
  readonly memory?: {
    readonly fingerprint: string;
    readonly business: TraceMemoryBusiness;
  };
  /** v2：造物账终局指纹与摘要。 */
  readonly creator?: {
    readonly fingerprint: string;
    readonly business: TraceCreatorBusiness;
  };
}

export interface TraceCheckpoint {
  /** 跑完第几拍（0 = 开局、还没推进世界）。 */
  readonly step: number;
  /** 那一拍的世界时刻。 */
  readonly atWorldMs: number;
  readonly fingerprint: string;
  /** v2：那一拍的记忆指纹。 */
  readonly memoryFingerprint?: string;
  /** v2：那一拍的造物账指纹。 */
  readonly creatorFingerprint?: string;
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

/** 旧格式能读到哪一层、缺了什么。CLI 与生成器都照这一句说人话。 */
export interface TraceCompatibility {
  readonly version: number;
  readonly outerSupported: boolean;
  readonly message: string;
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
  const base: TraceInput = {
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
  return {
    ...base,
    ...(trace.baseline === undefined ? {} : { baseline: trace.baseline }),
    ...(trace.outer === undefined ? {} : { outer: trace.outer }),
  };
}

export function digestOfInput(trace: TraceInput): string {
  return sha256Hex(canonicalJson(inputOf(trace)));
}

export function compatibilityOf(input: TraceInput): TraceCompatibility {
  if (input.traceVersion === TRACE_VERSION_V1) {
    return {
      version: 1,
      outerSupported: false,
      message: '旧格式轨迹（pwe-trace/1）：不支持外环字段，只校验世界指纹与事件区间。',
    };
  }
  return {
    version: 2,
    outerSupported: true,
    message: '外环字段：记忆指纹 + 造物账摘要都参与校验。',
  };
}

export function outerOf(input: TraceInput): TraceOuterConfig | null {
  if (input.traceVersion === TRACE_VERSION_V1) return null;
  return input.outer ?? { memory: true, creator: true };
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

  const version =
    raw.format === TRACE_FORMAT_V1 && raw.traceVersion === TRACE_VERSION_V1
      ? 1
      : raw.format === TRACE_FORMAT && raw.traceVersion === TRACE_VERSION
        ? 2
        : null;
  if (version === null) {
    problems.push(
      `format/traceVersion 必须成对出现：${TRACE_FORMAT_V1}/${TRACE_VERSION_V1} 或 ${TRACE_FORMAT}/${TRACE_VERSION}`,
    );
  }
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
  } else {
    problems.push(...injectionProblems(injections, raw));
  }

  if (version === 2) {
    problems.push(...baselineProblems(raw.baseline, raw.initialNow));
    problems.push(...outerProblems(raw.outer));
  }

  return problems;
}

function injectionProblems(injections: readonly unknown[], raw: Record<string, unknown>): string[] {
  const problems: string[] = [];
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
    if (
      injection.kind !== 'weather'
      && injection.kind !== 'intent'
      && injection.kind !== 'command'
      && injection.kind !== 'creatorBuild'
      && injection.kind !== 'memory'
    ) {
      problems.push(`${label}.kind 只能是 weather / intent / command / creatorBuild / memory`);
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
    } else if (injection.kind === 'creatorBuild') {
      if (typeof body.templateId !== 'string' || body.templateId.trim() === '') {
        problems.push(`${label}.payload.templateId 必须是非空字符串`);
      }
      if (!isPoint(body.at)) problems.push(`${label}.payload.at 必须是 { x, y }`);
      if (body.summary !== undefined && typeof body.summary !== 'string') {
        problems.push(`${label}.payload.summary 必须是字符串`);
      }
    } else if (injection.kind === 'memory') {
      if (typeof body.eventId !== 'string' || body.eventId.trim() === '') {
        problems.push(`${label}.payload.eventId 必须是非空字符串`);
      }
      if (typeof body.memoryKind !== 'string' || body.memoryKind.trim() === '') {
        problems.push(`${label}.payload.memoryKind 必须是非空字符串`);
      }
      if (typeof body.placeId !== 'string' || body.placeId.trim() === '') {
        problems.push(`${label}.payload.placeId 必须是非空字符串`);
      }
      if (!isPoint(body.at)) problems.push(`${label}.payload.at 必须是 { x, y }`);
      if (!Array.isArray(body.actors) || body.actors.some((item) => typeof item !== 'string')) {
        problems.push(`${label}.payload.actors 必须是字符串数组`);
      }
      if (
        body.witnesses !== undefined
        && (!Array.isArray(body.witnesses) || body.witnesses.some((item) => typeof item !== 'string'))
      ) {
        problems.push(`${label}.payload.witnesses 必须是字符串数组`);
      }
      for (const key of ['valence', 'arousal', 'importanceHint'] as const) {
        if (body[key] !== undefined && typeof body[key] !== 'number') {
          problems.push(`${label}.payload.${key} 必须是数字`);
        }
      }
      if (body.what !== undefined && typeof body.what !== 'string') {
        problems.push(`${label}.payload.what 必须是字符串`);
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

function baselineProblems(value: unknown, initialNow: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value !== 'object' || value === null) return ['baseline 必须是 { source, save }'];
  const baseline = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof baseline.source !== 'string' || baseline.source.trim() === '') {
    problems.push('baseline.source 必须是非空字符串');
  }
  const save = baseline.save;
  if (typeof save !== 'object' || save === null) {
    problems.push('baseline.save 必须是 WorldSave');
    return problems;
  }
  const record = save as Record<string, unknown>;
  if (record.schemaVersion !== 5) problems.push('baseline.save.schemaVersion 必须是 5');
  const world = record.world;
  if (typeof world !== 'object' || world === null) {
    problems.push('baseline.save.world 必须是对象');
  } else {
    const body = world as Record<string, unknown>;
    if (!isInteger(body.now) || body.now < 0) problems.push('baseline.save.world.now 必须是非负整数');
    if (isInteger(initialNow) && isInteger(body.now) && body.now !== initialNow) {
      problems.push(`initialNow=${initialNow} 与存档 world.now=${body.now} 不一致`);
    }
    if (typeof body.memory !== 'string') problems.push('baseline.save.world.memory 必须是字符串');
    if (!Array.isArray(body.buildings)) problems.push('baseline.save.world.buildings 必须是数组');
    if (!Array.isArray(body.villagers)) problems.push('baseline.save.world.villagers 必须是数组');
  }
  return problems;
}

function outerProblems(value: unknown): string[] {
  if (value === undefined) return ['pwe-trace/2 必须带 outer：{ memory, creator }'];
  if (typeof value !== 'object' || value === null) return ['outer 必须是 { memory, creator }'];
  const outer = value as Record<string, unknown>;
  if (typeof outer.memory !== 'boolean') return ['outer.memory 必须是布尔值'];
  if (typeof outer.creator !== 'boolean') return ['outer.creator 必须是布尔值'];
  return [];
}

function isPoint(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Record<string, unknown>;
  return isInteger(point.x) && isInteger(point.y);
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
