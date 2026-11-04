/**
 * 读档时的 witnessed 出处闸（EVAL-BUG-1 的修法）。
 *
 * ## 为什么不能写「witnessed 的 eventRefs 必须都能解析到事件」
 *
 * 事件会被淘汰：事实库（`world.facts`）只是当前还在的那一批，老事件被关账收走后，
 * 记忆条目仍指着它们的 id——**这是设计允许的悬空**。90 天存档里 71 条 witnessed
 * 中有 12 条指着已不在 `facts` 的事件；照「必须解析得到」去写，这 12 条合法的
 * 旧档会被当成假的拒掉，比原缺陷更糟。
 *
 * ## 那怎么分「历史淘汰」与「导入时凭空编造」
 *
 * 不靠形状，靠**旁证**：一条事件被摄入的那一刻，记忆层除了写记忆条目，还会
 * 同时写下**独立于这条记忆**的第二份记录——
 *
 * | 旁证 | 写在哪 | 什么时候写 |
 * | --- | --- | --- |
 * | 断言 | `claims[].eventRefs` | `ingest` 里 `birthClaim(fact, …)`，一事一条 |
 * | 信念 | `beliefs[].eventRefs` | 谁信了这条断言 |
 * | 痕迹 | `traces[].entries[].eventRef` | 地点上的物证 |
 * | 传说 / 史诗 | `legends[].eventRefs` / `epics[].eventRefs` | 反复讲述后升格 |
 * | 成长记录 | `turningPoints[].eventRefs` | 信念反转 |
 * | 关系账本 | `bonds[].evidence` | 谁对谁做了什么 |
 * | 地标一生 | `landmarks[].phases[].causeEventRef` | 建 / 拆 / 改名 |
 * | 地名史 | `placeNames[].history[].fromEventRef` | 改名的历史链 |
 *
 * 事实库会被淘汰，这些**不会**（断言只在隐私删除时级联摘掉，而那条删除同时会
 * 摘掉记忆条目自己的引用——`danglingRefs=0` 那条契约保证的正是这一点）。
 * 所以：
 *
 * - 引用还在旁证里 → **这条事件真的被摄入过**，只是事实被淘汰了：放行，计入
 *   `prunedUnverifiable`（「因淘汰无法用事实库核实，但旁证通过」）；
 * - 引用在快照里**一处旁证都没有** → 只可能是在导入时被塞进来的：**降级为
 *   `heard`**，计入 `downgradedEntries`；
 * - 条目本身形状坏（没有 id、没有出处、`sourceMode` 不认识）→ **拒绝**（丢弃），
 *   计入 `refusedEntries`。
 *
 * 刻意**不**做成回调里的 try/catch：要么拒、要么降级，没有静默通过这一档。
 *
 * ## 会误伤的真实场景（写在代码里，不留给事后猜）
 *
 * 1. 玩家手改存档：如果他把 `facts` 里某条事件删了、却留下记忆条目和断言，条目会被
 *    降级成 `heard`——内容不丢，只是不再自称亲历。
 * 2. 未来的保留策略如果连断言 / 传说一起淘汰：老事件的旁证没了，那些合法的
 *    witnessed 条目会被降级（同样是降级，不是删除）。
 * 3. 跨版本迁移：v1 的档没有 `landmarks` / `bonds` 这些段，迁移补空数组；
 *    此处对缺失段一律按空处理，不会因此拒档。
 */

import type { MemoryEntry } from './types.ts';
import type { MemoryWorldSnapshot } from './world.ts';

const SOURCE_MODES = new Set(['witnessed', 'heard', 'read', 'inferred']);

/** 读档闸的报告。三个数就是「拒绝 / 降级 / 因淘汰无法用事实库核实」。 */
export interface MemoryImportReport {
  readonly schema: 'memory-import-report/1';
  readonly witnessedBefore: number;
  readonly witnessedAfter: number;
  /** 形状坏、直接丢弃的条目数。 */
  readonly refusedEntries: number;
  /** 自称亲历但引用无任何旁证，降级为 `heard` 的条目数。 */
  readonly downgradedEntries: number;
  /** 引用不在事实库（无法核实），但旁证在、按历史淘汰放行的条目数。 */
  readonly prunedUnverifiable: number;
  readonly refusedMemoryIds: readonly string[];
  readonly downgradedMemoryIds: readonly string[];
  readonly prunedUnverifiableMemoryIds: readonly string[];
}

