/**
 * 由 `scripts/trace-to-test.ts` 生成，不要手改。
 *
 * 轨迹：../traces/night-rain-build.json
 * 世界：default / seed=pwe-trace-night-rain-build-0001
 * 时钟：86280000 + 3600 × 120
 *
 * 重跑这条用例：
 *   node --test test/trace-regression-night-rain-build.test.ts
 * 重新生成：
 *   node scripts/trace-to-test.ts traces/night-rain-build.json
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTrace } from '../src/trace/replay.ts';

const trace = JSON.parse(
  readFileSync(new URL('../traces/night-rain-build.json', import.meta.url), 'utf8'),
) as Parameters<typeof verifyTrace>[0];

test('轨迹回归：night-rain-build', () => {
  const check = verifyTrace(trace);

  // 1. 同一轨迹跑两次必须逐字相同。
  assert.equal(check.deterministic, true, '两次回放不一致：不可重放');
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true, '输入摘要与 recorded 不一致');

  // 2. 指纹：终局世界必须还是录制时那一个。
  assert.equal(check.status, 'replayable');
  assert.equal(check.fingerprint, '13b7dce6f9da1dec57bc47b99b3a46a0dedade0ec9b38f4e030996257a99a224');

  // 3. 关键事件数：事件条数与摘要都钉住。
  assert.equal(check.eventCount, 6);
  assert.equal(check.eventDigest, '115dd08dcc46d6524fa305d47c3bcd09ade07c5aea9cfab89212aa61cf379764');

  // 4. 业务读数：至少一项，这里把能一眼看懂的几项都钉住。
  assert.equal(check.business.buildings, 1);
  assert.equal(check.business.day, 1);
  assert.equal(check.business.weather, 'rain');
  assert.equal(check.business.tasksCompleted, 0);
});
