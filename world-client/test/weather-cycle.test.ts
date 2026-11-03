import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WEATHER_SLOT_MS,
  scheduledWeatherState,
  weatherForSlot,
  weatherSequence,
  weatherSlotAt,
  weatherSlotsBetween,
} from '../src/world/weather-cycle.ts';
import { clearWeather } from '../src/world/weather.ts';

/**
 * 天气排天的确定性。
 *
 * 钉的不是「跑两遍一样」这种弱确定（同一台机器上的 `Math.random` 也能做到
 * 两次不一样，但同一颗种子却做不到），而是**换种子换一串、同种子逐项相同**。
 * 晴/雨/雾只看 `(worldSeed, 槽号)`，与帧率、墙钟、上一次抽到什么都不相干。
 */

test('同一种子两次排出来的天气逐项相同', () => {
  const a = weatherSequence('dengchao', 42);
  const b = weatherSequence('dengchao', 42);
  assert.deepEqual(a, b);
  assert.equal(a.length, 42);
});

test('换一颗种子，整串天气不同', () => {
  const a = weatherSequence('seed-a', 24);
  const b = weatherSequence('seed-b', 24);
  assert.notDeepEqual(a, b, '两颗种子排出了同一串天气，说明种子没接进抽签');
});

test('槽只抽晴/雨/雾三档，暴雨不自动排天', () => {
  const seen = new Set<string>();
  for (let slot = 0; slot < 64; slot += 1) seen.add(weatherForSlot('dengchao', slot));
  assert.deepEqual([...seen].sort(), ['clear', 'fog', 'rain']);
});

test('4 世界小时一槽，跨边界才换天', () => {
  const seed = 'dengchao';
  const before = weatherSlotAt(seed, WEATHER_SLOT_MS - 1);
  const after = weatherSlotAt(seed, WEATHER_SLOT_MS);
  assert.equal(before.index, 0);
  assert.equal(after.index, 1);
  assert.equal(before.kind, weatherForSlot(seed, 0));
  assert.equal(after.kind, weatherForSlot(seed, 1));
});

test('一次跨两槽：按时间先后返回两槽，后者覆盖前者', () => {
  const slots = weatherSlotsBetween('dengchao', 0, WEATHER_SLOT_MS * 3 - 1);
  assert.deepEqual(slots.map((slot) => slot.index), [1, 2]);
  assert.equal(slots[1]!.kind, weatherForSlot('dengchao', 2));
});

test('排天的雨写到槽尾，不会半槽自己转晴', () => {
  // 抽一槽雨（若前几槽不是雨，往后找一个）。
  const seed = 'dengchao';
  let index = 0;
  while (weatherForSlot(seed, index) !== 'rain' && index < 200) index += 1;
  const slot = { index, start: index * WEATHER_SLOT_MS, end: (index + 1) * WEATHER_SLOT_MS, kind: 'rain' as const };
  const now = slot.start + WEATHER_SLOT_MS / 2;
  const state = scheduledWeatherState(clearWeather(), slot, now);
  assert.equal(state.kind, 'rain');
  assert.equal(state.remainingMs, WEATHER_SLOT_MS / 2);
});
