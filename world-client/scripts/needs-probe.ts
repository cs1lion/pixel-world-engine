#!/usr/bin/env node
/**
 * 饥饿专项证据：冻结轨迹里没人跨阈，所以另起一个短场景，把「跨阈 → 吃饭目标 →
 * 在现有摊子消费」整条链打出来。
 *
 *   node scripts/needs-probe.ts
 *
 * 只跑 `Simulation`（不进浏览器、不碰存档）：世界从第 2.8 天起，上次吃饭记在第 0 天，
 * 开局即饿；摊子取 `stallsAt` 的第一格。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { NEEDS_HUNGER_EAT_THRESHOLD, NEEDS_HUNGER_PER_DAY, needsAt } from '../src/world/needs.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(CLIENT_ROOT, '..', 'docs', 'evidence', 'needs', 'hunger-scenario.txt');

function main(): void {
  const start = Math.floor(2.8 * DAY_MS);
  const sim = new Simulation({
    grid: new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [] }),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    villagerNames: ['莞尔'],
    wallClock: () => 1000,
    initialNow: start,
    stallsAt: [{ x: 6, y: 6 }],
    villagerProfiles: [
      {
        at: { x: 2, y: 2 },
        routine: [{ id: 'promenade', label: '去街口', going: '去街口', target: { x: 8, y: 5 }, dwellMs: 300 }],
      },
    ],
  });
  const villagerId = sim.snapshot().villagers[0]!.id;
  sim.setLastMealAt(villagerId, 0);
  sim.setDecisionLogEnabled(true);

  const lines: string[] = [];
  lines.push('饥饿专项场景 —— 跨阈 → 吃饭目标 → 在现有摊子消费');
  lines.push('================================================');
  lines.push('');
  lines.push(`速率           每世界日 +${NEEDS_HUNGER_PER_DAY}（0 → 1 需 ${1 / NEEDS_HUNGER_PER_DAY} 个世界日）`);
  lines.push(`阈值           ${NEEDS_HUNGER_EAT_THRESHOLD}`);
  lines.push(`跨阈时刻       上次吃饭后 ${(NEEDS_HUNGER_EAT_THRESHOLD / NEEDS_HUNGER_PER_DAY).toFixed(1)} 个世界日`);
  lines.push(`开局           世界 ${start}（第 ${(start / DAY_MS).toFixed(2)} 天），上次吃饭记在 0`);
  lines.push(`摊子           (6, 6)；没有摊子时回落祭坛 (2, 2)`);
  lines.push('');
  const before = sim.needsOf(villagerId);
  lines.push(`开局读数       hunger=${before?.hunger.toFixed(4)} hungry=${before?.hungry}`);
  lines.push('');

  let lastHunger = before?.hunger ?? 0;
  let ateAt: number | null = null;
  for (let index = 0; index < 600 && ateAt === null; index += 1) {
    sim.update(2000);
    const reading = sim.needsOf(villagerId);
    if (reading === undefined || reading === null) break;
    const crossed =
      lastHunger < NEEDS_HUNGER_EAT_THRESHOLD && reading.hunger >= NEEDS_HUNGER_EAT_THRESHOLD;
    if (crossed) {
      lines.push(`[${sim.snapshot().now}] 跨阈   hunger=${reading.hunger.toFixed(4)}>=${NEEDS_HUNGER_EAT_THRESHOLD}`);
    }
    for (const record of sim.drainDecisions()) {
      const target = record.targetX === null ? '-' : `(${record.targetX}, ${record.targetY})`;
      lines.push(
        `[${record.now}] 决策   rule=${record.rule} goal=${record.goal} target=${target} hunger=${reading.hunger.toFixed(4)}`,
      );
    }
    if (lastHunger > 0 && reading.hunger === 0) ateAt = sim.snapshot().now;
    lastHunger = reading.hunger;
  }

  const after = sim.needsOf(villagerId);
  lines.push('');
  lines.push(`吃完时刻       ${ateAt === null ? '(尚未吃完)' : ateAt}`);
  lines.push(`吃完读数       hunger=${after?.hunger.toFixed(4)} hungry=${after?.hungry}`);
  lines.push(`打断次数       ${sim.goalInterruptCount()}（吃饭不触发打断）`);
  lines.push(`世界事件条数   ${sim.snapshot().events.length}（吃饭不新增世界事实）`);

  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.stdout.write(`\n已写入 ${OUT}\n`);
}

main();
