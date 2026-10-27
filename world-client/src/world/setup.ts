/** 把蓝图、网格和固定分区拼成一个可跑的世界。
 *
 * 分区是写死的世界规格（造物主的 L0 层），建筑位置由空间分配器算，
 * 不允许手填坐标。这样换一张蓝图表，世界仍然成立。
 */

import { WorldGrid, type GridSpec } from './grid.ts';
import { validateCoverage } from './blueprints.ts';
import { WORKSHOP_TASKS } from './tasks.ts';
import type { GridPoint, PlacedBuilding, PrefabBlueprint, ZoneId } from './types.ts';
import { BIOME_RADII } from './biomes.ts';

export const TILE_PX = 16;
export const BORDER = 1;

/**
 * 图块尺寸不动，只扩大地图。
 *
 * 「把图块放大到 32px」与「扩大世界」互相抵消：同样一块屏幕，图块翻倍就只看得到
 * 一半的地图内容，还得重画全部地形纹理。所以大世界靠更多格子，不靠更大的格子。
 */

/**
 * 旧规格：30×20。**保留为测试夹具**——20 处既有单测依赖它，
 * 换掉等于把已有验收数字全部作废。生产入口用 `LARGE_WORLD_SPEC`。
 */
export const SMALL_WORLD_SPEC: GridSpec = {
  width: 30,
  height: 20,
  border: BORDER,
  zones: [
    { id: 'industry', x: 1, y: 1, w: 12, h: 8 },
    { id: 'scholarly', x: 17, y: 1, w: 12, h: 8 },
    { id: 'street', x: 13, y: 1, w: 4, h: 6 },
    { id: 'altar', x: 13, y: 7, w: 4, h: 4 },
    { id: 'street', x: 13, y: 11, w: 4, h: 8 },
    { id: 'living', x: 1, y: 13, w: 12, h: 6 },
    { id: 'agriculture', x: 17, y: 13, w: 12, h: 6 },
  ],
};

/** 兼容旧调用点与旧测试：默认规格仍是 30×20。 */
export const WORLD_SPEC: GridSpec = SMALL_WORLD_SPEC;
export const GRID_WIDTH = SMALL_WORLD_SPEC.width;
export const GRID_HEIGHT = SMALL_WORLD_SPEC.height;

/**
 * 大世界：96×72 格，1536×1152 像素，面积是旧世界的 11.52 倍。
 * 原写着「80×60、1280×960、8 倍」——从 `996cbd3` 那笔起就是假的，同一笔的规格就是 96×72；`9fa55ca` 改了六处，**而 `9fa55ca^` 上 `git grep '80×60'` 数出来是七处**，漏的第七处是 `scripts/check-persistence.mjs`（本文件末尾 2026-10-28 补记）。
 * 分区是同心圆的近似：中心是祭坛，四角方向各留一条通向郊野的路。
 * 这里只给矩形分区，群落（离中心多远）由 `biomes.ts` 单独判定——
 * 两者职责不同：分区决定能建什么，群落决定看起来像哪一带。
 */
export const LARGE_WORLD_SPEC: GridSpec = {
  width: 96,
  height: 72,
  border: BORDER,
  zones: [
    // 核心：祭坛 + 中心广场。
    { id: 'altar', x: 45, y: 33, w: 6, h: 6 },
    // 十字主干道：4 格宽，从镇中心一直铺到地图边缘。
    { id: 'street', x: 46, y: 1, w: 4, h: 32 },
    { id: 'street', x: 46, y: 39, w: 4, h: 32 },
    { id: 'street', x: 1, y: 34, w: 45, h: 4 },
    { id: 'street', x: 50, y: 34, w: 45, h: 4 },
    // 工坊环：四块围着十字街排开，每块 10×10。
    //
    // 位置按**群落半径反推**：镇内四块全部落在 21 格内。
    { id: 'industry', x: 35, y: 20, w: 10, h: 10 },
    { id: 'scholarly', x: 51, y: 20, w: 10, h: 10 },
    { id: 'agriculture', x: 35, y: 42, w: 10, h: 10 },
    { id: 'living', x: 51, y: 42, w: 10, h: 10 },
    // 郊野：四角，全部落在 21..37 格的环带里。
    { id: 'industry', x: 18, y: 18, w: 9, h: 8 },
    { id: 'scholarly', x: 69, y: 18, w: 9, h: 8 },
    { id: 'agriculture', x: 18, y: 46, w: 9, h: 8 },
    { id: 'living', x: 69, y: 46, w: 9, h: 8 },
  ],
};

