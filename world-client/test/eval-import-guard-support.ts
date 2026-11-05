/**
 * 读档闸（`src/world/memory/import-guard.ts`）的共用探针：测试与证据脚本走同一份。
 *
 * 四个场景，对应四条判据：
 *
 * | 场景 | 造法 | 期望 |
 * | --- | --- | --- |
 * | `fabricated` | 基线世界 + 塞一条 `witnessed` 的假记忆（引用从未存在的事件） | 降级为 `heard`，`downgradedEntries=1` |
 * | `fabricatedLoose` | 同上，但绕过 `MemoryRuntime` 直连 `world.restoreSnapshot` | 仍以 `witnessed` 复活（造错守卫的靶子） |
 * | `prunedLegit` | 基线世界 + 从快照里删事实、保留断言（= 历史淘汰） | 仍是 `witnessed`，`prunedUnverifiable=2` |
 * | `fabricatedNoCorroboration` | 同上，但连断言一起删 | 降级为 `heard`（没有旁证 → 不是历史淘汰） |
 * | `realSample` | 仓库里的真 v5 存档（`traces/outer-baseline-v5.json`） | 导入前后 `witnessed` 条数不变 |
 * | `soakArchive` | pwe-soak 的 90 天存档（只读引用，路径由调用方给） | 71 → 71，降级 0、拒绝 0、淘汰旁证 12 |
 */
import { DAY_MS } from '../src/world/memory/config.ts';
import type { MemoryImportReport } from '../src/world/memory/import-guard.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

const GHOST_EVENT = 'eval-ghost-never-happened';
const GHOST_PLACE = 'eval-ghost-place';
const REAL_EVENT = 'eval-guard-e1';

export interface GuardScenario {
  readonly name: string;
  readonly witnessedBefore: number;
  readonly witnessedAfter: number;
  readonly refused: number;
  readonly downgraded: number;
  readonly prunedUnverifiable: number;
  /** 被探的那条记忆在召回里的 `sourceMode`；没召回时为 `null`。 */
  readonly probedMode: string | null;
  readonly probedRecalled: boolean;
  readonly importReport: MemoryImportReport | null;
}

interface SnapshotShape {
  memorySchemaVersion: number;
  lastClosedDay: number;
  started: boolean;
  now: number;
  positions: { holderId: string; at: { x: number; y: number } }[];
  world: Record<string, unknown> & {
    entries: Record<string, unknown>[];
    facts: { eventId: string }[];
    claims?: unknown[];
  };
}

function runtime(): MemoryRuntime {
  return new MemoryRuntime({ worldId: 'eval-import-guard' });
}

/** 一个只有一条亲历事件的小世界，快照里的断言就是这条事件的旁证。 */
function baseline(): MemoryRuntime {
  const rt = runtime();
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: REAL_EVENT,
      kind: 'workshop_accident',
      placeId: 'eval-guard-p1',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: { what: '炉子炸了' },
      importanceHint: 0.95,
    },
    ['a', 'b'],
    DAY_MS - 1,
  );
  rt.tick(DAY_MS);
  return rt;
}

function snapshotOf(rt: MemoryRuntime): SnapshotShape {
  return JSON.parse(rt.toJSON()) as SnapshotShape;
}

function countWitnessed(snap: SnapshotShape): number {
  return snap.world.entries.filter((entry) => entry.sourceMode === 'witnessed').length;
}

function probeMode(rt: MemoryRuntime, eventRef: string): { recalled: boolean; mode: string | null } {
  const outcome = rt.recallForDialogue('a', {
    cues: {},
    commit: false,
    nowDay: 1,
    seedKey: 'eval-import-guard',
  });
  const index = outcome.hits.findIndex((hit) => hit.entry.eventRefs.includes(eventRef));
  return {
    recalled: index !== -1,
    mode: index === -1 ? null : outcome.hits[index]!.entry.sourceMode,
  };
}

function injectFake(snap: SnapshotShape, sourceMode: 'witnessed' | 'heard'): string {
  const template = snap.world.entries[0];
  if (template === undefined) throw new Error('基线快照里没有记忆，探针失效');
  snap.world.entries.push({
    ...template,
    memoryId: 'm_fake_ghost',
    eventRefs: [GHOST_EVENT],
    sourceMode,
    sourceChain: sourceMode === 'heard' ? ['b'] : [],
    content: { ...(template.content as Record<string, unknown>), what: '（假记忆）', where: GHOST_PLACE },
  });
  return JSON.stringify(snap);
}

/** 场景 1：假记忆走过读档闸 → 降级。 */
export function runFabricated(): GuardScenario {
  const snap = snapshotOf(baseline());
  const rt = runtime();
  rt.fromJSON(injectFake(snap, 'witnessed'));
  const probe = probeMode(rt, GHOST_EVENT);
  const report = rt.lastImport;
  return {
    name: 'fabricated',
    // 读档闸数的是「注入之后」的 witnessed；基线本身只做前提核对。
    witnessedBefore: report?.witnessedBefore ?? -1,
    witnessedAfter: report?.witnessedAfter ?? -1,
    refused: report?.refusedEntries ?? -1,
    downgraded: report?.downgradedEntries ?? -1,
    prunedUnverifiable: report?.prunedUnverifiable ?? -1,
    probedMode: probe.mode,
    probedRecalled: probe.recalled,
    importReport: report,
  };
}

