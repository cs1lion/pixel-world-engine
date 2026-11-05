/**
 * CLI：实算 `eval/fixtures/eval-soak-day-facts.json` 声明的 save/summary 哈希。
 *
 * 退出码：0 = verified，1 = mismatch（真不一致），2 = unverified（不可判，不当绿）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyFixtureHashes } from './eval-fixture-hash-lib.ts';

const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');
const report = verifyFixtureHashes(worldClientRoot, repoRoot, process.env.PWE_SOAK);

for (const check of report.checks) {
  console.log(`${check.status}  ${check.name}  ${check.file}`);
  console.log(`  declared ${check.declared}`);
  console.log(`  actual   ${check.actual ?? '（未读到文件）'}`);
}
if (report.note !== undefined) console.log(report.note);
console.log(`fixture-hash: ${report.status} root=${report.root ?? '-'}`);

if (report.status === 'verified') process.exit(0);
process.exit(report.status === 'mismatch' ? 1 : 2);
