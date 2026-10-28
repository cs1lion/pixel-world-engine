/** 造物主创世指令白名单 Schema 与校验器。
 *
 * 这是 LLM 生成器（外环）与引擎（内环）之间的边界网关。模型输出 JSON，
 * **这里决定它能不能进世界**。
 *
 * 三条设计原则（来自《补充架构设计 v1.0》第 0 节的边界锁）：
 *
 * 1. **严禁直读写记忆表/信念表**：造物主六个角色只能提交创世指令，
 *    经本文件校验、再经 `runBusinessRulesCheck` 判空间，最后才变成标准 Event。
 * 2. **只接受白名单命令**：CreateRegion / PlaceBuilding / SpawnCharacter /
 *    SeedHistory / InjectEvent。多一个 kind 就拒。
 * 3. **未知字段直接拒绝，不静默忽略**：模型多写一个字段说明它以为世界有那个能力；
 *    静默丢掉会让它一直以为自己写对了。
 *
 * 与 `creator-schema.ts` 的分工：那一份只认「放一栋楼」的单一造物意图，
 * 是本文件的子集，历史数据仍在用。这里是五条指令的完整白名单。
 */

import { WORLD } from '../palette-data.ts';
import type { GridPoint, PrefabBlueprint } from '../types.ts';

// ========== 错误类型 ==========

export class CreatorSchemaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CreatorSchemaError';
    this.code = code;
  }
}

/** 模块级抛错函数。
 *
 * 必须是 `function` 声明而不是回调参数：TS 只对「声明处就能看到 never 返回类型」
 * 的调用做控制流收窄。写成 `fail: (why: string) => never` 传进来的话，
 * 后面的代码仍然认为值可能是 undefined，整份解析器就得堆满 `as`。
 */
function invalid(why: string): never {
  throw new CreatorSchemaError('INVALID_COMMAND', why);
}

// ========== 创世指令白名单型定义 ==========

interface BaseGenesisCommand {
  /** 可选 ID，用于追踪与回滚定位。 */
  readonly id?: string;
  /** LLM 的建造理由，人类审查时显示。 */
  readonly reason?: string;
}

export type EnvironmentFeature = 'fog' | 'lights' | 'water' | 'ruins';

/** CreateRegion：定义新区域。 */
export interface CreateRegionCommand extends BaseGenesisCommand {
  readonly kind: 'CreateRegion';
  readonly name: string;
  /** 多边形边界点，至少 3 个。 */
  readonly boundaries: GridPoint[];
  readonly terrainType: string;
  readonly environmentFeatures?: EnvironmentFeature[];
  readonly description?: string;
}

export type Orientation = 'n' | 's' | 'e' | 'w';

/** PlaceBuilding：放置建筑。 */
export interface PlaceBuildingCommand extends BaseGenesisCommand {
  readonly kind: 'PlaceBuilding';
  readonly templateId: string;
  readonly at: GridPoint;
  /** 槽位 → 调色板 token 名（不是十六进制）。 */
  readonly palette?: Record<string, string>;
  readonly orientation?: Orientation;
  readonly purpose?: string;
}

export type RelationType = 'friend' | 'enemy' | 'family' | 'colleague';

export interface CharacterRelationship {
  readonly targetName: string;
  readonly relationType: RelationType;
  /** -1 到 1。 */
  readonly strength: number;
}

/** SpawnCharacter：生成 NPC。 */
export interface SpawnCharacterCommand extends BaseGenesisCommand {
  readonly kind: 'SpawnCharacter';
  readonly name: string;
  readonly role: string;
  readonly startingLocation: GridPoint;
  readonly personalityTraits?: string[];
  readonly relationships?: CharacterRelationship[];
  readonly backstory?: string;
}

/** SeedHistory：播种历史事件。参与者必须是已有单位，溯源率是硬红线。 */
export interface SeedHistoryCommand extends BaseGenesisCommand {
  readonly kind: 'SeedHistory';
  readonly eventKind: string;
  /** 相对创世日的偏移，负数表示过去。 */
  readonly dayOffset: number;
  readonly participants: string[];
  readonly location?: GridPoint;
  readonly outcome?: Record<string, unknown>;
  readonly sources?: string[];
}

