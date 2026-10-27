/** 外部设定集的唯一入口：先校验，再编译成已有的网格与蓝图。 */
import { parseBlueprintTable } from '../world/blueprints.ts';
import { WORLD } from '../world/palette-data.ts';
import type { BuiltWorld } from '../world/setup.ts';
import { doorReaches, placeBlueprint, reaches, rehydratePalettes, WorldSetupError } from '../world/setup.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import { WorldGrid } from '../world/grid.ts';
import type { PlacedBuilding, PrefabBlueprint, TerrainId, ZoneId } from '../world/types.ts';
import { isCarryItem } from '../world/gate.ts';
import type {
  CompiledVillager,
  RawSettingPack,
  SettingPack,
  SettingRoutineStop,
  SettingScenery,
} from './types.ts';

export class SettingPackError extends Error {}

/** 24 个色板槽的名字。闭集，加一个就要走 ADR（SPEC_V2 §4.2）。 */
const TOKENS = Object.keys(WORLD) as WorldColor[];

/** 八种地形各自要落到一个色板槽上，一种都不能少。 */
const TERRAINS: readonly TerrainId[] = ['grass', 'stone', 'plaza', 'farm', 'tree', 'shallow', 'mud', 'coal'];

/**
 * 构件闭集。与 `SettingScenery['kind']` 是同一份名单，运行时再验一次。
 *
 * 类型只在 TypeScript 里成立；设定集是外部数据，`pack.ts` 里的 `as never`
 * 或一份从 JSON 读进来的包都能把别的词送进来。渲染层对没有分值的 kind
 * 什么都不做，于是那种构件**不会报错，只是不存在**。
 */
const SCENERY_KINDS: readonly SettingScenery['kind'][] = [
  'lantern', 'track', 'statue', 'bridge', 'debris', 'sign', 'steam', 'banner', 'stall',
];

/** 作息的潮位条件。`routines.ts` 只认这两个词。 */
const TIDE_BEATS: readonly NonNullable<SettingRoutineStop['tide']>[] = ['low', 'high'];

/** 六个建造分区。与 `ZoneId` 是同一份名单，运行时再验一次。 */
const ZONES: readonly ZoneId[] = ['street', 'altar', 'industry', 'scholarly', 'agriculture', 'living'];

/**
 * 一道有说法的地域，得真的占着格子。
 *
 * 地域按声明顺序画上去，后声明的盖先声明的（`grid.ts` 那道循环）。所以一道地域
 * 如果整个被后声明的区域盖住，它一个格子都不占，可它的**说法**还在生效：
 *
 * - `requires` 的门——`gatedRegions` 照样把它报给提示词和界面，而没有任何一格
 *   真的要求凭证。模型被告知有一道门，到了那儿发现谁都能进，比没有门更糟：
 *   它已经按「有门」规划过了。
 * - `breathing` 的留白——`breathingRegions` 同样照报，界面上那片写着「留白」，
 *   而它一格都不呼吸。呼吸段的整条链（`breathingAt`、不派活、不出急件）是绕着
 *   格子算的，一格不占就是整条链空转。
 *
 * **不能反过来要求「区域不许重叠」。** 灯潮界的渡口压在浅滩上、叠浪楼的轮廓伸进
 * 灯街，那是有意的写法（`pack.ts` 里写了理由：街先画、楼后画）。只有「一整片
 * 一格都不剩」才是错。
 */
function assertSaidRegionsOwnCells(raw: RawSettingPack, label: (id: string) => string): void {
  // 与 `WorldGrid` 同一条画法：按声明顺序写，后写的赢。
  const owner = new Map<string, string>();
  for (const region of raw.regions) {
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (let x = region.x; x < region.x + region.w; x += 1) {
        owner.set(`${x},${y}`, region.id);
      }
    }
  }
  for (const region of raw.regions) {
    const says: string[] = [];
    if (region.requires != null) says.push(`要 ${region.requires}`);
    if (region.breathing === true) says.push('是留白');
    if (says.length === 0) continue;
    let owns = false;
    for (let y = region.y; y < region.y + region.h && !owns; y += 1) {
      for (let x = region.x; x < region.x + region.w && !owns; x += 1) {
        owns = owner.get(`${x},${y}`) === region.id;
      }
    }
    if (!owns) {
      throw new SettingPackError(
        `${label(region.id)} ${says.join('、')}，可它每一格都被后声明的区域盖住了——这句话只存在于数据里`,
      );
    }
  }
}

