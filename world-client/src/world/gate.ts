/** 渡有仪式的判定（SPEC_V2 §4.6）。
 *
 * 区域声明 `requires`，角色带着 `carries`，两边是**同一套闭集词**：
 * 对不上就是过不去。判定放成纯函数而不是塞进 `WorldGrid` 或 `Simulation`，
 * 是因为它同时被寻路、被设定集校验、被纸面状态行读——三处各写一遍
 * 「她有没有灯」，迟早有一处漏掉 `'shoes'`。
 */

import type { CarryItem, GridPoint } from './types.ts';

/** 这道门要什么。`null` 表示没要，谁都能过。 */
export type RegionRequirement = CarryItem | null;

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
