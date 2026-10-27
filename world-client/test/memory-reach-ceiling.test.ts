/**
 * 「一条断言最多被几个人记住」这个上限，按 `maxFanout` 与 `maxHops` 算得出来。
 *
 * `propagate.ts` 那段注释在按它讲覆盖率目标（「一天的覆盖率不超过 35%」）——
 * 35% 是拿一个分母除出来的，分母就得是对的。原来写「3 跳之后理论上限是 27 人」，
 * 而 27 只是**第 3 层**的人数：第 1 层 3、第 2 层 9、第 3 层 27，
 * 三层加起来 39，算上起源者 40。说成 27 是把最宽的一层当成了总和。
 *
 * 注意这是**结构**上限，跟「每天讲给几个人」那个配额是两件事：配额（`maxFanout`）
 * 管的是节奏，跳数（`maxHops`）管的是深度。树再慢，深度到 3 也就不再分了，
 * 所以不管跑多少天，拿过这条断言的人不会超过这个数。
 *
 * 而现在两个设定集都只有 2 个村民——这个上限一辈子摸不到。它仍值得算：
 * 它是护栏的刻度，改了 `maxFanout`/`maxHops` 而刻度不动，覆盖率目标就成了空话。
 * 而刻度要成立，两条护栏都得真的在闸：深度那条由第 2 个测试核，配额那条
 * （`canFanout`）由第 4 个核——只核算式的话，第一层是不是 3 个人并没被验证。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import {
  canFanout,
  canSpread,
  fanoutKey,
  retell,
  type FanoutState,
} from '../src/world/memory/propagate.ts';

/** 深度 `hops` 内，除起源者之外最多有多少人拿过这条断言。 */
function ceiling(fanout: number, hops: number): number {
  let total = 0;
  let tier = 1;
  for (let hop = 1; hop <= hops; hop += 1) {
    tier *= fanout;
    total += tier;
  }
  return total;
}

test('3 跳的理论上限是 39 人，不是 27：27 只是最宽的那一层', () => {
  const { maxFanout, maxHops } = DEFAULT_MEMORY_CONFIG;
  assert.equal(ceiling(maxFanout, maxHops), 39, `fanout ${maxFanout}、hops ${maxHops} 该得 39`);
  // 分层的形状也钉一下：错的那个数（27）正是最后那一层。
  let tier = 1;
  const tiers: number[] = [];
  for (let hop = 1; hop <= maxHops; hop += 1) {
    tier *= maxFanout;
    tiers.push(tier);
  }
  assert.deepEqual(tiers, [3, 9, 27], '三层各是 3 / 9 / 27');
  assert.equal(tiers[tiers.length - 1], 27, '原来说的 27 是第三层，不是总和');
});

test('跳数上限真的把深度截在 3：第 3 跳之后不许再传', () => {
  const config = DEFAULT_MEMORY_CONFIG;
  // 造一条 hop 3 的断言：retell 三次，hop 从 0 到 3。
  let claim = retell(
    retell(
      retell(
        {
          id: 'c1',
          speakerId: 'v1',
          content: { detailLevel: 9, valence: 0.2, topic: 'tide' },
          confidence: 1,
          hop: 0,
          distortedBy: [],
          atMs: 0,
        } as never,
        config,
      ),
      config,
    ),
    config,
  );
  assert.equal(claim.hop, 3);
  assert.equal(canSpread(claim, config), false, '第 3 跳该是尽头');
  // 而第 2 跳还传得动（细节还没归零）——否则上限永远到不了 39。
  const atHop2 = retell(
    retell(
      {
        id: 'c2',
        speakerId: 'v1',
        content: { detailLevel: 9, valence: 0.2, topic: 'tide' },
        confidence: 1,
        hop: 0,
        distortedBy: [],
        atMs: 0,
      } as never,
      config,
    ),
    config,
  );
  assert.equal(atHop2.hop, 2);
  assert.equal(canSpread(atHop2, config), true, '第 2 跳还该传得动');
});

test('改了 fanout 或 hops，这个上限会跟着动——所以注释里的数不能手抄', () => {
  // 这不是在测配置，是在测上面那个算式与 `maxHops` 的语义对得上：
  // 深度砍一半，人数远不止砍一半（3^3 对 3^1 是 27 对 3）。
  assert.equal(ceiling(3, 1), 3);
  assert.equal(ceiling(3, 2), 12);
  assert.equal(ceiling(3, 3), 39);
  assert.equal(ceiling(4, 3), 84);
});

test('第一层真的只有 maxFanout 个人：讲满就不准再讲', () => {
  // 39 这个数站在「每个单位一天就同一条断言只向 maxFanout 个人提起」上。
  // 上面几条只核了算式与深度，没核这条配额本身——配额不设闸，第一层就不是
  // `maxFanout` 个人，39 立刻是空话。所以这里让 `maxFanout` 真的去咬一次。
  const config = DEFAULT_MEMORY_CONFIG;
  const counts = new Map<string, number>();
  const state: FanoutState = { day: 1, counts };
  for (let told = 0; told < config.maxFanout; told += 1) {
    assert.equal(canFanout(state, 'v0', 'c1', 1, config), true, `第 ${told + 1} 个该还讲得动`);
    counts.set(fanoutKey('v0', 'c1'), told + 1);
  }
  assert.equal(canFanout(state, 'v0', 'c1', 1, config), false, '讲满 maxFanout 个就不该再讲');
  // 换一天、换一条断言，配额各自归零——否则深度到不了 maxHops 就被自己堵死。
  assert.equal(canFanout(state, 'v0', 'c1', 2, config), true, '第二天该归零');
  assert.equal(canFanout(state, 'v0', 'c2', 1, config), true, '换一条断言该归零');
});
