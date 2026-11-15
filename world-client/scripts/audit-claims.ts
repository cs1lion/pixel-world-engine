#!/usr/bin/env node
/**
 * 标注式文档断言审计。
 *
 * 文档里的数字/版本等会漂的断言，用注释标记写死期望值：
 *
 *     <!-- claim: test-file-count=187 -->
 *     <!-- claim: save-schema-version=5 -->
 *
 * 脚本按标记调用**闭集里的探针**（读常量、数文件、git 查清单），
 * 把实际值写回来比对；不做自然语言判断，也不执行任意 shell。
 *
 * 用法：
 *   node scripts/audit-claims.ts [--strict] [--json]
 *
 * 输出：
 *   claims: markers=N passed=N failed=N
 *   adr-schema: files=N valid=N   （N 由 readdirSync 实测，不写死）
 * 未找到任何标记时也明确说出来，避免“0 个标记 = 全绿”的错觉。
 *
 * **扫描根缺失即红**：`README.md` / `CLAUDE.md` / `docs` 任一不存在时，原有的
 * `catch {}` 会静默跳过——这三个根恰好是 claim 标记的唯一来源，根没了就是
 * 「一个标记都没扫到」，与「全绿」长得一样。现在用 `audit-scan-guard-lib`
 * 的 `ScanRootProblem` 口径：缺哪个根、期望在哪、实际是什么码，全部打印并判红。
 * 地板沿用同一份 `audit-scan-baseline.json`（`claims.markers`），不另写阈值。
 *
 * --strict 下 claim 不符 / ADR 字段不合法 exit 1；扫描根缺失与地板失效**无条件**判红。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCAN_BASELINE_PATH,
  checkScanFloor,
  failureWhy,
  loadScanBaseline,
} from './audit-scan-guard-lib.ts';
import type { ScanFloor, ScanRootProblem } from './audit-scan-guard-lib.ts';

const SCRIPT_DIR = import.meta.dirname;
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

/** claim 标记的唯一来源。任一缺失都说明扫描面不完整。 */
const REQUIRED_ROOTS: ReadonlyArray<{ readonly rel: string; readonly kind: '目录' | '文件' }> = [
  { rel: 'README.md', kind: '文件' },
  { rel: 'CLAUDE.md', kind: '文件' },
  { rel: 'docs', kind: '目录' },
];

interface Claim {
  readonly file: string;
  readonly name: string;
  readonly expected: string;
}

/**
 * 递归列出参与计数的测试文件（POSIX 相对路径，已排序）。
 *
 * 口径：`world-client/test` 下任意层级、文件名以 `.test.ts` 结尾的文件。
 * 含子目录（再套一层目录的用例也算），不含辅助脚本、fixture 数据文件，
 * 以及生成物目录 `node_modules` / `tmp`。
 */
function listTestFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'tmp') continue;
        walk(full);
      } else if (entry.name.endsWith('.test.ts')) {
        files.push(relative(root, full).replaceAll('\\', '/'));
      }
    }
  };
  walk(join(root, 'world-client', 'test'));
  return files.sort();
}

/** 固定探针：名字 → (root) => 实际值。新增类型必须在这里加，不接受任意命令。 */
const PROBES: Record<string, (root: string) => string> = {
  'test-file-count': (root) => String(listTestFiles(root).length),
  'save-schema-version': (root) => {
    const text = readFileSync(join(root, 'world-client', 'src', 'world', 'save.ts'), 'utf8');
    const matched = /CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/.exec(text);
    return matched?.[1] ?? 'NOT-FOUND';
  },
  'adr-count': (root) =>
    String(readdirSync(join(root, 'docs', 'adr')).filter((name) => name.endsWith('.md')).length),
  'spec-authority': (root) => {
    const docs = join(root, 'docs');
    const specs = readdirSync(docs).filter((name) => /^SPEC.*\.md$/.test(name));
    const authority = specs.filter((name) =>
      readFileSync(join(docs, name), 'utf8').includes('唯一权威'),
    );
    if (specs.length !== 3) return `invalid: spec_files=${specs.length}`;
    if (authority.length !== 1) return `invalid: authority_files=${authority.join(',')}`;
    if (!readFileSync(join(docs, 'SPEC_V2.md'), 'utf8').includes('历史归档')) {
      return 'invalid: SPEC_V2_not_archived';
    }
    return authority[0]!;
  },
  'iterations-tracked-count': (root) => {
    const out = execFileSync('git', ['-C', root, 'ls-files', 'docs/iterations'], {
      encoding: 'utf8',
    });
    return String(out.split('\n').filter((line) => line.trim() !== '').length);
  },
};

