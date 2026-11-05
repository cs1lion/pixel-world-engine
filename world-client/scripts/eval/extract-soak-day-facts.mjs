#!/usr/bin/env node
/**
 * 把 pwe-soak 的 90 天证据投影成回溯问答用的小 fixture（不复制整份存档）。
 *
 *   node world-client/scripts/eval/extract-soak-day-facts.mjs \
 *     --save D:/project/pwe-soak/docs/evidence/soak/soak-a/save-90d.json \
 *     --summary D:/project/pwe-soak/docs/evidence/soak/soak-a/summary-90d.json \
 *     --source-commit <pwe-soak HEAD> \
 *     --out world-client/fixtures/eval-soak-day-facts.json
 *
 * 只保留第 20/45/60/89 天：天气 + 事实（eventId/day/tick/kind/placeId/actors/witnesses/what）。
 * 完整存档留在 pwe-soak 证据树，不进本分支；这里只留可复算的最小投影。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const savePath = args.get('--save');
const summaryPath = args.get('--summary');
const outPath = args.get('--out');
const sourceCommit = args.get('--source-commit');
const days = (args.get('--days') ?? '20,45,60,89').split(',').map((day) => Number(day));

if (savePath === undefined || summaryPath === undefined || outPath === undefined ||
  sourceCommit === undefined) {
  console.error('缺参数：--save / --summary / --source-commit / --out');
  process.exit(2);
}

const saveBytes = readFileSync(resolve(savePath));
const summaryBytes = readFileSync(resolve(summaryPath));
const save = JSON.parse(saveBytes.toString('utf8'));
const summary = JSON.parse(summaryBytes.toString('utf8'));
const memory = typeof save.world.memory === 'string'
  ? JSON.parse(save.world.memory)
  : save.world.memory;
const facts = (memory.world.facts ?? []).map((fact) => ({
  eventId: fact.eventId,
  day: fact.day,
  tick: fact.tick,
  kind: fact.kind,
  placeId: fact.placeId,
  actors: [...fact.actors],
  witnesses: [...(fact.witnesses ?? [])],
  what: fact.outcome?.what ?? '',
}));

const projectedDays = days.map((day) => {
  const dayFacts = facts.filter((fact) => fact.day === day)
    .sort((left, right) => left.tick - right.tick);
  const summaryDay = summary.days?.[day] ?? {};
  return {
    day,
    weather: summaryDay.weather ?? 'not_measured',
    worldEvents: summaryDay.events?.worldEvents ?? null,
    memoryHolders: summaryDay.memory?.holders ?? null,
    facts: dayFacts,
  };
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = {
  schema: 'eval-soak-day-facts/1',
  provenance: {
    sourceTree: 'pwe-soak',
    sourceCommit,
    saveFile: `docs/evidence/soak/soak-a/${basename(savePath)}`,
    saveSha256: sha256(saveBytes),
    summaryFile: `docs/evidence/soak/soak-a/${basename(summaryPath)}`,
    summarySha256: sha256(summaryBytes),
    note: '完整存档不复制进本分支；fixture 只是第 20/45/60/89 天的可复算投影',
  },
  days: projectedDays,
};

writeFileSync(resolve(outPath), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`days=${days.join(',')} facts=${projectedDays.map((day) => day.facts.length).join('/')} ` +
  `bytes=${JSON.stringify(fixture).length} out=${outPath}`);
