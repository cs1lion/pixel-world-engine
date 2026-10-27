/** 记忆世界的编排层：把上面那些纯模块接成一台能跑的机器。
 *
 * 这里是内环唯一持有**全部**记忆与信念的地方。它对外只开三扇门：
 *
 * 1. `ingest()` —— 世界侧把一条事件交进来（含 `source = agent / genesis` 的入口）；
 * 2. `viewOf(holderId)` —— **单位读自己**的那一扇。它返回的是一个只含该单位
 *    记忆与信念的快照，别的东西一概拿不到；
 * 3. `dayClosed()` —— 天界，整理 + 扩散 + 传说 + 心电图。
 *
 * 第 2 条是《信息传播设计》的核心约束「单位逻辑只能读自己的信念库，不能读
 * 全局世界状态」在 API 层的落法。它不是靠调用方自觉：`HolderView` 里根本没有
 * 指向其他单位的字段，而 `MemoryWorld` 的其余字段全是 `private`。
 *
 * 这一层仍然**不调模型**。日摘要走规则模板；模型摘要的位置（
 * `generatedBy.by = 'llm'`）留着，但本组不实现调用，也不占预算。
 */

import { DEFAULT_MEMORY_CONFIG, weightsFor, type MemoryConfig } from './config.ts';
import { consolidateHolder } from './consolidate.ts';
import { candidatesFrom, decayLegend, faded, formLegend, qualifies } from './legend.ts';
import { witnessesOf, type OcclusionGrid, type Perceiver, type PlaceAnchor } from './perception.ts';
import { deleteCascade, type DeletionReport, type DeletionRoot } from './privacy.ts';
import {
  canFanout,
  canSpread,
  createClaim,
  fanoutKey,
  postAnnouncement,
  retell,
  spreadStep,
  trustBetween,
  type Announcement,
  type CooldownState,
  type FanoutState,
  type ListenerBelief,
  type RelationshipMap,
  type SpreadCandidate,
  type Verdict,
} from './propagate.ts';
import { recall, type RecallOutcome, type RecallRequest } from './recall.ts';
import { decideWrite, inputsFor } from './salience.ts';
import { compile, type UpstreamAction } from './sanitize.ts';
import { rollBelow, seedOf } from './seed.ts';
import { exposedTraces, consequenceOf, fitTraceLayers, inferenceOf, makeTrace, type InferenceSpec } from './traces.ts';
import { readRecord, writeDiary, writeLetter, type WrittenRecord } from './written.ts';
import type {
  Belief,
  Claim,
  Holder,
  HolderType,
  Legend,
  MemoryContent,
  MemoryEntry,
  MemoryEvent,
  MemoryTier,
  Trace,
  Visibility,
  WorldFact,
  WorldVitals,
} from './types.ts';
import { checkConflict, credibilityOf, penalize, planVerify, verifyAt, type CredibilityScores, type VerifyPlan } from './verify.ts';
import { computeVitals, type TellRecord } from './vitals.ts';

/** 交进来的一条事件：世界侧已经知道谁在场，或由这里按感知模型算。 */
export interface IngestInput {
  readonly eventId: string;
  readonly at: number;
  readonly kind: string;
  readonly place: PlaceAnchor;
  readonly actors: readonly string[];
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly visibility: Visibility;
  readonly source: WorldFact['source'];
  readonly importanceHint: number | null;
  readonly parentEventId: string | null;
  /** 世界侧已经算好的在场者。给了就不再按感知模型算。 */
  readonly witnesses?: readonly string[];
  /** 感知模型要的现场快照。没给 `witnesses` 时必须给。 */
  readonly perceivers?: readonly Perceiver[];
  readonly grid?: OcclusionGrid;
  /** 事件的情绪。没给时按 kind 的先验推。 */
  readonly valence?: number;
  readonly arousal?: number;
}

/**
 * 单位能看见的世界。
 *
 * 只有它自己的东西。**没有** `entries`（那是全库）、没有其他 holder 的 id 列表、
 * 没有事件日志。想加一个字段之前先问：这个单位凭什么知道它。
 */
export interface HolderView {
  readonly holderId: string;
  readonly type: HolderType;
  readonly memories: readonly MemoryEntry[];
  readonly beliefs: readonly Belief[];
  /** 自己此刻的日程：要不要去求证，去哪。 */
  readonly verifyPlans: readonly VerifyPlan[];
  /** 自己的可靠度（别人怎么看他，他自己不知道；这里是他自己的账）。 */
  readonly credibility: number;
  readonly traces: readonly Trace[];
}

export interface MemoryWorldDeps {
  readonly config?: MemoryConfig;
  readonly relations?: RelationshipMap;
  readonly grid?: OcclusionGrid;
  /** 事件出口。世界侧接它写日志、广播心电图。 */
  readonly emit?: (event: MemoryEvent) => void;
  /** 世界 id，参与种子派生。 */
  readonly worldId?: string;
}

/**
 * 一台记忆世界。
 *
 * 所有随机都从 `worldId + day + holder + op` 派生，所有集合的迭代顺序都
 * 在取用前排序——回放同一串输入得到同一个库，这是协议第 16 节的硬要求。
 */
export class MemoryWorld {
  readonly config: MemoryConfig;
  private readonly relations: RelationshipMap;
  private readonly grid: OcclusionGrid | undefined;
  private readonly emitFn: ((event: MemoryEvent) => void) | undefined;
  private readonly worldId: string;

