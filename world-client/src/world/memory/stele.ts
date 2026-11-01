/** 碑：把传说排成能摆上屏的几行。
 *
 * 这一层是**纯函数**：收一份传说、一个世界日，给回排好序的行。不调模型、
 * 不读别的状态、不碰 DOM——它的输入就是 `MemoryRuntime.legends()` 给的副本。
 *
 * 为什么要排序与截断，而不是原样铺出去：实测（7 居民 9 栋楼，真设定集，
 * 1000ms 拍、8 个世界日）第 4 天关账时**一次立起 15 条**传说（`reach` 7–15）。
 * 收束（`legendImportanceFloor` + 同日同地归并）之前这个数是 22。
 * 15 行全铺出去不是「世界共识」，那是一面流水账——而且面板只有三百来像素宽。
 * 所以这里按 `reach` 降序排，面板只摆前 `STELE_MAX_LINES` 条。
 *
 * **`texts` 原样，不改写。** 与 `voice.ts` 同一条纪律：那几句是世界自己组织
 * 好的讲法（`candidatesFrom` 的 `variants`），改写就是造事实。
 */

import { ageLabel } from './voice.ts';
import { faded } from './legend.ts';
import type { Legend } from './types.ts';

/** 一块碑上的一行。 */
export interface SteleLine {
  readonly legendId: string;
  /** 同一件事的几种讲法，原样，按世界给出的顺序。 */
  readonly texts: readonly string[];
  /** 此刻还有几个人在讲。 */
  readonly reach: number;
  /** 「今天 / 昨天 / N 天前」——立碑距今，与 `voice.ts` 同一个口径。 */
  readonly age: string;
  /** 先立起来的那天。面板据此说「第 N 天立」。 */
  readonly formedDay: number;
  /** `reach <= 1`：已经淡去。淡去不等于删除，碑上留着一行。 */
  readonly faded: boolean;
}

/**
 * 一块碑最多摆几条。
 *
 * 5 不是随手挑的：第 4 天一次立起 15 条是**实测到的真实形态**（收束之后重跑的
 * `.tmp-audit/census-after.txt`；收束之前是 22 条），而 `STELE_MAX_LINES` 是它和
 * 一块能读的碑之间唯一的那道闸。改这个数会直接改屏幕，写测试钉住它。
 */
export const STELE_MAX_LINES = 5;

/**
 * 传说 → 碑上的行。全部返回，不替调用方截断——截断是面板的事，
 * 而测试要能数清总共有几条。
 *
 * 排序：未淡去的在前，再按 `reach` 降序，再按 `formedDay` 降序。
 *
 * 为什么淡去的排后面而不是排掉：淡去是**传说的晚年**，不是它的删除。抹掉它，
 * 「无人讲则淡去」这件事在屏幕上就看不见了；而它排在活着的传说前面，会把
 * 此刻镇上真正在传的事挤下去。
 *
 * `formLegend` 给的 `reach` 是形成时的人数，之后每天 `decayLegend` 掉 1、
 * 有人复述就加；所以它既是「这条传说此刻有多活」也是排序键——不需要另算。
 */
export function steleLines(legends: readonly Legend[], nowDay: number): readonly SteleLine[] {
  return legends
    .map((legend) => ({
      legendId: legend.legendId,
      texts: [...legend.variants],
      reach: legend.reach,
      age: ageLabel(nowDay - legend.formedDay),
      formedDay: legend.formedDay,
      faded: faded(legend),
    }))
    .sort((a, b) => {
      if (a.faded !== b.faded) return a.faded ? 1 : -1;
      if (a.reach !== b.reach) return b.reach - a.reach;
      return b.formedDay - a.formedDay;
    });
}
