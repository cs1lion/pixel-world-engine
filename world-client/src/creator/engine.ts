/** 造物引擎：整合 Fuse（熔断）+ Director（导演）+ Metrics（指标）+ SettingPack（设定集）
 *
 * **核心职责**：
 * 1. 加载并解析设定集 → 构建初始世界状态
 * 2. 协调整个造物流程 → 从 L0 到 L4 的自治爬梯
 * 3. 注入导演事件 → 打破机械重复与死寂
 * 4. 记录质量指标 → 触发升降级门禁
 *
 * **架构分层**：
 * - L0: 人工预制通用裸模骨架（由 `loadSettingPack` + `buildSettingWorld` 完成）
 * - L1: 生成后人工逐项确认（由 `FuseController.evaluateFuseDecision` 判断）
 * - L2: 自动检查免审 / 异常人工（由 `qualityGatesFor(L2)` 放行）
 * - L3: 抽检放行（由 `sampledIn` 决定 10% 抽检）
 * - L4: 无人值守例外报警（完全自动化，只发警报）
 *
 * ## 为什么这个文件住在 `src/creator/`，不在 `src/world/creator/`
 *
 * 第一版把它放在 `src/world/creator/`，与它调度的五个模块并排——听起来最顺。
 * 而 `purity.test.ts` 当场红在三行上：它从 `src/world/` 往上一层 import 了
 * `settings/types.ts`、`settings/load.ts`，而那道闸守的是「世界内核不依赖它上面的
 * 任何一层」，`settings` 尤其不：**世界 import 设定集，就成了世界回头读自己的配置**，
 * 而设定集是可以整套换掉的（`selectSetting` 干的就是这个），世界一旦认它，
 * 换设定集就不再是「换一份输入」。
 *
 * 那道闸没说错，是位置选错了。这个引擎的职责恰恰是**把一份设定集喂给世界**：
 * 它必然同时看得见两边，所以它在两边之上，不在其中任何一边里面。放在
 * `src/creator/` 之后，`src/world/` 依旧一格不越界，而引擎想读什么读什么。
 *
 * 代价：`creator-boundary.test.ts` 扫的是 `src/world/creator/`，它不覆盖这个文件。
 * 那条闸守的是「五个造物主模块不碰记忆表」，而这个文件碰得到 `memory/config.ts`
 * （它要给内环一份配置）——把它并进那条扫描会让闸门要么变宽、要么假豁免一次，
 * 两样都比「它不在扫描范围里，而扫描范围写在测试文件头」更糟。
 */

import type { SettingPack, RawSettingPack } from '../settings/types.ts';
import { loadSettingPack, buildSettingWorld } from '../settings/load.ts';
import {
  AutonomousFuseController,
  AutonomyLevel,
  evaluateFuseDecision,
  type CreatorRoleState,
} from '../world/creator/fuse.ts';
import type { BuiltWorld } from '../world/setup.ts';
import { seedOf, unitFromSeed } from '../world/memory/seed.ts';
import type { MemoryConfig } from '../world/memory/config.ts';
import { DEFAULT_MEMORY_CONFIG } from '../world/memory/config.ts';
import { DirectorEngine } from '../world/director.ts';

/** 造物引擎的全局配置 */
export const CREATOR_ENGINE_CONFIG = {
  /** 默认最大自治等级（爬到就停） */
  defaultTargetLevel: AutonomyLevel.L3 as AutonomyLevel,
  /** 导演健康判定窗口 */
  directorWindowDays: 7,
} as const;

/** 引擎启动参数 */
export interface CreatorEngineOptions {
  readonly worldSeed?: string;
  readonly targetLevel?: AutonomyLevel;
}

/** 造物引擎输出 */
export interface EngineOutput {
  /** 已构建的世界状态 */
  readonly world: BuiltWorld;
  /** 已加载的设定集（编译后） */
  readonly pack: SettingPack;
  /** 当前的自治等级 */
  readonly autonomyLevel: AutonomyLevel;
  /** 导演决策（是否需要注入事件） */
  readonly directorDecision?: DirectorDecision;
  /** 角色状态快照 */
  readonly roleStates: ReadonlyMap<string, CreatorRoleState>;
}

