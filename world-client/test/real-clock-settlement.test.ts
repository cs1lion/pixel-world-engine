import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { WorldVitals } from '../src/world/memory/types.ts';

test('离线 3 天：记忆层逐日关账三次', () => {
  const vitals: WorldVitals[] = [];
  const memory = new MemoryRuntime({ worldId: 'real-clock-3', onVitals: (item) => vitals.push(item) });
  const result = memory.tickCapped(3 * DAY_MS, 7);
  assert.equal(result.closed.length, 3);
  assert.equal(vitals.length, 3);
  assert.equal(result.skippedDays, 0);
  // 每一天用自己的天界时刻，不是「现在」。
  assert.deepEqual(
    result.closed.map((item) => item.day),
    [0, 1, 2],
  );
});

test('离线 10 天：合并成一次关账，并报告跳过 9 天', () => {
  const vitals: WorldVitals[] = [];
  const memory = new MemoryRuntime({ worldId: 'real-clock-10', onVitals: (item) => vitals.push(item) });
  const result = memory.tickCapped(10 * DAY_MS, 7);
  assert.equal(result.closed.length, 1);
  assert.equal(vitals.length, 1);
  assert.equal(result.skippedDays, 9);
});

test('恰好 7 天仍逐日关账；8 天才合并', () => {
  const seven: WorldVitals[] = [];
  const memoryA = new MemoryRuntime({ worldId: 'real-clock-7', onVitals: (item) => seven.push(item) });
  const resultA = memoryA.tickCapped(7 * DAY_MS, 7);
  assert.equal(resultA.closed.length, 7);
  assert.equal(resultA.skippedDays, 0);

  const eight: WorldVitals[] = [];
  const memoryB = new MemoryRuntime({ worldId: 'real-clock-8', onVitals: (item) => eight.push(item) });
  const resultB = memoryB.tickCapped(8 * DAY_MS, 7);
  assert.equal(resultB.closed.length, 1);
  assert.equal(resultB.skippedDays, 7);
});
