/**
 * 「深度 3、每层 3 人的满三元树有多大」——这个数按 `maxFanout` 与 `maxHops`
 * 算得出来，而 `propagate.ts` 那段注释在按它说话。
 *
 * 先说清它**不是**什么：它不是人数上限。配额（`maxFanout`）按天归零
 * （`fanoutUsed` 换天返回 0），所以一个单位终身能讲 3 × 天数 个不同的人；
 * 跳数（`maxHops`）只管深度。真正封顶持谣人数的是**人口**。
 *
 * 它**是**什么：树的形状。深度 3、每层 3 人，三层各是 3 / 9 / 27，
 * 加起来 39，算上起源者 40。原来写「3 跳之后理论上限是 27 人」——27 只是
 * 第 3 层，不是总和；可改成的「39 是结构上限」也不对，39 是满树的节点数。
 * 这里把树算一遍，两个错法都钉住。
 *
 * 而现在两个设定集加起来只有 2 个村民（莞尔镇的包一个都不声明，那 2 个是
 * `Simulation` 的默认；灯潮界声明 2 个）——这个数一辈子摸不到。它仍值得算：
 * 改了 `maxFanout` / `maxHops` 而刻度不动，注释里那句「39」就成了空话。
 * 而刻度要成立，两道闸都得真的在闸：深度那条由第 2 个测试核，配额那条
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

test('满三元树是 39 个节点，不是 27：27 只是最宽的那一层', () => {
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

test('39 是树的节点数，不是人数上限：配额按天归零，深度只管深度', () => {
  // 这一条是防「39 被当成上限」的那道闸。两条依据都在源码里：
  //   - `fanoutUsed` 见 `state.day !== day` 就返回 0，`bumpFanout` 换天整张表清掉
  //     ——所以同一个节点一天讲 3 个，第二天又能讲 3 个**新的**；
  //   - `canSpread` 只问 `claim.hop < maxHops`，不问今天讲过几个。
  // 于是「拿过这条断言的人数」随天数增长，封顶它的是人口，不是 39。
  const config = DEFAULT_MEMORY_CONFIG;
  const heard = new Set<string>();
  for (let day = 1; day <= 4; day += 1) {
    // 换天就是换一张表：`bumpFanout` 见 `this.fanout.day !== day` 就整张清掉。
    // 所以这里也按天新建 state——留着昨天那张表来问今天，问出来的是昨天的账。
    const counts = new Map<string, number>();
    const state: FanoutState = { day, counts };
    for (let told = 0; told < config.maxFanout; told += 1) {
      const listener = `v${day}-${told}`;
      assert.equal(canFanout(state, 'v0', 'c1', day, config), true, `第 ${day} 天第 ${told + 1} 个该还讲得动`);
      counts.set(fanoutKey('v0', 'c1'), told + 1);
      heard.add(listener);
    }
    assert.equal(canFanout(state, 'v0', 'c1', day, config), false, `第 ${day} 天讲满就不该再讲`);
  }
  // 四天讲给 12 个不同的人——同一个节点，同一句断言，早就讲过了「第三层」那 3 个。
  assert.equal(heard.size, 12, `四天该讲给 12 个不同的人，实得 ${heard.size}`);
  // 深度那道闸仍然在：hop 到 3 就再也传不动（下一条测试细核）。
  assert.equal(config.maxHops, 3, 'hops 变了，上面那句「深度 3」要重写');
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
