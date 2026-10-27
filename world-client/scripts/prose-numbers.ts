/**
 * 散文数字分诊：某个源码文件注释里手打的数，**它自己的守卫文件提都没提**。
 *
 * 这个仓库反复栽在同一件事上——注释写着「实测 18 条」「占总写入像素 25.6%」
 * 「11 色」，三个数一个都对不上它说的那对（`git log` 里 `895b6d9`、
 * `0b74bef`、`a624d36`、`6e7f84b` 四笔全是它）。修完自己又犯（`6bf0a57`：
 * 上一笔新加了三个行号引用，加完就错了）。
 *
 * 所以这里不判断「这个数对不对」——那要重跑世界，本工具一个数都不重算。
 * 它只回答一个便宜得多的问题：**这个数有没有机器在看着。**
 *
 * 「有机器在看」的判据刻意收得很紧：数字必须出现在**测这个源文件的那个测试
 * 文件**里（同名 `.test.ts`，或 import 了它的那些）。全仓库 103 个测试文件，
 * 随便哪个文件里冒出同一个数字都算「锁了」的话，判据就等于没有——`96`、`24`
 * 这种数在任何测试里都找得到，而那一处注释说的可能是完全另一件事。
 * 那正是「冤判看着像闸门」：宽判据会让脏数混过去，比没有闸门更糟。
 *
 * 所以反过来也要说清：**这里的每一条都只是候选，不是缺陷。** 数字真被锁着、
 * 只是锁在别处（某个汇总测试、某个审计脚本），这里照样会报。它给人一张
 * 按「自己的守卫没提」排出来的清单，裁定是人来做。
 *
 * 用法：`node scripts/prose-numbers.ts [--json] [--file <src 路径>]`
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly number: string;
  readonly text: string;
  readonly guards: readonly string[];
}

const SRC = 'src';
const TEST = 'test';
const SCRIPTS = 'scripts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs)$/.test(name)) out.push(p);
  }
  return out.sort();
}

/** 剥掉字符串与模板字面量，只留注释——数字在代码里是另一回事，不归这里管。 */
function stripCode(line: string): string {
  let out = '';
  let quote: string | null = null;
  for (const c of line) {
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * 一个「值得盯」的数字：至少两位，或带小数点，或带百分号。
 *
 * 单位数大多是结构常数（16 变体、4 内凹角、8 种材质、2 套色板），不是实测值，
 * 列出来只会淹掉真候选。`EDGE_VISIBLE_MIN_DL` 那种个位数阈值同理。
 */
const NUM = /(?<![\w.])(\d+\.\d+|\d{2,}%?|\d+%)(?![\w])/g;

/** 结构性坐标与编号，不是实测值。 */
const SKIP = /(第\s*\d+\s*行|§\s*\d|ADR[-_ ]?\d|issue\s*#?\d|#\d)/i;

/** 源码文件 → 守卫它的测试文件们。 */
function guardsFor(src: string, testFiles: readonly string[]): string[] {
  const rel = src.replace(/\\/g, '/');
  const base = rel.replace(/^src\//, '').replace(/\.[^./]+$/, '');
  const out: string[] = [];
  for (const t of testFiles) {
    const trel = t.replace(/\\/g, '/');
    if (trel === `test/${base}.test.ts` || trel === `test/${base}.test.mjs`) {
      out.push(trel);
      continue;
    }
    // import 了这个源文件的测试（跨名守卫，例如 audit-references 与
    // terrain-edge-invisible 互为兄弟守卫那一类）。
    const text = readFileSync(t, 'utf8');
    if (text.includes(`'../src/${base}.ts'`) || text.includes(`"../src/${base}.ts"`)) {
      out.push(trel);
    }
  }
  return out;
}

function main(): void {
  const srcFiles = walk(SRC);
  const testFiles = walk(TEST);
  const scriptFiles = walk(SCRIPTS);
  const only = process.argv.includes('--file')
    ? process.argv[process.argv.indexOf('--file') + 1]
    : null;

  const hits: Hit[] = [];
  for (const f of srcFiles) {
    const rel = relative('.', f).replace(/\\/g, '/');
    if (only !== null && rel !== only) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    const guards = guardsFor(f, testFiles);
    /** 守卫文件里出现过的数字。审计脚本**不算**——25 个脚本里什么数都有，
     *  把它们算进「 watched 」就等于没有判据（`96`、`24` 到处都有）。 */
    const watched = new Set<string>();
    for (const g of guards) {
      for (const m of readFileSync(g, 'utf8').matchAll(NUM)) watched.add(m[1]);
    }
    /**
     * 同一个文件里，数字在**代码**（非注释）里出现过，也算有机器在看。
     *
     * 第一版拿 `stripCode(整行)` 算这个集合，而 `stripCode` 只剥引号不剥注释——
     * 于是注释行自己的数字也落进了 `inCode`，每一条候选都被自己洗掉，扫出 0 处。
     * **闸门报 0 处的时候先怀疑闸门。** 这里先把注释整段挖掉再数。
     */
    const inCode = new Set<string>();
    for (const raw of lines) {
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/^\s*\*.*$/, '');
      for (const m of stripCode(code).matchAll(NUM)) inCode.add(m[1]);
    }

    lines.forEach((raw, i) => {
      if (!/\/\/|\*|<!--/.test(raw)) return;
      if (SKIP.test(raw)) return;
      for (const m of stripCode(raw).matchAll(NUM)) {
        const n = m[1];
        if (inCode.has(n)) continue;
        if (watched.has(n)) continue;
        hits.push({ file: rel, line: i + 1, number: n, text: raw.trim(), guards });
      }
    });
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(hits, null, 2));
    return;
  }

  const byFile = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byFile.get(h.file) ?? [];
    list.push(h);
    byFile.set(h.file, list);
  }
  console.log(
    `散文数字候选：${hits.length} 处，分布在 ${byFile.size} 个源码文件。`
    + ' 判据是「它自己的守卫文件提都没提」——候选，不是缺陷。\n',
  );
  for (const [file, list] of [...byFile].sort()) {
    const g = list[0].guards;
    console.log(`── ${file}${g.length === 0 ? '  （没有任何测试 import 它）' : `  → ${g.join(', ')}`}`);
    for (const h of list) console.log(`  ${h.line}: [${h.number}] ${h.text.slice(0, 120)}`);
    console.log('');
  }
}

main();
