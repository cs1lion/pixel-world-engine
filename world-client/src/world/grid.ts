/** 网格账本：分区、占用、选址与 A*。
 *
 * 纯逻辑，不依赖 Phaser。世界的一切空间约束都在这里结算；
 * 渲染层只读快照，不许自己改坐标。
 */

import type { CarryItem, GridPoint, PrefabBlueprint, TerrainId, TileCell, ZoneId } from './types.ts';
import type { RegionRequirement } from './types.ts';
import { WALK_COST, walkCostOf } from './terrain-cost.ts';
import { shouldGrowTree } from './wilderness.ts';
import { FLOODED_WALK_COST, isFlooded } from './tide.ts';

/**
 * 未被任何分区覆盖的格子落到这里。
 *
 * 旧规格里七个分区恰好铺满 30×20，默认值永远不会生效；大世界只定义若干
 * 矩形，剩下大片是「未覆盖」。默认成 `street` 会让这些格子全部铺成石板——
 * 实测大世界 72% 是石头，整张图看起来像一块工地。默认成草地才对。
 */
const ZONE_DEFAULT: ZoneId = 'living';

export interface ZoneRegion {
  readonly id: ZoneId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface GridSpec {
  readonly width: number;
  readonly height: number;
  /** 分区矩形；未覆盖到的格子落 street。 */
  readonly zones: readonly ZoneRegion[];
  /** 四周这几圈是不可通行的树篱。 */
  readonly border: number;
  /** 设定集显式绘制的地面。缺省保持旧的按分区推地形。 */
  readonly terrain?: readonly {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly terrain: TerrainId;
  }[];
  /** 地名只用于展示与设定，不参与旧的建造许可。 */
  readonly regions?: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    /**
     * 渡有仪式：进这道区域要带什么（SPEC_V2 §4.6）。
     *
     * 省略或 null 都是「没要」——莞尔镇的地域从来没有这一项，
     * 它们不能因为这一版就变成门。寻路默认不设卡（`path` 的 `accept` 省略时
     * 行为与从前完全一致），要卡谁由调用方按角色给。
     */
    readonly requires?: CarryItem | null;
    /**
     * 呼吸段（SPEC_V2 §4.7）：这一区里不派活、不触发随机事件、不弹提示。
     *
     * 与 `requires` 是**两个独立的槽位**：一道区域可以又要凭证又呼吸
     * （「进了这道门才该安静下来」）。混成一个字段就会有一个表达不了。
     *
     * 省略就是「不呼吸」。莞尔镇的地域从来没有这一项——它们不能因为
     * 这一版就变成静音区，否则整个世界都会停下。
     */
    readonly breathing?: boolean;
  }[];
}

export interface PlacementRequest {
  readonly instanceId: string;
  readonly origin: GridPoint;
  readonly w: number;
  readonly h: number;
  /** 门口格，必须落在占地之外。 */
  readonly door: GridPoint;
}

export function inRect(p: GridPoint, x: number, y: number, w: number, h: number): boolean {
  return p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
}

export class WorldGrid {
  readonly width: number;
  readonly height: number;
  private readonly cells: TileCell[];
  /**
   * 当前潮位，0..1。只有寻路读它。
   *
   * 水不是不可走，只是走起来贵——不可走会让读档时落在水里的角色卡死，
   * 那正是「迷雾只拦建造、不拦通行」踩过的坑。代价抬高到涉水很慢，
   * A* 自己会绕开，真需要时仍然过得去。
   */
  private tideLevel = 0;
  /**
   * 每道区域要带什么才进得去。没有 `requires` 的区域不在这张表里。
   *
   * 建表时算一次，寻路时只查：A* 每展开一格都会问一遍，
   * 每次去遍历 `spec.regions` 会让大世界的寻路平白多出几百次线性扫描。
   */
  private readonly requirements = new Map<string, CarryItem>();
  /**
   * 哪几道区域在呼吸（SPEC_V2 §4.7）。没有 `breathing` 的区域不在这张表里。
   *
   * 与 `requirements` 同一道手续：建表时算一次，问的时候只查。
   */
  private readonly breathing = new Set<string>();

