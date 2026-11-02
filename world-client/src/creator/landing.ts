/** 造物**落地之后**才成立的观测：门到镇心的可达性，以及回放一致性。
 *
 * 两项都不能在落位前算：
 *
 * - **可达性**：`checkPlacement` 只看门口那一格空不空，不看它连不连得出去。
 *   落位前新楼还没占格，干跑 `doorReaches` 会把「门口贴着楼体、四周被围死」
 *   判成可达——那是乐观误判。必须在 `building.built` 之后，用真实网格判。
 * - **回放一致**：要拿**落地前捕获的输入**重跑一次计划生成，再和「计划内容 +
 *   实际落点」比。落地后再重跑，「已有哪些模板」已经变了，算出来的是另一件事。
 *
 * 所以这个文件只提供「给定真实落地结果」的判定，不提供预检。调用方
 * （`SandboxScene`）在既有的 `building.built` 回调之后调它，不新开一条并行通道。
 */

import { doorReaches } from '../world/setup.ts';
import type { BuiltWorld } from '../world/setup.ts';
import { hash32 } from '../world/memory/seed.ts';
import type { GridPoint, PrefabBlueprint } from '../world/types.ts';
import type { CreationPlan } from '../world/creator-schema.ts';
import type { CreatorWorldView } from './engine.ts';

/** 从 `Simulation` 快照里取出来的、真实落地的结果。 */
export interface LandedCreation {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly origin: GridPoint;
  readonly door: GridPoint;
}

/**
 * 门到镇心是否真的可达。
 *
 * **只在落地之后调。** 楼已经占了格，`doorReaches` 才看得见这栋新墙；
 * 落位前调一定偏乐观。
 */
export function landingReachable(world: BuiltWorld, landed: LandedCreation): boolean {
  return doorReaches(world.grid, landed.door, world.altar);
}

export interface CreationReplayInput {
  /** 实际采用的那份计划。 */
  readonly plan: CreationPlan;
  /** 用落地前捕获的输入重跑出来的计划。 */
  readonly replayed: CreationPlan;
  /** 真实落地的结果（`Simulation` 快照里那一栋）。 */
  readonly landed: LandedCreation;
  /** 计划生成时用的 world_day。 */
  readonly day: number;
  readonly blueprints: ReadonlyMap<string, PrefabBlueprint>;
}

/**
 * 回放一致性：`H(实际计划 + 实际落地)` 与 `H(重跑计划 + 由其推出的落地)` 是否相同。
 *
 * 两边**不能都拿实际落地**——那样篡改落地会同时改两边，结论恒真。所以比较的两侧
 * 是「实际」与「应当」：左侧是真实产物，右侧是从重跑计划按蓝图门口偏移推出来的
 * 期望落地点。计划内容（模板、位置、配色、日期）与落地位置（原点、门口）都在
 * 指纹里，只哈希输入、不哈希落点的写法在这里拿不到 `true`。
 *
 * 返回 `null` 表示跑不了（重跑计划里的模板不在蓝图注册表里，推不出期望落点）。
 * **跑不了不等于通过**——调用方不要把 `null` 记成 `true`。
 */
export function verifyCreationReplay(input: CreationReplayInput): boolean | null {
  const expected = expectedLanding(input.replayed, input.blueprints);
  if (expected === null) return null;
  return (
    creationFingerprint(input.plan, input.landed, input.day)
    === creationFingerprint(input.replayed, expected, input.day)
  );
}

/** 指纹覆盖计划内容 + 落地位置，用世界种子那套 FNV-1a。 */
export function creationFingerprint(
  plan: CreationPlan,
  landed: LandedCreation,
  day: number,
): string {
  const parts = [
    plan.templateId,
    plan.at.x,
    plan.at.y,
    plan.palette.body,
    plan.palette.roof,
    plan.palette.trim,
    plan.palette.window,
    day,
    landed.prefabId,
    landed.origin.x,
    landed.origin.y,
    landed.door.x,
    landed.door.y,
  ];
  return hash32(parts.join('\u0000')).toString(16).padStart(8, '0');
}

/**
 * 把「此刻的落位许可」冻成位图，供回放重跑计划时使用。
 *
 * `CreatorWorldView.canPlace` 通常闭包在**活网格**上：楼一落地，原点那格就
 * 变成占用，重跑时 `checkPlacement` 会跳过它、挑下一个位置——那不是回放，
 * 是新算。冻成位图之后，重跑看到的是「落位前那一份世界」，才可比。
 *
 * 只冻结候选模板（`prefabIds`）：别的模板一律不可落，重跑不会挑到它们。
 * 代价是每个候选一次 O(宽 × 高) 的落位检查，按世界日节奏调用，不进帧循环。
 */
export function freezeCreatorView(
  view: CreatorWorldView,
  prefabIds: readonly string[],
): CreatorWorldView {
  const { width, height } = view;
  const allowed = new Map<string, Uint8Array>();
  for (const prefabId of prefabIds) {
    const bits = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (view.canPlace(prefabId, { x, y })) bits[y * width + x] = 1;
      }
    }
    allowed.set(prefabId, bits);
  }
  return {
    day: view.day,
    builtPrefabIds: new Set(view.builtPrefabIds),
    width,
    height,
    canPlace: (prefabId, at) => {
      const bits = allowed.get(prefabId);
      if (bits === undefined) return false;
      if (at.x < 0 || at.y < 0 || at.x >= width || at.y >= height) return false;
      return bits[at.y * width + at.x] === 1;
    },
  };
}

/** 按蓝图推出来的期望落地：原点就是计划位置，门口 = 原点 + 模板门口偏移。 */
function expectedLanding(
  plan: CreationPlan,
  blueprints: ReadonlyMap<string, PrefabBlueprint>,
): LandedCreation | null {
  const blueprint = blueprints.get(plan.templateId);
  if (blueprint === undefined) return null;
  return {
    // instanceId 里带自增序号，两次运行一定不同——指纹不比较它，这里只做占位。
    instanceId: '',
    prefabId: plan.templateId,
    origin: { x: plan.at.x, y: plan.at.y },
    door: { x: plan.at.x + blueprint.door.x, y: plan.at.y + blueprint.door.y },
  };
}
