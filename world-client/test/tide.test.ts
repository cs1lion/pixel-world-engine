import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FLOODED_WALK_COST,
  TERRAIN_HEIGHT,
  TIDE_JITTER_MS,
  TIDE_PERIOD_MS,
  describeTide,
  isFlooded,
  periodLength,
  tideLevelAt,
} from '../src/world/tide.ts';

test('潮位是 now 的纯函数：同一时刻永远同一个值', () => {
  for (const now of [0, 1_000, 60_000, 123_456, 3_600_000]) {
    assert.equal(tideLevelAt(now), tideLevelAt(now));
  }
});

test('潮位落在 0..1，且从 0 起步', () => {
  assert.equal(tideLevelAt(0), 0);
  for (let now = 0; now < TIDE_PERIOD_MS * 3; now += 7_919) {
    const level = tideLevelAt(now);
    assert.ok(level >= 0 && level <= 1, `潮位越界：now=${now} level=${level}`);
  }
});

test('一个周期里涨到满再退回原点', () => {
  const length = periodLength(0);
  const quarter = tideLevelAt(length * 0.5);
  const start = tideLevelAt(0);
  const end = tideLevelAt(length - 1);
  assert.ok(quarter > 0.95, `半周期应当是满潮，实际 ${quarter}`);
  assert.ok(start < 0.01 && end < 0.01, `周期两端应当退到底：${start} / ${end}`);
});

test('周期长度带抖动，但每个序号固定', () => {
  const lengths = Array.from({ length: 40 }, (_, i) => periodLength(i));
  // 抖动的意义是"规律本身有惊喜"：如果 40 个周期长度全一样，抖动就没生效。
  assert.ok(new Set(lengths).size > 1, '周期长度必须真的抖动');
  for (const length of lengths) {
    assert.ok(
      Math.abs(length - TIDE_PERIOD_MS) <= TIDE_JITTER_MS,
      `周期长度越界：${length}`,
    );
  }
  // 同一个序号永远同一个长度：这是可回放的前提。
  assert.equal(periodLength(7), periodLength(7));
});

test('回放可复现：同一串步长得到同一条潮位曲线', () => {
  const steps = Array.from({ length: 400 }, (_, i) => (i % 7) * 250 + 120);
  const run = (): number[] => {
    let now = 0;
    return steps.map((delta) => {
      now += delta;
      return tideLevelAt(now);
    });
  };
  assert.deepEqual(run(), run());
});

test('潮位跨周期连续，不会在周期边界跳变', () => {
  const boundary = periodLength(0);
  const before = tideLevelAt(boundary - 1);
  const after = tideLevelAt(boundary + 1);
  // 两端都接近 0，所以边界处不跳；给 0.05 的余量覆盖 1ms 的差。
  assert.ok(Math.abs(after - before) < 0.05, `周期边界跳变：${before} → ${after}`);
});

test('被淹判定按地形高度算', () => {
  // 退潮时全干。
  for (const terrain of Object.keys(TERRAIN_HEIGHT)) {
    assert.equal(isFlooded(terrain, 0), false, `${terrain} 在退潮时不该被淹`);
  }
  // 满潮时草地与农田进水，石板路与广场露出。
  assert.equal(isFlooded('grass', 1), true);
  assert.equal(isFlooded('farm', 1), true);
  assert.equal(isFlooded('plaza', 1), false);
  assert.equal(isFlooded('stone', 1), false);
});

test('没登记的地形按草地算，不当作永远干燥', () => {
  // 漏配一个地形时宁可湿脚，也不要让整片区域悄悄变干——那是更难查的 bug。
  assert.equal(isFlooded('lava', 1), isFlooded('grass', 1));
});

test('潮汐的说法随水位变化', () => {
  assert.equal(describeTide(0.95, 0.9), '满潮');
  assert.equal(describeTide(0.05, 0.2), '退潮见底');
  assert.equal(describeTide(0.5, 0.4), '涨潮');
  assert.equal(describeTide(0.5, 0.6), '退潮');
});

test('涉水代价明显高于任何地形，但仍有限', () => {
  assert.ok(FLOODED_WALK_COST > 2.5, '涉水要比密林还贵，A* 才会主动绕开');
  assert.ok(Number.isFinite(FLOODED_WALK_COST), '涉水不能是不可通行的无穷大');
});
