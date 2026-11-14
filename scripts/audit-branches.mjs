/**
 * 远端分支卫生巡检（报告型，与 `worktrees-audit.mjs` 同类）。
 *
 * 判据来自 `docs/BRANCH_EXCEPTIONS.md` 那张表——它是例外登记的单一真相。
 * 默认只报告；`--strict` 下三类问题判红：
 *   1. 远端有表里没登记的分支（合入即删是默认，例外必须写进表里）；
 *   2. 表项悬空（表里写了、远端已经没有）；
 *   3. 例外过了「到期复核」日期还没人复核。
 *
 * 拿不到远端清单时**明确说跳过**、退出 0：离线把全仓分支判成「未登记」是误报，
 * 比不查更糟。CI 的 repo-harness 里跑 --strict；本地随时可跑无参版本看全貌。
 *
 * 不删任何东西。删除动作归 owner，见 BRANCH_HYGIENE.md。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'docs', 'BRANCH_EXCEPTIONS.md');
const STRICT = process.argv.includes('--strict');

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** 解析例外表：只认「分支 / 类型 / 理由 / 到期复核 / 处置」这五列的主表。 */
function readRegistry() {
  const text = readFileSync(REGISTRY, 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const [branchCell, kind, reason, due, action] = cells;
    const branch = (branchCell ?? '').replace(/^`|`$/g, '');
    // 跳过表头、分隔行、以及「已归档」那张四列 tag 表。
    if (branch === '分支' || branch === '归档 tag' || /^-+$/.test(branch)) continue;
    if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch)) continue;
    rows.push({ branch, kind, reason, due, action });
  }
  return rows;
}

/** 在途分支 = 当前检出分支 + 本 PR head + 所有 OPEN PR 的 head。
 *  它们是在做的工作，不是堆积；不排除的话 strict 会把自己的 PR、以及并行 PR
 *  的分支全判成「未登记」。合入后自动删分支会收掉，不需要登记。
 *  gh 不可用（CI 无 token / 离线）时退化到前两项，并明确写进报告。 */
function inFlightBranches() {
  const set = new Set(
    [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME].filter(Boolean),
  );
  try {
    const current = git('branch', '--show-current');
    if (current) set.add(current);
  } catch {
    // detached HEAD：没有当前分支，正常。
  }
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'headRefName', '--jq', '.[].headRefName'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    for (const line of out.trim().split('\n')) if (line.trim()) set.add(line.trim());
  } catch {
    console.log('branches-audit: gh 不可用，退化到 GITHUB_HEAD_REF + 当前检出分支');
  }
  return set;
}

function remoteBranches(registered) {
  const inFlight = inFlightBranches();
  const out = git('ls-remote', '--heads', 'origin');
  return out
    .split('\n')
    .map((line) => line.match(/^[0-9a-f]+\s+refs\/heads\/(.+)$/)?.[1])
    .filter(
      (name) =>
        name !== undefined &&
        name !== 'main' &&
        // 已登记的例外永远留在清单里：它可能同时有 OPEN PR（例如 #30），
        // 被在途排除掉反而会把表项误报成「悬空」。
        (registered.has(name) || !inFlight.has(name)),
    )
    .sort();
}

/** 有独立提交的分支，用 patch-id 判那些提交是不是其实已经进了 main。 */
function patchState(branch) {
  try {
    // CI 是浅克隆，只有 main；-q 且收掉 stderr，别把「本地没有这个对象」
    // 打成红色 fatal 混进日志——那不是失败，下面会照实写「未判提交」。
    const sha = execFileSync('git', ['rev-parse', '--verify', '-q', `origin/${branch}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (sha === '') return null;
    const ahead = Number(git('rev-list', '--count', `origin/main..${sha}`));
    if (ahead === 0) return { ahead, unmergedPatches: 0 };
    const cherry = git('cherry', 'origin/main', sha);
    const plus = cherry.split('\n').filter((line) => line.startsWith('+')).length;
    return { ahead, unmergedPatches: plus };
  } catch {
    return null;
  }
}

function today() {
  // 运维巡检用**本地日历日**：UTC 的 ISO 串在东八区上午会少一天，
  // 让「到期复核」凭空早判一天。世界模拟的确定性约束不适用于这里。
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function main() {
  const registry = readRegistry();
  const known = new Set(registry.map((row) => row.branch));
  const problems = [];

  let branches = null;
  try {
    branches = remoteBranches(new Set(registry.map((row) => row.branch)));
  } catch (error) {
    console.log(`branches-audit: SKIP 远端盘点（拿不到 origin 清单）：${error.message ?? error}`);
    // 离线时仍校验登记表本身，避免「跳过」变成「什么都没查」。
  }

  console.log('=== 远端分支卫生巡检 ===');
  console.log(`登记表: docs/BRANCH_EXCEPTIONS.md（${registry.length} 条例外）`);
  console.log(`模式: ${STRICT ? 'strict' : 'report'}　日期: ${today()}`);

  if (branches !== null) {
    console.log(`\n远端分支（除 main）：${branches.length === 0 ? '无' : branches.length + ' 个'}`);
    for (const branch of branches) {
      const registered = known.has(branch);
      const state = patchState(branch);
      const stateText = state === null
        ? '本地无该分支对象，未判提交'
        : state.ahead === 0
          ? 'ahead=0（已完全包含）'
          : `ahead=${state.ahead}，未合入 patch=${state.unmergedPatches}`;
      console.log(`  - ${branch.padEnd(32)} ${registered ? '已登记例外' : '未登记'}　${stateText}`);
      if (!registered) problems.push(`未登记的远端分支：${branch}（合入即删是默认；有意保留请写进例外表）`);
    }
    for (const row of registry) {
      if (!branches.includes(row.branch)) {
        problems.push(`表项悬空：${row.branch} 远端已不存在，请删掉这一行`);
      }
    }
  } else {
    console.log('\n（离线：跳过「未登记 / 悬空」判定，仅做登记表校验）');
  }

  for (const row of registry) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.due)) {
      problems.push(`${row.branch} 的「到期复核」不是 YYYY-MM-DD：${row.due}`);
    } else if (row.due < today()) {
      problems.push(`${row.branch} 的到期复核日 ${row.due} 已过，请复核并更新日期或删分支`);
    }
    if (!row.reason || row.reason.length < 8) {
      problems.push(`${row.branch} 的「理由」太短，要写清为什么不合`);
    }
  }

  if (problems.length === 0) {
    console.log('\n结论：无未登记分支、无悬空表项、例外都在有效期内。');
    return;
  }
  console.log(`\n发现 ${problems.length} 项：`);
  for (const problem of problems) console.log(`  ! ${problem}`);
  if (STRICT) {
    console.error('branches-audit: FAIL（strict）');
    process.exitCode = 1;
  } else {
    console.log('（report 模式不阻断；CI 与合入前请跑 --strict）');
  }
}

main();