  private readonly holders = new Map<string, Holder>();
  private readonly facts = new Map<string, WorldFact>();
  private entries: MemoryEntry[] = [];
  private readonly claims = new Map<string, Claim>();
  private beliefs: Belief[] = [];
  private readonly traces = new Map<string, Trace[]>();
  private legends: Legend[] = [];
  private announcements: Announcement[] = [];
  private readonly tells: TellRecord[] = [];
  private written: WrittenRecord[] = [];
  private cooldowns: CooldownState[] = [];
  private fanout: FanoutState = { day: 0, counts: new Map() };
  private readonly verifyPlans = new Map<string, VerifyPlan[]>();
  private credibility: CredibilityScores = { scores: new Map() };
  private nextSerial = 1;
  private currentDay = 0;

  constructor(deps: MemoryWorldDeps = {}) {
    this.config = deps.config ?? DEFAULT_MEMORY_CONFIG;
    this.relations = deps.relations ?? new Map();
    this.grid = deps.grid;
    this.emitFn = deps.emit;
    this.worldId = deps.worldId ?? 'world';
  }

  // ---------------------------------------------------------------- Holder

  addHolder(holder: Holder): void {
    this.holders.set(holder.holderId, holder);
  }

  /** 有人走动了。行为层每拍调一次，记忆层据此算谁跟谁挨得够近。 */
  moveHolder(holderId: string, at: { readonly x: number; readonly y: number }): void {
    const holder = this.holders.get(holderId);
    if (holder === undefined) return;
    this.holders.set(holderId, { ...holder, at });
  }

  hasHolder(holderId: string): boolean {
    return this.holders.has(holderId);
  }

  /**
   * 一栋楼没了。
   *
   * **只删地点 Holder，不删人物的记忆。** 楼拆了，但它留下的痕迹与
   * 「那儿原来有间铺子」这件事还该有人记得——记忆不是世界状态的副本，
   * 它比世界慢半拍，这正是它该有的样子。
   *
   * 不删的话，`spreadCandidates` 会把一栋不存在的楼当成听众，
   * 而它永远「听得见」任何发生在原地的传言。
   */
  removePlace(holderId: string): void {
    const holder = this.holders.get(holderId);
    if (holder === undefined || holder.type !== 'place') return;
    this.holders.delete(holderId);
  }

  holderIds(): readonly string[] {
    return [...this.holders.keys()].sort();
  }

  // ------------------------------------------------------------ 事件入口

  /**
   * 世界侧交进来一条事件。
   *
   * 这一步做三件事，全部是规则：
   * 1. 定 `witnesses`（没给就按感知模型算）并写进事实；
   * 2. 对每个 witness 算显著度，过线的写 Episode；
   * 3. 对 place Holder 按后果规则落痕迹。
   *
   * `source = agent / genesis` 的事件走**同一条**路。本组只收不用：造物主
   * 与上游都从这里进来，之后怎么被感知、记忆、传播，与本地事件没有区别。
   */
  ingest(input: IngestInput): { readonly witnesses: readonly string[]; readonly written: readonly string[] } {
    const day = Math.floor(input.at / this.config.dayMs);
    const tick = input.at - day * this.config.dayMs;
    const witnesses = this.resolveWitnesses(input);

    const fact: WorldFact = {
      eventId: input.eventId,
      day,
      tick,
      kind: input.kind,
      placeId: input.place.placeId,
      actors: input.actors,
      witnesses,
      parentEventId: input.parentEventId,
      outcome: input.outcome,
      visibility: input.visibility,
      importanceHint: input.importanceHint,
      source: input.source,
    };
    this.facts.set(fact.eventId, fact);

    const written: string[] = [];
    const valence = input.valence ?? defaultValence(input.kind);
    const arousal = input.arousal ?? defaultArousal(input.kind);

    for (const holderId of witnesses) {
      const holder = this.holders.get(holderId);
      if (holder === undefined || holder.type !== 'character') continue;
      const parts = inputsFor({
        kind: input.kind,
        holderId,
        actors: input.actors,
        importanceHint: input.importanceHint,
        valence,
        arousal,
      });
      const weights = weightsFor(this.config.salienceWeights, holder.profile, this.config.salienceBias);
      const decision = decideWrite(weights, parts, this.config.T_write);
      if (!decision.write) continue;
      const entry = this.makeEpisodic(holderId, fact, {
        valence,
        arousal,
        salience: decision.salience.salience,
        detailLevel: 3,
      });
      this.entries.push(entry);
      written.push(entry.memoryId);
      this.emit('memory.written', input.at, {
        memoryId: entry.memoryId,
        holderId,
        eventRefs: entry.eventRefs,
        salience: entry.salience,
      });
    }

    // place Holder：后果规则，不走显著度。
    this.depositTraces(fact, input.at, input.place.placeType ?? 'generic', valence);

    return { witnesses, written };
  }

  /**
   * 上游动作从边界网关进来：先编译，再当作一条世界事件。
   *
   * 这是 `source = agent` 的唯一入口，也是脱敏发生的地方。编译不出事件
   * （拓扑不在表里，或一次平静的检索）时返回 `null`，世界什么都不会发生。
   */
  ingestUpstream(
    action: UpstreamAction,
    at: number,
    place: PlaceAnchor,
    actors: readonly string[],
    sight?: { readonly perceivers: readonly Perceiver[]; readonly grid: OcclusionGrid },
  ): WorldFact | null {
    const compiled = compile(action);
    if (compiled === null) return null;
    const eventId = this.nextEventId('up');
    this.ingest({
      eventId,
      at,
      kind: compiled.kind,
      place,
      actors,
      outcome: compiled.outcome,
      visibility: compiled.visibility,
      source: 'agent',
      importanceHint: compiled.importanceHint,
      parentEventId: null,
      // 给了现场就按感知模型算在场者；没给就按 `actors`——参与这件事的人
      // 按定义就在场。**早先这里写死成空数组**，于是上游事件一条目击者都
      // 没有：痕迹照落，但谁都不记得，入口形同虚设。事件进得来是一回事，
      // 进来之后世界真的记得它，是另一回事。
      ...(sight === undefined
        ? { witnesses: [...actors] }
        : { perceivers: sight.perceivers, grid: sight.grid }),
      valence: undefined,
      arousal: undefined,
    });
    return this.facts.get(eventId) ?? null;
  }

