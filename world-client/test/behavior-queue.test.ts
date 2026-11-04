/**
 * 行为规则表 + 目标队列：这一块不许改行为，只把「谁先问」从代码位置搬到表里。
 *
 * 这组钉五件事：
 *   1. **逐拍决策与原链逐行相同**——跑同一条 3000 拍轨迹，和改动前的
 *      `decisions-before.txt` 逐行比对；这是本块最关键的证据。
 *   2. **登记顺序就是优先级**——交换两条规则的位置能改变结果，证明不是硬编码。
 *   3. **新增一条规则不必改 `Simulation` 或 Scene**——运行期把表递进去就能生效。
 *   4. **打断接口在、但默认不触发**——跑过多个世界日，打断次数恒为 0。
 *   5. **空规则集兜底等于原 `routine`**。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import {
  BehaviorPlanner,
  GoalQueue,
  type BehaviorContext,
  type BehaviorGoal,
  type BehaviorRule,
} from '../src/world/behavior.ts';
import {
  DEFAULT_BEHAVIOR_RULES,
  PRE_COVER_RULE,
  ROUTINE_RULE,
  VERIFICATION_RULE,
} from '../src/world/behavior-rules.ts';
import { TraceRuntime } from '../src/trace/runtime.ts';
import { orderedInjections } from '../src/trace/format.ts';
import type { TraceFile } from '../src/trace/format.ts';
import type { DecisionRecord } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

function goalOf(kind: string): BehaviorGoal {
  return { kind, target: { x: 0, y: 0 }, beatId: null, routineIndex: null };
}

/** 三条口子都给目标：谁先被问，谁就先命中。 */
const allGoals: BehaviorContext = {
  villagerId: 'v1',
  verificationGoal: () => goalOf('verify'),
  preCoverGoal: () => goalOf('pre-cover'),
  routineGoal: () => goalOf('routine'),
};

function decisionLine(record: DecisionRecord): string {
  const target =
    record.targetX === null || record.targetY === null
      ? '-'
      : `${record.targetX},${record.targetY}`;
  return [
    record.now,
    record.villagerId,
    record.rule,
    record.goal,
    target,
    record.beatId ?? '-',
    record.routineIndex === null ? '-' : String(record.routineIndex),
  ].join('|');
}

/** 一张 12×10 的平地，一个作息指向街口的角色。 */
function makeSim(): Simulation {
  return new Simulation({
    grid: new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [] }),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    wallClock: () => 1000,
    villagerProfiles: [
      {
        at: { x: 2, y: 2 },
        routine: [{ id: 'promenade', label: '去街口', going: '去街口', target: { x: 8, y: 5 }, dwellMs: 300 }],
      },
    ],
  });
}

// ---------------------------------------------------------------- 逐拍等价

test('逐拍决策与原链逐行相同：同一条轨迹 3000 拍', async () => {
  const trace = JSON.parse(
    readFileSync(new URL('../traces/outer-two-days.json', import.meta.url), 'utf8'),
  ) as TraceFile;
  const expected = readFileSync(
    new URL('../../docs/evidence/behavior-queue/decisions-before.txt', import.meta.url),
    'utf8',
  )
    .trimEnd()
    .split('\n');

  const runtime = new TraceRuntime(trace);
  runtime.sim.setDecisionLogEnabled(true);
  const injections = orderedInjections(trace);
  let nextInjection = 0;
  const lines: string[] = [];

  for (let step = 1; step <= trace.steps; step += 1) {
    const worldNow = trace.initialNow + step * trace.stepMs;
    while (nextInjection < injections.length && injections[nextInjection]!.atWorldMs <= worldNow) {
      runtime.applyInjection(injections[nextInjection]!);
      nextInjection += 1;
    }
    await runtime.step(trace.stepMs);
    for (const record of runtime.sim.drainDecisions()) lines.push(decisionLine(record));
  }

  assert.equal(lines.length, expected.length, '决策条数与改动前不同');
  for (let index = 0; index < expected.length; index += 1) {
    assert.equal(lines[index], expected[index], `第 ${index + 1} 条决策与改动前不同`);
  }
});

