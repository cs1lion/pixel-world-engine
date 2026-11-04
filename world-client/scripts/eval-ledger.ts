#!/usr/bin/env node
/**
 * 指标账本闸：`node scripts/eval-ledger.ts [--json]`
 *
 * 校验 `eval/ledger.json` 的必填字段与 script_sha；全绿退出 0，任一字段缺失退出 1。
 * 秒级，放在现有 `npm test` 的 test job 内（不新开 CI job 的理由见证据 README）。
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadLedger, validateLedger } from './eval-ledger-lib.ts';

const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');
const startedAt = performance.now();
const validation = validateLedger(loadLedger(repoRoot), worldClientRoot);
const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ schema: 'eval-ledger-check/1', elapsedMs, ...validation }, null, 2));
} else {
  console.log(`ledger: metrics=${validation.metrics} ${validation.ok ? 'ok' : 'FAIL'} ` +
    `elapsed=${elapsedMs}ms`);
  for (const error of validation.errors) console.log(`  - ${error}`);
}
process.exit(validation.ok ? 0 : 1);