/** 失败时附带的明细：直接看到多/少了哪个文件，不用再翻一轮树。 */
const PROBE_DETAILS: Record<string, (root: string) => { scope: string; files: string[] }> = {
  'test-file-count': (root) => ({
    scope:
      'world-client/test 下任意层级的 *.test.ts（递归含子目录；不计辅助脚本、fixture 数据文件，跳过 node_modules/tmp）',
    files: listTestFiles(root),
  }),
};

/**
 * 核扫描根是否存在、类型对不对。
 *
 * **缺根不是「没东西可查」，是「不知道有没有东西可查」**——claim 标记全在这三个根里，
 * 根没了就会扫出 0 个标记，和「全绿」长得一模一样，所以必须判红。
 */
export function scanRootProblems(root: string = REPO_ROOT): ScanRootProblem[] {
  const problems: ScanRootProblem[] = [];
  for (const { rel, kind } of REQUIRED_ROOTS) {
    const abs = join(root, rel);
    try {
      const st = statSync(abs);
      const ok = kind === '目录' ? st.isDirectory() : st.isFile();
      if (!ok) problems.push({ scanRoot: rel, expected: abs, actual: `不是${kind}` });
    } catch (error) {
      problems.push({ scanRoot: rel, expected: abs, actual: failureWhy(error) });
    }
  }
  return problems;
}

function walkMarkdown(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'tmp') continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) files.push(...walkMarkdown(full));
    else if (name.endsWith('.md')) files.push(full);
  }
  return files;
}

/** 只在存在的根里收 claim；缺根由 `scanRootProblems` 负责判红，不在这里吞掉。 */
function collectClaims(root: string): Claim[] {
  const files: string[] = [];
  for (const { rel } of REQUIRED_ROOTS) {
    try {
      const abs = join(root, rel);
      const info = statSync(abs);
      if (info.isDirectory()) files.push(...walkMarkdown(abs));
      else files.push(abs);
    } catch {
      // 已由 scanRootProblems 判红；这里只是不重复报。
    }
  }
  const claims: Claim[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const pattern = /<!--\s*claim:\s*([a-z0-9-]+)=([^>]*?)\s*-->/g;
    for (const matched of text.matchAll(pattern)) {
      claims.push({
        file: relative(root, file).replaceAll('\\', '/'),
        name: matched[1]!,
        expected: matched[2]!.trim(),
      });
    }
  }
  return claims;
}

interface AdrIssue {
  readonly file: string;
  readonly why: string;
}

