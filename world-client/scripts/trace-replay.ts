#!/usr/bin/env node
/**
 * 重放校验：同一轨迹跑两次，世界、记忆、造物三枚指纹逐字比对。
 *
 * 用法：
 *   node scripts/trace-replay.ts [traces/outer-two-days.json] [--events]
 *
 * 旧格式（pwe-trace/1）照常能读：只校验世界层，并明确打印「不支持外环字段」。
 * 退出码：0 = `replayable`；1 = 其余三种（tampered / unreplayable / recorded-mismatch）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrace, verifyTrace } from '../src/trace/replay.ts';
import type { TraceFile } from '../src/trace/format.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TRACE = resolve(CLIENT_ROOT, 'traces/outer-two-days.json');

async function main(): Promise<void> {
  const at = process.argv.findIndex((arg, index) => index > 1 && !arg.startsWith('-'));
  const path = at === -1 ? DEFAULT_TRACE : resolve(process.argv[at]!);
  const trace = JSON.parse(readFileSync(path, 'utf8')) as TraceFile;
  const check = await verifyTrace(trace);
  const wantEvents = process.argv.includes('--events');

  const lines = [
    `轨迹：${path}`,
    `格式：${trace.format} / v${trace.traceVersion} —— ${check.compatibility.message}`,
    `世界：${trace.worldId} / seed=${trace.worldSeed}`,
    `时钟：${trace.initialNow} + ${trace.steps} × ${trace.stepMs} = ${trace.initialNow + trace.steps * trace.stepMs}`,
    trace.baseline === undefined
      ? '基线：空世界'
      : `基线：${trace.baseline.source}（内存里的存档副本，world.now=${trace.baseline.save.world.now}）`,
    `输入摘要：${check.inputDigest} (${check.checks.integrity ? '与 recorded 一致' : '与 recorded 不一致'})`,
    `世界指纹：${check.fingerprint}`,
    `世界指纹（第二次）：${check.secondFingerprint}`,
    `两次逐字相同：${check.deterministic ? '是' : '否'}`,
    `录制世界指纹：${trace.recorded.fingerprint}（一致：${check.checks.fingerprint ? '是' : '否'}）`,
    `事件：${check.eventCount} 条（录制 ${trace.recorded.eventCount} 条），摘要一致：${check.checks.eventDigest ? '是' : '否'}`,
    `世界业务读数：${JSON.stringify(check.business)}`,
  ];

  if (check.memory === null) {
    lines.push('记忆：不支持（旧格式轨迹没有 recorded.memory）');
  } else {
    lines.push(
      `记忆指纹：${check.memory.fingerprint}`,
      `记忆指纹（第二次）：${check.memory.secondFingerprint}`,
      `记忆逐字相同：${check.memory.deterministic ? '是' : '否'}；与录制一致：${check.memory.matchesRecorded ? '是' : '否'}`,
      `记忆读数：${JSON.stringify(check.memory.business)}`,
    );
  }
  if (check.creator === null) {
    lines.push('造物：不支持（旧格式轨迹没有 recorded.creator）');
  } else {
    lines.push(
      `造物指纹：${check.creator.fingerprint}`,
      `造物指纹（第二次）：${check.creator.secondFingerprint}`,
      `造物逐字相同：${check.creator.deterministic ? '是' : '否'}；与录制一致：${check.creator.matchesRecorded ? '是' : '否'}`,
      `造物账：日终 ${check.creator.business.dayCloses.length} 次 / 提议 ${check.creator.business.proposals.length} 条 / 落地 ${check.creator.business.landings.length} 栋`,
    );
  }

  lines.push(
    `耗时：第一次 ${check.firstRunMs.toFixed(1)}ms / 第二次 ${check.secondRunMs.toFixed(1)}ms`,
    `结论：${check.status} —— ${check.message}`,
  );
  process.stdout.write(lines.join('\n') + '\n');

  if (wantEvents) {
    const run = await runTrace(trace);
    process.stdout.write(`事件区间 [${trace.eventRange.from}, ${trace.eventRange.to})：\n`);
    for (const event of run.events) {
      process.stdout.write(`  #${event.seq} @${event.at} [${event.tone}] ${event.text}\n`);
    }
  }

  if (check.status !== 'replayable') process.exitCode = 1;
}

await main();
