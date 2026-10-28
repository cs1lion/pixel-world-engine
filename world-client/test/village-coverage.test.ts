/**
 * 村里几个人——以及 §3.2 B 的 `coverage_curve` 在今天连**分母都没有定**。
 *
 * ## 为什么要有这个文件
 *
 * §3.2 B 的五条评测指标里，`coverage_curve` 是**唯一一条全仓没有任何测量的**：
 * 它只作为一句话出现在 `src/world/memory/world.ts:516`（「同一件事在村里有两个
 * 版本同时流传，正是协议想避免的那种重复」）与 `src/world/memory/propagate.ts:450`
 * 的注释里，两个地方都是拿它当论据，不是拿它当指标。没有测试、没有探针、没有 eval。
 *
 * 它要的三个数是这样的（`docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md:150`）：
 *
 * | 时点 | 目标 |
 * | --- | --- |
 * | 第 1 天末 | 知晓比例 `≤ 35%`，严禁 100% 全知 |
 * | 第 3 天末 | 达到稳态 `60% ~ 80%` |
 *
 * ## 这个文件第一版写错了一件事，更正记在这儿
 *
 * 第一版（`635a169`）的结论是「村里只有两个人，所以 `60% ~ 80%` 一个值都取不到」。
 * **那句是拿一个没定下来的分母当既成事实。** 「村落中的知晓比例」的分母可以指
 * **村民**，也可以指**全部 holder**——而楼是 holder，楼也真的会持有信念
 * （本条第二个测试量这件事）。两种分母在同一次运行上给出**相反的判定**：
 *
 * | 时点 | 只算村民（分母 2） | 算全部 holder（分母 8） | 目标 | 谁达标 |
 * | --- | --- | --- | --- | --- |
 * | 第 1 天末 | **100%** | **25%** | ≤ 35% | 只有全部-holder 达标 |
 * | 第 3 天末 | 100% | 50% | 60% ~ 80% | 两个都不达标（一个超高、一个偏低） |
 * | 第 6 天末 | 100% | 63% | — | 全部-holder 落进区间里了 |
 *
 * 所以真正的缺陷不是「指标达不到」，而是**分母没有定义，而两种定义让同一次运行
 * 一个通过一个不通过**。在这个定下来之前，`coverage_curve` 既不能算达标，
 * 也不能算不达标——它量的还不是一个数。
 *
 * ## 今天量出来（2026-10-28）
 *
 * 出货的村子：**两个居民 + 六栋楼 = 八个 holder**。
 *
 * - 居民两个：`src/world/simulation.ts:658` 的兜底是
 *   `[deps.villagerName, DEFAULT_ASSISTANT_NAME]`；灯潮界设定集
 *   （`src/settings/dengchao/pack.ts:135`）是迷路人与汐，两条。两条路都是 2。
 * - 楼六栋：`pack.ts:103` 的 `placements` 六条。默认世界那边是十一栋
 *   （`src/main.ts:44` 走 `buildLargeWorld`，`test/large-world.test.ts:142` 钉住 11）。
 *
 * **没有任何东西钉住「几个居民、几栋楼」这组数**，而 `coverage_curve` 的分母、
 * `legendHolders` 的门槛、`maxFanout` 的天花板全是它的函数。这个文件就是那道闸。
 *
 * ## 这一条**不**查什么
 *
 * - **不裁分母该选哪个。** 选村民、选全部 holder、或者给楼单开一个不进分母的
 *   口径——三种都是设计决定，而这个决定该由定 §3.2 B 的人做。这个文件只保证
 *   「两种口径各是多少」有人盯着，并且让「没人定过分母」这件事有红可红。
 * - **不测传播本身快不快、准不准。** 那是 `memory-spread` / `memory-reach-ceiling`
 *   那一批的事。这里只数「第 N 天末有几个 holder 知道」。
 * - **不测 `latency_ratio`。** 那条指标（公告 ≤ 0.5 天 vs 传言 1.5–2.5 天）的量是
 *   「触达半数人口的时延」，同样没有分母定义，也同样没有数字测量。本条不替它主张。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';

/** §3.2 B 的 `coverage_curve` 目标，三个数都从定稿表来。 */
const DAY1_CEILING = 35;
const DAY3_LOW = 60;
const DAY3_HIGH = 80;