/** InjectEvent：注入低频运行事件，导演专用。 */
export interface InjectEventCommand extends BaseGenesisCommand {
  readonly kind: 'InjectEvent';
  readonly eventKind: string;
  readonly timing: {
    /** 未来第几天，必须 > 0。 */
    readonly dayOffset: number;
    /** 0-23，可选。 */
    readonly worldTime?: number;
  };
  readonly scope: 'global' | 'localized';
  readonly parameters?: Record<string, unknown>;
  readonly triggers?: Array<{ kind: 'time' | 'condition'; condition?: string }>;
}

export type GenesisCommand =
  | CreateRegionCommand
  | PlaceBuildingCommand
  | SpawnCharacterCommand
  | SeedHistoryCommand
  | InjectEventCommand;

export type GenesisCommandKind = GenesisCommand['kind'];

/** 批处理上下文。 */
export interface GenesisBatchContext {
  readonly settingPackId: string;
  readonly promptHash?: string;
  readonly llmModel?: string;
}

/** 创世指令包。 */
export interface GenesisCommandBatch {
  readonly version: number;
  readonly commands: GenesisCommand[];
  readonly context?: GenesisBatchContext;
}

// ========== 白名单常量 ==========

/** 五条创世指令，别处引用它来断言"没有第六种"。 */
export const GENESIS_COMMAND_KINDS = [
  'CreateRegion',
  'PlaceBuilding',
  'SpawnCharacter',
  'SeedHistory',
  'InjectEvent',
] as const;

export const ENVIRONMENT_FEATURES = ['fog', 'lights', 'water', 'ruins'] as const;
export const ORIENTATIONS = ['n', 's', 'e', 'w'] as const;
export const RELATION_TYPES = ['friend', 'enemy', 'family', 'colleague'] as const;
export const TERRAIN_TYPES = ['forest', 'plains', 'water', 'mountain', 'desert'] as const;

/** 导演能注入的事件。导演不能自己编剧情，只能从这张表里选。 */
export const DIRECTOR_EVENT_KINDS = [
  'visitor_arrival',
  'weather_anomaly',
  'tavern_feast',
  'festival_start',
  'oracle_message',
  'resource_discovery',
  'conflict_resolution',
] as const;

export type DirectorEventKind = (typeof DIRECTOR_EVENT_KINDS)[number];

