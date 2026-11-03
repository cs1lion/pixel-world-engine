/** 轨迹回放器自己的单测：确定、可篡改检出、旧格式兼容、格式守卫。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const HUGE = Number.MAX_SAFE_INTEGER;
const LEGACY_TRACE = fileURLToPath(new URL('../traces/night-rain-build.json', import.meta.url));
const OUTER_TRACE = fileURLToPath(new URL('../traces/outer-two-days.json', import.meta.url));

function readTrace(path: string): TraceFile {
  return JSON.parse(readFileSync(path, 'utf8')) as TraceFile;
}

async function makeV1Trace(): Promise<TraceFile> {
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
  const probe = await runTrace({ ...base, eventRange: { from: 0, to: HUGE } });
  return recordTrace({ ...base, eventRange: { from: 0, to: probe.events.length } });
}

async function makeV2Trace(): Promise<TraceFile> {
  const base: Omit<TraceInput, 'eventRange'> = {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description: '单测用的小 v2 轨迹：两天 + 一次造物 + 一次下雨，外环参与指纹。',
    worldId: 'default',
    worldSeed: 'unit-seed',
    initialNow: 0,
    stepMs: 60_000,
    steps: 3_000,
    injections: [
      {
        seq: 1,
        atWorldMs: 10_000_000,
        kind: 'creatorBuild',
        payload: { templateId: 'star_archive', at: { x: 51, y: 20 } },
      },
      {
        seq: 2,
        atWorldMs: 100_000_000,
        kind: 'weather',
        payload: { weather: 'rain' },
      },
    ],
    outer: { memory: true, creator: true },
  };
  const probe = await runTrace({ ...base, eventRange: { from: 0, to: HUGE } });
  return recordTrace({ ...base, eventRange: { from: 0, to: probe.events.length } });
}

test('v1：同一轨迹跑两次，世界指纹逐字相同', async () => {
  const trace = await makeV1Trace();
  const check = await verifyTrace(trace);
  assert.equal(check.status, 'replayable');
  assert.equal(check.deterministic, true);
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true);
  assert.equal(check.checks.fingerprint, true);
  assert.equal(check.checks.eventCount, true);
  assert.equal(check.checks.eventDigest, true);
});

test('v1 旧轨迹可读：明确报「不支持外环字段」而不是崩', async () => {
  const trace = readTrace(LEGACY_TRACE);
  const check = await verifyTrace(trace);
  assert.equal(check.compatibility.outerSupported, false);
  assert.match(check.compatibility.message, /不支持外环字段/);
  assert.equal(check.memory, null);
  assert.equal(check.creator, null);
  assert.equal(check.deterministic, true);
});

test('v2：世界、记忆、造物三枚指纹两次逐字相同', async () => {
  const trace = await makeV2Trace();
  const check = await verifyTrace(trace);
  assert.equal(check.status, 'replayable');
  assert.equal(check.compatibility.outerSupported, true);
  assert.equal(check.deterministic, true);
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.ok(check.memory !== null);
  assert.equal(check.memory.fingerprint, check.memory.secondFingerprint);
  assert.ok(check.creator !== null);
  assert.equal(check.creator.fingerprint, check.creator.secondFingerprint);
  assert.equal(check.creator.matchesRecorded, true);
});

test('换一个种子：inputDigest 对不上，报被改动', async () => {
  const trace = await makeV1Trace();
  const tampered: TraceFile = { ...trace, worldSeed: '另一位种子' };
  const check = await verifyTrace(tampered);
  assert.equal(check.status, 'tampered');
  assert.equal(check.checks.integrity, false);
  assert.match(check.message, /轨迹被改动过/);
});

test('v2 删掉造物意图并重算摘要：世界与造物账都对不上', async () => {
  const trace = readTrace(OUTER_TRACE);
  const input: TraceInput = {
    ...trace,
    injections: trace.injections.filter((injection) => injection.kind !== 'creatorBuild'),
  };
  const tampered: TraceFile = {
    ...input,
    recorded: { ...trace.recorded, inputDigest: digestOfInput(input) },
  };
  const check = await verifyTrace(tampered);
  assert.equal(check.status, 'recorded-mismatch');
  assert.equal(check.checks.integrity, true);
  assert.equal(check.checks.creator, false);
  assert.equal(check.checks.fingerprint, false);
  assert.ok(check.divergence !== null);
  assert.equal(check.divergence?.kind, 'world');
});

test('v2 改一个记忆条目的来源并重算摘要：记忆指纹先分叉', async () => {
  const trace = readTrace(OUTER_TRACE);
  assert.ok(trace.baseline !== undefined);
  const save = structuredClone(trace.baseline.save) as unknown as {
    world: { memory: string };
  };
  const memory = JSON.parse(save.world.memory) as {
    world: { entries: { sourceMode: string }[] };
  };
  assert.ok(memory.world.entries.length > 0);
  const first = memory.world.entries[0]!;
  first.sourceMode = first.sourceMode === 'witnessed' ? 'heard' : 'witnessed';
  save.world.memory = JSON.stringify(memory);
  const input: TraceInput = {
    ...trace,
    baseline: { ...trace.baseline!, save: save as unknown as typeof trace.baseline.save },
  };
  const tampered: TraceFile = {
    ...input,
    recorded: { ...trace.recorded, inputDigest: digestOfInput(input) },
  };
  const check = await verifyTrace(tampered);
  assert.equal(check.status, 'recorded-mismatch');
  assert.equal(check.checks.memory, false);
  assert.equal(check.checks.fingerprint, true);
  assert.equal(check.divergence?.kind, 'memory');
  assert.equal(check.divergence?.step, 0);
});

test('格式不全：跑世界之前就拒', () => {
  assert.throws(
    () => validateTrace({ format: 'pwe-trace/2', traceVersion: 2 }),
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