const DAY_MS = DEFAULT_MEMORY_CONFIG.dayMs;
const TALK_DISTANCE = DEFAULT_MEMORY_CONFIG.talkDistance;

/** 出货的那份设定集，和它落成的世界。都是真的，不是替身。 */
const PACK = loadSettingPack(DENGCHAO_RAW);
const WORLD = buildSettingWorld(PACK);

const VILLAGERS: readonly string[] = PACK.villagers.map((villager) => villager.name);
const BUILDING_IDS: readonly string[] = WORLD.buildings.map((building) => building.instanceId);
const ALL_HOLDERS: readonly string[] = [...VILLAGERS, ...BUILDING_IDS];

/**
 * 默认世界（不走设定集）会有几个村民。
 *
 * 从 `simulation.ts:658` 那一行读，不重抄：那个兜底数组的字面量一改，
 * 这里必须跟着改，否则这条钉的是一个已经不属于代码的数。
 */
function defaultWorldVillagerCount(): number {
  const text = readFileSync(new URL('../src/world/simulation.ts', import.meta.url), 'utf8');
  const line = text.split('\n').find((row) => row.includes('const names = deps.villagerNames'));
  assert.ok(line !== undefined, 'simulation.ts 里找不到 `const names = deps.villagerNames` 那一行——村民名单的兜底换了写法，回来改这条判据');
  const fallback = line.match(/\[\s*deps\.villagerName\s*,\s*DEFAULT_ASSISTANT_NAME\s*\]/);
  assert.ok(fallback !== null, '默认世界的村民兜底不是 `[villagerName, DEFAULT_ASSISTANT_NAME]` 两个字面量——人数换了写法，回来改这条判据');
  return 2;
}

/** 分母为 `population` 时，「知晓比例」这个量能取到的全部值（百分数）。 */
function reachablePercents(population: number): readonly number[] {
  const out: number[] = [];
  for (let know = 0; know <= population; know += 1) out.push(Math.round((know / population) * 1000) / 10);
  return out;
}

interface Awareness {
  /** 只算村民。 */
  readonly villagers: number;
  /** 算全部 holder（村民 + 楼）。 */
  readonly all: number;
  /** 知道这事的楼有几栋。 */
  readonly knowingBuildings: number;
}

/**
 * 第 `days` 天末，一条重大事件被多少 holder 知道。
 *
 * 全部 holder 一字排开、间距 `talkDistance`——这不是偏袒传播，是把「最有利的
 * 摆法」固定住：位置是这条要控制的变量之一，换成真实作息的话，量到的就不再是
 * `coverage_curve` 的量，而是某一套作息的巧合。
 */
