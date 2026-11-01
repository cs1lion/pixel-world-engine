/**
 * 门槛：碑上刻大事，闲话并成一块。
 *
 * 协议 §12 的原话是「反复讲述的**大事**」，而 `qualifies` 只判「反复讲述」——
 * 一件被五个人讲满三天的闲话照样够格。这一组钉的是门槛那半条，以及用户裁决的
 * 兜底：「大事优先，闲话同日同地兜底」——闲话不是被扔掉，是同一天同一个地点
 * 并成一块碑（归并本身在 `legend-merge.test.ts`）。
 *
 * 为什么门槛不能是「把闲话清掉」：实测（`.tmp-audit/legend-census.ts`，
 * 2026-11-01，真设定集、1000ms 拍、8 个世界日）35 条传说的
 * `max(importanceHint)` **一律 0.35**（全部来自 `routine_done`），
 * `legendImportanceFloor = 0.4` 以上一条都没有。若门槛单独用，灯潮界会一块碑
 * 都不立——那不是收束，是把这一层关掉了。所以门槛只分栏，兜底负责出碑。
 * 修完痕迹后同一口径重测是 28 条、hint 分布仍是 0.35 一种，结论不变。
 *
 * 也正因为如此，下面第一、二条用的是**合成事件**（`importanceHint` 0.95）：
 * 门槛以上的分支在真世界里还没出现过，只能在这里钉。第三条是今天真世界
 * 唯一走的那条路。
 *
 * 时间线：信念不是 `ingest` 当场写的，它在第一次日终整理时才落成
 * （`.tmp-audit/legend-probe2.ts` 实测：`ingest` 之后五个目击者手里都是 0 条），
 * 所以传说在**第 4 天关账**时才立起（`formedDay = 4`），不是第 3 天。
 * 下面每条都关到第 5 天，留一天余量。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MEMORY_CONFIG, DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';

/** 一个 10 人的村，加两个地点。人都撒在一片 4×3 的格子上。 */
function village(): MemoryWorld {
  const world = new MemoryWorld({ worldId: 'legend-cull', grid: { isWalkable: () => true } });
  for (let i = 0; i < 10; i += 1) {
    world.addHolder({
      holderId: `v${i}`,
      type: 'character',
      profile: {},
      at: { x: i % 4, y: Math.floor(i / 4) },
    });
  }
  world.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 1, y: 0 } });
  world.addHolder({ holderId: 'p2', type: 'place', profile: {}, at: { x: 3, y: 3 } });
  return world;
}

/** 五个人目击的一件事。`importanceHint` 决定它是大事还是闲话。 */
function witnessed(
  world: MemoryWorld,
  eventId: string,
  importanceHint: number,
  at = 1000,
  placeId = 'p1',
): void {
  world.ingest({
    eventId,
    at,
    kind: 'workshop_accident',
    place: { placeId, at: { x: 1, y: 0 }, indoor: false },
    actors: ['v0'],
    outcome: { what: `第 ${eventId} 件事` },
    visibility: 'world',
    source: 'world',
    importanceHint,
    parentEventId: null,
    witnesses: ['v0', 'v1', 'v2', 'v3', 'v4'],
  });
}

/** 关掉第 `from` 天到第 `to - 1` 天。`qualifies` 要 `nowDay - firstDay >= legendDays`（3）。 */
function closeDays(world: MemoryWorld, from: number, to: number): void {
  for (let d = from; d < to; d += 1) world.dayClosed(d, (d + 1) * DAY_MS);
}

function beliefsOn(world: MemoryWorld, eventId: string): readonly string[] {
  return world
    .holderIds()
    .flatMap((id) => world.viewOf(id)?.beliefs ?? [])
    .filter((belief) => belief.eventRefs.includes(eventId))
    .map((belief) => belief.holderId);
}

const FLOOR = DEFAULT_MEMORY_CONFIG.legendImportanceFloor;

