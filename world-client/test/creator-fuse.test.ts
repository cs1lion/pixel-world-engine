import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AutonomyLevel,
  AutonomousFuseController,
  FUSE_CONFIG,
  evaluateFuseDecision,
  ratesOf,
} from '../src/world/creator/fuse.ts';
import { FUSE_THRESHOLD_CONFIG } from '../src/world/creator/config.ts';

/**
 * 自治爬梯的双向熔断器。
 *
 * 钉三件事：
 * ① 只有连续达标才允许往上爬（证据要凑够 3 批或 14 天）；
 * ② 出事时**立刻**掉回 L1，而不是等这一批跑完；
 * ③ 熔断之后不能自己跳回来——§2.2 的恢复条件是「直至回归集回放测试重新达标」。
 *
 * 第二条比第一条重要——升级慢一点只是效率问题，降级慢一点是坏指令继续进世界。
 * 第三条是这份实现曾经最严重的一处走样：`allowResumeToTarget` 无条件跳到
 * `targetLevel`，那道回归闸门根本不存在。
 */

function freshController(): AutonomousFuseController {
  const c = new AutonomousFuseController();
  c.initRole('mapper', '地图师', AutonomyLevel.L1, AutonomyLevel.L3);
  return c;
}

const good = {
  schemaPassed: true,
  hasConflict: false,
  coverageRate: 0.98,
  pathfindingConnected: true,
  hasCollision: false,
  spatialConstraintSatisfied: true,
  wasManuallyModified: false,
  invariantViolated: false,
  traceable: true,
  replayHashConsistent: true,
};

/** 记一批全对的指令并结算这一批。 */
function goodBatch(c: AutonomousFuseController, roleId = 'mapper', size = 3): void {
  for (let i = 0; i < size; i++) c.recordCommandResult(roleId, good);
  c.endOfBatch(roleId);
}

/** 用真实爬梯把角色推到 L3——不走测试后门，验证的就是爬梯本身。 */
function climbToL3(c: AutonomousFuseController): void {
  for (let i = 0; i < 10; i++) goodBatch(c);
}

// ---------------------------------------------------------------- 初始化

test('角色起步就在它的定稿起点', () => {
  const c = freshController();
  const state = c.getRoleState('mapper');
  assert.equal(state?.currentLevel, AutonomyLevel.L1);
  assert.equal(state?.targetLevel, AutonomyLevel.L3);
  assert.equal(state?.isFused, false);
});

test('多个角色各自独立，互不串味', () => {
  const c = new AutonomousFuseController();
  c.initRole('mapper', '地图师', AutonomyLevel.L1, AutonomyLevel.L3);
  c.initRole('director', '导演', AutonomyLevel.L1, AutonomyLevel.L2);

  c.recordCommandResult('mapper', good);

  assert.equal(c.getRoleState('mapper')?.metrics.totalCommands, 1);
  assert.equal(c.getRoleState('director')?.metrics.totalCommands, 0);
});

// ---------------------------------------------------------------- 升级

test('连续三批达标之后允许升一级', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) goodBatch(c);

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);
});

test('证据不够升级——两批就想过关是不行的', () => {
  const c = freshController();
  goodBatch(c);
  goodBatch(c);

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L1);
});

test('升级之后窗口清零，下一级要从零重新证明自己', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) goodBatch(c);
  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);

  // 刚升完还没攒新证据，再结算一批不该直接又跳一级。
  goodBatch(c);
  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);

  // 攒够了才跳。
  goodBatch(c);
  goodBatch(c);
  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L3);
});

test('14 个 world_day 也能凑够证据（与 3 批是「或」的关系）', () => {
  const c = freshController();
  for (let day = 0; day < FUSE_CONFIG.climbRequiredDays; day++) {
    c.recordCommandResult('mapper', good);
    c.endOfDay('mapper');
  }
  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);
});

test('通过率不够时一步也不许爬', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) {
    for (let k = 0; k < 3; k++) c.recordCommandResult('mapper', { ...good, schemaPassed: false });
    c.endOfBatch('mapper');
  }

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L1);
});

test('人工修改率超标时不许爬——人要改太多说明它还没学会', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) {
    for (let k = 0; k < 3; k++) c.recordCommandResult('mapper', { ...good, wasManuallyModified: true });
    c.endOfBatch('mapper');
  }

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L1);
});

test('爬到目标等级就停住，不会越过 L3', () => {
  const c = freshController();
  for (let i = 0; i < 30; i++) goodBatch(c);

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L3);
});