/** 大世界的祭坛：规格正中心。 */
export const LARGE_ALTAR: GridPoint = { x: 48, y: 36 };

export const ALTAR: GridPoint = { x: 15, y: 9 };

/**
 * 常驻铺子：镇内三栋（本地确定性工作）+ 郊野三栋（探索性工作）。
 * 扩建样板 `workshop_plot` 不参与开局落位。
 */
const TOWN_PREFABS = new Set<string>(['code_forge', 'star_archive', 'ink_house']);

/**
 * 郊野铺子的 prefab id。**唯一来源**。
 *
 * `simulation.ts` 的派活规则也读它。早先那里另抄了一份，加第四栋郊野铺子时
 * 只改一处就会让派活规则静默错位——那不是 bug，是随时会变成 bug 的形状。
 *
 * **只收接活的铺子。** 郊野民居不走这里：常明灯、派活分流、郊野辨识都以为
 * 「郊野 = 有人在外面干活」，把住家塞进来会让每间农舍白天也亮着守夜灯。
 */
export const WILD_PREFABS: ReadonlySet<string> = new Set([
  'crawler_mine',
  'ink_mill',
  'gear_tower',
]);

/**
 * 民居：不接活，只占地方，让镇子看起来是有人住的。
 *
 * 为什么单开一组而不是塞进 TOWN_PREFABS / WILD_PREFABS：那两个集合的语义是
 * 「接活的铺子」，派活分流、郊野常明灯、世界状态统计都按这个语义工作。
 * 民居 `boundTask` 是 null，本来就不进 `validateCoverage` 的铺子预算，
 * 混进铺子集合会让计数与灯光一起错。
 *
 * 只在大世界落位：旧规格 30×20 是 20 处既有测试的夹具，那里凭空多出房子
 * 会让「小世界三栋」这条验收数字全部作废。
 */
const TOWN_HOMES = new Set<string>(['cottage_oak', 'cottage_plaster', 'cottage_stone']);
const WILD_HOMES = new Set<string>(['homestead_far', 'homestead_ridge']);
const HOME_PREFABS = new Set<string>([...TOWN_HOMES, ...WILD_HOMES]);

const RESIDENT_PREFABS = new Set<string>([
  ...TOWN_PREFABS,
  ...WILD_PREFABS,
  ...HOME_PREFABS,
]);

/**
 * 这栋建筑是不是长在郊野那一侧。
 *
 * 铺子与民居都要答这个问题，但两边的判断依据不同（铺子按 prefab 集合，
 * 民居按所属集合）。合成一处，免得落位锚点与群落校验各写一份、慢慢漂移。
 *
 * 导出是因为**玩家造物也要问同一个问题**：`SandboxScene` 的群落闸原来自己拿
 * `WILD_PREFABS` 认郊野，漏了下面那两栋郊野民居。见 `biomeRingAllows`。
 */
export function isWildSide(prefabId: string): boolean {
  return WILD_PREFABS.has(prefabId) || WILD_HOMES.has(prefabId);
}

export class WorldSetupError extends Error {}

export interface BuiltWorld {
  readonly grid: WorldGrid;
  readonly buildings: readonly PlacedBuilding[];
  readonly altar: GridPoint;
}

export interface SpawnResult {
  readonly building: PlacedBuilding;
  /** 从门口铺到主路的小径，由造物主顺手铺好。 */
  readonly road: readonly GridPoint[];
  /**
   * 门口与锚点之间**有没有路**。
   *
   * 与 `road` 空不空是两件事：路本来就已经铺好了（或者那段路在祭坛区里，
   * 不归小径铺），`road` 就是空的，而楼是连得出去的。只有这个字段能说出
   * 「这栋楼连不出去」——而这句话以前没有任何人说。
   *
   * `assertWorldInvariants` 在默认世界两条路的末尾各查一遍「与祭坛之间没有
   * 通路」，所以默认世界早就拦得下；编译后的设定集那条路谁都没查
   * （`ADR_PACK_SKIPS_WORLD_BUDGET` 待办 A），于是同一栋连不出去的楼，
   * 在默认世界开工即抛、在包里静静成立。信号生在这里，两个世界就都拿得到。
   */
  readonly reachable: boolean;
}

/** 某处为什么不能建。造物模式的幽灵预览要把原因说给玩家听。 */
export type PlacementProblem =
  | 'edge'
  | 'outOfZone'
  | 'occupied'
  | 'margin'
  | 'doorBlocked';

