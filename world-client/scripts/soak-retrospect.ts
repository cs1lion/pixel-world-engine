/**
 * 长周期回溯审计：跑一轮浸泡，顺便回答「回到某一天还能读出什么」。
 *
 * 只包 `MemoryWorld` 的原型方法，不改被测代码：
 *   - `enforceBudgets` 前后做差，记下当天真正被淘汰的 facts / legends；
 *   - 跑完后在**最终存档**里追这些被淘汰的事实，看它们还有没有留在
 *     条目 / 断言 / 信念 / 传说 / 痕迹的 `eventRefs` 里。
 *
 * 用法：
 *   node scripts/soak-retrospect.ts --days=90 --seed=soak-a
 *   node scripts/soak-retrospect.ts --days=90 --seed=soak-b
 *
 * 产物：`docs/evidence/soak/<seed>/` 下的 memory / save / summary（与
 * `soak-30d.ts` 同口径）以及 `retrospect-<days>d.json`。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MemoryWorld } from '../src/world/memory/world.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import type { DayDigest, Legend, WorldFact } from '../src/world/memory/types.ts';
import { SoakRun, type SoakSummary } from '../test/soak-support.ts';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(`--${name}=`.length);
}

const days = Number(arg('days', '90'));
const seed = arg('seed', 'soak-a');
const outRoot = resolve(process.cwd(), '../docs/evidence/soak');
const dir = join(outRoot, seed);
mkdirSync(dir, { recursive: true });

interface EvictedFact {
  eventId: string;
  factDay: number;
  evictedDay: number;
  kind: string;
  importanceHint: number;
  what: string;
}

interface EvictedLegend {
  legendId: string;
  formedDay: number;
  reach: number;
  eventRefs: readonly string[];
}

const evictedFacts: EvictedFact[] = [];
const evictedLegends: EvictedLegend[] = [];

type MutableWorld = {
  facts: Map<string, WorldFact>;
  legends: Legend[];
};

const proto = MemoryWorld.prototype as unknown as {
  enforceBudgets: (day: number, at: number) => void;
};
const originalEnforce = proto.enforceBudgets;
proto.enforceBudgets = function patched(this: MutableWorld, day: number, at: number): void {
  const factsBefore = new Map(this.facts);
  const legendsBefore = [...this.legends];
  originalEnforce.call(this, day, at);
  for (const [eventId, fact] of factsBefore) {
    if (this.facts.has(eventId)) continue;
    evictedFacts.push({
      eventId,
      factDay: fact.day,
      evictedDay: day,
      kind: fact.kind,
      importanceHint: fact.importanceHint ?? 0,
      what: String((fact.outcome as { what?: unknown }).what ?? ''),
    });
  }
  const legendIdsAfter = new Set(this.legends.map((legend) => legend.legendId));
  for (const legend of legendsBefore) {
    if (legendIdsAfter.has(legend.legendId)) continue;
    evictedLegends.push({
      legendId: legend.legendId,
      formedDay: legend.formedDay,
      reach: legend.reach,
      eventRefs: legend.eventRefs,
    });
  }
};

const ledgerPath = join(dir, `creator-ledger-${days}d.jsonl`);
writeFileSync(ledgerPath, '', 'utf8');
const run = new SoakRun({ seed, totalDays: days, ledgerPath });
const started = performance.now();
const summary = await run.run({ seed, totalDays: days, ledgerPath });
const elapsed = (performance.now() - started) / 1000;
const memoryJson = run.memory.toJSON();
writeFileSync(join(dir, `memory-${days}d.json`), `${memoryJson}\n`, 'utf8');
writeFileSync(join(dir, `save-${days}d.json`), `${JSON.stringify(run.sim.toSave(memoryJson))}\n`, 'utf8');
writeFileSync(join(dir, `summary-${days}d.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const world = (JSON.parse(memoryJson) as { world: Record<string, unknown> }).world;
const facts = (world.facts ?? []) as WorldFact[];
const entries = (world.entries ?? []) as {
  memoryId: string;
  holderId: string;
  kind: string;
  tier: string;
  eventRefs: readonly string[];
  createdDay: number;
  archived: boolean;
}[];
const legends = (world.legends ?? []) as Legend[];
const digests = (world.digests ?? []) as DayDigest[];

// 一次遍历最终存档，把「哪些 eventId 还在别处被引用」建成索引。
const knownIds = new Set<string>();
for (const fact of facts) knownIds.add(fact.eventId);
for (const item of evictedFacts) knownIds.add(item.eventId);
function indexRefs(root: unknown): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (node: unknown, path: string): void => {
    // **数组里的 id 也是引用。** 早先这里只收「对象属性值是字符串」的那一支，
    // 于是 `eventRefs: ['soak-1']` 与日摘要的 `events: [['soak-1', …]]` 全被漏掉，
    // 「事件可追溯」一栏系统性偏低、「淘汰事实可找回」被误判成永久消失。
    if (typeof node === 'string') {
      if (!knownIds.has(node)) return;
      const bucket = found.get(node) ?? [];
      bucket.push(path);
      found.set(node, bucket);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((value, index) => walk(value, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const next = path === '' ? key : `${path}.${key}`;
      if (typeof value === 'string') {
        if (!knownIds.has(value)) continue;
        const bucket = found.get(value) ?? [];
        bucket.push(next);
        found.set(value, bucket);
      } else {
        walk(value, next);
      }
    }
  };
  walk(root, '');
  return found;
}
// 从**整份存档**建索引，路径带 `world.` 前缀，`layerOf` 才切得出层名。
const refIndex = indexRefs(JSON.parse(memoryJson));

function layerOf(path: string): string {
  const match = /^world\.([a-zA-Z]+)(?:\[(\d+)\])?/.exec(path);
  if (match === null) return 'other';
  return match[1]!;
}

function detailOf(path: string, eventId: string): Record<string, unknown> {
  const layer = layerOf(path);
  const match = /^world\.([a-zA-Z]+)\[(\d+)\]/.exec(path);
  if (match === null) return { path, layer };
  const index = Number(match[2]);
  if (layer === 'entries') {
    const entry = entries[index];
    return {
      path,
      layer,
      holderId: entry?.holderId,
      tier: entry?.tier,
      createdDay: entry?.createdDay,
      archived: entry?.archived,
    };
  }
  if (layer === 'legends') {
    const legend = legends[index];
    return {
      path,
      layer,
      legendId: legend?.legendId,
      formedDay: legend?.formedDay,
      reach: legend?.reach,
      eventRefs: legend?.eventRefs,
    };
  }
  if (layer === 'digests') {
    const digest = digests[index];
    return {
      path,
      layer,
      day: digest?.day,
      compact: digest?.compact,
      // 摘要只留得住「哪一天、哪一类事、什么地点」；原句找不回来。
      pointerOnly: true,
    };
  }
  if (layer === 'facts') {
    return { path, layer, factId: eventId, fullSentence: true };
  }
  return { path, layer };
}

const dayEvents = summary.days.map((sample, index) => {
  const previous = index === 0 ? 0 : summary.days[index - 1]!.worldEvents;
  return sample.worldEvents - previous;
});

const factsByDay = new Map<number, number>();
for (const fact of facts) factsByDay.set(fact.day, (factsByDay.get(fact.day) ?? 0) + 1);
const evictedFactsByDay = new Map<number, number>();
for (const item of evictedFacts) {
  evictedFactsByDay.set(item.factDay, (evictedFactsByDay.get(item.factDay) ?? 0) + 1);
}
const timelineByDay = new Map<number, number>();
/** 每个 `(holderId, 事件)` 在条目层还剩几格。摘要按「补缺」并进来，不简单相加。 */
const entrySlotsByDay = new Map<number, Map<string, number>>();
for (const entry of entries) {
  timelineByDay.set(entry.createdDay, (timelineByDay.get(entry.createdDay) ?? 0) + 1);
  const key = entry.kind === 'episodic' ? `${entry.holderId}|${entry.eventRefs[0] ?? entry.memoryId}` : `${entry.holderId}|extra`;
  const slots = entrySlotsByDay.get(entry.createdDay) ?? new Map<string, number>();
  slots.set(key, (slots.get(key) ?? 0) + 1);
  entrySlotsByDay.set(entry.createdDay, slots);
}

