/** 隐私、删除与级联。
 *
 * 协议第 15 节。两件事：
 *
 * 1. **可见性**：`private_to_player` 的事件不写入任何单位记忆的明文，
 *    最多写入抽象化的 sanitized 版本；记忆继承事件的可见性；气泡、碑文等
 *    表现输出前再过一次脱敏。
 * 2. **删除级联**：`delete(root)` 沿 `derivedFrom` 与 `eventRefs` 找出所有
 *    派生物，一并清除；摘要里只含该事件的语句直接删，其余保留并标 `redacted`。
 *
 * 第 15 节第 1 条点名的派生物是**五样**：记忆、摘要、信念副本、痕迹、传说。
 * 记忆与摘要是同一个库里的两档，由 `deleteCascade` 一次走完；另外三样各有一
 * 个 `cascade*` 在这里，因为它们各是一个库，清法也各不一样（见各自的注释）。
 * `world.ts` 的 `delete()` 负责把五样都调到，并数清楚各清了多少。
 *
 * 这一层是纯函数：吃一份库，返回一份新库与被删的清单。它不写日志、不发事件，
 * 调用方拿 `MemoryDeleted(root_id, counts)` 去发。
 *
 * **删除之后不得再被检索命中，也不得再次被整理写回。** 前一句靠过滤（检索
 * 跳过 `redacted`），后一句靠这里真的把条目拿掉——如果只打标记，下一次整理
 * 仍会从当日片段里把它压进摘要。事件根本身也要拿走：`createClaimFrom` 拿不到
 * 事实就返回 `null`，删掉的事因此再也生不出新断言。
 */

import type { Belief, Legend, MemoryEntry, Trace, WorldFact } from './types.ts';

/** 一个根被删掉之后，连带清掉了什么。 */
export interface DeletionReport {
  readonly rootId: string;
  readonly entries: readonly MemoryEntry[];
  readonly removedMemoryIds: readonly string[];
  readonly redactedMemoryIds: readonly string[];
  readonly counts: {
    readonly memories: number;
    readonly summaries: number;
    readonly beliefs: number;
    readonly claims: number;
    readonly traces: number;
    readonly legends: number;
  };
}

/** 删除的根可以是事件、记忆或断言。 */
export type DeletionRoot =
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'memory'; readonly id: string }
  | { readonly kind: 'claim'; readonly id: string };

/**
 * 一条事件的可见性能不能进某个单位的记忆。
 *
 * `private_to_player` 不写明文；`sanitized` 只能写脱敏版本；`world` 随便。
 * 返回值是「该怎么写」而不是「能不能写」，因为 private 事件**可以**留下
 * 一条抽象化记忆——「有人做了件事」是允许的，「他改了哪个文件」不是。
 */
export type WriteMode = 'verbatim' | 'abstracted' | 'forbidden';

export function writeModeOf(fact: WorldFact, holderIsPlayer: boolean): WriteMode {
  if (fact.visibility === 'world') return 'verbatim';
  if (fact.visibility === 'sanitized') return 'abstracted';
  // private_to_player：玩家自己的记忆在上游，世界侧不写明文。
  return holderIsPlayer ? 'forbidden' : 'abstracted';
}

/**
 * 删除级联。
 *
 * 协议第 15 节第 1 条要「沿 `derived_from` 与 `event_refs` 找出所有派生物」，
 * 第 2 条规定摘该怎么处理。落到这里是四档：
 *
 * - **整条都是这个事件** → 删除；
 * - **摘要是多事件的并集**，其中含该事件 → 保留，标 `redacted`，并把该事件
 *   从 `eventRefs` 里摘掉。摘完之后 `eventRefs` 空了，就整条删除——
 *   一条没有出处的记忆不成立。
 * - **别的记忆派生自被删的那条**（`derivedFrom.memoryIds` 指着它）→ 保留，
 *   摘掉这个出处并标 `redacted`。它的 `eventRefs` 还撑着它，事件还在，
 *   整条删是删多了。
 * - **别的事件** → 不动。
 *
 * 这条规则让「删除」不会顺手删掉无辜的记忆：一段摘要记着三件事，删掉其中
 * 一件，另外两件该留着。
 */
