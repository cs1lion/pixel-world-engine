/** 导演运行：基于"世界心电图"快照的 PID 注入回路
 *
 * **核心目标**：让导演角色在长期运行中既不破坏玩家意图，又能精准控制世界节奏。
 *
 * **设计原则**（来自《补充架构设计 v1.0》第 2.3 节）：
 * 1. **严禁直接读取全量事件日志**：导演只吃四个标量指标
 * 2. **参数化注入**：只能从白名单事件中选择参数化动作，不能自由编造剧情
 * 3. **不变式检查前置**：所有注入指令必须先过审校角色的不变式检查
 *
 * **注入规则只有两条**，v1.0 §2.3 原文如此：
 * - `mean_arousal < 0.25` → `visitor_arrival` | `weather_anomaly`
 * - `mean_valence < -0.45` → `tavern_feast`
 *
 * 这份实现曾自行加过 `info_entropy` 与 `isolated_holders_count` 两条规则，
 * 阈值（2.5 / 3）都是编的。其中 `infoEntropy > 2.5` 是一条**永不触发的死规则**：
 * `memory/vitals.ts` 的 `entropyOf` 用 `Math.min(1, ...)` 封顶，真实值域是 [0, 1]。
 * 那两个标量照 §2.3 只作为观察量进入决策理由，不单独触发注入——多一条规则
 * 就多一份「导演在替世界编剧情」的空间，而那正是这条边界要拦的东西。
 *
 * **自治等级爬梯门禁指标**（v1.0 第 3.3 节）：
 * - L1 (每日注入指令需人确认) → L2 (低风险事件自动注入)
 * - 门禁：不变式违反 = 0 + 连续 7 天情绪均值在 [-0.3, +0.6] 健康区间内
 */

import { seedOf, unitFromSeed } from './memory/seed.ts';

// ========== "世界心电图"四标量类型定义 ==========

/** 日终摘要中的四个关键标量 */
export interface WorldVitalsSnapshot {
  /** 全村近 3 日记忆情绪均值，范围 [-1, +1] */
  readonly meanValence: number;

  /** 全村近 3 日记忆兴奋度均值，范围 [0, 1] */
  readonly meanArousal: number;

  /**
   * 当日传播的独立断言数与覆盖方差折算的熵，**范围 [0, 1]**。
   *
   * 上限不是约定而是实现：`memory/vitals.ts` 的 `entropyOf` 返回
   * `Math.min(1, ...)`。任何拿大于 1 的阈值来比这条的代码都是死代码。
   * 本文件的导演不拿它单独触发注入，只在决策理由里报告。
   */
  readonly infoEntropy: number;

  /** 连续 3 天无任何 ClaimTold 交互的孤立单位数 */
  readonly isolatedHoldersCount: number;
}

/** 导演的状态机 */
export interface DirectorState {
  /** 当前调度周期（world_day） */
  currentDay: number;

  /** 过去 7 天的情绪轨迹 */
  valenceHistory: number[];

  /** 过去 7 天的唤醒度轨迹 */
  arousalHistory: number[];

  /** 已注入的事件历史 */
  injectedEvents: Array<{
    day: number;
    eventKind: string;
    parameters?: Record<string, unknown>;
  }>;
}

/**
 * 导演注入的事件类型（白名单）。
 *
 * 前三项直接来自 v1.0 §2.3。后四项是《造物主角色》表里出现过的叙事事件，
 * 保留在类型里是为了让 `InjectEvent` 的白名单与导演可选集合对得上，
 * 但**没有任何一条注入规则会选它们**——规则只有 §2.3 那两条。
 */
export type InjectableEventKind =
  | 'visitor_arrival'     // 访客到来 —— 制造新话题线索（§2.3）
  | 'weather_anomaly'     // 天气异常 —— 打破机械重复（§2.3）
  | 'tavern_feast'        // 酒馆宴会 —— 修复情绪效价（§2.3）
  | 'festival_start'      // 节日开始 —— 集中社交激活
  | 'oracle_message'      // 神谕降临 —— 高 arousal 事件
  | 'resource_discovery'  // 资源发现 —— 正向激励
  | 'conflict_resolution'; // 冲突化解 —— 缓解紧张关系

/** 导演决策输出 */
export interface DirectorDecision {
  readonly shouldInject: boolean;
  readonly eventKind?: InjectableEventKind;
  readonly parameters?: Record<string, unknown>;
  readonly priority: 'low' | 'medium' | 'high';
  readonly reasoning: string;
  readonly requiresHumanReview: boolean;
}

// ========== 导演常量配置（v1.0 §2.3 / §3.3 定稿值） ==========

