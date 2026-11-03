#!/usr/bin/env node
/**
 * 重放校验：同一轨迹跑两次，逐字比对指纹；再和录制值逐项核对。
 *
 * 用法：
 *   node scripts/trace-replay.ts [traces/night-rain-build.json]
 *
 * 退出码：0 = `replayable`；1 = 其余三种（tampered / unreplayable / recorded-mismatch）。
 * 三种都**不静默通过**：第一处分歧在哪一拍、哪个字段，会打印出来。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrace, verifyTrace } from '../src/trace/replay.ts';
import type { TraceFile } from '../src/trace/format.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TRACE = resolve(CLIENT_ROOT, 'traces/night-rain-build.json');

function main(): void {
  const at = process.argv.findIndex((arg, index) => index > 1 && !arg.startsWith('-'));
  const path = at === -1 ? DEFAULT_TRACE : resolve(process.argv[at]!);
  const trace = JSON.parse(readFileSync(path, 'utf8')) as TraceFile;
  const check = verifyTrace(trace);
  const wantEvents = process.argv.includes('--events');

  process.stdout.write(
    [
      `轨迹：${path}`,
      `世界：${trace.worldId} / seed=${trace.worldSeed}`,
      `时钟：${trace.initialNow} + ${trace.steps} × ${trace.stepMs} = ${trace.initialNow + trace.steps * trace.stepMs}`,
      `输入摘要：${check.inputDigest} (${check.checks.integrity ? '与 recorded 一致' : '与 recorded 不一致'})`,
      `第一次指纹：${check.fingerprint}`,
      `第二次指纹：${check.secondFingerprint}`,
      `两次逐字相同：${check.deterministic ? '是' : '否'}`,
      `录制指纹：${trace.recorded.fingerprint}`,
      `指纹一致：${check.checks.fingerprint ? '是' : '否'}`,
      `事件：${check.eventCount} 条（录制 ${trace.recorded.eventCount} 条），摘要一致：${check.checks.eventDigest ? '是' : '否'}`,
      `业务读数：${JSON.stringify(check.business)}`,
      `耗时：第一次 ${check.firstRunMs.toFixed(1)}ms / 第二次 ${check.secondRunMs.toFixed(1)}ms`,
      `结论：${check.status} —— ${check.message}`,
    ].join('\n') + '\n',
  );

  if (wantEvents) {
    const run = runTrace(trace);
    process.stdout.write(`事件区间 [${trace.eventRange.from}, ${trace.eventRange.to})：\n`);
    for (const event of run.events) {
      process.stdout.write(`  #${event.seq} @${event.at} [${event.tone}] ${event.text}\n`);
    }
  }

  if (check.status !== 'replayable') process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
