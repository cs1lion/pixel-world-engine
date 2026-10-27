/** 把记忆世界接到世界循环上：同步位置、收事件、跨日关账、抛出心电图。
 *
 * 这一层是**适配器**，不是又一个世界。它只做四件事：
 *
 * 1. `syncHolders()` —— 把这一刻谁站在哪喂进去（传播要算距离）；
 * 2. `observe()` —— 世界做成了什么事，转成一条事实；
 * 3. `ingestUpstream()` —— **边界入口**：`source = agent / genesis` 的事件从这里进；
 * 4. `tick(now)` —— 跨过日界就关账，把心电图交出去。
 *
 * 为什么不直接长在 `Simulation` 里：世界内核只认它自己的事（任务、天气、潮汐），
 * 记忆是**关于**这些事的第二层。把它塞进 `Simulation`，等于让世界在推进时
 * 顺手整理自己的记忆——那既拖慢固定步长，也把两层的时间语义搅在一起。
 * 这里改成世界每拍交出一份快照，适配器照着快照过日子，与世界同钟。
 *
 * 这一层仍然**不调模型**，也**不读全局状态替单位做决定**：它只搬运。
 * 单位能看见什么，仍然只有 `MemoryWorld.viewOf()` 那一扇门。
 */

import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from './config.ts';
import type { OcclusionGrid, Perceiver } from './perception.ts';
import { witnessesOf } from './perception.ts';
import { compile, type UpstreamAction } from './sanitize.ts';
import type { HolderType, MemoryEvent, WorldFact, WorldVitals } from './types.ts';
import { MemoryWorld, type HolderView } from './world.ts';

/** 一个单位此刻的处境。位置是格坐标，与 `Simulation` 的 `Vec2` 同一套。 */
export interface RuntimeHolder {
  readonly holderId: string;
  readonly type: HolderType;
  readonly at?: { readonly x: number; readonly y: number };
  readonly talkativeness?: number;
}

/**
 * 世界做成的一件事，翻译成记忆层的话。
 *
 * 刻意**不用** `WorldChange` 那个联合类型：那是世界回写日志的词表，长在
 * `src/world/world-changes.ts`，而记忆层不许往上一层 import。翻译发生在
 * 调用方（场景），记忆层只收翻译好的结果——这样加一种 `WorldChange` 不必
 * 动记忆层，改一种记忆的说法也不必动日志。
 */
export interface RuntimeObservation {
  readonly eventId: string;
  /** 记忆层的 kind（`task_done` / `celebration` / …），不是日志里的 `world.changed`。 */
  readonly kind: string;
  readonly placeId: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly actors: readonly string[];
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly importanceHint: number | null;
  readonly valence?: number;
  readonly arousal?: number;
}

export interface MemoryRuntimeDeps {
  readonly config?: MemoryConfig;
  readonly worldId?: string;
  /** 心电图出口。**只出不进**：本组不拿它做任何决定，那是导演的事。 */
  readonly onVitals?: (vitals: WorldVitals) => void;
  /** 记忆层事件的出口（写日志用）。省略表示不记。 */
  readonly onEvent?: (event: MemoryEvent) => void;
  /**
   * 遮挡网格。**给了，「谁能看见一件事」才真的按感知模型算。**
   *
   * 世界那侧的 `WorldGrid` 直接满足 `OcclusionGrid`（只要 `isWalkable`），
   * 场景构造时把 `this.world.grid` 递进来即可。省略表示「判断不了遮挡」，
   * 于是退回归 `actors`——那是最保守的一档，宁可少记。
   */
  readonly occlusion?: OcclusionGrid;
}

