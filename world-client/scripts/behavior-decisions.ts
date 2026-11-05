/** 逐拍行为决策日志：跑同一条轨迹，把每一拍「选了哪个目标、谁下的决定」落成文本。
 *
 * 用途只有一个：把「行为没变」钉到决策层面，而不只是终局指纹。两版代码跑同一条
 * 轨迹，输出逐行 diff 为空才算等价。
 *
 * 只读：探针由 `Simulation.setDecisionLogEnabled(true)` 打开，记录的是已经做过的
 * 决定，不参与判定；关着时零开销。
 *
 * 用法：
 *   node scripts/behavior-decisions.ts traces/outer-two-days.json 输出.txt
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { TraceRuntime } from '../src/trace/runtime.ts';
import { orderedInjections } from '../src/trace/format.ts';
import type { TraceFile } from '../src/trace/format.ts';

const [, , tracePath, outPath] = process.argv;
if (tracePath === undefined || outPath === undefined) {
  console.error('用法：node scripts/behavior-decisions.ts <trace.json> <out.txt>');
  process.exit(1);
}

const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as TraceFile;
const runtime = new TraceRuntime(trace);
runtime.sim.setDecisionLogEnabled(true);

const injections = orderedInjections(trace);
let nextInjection = 0;
const lines: string[] = [];

for (let step = 1; step <= trace.steps; step += 1) {
  const worldNow = trace.initialNow + step * trace.stepMs;
  while (nextInjection < injections.length && injections[nextInjection]!.atWorldMs <= worldNow) {
    runtime.applyInjection(injections[nextInjection]!);
    nextInjection += 1;
  }
  await runtime.step(trace.stepMs);
  for (const record of runtime.sim.drainDecisions()) {
    const target = record.targetX === null || record.targetY === null
      ? '-'
      : `${record.targetX},${record.targetY}`;
    lines.push([
      record.now,
      record.villagerId,
      record.rule,
      record.goal,
      target,
      record.beatId ?? '-',
      record.routineIndex === null ? '-' : String(record.routineIndex),
    ].join('|'));
  }
}

const text = `${lines.join('\n')}\n`;
writeFileSync(outPath, text, 'utf8');
const digest = createHash('sha256').update(text).digest('hex');
console.log(JSON.stringify({ decisions: lines.length, steps: trace.steps, digest, outPath }));
