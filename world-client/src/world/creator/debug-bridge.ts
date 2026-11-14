/** 造物主 EDD 调试桥：**生产状态的只读适配器**。
 *
 * P0 收敛后这里不再算任何世界状态。落位走 `Simulation.enqueue`（与玩家手动造物、
 * 神谕同一条通道），验收读数一律来自 `SaveStore` 落盘的存档字节
 * `world.buildings / roads / constructions / now`。
 * 场地占用与绕行由生产 `WorldGrid.findBestSlot` / `grid.path` / `paveFrom` 决定，
 * 连通性问生产 `doorReaches`。桥只负责：注入评测夹具、投影读数、导出字节。
 *
 * 它是 `?debug=1` 下的评测面，不是产品面。`UpgradeBuilding` / `ApplyHumanDiff` /
 * `InjectViolations` 等动作只在 spec 组用例里出现，不进白名单、不改世界规则。
 *
 * 存档版本不动：`creatorRules` / `fuseState` / 评测台账是独立会话状态，
 * 打在导出包的顶层，不写进 v6 冻结的 `world.*` 路径集合。
 */

import type { Simulation } from '../simulation.ts';
import type { WorldGrid } from '../grid.ts';
import { doorReaches } from '../setup.ts';
import type { GridPoint, PrefabBlueprint } from '../types.ts';
import type { WorldSave } from '../save.ts';
import { AutonomousFuseController, AutonomyLevel } from './fuse.ts';
import { RuleSynthesizer, buildStructuredDiff } from './synthesizer.ts';
import type { GenesisCommand } from './schema.ts';
import {
  emptyAuditState,
  metricsOf,
  pointKey,
  type CreatorAuditState,
  type SpatialRule,
} from './audit-state.ts';

/** 评测一拍推进 1 个世界秒。生产仍是 100ms 固定步长，这里只是 `sim.update()` 的步长参数，
 *  不是第二套时钟——目的是让 3 拍能覆盖生产 `CONSTRUCTION_MS = 3200` 的施工窗口。 */
const EVAL_STEP_MS = 1000;
const AUDIT_STORAGE_KEY = 'pwe.creator.audit.v1';
/** 数据集的能力模块名 → 熔断器认的角色 id。 */
const FUSE_ROLE = 'mapper';

/** 存档读写的结构端口，不 import `src/ui/`（purity 闸门锁着分层）。 */
interface SavePort {
  readRawText(): string | null;
  write(save: WorldSave): unknown;
}

/** 数据集里的蓝图 id 是评测化名；真蓝图 id 归设定配置包，代码里只存排序位次。 */
interface EvalBlueprint {
  readonly blueprintRank: number;
  readonly region: string;
}

const EVAL_BLUEPRINTS: Readonly<Record<string, EvalBlueprint>> = {
  workshop_lantern: { blueprintRank: 0, region: 'industry' },
  smithy_lv1: { blueprintRank: 1, region: 'industry' },
  smithy_lv2: { blueprintRank: 2, region: 'industry' },
  grand_foundry_6x6: { blueprintRank: 3, region: 'industry' },
  fish_dock: { blueprintRank: 4, region: 'industry' },
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
  readonly currentSave: () => unknown;
}

interface AuditPackage {
  readonly schemaVersion: number;
  readonly world: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly creatorRules: readonly SpatialRule[];
  readonly fuseState: CreatorAuditState['fuseState'];
  readonly audit: CreatorAuditState & { readonly roadBaseline?: readonly string[] | null };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

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

interface SaveBuilding {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly origin: GridPoint;
  readonly footprint: { readonly w: number; readonly h: number };
  readonly door: GridPoint;
}

export class CreatorDebugBridge {
  private readonly deps: BridgeDeps;
  private audit: CreatorAuditState & { roadBaseline?: readonly string[] | null };
  private readonly fuse: AutonomousFuseController;
  private readonly synthesizer = new RuleSynthesizer();
  /** spec：下次落位前在网格里种一块真实障碍。 */
  private obstaclePending = false;
  /** spec：落位前的道路基线，用来从存档差集取生产真实铺出的路。 */
  private roadBaseline: readonly string[] | null = null;

  constructor(deps: BridgeDeps) {
    this.deps = deps;
    this.audit = emptyAuditState(deps.seed);
    this.fuse = new AutonomousFuseController(() => this.deps.sim.snapshot().now);
    this.fuse.initRole(FUSE_ROLE, '布局与建筑', AutonomyLevel.L2, AutonomyLevel.L2);
    // 每个页面加载都是干净评测会话。显式 reloadFromBytes 是唯一能在页面内恢复的路（H3）。
    deps.storage.removeItem(AUDIT_STORAGE_KEY);
    this.persist();
  }