export type PlacementCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PlacementProblem };

/** 把拒绝理由翻译成玩家读得懂的一句话。 */
export function hintFor(reason: PlacementProblem): string {
  switch (reason) {
    case 'edge':
      return '太靠边了，楼会出界。';
    case 'outOfZone':
      return '这种铺子不能建在这个区。';
    case 'occupied':
      return '这里已经有东西了。';
    case 'margin':
      return '离别的建筑太近，得留出空地。';
    case 'doorBlocked':
      return '门口被堵住了，人走不进去。';
  }
}

/**
 * 群落环：这座建筑许不许落在 `origin`。
 *
 * 郊野建筑（郊野铺子**与郊野民居**）整块落在工坊环之外、郊野环之内；
 * 镇内建筑落在工坊环之内。距离按**左上角**在整数尺上量，与 `biomeAt` /
 * `fogAt` 同一把尺——不拿格心尺，也不拿分区最近点。
 *
 * 为什么单独一个函数：这条规则原来写了两份。`buildLargeWorld` 的 `accept`
 * 拿 `isWildSide` 认郊野，`SandboxScene` 的群落闸拿 `WILD_PREFABS` 认——
 * 后者漏掉两栋郊野民居（`homestead_far` / `homestead_ridge`）。而这两栋的
 * `zone` 是 `living`，与三栋镇内民居同一个分区，`ZONE_DEFAULT` 也是
 * `living`，所以分区那道关拦不住它们。
 *
 * 实测（开局大世界，只数 `checkPlacement` 也判合法的落点）：对这两栋民居，
 * 开局的 `accept` 在 craftRing 内放行 **0** 个，而幽灵那道闸放行
 * **186**（homestead_far）/ **240**（homestead_ridge）个。也就是说，那道
 * 声称「与开局落位同一套规则」的闸，对郊野民居恰好是反的——它专门放行开局
 * 永远不做的那种落位。
 *
 * 合成一处之后，「同一套规则」由代码保证，不靠读者两边对照。
 *
 * 今天 UI 还没有「建民居」的入口，所以这不是正在发生的事故；但
 * `beginCreation` 收任何 prefabId，加一个按钮就会踩上。
 */
export function biomeRingAllows(
  prefabId: string,
  origin: GridPoint,
  altar: GridPoint,
): boolean {
  const d = Math.hypot(origin.x - altar.x, origin.y - altar.y);
  return isWildSide(prefabId)
    ? d > BIOME_RADII.craftRing && d <= BIOME_RADII.wilderness
    : d <= BIOME_RADII.craftRing;
}

/**
 * 能不能把这份蓝图落在 `origin`。
 *
 * 规则与 `findBestSlot` 内部逐条一致——幽灵预览与真实落位必须用同一套判定，
 * 否则玩家会看到"显示可以、确认却被拒"。
 *
 * 先后顺序按"玩家最容易理解"排：先出界，再分区，再占地，再留白，最后门口。
 */
export function checkPlacement(
  grid: WorldGrid,
  blueprint: PrefabBlueprint,
  origin: GridPoint,
): PlacementCheck {
  const { w, h } = blueprint.footprint;
  const margin = blueprint.clearMargin;

  // 出界：占地本身必须完整落在世界里。
  if (
    origin.x < 0 ||
    origin.y < 0 ||
    origin.x + w > grid.width ||
    origin.y + h > grid.height
  ) {
    return { ok: false, reason: 'edge' };
  }

  // 分区：整块占地都必须在蓝图声明的分区里。
  for (let y = origin.y; y < origin.y + h; y += 1) {
    for (let x = origin.x; x < origin.x + w; x += 1) {
      if (grid.zoneOf({ x, y }) !== blueprint.zone) {
        return { ok: false, reason: 'outOfZone' };
      }
    }
  }

  // 占地被占：先单独判一次，好给出比"留白不足"更准确的原因。
  for (let y = origin.y; y < origin.y + h; y += 1) {
    for (let x = origin.x; x < origin.x + w; x += 1) {
      if (!grid.isBuildable({ x, y })) return { ok: false, reason: 'occupied' };
    }
  }

  // 留白：四周 margin 圈内也必须空着（含越界，边界外不可建）。
  if (!grid.canPlace(origin, w, h, margin)) {
    return { ok: false, reason: 'margin' };
  }

  // 门口：必须可建，否则人走不进去。
  const door = { x: origin.x + blueprint.door.x, y: origin.y + blueprint.door.y };
  if (!grid.isBuildable(door)) return { ok: false, reason: 'doorBlocked' };

  return { ok: true };
}

