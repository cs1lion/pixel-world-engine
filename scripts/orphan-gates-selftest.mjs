#!/usr/bin/env node
/**
 * 回归：只有「能判红」的步骤才算消费方。
 *
 * 背景：`chore/orphan-gates` 最初只查可达性，`continue-on-error: true`、
 * `run: ... || true`、`if: false` 三种接线会让失败穿过 CI，却仍被记成
 * 「有消费方」，闸门等于没接。这里给三种写法各一条反例，外加一条正面对照。
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

function makeFixture({ steps, jobKeys = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'orphan-gates-selftest-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  copyFileSync(AUDIT_SOURCE, join(dir, 'scripts', AUDIT_COPY));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: { 'test:gate': 'node scripts/check-gate.mjs' } }, null, 2),
  );
  writeFileSync(join(dir, 'scripts', 'check-gate.mjs'), 'process.exit(0);\n');
  writeFileSync(
    join(dir, 'scripts', 'orphan-gates-allowlist.json'),
    JSON.stringify({ schema: 'orphan-gates-allowlist/v1', pendingCiBudget: 0, entries: [] }, null, 2),
  );
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