test('大事独占一块碑：够得着门槛的事一条一块，不跟别人并', () => {
  const world = village();
  witnessed(world, 'ev_big', 0.95);
  witnessed(world, 'ev_small', 0.35, 1200);
  closeDays(world, 0, 5);

  const legends = world.legendsOf();
  assert.equal(legends.length, 1, `大事与闲话不该各立一块，实际 ${legends.length} 块`);
  assert.deepEqual(
    [...legends[0]!.eventRefs],
    ['ev_big'],
    '那块碑上只有大事，闲话并进不了一条大事的碑',
  );
});

test('门槛是「大于等于」：正好落在门槛上的事算大事，差一点的不算', () => {
  const world = village();
  witnessed(world, 'ev_at', FLOOR);
  witnessed(world, 'ev_below', FLOOR - 0.01, 1200, 'p2');
  closeDays(world, 0, 5);

  const legends = world.legendsOf();
  const onFloor = legends.filter((legend) => legend.eventRefs.includes('ev_at'));
  const belowFloor = legends.filter((legend) => legend.eventRefs.includes('ev_below'));
  assert.equal(onFloor.length, 1, `hint 正好等于门槛 ${FLOOR} 的事该独占一块碑`);
  assert.equal(belowFloor.length, 1, '差一点的那件事仍会立碑——它只是并进它那个地点那条');
  assert.equal(legends.length, 2, '两个地点各一块：一个独占了门槛上的事，一个兜底并了门槛下的');
});

test('闲话不独占碑，但也不被扔掉：同一天同一地点的几件闲话并成一块，信念照旧在', () => {
  const world = village();
  witnessed(world, 'ev_chat_1', 0.35);
  witnessed(world, 'ev_chat_2', 0.35, 1200);
  witnessed(world, 'ev_chat_3', 0.35, 1400);
  closeDays(world, 0, 5);

  const legends = world.legendsOf();
  assert.equal(legends.length, 1, `三件闲话该并成一块碑，实际 ${legends.length} 块`);
  assert.deepEqual(
    [...legends[0]!.eventRefs].sort(),
    ['ev_chat_1', 'ev_chat_2', 'ev_chat_3'],
    '并起来的那块碑要把三件事都攥在手里，不能只留一件',
  );
  // 门槛只闸碑，不闸嘴：这三件事的信念一条都没少。
  for (const eventId of ['ev_chat_1', 'ev_chat_2', 'ev_chat_3']) {
    assert.ok(
      beliefsOn(world, eventId).length >= 5,
      `${eventId} 的信念还在五个人以上手里，实际 ${beliefsOn(world, eventId).length} 个`,
    );
  }

  // 第二天不许再立一遍。这三件事每天照旧够格，而碑上攥着的是**三条**事件；
  // 「已立过」若按 `eventRefs` 拼出来的 key 整组相等去判，单条候选永远对不上
  // 那条三合一的碑，于是天天重立一块一模一样的。
  closeDays(world, 5, 7);
  assert.equal(world.legendsOf().length, 1, '并好的碑第二天不该被重新立一遍');
});

test('大事优先：同一个地点同一天有大事，那天的闲话不立——第二天没有大事时才兜底', () => {
  const world = village();
  witnessed(world, 'ev_big', 0.95);
  witnessed(world, 'ev_chat', 0.35, 1200);

  closeDays(world, 0, 5);
  const day4 = world.legendsOf();
  assert.equal(day4.length, 1, `大事那块碑立起来的那天，同地的闲话不该跟着立，实际 ${day4.length} 块`);
  assert.deepEqual([...day4[0]!.eventRefs], ['ev_big'], '立起来的是大事那块');

  // 第二天那个地点没有大事了，闲话照旧够格、照旧没人替它说过——这时候兜底。
  closeDays(world, 5, 6);
  const day5 = world.legendsOf();
  assert.equal(day5.length, 2, `第二天闲话该兜底立起来，实际 ${day5.length} 块`);
  assert.deepEqual(
    [...day5[1]!.eventRefs],
    ['ev_chat'],
    '第二天立起来的是那件闲话，且它没有回头并进大事那块碑',
  );
});
