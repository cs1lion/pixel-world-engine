/**
 * 反事实探针的共用实现：测试与证据脚本走同一份代码，读数不会分叉。
 *
 * 三条口径：
 * 1. 删掉一条事件之后，那个角色对同一线索的召回集**必须**少掉它，且时间线
 *    不再指向它；同一世界里另一条事件仍在，证明不是整库塌掉。
 * 2. 塞一条「听说来的」假记忆（`eventRefs` 指向从未存在的事件），召回**可以**
 *    命中它，但 `sourceMode` 必须是 `heard`，不得被当成亲眼所见。
 * 3. 同样的假记忆改标 `witnessed` 时，读档闸（`src/world/memory/import-guard.ts`）
 *    会把它降级成 `heard`——EVAL-BUG-1 已修；报告里的 `downgradedEntries` 必须 ≥1。
 *    造错守卫（把这道闸关掉）见 `looseWitnessed*`：直连 `restoreSnapshot` 绕过
 *    `MemoryRuntime`，假记忆就会以 `witnessed` 活下来，守卫因此变红。
 */
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { MemoryImportReport } from '../src/world/memory/import-guard.ts';
import type { MemoryEntry, SourceMode } from '../src/world/memory/types.ts';

export interface RecallSnapshot {
  readonly memoryIds: readonly string[];
  readonly eventRefs: readonly string[];
  readonly modes: readonly string[];
}

export interface FakeProbe {
  readonly ghostEventId: string;
  readonly ghostEventExists: boolean;
  readonly rumorRecalled: boolean;
  readonly rumorMode: string | null;
  readonly witnessedRecalled: boolean;
  readonly witnessedMode: string | null;
  /** 读档闸的报告（只在本探针返回里带一份，便于证据脚本引用）。 */
  readonly importReport: MemoryImportReport | null;
  /** 关掉读档闸（直连 `restoreSnapshot`）时的同一探针——造错守卫的对照组。 */
  readonly looseWitnessedRecalled: boolean;
  readonly looseWitnessedMode: string | null;
}

export interface CounterfactualResult {
  readonly schema: 'eval-counterfactual/1';
  readonly seedKey: string;
  readonly before: RecallSnapshot;
  readonly after: RecallSnapshot;
  /** 不带地点过滤的一次召回：证明删一条没有把整库清空。 */
  readonly allAfter: RecallSnapshot;
  readonly removedMemoryIds: readonly string[];
  readonly timelineBeforeEvents: readonly string[];
  readonly timelineAfterEvents: readonly string[];
  readonly hintsBefore: readonly string[];
  readonly hintsAfter: readonly string[];
  readonly danglingRefs: number;
  readonly fake: FakeProbe;
}

const GHOST_EVENT = 'eval-ghost-never-happened';

function runtime(): MemoryRuntime {
  return new MemoryRuntime({ worldId: 'eval-counterfactual' });
}

function baselineRuntime(): MemoryRuntime {
  const rt = runtime();
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
  ]);
  const at = DAY_MS - 1;
  rt.observe(
    {
      eventId: 'eval-e1',
      kind: 'workshop_accident',
      placeId: 'eval-p1',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: { what: '炉子炸了' },
      importanceHint: 0.95,
    },
    ['a', 'b'],
    at,
  );
  rt.observe(
    {
      eventId: 'eval-e2',
      kind: 'task_done',
      placeId: 'eval-p2',
      at: { x: 1, y: 0 },
      actors: ['b'],
      outcome: { what: '水车修好了' },
      importanceHint: 0.6,
    },
    ['a', 'b'],
    at,
  );
  rt.tick(DAY_MS);
  return rt;
}

function recallOf(rt: MemoryRuntime, placeId?: string): RecallSnapshot {
  const outcome = rt.recallForDialogue('a', {
    cues: placeId === undefined ? {} : { placeId },
    commit: false,
    nowDay: 1,
    seedKey: 'eval-counterfactual',
  });
  return {
    memoryIds: outcome.hits.map((hit) => hit.entry.memoryId),
    eventRefs: outcome.hits.flatMap((hit) => [...hit.entry.eventRefs]),
    modes: outcome.hits.map((hit) => hit.entry.sourceMode),
  };
}

function entriesOf(rt: MemoryRuntime): readonly MemoryEntry[] {
  return rt.toSnapshot().world.entries;
}