  // ------------------------------------------------------------ 单位读面

  /**
   * 某个单位能看见的世界。**唯一**的读入口。
   *
   * 返回的是深拷贝的切片：调用方改了它，世界里的库不受影响。这不是性能考量，
   * 是「单位不能改世界」这条的落法——他只能读。
   */
  viewOf(holderId: string): HolderView | null {
    const holder = this.holders.get(holderId);
    if (holder === undefined) return null;
    return {
      holderId,
      type: holder.type,
      memories: this.entries.filter((entry) => entry.holderId === holderId).map(cloneEntry),
      beliefs: this.beliefs.filter((belief) => belief.holderId === holderId).map((belief) => ({ ...belief })),
      verifyPlans: [...(this.verifyPlans.get(holderId) ?? [])],
      credibility: credibilityOf(this.credibility, holderId),
      traces: holder.type === 'place' ? [...(this.traces.get(holderId) ?? [])] : [],
    };
  }

  /**
   * 单位的一次回忆。走 `recall`，`commit` 时强化并可能变形。
   *
   * 取几条由调用方定：**对话注入是 `dialogueTopK`（3），一般回忆是 `budgetK`（5）**。
   * 两个数不是重复——对话里塞五条记忆，模型的话就会变成流水账；而主动回忆时
   * 捞得太少又接不上。早先只接了后者，于是 `dialogueTopK` 是个死数。
   */
  recallFor(holderId: string, request: Omit<RecallRequest, 'holderId'>): RecallOutcome {
    const mine = this.entries.filter((entry) => entry.holderId === holderId);
    const outcome = recall(mine, { ...request, holderId }, this.config, rollBelow);
    if (request.commit && outcome.updated.length > 0) {
      const byId = new Map(outcome.updated.map((entry) => [entry.memoryId, entry]));
      this.entries = this.entries.map((entry) => byId.get(entry.memoryId) ?? entry);
      for (const mutation of outcome.mutations) {
        this.emit('memory.recalled', request.nowDay * this.config.dayMs, {
          memoryId: mutation.memoryId,
          cues: request.cues,
          mutation: mutation.mutation,
        });
      }
    }
    return outcome;
  }

  /**
   * 对话时注入的那几条。`dialogueTopK` 在这里落地。
   *
   * 与 `recallFor` 的差别只有取几条与默认 `commit`：对话是**读**，
   * 读一次就把这条记忆强化一次会让「被反复提起的事」迅速变得比事实更牢固，
   * 而它可能只是一句闲话。所以默认不 commit，要 commit 得明说。
   */
  recallForDialogue(
    holderId: string,
    request: Omit<RecallRequest, 'holderId' | 'budgetK'>,
  ): RecallOutcome {
    return this.recallFor(holderId, { ...request, budgetK: this.config.dialogueTopK });
  }

  // -------------------------------------------------------------- 传播

  /**
   * 造一条断言。断言诞生在目击者身上。
   *
   * `claim.created` 事件照发，但**不调模型**：内容直接取自事件的结构化字段。
   */
  createClaimFrom(eventId: string, originHolderId: string, at: number, secret = false): Claim | null {
    const fact = this.facts.get(eventId);
    if (fact === undefined) return null;
    const claim = createClaim({
      claimId: this.nextId('claim'),
      eventRef: eventId,
      content: this.contentForFact(fact),
      originHolderId,
      day: fact.day,
      confidence: 1,
      secret,
    });
    this.claims.set(claim.claimId, claim);
    this.emit('claim.created', at, {
      claimId: claim.claimId,
      eventRefs: claim.eventRefs,
      originHolderId,
    });
    return claim;
  }

