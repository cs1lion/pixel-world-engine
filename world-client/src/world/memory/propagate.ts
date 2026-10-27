/** 传播：断言在单位之间流动，按规则变形，受护栏限制。
 *
 * 《单位间感知与信息传播设计》的核心约束在这里落成一条硬边界：
 * **单位逻辑只能读自己的信念库**。本文件所有函数都只吃「一个 Holder 的信念」
 * 与「他此刻能接触到的对象」，从不吃全局世界状态。这不是约定，是签名——
 * 想读全局的人得先改这里每一个函数的参数表，而那会是一次看得见的越界。
 *
 * 五类通道共用一个抽象（接收范围、延迟、保真度、容量、权限），参数全部来自
 * `config.ts` 的 §3.2 定稿表。本文件实现其中三条：交谈、广播、痕迹。
 * 书面（信件/日记）走 `written.ts`，直接感知走 `perception.ts`。
 *
 * **变形只能按规则发生**：丢细节、放大情绪、来源换手，三样都记录。
 * 模型只负责把结构化断言说成话，不能改断言本身——所以这里没有一处调用模型。
 */

import type { MemoryConfig } from './config.ts';
import { seedOf } from './seed.ts';
import type { Claim, MemoryContent } from './types.ts';

/** 关系：这一对单位之间有多信任。传播的准入与听者的采信都看它。 */
export interface Relationship {
  readonly from: string;
  readonly to: string;
  /** -1..1。低于 `talkTrustFloor` 就不开口；带 secret 的断言要过 `talkSecretTrustFloor`。 */
  readonly trust: number;
  /** 关系强度 0..1，影响谁先开口。 */
  readonly strength: number;
}

export type RelationshipMap = ReadonlyMap<string, Relationship>;

/** 关系表的键。无向，两个方向查同一个键。 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function trustBetween(relations: RelationshipMap, a: string, b: string): number {
  return relations.get(pairKey(a, b))?.trust ?? 0;
}

/**
 * 每个人的「信息源可靠度」：他嘴里的话有多算数。
 *
 * 与 `Relationship.trust` 是两件事，别混：
 * - `trust` 是**一对单位之间**的——「我信不信你」，无向，随关系涨落；
 * - `credibility` 是**一个人自己的**——「这人被辟谣过几次」，全局一份。
 *
 * 区分是必要的：一个你并不熟的人（trust 低）也可能是从不说错的人
 * （credibility 高）；反过来，几十年的老朋友被当场抓了造谣，他不该因为
 * 「我们关系好」就继续被全信。两个数各管一半。
 *
 * 每被辟谣一次扣 `credibilityPenalty`（0.15），封底 0。**扣了要有人读**：
 * `judge` 拿它打折听者的采信，否则这个数只是一张没人看的表，而注释里
 * 「下一次他从这个人嘴里听到什么，可信度会低一档」就是句空话。
 */
export interface CredibilityScores {
  readonly scores: ReadonlyMap<string, number>;
}

export const DEFAULT_CREDIBILITY = 1;

export function credibilityOf(scores: CredibilityScores, holderId: string): number {
  return scores.scores.get(holderId) ?? DEFAULT_CREDIBILITY;
}

export function penalize(
  current: CredibilityScores,
  holderId: string,
  config: MemoryConfig,
): CredibilityScores {
  const next = Math.max(0, credibilityOf(current, holderId) - config.credibilityPenalty);
  const scores = new Map(current.scores);
  scores.set(holderId, next);
  return { scores };
}

/** 从一条事件与它的内容造出断言。断言诞生在目击者身上（`hop = 0`）。 */
export function createClaim(input: {
  readonly claimId: string;
  readonly eventRef: string;
  readonly content: MemoryContent;
  readonly originHolderId: string;
  readonly day: number;
  readonly confidence: number;
  readonly secret: boolean;
}): Claim {
  return {
    claimId: input.claimId,
    eventRefs: [input.eventRef],
    content: input.content,
    confidence: input.confidence,
    hop: 0,
    sourceChain: [{ holderId: input.originHolderId, claimId: input.claimId, hop: 0 }],
    originHolderId: input.originHolderId,
    createdDay: input.day,
    secret: input.secret,
    distortedBy: [],
  };
}

