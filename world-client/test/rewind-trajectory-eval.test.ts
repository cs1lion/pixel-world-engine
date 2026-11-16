/**
 * 世界时间回溯与 Trajectory 因果可观测性防假绿单测
 * 放置路径建议：world-client/test/rewind-trajectory-eval.test.ts
 * 运行方式：node --import tsx --test world-client/test/rewind-trajectory-eval.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
// 只静态 import 基线已存在的两个历史层入口（store.ts / scene-history.ts）。
// 新符号（pruneAfter / restoreSave / TrajectoryRecorder）在 base 上不存在，
// 但模块本身存在——先做存在性断言，让 red:first 在 base 上红在断言上（B7），
// 而不是 ERR_MODULE_NOT_FOUND（那会被判 module，不可采信）。
import * as historyStore from '../src/world/history/store.ts';
import * as sceneHistory from '../src/world/history/scene-history.ts';
import { clearWeather, type WeatherState } from '../src/world/weather.ts';
import type { HistoryDoc } from '../src/world/history/patch.ts';
import type { WorldSave } from '../src/world/save.ts';
import type { MemoryRuntimeSnapshot } from '../src/world/memory/runtime.ts';
import type { Belief } from '../src/world/memory/types.ts';

const { MemoryHistoryStore } = historyStore;
const { SceneHistory } = sceneHistory;

/** 存在性闸门：base 上这里红（AssertionError），tip 上继续跑行为断言。 */
function requireRewindSurface(): {
  readonly TrajectoryRecorder: new (worldId: string) => InstanceType<typeof sceneHistory.TrajectoryRecorder>;
} {
  assert.equal(
    typeof (sceneHistory as { TrajectoryRecorder?: unknown }).TrajectoryRecorder,
    'function',
    'scene-history.ts 必须桶导出 TrajectoryRecorder（回溯轨迹账本）',
  );
  assert.equal(
    typeof MemoryHistoryStore.prototype.pruneAfter,
    'function',
    'MemoryHistoryStore 必须实现 pruneAfter(day)（清理未来悬空补丁）',
  );
  assert.equal(
    typeof SceneHistory.prototype.restoreSave,
    'function',
    'SceneHistory 必须实现 restoreSave(day, fromDay)（真回滚，不毁档）',
  );
  return { TrajectoryRecorder: sceneHistory.TrajectoryRecorder };
}

function makeSampleDoc(day: number, buildings: number, beliefs: number, weather: WeatherState = clearWeather()): HistoryDoc {
  const factsCount = day * 2;
  const beliefsList: Belief[] = Array.from({ length: beliefs }, (_, i) => ({
    holderId: 'villager-0',
    claimId: `c${day}-${i}`,
    eventRefs: ['event-1'],
    confidence: 1,
    learnedDay: day,
    sourceHolderId: 'villager-0',
    hop: 1,
    state: 'held',
  }));
  const memory: MemoryRuntimeSnapshot = {
    memorySchemaVersion: 4,
    lastClosedDay: day,
    started: true,
    now: day * 1440,
    positions: [],
    world: {
      holders: [],
      facts: [],
      entries: [],
      claims: [],
      beliefs: beliefsList,
      traces: [],
      placeAnchors: [],
      landmarks: [],
      eras: [],
      epics: [],
      turningPoints: [],
      bonds: [],
      moods: [],
      legends: [],
      placeNames: [],
      announcements: [],
      tells: [],
      written: [],
      cooldowns: [],
      digests: [],
      fanout: { day: 1, counts: [] },
      verifyPlans: [],
      credibility: [],
      nextSerial: 1,
      currentDay: day,
      metToday: [],
    },
  };
  // 评测断言直接读的轻量摘要（与参考实现同口径），附加在快照上。
  const withSummary =
    memory as MemoryRuntimeSnapshot & {
      beliefsCount: number;
      factsCount: number;
      entries: string[];
    };
  withSummary.beliefsCount = beliefs;
  withSummary.factsCount = factsCount;
  withSummary.entries = [`day-${day}-entry`];

  const world: WorldSave['world'] & { readonly buildingsCount?: number; readonly roadsCount?: number } = {
    now: day * 1440,
    weather,
    buildingsCount: buildings,
    roadsCount: buildings * 3,
    memory: '', // 模拟 SandboxScene.ts 中 this.sim.toSave('') 将 memory 置空的行为
    siteOutput: '',
    autonomy: null,
    terrainEdits: [],
    villagers: [],
    buildings: [],
    roads: [],
    props: [],
    tasks: [],
    pending: [],
    activities: [],
    constructions: [],
    faith: { points: 0, milestones: 0 },
    settled: [],
    nextTaskNumber: 0,
    nextPendingNumber: 0,
    oracle: [],
    critters: [],
    tideOverride: null,
    worldChangeVersion: 0,
  };
  const save: WorldSave = {
    schemaVersion: 8,
    world,
    meta: {
      savedAtWallClock: day * 1440,
      savedReconciled: false,
      schemaFingerprint: 'rewind-test',
    },
  };
  return { day, save, memory: withSummary };
}

