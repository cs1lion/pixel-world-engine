/**
 * 交付失败进正式事件流：翻译、权重、目击与听见。
 *
 * 块 4 只改了任务状态；这一层钉的是「一件事发生了，得进了谁的记忆」：
 *
 *   1. 载荷：谁、哪单、在哪、为什么、是不是重复失败；
 *   2. 三张权重表与 kind 先验的落点（当事人过摘要线、目击者过写入线）；
 *   3. 室内同房间、室外 8 格 + 遮挡、以及「只听到、没看见」的通道。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { observationOf, type ObservationLookups } from '../src/world/memory/observe.ts';
import { inputsFor, salienceOf } from '../src/world/memory/salience.ts';
import type { OcclusionGrid } from '../src/world/memory/perception.ts';
import { deliveryFailureEventOf } from '../src/world/delivery-failure.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

const openGrid: OcclusionGrid = { isWalkable: () => true };

function failureChange(placeId: string, at = 1234): WorldChange {
  return deliveryFailureEventOf({
    at,
    taskId: 'task-9',
    taskKind: 'code',
    summary: '铸一口锅',
    workerId: 'worker',
    workerName: '阿禾',
    source: 'local',
    placeId,
    where: { x: 0, y: 0 },
    repeat: false,
  }).change;
}

function lookups(buildingIds: readonly string[]): ObservationLookups {
  return {
    atOfHolder: () => undefined,
    atOfBuilding: (id) => (buildingIds.includes(id) ? { x: 0, y: 0 } : undefined),
    buildingOfTask: () => undefined,
  };
}

function remembered(rt: MemoryRuntime, ids: readonly string[]): string[] {
  return ids.filter((id) => rt.viewOf(id)!.memories.length > 0);
}

test('载荷五件事都在：谁、哪单、在哪、为什么、是否重复', () => {
  const { failure, change, text } = deliveryFailureEventOf({
    at: 1234,
    taskId: 'task-9',
    taskKind: 'code',
    summary: '铸一口锅',
    workerId: 'worker',
    workerName: '阿禾',
    source: 'local',
    placeId: 'foundry',
    where: { x: 3, y: 4 },
    repeat: false,
  });
  assert.equal(change.change, 'world.event');
  if (change.change !== 'world.event') return;
  assert.equal(change.kind, 'delivery_failed');
  assert.equal(change.actorId, 'worker', '谁');
  assert.equal(change.placeId, 'foundry', '在哪');
  assert.deepEqual(change.where, { x: 3, y: 4 });
  assert.equal(change.failure?.taskId, 'task-9', '哪单');
  assert.equal(change.failure?.reason, 'hunger', '为什么');
  assert.equal(change.failure?.repeat, false, '是否重复失败');
  assert.equal(change.failure?.taskKind, 'code');
  assert.match(text, /阿禾.*没送到/);
  assert.equal(failure.taskId, 'task-9');
  assert.equal(failure.summary, '铸一口锅');
  assert.equal(failure.placeId, 'foundry');
  assert.equal(failure.reason, 'hunger');
});

test('翻译成记忆观察：status=fail 与结构化原因进 outcome，室内看地点', () => {
  const observed = observationOf(failureChange('foundry'), 'mem_1', lookups(['foundry']));
  assert.ok(observed !== null);
  assert.equal(observed.kind, 'delivery_failed');
  assert.deepEqual(observed.actors, ['worker']);
  assert.equal(observed.indoor, true, '有楼就该判成室内，交给同房间规则');
  assert.equal(observed.outcome['status'], 'fail');
  assert.equal(observed.outcome['taskId'], 'task-9');
  assert.equal(observed.outcome['reason'], 'hunger');
  assert.equal(observed.outcome['repeat'], false);
  assert.equal(observed.importanceHint, 0.7);
  assert.equal(observed.valence, -0.6);
  assert.equal(observed.arousal, 0.6);

  const outside = observationOf(failureChange('place:0,0'), 'mem_2', lookups(['foundry']));
  assert.ok(outside !== null);
  assert.equal(outside.indoor, false, '原地单没有楼，按室外 8 格算');
});

test('权重落点：当事人过摘要线、目击者过写入线、都够不上闪光', () => {
  const actor = salienceOf(
    inputsFor({
      kind: 'delivery_failed',
      holderId: 'worker',
      actors: ['worker'],
      importanceHint: 0.7,
      valence: -0.6,
      arousal: 0.6,
    }),
    DEFAULT_MEMORY_CONFIG.salienceWeights,
  );
  const witness = salienceOf(
    inputsFor({
      kind: 'delivery_failed',
      holderId: 'mate',
      actors: ['worker'],
      importanceHint: 0.7,
      valence: -0.6,
      arousal: 0.6,
    }),
    DEFAULT_MEMORY_CONFIG.salienceWeights,
  );
  assert.ok(Math.abs(actor.salience - 0.7375) < 1e-9, `当事人显著度 ${actor.salience}`);
  assert.ok(Math.abs(witness.salience - 0.5375) < 1e-9, `目击者显著度 ${witness.salience}`);
  assert.ok(actor.salience >= DEFAULT_MEMORY_CONFIG.T_promote, '当事人该进当天摘要');
  assert.ok(witness.salience >= DEFAULT_MEMORY_CONFIG.T_write, '目击者该写得下');
  assert.ok(
    witness.salience < DEFAULT_MEMORY_CONFIG.T_promote,
    '旁观目击者不该进摘要——否则一条失败会霸屏整村',
  );
  assert.ok(actor.salience < DEFAULT_MEMORY_CONFIG.T_flash, '不该变成闪光记忆');
});

test('室内失败：只有同房间的人记得，屋外两格也看不见', () => {
  const rt = new MemoryRuntime({
    worldId: 'failure-indoor',
    occlusion: openGrid,
    // 0..1 这间是铺子；2 号站在门口外。
    insideAt: (point) => (point.y === 0 && point.x <= 1 ? 'shop#1' : null),
  });
  rt.syncHolders([
    { holderId: 'worker', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'mate', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'outside', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'far', type: 'character', at: { x: 40, y: 40 } },
    { holderId: 'shop#1', type: 'place', at: { x: 0, y: 0 } },
  ]);
  const observed = observationOf(failureChange('shop#1'), 'mem_1', lookups(['shop#1']));
  assert.ok(observed !== null);
  rt.observe(observed, undefined, 1234);

  assert.deepEqual(remembered(rt, ['worker', 'mate', 'outside', 'far']), ['worker', 'mate']);
  const facts = rt.toSnapshot().world.facts.filter((fact) => fact.kind === 'delivery_failed');
  assert.equal(facts.length, 1, '一次失败恰好一条事实');
  assert.deepEqual(facts[0]!.witnesses, ['worker', 'mate']);
  assert.equal(facts[0]!.outcome['status'], 'fail');
  const entries = rt.toSnapshot().world.entries.filter((entry) =>
    entry.eventRefs.includes(facts[0]!.eventId),
  );
  assert.equal(entries.length, 2, '当事人 + 同房间，一人一条');
});

test('室外失败：两格内看见、屋里的人只听到、远处看不见也听不见', () => {
  const rt = new MemoryRuntime({
    worldId: 'failure-outdoor',
    occlusion: openGrid,
    // y=1 那间是屋子；y=0 是屋外的街。
    insideAt: (point) => (point.y === 1 ? 'house' : null),
  });
  rt.syncHolders([
    { holderId: 'worker', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'near', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'inside', type: 'character', at: { x: 2, y: 1 } },
    { holderId: 'far', type: 'character', at: { x: 40, y: 40 } },
    { holderId: 'place:0,0', type: 'place', at: { x: 0, y: 0 } },
  ]);
  const observed = observationOf(failureChange('place:0,0'), 'mem_1', lookups([]));
  assert.ok(observed !== null);
  assert.equal(observed.indoor, false);
  rt.observe(observed, undefined, 1234);

  assert.equal(rt.viewOf('near')!.memories.length, 1, '两格外该看得见');
  assert.equal(rt.viewOf('near')!.memories[0]!.sourceMode, 'witnessed');
  assert.equal(rt.viewOf('inside')!.memories.length, 1, '屋里的人该听得见（六格内、无遮挡）');
  assert.equal(rt.viewOf('inside')!.memories[0]!.sourceMode, 'heard');
  assert.equal(rt.viewOf('far')!.memories.length, 0, '四十格外不该记得');
});
