/**
 * 第 3 轮第 3 条（天气事件进记忆 + 影响次日行为）的可测读数。
 *
 * 跑法（在 `world-client/` 下）：
 *   node scripts/evidence-liveliness/evidence-weather-memory.ts > ../docs/evidence/liveliness/evidence-weather-memory.txt
 *
 * 五组数：
 *  1. 雨天目击：同一场雨里，灯街 6 格内的人入账、镇外的人不入；
 *  2. 有/无记忆对照：昨天淋过雨的摊主今天 13:00 提前盖布，关掉记忆则不盖；
 *  3. 逐日衰减：用「第 0 天有雨、之后几天不再下雨」的种子，看同一条记忆
 *     的强度怎么掉、掉到门槛 0.75 以下的那天行为怎么停；
 *  4. 两个种子的次日行为对照（不同天气序列 → 不同的目击者 → 不同的盖布人数）；
 *  5. 同基线两次逐项相同。
 */

import { Simulation } from '../../src/world/simulation.ts';
import { selectSetting, worldForSetting, routineProfiles } from '../../src/settings/index.ts';
import { MemoryRuntime } from '../../src/world/memory/runtime.ts';
import { observationOf } from '../../src/world/memory/observe.ts';
import { weatherWitnessGroups, WEATHER_WITNESS_CELLS } from '../../src/world/weather-witness.ts';
import { WEATHER_HABIT_MIN_STRENGTH } from '../../src/world/weather-witness.ts';
import { weatherSequence } from '../../src/world/weather-cycle.ts';
import { WEATHER_LABEL } from '../../src/world/weather.ts';
import type { WorldChange } from '../../src/world/world-changes.ts';

const PACK = selectSetting('?world=dengchao');
const world = worldForSetting(PACK);
const DAY = 24 * 60 * 60 * 1000;
const STALLS = PACK.scenery.filter((item) => item.kind === 'stall').map((item) => item.at);
const LOOKUPS = {
  atOfHolder: () => undefined,
  atOfBuilding: () => undefined,
  buildingOfTask: () => undefined,
};

/** 基线种子：默认设定集。 */
const BASE_SEED = 'dengchao';
/** 第 0 天只有 4:00 一场雨、之后几天不再下雨的种子（扫 3 万个种子里挑出的）。 */
const DECAY_SEED = 'seed-6682';
/** 第 0 天只有 12:00 一场雨、目击集合更小的种子。 */
const CONTRAST_SEED = 'seed-14054';

function namesOf(sim: Simulation): Map<string, string> {
  return new Map(sim.snapshot().villagers.map((villager) => [villager.id, villager.name]));
}

interface RainRecord {
  readonly at: number;
  readonly weather: string;
  readonly groups: readonly { at: { x: number; y: number }; witnesses: readonly string[] }[];
}

/** 从记忆层挑出「昨天淋过雨、还是负价、且是亲眼所见」的那条，译成世界能用的账。 */
function ledgerOf(memory: MemoryRuntime, sim: Simulation) {
  const today = memory.day;
  const ledger = [];
  for (const villager of sim.snapshot().villagers) {
    let best: { villagerId: string; strength: number; day: number } | null = null;
    for (const entry of memory.viewOf(villager.id)?.memories ?? []) {
      if (entry.createdDay >= today) continue;
      // 传闻也会把「雨落下来了」带进不在场者的记忆，但「听说」不是「淋到」。
      if (entry.sourceMode !== 'witnessed') continue;
      if (!entry.content.what.includes('雨')) continue;
      if (entry.content.valence >= 0) continue;
      const item = { villagerId: villager.id, strength: entry.strength, day: entry.createdDay };
      if (best === null || item.strength > best.strength) best = item;
    }
    if (best !== null) ledger.push(best);
  }
  return { today, ledger };
}

