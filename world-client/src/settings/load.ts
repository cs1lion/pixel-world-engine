/** 外部设定集的唯一入口：先校验，再编译成已有的网格与蓝图。 */
import { parseBlueprintTable } from '../world/blueprints.ts';
import type { BuiltWorld } from '../world/setup.ts';
import { placeBlueprint, rehydratePalettes, WorldSetupError } from '../world/setup.ts';
import { WorldGrid } from '../world/grid.ts';
import type { PlacedBuilding } from '../world/types.ts';
import type { RawSettingPack, SettingPack } from './types.ts';

export class SettingPackError extends Error {}

function point(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) throw new SettingPackError(`${label} 缺坐标`);
  const p = value as { x?: unknown; y?: unknown };
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
    throw new SettingPackError(`${label} 必须是整数格`);
  }
}

export function loadSettingPack(raw: RawSettingPack): SettingPack {
  if (!/^[a-z][a-z0-9-]*$/.test(raw.id)) throw new SettingPackError('设定集 id 不合法');
  if (raw.saveKey.length === 0) throw new SettingPackError('存档槽不能为空');
  const palette = Object.fromEntries(
    Object.entries(raw.palette).map(([name, value]) => [name, parseColor(value, name)]),
  );
  const required = ['ink', 'soil', 'grass', 'grassLit', 'stone', 'plaza', 'farm', 'timber', 'timberDark', 'trim', 'amber', 'skin', 'cloak', 'cloakDark', 'ember', 'pale', 'plaster', 'terracotta', 'copper', 'water', 'moss', 'deepShade', 'warmLight', 'charcoal'];
  for (const token of required) if (palette[token] === undefined) throw new SettingPackError(`缺少色板槽 ${token}`);
  if (new Set(Object.values(palette)).size > 24) throw new SettingPackError('同屏源色不能超过 24');
  const terrainColors = Object.fromEntries(
    Object.entries(raw.terrainColors).map(([name, token]) => {
      const color = palette[token];
      if (color === undefined) throw new SettingPackError(`地形 ${name} 用了未知色 ${token}`);
      return [name, color];
    }),
  );
  for (const terrain of ['grass', 'stone', 'plaza', 'farm', 'tree', 'shallow', 'mud', 'coal']) {
    if (terrainColors[terrain] === undefined) throw new SettingPackError(`缺少地形配色 ${terrain}`);
  }
  const { width, height } = raw.grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 30 || height < 20) {
    throw new SettingPackError('地图至少要有 30×20 格');
  }
  const inBounds = (p: { x: number; y: number }, label: string): void => {
    point(p, label);
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new SettingPackError(`${label} 越界`);
  };
  inBounds(raw.hub, '世界中心');
  for (const patch of raw.terrain) {
    point(patch, '地形');
    if (patch.w < 1 || patch.h < 1 || patch.x < 0 || patch.y < 0 || patch.x + patch.w > width || patch.y + patch.h > height) {
      throw new SettingPackError('地形矩形越界');
    }
  }
  const regionIds = new Set<string>();
  for (const region of raw.regions) {
    if (regionIds.has(region.id)) throw new SettingPackError(`区域重复 ${region.id}`);
    regionIds.add(region.id);
    if (region.w < 1 || region.h < 1 || region.x < 0 || region.y < 0 || region.x + region.w > width || region.y + region.h > height) throw new SettingPackError(`区域越界 ${region.id}`);
  }
  const blueprints = parseBlueprintTable(raw.prefabs, palette);
  const placementIds = new Set<string>();
  for (const placement of raw.placements) {
    if (placementIds.has(placement.prefabId)) throw new SettingPackError(`开局建筑重复 ${placement.prefabId}`);
    placementIds.add(placement.prefabId);
    if (!blueprints.has(placement.prefabId)) throw new SettingPackError(`未知蓝图 ${placement.prefabId}`);
    inBounds(placement.at, placement.prefabId);
  }
  // 构件坐标也必须校验：越界的灯或轨道不会报错，只会安静地画到地图外，
  // 表现成"设定集里写了、场景里没有"——这种静默失败最难在浏览器里定位。
  for (const item of raw.scenery) {
    inBounds(item.at, `构件 ${item.kind}`);
    if (item.kind === 'track' || item.kind === 'bridge') {
      const length = item.length ?? 0;
      if (!Number.isInteger(length) || length < 1) {
        throw new SettingPackError(`${item.kind} 需要 length ≥ 1`);
      }
      if (item.at.x + length > width) throw new SettingPackError(`${item.kind} 超出地图右边界`);
    }
  }
  if (raw.villagers.length === 0 || new Set(raw.villagers.map((v) => v.name)).size !== raw.villagers.length) throw new SettingPackError('居民必须至少一位且不重名');
  for (const villager of raw.villagers) {
    inBounds(villager.at, villager.name);
    if (villager.routine.length === 0) throw new SettingPackError(`${villager.name} 没有作息`);
    for (const stop of villager.routine) inBounds(stop, `${villager.name} 的作息`);
  }
  return { ...raw, palette, terrainColors: terrainColors as SettingPack['terrainColors'], blueprints, authored: true };
}

function parseColor(value: string, name: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new SettingPackError(`${name} 不是 #rrggbb`);
  return Number.parseInt(value.slice(1), 16);
}

/** 显式落位也走生产的占地/留白/门口检查；不能由设定集绕过世界法则。 */
export function buildSettingWorld(pack: SettingPack, saved?: readonly PlacedBuilding[]): BuiltWorld {
  const grid = new WorldGrid({ ...pack.grid, terrain: pack.terrain, regions: pack.regions });
  if (saved !== undefined) {
    const buildings = rehydratePalettes(saved, pack.blueprints);
    for (const building of buildings) {
      if (!grid.place({ instanceId: building.instanceId, origin: building.origin, w: building.footprint.w, h: building.footprint.h, door: building.door })) {
        throw new WorldSetupError(`存档落位不属于这套地图：${building.instanceId}`);
      }
    }
    return { grid, buildings, altar: pack.hub };
  }
  const buildings = pack.placements.map((placement) => {
    const blueprint = pack.blueprints.get(placement.prefabId)!;
    const placed = placeBlueprint(grid, blueprint, `${blueprint.id}#1`, pack.hub, placement.at);
    if (placed === null) throw new SettingPackError(`${blueprint.displayName} 的落位不合法`);
    return placed.building;
  });
  for (const villager of pack.villagers) {
    if (!grid.isWalkable(villager.at)) throw new SettingPackError(`${villager.name} 出生点不可走`);
    for (const stop of villager.routine) {
      if (!grid.isWalkable(stop)) throw new SettingPackError(`${villager.name} 的作息点不可走：${stop.label}`);
      if (grid.path(villager.at, stop).length === 0) throw new SettingPackError(`${villager.name} 到不了 ${stop.label}`);
    }
  }
  return { grid, buildings, altar: pack.hub };
}
