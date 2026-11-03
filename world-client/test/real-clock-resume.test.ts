import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS as MEMORY_DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { RealClock, localDayIndex } from '../src/world/real-clock.ts';
import {
  formatClockCatchUp,
  readClockBaseline,
  realClockBaselineKey,
  writeClockBaseline,
  type BaselineStorage,
} from '../src/world/real-clock-baseline.ts';

const DAY = 86_400_000;
const OFFSET = 480;
/** 本地 2026-11-02 00:00 的绝对时刻。 */
const MIDNIGHT = Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET * 60_000;

function fakeStorage(): BaselineStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('跨会话 1 天：prime 旧墙钟后观察当前墙钟，复用逐日分支', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.prime(MIDNIGHT, 1000);
  const tick = clock.observe(MIDNIGHT + DAY, 1000);
  assert.equal(tick.dayGap, 1);
  assert.deepEqual(tick.settlementDays, [localDayIndex(MIDNIGHT, OFFSET) + 1]);
  assert.equal(tick.skippedDays, 0);
});

test('跨会话 10 天：合并为一次，skippedDays=9', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.prime(MIDNIGHT, 1000);
  const tick = clock.observe(MIDNIGHT + 10 * DAY, 1000);
  assert.equal(tick.dayGap, 10);
  assert.equal(tick.settlementDays.length, 1);
  assert.equal(tick.skippedDays, 9);
});

test('跨会话 0 天：不产生补算', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.prime(MIDNIGHT, 1000);
  const tick = clock.observe(MIDNIGHT + 3_600_000, 1000);
  assert.equal(tick.dayGap, 0);
  assert.deepEqual(tick.settlementDays, []);
  assert.equal(tick.skippedDays, 0);
});

test('系统时钟回拨：暂停且不推进', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.prime(MIDNIGHT, 1000);
  const tick = clock.observe(MIDNIGHT - 10 * 60_000, 1000);
  assert.equal(tick.paused, true);
  assert.equal(tick.deltaMs, 0);
  assert.equal(tick.dayGap, 0);
});

test('老档没有基线：读不到，按从现在起计时，不补历史', () => {
  const storage = fakeStorage();
  assert.equal(readClockBaseline(storage, 'world'), null);
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.start(MIDNIGHT, 1000);
  const tick = clock.observe(MIDNIGHT + 60_000, 2000);
  assert.equal(tick.dayGap, 0);
  assert.deepEqual(tick.settlementDays, []);
});

test('基线读写：坏值一律当没有', () => {
  const storage = fakeStorage();
  assert.equal(
    writeClockBaseline(storage, 'world', { lastWallMs: MIDNIGHT, lastWorldNow: 840_300 }),
    true,
  );
  assert.deepEqual(readClockBaseline(storage, 'world'), {
    lastWallMs: MIDNIGHT,
    lastWorldNow: 840_300,
  });
  assert.equal(readClockBaseline(storage, 'dengchao'), null, '世界之间不串基线');
  storage.setItem(realClockBaselineKey('world'), '{"lastWallMs":-1,"lastWorldNow":5}');
  assert.equal(readClockBaseline(storage, 'world'), null);
  storage.setItem(realClockBaselineKey('world'), 'not json');
  assert.equal(readClockBaseline(storage, 'world'), null);
});

test('补算后 closedThroughDay 与世界日对齐：1 天 → 0，10 天 → 9', () => {
  const worldNow = 840_300;
  const oneDay = new MemoryRuntime({ worldId: 'resume-1' });
  oneDay.tickCapped(worldNow + MEMORY_DAY_MS, 7);
  assert.equal(oneDay.closedThroughDay, 0, '世界第 1 天，已关到第 0 天');

  const tenDays = new MemoryRuntime({ worldId: 'resume-10' });
  const result = tenDays.tickCapped(worldNow + 10 * MEMORY_DAY_MS, 7);
  assert.equal(result.closed.length, 1, '>7 天只关一次');
  assert.equal(result.skippedDays, 9);
  assert.equal(tenDays.closedThroughDay, 9, '世界第 10 天，已关到第 9 天');
});

test('补算文案能区分逐日与合并', () => {
  assert.equal(
    formatClockCatchUp({ kind: 'day-by-day', days: 3, skippedDays: 0 }),
    '真实时钟：离线逐日补算 3 天',
  );
  assert.equal(
    formatClockCatchUp({ kind: 'merged', days: 10, skippedDays: 9 }),
    '真实时钟：离线合并结算，跳过 9 天',
  );
});