/**
 * 转述一跳：`fidelity_decay` 的全部内容。
 *
 * - `detailLevel - 1`（下限 0）；
 * - `confidence × 0.80`；
 * - `|valence| × 1.10`（封顶 1），符号不变——放大的是情绪强度，不是方向。
 *
 * 方向不变是硬约束：把「好事」传成「坏事」不是「放大情绪」，是编造。
 * 这也是「变形只能丢细节、放大情绪」那条原则在代码里的样子。
 */
export function retell(claim: Claim, config: MemoryConfig): Claim {
  const hop = claim.hop + 1;
  return {
    ...claim,
    hop,
    content: {
      ...claim.content,
      detailLevel: Math.max(0, claim.content.detailLevel - config.hopDetailLoss),
      valence: amplify(claim.content.valence, config.hopValenceGain),
    },
    confidence: claim.confidence * config.hopConfidenceFactor,
    distortedBy: [
      ...claim.distortedBy,
      `hop${hop}:detail-${config.hopDetailLoss}:confidence×${config.hopConfidenceFactor}`,
    ],
  };
}

function amplify(valence: number, gain: number): number {
  const sign = valence < 0 ? -1 : 1;
  return Math.min(1, Math.abs(valence) * gain) * sign;
}

/** 还能不能继续往外传。第 3 跳后细节归零，禁止再传。 */
export function canSpread(claim: Claim, config: MemoryConfig): boolean {
  return claim.hop < config.maxHops && claim.content.detailLevel > 0;
}

/**
 * 说话者愿意向谁开口。
 *
 * 三条准入（补充设计 §3.2 A 的「权限」列）：
 * 1. 距离不超过 `talkDistance`；
 * 2. 关系信任过 `talkTrustFloor`；
 * 3. 带 secret 的断言要过更高的 `talkSecretTrustFloor`。
 *
 * 「说不说」还有一层：话题显著度 × 对听者的相关性 × 说话者性格 × 关系强度
 * （关系与传播 sheet）。那层用 `wantsToTell` 表达，它返回的是**意愿强度**，
 * 由调用方按它排序取前 `maxFanout`。
 */
export interface TellContext {
  readonly speaker: string;
  readonly listener: string;
  readonly distance: number;
  readonly relations: RelationshipMap;
  readonly speakerTalkativeness: number;
}

export function canTell(claim: Claim, context: TellContext, config: MemoryConfig): boolean {
  if (!canSpread(claim, config)) return false;
  if (context.distance > config.talkDistance) return false;
  const trust = trustBetween(context.relations, context.speaker, context.listener);
  if (claim.secret) return trust >= config.talkSecretTrustFloor;
  return trust >= config.talkTrustFloor;
}

/**
 * 开口的意愿 0..1。
 *
 * 显著度越高越想讲，听者越重要越想讲，关系越强越想讲，话多的人更想讲。
 * 秘密打三折——想说，但得掂量。这个数只用来**排序**，不设阈值：
 * 设了阈值就等于给「今天谁也不说」加了一个新的失效方式，而护栏
 * （扇出上限、冷却、跳数）已经够多了。
 */
export function wantsToTell(claim: Claim, context: TellContext, relations: RelationshipMap): number {
  const strength = relations.get(pairKey(context.speaker, context.listener))?.strength ?? 0;
  const raw =
    claim.content.arousal * 0.4 +
    claim.confidence * 0.3 +
    strength * 0.2 +
    context.speakerTalkativeness * 0.1;
  return claim.secret ? raw * 0.3 : raw;
}

/**
 * 这次转述允不允许发生。
 *
 * 两道冷却（§3.2 B）：
 * - 同一对单位就同一话题：`pairCooldownDays`（1 天）；
 * - 同一对单位整体闲聊：`chatCooldownDays`（0.25 天）。
 *
 * 用**世界日的小数**而不是墙钟：0.25 天是 6 个世界小时。冷却记的是
 * `lastSpoke` 的世界时间，与 `now` 同一根钟。
 */
