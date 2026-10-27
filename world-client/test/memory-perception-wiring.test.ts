import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { OcclusionGrid } from '../src/world/memory/perception.ts';
import type { MemoryEvent } from '../src/world/memory/types.ts';

/**
 * 感知模型在真实世界里的接线。
 *
 * `perception.ts` 的 `witnessesOf` 写好了、测过了，而在 `MemoryRuntime` 接上
 * 它之前，一个生产调用方都没有：`observe()` 一直写死 `witnesses ?? actors`。
 * 偏偏 `observe.ts` 里 `building.built`、`building.removed`、`miracle`、
 * `weather` 四种改变的 `actors` **都是空数组**——于是一栋新楼立起来、一次
 * 神迹、一场拆楼、一回天气反常，全村没有一个人记得，连站在原地的那个都不
 * 记得。没有目击者就没有记忆，没有记忆就没有断言，没有断言传播层整层空转。
 * 日志里一声不响，而每一层的单元测试都是绿的。
 *
 * 这一组测的是**接线本身**：门开在 `MemoryRuntime` 上，而且开在第一次
 * `syncHolders` 之后就能用。
 */

/** 一张全空的格子图：哪里都走得通，哪里都不挡视线。 */
const openGrid: OcclusionGrid = { isWalkable: () => true };

/** 一道南北向的墙，横在 x = 5 上（y = 0..20 都走不通）。 */
const walledGrid: OcclusionGrid = {
  isWalkable: (p) => !(p.x === 5 && p.y >= 0 && p.y <= 20),
};

function runtime(grid?: OcclusionGrid): { rt: MemoryRuntime; events: MemoryEvent[] } {
  const events: MemoryEvent[] = [];
  const rt = new MemoryRuntime({
    worldId: 'perception-wiring',
    onEvent: (event) => events.push(event),
    ...(grid === undefined ? {} : { occlusion: grid }),
  });
  rt.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'v1', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'v2', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'far', type: 'character', at: { x: 40, y: 40 } },
    // 地点 Holder 与神迹的落点同名：痕迹记在 placeId 上，名册里得有这么个Holder。
    { holderId: 'place:0,0', type: 'place', at: { x: 0, y: 0 } },
  ]);
  return { rt, events };
}

/** 一次神迹：`observe.ts` 的 miracle 分支，`actors` 是空的。 */
function miracle(rt: MemoryRuntime, eventId = 'mem_1', at = 1000): void {
  rt.observe(
    {
      eventId,
      kind: 'celebration',
      placeId: 'place:0,0',
      at: { x: 0, y: 0 },
      actors: [],
      outcome: { what: '神明显了一次灵' },
      importanceHint: 0.8,
      valence: 0.8,
      arousal: 0.7,
    },
    undefined,
    at,
  );
}

function remembered(rt: MemoryRuntime, ids: readonly string[]): string[] {
  return ids.filter((id) => rt.viewOf(id)!.memories.length > 0);
}

test('神迹有人记得：actors 为空的事件，站在原地的村民写下了记忆', () => {
  const { rt } = runtime(openGrid);
  miracle(rt);
  assert.deepEqual(
    remembered(rt, ['v0', 'v1', 'v2', 'far']),
    ['v0', 'v1', 'v2'],
    '没人记得神迹——感知模型没有接到 observe 上',
  );
});

test('在场的不只 actors：旁边看着的人也记得', () => {
  const { rt } = runtime(openGrid);
  rt.observe(
    {
      eventId: 'mem_1',
      kind: 'task_done',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['v0'],
      outcome: { what: '有人交了一单活' },
      importanceHint: 0.45,
      valence: 0.3,
      arousal: 0.4,
    },
    undefined,
    1000,
  );
  // v0 是 actors，v1/v2 只是站在旁边——他们也该记得。
  assert.deepEqual(remembered(rt, ['v0', 'v1', 'v2']), ['v0', 'v1', 'v2']);
});

test('远处的人不在场：四十格外什么都没看见', () => {
  const { rt } = runtime(openGrid);
  miracle(rt);
  assert.equal(rt.viewOf('far')!.memories.length, 0, '四十格外的人不该记得原地的事');
});