// ========== 基础校验工具 ==========

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function checkAllowedFields(record: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!set.has(key)) {
      invalid(`未知字段 "${key}"：只接受 ${allowed.join(' / ')}`);
    }
  }
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${key} 必须是字符串`);
  return value;
}

function readGridPoint(
  value: unknown,
  field: string,
  worldSize: { readonly width: number; readonly height: number },
): GridPoint {
  if (!isRecord(value)) invalid(`${field} 必须是 { x, y }`);
  const { x, y } = value;
  if (!isInteger(x)) invalid(`${field}.x 必须是整数格坐标`);
  if (!isInteger(y)) invalid(`${field}.y 必须是整数格坐标`);
  if (x < 0 || y < 0 || x >= worldSize.width || y >= worldSize.height) {
    invalid(
      `${field} (${x}, ${y}) 在世界之外：范围是 0..${worldSize.width - 1} × 0..${worldSize.height - 1}`,
    );
  }
  return { x, y };
}

function readEnum<T extends string>(value: unknown, valid: readonly T[], field: string): T {
  if (typeof value !== 'string') invalid(`${field} 必须是字符串`);
  if (!valid.includes(value as T)) {
    invalid(`${field} 只能取 ${valid.join(' / ')}，收到 "${value}"`);
  }
  return value as T;
}

function readEnumArray<T extends string>(value: unknown, valid: readonly T[], field: string): T[] {
  if (!Array.isArray(value)) invalid(`${field} 必须是数组`);
  return value.map((item, i) => readEnum(item, valid, `${field}[${i}]`));
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(`${field} 必须是字符串数组`);
  return value.map((item, i) => {
    if (!isNonEmptyString(item)) invalid(`${field}[${i}] 必须是非空字符串`);
    return item.trim();
  });
}

function validatePaletteToken(token: string, field: string): void {
  if (token.startsWith('#')) {
    invalid(
      `${field} 不接受十六进制 "${token}"：只能用 24 色表的 token 名，否则会绕开调色板预算`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(WORLD, token)) {
    invalid(`${field} 的 "${token}" 不在 24 色表里：可选 ${Object.keys(WORLD).join(' / ')}`);
  }
}

function readPalette(
  value: unknown,
  template: PrefabBlueprint,
  field: string,
): Record<string, string> {
  if (!isRecord(value)) invalid(`${field} 必须是对象`);
  const slots = Object.keys(template.palette);
  for (const key of Object.keys(value)) {
    if (!slots.includes(key)) {
      invalid(`${field} 里的未知槽 "${key}"：该模板只有 ${slots.join(' / ')}`);
    }
  }
  const resolved: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') invalid(`${field}.${key} 必须是色名 token`);
    validatePaletteToken(raw.trim(), `${field}.${key}`);
    resolved[key] = raw.trim();
  }
  return resolved;
}

// ========== 五条指令的解析器 ==========

export function parseCreateRegionCommand(
  raw: Record<string, unknown>,
  worldSize: { readonly width: number; readonly height: number },
): CreateRegionCommand {
  checkAllowedFields(raw, [
    'kind',
    'id',
    'reason',
    'name',
    'boundaries',
    'terrainType',
    'environmentFeatures',
    'description',
  ]);

  const name = raw.name;
  if (!isNonEmptyString(name)) invalid('CreateRegion.name 必须是非空字符串');

  const boundariesRaw = raw.boundaries;
  if (!Array.isArray(boundariesRaw)) invalid('CreateRegion.boundaries 必须是点数组');
  const boundaries = boundariesRaw.map((point, i) =>
    readGridPoint(point, `CreateRegion.boundaries[${i}]`, worldSize),
  );
  if (boundaries.length < 3) invalid('CreateRegion.boundaries 至少需要 3 个点构成多边形');

  const terrainType = readEnum(raw.terrainType, TERRAIN_TYPES, 'CreateRegion.terrainType');

  const featuresRaw = raw.environmentFeatures;
  const environmentFeatures =
    featuresRaw === undefined
      ? undefined
      : readEnumArray(featuresRaw, ENVIRONMENT_FEATURES, 'CreateRegion.environmentFeatures');

  return {
    kind: 'CreateRegion',
    id: readOptionalString(raw, 'id'),
    reason: readOptionalString(raw, 'reason'),
    name,
    boundaries,
    terrainType,
    environmentFeatures,
    description: readOptionalString(raw, 'description'),
  };
}

export function parsePlaceBuildingCommand(
  raw: Record<string, unknown>,
  templates: ReadonlyMap<string, PrefabBlueprint>,
  worldSize: { readonly width: number; readonly height: number },
): PlaceBuildingCommand {
  checkAllowedFields(raw, [
    'kind',
    'id',
    'reason',
    'templateId',
    'at',
    'palette',
    'orientation',
    'purpose',
  ]);

  const templateId = raw.templateId;
  if (!isNonEmptyString(templateId)) invalid('PlaceBuilding.templateId 必须是非空字符串');
  const template = templates.get(templateId);
  if (template === undefined) {
    invalid(`未知模板 "${templateId}"：可选 ${[...templates.keys()].join(' / ')}`);
  }

  const at = readGridPoint(raw.at, 'PlaceBuilding.at', worldSize);

  // 只判"在不在世界范围里"。能不能建（迷雾、占地、留白、门口）由 runBusinessRulesCheck 判。
  const paletteRaw = raw.palette;
  const palette =
    paletteRaw === undefined ? undefined : readPalette(paletteRaw, template, 'PlaceBuilding.palette');

  const orientationRaw = raw.orientation;
  const orientation =
    orientationRaw === undefined
      ? undefined
      : readEnum(orientationRaw, ORIENTATIONS, 'PlaceBuilding.orientation');

  return {
    kind: 'PlaceBuilding',
    id: readOptionalString(raw, 'id'),
    reason: readOptionalString(raw, 'reason'),
    templateId,
    at,
    palette,
    orientation,
    purpose: readOptionalString(raw, 'purpose'),
  };
}

export function parseSpawnCharacterCommand(
  raw: Record<string, unknown>,
  existingChars: ReadonlySet<string>,
  worldSize: { readonly width: number; readonly height: number },
): SpawnCharacterCommand {
  checkAllowedFields(raw, [
    'kind',
    'id',
    'reason',
    'name',
    'role',
    'startingLocation',
    'personalityTraits',
    'relationships',
    'backstory',
  ]);

  const name = raw.name;
  if (!isNonEmptyString(name)) invalid('SpawnCharacter.name 必须是非空字符串');

  const role = raw.role;
  if (!isNonEmptyString(role)) invalid('SpawnCharacter.role 必须是非空字符串');

  const startingLocation = readGridPoint(
    raw.startingLocation,
    'SpawnCharacter.startingLocation',
    worldSize,
  );

  const traitsRaw = raw.personalityTraits;
  const personalityTraits =
    traitsRaw === undefined
      ? undefined
      : readStringArray(traitsRaw, 'SpawnCharacter.personalityTraits');

  const relationshipsRaw = raw.relationships;
  const relationships =
    relationshipsRaw === undefined
      ? undefined
      : readRelationships(relationshipsRaw, existingChars);

  return {
    kind: 'SpawnCharacter',
    id: readOptionalString(raw, 'id'),
    reason: readOptionalString(raw, 'reason'),
    name,
    role,
    startingLocation,
    personalityTraits,
    relationships,
    backstory: readOptionalString(raw, 'backstory'),
  };
}

function readRelationships(
  raw: unknown,
  existingChars: ReadonlySet<string>,
): CharacterRelationship[] {
  if (!Array.isArray(raw)) invalid('SpawnCharacter.relationships 必须是数组');
  return raw.map((entry, i) => {
    const field = `SpawnCharacter.relationships[${i}]`;
    if (!isRecord(entry)) invalid(`${field} 必须是对象`);
    checkAllowedFields(entry, ['targetName', 'relationType', 'strength']);

    const targetName = entry.targetName;
    if (!isNonEmptyString(targetName)) invalid(`${field}.targetName 必须是非空字符串`);
    if (!existingChars.has(targetName)) {
      invalid(`${field}.targetName "${targetName}" 尚未存在：关系只能连到已有单位`);
    }

    const relationType = readEnum(entry.relationType, RELATION_TYPES, `${field}.relationType`);

    const strength = entry.strength;
    if (typeof strength !== 'number' || !Number.isFinite(strength)) {
      invalid(`${field}.strength 必须是数字`);
    }
    if (strength < -1 || strength > 1) {
      invalid(`${field}.strength 必须在 -1 到 1 之间，收到 ${strength}`);
    }

    return { targetName, relationType, strength };
  });
}

export function parseSeedHistoryCommand(
  raw: Record<string, unknown>,
  existingChars: ReadonlySet<string>,
  worldSize: { readonly width: number; readonly height: number },
): SeedHistoryCommand {
  checkAllowedFields(raw, [
    'kind',
    'id',
    'reason',
    'eventKind',
    'dayOffset',
    'participants',
    'location',
    'outcome',
    'sources',
  ]);

  const eventKind = raw.eventKind;
  if (!isNonEmptyString(eventKind)) invalid('SeedHistory.eventKind 必须是非空字符串');

  const dayOffset = raw.dayOffset;
  if (!isInteger(dayOffset)) invalid('SeedHistory.dayOffset 必须是整数');

  const participantsRaw = raw.participants;
  if (!Array.isArray(participantsRaw)) invalid('SeedHistory.participants 必须是名字数组');
  const participants: string[] = [];
  for (const [i, p] of participantsRaw.entries()) {
    if (!isNonEmptyString(p)) invalid(`SeedHistory.participants[${i}] 必须是非空字符串`);
    if (!existingChars.has(p)) {
      invalid(`SeedHistory.participants[${i}] "${p}" 尚未存在：历史只能引用已有单位（溯源红线）`);
    }
    participants.push(p);
  }
  if (participants.length === 0) invalid('SeedHistory.participants 至少需要 1 个参与者');

  const locationRaw = raw.location;
  const location =
    locationRaw === undefined
      ? undefined
      : readGridPoint(locationRaw, 'SeedHistory.location', worldSize);

  const outcomeRaw = raw.outcome;
  const outcome =
    outcomeRaw === undefined
      ? undefined
      : isRecord(outcomeRaw)
        ? outcomeRaw
        : invalid('SeedHistory.outcome 必须是对象');

  const sourcesRaw = raw.sources;
  const sources =
    sourcesRaw === undefined ? undefined : readStringArray(sourcesRaw, 'SeedHistory.sources');

  return {
    kind: 'SeedHistory',
    id: readOptionalString(raw, 'id'),
    reason: readOptionalString(raw, 'reason'),
    eventKind,
    dayOffset,
    participants,
    location,
    outcome,
    sources,
  };
}

export function parseInjectEventCommand(raw: Record<string, unknown>): InjectEventCommand {
  checkAllowedFields(raw, [
    'kind',
    'id',
    'reason',
    'eventKind',
    'timing',
    'scope',
    'parameters',
    'triggers',
  ]);

  const eventKind = readEnum(raw.eventKind, DIRECTOR_EVENT_KINDS, 'InjectEvent.eventKind');

  const timingRaw = raw.timing;
  if (!isRecord(timingRaw)) invalid('InjectEvent.timing 必须是对象');
  checkAllowedFields(timingRaw, ['dayOffset', 'worldTime']);

  const dayOffset = timingRaw.dayOffset;
  if (!isInteger(dayOffset)) invalid('InjectEvent.timing.dayOffset 必须是整数');
  if (dayOffset <= 0) invalid('InjectEvent.timing.dayOffset 必须是正整数：导演只能注入未来事件');

  const worldTimeRaw = timingRaw.worldTime;
  let worldTime: number | undefined;
  if (worldTimeRaw !== undefined) {
    if (!isInteger(worldTimeRaw) || worldTimeRaw < 0 || worldTimeRaw >= 24) {
      invalid('InjectEvent.timing.worldTime 必须是 0..23 的整数');
    }
    worldTime = worldTimeRaw;
  }

  const scopeRaw = raw.scope;
  if (scopeRaw !== 'global' && scopeRaw !== 'localized') {
    invalid('InjectEvent.scope 必须是 "global" 或 "localized"');
  }

  const parametersRaw = raw.parameters;
  const parameters =
    parametersRaw === undefined
      ? undefined
      : isRecord(parametersRaw)
        ? parametersRaw
        : invalid('InjectEvent.parameters 必须是对象');

  const triggersRaw = raw.triggers;
  const triggers = triggersRaw === undefined ? undefined : readTriggers(triggersRaw);

  return {
    kind: 'InjectEvent',
    id: readOptionalString(raw, 'id'),
    reason: readOptionalString(raw, 'reason'),
    eventKind,
    timing: { dayOffset, worldTime },
    scope: scopeRaw,
    parameters,
    triggers,
  };
}

function readTriggers(raw: unknown): Array<{ kind: 'time' | 'condition'; condition?: string }> {
  if (!Array.isArray(raw)) invalid('InjectEvent.triggers 必须是数组');
  return raw.map((entry, i) => {
    const field = `InjectEvent.triggers[${i}]`;
    if (!isRecord(entry)) invalid(`${field} 必须是对象`);
    const kind = readEnum(entry.kind, ['time', 'condition'] as const, `${field}.kind`);
    if (kind === 'condition') {
      const condition = entry.condition;
      if (!isNonEmptyString(condition)) {
        invalid(`${field}.condition 在 kind=condition 时必须有非空字符串`);
      }
      return { kind, condition: condition.trim() };
    }
    return { kind };
  });
}

// ========== 主入口 ==========

export function parseGenesisCommandBatch(
  raw: unknown,
  options: {
    templates: ReadonlyMap<string, PrefabBlueprint>;
    worldSize: { readonly width: number; readonly height: number };
    existingChars: ReadonlySet<string>;
  },
): GenesisCommandBatch {
  if (!isRecord(raw)) invalid('创世指令包必须是对象');
  checkAllowedFields(raw, ['version', 'commands', 'context']);

  const version = raw.version;
  if (!isInteger(version) || version < 1) invalid('version 必须是 ≥1 的整数');

  const commandsRaw = raw.commands;
  if (!Array.isArray(commandsRaw)) invalid('commands 必须是数组');
  if (commandsRaw.length === 0) invalid('commands 不能是空数组');

  const commands = commandsRaw.map((cmdRaw, i) => {
    if (!isRecord(cmdRaw)) invalid(`commands[${i}] 必须是对象`);
    const kind = cmdRaw.kind;
    if (typeof kind !== 'string') invalid(`commands[${i}] 缺少 kind 字段`);

    try {
      switch (kind) {
        case 'CreateRegion':
          return parseCreateRegionCommand(cmdRaw, options.worldSize);
        case 'PlaceBuilding':
          return parsePlaceBuildingCommand(cmdRaw, options.templates, options.worldSize);
        case 'SpawnCharacter':
          return parseSpawnCharacterCommand(cmdRaw, options.existingChars, options.worldSize);
        case 'SeedHistory':
          return parseSeedHistoryCommand(cmdRaw, options.existingChars, options.worldSize);
        case 'InjectEvent':
          return parseInjectEventCommand(cmdRaw);
        default:
          return invalid(
            `commands[${i}].kind "${kind}" 不在白名单：${GENESIS_COMMAND_KINDS.join(' / ')}`,
          );
      }
    } catch (err) {
      if (err instanceof CreatorSchemaError) {
        // 补上指令序号，否则一份 30 条指令的批处理里只知道"某条坏了"。
        throw new CreatorSchemaError(err.code, `commands[${i}] 无效：${err.message}`);
      }
      throw err;
    }
  });

  const contextRaw = raw.context;
  const context =
    contextRaw === undefined
      ? undefined
      : isRecord(contextRaw)
        ? readContext(contextRaw)
        : invalid('context 必须是对象');

  return { version, commands, context };
}

function readContext(raw: Record<string, unknown>): GenesisBatchContext {
  checkAllowedFields(raw, ['settingPackId', 'promptHash', 'llmModel']);

  const settingPackId = raw.settingPackId;
  if (!isNonEmptyString(settingPackId)) invalid('context.settingPackId 必须是非空字符串');

  return {
    settingPackId,
    promptHash: readOptionalString(raw, 'promptHash'),
    llmModel: readOptionalString(raw, 'llmModel'),
  };
}

// ========== 第二重门禁：运行时业务规则 ==========

/** 空间与不变式检查所需的世界状态。 */
export interface WorldStateView {
  getOccupiedCells: () => ReadonlySet<string>;
  checkSpatialConstraints: (command: PlaceBuildingCommand) => Promise<string | null>;
  checkInvariants: (command: GenesisCommand) => Promise<string | null>;
}

export interface CommandViolation {
  readonly commandIndex: number;
  readonly commandKind: GenesisCommandKind;
  readonly message: string;
}

/**
 * Schema 通过之后的第二重门禁：空间占用、约束、不变式。
 *
 * 分两层是刻意的：Schema 判「这是不是一份合法的造物意图」（纯数据，同步），
 * 这里判「这个意图落在这张图上成不成立」（要看世界状态，异步）。
 */
export async function runBusinessRulesCheck(
  batch: GenesisCommandBatch,
  worldState: WorldStateView,
): Promise<{ passed: boolean; violations: CommandViolation[] }> {
  const violations: CommandViolation[] = [];

  for (const [index, command] of batch.commands.entries()) {
    if (command.kind === 'PlaceBuilding') {
      const cell = `${command.at.x},${command.at.y}`;
      if (worldState.getOccupiedCells().has(cell)) {
        violations.push({
          commandIndex: index,
          commandKind: 'PlaceBuilding',
          message: `坐标 ${cell} 已被占用`,
        });
        continue;
      }
      const spatial = await worldState.checkSpatialConstraints(command);
      if (spatial !== null) {
        violations.push({
          commandIndex: index,
          commandKind: 'PlaceBuilding',
          message: spatial,
        });
      }
      continue;
    }

    const invariant = await worldState.checkInvariants(command);
    if (invariant !== null) {
      violations.push({ commandIndex: index, commandKind: command.kind, message: invariant });
    }
  }

  return { passed: violations.length === 0, violations };
}
