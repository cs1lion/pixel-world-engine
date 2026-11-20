/**
 * 命运分叉沙盘内核：多世界线树 + 转折日自动标注 + 蝴蝶印记。
 *
 * 职责边界：
 * 1. 纯确定性转折日检测 `detectTurnpoints(prevMetrics, currMetrics, day)`：
 *    基于相邻两日业务向量（建筑增量、信念骤降/飙升、极端天气、阶段切换），
 *    每日最多输出 2 条结构化转折记录 `TurnpointBadge`（展示文案交由表现层/UI 格式化）。
 * 2. 多世界线树 `WorldlineTree`（默认 `maxBranches = 4`，始终保留 `branch-0` 主线）：
 *    支持日结记录、任意历史日分叉、蝴蝶干预印记（每线最多记前 3 条）、
 *    分支无损切换、对照父线最大天数 `getParityDay`、树摘要与确定性序列化/反序列化。
 *
 * 纯度约束：本模块仅依赖同层 `./trajectory-recorder.ts` 类型，不依赖时钟、随机数或任何
 * `src/world/` 以外的上层模块；所有输出与序列化结果 100% 确定性。
 */

import type { TrajectoryMetrics } from './trajectory-recorder.ts';

export const MAIN_BRANCH_ID = 'branch-0';
export const DEFAULT_MAX_BRANCHES = 4;
export const MAX_TURNPOINTS_PER_DAY = 2;
export const MAX_INTERVENTIONS_PER_BRANCH = 3;

export interface WorldlineDayMetrics extends TrajectoryMetrics {
  readonly phase?: string | null;
}

export type TurnpointKind =
  | 'phase_shift'
  | 'extreme_weather'
  | 'belief_drop'
  | 'belief_surge'
  | 'building_growth';

export interface TurnpointBadge {
  readonly day: number;
  readonly kind: TurnpointKind;
  readonly severity: number;
  readonly token?: string;
  readonly delta?: number;
}

export interface InterventionStamp {
  readonly day: number;
  readonly kind: string;
  readonly label: string;
  readonly targetId?: string;
}

export interface WorldlineDayRecord {
  readonly day: number;
  readonly stateFingerprint: string;
  readonly metrics: WorldlineDayMetrics;
  readonly turnpoints: readonly TurnpointBadge[];
}

export interface WorldlineTreeOptions {
  readonly worldId?: string;
  readonly maxBranches?: number;
  readonly maxInterventionsPerBranch?: number;
}

export interface ForkResult {
  readonly branchId: string;
  readonly parentBranchId: string;
  readonly forkDay: number;
  readonly forkFromDay: number;
  readonly evictedBranchId: string | null;
}

export interface SwitchBranchResult {
  readonly ok: boolean;
  readonly branchId: string;
  readonly previousBranchId: string;
  readonly latestDay: number | null;
  readonly record: WorldlineDayRecord | null;
}

export interface WorldlineBranchSummary {
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly isMain: boolean;
  readonly isActive: boolean;
  readonly forkDay: number | null;
  readonly forkFromDay: number | null;
  readonly minDay: number | null;
  readonly maxDay: number | null;
  readonly dayCount: number;
  readonly parityDay: number | null;
  readonly turnpoints: readonly TurnpointBadge[];
  readonly interventions: readonly InterventionStamp[];
}

export interface WorldlineTreeSummary {
  readonly worldId: string;
  readonly activeBranchId: string;
  readonly maxBranches: number;
  readonly branchCount: number;
  readonly branches: readonly WorldlineBranchSummary[];
}

export interface SerializedWorldlineBranch {
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly forkDay: number | null;
  readonly forkFromDay: number | null;
  readonly createdOrder: number;
  readonly days: readonly WorldlineDayRecord[];
  readonly interventions: readonly InterventionStamp[];
}

export interface SerializedWorldlineTree {
  readonly version: 1;
  readonly worldId: string;
  readonly maxBranches: number;
  readonly maxInterventionsPerBranch: number;
  readonly activeBranchId: string;
  readonly branchSeq: number;
  readonly branches: readonly SerializedWorldlineBranch[];
}

