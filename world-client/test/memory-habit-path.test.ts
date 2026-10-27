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
 * 一件只有 a 看得见的小事。
 *
 * `worn_path` 的来路是 `recurrence >= 3`，而 `recurrence` 数的是**这个地点
 * 已经有的痕迹层数**（`depositTraces` 里 `existing.filter(...)` 那条），不是
 * 事件次数。所以得先有三件各自留下不同层的事，第四件才踩出路来。
 *
 * 三件都显式给 `valence: 0`：痕迹强度是 `|valence| + 0.2`，事故因此只留
 * `damage`（0.2）而不是 `scorch`（要 ≥ 0.5）。这一条不是为了好看——
 * `exposedTraces` 只暴露前三层，而磨损小径的强度是 `recurrence / 10 = 0.3`，
 * 正好压在 damage 与 garland 之上。换成默认效价，焦痕 0.9、花环 1.0，
 * 小路永远排第四，这条路就看不见了。
 */
function wearThePath(rt: MemoryRuntime, place: string): void {
  const steps: readonly { kind: string; valence: number }[] = [
    { kind: 'workshop_accident', valence: 0 },
    { kind: 'celebration', valence: 0 },
    { kind: 'milestone', valence: 0 },
    { kind: 'task_done', valence: 0 },
  ];
  for (let i = 0; i < steps.length; i += 1) {
    rt.observe(
      {
        eventId: `ev_${i}`,
        kind: steps[i]!.kind,
        placeId: place,
        at: { x: 0, y: 0 },
        actors: ['a'],
        outcome: { what: `第 ${i} 件` },
        importanceHint: 0.1,
        valence: steps[i]!.valence,
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
