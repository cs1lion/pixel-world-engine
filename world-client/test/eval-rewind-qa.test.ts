import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRewindQa, type DayRecord } from './eval-rewind-support.ts';

interface Fixture {
  readonly provenance: {
    readonly sourceTree: string;
    readonly sourceCommit: string;
    readonly saveFile: string;
    readonly saveSha256: string;
  };
  readonly days: readonly DayRecord[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../eval/fixtures/eval-soak-day-facts.json', import.meta.url), 'utf8'),
) as Fixture;

/**
 * 回溯问答：第 20/45/60/89 天 × 10 问 = 40 条断言。
 * 每条都要有答案、有 eventRefs、且引用只属于当天；空答案与跨天引用都算失败。
 * 事实来自 pwe-soak 已提交证据的只读投影（见 fixture 的 provenance）。
 */
test('40 条回溯问答全部有据可查', () => {
  const run = runRewindQa(fixture);
  assert.deepEqual(run.days, [20, 45, 60, 89], '四天必须齐');
  assert.equal(run.checks.length, 40, `断言分母必须是 40，实际 ${run.checks.length}`);
  assert.equal(
    run.failed,
    0,
    `失败项：${run.checks.filter((check) => !check.ok)
      .map((check) => `${check.day}/${check.id}:${check.failures.join('|')}`)
      .join('；')}`,
  );
  assert.equal(fixture.provenance.sourceTree, 'pwe-soak', '必须注明证据来源树');
  assert.match(fixture.provenance.sourceCommit, /^[0-9a-f]{7,40}$/, '必须注明来源提交');
});

test('空事实日必须记 10 条失败，不许拿“未记录”充答案', () => {
  const empty: DayRecord = { day: 20, weather: 'clear', facts: [] };
  const run = runRewindQa({ days: [empty] });
  assert.equal(run.checks.length, 10, '空日也要保持 10 条分母');
  assert.equal(run.failed, 10, '抽不到事实就是 10 条失败，不能变绿');
});
