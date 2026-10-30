/** 双向熔断与自动降级机制（Circuit Breaker & Auto-Downgrade）
 *
 * **核心目标**：自治等级不是只升不降的单行道，防止长程运行中的累积漂移。
 *
 * **设计原则**（来自《补充架构设计 v1.0》第 2.2 节）：
 * 1. **升级条件**：连续 3 批或 14 个 world_day，自动检查通过率≥98% 且人工修改率≤2% → 升 1 级
 * 2. **降级触发**：单日摘要校验拒绝率 >10%，或不变式违反≥1 次，或人类回滚 → 立即降回 L1
 * 3. **熔断执行**：降级后切出隔离沙盒分支，**直至回归集回放测试重新达标**才允许恢复
 *
 * **三处曾经写错的语义，这里逐条钉住**：
 *
 * - **窗口要重置**。原实现只在升级时加数字，从不把窗口清零，于是连续三次成功后
 *   第 4、5、6 天照样「达标」，`L1 → L3` 两天就能走完，14 天形同虚设。
 *   升级即清零：爬到新等级要从零重新证明自己。
 * - **比率要能降**。原实现给每个比率写 `if (ok) rate = 1.0`，只有成功那一支，
 *   于是一次满分之后永远满分——这不是门禁，是棘轮。现在记分子与分母。
 * - **恢复要过回归集**。原实现 `allowResumeToTarget` 直接跳到 `targetLevel`，
 *   中间不查任何东西，正是 §2.2 明写要防的「熔断后自己跳回来」。
 *
 * **自治等级爬梯作用**：这是升降级的安全护栏——系统能自己收紧权限，而不是盲目信任 LLM
 */

// ========== 自治等级定义（L0-L4） ==========
//
// 用 const 对象而不是 TS enum：工程开了 `erasableSyntaxOnly`，
// enum 会产出运行时代码，这里只要一组具名数字常量。

export const AutonomyLevel = {
  /** L0: 人工预制通用裸模骨架 —— 所有生成全部手动 */
  L0: 0,

  /**
   * L1: 生成后人工逐项确认 —— LLM 可以输出指令，但每一条都必须人点"确认"才能进世界
   * 门禁指标：Schema 通过率 <100% 或 冲突数 >0
   */
  L1: 1,

  /**
   * L2: 自动检查免审 / 异常人工 —— 硬指标 100% 通过的指令直接放行，只有软规则冲突才找人
   * 门禁指标：Schema 100% + 冲突 0 + 要素覆盖≥95%
   */
  L2: 2,

  /**
   * L3: 抽检放行 —— 线上运行时只抽检 10%，其余全放；发现异常立刻熔断回 L1
   * 门禁指标：L2 基础上 + 寻路连通 100% + 碰撞 0% + 约束 100%
   */
  L3: 3,

  /**
   * L4: 无人值守例外报警 —— 完全自动化，只在极端异常时发警报给人
   * 门禁指标：L3 基础上 + 溯源 100% + 回放哈希一致
   */
  L4: 4,
} as const;

export type AutonomyLevel = (typeof AutonomyLevel)[keyof typeof AutonomyLevel];

/**
 * 滑动窗口指标统计 —— **计数器**，不是「最好成绩」。
 *
 * 每条指令都同时累加分子与分母，一件坏指令就能把比率拉下来。分母为 0
 * （这一项还没观察过）时，`ratesOf` 给出 `null`，不是 1：没观察过和
 * 观察过且完美是两件事，混成一件就等于白送一个免检资格。
 */
export interface MetricWindow {
  /** 窗口内已结算的批次数（一轮 `recordCommandResult` 集合算一批）。 */
  batches: number;
  /** 窗口内已结算的 world_day 数。 */
  days: number;

  totalCommands: number;
  schemaPassCount: number;
  conflictCount: number;

