#!/usr/bin/env node
/**
 * 引用存在性审计：注释与文档里**不带行号**写下的「那个文件」，得真的是个文件。
 *
 * 为什么单独立一项：`audit-references.ts` 查的是带行号的引用，它的正则
 * `([\w./-]+\.(?:ts|mjs|py|md)):(\d+)` 里冒号加行号是**硬条件**。于是另一类
 * 完全没人管——`night.ts`、`docs/LARGE_WORLD.md`、`ART_SPEC` 这种只写文件名、
 * 不写行文的引用，它一处都看不见。而这个仓库已经为那一类付过代价：六个幽灵
 * 引用（`docs/VIEW_CULLING_RESEARCH.md`、`ART_SPEC` §2.4、`night.ts`、
 * `docs/LARGE_WORLD.md`、`docs/WORLD_INTENT.md`、`ART_STYLE_TARGET`）全史
 * 都没有对应文件，每一个都曾在注释里被当成依据引用过。
 *
 * 所以这里补那道闸：**反引号里长得像路径的 token，必须在仓里对应一个真实文件。**
 *
 * 判据有意很窄（`prose-numbers.ts` 是同一种做法：宁可漏，不可冤）。一个 token
 * 要受查，得同时满足：
 *   1. 带一个已知后缀（ts/mjs/js/py/md/json/html/css/txt/sh/yml）。
 *   2. **不含空白**。命令行（`FEED=1 node scripts/smoke.mjs`）、git 子命令
 *      （`git show 3f08e94 -- scripts/audit-references.ts`）因此直接出局——
 *      它们不是引用，是把命令抄进了注释。
 *   3. 不含 glob 字符 `*?[]{}<>$|`。
 *   4. 不以 `~` 开头（`~/Downloads/像素异界设定集….md` 是仓外的东西）。
 *   5. 不以 `/` 开头。那在注释里是 URL 路由或站点根路径（`/api/memory/entry/…`），
 *      不是仓内相对路径。**代价说清楚**：万一有人用绝对路径写一处仓内引用，它看不见。
 *      本仓的自述一律用相对路径，所以这一条现在不亏——但它是一条会沉默的规则，
 *      不是一条不会错的规则。
 *   6. 不是裸后缀：`.ts`、`.test.ts` 说的是后缀本身，不是文件。
 *
 * 受查之后再找它在仓里对应哪个文件。判据只有一层：**全仓后缀匹配**。
 * 这一层是必需的——`docs/adr/*.md` 里写 `world/setup.ts`，说的是
 * `world-client/src/world/setup.ts`，仓库根下的文档按模块内相对路径引用。
 * 实测关掉它，未解析从 0 涨到 49 处 / 28 个不同 token。
 * （另加仓库根与 `world-client/` 两个直接落点，只为少走一遍全仓扫描，不多一道判据。）
 *
 * 原来还写过「从引用者逐级祖先目录找」和「basename 索引」两层，**都已删**：它们被
 * 后缀匹配严格包含——若 `<某层祖先>/<tok>` 是文件，它的路径必然以 `/<tok>` 结尾；
 * 若某文件 basename 是 `<tok>`，同样以 `/<tok>` 结尾。所以那两层永远不可能多解析
 * 一个 token，留着只会让人以为它们在干活。这不是「今天贡献为 0」，是结构上多余。
 *
 * 三条**不查**，都是有意的，而且每一条都是拿误判换来的：
 *   - **ALL_CAPS 名不查**。`ART_SPEC` 与常量名、环境变量名形状完全相同，
 *     判据分不开。曾经试过「在全仓正文里出现 >1 次就算存在」，实测那一条的
 *     唯一效果是冤掉 `MOON_PHASES`（`test/phase-purity.test.ts` 里举的假想常量，
 *     只出现 1 次所以反而被报），而对 `ART_SPEC`（出现 12 次）照旧放行——
 *     **一条只产误报、不产真阳的判据比没有更糟**，所以整条删掉。代价说清楚：
 *     上面那六个幽灵里，`ART_SPEC` 与 `ART_STYLE_TARGET` 这一形**抓不到**。
 *     另四个（`night.ts`、`VIEW_CULLING_RESEARCH.md`、`LARGE_WORLD.md`、
 *     `WORLD_INTENT.md`）按裸文件名/带后缀查，一抓就着。
 *   - **否定语境的词不单独用来跳过**。曾经按「这行有『不存在』就整行不算」
 *     放过一大片（182 处），那是拿一个词换一整行的沉默——这行里完全可以
 *     同时有一处真引用和一句「某处不存在的说明」。改成逐 token 判：真引用的
 *     那一处照查。确实在记录「这是个幽灵」的那些，逐条列进 `KNOWN` 并写明理由，
 *     让理由本身可被复审，而不是靠一个词蒙混过去。
 *   - **不查那段说的是不是那件事**。那是语义，机器判不了。这里只判文件在不在。
 *
 * `KNOWN` 是**白名单，不是垃圾抽屉**：每一条都得写明它为什么不算缺陷，写不出
 * 理由的应当去修而不是往里加。它的存在是为了让输出正好等于「新缺陷」——
 * 一个每次跑都报 20 几条的闸门，人会学会不看它，那比没有闸门更糟。
 *
 * 用法：
 *   node scripts/audit-citations.ts           # 人读报告（stdout）
 *   node scripts/audit-citations.ts --strict  # 有白名单外的一处就退出码 1
 *
 * 与 `audit-references.ts` 分开：那个管带行号的引用指得准不准，这个管不带行号的
 * 引用是不是真的存在，两件不相干，正则可判的范围也不重叠。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 仓库根。这个脚本从 `world-client/` 里被 CI 调用，但它管的是整座仓库的自述。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 哪些地方的话要算数。与 `audit-references.ts` 同一份清单，免得两边口径不一。 */
