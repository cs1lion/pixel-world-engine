/**
 * red-first：本次改动的测试，在「没有本次实现」的 base 上必须红。
 *
 * 机制：取 base → 建临时 detached worktree → 只把 `world-client/test/` 的
 * diff 套上去 → 用 base 的源码 + 本次的测试跑一遍 → 必须**红在断言上**。
 *
 * 判定（exit code 三值）：
 *   0 = PASS（base 上因断言失败而红）或 SKIP（合理跳过）；
 *   1 = FAIL（base 上直接绿，不是先红后绿）；
 *   2 = ERROR（非零退出，但不是断言失败：module / compile / crash / unknown）。
 *
 * 只有「测试跑到了断言、并因为缺实现而失败」才算合格的红。import 写错、
 * 语法/转译失败、进程崩溃都会非零退出，但那是测试没跑起来，不是先红后绿；
 * 一律判 ERROR，不可采信。能区分「红得对不对」是这条闸门唯一的价值，
 * 否则它只是又一个 exit code 检查。
 *
 * base 选择（按优先级）：
 *   1. `--base <ref>` / `RED_FIRST_BASE`；
 *   2. `git merge-base HEAD origin/main`（分支工作流：分叉点）；
 *   3. `HEAD~1`（直接推 main 的工作流：上一次提交/上一次 main）。
 *
 * 盲区：
 *   - 直接推 main 且一次推多个提交时，`HEAD~1` 只覆盖最后一个提交；CI 里应传
 *     `github.event.before`（上一次 main 的 sha），本脚本也支持。
 *   - `origin/main` 是本地引用，可能没 fetch；CI 里用事件 sha 更准。
 *   - base 本身已经坏、或测试的失败被 base 的其它错误掩盖时，判据会失真。
 *   - 只套 `world-client/test/` 的 diff；如果新测试依赖 test/ 之外的新夹具/
 *     新依赖，base 上会因缺文件报 ERR_MODULE_NOT_FOUND → 判 ERROR（module），
 *     不可采信。这是有意的：那种红不是断言抓到了缺失。
 *
 * 跳过条件（不是放行，见 `red-first-lib.ts` 的注释）：
 *   - 只改文档/其它目录；
 *   - 测试 diff 为空（只改测试以外、纯重构）；
 *   - 测试文件被删除；
 *   - 快照型参数化用例（pin-shot-state / fixture-self-check / eval-fixture-hash）。
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBaseFailure, parseArgs, planTestChanges, type ChangedFile } from './red-first-lib.ts';

interface RunResult {
  status: number;
  output: string;
}

function git(args: string[], cwd: string, input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input }).toString();
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

function resolveBase(repo: string, explicit: string): { ref: string; source: string } {
  if (explicit && !explicit.startsWith('0000000')) {
    git(['rev-parse', '--verify', `${explicit}^{commit}`], repo);
    return { ref: explicit, source: '--base/RED_FIRST_BASE' };
  }

  const originMain = tryGit(['rev-parse', '--verify', 'origin/main^{commit}'], repo);
  if (originMain) {
    const mergeBase = tryGit(['merge-base', 'HEAD', originMain.trim()], repo);
    if (mergeBase) {
      const sha = mergeBase.trim();
      const head = git(['rev-parse', 'HEAD'], repo).trim();
      if (sha !== head) {
        return { ref: sha, source: 'merge-base(HEAD, origin/main)' };
      }
    }
  }

  const parent = tryGit(['rev-parse', '--verify', 'HEAD~1^{commit}'], repo);
  if (parent) return { ref: parent.trim(), source: 'HEAD~1' };

  throw new Error('找不到可用的 base：--base、origin/main、HEAD~1 都不可用');
}

function changedFiles(repo: string, base: string): ChangedFile[] {
  const raw = git(['diff', '--name-status', '-M', `${base}..HEAD`, '--', 'world-client'], repo);
  const changes: ChangedFile[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    if (status.startsWith('R') && parts.length >= 3) {
      changes.push({ status: 'R', path: parts[2] ?? '' });
    } else if (parts.length >= 2) {
      changes.push({ status, path: parts[1] ?? '' });
    }
  }
  return changes;
}

function linkNodeModules(repo: string, worktree: string): void {
  const pairs = [
    ['node_modules', join(repo, 'node_modules')],
    [join('world-client', 'node_modules'), join(repo, 'world-client', 'node_modules')],
  ] as const;
  for (const [relative, target] of pairs) {
    if (!existsSync(target)) continue;
    const link = join(worktree, relative);
    if (existsSync(link)) continue;
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

function unlinkNodeModules(worktree: string): void {
  for (const relative of ['node_modules', join('world-client', 'node_modules')]) {
    const link = join(worktree, relative);
    if (!existsSync(link)) continue;
    try {
      readlinkSync(link);
    } catch {
      continue; // 不是链接，别动它
    }
    try {
      if (process.platform === 'win32') rmdirSync(link);
      else unlinkSync(link);
    } catch {
      rmSync(link, { recursive: false, force: true });
    }
  }
}

function removeWorktree(repo: string, worktree: string): void {
  unlinkNodeModules(worktree);
  try {
    git(['worktree', 'remove', '--force', worktree], repo);
  } catch {
    try {
      rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 留给 git worktree prune
    }
    tryGit(['worktree', 'prune'], repo);
  }
}

function runTests(worktree: string, files: string[], timeoutMs: number): RunResult {
  const child = execFileSync(
    process.execPath,
    ['--import', './test/phaser-hooks.mjs', '--test', '--test-reporter=spec', ...files],
    {
      cwd: join(worktree, 'world-client'),
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RED_FIRST: '1' },
    },
  );
  return { status: 0, output: String(child) };
}

function tail(text: string, lines = 18): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
}

function main(): void {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.repo ? resolve(args.repo) : process.cwd();
  const repo = repoRoot(cwd);

  const { ref: base, source } = resolveBase(repo, args.base || process.env.RED_FIRST_BASE || '');
  const changes = changedFiles(repo, base);
  const plan = planTestChanges(changes);

  console.log(`red-first: base=${base} source=${source}`);
  if (plan.kind === 'skip') {
    console.log(`red-first: SKIP ${plan.reason}`);
    for (const entry of plan.skipped) console.log(`red-first:   skip ${entry.file} — ${entry.reason}`);
    console.log(`red-first: RESULT=SKIP elapsed=${Date.now() - started}ms`);
    return;
  }

  for (const entry of plan.skipped) console.log(`red-first: skip ${entry.file} — ${entry.reason}`);
  console.log(`red-first: files=${plan.run.join(', ')}`);

  const worktree = mkdtempSync(join(tmpdir(), 'pwe-red-first-'));
  rmSync(worktree, { recursive: true, force: true });
  try {
    git(['worktree', 'add', '-q', '--detach', worktree, base], repo);
    const patch = git(['diff', '--binary', `${base}..HEAD`, '--', 'world-client/test'], repo);
    if (!patch.trim()) {
      console.log('red-first: SKIP 测试 diff 为空（patch 为空）');
      return;
    }
    execFileSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: worktree, input: patch });
    linkNodeModules(repo, worktree);

    let result: RunResult;
    try {
      result = runTests(worktree, plan.run, args.timeoutMs);
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        status?: number;
        signal?: string;
        killed?: boolean;
        stdout?: string;
        stderr?: string;
      };
      if (err.code === 'ETIMEDOUT' || err.signal) {
        console.error(`red-first: ERROR 测试超时/被杀（${args.timeoutMs}ms）`);
        console.error(tail(String(err.message ?? err)));
        process.exitCode = 2;
        return;
      }
      if (typeof err.status === 'number' && err.status > 0) {
        result = { status: err.status, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      } else {
        console.error(`red-first: ERROR 无法启动测试：${err.message}`);
        process.exitCode = 2;
        return;
      }
    }

    if (result.status === 0) {
      console.error('red-first: FAIL 测试在 base 上已经绿；这不是「先红后绿」，判红。');
      console.error(tail(result.output));
      process.exitCode = 1;
      return;
    }

    const kind = classifyBaseFailure(result.output);
    if (kind !== 'assertion') {
      console.error(`red-first: ERROR 非断言失败（分类=${kind}）；这次红不可采信，不放行。`);
      if (kind === 'compile' && /does not provide an export named/.test(result.output)) {
        console.error(
          'red-first: 提示：测试静态 import 了 base 上还不存在的新导出。' +
            '改为动态 import + `typeof fn === "function"` 断言（见 docs/OPEN_ISSUES.md B7）。',
        );
      }
      console.error(tail(result.output));
      console.error(`red-first: RESULT=ERROR kind=${kind} elapsed=${Date.now() - started}ms`);
      process.exitCode = 2;
      return;
    }

    console.log(`red-first: PASS base 上按预期红（断言失败，exit=${result.status}）`);
    console.log(tail(result.output));
    console.log(`red-first: RESULT=RED elapsed=${Date.now() - started}ms`);
  } finally {
    if (args.keep) {
      console.log(`red-first: kept worktree ${worktree}`);
    } else {
      removeWorktree(repo, worktree);
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`red-first: ERROR ${(error as Error).message}`);
    process.exitCode = 2;
  }
}