  /** 要素覆盖率：最近一次观察值。 */
  coverageRate: number;
  /** 覆盖率被观察到的次数。没观察过时覆盖率不参与门禁。 */
  coverageChecks: number;

  pathfindingChecks: number;
  pathfindingConnectedCount: number;

  collisionChecks: number;
  collisionFreeCount: number;

  constraintChecks: number;
  constraintSatisfiedCount: number;

  traceabilityChecks: number;
  traceableCount: number;

  replayChecks: number;
  replayConsistentCount: number;

  manualModificationCount: number;
  rollbackCount: number;
  invariantViolationCount: number;
}

/** 由计数器派生出的比率。未观察过的项为 `null`。 */
export interface MetricRates {
  totalCommands: number;
  batches: number;
  days: number;

  schemaPassRate: number | null;
  conflictCount: number;
  coverageRate: number | null;

  pathfindingConnectedRate: number | null;
  /** 0 是好事，1 是坏事——这一项**下限**要求，其余都是上限要求。 */
  collisionRate: number | null;
  constraintSatisfactionRate: number | null;
  traceabilityRate: number | null;
  replayHashConsistencyRate: number | null;
  manualModificationRate: number | null;

  rollbackCount: number;
  invariantViolationCount: number;
}

/** 造物主角色的配置状态 */
export interface CreatorRoleState {
  roleId: 'interpreter' | 'art_supervisor' | 'mapper' | 'historian' | 'director' | 'auditor';
  roleName: string; // 显示名称
  currentLevel: AutonomyLevel;
  targetLevel: AutonomyLevel;
  metrics: MetricWindow; // 滑动窗口计数器
  lastClimbAttemptAt?: number; // 上次尝试升级时间戳
  lastDowngradeAt?: number; // 上次降级时间戳（绝对 world_day）
  isFused: boolean; // 是否已熔断
  isolationBranchId?: string; // 隔离分支 ID（熔断期间用）
  /** 最近一次回归集试跑是否通过。`undefined` = 还没跑过。 */
  lastRegressionPassed?: boolean;
  /** 抽检用的确定性计数器，替代 `Math.random`。 */
  sampleTick: number;
}

/** 熔断器事件 */
export type FuseEventType =
  | 'climb_attempt'       // 尝试升级
  | 'climb_success'       // 升级成功
  | 'downgrade_trigger'   // 降级触发
  | 'fuse_triggered'      // 熔断激活
  | 'isolation_branch_created' // 隔离分支创建
  | 'regression_test_started'  // 回归集测试开始
  | 'regression_test_passed'   // 回归集测试通过
  | 'regression_test_failed'   // 回归集测试未通过
  | 'resume_refused'           // 恢复请求被拒
  | 'resume_allowed';          // 恢复允许

/** 熔断事件日志 */
export interface FuseEvent {
  readonly timestamp: number;
  readonly roleId: string;
  readonly eventType: FuseEventType;
  readonly details: Record<string, unknown>;
  /** 事件发生**之前**的等级。 */
  readonly fromLevel: AutonomyLevel;
  /** 事件发生**之后**的等级；纯记录型事件与 fromLevel 相同。 */
  readonly toLevel: AutonomyLevel;
}

// ========== 全局配置常量（v1.0 第 2.2 节 / 3.3 节定稿值） ==========

export const FUSE_CONFIG = {
  // 升级所需的最小连续通过批次/天数（满足其一）
  climbRequiredBatches: 3,
  climbRequiredDays: 14,

  // 升级阈值
  autoCheckPassRateThreshold: 0.98, // ≥98%
  manualModificationRateThreshold: 0.02, // ≤2%

  // 降级触发阈值
  summaryRejectionRateThreshold: 0.10, // >10%
  invariantViolationTriggerCount: 1, // ≥1 次即降级
  rollbackTriggerOnce: 1, // 任意回滚即降级

  // 冷却时间（降级后至少多少天才能再次尝试升级）
  cooldownDaysAfterDowngrade: 7,
} as const;

