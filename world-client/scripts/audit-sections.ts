#!/usr/bin/env node
/**
 * 节号存在性审计：写明了是哪份文档的 `§N`，那份文档里得真有第 N 节。
 *
 * 为什么单立一项：本仓的注释习惯用「文档 §N」当依据，而这个形状**两边的错都犯过**，
 * 而且都没有任何机关会红——
 *   - `villager.ts` 写过「审计 §6.2」，而 `docs/adr/ADR_WORLD_ALIVE.md` 只有
 *     §1–§8 加一个附录，没有 §6.2。
 *   - `day-phase.ts` 写过「§6 缺口 2」，后来把萤火那条移出 §6 的编号列表，
 *     那个节号当场指向不存在的东西。
 * 两处都是人review挑出来、手工改掉的。这一类没有带行号的路径可查，
 * `audit-references.ts` 与 `audit-citations.ts` 都管不着。
 *
 * 判据（**只做结构判断，一句语义都不判**）：
 *   一行里出现 `§N`，先问这行指的是哪份文档。只有两种认法，认得出才查：
 *     1. 同一行点名了一份**已提交**的文档路径（`` `docs/adr/ADR_SAVE.md` §1 ``）。
 *     2. 同一行有一个文档别名，而它在已提交文件里只对应**一份**文档
 *        （`SPEC_V2` → `docs/SPEC_V2.md`；`ADR_SAVE` → `docs/adr/ADR_SAVE.md`）。
 *   认得出，就查那份文档里有没有第 N 节。没有 → 报。
 *
 * **不查的，以及为什么**（每条都是拿误判换来的，说清楚代价）：
 *   - **不查「那份文档在不在仓里」。** `ART_SPEC`、`ART_STYLE_TARGET`、
 *     `ART_PALETTE_AUDIT` 这三份从来未入库，而本仓**正当地**引用它们：
 *     `terrain-edge-visibility.test.ts` 文件头第 7-9 行明写「不在这个仓库里」，
 *     `palette-data.ts`、`ghost.ts`、`palette-budget.test.ts`、`day-phase.test.ts`
 *     里那些是**记录「原来挂着一个不存在的出处、已删」**的说明文字。
 *     「拿它当依据」与「记录它被删了」是语义，机器分不开——硬去分，就是把
 *     已经改对的地方再报一遍。所以这一形只**计数**（见输出的「待人看」段），
 *     不报缺陷。这与 `audit-citations.ts` 第 54 行是同一条规矩。
 *   - **不查那一节说的是不是那件事。** 只判编号在不在。
 *   - **裸 `§N`（没点名文档）不查。** 全仓两百多处，绝大多数指的是同文件或
 *     上文的某份文档，猜不出来。只计数。
 *
 * 「已提交」按 `git ls-files` 算，不按磁盘算：`docs/iterations/` 在磁盘上存在但
 * 从未入库，按磁盘算会把「读者打开这个仓库能拿到什么」这件事算错。git 不可用时
 * 退化成按磁盘算，并在输出第一行说明——那意味着本次运行的判据与设计不符。
 *
 * **这条闸门看不见的一类，写在这儿免得它装成全能**：`src/world/memory/` 与
 * `SandboxScene.ts` 里有 25 处裸写「补充设计 §N」。`docs/iterations/1027-task-2/`
 * 底下**两份**补充设计（v0.2 与 v1.0-params）都有 §0/§1/§1.1/§1.2/§1.3/§2/§2.1/
 * §2.2/§2.3/§3/§3.1/§3.2，而 §3.1 在两份里一个是「每日心电图指标汇总」、一个是
 * 「记忆协议参数初值表」，**内容不相干**。25 处**没有一处**点名版本，所以读者
 * 按 README 索引先翻到 v0.2，翻到的是另一件事。这一形别名对应不到任何一份已提交
 * 文件（文件名是 `architecture-supplement-*`，对不上「补充设计」四个字），因此
 * 全部落进上面的「要人判」计数里——**机器判不了是哪一份，只有人能判**。
 * 那 25 处都在别人的在飞工作里，本闸门不越界去改，只把形状记在这儿。
 *
 * 用法：
 *   node scripts/audit-sections.ts           # 人读报告（stdout）
 *   node scripts/audit-sections.ts --strict  # 有一处节号不存在就退出码 1
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SCAN_ROOTS: readonly string[] = [
  'docs',
  'GLOSSARY.md',
  'README.md',
  'world-client/src',
  'world-client/test',
  'world-client/scripts',
  'server',
];

/** `§4`、`§4.1`、`§4.1:218`（行号那一截丢掉，它不属于节号）。 */
const SEC = /§\s*(\d+(?:\.\d+)*)(?::\d+)?/g;
/**
 * 文档 token 的形状：一份仓内路径、一个全大写下划线名、或一个中文文档词。
 * 单拿出来不判对错——它得**紧贴在一个 `§N` 前面**才算点名了文档。
 */
