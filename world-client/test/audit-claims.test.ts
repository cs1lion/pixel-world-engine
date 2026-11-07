import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REPO_ROOT,
  auditClaims,
  scanRootProblemLines,
  scanRootProblems,
} from '../scripts/audit-claims.ts';

/**
 * 扫描根缺失不能静默归零：`README.md` / `CLAUDE.md` / `docs` 是 claim 标记的
 * 唯一来源，根没了 → 扫出 0 个标记 → 与「全绿」同形。这里钉住的是**它开口**。
 */

function fixture(seed: { withDocs: boolean; withReadme: boolean; withClaude: boolean }): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-claims-'));
  if (seed.withReadme) writeFileSync(path.join(root, 'README.md'), '# r\n', 'utf8');
  if (seed.withClaude) writeFileSync(path.join(root, 'CLAUDE.md'), '# c\n', 'utf8');
  if (seed.withDocs) {
    mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  }
  return root;
}

function baselineFile(root: string, markers: number): string {
  const file = path.join(root, 'baseline.json');
  writeFileSync(
    file,
    JSON.stringify({ threshold: { minDrop: 5, ratio: 0.02 }, audits: { claims: { markers } } }),
    'utf8',
  );
  return file;
}

test('删除 docs 与 README：判红并打印缺哪个根', () => {
  const root = fixture({ withDocs: false, withReadme: false, withClaude: true });
  try {
    const problems = scanRootProblems(root);
    assert.equal(problems.length, 2, `缺两个根应报两条，实际：${JSON.stringify(problems)}`);
    const names = problems.map((problem) => problem.scanRoot);
    assert.ok(names.includes('README.md'), `缺 README.md 要报出来：${names.join(', ')}`);
    assert.ok(names.includes('docs'), `缺 docs 要报出来：${names.join(', ')}`);
    const lines = scanRootProblemLines(problems).join('\n');
    assert.ok(lines.includes('README.md') && lines.includes('docs'), `打印缺哪个根：${lines}`);

    const audit = auditClaims({ root, baselineFile: baselineFile(root, 5) });
    assert.equal(audit.problems.length, 2, '审计结果必须带着扫描根问题，不能静默归零');
    assert.equal(audit.markers, 0, '没有标记不是「全绿」，是扫描面不完整');
    // 注：基线 markers=5、minDrop=5 时，掉到 0 的降幅正好等于允许值，地板本身
    // 不会 breach——这也是「根缺失必须单独判红」的理由，不能只靠地板。
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('docs 被改成文件：报「不是目录」', () => {
  const root = fixture({ withDocs: false, withReadme: true, withClaude: true });
  try {
    writeFileSync(path.join(root, 'docs'), 'not a dir\n', 'utf8');
    const problems = scanRootProblems(root);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0]!.scanRoot, 'docs');
    assert.match(problems[0]!.actual, /不是目录/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('根都在但标记塌陷：地板判红', () => {
  const root = fixture({ withDocs: true, withReadme: true, withClaude: true });
  try {
    writeFileSync(path.join(root, 'README.md'), '# r\n<!-- claim: test-file-count=1 -->\n', 'utf8');
    mkdirSync(path.join(root, 'world-client', 'test'), { recursive: true });
    const audit = auditClaims({ root, baselineFile: baselineFile(root, 20) });
    assert.equal(audit.problems.length, 0, JSON.stringify(audit.problems));
    assert.equal(audit.markers, 1);
    assert.equal(audit.floor.kind, 'breach', `基线 20 掉到 1 应判塌陷，实际：${JSON.stringify(audit.floor)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('正例：真实仓库 markers=5、扫描根齐全、地板在阈值内', () => {
  const audit = auditClaims({ root: REPO_ROOT });
  assert.deepEqual(audit.problems, [], JSON.stringify(audit.problems));
  assert.equal(audit.markers, 5, `正例标记数漂了，实际 ${audit.markers}`);
  assert.equal(audit.floor.kind, 'ok', JSON.stringify(audit.floor));
});