  dispatchCreatorCommand(raw: Record<string, unknown>): CreatorCommandOutcome {
    switch (String(raw['kind'] ?? '')) {
      case 'PlaceBuilding': return this.place(raw);
      case 'UpgradeBuilding': return this.upgrade(raw);
      case 'ApplyHumanDiff': return this.applyHumanDiff(raw);
      case 'InjectViolations': return this.injectViolations(raw);
      case 'InjectRegression': return this.injectRegression(raw);
      case 'FillZone':
        this.audit.filledRegions.push(String(raw['region'] ?? ''));
        this.persist();
        return {};
      case 'PlantObstacleAtDoor':
        this.obstaclePending = true;
        this.persist();
        return {};
      case 'SetTide': return this.setTide(raw);
      default: return { rejected: true, code: 'UNKNOWN_DEBUG_COMMAND' };
    }
  }

  /** 固定步长推进生产世界。`sim.update()` 是唯一的时钟来源，桥不另立施工倒计时。 */
  stepTicks(count: number): void {
    const times = Math.max(0, Math.min(5000, Math.floor(Number(count) || 0)));
    for (let i = 0; i < times; i += 1) {
      this.deps.sim.update(EVAL_STEP_MS);
      this.audit.nowTick += 1;
    }
    this.captureRoadPlan();
    this.persist();
  }

  /** 真写盘 → 读原始存档字节 → 与会话状态打成一个包。world/meta 是存档原文。 */
  exportSaveBytes(): string {
    try {
      this.deps.saveStore.write(this.deps.currentSave() as WorldSave);
    } catch {
      // 存储不可用时 readRawText 返回 null，下面退回当前世界的存档投影；
      // 少一层「真落盘」证据，但不伪造字段。
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
      audit: { ...this.audit, roadBaseline: this.roadBaseline },
    };
    const text = stableStringify(pkg);
    this.deps.storage.setItem(AUDIT_STORAGE_KEY, text);
    return text;
  }

  /** 只读传入的字节：所有世界真值都从 pkg.world 取，不偷看当前内存态。 */
  inspectSaveBytes(bytes: string): Record<string, unknown> {
    const pkg = JSON.parse(bytes) as AuditPackage;
    const audit = pkg.audit;
    const world = pkg.world;
    const buildings = (Array.isArray(world['buildings']) ? world['buildings'] : []) as SaveBuilding[];
    const roads = (Array.isArray(world['roads']) ? world['roads'] : []) as GridPoint[];
    const constructions = (Array.isArray(world['constructions']) ? world['constructions'] : []) as {
      readonly buildingId: string; readonly remainingMs: number;
    }[];
    const now = typeof world['now'] === 'number' ? world['now'] : 0;
    const altar = this.deps.sim.snapshot().altar;

    const scoped = buildings.filter((b) => audit.placedInstanceIds.includes(b.instanceId));
    const active = new Set(
      constructions.filter((c) => c.remainingMs > 0).map((c) => c.buildingId),
    );

    const projected = scoped.map((b) => {
      const scaffolding = active.has(b.instanceId);
      return {
        instanceId: b.instanceId,
        // spec：M4 的原位升级生产里不存在，只投影规格期望。
        prefabId: audit.upgradedPrefabIds[b.instanceId] ?? b.prefabId,
        origin: b.origin,
        footprint: b.footprint,
        stage: scaffolding ? 'scaffolding' : 'completed',
        smokeActive: scaffolding,
        doorConnected: doorReaches(this.deps.grid, b.door, altar),
      };
    });

    // 编年史不另记：从「在施工中 / 已落成」这两个生产状态投影出来。
    const chronicle = scoped.flatMap((b) => {
      const events = [{ tick: audit.nowTick, kind: 'building.scaffolding_started', buildingId: b.instanceId }];
      if (!active.has(b.instanceId)) {
        events.push({ tick: audit.nowTick, kind: 'building.completed', buildingId: b.instanceId });
      }
      return events;
    });

    const submerged = this.submergedTiles(audit.tideLevel);
    const metrics = metricsOf(
      buildings,
      scoped.map((b) => doorReaches(this.deps.grid, b.door, altar)),
      submerged,
    );

    return {
      now,
      buildings: projected,
      roads: roads.map((p) => ({ x: p.x, y: p.y })),
      chronicle,
      metrics,
      blockedTiles: audit.blockedTiles,
      lastRoadPlan: audit.lastRoadPlan,
      creatorRules: audit.creatorRules,
      fuseState: audit.fuseState,
      schemaVersion: pkg.schemaVersion,
    };
  }