const DOC_TOK =
  '(?:[\\w./-]+\\.(?:ts|mjs|md|py)|[A-Z][A-Z0-9]{1,}_[A-Z0-9_]{1,}|[一-龥]{2,}(?:文档|设计|规格|协议|审计|规范))';
/** token 紧贴在一个 `§N` 前面。反引号/引号/括号与空白都允许夹在中间。 */
const DOC_BEFORE_SEC = new RegExp(`(${DOC_TOK})\\s*[\`」』）)]*\\s*$`);
/** 往前看这么多字符找文档 token。够装下 `world-client/src/world/palette-data.ts`。 */
const WINDOW = 64;
/** 标题行：`## §1 标题` 与 `## 1. 标题` 都认。 */
const HEADING = /^#{1,6}\s+(.*)$/;

export interface SectionFinding {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly doc: string;
}

export interface SectionAudit {
  readonly findings: readonly SectionFinding[];
  /** 每一类跳过的处数。判据报不出跳过次数，等于没有判据。 */
  readonly skips: ReadonlyMap<string, number>;
  /** 受查的 `§N` 处数（认得出文档的那些）。 */
  readonly checked: number;
  /** git 是否可用。false 时「已提交」是拿磁盘冒充的。 */
  readonly viaGit: boolean;
}

/** 已提交文件的相对路径（一律 `/` 分隔）。git 不可用时退回磁盘扫描。 */
function committedFiles(root: string): { files: string[]; viaGit: boolean } {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
    return {
      files: out.toString('utf8').split('\0').filter((s) => s.length > 0),
      viaGit: true,
    };
  } catch {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(path.relative(root, p).split(path.sep).join('/'));
      }
    };
    walk(root);
    return { files, viaGit: false };
  }
}

/** 一份文档里出现过的节号集合。 */
function sectionsOf(root: string, rel: string): Set<string> {
  const out = new Set<string>();
  let text: string;
  try {
    text = readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (!m) continue;
    const title = m[1].trim().replace(/^§\s*/, '');
    const num = /^(\d+(?:\.\d+)*)/.exec(title);
    if (num) out.add(num[1]);
  }
  return out;
}

/** 磁盘上要扫的源文件（含未提交的——未提交的自述一样会骗到读的人）。 */
function scanFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mjs|md)$/.test(e)) out.push(p);
    }
  };
  for (const r of SCAN_ROOTS) walk(path.join(root, r));
  return out;
}

/**
 * `files` / `scan` 两个注入口只为测试：拿一份临时目录当仓库，不必真去
 * `git init`，也就不必让测试依赖当前工作区里别人正在飞的东西。
 * 默认值走真的 `git ls-files` 与真的目录扫描。
 */
