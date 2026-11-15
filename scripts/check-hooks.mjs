#!/usr/bin/env node
/**
 * 钩子启用自检：确认 pre-push 真的挂在当前 worktree 上，并验证它有牙齿。
 *
 * 为什么单独一项：`git config core.hooksPath .githooks` 是一次性手工动作，
 * 换机器、换 clone、换 worktree 都不会自动继承。钩子没装时 Git 不会报错，
 * push 照常成功——这条保护会安静地消失。所以这里把「已经启用」变成一条
 * 可以跑、可以红、可以贴进 PR 的读数。
 *
 * 为什么还要跑反向用例：2026-11-07 之前 `PWE_ALLOW_PUSH_MAIN=1` 在钩子开头
 * 整体 `exit 0`，豁免会连带跳过未来加在 pre-push 的所有检查。这里在临时仓里
 * 真跑钩子，覆盖「有豁免 / 无豁免 × main / 非 main × 小文件 / 大文件」，
 * 证明第二道检查在豁免路径下仍然执行。
 *
 * 用法：npm run check:hooks（仓库根目录）；或 node scripts/check-hooks.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let root;
try {
  root = git(['rev-parse', '--show-toplevel']);
} catch {
  console.error('check:hooks FAIL  当前目录不在 git 工作树里');
  process.exit(1);
}

const problems = [];
const warnings = [];

let configured = '';
try {
  configured = git(['config', '--get', 'core.hooksPath']);
} catch {
  configured = '';
}

const expectedDir = resolve(root, '.githooks');
if (configured === '') {
  problems.push('core.hooksPath 未设置，Git 不会执行 .githooks/pre-push');
} else {
  const actualDir = resolve(root, configured);
  if (actualDir.toLowerCase() !== expectedDir.toLowerCase()) {
    problems.push(`core.hooksPath 指向 ${actualDir}，不是 ${expectedDir}`);
  }
}

const hook = resolve(expectedDir, 'pre-push');
if (!existsSync(hook)) {
  problems.push(`${hook} 不存在（当前分支可能还没带上钩子）`);
} else {
  let mode = '';
  try {
    mode = git(['ls-files', '-s', '.githooks/pre-push']).split(/\s+/)[0] ?? '';
  } catch {
    mode = '';
  }
  if (mode !== '' && mode !== '100755') {
    warnings.push(`.githooks/pre-push 的索引模式是 ${mode}；Linux/macOS 需要 100755 才会执行`);
  }
}

/**
 * 在临时仓里真跑 pre-push，验证两道检查的四种组合。
 * 用 `git hook run --to-stdin` 走 Git 自己的解释器，避免依赖 `sh` 在 PATH 里。
 */
function runHookScenarios(hookSource) {
  const dir = mkdtempSync(join(tmpdir(), 'pwe-pre-push-'));
  const ZERO = '0000000000000000000000000000000000000000';
  const inDir = (args, extra = {}) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8', ...extra });

  try {
    const init = inDir(['init', '-q']);
    if (init.status !== 0) throw new Error(`git init 失败：${init.stderr}`);

    for (const [key, value] of [
      ['user.email', 'hook-test@example.com'],
      ['user.name', 'hook-test'],
      ['commit.gpgsign', 'false'],
    ]) {
      inDir(['config', key, value]);
    }

    const commit = (name, bytes) => {
      writeFileSync(join(dir, name), 'x'.repeat(bytes));
      inDir(['add', name]);
      const made = inDir(['commit', '-q', '-m', `add ${name}`]);
      if (made.status !== 0) throw new Error(`git commit 失败：${made.stderr}`);
      return inDir(['rev-parse', 'HEAD']).stdout.trim();
    };
    const small = commit('small.txt', 10);
    const big = commit('big.txt', 100);

    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    const hookPath = join(dir, '.git', 'hooks', 'pre-push');
    copyFileSync(hookSource, hookPath);
    chmodSync(hookPath, 0o755);

    let stdinSeq = 0;
    const run = (localRef, localSha, stdinRemoteSha, env) => {
      stdinSeq += 1;
      const stdinPath = join(dir, `stdin-${stdinSeq}.txt`);
      writeFileSync(stdinPath, `${localRef} ${localSha} ${localRef} ${stdinRemoteSha}\n`);
      const result = inDir(['hook', 'run', `--to-stdin=${stdinPath}`, 'pre-push'], {
        env: {
          ...process.env,
          PWE_PREPUSH_MAX_BLOB_BYTES: '60',
          ...env,
        },
      });
      return { status: result.status, stderr: result.stderr ?? '' };
    };

    const cases = [
      {
        label: '无豁免 + main + 小文件 → 拦 main',
        actual: run('refs/heads/main', small, ZERO, {}),
        expectedStatus: 1,
        expectText: ['拒绝直推 main'],
      },
      {
        label: '有豁免 + main + 小文件 → 放行',
        actual: run('refs/heads/main', small, ZERO, { PWE_ALLOW_PUSH_MAIN: '1' }),
        expectedStatus: 0,
        expectText: ['仅跳过 main 保护'],
      },
      {
        label: '有豁免 + main + 大文件 → 大文件检查仍然执行',
        actual: run('refs/heads/main', big, ZERO, { PWE_ALLOW_PUSH_MAIN: '1' }),
        expectedStatus: 1,
        expectText: ['新增 blob 超过'],
      },
      {
        label: '无豁免 + 非 main + 大文件 → 大文件检查独立生效',
        actual: run('refs/heads/feat/x', big, ZERO, {}),
        expectedStatus: 1,
        expectText: ['新增 blob 超过'],
      },
      {
        label: '无豁免 + 非 main + 小文件 → 放行',
        actual: run('refs/heads/feat/x', small, ZERO, {}),
        expectedStatus: 0,
        expectText: [],
      },
    ];

    for (const item of cases) {
      const { label, actual, expectedStatus, expectText } = item;
      const okStatus = actual.status === expectedStatus;
      const okText = expectText.every((text) => actual.stderr.includes(text));
      if (!okStatus || !okText) {
        problems.push(
          `反向用例失败：${label}（期望 exit ${expectedStatus}，实得 ${actual.status}；`
            + `期望 stderr 含 ${JSON.stringify(expectText)}）`,
        );
      } else {
        console.log(`  ✓ ${label}（exit ${actual.status}）`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const status = problems.length === 0 ? 'OK  ' : 'FAIL';
console.log(
  `hooks: ${status} core.hooksPath=${configured || '(unset)'} pre-push=${existsSync(hook) ? 'present' : 'missing'}`,
);

if (existsSync(hook)) runHookScenarios(hook);

if (problems.length > 0) {
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log('  修复：git config core.hooksPath .githooks');
  process.exitCode = 1;
}
for (const warning of warnings) console.log(`  ! ${warning}`);