// ---------------------------------------------------------------- 计数器不是棘轮

test('一次成功之后再来失败，寻路连通率会掉下来', () => {
  const c = freshController();
  c.recordCommandResult('mapper', { ...good, pathfindingConnected: true });
  c.recordCommandResult('mapper', { ...good, pathfindingConnected: false });

  const rates = c.getRates('mapper');
  assert.equal(rates?.pathfindingConnectedRate, 0.5);
});

test('一次碰撞之后碰撞率不是 0', () => {
  const c = freshController();
  c.recordCommandResult('mapper', { ...good, hasCollision: true });

  assert.equal(c.getRates('mapper')?.collisionRate, 1);
});

test('碰撞会拦住 L2 → L3，即使其余指标全对', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) goodBatch(c);
  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);

  // 攒够三批，但其中一批有碰撞。「重叠碰撞 0%」是 L3 的门禁。
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) {
    c.recordCommandResult('mapper', { ...good, hasCollision: i === 0 });
    c.recordCommandResult('mapper', good);
    c.recordCommandResult('mapper', good);
    c.endOfBatch('mapper');
  }

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);
});

test('碰撞不拦 L1 → L2——那三项是 L3 才要的', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) {
    c.recordCommandResult('mapper', { ...good, hasCollision: true });
    c.recordCommandResult('mapper', good);
    c.recordCommandResult('mapper', good);
    c.endOfBatch('mapper');
  }

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L2);
});

test('没观察过的项是 null，不是满分', () => {
  const c = freshController();
  c.recordCommandResult('mapper', { schemaPassed: true, hasConflict: false });

  const rates = c.getRates('mapper');
  assert.equal(rates?.pathfindingConnectedRate, null);
  assert.equal(rates?.collisionRate, null);
  assert.equal(rates?.replayHashConsistencyRate, null);
  assert.equal(ratesOf(c.getRoleState('mapper')!.metrics).traceabilityRate, null);
});

test('只在 schema 上全对、质量项全没测，不许升级', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) {
    for (let k = 0; k < 3; k++) c.recordCommandResult('mapper', { schemaPassed: true, hasConflict: false });
    c.endOfBatch('mapper');
  }

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L1);
});

// ---------------------------------------------------------------- 降级

test('不变式被违反一次就当场熔断回 L1', () => {
  const c = freshController();
  climbToL3(c);

  c.recordCommandResult('mapper', { ...good, invariantViolated: true });

  const state = c.getRoleState('mapper');
  assert.equal(state?.currentLevel, AutonomyLevel.L1);
  assert.equal(state?.isFused, true);
});

test('人类回滚一次就降级，并记下隔离分支', () => {
  const c = freshController();
  climbToL3(c);

  c.triggerRollback('mapper', 'branch-001');

  const state = c.getRoleState('mapper');
  assert.equal(state?.currentLevel, AutonomyLevel.L1);
  assert.equal(state?.isolationBranchId, 'branch-001');
});

test('降级后有一段冷却期，期间不会马上又爬回去', () => {
  const c = freshController();
  c.triggerRollback('mapper', 'branch-001');

  for (let i = 0; i < 5; i++) goodBatch(c);
  c.endOfDay('mapper');

  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L1);
});

test('熔断后旧成绩作废——恢复不能靠出事之前的分数', () => {
  const c = freshController();
  climbToL3(c);
  c.triggerRollback('mapper', 'b1');

  const state = c.getRoleState('mapper');
  assert.equal(state?.metrics.totalCommands, 0);
  assert.equal(state?.metrics.batches, 0);
});

// ---------------------------------------------------------------- 恢复必须过回归集

test('没跑过回归集就不许恢复', () => {
  const c = freshController();
  c.triggerRollback('mapper', 'branch-001');

  assert.equal(c.allowResumeToTarget('mapper'), false);
  assert.equal(c.getRoleState('mapper')?.isFused, true);
  assert.equal(c.getRoleState('mapper')?.currentLevel, AutonomyLevel.L1);
});

test('回归集没过也不许恢复', () => {
  const c = freshController();
  c.triggerRollback('mapper', 'branch-001');
  c.recordRegressionRun('mapper', false, { caseId: 'case-1' });

  assert.equal(c.allowResumeToTarget('mapper'), false);
  assert.equal(c.getRoleState('mapper')?.isFused, true);
});

