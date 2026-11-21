/** Copy-on-Write 平行世界线会话协调器单测（兼容 red:first）。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import('../src/world/history/scene-history.ts')) as unknown as Record<string, unknown>;

interface SessionLike {
  getActiveBranchId(): string;
  getTreeSummary(): { activeBranchId: string; branchCount: number };
  getDayTurnpoints(day: number, branchId?: string): readonly { kind: string; token?: string; delta?: number }[];
  recordDay(day: number, metrics: unknown, fingerprint: string, doc: unknown): unknown;
  forkAt(targetDay: number, fromDay: number): { branchId: string; parentBranchId: string; evictedBranchId: string | null };
  switchBranch(branchId: string): { ok: boolean; branchId: string; latestDay: number | null; doc: { day: number; tag?: string } | null };
  compareWithParent(branchId: string, day?: number): { day: number; fingerprintChanged: boolean; deltaBuildings: number; deltaBeliefs: number } | null;
}

type SessionCtor = new (options?: { worldId?: string; maxBranches?: number }) => SessionLike;

function requireSessionCtor(): SessionCtor {
  assert.equal(typeof mod['WorldlineSession'], 'function', 'WorldlineSession 必须从 scene-history.ts 导出');
  return mod['WorldlineSession'] as SessionCtor;
}

function makeMetrics(buildingsCount: number, beliefsCount: number, phase = '序幕') {
  return { buildingsCount, roadsCount: 4, beliefsCount, factsCount: 6, weather: 'clear', phase };
}

test('WorldlineSession 分叉走 Copy-on-Write，无损保留 branch-0 后续快照并支持跳回', () => {
  const WorldlineSession = requireSessionCtor();
  const session = new WorldlineSession({ worldId: 'dengchao' });

  for (let d = 1; d <= 5; d += 1) {
    session.recordDay(d, makeMetrics(3 + d, 10), `fp-main-${d}`, { day: d, tag: `main-d${d}` });
  }

  const forked = session.forkAt(2, 5);
  assert.equal(forked.parentBranchId, 'branch-0');
  assert.equal(session.getActiveBranchId(), forked.branchId);

  session.recordDay(3, makeMetrics(12, 16, '雨季'), 'fp-alt-3', { day: 3, tag: 'alt-d3' });
  const badges = session.getDayTurnpoints(3, forked.branchId);
  assert.ok(badges.length > 0 && badges.length <= 2);

  const diff = session.compareWithParent(forked.branchId, 3);
  assert.ok(diff !== null);
  assert.equal(diff.fingerprintChanged, true);
  assert.equal(diff.deltaBuildings, 6);
  assert.equal(diff.deltaBeliefs, 6);

  const backMain = session.switchBranch('branch-0');
  assert.equal(backMain.ok, true);
  assert.equal(backMain.latestDay, 5);
  assert.equal(backMain.doc?.tag, 'main-d5');

  const backAlt = session.switchBranch(forked.branchId);
  assert.equal(backAlt.ok, true);
  assert.equal(backAlt.latestDay, 3);
  assert.equal(backAlt.doc?.tag, 'alt-d3');
});
