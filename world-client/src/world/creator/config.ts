/** 全量待定参数与初值定稿表（v1.0 第 3.3 节）
 *
 * **核心目标**：将所有标注为 `待定` 或未给出具体数字的阈值全部补齐，作为第一波 MVP 的基准配置。
 *
 * **来源**：《补充架构设计与全量待定参数规格书 v1.0》——这是任务组 B 外环的唯一参数真理源
 */

// ============================================================================
// 自治等级爬梯目标表（造物主引擎核心指标）
// ============================================================================

export const AUTONOMY_CLIMB_CONFIG = {
  /**
   * 能力模块 1: 设定理解 (文字 + 图 → 世界圣经)
   * - 起步：L1（生成后人工逐项确认）
   * - 目标：L2（自动检查通过免审）
   * - 门禁：Schema 通过率 = 100% + 冲突数 = 0 + 要素覆盖 ≥ 95%
   */
  SETTING_UNDERSTANDING: {
    startLevel: 1 as const,
    targetLevel: 2 as const,
    metrics: {
      schemaPassRate: 1.0, // 100%
      conflictCount: 0,
      coverageRate: 0.95, // 95%
    },
  } as const,

  /**
   * 能力模块 2: 布局与建筑 (区域图 → 瓦片图)
   * - 起步：L2（自动过检免审，其余人工）
   * - 目标：L3（10% 抽检）
   * - 门禁：寻路连通 = 100% + 重叠碰撞 = 0% + 空间约束 = 100%
   */
  LAYOUT_AND_BUILDING: {
    startLevel: 2 as const,
    targetLevel: 3 as const,
    metrics: {
      pathfindingConnectedRate: 1.0, // 100%
      collisionRate: 0.0, // 0%
      constraintSatisfactionRate: 1.0, // 100%
    },
  } as const,

  /**
   * 能力模块 3: 历史 / 关系 / 记忆 (创世事件与运行时记忆)
   * - 起步：L2（自动过检免审，其余人工）
   * - 目标：L4（无人值守，例外报警）
   * - 门禁：溯源 = 100% + 关系双向对称 = 100% + 同种子回放哈希一致 = 100%
   */
  HISTORY_RELATIONS_MEMORY: {
    startLevel: 2 as const,
    targetLevel: 4 as const,
    metrics: {
      traceabilityRate: 1.0, // 100%
      relationSymmetryRate: 1.0, // 100%
      replayHashConsistencyRate: 1.0, // 100%
    },
  } as const,

  /**
   * 能力模块 4: 静态美术 (建筑本体、道具、纸娃娃叠层)
   * - 起步：L1（生成后人工逐项确认）
   * - 目标：L2（自动过检免审，其余人工）
   * - 门禁：网格对齐 = 100% + 调色板外溢 = 0% + 同类剪影 IoU ≤ 0.75
   */
  STATIC_ART: {
    startLevel: 1 as const,
    targetLevel: 2 as const,
    metrics: {
      gridAlignmentRate: 1.0, // 100%
      colorPaletteBleedRate: 0.0, // 0%
      silhouetteIoUCap: 0.75, // ≤0.75
    },
  } as const,

  /**
   * 能力模块 5: 动画 (角色序列帧与特效)
   * - 起步：L0（人工预制通用裸模骨架）
   * - 目标：L1（模块化换色 + 生成后确认）
   * - 门禁：采用「1 套通用身体帧 + 动态纸娃娃配件叠层 + 建筑局部粒子」绕过序列帧生成瓶颈；帧间重心偏移 ≤ 1px
   */
  ANIMATION: {
    startLevel: 0 as const,
    targetLevel: 1 as const,
    metrics: {
      usesModularSkeleton: true,
      frameToFrameCentroidShiftCap: 1.0, // ≤1px
    },
  } as const,

  /**
   * 能力模块 6: 导演运行 (低频事件注入与节奏控制)
   * - 起步：L1（每日注入指令需人确认）
   * - 目标：L2（低风险事件自动注入）
   * - 门禁：不变式违反 = 0 + 连续 7 天情绪均值在 [-0.3, +0.6]
   */
  DIRECTOR_RUNNING: {
    startLevel: 1 as const,
    targetLevel: 2 as const,
    metrics: {
      invariantViolationCount: 0,
      valenceHealthyRange: {
        min: -0.3,
        max: 0.6,
      },
      consecutiveDaysRequired: 7,
    },
  } as const,

  /**
   * 能力模块 7: 通用性 (跨设定包迁移能力)
   * - 起步：L0（单设定包垂直跑通）
   * - 目标：L2（换第 2 套设定包零改代码）
   * - 门禁：更换风格迥异的第二套设定包时，运行时内核与协议代码修改行数 = 0
   */
  GENERALIZATION: {
    startLevel: 0 as const,
    targetLevel: 2 as const,
    metrics: {
      codeModificationLinesOnSwitch: 0, // 必须是 0
    },
  } as const,
} as const;

