/**
 * eval-ledger 校验器的自检：真账本必须绿，五类坏账本必须红。
 *
 * 只读 eval/ledger.json，所有变异都在内存副本上做，不写账本。
 *
 * 跑法（cwd = world-client）：
 *   node scripts/verify-ledger-selfcheck.ts
 */
import { fileURLToPath } from 'node:url';
import { loadLedger, validateLedger } from './eval-ledger-lib.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
type Metric = Record<string, unknown> & { id?: string; value?: unknown; source?: unknown; script?: unknown };

function docWith(metrics: Metric[]) {
  return { version: 1, generated: '2026-11-06', metrics };
}

function cloneMetrics(document: unknown): Metric[] {
  const doc = document as { metrics: Metric[] };
  return structuredClone(doc.metrics);
}

function expectRed(name: string, document: unknown, needle: string): string | null {
  const result = validateLedger(document, ROOT);
  const hit = result.errors.some((line) => line.includes(needle));
  if (result.ok || !hit) {
    return `${name}: 期望判红且错误含「${needle}」，实际 ok=${result.ok} errors=${JSON.stringify(result.errors.slice(0, 3))}`;
  }
  console.log(`${name.padEnd(26)} 红  ${result.errors.find((line) => line.includes(needle))}`);
  return null;
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ledger = loadLedger(REPO_ROOT);
const baseline = validateLedger(ledger, ROOT);
const errors: string[] = [];
if (!baseline.ok) {
  errors.push(`baseline: 当前 eval/ledger.json 未通过：${baseline.errors.slice(0, 3).join(' / ')}`);
} else {
  console.log(`${'baseline'.padEnd(26)} 绿  metrics=${baseline.metrics}`);
}

const metrics = cloneMetrics(ledger);

const missing = structuredClone(metrics);
delete missing[0].seed;
errors.push(
  expectRed('缺必填字段 seed', docWith(missing), '缺必填字段 seed') ?? '',
);

const zeroPlaceholder = structuredClone(metrics);
zeroPlaceholder[0].value = 0;
zeroPlaceholder[0].source = 'not_measured';
errors.push(
  expectRed('0 占位 not_measured', docWith(zeroPlaceholder), '不许用 0 占位') ?? '',
);

const tamperedScript = structuredClone(metrics);
const withScript = tamperedScript.find((metric) => typeof metric.script === 'string');
if (!withScript) {
  errors.push('tampered script: 账本里找不到带 script 字段的读数，无法构造');
} else {
  withScript.script_sha = '0'.repeat(64);
  errors.push(
    expectRed('script_sha 与内容不符', docWith(tamperedScript), '脚本改过，读数需重测') ?? '',
  );
}

const external = structuredClone(metrics);
const soakMetric = external.find(
  (metric) => typeof metric.source === 'string' && metric.source.startsWith('pwe-soak/'),
);
if (!soakMetric) {
  errors.push('external: 账本里找不到 pwe-soak/ 来源的读数，无法构造');
} else {
  delete (soakMetric as Record<string, unknown>).input_sha;
  delete (soakMetric as Record<string, unknown>).input_status;
  delete (soakMetric as Record<string, unknown>).input_note;
  errors.push(
    expectRed('外部来源缺输入哈希', docWith(external), '外部来源（pwe-soak）必须给 input_sha') ?? '',
  );
}

const duplicate = structuredClone(metrics);
duplicate.push(structuredClone(duplicate[0]));
duplicate[duplicate.length - 1].id = duplicate[0].id;
errors.push(
  expectRed('重复 id', docWith(duplicate), 'id 重复') ?? '',
);

const badVersion = { ...(ledger as object), version: 2 };
errors.push(
  expectRed('version 不是 1', badVersion, 'version 必须是 1') ?? '',
);

const real = errors.filter(Boolean);
if (real.length > 0) {
  console.error('\n账本自检失败：');
  for (const line of real) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('\neval-ledger 自检通过：1 绿 + 6 红按预期判定');
