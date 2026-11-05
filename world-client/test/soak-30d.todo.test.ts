/**
 * 30 日浸泡暴露的口径缺口。SOAK-BUG-1（关系账本恒空）已修，用例转正；
 * SOAK-BUG-3/4 也早已是普通断言。读数留在 `docs/evidence/soak/REPORT.md`
 * 与 `docs/BUGS_FOUND.md` 的「长周期浸泡」小节。
 *
 * 为什么只跑 8 天而不是 30 天：预算边界与 legend 上限在 8 天内已经稳定复现，
 * 跑 30 天只会把同一结论拖长到 40 秒。
 * 30 天的完整读数由 `scripts/soak-30d.ts` 采，不在 `npm test` 里跑。
 *
 * 不允许放宽断言来「变绿」：修实现，然后删掉 todo。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SoakRun, type SoakSummary } from './soak-support.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';

const SEED = 'soak-todo';
const DAYS = 8;

let workDir = '';
let run: SoakRun;
let summary: SoakSummary;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'soak-todo-'));
  const ledgerPath = join(workDir, 'creator-ledger.jsonl');
  run = new SoakRun({ seed: SEED, totalDays: DAYS, ledgerPath });
  summary = await run.run({ seed: SEED, totalDays: DAYS, ledgerPath });
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function last() {
  const sample = summary.days.at(-1);
  assert.ok(sample !== undefined, '至少跑完一天');
  return sample;
}

test('[SOAK-BUG-1] 纯日常世界的 8 日也应结下关系账本条目', () => {
  const sample = last();
  assert.ok(sample.relations.count > 0, `关系账本 ${sample.relations.count} 条`);
});

// SOAK-BUG-2 不在这里翻正：日常世界跑 8 天确实不该有摘要。实测日层显著度
// p99 = max = 0.5029，0.60 在整条分布之上；而降阈值会让「听来的」(0.575)
// 也压成 `witnessed` 摘要、丢掉来源链。机制通不通由
// `memory-archive-reach.test.ts`（每 7 天一件亲历大事、跑 90 天）单独证明。

test('[SOAK-BUG-3] legend 层条目受条数 + 字节双预算约束', () => {
  // 读实现的真值：全库条目按 tier 计数，不靠夹具的摘要字段。
  const memory = JSON.parse(run.memory.toJSON()) as {
    world?: { entries?: { holderId?: string; tier?: string }[] };
  };
  const legends = (memory.world?.entries ?? []).filter((entry) => entry.tier === 'legend');
  const perHolder = new Map<string, number>();
  for (const entry of legends) {
    const holder = entry.holderId ?? 'unknown';
    perHolder.set(holder, (perHolder.get(holder) ?? 0) + 1);
  }
  for (const [holder, count] of perHolder) {
    assert.ok(
      count <= DEFAULT_MEMORY_CONFIG.budget.legend,
      `${holder} 的 legend 条目 ${count} 条，超过每人 ${DEFAULT_MEMORY_CONFIG.budget.legend} 条`,
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(legends), 'utf8');
  assert.ok(
    bytes <= DEFAULT_MEMORY_CONFIG.budget.bytes.legend * Math.max(1, perHolder.size),
    `legend 条目 ${bytes} B，超过 ${perHolder.size} 人 × ${DEFAULT_MEMORY_CONFIG.budget.bytes.legend} B`,
  );
});

test('[SOAK-BUG-4] 六个无条目层的库都落在预算内，超了就裁且留痕', () => {
  // 「1.7 KB/角色年」的旧目标按的是稀疏世界；这个世界每天约 30 件事，
  // 90 日实测 1203 KB/角色年，那个口径在这里结构性不成立（见 BUGS_FOUND）。
  // 能断言、也必须断言的是：**每个库都不超过它的预算**。这是本轮修的边界。
  const memory = JSON.parse(run.memory.toJSON()) as { world?: Record<string, unknown[]> };
  const world = memory.world ?? {};
  const layers = ['facts', 'claims', 'beliefs', 'cooldowns', 'tells', 'written', 'legends'] as const;
  for (const layer of layers) {
    const budget = DEFAULT_MEMORY_CONFIG.libraryBudget[layer];
    const rows = world[layer] ?? [];
    const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
    assert.ok(rows.length <= budget.count, `${layer} ${rows.length} 条 > 条数预算 ${budget.count}`);
    assert.ok(bytes <= budget.bytes, `${layer} ${bytes} B > 字节预算 ${budget.bytes}`);
  }
  // 8 天还够不着这些上限（第一天 60 KB，第 30 天才逼近），所以这里不断言
  // `pruned > 0`——那会变成一条「跑得不够久」的假失败。淘汰的痕迹与原因由
  // `memory-budget.test.ts` 用收紧的预算直接验证；30 / 90 日的真实淘汰量见 REPORT。
});