test('EDD 防假绿 1：restoreSave(day) 必须把 doc.memory 重新注入 save.world.memory（严禁置空毁档）', async () => {
  const { TrajectoryRecorder } = requireRewindSurface();
  const store = new MemoryHistoryStore();
  const ledger = new TrajectoryRecorder('dengchao');
  const history = new SceneHistory({ worldId: 'dengchao', store, trajectoryRecorder: ledger, everyDays: 30 });

  history.capture(1, makeSampleDoc(1, 2, 5));
  history.capture(2, makeSampleDoc(2, 3, 8));
  history.capture(3, makeSampleDoc(3, 4, 12));
  await history.flush();

  // 原只读 rewind(2) 会把 save.world.memory 置空为 ''
  const readOnlyView = await history.rewind(2);
  assert.equal(readOnlyView.save?.world.memory, '', '只读视图保持 memory 置空以兼容旧契约');

  // 新 restoreSave(2) 必须还原出非空且可反序列化的完整 world.memory
  const restored = await history.restoreSave(2, 3);
  assert.equal(restored.ok, true);
  assert.ok(restored.save && restored.save.world.memory.length > 10, '恢复存档必须携带完整 world.memory');

  const parsedMemory = JSON.parse(restored.save!.world.memory);
  assert.equal(parsedMemory.beliefsCount, 8);
  assert.deepEqual(parsedMemory.entries, ['day-2-entry']);
});

test('EDD 防假绿 2：回溯保真度自证（RewindFidelityProof）必须校验还原指纹与原始日结指纹 100% 一致', async () => {
  const { TrajectoryRecorder } = requireRewindSurface();
  const store = new MemoryHistoryStore();
  const ledger = new TrajectoryRecorder('dengchao');
  const history = new SceneHistory({ worldId: 'dengchao', store, trajectoryRecorder: ledger, everyDays: 30 });

  for (let d = 1; d <= 5; d++) {
    history.capture(d, makeSampleDoc(d, d + 1, d * 3));
  }
  await history.flush();

  const originalNodeDay3 = ledger.getNode('branch-0', 3);
  assert.ok(originalNodeDay3, 'Day 3 日结时必须已记录 Trajectory 节点');

  const restored = await history.restoreSave(3, 5);
  assert.equal(restored.ok, true);
  assert.equal(restored.fidelity.fidelityMatch, true, 'base+patch 还原指纹必须与原始日结指纹完全一致');
  assert.equal(restored.fidelity.restoredFingerprint, originalNodeDay3!.stateFingerprint);
});

