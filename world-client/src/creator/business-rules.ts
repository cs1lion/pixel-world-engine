/** 落地之后的业务规则检查：把真实世界投影成 `WorldStateView`，交给既有检查器。
 *
 * 这条检查是**事后**的：楼已经进了 `Simulation` 的账本、网格已经占格、事件已经回写。
 * 落位前不跑，也不拿 `checkPlacement` 的预检结论冒充——预检只看「能不能放」，
 * 这里问的是「放下去之后，这张图上成不成立」。
 *
 * 数据来源只有两处：`Simulation.snapshot()`（楼、摆件）与 `WorldGrid`（可走性）。
 * 不另建世界副本；`getOccupiedCells` 是**别的楼**的占地投影，自己会被排除，
 * 否则每一栋新楼都会把自己算成冲突。
 */

import type { WorldGrid } from '../world/grid.ts';
import type { GridPoint, PrefabBlueprint, WorldSnapshot } from '../world/types.ts';
import { doorReaches } from '../world/setup.ts';
import {
  runBusinessRulesCheck,
  type GenesisCommandBatch,
  type PlaceBuildingCommand,
  type WorldStateView,
} from '../world/creator/schema.ts';
import type { LandedCreation } from './landing.ts';

/** 检查器需要的最小世界面：快照 + 网格 + 镇心 + 当前设定集的模板表。 */
export interface BusinessWorld {
  readonly snapshot: WorldSnapshot;
  readonly grid: WorldGrid;
  readonly altar: GridPoint;
  readonly blueprints: ReadonlyMap<string, PrefabBlueprint>;
}

export interface LandedCheckResult {
  readonly passed: boolean;
  /** 空间类违规：占地与他楼重叠、原点被占等。 */
  readonly hasConflict: boolean;
  /** 不变式违规：越界、门在占地内、盖住镇心/摆件、门连不出去。 */
  readonly invariantViolated: boolean;
  readonly violations: readonly string[];
}

/** 两类违规的稳定前缀：调用方按前缀分类，不去猜自然语言。 */
export const CONFLICT_PREFIX = '空间：';
export const INVARIANT_PREFIX = '不变式：';

/**
 * 要素覆盖率 = **已落地模板数 / 设定集模板总数**。
 *
 * 按 `prefabId` 去重：同一种铺子建第二栋不会把覆盖率抬高。分母是设定集里
 * 允许的全部模板（`blueprints.size`），不是「打算建几栋」——没有那样一份清单。
 *
 * 每次造物结算时都用**当时的** `Simulation.snapshot()` 现算，不缓存、不沿用
 * 上一个窗口的读数。这样「同一模板拆掉再建」也会产生一次新观测：覆盖率仍是
 * 10/10 = 1.0，但 `coverageChecks` +1，这个事实是新的。
 *
 * 分母为 0 时返回 `null`，与账本侧的 `coverageAfterBuild()` 保持同一口径：
 * 「没测」不是「测了得 0 分」。调用方必须把 `null` 记成 `not_measured`，
 * 不能拿 `?? 0` 或真假判断把它压成一次不达标。
 */
export function creationCoverage(
  snapshot: Pick<WorldSnapshot, 'buildings'>,
  blueprints: ReadonlyMap<string, PrefabBlueprint>,
): number | null {
  const total = blueprints.size;
  if (total === 0) return null;
  const seen = new Set<string>();
  for (const building of snapshot.buildings) {
    if (blueprints.has(building.prefabId)) seen.add(building.prefabId);
  }
  return Math.min(1, seen.size / total);
}

/**
 * 对一个**已经落地**的造物跑第二重门禁。
 *
 * 返回 `hasConflict` / `invariantViolated` 两个布尔，供 `submitHumanApproval`
 * 当真实观测记进计数器；同时保留原始违规文案，便于日志与测试。
 */
export async function checkLandedBuilding(
  world: BusinessWorld,
  landed: LandedCreation,
): Promise<LandedCheckResult> {
  const command: PlaceBuildingCommand = {
    kind: 'PlaceBuilding',
    templateId: landed.prefabId,
    at: landed.origin,
  };
  const batch: GenesisCommandBatch = { version: 1, commands: [command] };

  const result = await runBusinessRulesCheck(batch, createWorldStateView(world, landed));

  let hasConflict = false;
  let invariantViolated = false;
  for (const violation of result.violations) {
    if (violation.message.startsWith(INVARIANT_PREFIX)) invariantViolated = true;
    else hasConflict = true;
  }

  return {
    passed: result.passed,
    hasConflict,
    invariantViolated,
    violations: result.violations.map((violation) => violation.message),
  };
}

