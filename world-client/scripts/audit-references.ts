#!/usr/bin/env node
/**
 * 行号引用审计：文档与注释里写的「代码在那儿」，得真的是在那儿。
 *
 * 为什么单独立一项：这个仓库的信条是「说谎比不去更糟」（`docs/SPEC.md`、
 * `world-client/src/world/routines.ts` 开头那段）。那句只管世界对用户说的话，
 * 可同一个毛病在仓库自己身上一样成立——`docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md`
 * 写「留白环（`grid.ts:230-237`）」，而 `canPlace` 的留白环今天在
 * `grid.ts:258-266`。看着行号翻过去的人，看见的是 `place()` 里给门口铺石头
 * 的那三行，于是照着错的上下文改代码。行号不会自己跟上：它每被一次提交
 * 推移一点，而写它那天之后没有人再核对过。
 *
 * 所以这里把它变成一条 CI 跑得到的断言，而不是一份「写完就对一次」的清单。
 *
 * 查五样：
 *   1. **指的文件存在**。引用写作 `grid.ts:230-237` 时只有一个裸文件名，
 *      所以按「引用者目录 → 仓库根 → 全仓唯一后缀」的顺序找。后缀撞上多个
 *      文件时报出来并列出候选——那不是脚本猜得了的，是人得挑一个写清楚。
 *   2. **行号在文件里**。越界比指错更糟：它连一个错位置都不指向。
 *   3. **那段里有可以落脚的东西**。空行与纯括号都算「什么都没指」——
 *      指着 `});` 不如不指。指着注释是正当的：ADR 经常引的就是注释的原文。
 *   4. **省略文件名的续引也在查**。「调用在 `setup.ts:320`、`:595`，定义在
 *      `:622`」这种写法只有第一处带文件名。不带文件名的那些曾完全没人管，
 *      于是 `test/terrain-edge-visibility.test.ts` 里那个指向不存在文档的
 *      第 218 行一直绿着。现在同一段里最近的那个文件会被带下去，空行一断就忘。
 *   5. **「那东西就在这儿」这种引用，那儿得有那样东西**。`scatterToShelter()`
 *      （`simulation.ts:1440`）这种写法把名字写在坐标旁边，本身是一句可验的
 *      断言——而 1440 那段今天讲的是潮位拒收。它曾一直绿着：行号在文件里、
 *      那段也有代码，只是代码是**别的**。见 `CALL_REF` 上那段。
 *
 * 两处**不查**，都是有意的：
 *   - 网址里的 `:8080` 是端口。整段挖掉，不是「这行有网址就整行跳过」——
 *     一行里可以同时有网址和真引用，按行跳过会把真的那一处一起放过。
 *   - 「见 a.ts 第 3 行」这种行文没有冒号，本来就不是指针。
 *
 * 不查「那段说的是不是那件事」：那是语义，机器判不了，也不该由脚本假装能判。
 * 所以「指着一段散文，可作者意思是那边的调用」这一类，脚本放它过去，
 * 靠 `--strict` 之外的那双眼睛。它能挡住的是**行号自己烂掉**那一种——
 * 那一种每天都在发生，而且没有任何别的机关在管。
 *
 * 用法：
 *   node scripts/audit-references.ts           # 人读报告（stdout）
 *   node scripts/audit-references.ts --strict  # 有任何一处存疑就退出码 1
 *
 * 与 `audit-palette.mjs` 分开：那个管颜色预算，这个管自述为真，两件不相干。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 仓库根。这个脚本从 `world-client/` 里被 CI 调用，但它管的是整座仓库的自述。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 哪些地方的话要算数：文档、词汇表、自述、源码、测试、脚本。 */
const SCAN_ROOTS: readonly string[] = [
  'docs',
  'GLOSSARY.md',
  'README.md',
  'world-client/src',
  'world-client/test',
  'world-client/scripts',
  'server',
];

/** 不算「引用」的后缀：json 里没有行号可指，png 更不是文本。 */
const TEXT_EXT = /\.(ts|mjs|py|md)$/;

/** `file.ext:123` 或 `file.ext:123-145`。 */
const REF = /([\w./-]+\.(?:ts|mjs|py|md)):(\d+)(?:-(\d+))?/g;

/**
 * 省略了文件名的续引：`` `:123` ``、`` `:123-145` ``。
 *
 * 紧跟一个前引号是**硬条件**。`width: 64` 这种代码里的键值对也长得像，
 * 少了这个条件就会把一段里随便一句 `x: 12` 当成续引去查——那是误报，
 * 而误报一样毁掉一个守卫，只是毁得慢一点。
 */