// ============================================================================
// 熔断器配置（来自 fuse.ts，但这里集中定义以作文档）
// ============================================================================

export const FUSE_THRESHOLD_CONFIG = {
  // 升级条件
  climbRequiredBatches: 3, // 连续 3 批
  climbRequiredDays: 14, // 或连续 14 个 world_day
  autoCheckPassRateThreshold: 0.98, // ≥98%
  manualModificationRateThreshold: 0.02, // ≤2%

  // 降级触发条件
  summaryRejectionRateThreshold: 0.10, // >10%
  invariantViolationTriggerCount: 1, // ≥1 次即降级
  rollbackTriggerOnce: 1, // 任意回滚即降级

  // 冷却时间
  cooldownDaysAfterDowngrade: 7,
} as const;

// ============================================================================
// 导演 PID 回路配置（来自 v1.0 §2.3 与 §3.3）
// ============================================================================
//
// 这里原来还有 `consecutiveDaysTrigger: 3`、`maxInjectionsPerDay: 2`、
// `eventCooldownDays: 2`。三者在 v1.0 里都找不到出处，`director.ts` 也一次都
// 没有读过——它们是「写在配置里的注释」。留着比删掉更糟：读代码的人会以为
// 每天最多注入两次这条限制真的在生效。规范只给了两个触发阈值与一个健康区间，
// 这里就只留这三组数。

export const DIRECTOR_PID_CONFIG = {
  /** 情绪健康区间（§3.3 导演那一行）。 */
  valenceHealthyMin: -0.3,
  valenceHealthyMax: 0.6,
  /** 健康判定要求的连续天数（§3.3「连续 7 天」）。 */
  healthyConsecutiveDays: 7,

  /** 死寂阈值：`mean_arousal < 0.25` 注入访客/天气异常（§2.3）。 */
  arousalDeathThreshold: 0.25,

  /** 低迷阈值：`mean_valence < -0.45` 注入酒馆宴会（§2.3）。 */
  valenceLowThreshold: -0.45,
} as const;

// ============================================================================
// 内环记忆协议参数（来自 v1.0 第 3.1 节）
// ============================================================================

