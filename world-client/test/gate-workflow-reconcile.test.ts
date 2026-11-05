import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATES, loadLedger } from '../scripts/eval-ledger-lib.ts';

/**
 * gate ↔ workflow 对账：账本里的 `gate` 不能只是形容词，必须是**真实存在的门**。
 *
 * 口径：解析 `.github/workflows/*.yml` 的 `on:`，把 gate 映射到触发条件
 * （`ci-pr → pull_request|push`、`ci-nightly → schedule|workflow_dispatch`、
 * `release → workflow_dispatch|push(tags)`）。账本里出现的每个 gate 都必须在某个
 * workflow 里有对应触发；新增 gate 而不接真实门，这里先红。
 *
 * 这条测试的起因：16 条 pwe-soak 读数曾标 `gate: ci-nightly`，而仓里从来没有
 * nightly workflow——标签指向一个不存在的门，等于没有门。
 */
const worldClientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(worldClientRoot, '..');
const workflowsDir = resolve(repoRoot, '.github/workflows');

interface TriggerSpec {
  readonly event: string;
  /** `push` 只在带 `tags:` 时才算 release 的落点。 */
  readonly tagsOnly?: boolean;
}

const GATE_TRIGGERS: Record<string, readonly TriggerSpec[]> = {
  'ci-pr': [{ event: 'pull_request' }, { event: 'push' }],
  'ci-nightly': [{ event: 'schedule' }, { event: 'workflow_dispatch' }],
  release: [{ event: 'workflow_dispatch' }, { event: 'push', tagsOnly: true }],
};

interface WorkflowTriggers {
  readonly file: string;
  readonly events: Set<string>;
  readonly pushTags: boolean;
}

function parseTriggers(file: string, text: string): WorkflowTriggers {
  const events = new Set<string>();
  let pushTags = false;
  const lines = text.split(/\r?\n/);
  const onIndex = lines.findIndex((line) => /^['"]?on['"]?\s*:/.test(line));
  if (onIndex === -1) return { file, events, pushTags };

  const head = lines[onIndex]!.replace(/^['"]?on['"]?\s*:/, '').trim();
  const clean = (token: string): string => token.trim().replace(/['"]/g, '');
  if (head.startsWith('[')) {
    for (const token of head.replace(/[\[\]]/g, '').split(',')) {
      if (token.trim() !== '') events.add(clean(token));
    }
    return { file, events, pushTags };
  }
  if (head !== '') {
    events.add(clean(head));
    return { file, events, pushTags };
  }

  let currentEvent = '';
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (/^\s*#/.test(raw) || raw.trim() === '') continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break;
    const trimmed = raw.trim();
    if (indent === 2) {
      if (trimmed.startsWith('- ')) {
        events.add(clean(trimmed.slice(2)));
        currentEvent = '';
      } else {
        const key = clean(trimmed.split(':')[0]!);
        events.add(key);
        currentEvent = key;
      }
      continue;
    }
    if (currentEvent === 'push' && /^tags\s*:/.test(trimmed)) pushTags = true;
  }
  return { file, events, pushTags };
}

function loadWorkflows(): WorkflowTriggers[] {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => parseTriggers(name, readFileSync(resolve(workflowsDir, name), 'utf8')));
}

test('账本里出现的每个 gate 在 workflow 里都有真实执行位置', () => {
  const workflows = loadWorkflows();
  assert.ok(workflows.length > 0, '.github/workflows/ 里没有任何 workflow');

  const document = loadLedger(repoRoot) as { metrics: { gate?: unknown }[] };
  const usedGates = [...new Set(document.metrics.map((metric) => String(metric.gate)))];

  for (const gate of GATES) {
    assert.ok(
      GATE_TRIGGERS[gate] !== undefined,
      `gate ${gate} 没有触发映射：新增 gate 必须同时说明它在哪个触发条件下真实执行`,
    );
  }

  for (const gate of usedGates) {
    const expected = GATE_TRIGGERS[gate];
    assert.ok(expected !== undefined, `账本用了未登记的 gate：${gate}`);
    const matched = expected.some((spec) =>
      workflows.some((workflow) =>
        workflow.events.has(spec.event) && (spec.tagsOnly !== true || workflow.pushTags)));
    assert.ok(
      matched,
      `gate ${gate} 在 .github/workflows/*.yml 里没有真实执行位置` +
      `（期望触发：${expected.map((spec) => spec.event + (spec.tagsOnly === true ? '(tags)' : '')).join(' / ')}；` +
      `实际：${workflows.map((workflow) => `${workflow.file}=[${[...workflow.events].join(',')}${workflow.pushTags ? ',tags' : ''}]`).join('；')}）`,
    );
  }
});