export function deleteCascade(
  entries: readonly MemoryEntry[],
  root: DeletionRoot,
): { readonly entries: readonly MemoryEntry[]; readonly report: Omit<DeletionReport, 'counts'> } {
  const removed: string[] = [];
  const redacted: string[] = [];
  const kept: MemoryEntry[] = [];

  for (const entry of entries) {
    if (matchesRoot(entry, root)) {
      removed.push(entry.memoryId);
      continue;
    }
    // 记忆被删：沿 `derived_from` 往下找。摘要是从片段压出来的，片段没了，
    // 摘要的出处链上就少一环。
    if (root.kind === 'memory' && entry.derivedFrom.memoryIds.includes(root.id)) {
      redacted.push(entry.memoryId);
      kept.push({
        ...entry,
        redacted: true,
        derivedFrom: {
          ...entry.derivedFrom,
          memoryIds: entry.derivedFrom.memoryIds.filter((id) => id !== root.id),
        },
      });
      continue;
    }
    if (root.kind !== 'event') {
      kept.push(entry);
      continue;
    }
    // 事件被删：看这条记忆里还有没有别的事件撑着。
    if (!entry.eventRefs.includes(root.id)) {
      kept.push(entry);
      continue;
    }
    const remaining = entry.eventRefs.filter((ref) => ref !== root.id);
    if (remaining.length === 0) {
      removed.push(entry.memoryId);
      continue;
    }
    redacted.push(entry.memoryId);
    kept.push({
      ...entry,
      eventRefs: [remaining[0]!, ...remaining.slice(1)],
      redacted: true,
      derivedFrom: {
        ...entry.derivedFrom,
        memoryIds: entry.derivedFrom.memoryIds.filter((id) => !removed.includes(id)),
      },
    });
  }

  return {
    entries: kept,
    report: { rootId: rootIdOf(root), entries: kept, removedMemoryIds: removed, redactedMemoryIds: redacted },
  };
}

/**
 * 这条记忆整条就是被删的那个根吗。
 *
 * 断言根走 `derivedFrom.claimIds`——记忆是从哪条断言听来的，那儿记着。
 * **原先还有一句 `claims.has(entry.memoryId)`，那是死的**：`claims` 是调用方
 * 递进来的**断言 id 集合**（`this.claims.keys()`），而 `entry.memoryId` 是
 * 记忆 id。两套 id 空间（`claim_0001` / `written_m_0001` 对 `m_0001` /
 * `m_sum_…`）从不相交，那句永远为假，却长得像在查「这条记忆是不是那条断言
 * 的源头」。真要查源头，该比的是 `originHolderId` 那条链，不是 id 集合。
 */
function matchesRoot(entry: MemoryEntry, root: DeletionRoot): boolean {
  if (root.kind === 'memory') return entry.memoryId === root.id;
  if (root.kind === 'event') return false;
  // 断言被删：从它听来的记忆整条走。
  return entry.derivedFrom.claimIds.includes(root.id);
}

function rootIdOf(root: DeletionRoot): string {
  return root.id;
}

/**
 * 信念副本的级联。
 *
 * 协议第 15 节第 1 条把「信念副本」和记忆、摘要、痕迹、传说**并列**在派生物
 * 名单里。而 `delete` 原先只清记忆：实测删一件 10 人村全员目击的大事，删完
 * 11 条信念照旧挂在那个 `event_ref` 上——村里每个人嘴里还当它是个真事，
 * 而 `diffuseDay` 第二天继续把它讲给还没听说过的人。
 *
 * 整条删，不打标记。第 2 条「其余保留并标 redacted」照顾的是**摘要**：一段
 * 摘要记着三件事，删一件，另外两件该留着。信念没有并集这回事——一条信念
 * 只属一件事，删了它就是删了。
 */
export function cascadeBeliefs(
  beliefs: readonly Belief[],
  root: DeletionRoot,
): { readonly beliefs: readonly Belief[]; readonly removed: readonly string[] } {
  const removed: string[] = [];
  const kept: Belief[] = [];
  for (const belief of beliefs) {
    if (beliefTouches(belief, root)) {
      removed.push(belief.claimId);
      continue;
    }
    kept.push(belief);
  }
  return { beliefs: kept, removed };
}

function beliefTouches(belief: Belief, root: DeletionRoot): boolean {
  if (root.kind === 'claim') return belief.claimId === root.id;
  return belief.eventRefs.includes(root.id);
}

/**
 * 一个地点上痕迹的级联。
 *
 * 协议第 15 节第 3 条：「痕迹移除或中性化」。取**移除**——一道痕迹只绑一个
 * 事件（`Trace.eventRef` 是单数，不是并集），没有「还有别的事撑着它」这回事，
 * 于是没有可保留的残骸。中性化会留下一道谁也不指向的图层，而它照样占着
 * `placeTraceLayers`（5 层）的预算，还照样被 `exposedTraces` 暴露出去。
 *
 * 这一条不是洁癖：实测删掉事件之后，`lookAtTraces` 仍从那道焦痕推断出
 * 「此处近期似乎出过事故」并写成一条新记忆——删掉的事实在靠痕迹通道复活，
 * 而它本该是最该闭嘴的那条。
 */