export interface CooldownState {
  readonly pairKey: string;
  readonly claimId: string | null;
  readonly atMs: number;
}

export function coolingDown(
  state: readonly CooldownState[],
  a: string,
  b: string,
  claimId: string,
  nowMs: number,
  config: MemoryConfig,
): boolean {
  const pair = pairKey(a, b);
  for (const item of state) {
    if (item.pairKey !== pair) continue;
    const elapsedDays = (nowMs - item.atMs) / config.dayMs;
    if (item.claimId === claimId) {
      if (elapsedDays < config.pairCooldownDays) return true;
    } else if (item.claimId === null) {
      if (elapsedDays < config.chatCooldownDays) return true;
    }
  }
  return false;
}

/**
 * 扇出配额：单个单位就同一条断言，**每一天**最多向几个人主动提起。
 *
 * 这是防「全员一天内全知」的第一道闸，也是最要紧的一道。要紧全在「每一天」：
 * 配额按天归零（`fanoutUsed` 见 `state.day !== day` 就返回 0，`bumpFanout`
 * 换天把整张表清掉），所以它管的是**节奏**——一天之内最多铺开多快。
 *
 * 另一道闸 `maxHops` 管的是**深度**（`canSpread` 要 `claim.hop < maxHops`）：
 * 一条断言最多转 3 手，第 3 手不能再往外传。两道闸各管一件，互不代替。
 *
 * **两道闸都不是人数上限。** 深度 3、每层 3 人的满三元树有 3 + 9 + 27 = 39 个
 * 节点（算上起源者 40）——那只是**树的形状**：一天之内、每个节点都用尽配额、
 * 且每个节点都是不同的人时，树能长到多大。它不是一辈子洗不掉的账，也不是人口
 * 上限。真实的人数上限是**人口**：现在两个设定集加起来只有 2 个村民，39 这个数
 * 一辈子摸不到。由 `test/memory-reach-ceiling.test.ts` 按这两个常数把树算一遍。
 *
 * 原来这里写「理论上限是 27 人」，后来改成「三层加起来 39 人，是结构上限」——
 * 27 只是最宽的第三层，这一层改对了；可 39 也不是上限，是满树的节点数。拿它当
 * 人数上限是反的：真按它推理，会以为一条断言永远传不到第 40 个人，而实际上人口
 * 够、日子够，谁都能听到。
 *
 * 也别拿 39 去当覆盖率目标的分母。第 1 天末「≤35%」那个目标量的是传播覆盖率，
 * 分母是**人口**（当前 2），不是 39。
 */
export interface FanoutState {
  readonly day: number;
  /** `holderId\u0000claimId` → 今天已经讲给几个人。 */
  readonly counts: ReadonlyMap<string, number>;
}

export function fanoutKey(holderId: string, claimId: string): string {
  return `${holderId}\u0000${claimId}`;
}

export function fanoutUsed(state: FanoutState, holderId: string, claimId: string, day: number): number {
  if (state.day !== day) return 0;
  return state.counts.get(fanoutKey(holderId, claimId)) ?? 0;
}

export function canFanout(
  state: FanoutState,
  holderId: string,
  claimId: string,
  day: number,
  config: MemoryConfig,
): boolean {
  return fanoutUsed(state, holderId, claimId, day) < config.maxFanout;
}

/**
 * 听者信不信。
 *
 * 可信度 = 对来源的信任 × 与已有信念的吻合度 × 多源印证（关系与传播 sheet）。
 * 这里把它折成三档结果，因为下游只关心「采信 / 存疑 / 去核实」：
 *
 * - 有同事件的高置信度亲历记忆且方向相反 → `verify`（求证闭环的入口，
 *   补充设计 §1.1 的冲突检测）；
 * - 综合可信度过 `T_write` → `accept`；
 * - 否则 → `doubt`，仍然记下（存疑的信念也是信念，它会成为日后求证的动机）。
 *
 * **`accept` 不等于「相信为真」**：它只表示「我收下了这条说法」。
 * 世界没有能力判定真伪——判定真伪要去看痕迹或公告，那是求证闭环的事。
 */
