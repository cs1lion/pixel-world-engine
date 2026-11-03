/**
 * 30 日联合浸泡：跑两轮（两个种子）+ 同种子再跑一遍做确定性对照。
 *
 * 用法：
 *   node scripts/soak-30d.ts                 # 30 日 ×2 种子 + 种子 A 复跑
 *   node scripts/soak-30d.ts --days=3        # 冒烟用
 *   node scripts/soak-30d.ts --seed=soak-a --no-repeat
 *
 * 产物写到 `docs/evidence/soak/<seed>/`：造物账本 JSONL 与逐日读数 JSON。
 * 曲线与报告由 `scripts/soak-report.mjs` 从这些 JSON 生成，跑数不重做。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import { SoakRun, type SoakSummary } from '../test/soak-support.ts';

interface Args {
  readonly days: number;
  readonly seed: string | null;
  readonly repeat: boolean;
  readonly out: string;
}

function parseArgs(argv: readonly string[]): Args {
  let days = 30;
  let seed: string | null = null;
  let repeat = true;
  let out = resolve(process.cwd(), '../docs/evidence/soak');
  for (const arg of argv) {
    if (arg.startsWith('--days=')) days = Number(arg.slice('--days='.length));
    else if (arg.startsWith('--seed=')) seed = arg.slice('--seed='.length);
    else if (arg === '--no-repeat') repeat = false;
    else if (arg.startsWith('--out=')) out = resolve(arg.slice('--out='.length));
  }
  return { days, seed, repeat, out };
}

function dayLine(summary: SoakSummary, day: number): string {
  const sample = summary.days.find((item) => item.day === day);
  if (sample === undefined) return `第${day + 1}天: 无`;
  return [
    `第${day + 1}天`,
    `事件 ${sample.eventCount}`,
    `记忆 ${sample.memory.entries}`,
    `关系 ${sample.relations.count}`,
    `账本 ${sample.ledgerRows}`,
    `存档 ${(sample.saveBytes / 1024).toFixed(1)}KB`,
    `p95 ${sample.perf.simP95.toFixed(2)}ms`,
  ].join(' · ');
}

async function runOne(seed: string, args: Args): Promise<SoakSummary> {
  const dir = join(args.out, seed);
  mkdirSync(dir, { recursive: true });
  const ledgerPath = join(dir, 'creator-ledger.jsonl');
  // 每次全新一轮：账本从空开始，避免上一轮的追加混进这一轮的读数。
  writeFileSync(ledgerPath, '', 'utf8');
  const run = new SoakRun({ seed, totalDays: args.days, ledgerPath });
  const started = performance.now();
  const summary = await run.run({ seed, totalDays: args.days, ledgerPath });
  const elapsed = (performance.now() - started) / 1000;
  const memoryJson = run.memory.toJSON();
  writeFileSync(join(dir, `memory-${args.days}d.json`), `${memoryJson}\n`, 'utf8');
  writeFileSync(
    join(dir, `save-${args.days}d.json`),
    `${JSON.stringify(run.sim.toSave(memoryJson))}\n`,
    'utf8',
  );
  writeFileSync(join(dir, `summary-${args.days}d.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const keyDays = [0, 6, 14, 21, 29].filter((day) => day < args.days);
  console.log(`[${seed}] ${args.days} 世界日，用时 ${elapsed.toFixed(1)}s，违反 ${summary.violations.length} 条`);
  for (const day of keyDays) console.log(`  ${dayLine(summary, day)}`);
  console.log(`  指纹 world=${summary.fingerprints.world.slice(0, 12)} memory=${summary.fingerprints.memory.slice(0, 12)} creator=${summary.fingerprints.creator.slice(0, 12)} events=${summary.fingerprints.events.slice(0, 12)}`);
  return summary;
}

const args = parseArgs(process.argv.slice(2));
const seeds = args.seed === null ? ['soak-a', 'soak-b'] : [args.seed];
const results: SoakSummary[] = [];
for (const seed of seeds) results.push(await runOne(seed, args));

if (args.repeat && args.seed === null) {
  // 同种子再跑一遍：指纹必须逐项相同。第二次写到一个只用来对照的目录。
  const first = results[0]!;
  const repeatDir = join(args.out, `${first.seed}-repeat`);
  mkdirSync(repeatDir, { recursive: true });
  const again = await runOne(`${first.seed}`, { ...args, out: repeatDir });
  const same = (a: string, b: string): string => (a === b ? '同' : '异');
  console.log(`[确定性] world ${same(first.fingerprints.world, again.fingerprints.world)} · memory ${same(first.fingerprints.memory, again.fingerprints.memory)} · creator ${same(first.fingerprints.creator, again.fingerprints.creator)} · events ${same(first.fingerprints.events, again.fingerprints.events)}`);
  const raw = (path: string): string =>
    createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex');
  const rawFirst = raw(join(args.out, first.seed, 'creator-ledger.jsonl'));
  const rawAgain = raw(join(repeatDir, first.seed, 'creator-ledger.jsonl'));
  console.log(
    `[确定性] 账本原始字节 ${same(rawFirst, rawAgain)}（recordId 由 randomUUID 生成，属防撞键，不是行为）`,
  );
  writeFileSync(
    join(args.out, 'determinism.json'),
    `${JSON.stringify(
      {
        seed: first.seed,
        first: first.fingerprints,
        again: again.fingerprints,
        ledgerRaw: { first: rawFirst, again: rawAgain, same: rawFirst === rawAgain },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

writeFileSync(join(args.out, `soak-${args.days}d.json`), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
