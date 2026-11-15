#!/usr/bin/env node
/**
 * skill 文档结构审计（warn 期）：只查「三件套」与验证边界的痕迹在不在，不判内容对不对。
 *
 * 为什么单立一项：X3 把 skill 改造的标准拆成了四块判据、三件套、四类验证边界与收尾五问，
 * 但没有一条机器闸门；写文档、回报、PR 说明时，「有流程图」与「写了张表」只能靠人 review，
 * 而「AI 评估通过」被写成「已验证」这种混称，review 也经常放过。本脚本只把能写成结构的
 * 部分变成断言，其余仍是人的事。
 *
 * 查三样（与 SKILL_ITERATION_STANDARD.md 第 2–5 节对应）：
 *   1. 三件套齐全、互指成立。工作流程图里的节点 ID 必须落进任务清单；
 *      任务清单的每个 ID 也要出现在流程图里；任务「入口」要么是 [需人工]，要么落在脚本清单。
 *   2. 任务清单 / 脚本清单的必含列齐全；脚本的「退出码含义」与「在 CI」两列是真值，
 *      不是空白、破折号或「待定」。
 *   3. 交付文本出现「已验证 / 验证通过 / 已通过 / 确认通过」时，同文得有 5.1 或 5.3
 *      的证据段落（同时含验证边界编号与命令 / 读数 / 截图 / 确认人 / sha 之一）。
 *
 * **这条闸门读不懂自然语言论证**。它能说的只有「5.1 或 5.3 的痕迹存在」，不能说
 * 「那段证据真的支持那句话」。同理，它不知道一张表的判据列写得对不对、截图是不是
 * 当次的。把这些写成「已验证」的，仍然要靠人。混称的一半由它拦，另一半不是它的活。
 *
 * 用法：
 *   node scripts/audit-skill-docs.ts [--strict] [文件...]
 * 默认扫 docs/agents/ 与 docs/skills/ 下的 .md。warn 期退出码恒 0；--strict 下
 * 有缺陷才 exit 1。CI 接线不在本脚本，别在这里偷偷改 CI。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface Finding {
  file: string;
  line: number;
  code: string;
  message: string;
}

interface Table {
  headerLine: number;
  headers: string[];
  rows: { line: number; cells: string[] }[];
}

const TASK_COLUMNS = ['ID', '任务', '输入', '输出', '入口', '判据', '状态', 'owner'];
const SCRIPT_COLUMNS = ['脚本', '入口命令', '输入', '输出', '退出码含义', '在 CI', '状态'];

const isFence = (s: string): boolean => s.trim().startsWith('```');
const isHeading = (s: string): boolean => /^#{1,6}\s/.test(s);
const isTableLine = (s: string): boolean => /^\s*\|/.test(s);
const isSeparator = (s: string): boolean => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(s);
const plain = (s: string): string => s.replace(/`/g, '').replace(/\*\*/g, '').trim();

/** 找出包含 keyword 的标题段：从标题行到下一个任意级标题之前。 */
function findSection(lines: string[], keyword: string): { heading: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (!isHeading(lines[i])) continue;
    if (!lines[i].includes(keyword)) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (isHeading(lines[j])) { end = j; break; }
    }
    return { heading: i, end };
  }
  return null;
}

