#!/usr/bin/env node
/**
 * 孤儿闸门检测：仓库里哪些检查脚本 / 检查型 npm 脚本没有任何东西在跑。
 *
 * 判据（写死在代码里，也抄在 docs/ORPHAN_GATES.md）：
 *   1) 检查 = 任意 scripts/ 目录下的 check-* 与 audit-*（.mjs/.ts），
 *      加上 npm 脚本名以 test:/audit:/fixture:/check:/baseline: 开头的条目。
 *   2) 有消费方 = 从任一 workflow 的 `run:` 出发可达：
 *      workflow 直接 `npm run X` / `node scripts/...`；
 *      npm 脚本体内 `npm run Y` / `node scripts/...`；
 *      JS/TS 文件之间的 import / require。
 *   3) 允许清单（scripts/orphan-gates-allowlist.json）里的每条必须有 id、
 *      kind（manual / pending-ci）、reason、acceptedBecause、blockedBy；
 *      指向不存在的检查 → 红；已经不再孤儿 → 红；没有登记的孤儿 → 红；
 *      pending-ci 条数不得超过顶层的 pendingCiBudget（棘轮）。
 *
 * 退出码：0 = 全部有主；1 = 有未登记孤儿，或清单自身有问题。
 * 只用 node 内置模块，repo-harness job 不需要 npm ci。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');
const ALLOWLIST_FILE = join(ROOT, 'scripts', 'orphan-gates-allowlist.json');
const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'dist', 'build', '.codeartsdoer']);

const CHECK_FILE_RE = /(^|\/)scripts\/(?:check|audit)-[^/]+\.(?:mjs|ts)$/;
const NPM_CHECK_RE = /^(?:test|audit|fixture|check|baseline):/;
const EXTENSIONS = ['.ts', '.mjs', '.js', '.mts', '.cts', '.tsx'];

function rel(p) {
  return relative(ROOT, p).split(sep).join('/') || '.';
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function packageDirs() {
  const dirs = [ROOT];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    if (isFile(join(ROOT, entry.name, 'package.json'))) dirs.push(join(ROOT, entry.name));
  }
  return dirs;
}

const PACKAGES = packageDirs();
const NPM_SCRIPTS = new Map();
const CHECK_FILES = new Map();

for (const pkgDir of PACKAGES) {
  const pkgRel = rel(pkgDir);
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  for (const [name, body] of Object.entries(manifest.scripts ?? {})) {
    const id = `npm:${pkgRel}#${name}`;
    NPM_SCRIPTS.set(id, { id, name, body, pkgDir });
  }
}

for (const pkgDir of PACKAGES) {
  const scriptsDir = join(pkgDir, 'scripts');
  if (!existsSync(scriptsDir)) continue;
  for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(scriptsDir, entry.name);
    const relPath = rel(abs);
    if (!CHECK_FILE_RE.test(relPath)) continue;
    CHECK_FILES.set(`file:${relPath}`, { id: `file:${relPath}`, abs, relPath });
  }
}

const NPM_CHECK_IDS = [...NPM_SCRIPTS.values()]
  .filter((s) => NPM_CHECK_RE.test(s.name))
  .map((s) => s.id);
const CHECK_IDS = [...CHECK_FILES.keys(), ...NPM_CHECK_IDS].sort();

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext)]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const re of [
      /from\s*['"]([^'"]+)['"]/,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      /require\s*\(\s*['"]([^'"]+)['"]/,
      /^import\s+['"]([^'"]+)['"]/,
    ]) {
      const match = line.match(re);
      if (match) found.add(match[1]);
    }
  }
  return [...found].map((spec) => resolveSpecifier(file, spec)).filter(Boolean);
}

function refsInCommand(command, baseDir) {
  const npmRuns = [];
  const files = [];
  for (const match of command.matchAll(/npm\s+run\s+([A-Za-z0-9:._-]+)/g)) npmRuns.push(match[1]);
  if (/(^|[;&|]\s*|\s)npm\s+test(\s|$)/.test(command)) npmRuns.push('test');
  for (const match of command.matchAll(/(?:^|[;&|]\s*|\s|\()node\s+([^\s'"]+)/g)) {
    const token = match[1];
    if (!token.includes('scripts')) continue;
    for (const base of [baseDir, ROOT]) {
      const abs = resolve(base, token);
      if (isFile(abs)) {
        files.push(abs);
        break;
      }
    }
  }
  return { npmRuns, files };
}

function packageFor(dir) {
  let current = dir;
  while (current.startsWith(ROOT)) {
    if (isFile(join(current, 'package.json'))) return current;
    if (current === ROOT) break;
    current = dirname(current);
  }
  return null;
}

function parseWorkflow(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const roots = [];
  const site = rel(file);
  let job = '(workflow)';
  let cwd = ROOT;
  let index = 0;

  const emit = (commands) => {
    for (const rawLine of commands) {
      const line = rawLine.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#')) continue;
      const refs = refsInCommand(line, cwd);
      for (const name of refs.npmRuns) roots.push({ kind: 'npm', name, pkgDir: packageFor(cwd), site: `${site}#${job}` });
      for (const refFile of refs.files) roots.push({ kind: 'file', file: refFile, site: `${site}#${job}` });
    }
  };

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    if (!trimmed) {
      index += 1;
      continue;
    }

    const jobHeader = /^[A-Za-z0-9_.-]+:$/.test(trimmed) && indent === 2;
    if (jobHeader && !['push', 'pull_request', 'schedule', 'workflow_dispatch', 'jobs', 'on', 'env'].includes(trimmed.slice(0, -1))) {
      job = trimmed.slice(0, -1);
      cwd = ROOT;
    }

    const wd = raw.match(/^\s*working-directory:\s*(\S.*)$/);
    if (wd) cwd = resolve(ROOT, wd[1].trim());

    const runKey = raw.match(/^(\s*)(- )?run:\s*(.*)$/);
    if (runKey) {
      const isListItem = Boolean(runKey[2]);
      const value = runKey[3].trim();
      // `defaults:\n  run:\n    working-directory: ...` 是映射键，不是命令。
      if (value === '' && !isListItem) {
        index += 1;
        continue;
      }
      if (value === '' || value.startsWith('|') || value.startsWith('>')) {
        const keyIndent = indent;
        const block = [];
        index += 1;
        while (index < lines.length) {
          const line = lines[index];
          if (line.trim() !== '' && line.length - line.trimStart().length <= keyIndent) break;
          block.push(line);
          index += 1;
        }
        const nonEmpty = block.filter((line) => line.trim());
        const minIndent = nonEmpty.length ? Math.min(...nonEmpty.map((line) => line.length - line.trimStart().length)) : 0;
        emit(block.map((line) => (line.trim() === '' ? '' : line.slice(minIndent))));
        continue;
      }
      emit([value]);
    }
    index += 1;
  }
  return roots;
}

const reached = new Map();
const queue = [];

function reach(id, via) {
  if (reached.has(id)) return;
  reached.set(id, via);
  queue.push(id);
}

if (existsSync(WORKFLOW_DIR)) {
  for (const entry of readdirSync(WORKFLOW_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(yml|yaml)$/.test(entry.name)) continue;
    for (const root of parseWorkflow(join(WORKFLOW_DIR, entry.name))) {
      if (root.kind === 'npm') {
        if (!root.pkgDir) continue;
        const id = `npm:${rel(root.pkgDir)}#${root.name}`;
        if (NPM_SCRIPTS.has(id)) reach(id, `${root.site} 调用 npm run ${root.name}`);
      } else {
        reach(`file:${rel(root.file)}`, `${root.site} 直接 node 调用`);
      }
    }
  }
}

while (queue.length > 0) {
  const id = queue.shift();
  if (id.startsWith('npm:')) {
    const script = NPM_SCRIPTS.get(id);
    if (!script) continue;
    const refs = refsInCommand(script.body, script.pkgDir);
    for (const name of refs.npmRuns) {
      const next = `npm:${rel(script.pkgDir)}#${name}`;
      if (NPM_SCRIPTS.has(next)) reach(next, `${id} 里调用 npm run ${name}`);
    }
    for (const abs of refs.files) {
      const relFile = rel(abs);
      if (CHECK_FILES.has(`file:${relFile}`)) reach(`file:${relFile}`, `${id} 里 node 调用`);
    }
    continue;
  }
  const file = CHECK_FILES.get(id) ?? { abs: resolve(ROOT, id.slice('file:'.length)) };
  for (const imported of importsOf(file.abs)) {
    const next = `file:${rel(imported)}`;
    if (CHECK_FILES.has(next)) reach(next, `${id} import`);
  }
}

const problems = [];
const allowed = new Map();
let parsed = null;

if (!existsSync(ALLOWLIST_FILE)) {
  problems.push(`缺少允许清单：${rel(ALLOWLIST_FILE)}`);
} else {
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
  } catch (error) {
    problems.push(`允许清单不是合法 JSON：${error.message}`);
  }
  for (const entry of parsed?.entries ?? []) {
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (!id) {
      problems.push('允许清单有一条缺 id');
      continue;
    }
    if (allowed.has(id)) problems.push(`允许清单重复登记：${id}`);
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) problems.push(`允许清单缺 reason：${id}`);
    if (typeof entry.acceptedBecause !== 'string' || !entry.acceptedBecause.trim()) {
      problems.push(`允许清单缺 acceptedBecause：${id}`);
    }
    if (entry.kind !== 'manual' && entry.kind !== 'pending-ci') {
      problems.push(`允许清单 kind 必须是 manual 或 pending-ci：${id}`);
    }
    if (typeof entry.blockedBy !== 'string' || !entry.blockedBy.trim()) {
      problems.push(`允许清单缺 blockedBy：${id}`);
    }
    if (!CHECK_IDS.includes(id)) {
      problems.push(`允许清单指向不存在的检查：${id}`);
    } else if (reached.has(id)) {
      problems.push(`允许清单里的 ${id} 已有消费方（${reached.get(id)}），请从清单移除`);
    }
    allowed.set(id, entry);
  }
}

const orphans = CHECK_IDS.filter((id) => !reached.has(id));
const allowedOrphans = orphans.filter((id) => allowed.has(id));
const newOrphans = orphans.filter((id) => !allowed.has(id));

const budget = Number.isInteger(parsed?.pendingCiBudget) ? parsed.pendingCiBudget : null;
const pendingCount = [...allowed.values()].filter((entry) => entry.kind === 'pending-ci').length;
if (budget === null) {
  problems.push('允许清单缺 pendingCiBudget（必须是整数）');
} else if (pendingCount > budget) {
  problems.push(`pending-ci 债务 ${pendingCount} 条 > 预算 ${budget}：新增豁免必须同时显式抬高 pendingCiBudget`);
}

const allowedManual = allowedOrphans.filter((id) => allowed.get(id).kind === 'manual').length;
const allowedPending = allowedOrphans.filter((id) => allowed.get(id).kind === 'pending-ci').length;

console.log(`孤儿闸门检测（${rel(ROOT) || ROOT}）`);
console.log('判据：文件 **/scripts/check-*、**/scripts/audit-*（.mjs/.ts）；npm 脚本前缀 test:/audit:/fixture:/check:/baseline:');
console.log('消费方判据：workflow 的 run: → npm 脚本互调 → import/require 闭包');
console.log('');

