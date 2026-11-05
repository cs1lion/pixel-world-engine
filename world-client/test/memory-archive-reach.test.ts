/**
 * 压缩与归档的入口到底通不通。
 *
 * 30 日联合浸泡（纯日常）里 `promoted = summaries = archived = 0`，看上去像
 * 「清理机制只做减法」。这一条把原因分清楚：
 *
 * 实测日层显著度的总体分布是 p50 = p90 = 0.495、p99 = max = 0.5029——日常
 * 世界生产不出够 0.60 的片段。而 0.60 又不能降：听来的条目实测 0.575，
 * 降到 0.50 会把传闻压成 `sourceMode: 'witnessed'` 的摘要，来源链直接丢失。
 *
 * 所以这条测的是**机制本身**：给它一个「每 7 天一件亲历大事」的场景，
 * 晋升、日摘要、周摘要、归档四步必须依次发生。跑得动不等于跑得对，但
 * 「够不着所以不跑」和「坏了所以不跑」是两件事，这里要把后者排除掉。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';

function village(count: number): MemoryWorld {
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

const DAYS = 90;
const MILESTONE_EVERY = 7;

function milestone(world: MemoryWorld, day: number, holders: readonly string[]): void {
  world.ingest({
    eventId: `ev_${day}`,
    at: day * DAY_MS + 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: [...holders],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.95,
    parentEventId: null,
    witnesses: [...holders],
  });
}

test('每 7 天一件亲历大事：90 天内晋升、日摘要、周摘要、归档依次发生', () => {
  const world = village(5);
  const holders = world.holderIds();
  for (let day = 0; day < DAYS; day += 1) {
    if (day % MILESTONE_EVERY === 0) milestone(world, day, holders);
    world.dayClosed(day, (day + 1) * DAY_MS - 1);
  }

  const all = holders.flatMap((holderId) => world.viewOf(holderId)?.memories ?? []);
  const summaries = all.filter((entry) => entry.kind === 'summary');
  const weekly = summaries.filter((entry) => entry.memoryId.includes('_week_'));
  const archived = all.filter((entry) => entry.archived);

  // 1. 晋升：大事必须离开 day 层，进到 long 层。
  assert.ok(
    summaries.length > 0,
    `一件 0.95 的事都没晋升，说明 T_promote 这条路根本没执行（摘要 ${summaries.length} 条）`,
  );
  // 2. 压缩：日摘要按周合并，`mergeWeekly` 不是摆设。
  assert.ok(
    weekly.length > 0,
    `90 天里周摘要一条都没有，mergeWeekly 没被触发（周摘要 ${weekly.length} 条）`,
  );
  // 3. 归档：long 层强度衰减到 T_forget 以下必须留痕。
  assert.ok(
    archived.length > 0,
    `90 天后没有任何条目归档，归档分支不可达或强度衰减没生效（归档 ${archived.length} 条）`,
  );
  // 4. 归档是「留下但淡出」，不是删掉：条目还在，只是 archived 为真。
  assert.ok(
    summaries.some((entry) => entry.archived),
    '归档的应该是 long 层的摘要，实际归档里没有摘要',
  );
});
