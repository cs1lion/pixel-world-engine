/** 造物账本（提案 B）：每件造物一条可审计记录，只增不改。
 *
 * ## 为什么要有它
 *
 * 门禁（`world/creator/metrics.ts` 与 `fuse.ts`）算的是一组比率与布尔，
 * 但它们只在**窗口**上留一个数。世界日一过、窗口一清零，就只剩一句
 * 「当时是达标的」——没有哪一项读数、没有实际值、没有分母。于是当一栋楼
 * 明明落不下去、或者落了却被拆，没人拿得出「门禁当时看到了什么」。
 *
 * 这份账本把**一次造物**拆成三条只增记录：
 *
 * | 记录 | 何时写 | 记什么 |
 * | --- | --- | --- |
 * | `creation` | 提案那一刻（无论过不过） | 提案本身、逐项门禁读数、熔断等级与爬梯状态、拒绝原因 |
 * | `landing` | 楼真的落地（或确认没落地） | 是否落地、建筑 id、落地后补测的四项 |
 * | `observation` | 落地后第 7 个世界日 | 仍在 / 被拆 / 被改 / 不见了 |
 *
 * `creation` 一条对应一次提案；`landing` / `observation` 用 `proposalId`
 * 挂回去。读取方用 `foldLedger()` 折成「每件造物一条」的视图，原始 JSONL
 * 仍是一行一条、只追加。
 *
 * ## 三条纪律
 *
 * 1. **不改历史**：这里只提供构造与解析，写由 `ledger-file.ts` / 服务端
 *    以追加方式做。任何「补写上一行」的接口都不存在。
 * 2. **没测就是 `null`**：门禁项没跑到就记 `null`，不默认 `true`/`1.0`。
 *    拒绝原因由此分成「真不达标」（below_requirement）与「分母为 0 /
 *    样本不足」（not_measured）——这两种处置完全不同。
 * 3. **不碰 v5 存档**：账本是外挂日志，`world.memory` 与存档契约都不动。
 */

import type { GridPoint } from '../world/types.ts';
import type { CreationPlan } from '../world/creator-schema.ts';
import {
  ratesOf,
  type CreatorRoleState,
  type FuseDecision,
  type MetricRates,
} from '../world/creator/fuse.ts';
import { hash32 } from '../world/memory/seed.ts';
import { creationFingerprint, type LandedCreation } from './landing.ts';

/** 账本格式版本。与存档 `CURRENT_SCHEMA_VERSION` 无关，各走各的。 */
export const CREATION_LEDGER_VERSION = 1 as const;

// ============================================================================
// 门禁读数
// ============================================================================

/** 门禁阈值。**改这里等于改门禁**——值必须与 `fuse.ts` / `metrics.ts` 同源。 */
export const CREATION_GATE_THRESHOLDS = {
  schema: '= true',
  placement: '= true',
  /** 与 `fuse.ts` 的 `qualityGatesFor` 同一个 0.95。 */
  coverage: '>= 0.95',
  pathfinding: '= true',
  collision: '= false',
  constraint: '= true',
  traceability: '= true',
  invariant: '= false',
  replay: '= true',
  fuse: '= allow',
} as const;

export type GateName = keyof typeof CREATION_GATE_THRESHOLDS;
export type GatePhase = 'proposal' | 'landing';
export type GateReason = 'pass' | 'below_requirement' | 'not_measured' | 'not_applicable';

/** 一项门禁的读数。`observed` 是**实际看到的**值，不是结论。 */
export interface GateReading {
  readonly name: GateName;
  /** 提案阶段或落地后阶段。落地后的项在提案时一律是 `not_measured`。 */
  readonly phase: GatePhase;
  /** 观测值：布尔、比率、或熔断动作字符串；`null` = 没测到。 */
  readonly observed: number | boolean | string | null;
  readonly threshold: string;
  readonly passed: boolean | null;
  readonly reason: GateReason;
  readonly detail?: string;
}

