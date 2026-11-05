#!/usr/bin/env node
/**
 * 反事实证据脚本：一份 JSON + 退出码。
 *
 *   node scripts/eval-counterfactual.ts --out docs/evidence/eval-counterfactual/counterfactual.json
 *   node scripts/eval-counterfactual.ts --guard-red
 *
 * 默认模式断言两条契约（删一条必变；听说假记忆不得 witnessed），全绿退出 0。
 * `--guard-red` 是**造错守卫**：关掉读档闸（直连 `world.restoreSnapshot`）再量
 * 同一句断言——假记忆会以 `witnessed` 复活，于是这一支必须红（退出 1）。
 * 红本身就是「闸是唯一拦住它的东西」的证据；默认模式（闸开着）必须绿。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runCounterfactual } from '../test/eval-counterfactual-support.ts';

const startedAt = performance.now();
const result = runCounterfactual();
const guardRed = process.argv.includes('--guard-red');

const contract = {
  deleteChangesRecall: !result.after.eventRefs.includes('eval-e1') &&
    result.before.eventRefs.includes('eval-e1') &&
    result.removedMemoryIds.length >= 1,
  danglingRefsZero: result.danglingRefs === 0,
  timelineCleared: !result.timelineAfterEvents.includes('eval-e1'),
  worldNotEmptied: result.allAfter.eventRefs.includes('eval-e2'),
  rumorNotWitnessed: result.fake.rumorRecalled && result.fake.rumorMode === 'heard',
  // EVAL-BUG-1 修好之后这一条才是绿的：假记忆被读档闸降级，不再自称亲历。
  fakeWitnessedRejected: result.fake.witnessedMode !== 'witnessed' &&
    (result.fake.importReport?.downgradedEntries ?? 0) >= 1,
};

/** 造错守卫：关掉读档闸（直连 restoreSnapshot）时，同一假记忆必须真的以 witnessed 复活。 */
const guard = {
  looseReproducesDefect: result.fake.looseWitnessedRecalled &&
    result.fake.looseWitnessedMode === 'witnessed',
};

const report = {
  schema: 'eval-counterfactual-evidence/1',
  elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
  contract,
  guard,
  defect: {
    id: 'EVAL-BUG-1',
    summary: '存档闸只查 entries 是数组，witnessed 的假记忆能整条读进来并被当成亲眼所见',
    status: 'fixed-by-import-guard',
    fixedBy: 'src/world/memory/import-guard.ts（读档闸降级；报告见 fake.importReport）',
    observed: {
      guardedSourceMode: result.fake.witnessedMode,
      guardedDowngraded: result.fake.importReport?.downgradedEntries ?? 0,
      // 关掉闸的对照组：同一个假记忆在这里就是 witnessed，证明缺陷不是传说。
      looseSourceMode: result.fake.looseWitnessedMode,
      looseRecalled: result.fake.looseWitnessedRecalled,
      ghostEventId: result.fake.ghostEventId,
      ghostEventExists: result.fake.ghostEventExists,
    },
  },
  reading: result,
};

const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1) {
  const target = resolve(process.argv[outIndex + 1] ?? '');
  if (process.argv[outIndex + 1] === undefined) {
    console.error('--out 后面要跟一个文件路径');
    process.exit(2);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`wrote ${target}`);
}

const failed = (Object.entries(contract) as [string, boolean][])
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

if (guardRed) {
  // 造错方向：把读档闸关掉，再用**同一句**断言去量。它必须红——红说明守卫抓得住。
  const rejected = result.fake.looseWitnessedMode !== 'witnessed';
  console.log('guard-red: 绕过读档闸后 witnessed 假记忆被召回 =', result.fake.looseWitnessedRecalled,
    'sourceMode =', result.fake.looseWitnessedMode);
  if (!rejected) {
    console.log('guard: RED（绕过闸时假记忆以 witnessed 存活；说明这道闸正是唯一拦它的东西）');
    process.exit(1);
  }
  console.log('guard: GREEN（绕过闸也拦住了？那这道闸没有存在意义，要查）');
  process.exit(0);
}

console.log(`contract: ${failed.length === 0 ? 'ok' : `failed=${failed.join(',')}`}；` +
  `elapsed=${report.elapsedMs}ms`);
process.exit(failed.length === 0 ? 0 : 1);