/** 造一条只存在于存档里的记忆，出处指向一个不存在的事件。 */
function injectedSnapshot(rt: MemoryRuntime, sourceMode: SourceMode): string {
  const snap = JSON.parse(rt.toJSON()) as {
    world: { entries: MemoryEntry[]; facts: readonly { eventId: string }[] };
  };
  const template = snap.world.entries.find((entry) => entry.eventRefs.includes('eval-e2'));
  if (template === undefined) throw new Error('基线快照里找不到 eval-e2 的记忆，探针失效');
  const fake: MemoryEntry = {
    ...template,
    memoryId: 'm_fake_ghost',
    // 类型上是非空数组；内容全假：地点、出处、说法都不在世界里。
    eventRefs: [GHOST_EVENT],
    sourceMode,
    sourceChain: sourceMode === 'heard' ? ['b'] : [],
    content: { ...template.content, what: '（假记忆）有人在鬼地方看见了不该看见的事', where: 'eval-ghost-place' },
  };
  snap.world.entries.push(fake);
  return JSON.stringify(snap);
}

function fakeProbe(sourceMode: SourceMode): {
  recalled: boolean;
  mode: string | null;
  ghostExists: boolean;
  report: MemoryImportReport | null;
} {
  const rt = runtime();
  rt.fromJSON(injectedSnapshot(baselineRuntime(), sourceMode));
  const hit = probeRecall(rt);
  const ghostExists = entriesOf(rt).some((entry) =>
    entry.eventRefs.includes(GHOST_EVENT) && entry.memoryId !== 'm_fake_ghost',
  );
  return {
    recalled: hit.memoryIds.includes('m_fake_ghost'),
    mode: hit.modes[hit.memoryIds.indexOf('m_fake_ghost')] ?? null,
    ghostExists,
    report: rt.lastImport,
  };
}

/** 对照组：关掉读档闸——直连 `world.restoreSnapshot`，`MemoryRuntime` 的闸不参与。 */
function looseFakeProbe(sourceMode: SourceMode): { recalled: boolean; mode: string | null } {
  const snapshot = JSON.parse(injectedSnapshot(baselineRuntime(), sourceMode)) as {
    world: Parameters<MemoryRuntime['world']['restoreSnapshot']>[0];
  };
  const rt = runtime();
  rt.world.restoreSnapshot(snapshot.world);
  const hit = probeRecall(rt);
  return {
    recalled: hit.memoryIds.includes('m_fake_ghost'),
    mode: hit.modes[hit.memoryIds.indexOf('m_fake_ghost')] ?? null,
  };
}

function probeRecall(rt: MemoryRuntime): RecallSnapshot {
  return recallOf(rt, 'eval-ghost-place');
}

export function runCounterfactual(): CounterfactualResult {
  const rt = baselineRuntime();
  const before = recallOf(rt, 'eval-p1');
  const timelineBeforeEvents = rt.timelineFor('a').map((item) => item.eventId);
  const hintsBefore = rt.placeHints('eval-p1').map((hint) => hint.traceId);

  rt.world.delete({ kind: 'event', id: 'eval-e1' });

  const after = recallOf(rt, 'eval-p1');
  const allAfter = recallOf(rt);
  const timelineAfterEvents = rt.timelineFor('a').map((item) => item.eventId);
  const hintsAfter = rt.placeHints('eval-p1').map((hint) => hint.traceId);
  const danglingRefs = entriesOf(rt).filter((entry) => entry.eventRefs.includes('eval-e1')).length;

  const rumor = fakeProbe('heard');
  const witnessed = fakeProbe('witnessed');
  const looseWitnessed = looseFakeProbe('witnessed');

  return {
    schema: 'eval-counterfactual/1',
    seedKey: 'eval-counterfactual',
    before,
    after,
    allAfter,
    removedMemoryIds: before.memoryIds.filter((id) => !after.memoryIds.includes(id)),
    timelineBeforeEvents,
    timelineAfterEvents,
    hintsBefore,
    hintsAfter,
    danglingRefs,
    fake: {
      ghostEventId: GHOST_EVENT,
      ghostEventExists: rumor.ghostExists || witnessed.ghostExists,
      rumorRecalled: rumor.recalled,
      rumorMode: rumor.mode,
      witnessedRecalled: witnessed.recalled,
      witnessedMode: witnessed.mode,
      importReport: witnessed.report,
      looseWitnessedRecalled: looseWitnessed.recalled,
      looseWitnessedMode: looseWitnessed.mode,
    },
  };
}
