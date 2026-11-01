/**
 * 叙事装饰那张单子：画什么、画几道、按什么顺序。
 *
 * 补充设计 §10：「表现层只消费 ExpressionHint，不直接读记忆库」。这条测试守的是
 * **两个读法必须是同一道闸**——`lookAtTraces` 走 `exposedTraces`，
 * `placeHints` 也必须走它。分叉的后果很具体：地上看得见一道焦痕，路过的人却
 * 推断不出任何东西；或者反过来，推断出来了、画面上什么都没有。
 *
 * 这一层是纯函数 + 一次转发，所以三条断言都在数据上，不碰画面。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placeHints } from '../src/world/memory/hints.ts';
import { exposedTraces } from '../src/world/memory/traces.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { Trace, TraceLayer } from '../src/world/memory/types.ts';

function trace(
  traceId: string,
  layerType: TraceLayer,
  intensity: number,
  visibility: number,
  placeId = 'p1',
): Trace {
  return { traceId, placeId, eventRef: `ev_${traceId}`, layerType, intensity, createdDay: 0, visibility };
}

const TRACES: readonly Trace[] = [
  trace('t1', 'scorch', 0.9, 0.8), // 0.72
  trace('t2', 'patch', 0.5, 0.6), // 0.30
  trace('t3', 'garland', 0.8, 0.9), // 0.72（与 t1 同分，按 id 排）
  trace('t4', 'worn_path', 0.2, 1.0), // 0.20
  trace('t5', 'inscription', 0.7, 0.0), // 风化到 0：不再露出来
];

test('与 exposedTraces 同一道闸、同一个顺序', () => {
  const hints = placeHints(TRACES, 5);
  const exposed = exposedTraces(TRACES, 5);
  assert.deepEqual(
    hints.map((hint) => hint.traceId),
    exposed.map((item) => item.traceId),
    '两边读的是同一张单子：顺序不同，就是「看得见的」与「画出来的」不是同一批',
  );
  // 同分按 id：t1 在 t3 前。
  assert.deepEqual(hints.map((hint) => hint.traceId).slice(0, 2), ['t1', 't3']);
});

test('风化到 0 的痕迹不出 hint——它在库里，但不在画面上', () => {
  const hints = placeHints(TRACES, 5);
  assert.ok(
    hints.every((hint) => hint.traceId !== 't5'),
    '`visibility = 0` 的痕迹该被闸挡住，与 `exposedTraces` 一致',
  );
  // 但它还在原数组里：风化只降可见度，不删记录（协议 §11）。
  assert.ok(TRACES.some((item) => item.traceId === 't5'));
});

test('上限由调用方给：传 2 就只出 2 道', () => {
  assert.equal(placeHints(TRACES, 2).length, 2);
  assert.equal(placeHints(TRACES, 0).length, 0);
});

test('hint 把痕迹的原值带出去，浓淡与可见度都在', () => {
  const [first] = placeHints([trace('only', 'scorch', 0.42, 0.37)], 3);
  assert.deepEqual(first, {
    type: 'decal',
    placeId: 'p1',
    traceId: 'only',
    layer: 'scorch',
    intensity: 0.42,
    visibility: 0.37,
  });
});

test('运行时转发用配置里那道闸，不是写死的数', () => {
  const runtime = new MemoryRuntime({
    worldId: 'trace-hints',
    occlusion: { isWalkable: () => true },
  });
  runtime.world.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  runtime.world.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  runtime.world.ingest({
    eventId: 'ev_1',
    at: 1000,
    kind: 'workshop_accident',
    place: { placeId: 'p1', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: ['a'],
    outcome: { what: '炉子炸了' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses: ['a'],
  });

  const hints = runtime.placeHints('p1');
  assert.ok(hints.length > 0, '事故该在楼里留下一道痕迹，画面上该有东西');
  assert.ok(hints.length <= runtime.config.traceExposedLayers, '不超过配置里那道闸');
  assert.equal(hints[0]!.placeId, 'p1', '落点就是这栋楼');
  assert.deepEqual(runtime.placeHints('没这栋楼'), [], '查不到的地点给空单子，不抛也不编');
});
