#!/usr/bin/env node
/**
 * SOAK-BUG-5 收尾：把日摘要上限临时压到 60 条，实测「超限时先扔哪些天」。
 *
 * 不改提交里的常量：这里只在构造 `MemoryWorld` 时传一份 `digests.count = 60`
 * 的配置，然后把 seed A 的 90 天真实记忆快照读进去，跑一次第 90 天关账，
 * 让 `enforceBudgets` 真的裁一次，再读回存活的日号。顺序由生产代码决定，
 * 不是脚本自己排的。
 *
 * 用法：node scripts/soak-digest-order.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import { DIGEST_PROTECTED_DAYS } from '../src/world/memory/digest.ts';
import type { MemoryRuntimeSnapshot } from '../src/world/memory/runtime.ts';
import type { DayDigest } from '../src/world/memory/types.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT = resolve(CLIENT_ROOT, '../docs/evidence/soak/soak-a/memory-90d.json');
const OUT = resolve(CLIENT_ROOT, '../docs/evidence/soak/digest-order-60.json');

const CAP = 60;
const config: MemoryConfig = {
  ...DEFAULT_MEMORY_CONFIG,
  libraryBudget: {
    ...DEFAULT_MEMORY_CONFIG.libraryBudget,
    digests: { count: CAP, bytes: DEFAULT_MEMORY_CONFIG.libraryBudget.digests.bytes },
  },
};

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as MemoryRuntimeSnapshot;
const world = new MemoryWorld({ config });
world.restoreSnapshot(snapshot.world);

const before = world.dayDigests();
const beforeDays = before.map((digest) => digest.day);
const day90 = Math.max(...beforeDays) + 1;
world.dayClosed(day90, snapshot.now);

const after = world.dayDigests();
const keptDays = after.map((digest) => digest.day);
const droppedDays = beforeDays.filter((day) => !keptDays.includes(day));
const protectedDays = beforeDays.filter((day) => day < DIGEST_PROTECTED_DAYS);
const protectedKept = keptDays.filter((day) => day < DIGEST_PROTECTED_DAYS);

function weightOf(digest: DayDigest): number {
  if (digest.flags.some((flag) => flag === 'dispute' || flag === 'anomaly' || flag === 'major')) return 2;
  return digest.events.length > 0 ? 1 : 0;
}

const beforeWeights = new Map(before.map((digest) => [digest.day, weightOf(digest)]));
const droppedWeights = droppedDays.map((day) => beforeWeights.get(day) ?? 0);
const droppedHeavy = droppedWeights.filter((weight) => weight === 2).length;

const summary = {
  cap: CAP,
  beforeCount: before.length,
  afterCount: after.length,
  keptRange: [keptDays[0] ?? null, keptDays.at(-1) ?? null],
  keptDays,
  droppedDays,
  droppedRanges: rangesOf(droppedDays),
  protectedDays: [protectedDays[0] ?? null, protectedDays.at(-1) ?? null],
  protectedKept: protectedKept.length,
  droppedWithDisputeAnomalyMajor: droppedHeavy,
  droppedWeights: { heavy: droppedHeavy, normal: droppedWeights.filter((w) => w === 1).length, empty: droppedWeights.filter((w) => w === 0).length },
};

writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`日摘要上限压到 ${CAP}：${before.length} → ${after.length} 条`);
console.log(`保底段（day 0–${DIGEST_PROTECTED_DAYS - 1}）：${protectedKept.length}/${protectedDays.length} 条存活`);
console.log(`保留日号：${keptDays.join(', ')}`);
console.log(`淘汰日号：${droppedDays.join(', ')}`);
console.log(`淘汰区间：${summary.droppedRanges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(' / ') || '无'}`);
console.log(`其中含争执/异常/大事的日子：${droppedHeavy} 条`);
console.log(`写入 ${OUT}`);

function rangesOf(days: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const day of days) {
    const last = out[out.length - 1];
    if (last !== undefined && day === last[1] + 1) {
      last[1] = day;
    } else {
      out.push([day, day]);
    }
  }
  return out;
}
