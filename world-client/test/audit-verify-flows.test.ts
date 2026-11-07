import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  auditFlows,
  loadRegistry,
  parseFlowRows,
  type Registry,
} from '../scripts/audit-verify-flows.ts';

/**
 * 互指闸门的行为锁：每一个「坏样例」都只改一处，并配一份同源的对照
 * （同一份注册表、未改的原文 → 0 处），证明它报的是那处改动，不是见谁都报。
 *
 * 只锁结构：它读不懂「判据写得对不对」，测试也不假装它懂。
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const DOC = resolve(ROOT, 'docs/evidence/VERIFIABLE_FLOWS.md');
const TEXT = readFileSync(DOC, 'utf8');
const REGISTRY = loadRegistry(ROOT);

/** 把某条流程的「入汇总」格改成指定值，其余一个字节不动。 */
function rewriteAggregate(text: string, flow: string, value: string): string {
  const row = parseFlowRows(text).find((item) => item.flow === flow);
  assert.ok(row, `夹具里找不到流程 ${flow}`);
  const lines = text.split('\n');
  const parts = lines[row.line - 1]!.split('|');
  const cells = parts.slice(1, -1);
  cells[cells.length - 1] = ` ${value} `;
  lines[row.line - 1] = `|${cells.join('|')}|`;
  return lines.join('\n');
}

function lineOfFlow(text: string, flow: string): number {
  const row = parseFlowRows(text).find((item) => item.flow === flow);
  assert.ok(row, `夹具里找不到流程 ${flow}`);
  return row.line;
}

test('对照：真实总表与真实注册表互指一致，0 处', () => {
  assert.deepEqual(auditFlows(TEXT, REGISTRY), []);
});

test('坏样例：把「已入」写成「未入」，而注册表里确有对应项 → ROW_MARKED_NOT_IN_AGGREGATE', () => {
  const bad = rewriteAggregate(TEXT, '6', '未入');
  const findings = auditFlows(bad, REGISTRY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.code, 'ROW_MARKED_NOT_IN_AGGREGATE');
  assert.equal(findings[0]!.line, lineOfFlow(TEXT, '6'));
  assert.match(findings[0]!.message, /palette-9/);
  // 对照：同一个改动点在原文里是「已入」，不报。
  assert.deepEqual(auditFlows(TEXT, REGISTRY), []);
});

test('坏样例：把「未入」写成「已入」，注册表里没有任何对应项 → ROW_NOT_REGISTERED', () => {
  const bad = rewriteAggregate(TEXT, '4', '已入');
  const findings = auditFlows(bad, REGISTRY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.code, 'ROW_NOT_REGISTERED');
  assert.equal(findings[0]!.line, lineOfFlow(TEXT, '4'));
});

test('坏样例：「入汇总」写成读不出的值 → ROW_AGGREGATE_UNREADABLE', () => {
  const bad = rewriteAggregate(TEXT, '7', '待定');
  const findings = auditFlows(bad, REGISTRY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.code, 'ROW_AGGREGATE_UNREADABLE');
  assert.equal(findings[0]!.line, lineOfFlow(TEXT, '7'));
});

test('坏样例：注册表多一条总表里没有的流程 → CHECK_WITHOUT_ROW', () => {
  const registry: Registry = {
    checks: [
      ...REGISTRY.checks,
      {
        id: 'never-documented',
        title: '只写进注册表、没写进总表的流程',
        commands: [['node', ['scripts/never-written.mjs']]],
        runnable: true,
      },
    ],
  };
  const findings = auditFlows(TEXT, registry);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.code, 'CHECK_WITHOUT_ROW');
  assert.match(findings[0]!.message, /never-documented/);
  // 对照：去掉这条多出来的注册项，原文不报。
  assert.deepEqual(auditFlows(TEXT, REGISTRY), []);
});