export class MemoryRuntime {
  readonly world: MemoryWorld;
  readonly config: MemoryConfig;
  private readonly deps: MemoryRuntimeDeps;
  /**
   * 已经关到第几天。`0` 表示一天都还没关——第 0 天要等跨进第 1 天才关。
   *
   * 起点不能是「当前第几天」：那样开局就站在第 0 天里，第 0 天永远不会关，
   * 而第 0 天恰恰是开局那批事最该被整理的一天。
   */
  private lastClosedDay = 0;
  private started = false;
  /**
   * 世界走到哪了。由 `tick` 推着走，不由墙钟。
   *
   * `observe` 用它给事件定时刻：一条观察不带时间（时间归世界，事件归这件事，
   * 与 `toEnvelope` 同一条纪律）。误差不超过一拍。
   */
  private now = 0;
  /**
   * 谁站在哪。**只记人物**，由 `syncHolders` 维护。
   *
   * 放在适配器这一层而不是 `MemoryWorld` 里：位置是行为层的知识，适配器的
   * 本职就是搬运它。放进世界就成了「任何人都能一次读到全村的位置」，
   * 而单位读世界的门至今只有 `viewOf` 一扇——那扇门后只有他自己的东西。
   */
  private readonly positions = new Map<string, { readonly x: number; readonly y: number }>();

  constructor(deps: MemoryRuntimeDeps = {}) {
    this.config = deps.config ?? DEFAULT_MEMORY_CONFIG;
    this.deps = deps;
    this.world = new MemoryWorld({
      config: this.config,
      worldId: deps.worldId ?? 'world',
      ...(deps.onEvent === undefined ? {} : { emit: deps.onEvent }),
    });
  }

  /**
   * 对齐这一刻的处境。
   *
   * 只增不删：走掉的人留在名册里（他还记得事），只是不再有位置——
   * 而**没有位置的单位不参与传播**（`spreadCandidates` 会跳过它们）。
   * 这是「不知道他在哪，就不能假装他站在谁旁边」。
   */
  syncHolders(holders: readonly RuntimeHolder[]): void {
    for (const holder of holders) {
      // 位置先记账，再管名册。**两个分支都要记**：第一次对齐时名册还是空的，
      // 人人走「新建」那条然后 `continue`——只写在另一条分支里的话，开局这
      // 一拍所有人都没有位置，感知模型于是谁都看不见。
      //
      // 地点 Holder 不记：一栋楼不会「看见」发生在它门口的事。
      if (holder.at !== undefined && holder.type === 'character') {
        this.positions.set(holder.holderId, holder.at);
      }
      if (!this.world.hasHolder(holder.holderId)) {
        this.world.addHolder({
          holderId: holder.holderId,
          type: holder.type,
          profile: { talkativeness: holder.talkativeness ?? 0.5 },
          ...(holder.at === undefined ? {} : { at: holder.at }),
        });
        continue;
      }
      if (holder.at !== undefined) this.world.moveHolder(holder.holderId, holder.at);
    }
    this.started = true;
  }

  /**
   * 世界做成了一件事。返回写下的记忆 id。
   *
   * `witnesses` 不传时**按感知模型算**（见 `witnessesFor`）。调用方手上
   * 有比位置更多的东西时（比如它知道谁真的在看），可以显式给一份盖过去。
   */
  observe(
    observation: RuntimeObservation,
    witnesses?: readonly string[],
    at = this.now,
  ): readonly string[] {
    const result = this.world.ingest({
      eventId: observation.eventId,
      at,
      kind: observation.kind,
      place: {
        placeId: observation.placeId,
        at: observation.at,
        // `indoor` 恒为 false：世界模型还答不上「这栋楼是不是室内空间」
        // （`PlaceAnchor.indoor` 至今没有生产方）。按室外算是**多记**的方向——
        // 屋里屋外八格内的人都算在场。反过来一律按「室内同房间」会让每件事
        // 只剩 actors 一个人记得，而那正是 `witnessesFor` 要修的那个静默失效。
        indoor: false,
      },
      actors: observation.actors,
      outcome: observation.outcome,
      visibility: 'world',
      source: 'world',
      importanceHint: observation.importanceHint,
      parentEventId: null,
      witnesses: witnesses ?? this.witnessesFor(observation),
      ...(observation.valence === undefined ? {} : { valence: observation.valence }),
      ...(observation.arousal === undefined ? {} : { arousal: observation.arousal }),
    });
    return result.written;
  }

