import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { periodLength, tideLevelAt } from '../src/world/tide.ts';

/**
 * 旧实现（从 0 开始逐周期减）作为基准，逐点比对返回值。
 *
 * 浸泡测试在 `feat/soak-30d` 上发现 `tideLevelAt` 的耗时随世界时间线性增长
 * （第 30 天 p50 17.9µs，第 1 天 0.3µs），根因是每次都从周期 0 扫起。
 * 修法是 64 周期一个检查点 + 二分。**值必须一模一样**——潮位是可确定性
 * 回放契约的一部分，换实现不能换曲线。
 */
function referenceTideLevelAt(now: number): number {
  if (!Number.isFinite(now) || now <= 0) return 0;
  let remaining = now;
  let index = 0;
  while (index < 100_000) {
    const length = periodLength(index);
    if (remaining < length) {
      const progress = remaining / length;
      return (1 - Math.cos(progress * Math.PI * 2)) / 2;
    }
    remaining -= length;
    index += 1;
  }
  return 0;
}

const DAY = 86_400_000;

test('tideLevelAt 与旧实现逐点相同（30 日内的采样点）', () => {
  const points: number[] = [];
  for (let day = 0; day <= 31; day += 1) {
    points.push(day * DAY);
    points.push(day * DAY + 1);
    points.push(day * DAY + 3_600_000);
    points.push(day * DAY + 23 * 3_600_000);
    points.push(day * DAY + DAY - 1);
  }
  // 一个周期内部的 20 个等分点，专门压检查点边界附近的分支。
  for (let index = 0; index < 20; index += 1) {
    points.push(Math.round((index / 20) * DAY));
  }
  for (const now of points) {
    const expected = referenceTideLevelAt(now);
    const actual = tideLevelAt(now);
    assert.equal(actual, expected, `now=${now} 期望 ${expected}，实际 ${actual}`);
  }
});

test('tideLevelAt 不受查询顺序影响（先远后近仍然一致）', () => {
  const early = 2 * DAY + 12_345;
  const late = 30 * DAY + 54_321;
  const firstLate = tideLevelAt(late);
  const thenEarly = tideLevelAt(early);
  assert.equal(thenEarly, referenceTideLevelAt(early));
  assert.equal(firstLate, referenceTideLevelAt(late));
});
