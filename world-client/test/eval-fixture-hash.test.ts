import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyFixtureHashes } from '../scripts/eval-fixture-hash-lib.ts';

/**
 * fixture 声明了 `saveSha256` / `summarySha256`，就必须有人实算核对。
 * 规则：能核 → 必须一致（不一致就红）；核不了 → 只能报 `unverified` / **不可判**，
 * 绝不允许把「没核」记成绿。
 */
const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');

test('fixture 的 save/summary 哈希：能核就核，核不了就报不可判', () => {
  const report = verifyFixtureHashes(worldClientRoot, repoRoot, process.env.PWE_SOAK);
  console.log(
    `fixture-hash: ${report.status} root=${report.root ?? '-'} ` +
    report.checks.map((check) => `${check.name}=${check.status}`).join(' '),
  );

  if (report.status === 'unverified') {
    assert.equal(report.ok, false, '哈希不可判时不许当绿');
    assert.ok(
      typeof report.note === 'string' && report.note.includes('不可判'),
      `unverified 必须写清「不可判」：${report.note ?? '(无 note)'}`,
    );
    return;
  }

  assert.equal(
    report.status,
    'verified',
    'fixture 声明的哈希与本地文件不一致：\n' +
    report.checks.map((check) => `${check.name}: declared=${check.declared} actual=${check.actual}`).join('\n'),
  );
  assert.equal(report.ok, true);
});