  constructor(spec: GridSpec, wilderness?: { readonly center: GridPoint }) {
    this.width = spec.width;
    this.height = spec.height;
    this.cells = new Array<TileCell>(spec.width * spec.height);
    // 郊野林地只在给了中心点时生成：旧规格靠边界的树就够了，
    // 不传 center 时行为与以前完全一致。
    const protectedZones = spec.zones.filter((z) => z.id !== 'street' && z.id !== 'altar');
    for (let y = 0; y < spec.height; y += 1) {
      for (let x = 0; x < spec.width; x += 1) {
        const zone = this.zoneAt(spec, x, y);
        const edge =
          x < spec.border ||
          y < spec.border ||
          x >= spec.width - spec.border ||
          y >= spec.height - spec.border;
        let terrain = terrainFor(zone);
        // 郊野长树：让"辽阔"不等于"空旷"。镇内与可建区不长。
        if (!edge && terrain === 'grass' && wilderness !== undefined) {
          if (shouldGrowTree({ x, y }, wilderness.center, protectedZones)) {
            terrain = 'tree';
          }
        }
        this.cells[y * spec.width + x] = {
          zone,
          terrain: edge ? 'tree' : terrain,
          walkable: !edge,
          occupant: null,
        };
      }
    }
    for (const patch of spec.terrain ?? []) {
      for (let y = patch.y; y < patch.y + patch.h; y += 1) {
        for (let x = patch.x; x < patch.x + patch.w; x += 1) {
          const cell = this.at({ x, y });
          if (cell !== undefined) cell.terrain = patch.terrain;
        }
      }
    }
    for (const region of spec.regions ?? []) {
      if (region.requires != null) this.requirements.set(region.id, region.requires);
      // 呼吸与门是两件事，同一个循环里各记各的：一道区域可以两者都要。
      if (region.breathing === true) this.breathing.add(region.id);
      for (let y = region.y; y < region.y + region.h; y += 1) {
        for (let x = region.x; x < region.x + region.w; x += 1) {
          const cell = this.at({ x, y });
          if (cell !== undefined) cell.region = region.id;
        }
      }
    }
  }

  private zoneAt(spec: GridSpec, x: number, y: number): ZoneId {
    for (const z of spec.zones) {
      if (inRect({ x, y }, z.x, z.y, z.w, z.h)) return z.id;
    }
    return ZONE_DEFAULT;
  }

  inBounds(p: GridPoint): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  at(p: GridPoint): TileCell | undefined {
    if (!this.inBounds(p)) return undefined;
    return this.cells[p.y * this.width + p.x];
  }

  zoneOf(p: GridPoint): ZoneId {
    return this.at(p)?.zone ?? ZONE_DEFAULT;
  }

  /**
   * 这一格要带什么才进得去。没设门的格子（含越界）返回 null。
   *
   * 多数格子属于某道地域，但只有少数地域有门——所以问的是「要什么」而不是
   * 「属哪道地域」。寻路每格都问一次，直接返回需求比让调用方再查一次表省一趟。
   */
  requirementAt(p: GridPoint): RegionRequirement {
    const region = this.at(p)?.region;
    if (region === undefined) return null;
    return this.requirements.get(region) ?? null;
  }

  /**
   * 每一道要凭证的区域：id 与要什么。没有门就返回空数组。
   *
   * `requirementAt` 是按格子问的，问不出「世界上有几道门」。而「有几道门」
   * 是要说给人听的（界面、喂模型的世界现状）——不说，那道门就只是数据里的
   * 一行字：机制、命令、提示词三处都齐了，没有一个区域真的用，也没人知道。
   *
   * 只给 id，不给显示名：网格不背显示名（见 `SettingPack['regions']` 那段
   * 「别为了去重把这边改成引用 GridSpec」）。名字由拿着设定集的调用方配上。
   */
  gatedRegions(): readonly { readonly id: string; readonly needs: CarryItem }[] {
    return [...this.requirements].map(([id, needs]) => ({ id, needs }));
  }