/**
 * 拒绝原因：**哪一项没过、实际值多少、是真不达标还是没测到**。
 *
 * `kind` 不是装饰：`not_measured` 是「分母为 0 / 样本不足」，
 * 正确处置是回去补测；`below_requirement` 才是「测了，不达标」。
 */
export interface RejectionReason {
  readonly gate: GateName;
  readonly observed: number | boolean | string | null;
  readonly threshold: string;
  readonly kind: 'below_requirement' | 'not_measured';
  readonly detail: string;
}

/** 爬梯状态快照。数来自 `AutonomousFuseController`，不是账本自己猜的。 */
export interface LadderSnapshot {
  readonly level: number;
  readonly levelName: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  readonly targetLevel: number;
  readonly isFused: boolean;
  readonly action: FuseDecision['action'] | 'not_applicable';
  readonly reason: string;
  readonly metrics: MetricRates;
}

export function levelName(level: number): LadderSnapshot['levelName'] {
  return (['L0', 'L1', 'L2', 'L3', 'L4'][level] ?? 'L0') as LadderSnapshot['levelName'];
}

/** 从熔断器状态与决策折出一份快照。 */
export function ladderSnapshot(
  state: CreatorRoleState,
  decision: FuseDecision,
): LadderSnapshot {
  return {
    level: state.currentLevel,
    levelName: levelName(state.currentLevel),
    targetLevel: state.targetLevel,
    isFused: state.isFused,
    action: decision.action,
    reason: decision.reason,
    metrics: ratesOf(state.metrics),
  };
}

/**
 * 不是造物引擎发起的落地（神谕造物、调试入口）也记等级，但**门禁没跑**。
 *
 * 这里不伪造一个 `allow`：`not_applicable` 才是真话。
 */
export function passiveLadderSnapshot(state: CreatorRoleState): LadderSnapshot {
  return {
    level: state.currentLevel,
    levelName: levelName(state.currentLevel),
    targetLevel: state.targetLevel,
    isFused: state.isFused,
    action: 'not_applicable',
    reason: '这次造物不是造物引擎的提议',
    metrics: ratesOf(state.metrics),
  };
}

// ============================================================================
// 门禁逐项读数
// ============================================================================

export type CreationOrigin = 'manual' | 'auto' | 'oracle' | 'world';

export interface GateInput {
  readonly origin: CreationOrigin;
  readonly schemaPassed: boolean;
  readonly placementPassed: boolean;
  readonly builtPrefabIds: ReadonlySet<string>;
  readonly blueprintCount: number;
  readonly templateId: string;
  readonly fuseAction: LadderSnapshot['action'];
  readonly fuseReason: string;
  readonly traceable: boolean;
  readonly schemaDetail?: string;
  readonly placementDetail?: string;
  /** 以下只在**落地后**才有值；提案时省略。 */
  readonly pathfindingConnected?: boolean | null;
  readonly hasCollision?: boolean | null;
  readonly spatialConstraintSatisfied?: boolean | null;
  readonly invariantViolated?: boolean | null;
  readonly replayHashConsistent?: boolean | null;
  /** 落地后现算的真实覆盖率（已落地模板数 / 模板总数）。 */
  readonly actualCoverageRate?: number | null;
}

/**
 * 覆盖率读数：**这次造物之后**的覆盖率。
 *
 * 用「建完之后」而不是「建之前」，是因为门禁问的是「这个世界够不够丰富」。
 * 莞尔镇 12 栋里已落 11 栋、这一栋补上第 12 种 → 12/12 = 1.0，该过；
 * 30 种模板里只落了 1 种、这一栋补成 2 种 → 2/30 ≈ 0.067，该拒。
 * 分母为 0 时返回 `null`，由调用方记成 `not_measured`——不是 0/0 当成 1。
 */
export function coverageAfterBuild(
  builtPrefabIds: ReadonlySet<string>,
  blueprintCount: number,
  templateId: string,
): { observed: number | null; detail: string } {
  if (blueprintCount <= 0) {
    return { observed: null, detail: '分母为 0：这份设定集没有模板' };
  }
  const adds = builtPrefabIds.has(templateId) ? 0 : 1;
  const seen = Math.min(blueprintCount, builtPrefabIds.size + adds);
  return {
    observed: seen / blueprintCount,
    detail: `已落地 ${builtPrefabIds.size}/${blueprintCount} 种；本提案补 ${adds} 种 → ${seen}/${blueprintCount}`,
  };
}

