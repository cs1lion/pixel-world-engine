/** 轨迹回放器自己的单测：确定、可篡改检出、格式守卫。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import {
  digestOfInput,
  TraceFormatError,
  validateTrace,
} from '../src/trace/format.ts';
import type { TraceFile, TraceInput } from '../src/trace/format.ts';
import {
  firstDifference,
  recordTrace,
  runTrace,
  verifyTrace,
} from '../src/trace/replay.ts';

function makeTrace(): TraceFile {
  const base: Omit<TraceInput, 'eventRange'> = {
    format: 'pwe-trace/1',
    traceVersion: 1,
    description: '单测用的小轨迹：跨日一次，注入一次下雨。',
    worldId: 'default',
    worldSeed: 'unit-seed',
    initialNow: DAY_MS - 3_000,
    stepMs: 100,
    steps: 600,
    injections: [
      {
        seq: 1,
        atWorldMs: DAY_MS + 5_000,
        kind: 'weather',
        payload: { weather: 'rain' },
      },
    ],
  };
  const probe = runTrace({ ...base, eventRange: { from: 0, to: Number.MAX_SAFE_INTEGER } });
  return recordTrace({ ...base, eventRange: { from: 0, to: probe.events.length } });
}

test('同一轨迹跑两次：指纹逐字相同', () => {
  const trace = makeTrace();
  const check = verifyTrace(trace);
  assert.equal(check.status, 'replayable');
  assert.equal(check.deterministic, true);
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true);
  assert.equal(check.checks.fingerprint, true);
  assert.equal(check.checks.eventCount, true);
  assert.equal(check.checks.eventDigest, true);
});

test('换一个种子：inputDigest 对不上，报被改动', () => {
  const trace = makeTrace();
  const tampered: TraceFile = { ...trace, worldSeed: '另一位种子' };
  const check = verifyTrace(tampered);
  assert.equal(check.status, 'tampered');
  assert.equal(check.checks.integrity, false);
  assert.match(check.message, /轨迹被改动过/);
});

test('删掉一条注入并重算摘要：世界指纹与事件对不上', () => {
  const trace = makeTrace();
  const input: TraceInput = {
    ...trace,
    injections: trace.injections.filter((injection) => injection.kind !== 'weather'),
  };
  const tampered: TraceFile = {
    ...input,
    recorded: { ...trace.recorded, inputDigest: digestOfInput(input) },
  };
  const check = verifyTrace(tampered);
  assert.equal(check.status, 'recorded-mismatch');
  assert.equal(check.checks.integrity, true);
  assert.equal(check.checks.fingerprint, false);
  assert.equal(check.checks.eventCount, false);
  assert.ok(check.divergence !== null, '应当指出第一处检查点分歧');
  assert.equal(check.divergence?.step, 250);
});

test('格式不全：跑世界之前就拒', () => {
  assert.throws(
    () => validateTrace({ format: 'pwe-trace/1', traceVersion: 1 }),
    (error: unknown) =>
      error instanceof TraceFormatError && error.message.includes('description'),
  );
});

test('第一处字段分歧：路径可读', () => {
  const left = { villagers: [{ id: 'v0', pos: { x: 1, y: 2 } }] };
  const right = { villagers: [{ id: 'v0', pos: { x: 1, y: 3 } }] };
  const diff = firstDifference(left, right);
  assert.equal(diff.path, '$.villagers[0].pos.y');
  assert.equal(diff.left, '2');
  assert.equal(diff.right, '3');
});