  /**
   * 这一格此刻是不是在一处呼吸段里（SPEC_V2 §4.7）。
   *
   * 问的是「属于哪道区域」，答不上来就不呼吸——世界外、没被任何区域
   * 覆盖的格子都返回 false。答不上来是「这一格不属于谁」，不是错误，
   * 所以返回 false 而不抛。
   *
   * 与 `requirementAt` 同构：那边问「要什么」，这边问「静不静」。
   *
   * **按整数格问。** 角色站在分数坐标上（她是一路滑过来的），直接拿
   * `villager.pos` 来问会落到一格之外——`at()` 用坐标当下标，
   * `cells[y * width + x]` 收一个 4.048 就是 undefined。调用方先过
   * `cellOf`（`simulation.ts` 里那个 `Math.round`）。这个坑看不见：
   * 她照样在走、照样在干活，只是世界一次都没看见那片呼吸段。
   */
  breathingAt(p: GridPoint): boolean {
    const region = this.at(p)?.region;
    if (region === undefined) return false;
    return this.breathing.has(region);
  }

  /**
   * 世界上有几处呼吸段。没有就返回空数组。
   *
   * 与 `gatedRegions` 同一条理由：`breathingAt` 按格问，问不出「世界上
   * 有几处」。而「有几处」是要说给人听的（界面、喂模型的世界现状）——
   * 不说，呼吸段就只是配置里的一行字，设定了却没人知道它在起作用。
   *
   * 只给 id，不给显示名：网格不背显示名（同 `gatedRegions`）。
   */
  breathingRegions(): readonly { readonly id: string }[] {
    return [...this.breathing].map((id) => ({ id }));
  }

  isWalkable(p: GridPoint): boolean {
    return this.at(p)?.walkable === true;
  }

  /** 潮汐每拍调一次。只影响寻路代价，不改格子的可走性。 */
  setTideLevel(level: number): void {
    this.tideLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  }

  tideLevelNow(): number {
    return this.tideLevel;
  }

  /** 这一格此刻是不是泡在水里。渲染层与派活规则都读它。 */
  isFloodedAt(p: GridPoint): boolean {
    const cell = this.at(p);
    if (cell === undefined) return false;
    return isFlooded(cell.terrain, this.tideLevel);
  }

  /** 这一格的通行代价：地形代价，涨潮时草地与农田按涉水算。 */
  costAt(p: GridPoint): number {
    const cell = this.at(p);
    if (cell === undefined) return WALK_COST.grass;
    return isFlooded(cell.terrain, this.tideLevel)
      ? FLOODED_WALK_COST
      : walkCostOf(cell.terrain);
  }

  /** 能不能往上放建筑：在界内、不是树、没人占。 */
  isBuildable(p: GridPoint): boolean {
    const cell = this.at(p);
    if (!cell) return false;
    return cell.occupant === null && cell.terrain !== 'tree';
  }

  /** 树篱与建筑之外的空地数量，给校验器用。 */
  countOccupied(): number {
    return this.cells.filter((cell) => cell.occupant !== null).length;
  }

  /** 把一栋建筑落进账本。门口必须在占地外，否则返回 false。 */
  place(req: PlacementRequest): boolean {
    if (inRect(req.door, req.origin.x, req.origin.y, req.w, req.h)) return false;
    if (!this.inBounds(req.door)) return false;
    if (!this.canPlace(req.origin, req.w, req.h, 0)) return false;
    for (let y = req.origin.y; y < req.origin.y + req.h; y += 1) {
      for (let x = req.origin.x; x < req.origin.x + req.w; x += 1) {
        const cell = this.cells[y * this.width + x];
        cell.occupant = req.instanceId;
        cell.walkable = false;
      }
    }
    const doorCell = this.at(req.door);
    if (!doorCell) return false;
    doorCell.walkable = true;
    doorCell.terrain = 'stone';
    return true;
  }

  /**
   * 把一栋建筑从账本里撤掉：清占用、恢复可走。
   *
   * 门口保留 stone 地形——那是铺过的路，拆楼不该把路也铲了。
   * 返回是否真的撤掉了（找不到占用者时返回 false）。
   */
  remove(instanceId: string, origin: GridPoint, w: number, h: number): boolean {
    let found = false;
    for (let y = origin.y; y < origin.y + h; y += 1) {
      for (let x = origin.x; x < origin.x + w; x += 1) {
        const cell = this.at({ x, y });
        if (cell === undefined) continue;
        if (cell.occupant !== instanceId) continue;
        cell.occupant = null;
        cell.walkable = true;
        found = true;
      }
    }
    return found;
  }

