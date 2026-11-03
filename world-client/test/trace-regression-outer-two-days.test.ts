/**
 * 由 `scripts/trace-to-test.ts` 生成，不要手改。
 *
 * 轨迹：../traces/outer-two-days.json
 * 格式：pwe-trace/2 / v2
 * 世界：default / seed=default
 * 时钟：180000000 + 6000 × 30000
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
  assert.equal(check.fingerprint, 'e25d22b5ee944d0c91e5517bd7f07b73af16b7a689477758a526ba46b3b304df');
  assert.equal(check.eventCount, 20);
  assert.equal(check.eventDigest, '8adb051144c1a4f78b8512275f54130e9c5c6518462ea58254231c222158f07d');
  assert.equal(check.business.buildings, 2);
  assert.equal(check.business.day, 4);
  assert.equal(check.business.weather, 'clear');

  // 3. 记忆层：完整快照指纹 + 关账天数 + 条目/事实/断言/信念计数。
  assert.equal(check.compatibility.outerSupported, true);
  const memory = check.memory;
  assert.ok(memory !== null);
  assert.equal(memory.deterministic, true);
  assert.equal(memory.fingerprint, 'cd9c1cb912cd3ce844b2d125a021ef9a919be341778ca24cca2d04bbb927cc46');
  assert.equal(memory.business.lastClosedDay, 4);
  assert.equal(memory.business.entries, 9);
  assert.equal(memory.business.facts, 17);
  assert.equal(memory.business.claims, 2);
  assert.equal(memory.business.beliefs, 5);

  // 4. 造物账：日终关账、提议、落地读数与角色门禁计数。
  const creator = check.creator;
  assert.ok(creator !== null);
  assert.equal(creator.deterministic, true);
  assert.equal(creator.fingerprint, '3060abe318a563126f7b561fde39dca56c4254bf75146083811657ac9476e0e5');
  assert.equal(creator.business.dayCloses.length, 2);
  assert.equal(creator.business.proposals.length, 3);
  assert.equal(creator.business.landings.length, 1);
});