const BARE_REF = /`:(\d+)(?:-(\d+))?`/g;

/** 一处引用。`ref` 为 null 表示文件名省略了，要接同一段里上一处的那个。 */
interface Hit {
  readonly index: number;
  readonly ref: string | null;
  readonly first: string;
  readonly last: string | undefined;
}

/** 一行里的全部引用，按出现顺序。
 *
 * 两个正则分开扫再合起来排序：省略文件名的那种要接着前一处带文件名的，
 * 而「前一处」是按位置算的，不是按哪个先扫完算的。 */
function hits(line: string): readonly Hit[] {
  const out: Hit[] = [];
  for (const m of line.matchAll(REF)) {
    if (m[1] === undefined || m[2] === undefined) continue;
    out.push({ index: m.index ?? 0, ref: m[1], first: m[2], last: m[3] });
  }
  for (const m of line.matchAll(BARE_REF)) {
    if (m[1] === undefined) continue;
    out.push({ index: m.index ?? 0, ref: null, first: m[1], last: m[2] });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * 一行里的网址整段。`https?://` 后面跟到空白为止。
 *
 * 为什么要整段挖掉、而不是「这行有网址就整行不算」：一行里可以同时有网址和
 * 真引用——「留白环见 `grid.ts:258-266`（背景见 https://…）」这种句子很自然。
 * 按行跳过会把那句里**真的**那一处一起放过：代码挪走、行号烂掉，而 CI 全绿。
 * 那正是这个脚本存在的理由所不容的一种沉默，比误报糟得多。
 *
 * 实测（2026-10-27）全仓当时只有一处落在那种沉默里，就是它自己测试数据里的
 * 那一行。那是运气，不是设计——所以改成逐处判。
 */
const URL_SPAN = /https?:\/\/\S*/g;

/** 把网址换成等长空白，剩下的才拿去找引用。
 *
 * 换空白而不是删掉：行里剩下的相对位置不变，将来若要在报错里带上列号也用得上。
 */
function stripUrls(line: string): string {
  return line.replace(URL_SPAN, (span) => ' '.repeat(span.length));
}

/** 一行里有没有可读的字符。中文也算：行号常常就指着一段中文注释。 */
const HAS_GLYPH = /[A-Za-z_$\p{Script=Han}]/u;

/** 一行里除了空白与括号，什么都没有。 */
const ONLY_BRACES = /^[\s{}()[\];,]*$/;

/**
 * 「那东西就在这儿」这种引用：一个带括号的函数名，后面紧跟一个坐标。
 *
 * 前四样都只查「行号自己烂没烂」——越界、空行、文件不存在。可还有一种烂法
 * 它们一句都说不出来：行号还在文件里、那段也有代码，只是那段是**别的**。
 * `scatterToShelter` 的定义挪走之后，它引的那个 1440 是一段讲潮位的注释，
 * 而 CI 全绿。这个脚本自己的文件头原来就写着「不查那段说的是不是那件事」——
 * 那是语义，机器判不了，也不该由脚本假装能判。
 *
 * 可这一种**不需要**懂语义：引用者自己把名字写在了坐标旁边。名字加一对括号、
 * 后面隔几个字一个坐标，这就是一句「这东西在那儿」的断言，而它可验。
 *
 * 两处收得很紧，都是有意的：
 *   - **名字后面必须立刻跟着坐标**，中间只允许一个括号（和一个反引号）。
 *     ADR 里有「每个模板都过同一个 `prefab()` 助手、`boundTask` 硬编码 null
 *     （`pack.ts:14`）」这种句子：`prefab()` 是顺带提的，坐标说的是
 *     `boundTask`。隔开半句再去认领一个坐标，就是把一句真话说成疑点——
 *     而误报一样毁掉一个守卫，只是毁得慢一点。
 *   - **必须带 `()`**。`placeBlueprint`（内部走…）这种只是提一句名字，
 *     不是在报位置，拿它去查坐标就是误报。
 *
 * 名字与坐标两头都**不要求**反引号：实测的那个样本里两者都是裸的。第一版两头
 * 都要求，于是一处都没匹配上——而它恰恰是这条判据唯一的活样本。守卫闭上嘴比
 * 没有守卫更糟，所以拿真仓库里那个形状当验收，不是拿想象当中的形状。
 *
 * 本文件的注释里因此不写那种形状的示例：审计连自己的注释一起审。
 */
const CALL_REF =
  /([A-Za-z_$][\w$]*)\(\)\s*[（(]?\s*`?([\w./-]+\.(?:ts|mjs|py|md)):(\d+)(?:-(\d+))?`?(?:[\s）)]|$)/g;

/** 引用允许偏几行：ADR 常引函数上面那段注释，而注释里不一定再写一遍函数名。 */
const CALL_REF_SLACK = 3;

/** 一处存疑的引用。 */
export interface ReferenceFinding {
  /** 引用写在哪儿：那份文档的路径，冒号后是行号。 */
  readonly where: string;
  /** 写的那一串：`grid.ts`。 */
  readonly ref: string;
  /** 为什么存疑。 */
  readonly why: string;
}

export interface ReferenceAudit {
  /** 一共查了多少处。 */
  readonly checked: number;
  readonly findings: readonly ReferenceFinding[];
}

/**
 * 一段里有没有可以落脚的**东西**。
 *
 * 判「那段不全是空行、也不只是括号」——不是判「那段里有代码」。
 * 区别是要紧的：ADR 引用 `blueprints.ts:103-104` 时引的是那两行**注释**的原文
 * （「0 栋等于这类活无处可去」），指着注释是正当的，脚本不该拦。
 * 而指着 `});` 或一片空行是另一回事——那不是位置，是真空。
 *
 * 仍然查不了的是「指着散文，可作者意思是那边的调用」。那要懂语义，
 * 机器判不了，也不该由脚本假装能判（见文件头第三条）。
 */
function hasCode(body: string): boolean {
  return body.split(/\r?\n/).some((line) => HAS_GLYPH.test(line) && !ONLY_BRACES.test(line));
}

function walk(dir: string, out: string[]): string[] {
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    const base = path.basename(dir);
    // node_modules 与缓存里没有人的话，只有生成物。
    if (base === 'node_modules' || base === '__pycache__' || base === '.git' || base === '.vite') {
      return out;
    }
    for (const name of readdirSync(dir)) walk(path.join(dir, name), out);
    return out;
  }
  if (TEXT_EXT.test(dir)) out.push(dir);
  return out;
}

/** 一个裸文件名解析出来的结果：唯一命中、多个候选、或者没有。 */
type Resolved = { readonly file: string } | { readonly candidates: readonly string[] } | null;

/** 按后缀找唯一的那一个。
 *
 * 一律换成 `/` 再比：引用里写的是 `/`，而 `path.join` 在 Windows 上给的是 `\`。
 * 直接 `endsWith(path.sep + ref)` 在 Windows 上一个都匹配不上——
 * 那会让一整类「写对了但没写全」的引用被误判成「找不到这个文件」。 */
function bySuffix(ref: string, index: readonly string[]): Resolved {
  const wanted = ref.split(path.sep).join('/');
  const hits = index
    .map((file) => file.split(path.sep).join('/'))
    .filter((posix) => posix === wanted || posix.endsWith(`/${wanted}`));
  if (hits.length === 0) return null;
  if (hits.length === 1) return { file: hits[0]! };
  return { candidates: hits };
}

function resolveRef(ref: string, fromDir: string, index: readonly string[]): Resolved {
  const direct = path.resolve(fromDir, ref);
  if (index.includes(direct)) return { file: direct };
  const fromRoot = path.resolve(ROOT, ref);
  if (index.includes(fromRoot)) return { file: fromRoot };
  return bySuffix(ref, index);
}

/**
 * 把一个引用落到文件行上。
 *
 * 落不下去就回一句为什么；落得下去就回那份文件的全部行，连引用指的区间，
 * 好让调用方自己再看那一段里该有什么。
 */
function land(
  named: string,
  first: string,
  last: string | undefined,
  file: string,
  root: string,
  index: readonly string[],
):
  | { readonly ok: true; readonly lines: readonly string[]; readonly from: number; readonly to: number; readonly span: string }
  | { readonly ok: false; readonly why: string } {
  const resolved = resolveRef(named, path.dirname(file), index);
  if (resolved === null) return { ok: false, why: '找不到这个文件' };
  if ('candidates' in resolved) {
    const names = resolved.candidates.map((c) => path.relative(root, c)).join('、');
    return { ok: false, why: `裸文件名撞上 ${resolved.candidates.length} 个文件（${names}）——写全路径` };
  }
  const target = readFileSync(resolved.file, 'utf8').split(/\r?\n/);
  const from = Number(first);
  const to = last === undefined ? from : Number(last);
  const span = `${path.relative(root, resolved.file)}:${first}${last === undefined ? '' : `-${last}`}`;
  if (from < 1 || to > target.length) {
    return { ok: false, why: `${span} 越界：那份一共 ${target.length} 行` };
  }
  return { ok: true, lines: target, from, to, span };
}

/**
 * 审一遍。`root` 可换，为的是测试能拿一份临时目录跑，不必动真仓库。
 */
export function auditReferences({ root = ROOT }: { root?: string } = {}): ReferenceAudit {
  const index: string[] = [];
  for (const entry of SCAN_ROOTS) walk(path.resolve(root, entry), index);
  index.sort();

  const findings: ReferenceFinding[] = [];
  let checked = 0;

  for (const file of index) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    // 一个段落里最近解析出来的那个文件。
    //
    // 「调用在 `setup.ts:320`、`:595`，定义在 `:622`」这种写法很常见——同一个
    // 文件连指几行，只有第一处带文件名。不带文件名的那些曾是完全没人查的：
    // `test/terrain-edge-visibility.test.ts` 里就留着这么一个指向不存在文档的
    // 「218 行」续引，而审计一直绿着。所以这里把最近的那个文件带下去。
    //
    // 只在**同一个段落**里带，且每个文件重新起算：空行一断就忘。跨段落或跨文件
    // 带会把 `:218` 安到一个毫不相干的文件头上——那是误报，而误报一样毁掉一个守卫。
    let carried: string | null = null;
    lines.forEach((line, at) => {
      // 网址先挖掉：`http://example.com/a.ts:8080` 里那一段长得跟引用一模一样，
      // 可 `:8080` 是端口，不是行号。见 `URL_SPAN` 上那段为什么不能按行跳过。
      const scanned = stripUrls(line);
      // 空行断段。注释壳（` *`、`//`、`---`）不算内容：它独自一行时什么都不说。
      if (!HAS_GLYPH.test(scanned.replace(/^[\s*/#-]+/, ''))) {
        carried = null;
        return;
      }
      for (const hit of hits(scanned)) {
        // 文件名省略时接着同一段里上一处那个；一段的开头没有可接的，那它就不是指针。
        const named = hit.ref ?? carried;
        if (named === null) continue;
        checked += 1;
        const where = `${path.relative(root, file)}:${at + 1}`;
        const landed = land(named, hit.first, hit.last, file, root, index);

        if (!landed.ok) {
          findings.push({ where, ref: named, why: landed.why });
          continue;
        }
        // 这一段指的文件记下来：后面省略文件名的那些处接它。
        carried = named;
        if (!hasCode(landed.lines.slice(landed.from - 1, landed.to).join('\n'))) {
          findings.push({
            where,
            ref: named,
            why: `${landed.span} 那段里没有代码，只有空行或括号`,
          });
        }
      }

      // 第五样：「这东西在那儿」这种断言，那儿得有那样东西。见 `CALL_REF`。
      // 单独立一段而不是并进上面那个循环：它多带一个名字，也多一条判据。
      for (const m of scanned.matchAll(CALL_REF)) {
        const name = m[1];
        if (name === undefined || m[2] === undefined || m[3] === undefined) continue;
        checked += 1;
        const where = `${path.relative(root, file)}:${at + 1}`;
        const landed = land(m[2], m[3], m[4], file, root, index);        if (!landed.ok) {
          findings.push({ where, ref: m[2], why: landed.why });
          continue;
        }
        // 允许偏几行：引用指的常是函数上面那段注释，而注释里不一定再写一遍名字。
        const lo = Math.max(0, landed.from - 1 - CALL_REF_SLACK);
        const hi = Math.min(landed.lines.length, landed.to + CALL_REF_SLACK);
        if (!landed.lines.slice(lo, hi).join('\n').includes(name)) {
          findings.push({
            where,
            ref: m[2],
            why: `${landed.span} 那段附近没有 ${name}——引用说它在那儿，可那儿不是它`,
          });
        }
      }
    });
  }

  return { checked, findings };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const { checked, findings } = auditReferences();
  const shown = findings.slice(0, 40);
  for (const finding of shown) {
    process.stdout.write(`${finding.where}  ${finding.ref} —— ${finding.why}\n`);
  }
  if (findings.length > shown.length) {
    process.stdout.write(`……还有 ${findings.length - shown.length} 处\n`);
  }
  process.stdout.write(`共查 ${checked} 处行号引用，${findings.length} 处存疑\n`);
  // 跟调色板那个不一样：这里没有预算可超，只有自述为真这一条。
  // 所以 `--strict` 的退出码只看有没有存疑，不看多少。
  if (strict && findings.length > 0) process.exitCode = 1;
}

// 被 import 时不跑 main：测试要的就是那个纯函数，不是它的退出码。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
