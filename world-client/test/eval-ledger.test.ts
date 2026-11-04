import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadLedger, validateLedger, REQUIRED_FIELDS } from '../scripts/eval-ledger-lib.ts';

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
