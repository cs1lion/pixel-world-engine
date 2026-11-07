#!/usr/bin/env node
/**
 * 流程总表 ↔ verify-all 注册表互指审计。
 *
 * 为什么单立一项：`docs/evidence/VERIFIABLE_FLOWS.md` 的总表用「入汇总」一列声明
 * 每条流程是不是进了 `scripts/verify-all.mjs`，但两边的对应关系**只写在命令文本里**——
 * 表里没有注册项 id，注册表里没有表行号。于是任何一边单独改动都不会让另一边出声：
 * 加一条注册项而忘了写进总表，总表从此少一行；把一行标成「已入」而注册表里没有，
 * 读者照表去找入口会落空。`audit-skill-docs.ts` 查的是**单文件内**的结构，看不见
 * 这种跨文件互指。
 *
 * 判据只有一条：**文件名相等**。每条流程的入口命令（总表那一格偏「摘要」，所以
 * 连同它自己的「流程 N」小节一起读）提取 `*.mjs|*.ts|*.py` 形状的 token，注册项的
 * 命令参数也提取同样形状，两边 basename 相等就算指到同一条流程。
 * 不读自然语言，不判「这条流程说得对不对」。
 *
 * 四条，都是结构与互指：
 *   1. ROW_NOT_REGISTERED             行说「已入」，却没有任何注册项与它对应。
 *   2. ROW_MARKED_NOT_IN_AGGREGATE    行说「未入」，却有一个注册项与它对应。
 *   3. CHECK_WITHOUT_ROW              注册项在总表里找不到对应行（新增流程漏登记）。
 *   4. ROW_AGGREGATE_UNREADABLE       「入汇总」列读不出「已入 / 未入 / SKIP」三者之一。
 *
 * 拦不住什么（写清楚，别让它看起来像能判对错）：
 *   - 读不懂总表的「判据摘要」与逐条口径是否一致；
 *   - 读不懂「未执行」是不是真的没执行；
 *   - 读不懂两处读数谁对；
 *   - 认不出「同一流程用了另一个脚本」：注册项跑的是自检脚本、行里写的是另一个脚本时，
 *     只有两边文字里出现同一个文件名才算指到。
 * 这些是语义，只能人判。
 *
 * 用法：
 *   node scripts/audit-verify-flows.ts            # warn 期：问题只打印，退出 0
 *   node scripts/audit-verify-flows.ts --strict   # 有问题退出 1
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const SCRIPT_DIR = import.meta.dirname;
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const DOC = resolve(ROOT, 'docs', 'evidence', 'VERIFIABLE_FLOWS.md');
const DOC_REL = 'docs/evidence/VERIFIABLE_FLOWS.md';

export type FlowFindingCode =
  | 'ROW_NOT_REGISTERED'
  | 'ROW_MARKED_NOT_IN_AGGREGATE'
  | 'CHECK_WITHOUT_ROW'
  | 'ROW_AGGREGATE_UNREADABLE';

export interface FlowFinding {
  readonly code: FlowFindingCode;
  readonly line: number;
  readonly message: string;
}

export interface RegisteredCheck {
  readonly id: string;
  readonly title: string;
  readonly commands: readonly (readonly (string | readonly string[])[])[];
  readonly runnable: boolean;
  readonly reason?: string | null;
}

export interface Registry {
  readonly checks: readonly RegisteredCheck[];
}

export interface FlowRow {
  readonly line: number;
  readonly flow: string;
  readonly entry: string;
  readonly aggregate: string;
}

/** 可执行文件名。`*` 不在字符集里，所以 `check-*.mjs` 这种写法提不出 token。 */
const FILE_TOKEN = /[\w./-]+\.(?:mjs|ts|tsx|js|py)/g;

function fileTokens(text: string): string[] {
  const out = new Set<string>();
  for (const matched of text.matchAll(FILE_TOKEN)) out.add(basename(matched[0]));
  return [...out];
}

/** 总表：`## 1. 总表` 之后第一张表。缺少这一节时直接抛——没有表就没什么可互指的。 */
export function parseFlowRows(text: string): FlowRow[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^##\s*1\.\s*总表/.test(line));
  if (start === -1) throw new Error('找不到「## 1. 总表」标题');
  let header: string[] | null = null;
  const rows: FlowRow[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (header === null) {
      header = cells;
      continue;
    }
    if (cells.every((cell) => /^:?-{2,}/.test(cell))) continue;
    const entryIndex = header.findIndex((cell) => cell.includes('触发命令'));
    const aggregateIndex = header.findIndex((cell) => cell.includes('入汇总'));
    if (entryIndex === -1 || aggregateIndex === -1) {
      throw new Error('总表表头缺少「触发命令」或「入汇总」列');
    }
    rows.push({
      line: i + 1,
      flow: cells[0] ?? '',
      entry: cells[entryIndex] ?? '',
      aggregate: cells[aggregateIndex] ?? '',
    });
  }
  return rows;
}