function reading(
  name: GateName,
  phase: GatePhase,
  passed: boolean | null,
  observed: number | boolean | string | null,
  threshold: string,
  detail?: string,
  reason?: GateReason,
): GateReading {
  return {
    name,
    phase,
    observed,
    threshold,
    passed,
    reason: reason ?? (passed === null ? 'not_measured' : passed ? 'pass' : 'below_requirement'),
    ...(detail === undefined ? {} : { detail }),
  };
}

/** 提案阶段的门禁。落地后才成立的五项在这里是 `not_measured`，不是通过。 */
export function evaluateProposalGates(input: GateInput): GateReading[] {
  const coverage = coverageAfterBuild(
    input.builtPrefabIds,
    input.blueprintCount,
    input.templateId,
  );
  return [
    reading('schema', 'proposal', input.schemaPassed, input.schemaPassed, CREATION_GATE_THRESHOLDS.schema, input.schemaDetail),
    reading('placement', 'proposal', input.placementPassed, input.placementPassed, CREATION_GATE_THRESHOLDS.placement, input.placementDetail),
    reading(
      'coverage',
      'proposal',
      coverage.observed === null ? null : coverage.observed >= 0.95,
      coverage.observed,
      CREATION_GATE_THRESHOLDS.coverage,
      coverage.detail,
    ),
    reading('traceability', 'proposal', input.traceable, input.traceable, CREATION_GATE_THRESHOLDS.traceability),
    input.origin !== 'auto'
      ? reading('fuse', 'proposal', null, null, CREATION_GATE_THRESHOLDS.fuse, '人工/神谕入口不走自动放行门禁', 'not_applicable')
      : reading(
          'fuse',
          'proposal',
          input.fuseAction === 'allow',
          input.fuseAction,
          CREATION_GATE_THRESHOLDS.fuse,
          input.fuseReason,
        ),
    reading('pathfinding', 'landing', null, null, CREATION_GATE_THRESHOLDS.pathfinding, '落地后才结算'),
    reading('collision', 'landing', null, null, CREATION_GATE_THRESHOLDS.collision, '落地后才结算'),
    reading('constraint', 'landing', null, null, CREATION_GATE_THRESHOLDS.constraint, '落地后才结算'),
    reading('invariant', 'landing', null, null, CREATION_GATE_THRESHOLDS.invariant, '落地后才结算'),
    reading('replay', 'landing', null, null, CREATION_GATE_THRESHOLDS.replay, '落地后才结算'),
  ];
}

/** 落地后补测的门禁。覆盖率在这一刻现算，不沿用提案时的预测。 */
export function evaluateLandingGates(input: GateInput): GateReading[] {
  const coverage = input.actualCoverageRate ?? null;
  return [
    reading(
      'coverage',
      'landing',
      coverage === null ? null : coverage >= 0.95,
      coverage,
      CREATION_GATE_THRESHOLDS.coverage,
      coverage === null ? '分母为 0：这份设定集没有模板' : `落地后实测 ${coverage.toFixed(4)}`,
    ),
    reading('pathfinding', 'landing', input.pathfindingConnected ?? null, input.pathfindingConnected ?? null, CREATION_GATE_THRESHOLDS.pathfinding),
    reading(
      'collision',
      'landing',
      input.hasCollision === undefined || input.hasCollision === null ? null : !input.hasCollision,
      input.hasCollision ?? null,
      CREATION_GATE_THRESHOLDS.collision,
    ),
    reading('constraint', 'landing', input.spatialConstraintSatisfied ?? null, input.spatialConstraintSatisfied ?? null, CREATION_GATE_THRESHOLDS.constraint),
    reading(
      'invariant',
      'landing',
      input.invariantViolated === undefined || input.invariantViolated === null ? null : !input.invariantViolated,
      input.invariantViolated ?? null,
      CREATION_GATE_THRESHOLDS.invariant,
    ),
    reading('replay', 'landing', input.replayHashConsistent ?? null, input.replayHashConsistent ?? null, CREATION_GATE_THRESHOLDS.replay),
    reading('traceability', 'landing', input.traceable, input.traceable, CREATION_GATE_THRESHOLDS.traceability),
  ];
}