export const MEMORY_PROTOCOL_CONFIG = {
  /**
   * 世界时钟：**一个世界日 = 24 世界小时**。
   *
   * v1.0 §3.1 写的是 `900` 秒，那是「现实里看完一天要多久」的节奏目标，
   * 不是一天的长度。1027 迭代 README 的问题 8 已经裁定过：`900` 按 `86400`
   * 读，`DAY_MS` 不变；节奏由 `timeScale` 承担（现状默认 6、上限 60）。
   *
   * 这里曾直接抄了 `900` 并注释成「常态 15 分钟」，于是同一份代码里
   * 一天既是 900 秒（这里）又是 86400 秒（`memory/config.ts` 的 `DAY_MS`）。
   * 「连续 14 个 world_day」「连续 7 天情绪均值」两处爬梯门禁的长度因此没有定义。
   */
  dayLengthSeconds: 86_400,

  /** 感知模型 */
  perceptionRadius: {
    outdoor: 8, // 室外 8 格
    indoor: 'same_room', // 室内 = 同房间
  } as const,

  /** 显著度权重（默认各 0.25，角色性格偏置±0.10） */
  salienceWeights: {
    emotion: 0.25,
    surprise: 0.25,
    goalRelevance: 0.25,
    involvement: 0.25,
  } as const,

  /** 写入与晋升阈值 */
  T_write: 0.30, // 写入 Episode
  T_promote: 0.60, // 晋升日摘要
  T_flash: 0.85, // 闪光灯永久记忆

  /** 层级周期 */
  weekLength: 7, // 连续 7 天的 DaySummary 合并压缩为周摘要

  /** 遗忘与衰减 */
  decayRate: 0.15, // 基础日衰减率
  tierFactors: {
    day: 1.0,
    long: 0.3,
    legend: 0.05,
  } as const,
  T_forget: 0.15, // 归档阈值

  /** 回忆强化与重构 */
  boost: 0.25, // 回忆强化系数
  p_blur: 0.20, // 重构变形概率

  /** 各层容量预算（Character） */
  budget: {
    day: 16, // 条
    daySummaryPerDay: 5, // 条/天
    long: 64, // 条
    impression: 32, // 条
  } as const,

  /** 地点痕迹预算 */
  traceBudgetPerPlace: 5, // 每个地点最多 5 层装饰

  /** 检索打分权重 */
  recallWeights: {
    recency: 0.20, // w_r(近因)
    salience: 0.25, // w_i(显著)
    relevance: 0.25, // w_v(相关)
    clue: 0.20, // w_c(线索)
    relationship: 0.10, // w_rel(关系)
  } as const,
  recallBudgetK: 5, // 取 Top-5

  /** 传说形成条件 */
  legendRequirements: {
    holders: 5, // X = 5 个 Holder
    days: 3, // Y = 3 个 world_day
  } as const,
} as const;

// ============================================================================
// 信息传播通道参数（来自 v1.0 第 3.2 节）
// ============================================================================

export const PROPAGATION_CHANNEL_CONFIG = {
  /** A. 五类信息通道参数 */
  channels: {
    /** 直接感知 */
    directPerception: {
      radius: 8, // 室外 8 格 / 室内同房间
      latency: 0, // 即时 0 tick
      fidelity: 3, // detail_level = 3
      capacity: Infinity, // 无限
    } as const,

    /** 交谈 */
    conversation: {
      radius: 2, // 距离≤2 格
      latency: 'meeting_time', // 相遇时
      fidelityDecayPerHop: -1, // 每跳 detail_level - 1
      maxClaimsPerChat: 2, // 单次最多传递 2 条 Claim
      trustMinimum: -0.2, // 需双方关系 trust ≥ -0.2
      secretTrustMinimum: 0.7, // 带 secret 标签需 trust ≥ 0.7
    } as const,

    /** 广播 */
    broadcast: {
      radius: 4, // 公告栏≤4 格或听到钟声
      latency: 'depends_on_carrier', // 取决于载体
      fidelity: 'high', // 高，有权威 confidence≥0.9
      maxAnnouncementsAtOnce: 5, // 公告栏同时最多张贴 5 张
      publishers: ['player', 'village_chief', 'system_daily_report'] as const,
    } as const,

    /** 书面 */
    written: {
      latency: 'slow_cross_day', // 慢（跨天）
      fidelity: 'highest', // 最高，持久不衰减
      capacity: {
        letter: 1, // 单封信件 1 条 Claim
        diaryPerDay: 3, // 单本日记 3 条/天
      } as const,
      permissions: {
        letter: ['sender', 'recipient'],
        diary: ['owner_only'],
        archive: ['scholar', 'village_chief'],
      } as const,
    } as const,

    /** 痕迹 */
    trace: {
      radius: 3, // 路过该建筑≤3 格且触发 CueFired
      latency: 'random', // 随机
      fidelity: 1, // detail_level = 1（需查表推断）
      maxVisibleTraces: 3, // 每个建筑最多显式暴露前 3 个高强度 Trace
    } as const,
  } as const,

  /** B. 传播护栏与评测指标 */
  barriersAndMetrics: {
    maxFanout: 3, // 单个单位就同一条 Claim 每天最多向几个人主动提起
    topicsPerChat: 2, // 每次交谈的话题数
    /**
     * 同一对单位之间就同一话题传播的最小间隔：**1 个 world_day**。
     *
     * §3.2 B 那一格写的是「`1` 个 `world_day`（日常闲聊整体冷却为 `0.25 day`）」，
     * 括号里是另一条参数。这里曾只抄了括号里的 0.25，于是「同一对」的冷却
     * 变成了「整体」的冷却——两条不同的护栏合成了一条，而且取的是松的那个。
     * 真实的两个值在 `memory/config.ts`：`pairCooldownDays: 1` 与
     * `chatCooldownDays: 0.25`。
     */
    pairCooldownDays: 1,
    /** 日常闲聊的整体冷却（与 `pairCooldownDays` 是两个不同的护栏）。 */
    chatCooldownDays: 0.25,
    maxHops: 3, // 断言可传递的最大转手层数
    fidelityDecayPerHop: {
      detailLevelDecay: -1,
      confidenceDecayFactor: 0.80,
      valenceMultiplier: 1.10, // |valence| × 1.10
    } as const,

    // 评测指标验收目标
    metrics: {
      coverageCurve: {
        day1EndMax: 0.35, // 第 1 天末 ≤35%
        day3EndSteadyState: { min: 0.60, max: 0.80 }, // 第 3 天末达到稳态 60%-80%
      } as const,
      fidelityCurve: {
        hop0: 3.0,
        hop1: 2.0,
        hop2: 1.0,
        hop3: 0.0,
      } as const,
      latencyRatio: {
        officialBroadcast: 0.5, // ≤0.5 day
        folkRumor: { min: 1.5, max: 2.5 }, // 1.5~2.5 days
      } as const,
      traceabilityRate: 1.0, // 100%（硬性红线）
      dailyPropagationCost: {
        llmCalls: 0, // 0 次 LLM 调用（纯图算法 <10ms/天）
        dayClosedSummaryPerImportantCharacter: 1, // ≤1 次/天
      } as const,
    } as const,
  } as const,
} as const;