/**
 * 建一个世界。
 *
 * `spec` 与 `altar` 都省略时用旧规格 30×20——20 处既有测试依赖这个默认值，
 * 不改它们。生产入口传 `LARGE_WORLD_SPEC` + `LARGE_ALTAR`（见 `buildLargeWorld`）。
 */
export function buildWorld(
  blueprints: ReadonlyMap<string, PrefabBlueprint>,
  spec: GridSpec = SMALL_WORLD_SPEC,
  altar: GridPoint = ALTAR,
): BuiltWorld {
  const coverage = validateCoverage(blueprints);
  if (coverage.length > 0) throw new WorldSetupError(coverage.join('；'));

  // 大世界才生成郊野林地：旧规格没有"郊野"，也不该突然长树。
  const grid = new WorldGrid(
    spec,
    spec === LARGE_WORLD_SPEC ? { center: altar } : undefined,
  );
  const buildings: PlacedBuilding[] = [];

  // 小世界放不下六栋：郊野铺子与民居只在大世界里落位。
  // 小规格继续服务 20 处既有测试，行为与以前完全一致。
  const wildAllowed = spec === LARGE_WORLD_SPEC;

  // 同一个分区里放多栋民居，要各给一个锚点，否则 findBestSlot 每轮都挑
  // 离锚点最近的那块空地，第二栋会紧贴第一栋，第三栋再贴上去——三间农舍
  // 挤成一个角落，比空着更难看。按**集合内的序号**取分区的一个角，
  // 顺序固定所以落位可复现。
  const homeCursor = new Map<string, number>();

  for (const blueprint of blueprints.values()) {
    if (!RESIDENT_PREFABS.has(blueprint.id)) continue;
    const wild = isWildSide(blueprint.id);
    const isHome = HOME_PREFABS.has(blueprint.id);
    // 小世界只放镇内三栋铺子，与以前逐位一致：郊野铺子和所有民居都不进。
    if (!wildAllowed && (wild || isHome)) continue;

    // 郊野建筑锚到**分区里离祭坛最远的那一侧**，镇内建筑锚到祭坛。
    //
    // 早先用 `altar.x ± 26` 猜一个方向，但 findBestSlot 只按距离挑最近的空位，
    // 实际落点由分区决定——实测郊野铺子现在落在 24.7 / 26.9 / 28.2 格，
    // 全在郊野圈里（`biomeAt` 判 wilderness），与「郊野」这个标签对得上。
    // 取分区外缘，才能让落位真的落到外圈。
    //
    // （这段原写「落在 14.6 / 17.5 / 21.1 格，全都还在工坊环（20 格）里，与
    // 『郊野』这个标签对不上」——两处都不成立：`BIOME_RADII.craftRing` 是 **21**
    // 不是 20，而今天这三个数本来就 21 以外。那句话描述的是锚点改之前的旧落位，
    // 改完还在纸上，读起来像今天的毛病。）
    let anchor: GridPoint;
    if (isHome) {
      const index = homeCursor.get(blueprint.zone) ?? 0;
      homeCursor.set(blueprint.zone, index + 1);
      anchor = homeAnchorOf(spec, blueprint.zone, altar, index);
    } else {
      anchor = wild ? wildernessAnchorOf(spec, blueprint.zone, altar) : altar;
    }

    // 落位必须与群落一致，否则「郊野」只是名义上的：
    //   - 郊野建筑在郊野圈（craftRing 之外、wilderness 之内）
    //   - 镇内建筑在工坊环内（否则镇内书斋会落到 23 格外的"郊野"）
    // 规则本体在 `biomeRingAllows`，与玩家造物的群落闸共用一份。
    const accept =
      spec !== LARGE_WORLD_SPEC
        ? undefined
        : (origin: GridPoint): boolean => biomeRingAllows(blueprint.id, origin, altar);
    const placed = placeBlueprint(grid, blueprint, `${blueprint.id}#1`, anchor, undefined, undefined, accept);
    if (placed === null) {
      throw new WorldSetupError(`${blueprint.displayName} 在 ${blueprint.zone} 找不到合规空地`);
    }
    buildings.push(placed.building);
  }

  assertWorldInvariants(grid, buildings, altar);
  return { grid, buildings, altar };
}