// ============================================================================
// 判决与拒绝原因
// ============================================================================

/** 自动提议必须过的四项。人工确认只受前两项约束——人已经看过其余项。 */
const AUTO_BLOCKING: readonly GateName[] = ['schema', 'placement', 'coverage', 'fuse'];
const MANUAL_BLOCKING: readonly GateName[] = ['schema', 'placement'];

export interface CreationVerdict {
  readonly verdict: 'accepted' | 'rejected';
  readonly rejection: RejectionReason | null;
  /** 人工确认放行、但读数没达标的那几项。不藏起来。 */
  readonly overrides: readonly GateName[];
}

function rejectionOf(reading: GateReading): RejectionReason {
  return {
    gate: reading.name,
    observed: reading.observed,
    threshold: reading.threshold,
    kind: reading.reason === 'not_measured' ? 'not_measured' : 'below_requirement',
    detail: reading.detail ?? `${reading.name} 读数 ${String(reading.observed)} ${reading.threshold}`,
  };
}

/**
 * 判决：自动提议按四项硬门禁；人工确认的覆盖率与熔断**只记不拦**。
 *
 * 这不是放水：L0–L2 的自治规则本来就是「需要人工确认」，人点了头就是那份
 * 确认。账本仍把没达标的读数原样记下，`overrides` 写明是哪几项。
 */
export function creationVerdict(
  origin: CreationOrigin,
  gates: readonly GateReading[],
): CreationVerdict {
  const blocking = origin === 'auto' ? AUTO_BLOCKING : MANUAL_BLOCKING;
  const proposal = gates.filter((gate) => gate.phase === 'proposal');
  const overrides = proposal
    .filter((gate) => gate.passed === false && !blocking.includes(gate.name))
    .map((gate) => gate.name);

  let firstFailure: GateReading | null = null;
  for (const name of blocking) {
    const gate = proposal.find((item) => item.name === name);
    if (gate !== undefined && gate.passed !== true) {
      firstFailure = gate;
      break;
    }
  }
  if (firstFailure === null) {
    return { verdict: 'accepted', rejection: null, overrides };
  }

  const others = proposal.filter(
    (gate) => gate.passed !== true && gate.name !== firstFailure!.name,
  );
  const suffix = others.length === 0
    ? ''
    : `；另有 ${others
        .map((gate) => `${gate.name}=${String(gate.observed)}（${gate.reason}）`)
        .join('、')}`;
  const rejection = rejectionOf(firstFailure);
  return {
    verdict: 'rejected',
    rejection: {
      ...rejection,
      detail: `${rejection.detail}${suffix}`,
    },
    overrides,
  };
}

// ============================================================================
// 回放指纹
// ============================================================================

/**
 * 一条可回放的指纹：种子 + 事件区间 + 计划/落地。
 *
 * `eventFrom` / `eventTo` 是上游事件日志的游标（`snapshot.feed.cursor`）。
 * 离线跑的时候两端都是 0；这一点由调用方如实写，不拿世界时间冒充事件 id。
 */
export interface ReplayStamp {
  readonly seed: string;
  readonly eventFrom: number;
  readonly eventTo: number;
  readonly dayFrom: number;
  readonly dayTo: number;
  readonly fingerprint: string;
}

export function proposalFingerprint(seed: string, day: number, plan: CreationPlan): string {
  const parts = [
    seed,
    day,
    plan.templateId,
    plan.at.x,
    plan.at.y,
    plan.palette.body,
    plan.palette.roof,
    plan.palette.trim,
    plan.palette.window,
  ];
  return hash32(parts.join('\u0000')).toString(16).padStart(8, '0');
}