// ========== 主类：双向熔断器 ==========

export class AutonomousFuseController {
  private readonly roleStates: Map<string, CreatorRoleState>;
  private readonly eventLog: FuseEvent[];
  private readonly dayCounter: Map<string, number>; // 每个角色的绝对 world_day 计数

  constructor() {
    this.roleStates = new Map();
    this.eventLog = [];
    this.dayCounter = new Map();
  }

  /** 初始化某个造物主角色。
   *
   * `targetLevel` 是这一阶段收敛到的等级（来自 v1.0 第 3.3 节爬梯表）：
   * 爬到它就停，不再无限往上。
   */
  initRole(
    roleId: CreatorRoleState['roleId'],
    roleName: string,
    initialLevel: AutonomyLevel,
    targetLevel: AutonomyLevel = initialLevel,
  ): void {
    this.roleStates.set(roleId, {
      roleId,
      roleName,
      currentLevel: initialLevel,
      targetLevel,
      metrics: this.emptyMetrics(),
      isFused: false,
      sampleTick: 0,
    });
    this.dayCounter.set(roleId, 0);
  }

  /** 记录单条创世指令的处理结果。
   *
   * 每个质量项都按「观察到了就记一次」累加：成功记 1、失败记 0，分母都加 1。
   * 原来只在成功那一支赋值 1.0，于是失败永远不影响比率——那样算出来的
   * 「寻路连通率 100%」可能只来自唯一一次成功，后面九次全断也一样是 100%。
   */
  recordCommandResult(
    roleId: string,
    result: {
      schemaPassed: boolean;
      hasConflict: boolean;
      coverageRate?: number;
      pathfindingConnected?: boolean;
      hasCollision?: boolean;
      spatialConstraintSatisfied?: boolean;
      wasManuallyModified?: boolean;
      invariantViolated?: boolean;
      traceable?: boolean;
      replayHashConsistent?: boolean;
    },
  ): void {
    const state = this.roleStates.get(roleId);
    if (!state || state.isFused) return;

    const m = state.metrics;
    m.totalCommands++;
    if (result.schemaPassed) m.schemaPassCount++;
    if (result.hasConflict) m.conflictCount++;
    if (result.coverageRate !== undefined) {
      m.coverageRate = result.coverageRate;
      m.coverageChecks++;
    }

    if (result.pathfindingConnected !== undefined) {
      m.pathfindingChecks++;
      if (result.pathfindingConnected) m.pathfindingConnectedCount++;
    }
    if (result.hasCollision !== undefined) {
      m.collisionChecks++;
      if (!result.hasCollision) m.collisionFreeCount++;
    }
    if (result.spatialConstraintSatisfied !== undefined) {
      m.constraintChecks++;
      if (result.spatialConstraintSatisfied) m.constraintSatisfiedCount++;
    }
    if (result.traceable !== undefined) {
      m.traceabilityChecks++;
      if (result.traceable) m.traceableCount++;
    }
    if (result.replayHashConsistent !== undefined) {
      m.replayChecks++;
      if (result.replayHashConsistent) m.replayConsistentCount++;
    }
    if (result.wasManuallyModified !== undefined && result.wasManuallyModified) {
      m.manualModificationCount++;
    }
    if (result.invariantViolated) m.invariantViolationCount++;

    // 实时检查降级条件
    this.checkDowngradeTriggers(roleId);
  }

  /** 结算一批指令。升级判定的「连续 3 批」数这一批。 */
  endOfBatch(roleId: string): void {
    const state = this.roleStates.get(roleId);
    if (!state || state.isFused) return;
    state.metrics.batches++;
    this.tryClimbUp(roleId);
  }

