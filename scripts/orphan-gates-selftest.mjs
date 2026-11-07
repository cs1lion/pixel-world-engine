#!/usr/bin/env node
/**
 * 检测器自检。
 *
 * 两组回归：
 *  1) 只有「能判红」的步骤才算消费方。`continue-on-error: true`、
 *     `run: ... || true`、`if: false` 三种接线会让失败穿过 CI，却仍被记成
 *     「有消费方」，闸门等于没接。这里给三种写法各一条反例，外加一条正面对照。
 *  2) 清单只能变短：三类条数必须分别等于三个预算；新增条目没抬预算、抬了预算
 *     但缺 approved 三字段、把 pending-ci 改成 manual 绕过预算，都必须红。
 *     另保留一条「未登记的新检查」探针。
 *
 * 跑法：node --test scripts/orphan-gates-selftest.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'audit-orphan-gates.mjs');
/** 副本改名，避免它自己按 `scripts/audit-*` 被算成第三个检查。 */
const AUDIT_COPY = 'orphan-gates-audit.mjs';

const BASE_ALLOWLIST = {
  schema: 'pwe-orphan-gates-allowlist/2',
  pendingCiBudget: 0,
  manualBudget: 0,
  obsoleteBudget: 0,
  budgetLedger: [
    {
      approved_at: '2026-11-07',
      approved_by: 'fixture',
      reason: 'fixture 基线',
      pendingCi: 0,
      manual: 0,
      obsolete: 0,
    },
  ],
  entries: [],
};

const entry = (id, kind) => ({
  id,
  kind,
  reason: 'fixture',
  acceptedBecause: 'fixture',
  blockedBy: 'fixture',
});

function makeFixture({ steps, jobKeys = [], extraScripts = {}, allowlist = BASE_ALLOWLIST }) {
  const dir = mkdtempSync(join(tmpdir(), 'orphan-gates-selftest-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  copyFileSync(AUDIT_SOURCE, join(dir, 'scripts', AUDIT_COPY));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: { 'test:gate': 'node scripts/check-gate.mjs' } }, null, 2),
  );
  writeFileSync(join(dir, 'scripts', 'check-gate.mjs'), 'process.exit(0);\n');
  for (const [name, body] of Object.entries(extraScripts)) {
    writeFileSync(join(dir, 'scripts', name), body);
  }
  writeFileSync(join(dir, 'scripts', 'orphan-gates-allowlist.json'), JSON.stringify(allowlist, null, 2));
  writeFileSync(
    join(dir, '.github', 'workflows', 'ci.yml'),
    [
      'name: fixture',
      'on: push',
      'jobs:',
      '  gate:',
      '    runs-on: ubuntu-latest',
      ...jobKeys.map((line) => `    ${line}`),
      '    steps:',
      ...steps,
      '',
    ].join('\n'),
  );
  return dir;
}

function audit(fixture) {
  try {
    return spawnSync(process.execPath, [join(fixture, 'scripts', AUDIT_COPY)], {
      cwd: fixture,
      encoding: 'utf8',
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('阻断式接线算有效消费方（正面对照）', () => {
  const result = audit(makeFixture({ steps: ['      - run: npm run test:gate'] }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[有消费方\] 2/);
});

test('continue-on-error: true 不算消费方', () => {
  const result = audit(
    makeFixture({
      steps: [
        '      - name: gate',
        '        run: npm run test:gate',
        '        continue-on-error: true',
      ],
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[新孤儿（未登记）\] 2/);
});

test('run: ... || true 不算消费方', () => {
  const result = audit(makeFixture({ steps: ['      - run: npm run test:gate || true'] }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[新孤儿（未登记）\] 2/);
});

test('if: false 不算消费方', () => {
  const result = audit(
    makeFixture({
      steps: ['      - name: gate', '        run: npm run test:gate', '        if: false'],
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[新孤儿（未登记）\] 2/);
});

test('job 级 continue-on-error: true 不算消费方', () => {
  const result = audit(
    makeFixture({
      jobKeys: ['continue-on-error: true'],
      steps: ['      - run: npm run test:gate'],
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[新孤儿（未登记）\] 2/);
});

test('未登记的新检查 → 红（新孤儿探针）', () => {
  const result = audit(
    makeFixture({
      steps: ['      - run: npm run test:gate'],
      extraScripts: { 'check-orphan.mjs': 'process.exit(0);\n' },
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[新孤儿（未登记）\] 1/);
});

test('新增 pending-ci 没抬预算 → 红', () => {
  const result = audit(
    makeFixture({
      steps: ['      - run: npm run test:gate'],
      extraScripts: { 'check-extra.mjs': 'process.exit(0);\n' },
      allowlist: {
        ...BASE_ALLOWLIST,
        entries: [entry('file:scripts/check-extra.mjs', 'pending-ci')],
      },
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /pending-ci 条数 1 ≠ 预算 0/);
});

test('抬了预算但缺 approved 三字段 → 红', () => {
  const result = audit(
    makeFixture({
      steps: ['      - run: npm run test:gate'],
      extraScripts: { 'check-extra.mjs': 'process.exit(0);\n' },
      allowlist: {
        ...BASE_ALLOWLIST,
        pendingCiBudget: 1,
        entries: [entry('file:scripts/check-extra.mjs', 'pending-ci')],
        budgetLedger: [{ reason: '新增一条', pendingCi: 1, manual: 0, obsolete: 0 }],
      },
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /budgetLedger 第 1 条 缺 approved_at/);
});

test('pending-ci 改成 manual 不能绕过预算 → 红', () => {
  const result = audit(
    makeFixture({
      steps: ['      - run: npm run test:gate'],
      extraScripts: { 'check-extra.mjs': 'process.exit(0);\n' },
      allowlist: {
        ...BASE_ALLOWLIST,
        entries: [entry('file:scripts/check-extra.mjs', 'manual')],
      },
    }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /manual 条数 1 ≠ 预算 0/);
});
