import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, planTestChanges, type ChangedFile } from '../scripts/red-first-lib.ts';

const change = (status: string, path: string): ChangedFile => ({ status, path });

test('只改文档：跳过，不判红', () => {
  const plan = planTestChanges([change('M', 'docs/OPEN_ISSUES.md'), change('M', 'README.md')]);
  assert.equal(plan.kind, 'skip');
  assert.match(plan.reason ?? '', /没有 world-client 改动/);
});

test('只改测试以外、或纯重构且测试 diff 为空：跳过', () => {
  const plan = planTestChanges([change('M', 'world-client/src/world/simulation.ts')]);
  assert.equal(plan.kind, 'skip');
  assert.match(plan.reason ?? '', /测试 diff 为空/);
});

test('新增普通测试：进入 base 红灯检查', () => {
  const plan = planTestChanges([change('A', 'world-client/test/new-behavior.test.ts')]);
  assert.equal(plan.kind, 'run');
  assert.deepEqual(plan.run, ['test/new-behavior.test.ts']);
});

test('快照型参数化用例：跳过并写明原因', () => {
  const files = [
    'world-client/test/pin-shot-state.test.ts',
    'world-client/test/fixture-self-check.test.ts',
    'world-client/test/eval-fixture-hash.test.ts',
  ];
  const plan = planTestChanges(files.map((path) => change('M', path)));
  assert.equal(plan.kind, 'skip');
  assert.equal(plan.skipped.length, 3);
  assert.match(plan.skipped[0]!.reason, /快照/);
});

test('快照型与普通测试混合：只跑普通测试', () => {
  const plan = planTestChanges([
    change('M', 'world-client/test/pin-shot-state.test.ts'),
    change('A', 'world-client/test/new-behavior.test.ts'),
  ]);
  assert.equal(plan.kind, 'run');
  assert.deepEqual(plan.run, ['test/new-behavior.test.ts']);
  assert.equal(plan.skipped.length, 1);
});

test('测试支撑文件随 patch 一起套用，但不单独跑', () => {
  const plan = planTestChanges([
    change('M', 'world-client/test/helpers.ts'),
    change('M', 'world-client/test/new-behavior.test.ts'),
  ]);
  assert.equal(plan.kind, 'run');
  assert.deepEqual(plan.support, ['test/helpers.ts']);
});

test('测试被删除：跳过并提示人工核对', () => {
  const plan = planTestChanges([change('D', 'world-client/test/old-behavior.test.ts')]);
  assert.equal(plan.kind, 'skip');
  assert.match(plan.reason ?? '', /快照型\/被删除/);
  assert.match(plan.skipped[0]!.reason, /删除/);
});

test('parseArgs：支持 --base/--repo/--timeout/--keep，空 base 当未给', () => {
  const args = parseArgs([
    '--base',
    '',
    '--repo=.',
    '--timeout',
    '90000',
    '--keep',
  ]);
  assert.equal(args.base, '');
  assert.equal(args.repo, '.');
  assert.equal(args.timeoutMs, 90_000);
  assert.equal(args.keep, true);
});