  /**
   * 屏幕外的一天：图扩散批量近似。
   *
   * 与屏幕内的逐次交谈走同一组函数（`spreadStep` → `judge` → 写信念），
   * 所以两边结果一致。屏幕内只是把「相遇」换成动画驱动的触发，
   * 不另写一套传播规则。
   *
   * **按跳数分层推进，不按「轮」**。第 h 跳的持有者说的话，落成第 h+1 跳的
   * 版本；同一个村子里的第一跳与第三跳可以同时存在，它们各自有各自的保真度。
   * 早先的实现让所有人共用一条不断被 retell 的断言对象，于是最后一个听到的人
   * 会把所有人的跳数一起改掉——保真度曲线因此画不出来，而它是一条验收指标。
   */
  diffuseDay(at: number): { readonly told: number; readonly accepted: number; readonly suspicious: number } {
    const day = Math.floor(at / this.config.dayMs);
    this.currentDay = day;
    if (this.fanout.day !== day) this.fanout = { day, counts: new Map() };

    let told = 0;
    let accepted = 0;
    let suspicious = 0;

    // 一次批量扩散 = 每对单位之间的一次交谈。两条闸各管一头：
    //
    // - `talkTopicsPerChat`（2 条）：**这一次交谈**能带几个话题。没有它，
    //   一个人一天之内可以把世上所有断言一口气讲给同一个人听。
    // - `chatCooldownDays`（0.25 天）：**下一次交谈**得等多久。它记的是
    //   交谈结束的时刻，所以本次交谈期间的后续话题不受它拦。
    //
    // 两条分开记，是因为它们是两件事。早先只推了后者，于是前者永远咬不到：
    // 同一对单位一次只能传一条断言，而「一次交谈 2 条」这个上限根本没机会生效。
    const topicsByPair = new Map<string, number>();
    const chatCooldowns: CooldownState[] = [];

    // 按 claimId 排序处理：同一天里多条断言的先后必须确定。
    const claimIds = [...this.claims.keys()].sort();
    for (const claimId of claimIds) {
      const origin = this.claims.get(claimId);
      if (origin === undefined) continue;

      for (let hop = 0; hop < this.config.maxHops; hop += 1) {
        const version = claimAtHop(origin, hop, this.config);
        if (!canSpread(version, this.config)) break;
        const holdersAtHop = this.beliefs
          .filter((belief) => belief.claimId === claimId && belief.hop === hop)
          // **今天才听说的人，今天不往下传。**
          //
          // 一跳 ≈ 一天的闲话。少了这一条，`diffuseDay` 会在一次日终里把
          // 0→1→2→3 跳全部跑完，等于一夜之间把三天的流言都传遍——覆盖率曲线
          // 第 1 天就冲到 60%，而护栏要的是第 1 天 ≤35%、第 3 天才到 60~80%。
          // 第 0 跳不受限：目击者当天就能开口。
          .filter((belief) => belief.learnedDay < day || hop === 0)
          .map((belief) => belief.holderId);
        // 断言诞生者本人就是第 0 跳的持有者。
        if (hop === 0 && !holdersAtHop.includes(origin.originHolderId)) {
          holdersAtHop.push(origin.originHolderId);
        }
        if (holdersAtHop.length === 0) continue;

        for (const speaker of [...holdersAtHop].sort()) {
          if (!canFanout(this.fanout, speaker, claimId, day, this.config)) continue;
          const candidates = this.spreadCandidates(speaker);
          const steps = spreadStep({
            day,
            claim: version,
            candidates,
            relations: this.relations,
            beliefs: this.beliefViews(),
            talkativeness: this.talkativeness(),
            cooldowns: this.cooldowns,
            nowMs: at,
            config: this.config,
          });
          for (const step of steps) {
            if (!canFanout(this.fanout, step.from, claimId, day, this.config)) break;
            const pair = pairOf(step.from, step.to);
            const used = topicsByPair.get(pair) ?? 0;
            // 这一对已经聊满了，换下一对。不是 `break`：别的单位对还能说。
            if (used >= this.config.talkTopicsPerChat) continue;
            const delivered = this.deliver(step.from, step.to, step.claim, step.verdict, at);
            if (!delivered) continue;
            if (used === 0) {
              // 第一次开口：这一对今天聊过了。散完之后整体记冷却。
              chatCooldowns.push({ pairKey: pair, claimId: null, atMs: at });
            }
            topicsByPair.set(pair, used + 1);
            told += 1;
            if (step.verdict === 'accept') accepted += 1;
            if (step.verdict === 'verify') suspicious += 1;
            this.bumpFanout(step.from, claimId, day);
          }
        }
      }
    }

    // 交谈结束了才记冷却。中途记的话，本次交谈的第二个话题会被自己刚写的
    // 冷却拦住——「一次交谈 2 条」就变成了一句空话。
    this.cooldowns = [...this.cooldowns, ...chatCooldowns];

    return { told, accepted, suspicious };
  }

  /** 读公告栏。公告不 retell：保真度是「高，有权威」。 */
  postAnnouncement(announcement: Announcement): boolean {
    const next = postAnnouncement(announcement, this.announcements, this.config);
    if (next === null) return false;
    this.announcements = next;
    this.claims.set(announcement.claim.claimId, announcement.claim);
    this.emit('announcement.posted', announcement.postedDay * this.config.dayMs, {
      announcementId: announcement.announcementId,
      placeId: announcement.placeId,
      claimId: announcement.claim.claimId,
    });
    return true;
  }

  /** 一个单位读到了公告。读到的内容直接进信念，跳数为 0。 */
  readAnnouncement(holderId: string, announcementId: string, at: number): Belief | null {
    const announcement = this.announcements.find((item) => item.announcementId === announcementId);
    if (announcement === undefined) return null;
    const belief = this.addBelief(holderId, announcement.claim, announcement.claim.originHolderId, 'held', at);
    this.emit('announcement.read', at, { announcementId, holderId });
    return belief;
  }

  // -------------------------------------------------------------- 书面

  /**
   * 写一封信。一封信一条断言，超了就写不成（见 `written.ts` 的解释）。
   */
  writeLetter(input: {
    readonly authorId: string;
    readonly recipientId: string;
    readonly claimIds: readonly string[];
    readonly placeId: string;
    readonly at: number;
  }): WrittenRecord | null {
    const claims = input.claimIds
      .map((claimId) => this.claims.get(claimId))
      .filter((claim): claim is Claim => claim !== undefined);
    const record = writeLetter({
      recordId: this.nextId('letter'),
      authorId: input.authorId,
      recipientId: input.recipientId,
      claims,
      day: Math.floor(input.at / this.config.dayMs),
      placeId: input.placeId,
      config: this.config,
    });
    if (record === null) return null;
    this.written = [...this.written, record];
    this.emit('diary.written', input.at, {
      recordId: record.recordId,
      kind: record.kind,
      authorId: record.authorId,
      recipientId: record.recipientId,
      claimIds: record.claims.map((claim) => claim.claimId),
    });
    return record;
  }

