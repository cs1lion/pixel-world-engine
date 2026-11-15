#!/usr/bin/env node
/**
 * 状态句审计（**report 类**：v1 只报读数，不判红、不接 CI、不进 verify-all）。
 *
 * E7 的判据是：描述某个闸门 / 脚本**接线状态**的句子，必须二选一——给出判据命令，
 * 或给出坐标（commit sha / ISO 日期）。没有坐标的状态句会被时间腐蚀：2026-11-08 之前
 * ENGINEERING_DISCIPLINE 有四处写着「`fixture:check` 当前 5/5 FAIL」，而同一份仓库里
 * CI 正在跑它、实测全绿；没有任何闸门发现这件事。
 *
 * 为什么**新建**而不是扩 `audit-claims.ts`：那个审计的头注明确写「不做自然语言判断」，
 * 它靠 `<!-- claim: name=value -->` 标记 + 闭集探针工作。把正则启发式塞进去，等于让它
 * 同时承担「标记断言」与「句子启发式」两种语义，还会搅浑它的 `--strict` 退码（本审计
 * v1 恒 exit 0）。两者可靠性差一个数量级，不该共用一个出口。
 *
 * **匹配刻意窄**（第一版用「当前 / 现在 / 尚未」时在现有文档上命中 51 段，全是散文，
 * 规则一宽人就会开始忽略它，所以这里只留「闸门没接线」这一族）。同一段（空行分段）里
 * 必须同时满足：
 *   1) **闸门名可解析**：反引号里的东西要么是 `npm run <script>` / `npx <script>`，
 *      要么本身是 `world-client/package.json` scripts 里的名字（如 `fixture:check`），
 *      要么能解析到 `world-client/scripts/` 下的脚本文件（如 `check-ground-shadow`、
 *      `verify-all.mjs`）。解析不到的标识符（函数名 `checkPlacement`、裸单词 `check`、
 *      带行号的引用 `check-scene-motion.mjs:35`）一律不算闸门。
 *   2) **状态词属于接线缺口**：未接 CI / 未接入 / 仍未接 / 尚未接 / 不接 CI / 不在 CI /
 *      不是绿闸 / 未认领 / 待接。
 * 且该段里**没有**坐标（7–40 位含数字的 hex、`YYYY-MM-DD`），也**没有**判据口径
 * （`判据＝`、`以它为准`、`坐标见`、`读数见`），**也没有指向被机器强制的对象**
 * （`audit-orphan-gates` 的账本条目 / `orphan-gates-allowlist.json` 的条目）。
 * 最后这一类是 2026-11-08 补的：把「未接 CI」改成「已接 CI」只是把假话换个方向，
 * 正确落点是指向账本——接线的人必须在同一提交删条并降预算，句子跟着账本一起被审。
 *
 * 定位用**文件 + 小节标题**，不打行号——行号会被下一次编辑冲掉。
 *
 * **允许清单**（`claims-state-allowlist.json`）只放「无论将来接不接闸门都不会变假」
 * 的句子：决策 / 取舍记录、结案结论。形状照 `audit-citations` 的白名单——每条必须
 * 写明为什么不是缺陷，且只对列出的 `file` + `section` 生效，不是全仓 token 赦免；
 * 没有「命中即全部忽略」的开关，未列出的命中一律算未允许。
 *
 * 用法：node scripts/audit-claims-state.ts
 * 命中的分类（真缺陷 / 合法）由人判；本脚本不做判断，恒 exit 0。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = import.meta.dirname;
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

/** 与 `audit-claims.ts` 同源的扫描根；缺根要明说，不能静默扫出 0 条。 */
const REQUIRED_ROOTS: readonly string[] = ['README.md', 'CLAUDE.md', 'docs'];

/** 状态词只收「闸门接线缺口」这一族。散文里的「当前 / 现在 / 仍然」不算状态声明。 */
const STATE_PATTERNS: readonly RegExp[] = [
  /未接\s*CI/,
  /尚未接(?:\s*CI)?/,
  /仍未接(?:\s*CI)?/,
  /不接\s*CI/,
  /不在\s*CI/,
  /未接入/,
  /不是绿闸/,
  /未认领/,
  /待接/,
];

/**
 * 判据口径：出现即视为「有坐标」，即便没有 sha / 日期。
 * 后两条指向**被机器强制的对象**：接线必须同提交改账本，这句话不会单方面腐烂。
 */
