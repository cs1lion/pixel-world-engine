/** 渡有仪式的判定（SPEC_V2 §4.6）。
 *
 * 区域声明 `requires`，角色带着 `carries`，两边是**同一套闭集词**：
 * 对不上就是过不去。
 *
 * 判定放成纯函数而不是塞进 `WorldGrid` 或 `Simulation`，是因为「她带的东西」
 * 和「门要的东西」各归一边，合成一个方法就会在某个只想知道「这门要什么」的
 * 调用点上顺手把她的兜也翻出来。现在寻路只向 `gateFilter` 要一个过滤器，
 * 设定集校验只向 `isCarryItem` 问一个词——谁都不用认识另一个半。
 */

import type { CarryItem, GridPoint, RegionRequirement } from './types.ts';

/**
 * 渡有仪式认得的凭证（SPEC_V2 §4.6）。
 *
 * 闭集：区域声明的 `requires` 与角色带着的 `carries` 必须是同一套词，
 * 否则「她明明带着灯，那道门就是不认」这种只有截图才看得见的 bug 会出现。
 *
 * 住在 `gate.ts` 而不是和 `save.ts` 里那十几个枚举常量做邻居：它是**这道门**
 * 的词汇表，设定集校验（`settings/load.ts`）、存档校验、`setCarries`
 * 与 `intent-schema.ts` 四处都向它问话。
 *
 * 这里原来写「那十个枚举常量」「三处都向它问话」——两个数都小了。
 * `save.ts` 里 `export const [A-Z_]*: readonly` 有 13 个，另有三个私有的
 * （`SETTLED_SOURCES` / `SETTLED_CLOCKS` / `PENDING_SOURCES`），共 16。
 * 问话的第四处是 `src/world/intent-schema.ts`。数不在意对错，这里在意的是
 * 那句话想表达的分工（词汇表归门，存档只是问话的一方）——那个分工没错。
 */
export const CARRY_ITEMS: readonly CarryItem[] = ['lamp', 'shoes'];

/** 这个世界上认不认这个东西当凭证。设定集与命令入口共用一句判定。 */
export function isCarryItem(value: string): value is CarryItem {
  return (CARRY_ITEMS as readonly string[]).includes(value);
}

/**
 * 她带着的这些东西，过不过得了要 `requires` 的门。
 *
 * 空数组是「两手空空」，不是「未知」：未知该由调用方在把 `carries`
 * 交进来之前就判完，这里不做宽松解释。
 */
export function gateSatisfied(
  requires: RegionRequirement,
  carries: readonly CarryItem[],
): boolean {
  if (requires === null) return true;
  return carries.includes(requires);
}

/**
 * 按她带着的东西造一个寻路过滤器。
 *
 * `requirementAt` 由 `WorldGrid` 给（它才知道哪一格属于哪个区域）；
 * 这里只负责把「她要什么」和「她有什么」对上。返回 `false` 的格子，
 * A* 当作不可走——于是路线自己绕开，而不是穿过去之后被发现。
 */
export function gateFilter(
  carries: readonly CarryItem[],
  requirementAt: (p: GridPoint) => RegionRequirement,
): (p: GridPoint) => boolean {
  return (p) => gateSatisfied(requirementAt(p), carries);
}