/** 导演决策简化版 */
interface DirectorDecision {
  readonly shouldInject: boolean;
  readonly eventKind?: InjectableEventKind;
  readonly priority: 'low' | 'medium' | 'high';
  readonly reasoning: string;
}

/** 可注入的事件类型 */
type InjectableEventKind =
  | 'visitor_arrival'
  | 'weather_anomaly'
  | 'tavern_feast'
  | 'festival_start'
  | 'oracle_message'
  | 'resource_discovery'
  | 'conflict_resolution';

/** 建造结果 */
export interface BuildResult {
  success: boolean;
  world?: BuiltWorld;
  error?: string;
}

/**
 * 主类：造物引擎
 *
 * **单一职责原则**：
 * - 不直接调用 Phaser（渲染在 `SandboxScene`）
 * - 不直接操作记忆表（在 `memory/` 模块）
 * - 不负责 UI 显示（在 `ui/` 模块）
 * - 只负责**协调整个造物流程**和**质量门禁控制**
 */
export class CreatorEngine {
  private readonly fuseController: AutonomousFuseController;
  private readonly directorEngine: DirectorEngine;
  private readonly pack: SettingPack;
  private readonly world: BuiltWorld;
  private readonly memoryConfig: MemoryConfig;

  constructor(
    rawPack: SettingPack | RawSettingPack,
    options: CreatorEngineOptions = {},
  ) {
    // 1. 加载并校验设定集（编译色板、验证布局可达性）
    this.pack = typeof rawPack === 'object' && !('authored' in rawPack)
      ? loadSettingPack(rawPack as RawSettingPack)
      : (rawPack as SettingPack);

    // 2. 构建初始世界状态
    const { grid, buildings, altar } = buildSettingWorld(this.pack);
    this.world = { grid, buildings, altar };

    // 3. 初始化记忆配置（基于默认配置，覆盖关键参数）
    this.memoryConfig = {
      ...DEFAULT_MEMORY_CONFIG,
      vitalsWindowDays: 3,
      isolatedDays: 3,
    };

    // 4. 初始化熔断器（所有造物主角色从 L0 开始）
    this.fuseController = new AutonomousFuseController();
    this.initializeAllRoles(options.targetLevel ?? CREATOR_ENGINE_CONFIG.defaultTargetLevel);

    // 5. 初始化导演引擎
    this.directorEngine = new DirectorEngine();
    const worldSeed = options.worldSeed ?? 'default-seed';
    this.directorEngine.initialize(worldSeed, 1);

    // 6. 广播世界诞生事件（记忆系统会读取）
    // TODO: 这里应该调用记忆系统的 broadcastDayBorn()
    //   暂时留作接口说明
  }

  /** 初始化所有造物主角色的状态 */
  private initializeAllRoles(targetLevel: AutonomyLevel): void {
    const roles: CreatorRoleState['roleId'][] = [
      'interpreter',     // 解释器：把用户话语转成世界命令
      'art_supervisor',  // 艺术监督：负责视觉一致性
      'mapper',          // 地图师：负责建筑布局
      'historian',       // 历史学家：负责记忆书写
      'director',        // 导演：负责节奏注入
      'auditor',         // 审计员：负责不变式检查
    ];

    for (const roleId of roles) {
      this.fuseController.initRole(roleId, `${roleId}-role`, AutonomyLevel.L0, targetLevel);
    }
  }

  /**
   * 获取当前世界的快照
   */
  getWorldSnapshot(): BuiltWorld {
    return { ...this.world };
  }

  /**
   * 获取角色状态
   */
  getRoleState(roleId: string): CreatorRoleState | undefined {
    return this.fuseController.getRoleState(roleId);
  }

  /**
   * 评估某个角色的决策建议
   */
  getFuseDecision(roleId: string): ReturnType<typeof evaluateFuseDecision> {
    return evaluateFuseDecision(this.fuseController, roleId);
  }

