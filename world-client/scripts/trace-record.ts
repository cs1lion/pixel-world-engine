#!/usr/bin/env node
/**
 * 轨迹记录器（pwe-trace/2）：世界 + 记忆 + 造物三层一起冻结。
 *
 * 用法：
 *   node scripts/trace-record.ts
 *
 * 产出三份东西：
 *   1. `traces/outer-baseline-v5.json`：一次真实运行导出的 v5 存档（只读证据）；
 *   2. `traces/outer-two-days.json`：以那份存档为基线、再跨两天的 v2 轨迹；
 *   3. 控制台读数：三枚指纹、事件、记忆条数、造物账、耗时。
 *
 * 旧轨迹 `traces/night-rain-build.json` 不动——它是 v1 兼容性的活样本。
 *
 * 为什么轨迹落在仓内 `traces/`：生成的回归用例要在 CI 里单独跑，轨迹必须
 * 跟着代码走、能被 review、能被 diff。
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordTrace, runTrace, verifyTrace } from '../src/trace/replay.ts';
import type { TraceBaseline, TraceInjection, TraceInput } from '../src/trace/format.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TRACES = resolve(CLIENT_ROOT, 'traces');
const BASELINE_OUT = resolve(TRACES, 'outer-baseline-v5.json');
const TRACE_OUT = resolve(TRACES, 'outer-two-days.json');
const HUGE = Number.MAX_SAFE_INTEGER;

const STEP_MS = 30_000;
const STEPS = 6_000;

function seedInput(eventRange: { readonly from: number; readonly to: number }): TraceInput {
  const injections: readonly TraceInjection[] = [
    {
      seq: 1,
      atWorldMs: 10_000_000,
      kind: 'creatorBuild',
      payload: {
        templateId: 'star_archive',
        at: { x: 51, y: 20 },
        summary: '第 0 天：人工立起星图书阁',
      },
    },
    { seq: 2, atWorldMs: 40_000_000, kind: 'intent', payload: { raw: '涨潮' } },
    { seq: 3, atWorldMs: 90_000_000, kind: 'weather', payload: { weather: 'rain' } },
    { seq: 4, atWorldMs: 140_000_000, kind: 'intent', payload: { raw: '点灯' } },
  ];
  return {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description:
      '基线生成跑：从空世界起两天，人工造一栋书阁、拨潮、下雨、点灯；结束时导出 v5 存档当下一段的起点。',
    worldId: 'default',
    worldSeed: 'default',
    initialNow: 0,
    stepMs: STEP_MS,
    steps: STEPS,
    eventRange,
    injections,
    outer: { memory: true, creator: true },
  };
}

function mainInput(
  baseline: TraceBaseline,
  eventRange: { readonly from: number; readonly to: number },
): TraceInput {
  const injections: readonly TraceInjection[] = [
    {
      seq: 1,
      atWorldMs: baseline.save.world.now + 20_000_000,
      kind: 'creatorBuild',
      payload: {
        templateId: 'code_forge',
        at: { x: 35, y: 20 },
        summary: '从存档起步后：人工立起炼码工坊',
      },
    },
    {
      seq: 2,
      atWorldMs: baseline.save.world.now + 80_000_000,
      kind: 'weather',
      payload: { weather: 'storm' },
    },
    {
      seq: 3,
      atWorldMs: baseline.save.world.now + 120_000_000,
      kind: 'intent',
      payload: { raw: '涨潮' },
    },
    {
      seq: 4,
      atWorldMs: baseline.save.world.now + 160_000_000,
      kind: 'intent',
      payload: { raw: '点灯' },
    },
  ];
  return {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description:
      '从真实 v5 存档起步，再跨两天（两次日终关账）：一次人工造物（炼码工坊）、一次暴雨、两次神谕。世界、记忆、造物三层都参与指纹。',
    worldId: 'default',
    worldSeed: 'default',
    initialNow: baseline.save.world.now,
    stepMs: STEP_MS,
    steps: STEPS,
    eventRange,
    injections,
    outer: { memory: true, creator: true },
    baseline,
  };
}

function sizeOf(path: string): number {
  return statSync(path).size;
}

async function main(): Promise<void> {
  mkdirSync(TRACES, { recursive: true });

  const seedProbe = await runTrace(seedInput({ from: 0, to: HUGE }));
  const seedRange = { from: 0, to: seedProbe.events.length };
  const seed = await recordTrace(seedInput(seedRange), { captureSave: true });
  const save = seed.artifacts?.save;
  if (save === undefined) throw new Error('基线生成没有拿到存档');
  writeFileSync(BASELINE_OUT, `${JSON.stringify(save, null, 2)}\n`, 'utf8');
  const baseline: TraceBaseline = {
    source: 'traces/outer-baseline-v5.json',
    save,
  };

  const probe = await runTrace(mainInput(baseline, { from: 0, to: HUGE }));
  const range = { from: 0, to: probe.events.length };
  const trace = await recordTrace(mainInput(baseline, range));
  writeFileSync(TRACE_OUT, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

  const check = await verifyTrace(trace);
  const startDay = Math.floor(trace.initialNow / DAY_MS);
  const endDay = Math.floor(trace.recorded.business.now / DAY_MS);
  const memory = trace.recorded.memory?.business;
  const creator = trace.recorded.creator?.business;

  process.stdout.write(
    [
      `基线存档：${BASELINE_OUT}（${sizeOf(BASELINE_OUT)} 字节，schemaVersion=${save.schemaVersion}）`,
      `新轨迹：${TRACE_OUT}（${sizeOf(TRACE_OUT)} 字节）`,
      `世界：${trace.worldId} / seed=${trace.worldSeed}`,
      `时钟：${trace.initialNow} + ${trace.steps} × ${trace.stepMs} = ${trace.initialNow + trace.steps * trace.stepMs}`,
      `跨日：day ${startDay} → ${endDay}`,
      `世界事件：${trace.recorded.eventCount} 条（[${trace.eventRange.from}, ${trace.eventRange.to})，摘要 ${trace.recorded.eventDigest}）`,
      `世界指纹：${trace.recorded.fingerprint}`,
      `记忆指纹：${trace.recorded.memory?.fingerprint ?? '(无)'}；关账到 day ${memory?.lastClosedDay ?? '?'}，条目 ${memory?.entries ?? 0}，事实 ${memory?.facts ?? 0}，断言 ${memory?.claims ?? 0}，信念 ${memory?.beliefs ?? 0}`,
      `造物指纹：${trace.recorded.creator?.fingerprint ?? '(无)'}；日终 ${creator?.dayCloses.length ?? 0} 次，提议 ${creator?.proposals.length ?? 0} 条，落地 ${creator?.landings.length ?? 0} 栋`,
      `回放结论：${check.status}；三枚指纹两次${check.deterministic ? '逐字相同' : '不同'}；单次 ${check.firstRunMs.toFixed(1)}ms / ${check.secondRunMs.toFixed(1)}ms`,
    ].join('\n') + '\n',
  );

  if (check.status !== 'replayable') {
    process.stderr.write(`录制出来的轨迹自己就不可重放：${check.message}\n`);
    process.exitCode = 1;
  }
}

await main();