/**
 * 日摘要能读出的「拍子」：`(holderId, 事件)` 的重复次数按 `beats` 记，
 * 非片段条目（摘要/印象）按 `extras` 记。口径与 `runtime.dayTimelineFor` 的
 * 补缺逻辑一致——存档里留下的条目先占格，摘要只补少掉的那几格。
 */
const digestSlotsByDay = new Map<number, Map<string, number>>();
for (const digest of digests) {
  const slots = new Map<string, number>();
  digest.events.forEach(([eventId], index) => {
    for (const holderIdx of digest.beats[index] ?? []) {
      const holderId = digest.people[holderIdx];
      if (holderId === undefined) continue;
      const key = `${holderId}|${eventId}`;
      slots.set(key, (slots.get(key) ?? 0) + 1);
    }
  });
  digest.extras.forEach((count, holderIdx) => {
    const holderId = digest.people[holderIdx];
    if (holderId === undefined) return;
    const key = `${holderId}|extra`;
    slots.set(key, (slots.get(key) ?? 0) + count);
  });
  digestSlotsByDay.set(digest.day, slots);
}

/** 从当天视角能读出多少条时间轴：条目 ∪ 摘要（同键取最大值，不是相加）。 */
function readableTimelineOf(day: number): number {
  const survivors = entrySlotsByDay.get(day);
  const fromDigest = digestSlotsByDay.get(day);
  if (fromDigest === undefined) return timelineByDay.get(day) ?? 0;
  const merged = new Map(survivors ?? []);
  for (const [key, count] of fromDigest) {
    merged.set(key, Math.max(merged.get(key) ?? 0, count));
  }
  return [...merged.values()].reduce((sum, count) => sum + count, 0);
}