export type Verdict = 'accept' | 'doubt' | 'verify';

export interface ListenerBelief {
  readonly eventRefs: readonly string[];
  readonly valence: number;
  readonly confidence: number;
  readonly sourceMode: 'witnessed' | 'heard' | 'read' | 'inferred';
}

export function judge(
  claim: Claim,
  trust: number,
  speakerCredibility: number,
  existing: readonly ListenerBelief[],
  config: MemoryConfig,
): Verdict {
  const conflict = existing.find(
    (belief) =>
      belief.eventRefs.some((ref) => claim.eventRefs.includes(ref)) &&
      (belief.sourceMode === 'witnessed' || belief.confidence >= config.highConfidence) &&
      belief.valence * claim.content.valence < 0,
  );
  if (conflict !== undefined) return 'verify';

  // 信任映射到 -1..1 → 0..1。**完全不信的人说的话可信度是 0**。
  //
  // 这里原来写的是 `0.5 + (trust+1)/4`，也就是 -1..1 → 0.5..1。那样一来
  // 再怎么不信任，一条说法也至少有一半可信度，于是 `judge` 永远不会因为
  // 不信任而拒绝——求证闭环里那个「可靠度下调 0.15」的惩罚也就永远咬不动。
  // 世界会变成「谁说的话都算数」，而传播护栏的一半是白写的。
  const trustFactor = (Math.max(-1, Math.min(1, trust)) + 1) / 2;
  // 说话人的可靠度：被辟谣过的人，话打一次折。**没被辟谣过的是 1，不打折**
  // ——所以这一步在没有任何辟谣发生的世界里是恒等变换，覆盖率曲线不受影响。
  // 少了它，`credibility` 就是一张没人看的表：扣分扣了，效果没有。
  const credibilityFactor = Math.max(0, Math.min(1, speakerCredibility));
  const corroboration = existing.some((belief) =>
    belief.eventRefs.some((ref) => claim.eventRefs.includes(ref)),
  )
    ? 1.2
    : 1;
  const credibility = Math.min(1, claim.confidence * trustFactor * credibilityFactor * corroboration);
  return credibility >= config.T_write ? 'accept' : 'doubt';
}

/**
 * 求证冲动（补充设计 §1.1，纯规则）。
 *
 * `verify_impulse = salience × |valence_new − valence_old| × speaker_trust`
 *
 * `salience` 用**听者的**那条旧记忆的显著度，不是新断言的：冲动是听者的，
 * 一件事对他多重要，得由他原来的记忆说了算。
 */
export function verifyImpulse(
  oldSalience: number,
  newValence: number,
  oldValence: number,
  speakerTrust: number,
): number {
  return oldSalience * Math.abs(newValence - oldValence) * Math.max(0, speakerTrust);
}

/**
 * 断言的地图扩散：一天结束时，屏幕外的单位用批量近似。
 *
 * 这一层与屏幕内的逐次交谈**必须得到一致的结果**（架构影响 sheet 第 3 条），
 * 所以它不另起一套逻辑：它调用的仍是 `retell` / `judge` / `canTell`，
 * 只是把「谁遇到谁」换成按距离与关系的确定性排序，而不是动画驱动的相遇。
 *
 * 随机性来自 `seed(天, 单位对, 断言)`，不是 `Math.random`——于是同一天
 * 重算一次，扩散路径一模一样。
 */
export interface SpreadCandidate {
  readonly speaker: string;
  readonly listener: string;
  readonly distance: number;
}

export interface SpreadInput {
  readonly day: number;
  readonly claim: Claim;
  readonly candidates: readonly SpreadCandidate[];
  readonly relations: RelationshipMap;
  /** 每个人的信息源可靠度。`judge` 拿它给采信打折——被辟谣过的人说话不好使。 */
  readonly credibility: CredibilityScores;
  readonly beliefs: ReadonlyMap<string, readonly ListenerBelief[]>;
  readonly talkativeness: ReadonlyMap<string, number>;
  readonly cooldowns: readonly CooldownState[];
  readonly nowMs: number;
  readonly config: MemoryConfig;
}