export function landingFingerprint(
  seed: string,
  day: number,
  plan: CreationPlan,
  landed: LandedCreation,
): string {
  // 落点由 `creationFingerprint` 覆盖；再套一层种子，回放时种子必须一致。
  return hash32(
    [seed, creationFingerprint(plan, landed, day)].join('\u0000'),
  )
    .toString(16)
    .padStart(8, '0');
}

// ============================================================================
// 记录
// ============================================================================

export interface CreationRecordInput {
  readonly recordId: string;
  readonly worldId: string;
  readonly seed: string;
  readonly day: number;
  readonly at: number;
  readonly templateId: string;
  readonly templateName: string;
  /** 模板类型：`blueprint.zone`（living / industry / …）。 */
  readonly templateKind: string;
  readonly intentText: string | null;
  readonly target: GridPoint;
  readonly origin: CreationOrigin;
  readonly gates: readonly GateReading[];
  readonly ladder: LadderSnapshot;
  readonly replay: ReplayStamp;
}

export interface CreationRecord extends CreationRecordInput {
  readonly kind: 'creation';
  readonly ledgerVersion: typeof CREATION_LEDGER_VERSION;
  readonly verdict: 'accepted' | 'rejected';
  readonly rejection: RejectionReason | null;
  /** 拒绝原因的主门禁名，便于按拒绝原因查询；没拒就是 `null`。 */
  readonly rejectionGate: GateName | null;
  readonly overrides: readonly GateName[];
  /** 创建记录里永远是 `null`；落地由 `landing` 记录补。 */
  readonly landing: null;
}

export function buildCreationRecord(input: CreationRecordInput): CreationRecord {
  const decision = creationVerdict(input.origin, input.gates);
  return {
    ...input,
    kind: 'creation',
    ledgerVersion: CREATION_LEDGER_VERSION,
    verdict: decision.verdict,
    rejection: decision.rejection,
    rejectionGate: decision.rejection?.gate ?? null,
    overrides: decision.overrides,
    landing: null,
  };
}

export interface LandingRecordInput {
  readonly proposalId: string;
  readonly worldId: string;
  readonly seed: string;
  readonly day: number;
  readonly at: number;
  readonly templateId: string;
  readonly landed: boolean;
  readonly buildingId: string | null;
  readonly origin: GridPoint | null;
  readonly door: GridPoint | null;
  readonly gates: readonly GateReading[];
  readonly replay: ReplayStamp;
  /** 没落地时的原因；落地了就是 `null`。 */
  readonly failure: RejectionReason | null;
}

export interface LandingRecord extends LandingRecordInput {
  readonly kind: 'landing';
  readonly ledgerVersion: typeof CREATION_LEDGER_VERSION;
  readonly recordId: string;
}

export function buildLandingRecord(input: LandingRecordInput): LandingRecord {
  return {
    ...input,
    kind: 'landing',
    ledgerVersion: CREATION_LEDGER_VERSION,
    recordId: `${input.proposalId}:landing`,
  };
}

export type ObservationStatus = 'still_present' | 'removed' | 'modified' | 'missing';

export interface ObservationRecordInput {
  readonly proposalId: string;
  readonly worldId: string;
  readonly day: number;
  readonly at: number;
  readonly dueDay: number;
  readonly buildingId: string | null;
  readonly status: ObservationStatus;
  readonly detail: string;
}

export interface ObservationRecord extends ObservationRecordInput {
  readonly kind: 'observation';
  readonly ledgerVersion: typeof CREATION_LEDGER_VERSION;
  readonly recordId: string;
}

export function buildObservationRecord(input: ObservationRecordInput): ObservationRecord {
  return {
    ...input,
    kind: 'observation',
    ledgerVersion: CREATION_LEDGER_VERSION,
    recordId: `${input.proposalId}:observation:${input.dueDay}`,
  };
}

export type LedgerRecord = CreationRecord | LandingRecord | ObservationRecord;

