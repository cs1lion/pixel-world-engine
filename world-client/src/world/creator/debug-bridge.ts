/** 造物主 EDD 调试桥：把评测动作翻译成真实世界动作，再把真实落盘字节交出去。
 *
 * **它是验收面，不是产品面。** 只在 `?debug=1` 下挂到 `window.__PIXEL_WORLD_DEBUG__`，
 * 生产路径上不存在。它认的 `UpgradeBuilding` / `ApplyHumanDiff` / `InjectViolations`
 * 等动作**不在** `GENESIS_COMMAND_KINDS` 里，也不进服务端规则层——白名单是 LLM
 * 的合法域，测试面是另一回事，混在一起第一次就会把 LLM 的权限一起放宽。
 *
 * 三样东西是真的，不是内存态假装：
 *  1. 落位过 `WorldGrid.canPlace()` 的真实空间判定，并且 `Simulation.enqueue({kind:'build'})`
 *     真的把楼交给了世界（`stepTicks` 里由 `sim.update()` 结算）；
 *  2. 选址与铺路来自 `spatial-executor.ts`，零随机、零墙钟；
 *  3. `exportSaveBytes()` 里的 `world` 是 `SaveStore.readRawText()` 的**原始存档字节**
 *     （只读），整包连同审计台账一起写进独立的 localStorage 键。
 *
 * **存档本体一个字段都不加。** v6 的 `SAVE_V6_PATH_SET` 是冻结集合，加键会被
 * `assertSave` 按字段漂移拒；升 v7 要动指纹、样例与一批冻结测试，那是独立决策。
 * 所以 `creatorRules` / `fuseState` 放在包的顶层，来自独立落盘的审计侧车。
 * `schemaVersion` 因此恒等——K4 要的是「起停前后不变」，不是「永远是某个数」。
 */

import type { Simulation } from '../simulation.ts';
import type { WorldGrid } from '../grid.ts';
import { checkPlacement } from '../setup.ts';
import type { GridPoint, PrefabBlueprint } from '../types.ts';
import type { WorldSave } from '../save.ts';

/** 存档读写的**结构端口**，不 import `src/ui/`：`purity` 闸门锁着
 * 「world 不依赖它上面的任何一层」。SaveStore 天然满足这个形状。 */
interface SavePort {
  readRawText(): string | null;
  write(save: WorldSave): unknown;
}
import { AutonomousFuseController, AutonomyLevel } from './fuse.ts';
import { RuleSynthesizer, buildStructuredDiff } from './synthesizer.ts';
import type { GenesisCommand } from './schema.ts';
import {
  emptyAuditState,
  enqueueBuildingConstruction,
  enqueueBuildingUpgrade,
  tickBuildingConstruction,
  metricsOf,
  constructionReadout,
  pointKey,
  type CreatorAuditState,
  type SpatialRule,
} from './audit-state.ts';
import {
  findDeterministicSlot,
  planRoadToMainNetwork,
  type Footprint,
} from './spatial-executor.ts';

/** 逻辑一拍的长度，与 `SandboxScene` 的 `LOGIC_STEP_MS` 同值。桥不定义世界节奏。 */
const LOGIC_STEP_MS = 100;
const AUDIT_STORAGE_KEY = 'pwe.creator.audit.v1';
/** 数据集写的是能力模块名 `LAYOUT_AND_BUILDING`；熔断器认的是角色 id。
 * 「布局与建筑」这一格归 `mapper`（见 `AUTONOMY_CLIMB_CONFIG` 与 fuse 的角色闭集）。 */
const FUSE_ROLE = 'mapper';

/** 数据集里的蓝图 id 不是仓里的 12 张真蓝图，是评测夹具的化名。
 * 这里只做「化名 → 真蓝图」的一张表，不改 `prefabs.json`，也不往注册表里塞假条目。 */
interface EvalBlueprint {
  /** 真蓝图按 id 排序后的位次。id 本身归设定配置包，代码里不写死。 */
  readonly blueprintRank: number;
  readonly footprint: Footprint;
  readonly margin: number;
  readonly door: GridPoint;
  readonly region: string;
}

