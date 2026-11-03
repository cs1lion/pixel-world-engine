/**
 * 由 `scripts/trace-to-test.ts` 生成，不要手改。
 *
 * 轨迹：../traces/outer-two-days.json
 * 格式：pwe-trace/2 / v2
 * 世界：default / seed=default
 * 时钟：90000000 + 3000 × 60000
 *
 * 重跑这条用例：
 *   node --test test/trace-regression-outer-two-days.test.ts
 * 重新生成：
 *   node scripts/trace-to-test.ts traces/outer-two-days.json
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTrace } from '../src/trace/replay.ts';

const trace = JSON.parse(
  readFileSync(new URL('../traces/outer-two-days.json', import.meta.url), 'utf8'),
) as Parameters<typeof verifyTrace>[0];

test('轨迹回归：outer-two-days', async () => {
  const check = await verifyTrace(trace);

  // 1. 同一轨迹跑两次：世界指纹必须先逐字相同。
  assert.equal(check.deterministic, true, '两次回放不一致：不可重放');
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true, '输入摘要与 recorded 不一致');

  // 2. 世界指纹 + 事件条数/摘要 + 世界业务读数。
  assert.equal(check.status, 'replayable');
  assert.equal(check.fingerprint, 'e962f0dc42acc3d4248ce2cd1551970c3fb11650d9d9e84531747910ebbb13ed');
  assert.equal(check.eventCount, 52);
  assert.equal(check.eventDigest, '8df20f9098c976773deb75ba8ad2658f78f52b465434be5a14e5f772722254b7');
  assert.equal(check.business.buildings, 2);
  assert.equal(check.business.day, 3);
  assert.equal(check.business.weather, 'clear');

  // 3. 记忆层：完整快照指纹 + 关账天数 + 条目/事实/断言/信念计数。
  assert.equal(check.compatibility.outerSupported, true);
  const memory = check.memory;
  assert.ok(memory !== null);
  assert.equal(memory.deterministic, true);
  assert.equal(memory.fingerprint, '4934fd4b5d2f52a12fc0a266ea8b13ce9a5f0eaab27b81d46f9cbbe395baaa50');
  assert.equal(memory.business.lastClosedDay, 3);
  assert.equal(memory.business.entries, 39);
  assert.equal(memory.business.facts, 52);
  assert.equal(memory.business.claims, 34);
  assert.equal(memory.business.beliefs, 8);
  assert.equal(memory.business.bonds, 1);
  assert.equal(memory.business.moods, 2);
  assert.equal(memory.business.bondTrustSum, -0.24);
  assert.equal(memory.business.moodValenceSum, 0.415208);

  // 4. 造物账：日终关账、提议、落地读数与角色门禁计数。
  const creator = check.creator;
  assert.ok(creator !== null);
  assert.equal(creator.deterministic, true);
  assert.equal(creator.fingerprint, 'ee5e4ed2f6f2fb2a93d8791d70370e8f218167cc9c61618f32bd2056d4400d56');
  assert.equal(creator.business.dayCloses.length, 2);
  assert.equal(creator.business.proposals.length, 3);
  assert.equal(creator.business.landings.length, 1);
});
