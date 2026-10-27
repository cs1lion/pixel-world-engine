/** 去哪栋铺子干活：镇内还是郊野。
 *
 * 这条规则是「空间映射能力」的落点：
 *   - **事件流派来的活**是本地确定性工作（改文件、跑脚本、整理），该在镇内做；
 *   - **神谕派的长活**是探索性的（查资料、爬取、长文档），去郊野。
 *
 * 为什么不按活类型硬分：同一个 `research` 既可能是上游事件流里的一条活，
 * 也可能是你对世界说的一句话。区别在**谁派的**，不在做什么。
 *
 * 纯函数，不碰网格也不碰渲染。
 */

import type { TaskKind } from './types.ts';

/** 谁派的活。`sandbox` 与 `oracle` 都算「你派的」，走探索侧。 */
export type VenueSource = 'feed' | 'oracle';

export interface VenueCandidate {
  readonly instanceId: string;
  /** null 表示这栋楼不接活。 */
  readonly boundTask: TaskKind | null;
  /** 是否在郊野（核心镇与工坊环之外）。 */
  readonly isWild: boolean;
  /** 铺子已被占、在施工、或故障中。 */
  readonly busy: boolean;
}

/**
 * 挑不到铺子的三种原因。
 *
 * 分开是因为这三句话对用户是**不同的真话**，混成一句就是在撒谎：
 *
 *   - `none`：这座镇子没有任何一栋楼接这类活。说「没有空闲的」是假的——
 *     它暗示有、只是忙。灯潮界六栋楼 `boundTask` 全是 null，正是这一种。
 *   - `busy`：镇内有接这类活的楼，但此刻都腾不出手。
 *   - `wild`：接这类活的楼**全在郊野**，而上游的活不去郊野。这一种曾并进
 *     `busy`，于是调用方说「没有空闲的镇内铺子」——那句话断言了镇内有、
 *     只是忙，而镇内可能一栋都没有。`demolish` 能把镇子拆到那一步，
 *     且没有覆盖校验兜底（`demolish.test.ts` 明说「世界允许把镇子拆空」）。
 */
export type VenueMiss = 'none' | 'busy' | 'wild';

/** 挑铺子的结果。挑不到时连原因一起回，好让调用方说一句真话。 */
export type VenuePick =
  | { readonly ok: true; readonly venue: VenueCandidate }
  | { readonly ok: false; readonly reason: VenueMiss };

/**
 * 挑一栋铺子。
 *
 * 规则：
 *   - 事件流来的活只认镇内；镇内腾不出手就带一个原因回来，让它排队，而不是塞给郊野；
 *   - 你派的活优先郊野，郊野忙再退回镇内；
 *   - 同类多个候选按传入顺序取第一个可用的，保证确定性。
 */
export function pickVenue(
  candidates: readonly VenueCandidate[],
  kind: TaskKind,
  source: VenueSource,
): VenuePick {
  // 先问「这座镇子到底有没有接这类活的楼」——这个问题与忙不忙无关，
  // 所以要在过滤掉 busy 之前问。问晚了就分不出「没有」与「都闲着」。
  const takes = candidates.filter((item) => item.boundTask === kind);
  if (takes.length === 0) return { ok: false, reason: 'none' };

  // 上游的活只去镇内。这个限制同样与忙不忙无关，所以也要在过滤 busy 之前问：
  // 问晚了，「镇内一栋接这类活的楼都没有」会被并进「都忙着」，
  // 而「没有空闲的镇内铺子」那句话也就成了假的。
  if (source === 'feed' && !takes.some((item) => !item.isWild)) {
    return { ok: false, reason: 'wild' };
  }

  const matching = takes.filter((item) => !item.busy);
  if (matching.length === 0) return { ok: false, reason: 'busy' };

  if (source === 'feed') {
    const town = matching.find((item) => !item.isWild);
    return town === undefined ? { ok: false, reason: 'busy' } : { ok: true, venue: town };
  }
  const wild = matching.find((item) => item.isWild);
  return { ok: true, venue: wild ?? matching[0]! };
}
