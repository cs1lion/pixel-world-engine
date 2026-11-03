import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOCK_BACKWARD_LIMIT_MS,
  DEFAULT_FAST_TIME_SCALE,
  DEFAULT_UTC_OFFSET_MINUTES,
  MAX_TIME_SCALE,
  OFFLINE_SETTLE_MAX_DAYS,
  REAL_DAY_MS,
  RealClock,
  localDayIndex,
  msSinceLocalMidnight,
  resolveClockSelection,
} from '../src/world/real-clock.ts';

const OFFSET = 480; // 默认 UTC+8
/** 本地 2026-11-02 00:00:00 对应的绝对时刻。 */
const LOCAL_MIDNIGHT = Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET * 60_000;

test('一天内只在本地 00:00 跨一次日界', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.start(LOCAL_MIDNIGHT, 1000);
  const day = localDayIndex(LOCAL_MIDNIGHT, OFFSET);

  // 23:59:59.999 还在同一天，没有结算。
  const before = clock.observe(LOCAL_MIDNIGHT + REAL_DAY_MS - 1, 1000 + REAL_DAY_MS - 1);
  assert.equal(before.dayGap, 0);
  assert.deepEqual(before.settlementDays, []);
  assert.equal(before.deltaMs, REAL_DAY_MS - 1);

  // 跨到 00:00:00.000 那一刻，恰好一次。
  const atMidnight = clock.observe(LOCAL_MIDNIGHT + REAL_DAY_MS, 1000 + REAL_DAY_MS);
  assert.equal(atMidnight.dayGap, 1);
  assert.deepEqual(atMidnight.settlementDays, [day + 1]);

  // 新的一天里再走几小时，不会再结算同一天。
  const later = clock.observe(LOCAL_MIDNIGHT + REAL_DAY_MS + 6 * 3_600_000, 1000 + REAL_DAY_MS + 6 * 3_600_000);
  assert.equal(later.dayGap, 0);
  assert.deepEqual(later.settlementDays, []);
});

test('离线 3 天逐日结算三次，不合并', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.start(LOCAL_MIDNIGHT + 12 * 3_600_000, 1000);
  const day = localDayIndex(LOCAL_MIDNIGHT, OFFSET);
  const tick = clock.observe(
    LOCAL_MIDNIGHT + 3 * REAL_DAY_MS + 12 * 3_600_000,
    1000 + 3 * REAL_DAY_MS,
  );
  assert.equal(tick.dayGap, 3);
  assert.deepEqual(tick.settlementDays, [day + 1, day + 2, day + 3]);
  assert.equal(tick.skippedDays, 0);
});

test('离线 10 天合并为一次，并记录跳过的 9 天', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.start(LOCAL_MIDNIGHT, 1000);
  const day = localDayIndex(LOCAL_MIDNIGHT, OFFSET);
  const tick = clock.observe(LOCAL_MIDNIGHT + 10 * REAL_DAY_MS, 1000 + 10 * REAL_DAY_MS);
  assert.equal(tick.dayGap, 10);
  assert.deepEqual(tick.settlementDays, [day + 10]);
  assert.equal(tick.skippedDays, 9);
  assert.equal(OFFLINE_SETTLE_MAX_DAYS, 7);
});

test('墙钟回拨 10 分钟：暂停且不推进，也不跳变', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.start(LOCAL_MIDNIGHT, 1000);
  const tick = clock.observe(LOCAL_MIDNIGHT - 10 * 60_000, 1000 + 10 * 60_000);
  assert.equal(tick.paused, true);
  assert.equal(tick.pauseReason, 'wall-clock-backward');
  assert.equal(tick.deltaMs, 0);
  assert.equal(tick.dayGap, 0);
  assert.equal(clock.isPaused, true);

  // 暂停期间再观察也不推进；重启（resume）才恢复。
  const again = clock.observe(LOCAL_MIDNIGHT + 60_000, 1000 + 120_000);
  assert.equal(again.paused, true);
  assert.equal(again.deltaMs, 0);

  clock.resume(LOCAL_MIDNIGHT + 60_000, 1000 + 120_000);
  const resumed = clock.observe(LOCAL_MIDNIGHT + 60_000 + 5_000, 1000 + 125_000);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.deltaMs, 5_000);
});

