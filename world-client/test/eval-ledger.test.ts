import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLedger, validateLedger, REQUIRED_FIELDS, sha256OfContent } from '../scripts/eval-ledger-lib.ts';

const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');

/**
 * 指标账本闸：每个读数必须带 seed / weather / rainSeed / denominator / source /
 * script_sha / judge。缺一个就红——「同一节两套数」与「0.08pp」都是从这里漏出去的。
 */
test('eval/ledger.json 每个读数都有来源、分母与种子', () => {
  const validation = validateLedger(loadLedger(repoRoot), worldClientRoot);
  assert.equal(
    validation.ok,
    true,
    `账本不合法：\n${validation.errors.join('\n')}`,
  );
  assert.ok(validation.metrics >= 10, `账本条数太少：${validation.metrics}`);
});

test('造错守卫：删掉任意一个必填字段，账本必须变红', () => {
  const document = JSON.parse(JSON.stringify(loadLedger(repoRoot))) as {
    version: number;
    generated: string;
    metrics: Record<string, unknown>[];
  };
  const mutated = JSON.parse(JSON.stringify(document)) as typeof document;
  delete mutated.metrics[0]?.[REQUIRED_FIELDS[0]];
  const validation = validateLedger(mutated, worldClientRoot);
  assert.equal(validation.ok, false, `删掉 ${REQUIRED_FIELDS[0]} 之后账本仍然全绿，守卫失效`);
  assert.ok(validation.errors.some((error) => error.includes(REQUIRED_FIELDS[0])));
});

/**
 * 行尾归一化：同一份脚本内容，CRLF 与 LF 必须算出同一个 script_sha。
 *
 * 仓库 `core.autocrlf=true`，检出是 CRLF、索引是 LF。若按字节哈希，同一账本里
 * 就会同时出现两套哈希，任何 checkout 都无法同时满足（合并闸门曾因此连红两次）。
 */
test('script_sha 对 CRLF / LF 同一内容给出同一哈希', () => {
  const lf = 'line one\nline two\nline three\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(sha256OfContent(crlf), sha256OfContent(lf));

  const dir = mkdtempSync(join(tmpdir(), 'eval-ledger-eol-'));
  try {
    const lfPath = join(dir, 'lf.txt');
    const crlfPath = join(dir, 'crlf.txt');
    writeFileSync(lfPath, lf);
    writeFileSync(crlfPath, crlf);
    const document = {
      version: 1,
      generated: '2026-11-04',
      metrics: [{
        id: 'eol.probe',
        value: 1,
        unit: 'bool',
        seed: 'eol',
        weather: 'not_measured',
        rainSeed: 'not_measured',
        denominator: '1 个测试文件',
        source: 'test',
        script: crlfPath,
        script_sha: sha256OfContent(lf),
        judge: 'program',
        measured_at: '2026-11-04',
        gate: 'ci-pr',
      }],
    };
    const validation = validateLedger(document, dir);
    assert.equal(validation.ok, true, `CRLF 工作树与 LF 哈希不一致：\n${validation.errors.join('\n')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