/**
 * 民居的锚点：同一个分区里第 `index` 栋落在哪里。
 *
 * 民居和铺子不同，它们要挤在同一个分区里（`living` 镇上只有一块 10×10），
 * 所以不能都锚到祭坛——那样每栋都会挑离祭坛最近的空地，最后叠成一摞。
 * 按序号绕分区四个角走，落点分散且可复现。
 *
 * 四个角轮流而不是按黄金角散开：10×10 的分区塞三栋 4×3 带留白的房子，
 * 角位是唯一还剩得开的摆法。
 */
function homeAnchorOf(
  spec: GridSpec,
  zone: ZoneId,
  altar: GridPoint,
  index: number,
): GridPoint {
  const region = spec.zones.find((item) => item.id === zone);
  if (region === undefined) return altar;
  const corners: readonly GridPoint[] = [
    { x: region.x, y: region.y },
    { x: region.x + region.w - 1, y: region.y + region.h - 1 },
    { x: region.x + region.w - 1, y: region.y },
    { x: region.x, y: region.y + region.h - 1 },
  ];
  return corners[index % corners.length]!;
}

/**
 * 某个分区里落在**郊野圈**的那个锚点。
 *
 * 同一种分区（如 scholarly）同时供镇内书斋与郊野矿洞使用，差别只在
 * 「落在这一区的哪一头」。但不能取最远角——实测最远角只到 34.1 / 34.5 / 35.0 格，
 * 那仍在郊野圈里（`biomeAt` 判 wilderness），可取；真正到不了的是 frontier，
 * 它要 `distance > 37`（`BIOME_RADII.wilderness`），而这三个分区的候选点没有
 * 一个过 37。原写「最远角会落到 frontier（34–37 格）」是把 34–37 这半圈当成了
 * frontier，那一整段都是 wilderness。
 *
 * 取「离祭坛最近、但仍在郊野圈内」的那个点：既保证标签对得上，
 * 又不至于远到不可达。
 */