  /**
   * 谁看见了这件事。
   *
   * **感知模型在真实世界里的唯一入口。** `perception.ts` 的 `witnessesOf`
   * 写好了、测过了，而在这之前 `observe` 一直写死 `witnesses ?? actors`——
   * 一个调用方都没有。偏偏 `observe.ts` 里 `building.built`、
   * `building.removed`、`miracle`、`weather` 四种改变的 `actors` **都是空数组**：
   * 一栋新楼立起来、一次神迹、一场拆楼、一回天气反常，全村没有一个人记得，
   * 连站在原地的那个都不记得。没有目击者就没有记忆，没有记忆就没有断言，
   * 没有断言传播层就整层空转——而日志里一声不响，单元测试还全绿。
   *
   * `actors` 仍然算在场者，而且**排在最前**：参与这件事的人按定义就在那；
   * 更重要的是 witnesses 的顺序决定断言诞生在谁身上（`birthClaim` 取第一个），
   * 动手的人该是那个起源者。
   *
   * 没有遮挡网格时退回归 `actors`：判断不了遮挡，就不能假装看得见。
   */
  private witnessesFor(observation: RuntimeObservation): readonly string[] {
    const witnesses = [...observation.actors];
    const grid = this.deps.occlusion;
    if (grid === undefined) return witnesses;
    const perceivers = this.perceivers();
    if (perceivers.length === 0) return witnesses;

    const seen = new Set(witnesses);
    for (const holderId of witnessesOf({
      place: { placeId: observation.placeId, at: observation.at, indoor: false },
      perceivers,
      grid,
      config: this.config,
    })) {
      if (seen.has(holderId)) continue;
      seen.add(holderId);
      witnesses.push(holderId);
    }
    return witnesses;
  }

  /**
   * 这一刻可能看见事情的人，按 holderId 排序。
   *
   * 排序不是洁癖：感知的输入顺序决定 witnesses 的顺序，witnesses 的顺序
   * 决定断言诞生在谁身上。同一份存档跑两遍要得到同一个答案，就不许按
   * Map 的插入顺序走——插入顺序取决于行为层这拍先同步了谁。
   */
  private perceivers(): readonly Perceiver[] {
    const perceivers: Perceiver[] = [];
    for (const holderId of [...this.positions.keys()].sort()) {
      const at = this.positions.get(holderId);
      if (at === undefined) continue;
      perceivers.push({ holderId, at, inside: null });
    }
    return perceivers;
  }

  /**
   * **边界入口**：上游动作从这里进世界。
   *
   * 这是本组唯一为造物主/上游预留的东西。事件进来之后怎么被感知、记忆、
   * 传播，与本地事件**没有区别**——本组不生成任何东西，只收。
   * 编译不出事件（拓扑不在表里，或一次平静的检索）时返回 `null`。
   */
  ingestUpstream(
    action: UpstreamAction,
    at: number,
    place: { readonly placeId: string; readonly at: { readonly x: number; readonly y: number } },
    actors: readonly string[],
    sight?: { readonly perceivers: readonly Perceiver[]; readonly grid: OcclusionGrid },
  ): WorldFact | null {
    // 调用方没给现场，就用适配器自己这一份：位置是 `syncHolders` 喂进来的，
    // 遮挡网格是构造时给的。两份都有才算得动；缺一个就按 `actors`——
    // 参与这件事的人按定义就在场。
    //
    // 不这么接的话，上游事件（`source = agent`）的记忆面会比本地事件窄一截：
    // 神迹从日志进来没人记得，神迹从 `observe` 进来就有人记得。
    const scene =
      sight ??
      (this.deps.occlusion === undefined
        ? undefined
        : { perceivers: this.perceivers(), grid: this.deps.occlusion });
    return this.world.ingestUpstream(action, at, { ...place, indoor: false }, actors, scene);
  }

  /** 一条上游动作会变成什么事件。不写世界，只回答「会不会发生」。 */
  previewUpstream(action: UpstreamAction): ReturnType<typeof compile> {
    return compile(action);
  }

  /**
   * 世界走了 `now` 这么远。跨过的每一个日界都关一次账。
   *
   * 用 `while` 而不是 `if`：读档之后 `now` 可能一次跨好几天，
   * 而那些天该各自整理一次。补关的天用各自的天界时刻，不是「现在」——
   * 否则三天的记忆会全挤在同一个时刻，编年史就乱了。
   */
  tick(now: number): readonly WorldVitals[] {
    this.now = now;
    const day = Math.floor(now / this.config.dayMs);
    const closed: WorldVitals[] = [];
    while (this.lastClosedDay < day) {
      const closing = this.lastClosedDay;
      const at = (closing + 1) * this.config.dayMs;
      const vitals = this.world.dayClosed(closing, at);
      this.lastClosedDay = closing + 1;
      this.deps.onVitals?.(vitals);
      closed.push(vitals);
    }
    return closed;
  }