const EVAL_BLUEPRINTS: Readonly<Record<string, EvalBlueprint>> = {
  workshop_lantern: {
    blueprintRank: 0,
    footprint: { w: 3, h: 2 },
    margin: 1,
    door: { x: 1, y: 2 },
    region: 'industry',
  },
  smithy_lv1: {
    blueprintRank: 1,
    footprint: { w: 3, h: 2 },
    margin: 1,
    door: { x: 1, y: 2 },
    region: 'industry',
  },
  smithy_lv2: {
    blueprintRank: 2,
    footprint: { w: 3, h: 2 },
    margin: 1,
    door: { x: 1, y: 2 },
    region: 'industry',
  },
  grand_foundry_6x6: {
    blueprintRank: 3,
    footprint: { w: 6, h: 6 },
    margin: 1,
    door: { x: 2, y: 6 },
    region: 'industry',
  },
  fish_dock: {
    blueprintRank: 4,
    footprint: { w: 2, h: 2 },
    margin: 1,
    door: { x: 0, y: 2 },
    region: 'industry',
  },
};

/** 分区化名 → 真实 zone id。数据集写 industrial，仓里叫 industry。 */
const REGION_ALIASES: Readonly<Record<string, string>> = {
  industrial: 'industry',
  coastal_industrial: 'industry',
  saturated_zone: 'industry',
  scholarly: 'scholarly',
  living: 'living',
  agriculture: 'agriculture',
  altar: 'altar',
};

export interface CreatorCommandOutcome {
  readonly rejected?: boolean;
  readonly code?: string;
  readonly instanceId?: string;
  readonly placedRegion?: string;
  readonly patch?: { readonly kind: string; readonly isSelfJustifying: boolean } | null;
}

export interface BridgeDeps {
  readonly grid: WorldGrid;
  readonly blueprints: ReadonlyMap<string, PrefabBlueprint>;
  readonly sim: Simulation;
  readonly saveStore: SavePort;
  readonly storage: Storage;
  readonly seed: number;
  /** 评测开局的世界时刻（毫秒）。桥的时钟从这里按固定步长走，不读挂机时长。 */
  readonly initialNow: number;
  /** 当前存档对象（无档时用世界现态生成），只用于打包 `world` 字段。 */
  readonly currentSave: () => unknown;
  /** 施工视图联动。渲染层每拍据此刷新脚手架；缺省时桥仍可无头运行。 */
  readonly onConstructionTick?: (audit: CreatorAuditState) => void;
}

interface AuditPackage {
  readonly schemaVersion: number;
  readonly world: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly creatorRules: readonly SpatialRule[];
  readonly fuseState: CreatorAuditState['fuseState'];
  readonly audit: CreatorAuditState;
}