  /**
   * 写今天的日记。只收亲历的条目，超 `diaryClaimsPerDay` 条按显著度截断。
   */
  writeDiary(input: {
    readonly authorId: string;
    readonly placeId: string;
    readonly at: number;
  }): WrittenRecord | null {
    const record = writeDiary({
      recordId: this.nextId('diary'),
      authorId: input.authorId,
      entries: this.entries,
      day: Math.floor(input.at / this.config.dayMs),
      placeId: input.placeId,
      config: this.config,
    });
    if (record === null) return null;
    this.written = [...this.written, record];
    this.emit('diary.written', input.at, {
      recordId: record.recordId,
      kind: record.kind,
      authorId: record.authorId,
      recipientId: null,
      claimIds: record.claims.map((claim) => claim.claimId),
    });
    return record;
  }

  /**
   * 读一封信或一本日记。读到的断言原样进信念，**跳数为 0**——
   * 书面通道不随跳数衰减，这是它存在的理由。
   *
   * 读不到（不是收件人、不是本人、记录不存在）时返回空数组，
   * 调用方分不出「没有」和「不给读」——这两种情况下他本来就都该什么都不知道。
   */
  readWritten(holderId: string, recordId: string, at: number): readonly Belief[] {
    const record = this.written.find((item) => item.recordId === recordId);
    if (record === undefined) return [];
    const claims = readRecord(record, holderId);
    const out: Belief[] = [];
    for (const claim of claims) {
      this.claims.set(claim.claimId, claim);
      out.push(this.addBelief(holderId, claim, record.authorId, 'held', at));
    }
    if (out.length > 0) {
      this.emit('announcement.read', at, {
        recordId,
        holderId,
        kind: record.kind,
        claimIds: claims.map((claim) => claim.claimId),
      });
    }
    return out;
  }

  /** 这个人写得下、也读得到的那几条记录。给 UI 与调试用。 */
  writtenOf(holderId: string): readonly WrittenRecord[] {
    return this.written.filter((record) => readRecord(record, holderId).length > 0);
  }

  // -------------------------------------------------------- 痕迹与推断

  /**
   * 一个单位路过某地，看见痕迹，推断出点什么。
   *
   * 这是「痕迹」通道的落点：低保真、需推断、0 次模型调用。
   * 碑文是唯一例外——它升级成 `read`，因为碑文绑着 event_ref。
   */
  lookAtTraces(holderId: string, placeId: string, at: number): InferenceSpec[] {
    // 走到那栋楼跟前才看得见痕迹。`traceRadius`（3 格）是这一步的准入，
    // 不是装饰参数：没有它，任何一个 unit 都能在村子另一头「路过」，
    // 于是痕迹通道等于免费的全村广播，而它本该是最慢、最费力的一条。
    if (!this.withinTraceReach(holderId, placeId)) return [];
    const traces = exposedTraces(this.traces.get(placeId) ?? [], this.config.traceExposedLayers);
    const out: InferenceSpec[] = [];
    for (const trace of traces) {
      const spec = inferenceOf(trace.layerType);
      if (spec === null) continue;
      out.push(spec);
      const content: MemoryContent = {
        what: spec.what,
        who: [],
        where: placeId,
        when: Math.floor(at / this.config.dayMs),
        detailLevel: spec.detailLevel,
        valence: spec.valence,
        arousal: spec.arousal,
      };
      const entry: MemoryEntry = {
        memoryId: this.nextId('m'),
        holderId,
        kind: 'episodic',
        tier: 'day',
        eventRefs: [trace.eventRef],
        sourceMode: spec.sourceMode,
        sourceChain: [],
        content,
        salience: spec.confidence * 0.6 + Math.abs(spec.valence) * 0.4,
        confidence: spec.confidence,
        strength: 1,
        createdDay: content.when,
        lastRecalledDay: content.when,
        recallCount: 0,
        flashbulb: false,
        pinned: false,
        redacted: false,
        derivedFrom: { memoryIds: [], claimIds: [] },
        generatedBy: this.ruleMeta(holderId, trace.traceId, content.when),
        archived: false,
      };
      this.entries.push(entry);
      this.emit('cue.fired', at, { holderId, cue: { placeId, layer: trace.layerType } });
    }
    return out;
  }

  // ---------------------------------------------------------- 求证闭环

  /** 一个单位到了事发地，看现场，判这条传言是真是假。 */
  verify(holderId: string, claimId: string, placeId: string, at: number): {
    readonly outcome: ReturnType<typeof verifyAt>;
    readonly debunkedSpeaker: string | null;
  } {
    const claim = this.claims.get(claimId);
    if (claim === undefined) return { outcome: 'inconclusive', debunkedSpeaker: null };

    const announcementClaims = this.announcements
      .filter((item) => item.placeId === placeId)
      .map((item) => item.claim);
    const outcome = verifyAt(
      { traces: this.traces.get(placeId) ?? [], announcementClaims },
      claim,
    );

    const state = outcome === 'confirmed' ? 'confirmed' : outcome === 'debunked' ? 'debunked' : 'suspicious';
    this.beliefs = this.beliefs.map((belief) =>
      belief.holderId === holderId && belief.claimId === claimId ? { ...belief, state } : belief,
    );

    let debunkedSpeaker: string | null = null;
    if (outcome === 'debunked') {
      const belief = this.beliefs.find((item) => item.holderId === holderId && item.claimId === claimId);
      debunkedSpeaker = belief?.sourceHolderId ?? claim.originHolderId;
      this.credibility = penalize(this.credibility, debunkedSpeaker, this.config);
      this.emit('rumor.debunked', at, {
        claimId,
        holderId,
        speakerId: debunkedSpeaker,
        placeId,
      });
    }

    // 求证完就撤掉这条日程：跑一趟只解决一条传言。
    const remaining = (this.verifyPlans.get(holderId) ?? []).filter((plan) => plan.claimId !== claimId);
    this.verifyPlans.set(holderId, remaining);
    return { outcome, debunkedSpeaker };
  }

