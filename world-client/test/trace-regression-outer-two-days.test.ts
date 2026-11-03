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
  assert.equal(check.fingerprint, '1a80ab7140c05134d2153279d7f940734c57f866e7f0800a557d2487d60daaa4');
  assert.equal(check.eventCount, 50);
  assert.equal(check.eventDigest, '5109ce62631576caaff84b10b43bd41912d5bd3ce47a69834e9f48dc9a190c0d');
  assert.equal(check.business.buildings, 2);
  assert.equal(check.business.day, 3);
  assert.equal(check.business.weather, 'clear');

  // 3. 记忆层：完整快照指纹 + 关账天数 + 条目/事实/断言/信念计数。
  assert.equal(check.compatibility.outerSupported, true);
  const memory = check.memory;
  assert.ok(memory !== null);
  assert.equal(memory.deterministic, true);
  assert.equal(memory.fingerprint, '27fc0a492bc8c6149b9c234dee329c43895c9dc6ed088c24690614fe1830262c');
  assert.equal(memory.business.lastClosedDay, 3);
  assert.equal(memory.business.entries, 50);
  assert.equal(memory.business.facts, 63);
  assert.equal(memory.business.claims, 55);
  assert.equal(memory.business.beliefs, 11);
  assert.equal(memory.business.bonds, 1);
  assert.equal(memory.business.moods, 2);
  assert.equal(memory.business.bondTrustSum, -0.24);
  assert.equal(memory.business.moodValenceSum, 0.211839);

  // 4. 造物账：日终关账、提议、落地读数与角色门禁计数。
  const creator = check.creator;
  assert.ok(creator !== null);
  assert.equal(creator.deterministic, true);
  assert.equal(creator.fingerprint, 'ccd95832d1bbdc09772a650d6fdc6d0d989933e06cb8f6090041ee588f88786e');
  assert.equal(creator.business.dayCloses.length, 2);
  assert.equal(creator.business.proposals.length, 3);
  assert.equal(creator.business.landings.length, 1);
});
