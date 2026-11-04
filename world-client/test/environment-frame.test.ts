/**
 * 环境帧：天气、潮位、时辰、光照合成一份读数。
 *
 * 这一组钉三件事：
 *   1. **组合条件能表达**——「雨 + 涨潮」「雾 + 收工」只是同一帧里两个 flag
 *      同时成立，不必在每个调用处各写一遍条件；
 *   2. **行为读数逐项不变**——步速、收摊、雾里不遠行、潮汐压线、安静段，
 *      与拆帧之前逐项相同（指纹那边的判据在 `trace-replay`，这里钉语义）；
 *   3. **灯态只在给了相位时登记**——世界层没有昼夜读数，不能把「未知」
 *      记成「不亮」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { worldMinutes } from '../src/world/pace.ts';
import { TIDE_HIGH_MIN, TIDE_LOW_MAX } from '../src/world/tide.ts';
import { environmentAt, hasEnvironment, type EnvironmentFrame } from '../src/world/environment.ts';
import {
  FOG_VISIT_CELLS,
  RAIN_WALK_FACTOR,
  fogKeepsClose,
  stallsPackedFor,
  walkSpeedFactor,
} from '../src/world/weather-effects.ts';
import { routineFor, tideBeatApplies, type RoutineBeat } from '../src/world/routines.ts';

const beats: readonly RoutineBeat[] = [
  { id: 'altar', label: '在祭坛边坐着', going: '去祭坛', target: { x: 19, y: 15 }, dwellMs: 6500 },
  { id: 'promenade', label: '在街口站着看了一会儿', going: '去街口', target: { x: 32, y: 27 }, dwellMs: 5800 },
  { id: 'promenade', label: '满潮时收起滩边的灯', going: '去滩边收灯', target: { x: 39, y: 29 }, dwellMs: 4800, tide: 'high' },
  { id: 'promenade', label: '趁退潮拾回还能用的灯芯', going: '去滩边拾灯芯', target: { x: 50, y: 42 }, dwellMs: 6000, tide: 'low' },
];

/** 拆帧前的潮汐判定，逐字抄自旧实现，只用作对照。 */
function oldTideApplies(tide: RoutineBeat['tide'], level: number): boolean {
  if (tide === 'low') return level <= TIDE_LOW_MAX;
  if (tide === 'high') return level >= TIDE_HIGH_MIN;
  return true;
}

test('组合条件：雨 + 涨潮、雾 + 收工都能在同一帧里表达', () => {
  const rainyHigh = environmentAt(worldMinutes(9 * 60), 'rain', 0.9);
  assert.equal(hasEnvironment(rainyHigh, 'rain', 'highTide'), true, '雨与涨潮同时成立');
  assert.equal(hasEnvironment(rainyHigh, 'wet', 'highTide'), true, 'wet 把 rain/storm 合在一起');
  assert.equal(hasEnvironment(rainyHigh, 'rain', 'lowTide'), false, '涨潮时不同时是退潮');

  const foggyAfterWork = environmentAt(worldMinutes(17 * 60), 'fog', 0.5);
  assert.equal(hasEnvironment(foggyAfterWork, 'fog', 'workEnded'), true, '雾与收工同时成立');
  assert.equal(hasEnvironment(foggyAfterWork, 'fog', 'workEnded', 'quiet'), false, '17:00 不在安静段');

  // 收工前一分钟：不再成立。边界与时刻表的 `work_end` 同一口径。
  const justBefore = environmentAt(worldMinutes(17 * 60) - 1, 'fog', 0.5);
  assert.equal(hasEnvironment(justBefore, 'workEnded'), false);
});

test('旧读数逐项不变：四个天气 × 三个行为', () => {
  const here = { x: 20, y: 20 };
  const far = { x: 20 + FOG_VISIT_CELLS + 1, y: 20 };
  for (const weather of ['clear', 'rain', 'storm', 'fog'] as const) {
    const frame = environmentAt(0, weather, 0.5);
    const wasRain = weather === 'rain' || weather === 'storm';
    assert.equal(walkSpeedFactor(frame), wasRain ? RAIN_WALK_FACTOR : 1, `${weather} 步速`);
    assert.equal(stallsPackedFor(frame), wasRain, `${weather} 收摊`);
    assert.equal(fogKeepsClose(frame, here, far), weather !== 'fog', `${weather} 远行`);
  }
});

test('旧读数逐项不变：潮汐压线那一格', () => {
  const levels = [0, 0.2, TIDE_LOW_MAX, TIDE_LOW_MAX + 1e-9, 0.5, TIDE_HIGH_MIN - 1e-9, TIDE_HIGH_MIN, 0.9, 1];
  for (const level of levels) {
    const frame = environmentAt(0, 'clear', level);
    for (const tide of [undefined, 'low', 'high'] as const) {
      assert.equal(
        tideBeatApplies(tide, frame),
        oldTideApplies(tide, level),
        `潮位 ${level} 的 ${tide ?? '无潮汐'} 条件与旧读数不一致`,
      );
    }
  }
});

test('旧读数逐项不变：安静段回锚点，边界左闭右开', () => {
  const quiet = routineFor(environmentAt(worldMinutes(13 * 60), 'clear', 0.5), beats, 2);
  assert.deepEqual(quiet.target, beats[0]!.target, '安静段回锚点');
  assert.equal(quiet.dwellMs, worldMinutes(40));
  // 用不挑潮位的那一拍：14:00 之后安静段结束，落点回到原拍。
  const afterQuiet = routineFor(environmentAt(worldMinutes(14 * 60), 'clear', 0.5), beats, 1);
  assert.deepEqual(afterQuiet.target, beats[1]!.target, '14:00 之后照常去街口');
});

test('时辰：day 与 minuteOfDay 跟 timetable 同一口径', () => {
  const frame = environmentAt(2 * DAY_MS + worldMinutes(6 * 60), 'clear', 0.5);
  assert.equal(frame.day, 2);
  assert.equal(frame.minuteOfDay, 360);
  assert.equal(frame.now, 2 * DAY_MS + worldMinutes(6 * 60));
});

test('灯态只在给了相位时登记：不传 lighting 就不是「不亮」', () => {
  const night: EnvironmentFrame = environmentAt(0, 'clear', 0.5, {
    phase: 'night',
    autoAdvancing: true,
  });
  assert.equal(hasEnvironment(night, 'lampsLit'), true, '午夜且未到收灯时刻：灯亮着');
  assert.equal(hasEnvironment(night, 'lampsOut'), false);

  const noon = environmentAt(worldMinutes(12 * 60), 'clear', 0.5, {
    phase: 'noon',
    autoAdvancing: true,
  });
  assert.equal(hasEnvironment(noon, 'lampsOut'), true, '正午：灯不亮');
  assert.equal(hasEnvironment(noon, 'lampsLit'), false);

  const unknown = environmentAt(0, 'clear', 0.5);
  assert.equal(unknown.flags.has('lampsLit') || unknown.flags.has('lampsOut'), false,
    '没有相位就没有灯态，不能把「未知」记成「不亮」');
});