/** 稳定字符串化：键序固定，保证同状态两次导出逐字相同（K3）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/** 稳定哈希（FNV-1a 64 位思路的 32 位双跑版），只用于评测比对，不参与存档。 */
function hash32(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((c << 5) | (c >>> 3)), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export class CreatorDebugBridge {
  private readonly deps: BridgeDeps;
  private audit: CreatorAuditState;
  private readonly fuse: AutonomousFuseController;
  private readonly synthesizer = new RuleSynthesizer();
  /** setup 留下的标记：下次落位时在门口正前方种一块障碍。 */
  private obstacleAtDoor = false;

  constructor(deps: BridgeDeps) {
    this.deps = deps;
    // 时钟不读 `sim.snapshot().now` 的绝对值：那个数里掺了「页面开着多久」，
    // 同种子重放两次会因为 tag 页多活了一秒而哈希不同（K3 第一次就抓到了这件事）。
    // 桥的时钟从 URL 钉住的开局时刻起步，按 LOGIC_STEP_MS 固定步长推进；
    // `sim.update()` 照常真跑，两条时钟各走各的但步长相同。
    this.audit = emptyAuditState(deps.seed, deps.initialNow);
    this.fuse = new AutonomousFuseController(() => this.audit.worldNow);
    this.fuse.initRole(FUSE_ROLE, '布局与建筑', AutonomyLevel.L2, AutonomyLevel.L2);
    // 每个页面加载都是一次干净的评测会话：清掉上次的审计侧车。
    // 显式 `reloadFromBytes()` 是唯一能在同一页面里恢复中途状态的路（H3）。
    deps.storage.removeItem(AUDIT_STORAGE_KEY);
    this.persist();
  }

  // ========== 评测动作 ==========

  dispatchCreatorCommand(raw: Record<string, unknown>): CreatorCommandOutcome {
    const kind = String(raw['kind'] ?? '');
    switch (kind) {
      case 'PlaceBuilding':
        return this.place(raw);
      case 'UpgradeBuilding':
        return this.upgrade(raw);
      case 'ApplyHumanDiff':
        return this.applyHumanDiff(raw);
      case 'InjectViolations':
        return this.injectViolations(raw);
      case 'InjectRegression':
        return this.injectRegression(raw);
      case 'FillZone':
        return this.fillZone(String(raw['region'] ?? ''));
      case 'PlantObstacleAtDoor':
        this.obstacleAtDoor = true;
        this.persist();
        return {};
      case 'SetTide':
        return this.setTide(raw);
      default:
        return { rejected: true, code: 'UNKNOWN_DEBUG_COMMAND' };
    }
  }

  /** 按固定逻辑拍推进：真调 `sim.update()`，世界时钟与居民作息照常走。 */
  stepTicks(count: number): void {
    const times = Math.max(0, Math.min(5000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < times; i += 1) {
      this.deps.sim.update(LOGIC_STEP_MS);
      this.audit.nowTick += 1;
      tickBuildingConstruction(this.audit);
      this.audit.worldNow += LOGIC_STEP_MS;
      this.deps.onConstructionTick?.(this.audit);
    }
    this.persist();
  }

  // ========== 落盘字节 ==========

  /**
   * 导出「真实存档字节 + 审计侧车」的包，并**真的写盘**。
   *
   * `world` 与 `meta` 直接来自 `SaveStore.readRawText()`；无档时用当前世界的
   * 存档投影，并在注释里说清这是开局态（不是伪造的落盘结果）。
   */
  exportSaveBytes(): string {
    // 先把当前世界（含 `sim.enqueue({kind:'build'})` 已经结算的楼）写回 SaveStore，
    // 再读原始字节。否则包里的 `world.buildings` 永远是上一次页面卸载时的旧档，
    // 新落的那栋楼只在审计台账里——那正是「只记内存态」的假绿形状。
    // 写的是 v6 已有字段，schemaVersion 不变；评测页独立 context，不碰玩家存档槽。
    try {
      this.deps.saveStore.write(
        this.deps.currentSave() as WorldSave,
      );
    } catch {
      // 存储不可用（隐私模式 / 配额）时不假装成功：下面的 readRawText 会返回 null，
      // 检查方拿到的仍是当前世界的存档投影，但会少一层「真落盘」的证据。
    }
    const raw = this.deps.saveStore.readRawText();
    const save = (raw !== null ? JSON.parse(raw) : this.deps.currentSave()) as {
      readonly schemaVersion?: number;
      readonly world?: Record<string, unknown>;
      readonly meta?: Record<string, unknown>;
    };
    const pkg: AuditPackage = {
      schemaVersion: save.schemaVersion ?? 6,
      world: save.world ?? {},
      meta: save.meta ?? {},
      creatorRules: this.audit.creatorRules,
      fuseState: this.audit.fuseState,
      audit: this.audit,
    };
    const text = stableStringify(pkg);
    this.deps.storage.setItem(AUDIT_STORAGE_KEY, text);
    return text;
  }

  /** 反序列化一份导出包。它只读传入的字节，不偷看当前内存态。 */
  inspectSaveBytes(bytes: string): Record<string, unknown> {
    const pkg = JSON.parse(bytes) as AuditPackage;
    const audit = pkg.audit;
    const submerged = this.submergedTiles(audit.tideLevel);
    const metrics = metricsOf(audit, submerged);
    return {
      now: audit.worldNow,
      buildings: audit.buildings.map((building) => ({
        ...building,
        ...constructionReadout(building),
      })),
      roads: audit.roads.map((key) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
      }),
      chronicle: audit.chronicle,
      metrics,
      blockedTiles: audit.blockedTiles,
      lastRoadPlan: audit.lastRoadPlan,
      creatorRules: audit.creatorRules,
      fuseState: audit.fuseState,
      schemaVersion: pkg.schemaVersion,
    };
  }

  /** H3：从导出的字节恢复中途施工状态。这是唯一不重置台账的入口。 */
  reloadFromBytes(bytes: string): void {
    const pkg = JSON.parse(bytes) as AuditPackage;
    this.audit = pkg.audit;
    this.persist();
  }

  stateHash(): string {
    return hash32(stableStringify(this.audit));
  }

  gridSnapshot(): string {
    const occupied = this.audit.buildings
      .flatMap((b) => {
        const cells: string[] = [];
        for (let y = b.origin.y; y < b.origin.y + b.footprint.h; y += 1) {
          for (let x = b.origin.x; x < b.origin.x + b.footprint.w; x += 1) {
            cells.push(`${x},${y}:${b.prefabId}:${b.stage}`);
          }
        }
        return cells;
      })
      .sort();
    return stableStringify({ occupied, roads: [...this.audit.roads].sort() });
  }

  /** 渲染层读的台账。只读，不允许从视图反写世界。 */
  auditState(): CreatorAuditState {
    return this.audit;
  }

  // ========== 内部：动作实现 ==========

  private place(raw: Record<string, unknown>): CreatorCommandOutcome {
    const prefabId = String(raw['prefabId'] ?? 'workshop_lantern');
    const blueprint = EVAL_BLUEPRINTS[prefabId];
    if (!blueprint) return { rejected: true, code: 'UNKNOWN_PREFAB' };

    const requestedRegion = raw['region'] === undefined ? undefined : String(raw['region']);
    const region = requestedRegion ?? blueprint.region;

    // 人工否决过的坐标，再提一次必须被拒（M5 的 enforcedOnNextPlace）。
    const explicitAt = raw['origin'] as GridPoint | undefined;
    if (explicitAt && this.forbiddenAt(explicitAt)) {
      return { rejected: true, code: 'SPATIAL_CONSTRAINT' };
    }

    const submerged = this.submergedTiles(this.audit.tideLevel);
    const bounds = { width: this.deps.grid.width, height: this.deps.grid.height };
    const snapshot = this.deps.sim.snapshot();
    const zoneId = REGION_ALIASES[region];

    // 落进世界要用一张「世界里还没有同款」的真蓝图：`Simulation.build()` 会拒
    // 「这种铺子已经有一栋了」。挑的顺序按 id 排序，保证同种子两次重放同一选择。
    const existing = new Set(snapshot.buildings.map((building) => building.prefabId));
    const sorted = [...this.deps.blueprints.values()].sort((a, b) => a.id.localeCompare(b.id));
    const mapped = sorted[blueprint.blueprintRank];
    const realBlueprint =
      mapped && !existing.has(mapped.id)
        ? mapped
        : sorted.find((candidate) => !existing.has(candidate.id));

    const slot = findDeterministicSlot({
      footprint: blueprint.footprint,
      margin: blueprint.margin,
      anchor: snapshot.altar,
      bounds,
      blocked: (p) => this.isBlocked(p, submerged),
      inRegion: this.regionPredicate(zoneId),
      // 用 `checkPlacement` 做整块终审：桥算出的 origin 必须同时也过
      // `placeBlueprint` 那一套规则，否则 `sim.enqueue(build)` 会静默拒绝，
      // 楼就只活在台账里了（K4 的防假绿断言抓到的正是这一条）。
      accept: realBlueprint
        ? (origin) => checkPlacement(this.deps.grid, realBlueprint, origin).ok
        : undefined,
    });
    if (slot === null) return { rejected: true, code: 'REGION_FULL' };

    const door = { x: slot.x + blueprint.door.x, y: slot.y + blueprint.door.y };
    const network = this.roadNetwork(snapshot.roads, snapshot.altar);
    const walkable = (p: GridPoint) => this.isWalkable(p, slot, blueprint.footprint);

    if (this.obstacleAtDoor) {
      // 「门口正前方」不是随便挑一格：先算出没有障碍时的最短路，把它的第二格
      // 封成岩石。这样 BFS 必须换一条路，H2 才真的测到绕行，而不是碰巧没撞上。
      const clear = planRoadToMainNetwork({ door, network, bounds, walkable });
      const front = clear && clear.length > 1 ? clear[1]! : { x: door.x, y: door.y + 1 };
      const key = pointKey(front);
      if (!this.audit.blockedTiles.includes(key)) this.audit.blockedTiles.push(key);
      this.obstacleAtDoor = false;
    }

    const path = planRoadToMainNetwork({ door, network, bounds, walkable });
    const paved = path ?? [];
    const doorConnected = path !== null;
    const straightDistance = network.reduce(
      (best, point) => Math.min(best, Math.abs(point.x - door.x) + Math.abs(point.y - door.y)),
      Number.POSITIVE_INFINITY,
    );
    this.audit.lastRoadPlan = {
      door,
      blocked: [...this.audit.blockedTiles],
      path: paved.map(pointKey),
      pathLength: paved.length,
      straightDistance: Number.isFinite(straightDistance) ? straightDistance : 0,
    };

    const instanceId = `creator-${this.audit.seed}-${this.audit.nextInstance}`;
    this.audit.nextInstance += 1;

    enqueueBuildingConstruction(this.audit, {
      instanceId,
      prefabId,
      origin: slot,
      footprint: blueprint.footprint,
      margin: blueprint.margin,
      door,
      constructionTicks: Number(raw['constructionTicks'] ?? 3),
      pavedRoadTiles: paved,
      doorConnected,
    });

    // 真把楼交给世界：由 `stepTicks()` 里的 `sim.update()` 结算队列。
    // 仓里的真蓝图 id 与评测化名不同，落世界用映射后的 id。
    if (realBlueprint) {
      this.deps.sim.enqueue({
        kind: 'build',
        prefabId: realBlueprint.id,
        instanceId,
        at: slot,
      });
    }
    this.persist();
    return { rejected: false, instanceId, placedRegion: region };
  }

  private upgrade(raw: Record<string, unknown>): CreatorCommandOutcome {
    const toPrefabId = String(raw['toPrefabId'] ?? '');
    const targetId = String(raw['targetId'] ?? this.audit.buildings[0]?.instanceId ?? '');
    if (!EVAL_BLUEPRINTS[toPrefabId]) return { rejected: true, code: 'UNKNOWN_PREFAB' };
    try {
      const building = enqueueBuildingUpgrade(
        this.audit,
        targetId,
        toPrefabId,
        Number(raw['constructionTicks'] ?? 2),
      );
      this.persist();
      return { rejected: false, instanceId: building.instanceId };
    } catch {
      return { rejected: true, code: 'TARGET_NOT_FOUND' };
    }
  }

  private applyHumanDiff(raw: Record<string, unknown>): CreatorCommandOutcome {
    const proposal = raw['agentProposal'] as Record<string, unknown> | undefined;
    const outcome = raw['userOutcome'] as Record<string, unknown> | undefined;
    if (!proposal || !outcome) return { rejected: true, code: 'MALFORMED_DIFF' };

    const toCommand = (value: Record<string, unknown>): GenesisCommand => ({
      kind: 'PlaceBuilding',
      id: String(value['id'] ?? 'cmd_1'),
      templateId: String(value['prefabId'] ?? 'workshop_lantern'),
      at: (value['origin'] as GridPoint) ?? { x: 0, y: 0 },
    });
    const diff = buildStructuredDiff(toCommand(proposal), toCommand(outcome));
    // 合成器只在查得到地标时才敢提炼距离规则（「查不到就不猜」是它自己的口径）。
    // 祭坛是这个世界唯一确定存在的地标，把它交进去。
    const altar = this.deps.sim.snapshot().altar;
    const result = this.synthesizer.synthesizeFromDiff(diff, {
      nearbyLandmarks: () => [{ id: 'altar', at: altar }],
    });
    const spatial = result.patches.find((patch) => patch.type === 'spatial_constraint');

    if (!spatial) return { rejected: true, code: 'NO_SPATIAL_PATCH' };

    const forbidden = (proposal['origin'] as GridPoint) ?? { x: 0, y: 0 };
    const rule: SpatialRule = {
      kind: 'SpatialConstraint',
      forbiddenAt: { x: forbidden.x, y: forbidden.y },
      isSelfJustifying: true,
      reason: spatial.justification,
      fromCommandId: String(proposal['id'] ?? 'cmd_1'),
    };
    this.audit.creatorRules.push(rule);
    this.persist();
    return {
      rejected: false,
      patch: { kind: 'SpatialConstraint', isSelfJustifying: true },
    };
  }

  private injectViolations(raw: Record<string, unknown>): CreatorCommandOutcome {
    const count = Math.max(1, Math.floor(Number(raw['count'] ?? 3)));
    for (let i = 0; i < count; i += 1) {
      this.fuse.recordCommandResult(FUSE_ROLE, {
        schemaPassed: false,
        invariantViolated: true,
        hasCollision: true,
      });
    }
    this.fuse.forceDowngradeToL1(FUSE_ROLE, '连续注入非法坐标');
    this.projectFuse('FUSE_TRIPPED', 2, 1);
    return {};
  }

  private injectRegression(raw: Record<string, unknown>): CreatorCommandOutcome {
    const passed = Number(raw['passRate'] ?? 1) >= 1;
    this.fuse.recordRegressionRun(FUSE_ROLE, passed, { source: 'creator-eval' });
    const resumed = this.fuse.allowResumeToTarget(FUSE_ROLE);
    this.projectFuse(resumed ? 'RECOVERY' : 'RESUME_REFUSED', 1, resumed ? 2 : 1);
    return {};
  }

  private setTide(raw: Record<string, unknown>): CreatorCommandOutcome {
    this.audit.tideLevel = Math.max(0, Math.min(1, Number(raw['level'] ?? 0)));
    this.deps.sim.enqueue({
      kind: 'setTideLevel',
      level: this.audit.tideLevel,
      durationMs: Math.max(1, Number(raw['durationMs'] ?? 60_000)),
    });
    this.persist();
    return {};
  }

  private projectFuse(lastEvent: string, fromLevel: number, toLevel: number): void {
    const state = this.fuse.getRoleState(FUSE_ROLE);
    this.audit.fuseState = {
      isFused: state?.isFused ?? false,
      fromLevel,
      toLevel,
      lastEvent,
    };
    this.persist();
  }

  // ========== 内部：空间判定 ==========

  /** H1 的「分区满载」：把该分区里每一格都标成不可建，让选址器真的走完整条
   * 螺旋后返回 null。用一个布尔旗子直接返回 REGION_FULL 会绕过选址器——
   * 那样测的是旗子，不是空间约束。 */
  private fillZone(region: string): CreatorCommandOutcome {
    const zoneId = REGION_ALIASES[region] ?? region;
    const grid = this.deps.grid;
    let cells = 0;
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (this.zoneOf({ x, y }) === zoneId) {
          const key = pointKey({ x, y });
          if (!this.audit.blockedTiles.includes(key)) this.audit.blockedTiles.push(key);
          cells += 1;
        }
      }
    }
    this.audit.filledRegions.push(region);
    this.persist();
    return { rejected: false, code: cells === 0 ? 'ZONE_NOT_FOUND' : undefined };
  }

  private forbiddenAt(point: GridPoint): boolean {
    return this.audit.creatorRules.some(
      (rule) => rule.forbiddenAt.x === point.x && rule.forbiddenAt.y === point.y,
    );
  }

  /** 潮位高时哪些格子算被淹。评测夹具用「边界两圈 + 低地」近似，
   * 与 `WorldGrid.levelAt()` 的真实高度一起判，不是凭空画一张水图。 */
  private submergedTiles(level: number): ReadonlySet<string> {
    const out = new Set<string>();
    if (level < 0.5) return out;
    const grid = this.deps.grid;
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const edge = Math.min(x, y, grid.width - 1 - x, grid.height - 1 - y);
        if (edge < 2 || grid.levelAt({ x, y }) < 0) out.add(pointKey({ x, y }));
      }
    }
    return out;
  }

  private isBlocked(point: GridPoint, submerged: ReadonlySet<string>): boolean {
    if (!this.deps.grid.canPlace(point, 1, 1, 0)) return true;
    if (submerged.has(pointKey(point))) return true;
    if (this.audit.blockedTiles.includes(pointKey(point))) return true;
    if (this.forbiddenAt(point)) return true;
    for (const building of this.audit.buildings) {
      const within =
        point.x >= building.origin.x - building.margin &&
        point.x < building.origin.x + building.footprint.w + building.margin &&
        point.y >= building.origin.y - building.margin &&
        point.y < building.origin.y + building.footprint.h + building.margin;
      if (within) return true;
    }
    return false;
  }

  private isWalkable(point: GridPoint, origin: GridPoint, footprint: Footprint): boolean {
    if (point.x < 0 || point.y < 0) return false;
    if (point.x >= this.deps.grid.width || point.y >= this.deps.grid.height) return false;
    if (this.audit.blockedTiles.includes(pointKey(point))) return false;
    if (
      point.x >= origin.x &&
      point.x < origin.x + footprint.w &&
      point.y >= origin.y &&
      point.y < origin.y + footprint.h
    ) {
      return false;
    }
    const cell = this.deps.grid.at(point);
    if (!cell || cell.terrain === 'shallow' || cell.terrain === 'tree') return false;
    return cell.walkable !== false;
  }

  private zoneOf(point: GridPoint): string {
    // 与 `checkPlacement` 用同一个分区读取口，避免桥和世界各判一套。
    return this.deps.grid.zoneOf(point);
  }

  /** 分区谓词只在图里真的有这个 zone 时生效。
   *
   * 设定集可以没有 `industry`（灯潮界的分区表就是另一套），此时若硬筛，
   * 整张图一格都不合规，返回 REGION_FULL——那读起来像「分区满了」，
   * 其实是「这张图没这个分区」。两种失败不能混成一个码。 */
  private regionPredicate(zoneId: string | undefined): ((p: GridPoint) => boolean) | undefined {
    if (!zoneId) return undefined;
    const grid = this.deps.grid;
    let exists = false;
    for (let y = 0; y < grid.height && !exists; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (this.zoneOf({ x, y }) === zoneId) {
          exists = true;
          break;
        }
      }
    }
    return exists ? (p) => this.zoneOf(p) === zoneId : undefined;
  }

  /** 主干道 = 存档里已有的路 + 祭坛周围四格。铺路连到任意一格即算连通。 */
  private roadNetwork(roads: readonly GridPoint[], altar: GridPoint): GridPoint[] {
    const out = roads.map((p) => ({ x: p.x, y: p.y }));
    for (const d of [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ]) {
      out.push({ x: altar.x + d.x, y: altar.y + d.y });
    }
    return out;
  }

  private persist(): void {
    // 只写审计侧车；存档槽由 SaveStore 独占，桥一个字节都不碰。
    this.deps.storage.setItem(
      AUDIT_STORAGE_KEY,
      stableStringify({ audit: this.audit, rules: this.audit.creatorRules }),
    );
  }
}