  // -------------------------------------------------------------- 天界

  /**
   * `DayClosed`。整理、扩散、传说、心电图，一次做完。
   *
   * 顺序有讲究：先扩散（当天的传言当天传），再整理（把当天的一切压成摘要），
   * 最后算心电图（它要看的就是整理之后的样子）。
   */
  dayClosed(day: number, at: number): WorldVitals {
    const closedDay = day;
    this.currentDay = closedDay;

    this.diffuseDay(at);

    // **日记要写在整理之前。** 整理会把当天的片段降级或压成摘要，写在那之后
    // 就一条都收不到了——日记收的正是「今天的片段」。这一句放错过位置，
    // 表现是日记从来不存在，而 `diary.written` 这个事件类型一直躺在类型表里。
    this.writeDailies(closedDay, at);

    const ids = this.holderIds();
    for (const holderId of ids) {
      const result = consolidateHolder(holderId, this.entries, closedDay, this.config, this.facts);
      this.entries = [...result.entries] as MemoryEntry[];
      this.emit('memory.consolidated', at, { holderId, day: closedDay, stats: result.stats });
      const archived = this.entries.filter((entry) => entry.holderId === holderId && entry.archived);
      for (const entry of archived) {
        this.emit('memory.archived', at, { memoryId: entry.memoryId });
      }
    }

    this.updateLegends(closedDay, at);

    const vitals = computeVitals({
      day: closedDay,
      memories: this.entries,
      beliefs: this.beliefs,
      tells: this.tells,
      holderIds: ids,
      // 孤立只看人。楼不说话，把它算进来会让这个数常年钉在楼的数量上，
      // 而导演读它是要看「世界是不是死了」——那个数得会动。
      characterIds: ids.filter((holderId) => this.holders.get(holderId)?.type === 'character'),
      config: this.config,
    });
    // 心电图向外广播。本组不读它做任何决定——那是导演的事。
    this.emit('day.closed', at, { ...vitals });
    return vitals;
  }

  // ---------------------------------------------------------------- 删除

  delete(root: DeletionRoot): DeletionReport {
    const claimIds = new Set(this.claims.keys());
    const result = deleteCascade(this.entries, root, claimIds);
    this.entries = [...result.entries] as MemoryEntry[];

    const counts = {
      memories: result.report.removedMemoryIds.length,
      summaries: result.report.redactedMemoryIds.length,
      claims: root.kind === 'claim' ? 1 : 0,
      traces: 0,
      legends: 0,
    };
    this.emit('memory.deleted', this.currentDay * this.config.dayMs, { rootId: root.id, counts });
    return { ...result.report, counts };
  }

  // ------------------------------------------------------------ 内部件

  private resolveWitnesses(input: IngestInput): string[] {
    if (input.witnesses !== undefined) return [...input.witnesses];
    const grid = input.grid ?? this.grid;
    if (input.perceivers === undefined || grid === undefined) return [];
    return witnessesOf({
      place: input.place,
      perceivers: input.perceivers,
      grid,
      config: this.config,
    });
  }

  private makeEpisodic(
    holderId: string,
    fact: WorldFact,
    extra: { valence: number; arousal: number; salience: number; detailLevel: number },
  ): MemoryEntry {
    const content: MemoryContent = {
      what: this.whatOf(fact),
      who: [...fact.actors],
      where: fact.placeId,
      when: fact.day,
      detailLevel: extra.detailLevel,
      valence: extra.valence,
      arousal: extra.arousal,
    };
    const flashbulb = extra.salience >= this.config.T_flash;
    return {
      memoryId: this.nextId('m'),
      holderId,
      kind: 'episodic',
      tier: 'day',
      eventRefs: [fact.eventId],
      sourceMode: 'witnessed',
      sourceChain: [],
      content,
      salience: extra.salience,
      confidence: 1,
      strength: 1,
      createdDay: fact.day,
      lastRecalledDay: fact.day,
      recallCount: 0,
      flashbulb,
      pinned: false,
      redacted: false,
      derivedFrom: { memoryIds: [], claimIds: [] },
      generatedBy: this.ruleMeta(holderId, fact.eventId, fact.day),
      archived: false,
    };
  }

  private depositTraces(fact: WorldFact, at: number, placeType: string, valence: number): void {
    const existing = this.traces.get(fact.placeId) ?? [];
    const recurrence = existing.filter((trace) => trace.eventRef !== fact.eventId).length;
    const specs = consequenceOf({
      eventId: fact.eventId,
      kind: fact.kind,
      placeId: fact.placeId,
      placeType,
      intensity: Math.min(1, Math.abs(valence) + 0.2),
      day: fact.day,
      recurrence,
    });
    if (specs.length === 0) return;
    let next = [...existing];
    for (const spec of specs) {
      const trace = makeTrace(this.nextId('trace'), {
        eventId: fact.eventId,
        kind: fact.kind,
        placeId: fact.placeId,
        placeType,
        intensity: spec.intensity,
        day: fact.day,
        recurrence,
      }, spec);
      // 同类痕迹合并：同一地点同一层只留最新一条，强度取高者。
      const sameLayer = next.findIndex((item) => item.layerType === spec.layerType);
      if (sameLayer >= 0) {
        const previous = next[sameLayer]!;
        next[sameLayer] = { ...trace, intensity: Math.max(previous.intensity, trace.intensity) };
      } else {
        next.push(trace);
      }
      this.emit('trace.added', at, { traceId: trace.traceId, placeId: trace.placeId, layerType: trace.layerType });
    }
    this.traces.set(fact.placeId, fitTraceLayers(next, this.config.placeTraceLayers));
  }