const consumedChecks = CHECK_IDS.filter((id) => reached.has(id));
console.log(`[有消费方] ${consumedChecks.length}`);
for (const id of consumedChecks) {
  console.log(`  ${id}\n    ← ${reached.get(id)}`);
}
console.log('');

console.log(`[已知孤儿（允许清单）] ${allowedOrphans.length}（manual ${allowedManual} / pending-ci ${allowedPending}）`);
for (const id of allowedOrphans) {
  const entry = allowed.get(id);
  console.log(`  ${id}\n    — [${entry.kind}] ${entry.reason}（卡在：${entry.blockedBy}）`);
}
console.log('');

console.log(`[新孤儿（未登记）] ${newOrphans.length}`);
for (const id of newOrphans) console.log(`  ${id}`);
console.log('');

console.log(`[允许清单问题] ${problems.length}`);
for (const problem of problems) console.log(`  ${problem}`);
console.log('');

const budgetText = budget === null ? '缺' : String(budget);
const headroom = budget === null ? '-' : String(budget - pendingCount);
console.log(`债务：pending-ci ${pendingCount} / 预算 ${budgetText}（余量 ${headroom}）`);
console.log(`清单：允许 ${allowed.size} 条，孤儿 ${orphans.length} 条`);
console.log(`合计 ${CHECK_IDS.length} 个检查：${CHECK_IDS.length - orphans.length} 有消费方 / ${allowedOrphans.length} 已知孤儿（manual ${allowedManual} / pending-ci ${allowedPending}） / ${newOrphans.length} 未登记`);

process.exit(problems.length > 0 || newOrphans.length > 0 ? 1 : 0);