  reloadFromBytes(bytes: string): void {
    const pkg = JSON.parse(bytes) as AuditPackage;
    this.audit = { ...pkg.audit };
    this.roadBaseline = pkg.audit.roadBaseline ?? null;
    this.persist();
  }

  stateHash(): string {
    return hash32(stableStringify(this.audit));
  }

  gridSnapshot(): string {
    const raw = this.deps.saveStore.readRawText();
    const world = raw === null ? {} : (JSON.parse(raw) as { world?: Record<string, unknown> }).world ?? {};
    const buildings = (Array.isArray(world['buildings']) ? world['buildings'] : []) as SaveBuilding[];
    return stableStringify({
      occupied: buildings
        .flatMap((b) => {
          const cells: string[] = [];
          for (let y = b.origin.y; y < b.origin.y + b.footprint.h; y += 1) {
            for (let x = b.origin.x; x < b.origin.x + b.footprint.w; x += 1) {
              cells.push(`${x},${y}:${b.prefabId}`);
            }
          }
          return cells;
        })
        .sort(),
      roads: ((Array.isArray(world['roads']) ? world['roads'] : []) as GridPoint[])
        .map((p) => pointKey(p)).sort(),
    });
  }

  // ========== 动作 ==========

  private place(raw: Record<string, unknown>): CreatorCommandOutcome {
    const prefabId = String(raw['prefabId'] ?? 'workshop_lantern');
    const blueprint = EVAL_BLUEPRINTS[prefabId];
    if (!blueprint) return { rejected: true, code: 'UNKNOWN_PREFAB' };

    const region = raw['region'] === undefined ? blueprint.region : String(raw['region']);
    // spec（H1）：满载旗子。它只在报告里作规格用例，不冒充生产空间约束。
    if (this.audit.filledRegions.includes(region)) {
      return { rejected: true, code: 'REGION_FULL' };
    }
    const explicitAt = raw['origin'] as GridPoint | undefined;
    if (explicitAt && this.forbiddenAt(explicitAt)) {
      return { rejected: true, code: 'SPATIAL_CONSTRAINT' };
    }

    if (this.obstaclePending) {
      this.plantObstacle();
      this.obstaclePending = false;
    }

    // 生产 `Simulation.build` 会拒「同模板已有一栋」；按 id 排序挑一张还没用过的真蓝图。
    const existing = new Set(this.deps.sim.snapshot().buildings.map((b) => b.prefabId));
    const sorted = [...this.deps.blueprints.values()].sort((a, b) => a.id.localeCompare(b.id));
    const mapped = sorted[blueprint.blueprintRank];
    const real = mapped && !existing.has(mapped.id)
      ? mapped
      : sorted.find((candidate) => !existing.has(candidate.id));
    if (!real) return { rejected: true, code: 'NO_AVAILABLE_BLUEPRINT' };

    this.roadBaseline = this.deps.sim.snapshot().roads.map(pointKey);
    const instanceId = `creator-${this.audit.seed}-${this.audit.nextInstance}`;
    this.audit.nextInstance += 1;
    this.audit.placedInstanceIds.push(instanceId);
    this.audit.lastRoadPlan = null;

    // 唯一的写世界入口：与玩家手动造物、神谕共用。
    this.deps.sim.enqueue({ kind: 'build', prefabId: real.id, instanceId });
    // update(0) 只结算队列、不推进世界时钟（场景的钉钟分支也这么用）。
    // 这样 placedRegion 能来自生产网格的真实分区，而不是把 input.region 原样回显——
    // 回显会让 M1 的「落在目标分区」变成一句永远为真的空话。
    this.deps.sim.update(0);
    const placed = this.deps.sim.snapshot().buildings.find((b) => b.instanceId === instanceId);
    const zone = placed === undefined ? '' : this.deps.grid.zoneOf(placed.origin);
    this.persist();
    return {
      rejected: false,
      instanceId,
      placedRegion: zone === 'industry' ? 'industrial' : zone || region,
    };
  }

  /** spec（M4）：生产没有原位升级，只记规格期望；坐标与道路都来自存档，天然不变。 */
  private upgrade(raw: Record<string, unknown>): CreatorCommandOutcome {
    const toPrefabId = String(raw['toPrefabId'] ?? '');
    const targetId = String(raw['targetId'] ?? this.audit.placedInstanceIds[0] ?? '');
    if (!EVAL_BLUEPRINTS[toPrefabId]) return { rejected: true, code: 'UNKNOWN_PREFAB' };
    if (!this.audit.placedInstanceIds.includes(targetId)) {
      return { rejected: true, code: 'TARGET_NOT_FOUND' };
    }
    this.audit.upgradedPrefabIds[targetId] = toPrefabId;
    this.persist();
    return { rejected: false, instanceId: targetId };
  }