function backfillRow(dayOneBased: number): Record<string, unknown> {
  const day = dayOneBased - 1;
  const sample = summary.days[day];
  if (sample === undefined) throw new Error(`第 ${dayOneBased} 天不在读数里`);
  const events = dayEvents[day] ?? 0;
  const factsAlive = factsByDay.get(day) ?? 0;
  const factsLost = evictedFactsByDay.get(day) ?? 0;
  const factsWritten = factsAlive + factsLost;
  // 「能读出多少条」= 条目层剩下的 + 日摘要补回的。老档没有摘要时这一项
  // 等于旧口径，所以改前改后是同一把尺子。
  const timelineEntriesOnly = timelineByDay.get(day) ?? 0;
  const timelineAlive = readableTimelineOf(day);
  const timelineAtClose = sample.timelineToday;
  const dayIds = [
    ...facts.filter((fact) => fact.day === day).map((fact) => fact.eventId),
    ...evictedFacts.filter((item) => item.factDay === day).map((item) => item.eventId),
  ];
  const reachable = dayIds.filter((eventId) => refIndex.has(eventId)).length;
  return {
    day: dayOneBased,
    worldEvents: events,
    factsWritten,
    factsAlive,
    factsMissing: factsWritten - factsAlive,
    factsMissingPct: factsWritten === 0 ? 0 : 1 - factsAlive / factsWritten,
    timelineEntriesOnly,
    timelineAlive,
    timelineAtClose,
    timelineMissingPct: timelineAtClose === 0 ? 0 : Math.max(0, 1 - timelineAlive / timelineAtClose),
    digestAlive: digestSlotsByDay.has(day),
    eventsReachable: reachable,
    eventsMissingPct: factsWritten === 0 ? 0 : 1 - reachable / factsWritten,
  };
}

const backfill = [20, 45, 60, 89].map(backfillRow);

