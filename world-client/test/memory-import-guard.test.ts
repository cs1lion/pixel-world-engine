import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runFabricated,
  runFabricatedLoose,
  runPrunedLegit,
  runPrunedWithoutCorroboration,
  runRealSample,
} from './eval-import-guard-support.ts';

/**
 * 读档出处闸（EVAL-BUG-1）：历史淘汰的悬空要放行，导入时编造的悬空要降级。
 *
 * 判据不是「eventRefs 非空」，而是**旁证**：事件被摄入时写下的断言 / 信念 / 痕迹 /
 * 传说 / 地标 / 关系账本里还查不查得到它。见 `src/world/memory/import-guard.ts`。
 */
test('假记忆（引用从未存在的事件）被降级为 heard，不再自称亲历', () => {
  const scenario = runFabricated();
  assert.equal(scenario.probedRecalled, true, '前提：降级后的记忆仍可召回，否则测不到出处');
  assert.notEqual(scenario.probedMode, 'witnessed', `假记忆仍是 ${scenario.probedMode}`);
  assert.equal(scenario.probedMode, 'heard');
  assert.equal(scenario.downgraded, 1, `降级条数：${scenario.downgraded}`);
  assert.equal(scenario.refused, 0, '降级不该同时拒掉');
  assert.equal(
    scenario.witnessedAfter,
    scenario.witnessedBefore - 1,
    '只有被注入的那一条降级，别的亲历记忆不该被连带',
  );
});

test('事实被淘汰、断言还在：合法悬空，仍算亲历', () => {
  const scenario = runPrunedLegit();
  assert.equal(scenario.probedRecalled, true);
  assert.equal(scenario.probedMode, 'witnessed', '历史淘汰不该把旧档的亲历降级');
  assert.equal(
    scenario.prunedUnverifiable,
    2,
    `淘汰旁证条数：${scenario.prunedUnverifiable}（同一天的两条汇总记忆都指这条事件）`,
  );
  assert.equal(scenario.downgraded, 0);
  assert.equal(scenario.refused, 0);
});

test('事实与断言都删光：一处旁证都没有 → 按编造降级', () => {
  const scenario = runPrunedWithoutCorroboration();
  assert.equal(scenario.probedMode, 'heard', `没有旁证的条目仍是 ${scenario.probedMode}`);
  assert.equal(scenario.downgraded, 2, '两条汇总记忆都指这条事件');
  assert.equal(scenario.prunedUnverifiable, 0);
});

test('造错守卫：绕过读档闸时，同一假记忆必须以 witnessed 复活', () => {
  const loose = runFabricatedLoose();
  assert.equal(loose.recalled, true, '对照组前提：绕过闸时假记忆可召回');
  assert.equal(loose.mode, 'witnessed', '对照组应暴露缺陷：闸正是唯一拦住它的东西');
});

test('真 v5 存档导入前后 witnessed 条数不变（25 → 25）', () => {
  const scenario = runRealSample('traces/outer-baseline-v5.json', (path) =>
    readFileSync(path, 'utf8'),
  );
  assert.equal(scenario.witnessedBefore, 25, '样品基线变了就要重核这条断言');
  assert.equal(scenario.witnessedAfter, scenario.witnessedBefore, '合法旧档不得被降级');
  assert.equal(scenario.downgraded, 0);
  assert.equal(scenario.refused, 0);
  assert.equal(scenario.prunedUnverifiable, 0);
});