  /** 每日结算：增加 world_day 计数器并检查升级条件。 */
  endOfDay(roleId: string): void {
    const state = this.roleStates.get(roleId);
    if (!state) return;

    const absoluteDay = (this.dayCounter.get(roleId) ?? 0) + 1;
    this.dayCounter.set(roleId, absoluteDay);

    if (state.isFused) return;

    state.metrics.days++;

    // 冷却期内不尝试升级
    if (
      state.lastDowngradeAt !== undefined &&
      absoluteDay - state.lastDowngradeAt < FUSE_CONFIG.cooldownDaysAfterDowngrade
    ) {
      return;
    }

    this.tryClimbUp(roleId);
  }

  /** 人类触发回滚 */
  triggerRollback(roleId: string, branchId?: string): void {
    const state = this.roleStates.get(roleId);
    if (!state) return;

    state.metrics.rollbackCount++;

    // 回滚立即触发降级到 L1
    this.triggerDowngrade(roleId, '人类触发了分支回滚', true);

    // 如果有隔离分支，记录下来
    if (branchId) {
      state.isolationBranchId = branchId;
      this.logEvent(roleId, 'isolation_branch_created', { branchId }, state.currentLevel);
    }
  }

  /** 强制降级到 L1 */
  forceDowngradeToL1(roleId: string, reason: string): void {
    this.triggerDowngrade(roleId, reason, true);
  }

  /**
   * 记录一次回归集试跑的结果。
   *
   * §2.2 的恢复条件是「直至回归集回放测试重新达标」，所以恢复请求必须
   * 先有这次记录。没有记录就等于没跑过，而「没跑」不是「通过」。
   */
  recordRegressionRun(roleId: string, passed: boolean, detail: Record<string, unknown> = {}): void {
    const state = this.roleStates.get(roleId);
    if (!state) return;

    state.lastRegressionPassed = passed;
    this.logEvent(
      roleId,
      passed ? 'regression_test_passed' : 'regression_test_failed',
      detail,
      state.currentLevel,
    );
  }

  /**
   * 尝试恢复到目标等级。**只在回归集通过后放行。**
   *
   * 返回是否真的恢复了。原实现无条件跳到 `targetLevel`，等于熔断器自己
   * 给自己开门——§2.2 要求的那道回归闸门从未存在。
   */
  allowResumeToTarget(roleId: string): boolean {
    const state = this.roleStates.get(roleId);
    if (!state) return false;

    if (state.lastRegressionPassed !== true) {
      this.logEvent(
        roleId,
        'resume_refused',
        {
          reason:
            state.lastRegressionPassed === false
              ? '回归集试跑未通过'
              : '尚未跑过回归集',
        },
        state.currentLevel,
      );
      return false;
    }

    const fromLevel = state.currentLevel;

    state.isFused = false;
    state.currentLevel = state.targetLevel;
    state.isolationBranchId = undefined;
    state.lastRegressionPassed = undefined;

    // 新等级从头算：旧窗口里那些观测属于旧等级的成绩。
    state.metrics = this.emptyMetrics();

    this.logEvent(roleId, 'resume_allowed', {}, fromLevel, state.currentLevel);
    return true;
  }

  // ========== 内部方法 ==========

  private emptyMetrics(): MetricWindow {
    return {
      batches: 0,
      days: 0,
      totalCommands: 0,
      schemaPassCount: 0,
      conflictCount: 0,
      coverageRate: 0,
      coverageChecks: 0,
      pathfindingChecks: 0,
      pathfindingConnectedCount: 0,
      collisionChecks: 0,
      collisionFreeCount: 0,
      constraintChecks: 0,
      constraintSatisfiedCount: 0,
      traceabilityChecks: 0,
      traceableCount: 0,
      replayChecks: 0,
      replayConsistentCount: 0,
      manualModificationCount: 0,
      rollbackCount: 0,
      invariantViolationCount: 0,
    };
  }