function awarenessAtDayEnd(days: number): Awareness {
  const rt = new MemoryRuntime({ worldId: 'coverage', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    ...VILLAGERS.map((holderId, index) => ({
      holderId,
      type: 'character' as const,
      at: { x: index * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
    ...BUILDING_IDS.map((holderId, index) => ({
      holderId,
      type: 'place' as const,
      at: { x: (index + VILLAGERS.length) * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
  ]);
  rt.observe(
    {
      eventId: 'ev_major',
      kind: 'celebration',
      placeId: BUILDING_IDS[0],
      at: { x: 0, y: 0 },
      // 一个目击者：事件的出生状态取最小，传播要负责把剩下的人送到。
      actors: [VILLAGERS[0]],
      outcome: {},
      importanceHint: 0.95,
    },
    undefined,
    1000,
  );
  for (let day = 1; day <= days; day += 1) rt.tick(day * DAY_MS);

  const knows = (holderId: string): boolean => {
    const view = rt.viewOf(holderId);
    return view !== null && view.beliefs.some((belief) => belief.eventRefs.includes('ev_major'));
  };
  const percent = (ids: readonly string[]): number =>
    Math.round((ids.filter(knows).length / ids.length) * 1000) / 10;
  return {
    villagers: percent(VILLAGERS),
    all: percent(ALL_HOLDERS),
    knowingBuildings: BUILDING_IDS.filter(knows).length,
  };
}

test('出货的村子今天八个人：两个居民 + 六栋楼', () => {
  assert.equal(VILLAGERS.length, 2, `灯潮界的居民是 ${VILLAGERS.join('、')}——加人或减人都会让 coverage_curve 的分母变，回来重算这个文件头里那张表`);
  assert.equal(BUILDING_IDS.length, 6, `灯潮界落了 ${BUILDING_IDS.length} 栋楼（pack.ts:103 的 placements 是六条）`);
  assert.equal(defaultWorldVillagerCount(), 2, '默认世界的村民兜底不再是两个');
  // 两组数合起来才是分母：设定集 8。
  assert.equal(ALL_HOLDERS.length, 8, '设定集的 holder 总数不再是八个');
  // 默认世界那边不在这一条里重建——它走 `buildLargeWorld`，十一个楼，
  // 已经由 `test/large-world.test.ts:142` 钉住。这里只把「那条钉的是同一个量」
  // 说清：它钉的是楼数，而楼数正是 coverage_curve 分母的另一半。
});

test('楼会持有信念：所以「全部 holder」不是硬凑出来的分母', () => {
  // 这一条是整个更正的支点。第一版默认了「知道某事的只有人」，而楼也在
  // spreadCandidates 的候选人里（world.ts:1651 按 holderIds() 全量枚举，
  // 不过 holder 类型），judge 也不按类型拒。量出来：六栋楼全都在说话距离内
  // 时，全都学到了一条第 0 跳的断言。
  const { knowingBuildings } = awarenessAtDayEnd(6);
  assert.ok(knowingBuildings > 0, `六栋楼里一栋都没学到——传播的听众选择变了，回来重新定 coverage_curve 的分母（它可能又变回「只有人」）`);
});

test('同一次运行，两种分母给出相反的判定', () => {
  // 第 1 天末：只算村民 100%（超过 35% 上限，不达标），算全部 holder 25%（达标）。
  const day1 = awarenessAtDayEnd(1);
  assert.equal(day1.villagers, 100, '第 1 天末、只算村民');
  assert.equal(day1.all, 25, '第 1 天末、算全部 holder');
  assert.ok(day1.villagers > DAY1_CEILING, `村民口径 ${day1.villagers}% 超过第 1 天末的 ${DAY1_CEILING}% 上限`);
  assert.ok(day1.all <= DAY1_CEILING, `全部-holder 口径 ${day1.all}% 却落在 ${DAY1_CEILING}% 上限之内——两条断言同时成立，正是「分母没定」的样子`);
});

test('比例能取到的值：村民口径三个，全部-holder 口径九个', () => {
  assert.deepEqual([...reachablePercents(VILLAGERS.length)], [0, 50, 100], '两个村民时，村民口径的知晓比例集合');
  assert.deepEqual([...reachablePercents(ALL_HOLDERS.length)], [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100], '八个 holder 时，全部-holder 口径的知晓比例集合');
  // 60%~80% 在村民口径里一个都没有，在全部-holder 口径里有两个。
  const inBandVillagers = reachablePercents(VILLAGERS.length).filter((pct) => pct >= DAY3_LOW && pct <= DAY3_HIGH);
  const inBandAll = reachablePercents(ALL_HOLDERS.length).filter((pct) => pct >= DAY3_LOW && pct <= DAY3_HIGH);
  assert.deepEqual(inBandVillagers, [], `第 3 天末的稳态目标 ${DAY3_LOW}%~${DAY3_HIGH}% 在村民口径里取不到`);
  assert.deepEqual(inBandAll, [62.5, 75], `第 3 天末的稳态目标 ${DAY3_LOW}%~${DAY3_HIGH}% 在全部-holder 口径里取得到——这条红说明 holder 总数变了，回来重算`);
});

test('实测曲线：第 1 天末 25%，第 3 天末 50%，第 6 天末 63%（全部-holder 口径）', () => {
  // 三个数都是从真实设定集的世界跑出来的，不是推演。它们盯的是传播的快慢：
  // 谁改了 talkDistance、pairCooldown、chatCooldown 或扇出，这里会动。
  assert.equal(awarenessAtDayEnd(1).all, 25, '第 1 天末');
  assert.equal(awarenessAtDayEnd(3).all, 50, '第 3 天末');
  assert.equal(awarenessAtDayEnd(6).all, 62.5, '第 6 天末');
  // 第 3 天末的 50% 低于 60% 的下限，而第 6 天末的 62.5% 落进区间里——
  // 所以「第 3 天末达到稳态」这句话今天在全部-holder 口径下是偏快的。
  const day3 = awarenessAtDayEnd(3).all;
  assert.ok(day3 < DAY3_LOW, `第 3 天末 ${day3}% 还没到 ${DAY3_LOW}% 的下限`);
});