test('EDD 防假绿 3：pruneAfter(targetDay) 必须清理未来悬空补丁并重置差分基准，确保续跑不报错不断裂', async () => {
  const { TrajectoryRecorder } = requireRewindSurface();
  const store = new MemoryHistoryStore();
  const ledger = new TrajectoryRecorder('dengchao');
  const history = new SceneHistory({ worldId: 'dengchao', store, trajectoryRecorder: ledger, everyDays: 30 });

  for (let d = 1; d <= 5; d++) {
    history.capture(d, makeSampleDoc(d, d, d * 2));
  }
  await history.flush();

  // 从 Day 5 回溯到 Day 2（自动截断 Day 3, 4, 5 的旧补丁）
  const restored = await history.restoreSave(2, 5);
  assert.equal(restored.ok, true);

  const daysAfterPrune = await store.listDays();
  assert.deepEqual(
    daysAfterPrune.map((d) => d.day),
    [1, 2],
    'Day 2 之后的旧补丁必须从主存储中清理'
  );

  // 从 Day 2 重新推进到 Day 3（不同建筑数），验证 previous 基准已对齐到 Day 2，生成连续 patch 而非断层 base
  history.capture(3, makeSampleDoc(3, 9, 20, clearWeather()));
  await history.flush();

  const daysAfterReAdvance = await store.listDays();
  const day3Record = daysAfterReAdvance.find((d) => d.day === 3);
  assert.equal(day3Record?.kind, 'patch', '从回溯点继续推进下一天必须平滑生成连续 patch');
});

test('EDD 防假绿 4：TrajectoryLedger 必须完整保留被回溯掉的影子轨迹段，并计算反事实分叉差异', async () => {
  const { TrajectoryRecorder } = requireRewindSurface();
  const store = new MemoryHistoryStore();
  const ledger = new TrajectoryRecorder('dengchao');
  const history = new SceneHistory({ worldId: 'dengchao', store, trajectoryRecorder: ledger, everyDays: 30 });

  // 主线 branch-0 推进到 Day 4（Day 4 有 4 座建筑、8 条信念）
  for (let d = 1; d <= 4; d++) {
    history.capture(d, makeSampleDoc(d, d, d * 2, clearWeather()));
  }
  await history.flush();

  // 从 Day 4 回溯至 Day 2，开启 branch-1
  const restored = await history.restoreSave(2, 4);
  assert.equal(restored.ok, true);
  assert.equal(ledger.getActiveBranchId(), 'branch-1');

  const spans = ledger.getRewindSpans();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].parentBranchId, 'branch-0');
  assert.equal(spans[0].newBranchId, 'branch-1');
  assert.equal(spans[0].forkAtDay, 2);
  assert.deepEqual(
    spans[0].archivedNodes.map((n) => n.day),
    [3, 4],
    '被回溯覆盖的 Day 3、Day 4 必须保留在影子轨迹归档中供可观测对比'
  );

  // 在新分支 branch-1 推进 Day 3、Day 4（建造了更多建筑：Day 4 变成 7 座建筑、14 条信念）
  history.capture(3, makeSampleDoc(3, 5, 10, clearWeather()));
  history.capture(4, makeSampleDoc(4, 7, 14, clearWeather()));
  await history.flush();

  const diffAtDay4 = ledger.compareBranches('branch-0', 'branch-1', 4);
  assert.ok(diffAtDay4, '必须支持跨分支同日反事实对比');
  assert.equal(diffAtDay4!.fingerprintChanged, true);
  assert.equal(diffAtDay4!.deltaBuildings, 3); // 7 - 4 = +3
  assert.equal(diffAtDay4!.deltaBeliefs, 6); // 14 - 8 = +6
});

test('EDD 防假绿 5：目标日为 missing 或越界时必须拒绝破坏性恢复，保护当前主档安全', async () => {
  const { TrajectoryRecorder } = requireRewindSurface();
  const store = new MemoryHistoryStore();
  const ledger = new TrajectoryRecorder('dengchao');
  const history = new SceneHistory({ worldId: 'dengchao', store, trajectoryRecorder: ledger, everyDays: 30 });

  history.capture(1, makeSampleDoc(1, 2, 4));
  history.markMissing(2);
  history.capture(3, makeSampleDoc(3, 3, 6));
  await history.flush();

  const resMissing = await history.restoreSave(2, 3);
  assert.equal(resMissing.ok, false);
  assert.equal(resMissing.reason, 'missing_day');
  assert.equal(ledger.getActiveBranchId(), 'branch-0', '失败回溯不得产生假分叉');
});