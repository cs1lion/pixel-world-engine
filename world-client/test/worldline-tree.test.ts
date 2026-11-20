/** 命运分叉沙盘内核（WorldlineTree & detectTurnpoints）单测。
 *
 * 仅从基线已存在的 ../src/world/history/scene-history.ts 动态导入，
 * 确保 red:first 在 base 分支上红在导出断言而不是 ERR_MODULE_NOT_FOUND。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

interface MetricsInput {
  readonly buildingsCount: number;
  readonly roadsCount: number;
  readonly beliefsCount: number;
  readonly factsCount: number;
  readonly weather: string;
  readonly phase?: string | null;
}

interface BadgeShape {
  readonly day: number;
  readonly kind: string;
  readonly label: string;
  readonly severity: number;
}

interface InterventionInput {
  readonly day: number;
  readonly kind: string;
  readonly label: string;
  readonly targetId?: string;
}

interface DayRecordShape {
  readonly day: number;
  readonly stateFingerprint: string;
  readonly metrics: MetricsInput;
  readonly turnpoints: readonly BadgeShape[];
}

interface ForkResultShape {
  readonly branchId: string;
  readonly parentBranchId: string;
  readonly forkDay: number;
  readonly forkFromDay: number;
  readonly evictedBranchId: string | null;
}

interface SwitchResultShape {
  readonly ok: boolean;
  readonly branchId: string;
  readonly previousBranchId: string;
  readonly latestDay: number | null;
  readonly record: DayRecordShape | null;
}

interface WorldlineTreeLike {
  getActiveBranchId(): string;
  getBranchIds(): readonly string[];
  getDayRecord(branchId: string, day: number): DayRecordShape | undefined;
  getInterventions(branchId?: string): readonly InterventionInput[];
  getTurnpoints(branchId?: string): readonly BadgeShape[];
  recordDay(day: number, metrics: MetricsInput, stateFingerprint?: string): DayRecordShape;
  forkAt(targetDay: number, fromDay: number): ForkResultShape;
  recordIntervention(stamp: InterventionInput): boolean;
  switchBranch(branchId: string): SwitchResultShape;
  getParityDay(branchId: string): number | null;
  getTreeSummary(): unknown;
  toJSON(): unknown;
  serialize(): string;
}

interface WorldlineTreeCtor {
  new (options?: { worldId?: string; maxBranches?: number; maxInterventionsPerBranch?: number }): WorldlineTreeLike;
  deserialize(input: string): WorldlineTreeLike;
}

const mod = (await import('../src/world/history/scene-history.ts')) as unknown as Record<string, unknown>;

function requireFn<T>(name: string): T {
  assert.equal(typeof mod[name], 'function', `${name} 必须从 scene-history.ts 导出`);
  return mod[name] as T;
}

function metrics(overrides: Partial<MetricsInput> = {}): MetricsInput {
  return {
    buildingsCount: 4,
    roadsCount: 6,
    beliefsCount: 10,
    factsCount: 8,
    weather: 'clear',
    phase: '序幕',
    ...overrides,
  };
}

test('scene-history 桶导出 WorldlineTree 与 detectTurnpoints', () => {
  requireFn<WorldlineTreeCtor>('WorldlineTree');
  requireFn<unknown>('detectTurnpoints');
});

test('detectTurnpoints 转折日打标上限 <= 2 且输出完全确定性', () => {
  const detectTurnpoints = requireFn<
    (prev: MetricsInput | null | undefined, curr: MetricsInput, day: number) => readonly BadgeShape[]
  >('detectTurnpoints');

  const prev = metrics({ phase: '序幕', beliefsCount: 10, buildingsCount: 4 });
  const curr = metrics({ phase: '雨季', beliefsCount: 15, buildingsCount: 6 });

  const first = detectTurnpoints(prev, curr, 7);
  const second = detectTurnpoints(prev, curr, 7);

  assert.ok(first.length <= 2, `单日转折打标不应超过 2 条，实际 ${first.length}`);
  assert.equal(first.length, 2);
  assert.equal(first[0]?.kind, 'phase_shift');
  assert.equal(first[1]?.kind, 'belief_surge');
  assert.deepEqual(first, second);
});

test('多分支分叉与无损切回主线 branch-0', () => {
  const WorldlineTree = requireFn<WorldlineTreeCtor>('WorldlineTree');
  const tree = new WorldlineTree({ worldId: 'test-world' });

  for (let d = 1; d <= 5; d += 1) {
    tree.recordDay(d, metrics({ buildingsCount: 3 + d }), `fp-main-d${d}`);
  }

  const forked = tree.forkAt(2, 5);
  assert.equal(forked.parentBranchId, 'branch-0');
  assert.equal(forked.forkDay, 2);
  assert.equal(forked.forkFromDay, 5);
  assert.equal(tree.getActiveBranchId(), forked.branchId);
  assert.equal(tree.getDayRecord(forked.branchId, 2)?.stateFingerprint, 'fp-main-d2');
  assert.equal(tree.getDayRecord(forked.branchId, 3), undefined);

  tree.recordDay(3, metrics({ buildingsCount: 9, beliefsCount: 14 }), 'fp-alt-d3');

  const switched = tree.switchBranch('branch-0');
  assert.equal(switched.ok, true);
  assert.equal(switched.branchId, 'branch-0');
  assert.equal(tree.getActiveBranchId(), 'branch-0');
  assert.equal(tree.getDayRecord('branch-0', 3)?.stateFingerprint, 'fp-main-d3');
  assert.equal(tree.getDayRecord('branch-0', 5)?.stateFingerprint, 'fp-main-d5');
});

test('超过 4 条分支时淘汰最旧非主线且永不淘汰 branch-0', () => {
  const WorldlineTree = requireFn<WorldlineTreeCtor>('WorldlineTree');
  const tree = new WorldlineTree({ worldId: 'evict-world' });
  tree.recordDay(1, metrics(), 'fp-1');
  tree.recordDay(2, metrics(), 'fp-2');

  const b1 = tree.forkAt(1, 2);
  tree.switchBranch('branch-0');
  const b2 = tree.forkAt(1, 2);
  tree.switchBranch('branch-0');
  const b3 = tree.forkAt(1, 2);
  assert.equal(b3.evictedBranchId, null);
  assert.equal(tree.getBranchIds().length, 4);

  tree.switchBranch('branch-0');
  const b4 = tree.forkAt(1, 2);
  assert.equal(b4.evictedBranchId, b1.branchId);
  assert.equal(tree.getBranchIds().length, 4);
  assert.ok(tree.getBranchIds().includes('branch-0'));
  assert.ok(!tree.getBranchIds().includes(b1.branchId));
  assert.ok(tree.getBranchIds().includes(b2.branchId));
  assert.ok(tree.getBranchIds().includes(b3.branchId));
  assert.ok(tree.getBranchIds().includes(b4.branchId));
});

test('单分支蝴蝶印记上限 <= 3', () => {
  const WorldlineTree = requireFn<WorldlineTreeCtor>('WorldlineTree');
  const tree = new WorldlineTree({ worldId: 'stamp-world' });
  tree.recordDay(1, metrics(), 'fp-1');
  tree.forkAt(1, 1);

  assert.equal(tree.recordIntervention({ day: 1, kind: 'oracle', label: '降下晴日神谕' }), true);
  assert.equal(tree.recordIntervention({ day: 2, kind: 'build', label: '兴建水井' }), true);
  assert.equal(tree.recordIntervention({ day: 3, kind: 'road', label: '修通石路' }), true);
  assert.equal(tree.recordIntervention({ day: 4, kind: 'oracle', label: '第四次干预应被拒' }), false);
  assert.equal(tree.getInterventions().length, 3);
});

test('getParityDay 正确返回分支与父分支的最大公共对照日', () => {
  const WorldlineTree = requireFn<WorldlineTreeCtor>('WorldlineTree');
  const tree = new WorldlineTree({ worldId: 'parity-world' });
  for (let d = 1; d <= 5; d += 1) {
    tree.recordDay(d, metrics(), `fp-d${d}`);
  }

  assert.equal(tree.getParityDay('branch-0'), null);

  const forked = tree.forkAt(2, 5);
  assert.equal(tree.getParityDay(forked.branchId), 2);

  tree.recordDay(3, metrics(), 'fp-b1-d3');
  tree.recordDay(4, metrics(), 'fp-b1-d4');
  assert.equal(tree.getParityDay(forked.branchId), 4);

  tree.recordDay(6, metrics(), 'fp-b1-d6');
  assert.equal(tree.getParityDay(forked.branchId), 4);
});

test('serialize 与 deserialize 往返完全一致', () => {
  const WorldlineTree = requireFn<WorldlineTreeCtor>('WorldlineTree');
  const tree = new WorldlineTree({ worldId: 'serde-world' });
  tree.recordDay(1, metrics({ phase: '序幕', beliefsCount: 10 }), 'fp-1');
  tree.recordDay(2, metrics({ phase: '雨季', beliefsCount: 14, buildingsCount: 5 }), 'fp-2');
  const forked = tree.forkAt(1, 2);
  tree.recordIntervention({ day: 1, kind: 'oracle', label: '启示', targetId: 'v-1' });
  tree.recordDay(2, metrics({ phase: '雨季', beliefsCount: 16 }), 'fp-b1-2');

  const raw = tree.serialize();
  const restored = WorldlineTree.deserialize(raw);

  assert.equal(restored.serialize(), raw);
  assert.deepEqual(restored.toJSON(), tree.toJSON());
  assert.deepEqual(restored.getTreeSummary(), tree.getTreeSummary());
  assert.equal(restored.getActiveBranchId(), forked.branchId);
});