/** onChange 只能在构造时给；这个 hook 把每一场雨换算成目击组。 */
function simWithRainHook(
  seed: string,
  habit: boolean,
  hook: (change: { at: number; weather: string }) => void,
): Simulation {
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: PACK.villagers[0]!.name,
    villagerNames: PACK.villagers.map((villager) => villager.name),
    villagerProfiles: routineProfiles(PACK),
    blueprints: PACK.blueprints,
    authored: true,
    worldSeed: seed,
    weatherCycle: true,
    weatherHabit: habit,
    stallsAt: STALLS,
    onChange: (change: WorldChange, at: number) => {
      if (change.change === 'weather') hook({ at, weather: change.weather });
    },
  });
}

function stepDay(sim: Simulation): void {
  const target = sim.now + DAY;
  while (sim.now < target) {
    sim.update(Math.min(2000, target - sim.now));
  }
}

function peopleOf(sim: Simulation) {
  return sim.snapshot().villagers.map((villager) => ({
    id: villager.id,
    cell: { x: Math.round(villager.pos.x), y: Math.round(villager.pos.y) },
    visible: villager.visible,
  }));
}

console.log(`== 1. 雨天目击：灯街 ${WEATHER_WITNESS_CELLS} 格内入账，镇外不入 ==`);
for (const seed of [BASE_SEED, CONTRAST_SEED]) {
  const records: RainRecord[] = [];
  const changes: { at: number; weather: string; actorId: null }[] = [];
  const sim = simWithRainHook(seed, true, (change) => {
    // 天气 change 不带 actorId：镇级事件按 null 计（个人记忆只按目击分组另写）。
    changes.push({ at: change.at, weather: change.weather, actorId: null });
    if (change.weather !== 'rain' && change.weather !== 'storm') return;
    records.push({ at: change.at, weather: change.weather, groups: weatherWitnessGroups(peopleOf(sim), STALLS) });
  });
  stepDay(sim);
  const names = namesOf(sim);
  const allIds = sim.snapshot().villagers.map((villager) => villager.id);
  const union = new Set<string>();
  for (const record of records) {
    for (const group of record.groups) for (const id of group.witnesses) union.add(id);
    console.log(
      `${seed} 第 ${Math.floor(record.at / DAY)} 天 ${Math.round((record.at % DAY) / 3600000)}:00 ${WEATHER_LABEL[record.weather]}：入账 ${
        new Set(record.groups.flatMap((group) => group.witnesses)).size
      }/${allIds.length}（${[
        ...new Set(record.groups.flatMap((group) => group.witnesses)),
      ].map((id) => names.get(id) ?? id).join('、') || '无'}）`,
    );
  }
  console.log(
    `${seed} 全天入账并集 ${union.size}/${allIds.length}；不在灯街：${
      allIds.filter((id) => !union.has(id)).map((id) => names.get(id) ?? id).join('、') || '无'
    }`,
  );
  const logged = sim
    .recentEvents(120)
    .filter((event) => /^[晴雨雾暴]/.test(event.text) && event.text.endsWith('天。'))
    .map((event) => event.text);
  console.log(
    `${seed} 镇级天气 change ${changes.length} 条，actorId=${
      changes.map((change) => String(change.actorId)).join('/') || '无'
    }（weather 不带 actorId，按 null 计）；日志：${logged.join('、') || '无'}`,
  );
}

console.log('\n== 2. 有/无记忆：次日 13:00 提前盖布 ==');

