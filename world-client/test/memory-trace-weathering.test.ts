import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { exposedTraces, makeTrace, weatherTrace } from '../src/world/memory/traces.ts';
import type { MemoryEvent, Trace, TraceLayer } from '../src/world/memory/types.ts';

/**
 * 痕迹风化。
 *
 * 协议第 11 节把 `visibility_decay` 写进 Trace 的字段表，并明说「风化只降低
 * 可见度，不删除记录」。三处注释（`traces.ts` 的 `makeTrace`、`types.ts` 的
 * `Trace.visibility`、`salience.ts` 的 `decayStrength`）都据此写着「风化是
 * 日终整理的事」。
 *
 * 而它从来没有发生过：`visibility` 只在落痕时被写成 `1`，之后只被读来排序与
 * 过滤，没有任何一处把它降下来。于是 `exposedTraces` 的排序里那一项是个常数，
 * 「一道快被雨冲平的焦痕不该压过昨天刚补的补丁」这句话在代码里是假的——
 * 所有痕迹永远一样新。
 *
 * 这一组测的是**风化真的发生**，以及它守的那条红线：只降可见度，不删记录。
 */

const ALL_LAYERS: readonly TraceLayer[] = [
  'scorch',
  'damage',
  'patch',
  'garland',
  'worn_path',
  'inscription',
];

function world(events: MemoryEvent[] = []): MemoryWorld {
  return new MemoryWorld({ emit: (event) => events.push(event) });
}

/** 在 `day` 那天让 `foundry` 出一场事故（落一道痕迹）。 */
function accident(w: MemoryWorld, eventId: string, day: number): void {
  w.ingest({
    eventId,
    at: day * DAY_MS + 1000,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
}

function tracesOf(w: MemoryWorld): readonly Trace[] {
  return w.viewOf('foundry')?.traces ?? [];
}

function trace(id: string, layerType: TraceLayer, day: number): Trace {
  return makeTrace(
    id,
    { eventId: `ev_${id}`, kind: 'celebration', placeId: 'p', placeType: 'altar', intensity: 0.8, day, recurrence: 0 },
    { layerType, intensity: 0.8, mergeKey: layerType },
  );
}

test('日终会风化：昨天的痕迹今天没那么清楚了', () => {
  const w = world();
  w.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  accident(w, 'ev_1', 0);
  const fresh = tracesOf(w)[0]!;
  assert.equal(fresh.visibility, 1, '刚落下的痕迹该是全可见的');

  w.dayClosed(1, 2 * DAY_MS);
  const weathered = tracesOf(w)[0]!;
  assert.ok(
    weathered.visibility < fresh.visibility,
    `日终该把可见度降下来，实际 ${weathered.visibility} 还是 ${fresh.visibility}`,
  );
});

test('当天落的痕迹不风化——中午炸的炉子，第二天早上还是完整的焦痕', () => {
  const w = world();
  w.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  accident(w, 'ev_1', 0);

  w.dayClosed(0, DAY_MS);
  assert.equal(tracesOf(w)[0]!.visibility, 1, '落痕当天的日终不该动它');
});

test('风化只降可见度，不删记录：归零之后 eventRef 还在', () => {
  const w = world();
  w.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  // 庆典留花环，0.30/天——四天就见底了。
  w.ingest({
    eventId: 'ev_fete',
    at: 1000,
    kind: 'celebration',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'altar' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
  for (let day = 1; day <= 5; day += 1) w.dayClosed(day, (day + 1) * DAY_MS);

  const all = tracesOf(w);
  assert.equal(all.length, 1, '痕迹记录本身不许被删——地点 Holder 的定义就是不遗忘');
  assert.equal(all[0]!.visibility, 0, '花环该彻底看不见了');
  assert.equal(all[0]!.eventRef, 'ev_fete', '看不见不等于没有来历');
});

test('风化完的痕迹不再被暴露，但没风化的照旧', () => {
  const faded: Trace = { ...trace('t1', 'garland', 0), visibility: 0 };
  const visible: Trace = { ...trace('t2', 'scorch', 0), visibility: 0.5 };
  const exposed = exposedTraces([faded, visible], 3);
  assert.deepEqual(
    exposed.map((item) => item.traceId),
    ['t2'],
  );
});

test('不同层风化速度不同：碑文比花环活得久', () => {
  const w = world();
  w.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  // 同一天：一场庆典（花环）+ 一块里程碑（碑文）。
  w.ingest({
    eventId: 'ev_fete',
    at: 1000,
    kind: 'celebration',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'altar' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
  w.ingest({
    eventId: 'ev_stone',
    at: 1100,
    kind: 'milestone',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'altar' },
    actors: ['a'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 1,
    parentEventId: null,
    witnesses: ['a'],
  });
  for (let day = 1; day <= 3; day += 1) w.dayClosed(day, (day + 1) * DAY_MS);

  const byLayer = new Map(tracesOf(w).map((item) => [item.layerType, item.visibility]));
  const garland = byLayer.get('garland');
  const inscription = byLayer.get('inscription');
  assert.ok(garland !== undefined && inscription !== undefined, '两种痕迹都该在');
  assert.ok(
    inscription > garland,
    `碑文该比花环撑得久，实际碑文 ${inscription} 花环 ${garland}`,
  );
});

test('每一层都有风化速率——加一种痕迹忘了给速率，可见度会变成 NaN', () => {
  for (const layerType of ALL_LAYERS) {
    const weathered = weatherTrace(trace(`t_${layerType}`, layerType, 0));
    assert.ok(
      Number.isFinite(weathered.visibility),
      `${layerType} 没有风化速率，可见度成了 ${weathered.visibility}`,
    );
    assert.ok(weathered.visibility < 1, `${layerType} 该风化，实际没动`);
    assert.ok(weathered.visibility >= 0, `${layerType} 风化过头了：${weathered.visibility}`);
  }
});

test('已经看不见的痕迹不再往下减——别减成负数', () => {
  const gone: Trace = { ...trace('t1', 'garland', 0), visibility: 0 };
  assert.equal(weatherTrace(gone).visibility, 0);
  assert.equal(weatherTrace(gone), gone, '归零的该原样返回，不必造新对象');
});

test('风化是确定的：同一个存档跑两遍，可见度一模一样', () => {
  const run = (): readonly number[] => {
    const w = world();
    w.addHolder({ holderId: 'foundry', type: 'place', profile: {}, at: { x: 0, y: 0 } });
    w.addHolder({ holderId: 'a', type: 'character', profile: {}, at: { x: 0, y: 0 } });
    accident(w, 'ev_1', 0);
    for (let day = 1; day <= 4; day += 1) w.dayClosed(day, (day + 1) * DAY_MS);
    return tracesOf(w).map((item) => item.visibility);
  };
  assert.deepEqual(run(), run(), '风化不许读随机数，也不许读墙钟');
});
