/**
 * WorldBundle v1 的确定性校验器。
 *
 * 只做一件事：把一份「可能是模型吐出来的 JSON」按 `schema.ts` 的口径全量过一遍，
 * 返回 `{ ok, violations }`。它**不抛**——校验器本来就是给大模型自修复 loop
 * 喂输入的，抛异常等于把修复线索扔掉。
 *
 * 确定性口径（与 `src/world` 其余文件同一条 purity 契约）：
 * - 同一份输入永远得到同一份 violations（顺序也固定：按字段声明序、按数组下标）；
 * - 不读 `Date.now()`、不摇 `Math.random()`、不 import 渲染/界面/设定集层；
 * - 数值一律先过 `Number.isInteger` / `Number.isFinite` 再进区间判断，
 *   NaN 与 Infinity 在这份契约里没有名字。
 *
 * violations 的 `code` 是机器可读的稳定字符串（与 `server/compiler/schema.py`
 * 同名同义，两边各自实现、同一套口径）；`path` 指到具体字段，
 * `message` 是能直接回传给模型的人话。
 */

import type { Weather } from '../types.ts';
import type { PhaseKind, WorldBundle } from './schema.ts';
import {
  CLIMATE_IDS,
  PHASE_KINDS,
  RELATION_DEBT_MAX,
  RELATION_DEBT_MIN,
  RELATION_MAX,
  RELATION_MIN,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN,
  VOICE_TEMPO_MAX,
  VOICE_TEMPO_MIN,
  VOICE_WARMTH_MAX,
  VOICE_WARMTH_MIN,
  WEATHER_IDS,
  WORLD_BUNDLE_SCHEMA_VERSION,
} from './schema.ts';

export interface BundleViolation {
  /** 点名到字段，如 `cast[2].voiceProfile.tempo`。 */
  readonly path: string;
  /** 机器可读的稳定编码，与 Python 侧同名校验器共用同一套词表。 */
  readonly code: string;
  /** 回给模型的人话：带了期望区间与实际值。 */
  readonly message: string;
}

export interface BundleValidation {
  readonly ok: boolean;
  readonly violations: readonly BundleViolation[];
}

type Push = (path: string, code: string, message: string) => void;

export function validateWorldBundle(raw: unknown): BundleValidation {
  const violations: BundleViolation[] = [];
  const push: Push = (path, code, message) => {
    violations.push({ path, code, message });
  };

  if (!isRecord(raw)) {
    return fail(push, 'bundle', 'bundle.notObject', 'WorldBundle 必须是对象');
  }

  if (raw.schemaVersion !== WORLD_BUNDLE_SCHEMA_VERSION) {
    push(
      'schemaVersion',
      'schemaVersion.unsupported',
      `schemaVersion 必须是 ${WORLD_BUNDLE_SCHEMA_VERSION}，收到 ${show(raw.schemaVersion)}`,
    );
  }

  validateMeta(raw.meta, push);
  validateClimate(raw.climate, push);
  validateGrid(raw.grid, push);
  validateRegions(raw.regions, raw.grid, push);
  validatePrefabs(raw.prefabs, push);
  validateCast(raw.cast, push);
  validatePhases(raw.phases, push);

  return { ok: violations.length === 0, violations };
}

function fail(
  push: Push,
  path: string,
  code: string,
  message: string,
): BundleValidation {
  push(path, code, message);
  return { ok: false, violations: [{ path, code, message }] };
}

function validateMeta(meta: unknown, push: Push): void {
  if (meta === undefined) {
    push('meta', 'meta.missing', '缺 meta（id / title / loreSummary / seed）');
    return;
  }
  if (!isRecord(meta)) {
    push('meta', 'meta.notObject', 'meta 必须是对象');
    return;
  }
  requireNonEmptyString(meta, 'id', 'meta.id', push);
  requireNonEmptyString(meta, 'title', 'meta.title', push);
  requireNonEmptyString(meta, 'loreSummary', 'meta.loreSummary', push);
  const seed = asInt(meta.seed);
  if (seed === undefined || seed < 0 || seed > 0x7fffffff) {
    push(
      'meta.seed',
      'meta.seed.range',
      `meta.seed 必须是 0..2147483647 的整数，收到 ${show(meta.seed)}`,
    );
  }
}