  private tryClimbUp(roleId: string): void {
    const state = this.roleStates.get(roleId);
    if (!state) return;

    // 不能超越目标等级
    if (state.currentLevel >= state.targetLevel) return;

    this.logEvent(roleId, 'climb_attempt', {}, state.currentLevel);

    const rates = ratesOf(state.metrics);

    // 证据要够：§2.2 是「连续 3 个迭代批次（或连续 14 个 world_day）」。
    const enoughBatches = rates.batches >= FUSE_CONFIG.climbRequiredBatches;
    const enoughDays = rates.days >= FUSE_CONFIG.climbRequiredDays;
    if (!enoughBatches && !enoughDays) return;

    // 自动检查通过率与人工修改率
    if (rates.schemaPassRate === null) return;
    if (rates.schemaPassRate < FUSE_CONFIG.autoCheckPassRateThreshold) return;
    if (rates.manualModificationRate === null) return;
    if (rates.manualModificationRate > FUSE_CONFIG.manualModificationRateThreshold) return;

    // 质量门禁：按**将要升入的等级**逐项要求，且是累积的。
    //
    // 这是本文件最容易写松的一处。原来只查「观察过的项是否达标」，
    // 于是质量项一个都没测的模块照样能升——「没测」被当成了「没问题」，
    // 而 §3.3 里 L2 明写要「要素覆盖 ≥95%」。没测过就是没达标。
    const nextLevel = (state.currentLevel + 1) as AutonomyLevel;
    if (!qualityGatesFor(nextLevel, rates)) return;

    const oldLevel = state.currentLevel;
    state.currentLevel = Math.min(oldLevel + 1, state.targetLevel) as AutonomyLevel;
    state.lastClimbAttemptAt = Date.now();

    this.logEvent(
      roleId,
      'climb_success',
      { passRate: rates.schemaPassRate, modificationRate: rates.manualModificationRate, rates },
      oldLevel,
      state.currentLevel,
    );

    // 升级即清零：爬到新等级要从零重新证明自己。
    state.metrics = this.emptyMetrics();
  }

  private checkDowngradeTriggers(roleId: string): void {
    const state = this.roleStates.get(roleId);
    if (!state) return;

    let shouldDowngrade = false;
    let reason = '';

    const rates = ratesOf(state.metrics);

    // 条件 1：摘要校验拒绝率 >10%
    if (rates.schemaPassRate !== null && rates.totalCommands > 0) {
      const rejectionRate = 1 - rates.schemaPassRate;
      if (rejectionRate > FUSE_CONFIG.summaryRejectionRateThreshold) {
        shouldDowngrade = true;
        reason = `摘要校验拒绝率 ${rejectionRate.toFixed(2)} > ${FUSE_CONFIG.summaryRejectionRateThreshold}`;
      }
    }

    // 条件 2：不变式违反 ≥1 次
    if (rates.invariantViolationCount >= FUSE_CONFIG.invariantViolationTriggerCount) {
      shouldDowngrade = true;
      reason = `不变式违反 ${rates.invariantViolationCount} 次`;
    }

    // 条件 3：有回滚记录
    if (rates.rollbackCount > 0) {
      shouldDowngrade = true;
      reason = '存在人类回滚操作';
    }

    if (shouldDowngrade) {
      this.triggerDowngrade(roleId, reason, true);
    }
  }

  private triggerDowngrade(roleId: string, reason: string, immediate: boolean): void {
    const state = this.roleStates.get(roleId);
    if (!state) return;

    const oldLevel = state.currentLevel;

    if (immediate) {
      state.currentLevel = AutonomyLevel.L1;
      state.lastDowngradeAt = this.dayCounter.get(roleId) || 0;
      state.isFused = true;
      state.lastRegressionPassed = undefined;

      this.logEvent(roleId, 'downgrade_trigger', { reason }, oldLevel, AutonomyLevel.L1);
      this.logEvent(roleId, 'fuse_triggered', { reason }, oldLevel, AutonomyLevel.L1);

      // 熔断后旧成绩作废。留着它会让「恢复」这一步看起来已经达标，
      // 而那段历史恰好是出事之前跑出来的。
      state.metrics = this.emptyMetrics();
    }
  }

