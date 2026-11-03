/** 检索协议：从记忆库里捞回几条，按需要打分、裁剪、强化。
 *
 * 协议第 9 节的四步，全部不调模型：
 * 1. 结构化过滤（地点 / 天 / 人物 / kind）；
 * 2. 打分 `w_r·recency + w_i·salience + w_v·relevance + w_c·cueMatch + w_rel·relationship`；
 * 3. 取前 `budget_k`；
 * 4. `commit = true` 时强化并可能变形。
 *
 * **归档的条目默认不参与检索**，但仍可被强线索唤醒：`archived` 只在
 * `strongCue` 为真时才放进来。这条是协议第 8 节「归档不是删除」的落点——
 * 如果归档之后再也捞不出来，那它就是删除，只是名字好听。
 *
 * ## 谁在叫它
 *
 * 有一条链了：点一个村民 → `SandboxScene.lookAtVillager` →
 * `MemoryRuntime.recallForDialogue` → `MemoryWorld.recallForDialogue` →
 * `recallFor`。所以「世界在记，没有一个村民问过它一句」这句话不再成立。
 *
 * 但它只是**面板读**：`commit: false`，不改 `entries`、不写 `memory.recalled`。
 * 会强化、会变形的那一支（`commit: true`）今天仍然零调用方——那是真正的交谈
 * 该做的事，归外环。`dialogueTopK` 不再是死数：面板的 Top-3 就是它的读出点。
 *
 * 数字别手数。**下面这条要加 `| grep -v ":[0-9]*: *\*"`**：这一段自己就在提这些
 * 名字，不带那个过滤的话，grep 命中的是这段注释，读起来就成了「有人叫」。
 * 一条引用了一条会反过来命中自己的命令，比不写命令更糟。
 *
 * ```bash
 * grep -rn "recallFor" src test --include=*.ts | grep -v ":[0-9]*: *\*"
 * grep -n "^  [a-zA-Z]" src/world/memory/runtime.ts                       # 公开面
 * ```
 *
 * 2026-10-30 跑出来是 10 行：`src` 里 6 行代码（场景 1、runtime 2、world 3），
 * `test/` 里 4 行。这个数变了这段就该跟着改，不是让它保持 10。
 *
 * `MemoryRuntime` 今天 14 个公开成员（构造除外），场景真的在调 12 个、共 14 个
 * 调用点；剩下两个（`ingestUpstream`/`previewUpstream`）是给
 * `source = agent / genesis` 留的缝，按边界红线就该空着。
 *
 * `viewOf` 那一路仍然只出现在 `SandboxScene` 的 `Oracle.memory(holderId?)`
 * 诊断里。那个诊断自己是孤的：**代码里零调用点**
 * （`grep -rn "\.memory(" src test scripts` 零命中），调它的唯一办法是人在
 * 浏览器控制台敲 `Oracle.memory('...')`。`src/ui/debug-panel.ts` 那份
 * `DebugOracle` 契约五成员（`view`/`events`/`saveStatus`/`feed`/`pushEvent`）
 * 里也没有它；不给 `holderId` 的那一分支只读 `memories.length` 与
 * `beliefs.length`——**两个计数**，不是记忆。
 *
 * 最后两个导出今天在仓库里零消费方：`filterCandidates` 与 `scoreEntry`
 * 只在本文件内部被叫（`grep -rn "filterCandidates\|scoreEntry" test/` 为空），
 * 留着 `export` 是为了「按第几步单测」成为可能。它们和 `viewOf` 一样属于
 * 为外环留的缝，不是正在用的接口。
 */

import type { MemoryConfig, RecallWeights } from './config.ts';
import { blurOnRecall, boostStrength } from './salience.ts';
import { seedOf } from './seed.ts';
import type { MemoryEntry } from './types.ts';

export interface RecallCues {
  readonly placeId?: string;
  readonly actorIds?: readonly string[];
  readonly dayRange?: { readonly from: number; readonly to: number };
  readonly kind?: string;
  readonly tags?: readonly string[];
}

export interface RecallRequest {
  readonly holderId: string;
  readonly cues: RecallCues;
  readonly budgetK: number;
  readonly commit: boolean;
  /** 强线索：能把归档的条目也唤醒。走进事发地、有人当面提起，都算。 */
  readonly strongCue?: boolean;
  readonly nowDay: number;
  readonly seedKey: string;
  /**
   * 这条记忆的关系相关度 0..1。省略时按 0 算（旧调用方保持原行为）。
   * 由持有者的关系账本给，不从全局关系表读。
   */
  readonly relationshipOf?: (entry: MemoryEntry) => number;
}

export interface RecallHit {
  readonly entry: MemoryEntry;
  readonly score: number;
}

/**
 * 结构化过滤。这一步**不看成**：进不来的条目分数再高也不该出现，
 * 因为「跟这件事不相干」不是一个可以由分数低来表达的判断。
 */
export function filterCandidates(
  entries: readonly MemoryEntry[],
  cues: RecallCues,
  strongCue: boolean,
): MemoryEntry[] {
  return entries.filter((entry) => {
    if (entry.archived && !strongCue) return false;
    if (entry.redacted) return false;
    if (cues.placeId !== undefined && entry.content.where !== cues.placeId) return false;
    if (cues.kind !== undefined && entry.kind !== cues.kind) return false;
    if (cues.dayRange !== undefined) {
      const { from, to } = cues.dayRange;
      if (entry.content.when < from || entry.content.when > to) return false;
    }
    if (cues.actorIds !== undefined && cues.actorIds.length > 0) {
      const who = new Set(entry.content.who);
      if (!cues.actorIds.some((id) => who.has(id))) return false;
    }
    return true;
  });
}

