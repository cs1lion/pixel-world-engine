/**
 * 由 `scripts/trace-to-test.ts` 生成，不要手改。
 *
 * 轨迹：../traces/night-rain-build.json
 * 格式：pwe-trace/1 / v1
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

test('轨迹回归：night-rain-build', async () => {
  const check = await verifyTrace(trace);

  // 1. 同一轨迹跑两次：世界指纹必须先逐字相同。
  assert.equal(check.deterministic, true, '两次回放不一致：不可重放');
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true, '输入摘要与 recorded 不一致');

  // 2. 世界指纹 + 事件条数/摘要 + 世界业务读数。
  assert.equal(check.status, 'replayable');
  assert.equal(check.fingerprint, '8a41a3c5cbc08193d8378ebfacf2263c82340710a252b2344e6fd4ff6d7a6513');
  assert.equal(check.eventCount, 6);
  assert.equal(check.eventDigest, '50d72a6f58c50b2cccfea3c8cf3bcf31270f18e5b3f66f018274601294369fce');
  assert.equal(check.business.buildings, 1);
  assert.equal(check.business.day, 1);
  assert.equal(check.business.weather, 'rain');

  // 3. 旧格式轨迹：外环未参与校验，只报「不支持」，不崩。
  assert.equal(check.compatibility.outerSupported, false);
  assert.match(check.compatibility.message, /不支持外环字段/);
  assert.equal(check.memory, null);
  assert.equal(check.creator, null);
});