export const DIRECTOR_CONFIG = {
  // 情绪健康区间
  VALENCE_HEALTHY_MIN: -0.3,
  VALENCE_HEALTHY_MAX: 0.6,

  // 死寂阈值
  AROUSAL_DEATH_THRESHOLD: 0.25,

  // 低迷阈值
  VALENCE_LOW_THRESHOLD: -0.45,

  /**
   * 情绪健康判定要求的连续天数。
   *
   * §3.3 导演那一行写的是「连续 7 天情绪均值在 [-0.3, +0.6]」。这里曾实现成
   * `daysOutOfRange <= 1`，等于顺手允许一天出界——而门禁文字里没有这个豁免。
   * 一周七天的病房里有一天不发烧，不能说这一周健康。
   */
  HEALTHY_CONSECUTIVE_DAYS: 7,

  /** 健康判定看最近多少天。与 `HEALTHY_CONSECUTIVE_DAYS` 同源。 */
  HISTORY_WINDOW_DAYS: 7,
} as const;

// ========== 主类：导演引擎 ==========

export class DirectorEngine {
  private readonly states: Map<string, DirectorState>; // key = world_seed
  private readonly injectQueue: Map<string, Array<DirectorDecision>>; // key = world_seed

  constructor() {
    this.states = new Map();
    this.injectQueue = new Map();
  }

  /**
   * 初始化某个世界的导演状态
   */
  initialize(worldSeed: string, initialDay: number = 1): void {
    if (!this.states.has(worldSeed)) {
      this.states.set(worldSeed, {
        currentDay: initialDay,
        valenceHistory: [],
        arousalHistory: [],
        injectedEvents: [],
      });
      this.injectQueue.set(worldSeed, []);
    }
  }

  /**
   * 处理日终摘要，更新指标并生成导演决策
   *
   * 这是外环的关键节点：内环在 DayClosed 时推送心电图快照给导演
   */
  processDayClosed(
    worldSeed: string,
    vitals: WorldVitalsSnapshot,
  ): DirectorDecision {
    if (!this.states.has(worldSeed)) {
      this.initialize(worldSeed);
    }

    const worldState = this.states.get(worldSeed)!;

    // 更新历史轨迹
    worldState.valenceHistory.push(vitals.meanValence);
    worldState.arousalHistory.push(vitals.meanArousal);

    // 保持最近 7 天窗口
    if (worldState.valenceHistory.length > DIRECTOR_CONFIG.HISTORY_WINDOW_DAYS) {
      worldState.valenceHistory.shift();
    }
    if (worldState.arousalHistory.length > DIRECTOR_CONFIG.HISTORY_WINDOW_DAYS) {
      worldState.arousalHistory.shift();
    }

    worldState.currentDay++;

    // 计算滑动均值
    const meanValence7d = this.computeMean(worldState.valenceHistory);
    const meanArousal7d = this.computeMean(worldState.arousalHistory);

    // 检查注入条件
    const decision = this.evaluateInjection(worldSeed, worldState, vitals, meanValence7d, meanArousal7d);

    if (decision.shouldInject && decision.eventKind) {
      // 记录注入事件
      worldState.injectedEvents.push({
        day: worldState.currentDay,
        eventKind: decision.eventKind,
        parameters: decision.parameters,
      });

      // 加入注入队列
      this.injectQueue.get(worldSeed)!.push(decision);
    }

    return decision;
  }

  /**
   * 获取待注入的事件队列
   */
  getInjectionQueue(worldSeed: string): Array<DirectorDecision> {
    return this.injectQueue.get(worldSeed) || [];
  }

  /**
   * 清空已处理的注入队列
   */
  clearProcessedQueue(worldSeed: string): void {
    this.injectQueue.set(worldSeed, []);
  }

  /**
   * 获取某世界的情绪健康度评估。
   *
   * 判据是 §3.3 原文：**连续 7 天**情绪均值都在 [-0.3, +0.6]。
   * 满 7 天数据之前一律报 `healthy: false`——「还不知道」不能报成「健康」，
   * 那会让一个刚开服、一天数据都没有的世界直接拿到免审资格。
   */
  getEmotionalHealthStatus(worldSeed: string): {
    healthy: boolean;
    daysOutOfHealthRange: number;
    recommendedAction?: 'boost_valence' | 'increase_arousal' | 'maintain';
  } {
    const state = this.states.get(worldSeed);
    if (!state) {
      // 没见过的世界没有任何证据。保守答案是不健康、待评估。
      return { healthy: false, daysOutOfHealthRange: 0, recommendedAction: 'maintain' };
    }

    const window = state.valenceHistory;
    let daysOutOfRange = 0;
    for (const v of window) {
      if (v < DIRECTOR_CONFIG.VALENCE_HEALTHY_MIN || v > DIRECTOR_CONFIG.VALENCE_HEALTHY_MAX) {
        daysOutOfRange++;
      }
    }

    // 数据不足 7 天：不构成「连续 7 天」的证据。
    const hasEnoughEvidence = window.length >= DIRECTOR_CONFIG.HEALTHY_CONSECUTIVE_DAYS;
    const healthy = hasEnoughEvidence && daysOutOfRange === 0;

    let recommendedAction: 'boost_valence' | 'increase_arousal' | 'maintain' | undefined;

    const lastValence = window[window.length - 1];
    const lastArousal = state.arousalHistory[state.arousalHistory.length - 1];

    if (lastValence !== undefined && lastValence < DIRECTOR_CONFIG.VALENCE_LOW_THRESHOLD) {
      recommendedAction = 'boost_valence';
    } else if (lastArousal !== undefined && lastArousal < DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD) {
      recommendedAction = 'increase_arousal';
    } else {
      recommendedAction = 'maintain';
    }

    return {
      healthy,
      daysOutOfHealthRange: daysOutOfRange,
      recommendedAction,
    };
  }

