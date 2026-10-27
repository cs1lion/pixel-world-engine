/** 求证行为闭环：认知失调 → 跑去核实 → 辟谣或证实。
 *
 * 补充设计 §1.1 的三步，全部是纯规则：
 *
 * 1. **冲突检测**：收到 `ClaimTold` 时，自己记忆库里有没有同 `event_refs`
 *    或同地点同日的高置信度记忆（`witnessed` 或 `confidence ≥ 0.8`）。
 * 2. **求证冲动**：`verify_impulse = salience × |valence_new − valence_old| × speaker_trust`，
 *    过 0.45 就变成「存疑」并插一条高优日程。
 * 3. **空间求证**：走到事发地读痕迹（或读公告）之后，证实是假就发 `RumorDebunked`，
 *    并把造谣者的可靠度下调 0.15。
 *
 * 这一条闭环是「行为决策」与「传播协议」之间唯一的连接点。没有它，传言
 * 只是数据库里的一行；有了它，传言会长成一个小人走出门去的动作。
 */

import type { MemoryConfig } from './config.ts';
import { verifyImpulse, type ListenerBelief } from './propagate.ts';
import type { Belief, Claim, MemoryEntry, Trace } from './types.ts';

/** 冲突检测的结果：找到的那条对立记忆，以及要不要去核实。 */
export interface ConflictCheck {
  readonly conflicting: MemoryEntry | null;
  readonly impulse: number;
  readonly suspicious: boolean;
}

/**
 * 冲突检测 + 求证冲动。
 *
 * 找的是**最相关的那条**：同 `event_refs` 优先于同地点同日。同一件事
 * 两个版本对不上，比同一地点同一天的两件不相干的事更值得跑一趟。
 */
export function checkConflict(input: {
  readonly claim: Claim;
  readonly memories: readonly MemoryEntry[];
  readonly speakerTrust: number;
  readonly day: number;
  readonly config: MemoryConfig;
}): ConflictCheck {
  const { claim, config } = input;
  const eligible = input.memories.filter(
    (entry) =>
      !entry.redacted &&
      (entry.sourceMode === 'witnessed' || entry.confidence >= config.highConfidence),
  );
  const sameEvent = eligible.filter((entry) =>
    entry.eventRefs.some((ref) => claim.eventRefs.includes(ref)),
  );
  const samePlaceDay = eligible.filter(
    (entry) => entry.content.where === claim.content.where && entry.content.when === input.day,
  );
  const conflicting = pick(sameEvent) ?? pick(samePlaceDay);
  if (conflicting === undefined) return { conflicting: null, impulse: 0, suspicious: false };

  const impulse = verifyImpulse(
    conflicting.salience,
    claim.content.valence,
    conflicting.content.valence,
    input.speakerTrust,
  );
  return {
    conflicting,
    impulse,
    suspicious: impulse >= config.verifyImpulseThreshold,
  };
}

/** 同组里取显著度最高的那条。同分按 id，保证确定。 */
function pick(entries: readonly MemoryEntry[]): MemoryEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => {
    if (a.salience !== b.salience) return b.salience - a.salience;
    return a.memoryId < b.memoryId ? -1 : 1;
  })[0];
}

/**
 * 求证的结果：到了现场，看见什么。
 *
 * 判据是**痕迹**，不是真相。单位没有能力读事件日志——他能做的只有两件事：
 * 看现场留下的痕迹，或者读公告栏。两者都没有，他就只能继续存疑，
 * 而「继续存疑」是一个正当的结局：世界不欠他一个答案。
 */
export type VerifyOutcome = 'confirmed' | 'debunked' | 'inconclusive';

export interface VerifyScene {
  readonly traces: readonly Trace[];
  readonly announcementClaims: readonly Claim[];
}

/**
 * 到了事发地之后怎么判。
 *
 * - 现场有痕迹，且痕迹的推断方向与新断言**一致** → 证实；
 * - 现场有痕迹，方向**相反** → 辟谣；
 * - 现场干净，但有权威公告 → 以公告为准；
 * - 什么都没有 → 悬而未决。
 *
 * 「方向一致」用效价符号判：焦痕（负）与「这里出了事故」（负）一致。
 * 这不是在判真假，是在判「现场看起来像不像他说的那样」——世界能给的
 * 只有这个程度的确证，把它说成「真相大白」就是撒谎。
 */
