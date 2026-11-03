#!/usr/bin/env node
/**
 * 轨迹记录器（pwe-trace/2）：世界 + 记忆（含 bonds / moods）+ 造物三层一起冻结。
 *
 * 用法：
 *   node scripts/trace-record.ts
 *
 * 产出：
 *   1. `traces/night-rain-build.json`：v1 世界层轨迹（旧格式兼容样本，按当前代码重录）；
 *   2. `traces/outer-baseline-v5.json`：一次真实运行导出的 v5 存档；
 *   3. `traces/outer-two-days.json`：以那份存档为基线、再跨两天的 v2 轨迹。
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordTrace, runTrace, verifyTrace } from '../src/trace/replay.ts';
import type { TraceBaseline, TraceInjection, TraceInput } from '../src/trace/format.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TRACES = resolve(CLIENT_ROOT, 'traces');
const BASELINE_OUT = resolve(TRACES, 'outer-baseline-v5.json');
const TRACE_OUT = resolve(TRACES, 'outer-two-days.json');
const LEGACY_OUT = resolve(TRACES, 'night-rain-build.json');
const HUGE = Number.MAX_SAFE_INTEGER;

const STEP_MS = 60_000;
const SEED_STEPS = 1_500;
const MAIN_STEPS = 3_000;

function memoryInjection(
  seq: number,
  atWorldMs: number,
  eventId: string,
  valence: number,
  arousal: number,
  what: string,
): TraceInjection {
  return {
    seq,
    atWorldMs,
    kind: 'memory',
    payload: {
      eventId,
      memoryKind: 'task_done',
      placeId: 'place:workshop',
      at: { x: 35, y: 24 },
      actors: ['v1'],
      witnesses: ['v0'],
      what,
      valence,
      arousal,
      importanceHint: 0.7,
    },
  };
}

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
    memoryInjection(2, 20_000_000, 'bond-pos-1', 0.4, 0.5, 'v1 修好了一盏灯'),
    memoryInjection(3, 30_000_000, 'bond-pos-2', 0.4, 0.5, 'v1 又修好了一盏灯'),
    memoryInjection(4, 40_000_000, 'bond-pos-3', 0.4, 0.5, 'v1 第三次修好灯'),
    { seq: 5, atWorldMs: 50_000_000, kind: 'weather', payload: { weather: 'rain' } },
    memoryInjection(6, 60_000_000, 'bond-neg-1', -0.6, 0.6, 'v1 弄坏了灯架'),
    memoryInjection(7, 70_000_000, 'bond-neg-2', -0.6, 0.6, 'v1 又弄坏了灯架'),
    memoryInjection(8, 80_000_000, 'bond-neg-3', -0.6, 0.6, 'v1 第三次弄坏灯架'),
  ];
  return {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description:
      '基线生成跑：从空世界起一天（含 1 次关账）。同一目击者 v0 三次看见 v1 的正面事、三次负面事，关系与情绪真的变化；结束时导出带 bonds/moods 的 v5 存档。',
    worldId: 'default',
    worldSeed: 'default',
    initialNow: 0,
    stepMs: STEP_MS,
    steps: SEED_STEPS,
    eventRange,
    injections,
    outer: { memory: true, creator: true },
  };
}

function mainInput(
  baseline: TraceBaseline,
  eventRange: { readonly from: number; readonly to: number },
): TraceInput {
  const start = baseline.save.world.now;
  const injections: readonly TraceInjection[] = [
    memoryInjection(1, start + 10_000_000, 'main-pos-1', 0.5, 0.5, 'v1 帮 v0 修好了屋顶'),
    memoryInjection(2, start + 20_000_000, 'main-pos-2', 0.5, 0.5, 'v1 又帮 v0 修好了屋顶'),
    memoryInjection(3, start + 30_000_000, 'main-pos-3', 0.5, 0.5, 'v1 第三次帮 v0 修屋顶'),
    memoryInjection(4, start + 50_000_000, 'main-neg-1', -0.7, 0.7, 'v1 把 v0 的工具弄丢了'),
    memoryInjection(5, start + 60_000_000, 'main-neg-2', -0.7, 0.7, 'v1 又弄丢了 v0 的工具'),
    memoryInjection(6, start + 70_000_000, 'main-neg-3', -0.7, 0.7, 'v1 第三次弄丢工具'),
    {
      seq: 7,
      atWorldMs: start + 90_000_000,
      kind: 'creatorBuild',
      payload: {
        templateId: 'code_forge',
        at: { x: 35, y: 20 },
        summary: '从存档起步后：人工立起炼码工坊',
      },
    },
    { seq: 8, atWorldMs: start + 110_000_000, kind: 'weather', payload: { weather: 'storm' } },
    { seq: 9, atWorldMs: start + 130_000_000, kind: 'intent', payload: { raw: '点灯' } },
    memoryInjection(10, start + 150_000_000, 'main-neg-4', -0.8, 0.8, 'v1 在暴雨里弄丢了工具'),
  ];
  return {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description:
      '从真实 v5 存档（带 bonds / moods）起步，再跨两天（两次日终关账）：同一目击者 v0 三次正面、四次负面目击 v1，一次人工造物（炼码工坊）、一次暴雨、一次点灯。世界、记忆（含关系账本与情绪）、造物三层都参与指纹。',
    worldId: 'default',
    worldSeed: 'default',
    initialNow: start,
    stepMs: STEP_MS,
    steps: MAIN_STEPS,
    eventRange,
    injections,
    outer: { memory: true, creator: true },
    baseline,
  };
}

/** v1 旧格式样本：世界层，无 baseline / outer。 */
function legacyInput(eventRange: { readonly from: number; readonly to: number }): TraceInput {
  return {
    format: 'pwe-trace/1',
    traceVersion: 1,
    description:
      '旧格式兼容样本：从世界日 0 的最后两分钟起跑 7 分 12 秒，跨日一次，注入造物、拨潮、下雨。只校验世界层。',
    worldId: 'default',
    worldSeed: 'pwe-trace-night-rain-build-0001',
    initialNow: DAY_MS - 120_000,
    stepMs: 120,
    steps: 3_600,
    eventRange,
    injections: [
      { seq: 1, atWorldMs: DAY_MS - 60_000, kind: 'intent', payload: { raw: '建一间书阁' } },
      { seq: 2, atWorldMs: DAY_MS + 130_000, kind: 'intent', payload: { raw: '涨潮' } },
      { seq: 3, atWorldMs: DAY_MS + 280_000, kind: 'weather', payload: { weather: 'rain' } },
    ],
  };
}

