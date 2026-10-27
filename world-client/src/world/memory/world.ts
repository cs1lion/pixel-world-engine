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
import {
  candidatesFrom,
  decayLegend,
  faded,
  formLegend,
  qualifies,
  reinforceLegend,
  type LegendCandidate,
} from './legend.ts';
import {
  distance,
  witnessesOf,
  type OcclusionGrid,
  type Perceiver,
  type PlaceAnchor,
} from './perception.ts';
import {
  cascadeBeliefs,
  cascadeClaims,
  cascadeLegends,
  cascadeTraces,
  deleteCascade,
  writeModeOf,
  type DeletionReport,
  type DeletionRoot,
} from './privacy.ts';
import {
  announcementReach,
  canFanout,
  canSpread,
  createClaim,
  credibilityOf,
  fanoutKey,
  pairKey,
  penalize,
  postAnnouncement,
  retell,
  spreadStep,
  trustBetween,
  type Announcement,
  type CooldownState,
  type CredibilityScores,
  type FanoutState,
  type ListenerBelief,
  type RelationshipMap,
  type SpreadCandidate,
  type Verdict,
} from './propagate.ts';
import { recall, type RecallOutcome, type RecallRequest } from './recall.ts';
import { decideWrite, inputsFor } from './salience.ts';
import { claimContentFor, compile, type UpstreamAction } from './sanitize.ts';
import { rollBelow, seedOf } from './seed.ts';
import { exposedTraces, consequenceOf, fitTraceLayers, inferenceOf, makeTrace, weatherTrace, type InferenceSpec } from './traces.ts';
import { readRecord, writeDiary, writeLetter, type WrittenRecord } from './written.ts';
import type {
  Belief,
  Claim,
  EventVoice,
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
import {
  asListenerBelief,
  beliefFrom,
  checkConflict,
  judgeVerify,
  planVerify,
  verifyAt,
  type VerifyPlan,
} from './verify.ts';
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
  /**
   * 这件事被怎么说。**`source = agent / genesis` 的事件必须给**——那是
   * 脱敏编译器自己那张表，比世界侧按 kind 的先验推更具体。
   *
   * 具体差在哪儿，说准了是这样（原先写「世界侧那张表根本没有这两行」，那是
   * 把两张表说成了一张）：
   *
   * | kind | `defaultValence` | `defaultArousal` | 编译器 |
   * | --- | --- | --- | --- |
   * | `discipline` | **有行，-0.6** | 兜底 0.3 | -0.6 / **0.7** |
   * | `oracle_prayer` | 兜底 0 | 兜底 0.3 | 0 / **0.4** |
   *
   * 差的全在**唤醒度**一列，而且只在这两个 kind 上；五个 kind 的效价
   * **一列都不差**。所以这句话该说成「`defaultArousal` 没有这两行」，
   * 不是「那张表没有这两行」。表里那两行是拿公开 API 量出来的：
   * `observe` 一个不带 `voice` 的事件，读它落下来的 `content.arousal`。
   *
   * 别顺手把这两行补进 `defaultArousal`：这两个 kind 只有 `compile()` 产出
   * （`grep -rn "discipline\|oracle_prayer" src | grep -v sanitize.ts`，
   * 剩下的命中是 `salience.ts` 的先验表与这两张兜底表自己），世界侧没有
   * 发出方，补了就是给不发生的路径加行。而 `ingestUpstream` 无条件给
   * `voice`，所以**跑着的世界**走不到这条兜底。
   *
   * 但「走不到」只到「没人这么发」为止，**门是开着的**：`observe` 收的是
   * 一个 `kind: string`，谁来敲一个 `'discipline'` 它都落 0.3。所以这不
   * 是一条够不着的兜底，是一条**没人走的兜底**——留着不补，是留着
   * 「世界侧哪天真要发一条训诫，这里会静悄悄地给它 0.3」这个记号。
   */
  readonly voice?: EventVoice;
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

    const written: string[] = [];
    // 三级取值：显式给的 > 编译器给的 > 按 kind 先验推。
    // 中间那一级不能漏——漏了它，`makeEpisodic` 会用先验值盖掉编译器定的性，
    // 于是同一条上游事件的记忆是 0.3、断言是 0.7，一件事两个版本。
    const valence = input.valence ?? input.voice?.valence ?? defaultValence(input.kind);
    const arousal = input.arousal ?? input.voice?.arousal ?? defaultArousal(input.kind);

    // **生效的那一版要落进事实里**，不能只在这个函数里用一次。
    //
    // 原来这里存的是 `input.voice` 原样，于是调用方显式给的 `valence` 进了
    // 显著度（`inputsFor`）与痕迹强度（`depositTraces`），却没有进事实本身。
    // 事后任何读 `contentForFact(fact)` 的人——断言的内容、以及碑文继承的
    // 效价——都只拿得到 kind 先验值。结果就是：目击者的记忆是 0.6，
    // 同一条事件的断言是 0，读碑文的人也是 0。一件事三个版本，
    // 而上面那条注释防的正是这个。
    //
    // `what` 与 `detailLevel` 也一并解析掉：`whatOf` 是先看 `outcome.what`
    // 再看 `voice.what`，把先验句填进来不改变它的结果（`outcome` 优先），
    // 但省得以后有人以为 `voice.what` 空着就等于「没有定过性」。
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
      voice: {
        what: input.voice?.what ?? DEFAULT_WHAT[input.kind] ?? input.kind,
        valence,
        arousal,
        detailLevel: input.voice?.detailLevel ?? 3,
      },
    };
    this.facts.set(fact.eventId, fact);

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

    this.birthClaim(fact, written, input.at);

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
    // 编译器的定性一路带进世界。**早先这里把 `valence` / `arousal` 显式传成
    // `undefined`**，于是上游事件的情绪落回 `defaultValence` / `defaultArousal`
    // 那两张世界侧的兜底表。差的是唤醒度那一列：`defaultArousal` 没有
    // `discipline`（0.7）与 `oracle_prayer`（0.4）两行，兜底给 0.3，于是
    // `COMPILE_TABLE` 上写着「高唤醒」的训诫，进世界时唤醒度是通用的 0.3。
    // `claimContentFor` 的 `what` 也一并不被读取：上游事件说的是
    // 「有人被训诫了」，不是「有人在祭坛被训诫了」。
    // （效价那一列原来也是这么说的，那半句已经过期：`defaultValence`
    // 现在有 `discipline` → -0.6 这一行。详见 `EventVoice` 上那张对照表。）
    const voice = claimContentFor(compiled);
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
      voice,
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
   *
   * **今天只有一个测试调用它**（`test/memory-written.test.ts`），`MemoryRuntime`
   * 也没有转发它的方法——村民对话系统整个不存在，`src/` 里记忆层之外
   * `dialogue` 一次都没出现。所以 `dialogueTopK` 是「有读出点、没调用链」，
   * 不是死数。整条读链的形状见 `recall.ts` 文件头。
   */
  recallForDialogue(
    holderId: string,
    request: Omit<RecallRequest, 'holderId' | 'budgetK'>,
  ): RecallOutcome {
    return this.recallFor(holderId, { ...request, budgetK: this.config.dialogueTopK });
  }

  // -------------------------------------------------------------- 传播

  /**
   * 一条事件进来之后，断言在谁嘴里诞生。
   *
   * **这是传播层的地基。** `diffuseDay` 遍历的是 `this.claims`，而断言原本
   * 只有测试手工调用 `createClaimFrom` 才会存在——于是跑着的世界里这一层
   * 永远是空的：三天下来零次交谈、熵恒为 0、所有人被算成孤立。交谈、广播、
   * 书面、求证四条通道全都建在它上面，所以它们一起是死的，而且不报错。
   *
   * 三条规则，都不调模型：
   *
   * 1. **得有人真的记住了它。** 一条没人当回事的事不会有人去讲。所以断言的
   *    诞生门槛不是显著度（那是逐人的），而是「至少有一个目击者把它写进了
   *    记忆」——`written` 非空。
   * 2. **断言诞生在目击者身上，不在事件身上。** 起源者是按 `witnesses` 顺序
   *    第一个真正写下了记忆的人。楼不算：`place` Holder 记得痕迹，但它不开口。
   * 3. **一件事只诞生一条断言。** 重复 `ingest` 同一个 `eventId`，或者调用方
   *    已经手工 `createClaimFrom` 过，都不再生成第二条——否则同一天里
   *    同一个事件会有两种说法在村里并行流传，而它们本该是同一句话的两个版本。
   *
   * `private_to_player` 不诞生断言：那是玩家自己的事，村里的单位没有版本可讲。
   * （`sanitized` 事件照常诞生——它进世界时已经被编译成脱敏版本了。）
   */
  private birthClaim(fact: WorldFact, written: readonly string[], at: number): void {
    if (written.length === 0) return;
    if (fact.visibility === 'private_to_player') return;
    if (this.claimOfEvent(fact.eventId) !== undefined) return;
    const origin = written
      .map((memoryId) => this.entries.find((entry) => entry.memoryId === memoryId))
      .find((entry) => entry !== undefined);
    if (origin === undefined) return;
    this.createClaimFrom(fact.eventId, origin.holderId, at);
  }

  /** 这个事件已经有断言了吗。按 `eventRefs` 找，不按 id 猜。 */
  private claimOfEvent(eventId: string): Claim | undefined {
    for (const claim of this.claims.values()) {
      if (claim.eventRefs.includes(eventId)) return claim;
    }
    return undefined;
  }

  /**
   * 造一条断言。断言诞生在目击者身上。
   *
   * `claim.created` 事件照发，但**不调模型**：内容直接取自事件的结构化字段。
   *
   * **一件事只有一条断言。** 已经有了就原样返回，不再发第二次
   * `claim.created`。这条不是防重的小聪明：同一个事件如果同时挂着两条断言，
   * 它们会各自扩散、各自算覆盖率，而 `coverage_curve` 的分母是一个事件——
   * 同一件事在村里有两个「版本」同时流传，正是协议想避免的那种重复。
   * 不同的讲法由 `retell` 的逐跳变形表达（`hop` 与 `sourceChain`），
   * 不是由第二条断言表达。
   *
   * 先到先得也适用于 `secret`：第一次诞生时不是秘密，后来再有人想把它
   * 标成秘密，不会成功——秘密是断言出生时的属性，不是谁都能事后盖的章。
   */
  createClaimFrom(eventId: string, originHolderId: string, at: number, secret = false): Claim | null {
    const existing = this.claimOfEvent(eventId);
    if (existing !== undefined) return existing;
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
            credibility: this.credibility,
            beliefs: this.beliefViews(),
            talkativeness: this.talkativeness(),
            cooldowns: this.cooldowns,
            nowMs: at,
            config: this.config,
          });
          for (const step of steps) {
            if (!canFanout(this.fanout, step.from, claimId, day, this.config)) break;
            const pair = pairKey(step.from, step.to);
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
   *
   * **这一路在跑着的世界里是断的，两头都断。** 扫一遍（`grep -rn "\.writeLetter(" src`）
   * 可知：`writeLetter` 与 `readWritten`、`writtenOf` 在 `src/` 里一个调用方都没有，
   * 层内也没有。而五类通道里另外四类都有生产方——直接感知走 `observe`/`ingest`，
   * 对话走 `diffuseDay`，广播走 `postDailyReport`，痕迹随 `ingest` 落。所以书面通道
   * 是**半接**的：日记那一半由 `dayClosed` → `writeDailies` 天天在产，书信那一半
   * 从来没有被触发过一次，`kind: 'letter'` 在跑着的世界里一次都没落过地。
   *
   * 没有替它接上，是因为补设计 §3.2 那一行只规定了书面通道的**参数**（`letterClaims`
   * 一条、去档案室主动查阅、慢、最高保真）与**权限**（收发双方），没有一个字说
   * 「什么时候该有人写信」。对照广播：那一行明写了三方发布权，其中「系统日终日报」
   * 不需要生成逻辑，所以 `postDailyReport` 接得上。书信缺的正是这个「谁该写」的判据，
   * 而它是外环的事。出口留着，不假装它接着。
   *
   * 顺带两处贴错的事件标签，病根同一个——`MemoryEventKind` 那个闭集里，写侧只有
   * `diary.written`、读侧只有 `announcement.read`，书信被塞进了这两格，而协议 §13
   * 那张表本来就没有书信事件：
   * - 本函数发的竟是 `'diary.written'`。写一封信，报的是「有人写了一篇日记」。
   *   `memory-diary.test.ts` 里「两天两条」那条断言能过，只因为那个测试里恰好没有信。
   * - `readWritten` 发的是 `'announcement.read'`。读一封信，报的是「有人读了一条公告」。
   * 要修就得往闭集里加 `letter.written` / `written.read` 两格——那是 taxonomy 决定，
   * 而归将来接这条流的人（今天它一个消费方都没有，见 `MemoryEventKind` 上那张表）。
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
   * 集体记忆：活着的与淡去的传说。
   *
   * 不挂在 `HolderView` 上——传说不是任何一个单位的记忆，它挂在事件上。
   * 但世界得能读它：协议第 12 节要验「同一事件的断言被足够多的人持有」，
   * 而 `reach` 是这个世界上唯一会自己涨自己跌的数，不给读就没法验。
   *
   * 返回拷贝：调用方改了它，表里不受影响。
   */
  legendsOf(): readonly Legend[] {
    return this.legends.map((legend) => ({ ...legend }));
  }

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
      // 碑文的效价继承它绑着的那个事件（见 `traceValence`）。别的痕迹照表里的来。
      const valence = this.traceValence(trace, spec);
      // 回报出去的也是**生效的那份**：调用方拿它去挂牌子，牌子上写的情绪
      // 得跟落进记忆的是同一个。原来这里原样push 表里那一行，于是碑文
      // 「说」出来是 0，写下去是 0.6——同一个函数两个口径。
      out.push(valence === spec.valence ? spec : { ...spec, valence });
      // 同一个人、同一处、同一类痕迹，只落一条记忆。
      //
      // `deliver` 靠「已经有这条信念了」保证一句话只被收下一次；痕迹通道
      // 这边原来没有任何等价物——`lookAtTraces` 每调一次就多写一条，而
      // 唯一的调用方（SandboxScene）是拿自己那张 `seenToday` 表挡住的。
      // 账本自己不认这条性质，换个调用方就原形毕露：一个人站在门口不动，
      // 每拍都重新推断同一道焦痕，一天下来记忆库被同一条痕迹灌满，而痕迹
      // 的价值恰恰在于稀少。
      //
      // **回报照旧给。** 看得见与记下来是两件事：重复调用仍然拿得到这条
      // 痕迹，调用方因此照旧知道「今天看过了」。要是改成返回空数组，
      // 调用方便永远学不会这件事，于是每拍都来问一遍。
      const already = this.entries.some(
        (entry) =>
          entry.holderId === holderId &&
          entry.content.where === placeId &&
          entry.content.what === spec.what &&
          entry.sourceMode === spec.sourceMode,
      );
      if (already) continue;
      const content: MemoryContent = {
        what: spec.what,
        who: [],
        where: placeId,
        when: Math.floor(at / this.config.dayMs),
        detailLevel: spec.detailLevel,
        valence,
        arousal: spec.arousal,
      };
      const entry: MemoryEntry = {
        memoryId: this.nextId('m'),
        holderId,
        // 照表里那一行的来，不一律写 `episodic`：磨损小径推出来的是 `habit`
        // （§1.2 第三行），它记的是「这里一直有人来」，不是「那天我看见了一道痕」。
        kind: spec.kind,
        tier: 'day',
        eventRefs: [trace.eventRef],
        sourceMode: spec.sourceMode,
        sourceChain: [],
        content,
        salience: spec.confidence * 0.6 + Math.abs(valence) * 0.4,
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
    /** 被升级成 `witnessed` / `read` 的记忆 id。求证没成就是空数组。 */
    readonly upgradedMemoryIds: readonly string[];
  } {
    const claim = this.claims.get(claimId);
    if (claim === undefined) {
      return { outcome: 'inconclusive', debunkedSpeaker: null, upgradedMemoryIds: [] };
    }

    const announcementClaims = this.announcements
      .filter((item) => item.placeId === placeId)
      .map((item) => item.claim);
    const verdict = judgeVerify(
      { traces: this.traces.get(placeId) ?? [], announcementClaims },
      claim,
    );
    const outcome = verdict.outcome;

    const state = outcome === 'confirmed' ? 'confirmed' : outcome === 'debunked' ? 'debunked' : 'suspicious';
    this.beliefs = this.beliefs.map((belief) =>
      belief.holderId === holderId && belief.claimId === claimId ? { ...belief, state } : belief,
    );

    // 求证成功还有后半句，见 `upgradeOnVerify`。**先升级再报事件**：一条
    // `belief.updated` 把「信念变了」和「记忆也变了」一起说清。反过来先报，
    // 回放的人会先看到信念已证实、而记忆还是 `heard` 打折后的那一版。
    // `upgradedMemoryIds` 只在求证这一路上有：求证没成就是空数组——
    // 「跑了一趟，但没有听说记忆可升」本身也是个结果。
    const upgraded =
      outcome === 'confirmed' && verdict.evidence !== null
        ? this.upgradeOnVerify(holderId, claimId, verdict.evidence)
        : [];
    this.emit('belief.updated', at, { holderId, claimId, state, upgradedMemoryIds: upgraded });

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
    return { outcome, debunkedSpeaker, upgradedMemoryIds: upgraded };
  }

  /**
   * 求证成功之后，听说来的那条升级成亲眼或亲读。
   *
   * 补充设计 §1.1 第 3 步的后半句：「若在事发地目击到对应的物质痕迹，或在公告栏
   * 读到官方通告，则将原 `heard` 记忆升级为 `witnessed / read`，置信度拉满」。
   * 原先这一句一处都没有——只有前半句（辟谣、可靠度下调 0.15）落了地。全仓
   * `sourceMode` 与 `confidence` 都只在条目**诞生**时写一次，之后再也不改，
   * 于是跑完一趟求证，他的记忆仍旧是 `heard`、可信度还是跳数打折后的那个数。
   * 「他亲自去现场看过」这件事在世界里没有留下任何痕迹。
   *
   * 痕迹定的案升 `witnessed`（他到过现场，看见的是物质），公告定的案升 `read`
   * （他读到的是记录）。`sourceChain` 一并清空：那个字段的定义是「heard 时的
   * 来源链」，一条 `witnessed` 却挂着三层转述的条目自己和自己矛盾。
   *
   * 只升 `heard` 的。已经 `witnessed` 的不用升；`inferred` 是从痕迹推出来的，
   * 不是听说，也不该被这条路改动——他从没信过任何人，他只是看见了地上的东西。
   *
   * 不挑 `claimIds` 里只有这一条的：同一条断言常常派生出好几段说法（当面讲的、
   * 广播听的），它们都是同一个传闻，一起升。
   */
  private upgradeOnVerify(
    holderId: string,
    claimId: string,
    evidence: 'trace' | 'announcement',
  ): readonly string[] {
    const sourceMode = evidence === 'announcement' ? 'read' : 'witnessed';
    const upgraded: string[] = [];
    this.entries = this.entries.map((entry) => {
      if (entry.holderId !== holderId) return entry;
      if (entry.sourceMode !== 'heard') return entry;
      if (!entry.derivedFrom.claimIds.includes(claimId)) return entry;
      upgraded.push(entry.memoryId);
      return { ...entry, sourceMode, confidence: 1, sourceChain: [] };
    });
    return upgraded;
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
    this.weatherTraces(closedDay);

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

    // 日报先贴，传说后算：公告也是一条「有人知道了」的路，而传说分不出
    // 也不该分他是从公告栏知道的还是从邻居那儿听来的。
    this.postDailyReport(closedDay, at);
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

  /**
   * 删一个根，沿五条库一路清下去。
   *
   * 协议第 15 节第 1 条点名的派生物是五样：**记忆、摘要、信念副本、痕迹、
   * 传说**。原先这里只调了 `deleteCascade`，另外四样一样没碰，而
   * `counts.traces` / `counts.legends` 是**写死的 0**、`counts.claims` 是
   * `root.kind === 'claim' ? 1 : 0` 拍出来的——于是 `memory.deleted` 事件
   * 向外面汇报「清了两条记忆，别的一切正常」，而实际上别的一样没看。
   *
   * 实测（10 人村、一件全员目击的大事、跑 7 天）删完之后：
   * 11 条信念还挂着那个 `event_ref`（村里每人嘴里还当它真）、
   * 1 道焦痕还在（`lookAtTraces` 照旧从它推断出事故并写成新记忆）、
   * 1 条传说的 `eventRefs` 还指着它、`createClaimFrom` 对同一个事件
   * **照样成功**——删掉的事实在靠四条通道同时复活。
   *
   * 顺序有讲究：先摘记忆（`deleteCascade` 要读 `derivedFrom`），再清另外
   * 四库，最后拿掉事件根本身。事实一拿走，`createClaimFrom` 自己就返回
   * `null` 了——§15 末行「不得再次被整理写回」不用另立一道闸。
   */
  delete(root: DeletionRoot): DeletionReport {
    const cascaded = deleteCascade(this.entries, root);
    this.entries = [...cascaded.entries] as MemoryEntry[];

    const beliefs = cascadeBeliefs(this.beliefs, root);
    this.beliefs = [...beliefs.beliefs] as Belief[];

    // 痕迹按地点分库存。删一个事件只动它落过的那些地方，别处的 stack 不动。
    let tracesRemoved = 0;
    for (const [placeId, layers] of this.traces) {
      const next = cascadeTraces(layers, root);
      if (next.removed.length === 0) continue;
      tracesRemoved += next.removed.length;
      this.traces.set(placeId, [...next.layers]);
    }

    const legends = cascadeLegends(this.legends, root);
    this.legends = [...legends.legends] as Legend[];

    const claims = cascadeClaims([...this.claims.values()], root);
    for (const claimId of claims.removed) this.claims.delete(claimId);

    // 事件根才拿事实。记忆与断言被删时，别的事件还好好在那儿。
    if (root.kind === 'event') this.facts.delete(root.id);

    const counts = {
      memories: cascaded.report.removedMemoryIds.length,
      summaries: cascaded.report.redactedMemoryIds.length,
      beliefs: beliefs.removed.length,
      claims: claims.removed.length,
      traces: tracesRemoved,
      legends: legends.removed.length + legends.stripped.length,
    };
    this.emit('memory.deleted', this.currentDay * this.config.dayMs, { rootId: root.id, counts });
    return { ...cascaded.report, counts };
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
    // 内容走 `contentForFact`，**不再在这里重抄一遍**。早先这两处各写一份
    // 同样的五字段字面量，于是给上游事件接上编译器的定性时只改一处——
    // 记忆条目换了说法，断言还是老说法，同一件事两个版本。
    let content: MemoryContent = {
      ...this.contentForFact(fact),
      detailLevel: extra.detailLevel,
      valence: extra.valence,
      arousal: extra.arousal,
    };
    // **可见性在这里落。** `writeModeOf` 写好很久了，但从来没有人调过它——
    // 于是 `private_to_player` 事件的明文（上游的文件名、密钥、邮件正文）
    // 原样落进记忆，而 `privacy.ts` 的文件头一直说它被处理了。
    //
    // 两档抽象化，**只降细节，不删条目**：
    //
    // - `sanitized`：`outcome` 进世界之前已经被 `compile()` 洗过（`harvest`、
    //   `retries`、`blessing` 这些是世界语汇），照用。它的问题只是「说得太细」，
    //   所以只压 `detailLevel`，不碰 `what`。
    // - `private_to_player`：`outcome` **没洗过**，一个字都不许取。用事件类型
    //   的先验句子顶上——「有人做了件事」是允许的，「他改了哪个文件」不是。
    //
    // 早先两档被我一视同仁地压成先验句子，`sanitized` 的语义就丢了：斥候带回来
    // 什么、炸了几次炉，本来都是脱敏后的世界事实，压掉等于白编译一遍。
    const mode = writeModeOf(fact, false);
    if (mode === 'abstracted') {
      content = {
        ...content,
        what:
          fact.visibility === 'private_to_player'
            ? (DEFAULT_WHAT[fact.kind] ?? '有人做了件事')
            : content.what,
        who: [],
        detailLevel: 1,
      };
    }
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
    this.rememberTold(to, claim, from, at);
    this.tells.push({ day: this.currentDay, from, to, claimId: claim.claimId });
    // 逐话题冷却（同一对单位、同一条断言）在这里记。闲聊冷却由
    // `diffuseDay` 在整场交谈结束时记——它记的是「聊过」这件事，不是某一条。
    this.cooldowns = [
      ...this.cooldowns,
      { pairKey: pairKey(from, to), claimId: claim.claimId, atMs: at },
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
    // 形状由 `beliefFrom` 定，不在这儿另写一遍。它的注释说「存疑信念与采信
    // 的区别只在 state 与日程上，形状是同一个」——那句话只有真的共用同一个
    // 构造器才作数；两边各写一份字面量的话，「同一个形状」只是个愿望。
    const belief = beliefFrom(holderId, claim, sourceHolderId, Math.floor(at / this.config.dayMs), state);
    this.beliefs = [...this.beliefs.filter((item) => !(item.holderId === holderId && item.claimId === claim.claimId)), belief];
    this.emit('belief.updated', at, { holderId, claimId: claim.claimId, state });
    return belief;
  }

  /**
   * 听说一件事，就记下它——`source_mode = heard` 的条目在这里诞生。
   *
   * 协议第 6 节末行：「听说类记忆走传播协议：单位收到 `ClaimTold` 并更新信念后，
   * 生成 source_mode = heard 的条目。」而 `deliver` 原先只写一条 `Belief`。
   * 实测：一条事故在 10 人的村里传到第 7 个人，7 个人都「知道」这件事，
   * **只有目击者本人有一条记忆**，另外 6 个人的记忆库是空的。
   *
   * 后果不止「记不住」这么轻。补充设计 §1.1 的求证闭环第 1 步是「单位收到
   * `ClaimTold`（准备生成 heard 记忆）时，检索自身记忆库中是否存在相同
   * `event_refs` 或同地点同日的高置信度记忆」——`checkConflict` 读的正是这个
   * 单位的记忆条目。heard 条目从来不存在，于是冲突检测只能拿目击者自己的
   * 记忆去比对，「听来的说法和我亲眼看见的不一样」这条触发路径一次都没走过。
   *
   * 显著度走目击者那条同一条路（`inputsFor` → `decideWrite`），阈值也是同一个
   * `T_write`：世界只有一个写入门槛，没有两个。`involvement` 天然偏低——
   * 他不是当事人，`inputsFor` 按 `actors` 判，用不着为传闻另立一个数。
   * 于是同一件事亲历者记得比听说者牢，而这道差是算出来的，不是写死的。
   * 过不了门槛的传闻照旧变成信念（他听说了），只是不落成记忆。
   */
  private rememberTold(holderId: string, claim: Claim, from: string, at: number): void {
    const holder = this.holders.get(holderId);
    if (holder === undefined || holder.type !== 'character') return;
    const eventRef = claim.eventRefs[0];
    if (eventRef === undefined) return;
    const fact = this.facts.get(eventRef);
    if (fact === undefined) return;

    const parts = inputsFor({
      kind: fact.kind,
      holderId,
      actors: fact.actors,
      importanceHint: fact.importanceHint,
      valence: claim.content.valence,
      arousal: claim.content.arousal,
    });
    const weights = weightsFor(this.config.salienceWeights, holder.profile, this.config.salienceBias);
    const decision = decideWrite(weights, parts, this.config.T_write);
    if (!decision.write) return;

    const day = Math.floor(at / this.config.dayMs);
    const entry: MemoryEntry = {
      memoryId: this.nextId('m'),
      holderId,
      kind: 'episodic',
      tier: 'day',
      eventRefs: claim.eventRefs,
      sourceMode: 'heard',
      sourceChain: this.toldChainOf(from, claim, eventRef),
      content: {
        what: claim.content.what,
        who: claim.content.who,
        where: claim.content.where,
        when: claim.content.when,
        // 细节照断言上的来：`retell` 每跳降一级，三跳的传闻进来就是 0 级。
        // 这里不再压一次——压两次就成了「传闻永远说不清」，而保真度曲线
        // 要的是跳数与细节一一对应。
        detailLevel: claim.content.detailLevel,
        valence: claim.content.valence,
        arousal: claim.content.arousal,
      },
      salience: decision.salience.salience,
      // 可信度照断言上的来，不再乘一次信任。说话人可不可信已经算进断言的
      // `confidence` 里了（`hopConfidenceFactor` 逐跳打折），在这儿再打一次
      // 就是把同一个因素算两遍。
      confidence: claim.confidence,
      strength: 1,
      createdDay: day,
      lastRecalledDay: day,
      recallCount: 0,
      flashbulb: decision.salience.salience >= this.config.T_flash,
      pinned: false,
      redacted: false,
      // 这条记忆是断言的副本，删断言时它该跟着走（`matchesRoot` 查的正是它）。
      derivedFrom: { memoryIds: [], claimIds: [claim.claimId] },
      generatedBy: this.ruleMeta(holderId, eventRef, day),
      archived: false,
    };
    this.entries.push(entry);
    this.emit('memory.written', at, {
      memoryId: entry.memoryId,
      holderId,
      eventRefs: entry.eventRefs,
      salience: entry.salience,
    });
  }

  /**
   * 这一条听来的记忆，来源链长什么样。
   *
   * 协议第 4 节只要求「claim_id 与前手 holder_id」——最少是 `[claimId, from]`。
   * 而 `types.ts` 上那句「谁告诉我的，他又是听谁的」要的是整条链。
   *
   * 链**不从断言上取**。`Claim.sourceChain` 那条链只有诞生那一节：`retell`
   * 只加 `hop` 不加链节，拿它拼出来的链三跳之后还是一个名字。断言是全村
   * 共享的，链挂在它上就长不起来（`types.ts` 上那段说清了为什么）。
   *
   * 从**人**上取：说话人对同一件事也有一条听来的记忆，把他的链接在我前面，
   * 我排在最后。于是一跳是 `[claim, 讲的人]`，三跳是 `[claim, 甲, 乙, 讲的人]`
   * ——每多一跳链条真长一节，这才叫「他又是听谁的」。领头的 claimId 在每一级
   * 都重写一次，所以拼之前先把说话人那条的前头去掉。
   */
  private toldChainOf(from: string, claim: Claim, eventRef: string): readonly string[] {
    const speaker =
      this.entries.find(
        (entry) =>
          entry.holderId === from && entry.eventRefs.includes(eventRef) && entry.sourceMode === 'heard',
      ) ??
      this.entries.find((entry) => entry.holderId === from && entry.eventRefs.includes(eventRef));
    const upstream = speaker === undefined ? [] : speaker.sourceChain.slice(1);
    return [claim.claimId, ...upstream, from];
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

  /**
   * 日终日报：把今天最重大的一件事贴到公告栏，让够得着的人读到。
   *
   * 五类通道里的**广播**在这之前没有生产方：`postAnnouncement` 与
   * `readAnnouncement` 在测试之外一个调用方都没有，`announcementReach`
   * 只被它自己读。于是「官方渠道」这句话在跑着的世界里是假的——而
   * `latency_ratio` 那条指标（公告 ≤ 0.5 天 vs 传言 1.5–2.5 天）少了一半。
   *
   * 补充设计 §3.2 的定稿表把发布权留给三方：玩家（神明）、村长（Planner）、
   * **系统日终日报**。前两方都不在本组边界内——神明的入口是
   * `ingestUpstream`，Planner 属于造物主/导演那一节。所以这里只做第三方，
   * 而它恰好是唯一不需要任何生成逻辑的那一方：日报贴什么，是**从已经发生
   * 的事情里挑**，不是编一件新的。
   *
   * 挑法：今天诞生的断言里，取其起源者写下那条记忆的显著度最高的一条。
   * 显著度是这个世界自己的注意力，不是谁的偏好。同分按 claimId 取先——
   * 同一份存档跑两遍，贴上去的是同一张。
   */
  private postDailyReport(day: number, at: number): void {
    const claim = this.reportClaimOf(day);
    if (claim === null) return;
    // 公告栏得有地方站。地点 Holder 不在名册里（或没有落点）就没有广播——
    // 世界不能假装那儿立着一块板子。
    const board = this.holders.get(claim.content.where)?.at;
    if (board === undefined) return;

    const announcement: Announcement = {
      announcementId: this.nextId('notice'),
      claim,
      postedDay: day,
      placeId: claim.content.where,
      // 日报没有「人」作者。写 'system' 而不是某个村民：今天最重大的事
      // 不见得是村长经历的，而公告的可信度来自渠道，不来自发言人。
      poster: 'system',
    };
    if (!this.postAnnouncement(announcement)) return;

    // 读到的人才算被触达。范围 4 格，不看遮挡——公告栏立在明处。
    // 没有位置的人不在听众里：不知道他在哪，就不能假装他路过了一块板子。
    const listeners = this.holderIds()
      .filter((holderId) => this.holders.get(holderId)?.type === 'character')
      .map((holderId) => ({ holderId, at: this.holders.get(holderId)!.at }))
      .filter((listener): listener is { holderId: string; at: { x: number; y: number } } => listener.at !== undefined)
      .map((listener) => ({ holderId: listener.holderId, distance: distance(board, listener.at) }));
    for (const holderId of announcementReach(listeners, this.config)) {
      this.readAnnouncement(holderId, announcement.announcementId, at);
    }
  }

  /** 今天最值得贴上公告栏的那条断言。没有就返回 `null`——安静的一天没有新闻。 */
  private reportClaimOf(day: number): Claim | null {
    let best: { claim: Claim; salience: number } | null = null;
    for (const claim of [...this.claims.values()].sort()) {
      if (claim.createdDay !== day) continue;
      const entry = this.entries.find(
        (item) =>
          item.holderId === claim.originHolderId &&
          item.eventRefs.some((ref) => claim.eventRefs.includes(ref)),
      );
      if (entry === undefined) continue;
      if (best === null || entry.salience > best.salience) best = { claim, salience: entry.salience };
    }
    return best?.claim ?? null;
  }

  /**
   * 这条传说今天被讲给了几个人听。
   *
   * 按「今天新落地的信念」数，不按某一条通道数：交谈、公告、书信、
   * 痕迹推断都是「有人知道了」，而传说分不出也不该分他是从哪知道的。
   * 按人去重——同一天从两个渠道听说，只算一次「今天有人讲」。
   *
   * 这里数的是**昨天之后**新增的听众，所以一条刚形成的传说（reach 已经
   * 等于持有者数）不会在同一天又被自己喂一次。
   */
  private toldToday(legend: Legend, day: number): number {
    const holders = new Set<string>();
    for (const belief of this.beliefs) {
      if (belief.learnedDay !== day) continue;
      if (!belief.eventRefs.some((ref) => legend.eventRefs.includes(ref))) continue;
      holders.add(belief.holderId);
    }
    return holders.size;
  }

  /**
   * 日终风化：每道痕迹按自己的层掉一天可见度。
   *
   * 协议第 11 节：「风化只降低可见度，不删除记录。」所以这里**从不删**，
   * 连 `visibility` 归零的也留着——它只是不再出现在 `exposedTraces` 里，
   * 但 `eventRef` 还在，地点 Holder 还追得到「这里发生过什么」。
   *
   * **当天新落的痕迹不风化。** 中午炸的炉子，第二天早上路过的人该看见
   * 完整的焦痕。少了这个判断，痕迹落地当天的日终就先掉一天——一条
   * `garland`（0.30/天）会在它被看见之前就短了一截，而「今天刚办过庆典」
   * 正是它唯一想说的那句话。
   */
  private weatherTraces(day: number): void {
    for (const [placeId, traces] of this.traces) {
      const weathered = traces.map((trace) => (trace.createdDay >= day ? trace : weatherTrace(trace)));
      this.traces.set(placeId, weathered);
    }
  }

  private updateLegends(day: number, at: number): void {
    // **先补后削，淡去的不补。** 「靠传播维持」四个字在这里落地：今天有几个人
    // 听说，活着的传说 reach 就加几个；一整天没人讲，才掉 1。
    //
    // 少了补这一句，`reinforceLegend` 一个调用方都没有，而传说只淡不长。
    // 实测：一条 reach=7 的传说此后每天准掉 1（7,6,5,4,3,2），到 1 淡去，
    // 然后**当天就从信念库里重新形成一条 reach=7 的**，再掉 6 天。于是
    // `legend.formed` 每 6 天响一次，永远响下去——那不是集体记忆的生死，
    // 那是一台节拍器，而「无人讲则淡去」这句话一次都没应验过。
    //
    // 而**淡去的传说不删**：`faded` 就是 `reach <= 1`，`decayLegend` 又把
    // reach 夹在 0，所以淡去这件事写在记录自己身上，不需要另立一个 flag。
    // 删掉它，下面那段 Formation 当天就看见同样的信念、当场再造一条一模一样的
    // （除了 id）。留着它，它继续占着这个事件——这才是「淡去不是删除」。
    this.legends = this.legends.map((legend) =>
      faded(legend) ? legend : reinforceLegend(legend, this.toldToday(legend, day)),
    );
    this.legends = this.legends.map(decayLegend);
    const candidates = candidatesFrom(this.beliefs, this.claims);
    for (const candidate of candidates) {
      if (!qualifies(candidate, day, this.config)) continue;
      const key = candidate.eventRefs.join(',');
      // 有过传说就不再生成了——淡去的也算有过。它是这条传说的晚年，
      // 不是另一条传说的童年。
      if (this.legends.some((legend) => legend.eventRefs.join(',') === key)) continue;
      const legend = formLegend(this.nextId('legend'), candidate, day);
      this.legends.push(legend);
      this.emit('legend.formed', at, { legendId: legend.legendId, eventRefs: legend.eventRefs });
      this.inscribe(legend, candidate, at);
    }
  }

  /**
   * 传说立起来的那一刻，给它涉及的每个人刻一条 `legend` 层的记忆。
   *
   * `MemoryTier` 一直列着 `'legend'`，`tierFactor.legend = 0.05`、
   * `limitFor('legend') = Infinity` 也早就配好了——**而没有任何一处写出过
   * 这个层的条目**。于是「淡去不是删除，它降到 legend 层之后衰减系数只有
   * 0.05，能撑很久」这句话的后半截在代码里是空的：碑文从来没有被刻过，
   * 那两个数一次都没用过。
   *
   * 下游全是现成的：`consolidateHolder` 按 `tierFactor[entry.tier]` 衰减，
   * `trimBudget` 对 legend 层不设上限。缺的只是**谁写第一笔**。
   *
   * 只写给形成时持有它的那几个人。后来才听说的人照旧只有一条普通信念——
   * 碑文是世界对这件事的记录，不是每个人各自的一份。
   */
  private inscribe(legend: Legend, candidate: LegendCandidate, at: number): void {
    for (const holderId of candidate.holders) {
      const entry: MemoryEntry = {
        memoryId: this.nextId('m'),
        holderId,
        kind: 'episodic',
        tier: 'legend',
        eventRefs: legend.eventRefs,
        // 碑文的来历是「大家都这么说」，不是某一个人告诉我的。
        sourceMode: 'heard',
        sourceChain: [],
        content: {
          // 几种讲法都刻上：传说的价值恰在于同一件事有几种说法。
          what: candidate.variants.join('；'),
          who: [],
          where: legend.homePlaceId,
          when: legend.formedDay,
          detailLevel: 3,
          valence: candidate.valence,
          arousal: candidate.arousal,
        },
        salience: 1,
        confidence: 1,
        strength: 1,
        createdDay: legend.formedDay,
        lastRecalledDay: legend.formedDay,
        recallCount: 0,
        flashbulb: false,
        // **不钉**。钉住会让 `consolidateHolder` 把它整个跳过衰减
        // （`exempt = flashbulb || pinned`），于是 `tierFactor.legend = 0.05`
        // 这个数又成了没人用的摆设——「衰减系数只有 0.05，能撑很久」的
        // 后半截再次落空。碑文该慢，不该停：0.15 × 0.05 = 每天掉 0.75%，
        // 一百天后还剩一半，这才是「撑很久」。
        pinned: false,
        redacted: false,
        derivedFrom: { memoryIds: [], claimIds: [] },
        generatedBy: this.ruleMeta(holderId, 'legend', legend.formedDay),
        archived: false,
      };
      this.entries.push(entry);
      this.emit('memory.written', at, {
        memoryId: entry.memoryId,
        holderId,
        eventRefs: entry.eventRefs,
        salience: entry.salience,
        tier: 'legend',
      });
    }
  }

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
      // 走 `asListenerBelief`，不在这儿另写一遍字面量。那个函数早就写好了，
      // 注释也说它是给 `judge` 用的——而这里手抄了一份。两份抄在同一处文件里
      // 意味着改一处忘一处：哪天 `judge` 多看一个字段，传播会静默地不喂它。
      const view = asListenerBelief(belief, this.claims.get(belief.claimId));
      if (view === null) continue;
      const list = map.get(belief.holderId) ?? [];
      list.push(view);
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
    return fact.voice?.what ?? DEFAULT_WHAT[fact.kind] ?? fact.kind;
  }

  private contentForFact(fact: WorldFact): MemoryContent {
    return {
      what: this.whatOf(fact),
      who: [...fact.actors],
      where: fact.placeId,
      when: fact.day,
      detailLevel: fact.voice?.detailLevel ?? 3,
      valence: fact.voice?.valence ?? defaultValence(fact.kind),
      arousal: fact.voice?.arousal ?? defaultArousal(fact.kind),
    };
  }

  /**
   * 一道痕迹推断出来的记忆，效价该取多少。
   *
   * `INFERENCE_TABLE` 里 inscription 那条写着「碑文继承原事件的效价，由调用方
   * 在生成记忆时覆盖」——而这句话一直没有调用方认领：这里原样用了表里的
   * `valence: 0`，于是**每一道碑文在记忆里都是不带情绪的**。
   *
   * 后果不只是「读起来平淡」。效价 0 的记忆通不过 `judge` 的冲突检测
   * （`belief.valence * claim.content.valence < 0`，乘 0 永远是 0），也产不出
   * 求证冲动（`|valence_new − valence_old|` 有一边恒为 0）。一道记着庆典的
   * 碑文与一道记着事故的碑文，在村民记忆里因此长得一模一样——而碑文恰是
   * 唯一一种 `confidence 0.9` 的高保真痕迹，它本该是情绪最清楚的那条。
   *
   * 走 `contentForFact` 的同一条推导（`voice ?? defaultValence(kind)`），
   * 不在这里另抄一份：读碑文的人与当场目击的人，对同一件事的情绪必须对得上。
   *
   * 只改效价，不改唤醒度——表里那句要求说的就是效价，顺手把 arousal 也继承了
   * 属于替规范加需求。事件已经不在了（痕迹还在、事实被关账收走）时退回表里的值。
   */
  private traceValence(trace: Trace, spec: InferenceSpec): number {
    if (spec.sourceMode !== 'read') return spec.valence;
    const fact = this.facts.get(trace.eventRef);
    return fact === undefined ? spec.valence : this.contentForFact(fact).valence;
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

/**
 * 一对单位的规范键**只有一份**，在 `propagate.ts` 的 `pairKey`。
 *
 * 这里原来另写了一个逐字相同的 `pairOf`。关系表与冷却表查的是同一个键，
 * 各写一份就会各自漂移——哪天其中一份换了分隔符，另一份毫不知情，
 * 于是「昨天聊过」与「关系很近」从此对不上。
 */

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