/** 场景 1b（造错守卫）：绕过 `MemoryRuntime`，直连 `world.restoreSnapshot`。 */
export function runFabricatedLoose(): { recalled: boolean; mode: string | null } {
  const snap = snapshotOf(baseline());
  const parsed = JSON.parse(injectFake(snap, 'witnessed')) as SnapshotShape;
  const rt = runtime();
  rt.world.restoreSnapshot(
    parsed.world as unknown as Parameters<MemoryRuntime['world']['restoreSnapshot']>[0],
  );
  return probeMode(rt, GHOST_EVENT);
}

/** 场景 2：事实被淘汰、断言还在 → 合法悬空，仍算亲历。 */
export function runPrunedLegit(): GuardScenario {
  const snap = snapshotOf(baseline());
  const before = countWitnessed(snap);
  snap.world.facts = snap.world.facts.filter((fact) => fact.eventId !== REAL_EVENT);
  const rt = runtime();
  rt.fromJSON(JSON.stringify(snap));
  const probe = probeMode(rt, REAL_EVENT);
  return {
    name: 'prunedLegit',
    witnessedBefore: before,
    witnessedAfter: rt.lastImport?.witnessedAfter ?? -1,
    refused: rt.lastImport?.refusedEntries ?? -1,
    downgraded: rt.lastImport?.downgradedEntries ?? -1,
    prunedUnverifiable: rt.lastImport?.prunedUnverifiable ?? -1,
    probedMode: probe.mode,
    probedRecalled: probe.recalled,
    importReport: rt.lastImport,
  };
}

/** 场景 3：事实与断言都删光 → 一处旁证都没有，按编造处理，降级。 */
export function runPrunedWithoutCorroboration(): GuardScenario {
  const snap = snapshotOf(baseline());
  snap.world.facts = snap.world.facts.filter((fact) => fact.eventId !== REAL_EVENT);
  // 旁证一处不留：断言、信念、痕迹、传说、史诗、成长记录、关系账本、地标、地名史。
  snap.world.claims = [];
  for (const key of [
    'beliefs', 'traces', 'legends', 'epics', 'turningPoints', 'bonds', 'landmarks', 'placeNames',
  ]) {
    if (Array.isArray(snap.world[key])) snap.world[key] = [];
  }
  const rt = runtime();
  rt.fromJSON(JSON.stringify(snap));
  const probe = probeMode(rt, REAL_EVENT);
  return {
    name: 'prunedWithoutCorroboration',
    witnessedBefore: rt.lastImport?.witnessedBefore ?? -1,
    witnessedAfter: rt.lastImport?.witnessedAfter ?? -1,
    refused: rt.lastImport?.refusedEntries ?? -1,
    downgraded: rt.lastImport?.downgradedEntries ?? -1,
    prunedUnverifiable: rt.lastImport?.prunedUnverifiable ?? -1,
    probedMode: probe.mode,
    probedRecalled: probe.recalled,
    importReport: rt.lastImport,
  };
}

/** 场景 4：真 v5 存档（`world.memory` 是一段 JSON 字符串）。 */
export function runRealSample(savePath: string, readText: (path: string) => string): GuardScenario {
  const save = JSON.parse(readText(savePath)) as { world?: { memory?: unknown } };
  const memoryText = save.world?.memory;
  if (typeof memoryText !== 'string') throw new Error(`${savePath} 里没有 world.memory 字符串`);
  if (memoryText === '') {
    // v4→v5 迁移给老档的默认值：没有记忆，不该有任何降级。
    return {
      name: 'realSample',
      witnessedBefore: 0,
      witnessedAfter: 0,
      refused: 0,
      downgraded: 0,
      prunedUnverifiable: 0,
      probedMode: null,
      probedRecalled: false,
      importReport: null,
    };
  }
  const before = countWitnessed(JSON.parse(memoryText) as SnapshotShape);
  const rt = runtime();
  rt.fromJSON(memoryText);
  return {
    name: 'realSample',
    witnessedBefore: before,
    witnessedAfter: rt.lastImport?.witnessedAfter ?? -1,
    refused: rt.lastImport?.refusedEntries ?? -1,
    downgraded: rt.lastImport?.downgradedEntries ?? -1,
    prunedUnverifiable: rt.lastImport?.prunedUnverifiable ?? -1,
    probedMode: null,
    probedRecalled: false,
    importReport: rt.lastImport,
  };
}

/** 场景 5：pwe-soak 的 90 天存档（只读引用，不从本分支复制）。 */
export function runSoakArchive(
  savePath: string,
  readText: (path: string) => string,
): GuardScenario {
  return { ...runRealSample(savePath, readText), name: 'soakArchive' };
}
