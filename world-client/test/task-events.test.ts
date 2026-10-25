import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FOLD,
  TASK_BLOCKED,
  TASK_CANCELLED,
  TASK_OPENED,
  TASK_SETTLED,
  foldTaskEvents,
  type TaskEvent,
  type TaskFoldState,
} from '../src/world/task-events.ts';

let nextId = 1;
/** 造一条事件。id 默认自增，便于写「按顺序来一批」。 */
function event(kind: string, payload: Record<string, unknown>, id?: number): TaskEvent {
  const assigned = id ?? nextId++;
  return { id: assigned, at: assigned * 100, kind, actor: 'server', payload };
}

/** 每批之间重置 id 计数器，避免测试互相污染。 */
function fresh(): void {
  nextId = 1;
}

const opened = (id: string, over: Record<string, unknown> = {}, eventId?: number): TaskEvent =>
  event(TASK_OPENED, { id, kind: 'code', title: '写爬虫', ...over }, eventId);

/** 分批折叠。每批可以是单条事件，也可以是数组。 */
function fold(...batches: (TaskEvent | readonly TaskEvent[])[]): TaskFoldState {
  return batches.reduce<TaskFoldState>(
    (state, batch) => foldTaskEvents(state, Array.isArray(batch) ? batch : [batch as TaskEvent]),
    EMPTY_FOLD,
  );
}

// ---------------------------------------------------------------- 开单

test('空日志折叠出空世界', () => {
  const state = foldTaskEvents(EMPTY_FOLD, []);
  assert.deepEqual(state.open, []);
  assert.equal(state.cursor, 0);
});

test('task.opened 开一条活', () => {
  fresh();
  const state = fold(opened('c_1'));
  assert.equal(state.open.length, 1);
  assert.deepEqual(state.open[0], { id: 'c_1', kind: 'code', title: '写爬虫', question: null });
  assert.equal(state.cursor, 1);
});

test('同一条活开两次只有一条', () => {
  fresh();
  const state = fold([opened('c_1')], [opened('c_1')]);
  assert.equal(state.open.length, 1);
});

test('缺字段的 opened 被忽略，不造半条活', () => {
  fresh();
  const state = fold([
    event(TASK_OPENED, { id: 'c_1', kind: 'code' }), // 缺 title
    event(TASK_OPENED, { id: 'c_2', title: '有标题没 kind' }),
    event(TASK_OPENED, { kind: 'code', title: '有 kind 没 id' }),
  ]);
  assert.deepEqual(state.open, []);
});

test('不认识的 kind 被忽略（世界只认四类活）', () => {
  fresh();
  const state = fold([event(TASK_OPENED, { id: 'c_1', kind: 'deploy', title: '上线' })]);
  assert.deepEqual(state.open, []);
});

// ---------------------------------------------------------------- 请示

test('task.blocked 给活挂上问题', () => {
  fresh();
  const state = fold([opened('c_1'), event(TASK_BLOCKED, { id: 'c_1', question: '选哪个？' })]);
  assert.equal(state.open[0]?.question, '选哪个？');
});

test('blocked 空问题等于没有问题', () => {
  fresh();
  const state = fold([
    opened('c_1', { question: '旧问题' }),
    event(TASK_BLOCKED, { id: 'c_1', question: '   ' }),
  ]);
  assert.equal(state.open[0]?.question, null);
});

test('给不存在的活挂问题：忽略，不凭空造活', () => {
  fresh();
  const state = fold([event(TASK_BLOCKED, { id: 'ghost', question: '?' })]);
  assert.deepEqual(state.open, [], '日志与世界的认知不一致时，宁可少一条也不编');
});

// ---------------------------------------------------------------- 收尾

test('task.settled 把活从 open 挪到 settled', () => {
  fresh();
  const state = fold([opened('c_1'), event(TASK_SETTLED, { id: 'c_1', completedAt: 1700000000000 })]);
  assert.deepEqual(state.open, []);
  assert.deepEqual(state.settled, [{ id: 'c_1', completedAt: 1700000000000 }]);
});

test('settled 没带 completedAt 时记 null，不拿本地时间顶替', () => {
  fresh();
  const state = fold([opened('c_1'), event(TASK_SETTLED, { id: 'c_1' })]);
  assert.equal(state.settled[0]?.completedAt, null);
});

test('已结算的 id 不复活', () => {
  fresh();
  const state = fold(
    [opened('c_1'), event(TASK_SETTLED, { id: 'c_1' })],
    [opened('c_1')],
  );
  assert.deepEqual(state.open, [], '收过的单不该被一条迟到的 opened 重新打开');
});

