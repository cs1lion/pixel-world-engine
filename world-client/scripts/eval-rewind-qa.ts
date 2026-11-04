#!/usr/bin/env node
/**
 * 回溯问答证据脚本：一份 JSON + 退出码。
 *
 *   node world-client/scripts/eval-rewind-qa.ts \
 *     --out docs/evidence/eval-rewind-qa/rewind-qa.json
 *
 * 默认读 `world-client/eval/fixtures/eval-soak-day-facts.json`（pwe-soak 90 天证据的
 * 第 20/45/60/89 天投影）；`--fixture` 可换路径，但 fact 结构必须相同。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRewindQa, type DayRecord } from '../test/eval-rewind-support.ts';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key !== undefined && value !== undefined) args.set(key, value);
}

// 默认 fixture 按脚本位置解析：从仓库根或 world-client 里跑都一样；报告里仍用仓内相对路径。
const fixtureArg = args.get('--fixture');
const fixturePath = resolve(
  fixtureArg ?? fileURLToPath(new URL('../eval/fixtures/eval-soak-day-facts.json', import.meta.url)),
);
const fixtureLabel = fixtureArg ?? 'world-client/eval/fixtures/eval-soak-day-facts.json';
const outPath = args.get('--out');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  provenance: unknown;
  days: readonly DayRecord[];
};

const startedAt = performance.now();
const run = runRewindQa(fixture);
const report = {
  schema: 'eval-rewind-qa-evidence/1',
  elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
  fixture: fixtureLabel.replace(/\\/g, '/'),
  passed: run.passed,
  failed: run.failed,
  denominator: run.checks.length,
  ...run,
};

if (outPath !== undefined) {
  const target = resolve(outPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`wrote ${target}`);
}

console.log(`rewind-qa: ${run.passed}/${run.checks.length} passed, failed=${run.failed}, ` +
  `elapsed=${report.elapsedMs}ms`);
for (const check of run.checks) {
  if (!check.ok) console.log(`  FAIL day ${check.day} ${check.id}: ${check.failures.join('|')}`);
}
process.exit(run.failed === 0 && run.checks.length === 40 ? 0 : 1);