/** 跑完第 0 天并把账交下去的起点；衰减表也从这里接着跑。 */
function dayZero(seed: string, withMemory: boolean) {
  // 有记忆：先跑第 0 天并写记忆，再带着账跑第 1 天。
  // 无记忆：同一台世界的孪生实例，只关掉记忆这一路，行为到日界为止逐项相同。
  const memory = new MemoryRuntime({ worldId: `wm-${seed}`, occlusion: { isWalkable: () => true } });
  let serial = 0;
  const sim = simWithRainHook(seed, withMemory, (change) => {
    if (change.weather !== 'rain' && change.weather !== 'storm') return;
    const groups = weatherWitnessGroups(peopleOf(sim), STALLS);
    for (const group of groups) {
      serial += 1;
      const observation = observationOf(
        { change: 'weather', weather: change.weather },
        `wm-${seed}-${serial}`,
        LOOKUPS,
        group.at,
      );
      if (observation !== null) memory.observe({ ...observation, at: group.at }, group.witnesses, change.at);
    }
  });
  if (withMemory) {
    memory.syncHolders(
      sim.snapshot().villagers.map((villager) => ({
        holderId: villager.id,
        type: 'character' as const,
        at: { x: villager.pos.x, y: villager.pos.y },
      })),
    );
  }
  stepDay(sim); // 第 0 天
  if (withMemory) memory.tick(DAY);
  const ledger = ledgerOf(memory, sim);
  sim.setWeatherHabitLedger(withMemory ? ledger.ledger : []);
  const names = namesOf(sim);
  return { sim, memory, ledger, names, before: sim.weatherHabitStats() };
}

function dayOne(seed: string, withMemory: boolean) {
  const base = dayZero(seed, withMemory);
  if (withMemory) {
    console.log(
      `账：${base.ledger.ledger
        .map((item) => `${base.names.get(item.villagerId) ?? item.villagerId} ${item.strength.toFixed(3)}（第 ${item.day} 天）`)
        .join('、')}`,
    );
    const heardOnly: string[] = [];
    for (const villager of base.sim.snapshot().villagers) {
      const entries = (base.memory.viewOf(villager.id)?.memories ?? []).filter(
        (entry) => entry.content.what.includes('雨') && entry.content.valence < 0,
      );
      if (entries.some((entry) => entry.sourceMode === 'heard') && !entries.some((entry) => entry.sourceMode === 'witnessed')) {
        heardOnly.push(base.names.get(villager.id) ?? villager.id);
      }
    }
    console.log(
      `另有 ${heardOnly.length} 人只有「听说」的雨记忆，不进习惯：${heardOnly.join('、') || '无'}`,
    );
  }
  stepDay(base.sim); // 次日的 24 小时
  const stats = base.sim.weatherHabitStats();
  const acted = stats.people.filter((person) => person.preCoveredDay !== null).length;
  console.log(
    `${withMemory ? '有记忆' : '无记忆'}：次日提前盖布 ${acted} 人 / 累计 ${stats.preCovers} 次（13:00 后）；账上过门槛 ${base.before.people.filter((p) => p.applies).length} 人`,
  );
  return { ...base, stats };
}

const baseWith = dayOne(BASE_SEED, true);
const baseWithout = dayOne(BASE_SEED, false);
console.log(
  `逐个：${baseWith.stats.people
    .filter((person) => person.preCoveredDay !== null)
    .map((person) => `${baseWith.names.get(person.villagerId) ?? person.villagerId}@第${person.preCoveredDay}天`)
    .join('、') || '无'}`,
);

