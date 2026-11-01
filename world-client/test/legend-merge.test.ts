/**
 * 归并：同一天、同一地点的闲话并成一块碑。
 *
 * 用户裁决是「大事优先，闲话同日同地兜底」。门槛那半条在 `legend-cull.test.ts`，
 * 这里钉归并那半条：并哪些、并成什么形状、以及**不并什么**。
 *
 * 为什么不并旧的：`Legend` 形成即定格。后来的事在同一个地点再立新的（碑按
 * `reach` 排它们）。回溯改写会让「回放一致」（§16）变成要比较历史版本的东西——
 * 同一天同一个世界跑两遍，第二次的碑文与第一次不一样，而它们本该逐字节相同。
 * 最后一条测试就是这条裁决的守卫。
 *
 * 实测（`.tmp-audit/legend-census.ts`，2026-11-01，真设定集 8 个世界日）：
 * 第 4 天关账时一次立起 22 条，按地点归并后剩 15 条；8 天 35 条 → 27 条。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS } from '../src/world/memory/config.ts';
import { mergeByPlace, maxImportance, type LegendCandidate } from '../src/world/memory/legend.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';

function candidate(init: {
  readonly refs: readonly [string, ...string[]];
  readonly holders: readonly string[];
  readonly variants: readonly string[];
  readonly place?: string;
  readonly firstDay?: number;
  readonly valence?: number;
  readonly arousal?: number;
}): LegendCandidate {
  return {
    eventRefs: init.refs,
    holders: init.holders,
    firstDay: init.firstDay ?? 0,
    variants: init.variants,
    homePlaceId: init.place ?? 'p1',
    valence: init.valence ?? 0,
    arousal: init.arousal ?? 0,
  };
}

test('同地点的两条并成一条：事件取并集、人取并集去重、讲法去重、最早那天留下', () => {
  const a = candidate({
    refs: ['e1'],
    holders: ['v0', 'v1'],
    variants: ['炉子炸了'],
    firstDay: 0,
    valence: -0.5,
    arousal: 0.8,
  });
  const b = candidate({
    refs: ['e2'],
    holders: ['v1', 'v2'],
    variants: ['炉子炸了', '有人受了伤'],
    firstDay: 1,
    valence: 0.2,
    arousal: 0.3,
  });
  // e2 更重：情绪取它的，与 `candidatesFrom` 同一口径（那两列从事件的 kind 取）。
  const importanceOf = (ref: string): number => (ref === 'e2' ? 0.6 : 0.35);

  const merged = mergeByPlace([a, b], importanceOf);
  assert.equal(merged.length, 1, '同一个地点只该剩一条');
  const [one] = merged;
  assert.deepEqual([...one!.eventRefs], ['e1', 'e2'], '两件事都攥在手里，顺序按世界给出的顺序');
  assert.deepEqual([...one!.holders], ['v0', 'v1', 'v2'], '人取并集、去重、排序');
  assert.deepEqual([...one!.variants], ['炉子炸了', '有人受了伤'], '同一种讲法只留一次');
  assert.equal(one!.firstDay, 0, '最早那天留下');
  assert.equal(one!.valence, 0.2, '情绪取最重那件事的');
  assert.equal(one!.arousal, 0.3, '唤醒度同上');
  assert.equal(one!.homePlaceId, 'p1');
});

test('不同地点不并，顺序按各自第一次出现', () => {
  const merged = mergeByPlace(
    [
      candidate({ refs: ['e1'], holders: ['v0'], variants: ['甲'], place: 'p1' }),
      candidate({ refs: ['e2'], holders: ['v0'], variants: ['乙'], place: 'p2' }),
      candidate({ refs: ['e3'], holders: ['v1'], variants: ['丙'], place: 'p1' }),
    ],
    () => 0.35,
  );
  assert.deepEqual(
    merged.map((item) => item.homePlaceId),
    ['p1', 'p2'],
    '两个地点两条，且 p1 在前面（它先出现）',
  );
  assert.deepEqual([...merged[0]!.eventRefs], ['e1', 'e3'], 'p1 的两件事并在一起');
  assert.deepEqual([...merged[1]!.eventRefs], ['e2'], 'p2 只有一件，原样');
});

test('只有一条候选时原样返回，不改写', () => {
  const only = candidate({ refs: ['e1'], holders: ['v0'], variants: ['甲'], firstDay: 3 });
  const [merged] = mergeByPlace([only], () => 0.35);
  assert.equal(merged, only, '没有闲话可并的日子不该被改写——连对象都该是同一个');
});

test('maxImportance 取最重的那件；查不到重量的事按 0 计', () => {
  const weights: Readonly<Record<string, number>> = { e1: 0.35, e2: 0.9 };
  const importanceOf = (ref: string): number => weights[ref] ?? 0;
  assert.equal(maxImportance(candidate({ refs: ['e1', 'e2'], holders: [], variants: [] }), importanceOf), 0.9);
  assert.equal(
    maxImportance(candidate({ refs: ['e1', 'gone'], holders: [], variants: [] }), importanceOf),
    0.35,
    '事件被回收之后它的重量无从谈起，按 0 计——「查不到多重」不该被读成「很重」',
  );
});

/** 一个 10 人的村，加一个地点。与 `legend-cull.test.ts` 同一套夹具。 */
function village(): MemoryWorld {
  const world = new MemoryWorld({ worldId: 'legend-merge', grid: { isWalkable: () => true } });
  for (let i = 0; i < 10; i += 1) {
    world.addHolder({
      holderId: `v${i}`,
      type: 'character',
      profile: {},
      at: { x: i % 4, y: Math.floor(i / 4) },
    });
  }
  world.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 1, y: 0 } });
  return world;
}

function chatter(world: MemoryWorld, eventId: string, at: number): void {
  world.ingest({
    eventId,
    at,
    kind: 'workshop_accident',
    place: { placeId: 'p1', at: { x: 1, y: 0 }, indoor: false },
    actors: ['v0'],
    outcome: { what: `第 ${eventId} 件事` },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.35,
    parentEventId: null,
    witnesses: ['v0', 'v1', 'v2', 'v3', 'v4'],
  });
}

function closeDays(world: MemoryWorld, from: number, to: number): void {
  for (let d = from; d < to; d += 1) world.dayClosed(d, (d + 1) * DAY_MS);
}

test('昨天立好的碑不回头并：后来的闲话在同一个地点另立一块', () => {
  const world = village();
  chatter(world, 'ev_day0', 1000);
  closeDays(world, 0, 5);

  const first = world.legendsOf();
  assert.equal(first.length, 1, `前提：第 4 天关账时该立起一块，实际 ${first.length} 块`);
  assert.deepEqual([...first[0]!.eventRefs], ['ev_day0']);

  // 第五天又出一件闲话，同一个地点。实测（`.tmp-audit/legend-probe3.ts`）它要等到
  // 第 9 天关账才够格：信念在第 6 天才落成，`qualifies` 再要三天。
  chatter(world, 'ev_day5', 5 * DAY_MS + 1000);
  closeDays(world, 5, 10);

  const later = world.legendsOf();
  assert.equal(later.length, 2, `后来的闲话该另立一块，实际 ${later.length} 块`);
  assert.deepEqual(
    [...later[0]!.eventRefs],
    ['ev_day0'],
    '先立的那块碑一个字都不该变——碑形成即定格，回溯改写会让回放对不上',
  );
  assert.deepEqual([...later[1]!.eventRefs], ['ev_day5'], '新立的那块只攥着新事件');
  assert.equal(later[1]!.formedDay, 9, '它立在第 9 天关账时，不是第 4 天');
});