  /** 占地 + 留白全部没被占才允许落。margin 会把周围几圈也算进检查。 */
  canPlace(origin: GridPoint, w: number, h: number, margin: number): boolean {
    for (let y = origin.y - margin; y < origin.y + h + margin; y += 1) {
      for (let x = origin.x - margin; x < origin.x + w + margin; x += 1) {
        if (!this.isBuildable({ x, y })) return false;
      }
    }
    return true;
  }

  /**
   * 在蓝图允许的分区里按离锚点最近优先找一块合规空地。
   *
   * `accept` 是可选的额外筛选：郊野铺子要用它把落点限制在郊野圈内。
   * 不传时行为与以前完全一致。
   */
  findBestSlot(
    prefab: PrefabBlueprint,
    anchor: GridPoint,
    accept?: (origin: GridPoint) => boolean,
  ): GridPoint | null {
    const { w, h } = prefab.footprint;
    const margin = prefab.clearMargin;
    let best: GridPoint | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const origin = { x, y };
        if (accept !== undefined && !accept(origin)) continue;
        if (!this.footprintInZone(origin, w, h, prefab.zone)) continue;
        if (!this.canPlace(origin, w, h, margin)) continue;
        const door = { x: origin.x + prefab.door.x, y: origin.y + prefab.door.y };
        if (!this.isBuildable(door)) continue;
        const cx = origin.x + (w - 1) / 2;
        const cy = origin.y + (h - 1) / 2;
        const score = Math.abs(cx - anchor.x) + Math.abs(cy - anchor.y);
        if (score < bestScore) {
          bestScore = score;
          best = origin;
        }
      }
    }
    return best;
  }

  private footprintInZone(origin: GridPoint, w: number, h: number, zone: ZoneId): boolean {
    for (let y = origin.y; y < origin.y + h; y += 1) {
      for (let x = origin.x; x < origin.x + w; x += 1) {
        if (this.zoneOf({ x, y }) !== zone) return false;
      }
    }
    return true;
  }

  /**
   * 4 邻域 A*。终点不可达时返回空数组（调用方自己决定怎么降级）。
   *
   * `accept` 是**逐格**的通行许可：返回 false 的格子当作不可走。
   * 渡有仪式用它把「没带凭证的区域」整体划掉，于是 A* 自己绕开，
   * 而不是先给一条穿门的路、走了一半才发现过不去。
   * 省略时行为与从前完全一致——门不拦任何人。
   */
  path(
    start: GridPoint,
    goal: GridPoint,
    accept?: (p: GridPoint) => boolean,
  ): GridPoint[] {
    const passable = (p: GridPoint): boolean => {
      const cell = this.at(p);
      if (cell === undefined || !cell.walkable) return false;
      return accept === undefined || accept(p);
    };
    if (!this.inBounds(start) || !this.inBounds(goal)) return [];
    let target = goal;
    if (!passable(target)) {
      // 兜底也得过同一道门：不然目标在门里时，兜底会摸一个门里的格子，
      // A* 进不去，整条路返回空——调用方看到「到不了」，
      // 而真正的原因是「她要的东西不对」。
      const alt = this.nearestWalkable(target, accept);
      if (!alt) return [];
      target = alt;
    }
    if (start.x === target.x && start.y === target.y) return [];

    const n = this.width * this.height;
    const index = (p: GridPoint): number => p.y * this.width + p.x;
    const gScore = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
    const cameFrom = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const startIndex = index(start);
    const goalIndex = index(target);
    gScore[startIndex] = 0;

    /**
     * 二叉堆取代原来的"每轮线性扫描最小值"。
     *
     * 单屏 30×20 时线性扫描够用；大世界 80×60 有 4800 格，每轮扫描整个 open
     * 列表会让跨图寻路明显变慢。堆的键是 f，同 f 不比较别的，保持确定性。
     */
    const heap = new MinHeap();
    heap.push(startIndex, heuristic(start, target), 0);

    while (heap.size > 0) {
      const { value: currentIndex, g: poppedG } = heap.pop();
      // 陈旧条目：这个格子后来被以更小的代价重新入堆过，旧条目要丢掉。
      // 少了这一步，堆里过期的 f 会把正确路线挤到后面，A* 给出非最优解。
      if (poppedG > gScore[currentIndex]) continue;
      if (closed[currentIndex]) continue;
      if (currentIndex === goalIndex) return rebuild(cameFrom, currentIndex, this.width);
      closed[currentIndex] = 1;

      const current = { x: currentIndex % this.width, y: Math.floor(currentIndex / this.width) };
      for (const step of ORTHOGONAL) {
        const next = { x: current.x + step.x, y: current.y + step.y };
        if (!passable(next)) continue;
        const nextIndex = index(next);
        if (closed[nextIndex]) continue;

        // 代价来自地形：石板路便宜、密林贵，路线自己会先上大路；
        // 涨潮时草地与农田按涉水算，路线会自己挑没被淹的格子走。
        const tentative = gScore[currentIndex] + this.costAt(next);
        if (tentative < gScore[nextIndex]) {
          gScore[nextIndex] = tentative;
          cameFrom[nextIndex] = currentIndex;
          heap.push(nextIndex, tentative + heuristic(next, target), tentative);
        }
      }
    }
    return [];
  }

  /** 半径内随机一块可走空地；找不到返回 null。 */
  randomWalkableNear(
    center: GridPoint,
    radius: number,
    random: () => number,
  ): GridPoint | null {
    const candidates: GridPoint[] = [];
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        const p = { x, y };
        if (Math.abs(x - center.x) + Math.abs(y - center.y) > radius) continue;
        if (this.isWalkable(p)) candidates.push(p);
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(random() * candidates.length)];
  }

  /**
   * 离目标最近的一块可走空地。作息落点用它兜底。
   *
   * `accept` 是渡有仪式的门（SPEC_V2 §4.6）：给了就只在不设卡的格子里找。
   * 寻路的兜底路径必须把它透传进来，否则门里的目标会被兜底成门里的格子。
   */
  nearestWalkable(goal: GridPoint, accept?: (p: GridPoint) => boolean): GridPoint | null {
    let best: GridPoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const p = { x, y };
        if (!this.isWalkable(p)) continue;
        if (accept !== undefined && !accept(p)) continue;
        const distance = Math.abs(x - goal.x) + Math.abs(y - goal.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = p;
        }
      }
    }
    return best;
  }
}

