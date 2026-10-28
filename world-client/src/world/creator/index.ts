/** 造物主引擎统一导出（外环）。
 *
 * 五条创世指令是外环与内环之间唯一的通道：造物主各角色不碰记忆表，
 * 只能提交这里的指令类型，经 `parseGenesisCommandBatch` 校验后变成标准 Event。
 */

// ===== Schema 与五条白名单指令 =====
export {
  CreatorSchemaError,
  GENESIS_COMMAND_KINDS,
  DIRECTOR_EVENT_KINDS,
  ENVIRONMENT_FEATURES,
  ORIENTATIONS,
  RELATION_TYPES,
  TERRAIN_TYPES,
  parseCreateRegionCommand,
  parsePlaceBuildingCommand,
  parseSpawnCharacterCommand,
  parseSeedHistoryCommand,
  parseInjectEventCommand,
  parseGenesisCommandBatch,
  runBusinessRulesCheck,
} from './schema.js';

export type {
  GenesisCommand,
  GenesisCommandKind,
  GenesisCommandBatch,
  GenesisBatchContext,
  CreateRegionCommand,
  PlaceBuildingCommand,
  SpawnCharacterCommand,
  SeedHistoryCommand,
  InjectEventCommand,
  CharacterRelationship,
  RelationType,
  Orientation,
  EnvironmentFeature,
  DirectorEventKind,
  WorldStateView,
  CommandViolation,
} from './schema.js';

// ===== 逆向审校合成器 =====
export { RuleSynthesizer, buildStructuredDiff, isSelfJustifying } from './synthesizer.js';

export type {
  StructuredDiff,
  RulePatch,
  SpatialConstraintPatch,
  ArtQualityPatch,
  NarrativeInvariantPatch,
  TemplatePromptPatch,
  SynthesisResult,
  SynthesisContext,
  RegressionVerdict,
  DiffType,
} from './synthesizer.js';

// ===== 双向熔断与降级 =====
export { AutonomyLevel, AutonomousFuseController, evaluateFuseDecision, FUSE_CONFIG } from './fuse.js';

export type { CreatorRoleState, MetricWindow, FuseEventType, FuseEvent, FuseDecision } from './fuse.js';

// ===== 自动化门禁指标 =====
export { runAllGateChecks, isGatePassed } from './metrics.js';

export type {
  CommandCheckResult,
  BatchCheckResults,
  AggregateGateMetrics,
  CheckContext,
} from './metrics.js';

// ===== 全量参数（v1.0 第 3.3 节定稿表） =====
export {
  AUTONOMY_CLIMB_CONFIG,
  FUSE_THRESHOLD_CONFIG,
  MEMORY_PROTOCOL_CONFIG,
  PROPAGATION_CHANNEL_CONFIG,
} from './config.js';
