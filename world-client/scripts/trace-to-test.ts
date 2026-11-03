#!/usr/bin/env node
/**
 * 轨迹 → 回归用例：把一条冻结的轨迹变成 `node --test` 能跑的真用例。
 *
 * 用法：
 *   node scripts/trace-to-test.ts [traces/outer-two-days.json] [--out test/trace-regression-….test.ts]
 *
 * 生成前先自己回放一遍：只有 `replayable` 的轨迹才配变成用例。v2 会断言
 * 世界 / 记忆 / 造物三枚指纹；v1 只断言世界层，并写明外环不支持。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTrace } from '../src/trace/replay.ts';
import type { TraceFile } from '../src/trace/format.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TRACE = resolve(CLIENT_ROOT, 'traces/outer-two-days.json');

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

function importPath(fromDir: string, target: string): string {
  const rel = toPosix(relative(fromDir, target));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

async function main(): Promise<void> {
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
  const check = await verifyTrace(parsed);
  if (check.status !== 'replayable') {
    process.stderr.write(`拒绝生成：这条轨迹当前状态是 ${check.status}——${check.message}\n`);
    process.exitCode = 1;
    return;
  }

  const traceRel = importPath(dirname(target), trace);
  const replayRel = importPath(dirname(target), resolve(CLIENT_ROOT, 'src/trace/replay.ts'));
  const title = `轨迹回归：${base}`;
  const outerAssertions =
    check.memory !== null && check.creator !== null
      ? `
  // 3. 记忆层：完整快照指纹 + 关账天数 + 条目/事实/断言/信念计数。
  assert.equal(check.compatibility.outerSupported, true);
  const memory = check.memory;
  assert.ok(memory !== null);
  assert.equal(memory.deterministic, true);
  assert.equal(memory.fingerprint, '${check.memory.fingerprint}');
  assert.equal(memory.business.lastClosedDay, ${check.memory.business.lastClosedDay});
  assert.equal(memory.business.entries, ${check.memory.business.entries});
  assert.equal(memory.business.facts, ${check.memory.business.facts});
  assert.equal(memory.business.claims, ${check.memory.business.claims});
  assert.equal(memory.business.beliefs, ${check.memory.business.beliefs});
  assert.equal(memory.business.bonds, ${check.memory.business.bonds});
  assert.equal(memory.business.moods, ${check.memory.business.moods});
  assert.equal(memory.business.bondTrustSum, ${check.memory.business.bondTrustSum});
  assert.equal(memory.business.moodValenceSum, ${check.memory.business.moodValenceSum});

  // 4. 造物账：日终关账、提议、落地读数与角色门禁计数。
  const creator = check.creator;
  assert.ok(creator !== null);
  assert.equal(creator.deterministic, true);
  assert.equal(creator.fingerprint, '${check.creator.fingerprint}');
  assert.equal(creator.business.dayCloses.length, ${check.creator.business.dayCloses.length});
  assert.equal(creator.business.proposals.length, ${check.creator.business.proposals.length});
  assert.equal(creator.business.landings.length, ${check.creator.business.landings.length});
`
      : `
  // 3. 旧格式轨迹：外环未参与校验，只报「不支持」，不崩。
  assert.equal(check.compatibility.outerSupported, false);
  assert.match(check.compatibility.message, /不支持外环字段/);
  assert.equal(check.memory, null);
  assert.equal(check.creator, null);
`;

  const content = `/**
 * 由 \`scripts/trace-to-test.ts\` 生成，不要手改。
 *
 * 轨迹：${traceRel}
 * 格式：${parsed.format} / v${parsed.traceVersion}
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

test('${title}', async () => {
  const check = await verifyTrace(trace);

  // 1. 同一轨迹跑两次：世界指纹必须先逐字相同。
  assert.equal(check.deterministic, true, '两次回放不一致：不可重放');
  assert.equal(check.fingerprint, check.secondFingerprint);
  assert.equal(check.checks.integrity, true, '输入摘要与 recorded 不一致');

  // 2. 世界指纹 + 事件条数/摘要 + 世界业务读数。
  assert.equal(check.status, 'replayable');
  assert.equal(check.fingerprint, '${check.fingerprint}');
  assert.equal(check.eventCount, ${check.eventCount});
  assert.equal(check.eventDigest, '${check.eventDigest}');
  assert.equal(check.business.buildings, ${check.business.buildings});
  assert.equal(check.business.day, ${check.business.day});
  assert.equal(check.business.weather, '${check.business.weather}');
${outerAssertions}});
`;

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');

  const rel = toPosix(relative(CLIENT_ROOT, target));
  process.stdout.write(
    [
      `已生成：${target}`,
      `世界指纹：${check.fingerprint}`,
      check.memory === null ? '记忆：不支持（v1）' : `记忆指纹：${check.memory.fingerprint}（条目 ${check.memory.business.entries}）`,
      check.creator === null ? '造物：不支持（v1）' : `造物指纹：${check.creator.fingerprint}（落地 ${check.creator.business.landings.length} 栋）`,
      `事件：${check.eventCount} 条 / 摘要 ${check.eventDigest}`,
      `跑它：cd world-client && node --test ${rel}`,
    ].join('\n') + '\n',
  );
}

await main();
