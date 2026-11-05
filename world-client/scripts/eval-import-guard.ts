/**
 * 读档出处闸（EVAL-BUG-1）证据脚本。
 *
 * 五个场景（见 `test/eval-import-guard-support.ts` 的表）：
 *
 * 1. 假记忆走过读档闸 → 降级为 `heard`；
 * 2. 事实被淘汰、断言还在 → 仍是 `witnessed`（**这条是防误伤的关键**）；
 * 3. 事实与旁证都删光 → 降级（说明判据不是「只要有淘汰水位就放行」）；
 * 4. 真 v5 存档 → 导入前后 witnessed 条数不变；
 * 5. 90 天 soak 存档（`--soak`，只读引用）→ 71 → 71，降级 0、拒绝 0、淘汰旁证 12。
 *
 * `--guard-red` 是**造错守卫**：关掉读档闸（直连 `world.restoreSnapshot`）再量
 * 同一句「不得以 witnessed 存在」的断言；假记忆会复活成 `witnessed`，于是这一支
 * 必须红（退出 1）。默认模式（闸开着）必须绿（退出 0）。
 *
 * 用法（从仓库根）：
 *   node world-client/scripts/eval-import-guard.ts --soak D:/project/pwe-soak/docs/evidence/soak/soak-a/save-90d.json --out docs/evidence/eval-import-guard/import-guard.json
 *   node world-client/scripts/eval-import-guard.ts --guard-red   # 必须退出 1
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  runFabricated,
  runFabricatedLoose,
  runPrunedLegit,
  runPrunedWithoutCorroboration,
  runRealSample,
  runSoakArchive,
} from '../test/eval-import-guard-support.ts';

const args = process.argv.slice(2);
const guardRed = args.includes('--guard-red');
const soakIndex = args.indexOf('--soak');
const soakPath = soakIndex === -1 ? null : args[soakIndex + 1] ?? null;
const outIndex = args.indexOf('--out');
const outPath = outIndex === -1 ? null : args[outIndex + 1] ?? null;

const startedAt = performance.now();

if (guardRed) {
  const loose = runFabricatedLoose();
  const rejected = loose.mode !== 'witnessed';
  console.log('guard-red: 绕过读档闸后假记忆被召回 =', loose.recalled, 'sourceMode =', loose.mode);
  if (!rejected) {
    console.error('guard: RED（绕过闸时假记忆以 witnessed 存活；说明这道闸正是唯一拦它的东西）');
    process.exit(1);
  }
  console.error('guard: GREEN（绕过闸也拦住了？那这道闸没有存在意义，要查）');
  process.exit(0);
}

const fabricated = runFabricated();
const prunedLegit = runPrunedLegit();
const uncorroborated = runPrunedWithoutCorroboration();
// 真 v5 样品按脚本位置解析：从仓库根或 world-client 里跑都一样。
const SAMPLE_PATH = fileURLToPath(new URL('../traces/outer-baseline-v5.json', import.meta.url));
const realSample = runRealSample(SAMPLE_PATH, (path) => readFileSync(path, 'utf8'));
const soak = soakPath === null ? null : runSoakArchive(soakPath, (path) => readFileSync(path, 'utf8'));

const contract = {
  fabricatedDowngraded: fabricated.probedMode === 'heard' && fabricated.downgraded >= 1,
  prunedLegitPreserved:
    prunedLegit.probedMode === 'witnessed' &&
    prunedLegit.prunedUnverifiable >= 1 &&
    prunedLegit.downgraded === 0 &&
    prunedLegit.refused === 0,
  uncorroboratedDowngraded:
    uncorroborated.probedMode === 'heard' &&
    uncorroborated.downgraded >= 1 &&
    uncorroborated.prunedUnverifiable === 0,
  realSamplePreserved:
    realSample.witnessedBefore === realSample.witnessedAfter &&
    realSample.downgraded === 0 &&
    realSample.refused === 0,
  soakPreserved:
    soak === null ||
    (soak.witnessedBefore === soak.witnessedAfter && soak.downgraded === 0 && soak.refused === 0),
};

const elapsedMs = performance.now() - startedAt;
const passed = Object.values(contract).filter(Boolean).length;
const total = Object.keys(contract).length;

for (const [name, ok] of Object.entries(contract)) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}
console.log(
  `witnessed: fabricated ${fabricated.witnessedBefore}→${fabricated.witnessedAfter}` +
    ` | pruned-legit ${prunedLegit.witnessedBefore}→${prunedLegit.witnessedAfter}` +
    ` | v5 ${realSample.witnessedBefore}→${realSample.witnessedAfter}` +
    (soak === null ? '' : ` | soak ${soak.witnessedBefore}→${soak.witnessedAfter}`),
);
console.log(
  `拒绝=${fabricated.refused} 降级=${fabricated.downgraded} 淘汰旁证=${fabricated.prunedUnverifiable}` +
    (soak === null ? '（未给 90 天存档，soak 未测）' : ` | soak 拒绝=${soak.refused} 降级=${soak.downgraded} 淘汰旁证=${soak.prunedUnverifiable}`),
);
console.log(`${passed}/${total} 契约通过，${elapsedMs.toFixed(2)}ms`);

if (outPath !== null) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema: 'eval-import-guard/1',
        contract,
        passed,
        total,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        scenarios: { fabricated, prunedLegit, uncorroborated, realSample, soak },
      },
      null,
      2,
    )}\n`,
  );
}

process.exit(passed === total ? 0 : 1);
