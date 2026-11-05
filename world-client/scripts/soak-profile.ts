/**
 * 诊断：把 `Simulation.update` 的各段切开计时，看 30 日里哪一段越跑越慢。
 *
 * 只包原型方法，不改被测代码。跑法与 `soak-30d.ts` 相同（30 日、种子可指定），
 * 结果写到 `docs/evidence/soak/profile.json`。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { SoakRun, type SoakSummary } from '../test/soak-support.ts';

const out = resolve(process.cwd(), '../docs/evidence/soak');
mkdirSync(out, { recursive: true });
const seed = process.argv.find((arg) => arg.startsWith('--seed='))?.slice('--seed='.length) ?? 'soak-profile';
const days = Number(process.argv.find((arg) => arg.startsWith('--days='))?.slice('--days='.length) ?? 30);

interface Bucket {
  calls: number;
  samples: number[];
}

const buckets = new Map<string, Bucket>();
const perDaySections = new Map<number, Map<string, Bucket>>();
let currentDay = 0;
const heapByDay = new Map<number, number>();
const STRIDE = 16;

function record(day: number, name: string, ms: number): void {
  const dayBucket = perDaySections.get(day) ?? new Map<string, Bucket>();
  const perDay = dayBucket.get(name) ?? { calls: 0, samples: [] };
  perDay.calls += 1;
  if (perDay.calls % STRIDE === 0) perDay.samples.push(ms);
  dayBucket.set(name, perDay);
  perDaySections.set(day, dayBucket);
  const all = buckets.get(name) ?? { calls: 0, samples: [] };
  all.calls += 1;
  if (all.calls % STRIDE === 0) all.samples.push(ms);
  buckets.set(name, all);
}

const SECTION_METHODS = [
  'stepTide',
  'stepAmbient',
  'stepTimetable',
  'stepLiveliness',
  'stepGrime',
  'stepConstructions',
  'stepVillager',
  'stepWorkstations',
  'stepDecrees',
  'stepCritters',
  'expireBubble',
  'pumpPending',
] as const;

for (const name of SECTION_METHODS) {
  const proto = Simulation.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = proto[name];
  if (original === undefined) continue;
  proto[name] = function patched(this: unknown, ...args: unknown[]): unknown {
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      const day = Math.floor((this as unknown as { now: number }).now / DAY_MS);
      record(day, name, performance.now() - started);
    }
  };
}

const originalUpdate = Simulation.prototype.update;
Simulation.prototype.update = function patchedUpdate(deltaMs: number): readonly unknown[] {
  const day = Math.floor((this as unknown as { now: number }).now / DAY_MS);
  if (day !== currentDay) {
    currentDay = day;
    heapByDay.set(day, process.memoryUsage().heapUsed);
  }
  return originalUpdate.call(this, deltaMs) as readonly unknown[];
};

const ledgerPath = join(tmpdir(), `soak-profile-${seed}.jsonl`);
const run = new SoakRun({
  seed,
  totalDays: days,
  ledgerPath,
});
const started = performance.now();
const summary: SoakSummary = await run.run({
  seed,
  totalDays: days,
  ledgerPath,
});
const elapsed = (performance.now() - started) / 1000;

function p(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length));
  return sorted[index]!;
}

const perDay = summary.days.map((sample) => {
  const sections = [...(perDaySections.get(sample.day) ?? [])].map(([name, bucket]) => {
    const sorted = [...bucket.samples].sort((a, b) => a - b);
    return [name, { calls: bucket.calls, sampled: sorted.length, p50: p(sorted, 50), p95: p(sorted, 95) }] as const;
  });
  return {
    day: sample.day,
    simP50: sample.perf.simP50,
    simP95: sample.perf.simP95,
    memP50: sample.perf.memP50,
    memP95: sample.perf.memP95,
    dayWallMs: sample.perf.dayWallMs,
    heapMB: (heapByDay.get(sample.day) ?? 0) / 1024 / 1024,
    sections: Object.fromEntries(sections),
  };
});

const sectionReading = Object.fromEntries(
  [...buckets.entries()].map(([name, bucket]) => {
    const sorted = [...bucket.samples].sort((a, b) => a - b);
    return [
      name,
      {
        calls: bucket.calls,
        sampled: sorted.length,
        p50: p(sorted, 50),
        p95: p(sorted, 95),
        max: sorted.at(-1) ?? 0,
      },
    ];
  }),
);

writeFileSync(
  join(out, 'profile.json'),
  `${JSON.stringify({ seed, days, elapsedSeconds: elapsed, perDay, sections: sectionReading }, null, 2)}\n`,
  'utf8',
);
console.log(`[profile] ${days} 日 ${elapsed.toFixed(1)}s`);
for (const day of [0, 1, 6, 14, 21, 29]) {
  const item = perDay.find((entry) => entry.day === day);
  if (item === undefined) continue;
  const parts = Object.entries(item.sections as Record<string, { p95: number }>)
    .sort((a, b) => b[1].p95 - a[1].p95)
    .slice(0, 5)
    .map(([name, value]) => `${name} p95=${value.p95.toFixed(3)}`);
  console.log(`  d${day + 1} sim p50=${item.simP50.toFixed(4)} p95=${item.simP95.toFixed(4)} heap=${item.heapMB.toFixed(0)}MB | ${parts.join(' ')}`);
}
