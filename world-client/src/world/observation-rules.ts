/** 观察规则注册表：一条世界改变 → 若干条「谁在场、记在哪」。
 *
 * 原先这段逻辑长在 `SandboxScene.remember()` 里：一个手写 `switch`，世界事件、
 * 奇迹、天气、建造拆除各一支，天气那一支还额外贪着「按摊位 6 格分组」。
 * 场景于是同时要知道两件事：世界改了什么，以及记忆层怎么翻译它。加一种改变
 * 就得回去改场景，而场景是渲染层的文件——改错一处，屏上看不出来，只表现为
 * 「这件事她怎么不记得」。
 *
 * 现在拆成一张表：**键是变化类型，值是「变化 + 上下文 → 观察记录或空」**。
 * 场景只做三件事：把时刻、事件 id、查询器递进来，然后照 `observationsFor`
 * 的结果逐条 `observe`。新增一种改变只改本文件（和 `observe.ts` 的翻译），
 * 不必动 Scene。
 *
 * 这张表**不判行为**：`observationOf` 仍然负责「这件事该不该进记忆」，
 * 这里只决定「拆成几条、每条记在哪个锚点、递什么目击者」。拆法必须与拆分前
 * 逐字相同——记忆指纹是判据。
 */

import type { GridPoint } from './types.ts';
import type { WorldChange } from './world-changes.ts';
import { observationOf, type ObservationLookups } from './memory/observe.ts';
import type { RuntimeObservation } from './memory/runtime.ts';
import type { LandmarkEvent } from './memory/landmark.ts';
import { weatherWitnessGroups, type WeatherPerson } from './weather-witness.ts';

/**
 * 规则能问的东西。全部由调用方（场景）现给：
 * 场景知道人在哪、楼在哪、码头在哪，记忆层只收翻译好的结果。
 */
export interface ObservationContext {
  readonly lookups: ObservationLookups;
  /** 本条改变的基础事件 id（`mem_N`）。分组的第一条复用它。 */
  readonly eventId: string;
  /** 额外的分组要用一个新的 id——**只有真的要用时才调用**，否则序号会空耗。 */
  readonly nextEventId: () => string;
  /** 灯街的摊位格子。空数组 = 没有灯街（纯逻辑测试与无摊位的镇子）。 */
  readonly stallsAt: readonly GridPoint[];
  /**
   * 此刻在街上的人。**惰性求值**：只有天气规则会真的问，别在每条改变上都
   * 遍历一遍村民。
   */
  readonly peopleOf: () => readonly WeatherPerson[];
  /** 楼的落成/拆除带一份地标输入；别的改变返回 `undefined`。 */
  readonly landmarkOf: (change: WorldChange) => LandmarkEvent | undefined;
  /** 这条改变有没有更窄的目击者名单（目前只有船班播报）。`undefined` = 按通用感知算。 */
  readonly witnessesOf: (change: WorldChange) => readonly string[] | undefined;
}

/** 一条待落账的观察。`witnesses === undefined` 表示按通用感知模型算。 */
export interface PendingObservation {
  readonly observation: RuntimeObservation;
  readonly witnesses: readonly string[] | undefined;
}

export type ObservationRule = (
  change: WorldChange,
  ctx: ObservationContext,
) => readonly PendingObservation[];

/**
 * 默认规则：一对一。
 *
 * `observationOf` 返回 `null` 就什么都不记（潮位、心电图、传说）；否则带上
 * 地标输入与场景给的目击者名单，原样交回去。
 */
const defaultRule: ObservationRule = (change, ctx) => {
  const observation = observationOf(change, ctx.eventId, ctx.lookups);
  if (observation === null) return [];
  const landmark = ctx.landmarkOf(change);
  return [{
    observation: landmark === undefined ? observation : { ...observation, landmark },
    witnesses: ctx.witnessesOf(change),
  }];
};

/**
 * 天气：一条改变拆成至多「摊位组数」条。
 *
 * 天气不是广播：只记灯街上 6 格内、还没进屋的人。按最近的摊子分组，一组一条，
 * 同一个人只入一次账（`weatherWitnessGroups` 保证）。
 *
 * **序号消耗顺序必须与拆分前一致**：基础 id 已由调用方消耗；第一条复用基础
 * 观察，之后**每多一组**才多消耗一个 id。空分组一条不落，也不消耗 id。
 * 没有摊位就整条退回默认路径（不进记忆分组，也不看地标）。
 */
const weatherRule: ObservationRule = (change, ctx) => {
  const observation = observationOf(change, ctx.eventId, ctx.lookups);
  if (observation === null) return [];
  if (ctx.stallsAt.length === 0) {
    return [{ observation, witnesses: undefined }];
  }
  const pending: PendingObservation[] = [];
  const groups = weatherWitnessGroups(ctx.peopleOf(), ctx.stallsAt);
  for (const [index, group] of groups.entries()) {
    const item = index === 0
      ? observation
      : observationOf(change, ctx.nextEventId(), ctx.lookups, group.at);
    if (item === null) continue;
    pending.push({ observation: { ...item, at: group.at }, witnesses: group.witnesses });
  }
  return pending;
};

/**
 * 注册表。键是 `WorldChange['change']` 的闭集——漏一个键，TypeScript 当场报。
 *
 * 目前只有天气有自己的规则；其余都走默认的一对一。`tide` / `world.vitals` /
 * `legend` 也登记在这儿而不是省掉：它们的「不记」由 `observationOf` 判，
 * 不在分派层再判一次——两份「该不该记」迟早分叉。
 */
export const OBSERVATION_RULES: Readonly<Record<WorldChange['change'], ObservationRule>> = {
  'task.delivered': defaultRule,
  'building.built': defaultRule,
  'building.removed': defaultRule,
  'miracle': defaultRule,
  weather: weatherRule,
  tide: defaultRule,
  'world.event': defaultRule,
  'world.vitals': defaultRule,
  legend: defaultRule,
};

/**
 * 查表并执行。**一次改变只命中一条规则**（`rules[change.change]`），不会
 * 先按这再按那地叠加。找不到就退回默认规则：新类型忘了登记时不至于静默丢
 * 事件，也不会落成两条。
 */
export function observationsFor(
  change: WorldChange,
  ctx: ObservationContext,
  rules: Readonly<Record<string, ObservationRule>> = OBSERVATION_RULES,
): readonly PendingObservation[] {
  const rule = rules[change.change] ?? defaultRule;
  return rule(change, ctx);
}