const SCAN_ROOTS: readonly string[] = [
  'docs',
  'GLOSSARY.md',
  'README.md',
  'world-client/src',
  'world-client/test',
  'world-client/scripts',
  'server',
];

/** 已知后缀。没有后缀的 token（`ART_SPEC`、`MOON_PHASES`）一律不受查。 */
const KNOWN_EXT = /\.(ts|mjs|js|py|md|json|html|css|txt|sh|yml)$/;

/** 反引号内容。单行、不含反引号——跨行的反引号是代码块，不是行内引用。 */
const BACKTICK = /`([^`\n]+)`/g;

/** glob 与 shell 元字符。出现任意一个就不是一个具体路径。 */
const GLOB = /[*?[\]{}<>$|]/;

/** 不算目录的：node_modules、构建产物、版本库内部。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.vite',
  '__pycache__',
  '.pytest_cache',
]);

/**
 * 已知不算缺陷的 token，每条带理由**和一份文件清单**。
 *
 * **加一条之前先想清楚能不能改成修。** 这里的每一条都是一次「这句话指的东西不在
 * 仓里，但这句话没有说谎」的裁决，而裁决是人做的，会错。
 *
 * 为什么带文件清单：白名单按 token 放行，等于在**全仓**赦免这个 token。那样
 * `night.ts` 今天在 `phase-view.ts` 里是一句「这个文件从来不存在」的正确记录，
 * 明天有人在别的渲染文件里写「沿用 `night.ts` 的手法」照样绿——那正是这个
 * 脚本要防的事。所以放行只放到**列出名的那些文件**，换一个文件提就报。
 * 清单也因此是一份可复审的东西：某条只在一个文件里出现，哪天那个文件改了，
 * 这条要么跟着改，要么变成一处新缺陷，不会无声无息地继续赦免。
 */
const KNOWN: Readonly<Record<string, { why: string; at: readonly string[] }>> = {
  // —— 旧项目路径。`docs/MIGRATION_FROM_XIAOXI.md` 与
  // `docs/SPEC_DRAFT_20261025.md` 的搬迁表，左列是曦计划那一侧的路径，
  // 右列才是本仓的。表的第一列整列都不该按本仓路径要求。
  'docs/LARGE_WORLD.md': {
    why: '五处里有三处在记录「这份不在本仓」，另两处是搬迁表左列，没有一处拿它当依据',
    at: [
      'docs/MIGRATION_FROM_XIAOXI.md',
      'docs/adr/ADR_SAVE.md',
      'docs/adr/ADR_WORLD_ALIVE.md',
      'world-client/test/dressing.test.ts',
      'world-client/scripts/audit-citations.ts',
    ],
  },
  'pixel-world/src/world/simulation.ts': {
    why: 'SPEC_DRAFT 搬迁表左列（曦计划旧路径）',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },
  'pixel-world/src/world/save.ts': {
    why: 'SPEC_DRAFT 搬迁表左列（曦计划旧路径）',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },
  'pixel-world/index.html': {
    why: 'SPEC_DRAFT 搬迁表左列（曦计划旧路径）',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },
  'pixel-world/src/world/projection.ts': {
    why: 'SPEC_DRAFT 搬迁表左列（曦计划旧路径）',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },
  'src/world/ledger.ts': {
    why: 'MIGRATION 搬迁表左列（曦计划旧路径）',
    at: ['docs/MIGRATION_FROM_XIAOXI.md'],
  },
  'src/world/projection.ts': {
    why: 'MIGRATION 搬迁表左列（曦计划旧路径）',
    at: ['docs/MIGRATION_FROM_XIAOXI.md'],
  },
  'scripts/check-protocol.py': {
    why: 'MIGRATION 搬迁表左列（旧仓脚本）',
    at: ['docs/MIGRATION_FROM_XIAOXI.md'],
  },

  // —— 计划过但没这么建的布局。`docs/SPEC_DRAFT_20261025.md` 是草稿，
  // 记的是当时的打算；实际建成的是 `server/events/`、`server/rules/`、
  // `server/oracle/`。草稿与成品不一致不是谎言，把它当成活缺陷来报才是。
  'server/world-events/log.py': {
    why: 'SPEC_DRAFT 里的计划布局；实际建成 server/events/log.py',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },
  'server/world-rules/engine.py': {
    why: 'SPEC_DRAFT 里的计划布局；实际建成 server/rules/schema.py',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },
  'server/world-model/orchestrator.py': {
    why: 'SPEC_DRAFT 里的计划布局；实际建成 server/oracle/orchestrator.py',
    at: ['docs/SPEC_DRAFT_20261025.md'],
  },

  // —— 注释里的示例字符串，说明的是「长什么样」，不是「去那儿看」。
  'world/xxx.ts': {
    why: 'source-scan.ts 里说明相对路径格式的示例',
    at: ['world-client/test/source-scan.ts'],
  },
  'world/../render/x.ts': {
    why: 'purity.test.ts 里说明字符串前缀比较的示例',
    at: ['world-client/test/purity.test.ts'],
  },
  '../settings/types.ts': {
    why: 'purity.test.ts 里说明被禁的 import 写法的示例',
    at: ['world-client/test/purity.test.ts'],
  },
  'frames.js': {
    why: 'when-api.test.ts 里说明「后缀不限 .ts」的示例',
    at: ['world-client/test/when-api.test.ts'],
  },

  // —— 命名约定的例子，不是路径。
  'day-0007.md': {
    why: 'ADR_MEMORY.md 里说明「文件名用世界日序号」的例子',
    at: ['docs/adr/ADR_MEMORY.md'],
  },

  // —— 条件句里的可选文件。
  'GLOSSARY-MAP.md': {
    why: 'docs/agents/domain.md 三处都是条件句（「如果有…」），说的是可选文件',
    at: ['docs/agents/domain.md'],
  },

  // —— 仓外的东西。
  'world_intent.py': {
    why: 'intent-context.ts 明说「线上」，不在本仓',
    at: ['world-client/src/world/intent-context.ts'],
  },

  // —— 在记录「这是个幽灵」这件事本身。引的是那句谎话的内容，不是本仓路径。
  // 修的是源头（`day-phase.ts`、`palette-data.ts` 那几个文件头），不是这些记录。
  'proto/day-phase.html': {
    why: 'ADR_WORLD_ALIVE.md 两处在记录 day-phase.ts 文件头引了个不存在的文档',
    at: ['docs/adr/ADR_WORLD_ALIVE.md'],
  },
  'docs/VIEW_CULLING_RESEARCH.md': {
    why: 'bake.ts 在记录「原来引着一份不存在的实测文档」',
    at: ['world-client/src/render/bake.ts', 'world-client/scripts/audit-citations.ts'],
  },
  'night.ts': {
    why: 'phase-view.ts 三处都在记录「这个文件在仓库里从来不存在」',
    at: ['world-client/src/render/phase-view.ts', 'world-client/scripts/audit-citations.ts'],
  },
  'docs/WORLD_INTENT.md': {
    why: 'intent-context.test.ts 在记录「那个文档不存在」',
    at: ['world-client/test/intent-context.test.ts', 'world-client/scripts/audit-citations.ts'],
  },

  // —— 本脚本自己的 doc 注释列举那六个幽灵时的裸名。它们不是在引用，是在点名。
  'VIEW_CULLING_RESEARCH.md': {
    why: 'audit-citations.ts doc 注释列举幽灵时的裸名',
    at: ['world-client/scripts/audit-citations.ts'],
  },
  'LARGE_WORLD.md': {
    why: 'audit-citations.ts doc 注释列举幽灵时的裸名',
    at: ['world-client/scripts/audit-citations.ts'],
  },
  'WORLD_INTENT.md': {
    why: 'audit-citations.ts doc 注释列举幽灵时的裸名',
    at: ['world-client/scripts/audit-citations.ts'],
  },

  // —— 说的就是「那条少了 adr/ 的路径」本身。`docs/adr/ADR_PALETTE_24.md` 是存在的，
  // 这些提及全都在讲**另一条**（少了 `adr/` 的）路径为什么指不到它。
  'docs/ADR_PALETTE_24.md': {
    why: '三处讲的都是那条少了 adr/ 的旧路径，不是今天存在的 docs/adr/ADR_PALETTE_24.md',
    at: [
      'docs/adr/ADR_PALETTE_24.md',
      'docs/adr/ADR_WORLD_ALIVE.md',
      'docs/MIGRATION_FROM_XIAOXI.md',
    ],
  },

  // —— 生成的产物，跑一次就有，gitignored 所以仓里看不到。
  'eval/screens/anim-manifest.txt': {
    why: 'capture-palette.mjs 自己写的产物（OUT = eval/screens），不是引用',
    at: ['world-client/scripts/capture-palette.mjs'],
  },

  // —— 命名约定的备选方案，不是路径。
  'entries/2026-10-25.md': {
    why: 'ADR_MEMORY.md 备选表里被否掉的命名方案',
    at: ['docs/adr/ADR_MEMORY.md'],
  },

  // —— 仓外产物的原名。
  'gemini-code-1793092375128.md': {
    why: 'docs/iterations 里记的仓外产物原名，本仓没有这个文件',
    at: ['docs/iterations/1027-task-2/README.md'],
  },

  // —— 修正注释里点名的那两个被删/从未存在的文件。引它们是**为了说它们不在**。
  'test/world-door-reachability.test.ts': {
    why: 'pave-reachable.test.ts 修正注释里点名 4cead00 删掉的那份测试',
    at: ['world-client/test/pave-reachable.test.ts'],
  },
  'vite.harness.mjs': {
    why: 'smoke-ego.mjs 修正注释里点名那条从不存在的退路',
    at: ['world-client/scripts/smoke-ego.mjs'],
  },

  // —— 说明「文件名长什么样/什么形状合法」的例子，不是路径。
  'CON.md': {
    why: 'memory/paths.py 里举例说明 Windows 保留名',
    at: ['server/memory/paths.py'],
  },
  'entries/day-0007.md': {
    why: 'memory/paths.py docstring 里说明每日快照的文件名格式',
    at: ['server/memory/paths.py'],
  },
  'rules/铁律.md': {
    why: 'test_memory_paths.py 里举例说明「形状合法但不在白名单」',
    at: ['server/tests/test_memory_paths.py'],
  },

  // —— 搬迁表来源列（曦计划那一侧的路径）。
  'docs/ADR_WORLD_ALIVE.md': {
    why: 'MIGRATION_FROM_XIAOXI.md 搬迁表来源列（旧仓路径）',
    at: ['docs/MIGRATION_FROM_XIAOXI.md'],
  },
};

export interface CitationFinding {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly text: string;
}

export interface CitationAudit {
  /** 受查过而且没找到对应文件的。 */
  readonly findings: readonly CitationFinding[];
  /** 命中 `KNOWN` 白名单的——不算缺陷，但要看得见有多少。 */
  readonly known: number;
  /** 逐项跳过次数。报不出来就没法判断判据放过了多少。 */
  readonly skips: ReadonlyMap<string, number>;
  /** 真正受查的 token 数（白名单外的）。 */
  readonly checked: number;
}

/** 递归收集目录下的所有文件路径（已归一成正斜杠）。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name).split(path.sep).join('/');
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 一行里的全部反引号 token。 */
function tokens(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(BACKTICK)) {
    if (m[1] !== undefined) out.push(m[1].trim());
  }
  return out;
}

/**
 * 这个 token 能不能当一条引用来查。
 *
 * 六种「不能」都在 doc 注释的「判据」那节列明了，这里不重复理由。
 * 逐项分开判是为了让跳过次数能一项项报出来——**报不出跳过次数的判据等于没有判据**，
 * 因为没人知道它放过了多少。返回命中的那条规则名。
 */
function skipReason(tok: string): string | null {
  if (!KNOWN_EXT.test(tok)) return '没有已知后缀';
  if (/\s/.test(tok)) return '含空白（命令行/子命令，不是引用）';
  if (GLOB.test(tok)) return '含 glob 或 shell 元字符';
  if (tok.startsWith('~')) return '以 ~ 开头（仓外）';
  if (tok.startsWith('/')) return '以 / 开头（URL 路由/站点根）';
  if (tok.startsWith('.')) return '裸后缀';
  return null;
}

/**
 * 这个 token 在仓里能不能找到一个真实文件对应。
 *
 * 只有一层判据：**全仓后缀匹配**（外加仓库根与 `world-client/` 两个直接落点）。
 * 原来还有两层——「从引用者逐级祖先目录找」和「basename 索引」——都已删，
 * 因为它们被后缀匹配**严格包含**，不是「今天贡献为 0」而是永远不可能多解析一个：
 * 若 `<某层祖先>/<tok>` 是个文件，它的路径必然以 `/<tok>` 结尾；若某文件的
 * basename 是 `<tok>`，同样以 `/<tok>` 结尾。留着两层只是让人以为它们在干活。
 *
 * 后缀匹配本身是必需的：`docs/adr/*.md` 里写 `world/setup.ts`，说的是
 * `world-client/src/world/setup.ts`——仓库根下的文档按模块内相对路径引用。
 * 实测关掉它，未解析从 0 涨到 49 处 / 28 个不同 token。
 *
 * `root` 与文件清单都从参数进，**不在模块加载时算**：测试要拿一份临时目录当假仓库，
 * 模块级的缓存会把真仓库的结果冻在第一次 import 里，于是假仓库永远审出真仓库的结论。
 */
