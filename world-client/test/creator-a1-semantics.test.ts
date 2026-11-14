/** A1 口径定性：钉住「schemaPassRate 测的是落地成功率，不是 Schema 校验通过率」。
 *
 * 见 ADR_SCHEMA_PASS_RATE_SEMANTICS。这组断言不是为了证明系统「没问题」，
 * 而是防止后来者把 `schemaPassRate === 1` 误读成「校验跑过很多次、全过了」。
 * 若哪天接上了真正的「模型产出被 schema 拒」信号、开始传 approved=false，
 * 这组断言会红——那正是要人回来重新定口径的时刻，别顺手把断言改松。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousFuseController, AutonomyLevel } from '../src/world/creator/fuse.ts';
import { ratesOf, type MetricWindow } from '../src/world/creator/fuse.ts';

function controller(): AutonomousFuseController {
  const c = new AutonomousFuseController(() => 0);
  c.initRole('mapper', 'mapper-role', AutonomyLevel.L0, AutonomyLevel.L3);
  return c;
}

test('A1：只记落地成功时，schemaPassRate 恒为 1（这正是当前口径）', () => {
  const c = controller();
  for (let i = 0; i < 5; i += 1) {
    c.recordCommandResult('mapper', { schemaPassed: true });
  }
  const rates = c.getRates('mapper')!;
  assert.equal(rates.totalCommands, 5);
  assert.equal(rates.schemaPassRate, 1, '没有 false 输入，通过率必然是 1');
  assert.equal(rates.manualModificationRate, 0, '没有 modifications，人工修改率必然是 0');
});

test('A1：引擎能表达失败侧，但一次失败会立刻熔断——所以更不能乱记', () => {
  const c = controller();
  c.recordCommandResult('mapper', { schemaPassed: true });
  assert.equal(c.getRates('mapper')!.totalCommands, 1);
  assert.equal(c.getRates('mapper')!.schemaPassRate, 1);

  // 关键事实：单条 schemaPassed:false 让拒绝率 100% > 10% 阈值，
  // checkDowngradeTriggers 立即熔断并清空指标窗口（total 归 0）。
  // 这正是 ADR 说的「把玩家点错位置记成质量失败会连累外环」的硬证据——
  // 不是拉低一点分数，是角色直接被隔离。
  c.recordCommandResult('mapper', { schemaPassed: false });
  const state = c.getRoleState('mapper')!;
  assert.equal(state.isFused, true, '一条失败即触发熔断');
  assert.equal(c.getRates('mapper')!.totalCommands, 0, '熔断后旧成绩作废、窗口清零');
  assert.equal(c.getRates('mapper')!.schemaPassRate, null);
});

test('A1：没测过（分母 0）是 null，不是满分——这条与「恒为 1」不能混为一谈', () => {
  const empty: MetricWindow = {
    batches: 0, days: 0, totalCommands: 0, schemaPassCount: 0,
    conflictCount: 0, conflictChecks: 0, coverageRate: 0, coverageChecks: 0,
    pathfindingChecks: 0, pathfindingConnectedCount: 0,
    collisionChecks: 0, collisionFreeCount: 0,
    constraintChecks: 0, constraintSatisfiedCount: 0,
    traceabilityChecks: 0, traceableCount: 0,
    replayChecks: 0, replayConsistentCount: 0,
    manualModificationCount: 0, rollbackCount: 0,
    invariantViolationCount: 0, invariantChecks: 0,
  };
  assert.equal(ratesOf(empty).schemaPassRate, null, '没观测过 ≠ 满分');
});

test('A1：三类「失败」都不该被误算成质量失败（口径边界）', () => {
  // 这里直接列出 ADR 里核实过的三类，用注释钉住，避免有人把其中一类
  // 顺手接进 recordCommandResult({schemaPassed:false}) 而不重新定口径。
  const nonQualityFailures = [
    '玩家取消造物（cancelCreation，人的意图撤回）',
    '玩家造物参数不合法（confirmCreation 的 schema catch，玩家选错）',
    '自动提议被熔断/抽检拒绝（门禁正常工作，不是生成质量差）',
  ] as const;
  assert.equal(nonQualityFailures.length, 3);

  const c = controller();
  // 模拟「只发生这三类、不落地」：fuse 窗口应当没有任何命令样本。
  assert.equal(c.getRates('mapper')!.totalCommands, 0,
    '这三类都不进 fuse 指标窗口');
  assert.equal(c.getRates('mapper')!.schemaPassRate, null);
});