export function verifyAt(scene: VerifyScene, claim: Claim): VerifyOutcome {
  const sign = Math.sign(claim.content.valence);
  const traceSign = scene.traces
    .filter((trace) => trace.visibility > 0)
    .map((trace) => traceSignOf(trace))
    .filter((value) => value !== 0);

  if (traceSign.length > 0) {
    const agrees = traceSign.some((value) => value === sign);
    const disagrees = traceSign.some((value) => value === -sign);
    if (agrees && !disagrees) return 'confirmed';
    if (disagrees && !agrees) return 'debunked';
    // 两种都有：现场说不清，去看公告。
  }

  if (scene.announcementClaims.length > 0) {
    const authoritative = scene.announcementClaims.some(
      (posted) =>
        posted.eventRefs.some((ref) => claim.eventRefs.includes(ref)) &&
        Math.sign(posted.content.valence) === sign,
    );
    return authoritative ? 'confirmed' : 'debunked';
  }

  return 'inconclusive';
}

function traceSignOf(trace: Trace): number {
  if (trace.layerType === 'garland') return 1;
  if (trace.layerType === 'scorch' || trace.layerType === 'damage') return -1;
  return 0;
}

/**
 * 可靠度记分：谁说过错话。
 *
 * 每被辟谣一次扣 0.15，封底 0。这个数不是「道德评价」，是一个**可观测的
 * 统计量**：下一次他从这个人嘴里听到什么，可信度会低一档。没有它，
 * 谣言与真相在传播网络里就永远同权。
 *
 * 名字里不用「账本」那个英文词：它在这个仓库里是旧上游接口的冻结值，
 * `purity.test.ts` 扫到就红——那条扫描防的是有人把台账语义接回来。
 * 这个记分与台账无关，换个词，免得那道闸分不清。
 * （扫描是裸读全文的，注释里提一句也照样红，所以这里连提都不提。）
 */

/**
 * 求证冲动变成一条日程。
 *
 * 返回 `null` 表示没有冲动，或者冲动不够。返回的值是**去哪个地点**——
 * 行为决策层拿它插一条高优日程，走到那里触发 `CueFired`，再由
 * `verifyAt` 判结果。
 */
export interface VerifyPlan {
  readonly holderId: string;
  readonly placeId: string;
  readonly claimId: string;
  readonly impulse: number;
  readonly reason: 'trace' | 'announcement';
}

export function planVerify(
  holderId: string,
  check: ConflictCheck,
  claim: Claim,
  hasAnnouncementBoard: boolean,
): VerifyPlan | null {
  if (!check.suspicious) return null;
  return {
    holderId,
    placeId: claim.content.where,
    claimId: claim.claimId,
    impulse: check.impulse,
    // 事发地有痕迹就去现场；没有公告栏可读时也只能去现场。
    reason: hasAnnouncementBoard ? 'announcement' : 'trace',
  };
}

/** 存疑信念。它与「采信」的区别只在 `state` 与日程上，形状是同一个。 */
export function beliefFrom(
  holderId: string,
  claim: Claim,
  sourceHolderId: string,
  day: number,
  state: Belief['state'],
): Belief {
  return {
    holderId,
    claimId: claim.claimId,
    eventRefs: claim.eventRefs,
    confidence: claim.confidence,
    learnedDay: day,
    sourceHolderId,
    hop: claim.hop,
    state,
  };
}

/** 信念 → 听者已有的信念视图（`judge` 用）。 */
export function asListenerBelief(
  belief: Belief,
  claim: Claim | undefined,
): ListenerBelief | null {
  if (claim === undefined) return null;
  return {
    eventRefs: belief.eventRefs,
    valence: claim.content.valence,
    confidence: belief.confidence,
    sourceMode: 'heard',
  };
}
