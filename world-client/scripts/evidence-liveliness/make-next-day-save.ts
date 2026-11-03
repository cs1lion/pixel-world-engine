/**
 * 生成一张「第 0 天淋过雨、现在第 1 天 13:00」的存档，给面板截图用。
 * 存档本身不提交（几十 MB 的记忆快照），截图脚本会现场读它。
 *
 * 跑法（在 `world-client/` 下）：node scripts/evidence-liveliness/make-next-day-save.ts
 */

import { writeFileSync } from 'node:fs';
import { Simulation } from '../../src/world/simulation.ts';
import { selectSetting, worldForSetting, routineProfiles } from '../../src/settings/index.ts';
import { MemoryRuntime } from '../../src/world/memory/runtime.ts';
import { observationOf } from '../../src/world/memory/observe.ts';
import { weatherWitnessGroups } from '../../src/world/weather-witness.ts';
import type { WorldChange } from '../../src/world/world-changes.ts';

const PACK = selectSetting('?world=dengchao');
const world = worldForSetting(PACK);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const STALLS = PACK.scenery.filter((item) => item.kind === 'stall').map((item) => item.at);
const LOOKUPS = {
  atOfHolder: () => undefined,
  atOfBuilding: () => undefined,
  buildingOfTask: () => undefined,
};

const memory = new MemoryRuntime({ worldId: PACK.id, occlusion: { isWalkable: () => true } });
let serial = 0;
const sim = new Simulation({
  grid: world.grid,
  buildings: world.buildings,
  altar: world.altar,
  villagerName: PACK.villagers[0]!.name,
  villagerNames: PACK.villagers.map((villager) => villager.name),
  villagerProfiles: routineProfiles(PACK),
  blueprints: PACK.blueprints,
  authored: true,
  worldSeed: PACK.id,
  weatherCycle: true,
  weatherHabit: true,
  stallsAt: STALLS,
  onChange: (change: WorldChange, at: number) => {
    if (change.change !== 'weather') return;
    const snapshot = sim.snapshot();
    const people = snapshot.villagers.map((villager) => ({
      id: villager.id,
      cell: { x: Math.round(villager.pos.x), y: Math.round(villager.pos.y) },
      visible: villager.visible,
    }));
    const groups = weatherWitnessGroups(people, STALLS);
    for (const [index, group] of groups.entries()) {
      serial += 1;
      const observation =
        index === 0
          ? observationOf(change, `save-${serial}`, LOOKUPS, group.at)
          : observationOf(change, `save-${serial}`, LOOKUPS, group.at);
      if (observation !== null) memory.observe({ ...observation, at: group.at }, group.witnesses, at);
    }
  },
});

let snapshot = sim.snapshot();
memory.syncHolders(
  snapshot.villagers.map((villager) => ({
    holderId: villager.id,
    type: 'character' as const,
    at: { x: villager.pos.x, y: villager.pos.y },
  })),
);

const target = DAY + 13 * HOUR;
while (sim.now < target) {
  sim.update(Math.min(2000, target - sim.now));
  snapshot = sim.snapshot();
  memory.syncHolders(
    snapshot.villagers.map((villager) => ({
      holderId: villager.id,
      type: 'character' as const,
      at: { x: villager.pos.x, y: villager.pos.y },
    })),
  );
  memory.tick(snapshot.now);
}

const save = sim.toSave(memory.toJSON());
writeFileSync('tmp/next-day-save.json', JSON.stringify(save), 'utf8');

const names = new Map(snapshot.villagers.map((villager) => [villager.id, villager.name]));
for (const villager of snapshot.villagers) {
  const entries = (memory.viewOf(villager.id)?.memories ?? []).filter(
    (entry) => entry.createdDay === 0 && entry.sourceMode === 'witnessed' && entry.content.what.includes('雨') && entry.content.valence < 0,
  );
  if (entries.length > 0) console.log(`${names.get(villager.id)} 第 0 天雨记忆 ${entries.length} 条，最强 ${entries[0]!.strength.toFixed(3)}`);
}
console.log(`存档已写 tmp/next-day-save.json，now=第 ${Math.floor(snapshot.now / DAY)} 天 ${Math.round((snapshot.now % DAY) / HOUR)}:00，记忆 ${memory.toJSON().length} 字符`);