export interface MemoryImportGuardResult {
  readonly world: MemoryWorldSnapshot;
  readonly report: MemoryImportReport;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 条目形状闸。只查「读进来会不会让下游拿到半条记忆」这一层：
 * 身份、出处、来源模式、内容。`eventRefs` 必须是非空的非空字符串数组。
 */
function isWellFormedEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.memoryId) || !isNonEmptyString(value.holderId)) return false;
  if (typeof value.sourceMode !== 'string' || !SOURCE_MODES.has(value.sourceMode)) return false;
  if (!Array.isArray(value.eventRefs) || value.eventRefs.length === 0) return false;
  if (!value.eventRefs.every(isNonEmptyString)) return false;
  return isRecord(value.content);
}

/** 收集「独立于记忆条目」的旁证：事件 id → 出现过它的库。 */
function collectCorroboration(world: MemoryWorldSnapshot): Set<string> {
  const seen = new Set<string>();
  const add = (ref: unknown): void => {
    if (isNonEmptyString(ref)) seen.add(ref);
  };
  for (const claim of world.claims ?? []) {
    for (const ref of claim.eventRefs ?? []) add(ref);
  }
  for (const belief of world.beliefs ?? []) {
    for (const ref of belief.eventRefs ?? []) add(ref);
  }
  for (const trace of world.traces ?? []) {
    for (const entry of trace.entries ?? []) add(entry.eventRef);
  }
  for (const legend of world.legends ?? []) {
    for (const ref of legend.eventRefs ?? []) add(ref);
  }
  for (const epic of world.epics ?? []) {
    for (const ref of epic.eventRefs ?? []) add(ref);
  }
  for (const point of world.turningPoints ?? []) {
    for (const ref of point.eventRefs ?? []) add(ref);
  }
  for (const bond of world.bonds ?? []) {
    for (const ref of bond.evidence ?? []) add(ref);
  }
  for (const landmark of world.landmarks ?? []) {
    for (const phase of landmark.phases ?? []) add(phase.causeEventRef);
  }
  for (const toponym of world.placeNames ?? []) {
    for (const step of toponym.history ?? []) add(step.fromEventRef);
  }
  return seen;
}

/**
 * 读档闸本体：坏条目拒、自称亲历但无旁证的降级、因淘汰悬空但有旁证的放行。
 * 纯函数，不改入参（诊断用的 `world` 原样返回引用，条目数组是新的）。
 */
export function enforceWitnessedProvenance(world: MemoryWorldSnapshot): MemoryImportGuardResult {
  const factIds = new Set<string>();
  for (const fact of world.facts ?? []) {
    if (isNonEmptyString(fact.eventId)) factIds.add(fact.eventId);
  }
  const corroborated = collectCorroboration(world);

  const entries: MemoryEntry[] = [];
  const refusedMemoryIds: string[] = [];
  const downgradedMemoryIds: string[] = [];
  const prunedUnverifiableMemoryIds: string[] = [];
  let witnessedBefore = 0;
  let witnessedAfter = 0;

  for (const raw of world.entries ?? []) {
    if (!isWellFormedEntry(raw)) {
      const id = isRecord(raw) && isNonEmptyString(raw.memoryId) ? raw.memoryId : '(no-id)';
      refusedMemoryIds.push(id);
      continue;
    }
    if (raw.sourceMode === 'witnessed') {
      witnessedBefore += 1;
      const unresolved = raw.eventRefs.filter((ref) => !factIds.has(ref));
      if (unresolved.length === 0) {
        witnessedAfter += 1;
      } else if (unresolved.every((ref) => corroborated.has(ref))) {
        // 事实被淘汰，但断言 / 信念 / 痕迹 / 传说 / 地标 / 关系账本里还查得到这件事。
        witnessedAfter += 1;
        prunedUnverifiableMemoryIds.push(raw.memoryId);
      } else {
        // 一处旁证都没有：只能是在导入时编的。降级，不删除。
        entries.push({ ...raw, sourceMode: 'heard' });
        downgradedMemoryIds.push(raw.memoryId);
        continue;
      }
    }
    entries.push(raw);
  }

  return {
    world: { ...world, entries },
    report: {
      schema: 'memory-import-report/1',
      witnessedBefore,
      witnessedAfter,
      refusedEntries: refusedMemoryIds.length,
      downgradedEntries: downgradedMemoryIds.length,
      prunedUnverifiable: prunedUnverifiableMemoryIds.length,
      refusedMemoryIds,
      downgradedMemoryIds,
      prunedUnverifiableMemoryIds,
    },
  };
}
