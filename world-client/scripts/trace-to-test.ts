#!/usr/bin/env node
/**
 * 轨迹 → 回归用例：把一条冻结的轨迹变成 `node --test` 能跑的真用例。
 *
 * 用法：
 *   node scripts/trace-to-test.ts [traces/night-rain-build.json] [--out test/trace-regression-….test.ts]
 *
 * 生成前先自己回放一遍：只有 `replayable` 的轨迹才配变成用例。生成出来的
 * 断言值全部来自这次回放，不是模板里的占位符——轨迹一变、代码一变，用例就红。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTrace } from '../src/trace/replay.ts';
import type { TraceFile } from '../src/trace/format.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TRACE = resolve(CLIENT_ROOT, 'traces/night-rain-build.json');

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

function importPath(fromDir: string, target: string): string {
  const rel = toPosix(relative(fromDir, target));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function main(): void {
  const args = process.argv.slice(2);
  let tracePath: string | null = null;
  let out: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--out') {
      out = resolve(args[index + 1] ?? '');
      index += 1;
    } else {
      tracePath = resolve(arg);
    }
  }
  const trace = tracePath ?? DEFAULT_TRACE;
  const base = toPosix(trace).split('/').pop()!.replace(/\.json$/, '');
  const target = out ?? resolve(CLIENT_ROOT, `test/trace-regression-${base}.test.ts`);

  const parsed = JSON.parse(readFileSync(trace, 'utf8')) as TraceFile;
  const check = verifyTrace(parsed);
  if (check.status !== 'replayable') {
    process.stderr.write(`拒绝生成：这条轨迹当前状态是 ${check.status}——${check.message}\n`);
    process.exitCode = 1;
    return;
  }

  const traceRel = importPath(dirname(target), trace);
  const replayRel = importPath(dirname(target), resolve(CLIENT_ROOT, 'src/trace/replay.ts'));
  const title = `轨迹回归：${base}`;

  const content = `/**
 * 由 \`scripts/trace-to-test.ts\` 生成，不要手改。
 *
 * 轨迹：${traceRel}
 * 世界：${parsed.worldId} / seed=${parsed.worldSeed}
 * 时钟：${parsed.initialNow} + ${parsed.steps} × ${parsed.stepMs}
 *
 * 重跑这条用例：
 *   node --test ${toPosix(relative(CLIENT_ROOT, target))}
 * 重新生成：
 *   node scripts/trace-to-test.ts ${toPosix(relative(CLIENT_ROOT, trace))}
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTrace } from '${replayRel}';

const trace = JSON.parse(
  readFileSync(new URL('${traceRel}', import.meta.url), 'utf8'),
) as Parameters<typeof verifyTrace>[0];

test('${title}', () => {
  const check = verifyTrace(trace);

  // 1. 同一轨迹跑两次必须逐字相同。
  assert.equal(check.deterministic, true, '两次回放不一致：不可重放');
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true, '输入摘要与 recorded 不一致');

  // 2. 指纹：终局世界必须还是录制时那一个。
  assert.equal(check.status, 'replayable');
  assert.equal(check.fingerprint, '${check.fingerprint}');

  // 3. 关键事件数：事件条数与摘要都钉住。
  assert.equal(check.eventCount, ${check.eventCount});
  assert.equal(check.eventDigest, '${check.eventDigest}');

  // 4. 业务读数：至少一项，这里把能一眼看懂的几项都钉住。
  assert.equal(check.business.buildings, ${check.business.buildings});
  assert.equal(check.business.day, ${check.business.day});
  assert.equal(check.business.weather, '${check.business.weather}');
  assert.equal(check.business.tasksCompleted, ${check.business.tasksCompleted});
});
`;

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');

  const rel = toPosix(relative(CLIENT_ROOT, target));
  process.stdout.write(
    [
      `已生成：${target}`,
      `断言指纹：${check.fingerprint}`,
      `事件：${check.eventCount} 条 / 摘要 ${check.eventDigest}`,
      `业务读数：楼 ${check.business.buildings} 栋、day ${check.business.day}、天气 ${check.business.weather}、完成任务 ${check.business.tasksCompleted}`,
      `跑它：cd world-client && node --test ${rel}`,
    ].join('\n') + '\n',
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