/** 存储层给每条记录补的两个字段：追加序号与服务端/写盘时刻。 */
export type StoredLedgerRecord = LedgerRecord & {
  readonly seq: number;
  readonly recordedAt: string;
};

// ============================================================================
// 7 日观测
// ============================================================================

/**
 * 落地后第几个**世界日**观测。
 *
 * 节奏 60 只改「一世界日现实里多长」（24 分钟），不改 `DAY_MS`：
 * `DAY_MS` 仍是 24 × 60 × 60 × 1000 世界毫秒，所以这个 7 是**世界日**，
 * 不是现实日。`at` / `dueDay` / `day` 全部用同一把世界时钟尺子。
 */
export const OBSERVATION_WINDOW_DAYS = 7;

/** 观测到期日 = 落地日 + 7 个世界日。纯整数世界日加法，不碰现实时钟。 */
export function observationDueDay(landingDay: number): number {
  return landingDay + OBSERVATION_WINDOW_DAYS;
}

export interface ObservationInput {
  /** 落地时记下的那一栋。 */
  readonly expected: {
    readonly prefabId: string;
    readonly origin: GridPoint;
    readonly door: GridPoint;
  };
  /** 此刻世界里的那一栋；已经被拆就是 `null`。 */
  readonly current: {
    readonly prefabId: string;
    readonly origin: GridPoint;
    readonly door: GridPoint;
    readonly displayName: string;
  } | null;
  /** 世界发过 `building.removed`。 */
  readonly removed: boolean;
  /** 记忆层给它起过的新名字；没改名就是 `null`。 */
  readonly renamedTo: string | null;
}

/**
 * 判定 7 日观测的三态。
 *
 * `modified` 只认两种**看得见**的改动：占地/门口真的变了，或者记忆层给了
 * 它另一个名字。世界今天没有第三种「改楼」的写入口，所以不编第四种状态。
 */
export function observationOf(input: ObservationInput): {
  readonly status: ObservationStatus;
  readonly detail: string;
} {
  const { expected, current } = input;
  if (current === null) {
    if (input.removed) {
      return { status: 'removed', detail: '世界发过 building.removed，这一栋已经不在了' };
    }
    return { status: 'missing', detail: '快照里找不到这一栋，也没有拆除记录——下落不明' };
  }
  if (
    current.prefabId !== expected.prefabId
    || current.origin.x !== expected.origin.x
    || current.origin.y !== expected.origin.y
    || current.door.x !== expected.door.x
    || current.door.y !== expected.door.y
  ) {
    return {
      status: 'modified',
      detail: `占地/门口变了：期望 ${expected.prefabId}@(${expected.origin.x},${expected.origin.y})，`
        + `现为 ${current.prefabId}@(${current.origin.x},${current.origin.y})`,
    };
  }
  if (input.renamedTo !== null && input.renamedTo !== current.displayName) {
    return {
      status: 'modified',
      detail: `被改了名：原叫「${current.displayName}」，记忆层现在叫「${input.renamedTo}」`,
    };
  }
  return { status: 'still_present', detail: `仍立在 (${current.origin.x},${current.origin.y})` };
}

// ============================================================================
// 折叠与查询
// ============================================================================

/** 读取端折出来的「每件造物一条」。 */
export interface FoldedCreationEntry {
  readonly recordId: string;
  readonly creation: CreationRecord;
  readonly landing: LandingRecord | null;
  readonly observations: readonly ObservationRecord[];
  readonly lastObservation: ObservationRecord | null;
}

function orderOf(record: LedgerRecord | StoredLedgerRecord): number {
  return 'seq' in record ? record.seq : record.at;
}

/**
 * 把三条只增记录折成「每件造物一条」。
 *
 * 只包含有 `creation` 的记录：没有提案就没有账。落地/观测记录挂不上的
 * 一律不猜归属，直接不折。
 */
