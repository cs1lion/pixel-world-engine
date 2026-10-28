/**
 * 村里几个人——以及 §3.2 B 的 `coverage_curve` 在这个规模下取不取得到。
 *
 * ## 为什么要有这个文件
 *
 * §3.2 B 的五条评测指标里，`coverage_curve` 是**唯一一条全仓没有任何测量的**：
 * 它只作为一句话出现在 `src/world/memory/world.ts:516`（「同一件事在村里有两个
 * 版本同时流传，正是协议想避免的那种重复」）与 `propagate.ts:450` 的注释里，
 * 两个地方都是拿它当论据，不是拿它当指标。没有测试、没有探针、没有 eval。
 *
 * 而它要的三个数是这样的（`docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md:150`）：
 *
 * | 时点 | 目标 |
 * | --- | --- |
 * | 第 1 天末 | 知晓比例 `≤ 35%`，严禁 100% 全知 |
 * | 第 3 天末 | 达到稳态 `60% ~ 80%` |
 *
 * ## 今天量出来（2026-10-28）
 *
 * 跑真实 `MemoryRuntime`、两个村民、喂一条 `importanceHint = 0.95` 的重大事件、
 * 两人开局就站在 `talkDistance = 2` 之内：
 *
 * | 时点 | 实测 | 目标 | |
 * | --- | --- | --- | --- |
 * | 第 1 天末 | **50%** | ≤ 35% | 超了 |
 * | 第 2 天末 | 100% | — | |
 * | 第 3 天末 | **100%** | 60% ~ 80% | 超了 |
 *
 * 但**别把这个 50% / 100% 当成Bug**——它是村里只有两个人的算术后果，不是传播写错了：
 *
 * ```
 * 知晓比例的分母是村民数，而村民数是 2
 * 所以比例只能取 0% / 50% / 100%
 * ```
 *
 * `60% ~ 80%` 这个区间，**两个村民时一个值都取不到**——不是「差一点」，是集合里
 * 没有。`≤ 35%` 也好不了多少：它塌缩成「一个都不能知道」。
 *
 * ## 村民为什么是 2，这个数有谁盯着
 *
 * 两条产出路径都恰好给 2 个：
 *
 * - 默认世界：`src/world/simulation.ts:658` 的兜底是
 *   `[deps.villagerName, DEFAULT_ASSISTANT_NAME]`，两个名字。
 * - 灯潮界设定集：`src/settings/dengchao/pack.ts:135` 的 `villagers` 数组，
 *   迷路人与汐，两条。
 *
 * **没有任何东西钉住这个 2。** 谁往设定集里加第三个居民，`coverage_curve` 的
 * 分母就变了，而三条指标一条都不会响——它们本来就没有闸。这个文件就是那道闸：
 * 它钉住「今天村里几个人」，以及几个人之下 `coverage_curve` 取不取得到。
 *
 * ## 这一条**不**查什么
 *
 * - **不裁该往哪边走。** 往设定集加人、回去改 §3.2 B 的三个数、或者承认
 *   `coverage_curve` 是要靠 eval 而不是单测——三种都是设计决定。这个文件只保证
 *   「现状是多少」有人盯着：加了第三个居民它会红，改了声誉门槛它会红，
 *   而红了之后要重算的是上面那张表。
 * - **不测传播本身快不快、准不准。** 那是 `memory-spread` / `memory-reach-ceiling`
 *   那一批的事。这里只数「第 N 天末有几个人知道」。
 * - **不测 `latency_ratio`。** 那条指标（公告 ≤ 0.5 天 vs 传言 1.5–2.5 天）
 *   的量是「触达半数人口的时延」，而半数人口在两人村里是 1 个人——同一个病，
 *   另一条命。它今天也没有数字测量，本条不替它主张。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';

/** §3.2 B 的 `coverage_curve` 目标，三个数都从定稿表来。 */
const DAY1_CEILING = 35;
const DAY3_LOW = 60;
const DAY3_HIGH = 80;

const DAY_MS = DEFAULT_MEMORY_CONFIG.dayMs;
const TALK_DISTANCE = DEFAULT_MEMORY_CONFIG.talkDistance;

