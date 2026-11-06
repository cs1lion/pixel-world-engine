/**
 * 动画基线账本的机器校验。
 *
 * 这份账本原来只有文档，没有可执行判据。这里把它当前已记录的 157 行结构钉住：
 * 行数、编号连续、六类计数、12 位旧/新基线哈希、7 位对应提交。
 * 它校验的是「账本说自己记了什么」，不是「哪张图真的该变」。
 *
 * 跑法（cwd = world-client）：
 *   node scripts/verify-animation-baseline.mjs [--doc <path>] [--self-test]
 * 退出码：0 绿；1 红；2 文档不存在（不可判，不是通过）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REL = 'docs/evidence/animation-express/SCREENSHOT_BASELINE_CHANGES.md';
const EXPECTED_COUNTS = new Map([
  ['甲·可信', 73],
  ['甲·基线不可复现', 29],
  ['乙', 28],
  ['丙', 18],
  ['丁', 2],
  ['参照', 7],
]);

function defaultDoc() {
  const candidates = [resolve(ROOT, REL), resolve(ROOT, '..', '..', 'pwe-anim', REL)];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function stripTicks(value) {
  return value.trim().replace(/^`|`$/g, '');
}

export function parseDoc(text) {
  const lines = text.split(/\r?\n/);
  const rows = lines
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split('|');
      return {
        index: Number(cells[1].trim()),
        file: stripTicks(cells[2]),
        oldSha: stripTicks(cells[3]),
        newSha: stripTicks(cells[4]),
        category: stripTicks(cells[9]),
        commit: stripTicks(cells[11]),
      };
    });
  const counts = new Map();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return { rows, counts, title: lines.find((line) => line.startsWith('# ')) ?? '' };
}

export function validateDoc(text) {
  const errors = [];
  const { rows, counts, title } = parseDoc(text);
  if (!/157/.test(title)) errors.push(`标题未声明 157 张：${title}`);
  if (rows.length !== 157) errors.push(`行数 ${rows.length}，期望 157`);
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].index !== i + 1) {
      errors.push(`第 ${i + 1} 行编号是 ${rows[i].index}，期望连续 1..157`);
      break;
    }
  }
  for (const [category, expected] of EXPECTED_COUNTS) {
    const actual = counts.get(category) ?? 0;
    if (actual !== expected) errors.push(`归类「${category}」${actual} 行，期望 ${expected}`);
  }
  for (const [category, actual] of counts) {
    if (!EXPECTED_COUNTS.has(category)) errors.push(`出现未登记的归类「${category}」（${actual} 行）`);
  }
  for (const row of rows) {
    if (!/^[0-9a-f]{12}$/.test(row.oldSha)) errors.push(`#${row.index} 旧基线不是 12 位哈希：${row.oldSha}`);
    if (!/^[0-9a-f]{12}$/.test(row.newSha)) errors.push(`#${row.index} 新基线不是 12 位哈希：${row.newSha}`);
    if (!/^[0-9a-f]{7}$/.test(row.commit)) errors.push(`#${row.index} 对应提交不是 7 位哈希：${row.commit}`);
  }
  return { errors, rows, counts };
}

function runSelfTest(text) {
  const cases = [
    ['删掉最后一行', text.split(/\r?\n/).filter((line) => !/^\|\s*157\s*\|/.test(line)).join('\n'), '行数'],
    ['打坏一个新基线哈希', text.replace('`77cbf13654d8`', '`zzzzzzzzzzzz`'), '新基线不是 12 位哈希'],
    ['改掉一行归类', text.replace('| 乙 |', '| 甲·可信 |'), '归类「甲·可信」'],
  ];
  let failed = 0;
  for (const [name, mutated, needle] of cases) {
    const result = validateDoc(mutated);
    const hit = result.errors.some((line) => line.includes(needle));
    console.log(`${name.padEnd(22)} ${hit ? '红（符合预期）' : '没红（判据失效）'}`);
    if (!hit) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

const doc = defaultDoc();
const selfTest = process.argv.includes('--self-test');
const explicit = process.argv.indexOf('--doc');
if (explicit >= 0) {
  const path = process.argv[explicit + 1];
  if (!path) {
    console.error('--doc 后面要跟文件路径');
    process.exit(1);
  }
  if (!existsSync(resolve(path))) {
    console.error(`文档不存在：${resolve(path)}`);
    process.exit(2);
  }
  const text = readFileSync(resolve(path), 'utf8');
  if (selfTest) process.exit(runSelfTest(text));
  const { errors, rows, counts } = validateDoc(text);
  if (errors.length > 0) {
    console.error(`动画基线账本红：${errors.length} 条`);
    for (const line of errors.slice(0, 10)) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`动画基线账本绿：${rows.length} 行，六类计数 ${[...counts].map(([k, v]) => `${k}=${v}`).join(' / ')}`);
  process.exit(0);
}

if (!doc) {
  console.error(`找不到 ${REL}（main 与 ../pwe-anim 都没有）`);
  process.exit(2);
}
const text = readFileSync(doc, 'utf8');
if (selfTest) process.exit(runSelfTest(text));
const { errors, rows, counts } = validateDoc(text);
if (errors.length > 0) {
  console.error(`动画基线账本红：${errors.length} 条`);
  for (const line of errors.slice(0, 10)) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`动画基线账本绿：${rows.length} 行，六类计数 ${[...counts].map(([k, v]) => `${k}=${v}`).join(' / ')}`);
