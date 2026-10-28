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
 * 文件**里（同名 `.test.ts`，或 import 了它的那些）。测试文件有多少个不重要，
 * 重要的是**不能**「随便哪个文件里冒出同一个数字都算锁了」——`96`、`24`
 * 这种数在任何测试里都找得到，而那一处注释说的可能是完全另一件事。
 * 那正是「冤判看着像闸门」：宽判据会让脏数混过去，比没有闸门更糟。
 * （2026-10-28：这里原来写「全仓库 103 个测试文件」。今天 `git ls-files
 * world-client/test` 是 **137** 个 `.test.ts`——这个数每加一个测试就烂一次，
 * 而它在本文件里不承重，所以删掉，只留它要说明的那件事。）
 * （**同日补记：上一句说自己「删掉」，其实没删——它把 103 换成了 137。**
 * 而 137 也已经烂了：今天同一命令数出来是 **150**。一个每加一个测试就烂
 * 一次的数，写进注释就是留一个下次一定假的承诺，而它在这儿本来就不承重。
 * 现在真的删掉。要说明的那件事与仓库里有多少个测试文件无关：判据收得紧，
 * 紧到数字必须出现在**测这个源文件的那个测试文件**里。）
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

/**
 * 结构性坐标与编号，不是实测值。
 *
 * **片段级，不是整行级。** 第一版拿它当整行开关：`if (SKIP.test(raw)) return;`
 * ——一行里出现 `§6` 就把整行丢了。可注释里「§6 缺口 2」与「77 万与 87% 还在那个
 * 脚本第 6 行」常常同住一行，后者正是这个工具唯一该抓的东西，却因为同一行有个
 * §号被一起丢掉。2026-10-28 在本仓实测：整行丢 568 处候选，改成先把这些片段
 * 挖掉再数是 581 处——少的 13 处里有 `fog-view.ts` 的 `77 万`/`87%`、
 * `fuse.ts` 的 `95%`、`palette-data.ts` 的两个 luma，全是量过的值。
 * （**这三个数是 2026-10-28 那一刻的，加一个源文件就漂**——它们只为说明
 * 「漏的是量过的值」，不承重。承重的是 `test/prose-numbers.test.ts`。）
 * **而那 13 处是单调多出来的**：整行丢的时候这一行一条都不报，不存在
 * 「改完反而漏掉」的那一侧。
 *
 * 所以下面只 `replace`，不 `test`。也因此它必须带 `g`：不带 `g` 只挖得掉第一处，
 * 同一行第二个 `§4.1` 会留下一个 `.1`。而带 `g` 的正则被 `.test()`/`.exec()` 调会
 * 留下 `lastIndex`，下一次测同一行就时灵时不灵——**别在这儿加 `.test()`**。
 * （**2026-10-28 补记：上一句的机制说错了，而结论该比它更强。** 实测同一行两个
 * `§4.1`：不带 `g` 时**第二条整条留着**，不是「留下一个 `.1`」——于是 `NUM` 的
 * `\d+\.\d+` 那一支真的收下它，变成一个假候选 `4.1`（`§` 既不是 `\w` 也不是
 * `.`，前面的 lookbehind 挡不住它）。`ADR-1 与 ADR-12345` 同理：第二条活着，
 * `12345` 就成了候选。所以 `g` 不是「挖得干净点」，是**不挖第二处就报假数**。）
 *
 * 数字部分一律 `\d+` 而不是 `\d`：`ADR[-_ ]?\d` 只吃掉 `ADR-1`，`ADR-12345`
 * 会剩一个 `2345` 变成假候选。`#\d+` 对十六进制色值（`#3a3f3b`）一样安全——
 * 它只吃到 `#3`，剩下的 `a3f3b` 里没有连续两位数字。`§\s*\d+` 吃掉 `§4` 留下
 * `.1`，而 `NUM` 的数字前有 `(?<![\w.])` 挡着，`.` 后面的单个数字不算。
 * （**同日补记：色值那句是拿一个安全样本当了全体。** `#3a3f3b` 确实安全，
 * 可本仓不是：`#3b3423` 挖完剩 `b3423`（里面有 `3423`）、`#4e6241` 剩 `e6241`、
 * `#2b322c` 剩 `b322c`、`#8e968c` 剩 `e968c`——`index.html`、
 * `audit-palette.mjs`、`palette-data.ts` 里都有，共 28 个。所以「剩下的没有
 * 连续两位数字」是假的。**结论仍成立，但兜它的不是那个理由**：真正兜住的是
 * 下一行那个 `(?<![\w.])`——这些两位数串前面都跟着一个字母，lookbehind 一律
 * 挡掉。也就是说这一行的安全性押在 lookbehind 上，不押在「十六进制挖得干净」。
 * 哪天 lookbehind 松了，红的是这儿。）
 */
const SKIP = /(第\s*\d+\s*行|§\s*\d+|ADR[-_ ]?\d+|issue\s*#?\d+|#\d+)/gi;

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
  const only = process.argv.includes('--file')
    ? process.argv[process.argv.indexOf('--file') + 1]
    : null;

  const hits: Hit[] = [];
  for (const f of srcFiles) {
    const rel = relative('.', f).replace(/\\/g, '/');
    if (only !== null && rel !== only) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    const guards = guardsFor(f, testFiles);
    /** 守卫文件里出现过的数字。审计脚本**不算**——`scripts/` 里什么数都有，
     *  把它们算进「 watched 」就等于没有判据（`96`、`24` 到处都有）。
     *  （原来这里写着「25 个脚本」。那个数今天对不上：`git ls-tree -r --name-only
     *  HEAD -- scripts` 是 29 个。它在本文件里不承重，删掉——同文件头删掉
     *  「全仓库 103 个测试文件」是同一条规矩。）
     *  （**2026-10-28 补记：上面那条命令少说了一个前提——它只在 `world-client/`
     *  里成立。** 在仓库根跑同一条，`-- scripts` 匹配不到任何东西，git 不认为那是
     *  错：**返回 0 行、退出码 0**。照抄到根上的人会看到「一个脚本都没有」，
     *  语气与「29 个」一样确定。静默返回空的复算命令比没有命令更坏——它长得像
     *  确认。现已补上路径：`git ls-tree -r --name-only HEAD -- world-client/scripts`。） */
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
      // 先把结构性编号从这一行里挖掉，再在剩下的里数——见 SKIP 上面那段。
      for (const m of stripCode(raw.replace(SKIP, '')).matchAll(NUM)) {
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
