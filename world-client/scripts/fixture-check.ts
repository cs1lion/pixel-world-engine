#!/usr/bin/env node
/**
 * 夹具自检入口（`npm run fixture:check`）：逐条回放预制夹具，核对录制值 + 业务断言。
 *
 * 用法：
 *   node scripts/fixture-check.ts
 *   node scripts/fixture-check.ts --only natural-bond-witness
 *
 * 行为：
 *   1. 按文件名顺序读 `fixtures/*.json`（`--only` 只跑一条，名字必须精确匹配）；
 *   2. 每条用真实 `TraceRuntime` 跑一遍，先核对 `recorded`（输入摘要 / 世界 /
 *      事件 / 记忆 / 造物），再求值夹具声明的业务断言；
 *   3. **单条失败不影响其他条**：每条独立 try/catch，失败写清原因；
 *   4. 最后打汇总表；任一条失败则退出码 1。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { digestOfInput, canonicalJson, validateTrace } from '../src/trace/format.ts';
import type { TraceBaseline, TraceFile } from '../src/trace/format.ts';
import type { WorldSave } from '../src/world/save.ts';
import { runTraceWithRuntime } from '../src/trace/replay.ts';
import { TraceRuntime } from '../src/trace/runtime.ts';
import {
  baselineSourceOf,
  evaluateAssertion,
  fixtureProblems,
  fixtureSources,
} from '../src/trace/fixture.ts';
import type { FixtureFile } from '../src/trace/fixture.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = resolve(CLIENT_ROOT, 'fixtures');
const BUDGET_MS = 3_000;

interface Row {
  readonly name: string;
  readonly steps: number;
  readonly ms: number;
  readonly checks: number;
  readonly ok: boolean;
  readonly overBudget: boolean;
}

interface Outcome {
  readonly row: Row;
  readonly failures: readonly string[];
}

function onlyName(): string | null {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--only') return args[index + 1] ?? null;
    if (arg.startsWith('--only=')) return arg.slice('--only='.length);
  }
  return null;
}

function loadFixtures(): { file: string; path: string; data: unknown }[] {
  let names: string[];
  try {
    names = readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort();
  } catch {
    throw new Error(`夹具目录不存在：${FIXTURES}`);
  }
  const only = onlyName();
  const chosen = only === null ? names : names.filter((name) => name.replace(/\.json$/, '') === only);
  if (chosen.length === 0) {
    throw new Error(`没有名为 ${only} 的夹具；可用：${names.map((name) => name.replace(/\.json$/, '')).join(', ')}`);
  }
  return chosen.map((name) => {
    const path = resolve(FIXTURES, name);
    return { file: name, path, data: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  });
}

function withBaseline(fixture: FixtureFile): TraceFile {
  const baselinePath = fixture.baselinePath;
  if (baselinePath === undefined) return fixture.trace;
  const full = resolve(CLIENT_ROOT, baselinePath);
  const save = JSON.parse(readFileSync(full, 'utf8')) as WorldSave;
  const baseline: TraceBaseline = { source: baselineSourceOf(baselinePath), save };
  return { ...fixture.trace, baseline };
}

function recordedFailures(trace: TraceFile, run: Awaited<ReturnType<typeof runTraceWithRuntime>>): string[] {
  const recorded = trace.recorded;
  const failures: string[] = [];
  const push = (label: string, ok: boolean, expected: unknown, actual: unknown): void => {
    if (!ok) failures.push(`录制值 ${label}：期望 ${json(expected)}，实际 ${json(actual)}`);
  };
  push('inputDigest', digestOfInput(trace) === recorded.inputDigest, recorded.inputDigest, digestOfInput(trace));
  push('世界指纹', run.fingerprint === recorded.fingerprint, recorded.fingerprint, run.fingerprint);
  push('事件条数', run.eventCount === recorded.eventCount, recorded.eventCount, run.eventCount);
  push('事件摘要', run.eventDigest === recorded.eventDigest, recorded.eventDigest, run.eventDigest);
  push('世界业务读数', canonicalJson(run.business) === canonicalJson(recorded.business), recorded.business, run.business);
  if (recorded.memory !== undefined) {
    push('记忆指纹', run.memory?.fingerprint === recorded.memory.fingerprint, recorded.memory.fingerprint, run.memory?.fingerprint);
    push('记忆读数', canonicalJson(run.memory?.business) === canonicalJson(recorded.memory.business), recorded.memory.business, run.memory?.business);
  }
  if (recorded.creator !== undefined) {
    push('造物指纹', run.creator?.fingerprint === recorded.creator.fingerprint, recorded.creator.fingerprint, run.creator?.fingerprint);
    push('造物摘要', canonicalJson(run.creator?.business) === canonicalJson(recorded.creator.business), recorded.creator.business, run.creator?.business);
  }
  return failures;
}

function recordedChecks(trace: TraceFile): number {
  return 5 + (trace.recorded.memory === undefined ? 0 : 2) + (trace.recorded.creator === undefined ? 0 : 2);
}

async function runOne(entry: { file: string; path: string; data: unknown }): Promise<Outcome> {
  const problems = fixtureProblems(entry.data);
  if (problems.length > 0) {
    return {
      row: { name: entry.file, steps: 0, ms: 0, checks: 0, ok: false, overBudget: false },
      failures: problems.map((item) => `格式：${item}`),
    };
  }
  const fixture = entry.data as FixtureFile;
  let trace: TraceFile;
  try {
    trace = withBaseline(fixture);
    validateTrace(trace);
  } catch (error) {
    return {
      row: { name: fixture.name, steps: fixture.trace.steps, ms: 0, checks: fixture.assertions.length, ok: false, overBudget: false },
      failures: [`加载：${error instanceof Error ? error.message : String(error)}`],
    };
  }

  try {
    const started = performance.now();
    const runtime = new TraceRuntime(trace);
    const run = await runTraceWithRuntime(trace, runtime);
    const ms = performance.now() - started;
    const failures = recordedFailures(trace, run);
    const sources = fixtureSources(runtime, run);
    for (const assertion of fixture.assertions) {
      const result = evaluateAssertion(sources, assertion);
      if (!result.ok) {
        failures.push(
          `断言「${assertion.note}」：${assertion.source}.${assertion.path} ` +
            `期望 ${assertion.op} ${json(assertion.value)}，实际 ${json(result.actual)}`,
        );
      }
    }
    return {
      row: {
        name: fixture.name,
        steps: fixture.trace.steps,
        ms,
        checks: recordedChecks(trace) + fixture.assertions.length,
        ok: failures.length === 0,
        overBudget: ms > BUDGET_MS,
      },
      failures,
    };
  } catch (error) {
    return {
      row: { name: fixture.name, steps: fixture.trace.steps, ms: 0, checks: fixture.assertions.length, ok: false, overBudget: false },
      failures: [`运行：${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function json(value: unknown): string {
  const text = value === undefined ? '(undefined)' : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function printTable(rows: readonly Row[]): void {
  const headers = ['夹具', '拍数', '耗时(ms)', '断言', '结果'];
  const lines = rows.map((row) => [
    row.name,
    String(row.steps),
    row.ms.toFixed(1),
    String(row.checks),
    row.ok ? 'PASS' : 'FAIL',
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...lines.map((line) => line[index]!.length)),
  );
  const format = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd();
  process.stdout.write(`\n${format(headers)}\n`);
  for (const line of lines) process.stdout.write(`${format(line)}\n`);
}

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  const outcomes: Outcome[] = [];
  for (const entry of fixtures) {
    const outcome = await runOne(entry);
    outcomes.push(outcome);
    const row = outcome.row;
    process.stdout.write(
      `${row.ok ? 'PASS' : 'FAIL'} ${row.name}：${row.steps} 拍，${row.ms.toFixed(1)}ms，` +
        `${row.checks} 项断言${row.overBudget ? `（超 ${BUDGET_MS}ms 预算）` : ''}\n`,
    );
    for (const failure of outcome.failures) process.stdout.write(`  - ${failure}\n`);
  }

  printTable(outcomes.map((item) => item.row));
  const failed = outcomes.filter((item) => !item.row.ok);
  const totalMs = outcomes.reduce((sum, item) => sum + item.row.ms, 0);
  const totalChecks = outcomes.reduce((sum, item) => sum + item.row.checks, 0);
  process.stdout.write(
    `\n合计：${outcomes.length} 条夹具，${totalChecks} 项断言，` +
      `${outcomes.length - failed.length} 通过 / ${failed.length} 失败，回放共 ${totalMs.toFixed(1)}ms\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

await main();
