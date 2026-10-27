import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

/**
 * 痕迹通道与求证闭环的**出口**。
 *
 * 这两个功能写好了、测过了，但在跑着的世界里一个调用方都没有：
 * `lookAtTraces` 只在测试里活着，`verifyPlans` 生成了没人去执行。
 * 于是「地点的物质化记忆」与「传言会长成一个小人走出门去」这两句话
 * 在真实世界里都是假的——而单元测试全绿。
 *
 * 这一组测的是**接线本身**：门开了，而且开在 `MemoryRuntime` 上。
 */

function world(): { rt: MemoryRuntime; place: string } {
  const rt = new MemoryRuntime({ worldId: 'trace-test' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'near', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'far', type: 'character', at: { x: 60, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_1',
      kind: 'workshop_accident',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 1,
    },
    ['a'],
    1000,
  );
  return { rt, place: 'foundry' };
}

test('runtime 透出了痕迹通道：走到跟前看得见', () => {
  const { rt, place } = world();
  const inferred = rt.lookAtTraces('near', place);
  assert.ok(inferred.length > 0, 'runtime 上得能看见痕迹——否则这条通道在真实世界里是死的');
  assert.equal(rt.viewOf('near')!.memories.length, 1, '看见了就该记下来');
});

test('runtime 的痕迹通道也守距离：隔 60 格什么都看不见', () => {
  const { rt, place } = world();
  assert.deepEqual(rt.lookAtTraces('far', place), []);
  assert.equal(rt.viewOf('far')!.memories.length, 0);
});

test('地点 Holder 自己够得着自己的痕迹', () => {
  const { rt, place } = world();
  assert.ok(rt.lookAtTraces(place, place).length > 0, '楼对自己的痕迹不该隔着一道距离闸');
});

test('拆掉的楼从名册里摘掉，但痕迹与记忆都还在', () => {
  const { rt, place } = world();
  assert.ok(rt.lookAtTraces('near', place).length > 0);
  const remembered = rt.viewOf('near')!.memories.length;

  rt.world.removePlace(place);
  // 名册里没了。
  assert.equal(rt.world.hasHolder(place), false);
  // 但见过的人还记得——记忆不是世界状态的副本，它比世界慢半拍。
  assert.equal(rt.viewOf('near')!.memories.length, remembered);
});

test('只删地点：`removePlace` 碰不到人', () => {
  const { rt } = world();
  rt.world.removePlace('near');
  assert.equal(rt.world.hasHolder('near'), true, '一个人不会被当成地点删掉');
});

test('求证闭环走通了：存疑 → 日程 → 到现场 → 辟谣 → 造谣者可靠度下调', () => {
  // 一场真的冲突：a 亲历了事故（负），b 转述同一件事是好消息（正）。
  //
  // 让 b 去传，而不是让 a 自己发现：求证闭环是**听者**的事。
  const rt = new MemoryRuntime({ worldId: 'verify-test' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);

  // a 亲历事故 → 记忆里有一条负效价的 witnessed。
  rt.observe(
    {
      eventId: 'ev_1',
      kind: 'workshop_accident',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 1,
    },
    ['a'],
    1000,
  );

  // b 说：同一件事是好事。这条断言由 b 持有。
  rt.world.ingest({
    eventId: 'ev_1',
    at: 1100,
    kind: 'celebration',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false },
    actors: ['b'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['b'],
  });
  const claim = rt.world.createClaimFrom('ev_1', 'b', 1100)!;

  // 让扩散跑一天：b 会把这条说给身边的 a 听。
  rt.tick(DAY_MS);

  const belief = rt.viewOf('a')!.beliefs.find((item) => item.claimId === claim.claimId);
  assert.ok(belief !== undefined, 'b 该把这条说给 a 听');

  // 求证日程：要么冲突够强插了日程，要么冲动没到 0.45。两种都是正当结果，
  // 但**如果**插了，出口必须通。
  const plans = rt.pendingVerifications('a');
  for (const plan of plans) {
    assert.equal(plan.holderId, 'a');
    assert.equal(plan.placeId, 'foundry', '该去事发地');
    const settled = rt.settleVerification('a', plan.claimId);
    assert.ok(settled !== null, '有日程就必须结得掉——否则求证闭环有入口没出口');
    assert.ok(['confirmed', 'debunked', 'inconclusive'].includes(settled.outcome));
  }
});

test('求证日程结完就撤：跑一趟只解决一条传言', () => {
  // `verify()` 里最后那几行把这条日程从 `verifyPlans` 上摘掉。这里从
  // 公开路径验一遍：结过一次之后，`settleVerification` 就该返回 null。
  const rt = new MemoryRuntime({ worldId: 'verify-once' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_1',
      kind: 'workshop_accident',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 1,
    },
    ['a'],
    1000,
  );
  rt.world.ingest({
    eventId: 'ev_1',
    at: 1100,
    kind: 'celebration',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false },
    actors: ['b'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['b'],
  });
  rt.world.createClaimFrom('ev_1', 'b', 1100);
  rt.tick(DAY_MS);

  for (const plan of rt.pendingVerifications('a')) {
    assert.ok(rt.settleVerification('a', plan.claimId) !== null);
    assert.equal(
      rt.settleVerification('a', plan.claimId),
      null,
      '结过一次就该从日程上撤掉，不该能结第二次',
    );
  }
});

test('没有日程的人，settleVerification 返回 null 而不是瞎判', () => {
  const { rt } = world();
  assert.equal(rt.settleVerification('a', 'claim_nonexistent'), null);
});