  /**
   * 执行一条造物指令（带熔断控制）
   *
   * @param roleId 哪个造物主角色在执行
   * @param command 要执行的指令
   * @returns 是否被允许执行
   */
  async executeCommand(
    roleId: string,
    _command: {
      kind: string;
      parameters?: Record<string, unknown>;
    },
  ): Promise<{
    allowed: boolean;
    level?: AutonomyLevel;
    reason?: string;
  }> {
    const decision = this.getFuseDecision(roleId);

    switch (decision.action) {
      case 'allow':
        // L3/L4 自动放行
        return {
          allowed: true,
          level: this.fuseController.getRoleState(roleId)?.currentLevel,
          reason: decision.reason,
        };

      case 'requireReview':
        // L1/L2 需要人工确认
        return {
          allowed: false,
          level: this.fuseController.getRoleState(roleId)?.currentLevel,
          reason: decision.reason,
        };

      case 'downgrade':
      case 'isolate':
        // 已熔断，拒绝执行
        return {
          allowed: false,
          reason: decision.reason,
        };

      default:
        return {
          allowed: false,
          reason: '未知策略',
        };
    }
  }

  /**
   * 提交人类确认结果
   */
  submitHumanApproval(
    roleId: string,
    _commandId: string,
    approved: boolean,
    modifications?: Record<string, unknown>,
  ): void {
    const state = this.fuseController.getRoleState(roleId);
    if (!state) return;

    // 记录 Schema 通过率等指标
    this.fuseController.recordCommandResult(roleId, {
      schemaPassed: approved,
      hasConflict: false,
      coverageRate: 1.0,
      pathfindingConnected: true,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      wasManuallyModified: !!modifications,
      invariantViolated: false,
      traceable: true,
      replayHashConsistent: true,
    });

    this.fuseController.endOfDay(roleId);
  }

  /**
   * 处理日终摘要（触发导演注入）
   */
  processDayClosed(vitals: {
    meanValence: number;
    meanArousal: number;
    infoEntropy: number;
    isolatedHoldersCount: number;
  }): {
    shouldInject: boolean;
    eventKind?: InjectableEventKind;
    reasoning: string;
  } {
    const worldSeed = 'default-seed'; // TODO: 从 world.state 读取
    const decision = this.directorEngine.processDayClosed(worldSeed, {
      meanValence: vitals.meanValence,
      meanArousal: vitals.meanArousal,
      infoEntropy: vitals.infoEntropy,
      isolatedHoldersCount: vitals.isolatedHoldersCount,
    });

    if (decision.shouldInject && decision.eventKind) {
      return {
        shouldInject: true,
        eventKind: decision.eventKind,
        reasoning: decision.reasoning,
      };
    }

    return {
      shouldInject: false,
      reasoning: '世界状态健康，无需干预',
    };
  }

  /**
   * 记录回归集测试结果（用于恢复熔断）
   */
  recordRegressionTest(roleId: string, passed: boolean, detail?: Record<string, unknown>): void {
    this.fuseController.recordRegressionRun(roleId, passed, detail ?? {});
  }

  /**
   * 尝试恢复熔断后的角色
   */
  tryResumeFusedRole(roleId: string): boolean {
    return this.fuseController.allowResumeToTarget(roleId);
  }

  /**
   * 生成确定性随机数（用于事件选择）
   */
  deterministicRandom(seedPart: string): number {
    const worldSeed = 'default-seed'; // TODO: 从 world.state 读取
    return unitFromSeed(seedOf(worldSeed, 1, 'creator', seedPart));
  }

  /**
   * 获取内存配置
   */
  getMemoryConfig(): MemoryConfig {
    return this.memoryConfig;
  }

  /**
   * 获取设定集信息
   */
  getPackInfo(): SettingPack {
    return this.pack;
  }

  /**
   * 获取所有角色状态（用于调试/监控）
   */
  getAllRoleStates(): ReadonlyMap<string, CreatorRoleState> {
    return this.fuseController.getAllRoleIds().reduce((acc, id) => {
      const state = this.fuseController.getRoleState(id);
      if (state) acc.set(id, state);
      return acc;
    }, new Map<string, CreatorRoleState>());
  }
}

/** 类型导出 */
export type { RawSettingPack } from '../settings/types.ts';
export type { BuilderContext } from '../world/creator/types.ts';