// ============================================================================
// 造物主白名单命令类型清单
// ============================================================================

export const GENESIS_COMMAND_TYPES = {
  CreateRegion: {
    description: '定义新区域（地形、边界、环境特征）',
    requiredFields: ['name', 'boundaries', 'terrainType'],
    optionalFields: ['environmentFeatures', 'description', 'id', 'reason'],
  } as const,
  PlaceBuilding: {
    description: '放置建筑（需要空间约束检查）',
    requiredFields: ['templateId', 'at'],
    optionalFields: ['palette', 'orientation', 'purpose', 'id', 'reason'],
  } as const,
  SpawnCharacter: {
    description: '生成 NPC（需要关系网注入）',
    requiredFields: ['name', 'role', 'startingLocation'],
    optionalFields: ['personalityTraits', 'relationships', 'backstory', 'id', 'reason'],
  } as const,
  SeedHistory: {
    description: '播种历史事件（溯源率 100%）',
    requiredFields: ['eventKind', 'dayOffset', 'participants'],
    optionalFields: ['location', 'outcome', 'sources', 'id', 'reason'],
  } as const,
  InjectEvent: {
    description: '注入低频运行事件（导演专用）',
    requiredFields: ['eventKind', 'timing'],
    optionalFields: ['scope', 'parameters', 'triggers', 'id', 'reason'],
  } as const,
} as const;

// ============================================================================
// 导演白名单注入事件类型
// ============================================================================

export const DIRECTOR_EVENT_KINDS = [
  'visitor_arrival',     // 访客到来 —— 制造新话题线索
  'weather_anomaly',     // 天气异常 —— 打破机械重复
  'tavern_feast',        // 酒馆宴会 —— 修复情绪效价
  'festival_start',      // 节日开始 —— 集中社交激活
  'oracle_message',      // 神谕降临 —— 高 arousal 事件
  'resource_discovery',  // 资源发现 —— 正向激励
  'conflict_resolution', // 冲突化解 —— 缓解紧张关系
] as const;

export type DirectorEventKind = (typeof DIRECTOR_EVENT_KINDS)[number];

// ============================================================================
// 导出所有配置供其他模块使用
// ============================================================================

export type { AutonomyLevel } from './fuse.js';
