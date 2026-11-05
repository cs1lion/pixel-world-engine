#!/usr/bin/env node
/**
 * worktree 登记巡检：把「谁在用哪个 worktree、什么时候该回收」变成可读读数。
 *
 * 只读，不删除任何 worktree。判定分三种，输出里各自成段：
 *   1. 未登记：`git worktree list` 里有，但 docs/WORKTREES.md 表里没有。
 *   2. 过期未回收：预计回收时间已到，且状态不是「不回收」。
 *   3. 已合入未回收：分支已经并进 main，但 worktree 还在（回收候选，需人确认）。
 *
 * 用法：
 *   npm run worktrees:audit            # 仓库根目录
 *   node scripts/worktrees-audit.mjs --strict
 *   PWE_WORKTREE_TTL_DAYS=7 node scripts/worktrees-audit.mjs
 *
 * --strict 下「未登记」或「过期未回收」会 exit 1；「已合入未回收」只提示，
 * 因为合并后是否立刻回收由 owner 判断（本脚本不替你删）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const STRICT = process.argv.includes('--strict');
const TTL_DAYS = Number.parseInt(process.env.PWE_WORKTREE_TTL_DAYS ?? '14', 10) || 14;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const root = git(['rev-parse', '--show-toplevel']);
const registryPath = resolve(root, 'docs', 'WORKTREES.md');

function normalize(value) {
  return resolve(value).toLowerCase();
}

function dayOf(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

/**
 * 解析 docs/WORKTREES.md 里的登记表。
 *
 * 文档里可能还有别的表（比如判定口径），所以按「表头同时包含 路径 与 分支」
 * 选中一张，而不是拿第一张表。列名固定，行内容缺列按空串处理。
 */
function readRegistry() {
  if (!existsSync(registryPath)) return new Map();
  const lines = readFileSync(registryPath, 'utf8').split(/\r?\n/);
  const tables = [];
  let block = [];
  for (const line of lines) {
    if (line.startsWith('|')) {
      block.push(line);
    } else if (block.length > 0) {
      tables.push(block);
      block = [];
    }
  }
  if (block.length > 0) tables.push(block);

  const rows = new Map();
  for (const table of tables) {
    const header = table[0]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!header.includes('路径') || !header.includes('分支')) continue;
    for (const line of table.slice(1)) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      const row = {};
      header.forEach((name, index) => {
        row[name] = cells[index] ?? '';
      });
      if (row['路径'] !== undefined && row['路径'] !== '') {
        rows.set(normalize(row['路径']), row);
      }
    }
    break;
  }
  return rows;
}

function listWorktrees() {
  const out = git(['worktree', 'list', '--porcelain']);
  const blocks = out.split(/\r?\n\r?\n/).filter((block) => block.trim() !== '');
  return blocks.map((block) => {
    const info = { path: '', head: '', branch: null };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) info.path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) info.head = line.slice('HEAD '.length);
      else if (line.startsWith('branch ')) info.branch = line.slice('branch '.length);
    }
    return info;
  });
}

function branchName(ref) {
  return ref === null ? null : ref.replace(/^refs\/heads\//, '');
}

function mergedIntoMain(branch) {
  if (branch === null || branch === 'main') return false;
  try {
    const out = git(['branch', '--merged', 'main', '--list', branch]);
    return out.split(/\r?\n/).some((line) => line.trim().replace(/^[*+]\s*/, '') === branch);
  } catch {
    return false;
  }
}

function birthDay(path) {
  try {
    return dayOf(statSync(path).birthtime);
  } catch {
    return 'unknown';
  }
}

const registry = readRegistry();
const today = dayOf(new Date());
const live = listWorktrees().map((item) => {
  const branch = branchName(item.branch);
  const entry = registry.get(normalize(item.path));
  const created = entry?.['创建时间'] || birthDay(item.path);
  const reclaim = entry?.['预计回收时间'] || (created === 'unknown' ? 'unknown' : addDays(created, TTL_DAYS));
  const status = entry?.['状态'] || '未登记';
  return {
    path: item.path,
    head: item.head.slice(0, 7),
    branch: branch ?? '(detached)',
    owner: entry?.['owner'] || '未登记',
    created,
    reclaim,
    status,
    registered: entry !== undefined,
    pinned: /不回收|保留/.test(status),
    overdue: reclaim !== 'unknown' && reclaim <= today && !/不回收|保留/.test(status),
    mergedStale: mergedIntoMain(branch) && !/不回收|保留/.test(status),
  };
});

const livePaths = new Set(live.map((item) => normalize(item.path)));
const missing = [...registry.entries()].filter(([path]) => !livePaths.has(path));

const unregistered = live.filter((item) => !item.registered);
const overdue = live.filter((item) => item.overdue);
const mergedStale = live.filter((item) => item.mergedStale);

console.log(
  `worktrees: total=${live.length} registered=${live.length - unregistered.length} unregistered=${unregistered.length} overdue=${overdue.length} merged-stale=${mergedStale.length}`,
);
console.log(`registry: ${registryPath}`);
console.log(`today=${today} ttl-days=${TTL_DAYS}`);
console.log('');
console.log('| 路径 | 分支 | owner | 创建时间 | 预计回收 | 状态 |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const item of live) {
  console.log(
    `| ${item.path} | ${item.branch} | ${item.owner} | ${item.created} | ${item.reclaim} | ${item.status}${item.overdue ? '（已过期）' : ''} |`,
  );
}

if (unregistered.length > 0) {
  console.log('\n未登记（请补进 docs/WORKTREES.md）：');
  for (const item of unregistered) console.log(`  - ${item.path} (${item.branch})`);
}
if (overdue.length > 0) {
  console.log('\n过期未回收（owner 决定回收或续期；本脚本不删）：');
  for (const item of overdue) console.log(`  - ${item.path} (${item.branch}, 预计 ${item.reclaim})`);
}
if (mergedStale.length > 0) {
  console.log('\n已合入 main 但 worktree 仍在（回收候选，本脚本不删）：');
  for (const item of mergedStale) console.log(`  - ${item.path} (${item.branch})`);
}
if (missing.length > 0) {
  console.log('\n登记表里有、但 worktree 已不存在（请清理表项）：');
  for (const [path, row] of missing) console.log(`  - ${path} (${row['状态'] ?? ''})`);
}

if (STRICT && (unregistered.length > 0 || overdue.length > 0 || missing.length > 0)) {
  process.exitCode = 1;
}
