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
   * `witnesses` 不在这里算：记忆层没有遮挡网格，也不知道谁能看见谁。
   * 由调用方给（它手上有 `Simulation` 的快照），给不出就按「在场者」——
   * 也就是 `actors`，这是最保守的一档，宁可少记。
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
        indoor: false,
      },
      actors: observation.actors,
      outcome: observation.outcome,
      visibility: 'world',
      source: 'world',
      importanceHint: observation.importanceHint,
      parentEventId: null,
      witnesses: witnesses ?? observation.actors,
      ...(observation.valence === undefined ? {} : { valence: observation.valence }),
      ...(observation.arousal === undefined ? {} : { arousal: observation.arousal }),
    });
    return result.written;
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
    return this.world.ingestUpstream(action, at, { ...place, indoor: false }, actors, sight);
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

  /** 单位读自己。唯一那扇门，原样透出，不加任何东西。 */
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
  ): { readonly outcome: 'confirmed' | 'debunked' | 'inconclusive'; readonly debunkedSpeaker: string | null } | null {
    const plans = this.world.viewOf(holderId)?.verifyPlans ?? [];
    const plan = plans.find((item) => item.claimId === claimId);
    if (plan === undefined) return null;
    return this.world.verify(holderId, claimId, plan.placeId, this.now);
  }

  /** 这个人此刻该去哪求证。行为层每拍读一次，读完就派路。 */
  pendingVerifications(holderId: string): HolderView['verifyPlans'] {
    return this.world.viewOf(holderId)?.verifyPlans ?? [];
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