const ORTHOGONAL: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * 启发式：曼哈顿距离 × 最小通行代价。
 *
 * 必须乘最小代价，否则它就不再是「低估剩余成本」。旧实现用裸曼哈顿距离，
 * 在引入代价后会把 2.5 的密林估成 1，A* 可能给出非最优路线（绕远却不自知）。
 * 用全场最小代价做尺度，保证可采纳，同时仍是有信息的。
 */
const MIN_WALK_COST = Math.min(...Object.values(WALK_COST));

function heuristic(a: GridPoint, b: GridPoint): number {
  return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * MIN_WALK_COST;
}

/**
 * 二叉最小堆，键是 f 值。
 *
 * 不追求通用：只服务 A* 的 open 列表，没有 decrease-key（A* 用重复入堆代替）。
 */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];
  /** 入堆时的 g 值，用来识别陈旧条目。 */
  private readonly gs: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(value: number, key: number, g: number): void {
    this.keys.push(key);
    this.values.push(value);
    this.gs.push(g);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { value: number; g: number } {
    const topValue = this.values[0]!;
    const topG = this.gs[0]!;
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;
    const lastG = this.gs.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      this.gs[0] = lastG;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.keys.length && this.keys[left]! < this.keys[smallest]!) smallest = left;
        if (right < this.keys.length && this.keys[right]! < this.keys[smallest]!) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return { value: topValue, g: topG };
  }

  private swap(a: number, b: number): void {
    const key = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = key;
    const value = this.values[a]!;
    this.values[a] = this.values[b]!;
    this.values[b] = value;
    const g = this.gs[a]!;
    this.gs[a] = this.gs[b]!;
    this.gs[b] = g;
  }
}

function rebuild(cameFrom: Int32Array, goalIndex: number, width: number): GridPoint[] {
  const out: GridPoint[] = [];
  let current = goalIndex;
  while (current !== -1) {
    out.push({ x: current % width, y: Math.floor(current / width) });
    current = cameFrom[current];
  }
  out.reverse();
  return out.slice(1); // 去掉起点：她已经站在那了。
}

function terrainFor(zone: ZoneId): TileCell['terrain'] {
  switch (zone) {
    case 'altar':
      return 'plaza';
    case 'agriculture':
      return 'farm';
    case 'street':
      return 'stone';
    default:
      return 'grass';
  }
}