  /** 记一条审计事件。
   *
   * 等级变化要**显式**传进来，不能在这里读 `state.currentLevel`：
   * 升降级的调用点都是先改状态再记日志，读当前值会把 from 和 to 记成同一个数，
   * 事后翻日志就看不见到底跳了几级。
   */
  private logEvent(
    roleId: string,
    eventType: FuseEventType,
    details: Record<string, unknown>,
    fromLevel: AutonomyLevel,
    toLevel: AutonomyLevel = fromLevel,
  ): void {
    this.eventLog.push({
      timestamp: Date.now(),
      roleId,
      eventType,
      details,
      fromLevel,
      toLevel,
    });
  }

  // ========== 查询 API ==========

  getRoleState(roleId: string): CreatorRoleState | undefined {
    return this.roleStates.get(roleId);
  }

  /** 由计数器派生的比率视图。 */
  getRates(roleId: string): MetricRates | undefined {
    const state = this.roleStates.get(roleId);
    return state === undefined ? undefined : ratesOf(state.metrics);
  }

  getEventLog(roleId?: string, limit: number = 50): FuseEvent[] {
    const events = roleId === undefined ? this.eventLog : this.eventLog.filter((e) => e.roleId === roleId);
    return events.slice(-limit);
  }

  getAllRoleIds(): string[] {
    return [...this.roleStates.keys()];
  }
}

// ========== 派生与判定 ==========

function divide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** 把计数器算成比率。分母为 0 的项返回 `null`（没观察过 ≠ 满分）。 */
export function ratesOf(m: MetricWindow): MetricRates {
  return {
    totalCommands: m.totalCommands,
    batches: m.batches,
    days: m.days,
    schemaPassRate: divide(m.schemaPassCount, m.totalCommands),
    conflictCount: m.conflictCount,
    coverageRate: m.coverageChecks === 0 ? null : m.coverageRate,
    pathfindingConnectedRate: divide(m.pathfindingConnectedCount, m.pathfindingChecks),
    collisionRate: divide(m.collisionChecks - m.collisionFreeCount, m.collisionChecks),
    constraintSatisfactionRate: divide(m.constraintSatisfiedCount, m.constraintChecks),
    traceabilityRate: divide(m.traceableCount, m.traceabilityChecks),
    replayHashConsistencyRate: divide(m.replayConsistentCount, m.replayChecks),
    manualModificationRate: divide(m.manualModificationCount, m.totalCommands),
    rollbackCount: m.rollbackCount,
    invariantViolationCount: m.invariantViolationCount,
  };
}

/**
 * 质量门禁：升到 `targetLevel` 之前必须具备哪些数，逐级累积。
 *
 * 对应 v1.0 §3.3：
 * - L2：冲突 0 / 要素覆盖 ≥95% / 不变式违反 0
 * - L3：外加 寻路连通 100% / 重叠碰撞 0% / 空间约束 100%
 * - L4：外加 溯源 100% / 回放哈希一致
 *
 * **`null` 一律不通过。** 「这一项没测」和「这一项满分」在门禁上是两件事：
 * 前者的正确处置是回去补测，不是放行。这一条是本文件最容易被写松的地方。
 */
function qualityGatesFor(targetLevel: AutonomyLevel, rates: MetricRates): boolean {
  if (targetLevel >= AutonomyLevel.L2) {
    if (rates.invariantViolationCount > 0) return false;
    if (rates.conflictCount > 0) return false;
    if (rates.coverageRate === null || rates.coverageRate < 0.95) return false;
  }

  if (targetLevel >= AutonomyLevel.L3) {
    if (rates.pathfindingConnectedRate === null || rates.pathfindingConnectedRate < 1) return false;
    if (rates.collisionRate === null || rates.collisionRate > 0) return false;
    if (rates.constraintSatisfactionRate === null || rates.constraintSatisfactionRate < 1) return false;
  }

  if (targetLevel >= AutonomyLevel.L4) {
    if (rates.traceabilityRate === null || rates.traceabilityRate < 1) return false;
    if (rates.replayHashConsistencyRate === null || rates.replayHashConsistencyRate < 1) return false;
  }

  return true;
}

