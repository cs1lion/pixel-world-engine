#!/usr/bin/env node
/**
 * 轨迹记录器：把一次世界运行冻结成 JSON。
 *
 * 用法：
 *   node scripts/trace-record.ts [--out traces/night-rain-build.json]
 *
 * 场景是固定的，不读墙钟、不读环境变量：
 *   开局在世界日第 0 天的最后两分钟，跑 7 分 12 秒，跨过日界；
 *   期间注入一条造物神谕、一条拨潮神谕、一次天气变化。
 *
 * 为什么把轨迹落在仓内 `traces/` 而不是仓外：生成出来的回归用例要在 CI 里
 * 单独跑，轨迹必须跟着代码走、能被 review、能被 diff。文件很小（见实测），
 * 放仓外等于让回归用例依赖一台机器的临时目录。
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordTrace, runTrace, verifyTrace } from '../src/trace/replay.ts';
import type { TraceInput, TraceInjection } from '../src/trace/format.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT = resolve(CLIENT_ROOT, 'traces/night-rain-build.json');

/** 开局：世界日 0 的最后两分钟。 */
export const INITIAL_NOW = DAY_MS - 120_000;
const STEP_MS = 120;
const STEPS = 3_600;

const BEGIN_MS = INITIAL_NOW + 60_000;

const injections: readonly TraceInjection[] = [
  {
    seq: 1,
    atWorldMs: BEGIN_MS,
    kind: 'intent',
    payload: { raw: '建一间书阁' },
  },
  {
    seq: 2,
    atWorldMs: INITIAL_NOW + 250_000,
    kind: 'intent',
    payload: { raw: '涨潮' },
  },
  {
    seq: 3,
    atWorldMs: INITIAL_NOW + 400_000,
    kind: 'weather',
    payload: { weather: 'rain' },
  },
];

function scenario(eventRange: { readonly from: number; readonly to: number }): TraceInput {
  return {
    format: 'pwe-trace/1',
    traceVersion: 1,
    description:
      '从世界日 0 的最后两分钟起跑 7 分 12 秒：跨日一次，注入造物（建一间书阁）、拨潮（涨潮）、天气（下雨）。时钟只有 initialNow + steps×stepMs，注入按 atWorldMs 进队、同刻按 seq 定先后。',
    worldId: 'default',
    worldSeed: 'pwe-trace-night-rain-build-0001',
    initialNow: INITIAL_NOW,
    stepMs: STEP_MS,
    steps: STEPS,
    eventRange,
    injections,
  };
}

function main(): void {
  const at = process.argv.indexOf('--out');
  const out = at === -1 ? DEFAULT_OUT : resolve(process.argv[at + 1] ?? DEFAULT_OUT);

  // 先把事件区间探出来：录制文件里的 eventRange 必须覆盖这次运行真正发出的世界事件。
  // 这里用一个大上界跑一次，只为数条数；真正的录制会在 eventRange 定稿后再跑一次。
  const probe = runTrace(scenario({ from: 0, to: Number.MAX_SAFE_INTEGER }));
  const input = scenario({ from: 0, to: probe.events.length });

  const trace = recordTrace(input);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

  const bytes = statSync(out).size;
  const check = verifyTrace(trace);
  const firstEvent = trace.recorded.business;
  const startDay = Math.floor(trace.initialNow / DAY_MS);
  const endDay = Math.floor(trace.recorded.business.now / DAY_MS);

  process.stdout.write(
    [
      `轨迹：${out}`,
      `大小：${bytes} 字节`,
      `世界：${trace.worldId} / seed=${trace.worldSeed}`,
      `时钟：initialNow=${trace.initialNow}，stepMs=${trace.stepMs}，steps=${trace.steps}，终点=${trace.initialNow + trace.stepMs * trace.steps}`,
      `跨日：day ${startDay} → ${endDay}`,
      `事件：${trace.recorded.eventCount} 条（区间 [${trace.eventRange.from}, ${trace.eventRange.to})，摘要 ${trace.recorded.eventDigest}）`,
      `业务读数：楼 ${firstEvent.buildings} 栋 / 任务 ${firstEvent.tasksTotal}（完成 ${firstEvent.tasksCompleted}）/ 天气 ${firstEvent.weather} / 信仰 ${firstEvent.faithPoints}`,
      `指纹：${trace.recorded.fingerprint}`,
      `回放：${check.status}；两次指纹 ${check.fingerprint === check.secondFingerprint ? '逐字相同' : '不同'}；单次 ${check.firstRunMs.toFixed(1)}ms / ${check.secondRunMs.toFixed(1)}ms`,
    ].join('\n') + '\n',
  );

  if (check.status !== 'replayable') {
    process.stderr.write(`录制出来的轨迹自己就不可重放：${check.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