function validateClimate(climate: unknown, push: Push): void {
  if (climate === undefined) {
    push('climate', 'climate.missing', '缺 climate（kind / weatherWeights）');
    return;
  }
  if (!isRecord(climate)) {
    push('climate', 'climate.notObject', 'climate 必须是对象');
    return;
  }
  if (!isOneOf(climate.kind, CLIMATE_IDS)) {
    push(
      'climate.kind',
      'climate.kind.unsupported',
      `climate.kind 取值 ${show(climate.kind)} 不在 ${CLIMATE_IDS.join('/')} 里`,
    );
  }
  const weights = climate.weatherWeights;
  if (weights === undefined) {
    push('climate.weatherWeights', 'climate.weatherWeights.missing', '缺 climate.weatherWeights');
    return;
  }
  if (!isRecord(weights)) {
    push('climate.weatherWeights', 'climate.weatherWeights.notObject', 'climate.weatherWeights 必须是对象');
    return;
  }
  let sawPositive = false;
  for (const [key, value] of Object.entries(weights)) {
    const path = `climate.weatherWeights.${key}`;
    if (!isWeatherId(key)) {
      push(path, 'climate.weatherWeights.unknown', `未知天气 ${key}；只认 ${WEATHER_IDS.join('/')}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      push(path, 'climate.weatherWeights.range', `天气权重必须是 0..1 的有限小数，收到 ${show(value)}`);
      continue;
    }
    if (value > 0) sawPositive = true;
  }
  if (!sawPositive) {
    push(
      'climate.weatherWeights',
      'climate.weatherWeights.allZero',
      'weatherWeights 全部为 0（或缺席）：这个气候下永远不会有任何天气',
    );
  }
}

function validateGrid(grid: unknown, push: Push): void {
  if (grid === undefined) {
    push('grid', 'grid.missing', '缺 grid（width / height）');
    return;
  }
  if (!isRecord(grid)) {
    push('grid', 'grid.notObject', 'grid 必须是对象');
    return;
  }
  requirePositiveInt(grid, 'width', 'grid.width', 'grid.range', push);
  requirePositiveInt(grid, 'height', 'grid.height', 'grid.range', push);
}

function validateRegions(regions: unknown, grid: unknown, push: Push): void {
  if (regions === undefined) {
    push('regions', 'regions.missing', '缺 regions（可为空数组，但不能缺）');
    return;
  }
  if (!Array.isArray(regions)) {
    push('regions', 'regions.notArray', 'regions 必须是数组');
    return;
  }
  const width = isRecord(grid) ? asInt(grid.width) : undefined;
  const height = isRecord(grid) ? asInt(grid.height) : undefined;
  const seenIds = new Set<string>();
  regions.forEach((entry, index) => {
    const path = `regions[${index}]`;
    if (!isRecord(entry)) {
      push(path, 'region.notObject', `${path} 必须是对象`);
      return;
    }
    requireNonEmptyString(entry, 'id', `${path}.id`, push);
    requireNonEmptyString(entry, 'label', `${path}.label`, push);
    const id = entry.id;
    if (typeof id === 'string' && id !== '') {
      if (seenIds.has(id)) {
        push(`${path}.id`, 'region.duplicateId', `分区 id ${JSON.stringify(id)} 重复`);
      } else {
        seenIds.add(id);
      }
    }
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const isSize = key === 'w' || key === 'h';
      const value = asInt(entry[key]);
      if (value === undefined || value < (isSize ? 1 : 0)) {
        push(
          `${path}.${key}`,
          'region.bounds.range',
          `分区 ${key} 必须是${isSize ? '正' : '非负'}整数，收到 ${show(entry[key])}`,
        );
      }
    }
    const x = asInt(entry.x);
    const y = asInt(entry.y);
    const w = asInt(entry.w);
    const h = asInt(entry.h);
    if (
      width !== undefined && height !== undefined &&
      x !== undefined && y !== undefined && w !== undefined && h !== undefined &&
      (x < 0 || y < 0 || x + w > width || y + h > height)
    ) {
      push(
        path,
        'region.outOfBounds',
        `分区 ${JSON.stringify(String(id))} 越界：矩形 ${x},${y} ${w}x${h} 超出了 ${width}x${height} 的世界`,
      );
    }
    if (!Array.isArray(entry.tags)) {
      push(`${path}.tags`, 'region.tags.notArray', `${path}.tags 必须是数组`);
    } else {
      entry.tags.forEach((tag, tagIndex) => {
        if (typeof tag !== 'string' || tag === '') {
          push(`${path}.tags[${tagIndex}]`, 'region.tag.empty', `标签必须是非空字符串，收到 ${show(tag)}`);
        }
      });
    }
  });
}

function validatePrefabs(prefabs: unknown, push: Push): void {
  if (prefabs === undefined) {
    push('prefabs', 'prefabs.missing', '缺 prefabs（可为空数组，但不能缺）');
    return;
  }
  if (!Array.isArray(prefabs)) {
    push('prefabs', 'prefabs.notArray', 'prefabs 必须是数组');
    return;
  }
  const seenIds = new Set<string>();
  prefabs.forEach((entry, index) => {
    const path = `prefabs[${index}]`;
    if (!isRecord(entry)) {
      push(path, 'prefab.notObject', `${path} 必须是对象`);
      return;
    }
    requireNonEmptyString(entry, 'id', `${path}.id`, push);
    const id = entry.id;
    if (typeof id === 'string' && id !== '') {
      if (seenIds.has(id)) {
        push(`${path}.id`, 'prefab.duplicateId', `蓝图 id ${JSON.stringify(id)} 重复`);
      } else {
        seenIds.add(id);
      }
    }
    const footprint = entry.footprint;
    let footprintW: number | undefined;
    let footprintH: number | undefined;
    if (!isRecord(footprint)) {
      push(`${path}.footprint`, 'prefab.footprint.notObject', `${path}.footprint 必须是 { w, h }`);
    } else {
      footprintW = asInt(footprint.w);
      footprintH = asInt(footprint.h);
      if (footprintW === undefined || footprintW < 1) {
        push(`${path}.footprint.w`, 'prefab.footprint.range', `占地 w 必须是正整数，收到 ${show(footprint.w)}`);
      }
      if (footprintH === undefined || footprintH < 1) {
        push(`${path}.footprint.h`, 'prefab.footprint.range', `占地 h 必须是正整数，收到 ${show(footprint.h)}`);
      }
    }
    const margin = asInt(entry.clearMargin);
    if (margin === undefined || margin < 0) {
      push(`${path}.clearMargin`, 'prefab.clearMargin.range', `clearMargin 必须是非负整数，收到 ${show(entry.clearMargin)}`);
    }
    const door = asPoint(entry.door);
    if (door === undefined) {
      push(`${path}.door`, 'prefab.door.notPoint', `${path}.door 必须是整数格 { x, y }`);
    } else if (door.x < 0 || door.y < 0) {
      push(`${path}.door`, 'prefab.door.negative', `门口坐标不能为负，收到 (${door.x}, ${door.y})`);
    } else if (
      footprintW !== undefined && footprintH !== undefined &&
      door.x < footprintW && door.y < footprintH
    ) {
      push(
        `${path}.door`,
        'prefab.door.insideFootprint',
        `门口落在占地内，人走不进去；门必须在 ${footprintW}x${footprintH} 的占地外`,
      );
    }
    const spots = entry.workSpots;
    if (!Array.isArray(spots)) {
      push(`${path}.workSpots`, 'prefab.workSpots.notArray', `${path}.workSpots 必须是数组`);
      return;
    }
    if (spots.length === 0) {
      push(`${path}.workSpots`, 'prefab.workSpots.empty', `${path}.workSpots 不能为空`);
      return;
    }
    spots.forEach((spot, spotIndex) => {
      const spotPath = `${path}.workSpots[${spotIndex}]`;
      const point = asPoint(spot);
      if (point === undefined) {
        push(spotPath, 'prefab.workSpots.notPoint', `${spotPath} 必须是整数格 { x, y }`);
        return;
      }
      if (point.x < 0 || point.y < 0) {
        push(spotPath, 'prefab.workSpots.negative', `工位坐标不能为负，收到 (${point.x}, ${point.y})`);
        return;
      }
      if (
        footprintW !== undefined && footprintH !== undefined &&
        (point.x >= footprintW || point.y >= footprintH)
      ) {
        push(
          spotPath,
          'prefab.workSpots.outsideFootprint',
          `工位落在占地外：(${point.x}, ${point.y}) 不在 ${footprintW}x${footprintH} 里`,
        );
      }
    });
  });
}

function validateCast(cast: unknown, push: Push): void {
  if (cast === undefined) {
    push('cast', 'cast.missing', '缺 cast（居民数组，至少 1 位）');
    return;
  }
  if (!Array.isArray(cast)) {
    push('cast', 'cast.notArray', 'cast 必须是数组');
    return;
  }
  if (cast.length === 0) {
    push('cast', 'cast.empty', 'cast 不能为空数组：世界至少要有 1 位居民');
    return;
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  cast.forEach((entry, index) => {
    const path = `cast[${index}]`;
    if (!isRecord(entry)) {
      push(path, 'cast.notObject', `${path} 必须是对象`);
      return;
    }
    requireNonEmptyString(entry, 'id', `${path}.id`, push);
    requireNonEmptyString(entry, 'name', `${path}.name`, push);
    requireNonEmptyString(entry, 'persona', `${path}.persona`, push);
    const id = entry.id;
    if (typeof id === 'string' && id !== '') {
      if (seenIds.has(id)) {
        push(`${path}.id`, 'cast.duplicateId', `居民 id ${JSON.stringify(id)} 重复`);
      } else {
        seenIds.add(id);
      }
    }
    const name = entry.name;
    if (typeof name === 'string' && name !== '') {
      if (seenNames.has(name)) {
        push(`${path}.name`, 'cast.duplicateName', `居民姓名 ${JSON.stringify(name)} 重复`);
      } else {
        seenNames.add(name);
      }
    }
    validateRelations(entry, id, cast, path, push);
    validateVoice(entry.voiceProfile, path, push);
  });
}

function validateRelations(
  entry: Record<string, unknown>,
  id: unknown,
  cast: readonly unknown[],
  path: string,
  push: Push,
): void {
  const relations = entry.initialRelations;
  if (relations === undefined) {
    push(`${path}.initialRelations`, 'cast.relations.missing', `${path}.initialRelations 不能缺（可没有关系，但字段要在）`);
    return;
  }
  if (!Array.isArray(relations)) {
    push(`${path}.initialRelations`, 'cast.relations.notArray', `${path}.initialRelations 必须是数组`);
    return;
  }
  const castIds = new Set(
    cast.filter(isRecord).map((member) => member.id).filter((value): value is string => typeof value === 'string'),
  );
  relations.forEach((relation, relIndex) => {
    const relPath = `${path}.initialRelations[${relIndex}]`;
    if (!isRecord(relation)) {
      push(relPath, 'cast.relation.notObject', `${relPath} 必须是对象`);
      return;
    }
    const to = relation.to;
    if (typeof to !== 'string' || to === '') {
      push(`${relPath}.to`, 'cast.relation.to.empty', `${relPath}.to 必须是非空字符串`);
    } else if (to === id) {
      push(`${relPath}.to`, 'cast.relation.to.self', `${relPath}.to 不能指向自己（${JSON.stringify(to)}）`);
    } else if (!castIds.has(to)) {
      push(`${relPath}.to`, 'cast.relation.to.unknown', `${relPath}.to 指向的 ${JSON.stringify(to)} 不在这份 cast 里`);
    }
    checkRange(relation, 'trust', `${relPath}.trust`, RELATION_MIN, RELATION_MAX, '信任', 'cast.relation.range', push);
    checkRange(relation, 'warmth', `${relPath}.warmth`, RELATION_MIN, RELATION_MAX, '亲密度', 'cast.relation.range', push);
    checkRange(relation, 'debt', `${relPath}.debt`, RELATION_DEBT_MIN, RELATION_DEBT_MAX, '欠债', 'cast.relation.range', push);
    checkRange(relation, 'familiarity', `${relPath}.familiarity`, RELATION_MIN, RELATION_MAX, '熟悉度', 'cast.relation.range', push);
  });
}

function validateVoice(voice: unknown, path: string, push: Push): void {
  if (voice === undefined) {
    push(`${path}.voiceProfile`, 'cast.voiceProfile.missing', `${path}.voiceProfile 不能缺`);
    return;
  }
  if (!isRecord(voice)) {
    push(`${path}.voiceProfile`, 'cast.voiceProfile.notObject', `${path}.voiceProfile 必须是对象`);
    return;
  }
  checkRange(voice, 'pitch', `${path}.voiceProfile.pitch`, VOICE_PITCH_MIN, VOICE_PITCH_MAX, '音高', 'cast.voiceProfile.range', push);
  checkRange(voice, 'tempo', `${path}.voiceProfile.tempo`, VOICE_TEMPO_MIN, VOICE_TEMPO_MAX, '语速', 'cast.voiceProfile.range', push);
  checkRange(voice, 'warmth', `${path}.voiceProfile.warmth`, VOICE_WARMTH_MIN, VOICE_WARMTH_MAX, '暖度', 'cast.voiceProfile.range', push);
}

function validatePhases(phases: unknown, push: Push): void {
  if (phases === undefined) return;
  if (!Array.isArray(phases)) {
    push('phases', 'phases.notArray', 'phases 必须是数组');
    return;
  }
  const seenIds = new Set<string>();
  phases.forEach((entry, index) => {
    const path = `phases[${index}]`;
    if (!isRecord(entry)) {
      push(path, 'phase.notObject', `${path} 必须是对象`);
      return;
    }
    requireNonEmptyString(entry, 'id', `${path}.id`, push);
    requireNonEmptyString(entry, 'label', `${path}.label`, push);
    const id = entry.id;
    if (typeof id === 'string' && id !== '') {
      if (seenIds.has(id)) {
        push(`${path}.id`, 'phase.duplicateId', `阶段 id ${JSON.stringify(id)} 重复`);
      } else {
        seenIds.add(id);
      }
    }
    if (!isOneOf(entry.kind, PHASE_KINDS)) {
      push(
        `${path}.kind`,
        'phase.kind.unsupported',
        `phase.kind 取值 ${show(entry.kind)} 不在 ${PHASE_KINDS.join('/')} 里`,
      );
      return;
    }
    const kind = entry.kind as PhaseKind;
    if (kind === 'countdown') {
      const ticks = asInt(entry.afterTicks);
      if (ticks === undefined || ticks < 1) {
        push(`${path}.afterTicks`, 'phase.afterTicks.range', `countdown 阶段的 afterTicks 必须是正整数，收到 ${show(entry.afterTicks)}`);
      }
    } else if (kind === 'climate') {
      if (!isOneOf(entry.toClimate, CLIMATE_IDS)) {
        push(`${path}.toClimate`, 'phase.toClimate.unsupported', `climate 阶段的 toClimate 必须在 ${CLIMATE_IDS.join('/')} 里，收到 ${show(entry.toClimate)}`);
      }
    } else {
      if (typeof entry.condition !== 'string' || entry.condition === '') {
        push(`${path}.condition`, 'phase.condition.empty', `${kind} 阶段必须给非空的 condition 触发条件`);
      }
    }
  });
}

function requireNonEmptyString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  push: Push,
): void {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    push(path, `${path}.empty`, `${path} 必须是非空字符串，收到 ${show(value)}`);
  }
}

function requirePositiveInt(
  source: Record<string, unknown>,
  key: string,
  path: string,
  code: string,
  push: Push,
): void {
  const value = asInt(source[key]);
  if (value === undefined || value < 1) {
    push(path, code, `${path} 必须是正整数，收到 ${show(source[key])}`);
  }
}

function checkRange(
  source: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  max: number,
  label: string,
  code: string,
  push: Push,
): void {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    push(path, code, `${label}参数 ${key} 必须是 ${min}..${max} 的有限小数，收到 ${show(value)}`);
  }
}

/** 只有「整数」这一种数字进几何与种子；小数一律视为没给。 */
function asInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** 整数格点：x / y 都必须是整数。 */
function asPoint(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = asInt(value.x);
  const y = asInt(value.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function isWeatherId(value: string): value is Weather {
  return WEATHER_IDS.includes(value as Weather);
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/** 便捷封装：只问合不合法。 */
export function isValidWorldBundle(raw: unknown): raw is WorldBundle {
  return validateWorldBundle(raw).ok;
}