/** 灯潮界的两位居民。名字从设定集读，不在这儿重抄——抄了就成了会漂的第二份。 */
const VILLAGERS: readonly string[] = DENGCHAO_RAW.villagers.map((villager) => villager.name);

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

/** 两个村民时，「知晓比例」这个量能取到的全部值。 */
function reachablePercents(population: number): readonly number[] {
  const out: number[] = [];
  for (let know = 0; know <= population; know += 1) out.push(Math.round((know / population) * 100));
  return out;
}

/**
 * 第 `dayCount` 天末，一条重大事件被几个村民知道。
 *
 * 两人开局就放在 `talkDistance` 之内——这不是偏袒传播，是把「最有利的情形」
 * 固定住：位置是这条要控制的变量之一，换成真实作息的话，量到的就不再是
 * `coverage_curve` 的上界，而是某一套作息的巧合。
 */
function awarenessPercentAtDayEnd(dayCount: number): number {
  const rt = new MemoryRuntime({ worldId: 'coverage', occlusion: { isWalkable: () => true } });
  rt.syncHolders(
    VILLAGERS.map((holderId, index) => ({
      holderId,
      type: 'character' as const,
      at: { x: index * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
  );
  rt.observe(
    {
      eventId: 'ev_major',
      kind: 'workshop_accident',
      placeId: 'p',
      at: { x: 0, y: 0 },
      actors: [VILLAGERS[0]],
      outcome: {},
      importanceHint: 0.95,
    },
    undefined,
    1000,
  );
  for (let day = 1; day <= dayCount; day += 1) rt.tick(day * DAY_MS);

  let know = 0;
  for (const holderId of VILLAGERS) {
    const view = rt.viewOf(holderId);
    if (view === null) continue;
    if (view.beliefs.some((belief) => belief.eventRefs.includes('ev_major'))) know += 1;
  }
  return Math.round((know / VILLAGERS.length) * 100);
}

test('出货的村子今天两个人：设定集与默认世界两条路都是', () => {
  assert.equal(VILLAGERS.length, 2, `灯潮界的居民是 ${VILLAGERS.join('、')}——加人或减人都会让 coverage_curve 的分母变，回来重算这个文件头里那张表`);
  assert.equal(defaultWorldVillagerCount(), 2, '默认世界的村民兜底不再是两个');
});

test('两个人之下，coverage_curve 的 60%~80% 一个值都取不到', () => {
  const reachable = reachablePercents(VILLAGERS.length);
  assert.deepEqual([...reachable], [0, 50, 100], '两人村的知晓比例集合');
  const inBand = reachable.filter((pct) => pct >= DAY3_LOW && pct <= DAY3_HIGH);
  assert.deepEqual(inBand, [], `第 3 天末的稳态目标 ${DAY3_LOW}%~${DAY3_HIGH}% 在两人村里取不到——这条红说明村里加了人，那时这个区间可能第一次真的可达，回来把文件头那张表改对`);
  // 「第 1 天末 ≤ 35%」在两人村塌缩成「谁都不能知道」。
  const underCeiling = reachable.filter((pct) => pct <= DAY1_CEILING);
  assert.deepEqual(underCeiling, [0], `第 1 天末的 ${DAY1_CEILING}% 上限在两人村里只剩 0% 一个解`);
});

test('实测：第 1 天末 50%（超 35% 上限），第 3 天末 100%（超 80% 上限）', () => {
  // 这两个数是「最有利位置下」的量，不是Bug报告——文件头解释了为什么。
  // 它们存在的意义是让「传播变慢/变快」这件事有红可红：
  // 谁改了 talkDistance、pairCooldown、chatCooldown 或扇出，这里会动。
  assert.equal(awarenessPercentAtDayEnd(1), 50, '第 1 天末的知晓比例');
  assert.equal(awarenessPercentAtDayEnd(3), 100, '第 3 天末的知晓比例');
  // 满员不是第 3 天才到的——第 2 天就全知道了。这正说明 100% 不是巧合。
  assert.equal(awarenessPercentAtDayEnd(2), 100, '第 2 天末就已经满员');
});
