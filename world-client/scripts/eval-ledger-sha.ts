#!/usr/bin/env node
/**
 * 账本 `script_sha` 的**生成端**：`node scripts/eval-ledger-sha.ts [--write]`
 *
 * 与校验端（`eval-ledger-lib.ts` 的 `validateLedger`）共用同一个 `sha256OfFile`，
 * 也就是同一套「先 CRLF → LF 归一化、再算 sha256」的口径——手抄哈希是错的那两次
 * 红闸门的直接原因之一，这里不给手抄留位置。
 *
 * 不加 `--write` 只打印 `id / script / sha` 与「是否已与账本一致」；加 `--write` 把
 * 不一致的条目写回 `eval/ledger.json`。它**不**证明读数有效：脚本改过之后读数仍
 * 必须重测，这里只负责把「哪个脚本」的哈希对齐。
 */
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedger, sha256OfFile } from './eval-ledger-lib.ts';

const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');
const ledgerPath = resolve(repoRoot, 'eval/ledger.json');
const write = process.argv.includes('--write');

interface LedgerMetric {
  script?: string;
  script_sha?: string;
  [key: string]: unknown;
}
const document = loadLedger(repoRoot) as { metrics: LedgerMetric[] };

let changed = 0;
for (const metric of document.metrics) {
  if (typeof metric.script !== 'string') continue;
  const scriptPath = isAbsolute(metric.script) ? metric.script : resolve(worldClientRoot, metric.script);
  const actual = sha256OfFile(scriptPath);
  const same = metric.script_sha === actual;
  if (!same) {
    changed += 1;
    if (write) metric.script_sha = actual;
  }
  console.log(`${same ? 'ok  ' : 'DIFF'} ${String(metric.id)} ${metric.script} ${actual}`);
}

if (write) {
  writeFileSync(ledgerPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`\nwritten: ${changed} 条 script_sha 已更新 → eval/ledger.json`);
  console.log('提醒：哈希对齐不等于读数有效，脚本改过必须重测读数后才能提交。');
} else if (changed > 0) {
  console.log(`\n${changed} 条不一致；加 --write 可回写。`);
}