interface InternalBranchState {
  readonly branchId: string;
  readonly parentBranchId: string | null;
  readonly forkDay: number | null;
  readonly forkFromDay: number | null;
  readonly createdOrder: number;
  readonly days: Map<number, WorldlineDayRecord>;
  readonly interventions: InterventionStamp[];
}

const BELIEF_DELTA_ABS_THRESHOLD = 3;
const BELIEF_DELTA_RATIO_THRESHOLD = 0.3;
const BELIEF_RATIO_MIN_BASE = 4;

const EXTREME_WEATHER_TOKENS: readonly string[] = [
  'thunderstorm',
  'snowstorm',
  'blizzard',
  'sandstorm',
  'hurricane',
  'typhoon',
  'cyclone',
  'heatwave',
  'heavy_rain',
  'drought',
  'flood',
  'storm',
  'tempest',
];

function matchExtremeWeatherToken(weather: string): string | null {
  const normalized = weather.trim().toLowerCase();
  if (!normalized) return null;
  for (const token of EXTREME_WEATHER_TOKENS) {
    if (normalized.includes(token)) {
      return token;
    }
  }
  return null;
}

function normalizePhase(phase: string | null | undefined): string | null {
  if (typeof phase !== 'string') return null;
  const trimmed = phase.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMetrics(metrics: WorldlineDayMetrics): WorldlineDayMetrics {
  const base: TrajectoryMetrics = {
    buildingsCount: Number.isFinite(metrics.buildingsCount) ? metrics.buildingsCount : 0,
    roadsCount: Number.isFinite(metrics.roadsCount) ? metrics.roadsCount : 0,
    beliefsCount: Number.isFinite(metrics.beliefsCount) ? metrics.beliefsCount : 0,
    factsCount: Number.isFinite(metrics.factsCount) ? metrics.factsCount : 0,
    weather: String(metrics.weather ?? 'clear'),
  };
  const phase = normalizePhase(metrics.phase);
  return phase === null ? base : { ...base, phase };
}

function cloneBadge(b: TurnpointBadge): TurnpointBadge {
  return {
    day: b.day,
    kind: b.kind,
    severity: b.severity,
    ...(b.token !== undefined ? { token: b.token } : {}),
    ...(b.delta !== undefined ? { delta: b.delta } : {}),
  };
}

function cloneIntervention(stamp: InterventionStamp): InterventionStamp {
  return stamp.targetId !== undefined
    ? { day: stamp.day, kind: stamp.kind, label: stamp.label, targetId: stamp.targetId }
    : { day: stamp.day, kind: stamp.kind, label: stamp.label };
}

function cloneDayRecord(record: WorldlineDayRecord): WorldlineDayRecord {
  return {
    day: record.day,
    stateFingerprint: record.stateFingerprint,
    metrics: normalizeMetrics(record.metrics),
    turnpoints: record.turnpoints.map(cloneBadge),
  };
}

function compareStringAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 纯确定性转折日检测：比较前一日与当日业务向量，识别阶段切换、极端天气、
 * 信念骤降/飙升与建筑增量，按严重度与类型确定性排序，每日最多返回 2 条中文短标签。
 */
export function detectTurnpoints(
  prevMetrics: WorldlineDayMetrics | null | undefined,
  currMetrics: WorldlineDayMetrics,
  day: number,
): readonly TurnpointBadge[] {
  const curr = normalizeMetrics(currMetrics);
  const prev = prevMetrics ? normalizeMetrics(prevMetrics) : null;
  const candidates: TurnpointBadge[] = [];

  // 1. 阶段切换（最高优先级）
  const prevPhase = normalizePhase(prev?.phase);
  const currPhase = normalizePhase(curr.phase);
  if (prevPhase !== null && currPhase !== null && prevPhase !== currPhase) {
    candidates.push({
      day,
      kind: 'phase_shift',
      token: `进入${currPhase}`,
      severity: 4,
    });
  }

  // 2. 极端天气（首次进入或首日即遭遇极端天气）
  const extremeToken = matchExtremeWeatherToken(curr.weather);
  const prevWeatherNorm = prev ? prev.weather.trim().toLowerCase() : '';
  const currWeatherNorm = curr.weather.trim().toLowerCase();
  if (extremeToken !== null && currWeatherNorm !== prevWeatherNorm) {
    candidates.push({
      day,
      kind: 'extreme_weather',
      severity: 3,
      token: extremeToken,
    });
  }

  // 3. 信念骤降 / 飙升
  if (prev !== null) {
    const beliefDelta = curr.beliefsCount - prev.beliefsCount;
    const ratioTriggered =
      prev.beliefsCount >= BELIEF_RATIO_MIN_BASE &&
      Math.abs(beliefDelta) / prev.beliefsCount >= BELIEF_DELTA_RATIO_THRESHOLD;
    if (beliefDelta <= -BELIEF_DELTA_ABS_THRESHOLD || (beliefDelta < 0 && ratioTriggered)) {
      candidates.push({
        day,
        kind: 'belief_drop',
      severity: 2,
      delta: beliefDelta,
      });
    } else if (beliefDelta >= BELIEF_DELTA_ABS_THRESHOLD || (beliefDelta > 0 && ratioTriggered)) {
      candidates.push({
        day,
        kind: 'belief_surge',
      severity: 2,
      delta: beliefDelta,
      });
    }
  }

  // 4. 建筑增量
  if (prev !== null) {
    const buildingDelta = curr.buildingsCount - prev.buildingsCount;
    if (buildingDelta > 0) {
      candidates.push({
        day,
        kind: 'building_growth',
      severity: 1,
      delta: buildingDelta,
      });
    }
  }

  candidates.sort((a, b) => b.severity - a.severity || compareStringAsc(a.kind, b.kind));
  return candidates.slice(0, MAX_TURNPOINTS_PER_DAY);
}

/**
 * 多世界线树：管理主线 `branch-0` 与各分叉世界线，提供无损分支切换、
 * 超限淘汰最旧非主线、蝴蝶干预印记、父线对照日计算与确定性序列化。
 */
export class WorldlineTree {
  public readonly worldId: string;
  public readonly maxBranches: number;
  public readonly maxInterventionsPerBranch: number;

  private activeBranchId: string = MAIN_BRANCH_ID;
  private branchSeq = 0;
  private readonly branches = new Map<string, InternalBranchState>();

  constructor(options: WorldlineTreeOptions = {}) {
    this.worldId = options.worldId ?? 'default';
    const rawMax = options.maxBranches ?? DEFAULT_MAX_BRANCHES;
    this.maxBranches = Math.max(1, Math.floor(Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_BRANCHES));
    const rawMaxInt = options.maxInterventionsPerBranch ?? MAX_INTERVENTIONS_PER_BRANCH;
    this.maxInterventionsPerBranch = Math.max(
      0,
      Math.floor(Number.isFinite(rawMaxInt) ? rawMaxInt : MAX_INTERVENTIONS_PER_BRANCH),
    );

    this.branches.set(MAIN_BRANCH_ID, {
      branchId: MAIN_BRANCH_ID,
      parentBranchId: null,
      forkDay: null,
      forkFromDay: null,
      createdOrder: 0,
      days: new Map(),
      interventions: [],
    });
  }

  public getActiveBranchId(): string {
    return this.activeBranchId;
  }

  public getBranchIds(): readonly string[] {
    return this.sortedBranches().map((branch) => branch.branchId);
  }

  public getDayRecord(branchId: string, day: number): WorldlineDayRecord | undefined {
    const record = this.branches.get(branchId)?.days.get(day);
    return record ? cloneDayRecord(record) : undefined;
  }

  public getInterventions(branchId: string = this.activeBranchId): readonly InterventionStamp[] {
    const branch = this.branches.get(branchId);
    if (!branch) return [];
    return branch.interventions.map(cloneIntervention);
  }

  public getTurnpoints(branchId: string = this.activeBranchId): readonly TurnpointBadge[] {
    const branch = this.branches.get(branchId);
    if (!branch) return [];
    return this.collectBranchTurnpoints(branch);
  }

  /**
   * 在当前活跃世界线上记录第 `day` 天的状态向量与确定性转折日标签。
   */
  public recordDay(
    day: number,
    metrics: WorldlineDayMetrics,
    stateFingerprint = '',
  ): WorldlineDayRecord {
    const branch = this.requireBranch(this.activeBranchId);
    const prevRecord = this.findLatestRecordBefore(branch, day);
    const normalized = normalizeMetrics(metrics);
    const turnpoints = detectTurnpoints(prevRecord?.metrics ?? null, normalized, day);
    const record: WorldlineDayRecord = {
      day,
      stateFingerprint,
      metrics: normalized,
      turnpoints,
    };
    branch.days.set(day, record);
    return cloneDayRecord(record);
  }

  /**
   * 从当前活跃世界线在 `targetDay` 处分叉出新世界线（记录从 `fromDay` 回溯而来）。
   * 原世界线历史完整保留；若分支总数超过 `maxBranches`，自动淘汰最旧非主线（永不淘汰 `branch-0`）。
   */
  public forkAt(targetDay: number, fromDay: number): ForkResult {
    const parentBranchId = this.activeBranchId;
    const parentBranch = this.requireBranch(parentBranchId);

    this.branchSeq += 1;
    const newBranchId = `branch-${this.branchSeq}`;
    const copiedDays = new Map<number, WorldlineDayRecord>();
    const sortedDays = [...parentBranch.days.keys()].sort((a, b) => a - b);
    for (const d of sortedDays) {
      if (d <= targetDay) {
        const rec = parentBranch.days.get(d);
        if (rec) copiedDays.set(d, cloneDayRecord(rec));
      }
    }

    const nextBranch: InternalBranchState = {
      branchId: newBranchId,
      parentBranchId,
      forkDay: targetDay,
      forkFromDay: fromDay,
      createdOrder: this.branchSeq,
      days: copiedDays,
      interventions: [],
    };
    this.branches.set(newBranchId, nextBranch);

    let evictedBranchId: string | null = null;
    while (this.branches.size > this.maxBranches) {
      const candidate = this.findOldestEvictableBranch(newBranchId);
      if (candidate === null) break;
      this.branches.delete(candidate.branchId);
      evictedBranchId = candidate.branchId;
    }

    this.activeBranchId = newBranchId;
    return {
      branchId: newBranchId,
      parentBranchId,
      forkDay: targetDay,
      forkFromDay: fromDay,
      evictedBranchId,
    };
  }

  /**
   * 在当前活跃世界线上刻录一条蝴蝶干预印记。每条世界线最多保留前 3 条（超限忽略并返回 `false`）。
   */
  public recordIntervention(stamp: InterventionStamp): boolean {
    const branch = this.requireBranch(this.activeBranchId);
    if (branch.interventions.length >= this.maxInterventionsPerBranch) {
      return false;
    }
    branch.interventions.push(cloneIntervention(stamp));
    return true;
  }

  /**
   * 无损切换活跃世界线：原分支与目标分支的日结记录、转折标签与蝴蝶印记均保持不变。
   */
  public switchBranch(branchId: string): SwitchBranchResult {
    const previousBranchId = this.activeBranchId;
    const target = this.branches.get(branchId);
    if (!target) {
      return {
        ok: false,
        branchId,
        previousBranchId,
        latestDay: null,
        record: null,
      };
    }
    this.activeBranchId = branchId;
    const latestDay = this.maxDayOf(target);
    const latestRecord = latestDay === null ? null : target.days.get(latestDay) ?? null;
    return {
      ok: true,
      branchId,
      previousBranchId,
      latestDay,
      record: latestRecord ? cloneDayRecord(latestRecord) : null,
    };
  }

  /**
   * 返回 `branchId` 对照其父线的最大共同天数。
   * 主线无父线、目标分支不存在、父线已被淘汰或无共同天数时返回 `null`。
   */
  public getParityDay(branchId: string): number | null {
    const branch = this.branches.get(branchId);
    if (!branch || branch.parentBranchId === null) return null;
    const parent = this.branches.get(branch.parentBranchId);
    if (!parent) return null;

    let maxCommonDay: number | null = null;
    for (const day of branch.days.keys()) {
      if (!parent.days.has(day)) continue;
      if (maxCommonDay === null || day > maxCommonDay) {
        maxCommonDay = day;
      }
    }
    return maxCommonDay;
  }

  /**
   * 汇总整棵世界线树的结构、活跃状态、转折日标签、蝴蝶印记与对照父线天数。
   */
  public getTreeSummary(): WorldlineTreeSummary {
    const branches: WorldlineBranchSummary[] = this.sortedBranches().map((branch) => ({
      branchId: branch.branchId,
      parentBranchId: branch.parentBranchId,
      isMain: branch.branchId === MAIN_BRANCH_ID,
      isActive: branch.branchId === this.activeBranchId,
      forkDay: branch.forkDay,
      forkFromDay: branch.forkFromDay,
      minDay: this.minDayOf(branch),
      maxDay: this.maxDayOf(branch),
      dayCount: branch.days.size,
      parityDay: this.getParityDay(branch.branchId),
      turnpoints: this.collectBranchTurnpoints(branch),
      interventions: branch.interventions.map(cloneIntervention),
    }));

    return {
      worldId: this.worldId,
      activeBranchId: this.activeBranchId,
      maxBranches: this.maxBranches,
      branchCount: branches.length,
      branches,
    };
  }

  /**
   * 导出规范有序的可序列化对象（供确定性 JSON 持久化）。
   */
  public toJSON(): SerializedWorldlineTree {
    const branches: SerializedWorldlineBranch[] = this.sortedBranches().map((branch) => {
      const days = [...branch.days.values()]
        .sort((a, b) => a.day - b.day)
        .map(cloneDayRecord);
      return {
        branchId: branch.branchId,
        parentBranchId: branch.parentBranchId,
        forkDay: branch.forkDay,
        forkFromDay: branch.forkFromDay,
        createdOrder: branch.createdOrder,
        days,
        interventions: branch.interventions.map(cloneIntervention),
      };
    });

    return {
      version: 1,
      worldId: this.worldId,
      maxBranches: this.maxBranches,
      maxInterventionsPerBranch: this.maxInterventionsPerBranch,
      activeBranchId: this.activeBranchId,
      branchSeq: this.branchSeq,
      branches,
    };
  }

  /**
   * 确定性序列化为 JSON 字符串：相同状态在任何时刻产出完全一致的字节序列。
   */
  public serialize(): string {
    return JSON.stringify(this.toJSON());
  }

  /**
   * 从确定性序列化结果无损恢复多世界线树。
   */
  public static deserialize(input: string | SerializedWorldlineTree): WorldlineTree {
    const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('WorldlineTree 反序列化失败：输入必须是对象或合法 JSON 字符串');
    }
    const raw = parsed as Partial<SerializedWorldlineTree>;
    if (raw.version !== 1 || !Array.isArray(raw.branches)) {
      throw new Error('WorldlineTree 反序列化失败：不支持的版本或缺少 branches');
    }

    const tree = new WorldlineTree({
      worldId: typeof raw.worldId === 'string' ? raw.worldId : 'default',
      maxBranches: typeof raw.maxBranches === 'number' ? raw.maxBranches : DEFAULT_MAX_BRANCHES,
      maxInterventionsPerBranch:
        typeof raw.maxInterventionsPerBranch === 'number'
          ? raw.maxInterventionsPerBranch
          : MAX_INTERVENTIONS_PER_BRANCH,
    });

    tree.branches.clear();
    let maxOrder = 0;
    const sortedInput = [...raw.branches].sort((a, b) => a.createdOrder - b.createdOrder);
    for (const item of sortedInput) {
      const daysMap = new Map<number, WorldlineDayRecord>();
      const sortedDays = [...item.days].sort((a, b) => a.day - b.day);
      for (const rec of sortedDays) {
        daysMap.set(rec.day, cloneDayRecord(rec));
      }
      const interventions = item.interventions
        .slice(0, tree.maxInterventionsPerBranch)
        .map(cloneIntervention);
      const order = Number.isFinite(item.createdOrder) ? item.createdOrder : 0;
      if (order > maxOrder) maxOrder = order;
      tree.branches.set(item.branchId, {
        branchId: item.branchId,
        parentBranchId: item.parentBranchId ?? null,
        forkDay: item.forkDay ?? null,
        forkFromDay: item.forkFromDay ?? null,
        createdOrder: order,
        days: daysMap,
        interventions,
      });
    }

    if (!tree.branches.has(MAIN_BRANCH_ID)) {
      tree.branches.set(MAIN_BRANCH_ID, {
        branchId: MAIN_BRANCH_ID,
        parentBranchId: null,
        forkDay: null,
        forkFromDay: null,
        createdOrder: 0,
        days: new Map(),
        interventions: [],
      });
    }

    tree.branchSeq =
      typeof raw.branchSeq === 'number' && Number.isFinite(raw.branchSeq)
        ? Math.max(raw.branchSeq, maxOrder)
        : maxOrder;
    tree.activeBranchId =
      typeof raw.activeBranchId === 'string' && tree.branches.has(raw.activeBranchId)
        ? raw.activeBranchId
        : MAIN_BRANCH_ID;

    return tree;
  }

  // ------------------------------------------------------------------ 内部工具

  private requireBranch(branchId: string): InternalBranchState {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`WorldlineTree 内部状态异常：找不到分支 ${branchId}`);
    }
    return branch;
  }

  private sortedBranches(): readonly InternalBranchState[] {
    return [...this.branches.values()].sort(
      (a, b) => a.createdOrder - b.createdOrder || compareStringAsc(a.branchId, b.branchId),
    );
  }

  private findLatestRecordBefore(
    branch: InternalBranchState,
    day: number,
  ): WorldlineDayRecord | null {
    let bestDay: number | null = null;
    for (const d of branch.days.keys()) {
      if (d >= day) continue;
      if (bestDay === null || d > bestDay) bestDay = d;
    }
    return bestDay === null ? null : branch.days.get(bestDay) ?? null;
  }

  private findOldestEvictableBranch(excludeBranchId: string): InternalBranchState | null {
    let oldest: InternalBranchState | null = null;
    for (const branch of this.branches.values()) {
      if (branch.branchId === MAIN_BRANCH_ID || branch.branchId === excludeBranchId) continue;
      if (oldest === null || branch.createdOrder < oldest.createdOrder) {
        oldest = branch;
      }
    }
    return oldest;
  }

  private minDayOf(branch: InternalBranchState): number | null {
    let minDay: number | null = null;
    for (const d of branch.days.keys()) {
      if (minDay === null || d < minDay) minDay = d;
    }
    return minDay;
  }

  private maxDayOf(branch: InternalBranchState): number | null {
    let maxDay: number | null = null;
    for (const d of branch.days.keys()) {
      if (maxDay === null || d > maxDay) maxDay = d;
    }
    return maxDay;
  }

  private collectBranchTurnpoints(branch: InternalBranchState): readonly TurnpointBadge[] {
    const out: TurnpointBadge[] = [];
    const sortedDays = [...branch.days.keys()].sort((a, b) => a - b);
    for (const d of sortedDays) {
      const rec = branch.days.get(d);
      if (!rec) continue;
      for (const badge of rec.turnpoints) {
        out.push(cloneBadge(badge));
      }
    }
    return out;
  }
}