console.log(`\n== 3. 逐日衰减（${DECAY_SEED}：第 0 天 4:00 一场雨，之后不再下雨） ==`);
{
  const { sim, memory } = dayZero(DECAY_SEED, true);
  const tracked = new Map<string, string>();
  for (const villager of sim.snapshot().villagers) {
    let best: { id: string; strength: number } | null = null;
    for (const entry of memory.viewOf(villager.id)?.memories ?? []) {
      if (entry.createdDay !== 0 || entry.sourceMode !== 'witnessed') continue;
      if (!entry.content.what.includes('雨') || entry.content.valence >= 0) continue;
      if (best === null || entry.strength > best.strength) best = { id: entry.memoryId, strength: entry.strength };
    }
    if (best !== null) tracked.set(villager.id, best.id);
  }
  console.log(`跟踪第 0 天那场雨的 ${tracked.size} 条记忆：`);
  for (const day of [1, 2, 3, 4]) {
    const ledger = ledgerOf(memory, sim);
    sim.setWeatherHabitLedger(ledger.ledger);
    const strengths = ledger.ledger.map((item) => item.strength);
    const low = strengths.length === 0 ? 0 : Math.min(...strengths);
    const high = strengths.length === 0 ? 0 : Math.max(...strengths);
    const before = sim.weatherHabitStats().preCovers;
    stepDay(sim);
    const stats = sim.weatherHabitStats();
    const todayCovered = stats.people.filter((person) => person.preCoveredDay === day).length;
    console.log(
      `第 ${day} 天：账上 ${ledger.ledger.length} 人，强度 ${
        strengths.length === 0 ? '—' : `${low.toFixed(4)}${low === high ? '' : `..${high.toFixed(4)}`}`
      }；门槛 ${WEATHER_HABIT_MIN_STRENGTH} → 还够 ${
        ledger.ledger.filter((item) => item.strength >= WEATHER_HABIT_MIN_STRENGTH).length
      } 人；当天 13:00 后盖布 ${todayCovered} 人（累计 +${stats.preCovers - before}）`,
    );
    memory.tick((day + 1) * DAY); // 日终衰减
    const after = [...tracked.entries()]
      .map(([villagerId, id]) => memory.viewOf(villagerId)?.memories.find((entry) => entry.memoryId === id)?.strength ?? null)
      .filter((value): value is number => value !== null);
    if (after.length > 0) {
      const lowAfter = Math.min(...after);
      const highAfter = Math.max(...after);
      console.log(
        `      日终之后同一条：${lowAfter.toFixed(4)}${lowAfter === highAfter ? '' : `..${highAfter.toFixed(4)}`}（${after.length} 条）`,
      );
    }
  }
}

console.log('\n== 4. 两个种子的次日行为对照 ==');
{
  const b = dayOne(CONTRAST_SEED, true);
  const seqA = weatherSequence(BASE_SEED, 12).map((kind) => WEATHER_LABEL[kind]).join(' ');
  const seqB = weatherSequence(CONTRAST_SEED, 12).map((kind) => WEATHER_LABEL[kind]).join(' ');
  console.log(`${BASE_SEED} 前 12 槽：${seqA}`);
  console.log(`${CONTRAST_SEED}    前 12 槽：${seqB}`);
  const actedOf = (stats: typeof baseWith.stats) =>
    stats.people.filter((person) => person.preCoveredDay !== null).length;
  console.log(`次日提前盖布：${BASE_SEED} ${actedOf(baseWith.stats)} 人 / ${CONTRAST_SEED} ${actedOf(b.stats)} 人`);
  console.log(
    `${BASE_SEED} 盖布的人：${baseWith.stats.people
      .filter((p) => p.preCoveredDay !== null)
      .map((p) => baseWith.names.get(p.villagerId) ?? p.villagerId)
      .join('、') || '无'}`,
  );
  console.log(
    `${CONTRAST_SEED} 盖布的人：${b.stats.people
      .filter((p) => p.preCoveredDay !== null)
      .map((p) => b.names.get(p.villagerId) ?? p.villagerId)
      .join('、') || '无'}`,
  );
  console.log(
    `无记忆对照（${CONTRAST_SEED}）：${dayOne(CONTRAST_SEED, false).stats.preCovers} 次`,
  );
}

console.log('\n== 5. 同基线两次逐项相同 ==');
{
  const runTwice = () => {
    const result = dayOne(DECAY_SEED, true);
    return JSON.stringify({
      villagers: result.sim
        .snapshot()
        .villagers.map((villager) => [villager.id, villager.pos.x, villager.pos.y, villager.mode]),
      weather: result.sim.snapshot().weather,
      habit: result.stats,
    });
  };
  const one = runTwice();
  const two = runTwice();
  console.log(`同基线两次逐项相同：${one === two ? '是' : '否'}（${one.length} 字符）`);
}
