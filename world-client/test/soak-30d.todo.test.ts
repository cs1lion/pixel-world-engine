/**
 * 30 日浸泡暴露的四条口径缺口。**这些是 `todo` 用例**：用例写的是「应该成立」
 * 的断言，当前实现不满足；Node test 会把它标成 todo 而不是失败，读数留在
 * `docs/evidence/soak/REPORT.md` 与 `docs/BUGS_FOUND.md` 的「长周期浸泡」小节。
 *
 * 为什么只跑 8 天而不是 30 天：这四条在 8 天内已经稳定复现（关系 0、摘要 0、
 * legend 无预算、存档日均增长远超基线），跑 30 天只会把同一结论拖长到 40 秒。
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

test(
  '[SOAK-BUG-1] 纯日常世界的 8 日也应结下关系账本条目',
  { todo: 'SOAK-BUG-1：30 日浸泡 incidents=0，bondsOf() 恒空；关系账本从未写入' },
  () => {
    const sample = last();
    assert.ok(sample.relations.count > 0, `关系账本 ${sample.relations.count} 条`);
  },
);

test(
  '[SOAK-BUG-2] 8 日应至少产生一条摘要，归档才有入口',
  { todo: 'SOAK-BUG-2：日层显著度最高 0.5029 < T_promote=0.6，summaries/promoted/archived 全为 0' },
  () => {
    const sample = last();
    assert.ok(sample.memory.summaries > 0, `摘要 ${sample.memory.summaries} 条`);
    assert.ok(sample.memory.archived > 0, `归档 ${sample.memory.archived} 条`);
  },
);

test(
  '[SOAK-BUG-3] legend 层条目应有预算上限（现在是无上限）',
  { todo: "SOAK-BUG-3：limitFor('legend') = Infinity，8 天 95 条 / 30 天 500 条，按事 × 人 × 地点刻" },
  () => {
    // 读实现的真值：全库条目按 tier 计数，不靠夹具的摘要字段。
    const memory = JSON.parse(run.memory.toJSON()) as {
      world?: { entries?: { holderId?: string; tier?: string }[] };
    };
    const legends = (memory.world?.entries ?? []).filter((entry) => entry.tier === 'legend');
    // 长期层预算 64 是现成的上限口径；legend 层至少不该超过它。
    assert.ok(legends.length <= 64, `legend 条目 ${legends.length} > 64`);
  },
);

test(
  '[SOAK-BUG-4] 存档边际增长不应打破 1.7 KB/角色年',
  { todo: 'SOAK-BUG-4：30 日存档 1.69MB，边际约 4055 KB/角色年；facts/claims/beliefs/cooldowns/tells 无预算' },
  () => {
    const first = summary.days[0];
    const sample = last();
    assert.ok(first !== undefined);
    const characters = 5;
    const perDayKB = (sample.saveBytes - first.saveBytes) / 1024 / (DAYS - 1);
    const kbPerCharacterYear = (perDayKB * 365) / characters;
    assert.ok(kbPerCharacterYear <= 1.7, `${kbPerCharacterYear.toFixed(1)} KB/角色年`);
  },
);