function resolves(tok: string, root: string, allFiles: readonly string[]): boolean {
  // 后缀匹配之前先试两个直接落点：`docs/SPEC.md` 这种仓库根相对的，
  // 以及 `world-client/package.json` 这种的。后缀匹配同样覆盖它们，先试是为了
  // 少走一遍全仓扫描——不是多一道判据。
  for (const d of [root, path.join(root, 'world-client')]) {
    const c = path.join(d, tok).split(path.sep).join('/');
    if (existsSync(c) && statSync(c).isFile()) return true;
  }
  return allFiles.some((f) => f.endsWith(`/${tok}`));
}

/**
 * 审一座仓库的反引号引用。默认审真仓库，测试传假仓库。
 *
 * 纯函数：只读文件系统，不写、不改环境。退出码归 `main` 管。
 */
export function auditCitations({ root = ROOT }: { root?: string } = {}): CitationAudit {
  const allFiles = walk(root);

  const findings: CitationFinding[] = [];
  const skips = new Map<string, number>();
  let knownCount = 0;
  let checked = 0;

  for (const scanRoot of SCAN_ROOTS) {
    const abs = path.join(root, scanRoot).split(path.sep).join('/');
    if (!existsSync(abs)) continue;
    const files = statSync(abs).isDirectory() ? walk(abs) : [abs];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const rel = path.relative(root, file).split(path.sep).join('/');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.includes('`')) continue;
        for (const tok of tokens(line)) {
          const why = skipReason(tok);
          if (why !== null) {
            skips.set(why, (skips.get(why) ?? 0) + 1);
            continue;
          }
          const known = KNOWN[tok];
          if (known !== undefined && known.at.includes(rel)) {
            knownCount++;
            continue;
          }
          checked++;
          if (resolves(tok, root, allFiles)) continue;
          findings.push({
            file: rel,
            line: i + 1,
            token: tok,
            text: line.trim().slice(0, 100),
          });
        }
      }
    }
  }
  return { findings, known: knownCount, skips, checked };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const { findings, known, skips, checked } = auditCitations();

  const skipLine = [...skips]
    .sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${why} ${n}`)
    .join('；');
  process.stdout.write(
    `引用存在性：受查 ${checked} 处，未解析 ${findings.length} 处；` +
      `白名单内 ${known} 处不算缺陷。\n跳过：${skipLine}\n`,
  );
  for (const f of findings) {
    process.stdout.write(`  ${f.file}:${f.line}  ${f.token}\n`);
    process.stdout.write(`      ${f.text}\n`);
  }
  if (findings.length === 0) {
    process.stdout.write('  没有白名单外的引用——这句话只指「文件不在」，不指「说得对不对」。\n');
  }
  // 跟调色板那个不一样：这里没有预算可超，只有自述为真这一条。
  // 所以 `--strict` 的退出码只看有没有白名单外的，不看多少。
  if (strict && findings.length > 0) process.exitCode = 1;
}

// 被 import 时不跑 main：测试要的就是那个纯函数，不是它的退出码。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
