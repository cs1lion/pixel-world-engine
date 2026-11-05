#!/usr/bin/env node
/**
 * SOAK-BUG-5 收尾：把第 20 / 45 / 89 天面板真正会渲染的字符串打出来。
 *
 * 不另写一套格式化：走 `buildUnitStatus` 同一条路（`unit-status.ts` 的
 * `timelineLines`），再把绑定层那两行文本照原样拼出来：
 *   行首：`${clock} · ${what}`
 *   细节：`${place} · ${who} · 记忆 ${memoryId} · 事件 ${eventId}`
 *
 * 世界快照取 90 天存档（村民名字/地点名与那一天一致的部分用它的），
 * `now` 拨回目标日；记忆走 90 天真实快照。
 *
 * 用法：node scripts/soak-bug5-render.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUnitStatus, type UnitStatusWorld, type UnitTimelineLine } from '../src/ui/unit-status.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAVE = resolve(CLIENT_ROOT, '../docs/evidence/soak/soak-a/save-90d.json');
const OUT = resolve(CLIENT_ROOT, '../docs/evidence/soak/render-bug5.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = [20, 45, 89];

const save = JSON.parse(readFileSync(SAVE, 'utf8')) as {
  world: Record<string, unknown> & { memory: string };
};
const runtime = new MemoryRuntime();
runtime.fromJSON(save.world.memory);
const memory = {
  viewOf: (holderId: string) => runtime.viewOf(holderId),
  bondsOf: (holderId: string) => runtime.bondsOf(holderId),
  moodOf: (holderId: string) => runtime.moodOf(holderId),
  innerVoiceOf: (holderId: string) => runtime.innerVoiceOf(holderId),
  dayTimelineOf: (holderId: string, day: number) => runtime.dayTimelineFor(holderId, day),
};

const world = {
  now: 0,
  altar: { x: 0, y: 0 },
  villagers: save.world.villagers,
  buildings: save.world.buildings,
  tasks: save.world.tasks,
  workstations: save.world.activities ?? [],
  constructions: save.world.constructions,
} as unknown as UnitStatusWorld;

const result: Record<string, unknown> = {};

for (const day of DAYS) {
  const dayWorld: UnitStatusWorld = { ...world, now: day * DAY_MS };
  const total: UnitTimelineLine[] = [];
  for (const villager of dayWorld.villagers) {
    const view = buildUnitStatus(dayWorld, { kind: 'villager', id: villager.id }, memory);
    if (view?.today !== undefined) total.push(...view.today);
  }
  const unknownWhen = total.filter((line) => line.clock === '时刻不明').length;
  const representative = dayWorld.villagers
    .map((villager) => ({
      id: villager.id,
      name: villager.name,
      lines: buildUnitStatus(dayWorld, { kind: 'villager', id: villager.id }, memory)?.today ?? [],
    }))
    .sort((a, b) => b.lines.length - a.lines.length)[0];

  result[day] = {
    villager: representative?.name ?? null,
    rows: total.length,
    unknownWhen,
    unknownWhenPct: total.length === 0 ? 0 : unknownWhen / total.length,
    lines: (representative?.lines ?? []).map((line) => ({
      head: `${line.clock} · ${line.what}`,
      detail: `${line.place} · ${line.who} · 记忆 ${line.memoryId} · 事件 ${line.eventId}`,
    })),
  };

  console.log(`\n=== 第 ${day} 天 · ${representative?.name ?? '?'}（当天全村 ${total.length} 格，时刻不明 ${unknownWhen} 格，${(unknownWhen / Math.max(1, total.length) * 100).toFixed(1)}%）===`);
  for (const line of representative?.lines ?? []) {
    console.log(`${line.clock} · ${line.what}`);
    console.log(`    ${line.place} · ${line.who} · 记忆 ${line.memoryId} · 事件 ${line.eventId}`);
  }
}

writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`\n写入 ${OUT}`);