const recoverableEvicted = evictedFacts.filter((item) =>
  (refIndex.get(item.eventId) ?? []).some((path) => layerOf(path) !== 'facts'),
).length;
/**
 * 只找得回「指针」的那批：唯一还提到它的是日摘要（哪天、哪一类、什么地点）。
 * 原句（`content.what` / 传记 / 传说正文）都已经不在了——这一列要单独报，
 * 别让「可找回」听起来像「原文还在」。
 */
const pointerOnlyEvicted = evictedFacts.filter((item) => {
  const layers = [...new Set((refIndex.get(item.eventId) ?? []).map((path) => layerOf(path)))].filter(
    (layer) => layer !== 'facts',
  );
  return layers.length > 0 && layers.every((layer) => layer === 'digests');
}).length;

const sampleEvicted = (() => {
  if (evictedFacts.length === 0) return [];
  // 只抽已经落在 90 天窗口内的事实，别把跨日边界后的第 91 天记录混进来。
  const within = evictedFacts.filter((item) => item.factDay < days);
  // 三条不同质地：最早被淘汰的一批、重要度最高的、最后被淘汰的。
  const earliest = [...within].sort((a, b) => a.evictedDay - b.evictedDay || a.factDay - b.factDay)[0]!;
  const highest = [...within].sort((a, b) => b.importanceHint - a.importanceHint)[0]!;
  const latest = [...within].sort((a, b) => b.evictedDay - a.evictedDay || b.factDay - a.factDay)[0]!;
  return [earliest, highest, latest].map((item) => {
    const refs = (refIndex.get(item.eventId) ?? []).filter((path) => layerOf(path) !== 'facts');
    return {
      ...item,
      recoverable: refs.length > 0,
      reachableFrom: refs.slice(0, 6).map((path) => detailOf(path, item.eventId)),
    };
  });
})();

const legendReach = new Map<number, number>();
for (const legend of legends) legendReach.set(legend.reach, (legendReach.get(legend.reach) ?? 0) + 1);
const evictedLegendReach = new Map<number, number>();
for (const legend of evictedLegends) {
  evictedLegendReach.set(legend.reach, (evictedLegendReach.get(legend.reach) ?? 0) + 1);
}
const legendBytes = Buffer.byteLength(JSON.stringify(legends), 'utf8');

const last = summary.days.at(-1)!;
const saveKB = last.saveBytes / 1024;
const day60 = summary.days[59]!;
const last30KbPerDay = (last.saveBytes - day60.saveBytes) / 1024 / 30;