  private deliver(
    from: string,
    to: string,
    claim: Claim,
    verdict: Verdict,
    at: number,
  ): boolean {
    if (this.beliefs.some((belief) => belief.holderId === to && belief.claimId === claim.claimId)) {
      return false;
    }
    const state = verdict === 'verify' ? 'suspicious' : 'held';
    this.addBelief(to, claim, from, state, at);
    this.tells.push({ day: this.currentDay, from, to, claimId: claim.claimId });
    // 逐话题冷却（同一对单位、同一条断言）在这里记。闲聊冷却由
    // `diffuseDay` 在整场交谈结束时记——它记的是「聊过」这件事，不是某一条。
    this.cooldowns = [
      ...this.cooldowns,
      { pairKey: pairOf(from, to), claimId: claim.claimId, atMs: at },
    ];
    this.emit('claim.told', at, {
      claimId: claim.claimId,
      from,
      to,
      hop: claim.hop,
      detailLevel: claim.content.detailLevel,
      verdict,
    });

    if (verdict === 'verify') this.planVerification(to, claim, at);
    return true;
  }

  private addBelief(
    holderId: string,
    claim: Claim,
    sourceHolderId: string,
    state: Belief['state'],
    at: number,
  ): Belief {
    const belief: Belief = {
      holderId,
      claimId: claim.claimId,
      eventRefs: claim.eventRefs,
      confidence: claim.confidence,
      learnedDay: Math.floor(at / this.config.dayMs),
      sourceHolderId,
      hop: claim.hop,
      state,
    };
    this.beliefs = [...this.beliefs.filter((item) => !(item.holderId === holderId && item.claimId === claim.claimId)), belief];
    this.emit('belief.updated', at, { holderId, claimId: claim.claimId, state });
    return belief;
  }

  /**
   * 求证冲动过线时插一条日程。
   *
   * 这一步同时做冲突检测（补充设计 §1.1 第 1 步）——它需要这个单位的**全部**
   * 记忆，所以只能在这里做，不能在传播层做（那一层只认断言）。
   */
  private planVerification(holderId: string, claim: Claim, at: number): void {
    const check = checkConflict({
      claim,
      memories: this.entries.filter((entry) => entry.holderId === holderId),
      speakerTrust: trustBetween(this.relations, holderId, claim.originHolderId),
      day: Math.floor(at / this.config.dayMs),
      config: this.config,
    });
    const plan = planVerify(holderId, check, claim, this.announcements.length > 0);
    if (plan === null) return;
    this.verifyPlans.set(holderId, [...(this.verifyPlans.get(holderId) ?? []), plan]);
  }

  /**
   * 日终写日记。协议第 7 节把日记列为整理的**表现产物**之一——
   * 一个世界过了一天，该有人把今天的事记下来。
   *
   * 为什么放在整理之后：日记收的是 `sourceMode === 'witnessed'` 的当日片段，
   * 而整理会把没被挑中的片段降一级细节。写日记要在整理之后，记下的才是
   * 「他今天记住的样子」，不是「他今天经历的样子」——后者是事件日志的事。
   *
   * 为什么不是每个人都写：`writeDiary` 只收亲历的条目，一天什么都没亲历的
   * 人写不出日记，返回 `null`。这不是缺陷，是这个世界该有的样子——
   * 不是每天每个人都有值得写下来的事。
   */
  private writeDailies(day: number, at: number): void {
    for (const holderId of this.holderIds()) {
      const holder = this.holders.get(holderId);
      if (holder === undefined || holder.type !== 'character') continue;
      const record = writeDiary({
        recordId: this.nextId('diary'),
        authorId: holderId,
        entries: this.entries,
        day,
        placeId: holder.at === undefined ? '' : `at_${holder.at.x}_${holder.at.y}`,
        config: this.config,
      });
      if (record === null) continue;
      this.written = [...this.written, record];
      this.emit('diary.written', at, {
        recordId: record.recordId,
        kind: record.kind,
        authorId: record.authorId,
        recipientId: null,
        claimIds: record.claims.map((claim) => claim.claimId),
      });
    }
  }

  private updateLegends(day: number, at: number): void {
    this.legends = this.legends.map(decayLegend).filter((legend) => !faded(legend));
    const candidates = candidatesFrom(this.beliefs, this.claims);
    for (const candidate of candidates) {
      if (!qualifies(candidate, day, this.config)) continue;
      const key = candidate.eventRefs.join(',');
      if (this.legends.some((legend) => legend.eventRefs.join(',') === key)) continue;
      const legend = formLegend(this.nextId('legend'), candidate, day);
      this.legends.push(legend);
      this.emit('legend.formed', at, { legendId: legend.legendId, eventRefs: legend.eventRefs });
    }
  }

  /**
   * 这个人可能说给谁听：只列他身边的人。
   *
   * 距离是**真实距离**，不是 1。没有这一条，候选表就是全连接图，而
   * `talkDistance = 2` 那道闸永远咬不到任何人——全村一天之内全知，
   * 正是护栏 sheet 第一行警告的那件事。
   *
   * 位置缺失的单位**不参与**传播。它们不是被禁言，是「不知道他在哪」——
   * 而世界不能假装知道他站在谁旁边。调用方接上位置之后它们自然回来。
   */
  /**
   * 这个人此刻够不够得着那个地点的痕迹。
   *
   * 地点 Holder 永远够得着自己（它就是那个地点）。人物要走到 `traceRadius` 以内。
   * 位置缺失的单位**够不着**——不是禁足，是「不知道他在哪」，而世界不能
   * 假装他从那儿路过。
   */
  private withinTraceReach(holderId: string, placeId: string): boolean {
    const holder = this.holders.get(holderId);
    if (holder === undefined) return false;
    if (holder.type === 'place') return holder.holderId === placeId;
    const from = holder.at;
    const to = this.holders.get(placeId)?.at;
    if (from === undefined || to === undefined) return false;
    return Math.hypot(from.x - to.x, from.y - to.y) <= this.config.traceRadius;
  }

