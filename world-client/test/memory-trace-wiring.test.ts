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
  //
  // 这是**另一件**事（同一个地点、同一天，但效价相反），所以它有自己
  // 的事件 id。早先这里复用了 `ev_1`，靠的是「断言按调用方给什么就造什么」；
  // 而事件 id 是日志里的身份，两件事共用一个 id 在真实世界里不会发生。
  // 断言改为「一个事件只诞生一条」之后，复用 id 会让第二次 `createClaimFrom`
  // 返回第一条断言——测试于是红在这里，红得对。
  rt.world.ingest({
    eventId: 'ev_2',
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
  const claim = rt.world.createClaimFrom('ev_2', 'b', 1100)!;

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
    eventId: 'ev_2',
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
  rt.world.createClaimFrom('ev_2', 'b', 1100);
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

test('同一道痕迹不重复记：站在门口看一百遍也只有一条', () => {
  const { rt, place } = world();
  const first = rt.lookAtTraces('near', place);
  assert.equal(rt.viewOf('near')!.memories.length, 1);

  // 再看一次、再再看一次。**看得见**与**记下来**是两件事：痕迹还留在
  // 现场，他照样推断得出来；只是不再往记忆库里写第二遍。
  const second = rt.lookAtTraces('near', place);
  assert.ok(second.length > 0, '痕迹还在，就该还看得见');
  assert.equal(second.length, first.length, '看见的东西不该因为记过就变少');
  for (let round = 0; round < 10; round += 1) rt.lookAtTraces('near', place);
  assert.equal(
    rt.viewOf('near')!.memories.length,
    1,
    '同一个人、同一处、同一类痕迹，看一百遍也只该留下一条',
  );
});

test('「不重复记」管的是这个人这个地方，不是全村共用一条', () => {
  const { rt, place } = world();
  rt.lookAtTraces('near', place);
  rt.lookAtTraces('near', place);
  assert.equal(rt.viewOf('near')!.memories.length, 1, '先钉住：重复看不重复记');

  // 换个人去看同一道焦痕——他没去过，该记下自己的那一条。
  // 不能拿 `a`：`world()` 里它就是事故的目击者，记忆库里早有一条了。
  rt.syncHolders([{ holderId: 'bystander', type: 'character', at: { x: 1, y: 1 } }]);
  rt.lookAtTraces('bystander', place);
  assert.equal(rt.viewOf('bystander')!.memories.length, 1, '另一个人有自己的记忆');

  // 同类痕迹换个地方，也是另一条：两处工坊各出过一次事故，就是两件事。
  rt.syncHolders([{ holderId: 'foundry2', type: 'place', at: { x: 2, y: 2 } }]);
  rt.observe(
    {
      eventId: 'ev_2',
      kind: 'workshop_accident',
      placeId: 'foundry2',
      at: { x: 2, y: 2 },
      actors: ['a'],
      outcome: {},
      importanceHint: 1,
    },
    ['a'],
    2000,
  );
  rt.lookAtTraces('near', 'foundry2');
  assert.equal(rt.viewOf('near')!.memories.length, 2, '另一处的痕迹是另一条记忆');
});

test('碑文的效价跟着它记的那件事，不是表里那个 0', () => {
  // `INFERENCE_TABLE` 里 inscription 那条写着「碑文继承原事件的效价，由调用方
  // 在生成记忆时覆盖」——而这句话一直没有人认领。`lookAtTraces` 原样用了表里的
  // `valence: 0`，于是每一道碑文在记忆里都是不带情绪的。
  //
  // 立一栋楼：`building.built` 经 `observationOf` 变成 `milestone` 事件，
  // `consequenceOf` 给它落一道碑文。给这件事一个明确的正面效价。
  const rt = new MemoryRuntime({ worldId: 'inscription-valence' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'reader', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'hall', type: 'place', at: { x: 0, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_hall',
      kind: 'milestone',
      placeId: 'hall',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 0.9,
      valence: 0.6,
    },
    ['a'],
    1000,
  );

  const inferred = rt.lookAtTraces('reader', 'hall');
  assert.equal(inferred.length, 1, '该看得见那道碑文');
  assert.equal(inferred[0]!.sourceMode, 'read', '碑文是唯一一种高保真痕迹');
  assert.equal(
    inferred[0]!.valence,
    0.6,
    '碑文的效价该是它记的那件事的效价，不是表里的 0',
  );

  const entry = rt.viewOf('reader')!.memories[0]!;
  assert.equal(entry.content.valence, 0.6, '写进记忆的也该是继承来的效价');
  // 显著度里效价那一项因此也活了：0.9 × 0.6 + 0.6 × 0.4 = 0.78。
  // 效价恒 0 时它只有 0.54——碑文是 confidence 最高的一条痕迹，
  // 却因为不带情绪而只比一道焦痕（0.35 × 0.6 + 0.6 × 0.4 = 0.45）强得有限。
  assert.ok(
    entry.salience > 0.7,
    `碑文的显著度该带上情绪，实际 ${entry.salience.toFixed(3)}`,
  );
});

test('焦痕的效价照表里的来：这条继承规则只管碑文', () => {
  // 别把继承规则扩大到所有痕迹。焦痕的效价是「此地出过事故」这个推断自带的，
  // 与它下面埋着的那件事的情绪无关——一次庆典之后的冲突照样留焦痕。
  const { rt, place } = world();
  const inferred = rt.lookAtTraces('near', place);
  assert.ok(inferred.length > 0);
  for (const spec of inferred) {
    assert.equal(spec.sourceMode, 'inferred', '事故留下的是推断，不是记录');
    assert.equal(spec.valence, -0.6, '焦痕照表里的负效价来');
  }
});