/**
 * 把快照与网格折成一个 `WorldStateView`。
 *
 * `landed.instanceId` 会从「已占用」里排除：它自己刚占的格不算与别人冲突。
 * 剩下的占用来自**快照里的其它楼**——这比 `grid` 逐格问更合适，因为冲突的判据是
 * 「两栋楼的几何是否相交」，不是「这一格此刻归谁」。
 */
export function createWorldStateView(
  world: BusinessWorld,
  landed: LandedCreation,
): WorldStateView {
  const self = landed.instanceId;
  const otherCells = new Set<string>();
  for (const building of world.snapshot.buildings) {
    if (building.instanceId === self) continue;
    for (const cell of footprintOf(building.origin, building.footprint)) {
      otherCells.add(cellKey(cell));
    }
  }

  return {
    getOccupiedCells: () => otherCells,

    checkSpatialConstraints: async (command) => {
      const blueprint = world.blueprints.get(command.templateId);
      if (blueprint === undefined) {
        return `${CONFLICT_PREFIX}未知模板 "${command.templateId}"`;
      }
      for (const cell of footprintOf(command.at, blueprint.footprint)) {
        if (otherCells.has(cellKey(cell))) {
          return `${CONFLICT_PREFIX}占地与既有建筑重叠于 (${cell.x},${cell.y})`;
        }
      }
      return null;
    },

    checkInvariants: async (command) => {
      if (command.kind !== 'PlaceBuilding') return null;
      const blueprint = world.blueprints.get(command.templateId);
      if (blueprint === undefined) return `${INVARIANT_PREFIX}未知模板 "${command.templateId}"`;

      const { w, h } = blueprint.footprint;
      const origin = command.at;

      // 1. 占地必须完整落在世界里。
      if (
        origin.x < 0 ||
        origin.y < 0 ||
        origin.x + w > world.grid.width ||
        origin.y + h > world.grid.height
      ) {
        return `${INVARIANT_PREFIX}占地越界：(${origin.x},${origin.y}) 的 ${w}×${h} 超出世界`;
      }

      // 2. 门口必须在占地外，否则人从楼里出不来。
      const door = { x: origin.x + blueprint.door.x, y: origin.y + blueprint.door.y };
      if (inFootprint(door, origin, w, h)) {
        return `${INVARIANT_PREFIX}门口落在占地内：(${door.x},${door.y})`;
      }

      // 3. 占地不得覆盖镇心。
      if (inFootprint(world.altar, origin, w, h)) {
        return `${INVARIANT_PREFIX}占地覆盖了镇心：(${world.altar.x},${world.altar.y})`;
      }

      // 4. 占地不得覆盖既有摆件（灯、树、幌布）。摆件不占格，所以落位检查拦不住它。
      const covered = world.snapshot.props.find((prop) => inFootprint(prop.at, origin, w, h));
      if (covered !== undefined) {
        return `${INVARIANT_PREFIX}占地覆盖了既有摆件 "${covered.id}"：(${covered.at.x},${covered.at.y})`;
      }

      // 5. 门口必须真的连得到镇心。用落地后的网格，楼已经占格。
      if (!doorReaches(world.grid, door, world.altar)) {
        return `${INVARIANT_PREFIX}门口到不了镇心：(${door.x},${door.y})`;
      }

      return null;
    },
  };
}

function footprintOf(origin: GridPoint, size: { readonly w: number; readonly h: number }): GridPoint[] {
  const cells: GridPoint[] = [];
  for (let y = origin.y; y < origin.y + size.h; y += 1) {
    for (let x = origin.x; x < origin.x + size.w; x += 1) cells.push({ x, y });
  }
  return cells;
}

function inFootprint(p: GridPoint, origin: GridPoint, w: number, h: number): boolean {
  return p.x >= origin.x && p.y >= origin.y && p.x < origin.x + w && p.y < origin.y + h;
}

function cellKey(p: GridPoint): string {
  return `${p.x},${p.y}`;
}