  private spreadCandidates(speaker: string): SpreadCandidate[] {
    const from = this.holders.get(speaker)?.at;
    if (from === undefined) return [];
    const out: SpreadCandidate[] = [];
    for (const listener of this.holderIds()) {
      if (listener === speaker) continue;
      const to = this.holders.get(listener)?.at;
      if (to === undefined) continue;
      out.push({ speaker, listener, distance: Math.hypot(from.x - to.x, from.y - to.y) });
    }
    return out;
  }

  private beliefViews(): ReadonlyMap<string, readonly ListenerBelief[]> {
    const map = new Map<string, ListenerBelief[]>();
    for (const belief of this.beliefs) {
      const claim = this.claims.get(belief.claimId);
      if (claim === undefined) continue;
      const list = map.get(belief.holderId) ?? [];
      list.push({
        eventRefs: belief.eventRefs,
        valence: claim.content.valence,
        confidence: belief.confidence,
        sourceMode: 'heard',
      });
      map.set(belief.holderId, list);
    }
    return map;
  }

  private talkativeness(): ReadonlyMap<string, number> {
    const map = new Map<string, number>();
    for (const [id, holder] of this.holders) {
      map.set(id, holder.profile.talkativeness ?? 0.5);
    }
    return map;
  }

  private bumpFanout(holderId: string, claimId: string, day: number): void {
    if (this.fanout.day !== day) this.fanout = { day, counts: new Map() };
    const counts = new Map(this.fanout.counts);
    const key = fanoutKey(holderId, claimId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    this.fanout = { day, counts };
  }

  private whatOf(fact: WorldFact): string {
    const what = fact.outcome['what'];
    if (typeof what === 'string' && what !== '') return what;
    return DEFAULT_WHAT[fact.kind] ?? fact.kind;
  }

  private contentForFact(fact: WorldFact): MemoryContent {
    return {
      what: this.whatOf(fact),
      who: [...fact.actors],
      where: fact.placeId,
      when: fact.day,
      detailLevel: 3,
      valence: defaultValence(fact.kind),
      arousal: defaultArousal(fact.kind),
    };
  }

  private ruleMeta(holderId: string, opId: string, day: number): MemoryEntry['generatedBy'] {
    const seed = seedOf(this.worldId, day, holderId, opId);
    return { by: 'rule', rulesetVersion: RULESET_VERSION, inputHash: String(seed), seed };
  }

  private nextId(prefix: string): string {
    const id = `${prefix}_${String(this.nextSerial).padStart(4, '0')}`;
    this.nextSerial += 1;
    return id;
  }

  private nextEventId(prefix: string): string {
    return `${prefix}_${String(this.nextSerial).padStart(4, '0')}`;
  }

  private emit(kind: MemoryEvent['kind'], at: number, payload: Readonly<Record<string, unknown>>): void {
    this.emitFn?.({ kind, at, payload });
  }
}

const RULESET_VERSION = 'memory-r1';

/** 事实里没有 `what` 时，按 kind 给一句。只用于世界侧自己发的事件。 */
const DEFAULT_WHAT: Readonly<Record<string, string>> = {
  task_done: '有人交了一单活',
  celebration: '有人庆祝了一件事',
  conflict: '有人起了争执',
  milestone: '达成了一个里程碑',
  workshop_accident: '工坊里出了事故',
  expedition_done: '有人从外面回来了',
  oracle_prayer: '有人在祭坛祈祷',
  discipline: '有人被训诫了',
  visitor_arrival: '有生人进了村',
  weather_anomaly: '天气反常',
  tavern_feast: '酒馆里摆了宴',
};

function defaultValence(kind: string): number {
  if (kind === 'celebration' || kind === 'tavern_feast') return 0.8;
  if (kind === 'workshop_accident' || kind === 'conflict') return -0.7;
  if (kind === 'discipline') return -0.6;
  if (kind === 'task_done' || kind === 'expedition_done') return 0.3;
  return 0;
}

function defaultArousal(kind: string): number {
  if (kind === 'workshop_accident' || kind === 'conflict') return 0.8;
  if (kind === 'weather_anomaly' || kind === 'visitor_arrival') return 0.7;
  if (kind === 'celebration' || kind === 'tavern_feast') return 0.6;
  return 0.3;
}

function pairOf(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * 一条断言在第 `hop` 跳时的样子。
 *
 * 逐跳 retell 而不是一次算到底：`retell` 每次都要记 `distortedBy`，
 * 一次算到底只能记一条「跳了 3 跳」，而验收要的是**每一次变形都记录**。
 */
function claimAtHop(origin: Claim, hop: number, config: MemoryConfig): Claim {
  let current = origin;
  for (let index = 0; index < hop; index += 1) current = retell(current, config);
  return current;
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    eventRefs: [...entry.eventRefs] as unknown as MemoryEntry['eventRefs'],
    sourceChain: [...entry.sourceChain],
    content: { ...entry.content, who: [...entry.content.who] },
    derivedFrom: { ...entry.derivedFrom },
    generatedBy: { ...entry.generatedBy },
  };
}

/** 未被使用的类型出口，留给任务组 B 与将来的 UI。 */
export type { MemoryTier };