/** 每条流程自己的小节（`### 流程 N：…` 到下一个同级标题）。表里那格是摘要，正文才是入口全集。 */
export function flowSections(text: string): Map<string, string> {
  const lines = text.split('\n');
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (current !== null) sections.set(current, buffer.join('\n'));
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^###\s*流程\s*(\d+)/.exec(line);
    if (heading !== null) {
      flush();
      current = heading[1]!;
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      current = null;
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return sections;
}

function checkTokens(check: RegisteredCheck): string[] {
  return fileTokens(check.commands.flat(Infinity).join(' '));
}

/**
 * 纯函数：只吃文档文本与注册表，方便测试灌坏样例。
 *
 * `runnable` 不参与判定：注册项当前是否 SKIP 取决于本机 checkout，拿它当判据会让
 * 同一份文档在不同机器上红绿不同。这里只问「有没有登记」。
 */
export function auditFlows(text: string, registry: Registry): FlowFinding[] {
  const findings: FlowFinding[] = [];
  const checks = registry.checks.map((check) => ({ check, tokens: checkTokens(check) }));
  const sections = flowSections(text);
  const matchedRows = new Set<string>();

  for (const row of parseFlowRows(text)) {
    const tokens = [...new Set([...fileTokens(row.entry), ...fileTokens(sections.get(row.flow) ?? '')])];
    const matched = checks.filter((item) => item.tokens.some((token) => tokens.includes(token)));
    for (const item of matched) matchedRows.add(item.check.id);

    const markedIn = row.aggregate.includes('已入');
    const markedOut = row.aggregate.includes('未入');
    const markedSkip = row.aggregate.includes('SKIP');
    if (!markedIn && !markedOut && !markedSkip) {
      findings.push({
        code: 'ROW_AGGREGATE_UNREADABLE',
        line: row.line,
        message: `流程 ${row.flow} 的「入汇总」列读不出「已入 / 未入 / SKIP」：${row.aggregate}`,
      });
    }
    if (markedIn && matched.length === 0) {
      findings.push({
        code: 'ROW_NOT_REGISTERED',
        line: row.line,
        message: `流程 ${row.flow} 标为已入，但 verify-all 注册表里没有命令与它对得上`,
      });
    }
    if (markedOut && matched.length > 0) {
      findings.push({
        code: 'ROW_MARKED_NOT_IN_AGGREGATE',
        line: row.line,
        message: `流程 ${row.flow} 标为未入，但注册表里有 ${matched.map((item) => item.check.id).join('、')} 与它对得上`,
      });
    }
  }

  for (const { check } of checks) {
    if (!matchedRows.has(check.id)) {
      findings.push({
        code: 'CHECK_WITHOUT_ROW',
        line: 1,
        message: `注册项 ${check.id} 在总表和它的流程小节里都找不到对应行（新增流程漏登记？）`,
      });
    }
  }
  return findings;
}

/** 注册表从 `verify-all.mjs --json` 读，不解析源码文本：那份注册表是唯一的真值。 */
export function loadRegistry(root = ROOT): Registry {
  const proc = spawnSync(process.execPath, ['scripts/verify-all.mjs', '--json'], {
    cwd: resolve(root, 'world-client'),
    encoding: 'utf8',
  });
  if (proc.status !== 0) {
    throw new Error(`verify-all.mjs --json 退出 ${String(proc.status)}：${(proc.stderr ?? '').slice(0, 300)}`);
  }
  return JSON.parse(proc.stdout) as Registry;
}

function main(): number {
  const strict = process.argv.includes('--strict');
  const text = readFileSync(DOC, 'utf8');
  const registry = loadRegistry(ROOT);
  const rows = parseFlowRows(text);
  const findings = auditFlows(text, registry);

  process.stdout.write(
    `流程总表互指审计（warn 期，不拦 CI）：行 ${rows.length} 条，注册项 ${registry.checks.length} 条，问题 ${findings.length} 处\n`,
  );
  for (const finding of findings) {
    process.stdout.write(`  ${DOC_REL}:${finding.line} [${finding.code}] ${finding.message}\n`);
  }
  if (findings.length === 0) {
    process.stdout.write('  总表与注册表互指一致——这只说明「指得到」，不说明「判得对」。\n');
  } else {
    process.stdout.write('  这些是结构与互指问题，不判判据对错；转 strict 前先修表或修注册表。\n');
  }
  return strict && findings.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main());
}
