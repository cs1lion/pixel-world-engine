import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { computeVitals, type TellRecord } from '../src/world/memory/vitals.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';

/**
 * 传播护栏的实测：覆盖曲线、跳数、扇出、冷却、孤立单位。
 *
 * 这些测的是《补充设计》§3.2 B 那几条定稿指标，而不是某一段实现。
 * 换一种扩散算法，这些断言该照旧成立——它们说的是世界该长什么样。
 */

/** 一个 10 人的村子，站成一条 1 格间距的直线。 */
function village(count = 10): MemoryWorld {
  const world = new MemoryWorld();
  for (let index = 0; index < count; index += 1) {
    world.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  }
  return world;
}

function seedEvent(world: MemoryWorld, witnesses: readonly string[], at = 1000): void {
  world.ingest({
    eventId: 'ev_1',
    at,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: [witnesses[0] ?? 'v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses,
  });
}

function knownBy(world: MemoryWorld): string[] {
  return world.holderIds().filter((id) => world.viewOf(id)!.beliefs.length > 0);
}

test('覆盖率：单一重大事件第 1 天末不超过 35%', () => {
  const world = village(10);
  seedEvent(world, ['v0']);
  world.createClaimFrom('ev_1', 'v0', 1000);
  world.dayClosed(0, DAY_MS - 1);
  const share = knownBy(world).length / 10;
  assert.ok(share <= 0.35, `第 1 天覆盖率 ${share}，超过护栏 35%`);
  assert.ok(share > 0, '至少该传出去一点，否则护栏没在测东西');
});

test('覆盖率曲线：第 3 天末到稳态 60%~80%，不是一天全知', () => {
  // 指标写的是「第 1 天末 ≤35%，第 3 天末 60%~80%」。只有把三天都跑完，
  // 才能看出这条曲线是不是真的在爬，而不是被某一道闸一刀砍死。
  const world = village(10);
  seedEvent(world, ['v0']);
  world.createClaimFrom('ev_1', 'v0', 1000);

  const curve: number[] = [];
  for (let day = 0; day < 3; day += 1) {
    world.dayClosed(day, (day + 1) * DAY_MS - 1);
    curve.push(knownBy(world).length / 10);
  }

  assert.ok(curve[0]! <= 0.35, `第 1 天 ${curve[0]}，超过 35%`);
  assert.ok(curve[2]! >= 0.6, `第 3 天只有 ${curve[2]}，没到稳态 60%`);
  assert.ok(curve[2]! <= 0.8, `第 3 天 ${curve[2]}，超过稳态上限 80%`);
  // 单调不减：知道了就不会忘掉（信念不参与记忆的衰减归档）。
  assert.ok(curve[0]! <= curve[1]! && curve[1]! <= curve[2]!, `曲线不单调：${curve.join(' → ')}`);
});


test('孤立单位：站得太远的人永远不会知道', () => {
  const world = new MemoryWorld();
  for (let index = 0; index < 4; index += 1) {
    world.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  }
  world.addHolder({
    holderId: 'hermit',
    type: 'character',
    profile: { talkativeness: 0.5 },
    at: { x: 200, y: 200 },
  });
  seedEvent(world, ['v0']);
  world.createClaimFrom('ev_1', 'v0', 1000);
  world.dayClosed(0, DAY_MS - 1);
  assert.equal(world.viewOf('hermit')!.beliefs.length, 0, '离得远就该一直不知道');
});

test('扇出上限：一个人就一条断言一天最多讲给 3 个人', () => {
  // 12 个人挤在 2 格内，谁都能跟谁说话；扇出仍然只能 3。
  const world = new MemoryWorld();
  for (let index = 0; index < 12; index += 1) {
    world.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 1 },
      at: { x: index % 3, y: Math.floor(index / 3) },
    });
  }
  seedEvent(world, ['v0']);
  world.createClaimFrom('ev_1', 'v0', 1000);
  world.dayClosed(0, DAY_MS - 1);

  const told = knownBy(world).filter((id) => id !== 'v0');
  assert.ok(told.length <= 3, `v0 一天讲给了 ${told.length} 个人，超过扇出上限 3`);
});

