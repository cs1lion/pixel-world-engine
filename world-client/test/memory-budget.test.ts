/**
 * 预算与淘汰痕迹：
 *
 * 1. 事实超预算时按**重要度**裁，不是按新旧一刀切；
 * 2. 淘汰留下 `memory.pruned`（层 / 条数 / 字节 / 原因 / 剩余），不是静默；
 * 3. 被裁的事实不会让面板编造——`dayTimelineFor` 把它标成 `whenKnown = false`，
 *    面板据此写「时刻不明」（渲染那一半在 `unit-status.test.ts`）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DAY_MS, DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { MemoryWorld } from '../src/world/memory/world.ts';
import type { MemoryEvent } from '../src/world/memory/types.ts';

function withFactsBudget(
  count: number,
  bytes = 100_000,
): { runtime: MemoryRuntime; world: MemoryWorld; events: MemoryEvent[] } {
  const events: MemoryEvent[] = [];
  const runtime = new MemoryRuntime({
    config: {
      ...DEFAULT_MEMORY_CONFIG,
      libraryBudget: {
        ...DEFAULT_MEMORY_CONFIG.libraryBudget,
        facts: { count, bytes },
      },
    },
    onEvent: (event) => events.push(event),
  });
  runtime.world.addHolder({
    holderId: 'v0',
    type: 'character',
    profile: { talkativeness: 0.5 },
    at: { x: 0, y: 0 },
  });
  return { runtime, world: runtime.world, events };
}

function ingest(world: MemoryWorld, eventId: string, importanceHint: number, at: number): void {
  world.ingest({
    eventId,
    at,
    kind: 'street_tumble',
    place: { placeId: 'street', at: { x: 0, y: 0 }, indoor: false, placeType: 'street' },
    actors: ['v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint,
    parentEventId: null,
    witnesses: ['v0'],
  });
}

test('事实超条数预算：先裁不重要的，重要的留下', () => {
  const { world, events } = withFactsBudget(1);
  ingest(world, 'ev_low', 0.2, DAY_MS / 2);
  ingest(world, 'ev_high', 0.9, DAY_MS / 2 + 60_000);
  world.dayClosed(0, DAY_MS - 1);

  assert.equal(world.factDigest('ev_high') !== null, true, '重要的一条该留下');
  assert.equal(
    world.factDigest('ev_low'),
    null,
    '预算只留一条时，被裁的应是重要度低的那条，而不是最后写入的那条',
  );

  const pruned = events.filter((event) => event.kind === 'memory.pruned');
  assert.equal(pruned.length, 1, '淘汰必须留一条可查痕迹');
  const payload = pruned[0]!.payload as Record<string, unknown>;
  assert.equal(payload.layer, 'facts');
  assert.equal(payload.evicted, 1);
  assert.equal(payload.byCount, 1);
  assert.equal(payload.byBytes, 0);
  assert.equal(payload.reason, 'count');
  assert.equal(payload.remaining, 1);
});

test('事实超字节预算：按字节裁，原因记 bytes 而不是 count', () => {
  // 一条事实约 350 B；给 300 B 只装得下一条，条数给宽了也照样裁。
  const { world, events } = withFactsBudget(10, 300);
  ingest(world, 'ev_a', 0.9, DAY_MS / 2);
  ingest(world, 'ev_b', 0.8, DAY_MS / 2 + 60_000);
  ingest(world, 'ev_c', 0.7, DAY_MS / 2 + 120_000);
  world.dayClosed(0, DAY_MS - 1);

  const pruned = events.filter((event) => event.kind === 'memory.pruned');
  assert.equal(pruned.length, 1);
  const payload = pruned[0]!.payload as Record<string, unknown>;
  assert.equal(payload.layer, 'facts');
  assert.equal(payload.byCount, 0, '条数没超，不该记成 count');
  assert.ok(payload.byBytes as number > 0, '字节超了必须有 byBytes');
  assert.equal(payload.reason, 'bytes');
});

test('事实被裁掉后，当天的时间线把那一格标成「时刻不明」', () => {
  const { runtime, world } = withFactsBudget(1);
  // 两条都留在 `day` 层（显著度低于 T_promote），测的是「事实没了」那一半，
  // 别把「摘要的 when 是日号」那一条混进来。
  ingest(world, 'ev_low', 0.1, DAY_MS / 2);
  ingest(world, 'ev_high', 0.5, DAY_MS / 2 + 60_000);
  world.dayClosed(0, DAY_MS - 1);

  const timeline = runtime.dayTimelineFor('v0', 0);
  const low = timeline.find((entry) => entry.eventId === 'ev_low');
  assert.ok(low !== undefined, '条目本身还在（记忆不因事实被裁而消失）');
  assert.equal(low.whenKnown, false, '事实没了，时刻就不能再给一个看起来像真的值');
  assert.equal(low.what, null, '说法也不能编');
  assert.equal(low.placeId, null, '地点也不能编');

  const high = timeline.find((entry) => entry.eventId === 'ev_high');
  assert.equal(high?.whenKnown, true, '事实还在的那一格照常给时刻');
});
