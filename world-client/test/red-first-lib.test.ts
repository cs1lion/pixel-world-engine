import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, planTestChanges, type ChangedFile } from '../scripts/red-first-lib.ts';

/**
 * 分类器在 base 上可能还不存在。用动态 import + 属性断言，让「缺实现」表现为
 * 断言失败（而不是 ERR_MODULE_NOT_FOUND / 缺命名导出），这样 red-first 闸门
 * 才能把这条测试判成合格的红。
 */
type ClassifierModule = {
  classifyBaseFailure?: (output: string) => string;
  explainBaseFailure?: (output: string) => {
    kind: string;
    pattern: string | null;
    line: number | null;
    matched: string | null;
    file: string | null;
    fileLine: number | null;
    context: string[];
  };
};
const loadClassifier = async (): Promise<ClassifierModule> =>
  (await import('../scripts/red-first-lib.ts')) as unknown as ClassifierModule;

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

test('失败分类：断言失败才算合格的红', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  const output = [
    '✖ 正常新测试 (2ms)',
    '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
    '  + actual - expected',
    '  + 3',
    '  - 4',
  ].join('\n');
  assert.equal(lib.classifyBaseFailure!(output), 'assertion');
});

test('失败分类：import 不存在判 module，不冒充断言', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  const output = [
    '✖ test/red-first-probe.test.ts',
    "  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'file:///tmp/red-first-probe.ts'",
  ].join('\n');
  assert.equal(lib.classifyBaseFailure!(output), 'module');
});

test('失败分类：语法/类型失败判 compile', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  assert.equal(lib.classifyBaseFailure!("SyntaxError: Unexpected token 'export'"), 'compile');
  assert.equal(lib.classifyBaseFailure!('src/a.ts(3,5): error TS2322: Type is not assignable'), 'compile');
});

test('失败分类：进程崩溃判 crash', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  assert.equal(lib.classifyBaseFailure!('FATAL ERROR: Reached heap limit Allocation failed'), 'crash');
});

test('失败分类：没有任何测试信号判 unknown', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  assert.equal(lib.classifyBaseFailure!(''), 'unknown');
  assert.equal(lib.classifyBaseFailure!('some unexpected stderr noise'), 'unknown');
});

test('失败分类：import 错误与断言文字同时出现时，按 module 处理', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  const output = [
    'AssertionError [ERR_ASSERTION]: nope',
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'x'",
  ].join('\n');
  assert.equal(lib.classifyBaseFailure!(output), 'module');
});

test('失败分类：测试级超时按断言失败处理', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  assert.equal(lib.classifyBaseFailure!("failureType: 'testTimeoutFailure'"), 'assertion');
});

test('失败分类：断言消息里引用 Node 原文时，仍按断言处理', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.classifyBaseFailure, 'function');
  const output = [
    '✖ 无钩子（环境不支持）→ 判红 (4ms)',
    "  AssertionError [ERR_ASSERTION]: 模块缺 assertMeasuredReading：Cannot find module '/tmp/x.mjs' imported from /tmp/t.ts",
  ].join('\n');
  assert.equal(lib.classifyBaseFailure!(output), 'assertion');
});

test('诊断：module 红要指到命中的规则、行号与出错文件', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.explainBaseFailure, 'function');
  const output = [
    '✖ test/check-setting-scale-probe.test.ts',
    "  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/x/scripts/lib/setting-scale-probe.mjs'",
    '  imported from /tmp/x/test/check-setting-scale-probe.test.ts',
  ].join('\n');
  const evidence = lib.explainBaseFailure!(output);
  assert.equal(evidence.kind, 'module');
  assert.equal(evidence.pattern, 'ERR_MODULE_NOT_FOUND');
  assert.equal(evidence.line, 2, '要说清是全量输出里的第几行，不是 tail 里的第几行');
  assert.match(evidence.matched ?? '', /Cannot find module/);
  assert.match(evidence.file ?? '', /test[/\\]check-setting-scale-probe\.test\.ts$/);
  assert.ok(evidence.context.length > 0, '上下文要一起给出来');
});

test('诊断：compile 红要找到错误消息上方那个出错文件与行号', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.explainBaseFailure, 'function');
  // 拼出来：源码里不留「路径 + 冒号 + 行号」的字面形状，否则 audit-references
  // 会把这条夹具当成一处真的引用去查（它连自己的测试数据一起审）。
  const site = ['file:///tmp/pwe/x/world-client/test/audit-references.test.ts', ':2', '0'].join('');
  const output = [
    site,
    "import { silentWindow } from '../scripts/audit-scan-guard-lib.ts';",
    '         ^^^^^^^^^^^^',
    "SyntaxError: The requested module '../scripts/audit-scan-guard-lib.ts' does not provide an export named 'silentWindow'",
  ].join('\n');
  const evidence = lib.explainBaseFailure!(output);
  assert.equal(evidence.kind, 'compile');
  assert.equal(evidence.pattern, 'SyntaxError');
  assert.equal(evidence.file, '/tmp/pwe/x/world-client/test/audit-references.test.ts');
  assert.equal(evidence.fileLine, 20);
});

test('诊断：没有任何信号时字段留空，不编造现场', async () => {
  const lib = await loadClassifier();
  assert.equal(typeof lib.explainBaseFailure, 'function');
  const evidence = lib.explainBaseFailure!('some unexpected stderr noise');
  assert.equal(evidence.kind, 'unknown');
  assert.equal(evidence.pattern, null);
  assert.equal(evidence.line, null);
  assert.deepEqual(evidence.context, []);
});