// ========== 辅助类型和工具 ==========

/** 熔断器的决策建议 */
export interface FuseDecision {
  readonly action: 'allow' | 'requireReview' | 'downgrade' | 'isolate';
  readonly reason: string;
  readonly suggestedLevel?: AutonomyLevel;
}

export function evaluateFuseDecision(controller: AutonomousFuseController, roleId: string): FuseDecision {
  const state = controller.getRoleState(roleId);
  if (!state) {
    return { action: 'allow', reason: '角色不存在，默认允许' };
  }

  if (state.isFused) {
    return {
      action: 'isolate',
      reason: '已熔断，需回归集测试通过后才能恢复',
      suggestedLevel: AutonomyLevel.L1,
    };
  }

  if (state.currentLevel === AutonomyLevel.L4) {
    return { action: 'allow', reason: '已达到最高自治等级' };
  }

  if (state.currentLevel === AutonomyLevel.L1) {
    return { action: 'requireReview', reason: '需要人工逐项确认' };
  }

  /**
   * L0：人工预制裸模骨架——**所有生成全部手动**。
   *
   * 这一支原先不存在，而下面那个 `default` 返回的是 `allow`。于是所有角色
   * 从 L0 起步的那一刻，每一条命令都直接放行：§3.3 表里 L0 那一行「全部手动」
   * 与代码正好相反，而且不会有任何东西红——因为「放行」不是异常，它只是
   * 少问了一句。`creator-fuse.test.ts` 的「L1 要求逐项确认，L4 放行，熔断中
   * 要求隔离」那条钉了 L1 / L4 / 熔断三种，L0 那一格一直空着；补它的是
   * `creator-engine.test.ts` 的「执行命令时 L0 需要人工确认」（拿 HEAD 的
   * `fuse.ts` 跑一遍，那条会红——补的不是一条永远不会失败的断言）。
   */
  if (state.currentLevel === AutonomyLevel.L0) {
    return { action: 'requireReview', reason: 'L0 阶段所有生成都要人工逐项确认' };
  }

  const rates = ratesOf(state.metrics);

  if (state.currentLevel === AutonomyLevel.L2) {
    if (rates.schemaPassRate !== null && rates.schemaPassRate >= 0.95) {
      return { action: 'allow', reason: '通过率足够高，可自动放行', suggestedLevel: AutonomyLevel.L2 };
    }
    return { action: 'requireReview', reason: '通过率未达 L2 标准', suggestedLevel: AutonomyLevel.L1 };
  }

  // L3 抽检模式：按 10% 抽。挑谁进来必须可复现（同种子回放要一致），
  // 所以用角色自增的计数当种子，不用 `Math.random`。
  if (state.currentLevel === AutonomyLevel.L3) {
    state.sampleTick++;
    const shouldSample = sampledIn(roleId, state.sampleTick);
    return {
      action: shouldSample ? 'requireReview' : 'allow',
      reason: shouldSample ? '进入 10% 抽检池' : '未抽中，自动放行',
      suggestedLevel: AutonomyLevel.L3,
    };
  }

  return { action: 'allow', reason: '默认策略' };
}

/** 确定性抽检：把 (roleId, tick) 打散到 [0, 1) 后与 10% 比。 */
function sampledIn(roleId: string, tick: number): boolean {
  // 与 `memory/seed.ts` 同一套 FNV-1a，不引第二个哈希实现。
  let hash = 0x811c9dc5;
  const text = `${roleId}\u0000${tick}\u0000sample`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return ((hash >>> 8) / 0x1000000) < 0.1;
}
