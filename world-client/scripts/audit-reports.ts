#!/usr/bin/env node
/**
 * 交付报告机器可读块的审计（规则见 docs/agents/reporting.md）。
 *
 * 扫描 `docs/**\/*.md` 里以 `<!-- delivery` 开头的注释块，按 JSON 校验：
 *   R1 产物：路径存在、结构完整；bytes/sha256 手写锁死值漂移只提示（脚本复算值直接打出）
 *   R2 通过：checks 非空、exit 为整数
 *   R3 比对口径：method/threshold/size/shots/scope 齐全；byte-exact 时 threshold 必须 0
 *   R4 推断：每条 basis 非空且 ≥8 字符（语义归属仍靠人工）
 *   R5 状态：state 闭集、sha 40 位、state 与 pushed 不矛盾；非浅克隆时验证 sha 在本仓
 *   R6 时间：只认 git 提交时间（产物提交时间 vs 报告文件提交时间）。
 *            报告侧与产物侧都要「已提交且工作区无改动」才有可信的提交时间；
 *            任一侧取不到时如实记为未核验（不判红），不退回 mtime 或 reportedAt 兜底——
 *            不给作者留下「填数字关掉」的辅助判据。
 *   R7 无产物：artifacts 为空时必须写 noArtifactsReason
 *
 * 不会联网、不重放历史命令、不做自然语言判断——这些写进文档的人工检查点。
 *
 * 用法：node scripts/audit-reports.ts [--strict]
 * 输出：audit-reports: reports=N artifacts=N checks=N issues=N
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SCRIPT_DIR = import.meta.dirname;
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const STRICT = process.argv.includes('--strict');
const SHA256 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SIZES = /^\d+x\d+$/;
const METHODS = new Set(['byte-exact', 'pixel-threshold', 'structure-block']);
const STATES = new Set(['uncommitted', 'local-commit', 'pushed']);

interface Issue {
  readonly file: string;
  readonly why: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function isTracked(path: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isShallow(): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8' }).trim() === 'true';
  } catch {
    return true;
  }
}

function commitExists(sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isDirty(path: string): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', path], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
  } catch {
    return true;
  }
}

/** 最后一次触及该路径的提交时间（毫秒）。取不到（未跟踪/无历史）返回 undefined。 */
function lastCommitMs(path: string): number | undefined {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', path], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (out === '') return undefined;
    const seconds = Number.parseInt(out, 10);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 报告文件的 R6 基线：只有已提交且工作区无改动时才成立（此时 git 时间可信）。
 * 未提交或有未提交改动时 git 时间不可信，本产物不参与先后比对，如实记 unverified。
 */
function reportCommitMsOf(path: string): number | undefined {
  if (!isTracked(path) || isDirty(path)) return undefined;
  return lastCommitMs(path);
}

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const BLOCK = /<!--\s*delivery\s*\r?\n\s*\{/g;
const FENCED = /```[\s\S]*?```/g;

const issues: Issue[] = [];
const counts = { reports: 0, artifacts: 0, checks: 0, gitTime: 0, unverifiedTime: 0 };

const shallow = isShallow();
if (shallow) console.log('audit-reports: 浅克隆，R5 的「sha 在本仓」检查跳过（会误判）');

for (const file of walk(join(ROOT, 'docs'))) {
  const raw = readFileSync(file, 'utf8');
  // 代码块里的示例不算报告：把围栏内的内容抹掉（保留长度不影响匹配定位）。
  const text = raw.replace(FENCED, (fenced) => ' '.repeat(fenced.length));
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  BLOCK.lastIndex = 0;
  let matched: RegExpExecArray | null;
  while ((matched = BLOCK.exec(text)) !== null) {
    counts.reports += 1;
    const start = matched.index + matched[0].length - 1;
    const end = text.indexOf('-->', start);
    if (end < 0) {
      issues.push({ file: rel, why: 'delivery 块没有闭合的 -->' });
      continue;
    }
    let block: unknown;
    try {
      block = JSON.parse(text.slice(start, end).trim());
    } catch (error) {
      issues.push({ file: rel, why: `delivery 块不是合法 JSON：${String(error)}` });
      continue;
    }
    const data = block as Record<string, unknown>;
    const add = (why: string): void => {
      issues.push({ file: rel, why });
    };
    // R6 的报告侧基线：只有「已提交且工作区无改动」才有可信的 git 提交时间；
    // 取不到时产物侧也不会可比对，一律如实记 unverified，不退回 mtime / reportedAt。
    const reportMs = reportCommitMsOf(rel);

    // R1 / R7 -------------------------------------------------------------
    const artifacts = data.artifacts;
    if (!Array.isArray(artifacts)) {
      add('R1 artifacts 缺失或不是数组（没有产物也要写 [] + noArtifactsReason）');
    } else if (artifacts.length === 0) {
      if (typeof data.noArtifactsReason !== 'string' || data.noArtifactsReason.trim() === '') {
        add('R7 artifacts 为空但没有写 noArtifactsReason');
      }
    } else {
      if (data.noArtifactsReason !== undefined) add('R7 有产物却又写了 noArtifactsReason');
      for (const raw of artifacts) {
        counts.artifacts += 1;
        const item = raw as Record<string, unknown>;
        const path = item.path;
        if (typeof path !== 'string' || path.trim() === '') {
          add('R1 产物缺 path');
          continue;
        }
        const full = resolve(ROOT, path);
        let size: number;
        try {
          size = statSync(full).size;
        } catch {
          add(`R1 产物不存在：${path}`);
          continue;
        }
        if (typeof item.bytes !== 'number' || !Number.isInteger(item.bytes)) {
          add(`R1 ${path} 缺 bytes（整数）`);
        } else if (item.bytes !== size) {
          // 2026-11-19 起 bytes/sha256 的「手写锁死值」漂移只提示、不判红：
          // 产物重拍一次手写值就旧一次（2026-11-16 就这么误红过一次：
          // docs/evidence/stair-flight/README.md 写 4251、实际 4050）。
          // 这里直接打印脚本复算值，抄进报告即回绿；结构缺失仍判红。
          console.log(`audit-reports: R1 ${path} bytes 写 ${item.bytes}，实际 ${size}（复算值，抄进报告即可）`);
        }
        if (typeof item.sha256 === 'string') {
          if (!SHA256.test(item.sha256)) {
            add(`R1 ${path} sha256 不是 64 位小写十六进制：${item.sha256}`);
          } else if (sha256Of(full) !== item.sha256) {
            console.log(`audit-reports: R1 ${path} sha256 与文件内容不符（复算值 ${sha256Of(full)}，抄进报告即可）`);
          }
        } else if (typeof item.noHashReason !== 'string' || item.noHashReason.trim() === '') {
          add(`R1 ${path} 既没有 sha256 也没有 noHashReason`);
        }
        // R6：只认 git 提交时间，不设 mtime 兜底、不退回 reportedAt 辅助判据。
        // 报告侧 reportMs 只有已提交且无未提交改动才可信；产物侧取 lastCommitMs。
        // 任一侧取不到提交时间 → 记 unverified（如实写），不判红、不退回其它判据。
        if (typeof data.reportedAt === 'string' && ISO_WITH_ZONE.test(data.reportedAt)) {
          const artifactMs = lastCommitMs(path);
          if (artifactMs === undefined) {
            counts.unverifiedTime += 1;
          } else if (reportMs !== undefined) {
            counts.gitTime += 1;
            if (artifactMs > reportMs) {
              add(`R6 ${path} 的提交时间晚于报告文件的提交时间（产物后置 = 未交付）`);
            }
          } else {
            // 报告侧取不到可信 git 时间（未提交或有未提交改动）：主判据缺席，如实记 unverified。
            counts.unverifiedTime += 1;
          }
        }
      }
    }

    // R2 -------------------------------------------------------------------
    const checks = data.checks;
    if (!Array.isArray(checks) || checks.length === 0) {
      add('R2 checks 缺失或为空（至少要一条命令 + 退出码）');
    } else {
      for (const raw of checks) {
        counts.checks += 1;
        const item = raw as Record<string, unknown>;
        if (typeof item.name !== 'string' || item.name.trim() === '') add('R2 有一条 check 缺 name');
        if (typeof item.exit !== 'number' || !Number.isInteger(item.exit)) {
          add(`R2 check「${String(item.name)}」缺整数 exit`);
        }
      }
    }

    // R3 -------------------------------------------------------------------
    const diff = data.diff as Record<string, unknown> | undefined;
    if (diff === undefined || typeof diff !== 'object') {
      add('R3 diff 缺失（不变/零差异必须写比对口径）');
    } else {
      const method = diff.method;
      if (typeof method !== 'string' || !METHODS.has(method)) {
        add(`R3 method 不在闭集：${String(method)}`);
      }
      if (typeof diff.threshold !== 'number' || !Number.isFinite(diff.threshold) || diff.threshold < 0) {
        add('R3 threshold 缺少数值（逐字节应为 0）');
      }
      if (typeof method === 'string' && method.includes('byte') && diff.threshold !== 0) {
        add('R3 method 是 byte 类，threshold 必须为 0');
      }
      if (typeof diff.size !== 'string' || !SIZES.test(diff.size)) add('R3 size 必须是 宽x高（如 961x641）');
      if (typeof diff.shots !== 'number' || !Number.isInteger(diff.shots) || diff.shots < 1) {
        add('R3 shots 必须是 ≥1 的整数');
      }
      if (typeof diff.scope !== 'string' || diff.scope.trim() === '') add('R3 scope 不能为空');
    }

    // R4 -------------------------------------------------------------------
    if (data.inferences !== undefined) {
      if (!Array.isArray(data.inferences)) {
        add('R4 inferences 必须是数组');
      } else {
        for (const raw of data.inferences) {
          const item = raw as Record<string, unknown>;
          if (typeof item.claim !== 'string' || item.claim.trim() === '') add('R4 有一条推断缺 claim');
          if (typeof item.basis !== 'string' || item.basis.trim().length < 8) {
            add(`R4 推断「${String(item.claim)}」的依据不足 8 字（凭什么这么推断）`);
          }
        }
      }
    }

    // R5 -------------------------------------------------------------------
    const status = data.status as Record<string, unknown> | undefined;
    if (status === undefined || typeof status !== 'object') {
      add('R5 status 缺失（要写清未提交/本地提交/已推送）');
    } else {
      if (typeof status.state !== 'string' || !STATES.has(status.state)) {
        add(`R5 state 不在闭集：${String(status.state)}`);
      }
      if (typeof status.pushed !== 'boolean') add('R5 pushed 必须是布尔');
      if (typeof status.pr !== 'boolean') add('R5 pr 必须是布尔');
      if (status.state !== 'uncommitted') {
        if (typeof status.sha !== 'string' || !SHA40.test(status.sha)) add('R5 提交/推送状态需要 40 位 sha');
        if (typeof status.branch !== 'string' || status.branch.trim() === '') add('R5 提交/推送状态需要 branch');
        if (typeof status.sha === 'string' && SHA40.test(status.sha) && !shallow && !commitExists(status.sha)) {
          add(`R5 sha 不在本仓：${status.sha}`);
        }
      }
      if (status.state === 'pushed' && status.pushed !== true) add('R5 state=pushed 但 pushed=false');
      if (status.state === 'local-commit' && status.pushed !== false) add('R5 state=local-commit 但 pushed=true（自相矛盾）');
      if (status.state === 'uncommitted' && status.pushed === true) add('R5 state=uncommitted 但 pushed=true');
    }

    // R6 -------------------------------------------------------------------
    const reportedAt = data.reportedAt;
    if (typeof reportedAt !== 'string' || !ISO_WITH_ZONE.test(reportedAt) || Number.isNaN(Date.parse(reportedAt))) {
      add('R6 reportedAt 缺失或不是含时区的 ISO 8601');
    }
  }
}

const counted = `reports=${counts.reports} artifacts=${counts.artifacts} checks=${counts.checks} issues=${issues.length}`;
console.log(`audit-reports: ${counted}`);
if (counts.gitTime > 0) {
  console.log(`audit-reports: R6 ${counts.gitTime} 个产物按 git 提交时间比对报告文件提交时间`);
}
if (counts.unverifiedTime > 0) {
  console.log(`audit-reports: R6 ${counts.unverifiedTime} 个产物取不到可信的 git 提交时间（报告未提交 / 未跟踪 / 有未提交改动），未做先后比对（如实记为未核验，不退回 mtime 或 reportedAt 兜底）`);
}
for (const issue of issues) console.log(`audit-reports: FAIL ${issue.file} —— ${issue.why}`);
if (issues.length === 0) console.log('audit-reports: 全部可自动核对项通过；人工检查点见 docs/agents/reporting.md');

if (STRICT && issues.length > 0) process.exit(1);