function wildernessAnchorOf(spec: GridSpec, zone: ZoneId, altar: GridPoint): GridPoint {
  const candidates: GridPoint[] = [];
  for (const region of spec.zones) {
    if (region.id !== zone) continue;
    // 沿分区四边取样，找落进郊野圈的点。
    for (let x = region.x; x < region.x + region.w; x += 1) {
      for (const y of [region.y, region.y + region.h - 1]) candidates.push({ x, y });
    }
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (const x of [region.x, region.x + region.w - 1]) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return altar;

  const inWild = candidates.filter((p) => {
    const d = Math.hypot(p.x - altar.x, p.y - altar.y);
    return d > BIOME_RADII.craftRing && d <= BIOME_RADII.wilderness;
  });
  const pool = inWild.length > 0 ? inWild : candidates;
  // 取池里离祭坛**最近**的：够远到进郊野圈，又不至于远得走不到。
  return pool.reduce((best, p) =>
    Math.hypot(p.x - altar.x, p.y - altar.y) <
    Math.hypot(best.x - altar.x, best.y - altar.y)
      ? p
      : best,
  );
}

/** 生产用的大世界：96×72，常驻铺子按郊野锚点重新落位。 */
export function buildLargeWorld(
  blueprints: ReadonlyMap<string, PrefabBlueprint>,
): BuiltWorld {
  return buildWorld(blueprints, LARGE_WORLD_SPEC, LARGE_ALTAR);
}

/**
 * 把一份**已通过 schema 校验**的造物意图落进世界。
 *
 * 这是 schema 与世界的唯一接缝：意图里的 `templateId` 换成蓝图，
 * `palette` 覆盖模板配色，位置交给 `placeBlueprint` 走同一套空间校验。
 *
 * 调它之前必须先 `parseCreationPlan`。这里不重复校验形状——
 * 两道校验分开，是因为它们回答的问题不同：形状 vs 空间。
 */
export function placeFromPlan(
  world: BuiltWorld,
  plan: {
    readonly templateId: string;
    readonly at: GridPoint;
    readonly palette: PrefabBlueprint['palette'];
  },
  instanceId: string,
  blueprints: ReadonlyMap<string, PrefabBlueprint>,
): SpawnResult | null {
  const template = blueprints.get(plan.templateId);
  if (template === undefined) return null;

  // 意图里的配色覆盖模板：模板只提供形状，颜色由造物主决定。
  return placeBlueprint(
    world.grid,
    { ...template, palette: plan.palette },
    instanceId,
    world.altar,
    plan.at,
  );
}

/**
 * 造物主的一次落位：选址、占格、铺路。空间不足时返回 null，不改账本。
 *
 * `at` 省略时走 `findBestSlot`（自动选最靠近锚点的合规空地）；
 * 给了 `at` 就是玩家指定的位置，先过 `checkPlacement`，不合法直接返回 null。
 * 两条路径最终都经过同一套判定。
 */
export function placeBlueprint(
  grid: WorldGrid,
  blueprint: PrefabBlueprint,
  instanceId: string,
  anchor: GridPoint,
  at?: GridPoint,
  source?: { readonly taskId: string; readonly summary: string },
  accept?: (origin: GridPoint) => boolean,
): SpawnResult | null {
  let origin: GridPoint | null;
  if (at === undefined) {
    origin = grid.findBestSlot(blueprint, anchor, accept);
  } else {
    const check = checkPlacement(grid, blueprint, at);
    origin = check.ok ? at : null;
  }
  if (origin === null) return null;

  const door = { x: origin.x + blueprint.door.x, y: origin.y + blueprint.door.y };
  const placed = grid.place({
    instanceId,
    origin,
    w: blueprint.footprint.w,
    h: blueprint.footprint.h,
    door,
  });
  if (!placed) return null;

  const workSpot = blueprint.workSpots[0];
  const building: PlacedBuilding = {
    instanceId,
    prefabId: blueprint.id,
    displayName: blueprint.displayName,
    zone: blueprint.zone,
    origin,
    footprint: blueprint.footprint,
    door,
    workSpot: { x: origin.x + workSpot.x, y: origin.y + workSpot.y },
    chimney: { x: origin.x + blueprint.chimney.x, y: origin.y + blueprint.chimney.y },
    accent: blueprint.accent,
    silhouette: blueprint.silhouette,
    boundTask: blueprint.boundTask,
    palette: blueprint.palette,
    sourceTaskId: source?.taskId ?? null,
    sourceSummary: source?.summary ?? null,
  };

  const paved = paveFrom(grid, door, anchor);
  return { building, road: paved.road, reachable: paved.reachable };
}

/** 一条铺出来的小径，连同「铺不铺得出来」这个事实。 */
export interface PavedRoute {
  /** 铺出来的小径。空不等于连不出去——路可能本来就已经通了。 */
  readonly road: readonly GridPoint[];
  /** 门口与锚点之间有没有路。 */
  readonly reachable: boolean;
}

/**
 * 从一处走不走到另一处。
 *
 * **这一句谁判都是同一句。** 「连不连得出去」以前在默认世界由
 * `assertWorldInvariants` 判、在包里由 nobody 判，两边各写一遍 `path(...).length === 0`
 * 就意味着它们迟早说出不同的话。抽出来放这儿。
 *
 * 关键是不把**两种空数组**混为一谈：`grid.path` 在「起点即终点」时返回空数组，
 * 在「走不到」时也返回空数组。前者是她已经到了，后者是真过不去。
 * 照抄返回值，一扇最好的门会被报成与祭坛没有通路——而错误信息说的是假话，
 * 比不报更糟。
 *
 * 终点不可走时，「到终点」实际是「到离终点最近的那块可走地」——`grid.path`
 * 自己也是这么做的（`grid.ts` 的兜底）。先把它问出来，两种空数组才分得开。
 */
export function reaches(grid: WorldGrid, from: GridPoint, to: GridPoint): boolean {
  // 越界的点不在世界里，谈不上一不一致。
  if (!grid.inBounds(from) || !grid.inBounds(to)) return false;
  const goal = grid.isWalkable(to) ? to : grid.nearestWalkable(to);
  if (goal === null) return false;
  // 她人就站在那块可走地上：没有比这更连得出去的。
  // 起点与终点坐标全等只是它的一种（终点可走、起点就开在它上面）。
  if (goal.x === from.x && goal.y === from.y) return true;
  return grid.path(from, goal).length > 0;
}

/**
 * 门口与锚点之间有没有路。就是 `reaches`，只是两个端点各有名字。
 *
 * hub 落在树篱环上、或被某栋楼盖住，都是合法的（装载只查越界，不查可走）。
 * 不认「改写后起点即终点」，一扇离镇心一步远的门会被报成「门口到不了镇心」
 * ——曼哈顿距离 1，那是全图离镇心最近的一块可走格。
 */
export function doorReaches(grid: WorldGrid, door: GridPoint, anchor: GridPoint): boolean {
  return reaches(grid, door, anchor);
}

/**
 * 从门口往祭坛铺一条小径，只铺没被占的空地。
 *
 * `reachable` 看的**不是 `road` 空不空**，而是有没有路：一段全在祭坛区里、
 * 或者全被占用的路，`road` 是空的而楼是连得出去的。拿 `road` 判会把
 * 「路已经铺好了」误报成「连不出去」——那比不报更糟，它会让人去拒一栋好楼。
 */
export function paveFrom(grid: WorldGrid, door: GridPoint, anchor: GridPoint): PavedRoute {
  const route = grid.path(door, anchor);
  const road: GridPoint[] = [];
  for (const cell of route) {
    if (grid.zoneOf(cell) === 'altar') continue;
    if (grid.at(cell)?.occupant !== null) continue;
    road.push(cell);
  }
  return { road, reachable: doorReaches(grid, door, anchor) };
}

/** 读档重建网格：只按存档 buildings 顺序重放落位，不存 cells（ADR_SAVE §1.2）。 */
export function rebuildGridFromPlacements(
  buildings: readonly PlacedBuilding[],
  spec: GridSpec = SMALL_WORLD_SPEC,
): WorldGrid {
  const grid = new WorldGrid(spec);
  for (const building of buildings) {
    const placed = grid.place({
      instanceId: building.instanceId,
      origin: building.origin,
      w: building.footprint.w,
      h: building.footprint.h,
      door: building.door,
    });
    if (!placed) {
      throw new WorldSetupError(`读档重建失败：${building.displayName} 的落位放不进网格`);
    }
  }
  return grid;
}

/** 蓝图表的两种形态（数组或 Map）都能收：调用方不必先转一手。 */
export type BlueprintSource =
  | readonly PrefabBlueprint[]
  | ReadonlyMap<string, PrefabBlueprint>;

function indexBlueprints(blueprints: BlueprintSource): Map<string, PrefabBlueprint> {
  if (blueprints instanceof Map) return new Map(blueprints);
  return new Map((blueprints as readonly PrefabBlueprint[]).map((item) => [item.id, item]));
}

/** 读档后的世界：网格按存档重放，分区/铺子不变量仍要过一遍。
 *
 * 颜色是“显示事实”，以当前 prefab 表为准：存档里的 palette 可能是旧色表留下的，
 * 直接拿来渲染会让老档永远停在旧配色（D6-A P1）。所以按 prefabId 重解，
 * 找不到 prefab（比如蓝图被删）才回退存量 palette 并告警。
 * 存档 schema 不动：v1 已冻结，读档只做内存里的显示修正。
 */
export function buildWorldFromSave(
  buildings: readonly PlacedBuilding[],
  blueprints?: BlueprintSource,
  spec: GridSpec = SMALL_WORLD_SPEC,
  altar: GridPoint = ALTAR,
): BuiltWorld {
  const resolved = blueprints === undefined ? [...buildings] : rehydratePalettes(buildings, blueprints);
  const grid = rebuildGridFromPlacements(resolved, spec);
  assertWorldInvariants(grid, resolved, altar);
  return { grid, buildings: resolved, altar };
}

/** 按当前 prefab 表重解每栋楼的 palette；prefab 缺失时保留存档值并告警。 */
export function rehydratePalettes(
  buildings: readonly PlacedBuilding[],
  blueprints: BlueprintSource,
): PlacedBuilding[] {
  const byId = indexBlueprints(blueprints);
  const seenMissing = new Set<string>();
  return buildings.map((building) => {
    const blueprint = byId.get(building.prefabId);
    if (blueprint === undefined) {
      if (!seenMissing.has(building.prefabId)) {
        seenMissing.add(building.prefabId);
        console.warn(
          `[setup] 读档时找不到蓝图 ${building.prefabId}，${building.displayName} 沿用存档里的颜色（可能是旧版/外部存档）。`,
        );
      }
      return building;
    }
    return { ...building, palette: blueprint.palette };
  });
}

/** 世界预算校验：像 check_protocol 一样，不合规就不许开工。 */
export function assertWorldInvariants(
  grid: WorldGrid,
  buildings: readonly PlacedBuilding[],
  altar: GridPoint = ALTAR,
): void {
  const problems: string[] = [];
  const workshops = buildings.filter((item) => item.boundTask !== null);
  // 每种活 1–2 栋，只数栋数。括号里那个「镇内 + 郊野」是这个函数的**意图**，不是它
  // 查的东西：下面按 `boundTask` 分组计数，从头到尾不看 prefabId，因而看不出镇内
  // 郊野。小世界就是 3 栋全在镇内、郊野 0 栋，照样过——所以别把这句话读成已校验。
  const byKind = new Map<string, number>();
  for (const building of workshops) {
    if (building.boundTask === null) continue;
    byKind.set(building.boundTask, (byKind.get(building.boundTask) ?? 0) + 1);
  }
  for (const kind of WORKSHOP_TASKS) {
    const count = byKind.get(kind) ?? 0;
    if (count < 1 || count > 2) {
      problems.push(`承接 ${kind} 的铺子 ${count} 栋，必须是 1 或 2 栋`);
    }
  }
  // 每个 ZoneId 里最多 2 栋铺子：同类铺子挤在同一个分区会互相抢活。
  //
  // 这里数的是 `building.zone`（ZoneId：street / altar / industry / scholarly /
  // agriculture / living），**不是**镇内/郊野。那是另一码事，由 prefab 集合决定
  // （`isWildSide`），这个函数从头到尾不碰 prefabId。
  //
  // 这段注释原写「同分区的两栋必须是『一栋镇内、一栋郊野』」，说的是一条代码没有
  // 实现的规则：把原话写成断言，它是红的——同 zone 两栋同在镇内，这里一声不响。
  // 已改成说代码做的事。镇内/郊野的配比不在这一层校验：它由 `homes.test.ts` 对着
  // `buildLargeWorld` 落成的世界断言（镇内三栋、郊野三栋，三种活各是「镇内一栋 +
  // 郊野一栋」共两栋），不靠这个函数。原写「每种活各一栋」，那是把 6 栋铺子除以
  // 3 种活按少了算——`homes.test.ts` 那两条 `entry.town === 1` / `entry.wild === 1`
  // 说得就是「各一栋」各指的是哪一栋。`wilderness-feel.test.ts` 只测时长倍率、落点距离与常明灯，没有一条在数
  // 栋数——别把配比记在它头上。
  const zones = new Map<string, number>();
  for (const building of workshops) {
    zones.set(building.zone, (zones.get(building.zone) ?? 0) + 1);
  }
  for (const [zone, count] of zones) {
    if (count > 2) problems.push(`分区 ${zone} 里有 ${count} 栋铺子，最多 2 栋`);
  }

  for (const building of buildings) {
    if (grid.zoneOf(building.door) === 'altar') {
      problems.push(`${building.displayName} 的门口开在祭坛区`);
    }
    if (!grid.isWalkable(building.door)) {
      problems.push(`${building.displayName} 的门口不可通行`);
    }
    // 与包那条路共用同一个定义（`doorReaches`）：两边各写一遍
    // `path(...).length === 0`，迟早有一边漏掉「门就开在祭坛上」这种真连通。
    if (!doorReaches(grid, building.door, altar)) {
      problems.push(`${building.displayName} 与祭坛之间没有通路`);
    }
  }
  if (problems.length > 0) throw new WorldSetupError(problems.join('；'));
}

// ------------------------------------------------------------------ 2026-10-28 补记
//
// `LARGE_WORLD_SPEC` 上头那句「`9fa55ca` 改了六处」**读起来像穷举，其实不是**。
// 在 `9fa55ca^` 上 `git grep -n '80×60' -- world-client` 数出来是**七处**：
//   `main.ts` / `biomes.ts` / `fog.ts` / `grid.ts` / `setup.ts`（两处：
//   `LARGE_WORLD_SPEC` 的 doc 与 `buildLargeWorld` 的 doc）/ **`scripts/check-persistence.mjs`**。
// 那一笔改了前六处，漏了第七处。而漏的那处是**唯一一处写着「存档体积上限」的地方**，
// 读它的人正是要判断「存档会不会太大」的人——它比 `src/` 里任何一处都更该改对。
//
// 为什么没够到：写「六处」的时候是在 `src/` 里 grep 的，`scripts/` 不在搜索路径里。
// 所以「N 处」这种写法本身是个坑——它让后人以为穷举过了。
//
// 这条补记放在文件末尾而不放在那句话旁边，是**刻意的**：本文件 201～685 行有十几处
// 行号引用（`docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md` 与 `ADR_DEFAULT_PACK_BYPASS.md`），
// 在第 49 行插字会把它们全部推歪，`audit-references.ts --strict` 当场红。