export function cascadeTraces(
  layers: readonly Trace[],
  root: DeletionRoot,
): { readonly layers: readonly Trace[]; readonly removed: readonly string[] } {
  const removed: string[] = [];
  const kept: Trace[] = [];
  for (const layer of layers) {
    if (layer.eventRef === root.id) {
      removed.push(layer.traceId);
      continue;
    }
    kept.push(layer);
  }
  return { layers: kept, removed };
}

/**
 * 传说的级联。
 *
 * 协议第 15 节第 3 条：「传说移除该 `event_ref`，空了则整条删除」。所以
 * 不是二选一，是**先摘后删**：摘掉那个出处，摘完还剩别的出处就留着，
 * 一条不剩才整条走。
 *
 * `Legend.eventRefs` 类型上是非空元组——摘空了的传说在类型上不成立，
 * 正好对应「空了则整条删除」，不用另立一个判断。
 */
export function cascadeLegends(
  legends: readonly Legend[],
  root: DeletionRoot,
): {
  readonly legends: readonly Legend[];
  readonly removed: readonly string[];
  readonly stripped: readonly string[];
} {
  const removed: string[] = [];
  const stripped: string[] = [];
  const kept: Legend[] = [];
  for (const legend of legends) {
    if (!legend.eventRefs.includes(root.id)) {
      kept.push(legend);
      continue;
    }
    const remaining = legend.eventRefs.filter((ref) => ref !== root.id);
    if (remaining.length === 0) {
      removed.push(legend.legendId);
      continue;
    }
    stripped.push(legend.legendId);
    kept.push({ ...legend, eventRefs: [remaining[0]!, ...remaining.slice(1)] });
  }
  return { legends: kept, removed, stripped };
}

/**
 * 断言的级联。
 *
 * 协议第 15 节的派生物名单里没有列「断言」，但留着它比删掉它更糟：`diffuseDay`
 * 遍历的就是断言池，一条关于已删事件的断言会继续被讲出去，而
 * `createClaimFrom` 的「一件事只有一条断言」还会拿它当挡箭牌，让同一件事
 * 换个人重新诞生时被它拦住——删掉的事件于是既在流传、又不许重讲。
 */
export function cascadeClaims(
  claims: readonly { readonly claimId: string; readonly eventRefs: readonly string[] }[],
  root: DeletionRoot,
): { readonly claims: readonly { readonly claimId: string; readonly eventRefs: readonly string[] }[]; readonly removed: readonly string[] } {
  const removed: string[] = [];
  const kept: { claimId: string; eventRefs: readonly string[] }[] = [];
  for (const claim of claims) {
    if (claim.eventRefs.includes(root.id)) {
      removed.push(claim.claimId);
      continue;
    }
    kept.push(claim);
  }
  return { claims: kept, removed };
}

/**
 * 表现输出的脱敏（协议第 15 节最后一句）。
 *
 * 这一层与 `writeModeOf` 分开：一个是「写不写进记忆」，一个是「说不说得出口」。
 * 一条 `sanitized` 记忆可以写进记忆库，但它的原话不该出现在气泡里——
 * 气泡是给玩家看的，而玩家已经在别处知道真相了。
 *
 * **今天一个调用方都没有，而这不是漏接。** 现在没有一条表现通道会递出记忆
 * 里的原话，逐个看过：
 *
 * - 村民气泡（`world-overlay.ts` 的 `overlay-bubble`）：除了派单失败那几句
 *   嵌了 `TaskRecord.summary`，其余全是 `simulation.ts` 里的硬编码句子。
 *   而 `summary` 是**上游自己给的标题**（"标题只有它知道，世界不自己编"），
 *   把它洗成省略号等于把上游当外人——上游的活派不下去，它当然该看见自己
 *   那句标题。它也不是 `private_to_player` 事件，§15 那条闸管不到它。
 * - 露话（SPEC_V2 §4.6）：来自设定集的露话池，静态配置，不是记忆。
 * - 碑文：`traces.ts` 只把它做成一道痕迹和一句推断，**没有任何渲染器**。
 *   传说（`legend.ts`）同理——`formLegend` 有人调，但没有一处把它画出来。
 *
 * 所以这个函数在等一个具体条件：**第一条会把记忆原文递到玩家眼前的表现
 * 通道**。那条通道出现时，这里就是它非过不可的那道闸。在那之前把它接上
 * 任何地方，都只是给一段没人看的文本脱敏——而§15 的要求会一直是真的。
 */
export function redactForDisplay(text: string, forbidden: readonly string[]): string {
  let output = text;
  for (const token of forbidden) {
    if (token === '') continue;
    output = output.split(token).join('…');
  }
  return output;
}
