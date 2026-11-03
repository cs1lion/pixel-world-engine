import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRE_COVER_MS,
  WEATHER_HABIT_MIN_STRENGTH,
  WEATHER_WITNESS_CELLS,
  habitApplies,
  nearestStall,
  weatherWitnessGroups,
  withinWeatherWitnessRange,
} from '../src/world/weather-witness.ts';

/**
 * 天气进记忆的门槛是「目击/在场」，不是广播。
 *
 * 灯街是一条长街（六张摊从 x15 铺到 x47），所以按**最近的摊子**分 6 格一组，
 * 而不是全镇一个圆心；否则东头摊主离街心 18 格，永远进不了账。
 */

test('按最近的摊子分 6 格：街上的人入账，镇外的人不入', () => {
  const stalls = [{ x: 17, y: 26 }, { x: 47, y: 31 }];
  const people = [
    { id: 'a', cell: { x: 21, y: 28 }, visible: true }, // 距西摊 4.47
    { id: 'b', cell: { x: 23, y: 29 }, visible: true }, // 距西摊 6.71 → 不在灯街
    { id: 'c', cell: { x: 49, y: 32 }, visible: true }, // 距东摊 2.24
    { id: 'd', cell: { x: 19, y: 27 }, visible: true }, // 距西摊 2.24
    { id: 'e', cell: { x: 24, y: 30 }, visible: true }, // 距西摊 8.06 → 不在灯街
    { id: 'f', cell: { x: 18, y: 26 }, visible: false }, // 已进屋
  ];
  const groups = weatherWitnessGroups(people, stalls);
  assert.deepEqual(
    groups.map((group) => [group.at, group.witnesses]),
    [
      [{ x: 17, y: 26 }, ['a', 'd']],
      [{ x: 47, y: 31 }, ['c']],
    ],
  );
});

test('同一个人只入一次账；没有摊子的图不写个人记忆', () => {
  const stalls = [{ x: 30, y: 30 }];
  const people = [
    { id: 'a', cell: { x: 30, y: 30 }, visible: true },
    { id: 'b', cell: { x: 31, y: 30 }, visible: true },
  ];
  const groups = weatherWitnessGroups(people, stalls);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.witnesses, ['a', 'b']);
  assert.deepEqual(weatherWitnessGroups(people, []), []);
});

test('6 格是含边界的；超出 1 格就不算', () => {
  const at = { x: 10, y: 10 };
  assert.equal(withinWeatherWitnessRange({ x: 10 + WEATHER_WITNESS_CELLS, y: 10 }, at), true);
  assert.equal(withinWeatherWitnessRange({ x: 10 + WEATHER_WITNESS_CELLS + 1, y: 10 }, at), false);
});

test('最近的摊子超过 6 格就返回 null——他不在灯街上', () => {
  const stalls = [{ x: 10, y: 10 }];
  assert.deepEqual(nearestStall({ x: 13, y: 14 }, stalls), { x: 10, y: 10 });
  assert.equal(nearestStall({ x: 20, y: 20 }, stalls), null);
});

test('门槛只认记忆层当前的强度：次日 0.85 过线，第 2 天 0.72 掉出去', () => {
  assert.equal(habitApplies({ villagerId: 'a', strength: 0.85, day: 0 }), true);
  assert.equal(habitApplies({ villagerId: 'a', strength: 0.7225, day: 0 }), false);
  assert.equal(habitApplies({ villagerId: 'a', strength: 1, day: 0 }), true);
  assert.equal(WEATHER_HABIT_MIN_STRENGTH, 0.75);
});

test('13:00 是提前收摊那一拍', () => {
  assert.equal(PRE_COVER_MS, 13 * 60 * 60 * 1000);
});