// ---------------------------------------------------------- 顺序即优先级

test('登记顺序决定优先级：交换两条规则的位置，结果就变了', () => {
  const planner = new BehaviorPlanner(DEFAULT_BEHAVIOR_RULES, ROUTINE_RULE);

  assert.equal(planner.plan(allGoals)?.rule, 'verification', '默认顺序第一条是求证');
  assert.deepEqual(planner.orderedIds(), ['verification', 'pre-cover', 'routine']);

  planner.setRules([ROUTINE_RULE, PRE_COVER_RULE, VERIFICATION_RULE]);
  assert.equal(planner.plan(allGoals)?.rule, 'routine', '把作息登记在最前，它就先命中');
  assert.deepEqual(planner.orderedIds(), ['routine', 'pre-cover', 'verification']);

  planner.setRules([PRE_COVER_RULE, VERIFICATION_RULE]);
  assert.equal(planner.plan(allGoals)?.rule, 'pre-cover', '盖布排第一就压过求证');
});

// ------------------------------------------------------ 新增规则无需改分支

test('运行期新增一条规则不需要改 Simulation 或 Scene', () => {
  const sim = makeSim();
  let fired = 0;
  const once: BehaviorRule = {
    id: 'once',
    match: () => {
      if (fired > 0) return null;
      fired += 1;
      return { kind: 'once', target: { x: 5, y: 5 }, beatId: null, routineIndex: null };
    },
  };

  sim.setBehaviorRules([once, ...DEFAULT_BEHAVIOR_RULES]);
  assert.deepEqual(sim.behaviorRuleIds(), ['once', 'verification', 'pre-cover', 'routine']);

  sim.setDecisionLogEnabled(true);
  for (let index = 0; index < 3; index += 1) sim.update(2000);
  const decisions = sim.drainDecisions().map(decisionLine);

  assert.ok(decisions.some((line) => line.includes('|once|')), '新规则没有生效');
});

// ------------------------------------------------------------ 打断不触发

test('默认路径不触发打断：跑两个世界日后打断次数为 0', () => {
  const sim = makeSim();
  const ticks = Math.ceil((2 * DAY_MS) / 2000);
  for (let index = 0; index < ticks; index += 1) sim.update(2000);
  assert.equal(sim.goalInterruptCount(), 0, '默认路径不该有任何打断');
  for (const villager of sim.snapshot().villagers) {
    assert.equal(sim.goalStateOf(villager.id)?.interrupts ?? 0, 0, `${villager.id} 的队列被打了断`);
  }
});

test('打断接口本身可用：没有当前目标时什么也不做，恢复后回到原目标', () => {
  const queue = new GoalQueue();
  const current = goalOf('routine');

  assert.equal(queue.interrupt('天气突变'), false, '没有当前目标时不能凭空打断');
  assert.equal(queue.interruptCount, 0);

  queue.setCurrent(current);
  assert.equal(queue.interrupt('天气突变'), true);
  assert.equal(queue.currentGoal, null);
  assert.equal(queue.interruptCount, 1);
  assert.equal(queue.lastInterruptReason, '天气突变');

  assert.equal(queue.resume(), true);
  assert.equal(queue.currentGoal, current, '条件消失后回到原来的目标');
  assert.equal(queue.resume(), false, '恢复过一次就不该再恢复');
});

// -------------------------------------------------------------- 空表兜底

test('空规则集时兜底行为与原 routine 相同', () => {
  const planner = new BehaviorPlanner([], ROUTINE_RULE);
  assert.equal(planner.plan(allGoals)?.rule, 'routine');
  assert.equal(planner.plan(allGoals)?.goal.kind, 'routine');
  assert.deepEqual(planner.orderedIds(), []);

  // 运行时同样：清空表之后，世界仍按原作息走。
  const sim = makeSim();
  sim.setBehaviorRules([]);
  sim.setDecisionLogEnabled(true);
  for (let index = 0; index < 10; index += 1) sim.update(2000);
  const rules = new Set(sim.drainDecisions().map((record) => record.rule));
  assert.deepEqual([...rules].sort(), ['routine'], '空表时只有 routine 在派活');
});