function sizeOf(path: string): number {
  return statSync(path).size;
}

async function main(): Promise<void> {
  mkdirSync(TRACES, { recursive: true });

  const legacyProbe = await runTrace(legacyInput({ from: 0, to: HUGE }));
  const legacy = await recordTrace(legacyInput({ from: 0, to: legacyProbe.events.length }));
  writeFileSync(LEGACY_OUT, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

  const seedProbe = await runTrace(seedInput({ from: 0, to: HUGE }));
  const seed = await recordTrace(seedInput({ from: 0, to: seedProbe.events.length }), {
    captureSave: true,
  });
  const save = seed.artifacts?.save;
  if (save === undefined) throw new Error('基线生成没有拿到存档');
  writeFileSync(BASELINE_OUT, `${JSON.stringify(save, null, 2)}\n`, 'utf8');
  const baseline: TraceBaseline = { source: 'traces/outer-baseline-v5.json', save };

  const probe = await runTrace(mainInput(baseline, { from: 0, to: HUGE }));
  const trace = await recordTrace(mainInput(baseline, { from: 0, to: probe.events.length }));
  writeFileSync(TRACE_OUT, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

  const check = await verifyTrace(trace);
  const memory = trace.recorded.memory?.business;
  const creator = trace.recorded.creator?.business;

  process.stdout.write(
    [
      `旧格式轨迹：${LEGACY_OUT}（${sizeOf(LEGACY_OUT)} 字节）`,
      `基线存档：${BASELINE_OUT}（${sizeOf(BASELINE_OUT)} 字节，schemaVersion=${save.schemaVersion}）`,
      `新轨迹：${TRACE_OUT}（${sizeOf(TRACE_OUT)} 字节）`,
      `时钟：${trace.initialNow} + ${trace.steps} × ${trace.stepMs} = ${trace.initialNow + trace.steps * trace.stepMs}，day ${Math.floor(trace.initialNow / DAY_MS)} → ${Math.floor(trace.recorded.business.now / DAY_MS)}`,
      `世界指纹：${trace.recorded.fingerprint}（事件 ${trace.recorded.eventCount} 条）`,
      `记忆指纹：${trace.recorded.memory?.fingerprint ?? '(无)'}；条目 ${memory?.entries ?? 0}，事实 ${memory?.facts ?? 0}，断言 ${memory?.claims ?? 0}，信念 ${memory?.beliefs ?? 0}`,
      `关系账本：${memory?.bonds ?? 0} 条，trust 合计 ${memory?.bondTrustSum ?? 0}；情绪：${memory?.moods ?? 0} 条，valence 合计 ${memory?.moodValenceSum ?? 0}`,
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
