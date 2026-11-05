import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCounterfactual } from './eval-counterfactual-support.ts';

/**
 * 反事实：删一条记忆，行为必须变；塞一条假记忆，不得被当成亲眼所见。
 *
 * 这两条是「记忆真的被行为用到」与「出处真的被当真」的唯一硬证据。
 * 假记忆走**听说**（`heard`）通道必须可召回但不得升格为 `witnessed`；
 * 走 `witnessed` 的注入必须被读档闸降级（EVAL-BUG-1 已修），而关掉闸的对照组
 * （`looseWitnessedMode`）会以 `witnessed` 活下来——那条对照就是造错守卫的靶子。
 */
test('删掉一条事件：同一线索的召回集变短，时间线不再指向它，别的事件还在', () => {
  const result = runCounterfactual();
  assert.ok(result.before.eventRefs.includes('eval-e1'), '前提：删之前这条事在召回集里');
  assert.ok(result.before.memoryIds.length > 0, '前提：召回集不是空的');
  assert.ok(
    result.allAfter.eventRefs.includes('eval-e2'),
    '删一条不该把整库清空：另一条事件仍应可召回',
  );
  assert.ok(
    !result.after.eventRefs.includes('eval-e1'),
    `删掉的事件仍在召回集里：${result.after.eventRefs.join(',')}`,
  );
  assert.notDeepEqual(result.before.memoryIds, result.after.memoryIds, '召回集必须真的变了');
  assert.ok(result.removedMemoryIds.length >= 1, '至少要有一条记忆因为这次删除而消失');

  assert.ok(result.timelineBeforeEvents.includes('eval-e1'), '前提：时间线上有这条事');
  assert.ok(!result.timelineAfterEvents.includes('eval-e1'), '时间线必须跟着删干净');
  assert.equal(result.danglingRefs, 0, `删除后仍悬挂的 eventRefs：${result.danglingRefs}`);
});

test('听说来的假记忆可以召回，但不得被标成 witnessed', () => {
  const result = runCounterfactual();
  assert.equal(result.fake.ghostEventExists, false, '前提：出处事件在库里根本不存在');
  assert.equal(result.fake.rumorRecalled, true, '听说来的事该记得住，否则这条测试测不到出处');
  assert.equal(
    result.fake.rumorMode,
    'heard',
    `假记忆的出处被改写成了 ${result.fake.rumorMode}`,
  );
});

test('witnessed 假记忆被读档闸降级；关掉闸的对照组才会以 witnessed 复活', () => {
  const result = runCounterfactual();
  assert.equal(result.fake.ghostEventExists, false, '前提：出处事件在库里根本不存在');
  assert.notEqual(
    result.fake.witnessedMode,
    'witnessed',
    `假记忆仍以 witnessed 存在：${result.fake.witnessedMode ?? 'null'}`,
  );
  assert.ok(
    (result.fake.importReport?.downgradedEntries ?? 0) >= 1,
    `读档闸报告没记下降级：${JSON.stringify(result.fake.importReport)}`,
  );
  // 造错守卫的靶子：绕过读档闸时，同一个假记忆必须真的以 witnessed 复活。
  assert.equal(result.fake.looseWitnessedRecalled, true, '对照组前提：绕过闸时假记忆仍可召回');
  assert.equal(
    result.fake.looseWitnessedMode,
    'witnessed',
    '对照组应暴露缺陷：绕过闸时假记忆就是 witnessed',
  );
});