  private applyHumanDiff(raw: Record<string, unknown>): CreatorCommandOutcome {
    const proposal = raw['agentProposal'] as Record<string, unknown> | undefined;
    const outcome = raw['userOutcome'] as Record<string, unknown> | undefined;
    if (!proposal || !outcome) return { rejected: true, code: 'MALFORMED_DIFF' };
    const toCommand = (v: Record<string, unknown>): GenesisCommand => ({
      kind: 'PlaceBuilding',
      id: String(v['id'] ?? 'cmd_1'),
      templateId: String(v['prefabId'] ?? 'workshop_lantern'),
      at: (v['origin'] as GridPoint) ?? { x: 0, y: 0 },
    });
    const diff = buildStructuredDiff(toCommand(proposal), toCommand(outcome));
    const altar = this.deps.sim.snapshot().altar;
    const result = this.synthesizer.synthesizeFromDiff(diff, {
      nearbyLandmarks: () => [{ id: 'altar', at: altar }],
    });
    const spatial = result.patches.find((p) => p.type === 'spatial_constraint');
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
    return { rejected: false, patch: { kind: 'SpatialConstraint', isSelfJustifying: true } };
  }

  private injectViolations(raw: Record<string, unknown>): CreatorCommandOutcome {
    const count = Math.max(1, Math.floor(Number(raw['count'] ?? 3)));
    for (let i = 0; i < count; i += 1) {
      this.fuse.recordCommandResult(FUSE_ROLE, {
        schemaPassed: false, invariantViolated: true, hasCollision: true,
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
      isFused: state?.isFused ?? false, fromLevel, toLevel, lastEvent,
    };
    this.persist();
  }

  // ========== 评测夹具 ==========

  private forbiddenAt(point: GridPoint): boolean {
    return this.audit.creatorRules.some(
      (r) => r.forbiddenAt.x === point.x && r.forbiddenAt.y === point.y,
    );
  }

  /** 潮位高时哪些格算被淹：边界两圈 + 生产 `grid.levelAt` 的低地。 */
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

  /** spec（H2）：往**生产网格**里种一块真障碍，逼 `findBestSlot` 与 `grid.path` 绕开。
   *  不是桥的私有地图——`WorldGrid.place()` 是生产 API。 */
  private plantObstacle(): void {
    const grid = this.deps.grid;
    const altar = this.deps.sim.snapshot().altar;
    for (let y = 1; y < grid.height - 1 && this.audit.blockedTiles.length === 0; y += 1) {
      for (let x = 1; x < grid.width - 1; x += 1) {
        const origin = { x, y };
        if (!grid.canPlace(origin, 1, 1, 0)) continue;
        const id = `eval-obstacle-${this.audit.seed}-${x}-${y}`;
        // door 指向远处的祭坛：place() 会把 door 那格设回可走，不能指向障碍自己。
        if (!grid.place({ instanceId: id, origin, w: 1, h: 1, door: altar })) continue;
        this.audit.blockedTiles.push(pointKey(origin));
        return;
      }
    }
  }

  /** 生产铺出的路 = 存档 roads 相对落位前基线的增量。不再自己跑 BFS 造路径。 */
  private captureRoadPlan(): void {
    if (this.roadBaseline === null) return;
    const before = new Set(this.roadBaseline);
    const after = this.deps.sim.snapshot().roads.map(pointKey);
    const path = after.filter((key) => !before.has(key));
    const altar = this.deps.sim.snapshot().altar;
    const last = this.audit.placedInstanceIds.at(-1);
    const building = this.deps.sim.snapshot().buildings.find((b) => b.instanceId === last);
    const straight = building
      ? Math.abs(building.door.x - altar.x) + Math.abs(building.door.y - altar.y)
      : 0;
    this.audit.lastRoadPlan = {
      blocked: [...this.audit.blockedTiles],
      path,
      pathLength: path.length,
      straightDistance: straight,
    };
    this.roadBaseline = null;
  }

  private persist(): void {
    // 只写审计侧车；存档槽由 SaveStore 独占。
    this.deps.storage.setItem(
      AUDIT_STORAGE_KEY,
      stableStringify({ audit: this.audit, roadBaseline: this.roadBaseline }),
    );
  }
}
