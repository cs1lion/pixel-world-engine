/** C1：零造物世界也能自制升级。
 *
 * 问题（OPEN_ISSUES C1）：升级门禁全靠「造物观测」的比率，安静的、不再扩张的
 * 世界 `coverageRate` 恒为 null、`schemaPassRate` 恒为 null，于是卡在 L1。
 *
 * 解法：加「自运行观察」通道——世界连续 7 天没出事（无冲突 / 无违规 / 无回滚）、
 * 且确实在跑（`endOfDay` 被调过），就允许从 L1 升到 L2。四条边界必须守住，
 * 否则就成「白送」：
 *   - 只给整个生命周期**从没造过物**的角色（造过但窗口清零不算）；
 *   - 天数不足不升；
 *   - 中途出过事不升（cleanDays 归零）；
 *   - 熔断中不升；只升到 L2，L3/L4 仍要真实的空间/回放证据。
 *
 * 同时守住既有语义：有过造物的世界仍走原来的「不能白送」门禁。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutonomousFuseController,
  AutonomyLevel,
  FUSE_CONFIG,
} from '../src/world/creator/fuse.ts';

function controller(targetLevel: AutonomyLevel = AutonomyLevel.L3): AutonomousFuseController {
  const c = new AutonomousFuseController(() => 0);
  c.initRole('mapper', 'mapper-role', AutonomyLevel.L0, targetLevel);
  return c;
}

/** 安静地过 n 天：不记任何造物结果，只结算日界。 */
function quietDays(c: AutonomousFuseController, n: number, roleId = 'mapper'): void {
  for (let i = 0; i < n; i += 1) c.endOfDay(roleId);
}

test('C1：零造物世界安静运行 7 天，L0 → L1 → L2 逐级自升', () => {
  const c = controller();
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L0);

  // 第一级：7 天干净日，L0 → L1
  quietDays(c, FUSE_CONFIG.selfRunningRequiredDays);
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L1,
    '零造物世界也该能离开 L0');

  // 第二级：再 7 天干净日，L1 → L2（升级不清空 selfRunningDays / cleanDays，
  // 但常规通道的 days 会清零；这里靠自运行通道继续）
  quietDays(c, FUSE_CONFIG.selfRunningRequiredDays);
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L2,
    '零造物世界也该能升到 L2');

  // 事件日志里要有明确的「自运行升级」来源，不能冒充常规 climb_success。
  const events = c.getEventLog('mapper', 50);
  assert.ok(events.some((e) => e.eventType === 'climb_self_running'),
    '自运行升级必须留可审计的事件');
});

test('C1：天数不足不升级', () => {
  const c = controller();
  quietDays(c, FUSE_CONFIG.selfRunningRequiredDays - 1);
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L0,
    '差一天也不给白送');
});

test('C1：只升到 L2，L3 仍要真实证据', () => {
  const c = controller();
  quietDays(c, FUSE_CONFIG.selfRunningRequiredDays * 4);
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L2,
    '自运行通道不能一路推到 L3/L4');
});

test('C1：中途出过冲突 / 违规 / 回滚，干净日归零，不升级', () => {
  for (const bad of [
    { hasConflict: true },
    { invariantViolated: true },
  ] as const) {
    const c = controller();
    quietDays(c, 4);
    c.recordCommandResult('mapper', { schemaPassed: true, ...bad });
    quietDays(c, FUSE_CONFIG.selfRunningRequiredDays);
    // 来过造物结果 → 不再是零造物世界，且问题数 > 0 → 两道都挡住。
    assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L0,
      `出过事就不该靠自运行升级：${JSON.stringify(bad)}`);
  }

  const rolled = controller();
  quietDays(rolled, 4);
  rolled.triggerRollback('mapper');
  quietDays(rolled, FUSE_CONFIG.selfRunningRequiredDays * 2);
  assert.equal(rolled.getRoleState('mapper')!.currentLevel, AutonomyLevel.L0,
    '回滚并熔断后不该升级');
});

test('C1：造过物但窗口清零，仍走「不能白送」门禁，不靠自运行白升', () => {
  const c = controller();
  // 先来一批真实造物观测，攒够常规通道的 14 天升到 L1（并清零窗口）。
  for (let day = 0; day < FUSE_CONFIG.climbRequiredDays; day += 1) {
    c.recordCommandResult('mapper', {
      schemaPassed: true,
      hasConflict: false,
      coverageRate: 0.98,
      pathfindingConnected: true,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      invariantViolated: false,
      traceable: true,
      replayHashConsistent: true,
    });
    c.endOfDay('mapper');
  }
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L1);
  assert.equal(c.getRates('mapper')!.coverageRate, null, '升级即清零');

  // 之后完全没有新造物，安静跑很久：因为 everCreated=true，不许走自运行旁路。
  quietDays(c, FUSE_CONFIG.selfRunningRequiredDays * 3);
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L1,
    '造过物的世界没有新观测就不许白升 L2');
});

test('C1：熔断中的角色不走自运行升级', () => {
  const c = controller();
  // 从 L0 强制降级：frozenLevel = min(currentLevel, L1) = L0，但会置 isFused。
  c.forceDowngradeToL1('mapper', '先熔断');
  assert.equal(c.getRoleState('mapper')!.isFused, true, '前置条件：确实熔断了');
  const levelBefore = c.getRoleState('mapper')!.currentLevel;
  quietDays(c, FUSE_CONFIG.selfRunningRequiredDays * 3);
  assert.equal(c.getRoleState('mapper')!.currentLevel, levelBefore,
    '熔断中不许靠自运行升级');
});