export interface SpreadStep {
  readonly from: string;
  readonly to: string;
  readonly claim: Claim;
  readonly verdict: Verdict;
}

/**
 * 扩散一步：给一条断言，找出这一天它还能传给谁。
 *
 * 返回的 `SpreadStep` 里带着**转述后的**断言（`retell` 过的），调用方直接
 * 拿它写信念。扇出配额由调用方在跨步之间累计，这里只看单步。
 */
export function spreadStep(input: SpreadInput): SpreadStep[] {
  const { claim, config } = input;
  if (!canSpread(claim, config)) return [];
  const steps: SpreadStep[] = [];
  const eligible: { candidate: SpreadCandidate; want: number }[] = [];

  for (const candidate of input.candidates) {
    if (candidate.speaker === candidate.listener) continue;
    const context: TellContext = {
      speaker: candidate.speaker,
      listener: candidate.listener,
      distance: candidate.distance,
      relations: input.relations,
      speakerTalkativeness: input.talkativeness.get(candidate.speaker) ?? 0.5,
    };
    if (!canTell(claim, context, config)) continue;
    if (coolingDown(input.cooldowns, candidate.speaker, candidate.listener, claim.claimId, input.nowMs, config)) {
      continue;
    }
    // 已经知道的人不必再听一遍：重复讲述不产生新信念，只浪费扇出配额。
    const known = input.beliefs.get(candidate.listener) ?? [];
    if (known.some((belief) => belief.eventRefs.some((ref) => claim.eventRefs.includes(ref)))) {
      continue;
    }
    eligible.push({ candidate, want: wantsToTell(claim, context, input.relations) });
  }

  // 排序确定：意愿降序，同分按单位对名字。种子只用来打散同分，
  // 不参与主序——主序一变，覆盖率曲线就跟着变，而那条曲线是验收指标。
  eligible.sort((a, b) => {
    if (a.want !== b.want) return b.want - a.want;
    const keyA = `${a.candidate.speaker}\u0000${a.candidate.listener}`;
    const keyB = `${b.candidate.speaker}\u0000${b.candidate.listener}`;
    return seedOf(input.day, keyA, claim.claimId) - seedOf(input.day, keyB, claim.claimId);
  });

  for (const { candidate } of eligible) {
    const retold = retell(claim, config);
    const trust = trustBetween(input.relations, candidate.speaker, candidate.listener);
    const verdict = judge(
      retold,
      trust,
      credibilityOf(input.credibility, candidate.speaker),
      input.beliefs.get(candidate.listener) ?? [],
      config,
    );
    steps.push({ from: candidate.speaker, to: candidate.listener, claim: retold, verdict });
  }
  return steps;
}

/**
 * 公告：官方渠道。范围是公告栏 4 格，可信度高（`confidence ≥ 0.9`），
 * 同时最多贴 5 张（含每日 1 张日报）。
 *
 * 公告与传言的差别只有两处：**谁发的**与**跳数不衰减**。公告不 retell——
 * 它的保真度是「高，有权威」，照抄一遍就够。这也让 `latency_ratio` 那条
 * 指标（公告 ≤ 0.5 天 vs 传言 1.5–2.5 天）在结构上成立。
 */
export interface Announcement {
  readonly announcementId: string;
  readonly claim: Claim;
  readonly postedDay: number;
  readonly placeId: string;
  readonly poster: string;
}

export function postAnnouncement(
  announcement: Announcement,
  existing: readonly Announcement[],
  config: MemoryConfig,
): Announcement[] | null {
  const active = existing.filter((item) => item.placeId === announcement.placeId);
  if (active.length >= config.broadcastMaxPosts) return null;
  if (announcement.claim.confidence < config.broadcastConfidenceFloor) return null;
  return [...existing, announcement];
}

/** 谁读得到这块公告栏。范围 4 格，不看遮挡——公告栏立在明处。 */
export function announcementReach(
  listeners: readonly { readonly holderId: string; readonly distance: number }[],
  config: MemoryConfig,
): string[] {
  return listeners
    .filter((listener) => listener.distance <= config.broadcastRadius)
    .map((listener) => listener.holderId);
}