/**
 * 打分。
 *
 * 五项各自的来源：
 * - 近因：`1 / (1 + 天数差)`。指数衰减会让「昨天」和「前天」几乎同分，
 *   而人对这两天的区分是很清楚的。
 * - 显著：记忆自带的 `salience`。
 * - 相关：线索里点到的地点/人物命中比例。没有线索时给 0.5（中性），
 *   不是 0——「没问什么」不等于「什么都不相关」。
 * - 线索：这条记忆是不是被线索直接点名的（强线索）。
 * - 关系：留给关系图，本组没有关系数据时恒为 0。
 */
export function scoreEntry(
  entry: MemoryEntry,
  cues: RecallCues,
  weights: RecallWeights,
  nowDay: number,
  strongCue: boolean,
  relationshipOf?: (entry: MemoryEntry) => number,
): number {
  const age = Math.max(0, nowDay - entry.createdDay);
  const recency = 1 / (1 + age);
  const relevance = relevanceOf(entry, cues);
  const cueMatch = strongCue ? 1 : cueHit(entry, cues) ? 1 : 0;
  const relationship = relationshipOf === undefined ? 0 : Math.max(0, Math.min(1, relationshipOf(entry)));
  return (
    weights.recency * recency +
    weights.salience * entry.salience +
    weights.relevance * relevance +
    weights.cue * cueMatch +
    weights.relationship * relationship
  );
}

/** 线索点名的地点/人物里，这条记忆占了几成。没有线索时中性 0.5。 */
function relevanceOf(entry: MemoryEntry, cues: RecallCues): number {
  const parts: boolean[] = [];
  if (cues.placeId !== undefined) parts.push(entry.content.where === cues.placeId);
  if (cues.actorIds !== undefined && cues.actorIds.length > 0) {
    const who = new Set(entry.content.who);
    for (const id of cues.actorIds) parts.push(who.has(id));
  }
  if (parts.length === 0) return 0.5;
  return parts.filter(Boolean).length / parts.length;
}

function cueHit(entry: MemoryEntry, cues: RecallCues): boolean {
  if (cues.placeId !== undefined && entry.content.where === cues.placeId) return true;
  if (cues.actorIds !== undefined) {
    const who = new Set(entry.content.who);
    if (cues.actorIds.some((id) => who.has(id))) return true;
  }
  if (cues.tags !== undefined) {
    const refs = new Set(entry.eventRefs);
    if (cues.tags.some((tag) => refs.has(tag))) return true;
  }
  return false;
}

export interface RecallOutcome {
  readonly hits: readonly RecallHit[];
  /** 被强化过的条目（commit = true 时才有）。调用方据此写回库。 */
  readonly updated: readonly MemoryEntry[];
  /** 每一次变形都记下来，进 `MemoryRecalled` 的 mutation 字段。 */
  readonly mutations: readonly {
    readonly memoryId: string;
    readonly mutation: 'detail' | 'valence';
  }[];
}

/**
 * 完整的一次检索。
 *
 * `commit` 的副作用只有两件：强化与变形。两者都**不改事实**——
 * 强化只动 `strength`，变形只降细节或放大情绪幅度。
 */
export function recall(
  entries: readonly MemoryEntry[],
  request: RecallRequest,
  config: MemoryConfig,
  roll: (seed: number, p: number) => boolean,
): RecallOutcome {
  const strongCue = request.strongCue === true;
  const candidates = filterCandidates(entries, request.cues, strongCue);
  const scored: RecallHit[] = candidates.map((entry) => ({
    entry,
    score: scoreEntry(entry, request.cues, config.recallWeights, request.nowDay, strongCue, request.relationshipOf),
  }));
  // 同分按 memoryId 排：顺序必须确定，否则回放时 top-k 的边界会抖。
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.entry.memoryId < b.entry.memoryId ? -1 : a.entry.memoryId > b.entry.memoryId ? 1 : 0;
  });
  const hits = scored.slice(0, Math.max(0, request.budgetK));

  if (!request.commit) return { hits, updated: [], mutations: [] };

  const updated: MemoryEntry[] = [];
  const mutations: { memoryId: string; mutation: 'detail' | 'valence' }[] = [];
  for (const hit of hits) {
    const seed = seedOf(request.seedKey, request.holderId, hit.entry.memoryId, request.nowDay);
    const blurred = blurOnRecall(
      hit.entry.content,
      seed,
      config.pBlur,
      config.blurValenceGain,
      roll,
    );
    if (blurred.mutation !== null) {
      mutations.push({ memoryId: hit.entry.memoryId, mutation: blurred.mutation });
    }
    updated.push({
      ...hit.entry,
      content: blurred.content,
      strength: boostStrength(hit.entry.strength, config.boost),
      lastRecalledDay: request.nowDay,
      recallCount: hit.entry.recallCount + 1,
    });
  }
  return { hits, updated, mutations };
}

/**
 * 新条目的事实集合是不是旧条目的子集。
 *
 * 「重构性回忆不得新增事实」这条验收靠的正是它（`memory-protocol.test.ts`
 * 那条「变形不得新增事实」调的是这个）。这里原来还有一个 `factSet`，把事实
 * 拼成一个字符串，而它的注释说「验收测试靠它」——那句话是假的：`factSet`
 * 从写下来那天起就没有任何一个调用方，测试也好、运行时也好。留着它只会让
 * 下一个人以为事实的定义在那边，于是改一处漏一处。
 */
export function isSubsetFacts(before: MemoryEntry, after: MemoryEntry): boolean {
  const beforeRefs = new Set(before.eventRefs);
  if (!after.eventRefs.every((ref) => beforeRefs.has(ref))) return false;
  const beforeWho = new Set(before.content.who);
  if (!after.content.who.every((who) => beforeWho.has(who))) return false;
  return before.content.where === after.content.where;
}
