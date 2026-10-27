/**
 * 走着的时候，牌子不许说「到了之后」的那句话。
 *
 * 这一条守的不是边角。默认世界里跑起来，坐标在动的拍远多于站着带牌子的拍——
 * 下面 `moved > stillLabelled` 就把这件事钉住，所以「多数时刻她都在往某处走，
 * 而牌子说她已经站在那儿了」是这个世界的常态，不是偶发。
 * （早先这里写着「76.1%」「16248 拍」四个数，是一次性探针量出来的。探针删了
 *   之后四个数一个都复算不出来，而它们正是本条最容易被当成边角的原因——
 *   所以换成一条断言：要这个比例，跑一遍看两条计数就有了。）
 *
 * 假的意思是**可复算的**：牌子说她站在某处，而她的坐标这一拍动了。所以判据
 * 不需要摸世界内部——拿相邻两拍的坐标比一下就知道。这也是本条不用 `path`
 * 当观察口的原因：快照里没有它，而为了能测它给快照加一个字段，是让生产代码
 * 迁就测试。
 *
 * `simulation.ts` 里早就为同一件事立过规矩：`sheltering` 出发时挂「跑向屋檐下
 * 躲雨」、`path` 空掉那一刻换成「在屋檐下看雨」，旁边写着「写『跑到屋檐下』
 * 就是断言她已经到了——她半步还没动」。作息这条路漏了，本条把它堵上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { routineBeats } from '../src/world/routines.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

const world = buildWorld(blueprints);

function makeSim(): Simulation {
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

/**
 * 所有「到了之后」的说法。**独立枚举，不问被测代码要。**
 *
 * 节拍表里那四句是数据，直接读；天气合成的四句在 `routineFor` 里是字面量，
 * 所以在这儿照抄——照抄正是为了让它成为一份独立的凭据：哪天有人在
 * `routineFor` 里添一句新的落脚说法而忘了配赶路的说法，这条会红，逼他回去
 * 把两只配齐。反过来问 `routineFor` 要这份集合，新句子会自动进集合，这条
 * 就再也红不了了。
 */
const ARRIVAL = new Set<string>([
  ...routineBeats(ALTAR, world.grid).map((beat) => beat.label),
  '缩进屋檐下躲暴雨',
  '躲到屋檐下看雨',
  '在祭坛边缩着等暴雨过去',
  '在祭坛边看雨',
]);

const TICKS = 60 * 180;

interface Survey {
  /** 坐标动了的拍数——她在赶路。 */
  readonly moved: number;
  /** 坐标没动、而牌子有值的拍数——她真在某处站着。 */
  readonly stillLabelled: number;
  /** 赶路时牌子说着落脚那句的处数。这条要为零。 */
  readonly walkingLies: readonly string[];
  /** 赶路时牌子整个是空的处数。把牌子收走也一样是假，这条也要为零。 */
  readonly walkingSilent: readonly string[];
  /** 站着时牌子不说落脚那句的处数。 */
  readonly standingWrong: readonly string[];
}

/**
 * 牌子在**这一拍开始时的样子**，与这一拍有没有走动，一起看。
 *
 * 必须先取样再 `update`：到了的那一拍她也动了（最后一步走完，`path` 空掉，
 * 牌子在同一拍换成落脚那句）。事后取样的话，那一拍会同时「动了」又「说着
 * 落脚那句」——而那是真的到了，不是假。事前取样问的是「她动身时嘴上说的是
 * 什么」，那才是屏上演给她看的那句话。
 */
function survey(sim: Simulation): Survey {
  const before = new Map(sim.snapshot().villagers.map((v) => [v.id, { pos: { ...v.pos }, routine: v.routine }]));
  const walkingLies: string[] = [];
  const walkingSilent: string[] = [];
  const standingWrong: string[] = [];
  let moved = 0;
  let stillLabelled = 0;

  for (let t = 0; t < TICKS; t += 1) {
    sim.update(16);
    for (const villager of sim.snapshot().villagers) {
      const was = before.get(villager.id)!;
      const isMoving = villager.pos.x !== was.pos.x || villager.pos.y !== was.pos.y;
      const label = was.routine;
      before.set(villager.id, { pos: { ...villager.pos }, routine: villager.routine });
      if (isMoving) {
        moved += 1;
        if (label === null) walkingSilent.push(`t=${t} ${villager.name}`);
        else if (ARRIVAL.has(label)) walkingLies.push(`t=${t} ${villager.name}「${label}」`);
        continue;
      }
      if (label === null) continue;
      stillLabelled += 1;
      if (!ARRIVAL.has(label)) standingWrong.push(`t=${t} ${villager.name}「${label}」`);
    }
  }
  return { moved, stillLabelled, walkingLies, walkingSilent, standingWrong };
}

test('坐标动了的那些拍，牌子不是一句「已经到了」', () => {
  const seen = survey(makeSim());

  assert.ok(seen.moved > 1000, `只观察到 ${seen.moved} 拍在动，像是世界没跑起来`);
  assert.ok(
    seen.moved > seen.stillLabelled,
    `赶路 ${seen.moved} 拍却少于站着 ${seen.stillLabelled} 拍——本条守的就不再是常态`,
  );
  assert.deepEqual(
    seen.walkingSilent.slice(0, 5),
    [],
    `走着却什么都没说的拍有 ${seen.walkingSilent.length} 个——把牌子整个收走，与说错地方是同一种假`,
  );
  assert.deepEqual(
    seen.walkingLies.slice(0, 5),
    [],
    `走着却说着到了之后的话，共 ${seen.walkingLies.length} 处：\n${seen.walkingLies.slice(0, 5).join('\n')}`,
  );
});

test('不动的拍才说「已经到了」，而且说得出是哪儿', () => {
  const seen = survey(makeSim());

  assert.ok(seen.stillLabelled > 1000, `只观察到 ${seen.stillLabelled} 拍站着带牌子，这条什么都没验`);
  assert.deepEqual(
    seen.standingWrong.slice(0, 5),
    [],
    `站着却不说落脚的那句，共 ${seen.standingWrong.length} 处：\n${seen.standingWrong.slice(0, 5).join('\n')}`,
  );
});