test('5 分钟以内的回拨按抖动处理：不暂停，也不推进负时间', () => {
  const clock = new RealClock({ utcOffsetMinutes: OFFSET });
  clock.start(LOCAL_MIDNIGHT, 1000);
  const tick = clock.observe(LOCAL_MIDNIGHT - 2 * 60_000, 1000 + 2 * 60_000);
  assert.equal(tick.paused, false);
  assert.equal(tick.deltaMs, 0);
  assert.equal(CLOCK_BACKWARD_LIMIT_MS, 5 * 60_000);
});

test('锚点可配：同一个绝对时刻在不同时区落在不同的本地日', () => {
  const utcDay = localDayIndex(LOCAL_MIDNIGHT, 0);
  const eastDay = localDayIndex(LOCAL_MIDNIGHT, OFFSET);
  assert.equal(eastDay, utcDay + 1);
  assert.equal(msSinceLocalMidnight(LOCAL_MIDNIGHT, OFFSET), 0);
  assert.equal(msSinceLocalMidnight(LOCAL_MIDNIGHT + 12 * 3_600_000, OFFSET), 12 * 3_600_000);
});

test('时钟入口默认即真实时钟：不写参数就是 1:1', () => {
  const selection = resolveClockSelection('');
  assert.equal(selection.mode, 'real');
  assert.equal(selection.timeScale, 1, '真实时钟不带任何倍率');
  assert.equal(selection.utcOffsetMinutes, DEFAULT_UTC_OFFSET_MINUTES);
});

test('加速必须显式：?clock=fast / accelerated / 只给 ?speed=', () => {
  assert.equal(resolveClockSelection('?clock=fast').mode, 'accelerated');
  assert.equal(resolveClockSelection('?clock=fast').timeScale, DEFAULT_FAST_TIME_SCALE);
  assert.equal(resolveClockSelection('?clock=accelerated&speed=12').timeScale, 12);
  const bySpeed = resolveClockSelection('?speed=1');
  assert.equal(bySpeed.mode, 'accelerated');
  assert.equal(bySpeed.timeScale, 1);
});

test('?clock=real 压过 ?speed=：真实时钟不能被偷偷加速', () => {
  const selection = resolveClockSelection('?clock=real&speed=12');
  assert.equal(selection.mode, 'real');
  assert.equal(selection.timeScale, 1);
});

test('非法 ?speed= 单独出现不切模式；显式 clock=fast 时回落默认倍率', () => {
  for (const text of ['?speed=0', '?speed=61', '?speed=abc']) {
    assert.equal(resolveClockSelection(text).mode, 'real', `${text} 不算加速意图`);
  }
  const byFast = resolveClockSelection('?clock=fast&speed=61');
  assert.equal(byFast.mode, 'accelerated');
  assert.equal(byFast.timeScale, DEFAULT_FAST_TIME_SCALE, '非法倍率回落到加速模式默认值');
  assert.equal(MAX_TIME_SCALE, 60);
});

test('时区参数只影响日界；非法值回默认 UTC+8', () => {
  assert.equal(resolveClockSelection('?utcOffsetMinutes=0').utcOffsetMinutes, 0);
  assert.equal(resolveClockSelection('?utcOffsetMinutes=840').utcOffsetMinutes, 840);
  assert.equal(resolveClockSelection('?utcOffsetMinutes=841').utcOffsetMinutes, DEFAULT_UTC_OFFSET_MINUTES);
  assert.equal(resolveClockSelection('?utcOffsetMinutes=abc').utcOffsetMinutes, DEFAULT_UTC_OFFSET_MINUTES);
});
