/** 外部设定集的唯一入口：先校验，再编译成已有的网格与蓝图。 */
import { parseBlueprintTable } from '../world/blueprints.ts';
import { WORLD } from '../world/palette-data.ts';
import type { BuiltWorld } from '../world/setup.ts';
import { doorReaches, placeBlueprint, rehydratePalettes, WorldSetupError } from '../world/setup.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import { WorldGrid } from '../world/grid.ts';
import type { PlacedBuilding, TerrainId } from '../world/types.ts';
import { isCarryItem } from '../world/gate.ts';
import type { RawSettingPack, SettingPack } from './types.ts';

export class SettingPackError extends Error {}

/** 24 个色板槽的名字。闭集，加一个就要走 ADR（SPEC_V2 §4.2）。 */
const TOKENS = Object.keys(WORLD) as WorldColor[];

/** 八种地形各自要落到一个色板槽上，一种都不能少。 */
const TERRAINS: readonly TerrainId[] = ['grass', 'stone', 'plaza', 'farm', 'tree', 'shallow', 'mud', 'coal'];

/** 名字读起来像取值，实际是断言：不合法就抛，合法就什么也不返回。 */
function assertPoint(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) throw new SettingPackError(`${label} 缺坐标`);
  const p = value as { x?: unknown; y?: unknown };
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
    throw new SettingPackError(`${label} 必须是整数格`);
  }
}

export function loadSettingPack(raw: RawSettingPack): SettingPack {
  if (!/^[a-z][a-z0-9-]*$/.test(raw.id)) throw new SettingPackError('设定集 id 不合法');
  if (raw.saveKey.length === 0) throw new SettingPackError('存档槽不能为空');
  // 先按「不可信的外部数据」收一遍色值：此时键还是任意字符串，
  // 等下面验明 24 个槽都在，才把它当 WorldPalette 用。
  const slots = Object.fromEntries(
    Object.entries(raw.palette).map(([name, value]) => [name, parseColor(value, name)]),
  ) as Record<string, number>;
  // 24 色预算是「24 个各不相同的槽」，不是「最多 24 个值」。
  //
  // 只查上界会漏掉重复：两个 token 填同一个色值时，画面上的实际色数少了，
  // 而调用方以为 24 个槽都占着——那正是 `grassLit` 与 `stone` 同值发生过的事。
  // 少一个槽（漏填）同样拒：槽位空着会让渲染层静默换色。
  for (const token of TOKENS) {
    if (slots[token] === undefined) throw new SettingPackError(`缺少色板槽 ${token}`);
  }
  if (new Set(TOKENS.map((token) => slots[token])).size !== TOKENS.length) {
    const distinct = new Set(TOKENS.map((token) => slots[token])).size;
    throw new SettingPackError(`24 个色板槽必须各占一个不同的色值，实际只有 ${distinct} 个`);
  }
  const palette = slots as WorldPalette;
  /**
   * 八种地形各自落到一个色板槽上，一种都不能少。
   *
   * 少一种不会报缺省色，只会让那种地形在画面上用别的地形的颜色顶替——
   * 「设定集里写了、场景里看不出」正是最难在浏览器里定位的那类静默失败。
   */
  const terrainColors = Object.fromEntries(
    TERRAINS.map((terrain) => {
      const token = raw.terrainColors[terrain];
      const color = token === undefined ? undefined : palette[token as WorldColor];
      if (color === undefined) {
        const why = token === undefined ? '没有填' : `色 ${token} 不在 24 色里`;
        throw new SettingPackError(`缺少地形配色 ${terrain}：${why}`);
      }
      return [terrain, color];
    }),
  ) as Record<TerrainId, number>;
  const { width, height } = raw.grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 30 || height < 20) {
    throw new SettingPackError('地图至少要有 30×20 格');
  }
  const inBounds = (p: { x: number; y: number }, label: string): void => {
    assertPoint(p, label);
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new SettingPackError(`${label} 越界`);
  };
  inBounds(raw.hub, '世界中心');
  for (const patch of raw.terrain) {
    assertPoint(patch, '地形');
    if (patch.w < 1 || patch.h < 1 || patch.x < 0 || patch.y < 0 || patch.x + patch.w > width || patch.y + patch.h > height) {
      throw new SettingPackError('地形矩形越界');
    }
  }
  const regionIds = new Set<string>();
  for (const region of raw.regions) {
    if (regionIds.has(region.id)) throw new SettingPackError(`区域重复 ${region.id}`);
    regionIds.add(region.id);
    if (region.w < 1 || region.h < 1 || region.x < 0 || region.y < 0 || region.x + region.w > width || region.y + region.h > height) throw new SettingPackError(`区域越界 ${region.id}`);
    // 渡有仪式（SPEC_V2 §4.6）：requires 只能是闭集里的词。写错一个字母，
    // 表现成「这道门谁也过不去」——比当场报错难查得多。
    if (region.requires != null && !isCarryItem(region.requires)) {
      throw new SettingPackError(`区域 ${region.id} 的 requires 只能是 lamp/shoes 或 null`);
    }
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
  return { ...raw, palette, terrainColors, blueprints, authored: true };
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
  // 门口到不了镇心：这栋楼在镇子外面。默认世界由 assertWorldInvariants 拦
  // （「与祭坛之间没有通路」），包这条路原来谁都不拦——同一栋连不出去的楼，
  // 在默认世界开工即抛，在包里静静成立（ADR_PACK_SKIPS_WORLD_BUDGET 待办 A）。
  //
  // **全部落完再查，不是落一栋查一栋。** 后一栋能把前一栋的门围死，
  // 而落位时的 `reachable` 只看得到当时已经落下去的楼。逐栋查会漏那种，
  // 漏掉的表现还是一栋静悄悄死掉的楼。
  //
  // 只查新建路：读档路不铺路，`grid.path` 在一条路都没有的格子上当然大多是空的，
  // 拿它判会把每一份旧存档都拒掉。存档是照着一份当年通过的世界写的。
  for (const building of buildings) {
    if (!doorReaches(grid, building.door, pack.hub)) {
      throw new SettingPackError(`${building.displayName} 的门口到不了镇心`);
    }
  }
  for (const villager of pack.villagers) {
    if (!grid.isWalkable(villager.at)) throw new SettingPackError(`${villager.name} 出生点不可走`);
    for (const stop of villager.routine) {
      if (!grid.isWalkable(stop)) throw new SettingPackError(`${villager.name} 的作息点不可走：${stop.label}`);
      // 这里的可达性**故意不过渡有仪式的门**：装载时还没有人知道她以后会带上什么，
      // 而门后的作息点完全可以是合法的（等她有了灯就走得到）。
      // 按两手空空判会把这种包误拒；门是运行时的事，不该在装载时夺权。
      if (grid.path(villager.at, stop).length === 0) throw new SettingPackError(`${villager.name} 到不了 ${stop.label}`);
    }
  }
  return { grid, buildings, altar: pack.hub };
}