  /**
   * 单位读自己。唯一那扇门，原样透出，不加任何东西。
   *
   * **今天没有人在用这扇门。** 它在 `SandboxScene` 只出现在
   * `Oracle.memory(holderId?)` 诊断里，而那个诊断在代码里零调用点——唯一调它的
   * 办法是人在浏览器控制台敲 `Oracle.memory('...')`。`src/ui/debug-panel.ts` 的
   * `DebugOracle` 五成员契约里也没有它；诊断摘要那一分支读的还是
   * `memories.length`，不是记忆本身。**验它要带注释过滤**，否则 grep 命中的是
   * 正在说明这件事的这几行：`grep -rn "\.memory(" src test scripts | grep -v ":[0-9]*: *\*"`。
   *
   * 注意这不是**回忆**：回忆是 `recall.ts`（打分、裁剪、强化），那一条链在
   * 本类一个方法都没有——见 `recall.ts` 文件头「在跑着的世界里没有调用方」。
   * 这一扇给的是**全量原样**，两者的区别正是「单位只能读自己」与
   * 「他要想起什么」。
   */
  viewOf(holderId: string): HolderView | null {
    return this.world.viewOf(holderId);
  }

  /**
   * 某个人路过一个地点。走到跟前才看得见痕迹（`traceRadius`），
   * 看见之后按 `traces.ts` 的查表推断——不调模型，不猜。
   *
   * 返回他这次新推出的东西，调用方拿去挂牌子。返回空数组是常态：
   * 大多数地点大多数时候什么都没留下。
   */
  lookAtTraces(holderId: string, placeId: string): ReturnType<MemoryWorld['lookAtTraces']> {
    return this.world.lookAtTraces(holderId, placeId, this.now);
  }

  /**
   * **求证闭环的出口**。
   *
   * `verifyPlans` 早在传播时就写进了每个单位的视图里（`HolderView.verifyPlans`），
   * 但在这之前没有任何人读它——日程生成了，没人出门，于是 `verify()` 是死代码，
   * 而「造谣者可靠度下调 0.15」永远咬不动。
   *
   * 这里把它接上：行为层看到一个人站在他求证日程的落点上，就调一次。
   * 返回 `null` 表示他没这条日程（或已经跑过了）。
   */
  settleVerification(
    holderId: string,
    claimId: string,
  ): ReturnType<MemoryWorld['verify']> | null {
    const plans = this.world.viewOf(holderId)?.verifyPlans ?? [];
    const plan = plans.find((item) => item.claimId === claimId);
    if (plan === undefined) return null;
    return this.world.verify(holderId, claimId, plan.placeId, this.now);
  }

  /** 这个人此刻该去哪求证。行为层每拍读一次，读完就派路。 */
  pendingVerifications(holderId: string): HolderView['verifyPlans'] {
    return this.world.viewOf(holderId)?.verifyPlans ?? [];
  }

  /**
   * 一栋楼没了。**只删地点 Holder，不删人物的记忆。**
   *
   * 透出 `MemoryWorld.removePlace`——行为层拆楼时喊这一声，理由写在那儿的
   * 注释里（楼拆了，「那儿原来有间铺子」还该有人记得）。
   *
   * 这个转发方法原先不存在，而 `SandboxScene` 从 `6e8ec48` 起就在调它：
   * `npm run check` 从那一笔起一直是红的（TS2339，`MemoryRuntime` 没这个成员）。
   * 补上不是顺手——门少一层，喊的人就喊不到。
   */
  removePlace(holderId: string): void {
    this.world.removePlace(holderId);
  }

  /** 已经关到第几天（含）。给状态行与调试用。 */
  get closedThroughDay(): number {
    return this.lastClosedDay - 1;
  }

  /** 对齐过名册没有。没对齐过时传播无从谈起，状态行据此说「还没接上」。 */
  get ready(): boolean {
    return this.started;
  }

}