test('墙后的人不在场：遮挡网格真的在咬', () => {
  // 墙在 x = 5。v0/v1/v2 在西边（看得见），东边 x = 8 那位隔着墙。
  const events: MemoryEvent[] = [];
  const rt = new MemoryRuntime({ worldId: 'walled', occlusion: walledGrid, onEvent: (e) => events.push(e) });
  rt.syncHolders([
    { holderId: 'v0', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'behindWall', type: 'character', at: { x: 8, y: 0 } },
  ]);
  miracle(rt);
  assert.equal(rt.viewOf('v0')!.memories.length, 1, '墙西边的人该看得见');
  assert.equal(
    rt.viewOf('behindWall')!.memories.length,
    0,
    '一堵墙隔开的两边不该共享同一份记忆——否则痕迹通道就只是装饰',
  );
});

test('没有遮挡网格就不假装看得见：退回归 actors', () => {
  // 判断不了遮挡，就不能算在场者。这一档是「宁可少记」，与接上之前同一条路。
  const { rt } = runtime(undefined);
  rt.observe(
    {
      eventId: 'mem_1',
      kind: 'task_done',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['v0'],
      outcome: { what: '有人交了一单活' },
      importanceHint: 0.45,
      valence: 0.3,
      arousal: 0.4,
    },
    undefined,
    1000,
  );
  assert.deepEqual(remembered(rt, ['v0', 'v1', 'v2']), ['v0'], '没有网格时只该算 actors');
});

test('断言诞生在 actors 身上，不在旁边看着的人身上', () => {
  // witnesses 的顺序决定 `birthClaim` 取谁当起源者，而 actors 排在最前：
  // 动手的人该是那个开口的人。
  const { rt, events } = runtime(openGrid);
  rt.observe(
    {
      eventId: 'mem_1',
      kind: 'task_done',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['v2'],
      outcome: { what: '有人交了一单活' },
      importanceHint: 0.45,
      valence: 0.3,
      arousal: 0.4,
    },
    undefined,
    1000,
  );
  const created = events.find((event) => event.kind === 'claim.created');
  assert.ok(created !== undefined, '该诞生断言');
  assert.equal(created.payload['originHolderId'], 'v2');
});

test('地点 Holder 不感知：一栋楼不会「看见」发生在自己门口的事', () => {
  const { rt } = runtime(openGrid);
  miracle(rt);
  assert.equal(rt.viewOf('place:0,0')!.memories.length, 0, '楼不该有情景记忆');
  // 但事情落在它门口，它就留了痕迹——那是地点 Holder 记住事情的方式。
  assert.ok(rt.viewOf('place:0,0')!.traces.length > 0, '门口发生了事，地上该留下什么');
});

test('第一次对齐就够用：不必等第二拍才有人记得', () => {
  // 开局那一拍名册还是空的，人人走 `addHolder` 那条然后 continue。
  // 位置只写在「已存在」那条分支里的话，这一拍所有人都没有位置。
  const { rt } = runtime(openGrid);
  miracle(rt);
  assert.ok(remembered(rt, ['v0', 'v1', 'v2']).length >= 1, '第一次 syncHolders 之后就该看得见');
});

test('上游事件不传现场时，也按感知算——神迹从日志进来同样有人记得', () => {
  // 不接这一路的话，上游事件的记忆面会比本地事件窄一截：同一次炸炉，
  // 从 `observe` 进来有人记得，从 `ingestUpstream` 进来没人记得。
  const { rt } = runtime(openGrid);
  const fact = rt.ingestUpstream(
    { topology: 'execute', status: 'blocked', retries: 2, elapsedMs: 9000, difficulty: 'hard' },
    1000,
    { placeId: 'place_foundry', at: { x: 0, y: 0 } },
    [],
  );
  assert.ok(fact !== undefined, '该编译出一条事件');
  assert.deepEqual(
    remembered(rt, ['v0', 'v1', 'v2']),
    ['v0', 'v1', 'v2'],
    '上游事件也该有目击者——否则边界入口进来什么都被忘掉',
  );
});

test('接上之后世界真的在传：三天之后不再全员孤立', () => {
  const { rt } = runtime(openGrid);
  miracle(rt);
  for (let day = 1; day <= 3; day += 1) rt.tick(day * DAY_MS);
  const known = ['v0', 'v1', 'v2', 'far'].filter((id) => rt.viewOf(id)!.beliefs.length > 0);
  assert.ok(known.length >= 2, `三天之后只有 ${known.length} 个人知道——传播层还在空转`);
});