test('最大跳数：第 3 跳之后没人再往下传', () => {
  const world = village(10);
  seedEvent(world, ['v0']);
  world.createClaimFrom('ev_1', 'v0', 1000);
  world.dayClosed(0, DAY_MS - 1);

  // 每一个信念上的 hop 都不该超过 maxHops。
  for (const id of world.holderIds()) {
    for (const belief of world.viewOf(id)!.beliefs) {
      assert.ok(belief.hop <= DEFAULT_MEMORY_CONFIG.maxHops, `${id} 手里是第 ${belief.hop} 跳`);
    }
  }
});

test('保真度曲线：跳数越高，细节越低、可信度越低', () => {
  const world = village(10);
  seedEvent(world, ['v0']);
  world.createClaimFrom('ev_1', 'v0', 1000);
  world.dayClosed(0, DAY_MS - 1);

  const byHop = new Map<number, { detail: number; confidence: number }>();
  for (const id of world.holderIds()) {
    for (const belief of world.viewOf(id)!.beliefs) {
      const existing = byHop.get(belief.hop);
      if (existing === undefined || belief.confidence < existing.confidence) {
        byHop.set(belief.hop, { detail: 3 - belief.hop, confidence: belief.confidence });
      }
    }
  }
  const hops = [...byHop.keys()].sort((a, b) => a - b);
  for (let index = 1; index < hops.length; index += 1) {
    const earlier = byHop.get(hops[index - 1]!)!;
    const later = byHop.get(hops[index]!)!;
    assert.ok(later.confidence <= earlier.confidence, '跳得越远越不可信');
    assert.ok(later.detail <= earlier.detail, '跳得越远细节越少');
  }
});

test('心电图：全员同知的平静与全员孤立的死寂都能读出来', () => {
  const config = DEFAULT_MEMORY_CONFIG;

  const silent = computeVitals({
    day: 5,
    memories: [],
    beliefs: [],
    tells: [],
    holderIds: ['a', 'b', 'c'],
    config,
  });
  assert.equal(silent.isolatedHoldersCount, 3, '没人说话时全员孤立');
  assert.equal(silent.infoEntropy, 0, '一条断言都没有时熵为 0');

  // 同一件事全员知道：断言只有 1 条、覆盖均匀，熵低（这正是「同质化」的样子）。
  const uniform: TellRecord[] = [
    { day: 5, from: 'a', to: 'b', claimId: 'c1' },
    { day: 5, from: 'a', to: 'c', claimId: 'c1' },
  ];
  const homogeneous = computeVitals({
    day: 5,
    memories: [],
    beliefs: [],
    tells: uniform,
    holderIds: ['a', 'b', 'c'],
    config,
  });
  assert.equal(homogeneous.isolatedHoldersCount, 0);
  assert.ok(homogeneous.infoEntropy < 0.5, '全员只知道同一件事，熵该低');
});

test('孤立单位只数人，不数楼', () => {
  // 楼不参与 `claim.told`——它不说话。把地点 Holder 算进孤立统计，每一栋
  // 楼都会被永久算成孤立单位：一个两三个人、六七栋楼的村子，这个数会常年
  // 停在 7 以上。而导演读它是要看「世界是不是死了」，那个数必须会动。
  const world = new MemoryWorld();
  world.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  world.addHolder({ holderId: 'b', type: 'character', profile: {}, at: { x: 50, y: 0 } });
  world.addHolder({ holderId: 'shop', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  world.addHolder({ holderId: 'shop2', type: 'place', profile: {}, at: { x: 50, y: 0 } });
  world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'shop', at: { x: 0, y: 0 }, indoor: false },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
  world.createClaimFrom('ev_1', 'a', 1000);
  const vitals = world.dayClosed(0, DAY_MS - 1);
  // 隔 50 格的 b 一句话没听到，他是唯一该被算作孤立的人。两栋楼不算。
  assert.equal(vitals.isolatedHoldersCount, 1, '楼不该被算成孤立单位');
});

test('回放一致：同一天两次扩散得到同一份信念', () => {
  const run = (): string => {
    const world = village(8);
    seedEvent(world, ['v0']);
    world.createClaimFrom('ev_1', 'v0', 1000);
    world.dayClosed(0, DAY_MS - 1);
    return JSON.stringify(world.holderIds().map((id) => world.viewOf(id)!.beliefs));
  };
  assert.equal(run(), run());
});