  // ========== 内部方法 ==========

  private computeMean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, x) => sum + x, 0) / arr.length;
  }

  /**
   * 根据心电图四标量和滑动均值评估是否需要注入事件。
   *
   * 只有两条规则会触发注入（v1.0 §2.3）。`infoEntropy` 与
   * `isolatedHoldersCount` 只写进 `reasoning`——它们是体检报告上的读数，
   * 不是处方。想加第三条规则，先改规范。
   */
  private evaluateInjection(
    worldSeed: string,
    state: DirectorState,
    vitals: WorldVitalsSnapshot,
    meanValence7d: number,
    meanArousal7d: number,
  ): DirectorDecision {
    const readings =
      `信息熵 ${vitals.infoEntropy.toFixed(3)}、孤立单位 ${vitals.isolatedHoldersCount}`;

    // 条件 1:mean_arousal < 0.25（世界陷入死寂与机械重复）
    // §2.3 给的是「visitor_arrival | weather_anomaly」二选一。挑哪一个必须
    // 可复现：原来用 Math.random，同一份事件流两次回放会注入不同事件，
    // 而「同种子回放哈希一致」是 L4 的硬门禁。
    if (meanArousal7d < DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD) {
      const roll = unitFromSeed(
        seedOf(worldSeed, state.currentDay, 'director', 'arousal_death'),
      );
      return {
        shouldInject: true,
        eventKind: roll < 0.5 ? 'visitor_arrival' : 'weather_anomaly',
        priority: 'medium',
        reasoning:
          `世界唤醒度过低 (${meanArousal7d.toFixed(3)} < ${DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD})，` +
          `需要打破机械重复（${readings}）`,
        parameters: {
          intensity: (DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD - meanArousal7d) * 4, // 归一化到 0-1
        },
        requiresHumanReview: false,
      };
    }

    // 条件 2:mean_valence < -0.45（连续高强度任务报错导致全村情绪低迷）
    if (meanValence7d < DIRECTOR_CONFIG.VALENCE_LOW_THRESHOLD) {
      return {
        shouldInject: true,
        eventKind: 'tavern_feast',
        priority: 'high',
        reasoning:
          `情绪严重低迷 (${meanValence7d.toFixed(3)} < ${DIRECTOR_CONFIG.VALENCE_LOW_THRESHOLD})，` +
          `需要集中修复效价（${readings}）`,
        parameters: {
          attendanceRate: Math.min(1.0, (DIRECTOR_CONFIG.VALENCE_LOW_THRESHOLD - meanValence7d) * 3),
        },
        // 高优先级一律要人点头：改情绪是重手，导演不该自己决定。
        requiresHumanReview: true,
      };
    }

    // 没触发任何规则。健康区间内就明说健康，否则报告偏离但不注入。
    if (
      meanValence7d >= DIRECTOR_CONFIG.VALENCE_HEALTHY_MIN &&
      meanValence7d <= DIRECTOR_CONFIG.VALENCE_HEALTHY_MAX &&
      meanArousal7d >= DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD
    ) {
      return {
        shouldInject: false,
        priority: 'low',
        reasoning: `世界状态健康，无需干预（${readings}）`,
        requiresHumanReview: false,
      };
    }

    // 轻度偏离但没有对应规则：观察，不注入。
    // 这里原来会注入 festival_start，那是第三条自编规则，已删。
    return {
      shouldInject: false,
      priority: 'low',
      reasoning:
        `情绪均值 ${meanValence7d.toFixed(3)} 略偏离健康区间 ` +
        `[${DIRECTOR_CONFIG.VALENCE_HEALTHY_MIN}, ${DIRECTOR_CONFIG.VALENCE_HEALTHY_MAX}]，` +
        `未达 §2.3 的注入条件（${readings}）`,
      requiresHumanReview: false,
    };
  }
}

// ========== 辅助工具：注入验证器 ==========

/** 导演注入前，必须通过审校的不变式检查 */
export async function validateDirectorInjection(
  decision: DirectorDecision,
  worldInvariants: {
    checkInvariant: (eventKind: InjectableEventKind, parameters?: Record<string, unknown>) => Promise<string | null>;
  },
): Promise<{ valid: boolean; violationReason?: string }> {
  if (!decision.shouldInject || !decision.eventKind) {
    return { valid: true };
  }

  const violation = await worldInvariants.checkInvariant(decision.eventKind, decision.parameters);
  if (violation !== null) {
    return { valid: false, violationReason: violation };
  }

  return { valid: true };
}

// 类型都在上面直接 `export interface` / `export type` 过了，这里不再重复导出。
