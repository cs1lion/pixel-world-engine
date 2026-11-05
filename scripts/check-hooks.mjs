#!/usr/bin/env node
/**
 * 钩子启用自检：确认 pre-push 真的挂在当前 worktree 上。
 *
 * 为什么单独一项：`git config core.hooksPath .githooks` 是一次性手工动作，
 * 换机器、换 clone、换 worktree 都不会自动继承。钩子没装时 Git 不会报错，
 * push 照常成功——这条保护会安静地消失。所以这里把「已经启用」变成一条
 * 可以跑、可以红、可以贴进 PR 的读数。
 *
 * 用法：npm run check:hooks（仓库根目录）；或 node scripts/check-hooks.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

const status = problems.length === 0 ? 'OK  ' : 'FAIL';
console.log(
  `hooks: ${status} core.hooksPath=${configured || '(unset)'} pre-push=${existsSync(hook) ? 'present' : 'missing'}`,
);

if (problems.length > 0) {
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log('  修复：git config core.hooksPath .githooks');
  process.exitCode = 1;
}
for (const warning of warnings) console.log(`  ! ${warning}`);