export function auditSections({
  root = ROOT,
  files,
  scan,
}: {
  root?: string;
  files?: readonly string[];
  scan?: readonly string[];
} = {}): SectionAudit {
  const git = committedFiles(root);
  const committed = files ?? git.files;
  const viaGit = files === undefined ? git.viaGit : false;
  const committedSet = new Set(committed);

  // 按 stem 索引已提交文档：`SPEC_V2` → ['docs/SPEC_V2.md']。
  const byStem = new Map<string, string[]>();
  for (const rel of committed) {
    if (!/\.md$/.test(rel)) continue;
    const stem = path.basename(rel).replace(/\.md$/, '');
    const list = byStem.get(stem);
    if (list) list.push(rel);
    else byStem.set(stem, [rel]);
  }
  const sectionCache = new Map<string, Set<string>>();
  const sectionsFor = (rel: string): Set<string> => {
    let s = sectionCache.get(rel);
    if (!s) {
      s = sectionsOf(root, rel);
      sectionCache.set(rel, s);
    }
    return s;
  };

  const findings: SectionFinding[] = [];
  const skips = new Map<string, number>();
  const bump = (reason: string): void => {
    skips.set(reason, (skips.get(reason) ?? 0) + 1);
  };
  let checked = 0;

  for (const abs of scan ?? scanFiles(root)) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      SEC.lastIndex = 0;
      for (const m of line.matchAll(SEC)) {
        const sec = m[1];

        // 这一处 `§N` 指的是哪份文档？只看它**紧前面**那一段。
        // 第一版按「整行点名的路径」判，实测 68 处里几乎全是误报：一行里列着
        // 三四份文件时，`§N` 到底挂在谁身上机器分不清，而 `ADR_PALETTE_24.md:10`
        // 那种整句是**引用别处文件头原文**的，路径全是句子的主语、不是出处。
        // 改成紧贴判据之后误报归零，代价说清楚：`§8` 前面只写着「与」的那种
        // （`ADR_WORLD_ALIVE.md:4`）会漏掉——那是漏，不是冤。
        const before = line.slice(Math.max(0, m.index - WINDOW), m.index);
        const tok = DOC_BEFORE_SEC.exec(before);
        if (!tok) {
          bump('没点名文档（裸 §N，前面没有一个紧贴的文档 token）');
          continue;
        }
        const token = tok[1];

        // 路径：得是已提交的文件。别名的分支见下。
        if (/\.(?:ts|mjs|md|py)$/.test(token)) {
          const doc = committedSet.has(token)
            ? token
            : committed.find((c) => c.endsWith(`/${token}`));
          if (!doc) {
            bump('点名的路径不在已提交文件里（要人判，不报缺陷）');
            continue;
          }
          checked++;
          if (!sectionsFor(doc).has(sec)) {
            findings.push({ file: rel, line: i + 1, token: `§${sec}`, doc });
          }
          continue;
        }

        // 别名：按已提交文档的 stem 找。找不到或不止一份都不判。
        const hit = byStem.get(token);
        if (!hit) {
          bump('别名在已提交文档里没有对应文件（要人判，不报缺陷）');
          continue;
        }
        if (hit.length > 1) {
          bump('别名对应多份已提交文档，分不清是哪份');
          continue;
        }
        checked++;
        if (!sectionsFor(hit[0]).has(sec)) {
          findings.push({ file: rel, line: i + 1, token: `§${sec}`, doc: hit[0] });
        }
      }
    });
  }

  return { findings, skips, checked, viaGit };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const r = auditSections();
  if (!r.viaGit) {
    console.log('# 注意：git 不可用，「已提交」是拿磁盘冒充的——本次判据与设计不符。\n');
  }
  for (const [reason, n] of [...r.skips].sort((a, b) => b[1] - a[1])) {
    console.log(`跳过 ${n} 处：${reason}`);
  }
  console.log(`\n受查 ${r.checked} 处（认得出文档的 §N）。`);
  if (r.findings.length === 0) {
    console.log('节号全部对得上。');
    return;
  }
  console.log(`\n节号对不上 ${r.findings.length} 处：`);
  for (const f of r.findings) {
    console.log(`  ${f.file}:${f.line}  ${f.token} —— ${f.doc} 里没有这一节`);
  }
  if (strict) process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
