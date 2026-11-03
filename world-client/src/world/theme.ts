/** 渲染配色的稳定语义槽。每套设定集可换色值，不能换含义。
 *
 * token 名是**闭集**，来自 `WORLD`：设定集手册自己的 11 色只是另一组值，
 * 落点仍是这 24 个槽（SPEC_V2 §4.2）。所以这里是 `Record<WorldColor, number>`
 * 而不是 `Record<string, number>`——写错一个 token 名（`terracota`）要当场
 * 编译失败，而不是在运行时画出一个 `undefined` 色、安静地什么都不显示。
 *
 * **这里是「按当前世界解析」的那一层，不是某一套色板本身。** 渲染代码不该
 * 直接读 `WORLD`——那是莞尔镇的映射，灯潮界的 24 个槽同名不同色。直接读
 * `WORLD` 意味着：换一套设定集，画面上就是两套色同时出现（骨架用莞尔镇的
 * 灰木、包里的楼用灯潮界的冷蓝），而且再换一套世界要把每个调用点都改一遍。
 *
 * 所以调用点写 `paletteFor().timber`：省略参数 = 取**当前激活世界**的映射，
 * 由 `activateWorld()` 在选设定集时切换。默认世界（`?world=` 缺省）始终有
 * 回落：注册表初值就是 `WORLD`/`TERRAIN_COLORS`，问一个没注册的 id 也拿到
 * 它，不会画出 `undefined`。
 *
 * 注册与激活都在 `settings/index.ts` 的 `selectSetting()` 里做——它已经是
 * 「这一次跑哪套设定集」的唯一入口，色板跟着它走，不另开第二条真相。
 */
import { WORLD, TERRAIN_COLORS } from './palette-data.ts';
import type { WorldColor } from './palette-data.ts';
import type { TerrainId } from './types.ts';

export type { WorldColor };

export type WorldPalette = Readonly<Record<WorldColor, number>>;
export type TerrainPalette = Readonly<Record<TerrainId, number>>;

/** 没有 `?world=` 时的那一套；也是注册表与激活指针的初值与回落。 */
const DEFAULT_WORLD = 'default';

interface WorldColors {
  readonly palette: WorldPalette;
  readonly terrain: TerrainPalette;
}

const WORLDS = new Map<string, WorldColors>([
  [DEFAULT_WORLD, { palette: WORLD, terrain: TERRAIN_COLORS }],
]);

let activeWorldId = DEFAULT_WORLD;

/** 把一套设定集的 24 色与地形色登记进来。同一个 id 再登记以新的为准。 */
export function registerWorldPalette(
  id: string,
  palette: WorldPalette,
  terrain: TerrainPalette,
): void {
  WORLDS.set(id, { palette, terrain });
}

/** 切到某个世界。没登记过的 id 当场抛错，不静默回落——那是装载期就该抓到的错。 */
export function activateWorld(id: string): void {
  if (!WORLDS.has(id)) throw new Error(`没有登记这个世界的调色板：${id}`);
  activeWorldId = id;
}

export function activeWorld(): string {
  return activeWorldId;
}

/** 按 id 取 24 色；省略就是当前世界。没登记的 id 回落默认世界。 */
export function paletteFor(worldId: string = activeWorldId): WorldPalette {
  return WORLDS.get(worldId)?.palette ?? WORLD;
}

/** 按 id 取地形色；省略就是当前世界。没登记的 id 回落默认世界。 */
export function terrainFor(worldId: string = activeWorldId): TerrainPalette {
  return WORLDS.get(worldId)?.terrain ?? TERRAIN_COLORS;
}
