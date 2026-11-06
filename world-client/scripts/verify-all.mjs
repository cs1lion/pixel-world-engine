/**
 * 可验证流程的统一入口。
 *
 * 只串「当前 checkout 能离线跑」的流程；浏览器流程与只存在于别的 worktree 的流程
 * 一律显式 SKIP 并打印原因，不伪装成绿。
 *
 * 跑法（cwd = world-client）：
 *   node scripts/verify-all.mjs            # 跑全部当前可跑的
 *   node scripts/verify-all.mjs --list     # 只列流程与状态
 *   node scripts/verify-all.mjs --only palette-9,eval-ledger
 *   node scripts/verify-all.mjs --self-test  # 反向验证：注入必红项，确认整体退出非零
 * 退出码：任一 FAIL → 1；全部 pass/skip → 0。
 * 读数：tmp/verify-all/last-run.json 与 tmp/verify-all/logs/<id>.log
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.VERIFY_ALL_OUT
  ? resolve(process.env.VERIFY_ALL_OUT)
  : resolve(ROOT, 'tmp/verify-all');
const NODE = process.execPath;
const PYTHON = process.env.PYTHON || 'python';
const TEST_IMPORT = ['./test/phaser-hooks.mjs'];

const CHECKS = [
  {
    id: 'pin-contract',
    title: '钉子契约（23 条守卫）',
    commands: [[NODE, [...TEST_IMPORT, '--test', 'test/pin-shot-state.test.ts']]],
  },
  {
    id: 'screens-diff-selfcheck',
    title: '结构差判据（精确/可见/结构，含红例）',
    commands: [[PYTHON, ['scripts/verify-screens-diff-selfcheck.py']]],
  },
  {
    id: 'phase-frames',
    title: '相位帧弱判据（仅 pwe-anim）',
    when: () => {
      if (!existsSync(resolve(ROOT, 'scripts/check-phase-frames.mjs'))) {
        return '仅存在于 pwe-anim（feat/animation-express），当前 checkout 无脚本';
      }
      const ref = resolve(ROOT, '..', 'tmp/anim-verify/r1/screens');
      const cur = resolve(ROOT, '..', 'tmp/anim-verify/r2/screens');
      if (!existsSync(ref) || !existsSync(cur)) return '缺 r1/r2 两跑截图目录（tmp/anim-verify）';
      return null;
    },
    commands: [[NODE, ['scripts/check-phase-frames.mjs', '--ref', '../tmp/anim-verify/r1/screens', '--cur', '../tmp/anim-verify/r2/screens']]],
  },
  {
    id: 'render-budget-threshold',
    title: '后台降频双条件（纯函数边界）',
    commands: [[NODE, [...TEST_IMPORT, '--test', 'test/render-budget-throttle.test.ts']]],
  },
  {
    id: 'palette-9',
    title: '入口配色 9 色位',
    commands: [
      [NODE, ['scripts/audit-palette.mjs', '--strict']],
      [NODE, [...TEST_IMPORT, '--test', 'test/palette-budget.test.ts']],
    ],
  },
  {
    id: 'fatigue-homecoming',
    title: '疲劳/睡眠/回家',
    commands: [[NODE, [...TEST_IMPORT, '--test', '--test-concurrency=1', 'test/fatigue.test.ts', 'test/homecoming.test.ts']]],
  },
  {
    id: 'behavior-needs',
    title: '环境/观察/行为/需求/交付失败',
    commands: [[
      NODE,
      [
        ...TEST_IMPORT,
        '--test',
        '--test-concurrency=1',
        'test/environment-frame.test.ts',
        'test/observation-rules.test.ts',
        'test/behavior-queue.test.ts',
        'test/needs.test.ts',
        'test/needs-failure.test.ts',
        'test/delivery-failure-event.test.ts',
      ],
    ]],
  },
  {
    id: 'eval-ledger',
    title: '指标账本与旁证分桶',
    commands: [
      [NODE, ['scripts/eval-ledger.ts']],
      [NODE, ['scripts/verify-ledger-selfcheck.ts']],
      [NODE, [...TEST_IMPORT, '--test', 'test/memory-witnessed-corroboration.test.ts']],
    ],
  },
  {
    id: 'animation-baseline',
    title: '动画基线账本结构（157 行）',
    when: () => {
      const doc = resolve(ROOT, '..', '..', 'pwe-anim/docs/evidence/animation-express/SCREENSHOT_BASELINE_CHANGES.md');
      return existsSync(doc) ? null : '找不到 pwe-anim 的 SCREENSHOT_BASELINE_CHANGES.md';
    },
    allowExit2: true,
    commands: [[NODE, ['scripts/verify-animation-baseline.mjs']]],
  },
];

const OUT_OF_AGGREGATE = [
  ['pin-actor-frames', '需要浏览器 + 本地服务（默认 5211）；EVAL_OUT 六图与 runs.json 当前未落盘'],
  ['capture-ledger', '四个抓拍脚本需要浏览器 + 本地服务；pixel-ledger/compare-ledger 只在 pwe-anim'],
  ['phase-frames 真跑', '需要 Chromium；主仓无脚本，pwe-anim 需 r1/r2/r3 截图目录'],
  ['render-budget 浏览器六项', '需要浏览器 + 本地服务；离线只覆盖纯函数边界'],
  ['smoke/phases/persistence/buttons', '需要浏览器 + 本地服务；test:buttons 仍因 /api/memory/list 404 退出 2'],
];

function parseArgs(argv) {
  const args = { only: null, list: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--list') args.list = true;
    else if (argv[i] === '--self-test') args.selfTest = true;
    else if (argv[i] === '--only') args.only = (argv[++i] || '').split(',').filter(Boolean);
  }
  return args;
}

function writeLog(id, text) {
  mkdirSync(resolve(OUT, 'logs'), { recursive: true });
  writeFileSync(resolve(OUT, 'logs', `${id}.log`), text, 'utf8');
}

function runCommand(command, id) {
  const [cmd, args] = command;
  const started = Date.now();
  const proc = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    timeout: 600_000,
    encoding: 'utf8',
    shell: false,
  });
  const output = [
    `$ ${cmd} ${args.join(' ')}`,
    `exit=${proc.status} signal=${proc.signal ?? '-'} ms=${Date.now() - started}`,
    proc.stdout ?? '',
    proc.stderr ?? '',
  ].join('\n');
  writeLog(id, output);
  return { status: proc.status, error: proc.error, output };
}

function runCheck(check) {
  const skipReason = check.when ? check.when() : null;
  if (skipReason) {
    console.log(`SKIP  ${check.id.padEnd(24)} ${skipReason}`);
    return { id: check.id, title: check.title, status: 'skip', reason: skipReason };
  }
  console.log(`RUN   ${check.id.padEnd(24)} ${check.title}`);
  for (const command of check.commands) {
    const result = runCommand(command, check.id);
    const fail = result.error || result.status !== 0;
    const skipByExit2 = check.allowExit2 && result.status === 2;
    if (skipByExit2) {
      console.log(`SKIP  ${check.id.padEnd(24)} exit=2（不可判，不计绿）`);
      return { id: check.id, title: check.title, status: 'skip', reason: 'exit=2 不可判' };
    }
    if (fail) {
      const tail = result.output.split(/\r?\n/).slice(-6).join(' | ');
      console.log(`FAIL  ${check.id.padEnd(24)} ${result.error ? result.error.message : `exit=${result.status}`} ${tail}`);
      return { id: check.id, title: check.title, status: 'fail', exit: result.status, log: `tmp/verify-all/logs/${check.id}.log` };
    }
  }
  console.log(`PASS  ${check.id.padEnd(24)}`);
  return { id: check.id, title: check.title, status: 'pass', log: `tmp/verify-all/logs/${check.id}.log` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const check of CHECKS) {
      const reason = check.when ? check.when() : null;
      console.log(`${reason ? 'SKIP' : 'RUN '}  ${check.id.padEnd(24)} ${check.title}${reason ? `  (${reason})` : ''}`);
    }
    console.log('\n不进入汇总入口：');
    for (const [name, reason] of OUT_OF_AGGREGATE) console.log(`SKIP  ${name}: ${reason}`);
    return 0;
  }

  if (args.selfTest) {
    console.log('自检：注入一条必红命令，确认汇总入口能整体判红。');
    const results = [runCheck({
      id: 'self-check-must-fail',
      title: '注入必红项',
      commands: [[NODE, ['-e', 'process.exit(1)']]],
    })];
    const red = results.some((result) => result.status === 'fail');
    console.log(red ? '\n自检通过：必红项使整体判红。' : '\n自检失败：必红项没有判红。');
    return red ? 0 : 1;
  }

  const selected = args.only ? CHECKS.filter((check) => args.only.includes(check.id)) : CHECKS;
  if (selected.length === 0) {
    console.error(`--only 没有匹配任何流程：${args.only.join(',')}`);
    return 2;
  }

  mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const results = selected.map(runCheck);
  const summary = {
    generatedAt: new Date().toISOString(),
    cwd: ROOT,
    elapsedMs: Date.now() - started,
    counts: {
      pass: results.filter((result) => result.status === 'pass').length,
      fail: results.filter((result) => result.status === 'fail').length,
      skip: results.filter((result) => result.status === 'skip').length,
    },
    results,
  };
  writeFileSync(resolve(OUT, 'last-run.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`\n汇总：pass=${summary.counts.pass} fail=${summary.counts.fail} skip=${summary.counts.skip} elapsed=${summary.elapsedMs}ms`);
  console.log(`读数：${resolve(OUT, 'last-run.json')}`);
  return summary.counts.fail > 0 ? 1 : 0;
}

process.exit(main());
