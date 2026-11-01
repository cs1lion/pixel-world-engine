import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { inferenceOf } from '../src/world/memory/traces.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

/**
 * 磨损小径是**习惯**，不是情景片段。
 *
 * 补充设计 §1.2 的溯因查表三行，第三行的初始字段特征写着
 * `who: []`、`confidence: 0.60`、`kind: habit`。前两样都在，第三样原先没接：
 * `lookAtTraces` 给每条推断记忆一律写 `kind: 'episodic'`，于是
 * `MemoryKind` 声明的五个种类里只有两个被写出过——`habit`、`impression`、
 * `trace` 三处是空头声明，`budget.impression`（32 条）与
 * `limitFor('impression')` 也一直是死的。
 *
 * 同一行的 `confidence` 也被抄错了：代码里是 0.3（照抄焦痕那一档），
 * 表里是 0.60。它是全表最高的一档——一条被走出来的路是反复见过的东西，
 * 比一道说不清来由的焦痕可信得多。
 *
 * 这一组同时钉住**表**与**落点**：表里那一行是什么，写进记忆的就是什么。
 */

/** 一个工坊，加一个从没去过那儿的旁观者。 */
function foundry(): { rt: MemoryRuntime; place: string; stranger: string } {
  const rt = new MemoryRuntime({ worldId: 'habit-probe', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'stranger', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);
  return { rt, place: 'foundry', stranger: 'stranger' };
}

/**
 * 在同一个地方按作息站四次。
 *
 * `worn_path` 的来路是 `recurrence >= 3`，而 `recurrence` 数的是**同一地点、
 * 同一 kind 的事此前发生过几次**。所以得是四件**同 kind** 的事，不是四件不同的。
 *
 * **这一条是 2026-11-01 改的，改的是实现不是夹具。** 原先 `depositTraces` 数的是
 * 「这个地点已经有几层痕迹」，于是四件不同 kind 的事恰好凑够三层、第四件踩出路来
 * ——一个数错了东西的实现，被一个刚好绕开它的夹具钉成了绿。而在这个实现下
 * 灯潮界一条痕迹也产不出来：那里只有 `routine_done`，它不在旧白名单里，
 * `trace.added` 八个世界日一次都没发过。
 *
 * 用 `routine_done` 而不是 `task_done`：前者是这个设定集里真的天天在发生的那一种
 * （村民按作息站在落点上）。`valence: 0` 让强度停在 0.2，这样即使哪天有人把
 * 别的 kind 放进白名单，这条夹具也还在量同一条路。
 */
function wearThePath(rt: MemoryRuntime, place: string): void {
  for (let i = 0; i < 4; i += 1) {
    rt.observe(
      {
        eventId: `ev_${i}`,
        kind: 'routine_done',
        placeId: place,
        at: { x: 0, y: 0 },
        actors: ['a'],
        outcome: { what: `第 ${i} 次站在这儿` },
        importanceHint: 0.35,
        valence: 0,
      },
      ['a'],
      1000 + i * 100,
    );
  }
}

test('表：磨损小径那一行是 habit，可信度 0.60', () => {
  const worn = inferenceOf('worn_path');
  assert.ok(worn !== null);
  assert.equal(worn.kind, 'habit', '§1.2 第三行明写 kind: habit');
  assert.equal(worn.confidence, 0.6, '§1.2 第三行明写 confidence: 0.60');
  // 它还是「没人」看见的：who 空着是推断记忆的通例。
  assert.equal(worn.detailLevel, 1);
});

test('表：另外五种痕迹照旧是情景片段', () => {
  for (const layer of ['scorch', 'damage', 'patch', 'garland', 'inscription'] as const) {
    const spec = inferenceOf(layer);
    assert.ok(spec !== null, `${layer} 该有推断`);
    assert.equal(spec.kind, 'episodic', `${layer} 那一行没写 kind，落情景片段`);
  }
});

test('门槛：同一件事站三次还不算路，第四次才踩出来', () => {
  // 「走的人多了就是路」的门槛是 3 次**重复**。三次只是偶尔经过——
  // 这条同时钉住 `recurrence` 数的是事件、以及阈值本身没被顺手改掉。
  const rt = new MemoryRuntime({ worldId: 'habit-threshold', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);
  const stand = (i: number): void => {
    rt.observe(
      {
        eventId: `ev_${i}`,
        kind: 'routine_done',
        placeId: 'foundry',
        at: { x: 0, y: 0 },
        actors: ['a'],
        outcome: { what: '站了一会儿' },
        importanceHint: 0.35,
        valence: 0,
      },
      ['a'],
      1000 + i * 100,
    );
  };
  stand(0);
  stand(1);
  stand(2);
  assert.deepEqual(rt.viewOf('foundry')!.traces, [], '三次只是偶尔经过，地上什么都不该有');
  stand(3);
  const traces = rt.viewOf('foundry')!.traces;
  assert.equal(traces.length, 1, '第四次才踩出那一条路');
  assert.equal(traces[0]!.layerType, 'worn_path');
});

test('落点：走过一条被走出来的路，记下的是一条习惯', () => {
  const { rt, place, stranger } = foundry();
  wearThePath(rt, place);
  rt.lookAtTraces(stranger, place);

  const mine = rt.viewOf(stranger)!.memories;
  const habit = mine.filter((entry) => entry.kind === 'habit');
  assert.equal(habit.length, 1, '那条路该沉淀成一条习惯');
  assert.equal(habit[0]!.confidence, 0.6, '可信度照表里那一行');
  assert.deepEqual(habit[0]!.content.who, [], '没人可指——是路，不是人');
  assert.equal(habit[0]!.sourceMode, 'inferred', '推断出来的，不是读到的');
  // 显著性跟着抬起来了：原先 0.18，全表最低，比 T_write 还低一截。
  assert.ok(habit[0]!.salience > 0.3, `salience ${habit[0]!.salience} 该过 T_write`);
});

test('落点：同一处的焦痕照旧记成情景片段，不跟着升格', () => {
  const rt = new MemoryRuntime({ worldId: 'habit-control', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'stranger', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_boom',
      kind: 'workshop_accident',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: { what: '炉子炸了' },
      importanceHint: 1,
    },
    ['a'],
    1000,
  );
  rt.lookAtTraces('stranger', 'foundry');

  const mine = rt.viewOf('stranger')!.memories;
  assert.deepEqual(mine.filter((entry) => entry.kind === 'habit'), [], '事故不是习惯');
  assert.ok(mine.some((entry) => entry.kind === 'episodic'), '焦痕照旧推出情景片段');
});

test('习惯不重复落：同一个人在同一处反复路过，只有一条', () => {
  const { rt, place, stranger } = foundry();
  wearThePath(rt, place);
  for (let day = 0; day < 5; day += 1) {
    rt.lookAtTraces(stranger, place);
    rt.tick((day + 1) * DAY_MS);
  }
  assert.equal(
    rt.viewOf(stranger)!.memories.filter((entry) => entry.kind === 'habit').length,
    1,
    '一条路走五遍还是那一条习惯，不是五条',
  );
});