export function foldLedger(
  records: readonly (LedgerRecord | StoredLedgerRecord)[],
): FoldedCreationEntry[] {
  const creations = new Map<string, CreationRecord>();
  const landings = new Map<string, LandingRecord>();
  const observations = new Map<string, ObservationRecord[]>();

  const ordered = [...records].sort((a, b) => orderOf(a) - orderOf(b));
  for (const record of ordered) {
    if (record.kind === 'creation') {
      // 同一条 recordId 只认第一次：只增日志里不该有第二条，真有也不覆盖。
      if (!creations.has(record.recordId)) creations.set(record.recordId, record);
    } else if (record.kind === 'landing') {
      if (!landings.has(record.proposalId)) landings.set(record.proposalId, record);
    } else {
      const list = observations.get(record.proposalId) ?? [];
      list.push(record);
      observations.set(record.proposalId, list);
    }
  }

  const entries: FoldedCreationEntry[] = [];
  for (const [recordId, creation] of creations) {
    const list = observations.get(recordId) ?? [];
    entries.push({
      recordId,
      creation,
      landing: landings.get(recordId) ?? null,
      observations: list,
      lastObservation: list[list.length - 1] ?? null,
    });
  }
  return entries.sort((a, b) => orderOf(a.creation) - orderOf(b.creation));
}

export interface LedgerQuery {
  readonly day?: number;
  readonly templateId?: string;
  readonly rejectionGate?: GateName;
  readonly verdict?: 'accepted' | 'rejected';
}

/** 按世界日 / 模板 / 拒绝原因查询。三个条件可以叠加。 */
export function queryLedger(
  records: readonly (LedgerRecord | StoredLedgerRecord)[],
  query: LedgerQuery = {},
): FoldedCreationEntry[] {
  return foldLedger(records).filter((entry) => {
    const { creation } = entry;
    if (query.day !== undefined && creation.day !== query.day) return false;
    if (query.templateId !== undefined && creation.templateId !== query.templateId) return false;
    if (query.rejectionGate !== undefined && creation.rejection?.gate !== query.rejectionGate) {
      return false;
    }
    if (query.verdict !== undefined && creation.verdict !== query.verdict) return false;
    return true;
  });
}

// ============================================================================
// JSONL 编解码
// ============================================================================

export function serializeLedgerRecord(
  record: LedgerRecord | StoredLedgerRecord,
): string {
  return JSON.stringify(record);
}

/**
 * 一行一条。空行跳过；坏行**抛错**，不静默跳过——一份读不全的账本比没有
 * 更糟，因为它看起来是完整的。
 */
export function parseLedgerJsonl(text: string): StoredLedgerRecord[] {
  const out: StoredLedgerRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`账本第 ${index + 1} 行不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isLedgerRecord(parsed)) {
      throw new Error(`账本第 ${index + 1} 行不是认识的记录（kind 缺失或版本不对）`);
    }
    out.push(parsed);
  }
  return out;
}

function isLedgerRecord(value: unknown): value is StoredLedgerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record['kind'] !== 'creation'
    && record['kind'] !== 'landing'
    && record['kind'] !== 'observation'
  ) {
    return false;
  }
  if (record['ledgerVersion'] !== CREATION_LEDGER_VERSION) return false;
  if (typeof record['recordId'] !== 'string' || record['recordId'] === '') return false;
  if (!Number.isInteger(record['seq']) || (record['seq'] as number) < 1) return false;
  if (typeof record['recordedAt'] !== 'string') return false;
  return true;
}

/** 账本在磁盘上的字节数（每行含结尾换行）。给体积读数用，不写盘。 */
export function ledgerByteLength(records: readonly (LedgerRecord | StoredLedgerRecord)[]): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const record of records) {
    total += encoder.encode(`${serializeLedgerRecord(record)}\n`).length;
  }
  return total;
}

/**
 * 新记录 id。只有审计用，不参与世界模拟，所以允许用 UUID。
 *
 * 重试同一条记录必须复用同一个 id（出队器把它连同 payload 一起攒着），
 * 服务端据此去重——这是「不丢、不重复」里「不重复」那一半。
 */
export function newRecordId(prefix: string): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === 'function') {
    return `${prefix}:${cryptoObject.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