/** 段内的表格。代码块里的竖线不算表。 */
function tablesIn(lines: string[], from: number, to: number): Table[] {
  const tables: Table[] = [];
  let inCode = false;
  for (let i = from; i <= to && i < lines.length; i++) {
    if (isFence(lines[i])) { inCode = !inCode; continue; }
    if (inCode || !isTableLine(lines[i])) continue;
    if (i + 1 >= lines.length || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((c) => plain(c).toUpperCase() === 'ID' ? 'ID' : plain(c));
    const rows: { line: number; cells: string[] }[] = [];
    let j = i + 2;
    while (j < lines.length && isTableLine(lines[j]) && !isFence(lines[j])) {
      rows.push({ line: j, cells: splitRow(lines[j]).map(plain) });
      j++;
    }
    tables.push({ headerLine: i + 1, headers, rows });
    i = j - 1;
  }
  return tables;
}

function splitRow(s: string): string[] {
  const parts = s.split('|');
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((p) => p.trim());
}

function missingColumns(table: Table, required: string[], label: string): Finding[] {
  const have = new Set(table.headers.map((h) => plain(h)));
  const out: Finding[] = [];
  for (const col of required) {
    if (!have.has(col)) {
      out.push({
        file: '', line: table.headerLine, code: 'MISSING_COLUMN',
        message: `${label}缺列「${col}」（表头只有：${table.headers.join(' / ')}）`,
      });
    }
  }
  return out;
}

function colIndex(table: Table, name: string): number {
  return table.headers.findIndex((h) => plain(h) === name);
}

/** 流程图里的节点 ID（只认 T1 / S2 这种字母+数字，裸数字不当 ID）。 */
function flowNodes(lines: string[], section: { heading: number; end: number }): { id: string; line: number }[] {
  const nodes: { id: string; line: number }[] = [];
  let inCode = false;
  let sawBlock = false;
  for (let i = section.heading; i < section.end; i++) {
    if (isFence(lines[i])) { inCode = !inCode; if (inCode) sawBlock = true; continue; }
    if (!inCode) continue;
    const re = /\b([TS]\d+)\b/g;
    for (const m of lines[i].matchAll(re)) nodes.push({ id: m[1], line: i + 1 });
  }
  return sawBlock ? nodes : [];
}

/** 入口是否落在脚本清单：按路径 / 文件名 / npm script 名三项比对。 */
function entryMatches(entry: string, scriptRows: Table['rows'], scriptCol: number, cmdCol: number): boolean {
  const target = entry.trim();
  if (!target) return false;
  for (const row of scriptRows) {
    const script = (row.cells[scriptCol] ?? '').trim();
    const cmd = (row.cells[cmdCol] ?? '').trim();
    if (!script) continue;
    if (target.includes(script)) return true;
    const base = path.basename(script);
    if (base && target.includes(base)) return true;
    const npm = target.match(/npm\s+run\s+([^\s,，;；]+)/);
    if (npm && cmd.includes(`npm run ${npm[1]}`)) return true;
  }
  return false;
}

const EXIT_TRUTH = /0|非\s*0|通过|失败|exit/i;
const CI_TRUTH = /^(是|否|yes|no|true|false)$/i;

/** 单篇文档的结构审计。纯函数，测试直接用。 */
export function auditSkillDoc(file: string, text: string): Finding[] {
  const lines = text.split(/\r?\n/);
  const raw: Finding[] = [];
  const push = (f: Finding): void => { raw.push({ ...f, file }); };

  // —— 1. 三件套的存在性 ——
  const flow = findSection(lines, '工作流程图');
  const tasks = findSection(lines, '任务清单');
  const scripts = findSection(lines, '脚本清单');
  if (!flow) push({ file, line: 1, code: 'MISSING_BLOCK', message: '缺少「工作流程图」：找不到含该词的标题' });
  if (!tasks) push({ file, line: 1, code: 'MISSING_BLOCK', message: '缺少「任务清单」：找不到含该词的标题' });
  if (!scripts) push({ file, line: 1, code: 'MISSING_BLOCK', message: '缺少「脚本清单」：找不到含该词的标题' });

  // —— 2. 必含列与真值 ——
  const taskTable = tasks ? tablesIn(lines, tasks.heading, tasks.end)[0] : undefined;
  const scriptTable = scripts ? tablesIn(lines, scripts.heading, scripts.end)[0] : undefined;
  if (tasks && !taskTable) push({ file, line: lines[tasks.heading] ? tasks.heading + 1 : 1, code: 'NO_TABLE', message: '任务清单段里没有表格' });
  if (scripts && !scriptTable) push({ file, line: scripts.heading + 1, code: 'NO_TABLE', message: '脚本清单段里没有表格' });

  if (taskTable) for (const f of missingColumns(taskTable, TASK_COLUMNS, '任务清单')) push(f);
  if (scriptTable) {
    for (const f of missingColumns(scriptTable, SCRIPT_COLUMNS, '脚本清单')) push(f);
    const exitCol = colIndex(scriptTable, '退出码含义');
    const ciCol = colIndex(scriptTable, '在 CI');
    for (const row of scriptTable.rows) {
      const exit = (row.cells[exitCol] ?? '').trim();
      const ci = (row.cells[ciCol] ?? '').trim();
      if (exitCol >= 0 && (!exit || /^[—\-/待定?]+$/.test(exit) || !EXIT_TRUTH.test(exit))) {
        push({ file, line: row.line + 1, code: 'EMPTY_EXIT_CODE', message: `退出码含义不是真值：「${exit || '空'}」` });
      }
      if (ciCol >= 0 && !CI_TRUTH.test(ci)) {
        push({ file, line: row.line + 1, code: 'EMPTY_CI_FLAG', message: `「在 CI」不是是/否：「${ci || '空'}」` });
      }
    }
  }

  // —— 3. 互指 ——
  const nodes = flow ? flowNodes(lines, flow) : [];
  if (flow && nodes.length === 0) {
    push({ file, line: flow.heading + 1, code: 'NO_DIAGRAM', message: '工作流程图段里没有代码块或没有 T*/S* 节点 ID' });
  }
  const taskIds = new Map<string, number>();
  if (taskTable) {
    const idCol = colIndex(taskTable, 'ID');
    if (idCol >= 0) for (const row of taskTable.rows) {
      const id = (row.cells[idCol] ?? '').trim().toUpperCase();
      if (id) taskIds.set(id, row.line + 1);
    }
  }
  for (const node of nodes) {
    if (!taskIds.has(node.id.toUpperCase())) {
      push({ file, line: node.line, code: 'DANGLING_FLOW_ID', message: `流程图节点 ${node.id} 在任务清单里没有对应条目` });
    }
  }
  for (const [id, line] of taskIds) {
    if (nodes.length && !nodes.some((n) => n.id.toUpperCase() === id)) {
      push({ file, line, code: 'ORPHAN_TASK', message: `任务 ${id} 没有出现在工作流程图里` });
    }
  }

  if (taskTable && scriptTable) {
    const entryCol = colIndex(taskTable, '入口');
    const scriptCol = colIndex(scriptTable, '脚本');
    const cmdCol = colIndex(scriptTable, '入口命令');
    if (entryCol >= 0 && scriptCol >= 0) {
      for (const row of taskTable.rows) {
        const entry = (row.cells[entryCol] ?? '').trim();
        if (!entry) {
          push({ file, line: row.line + 1, code: 'MISSING_VALUE', message: '任务的「入口」为空' });
          continue;
        }
        if (entry.includes('需人工')) continue;
        if (!entryMatches(entry, scriptTable.rows, scriptCol, cmdCol)) {
          push({ file, line: row.line + 1, code: 'DANGLING_SCRIPT_REF', message: `入口引用的脚本不在脚本清单：「${entry}」` });
        }
      }
    }
  }

  // —— 4. 验证边界：声称与证据 ——
  const claimRe = /(已验证|验证通过|已通过|确认通过|人工确认通过)/;
  const evidenceRe = /(命令|exit|退出码|截图|确认人|sha|issue|读数)/i;
  let evidence = false;
  let inCode = false;
  const codeFlags: boolean[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isFence(lines[i])) { inCode = !inCode; codeFlags.push(true); continue; }
    codeFlags.push(inCode);
    const t = lines[i];
    if (!inCode && /5\.[13]/.test(t) && evidenceRe.test(t)) evidence = true;
  }
  if (!evidence) {
    for (let i = 0; i < lines.length; i++) {
      if (codeFlags[i]) continue;
      const m = lines[i].match(claimRe);
      if (!m) continue;
      push({
        file, line: i + 1, code: 'CLAIM_WITHOUT_EVIDENCE',
        message: `「${m[1]}」在同文找不到 5.1 / 5.3 的证据段落（需同时含验证边界编号与命令 / 读数 / 截图 / 确认人 / sha）`,
      });
    }
  }

  return raw;
}

function collectMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectMarkdown(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function defaultTargets(): string[] {
  return [
    ...collectMarkdown(path.join(ROOT, 'docs', 'agents')),
    ...collectMarkdown(path.join(ROOT, 'docs', 'skills')),
  ].sort();
}

export function auditFiles(files: string[]): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  let checked = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      findings.push({ file, line: 1, code: 'NO_SUCH_FILE', message: '文件不存在' });
      continue;
    }
    checked++;
    findings.push(...auditSkillDoc(file, readFileSync(file, 'utf8')));
  }
  return { findings, checked };
}

function show(file: string): string {
  const rel = path.relative(ROOT, file);
  return rel.startsWith('..') ? file : rel.split(path.sep).join('/');
}

export function run(argv: string[]): number {
  const strict = argv.includes('--strict');
  const names = argv.filter((a) => !a.startsWith('--'));
  const files = names.length ? names.map((n) => path.resolve(process.cwd(), n)) : defaultTargets();
  const { findings, checked } = auditFiles(files);

  if (files.length === 0) {
    console.log('skill-docs 审计（warn 期，不拦 CI）：没有找到待查文档（docs/agents/ 与 docs/skills/ 下无 .md）。');
    return 0;
  }

  console.log(`skill-docs 审计（${strict ? 'strict' : 'warn 期，不拦 CI'}）：受查 ${checked} 篇，${findings.length} 处`);
  for (const f of findings) console.log(`  ${show(f.file)}:${f.line} [${f.code}] ${f.message}`);
  if (findings.length === 0) console.log('  没有发现结构性问题。');
  if (!strict) {
    console.log('warn 期不拦 CI：退出码 0。转 strict 前先按 SKILL_ITERATION_STANDARD.md 第 3 节补齐三件套，并备好正反样例。');
    return 0;
  }
  console.log('strict：只判结构痕迹，不判证据内容是否真的支持那句话。');
  return findings.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = run(process.argv.slice(2));