/**
 * 每个模板声明的分区，得在这张图上真的有一格。
 *
 * 分区的归属是**先声明者赢**（`grid.ts` 的 `zoneAt`），与地域的「后声明者赢」
 * 正好相反——两处规则不一样，而数据文件里看不出来。所以在分区表里把一条窄巷写在
 * 一整块工坊区**后面**，它就一格也占不到：那行字读起来像一张街，实际上是死的。
 *
 * 分区表自己死一格不致命，可**蓝图**要是写进一个不存在的分区就致命了：
 * `checkPlacement` 逐格比 `zoneOf`，对整张图恒为 `outOfZone`。于是
 * 「白名单里有一份模板」这件事成了空话——界面给它按钮、提示词告诉模型这个名字、
 * 回执却只有一句「没地方」，而且永远说不出为什么。这是最坏的一种：
 * 玩家试一次、试两次、试三次，每次都以为是位置没选对。
 *
 * 只查「这一片地方在不在」，不查「现在还有没有空地」。后者是会变的：
 * 地图建满了、留白挤没了都是合法的临时状态，而一个不存在分区永远建不进去。
 */
function assertTemplateZonesExist(raw: RawSettingPack, blueprints: ReadonlyMap<string, PrefabBlueprint>): void {
  // 问网格本身，不另写一遍「先声明者赢」——那两处迟早对不上，而对不上的
  // 时候这里会放行一份真正建不出来的包。
  const grid = new WorldGrid({ ...raw.grid, terrain: raw.terrain, regions: raw.regions });
  const present = new Set<ZoneId>();
  for (let y = 0; y < raw.grid.height; y += 1) {
    for (let x = 0; x < raw.grid.width; x += 1) present.add(grid.zoneOf({ x, y }));
  }
  for (const blueprint of blueprints.values()) {
    if (present.has(blueprint.zone)) continue;
    throw new SettingPackError(
      `${blueprint.displayName} 要建在 ${blueprint.zone} 区，而这张图上一格 ${blueprint.zone} 都没有——它永远建不出来`,
    );
  }
}

/** 名字读起来像取值，实际是断言：不合法就抛，合法就什么也不返回。 */
function assertPoint(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) throw new SettingPackError(`${label} 缺坐标`);
  const p = value as { x?: unknown; y?: unknown };
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
    throw new SettingPackError(`${label} 必须是整数格`);
  }
}

/**
 * 一条作息的停留时长与潮位条件。
 *
 * 时长是**唯一**读它的地方写进 `nextRoutineAt = now + dwellMs` 的那个数。
 * 负数或 NaN 把那个时刻放到过去或彻底作废，`now < nextRoutineAt` 于是恒为假，
 * 她每一拍都重新挑一次作息点，原地打转——看起来像"卡住了"，查起来却是数据。
 * 无穷大同理：那一站她永远不再离开。
 *
 * `tide` 写错一个词，`routines.ts` 的两个分支都不进：设定集里那句「趁退潮」
 * 从此在满潮时也照去不误，而这行字还留在数据里。
 */