test('同一单结算两次只记一次', () => {
  fresh();
  const state = fold([
    opened('c_1'),
    event(TASK_SETTLED, { id: 'c_1', completedAt: 1 }),
    event(TASK_SETTLED, { id: 'c_1', completedAt: 2 }),
  ]);
  assert.deepEqual(state.settled, [{ id: 'c_1', completedAt: 1 }]);
});

// ---------------------------------------------------------------- 撤单

test('task.cancelled 把活从 open 去掉', () => {
  fresh();
  const state = fold([opened('c_1'), event(TASK_CANCELLED, { id: 'c_1' })]);
  assert.deepEqual(state.open, []);
  assert.deepEqual(state.cancelled, ['c_1']);
});

test('撤掉的 id 不复活', () => {
  fresh();
  const state = fold([opened('c_1'), event(TASK_CANCELLED, { id: 'c_1' })], [opened('c_1')]);
  assert.deepEqual(state.open, []);
});

test('已结算的单被撤：不算撤单，收尾记录保留', () => {
  fresh();
  const state = fold([
    opened('c_1'),
    event(TASK_SETTLED, { id: 'c_1', completedAt: 5 }),
    event(TASK_CANCELLED, { id: 'c_1' }),
  ]);
  assert.deepEqual(state.settled, [{ id: 'c_1', completedAt: 5 }]);
  assert.deepEqual(state.cancelled, [], '它已经成了，撤单不该覆盖收尾');
});

test('撤单之后重新开同一条：可以（撤单不是终态）', () => {
  fresh();
  // 注意：这里验的是 fold 本身的行为。世界侧另有 settledLog 挡住复活，
  // 但「撤了又开」在日志层面是合法的事件序列，折叠层不该自己加规矩。
  const state = fold([opened('c_1'), event(TASK_CANCELLED, { id: 'c_1' })]);
  assert.deepEqual(state.open, []);
  assert.deepEqual(state.cancelled, ['c_1']);
});

// ---------------------------------------------------------------- 游标

test('cursor 停在这批最后一条的 id', () => {
  fresh();
  const state = fold([opened('a'), opened('b'), opened('c')]);
  assert.equal(state.cursor, 3);
});

test('重复投递的事件不折叠第二次', () => {
  fresh();
  const first = fold([opened('c_1')]);
  const again = foldTaskEvents(first, [opened('c_1', {}, 1)]);
  assert.equal(again.cursor, 1);
  assert.equal(again.open.length, 1);
});

test('乱序（id 更小）的事件被丢掉', () => {
  fresh();
  const first = fold([opened('c_1', {}, 5)]);
  const stale = foldTaskEvents(first, [event(TASK_SETTLED, { id: 'c_1' }, 3)]);
  assert.equal(stale.open.length, 1, 'id 3 的结算发生在 cursor 之前，不该生效');
  assert.equal(stale.cursor, 5);
});

test('分批折叠与一次折叠等价', () => {
  fresh();
  const all = [
    opened('a'),
    event(TASK_BLOCKED, { id: 'a', question: '？' }),
    opened('b'),
    event(TASK_SETTLED, { id: 'b', completedAt: 9 }),
    opened('c'),
    event(TASK_CANCELLED, { id: 'c' }),
  ];
  const oneShot = foldTaskEvents(EMPTY_FOLD, all);
  const batched = fold(all.slice(0, 2), all.slice(2, 4), all.slice(4));
  assert.deepEqual(batched, oneShot, '增量折叠必须与从头折叠同结果——这是断点续读的基础');
});

test('open 按 id 字典序，与事件到达顺序无关', () => {
  fresh();
  const state = fold([opened('c_3'), opened('c_1'), opened('c_2')]);
  assert.deepEqual(state.open.map((task) => task.id), ['c_1', 'c_2', 'c_3']);
});

test('折叠是纯函数：不改输入', () => {
  fresh();
  const previous = fold([opened('c_1')]);
  const snapshot = JSON.parse(JSON.stringify(previous)) as TaskFoldState;
  foldTaskEvents(previous, [opened('c_2', {}, 99)]);
  assert.deepEqual(previous, snapshot);
});

test('非任务事件被忽略，但游标仍然前进', () => {
  fresh();
  const state = fold([
    event('world.changed', { reason: 'x' }),
    event('oracle.spoken', { raw: '让天晴' }),
    opened('c_1'),
  ]);
  assert.equal(state.open.length, 1);
  assert.equal(state.cursor, 3, '别的 kind 也要推进游标，否则会一直重读');
});