const CRITERION_MARKS: readonly RegExp[] = [
  /判据\s*[＝=]/,
  /以它为准/,
  /坐标见/,
  /读数见/,
  /audit-orphan-gates/,
  /orphan-gates-allowlist/,
];

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const HEX_TOKEN = /^[0-9a-f]{7,40}$/i;
const SCRIPT_EXT = /\.(?:mjs|cjs|js|ts|py|sh)$/;
/** 带行号 / 锚点的引用不是闸门名，是引用。 */
const WITH_LINE_REF = /(?::\d+|#L\d+)|\s#\s?L?$/;

const HEADING = /^(#{1,6})\s+(.*)$/;

export interface GateVocabulary {
  /** `world-client/package.json` 的 scripts 键。 */
  readonly npmScripts: ReadonlySet<string>;
  /** `world-client/scripts/` 下的脚本：带扩展名的文件名 + 去掉扩展名的词干。 */
  readonly scriptNames: ReadonlySet<string>;
}

/** 从仓库读闸门词表。测试里直接传一个手写词表，避免依赖磁盘布局。 */
export function loadGateVocabulary(root: string = REPO_ROOT): GateVocabulary {
  const npmScripts = new Set<string>();
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'world-client', 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    for (const name of Object.keys(pkg.scripts ?? {})) npmScripts.add(name);
  } catch {
    // 读不到 package.json 就没有命令名可认；脚本文件名那一半仍然可用。
  }
  const scriptNames = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const entry = statSync(full);
      if (entry.isDirectory()) {
        if (name === 'node_modules' || name === 'tmp') continue;
        walk(full);
        continue;
      }
      if (!SCRIPT_EXT.test(name)) continue;
      scriptNames.add(name);
      scriptNames.add(basename(name, extname(name)));
    }
  };
  try {
    walk(join(root, 'world-client', 'scripts'));
  } catch {
    // 缺目录时词表只剩 npm scripts。
  }
  return { npmScripts, scriptNames };
}

/**
 * 反引号里的东西是不是「能跑起来 / 有名字的闸门」。
 *
 * 三类命中：`npm run X` / `npx X`（X 必须在 scripts 里，或能解析到脚本文件）；
 * scripts 里的名字（`fixture:check`、`audit:ports`）；`scripts/` 下的文件名或词干
 * （`check-ground-shadow`、`verify-all.mjs`、`scripts/audit-palette.mjs`）。
 * 带 `:行号` / `#L` 的是引用不是闸门；函数名、裸单词、普通路径都不算。
 */
export function isGateToken(raw: string, vocab: GateVocabulary): boolean {
  let text = raw.trim();
  if (text === '') return false;
  if (WITH_LINE_REF.test(text)) return false;
  const command = /^(?:npm run |npx )(\S+)/.exec(text);
  if (command !== null) {
    const name = command[1] ?? '';
    return (
      vocab.npmScripts.has(name) ||
      vocab.scriptNames.has(name) ||
      vocab.scriptNames.has(basename(name))
    );
  }
  text = text.split(/\s+/)[0] ?? '';
  if (vocab.npmScripts.has(text)) return true;
  if (vocab.scriptNames.has(text)) return true;
  if (vocab.scriptNames.has(basename(text))) return true;
  return false;
}

export interface StateClaimHit {
  /** 仓库相对路径，POSIX 分隔。 */
  readonly file: string;
  /** 最近的小节标题原文（含 `#` 前缀）；文件头段落为 `(文件头)`。 */
  readonly section: string;
  /** 命中的那一段（多行已折成单行，便于读）。 */
  readonly block: string;
  /** 命中的状态词原文。 */
  readonly stateWord: string;
  /** 命中的闸门名（反引号原文）。 */
  readonly gateToken: string;
  readonly reason: string;
  /** 被允许清单放行（只该是决策记录这类永久为真的句子）。 */
  readonly allowed: boolean;
  /** 放行理由；未放行时为 null。 */
  readonly allowedWhy: string | null;
}

/** 允许清单的一条：只对列出的文件 + 小节生效。 */
export interface AllowEntry {
  readonly file: string;
  readonly section: string;
  readonly why: string;
}

export interface AllowlistReport {
  /** 清单自己声明的条目数；缺失或非法时为 null。 */
  readonly declaredCount: number | null;
  readonly entries: readonly AllowEntry[];
  /** 清单自身的问题：条数不符、指向不存在的文件 / 小节、缺理由、重复。 */
  readonly problems: readonly string[];
}