function assertRoutineStop(stop: SettingRoutineStop, villagerName: string): void {
  const dwellMs = stop.dwellMs;
  if (dwellMs !== undefined && (!Number.isFinite(dwellMs) || dwellMs <= 0)) {
    throw new SettingPackError(`${villagerName} 的作息 ${stop.label} 停留时长必须是正数`);
  }
  if (stop.tide !== undefined && !TIDE_BEATS.includes(stop.tide)) {
    throw new SettingPackError(`${villagerName} 的作息 ${stop.label} 潮位条件只能是 low 或 high`);
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
    // 写错的地形名不会报缺省色，只会让那一片退回旧世界的底色（渲染层读
    // `terrainColors[terrain]`，查不到就落 `TERRAIN_COLORS` 那条兜底）。
    // 那样"设定集里写了、场景里看不出"——最难在浏览器里定位的静默失败。
    if (!TERRAINS.includes(patch.terrain)) {
      throw new SettingPackError(`地形 ${String(patch.terrain)} 不是八种地形之一`);
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
  // 分区 id 只能是那六个词。蓝图的 `zone` 已经按闭集验过了，但分区表这边没有，
  // 于是「表里写了第七个词」会安静地通过：每一格的分区都不是任何蓝图认的那个，
  // `checkPlacement` 对整张图恒为 outOfZone——世界照常开门，`building.add`
  // 在这张图上永远只会被拒。那是「一句话等于摆设」，而且一句话都说不出为什么。
  for (const zone of raw.grid.zones) {
    if (!ZONES.includes(zone.id)) {
      throw new SettingPackError(`分区 ${String(zone.id)} 不是六个分区之一`);
    }
  }
  assertSaidRegionsOwnCells(raw, (id) => raw.regions.find((region) => region.id === id)?.name ?? id);
  const blueprints = parseBlueprintTable(raw.prefabs, palette);
  assertTemplateZonesExist(raw, blueprints);
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
    // 渲染层按 kind 一串 if/else 画，认不出的那个词什么也不画，也不报错。
    if (!SCENERY_KINDS.includes(item.kind)) {
      throw new SettingPackError(`未知构件 ${String(item.kind)}`);
    }
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
  const villagers: CompiledVillager[] = raw.villagers.map((villager) => {
    // 外观的色名只能是色板槽。渲染层写的是 `palette[style.cloak] ?? WORLD.cloak`，
    // 那个兜底本身没错（画不出来不该抛），但它把「设定集写错了」这件事吃掉：
    // 迷路人穿着一件莞尔镇的斗篷，而没有任何地方说过这件事。
    const style = villager.style;
    if (style !== undefined) {
      for (const slot of ['cloak', 'scarf'] as const) {
        if (!TOKENS.includes(style[slot])) {
          throw new SettingPackError(`${villager.name} 的外观色 ${String(style[slot])} 不在 24 色里`);
        }
      }
      // `lamp` 决定开局带不带灯（下面那句 `carries`）。写成字符串时
      // `=== true` 为假，她就被当成两手空空——而设定集里明明写着提着灯。
      if (typeof style.lamp !== 'boolean') {
        throw new SettingPackError(`${villager.name} 的外观 lamp 只能是 true 或 false`);
      }
    }
    return {
      ...villager,
      // 开局带着什么，从设定集写定的那一句派生：`style.lamp` 是「她提着一盏灯」，
      // `carries` 是世界认的凭证。一处派生，往后只有一个事实。
      carries: style?.lamp === true ? (['lamp'] as const) : [],
    };
  });
  for (const villager of villagers) {
    inBounds(villager.at, villager.name);
    if (villager.routine.length === 0) throw new SettingPackError(`${villager.name} 没有作息`);
    for (const stop of villager.routine) {
      inBounds(stop, `${villager.name} 的作息`);
      assertRoutineStop(stop, villager.name);
    }
  }
  return { ...raw, palette, terrainColors, blueprints, villagers, authored: true };
}

/** 从设定集落成的格子上，反过来问一道地域的显示名。装载与报错共用。 */
function regionNamesOf(pack: SettingPack): Map<string, string> {
  return new Map(pack.regions.map((region) => [region.id, region.name]));
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
  const names = regionNamesOf(pack);
  const regionNameAt = (p: { x: number; y: number }): string => {
    const id = grid.at(p)?.region;
    return id === undefined ? '这片区域' : (names.get(id) ?? id);
  };
  for (const villager of pack.villagers) {
    if (!grid.isWalkable(villager.at)) throw new SettingPackError(`${villager.name} 出生点不可走`);
    // 生在一道她进不去的门里：她兜里那几件过不了脚下这道门，于是**一步也动不了**
    // ——而世界不会报错，只会有一个站着不动的人。所以在这里拒，不让她静静出生。
    //
    // 只查出生点，不查作息点：门后的作息点完全可以是合法的（等她有了灯就走得到），
    // 上面那段可达性注释说的就是这件事。出生点是另一回事——她 t=0 就在那儿。
    const need = grid.requirementAt(villager.at);
    if (need !== null && !villager.carries.includes(need)) {
      throw new SettingPackError(
        `${villager.name} 出生在要 ${need} 的${regionNameAt(villager.at)}里，而她开局没有——她会一步也动不了`,
      );
    }
    for (const stop of villager.routine) {
      if (!grid.isWalkable(stop)) throw new SettingPackError(`${villager.name} 的作息点不可走：${stop.label}`);
      // 这里的可达性**故意不过渡有仪式的门**：装载时还没有人知道她以后会带上什么，
      // 而门后的作息点完全可以是合法的（等她有了灯就走得到）。
      // 按两手空空判会把这种包误拒；门是运行时的事，不该在装载时夺权。
      //
      // 走 `reaches`，不自己写 `path(...).length === 0`：那个返回值在
      // 「作息点就踩在出生点上」时是空数组，照抄它会拒一份合法的包，
      // 还说「她 到不了 就站在起点上」——那句话是假话。
      if (!reaches(grid, villager.at, stop)) {
        throw new SettingPackError(`${villager.name} 到不了 ${stop.label}`);
      }
    }
  }
  return { grid, buildings, altar: pack.hub };
}
