#!/usr/bin/env node
/**
 * 世界时间回溯与 Trajectory 因果分叉可观测性 EDD 评估脚本
 * 用法：
 *   node world-client/scripts/eval-rewind.mjs [--split main|held-out|all] [--url http://127.0.0.1:4173/?art=0]
 *
 * 依赖对齐仓库规范：使用 @playwright/test 与 window.__PIXEL_WORLD_DEBUG__ / window.Oracle
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const EVAL_DIR = path.resolve(process.cwd(), 'world-client/eval/rewind');

function parseArgs(argv) {
  const args = { split: 'all', url: 'http://127.0.0.1:4173/?art=0' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--split' && argv[i + 1]) args.split = argv[++i];
    else if (argv[i] === '--url' && argv[i + 1]) args.url = argv[++i];
    else if (argv[i].startsWith('--split=')) args.split = argv[i].split('=')[1];
  }
  return args;
}

async function loadSplit(name) {
  const filePath = path.join(EVAL_DIR, `${name}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function runCase(page, example) {
  const startedAt = performance.now();

  try {
    const result = await page.evaluate(async (ex) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      if (!api || typeof api.restoreWorldToDay !== 'function') {
        return { ok: false, reason: 'missing window.__PIXEL_WORLD_DEBUG__.restoreWorldToDay' };
      }

      await api.resetWorld({
        world: ex.env?.world ?? 'dengchao',
        seed: ex.env?.seed ?? 'rewind-default-seed',
        now: ex.env?.now ?? 360,
      });

      if (ex.env?.advanceToDay && ex.env.advanceToDay > 1) {
        await api.advanceToDayAndClose(ex.env.advanceToDay);
      }

      switch (ex.check) {
        case 'restoreMemoryIntact': {
          const res = await api.restoreWorldToDay(ex.input.targetDay);
          const saveRaw = api.exportSaveJson();
          const saveObj = JSON.parse(saveRaw);
          const memoryStr = saveObj?.world?.memory ?? '';
          return {
            ok:
              Boolean(res?.ok) &&
              memoryStr.length > 10 &&
              api.getCurrentDay() === ex.expect.currentDayAfterRestore &&
              api.getBeliefCount() > 0,
            detail: { res, day: api.getCurrentDay(), memoryLen: memoryStr.length },
          };
        }
        case 'rewindFidelity': {
          const res = await api.restoreWorldToDay(ex.input.targetDay);
          return {
            ok:
              Boolean(res?.ok) &&
              res?.fidelity?.fidelityMatch === ex.expect.fidelityMatch &&
              Boolean(res?.fidelity?.restoredFingerprint),
            detail: res?.fidelity,
          };
        }
        case 'sceneRestoreAndSave': {
          const res = await api.restoreWorldToDay(ex.input.targetDay, { viaUiConfirm: ex.input.viaUiConfirm });
          const persistedDay = api.getPersistedSaveDay();
          const fxTriggered = api.hasActiveFx?.('oracle-beam') ?? Boolean(res?.oracleBeamTriggered);
          return {
            ok:
              Boolean(res?.ok) &&
              api.getCurrentDay() === ex.expect.simDay &&
              persistedDay === ex.expect.saveStoreDay &&
              fxTriggered === ex.expect.oracleBeamTriggered,
            detail: { simDay: api.getCurrentDay(), persistedDay, fxTriggered },
          };
        }
        case 'pruneAndReAdvance': {
          await api.restoreWorldToDay(ex.input.targetDay);
          await api.advanceToDayAndClose(ex.input.targetDay + ex.input.reAdvanceDays);
          const days = api.getHistoryDays();
          const maxDay = Math.max(...days.map((d) => d.day));
          const day3 = days.find((d) => d.day === ex.input.targetDay + 1);
          const missingCount = days.filter((d) => d.kind === 'missing').length;
          return {
            ok:
              api.getCurrentDay() === ex.expect.simDay &&
              maxDay === ex.expect.maxRecordedDay &&
              day3?.kind === ex.expect.day3Kind &&
              missingCount === ex.expect.missingDaysCount,
            detail: { simDay: api.getCurrentDay(), maxDay, day3, missingCount },
          };
        }
        case 'trajectoryForkLineage': {
          await api.restoreWorldToDay(ex.input.targetDay);
          const lineage = api.getTrajectoryLineage();
          const lastSpan = lineage?.rewindSpans?.[lineage.rewindSpans.length - 1];
          return {
            ok:
              lineage?.activeBranchId === ex.expect.activeBranchId &&
              lastSpan?.parentBranchId === ex.expect.parentBranchId &&
              lastSpan?.forkAtDay === ex.expect.forkAtDay &&
              lastSpan?.archivedNodes?.length === ex.expect.archivedDayCount,
            detail: { lineage, lastSpan },
          };
        }
        case 'counterfactualDiff': {
          await api.restoreWorldToDay(ex.input.targetDay);
          if (ex.input.injectOnNewBranch === 'placeBuilding') {
            api.injectCreatorBuildingForTest?.();
          }
          await api.advanceToDayAndClose(ex.input.compareAtDay);
          const diff = api.compareTrajectoryBranches('branch-0', 'branch-1', ex.input.compareAtDay);
          return {
            ok:
              Boolean(diff) &&
              diff.fingerprintChanged === ex.expect.fingerprintChanged &&
              diff.deltaBuildings === ex.expect.deltaBuildings,
            detail: diff,
          };
        }
        case 'dayCardReadOnlyProof': {
          const proof = window.Oracle?.dayCardProof?.();
          return {
            ok: Boolean(proof) && proof.memoryEqual === true && proof.saveEqual === true,
            detail: proof,
          };
        }
        case 'legacyReadOnlyRewind': {
          const view = await window.Oracle?.historyRewind?.(ex.input.previewDay);
          return {
            ok: api.getCurrentDay() === ex.expect.activeSimDayUnchanged && view?.day === ex.expect.previewDayReturned,
            detail: { activeDay: api.getCurrentDay(), previewDay: view?.day },
          };
        }
        case 'worldStillRuns': {
          const t0 = performance.now();
          api.stepTicks(10);
          const avgMs = (performance.now() - t0) / 10;
          return { ok: avgMs <= (ex.expect.maxAvgStepMs ?? 16.6), detail: { avgMs } };
        }
        case 'deterministicReplay': {
          await api.resetWorld({ world: ex.env.world, seed: ex.env.seed, now: 360 });
          await api.advanceToDayAndClose(3);
          await api.restoreWorldToDay(1);
          await api.advanceToDayAndClose(2);
          const hashA = api.getStateHash();

          await api.resetWorld({ world: ex.env.world, seed: ex.env.seed, now: 360 });
          await api.advanceToDayAndClose(3);
          await api.restoreWorldToDay(1);
          await api.advanceToDayAndClose(2);
          const hashB = api.getStateHash();
          return { ok: Boolean(hashA) && hashA === hashB, detail: { hashA, hashB } };
        }
        default:
          return { ok: false, reason: `unhandled check: ${ex.check}` };
      }
    }, example);

    return {
      id: example.id,
      ok: Boolean(result.ok),
      durationMs: performance.now() - startedAt,
      detail: result.detail ?? result.reason,
    };
  } catch (err) {
    return {
      id: example.id,
      ok: false,
      durationMs: performance.now() - startedAt,
      detail: String(err),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const splits = args.split === 'all' ? ['main', 'held-out'] : [args.split];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let total = 0;
  let passed = 0;

  try {
    await page.goto(args.url, { waitUntil: 'networkidle' });
    for (const splitName of splits) {
      const dataset = await loadSplit(splitName);
      console.log(`\n=== Running rewind & trajectory eval split: ${splitName} (${dataset.examples.length} cases) ===`);
      for (const ex of dataset.examples) {
        total++;
        const res = await runCase(page, ex);
        if (res.ok) passed++;
        console.log(`[${res.ok ? 'PASS' : 'FAIL'}] ${ex.id} (${ex.name}) - ${res.durationMs.toFixed(1)}ms`);
        if (!res.ok) console.log('   detail:', JSON.stringify(res.detail));
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nSummary: ${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});