const DEFAULT_ALLOWLIST = join(SCRIPT_DIR, 'claims-state-allowlist.json');

function allowKey(file: string, section: string): string {
  return `${file}\u0000${section}`;
}

/**
 * 读允许清单并**自己检查它没烂**：条数必须等于 `declaredCount`，每条都要指向
 * 真实存在的文件与小节，且必须有「为什么不是缺陷」的理由。
 */
export function loadAllowlist({
  root = REPO_ROOT,
  path = DEFAULT_ALLOWLIST,
}: {
  root?: string;
  path?: string;
} = {}): AllowlistReport {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      declaredCount: null,
      entries: [],
      problems: [
        `允许清单读不到或不是 JSON：${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const source = doc as { declaredCount?: unknown; entries?: unknown };
  const declared =
    typeof source.declaredCount === 'number' && Number.isInteger(source.declaredCount)
      ? source.declaredCount
      : null;
  if (declared === null) problems.push('允许清单缺整数型 declaredCount');

  const entries: AllowEntry[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(source.entries)) {
    problems.push('允许清单缺 entries 数组');
  } else {
    for (const [index, item] of source.entries.entries()) {
      const raw = item as { file?: unknown; section?: unknown; why?: unknown };
      const file = typeof raw.file === 'string' ? raw.file.trim() : '';
      const section = typeof raw.section === 'string' ? raw.section.trim() : '';
      const why = typeof raw.why === 'string' ? raw.why.trim() : '';
      const tag = `entries[${index}]`;
      if (file === '') {
        problems.push(`${tag} 缺 file`);
        continue;
      }
      if (section === '') problems.push(`${tag} 缺 section`);
      if (why === '') problems.push(`${tag} 缺 why（每条都必须说明为什么不是缺陷）`);

      let text: string;
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        problems.push(`${tag} 指向的文件不存在：${file}`);
        continue;
      }
      if (section !== '' && !text.split(/\r?\n/).some((line) => line.trim() === section)) {
        problems.push(`${tag} 指向的小节不存在：${file} 的 ${section}`);
      }

      const key = allowKey(file, section);
      if (seen.has(key)) problems.push(`${tag} 与前一条重复：${file} ${section}`);
      seen.add(key);
      entries.push({ file, section, why });
    }
  }
  if (declared !== null && entries.length !== declared) {
    problems.push(`条数与声明不等：declaredCount ${declared} / entries ${entries.length}`);
  }
  return { declaredCount: declared, entries, problems };
}

interface Block {
  readonly section: string;
  readonly text: string;
}

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let section = '(文件头)';
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length > 0) {
      blocks.push({ section, text: buffer.join('\n') });
      buffer = [];
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      section = line.trim();
      blocks.push({ section, text: line.trim() });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** 该段里有没有坐标（sha / 日期）或判据口径。 */
export function hasCoordinate(block: string): boolean {
  if (ISO_DATE.test(block)) return true;
  if (CRITERION_MARKS.some((mark) => mark.test(block))) return true;
  for (const token of block.split(/[^0-9a-zA-Z]+/)) {
    if (HEX_TOKEN.test(token) && /\d/.test(token)) return true;
  }
  return false;
}

/** 纯函数：喂文本 + 词表，拿命中。测试直接用它，不落盘。 */
export function scanStateClaimsInText({
  file,
  text,
  vocab,
}: {
  file: string;
  text: string;
  vocab: GateVocabulary;
}): StateClaimHit[] {
  const hits: StateClaimHit[] = [];
  for (const block of blocksOf(text)) {
    if (hasCoordinate(block.text)) continue;
    const state = STATE_PATTERNS.find((pattern) => pattern.test(block.text));
    if (state === undefined) continue;
    const stateWord = (state.exec(block.text)?.[0] ?? '').trim();
    let gateToken: string | null = null;
    for (const matched of block.text.matchAll(/`([^`]+)`/g)) {
      const token = (matched[1] ?? '').trim();
      if (isGateToken(token, vocab)) {
        gateToken = token;
        break;
      }
    }
    if (gateToken === null) continue;
    hits.push({
      file,
      section: block.section,
      block: block.text.replace(/\s+/g, ' ').trim(),
      stateWord,
      gateToken,
      reason: `状态词「${stateWord}」+ 对象 \`${gateToken}\``,
      allowed: false,
      allowedWhy: null,
    });
  }
  return hits;
}