test('回归集通过后可以恢复到原目标等级', () => {
  const c = freshController();
  c.triggerRollback('mapper', 'branch-001');
  c.recordRegressionRun('mapper', true, { cases: 12 });

  assert.equal(c.allowResumeToTarget('mapper'), true);

  const state = c.getRoleState('mapper');
  assert.equal(state?.isFused, false);
  assert.equal(state?.currentLevel, AutonomyLevel.L3);
});

test('恢复之后回归结论被消费掉，下一次熔断要重新跑', () => {
  const c = freshController();
  c.triggerRollback('mapper', 'b1');
  c.recordRegressionRun('mapper', true);
  assert.equal(c.allowResumeToTarget('mapper'), true);

  c.triggerRollback('mapper', 'b2');
  assert.equal(c.allowResumeToTarget('mapper'), false);
});

// ---------------------------------------------------------------- 事件日志

test('升级与降级都留下可审计的事件', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) goodBatch(c);
  c.triggerRollback('mapper', 'b1');

  const kinds = c.getEventLog('mapper').map((e) => e.eventType);
  assert.ok(kinds.includes('climb_success'));
  assert.ok(kinds.includes('downgrade_trigger'));
  assert.ok(kinds.includes('fuse_triggered'));
});

test('被拒的恢复也留下记录，而不是静默失败', () => {
  const c = freshController();
  c.triggerRollback('mapper', 'b1');
  c.allowResumeToTarget('mapper');

  const kinds = c.getEventLog('mapper').map((e) => e.eventType);
  assert.ok(kinds.includes('resume_refused'));
});

test('等级变化如实记下 from 与 to，不会记成同一个数', () => {
  const c = freshController();
  for (let i = 0; i < FUSE_CONFIG.climbRequiredBatches; i++) goodBatch(c);

  const climb = c.getEventLog('mapper').find((e) => e.eventType === 'climb_success');
  assert.equal(climb?.fromLevel, AutonomyLevel.L1);
  assert.equal(climb?.toLevel, AutonomyLevel.L2);
});

// ---------------------------------------------------------------- 决策

test('L1 要求逐项确认，L4 放行，熔断中要求隔离', () => {
  const c = freshController();
  assert.equal(evaluateFuseDecision(c, 'mapper').action, 'requireReview');

  const c4 = new AutonomousFuseController();
  c4.initRole('auditor', '审校', AutonomyLevel.L4, AutonomyLevel.L4);
  assert.equal(evaluateFuseDecision(c4, 'auditor').action, 'allow');

  c.triggerRollback('mapper', 'b1');
  assert.equal(evaluateFuseDecision(c, 'mapper').action, 'isolate');
});

test('L3 抽检是确定性的：同一串 tick 两次跑出同样的结论', () => {
  const runOnce = (): string[] => {
    const c = new AutonomousFuseController();
    c.initRole('mapper', '地图师', AutonomyLevel.L3, AutonomyLevel.L3);
    const out: string[] = [];
    for (let i = 0; i < 20; i++) out.push(evaluateFuseDecision(c, 'mapper').action);
    return out;
  };

  assert.deepEqual(runOnce(), runOnce());
});

test('L3 抽检率大致是 10%', () => {
  const c = new AutonomousFuseController();
  c.initRole('mapper', '地图师', AutonomyLevel.L3, AutonomyLevel.L3);
  let reviewed = 0;
  for (let i = 0; i < 1000; i++) {
    if (evaluateFuseDecision(c, 'mapper').action === 'requireReview') reviewed++;
  }
  assert.ok(reviewed > 50 && reviewed < 200, `抽到 ${reviewed} 次，偏离 10% 太远`);
});

// ---------------------------------------------------------------- 定稿值一致

test('代码里的熔断阈值与 v1.0 定稿表一致', () => {
  assert.equal(FUSE_CONFIG.climbRequiredBatches, FUSE_THRESHOLD_CONFIG.climbRequiredBatches);
  assert.equal(FUSE_CONFIG.climbRequiredDays, FUSE_THRESHOLD_CONFIG.climbRequiredDays);
  assert.equal(
    FUSE_CONFIG.autoCheckPassRateThreshold,
    FUSE_THRESHOLD_CONFIG.autoCheckPassRateThreshold,
  );
  assert.equal(
    FUSE_CONFIG.manualModificationRateThreshold,
    FUSE_THRESHOLD_CONFIG.manualModificationRateThreshold,
  );
  assert.equal(
    FUSE_CONFIG.summaryRejectionRateThreshold,
    FUSE_THRESHOLD_CONFIG.summaryRejectionRateThreshold,
  );
});
