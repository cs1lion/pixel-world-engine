import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

/**
 * 传说的生死：靠传播维持，无人讲则淡去。
 *
 * 协议第 12 节把那句话写成规则，`legend.ts` 也把它写成了两个函数——
 * `decayLegend`（掉 1）与 `reinforceLegend`（加 N）。而**只有一个被接过**：
 * `updateLegends` 里只有 `decayLegend`，`reinforceLegend` 一个调用方都没有。
 *
 * 于是「靠传播维持」在跑着的世界里是反的：传说只淡不长，讲得再多也救不回来。
 * 实测一条 reach=7 的传说，此后每天准掉 1（7,6,5,4,3,2），到 1 淡去——
 * 然后**当天就从信念库里重新形成一条 reach=7 的**，再掉 6 天。
 * `legend.formed` 每 6 天响一次，永远响下去。那不是集体记忆的生死，
 * 那是一台节拍器。
 *
 * 这一组测的是**接线本身**：有人讲就活着，没人讲就淡，淡了不再原地重生。
 */

/** 一个七人村子，公告栏在 (6,0)。够 `legendHolders = 5` 的门槛。 */
function village(): MemoryRuntime {
  const rt = new MemoryRuntime({ worldId: 'legend-life', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'c', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'd', type: 'character', at: { x: 3, y: 0 } },
    { holderId: 'e', type: 'character', at: { x: 4, y: 0 } },
    { holderId: 'f', type: 'character', at: { x: 5, y: 0 } },
    { holderId: 'board', type: 'place', at: { x: 6, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'mem_1',
      kind: 'workshop_accident',
      placeId: 'board',
      at: { x: 6, y: 0 },
      actors: ['a'],
      outcome: { what: '炉子炸了' },
      importanceHint: 0.95,
      valence: -0.6,
      arousal: 0.9,
    },
    undefined,
    1000,
  );
  return rt;
}

function reachOf(rt: MemoryRuntime): readonly number[] {
  return rt.world.legendsOf().map((legend) => legend.reach);
}

test('有人讲，传说就活着：每天有新听众，reach 不往下掉', () => {
  const rt = village();
  for (let day = 1; day <= 12; day += 1) {
    // 每天搬来一个新人，站在老住户旁边——那条老传说每天都有新听众。
    rt.syncHolders([{ holderId: `new${day}`, type: 'character', at: { x: 5, y: 0 } }]);
    rt.tick(day * DAY_MS);
  }
  const reach = reachOf(rt);
  assert.equal(reach.length, 1, '该有一条传说');
  // 接上 `reinforceLegend` 之前，这条曲线是 12,11,10,…,2 然后淡去、原地重生。
  assert.ok(
    reach[0]! >= 12,
    `天天有人听说，reach 该撑住，实际掉到 ${reach[0]}——reinforceLegend 没接上`,
  );
});

test('没人讲，传说就淡：一整天没有新听众，reach 掉 1', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  const formed = reachOf(rt)[0]!;
  assert.ok(formed > 1, '先得形成一条传说');
  const before = reachOf(rt)[0]!;
  rt.tick(7 * DAY_MS);
  assert.equal(reachOf(rt)[0], before - 1, '没人讲的那天该掉 1');
});

test('淡去的传说留在表里：reach 归零，不是记录消失', () => {
  const rt = village();
  for (let day = 1; day <= 14; day += 1) rt.tick(day * DAY_MS);
  const reach = reachOf(rt);
  assert.equal(reach.length, 1, '淡去不是删除——表里还该有它');
  assert.equal(reach[0], 0, '讲不下去的传说该归零');
});

test('淡去之后不原地重生：二十天只有一条传说', () => {
  // 少了这一条，淡去的传说被 `.filter(!faded)` 摘掉，同一天的
  // `candidatesFrom` 又看见同样的信念，当场形成一条新的——
  // `legend.formed` 每 6 天响一次，永远响下去。
  const rt = village();
  for (let day = 1; day <= 20; day += 1) rt.tick(day * DAY_MS);
  const ids = rt.world.legendsOf().map((legend) => legend.legendId);
  assert.equal(ids.length, 1, `二十天形成了 ${ids.length} 条传说——它在原地重生`);
});

test('淡去之后不再补：reach 归零了就停在零', () => {
  const rt = village();
  for (let day = 1; day <= 16; day += 1) rt.tick(day * DAY_MS);
  const fadedReach = reachOf(rt)[0]!;
  assert.equal(fadedReach, 0, '先得淡到零');
  // 淡去的传说还在表里，而村里没人再听说这件事——不许招魂。
  rt.tick(17 * DAY_MS);
  rt.tick(18 * DAY_MS);
  assert.equal(reachOf(rt)[0], 0, '归零的传说不该自己涨回来');
});
