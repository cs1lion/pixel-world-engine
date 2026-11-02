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
 *   adr-schema: files=8 valid=8
 * 未找到任何标记时也明确说出来，避免“0 个标记 = 全绿”的错觉。
 * --strict 下任一失败（含 ADR 字段/证据不合法）exit 1。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SCRIPT_DIR = import.meta.dirname;
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

interface Claim {
  readonly file: string;
  readonly name: string;
  readonly expected: string;
}

/** 固定探针：名字 → (root) => 实际值。新增类型必须在这里加，不接受任意命令。 */
const PROBES: Record<string, (root: string) => string> = {
  'test-file-count': (root) =>
    String(
      readdirSync(join(root, 'world-client', 'test')).filter((name) => name.endsWith('.test.ts'))
        .length,
    ),
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

function collectClaims(): Claim[] {
  const roots = [join(ROOT, 'README.md'), join(ROOT, 'CLAUDE.md'), join(ROOT, 'docs')];
  const files: string[] = [];
  for (const root of roots) {
    try {
      const info = statSync(root);
      if (info.isDirectory()) files.push(...walkMarkdown(root));
      else files.push(root);
    } catch {
      // 文件不存在不算缺陷；README/CLAUDE/docs 都应有。
    }
  }
  const claims: Claim[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const pattern = /<!--\s*claim:\s*([a-z0-9-]+)=([^>]*?)\s*-->/g;
    for (const matched of text.matchAll(pattern)) {
      claims.push({
        file: relative(ROOT, file).replaceAll('\\', '/'),
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

function validateAdrs(): { files: number; issues: AdrIssue[] } {
  const dir = join(ROOT, 'docs', 'adr');
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
        statSync(join(ROOT, item));
      } catch {
        issues.push({ file: name, why: `evidence 路径不存在：${item}` });
      }
    }
  }
  return { files: files.length, issues };
}

const claims = collectClaims();
const results = claims.map((claim) => {
  const probe = PROBES[claim.name];
  if (probe === undefined) {
    return { ...claim, actual: 'UNKNOWN-PROBE', ok: false as const };
  }
  const actual = probe(ROOT);
  return { ...claim, actual, ok: actual === claim.expected };
});
const failed = results.filter((item) => !item.ok);
const adr = validateAdrs();

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        claims: { markers: claims.length, passed: results.length - failed.length, failed: failed.length },
        adrSchema: { files: adr.files, valid: adr.files - adr.issues.length, issues: adr.issues },
        results,
      },
      null,
      2,
    ),
  );
} else {
  if (claims.length === 0) {
    console.log('claims: markers=0（没有找到任何 claim 标注；这不是“全绿”）');
  } else {
    console.log(
      `claims: markers=${claims.length} passed=${results.length - failed.length} failed=${failed.length}`,
    );
    for (const item of failed) {
      console.log(
        `FAIL ${item.file}  claim:${item.name}  文档与代码不符，实际是 ${item.actual}（期望 ${item.expected}）`,
      );
    }
  }
  console.log(`adr-schema: files=${adr.files} valid=${adr.files - adr.issues.length}`);
  for (const issue of adr.issues) console.log(`FAIL docs/adr/${issue.file}  ${issue.why}`);
}

if (STRICT && (failed.length > 0 || adr.issues.length > 0)) process.exitCode = 1;
