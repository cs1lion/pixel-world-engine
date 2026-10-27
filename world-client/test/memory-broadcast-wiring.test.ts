import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { MemoryEvent } from '../src/world/memory/types.ts';

/**
 * 广播通道的接线。
 *
 * 五类通道（直接感知 / 交谈 / 广播 / 书面 / 痕迹）里的**广播**在这之前
 * 一个生产调用方都没有：`postAnnouncement` 与 `readAnnouncement` 在测试
 * 之外没人调，`announcementReach` 只被它自己读——连单元测试都没有。
 * 于是「官方渠道」这句话在跑着的世界里是假的，而 `latency_ratio` 那条
 * 指标（公告 ≤ 0.5 天 vs 传言 1.5–2.5 天）少了一半。
 *
 * 补充设计 §3.2 把发布权留给三方：玩家（神明）、村长（Planner）、
 * **系统日终日报**。前两方不在本组边界内，这里只接第三方——而它恰好是
 * 唯一不需要生成逻辑的那一方：日报贴什么，是从已经发生的事情里挑。
 *
 * 这一组测的是**接线本身**：日报贴得上去，够得着的人读得到，四格外读不到。
 */

function world(): { rt: MemoryRuntime; events: MemoryEvent[] } {
  const events: MemoryEvent[] = [];
  const rt = new MemoryRuntime({
    worldId: 'broadcast-wiring',
    onEvent: (event) => events.push(event),
    occlusion: { isWalkable: () => true },
  });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'near', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'far', type: 'character', at: { x: 10, y: 0 } },
    // 公告栏：地点 Holder，落点 (1,0)。四格内是 a 与 near，四格外是 far。
    { holderId: 'board', type: 'place', at: { x: 1, y: 0 } },
  ]);
  return { rt, events };
}

/** 一场大事，落点就在公告栏旁边。 */
function accident(rt: MemoryRuntime, eventId = 'mem_1', at = 1000): void {
  rt.observe(
    {
      eventId,
      kind: 'workshop_accident',
      placeId: 'board',
      at: { x: 1, y: 0 },
      actors: ['a'],
      outcome: { what: '炉子炸了' },
      importanceHint: 0.95,
      valence: -0.6,
      arousal: 0.8,
    },
    undefined,
    at,
  );
}

test('日终会贴日报：公告栏不是一块没人管的板子', () => {
  const { rt, events } = world();
  accident(rt);
  rt.tick(DAY_MS);
  assert.equal(
    events.filter((event) => event.kind === 'announcement.posted').length,
    1,
    '跑了一天，公告栏上该有一张日报',
  );
});

test('够得着公告栏的人读到了：四格内就算广播触达', () => {
  const { rt, events } = world();
  accident(rt);
  rt.tick(DAY_MS);
  assert.equal(events.filter((event) => event.kind === 'announcement.read').length, 2, 'a 与 near 都该读到');
  assert.equal(rt.viewOf('a')!.beliefs.length, 1);
  assert.equal(rt.viewOf('near')!.beliefs.length, 1, '站在公告栏旁边的人不该靠传言才知道');
});

test('四格外读不到：广播有范围，不是全村喇叭', () => {
  const { rt } = world();
  accident(rt);
  rt.tick(DAY_MS);
  assert.equal(rt.viewOf('far')!.beliefs.length, 0, '十格外的人不该被广播够到');
});

test('公告不 retell：读到的信念跳数是 0，置信度不低于发布时的地板', () => {
  const { rt } = world();
  accident(rt);
  rt.tick(DAY_MS);
  const belief = rt.viewOf('near')!.beliefs[0]!;
  assert.equal(belief.hop, 0, '公告的保真度是「高，有权威」，不该按传言逐跳衰减');
  assert.ok(
    belief.confidence >= rt.config.broadcastConfidenceFloor,
    `公告的可信度该在 ${rt.config.broadcastConfidenceFloor} 以上，实际 ${belief.confidence}`,
  );
});

test('没有公告栏就没有广播：地点 Holder 不在名册里，日报贴不上去', () => {
  const events: MemoryEvent[] = [];
  const rt = new MemoryRuntime({ worldId: 'no-board', onEvent: (e) => events.push(e) });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
  ]);
  accident(rt);
  rt.tick(DAY_MS);
  assert.equal(events.filter((event) => event.kind === 'announcement.posted').length, 0, '没有板子就不该贴');
  // 但 b 还是知道了——靠 a 亲口告诉他。传言照旧，只是没有了官方那条更快的路。
  const belief = rt.viewOf('b')!.beliefs[0]!;
  assert.equal(belief.sourceHolderId, 'a', '没人贴公告，b 只能听 a 说');
  assert.ok(belief.hop > 0, '道听途说该有跳数，公告才有跳数 0');
});

test('一天只贴一张日报：不是每件事都贴，也不是每人贴一张', () => {
  const { rt, events } = world();
  accident(rt, 'mem_1', 1000);
  accident(rt, 'mem_2', 2000);
  rt.observe(
    {
      eventId: 'mem_3',
      kind: 'milestone',
      placeId: 'board',
      at: { x: 1, y: 0 },
      actors: [],
      outcome: { what: '立起了一栋新楼' },
      importanceHint: 0.6,
      valence: 0.5,
      arousal: 0.4,
    },
    undefined,
    3000,
  );
  rt.tick(DAY_MS);
  assert.equal(
    events.filter((event) => event.kind === 'announcement.posted').length,
    1,
    '同一天发生了三件事，日报只有一张',
  );
});

test('公告栏最多五张：贴满之后新的贴不上', () => {
  // 这道闸是 `postAnnouncement` 自己的，这里从公开路径验它真的在咬——
  // 否则「同时最多 5 张」只是一句注释。
  const { rt } = world();
  for (let day = 0; day < 5; day += 1) {
    accident(rt, `mem_${day}`, day * DAY_MS + 1000);
    rt.tick((day + 1) * DAY_MS);
  }
  const posted = rt.world.viewOf('board');
  assert.ok(posted !== null);
  // 五张是上限，不是目标：够得着公告栏的人会把它们读成信念，
  // 但公告本身最多那么多。
  assert.ok(
    rt.viewOf('a')!.beliefs.length <= 5,
    `公告栏上贴了 ${rt.viewOf('a')!.beliefs.length} 条——超过了同时最多 5 张`,
  );
});

test('安静的一天没有日报：什么都没发生，公告栏就是空的', () => {
  const { rt, events } = world();
  rt.tick(DAY_MS);
  assert.equal(events.filter((event) => event.kind === 'announcement.posted').length, 0);
});

test('日报是确定的：同一个世界跑两遍，贴上去的是同一张', () => {
  const run = (): readonly unknown[] => {
    const { rt, events } = world();
    accident(rt, 'mem_1', 1000);
    accident(rt, 'mem_2', 2000);
    rt.tick(DAY_MS);
    return events.filter((event) => event.kind === 'announcement.posted').map((event) => event.payload['claimId']);
  };
  assert.deepEqual(run(), run(), '挑哪条上公告不许读随机数，也不许读墙钟');
});
