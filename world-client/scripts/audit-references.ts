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
 * 查三样：
 *   1. **指的文件存在**。引用写作 `grid.ts:230-237` 时只有一个裸文件名，
 *      所以按「引用者目录 → 仓库根 → 全仓唯一后缀」的顺序找。后缀撞上多个
 *      文件时报出来并列出候选——那不是脚本猜得了的，是人得挑一个写清楚。
 *   2. **行号在文件里**。越界比指错更糟：它连一个错位置都不指向。
 *   3. **那段里有可以落脚的东西**。空行与纯括号都算「什么都没指」——
 *      指着 `});` 不如不指。指着注释是正当的：ADR 经常引的就是注释的原文。
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

/** 一行里带网址就不查：`//host/a` 后面跟的端口不是行号。 */
const URL_ISH = /https?:\/\//;

/** 注释里写「见 grid.ts 第 12 行」这种行文不算指针：它没有坐标。 */
const PROSE_LINE = /第\s*\d+\s*行/;

/** 一行里有没有可读的字符。中文也算：行号常常就指着一段中文注释。 */
const HAS_GLYPH = /[A-Za-z_$\p{Script=Han}]/u;

/** 一行里除了空白与括号，什么都没有。 */
const ONLY_BRACES = /^[\s{}()[\];,]*$/;

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
    lines.forEach((line, at) => {
      // 网址里的 `:8080` 是端口，「见 grid.ts 第 12 行」是行文——两者都没有坐标。
      if (URL_ISH.test(line) || PROSE_LINE.test(line)) return;
      for (const match of line.matchAll(REF)) {
        const [, ref, first, last] = match;
        if (ref === undefined || first === undefined) continue;
        checked += 1;
        const where = `${path.relative(root, file)}:${at + 1}`;
        const resolved = resolveRef(ref, path.dirname(file), index);

        if (resolved === null) {
          findings.push({ where, ref, why: '找不到这个文件' });
          continue;
        }
        if ('candidates' in resolved) {
          const names = resolved.candidates.map((c) => path.relative(root, c)).join('、');
          findings.push({
            where,
            ref,
            why: `裸文件名撞上 ${resolved.candidates.length} 个文件（${names}）——写全路径`,
          });
          continue;
        }

        const target = readFileSync(resolved.file, 'utf8').split(/\r?\n/);
        const from = Number(first);
        const to = last === undefined ? from : Number(last);
        const span = `${path.relative(root, resolved.file)}:${first}${last === undefined ? '' : `-${last}`}`;
        if (from < 1 || to > target.length) {
          findings.push({
            where,
            ref,
            why: `${span} 越界：那份一共 ${target.length} 行`,
          });
          continue;
        }
        if (!hasCode(target.slice(from - 1, to).join('\n'))) {
          findings.push({
            where,
            ref,
            why: `${span} 那段里没有代码，只有空行或括号`,
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
