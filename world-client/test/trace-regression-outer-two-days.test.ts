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
  assert.equal(check.fingerprint, '95ee830c948bb5b8c0e07964d7b8d6700a2470fc79a2f1adcf179d5ddfb08131');
  assert.equal(check.eventCount, 50);
  assert.equal(check.eventDigest, '5b59c5a747514a1b85cab86a2bfd14be947992125db5694e3a59824818e916a1');
  assert.equal(check.business.buildings, 2);
  assert.equal(check.business.day, 3);
  assert.equal(check.business.weather, 'clear');

  // 3. 记忆层：完整快照指纹 + 关账天数 + 条目/事实/断言/信念计数。
  assert.equal(check.compatibility.outerSupported, true);
  const memory = check.memory;
  assert.ok(memory !== null);
  assert.equal(memory.deterministic, true);
  assert.equal(memory.fingerprint, '77ad2ab030988ad4bcb7a81e3e3b7a5e58700590ed35cc7ae2f8b5cecdd9eec1');
  assert.equal(memory.business.lastClosedDay, 3);
  assert.equal(memory.business.entries, 45);
  assert.equal(memory.business.facts, 47);
  assert.equal(memory.business.claims, 38);
  assert.equal(memory.business.beliefs, 11);
  assert.equal(memory.business.bonds, 1);
  assert.equal(memory.business.moods, 2);
  assert.equal(memory.business.bondTrustSum, -0.24);
  assert.equal(memory.business.moodValenceSum, 0.246757);

  // 4. 造物账：日终关账、提议、落地读数与角色门禁计数。
  const creator = check.creator;
  assert.ok(creator !== null);
  assert.equal(creator.deterministic, true);
  assert.equal(creator.fingerprint, 'c5198f0f902a1a0c2167b54ca7d300c50dba0bd602ac3eda96a05e2a2d325e1d');
  assert.equal(creator.business.dayCloses.length, 2);
  assert.equal(creator.business.proposals.length, 3);
  assert.equal(creator.business.landings.length, 1);
});