const audit = {
  seed,
  days,
  elapsedSeconds: elapsed,
  saveKB,
  savePercent: saveKB / 2048,
  last30KbPerDay,
  facts: {
    alive: facts.length,
    events: summary.days.at(-1)!.worldEvents,
    ratio: facts.length / Math.max(1, summary.days.at(-1)!.worldEvents),
    evicted: evictedFacts.length,
    evictedRecoverable: recoverableEvicted,
    evictedPointerOnly: pointerOnlyEvicted,
    byDay: Object.fromEntries([...evictedFactsByDay.entries()].sort((a, b) => a[0] - b[0])),
  },
  prunedByLayer: last.memory.prunedByLayer,
  digest: (() => {
    const bytes = Buffer.byteLength(JSON.stringify(digests), 'utf8');
    const budget = DEFAULT_MEMORY_CONFIG.libraryBudget.digests;
    const perDay = new Map<number, number>();
    for (const digest of digests) perDay.set(digest.day, (perDay.get(digest.day) ?? 0) + 1);
    return {
      count: digests.length,
      bytes,
      countBudget: budget.count,
      bytesBudget: budget.bytes,
      countPercent: digests.length / budget.count,
      bytesPercent: bytes / budget.bytes,
      compactCount: digests.filter((digest) => digest.compact).length,
      fullCount: digests.filter((digest) => !digest.compact).length,
      maxPerDay: Math.max(0, ...perDay.values()),
      maxAnomalies: Math.max(0, ...digests.map((digest) => digest.anomalies.length)),
      coveredDays: perDay.size,
      firstDay: digests.length === 0 ? -1 : Math.min(...digests.map((digest) => digest.day)),
      lastDay: digests.length === 0 ? -1 : Math.max(...digests.map((digest) => digest.day)),
    };
  })(),
  legend: {
    count: legends.length,
    bytes: legendBytes,
    countBudget: DEFAULT_MEMORY_CONFIG.libraryBudget.legends.count,
    countPercent: legends.length / DEFAULT_MEMORY_CONFIG.libraryBudget.legends.count,
    bytesBudget: DEFAULT_MEMORY_CONFIG.libraryBudget.legends.bytes,
    bytesPercent: legendBytes / DEFAULT_MEMORY_CONFIG.libraryBudget.legends.bytes,
    formedDay: { min: Math.min(...legends.map((legend) => legend.formedDay)), max: Math.max(...legends.map((legend) => legend.formedDay)) },
    reach: Object.fromEntries([...legendReach.entries()].sort((a, b) => a[0] - b[0])),
    evicted: evictedLegends.length,
    evictedFormedDay: {
      min: Math.min(...evictedLegends.map((legend) => legend.formedDay)),
      max: Math.max(...evictedLegends.map((legend) => legend.formedDay)),
    },
    evictedReach: Object.fromEntries([...evictedLegendReach.entries()].sort((a, b) => a[0] - b[0])),
    evictedSample: evictedLegends.slice(0, 5),
  },
  backfill,
  evictedFactSample: sampleEvicted,
};

writeFileSync(join(dir, `retrospect-${days}d.json`), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

console.log(`[${seed}] ${days} 日回溯审计，用时 ${elapsed.toFixed(1)}s`);
console.log(`  存档 ${saveKB.toFixed(1)}KB（${(saveKB / 1024 / 2 * 100).toFixed(1)}% of 2MB），第 60→90 天 ${last30KbPerDay.toFixed(2)}KB/天`);
console.log(`  facts ${facts.length}/${summary.days.at(-1)!.worldEvents} = ${(audit.facts.ratio * 100).toFixed(1)}%，淘汰 ${evictedFacts.length}，可找回指针 ${recoverableEvicted}（其中仅摘要指针 ${pointerOnlyEvicted}）`);
for (const row of backfill as Record<string, number>[]) {
  console.log(
    `  第${row.day}天 事件${row.worldEvents} 事实${row.factsAlive}/${row.factsWritten}(${(row.factsMissingPct * 100).toFixed(1)}%缺) 时间轴${row.timelineAlive}/${row.timelineAtClose}(${(row.timelineMissingPct * 100).toFixed(1)}%缺) 事件可追溯${row.eventsReachable}(${(row.eventsMissingPct * 100).toFixed(1)}%缺)`,
  );
}
for (const item of audit.evictedFactSample) {
  console.log(`  淘汰样本 ${item.eventId} 第${item.factDay + 1}天 ${item.kind} hint=${item.importanceHint} 可找回=${item.recoverable}`);
}
console.log(`  digest ${audit.digest.count} 条（全量 ${audit.digest.fullCount} / 浓缩 ${audit.digest.compactCount}），${(audit.digest.bytes / 1024).toFixed(1)}KB/${(audit.digest.bytesBudget / 1024).toFixed(0)}KB = ${(audit.digest.bytesPercent * 100).toFixed(1)}%，覆盖 ${audit.digest.coveredDays} 天，每天最多 ${audit.digest.maxPerDay} 条 / 异常最多 ${audit.digest.maxAnomalies} 条`);
console.log(`  legend ${legends.length}/${audit.legend.countBudget} = ${(audit.legend.countPercent * 100).toFixed(1)}%，${(legendBytes / 1024).toFixed(1)}KB/${(audit.legend.bytesBudget / 1024).toFixed(0)}KB = ${(audit.legend.bytesPercent * 100).toFixed(1)}%，淘汰 ${evictedLegends.length}`);