function validateAdrs(root: string): { files: number; issues: AdrIssue[] } {
  const dir = join(root, 'docs', 'adr');
  const files = readdirSync(dir).filter((name) => name.endsWith('.md'));
  const issues: AdrIssue[] = [];
  const statusValues = new Set(['aligned', 'backfilled', 'pending-review']);
  for (const name of files) {
    const text = readFileSync(join(dir, name), 'utf8');
    const status = /^- status:\s*(\S+)\s*$/m.exec(text)?.[1];
    const verified = /^- verified_at:\s*(\S+)\s*$/m.exec(text)?.[1];
    const evidence = /^- evidence:\s*(.+)$/m.exec(text)?.[1];
    if (status === undefined || !statusValues.has(status)) {
      issues.push({ file: name, why: `status 缺失或不在闭集：${status ?? 'missing'}` });
      continue;
    }
    if (verified === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(verified)) {
      issues.push({ file: name, why: `verified_at 缺失或格式不对：${verified ?? 'missing'}` });
    }
    if (evidence === undefined || !evidence.includes('`')) {
      issues.push({ file: name, why: 'evidence 缺失或没有可检查的路径' });
      continue;
    }
    const paths = [...evidence.matchAll(/`([^`]+)`/g)].map((matched) => matched[1]!);
    for (const item of paths) {
      try {
        statSync(join(root, item));
      } catch {
        issues.push({ file: name, why: `evidence 路径不存在：${item}` });
      }
    }
  }
  return { files: files.length, issues };
}

export interface ClaimsAudit {
  readonly markers: number;
  readonly results: Array<Claim & { readonly actual: string; readonly ok: boolean }>;
  readonly failed: Array<Claim & { readonly actual: string; readonly ok: boolean }>;
  readonly adr: { readonly files: number; readonly issues: AdrIssue[] };
  readonly problems: ScanRootProblem[];
  readonly floor: ScanFloor;
  /** 基线文件没读成时的原因；读成了就是 `null`。 */
  readonly baselineWhy: string | null;
}

/**
 * 纯审计：不打印、不退码，方便仓内测试直接喂 fixture 根。
 * CLI 行为在 `main()` 里，两者共用同一份判据。
 */
export function auditClaims({
  root = REPO_ROOT,
  baselineFile = SCAN_BASELINE_PATH,
}: { root?: string; baselineFile?: string } = {}): ClaimsAudit {
  const problems = scanRootProblems(root);
  const claims = collectClaims(root);
  const results = claims.map((claim) => {
    const probe = PROBES[claim.name];
    if (probe === undefined) {
      return { ...claim, actual: 'UNKNOWN-PROBE', ok: false as const };
    }
    const actual = probe(root);
    return { ...claim, actual, ok: actual === claim.expected };
  });
  const failed = results.filter((item) => !item.ok);
  const adr = problems.some((problem) => problem.scanRoot === 'docs')
    ? { files: 0, issues: [] }
    : validateAdrs(root);

  const loaded = loadScanBaseline(baselineFile);
  if (!loaded.ok) {
    return { markers: claims.length, results, failed, adr, problems, floor: { kind: 'missing' }, baselineWhy: loaded.why };
  }
  return {
    markers: claims.length,
    results,
    failed,
    adr,
    problems,
    floor: checkScanFloor(loaded.baseline, 'claims', 'markers', claims.length),
    baselineWhy: null,
  };
}

/** 打印 `scanRootProblems` 的明细，供 CLI 与测试共用同一句文案。 */
export function scanRootProblemLines(problems: ScanRootProblem[]): string[] {
  return problems.map(
    (problem) =>
      `  扫描根不存在：${problem.scanRoot} —— 期望 ${problem.expected}，实际 ${problem.actual}`,
  );
}

function main(): void {
  const audit = auditClaims();
  const { markers, results, failed, adr, problems, floor, baselineWhy } = audit;
  const strict = process.argv.includes('--strict');
  const json = process.argv.includes('--json');

  if (json) {
    console.log(
      JSON.stringify(
        {
          claims: { markers, passed: results.length - failed.length, failed: failed.length },
          adrSchema: { files: adr.files, valid: adr.files - adr.issues.length, issues: adr.issues },
          scanRoots: { problems },
          floor,
          baselineWhy,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    if (problems.length > 0) {
      console.error(`audit-claims: 扫描面不完整：${problems.length} 个扫描根不存在。`);
      for (const line of scanRootProblemLines(problems)) console.error(line);
    }
    if (markers === 0) {
      console.log('claims: markers=0（没有找到任何 claim 标注；这不是“全绿”）');
    } else {
      console.log(`claims: markers=${markers} passed=${results.length - failed.length} failed=${failed.length}`);
      for (const item of failed) {
        console.log(
          `FAIL ${item.file}  claim:${item.name}  文档与代码不符，实际是 ${item.actual}（期望 ${item.expected}）`,
        );
        const detail = PROBE_DETAILS[item.name];
        if (detail !== undefined) {
          const { scope, files } = detail(REPO_ROOT);
          console.log(`  统计范围：${scope}`);
          console.log(`  参与统计的 ${files.length} 个文件：`);
          for (const file of files) console.log(`    ${file}`);
        }
      }
    }
    console.log(`adr-schema: files=${adr.files} valid=${adr.files - adr.issues.length}`);
    for (const issue of adr.issues) console.log(`FAIL docs/adr/${issue.file}  ${issue.why}`);
    if (baselineWhy !== null) {
      console.error(`audit-claims: 扫描面基线没查成：${baselineWhy}。没有地板就不是绿。`);
    } else if (floor.kind === 'missing') {
      console.error('audit-claims: 基线文件里没有 claims.markers。没有地板就不是绿。');
    } else if (floor.kind === 'breach') {
      console.error(
        `audit-claims: claim 标记塌陷：找到 ${markers} 个，比基线 ${floor.baseline} ` +
          `少 ${floor.baseline - markers} 个（允许最多降 ${floor.allowed} 个）。`,
      );
    }
  }

  if (problems.length > 0) process.exitCode = 1;
  if (baselineWhy !== null || floor.kind !== 'ok') process.exitCode = 1;
  if (strict && (failed.length > 0 || adr.issues.length > 0)) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
