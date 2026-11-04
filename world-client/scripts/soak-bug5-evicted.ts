#!/usr/bin/env node
/**
 * SOAK-BUG-5 收尾：事实原句层 60% 缺口抽样。
 *
 * 取 seed A 的第 30 天快照与第 90 天快照，差集 = 「活到第 30 天、之后被淘汰」
 * 的事实，原文可直接读到（不用改引擎采样）。再按固定种子抽 20 条打印，
 * 并统计全部差集按 kind 与 importanceHint 的分布。
 *
 * 诚实边界：第 30 天之后新写入、又在当天关账时被淘汰的事实不在这个差集里，
 * 它们的文本没有留档；所以这是「中期被淘汰」的样本，不是全部 1773 条的随机样本。
 *
 * 用法：node scripts/soak-bug5-evicted.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = resolve(CLIENT_ROOT, '../docs/evidence/soak/soak-a');
const OUT = resolve(CLIENT_ROOT, '../docs/evidence/soak/evicted-sample-20.json');

interface Fact {
  readonly eventId: string;
  readonly day: number;
  readonly kind: string;
  readonly importanceHint: number;
  readonly outcome: { readonly what: string };
}

const day30 = JSON.parse(readFileSync(resolve(DIR, 'memory-30d.json'), 'utf8')) as {
  world: { facts: Fact[] };
};
const day90 = JSON.parse(readFileSync(resolve(DIR, 'memory-90d.json'), 'utf8')) as {
  world: { facts: Fact[] };
};

const alive90 = new Set(day90.world.facts.map((fact) => fact.eventId));
const evicted = day30.world.facts
  .filter((fact) => !alive90.has(fact.eventId))
  .sort((a, b) => (a.day !== b.day ? a.day - b.day : a.eventId.localeCompare(b.eventId))) as Fact[];

// 固定线性同余，保证换机器也是同一批 20 条。
let state = 20261104;
const random = (): number => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
const shuffled = [...evicted];
for (let index = shuffled.length - 1; index > 0; index -= 1) {
  const other = Math.floor(random() * (index + 1));
  [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
}
const sample = shuffled.slice(0, 20);

const kindCounts: Record<string, number> = {};
const hintBuckets = { low: 0, mid: 0, high: 0 };
for (const fact of evicted) {
  kindCounts[fact.kind] = (kindCounts[fact.kind] ?? 0) + 1;
  if (fact.importanceHint < 0.4) hintBuckets.low += 1;
  else if (fact.importanceHint < 0.6) hintBuckets.mid += 1;
  else hintBuckets.high += 1;
}

const summary = {
  frame: 'seed A：第 30 天仍存活、第 90 天已不在 facts 的事实',
  candidateCount: evicted.length,
  sampleSize: sample.length,
  kindCounts,
  hintBuckets,
  sample: sample.map((fact) => ({
    eventId: fact.eventId,
    day: fact.day,
    kind: fact.kind,
    importanceHint: fact.importanceHint,
    what: fact.outcome.what,
  })),
};

writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`候选 ${evicted.length} 条（活到第 30 天、之后被淘汰）`);
console.log(`重要度分桶：<0.4 ${hintBuckets.low} / 0.4–0.6 ${hintBuckets.mid} / ≥0.6 ${hintBuckets.high}`);
console.log(`kind：${Object.entries(kindCounts).map(([kind, count]) => `${kind} ${count}`).join(' / ')}`);
for (const [index, fact] of summary.sample.entries()) {
  console.log(`${index + 1}. [${fact.kind} ${fact.importanceHint}] ${fact.what}`);
}
console.log(`写入 ${OUT}`);