function collectMarkdown(root: string): Array<{ file: string; abs: string }> {
  const found: Array<{ file: string; abs: string }> = [];
  for (const rel of REQUIRED_ROOTS) {
    const abs = join(root, rel);
    let info;
    try {
      info = statSync(abs);
    } catch {
      continue;
    }
    if (!info.isDirectory()) {
      found.push({ file: rel, abs });
      continue;
    }
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git' || name === 'tmp') continue;
        const full = join(dir, name);
        const entry = statSync(full);
        if (entry.isDirectory()) walk(full);
        else if (name.endsWith('.md')) {
          found.push({ file: relative(root, full).replaceAll('\\', '/'), abs: full });
        }
      }
    };
    walk(abs);
  }
  return found.sort((left, right) => left.file.localeCompare(right.file));
}

export interface StateClaimsAudit {
  readonly files: number;
  readonly blocks: number;
  readonly hits: StateClaimHit[];
  /** 命中里被允许清单放行的条数。 */
  readonly allowed: number;
  /** 允许清单里今天一条命中也未放过的条目（`file\0section`）——清单在空转。 */
  readonly unusedAllow: readonly string[];
  readonly allowlist: AllowlistReport;
  /** 扫描根缺失时逐条列出（缺根不等于「没有状态句」）。 */
  readonly missingRoots: string[];
}

export function auditStateClaims({ root = REPO_ROOT }: { root?: string } = {}): StateClaimsAudit {
  const missingRoots: string[] = [];
  for (const rel of REQUIRED_ROOTS) {
    try {
      statSync(join(root, rel));
    } catch {
      missingRoots.push(rel);
    }
  }
  const vocab = loadGateVocabulary(root);
  const docs = collectMarkdown(root);
  let blockCount = 0;
  const rawHits: StateClaimHit[] = [];
  for (const doc of docs) {
    const text = readFileSync(doc.abs, 'utf8');
    blockCount += blocksOf(text).length;
    rawHits.push(...scanStateClaimsInText({ file: doc.file, text, vocab }));
  }

  const allowlist = loadAllowlist({ root });
  const byKey = new Map<string, AllowEntry>();
  for (const entry of allowlist.entries) byKey.set(allowKey(entry.file, entry.section), entry);
  const fired = new Set<string>();
  for (const hit of rawHits) fired.add(allowKey(hit.file, hit.section));
  const hits = rawHits.map((hit): StateClaimHit => {
    const key = allowKey(hit.file, hit.section);
    const entry = byKey.get(key);
    if (entry === undefined) return hit;
    return { ...hit, allowed: true, allowedWhy: entry.why };
  });
  const unusedAllow = allowlist.entries
    .filter((entry) => !fired.has(allowKey(entry.file, entry.section)))
    .map((entry) => allowKey(entry.file, entry.section));

  return {
    files: docs.length,
    blocks: blockCount,
    hits,
    allowed: hits.filter((hit) => hit.allowed).length,
    unusedAllow,
    allowlist,
    missingRoots,
  };
}

function main(): void {
  const audit = auditStateClaims();
  for (const rel of audit.missingRoots) {
    console.log(`claims-state: 扫描根缺失 ${rel} —— 缺根不等于「没有状态句」`);
  }
  const unallowed = audit.hits.length - audit.allowed;
  console.log(
    `claims-state: 受查 ${audit.blocks} 段 / ${audit.files} 个文件；` +
      `命中 ${audit.hits.length} 段（允许 ${audit.allowed} / 未允许 ${unallowed}）`,
  );
  for (const problem of audit.allowlist.problems) {
    console.log(`CLAIMS-STATE-ALLOWLIST ${problem}`);
  }
  for (const unused of audit.unusedAllow) {
    console.log(`CLAIMS-STATE-ALLOWLIST 没放过任何命中：${unused.replace('\u0000', '  ')}`);
  }
  for (const hit of audit.hits) {
    console.log(`${hit.allowed ? 'ALLOW' : 'HIT'} ${hit.file}  ${hit.section}`);
    console.log(`  ${hit.block}`);
    console.log(
      hit.allowed
        ? `  → ${hit.reason}；允许清单放行：${hit.allowedWhy}`
        : `  → ${hit.reason}；没有坐标也没有判据口径`,
    );
  }
  console.log('claims-state: report 类——不判红（恒 exit 0）；未允许命中要人看，逐条分类。');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
