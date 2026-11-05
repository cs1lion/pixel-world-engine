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

type LedgerDocumentShape = {
  version: number;
  generated: string;
  metrics: Record<string, unknown>[];
};

/**
 * 期望的指标 id 集合。来源：规格与证据里写死「登记指标 25 条」
 * （`docs/evidence/eval-ledger/README.md:14`），具体的 25 个 id 按 `eval/ledger.json`
 * 逐条核对语义归属后固定在这里——账本少一条、多一条、改一个 id 都必须红，
 * 不许用「条数 >= 10」这种松口子把缺口盖过去。
 */
const EXPECTED_METRIC_IDS = [
  'save.percent90.seed-a',
  'save.percent90.seed-b',
  'save.slopeKBPerDay.last30.seed-a',
  'facts.aliveRatio.day90',
  'facts.missingPct.day20',
  'facts.missingPct.hintHigh.day20',
  'timeline.missing.day20',
  'timeline.missing.day45',
  'timeline.missing.day60',
  'timeline.missing.day89',
  'legend.count.day90',
  'legend.reachAgreement.day90',
  'memory.danglingRefs.afterDelete',
  'render.drawCalls.static.p50',
  'palette.violations.world',
  'palette.violations.ui',
  'motion.structDiff.walk.min',
  'motion.structDiff.idle.min',
  'determinism.fingerprints.equal',
  'rewind.qa.passed',
  'memory.importGuard.fabricatedDowngraded',
  'memory.importGuard.refused.soak90d',
  'memory.importGuard.downgraded.soak90d',
  'memory.importGuard.prunedUnverifiable.soak90d',
  'memory.importGuard.witnessedPreserved',
] as const;

/**
 * 指标账本闸：每个读数必须带 seed / weather / rainSeed / denominator / source /
 * script_sha / judge。缺一个就红——「同一节两套数」与「0.08pp」都是从这里漏出去的。
 */
test('eval/ledger.json 每个读数都有来源、分母与种子', () => {
  const document = loadLedger(repoRoot) as LedgerDocumentShape;
  const validation = validateLedger(document, worldClientRoot);
  assert.equal(
    validation.ok,
    true,
    `账本不合法：\n${validation.errors.join('\n')}`,
  );
  assert.equal(
    validation.metrics,
    EXPECTED_METRIC_IDS.length,
    `账本条数与规格不符：期望 ${EXPECTED_METRIC_IDS.length}，实际 ${validation.metrics}`,
  );
  assert.deepEqual(
    document.metrics.map((metric) => metric.id).sort(),
    [...EXPECTED_METRIC_IDS].sort(),
    '账本 id 集合与规格不符：多一条、少一条、或改了一个 id 都不行',
  );
});

test('造错守卫：12 个必填字段逐个删，每一个都必须变红并报出字段名', () => {
  const document = loadLedger(repoRoot) as LedgerDocumentShape;
  assert.equal(
    REQUIRED_FIELDS.length,
    12,
    `必填字段数量从 12 变了（实际 ${REQUIRED_FIELDS.length}）：请确认规格并同步更新本测试的遍历范围`,
  );
  for (const field of REQUIRED_FIELDS) {
    const mutated = JSON.parse(JSON.stringify(document)) as LedgerDocumentShape;
    delete mutated.metrics[0]?.[field];
    const validation = validateLedger(mutated, worldClientRoot);
    assert.equal(validation.ok, false, `删掉 ${field} 之后账本仍然全绿，守卫失效`);
    assert.ok(
      validation.errors.some((error) => error.includes(field)),
      `删掉 ${field} 变红了，但错误信息里没有出现字段名：\n${validation.errors.join('\n')}`,
    );
  }
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
