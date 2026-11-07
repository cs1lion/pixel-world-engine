#!/usr/bin/env node
/**
 * 孤儿闸门检测：仓库里哪些检查脚本 / 检查型 npm 脚本没有任何东西在跑。
 *
 * 判据（写死在代码里，也抄在 docs/ORPHAN_GATES.md）：
 *   1) 检查 = 任意 scripts/ 目录下的 check-* 与 audit-*（.mjs/.ts），
 *      加上 npm 脚本名以 test:/audit:/fixture:/check:/baseline: 开头的条目。
 *   2) 有消费方 = 从任一 workflow 的 `run:` 出发可达，且那条步骤必须**能判红**：
 *      workflow 直接 `npm run X` / `node scripts/...`；
 *      npm 脚本体内 `npm run Y` / `node scripts/...`；
 *      JS/TS 文件之间的 import / require。
 *      `continue-on-error: true`、`if: false`、命令里的 `|| true` 会让失败
 *      穿过 CI，一律不算消费方（job 级同名字段同理）。
 *   3) 允许清单（scripts/orphan-gates-allowlist.json）里的每条必须有 id、
 *      kind（manual / pending-ci / obsolete）、reason、acceptedBecause、blockedBy；
 *      指向不存在的检查 → 红；已经不再孤儿 → 红；没有登记的孤儿 → 红；
 *      三类条数必须分别**等于** pendingCiBudget / manualBudget / obsoleteBudget（棘轮）；
 *      budgetLedger 末条的三个计数必须与三个预算一致，且每条都带
 *      approved_at / approved_by / reason（预算变更必须留下审批记录）。
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

const problems = [];
let parsed = null;
if (!existsSync(ALLOWLIST_FILE)) {
  problems.push(`缺少允许清单：${rel(ALLOWLIST_FILE)}`);
} else {
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
  } catch (error) {
    problems.push(`允许清单不是合法 JSON：${error.message}`);
  }
}

// 命名豁免：`extraChecks` 里的 file: 条目把「不按 check-*/audit-* 命名」的脚本
// 提升为检查（python、verify-* 等）。这是「它是检查」的声明，和「它暂时豁免」
// （entries）分开：接线删条之后仍留在检查域里，总量不会因为接线反而变小。
// 文件必须真实存在且在 scripts/ 下；指向不存在的路径仍按
// 「允许清单指向不存在的检查」判红。
for (const id of Array.isArray(parsed?.extraChecks) ? parsed.extraChecks : []) {
  if (typeof id !== 'string' || !id.startsWith('file:')) continue;
  const relPath = id.slice('file:'.length);
  if (!/(^|\/)scripts\/[^/]+\.(?:py|mjs|ts|js)$/.test(relPath)) continue;
  if (CHECK_FILES.has(id)) continue;
  const abs = resolve(ROOT, relPath);
  if (!isFile(abs)) continue;
  CHECK_FILES.set(id, { id, abs, relPath });
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

const DISCOVERIES = new Map();

function addDiscovery(abs, form, site) {
  if (!abs || !isFile(abs)) return;
  const key = rel(abs);
  if (CHECK_FILES.has(`file:${key}`)) return;
  let item = DISCOVERIES.get(key);
  if (!item) {
    item = { file: key, abs, forms: new Set(), sites: new Set() };
    DISCOVERIES.set(key, item);
  }
  item.forms.add(form);
  item.sites.add(site);
}

function resolveScriptToken(token, baseDir) {
  if (!token.includes('scripts')) return null;
  for (const base of [baseDir, ROOT]) {
    const abs = resolve(base, token);
    if (isFile(abs)) return abs;
  }
  return null;
}

function refsInCommand(command, baseDir) {
  const npmRuns = [];
  const files = [];
  const discoveries = [];
  for (const match of command.matchAll(/npm\s+run\s+([A-Za-z0-9:._-]+)/g)) npmRuns.push(match[1]);
  if (/(^|[;&|]\s*|\s)npm\s+test(\s|$)/.test(command)) npmRuns.push('test');

  // 机械可判的调用形态。node / tsx / npx tsx 解析出的文件仍进「消费方」；
  // python 目标、以及不符合 check-*/audit-* 命名规则的脚本，只进「盲区候选」，
  // 不改变孤儿总数——分类留给 owner 决定。
  const patterns = [
    { form: 'node', re: /(?:^|[;&|]\s*|\s|\()node\s+([^\s'"]+)/g },
    { form: 'tsx', re: /(?:^|[;&|]\s*|\s|\()tsx\s+([^\s'"]+)/g },
    { form: 'npx tsx', re: /(?:^|[;&|]\s*|\s|\()npx\s+(?:-\S+\s+)*tsx\s+([^\s'"]+)/g },
    { form: 'npx ts-node', re: /(?:^|[;&|]\s*|\s|\()npx\s+(?:-\S+\s+)*ts-node\s+([^\s'"]+)/g },
    { form: 'python', re: /(?:^|[;&|]\s*|\s|\()python(?:3)?\s+([^\s'"]+)/g },
  ];
  const seen = new Set();
  for (const { form, re } of patterns) {
    for (const match of command.matchAll(re)) {
      const token = match[1];
      if (!token.includes('scripts')) continue;
      const abs = resolveScriptToken(token, baseDir);
      if (!abs) continue;
      if (seen.has(`${abs}|${form}`)) continue;
      seen.add(`${abs}|${form}`);
      if (form === 'python') {
        // 已登记为检查的 python 目标被 workflow 直接跑，就是真实消费方；
        // 未登记的新 python 脚本只进「盲区候选」，不擅自扩检查域。
        if (CHECK_FILES.has(`file:${rel(abs)}`)) files.push(abs);
        else discoveries.push({ abs, form });
      } else if (!/\.(mjs|ts|js)$/.test(abs)) {
        discoveries.push({ abs, form });
      } else {
        files.push(abs);
      }
    }
  }
  return { npmRuns, files, discoveries };
}

/** 本地 composite action 的一层 `run:`（支持 `- run:` 内联与 `|`/`>` 块）。 */
function compositeRunCommands(file) {
  const text = readFileSync(file, 'utf8');
  if (!/^\s*using:\s*composite\s*$/m.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const indentOf = (line) => line.length - line.trimStart().length;
  const strip = (line) => line.replace(/\s+#.*$/, '').trim();
  const dedent = (block) => {
    const nonEmpty = block.filter((line) => line.trim());
    if (nonEmpty.length === 0) return [];
    const min = Math.min(...nonEmpty.map((line) => indentOf(line)));
    return block.map((line) => (line.trim() ? line.slice(min) : ''));
  };
  const commands = [];
  let stepsIndent = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*steps:\s*$/.test(line)) {
      stepsIndent = indentOf(line);
      continue;
    }
    if (stepsIndent === null) continue;
    const item = line.match(/^(\s*)- /);
    if (!item || item[1].length !== stepsIndent + 2) continue;
    const itemIndent = item[1].length;
    const keyIndent = itemIndent + 2;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].match(/^(\s*)- /);
      if (next && next[1].length === itemIndent) {
        end = j;
        break;
      }
      if (lines[j].trim() && indentOf(lines[j]) <= stepsIndent) {
        end = j;
        break;
      }
    }
    const keyValue = (key) => {
      const pattern = new RegExp(`^\\s*${key}:\\s*(.*)$`);
      for (let k = i; k < end; k += 1) {
        const match = lines[k].match(pattern);
        if (match && indentOf(lines[k]) === keyIndent) return match[1].trim();
      }
      return '';
    };
    if (/^(true|'true'|"true")$/i.test(keyValue('continue-on-error'))) continue;
    if (/^(false|'false'|"false")$/i.test(keyValue('if'))) continue;

    const inlineRun = line.match(/^\s*- run:\s*(.*)$/);
    if (inlineRun) {
      const value = inlineRun[1].trim();
      if (value && !value.startsWith('|') && !value.startsWith('>')) {
        commands.push(strip(value));
        continue;
      }
      let j = i + 1;
      const block = [];
      for (; j < end; j += 1) {
        if (lines[j].trim() && indentOf(lines[j]) <= keyIndent) break;
        block.push(lines[j]);
      }
      commands.push(...dedent(block).map(strip).filter(Boolean));
      i = j - 1;
      continue;
    }
    for (let k = i; k < end; k += 1) {
      const run = lines[k].match(/^\s*run:\s*(.*)$/);
      if (!run || indentOf(lines[k]) !== keyIndent) continue;
      const value = run[1].trim();
      if (value && !value.startsWith('|') && !value.startsWith('>')) {
        commands.push(strip(value));
        break;
      }
      let j = k + 1;
      const block = [];
      for (; j < end; j += 1) {
        if (lines[j].trim() && indentOf(lines[j]) <= keyIndent) break;
        block.push(lines[j]);
      }
      commands.push(...dedent(block).map(strip).filter(Boolean));
      break;
    }
  }
  return commands;
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

  const indentOf = (line) => line.length - line.trimStart().length;
  const literal = (value, expected) =>
    value !== null &&
    new RegExp(`^(?:${expected}|'${expected}'|"${expected}")$`, 'i').test(value.trim());
  const keyIn = (start, end, indent, key) => {
    const pattern = new RegExp(`^\\s*${key}:\\s*(.*)$`);
    for (let i = start; i < end; i += 1) {
      const match = lines[i].match(pattern);
      if (match && indentOf(lines[i]) === indent) return match[1];
    }
    return null;
  };
  const jobBlock = (from) => {
    let start = from;
    for (let i = from - 1; i >= 0; i -= 1) {
      if (indentOf(lines[i]) === 2 && /^[A-Za-z0-9_.-]+:$/.test(lines[i].trim())) {
        start = i;
        break;
      }
    }
    let end = lines.length;
    for (let i = from + 1; i < lines.length; i += 1) {
      if (indentOf(lines[i]) === 2 && /^[A-Za-z0-9_.-]+:$/.test(lines[i].trim())) {
        end = i;
        break;
      }
    }
    return { start, end };
  };

  const stepBlock = (at, keyIndent, isListItem) => {
    let listIndent = isListItem ? keyIndent : keyIndent - 2;
    let start = at;
    if (!isListItem) {
      for (let i = at - 1; i >= 0; i -= 1) {
        const match = lines[i].match(/^(\s*)- /);
        if (match && match[1].length <= listIndent) {
          start = i;
          listIndent = match[1].length;
          break;
        }
        if (indentOf(lines[i]) === 2 && /^[A-Za-z0-9_.-]+:$/.test(lines[i].trim())) break;
      }
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      const match = lines[i].match(/^(\s*)- /);
      if (match && match[1].length <= listIndent) {
        end = i;
        break;
      }
      if (indentOf(lines[i]) === 2 && /^[A-Za-z0-9_.-]+:$/.test(lines[i].trim())) {
        end = i;
        break;
      }
    }
    return { start, end, keyIndent: listIndent + 2 };
  };
  // 只有「能判红」的步骤才算消费方：continue-on-error: true、if: false、`|| true`
  // 都会让失败穿过 CI，等于没接。job 级同名字段一并排除。
  const isBlockingAt = (at, keyIndent, isListItem) => {
    const step = stepBlock(at, keyIndent, isListItem);
    if (literal(keyIn(step.start, step.end, step.keyIndent, 'continue-on-error'), 'true')) return false;
    if (literal(keyIn(step.start, step.end, step.keyIndent, 'if'), 'false')) return false;
    const block = jobBlock(at);
    if (literal(keyIn(block.start, block.end, 4, 'continue-on-error'), 'true')) return false;
    if (literal(keyIn(block.start, block.end, 4, 'if'), 'false')) return false;
    return true;
  };

  const emit = (commands, blocking) => {
    if (!blocking) return;
    for (const rawLine of commands) {
      const line = rawLine.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#')) continue;
      if (/\|\|\s*true(?=\s|;|$)/.test(line)) continue;
      const refs = refsInCommand(line, cwd);
      for (const name of refs.npmRuns) roots.push({ kind: 'npm', name, pkgDir: packageFor(cwd), site: `${site}#${job}` });
      for (const refFile of refs.files) roots.push({ kind: 'file', file: refFile, site: `${site}#${job}` });
      for (const found of refs.discoveries) addDiscovery(found.abs, found.form, `${site}#${job}`);
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
        const blocking = isBlockingAt(index, keyIndent, isListItem);
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
        emit(block.map((line) => (line.trim() === '' ? '' : line.slice(minIndent))), blocking);
        continue;
      }
      emit([value], isBlockingAt(index, indent, isListItem));
    }

    const uses = raw.match(/^\s*(?:- )?uses:\s*(\S+)\s*$/);
    if (uses && uses[1].startsWith('./.github/actions/')) {
      const isListItem = Boolean(raw.match(/^\s*- /));
      if (isBlockingAt(index, indent, isListItem)) {
        const actionDir = resolve(ROOT, uses[1]);
        const actionFile = ['action.yml', 'action.yaml']
          .map((name) => join(actionDir, name))
          .find((candidate) => isFile(candidate));
        if (actionFile) emit(compositeRunCommands(actionFile), true);
      }
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
    for (const found of refs.discoveries) addDiscovery(found.abs, found.form, id);
    continue;
  }
  const file = CHECK_FILES.get(id) ?? { abs: resolve(ROOT, id.slice('file:'.length)) };
  for (const imported of importsOf(file.abs)) {
    const next = `file:${rel(imported)}`;
    if (CHECK_FILES.has(next)) reach(next, `${id} import`);
  }
}

// 静态 child_process：只认字面量数组里的 scripts/ 路径，拼字符串一律留作已知边界。
for (const pkgDir of PACKAGES) {
  const scriptsDir = join(pkgDir, 'scripts');
  if (!existsSync(scriptsDir)) continue;
  for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(mjs|ts|js)$/.test(entry.name)) continue;
    const abs = join(scriptsDir, entry.name);
    const text = readFileSync(abs, 'utf8');
    if (!/child_process/.test(text)) continue;
    for (const match of text.matchAll(/['"]([^'"\n]*scripts\/[^'"\n]+)['"]/g)) {
      const token = match[1];
      if (!/scripts\/(?:check-|audit-|verify-|[^/'"\n]+\.py)/.test(token)) continue;
      const target = resolveScriptToken(token, pkgDir);
      if (!target) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      addDiscovery(target, `child_process 静态数组（${rel(abs)}:${line}）`, `${rel(abs)}:${line}`);
    }
  }
}

// python 文件不靠命名规则判断：全部列进盲区候选；没被任何机械路径引用的，标成「仅文档手动命令」。
// 同目录的静态 `.py` 字面量（如 `DIFF = HERE / "screens-diff.py"`）也算一条引用；
// 变量展开 / 路径拼接不猜，留作已知边界。分两遍：先收引用，再给真正没人引用的补注。
const PY_FILES = [];
for (const pkgDir of PACKAGES) {
  const scriptsDir = join(pkgDir, 'scripts');
  if (!existsSync(scriptsDir)) continue;
  for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.py$/.test(entry.name)) continue;
    const abs = join(scriptsDir, entry.name);
    PY_FILES.push({ abs, pkgDir, text: readFileSync(abs, 'utf8') });
  }
}
for (const { abs, pkgDir, text } of PY_FILES) {
  for (const match of text.matchAll(/['"]([^'"\n]+\.py)['"]/g)) {
    const token = match[1];
    const target = token.includes('scripts/')
      ? resolveScriptToken(token, pkgDir)
      : resolve(dirname(abs), token);
    if (!target || target === abs || !isFile(target)) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    addDiscovery(target, `python 静态路径（${rel(abs)}:${line}）`, `${rel(abs)}:${line}`);
  }
}
for (const { abs, pkgDir } of PY_FILES) {
  if (!DISCOVERIES.has(rel(abs))) {
    addDiscovery(abs, '未被 workflow / npm / 静态 spawn 引用（仅文档手动命令）', rel(pkgDir));
  }
}

const allowed = new Map();
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
  if (!['manual', 'pending-ci', 'obsolete'].includes(entry.kind)) {
    problems.push(`允许清单 kind 必须是 manual / pending-ci / obsolete：${id}`);
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

const orphans = CHECK_IDS.filter((id) => !reached.has(id));
const allowedOrphans = orphans.filter((id) => allowed.has(id));
const newOrphans = orphans.filter((id) => !allowed.has(id));

const counts = { 'pending-ci': 0, manual: 0, obsolete: 0 };
for (const entry of allowed.values()) {
  if (entry.kind in counts) counts[entry.kind] += 1;
}

const BUDGETS = [
  ['pending-ci', 'pendingCiBudget'],
  ['manual', 'manualBudget'],
  ['obsolete', 'obsoleteBudget'],
];
const budgets = {};
for (const [kind, key] of BUDGETS) {
  const value = parsed?.[key];
  if (!Number.isInteger(value)) {
    budgets[kind] = null;
    problems.push(`允许清单缺 ${key}（必须是整数）`);
    continue;
  }
  budgets[kind] = value;
  if (counts[kind] !== value) {
    problems.push(
      `${kind} 条数 ${counts[kind]} ≠ 预算 ${value}：条数必须与预算相等；新增条目同一提交 +1、删除条目同一提交 -1，改 kind 也要同步两边`,
    );
  }
}

const LEDGER_KEYS = [
  ['pending-ci', 'pendingCi'],
  ['manual', 'manual'],
  ['obsolete', 'obsolete'],
];
const ledger = Array.isArray(parsed?.budgetLedger) ? parsed.budgetLedger : null;
if (!ledger || ledger.length === 0) {
  problems.push('允许清单缺 budgetLedger（至少一条基线记录，含 approved_at / approved_by / reason 与三类条数）');
} else {
  let previousAt = '';
  ledger.forEach((record, index) => {
    const tag = `budgetLedger 第 ${index + 1} 条`;
    for (const key of ['approved_at', 'approved_by', 'reason']) {
      if (typeof record?.[key] !== 'string' || !record[key].trim()) problems.push(`${tag} 缺 ${key}`);
    }
    const at = typeof record?.approved_at === 'string' ? record.approved_at.trim() : '';
    if (at) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) problems.push(`${tag} approved_at 必须是 YYYY-MM-DD`);
      else if (at < previousAt) problems.push(`${tag} approved_at 早于上一条`);
      else previousAt = at;
    }
    for (const [, key] of LEDGER_KEYS) {
      if (!Number.isInteger(record?.[key])) problems.push(`${tag} 缺整数 ${key}`);
    }
  });
  const last = ledger[ledger.length - 1];
  for (const [kind, key] of LEDGER_KEYS) {
    if (Number.isInteger(last?.[key]) && budgets[kind] !== null && last[key] !== budgets[kind]) {
      problems.push(
        `budgetLedger 末条 ${key}=${last[key]} ≠ ${kind} 预算 ${budgets[kind]}：任何预算变更都必须追加一条带 approved_at / approved_by / reason 的记录`,
      );
    }
  }
}

const budget = budgets['pending-ci'];
const pendingCount = counts['pending-ci'];

const allowedManual = allowedOrphans.filter((id) => allowed.get(id).kind === 'manual').length;
const allowedPending = allowedOrphans.filter((id) => allowed.get(id).kind === 'pending-ci').length;
const allowedObsolete = allowedOrphans.filter((id) => allowed.get(id).kind === 'obsolete');

console.log(`孤儿闸门检测（${rel(ROOT) || ROOT}）`);
console.log('判据：文件 **/scripts/check-*、**/scripts/audit-*（.mjs/.ts）；npm 脚本前缀 test:/audit:/fixture:/check:/baseline:');
console.log('消费方判据：workflow 的 run:（步骤必须能判红）→ npm 脚本互调 → import/require 闭包');
console.log('');

const consumedChecks = CHECK_IDS.filter((id) => reached.has(id));
console.log(`[有消费方] ${consumedChecks.length}`);
for (const id of consumedChecks) {
  console.log(`  ${id}\n    ← ${reached.get(id)}`);
}
console.log('');

console.log(`[已知孤儿（允许清单）] ${allowedOrphans.length}（manual ${allowedManual} / pending-ci ${allowedPending} / obsolete ${allowedObsolete.length}）`);
for (const id of allowedOrphans) {
  const entry = allowed.get(id);
  if (entry.kind === 'obsolete') continue;
  console.log(`  ${id}\n    — [${entry.kind}] ${entry.reason}（卡在：${entry.blockedBy}）`);
}
console.log('');

console.log(`[obsolete（应删）] ${allowedObsolete.length}`);
for (const id of allowedObsolete) {
  const entry = allowed.get(id);
  console.log(`  ${id}\n    — ${entry.reason}（${entry.blockedBy}）`);
}
console.log('');

console.log(`[新孤儿（未登记）] ${newOrphans.length}`);
for (const id of newOrphans) console.log(`  ${id}`);
console.log('');

console.log(`[允许清单问题] ${problems.length}`);
for (const problem of problems) console.log(`  ${problem}`);
console.log('');

// 盲区候选：只做发现，不参与 exit code、不改变任何分类与预算。
// 建议 kind 的依据只看「能不能给出客观的 exit 非 0」，不看它现在有没有人跑。
function exitEvidence(abs) {
  const text = readFileSync(abs, 'utf8');
  if (/\.py$/.test(abs)) {
    if (/raise\s+SystemExit/.test(text)) return '含 `raise SystemExit(...)`，有客观退出码';
    if (/sys\.exit\s*\(/.test(text)) return '含 `sys.exit(...)`，有客观退出码';
    if (/SystemExit/.test(text)) return '含 SystemExit，有客观退出码';
    return '';
  }
  if (/process\.exitCode\s*=/.test(text)) return '写 `process.exitCode`，有客观退出码';
  if (/process\.exit\s*\(/.test(text)) return '含 `process.exit(...)`，有客观退出码';
  return '';
}

function isAggregator(abs) {
  if (!/\.(mjs|ts|js)$/.test(abs)) return false;
  const text = readFileSync(abs, 'utf8');
  const matches = text.match(/['"][^'"\n]*scripts\/[^'"\n]+['"]/g) ?? [];
  return matches.length >= 3;
}

function siteReferrer(site) {
  const match = site.match(/^(\S+?):\d+$/);
  return match ? match[1] : '';
}

const visibleDiscoveries = [...DISCOVERIES.values()]
  .filter((item) => !allowed.has(`file:${item.file}`))
  .sort((a, b) => a.file.localeCompare(b.file));

console.log(`[盲区候选（只发现，不判红）] ${visibleDiscoveries.length}`);
for (const item of visibleDiscoveries) {
  const forms = [...item.forms].join(' / ');
  const evidence = exitEvidence(item.abs);
  const kind = evidence ? 'pending-ci' : 'manual';
  const why = evidence || '没有任何客观退出码，只能人工目视读数';
  console.log(`  ${item.file}`);
  console.log(`    引用形态：${forms}`);
  console.log(`    引用位置：${[...item.sites].join('、')}`);
  console.log(`    建议：${kind} —— ${why}`);
  const aggregators = [...item.sites].map(siteReferrer).filter(Boolean).filter(isAggregator);
  if (aggregators.length > 0) {
    console.log(`    注意：引用者 ${aggregators.join('、')} 是聚合器（一次拉起多条），接它等于一次接多条，需要你单独决定`);
  }
}
console.log('  说明：本段只打印，不进入 exit code、不改分类、不改预算。');
console.log('');

const budgetText = budget === null ? '缺' : String(budget);
const manualBudgetText = budgets.manual === null ? '缺' : String(budgets.manual);
const obsoleteBudgetText = budgets.obsolete === null ? '缺' : String(budgets.obsolete);
console.log(
  `债务：pending-ci ${pendingCount} / 预算 ${budgetText}；manual ${counts.manual} / 预算 ${manualBudgetText}；obsolete ${counts.obsolete} / 预算 ${obsoleteBudgetText}（三类均须相等）`,
);
console.log(`清单：允许 ${allowed.size} 条，孤儿 ${orphans.length} 条`);
console.log(`合计 ${CHECK_IDS.length} 个检查：${CHECK_IDS.length - orphans.length} 有消费方 / ${allowedOrphans.length} 已知孤儿（manual ${allowedManual} / pending-ci ${allowedPending} / obsolete ${allowedObsolete.length}） / ${newOrphans.length} 未登记`);

process.exit(problems.length > 0 || newOrphans.length > 0 ? 1 : 0);
