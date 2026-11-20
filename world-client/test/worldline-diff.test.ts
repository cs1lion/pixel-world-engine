/** 命运分叉沙盘 UI 格式化、对照日追赶计算与改命切片单测。
 *
 * 动态 import + try/catch：兼容 red:first（未落地前红在导出断言而非 ERR_MODULE_NOT_FOUND）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod: Record<string, unknown> = {};
try {
  mod = (await import('../src/ui/worldline-diff.ts')) as unknown as Record<string, unknown>;
} catch {
  // 缺文件时交给下方导出断言失败
}

function need<T>(name: string): T {
  assert.equal(typeof mod[name], 'function', `${name} 必须从 ui/worldline-diff.ts 导出`);
  return mod[name] as T;
}

test('formatTurnpointBadge 覆盖全部 5 类转折并支持 WorldBundle 自定义词表', () => {
  const formatTurnpointBadge = need<
    (badge: { day: number; kind: string; severity: number; token?: string; delta?: number }, opts?: { weatherLabels?: Record<string, string>; phasePrefix?: string }) => string
  >('formatTurnpointBadge');

  assert.equal(formatTurnpointBadge({ day: 3, kind: 'phase_shift', severity: 4, token: '雨季' }), '进入雨季');
  assert.equal(formatTurnpointBadge({ day: 4, kind: 'extreme_weather', severity: 3, token: 'thunderstorm' }), '雷暴来袭');
  assert.equal(
    formatTurnpointBadge(
      { day: 4, kind: 'extreme_weather', severity: 3, token: 'thunderstorm' },
      { weatherLabels: { thunderstorm: '天劫雷潮' } },
    ),
    '天劫雷潮',
  );
  assert.equal(formatTurnpointBadge({ day: 5, kind: 'belief_drop', severity: 2, delta: -4 }), '信念骤降(-4)');
  assert.equal(formatTurnpointBadge({ day: 6, kind: 'belief_surge', severity: 2, delta: 5 }), '信念飙升(+5)');
  assert.equal(formatTurnpointBadge({ day: 7, kind: 'building_growth', severity: 1, delta: 2 }), '新建+2栋');
});

test('resolveParityTarget 严格区分已可对比日与父分支目标追赶日', () => {
  const resolveParityTarget = need<
    (summary: unknown, branchId: string, currentDay: number) => {
      latestComparableDay: number | null;
      targetParityDay: number | null;
      remainingDays: number;
      canFastForward: boolean;
    }
  >('resolveParityTarget');

  const summary = {
    worldId: 'dengchao',
    activeBranchId: 'branch-1',
    maxBranches: 4,
    branchCount: 2,
    branches: [
      {
        branchId: 'branch-0',
        parentBranchId: null,
        isMain: true,
        isActive: false,
        forkDay: null,
        forkFromDay: null,
        minDay: 1,
        maxDay: 12,
        dayCount: 12,
        parityDay: null,
        turnpoints: [],
        interventions: [],
      },
      {
        branchId: 'branch-1',
        parentBranchId: 'branch-0',
        isMain: false,
        isActive: true,
        forkDay: 4,
        forkFromDay: 12,
        minDay: 1,
        maxDay: 6,
        dayCount: 6,
        parityDay: 6,
        turnpoints: [],
        interventions: [],
      },
    ],
  };

  const mainView = resolveParityTarget(summary, 'branch-0', 12);
  assert.equal(mainView.canFastForward, false);
  assert.equal(mainView.targetParityDay, null);

  const midView = resolveParityTarget(summary, 'branch-1', 6);
  assert.equal(midView.latestComparableDay, 6);
  assert.equal(midView.targetParityDay, 12);
  assert.equal(midView.remainingDays, 6);
  assert.equal(midView.canFastForward, true);

  const caughtUp = resolveParityTarget(summary, 'branch-1', 12);
  assert.equal(caughtUp.remainingDays, 0);
  assert.equal(caughtUp.canFastForward, false);
});

test('buildWorldlineDiffReport 正确格式化差值与自证状态', () => {
  const buildWorldlineDiffReport = need<
    (diff: unknown, branch: unknown) => {
      day: number;
      forkDay: number | null;
      fingerprintChanged: boolean;
      metrics: readonly { key: string; label: string; formatted: string }[];
    }
  >('buildWorldlineDiffReport');

  const report = buildWorldlineDiffReport(
    {
      day: 10,
      branchA: 'branch-0',
      branchB: 'branch-1',
      fingerprintA: 'fp-a-123456',
      fingerprintB: 'fp-b-987654',
      fingerprintChanged: true,
      deltaBuildings: 2,
      deltaRoads: -1,
      deltaBeliefs: 0,
      deltaFacts: 3,
    },
    {
      branchId: 'branch-1',
      parentBranchId: 'branch-0',
      isMain: false,
      isActive: true,
      forkDay: 4,
      forkFromDay: 10,
      minDay: 1,
      maxDay: 10,
      dayCount: 10,
      parityDay: 10,
      turnpoints: [],
      interventions: [{ day: 4, kind: 'oracle', label: '降下晴日神谕' }],
    },
  );

  assert.equal(report.day, 10);
  assert.equal(report.forkDay, 4);
  assert.equal(report.fingerprintChanged, true);
  assert.deepEqual(
    report.metrics.map((m) => `${m.label}:${m.formatted}`),
    ['Δ建筑:+2', 'Δ道路:-1', 'Δ信念:0', 'Δ事实:+3'],
  );
});

test('改命切片 serializeButterflySlice 与 parseButterflySlice 往返一致且拒绝非法 JSON', () => {
  const serializeButterflySlice = need<(worldId: string, branch: unknown) => string>('serializeButterflySlice');
  const parseButterflySlice = need<(raw: string) => { worldId: string; branchId: string; forkDay: number | null; interventions: readonly { label: string }[] } | null>('parseButterflySlice');

  const raw = serializeButterflySlice('dengchao', {
    branchId: 'branch-1',
    parentBranchId: 'branch-0',
    isMain: false,
    isActive: true,
    forkDay: 4,
    forkFromDay: 10,
    minDay: 1,
    maxDay: 10,
    dayCount: 10,
    parityDay: 10,
    turnpoints: [],
    interventions: [{ day: 4, kind: 'oracle', label: '降下晴日神谕', targetId: 'v-1' }],
  });

  const parsed = parseButterflySlice(raw);
  assert.ok(parsed !== null);
  assert.equal(parsed.worldId, 'dengchao');
  assert.equal(parsed.branchId, 'branch-1');
  assert.equal(parsed.forkDay, 4);
  assert.equal(parsed.interventions[0]?.label, '降下晴日神谕');
  assert.equal(parseButterflySlice('{bad json'), null);
  assert.equal(parseButterflySlice(JSON.stringify({ version: 2 })), null);
});
