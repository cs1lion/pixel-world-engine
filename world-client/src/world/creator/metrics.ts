/** 自动化门禁指标（Automated Gate Metrics）。
 *
 * 自治爬梯的「门票」：每个等级要求一组可计算的数，达标才允许往上爬。
 * 数值来自《补充架构设计 v1.0》第 3.3 节定稿表。
 *
 * 三条约束：
 *
 * 1. **纯计算，0 次模型调用**——爬梯判定本身不能变成新的开销。
 * 2. **每项指标都能由指令与世界状态直接算出**，没有"主观酌情"。
 * 3. **检测不到就报缺，不默认满分**——`isGatePassed` 只在所有必需项都达标时放行。
 */

import type {
  GenesisCommand,
  GenesisCommandBatch,
  GenesisCommandKind,
  PlaceBuildingCommand,
} from './schema.js';

// ============================================================================
// 结果类型
// ============================================================================

/** 单条指令的检查结果。 */
export interface CommandCheckResult {
  readonly commandIndex: number;
  readonly commandKind: GenesisCommandKind;
  readonly passed: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * 聚合门禁指标——爬梯判定就看这一组数。
 *
 * **没有一项可以被「默认满分」**。算不出来的项返回 `null`，由调用方拿
 * `MissingMetric` 报缺。这里曾经把 `replayHashConsistencyRate` 硬编码成 1、
 * 让 `coverageOf` 无条件返回 1——两项 L4 门禁因此永远「达标」，
 * 而它们恰恰是最难满足的那两项。
 */
export interface AggregateGateMetrics {
  /** Schema 通过率，要求 = 1。 */
  schemaPassRate: number;
  /** 冲突数，要求 = 0。 */
  conflictCount: number;
  /** 核心设定要素覆盖率，要求 ≥ 0.95。没有要素清单时为 `null`。 */
  coverageRate: number | null;
  /** 寻路连通率，要求 = 1。没有建筑时为 `null`。 */
  pathfindingConnectedRate: number | null;
  /** 建筑重叠率，要求 = 0。没有建筑时为 `null`。 */
  collisionRate: number | null;
  /** 空间约束满足率，要求 = 1。没有建筑时为 `null`。 */
  constraintSatisfactionRate: number | null;
  /** 事件溯源率，要求 = 1。没有历史事件时为 `null`。 */
  traceabilityRate: number | null;
  /** 关系双向对称率，要求 = 1。没提供关系图时为 `null`。 */
  relationSymmetryRate: number | null;
  /** 同种子回放哈希一致率，要求 = 1。没有回放结果时为 `null`。 */
  replayHashConsistencyRate: number | null;
  /** 不变式违反次数，要求 = 0。 */
  invariantViolationCount: number;
}

/** 一次批处理的完整结论。 */
export interface BatchCheckResults {
  readonly totalCommands: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly individualResults: readonly CommandCheckResult[];
  readonly aggregateMetrics: AggregateGateMetrics;
}

/** 检查所需的世界状态。所有查询都是只读的。 */
export interface CheckContext {
  readonly existingChars: ReadonlySet<string>;
  readonly worldState: {
    /** 已被建筑占用的格子，key 是 "x,y"。 */
    getOccupiedCells: () => ReadonlySet<string>;
    /** 查空间约束（留白、门口、贴脸）。返回 null 表示通过。 */
    checkSpatialConstraints: (command: PlaceBuildingCommand) => Promise<string | null>;
    /** 查世界圣经不变式。返回 null 表示通过。 */
    checkInvariants: (command: GenesisCommand) => Promise<string | null>;
    /** 关系图：取某个单位的关系对端名单。缺省时对称率报 `null`，不报满分。 */
    getRelationTargets?: (name: string) => ReadonlySet<string>;
    /**
     * 设定包要求的核心要素清单。缺省时覆盖率报 `null`。
     *
     * 原来这里没有这一项，`coverageOf` 于是只能无条件返回 1——一个恒定
     * 满足的门禁等于没有门禁，而「要素覆盖 ≥95%」正是 L2 的三道关之一。
     */
    requiredElements?: readonly string[];
    /** 某条指令覆盖了哪些核心要素。配合 `requiredElements` 算覆盖率。 */
    elementsCoveredBy?: (command: GenesisCommand) => readonly string[];
    /**
     * 同种子回放校验：把这一批指令重放一遍，返回哈希是否一致。
     * 缺省时回放一致率报 `null`——没跑过就是没跑过。
     */
    replayCheck?: (batch: GenesisCommandBatch) => Promise<boolean>;
  };
}

// ============================================================================
// 主入口
// ============================================================================

export async function runAllGateChecks(
  batch: GenesisCommandBatch,
  context: CheckContext,
): Promise<BatchCheckResults> {
  const individualResults: CommandCheckResult[] = [];

  for (const [index, command] of batch.commands.entries()) {
    individualResults.push(await checkOne(index, command, context));
  }

  const passedCount = individualResults.filter((r) => r.passed).length;

  return {
    totalCommands: individualResults.length,
    passedCount,
    failedCount: individualResults.length - passedCount,
    individualResults,
    aggregateMetrics: await computeAggregateMetrics(individualResults, batch, context),
  };
}

async function checkOne(
  commandIndex: number,
  command: GenesisCommand,
  context: CheckContext,
): Promise<CommandCheckResult> {
  const { errors, warnings } = await checkCommand(command, context);
  return {
    commandIndex,
    commandKind: command.kind,
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

async function checkCommand(
  command: GenesisCommand,
  context: CheckContext,
): Promise<{ errors: string[]; warnings: string[] }> {
  switch (command.kind) {
    case 'PlaceBuilding':
      return checkPlaceBuilding(command, context);
    case 'SeedHistory': {
      const errors: string[] = [];
      // Schema 层已查过参与者存在性；这里只补时间线合法性。
      if (command.dayOffset < 0 && command.sources === undefined) {
        errors.push(`历史事件发生在创世前 (dayOffset=${command.dayOffset}) 却没有任何来源引用`);
      }
      return { errors, warnings: [] };
    }
    case 'SpawnCharacter': {
      const errors: string[] = [];
      for (const rel of command.relationships ?? []) {
        if (!context.existingChars.has(rel.targetName)) {
          errors.push(`关系目标 "${rel.targetName}" 尚未存在`);
        }
      }
      return { errors, warnings: [] };
    }
    default: {
      // CreateRegion / InjectEvent / 其余：只查不变式。
      // 前缀必须和 checkPlaceBuilding 里一致，否则聚合时认不出来（不变式违反次数会漏计）。
      const violation = await context.worldState.checkInvariants(command);
      return {
        errors: violation === null ? [] : [`违反世界圣经不变式：${violation}`],
        warnings: [],
      };
    }
  }
}

async function checkPlaceBuilding(
  command: PlaceBuildingCommand,
  context: CheckContext,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cell = `${command.at.x},${command.at.y}`;
  if (context.worldState.getOccupiedCells().has(cell)) {
    errors.push(`坐标 ${cell} 已被占用`);
    return { errors, warnings }; // 占用了就没必要再查约束
  }

  const spatial = await context.worldState.checkSpatialConstraints(command);
  if (spatial !== null) errors.push(spatial);

  const invariant = await context.worldState.checkInvariants(command);
  if (invariant !== null) errors.push(`违反世界圣经不变式：${invariant}`);

  if (command.palette === undefined) {
    warnings.push('未指定调色板，将使用模板自带配色');
  }

  return { errors, warnings };
}

// ============================================================================
// 聚合
// ============================================================================

async function computeAggregateMetrics(
  results: readonly CommandCheckResult[],
  batch: GenesisCommandBatch,
  context: CheckContext,
): Promise<AggregateGateMetrics> {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  // 只有 PlaceBuilding 能贡献寻路/碰撞/约束三项，只有 SeedHistory 贡献溯源。
  // 分母按「有这项检查的指令数」算，不是按总数——否则一批纯 CreateRegion
  // 会把寻路率稀释成 0，看起来像坏了。但**没有这项检查时是 `null` 而不是 1**：
  // 一批没有建筑的指令既不证明寻路好，也不证明寻路坏。
  const buildingResults = results.filter((r) => r.commandKind === 'PlaceBuilding');
  const historyResults = results.filter((r) => r.commandKind === 'SeedHistory');

  const pathfindingOk = buildingResults.filter((r) => !r.errors.some(isPathfindingError)).length;
  const collisionFree = buildingResults.filter((r) => !r.errors.some(isCollisionError)).length;
  const constraintOk = buildingResults.filter((r) => !r.errors.some(isConstraintError)).length;
  const traceable = historyResults.filter((r) => !r.errors.some(isTraceabilityError)).length;

  const invariantViolations = results.filter((r) =>
    r.errors.some((e) => e.includes('不变式')),
  ).length;

  return {
    schemaPassRate: total === 0 ? 1 : passed / total,
    conflictCount: total - passed,
    coverageRate: coverageOf(batch, context),
    pathfindingConnectedRate: ratio(pathfindingOk, buildingResults.length),
    collisionRate: ratio(buildingResults.length - collisionFree, buildingResults.length),
    constraintSatisfactionRate: ratio(constraintOk, buildingResults.length),
    traceabilityRate: ratio(traceable, historyResults.length),
    relationSymmetryRate: relationSymmetryOf(context),
    replayHashConsistencyRate: await replayConsistencyOf(batch, context),
    invariantViolationCount: invariantViolations,
  };
}

/** 分母为 0 时返回 `null`：这一项没被观察到，不是「观察过且满分」。 */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

const isPathfindingError = (e: string): boolean => e.includes('连通') || e.includes('死锁');
const isCollisionError = (e: string): boolean => e.includes('占用') || e.includes('重叠');
const isConstraintError = (e: string): boolean => e.includes('留白') || e.includes('门口') || e.includes('贴脸');
const isTraceabilityError = (e: string): boolean => e.includes('尚未存在') || e.includes('来源');

/**
 * 要素覆盖率 = 被指令覆盖到的核心要素数 / 设定包要求的核心要素数。
 *
 * 没有要素清单就报 `null`。这里原来直接 `return 1`，注释还写着「粗估」——
 * 一个恒返回 1 的门禁不是粗估，是摆设，而它是 L2 的三道关之一。
 */
function coverageOf(batch: GenesisCommandBatch, context: CheckContext): number | null {
  const required = context.worldState.requiredElements;
  const covered = context.worldState.elementsCoveredBy;
  if (required === undefined || covered === undefined) return null;
  if (required.length === 0) return null;

  const seen = new Set<string>();
  for (const command of batch.commands) {
    for (const element of covered(command)) seen.add(element);
  }
  const hit = required.filter((element) => seen.has(element)).length;
  return hit / required.length;
}

/** 关系双向对称：A→B 有边则 B→A 也要有。没提供关系图时报 `null`。 */
function relationSymmetryOf(context: CheckContext): number | null {
  const getTargets = context.worldState.getRelationTargets;
  if (getTargets === undefined) return null;
  let checked = 0;
  let symmetric = 0;
  for (const name of context.existingChars) {
    for (const target of getTargets(name)) {
      checked++;
      if (getTargets(target).has(name)) symmetric++;
    }
  }
  return ratio(symmetric, checked);
}

/** 同种子回放校验。没配校验器时报 `null`——没跑过不能说一致。 */
async function replayConsistencyOf(
  batch: GenesisCommandBatch,
  context: CheckContext,
): Promise<number | null> {
  const check = context.worldState.replayCheck;
  if (check === undefined) return null;
  return (await check(batch)) ? 1 : 0;
}

// ============================================================================
// 爬梯判定
// ============================================================================

export interface MissingMetric {
  readonly name: keyof AggregateGateMetrics;
  /** 实测值；`null` 表示这一项**根本没被测到**。 */
  readonly actual: number | null;
  readonly required: number;
  /** 是「没测」还是「测了没达标」。这两件事的处置完全不同。 */
  readonly reason: 'not_measured' | 'below_requirement';
}

/**
 * 判断一组指标够不够升到 `targetLevel`。
 *
 * 门禁是**累积**的：要 L3，L1 与 L2 的条件也都要满足。
 * 这条不是洁癖——一个连 Schema 都过不满的模块，
 * 让它去做 10% 抽检等于把 90% 的坏指令直接放行。
 *
 * `null` 一律记为 `not_measured` 并**阻止升级**。没测过不等于达标；
 * 想看「这一项本来就不适用」，请让检查器给出真实的分母。
 */
export function isGatePassed(
  metrics: AggregateGateMetrics,
  targetLevel: number,
): { passed: boolean; missingMetrics: MissingMetric[] } {
  const missing: MissingMetric[] = [];

  const atLeast = (
    name: keyof AggregateGateMetrics,
    actual: number | null,
    required: number,
  ): void => {
    if (actual === null) {
      missing.push({ name, actual, required, reason: 'not_measured' });
    } else if (actual < required) {
      missing.push({ name, actual, required, reason: 'below_requirement' });
    }
  };

  const atMost = (
    name: keyof AggregateGateMetrics,
    actual: number | null,
    required: number,
  ): void => {
    if (actual === null) {
      missing.push({ name, actual, required, reason: 'not_measured' });
    } else if (actual > required) {
      missing.push({ name, actual, required, reason: 'below_requirement' });
    }
  };

  if (targetLevel >= 1) {
    atLeast('schemaPassRate', metrics.schemaPassRate, 1);
  }

  if (targetLevel >= 2) {
    atMost('conflictCount', metrics.conflictCount, 0);
    atLeast('coverageRate', metrics.coverageRate, 0.95);
    atMost('invariantViolationCount', metrics.invariantViolationCount, 0);
  }

  if (targetLevel >= 3) {
    atLeast('pathfindingConnectedRate', metrics.pathfindingConnectedRate, 1);
    atMost('collisionRate', metrics.collisionRate, 0);
    atLeast('constraintSatisfactionRate', metrics.constraintSatisfactionRate, 1);
  }

  if (targetLevel >= 4) {
    atLeast('traceabilityRate', metrics.traceabilityRate, 1);
    atLeast('replayHashConsistencyRate', metrics.replayHashConsistencyRate, 1);
    atLeast('relationSymmetryRate', metrics.relationSymmetryRate, 1);
  }

  return { passed: missing.length === 0, missingMetrics: missing };
}
