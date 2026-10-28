/**
 * 「传播计算 `< 10ms/天`」——§3.2 B 五条指标里最后一个没人量过的硬数。
 *
 * ## 为什么要有这个文件
 *
 * §3.2 B 的 `daily_prop_cost`（`docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md:154`）
 * 是**两半**：
 *
 * 1. 「传播计算 `0` 次 LLM 调用」——**有闸**。`test/creator-config.test.ts:235`
 *    钉住配置里那个数是 0，`test/memory-protocol.test.ts` 钉住断言是
 *    `generatedBy.by === 'rule'` 生的。
 * 2. 「纯图算法 `< 10ms/天`」——**一闸都没有**。`10ms` 这三个字符在
 *    `src/world/memory/` 与 `docs/` 里**零命中**：没有测试、没有探针、没有 eval，
 *    连一句注释都没提过它。
 *
 * 而这个仓库最不容的正是「读起来像真的、其实一次都没量过」——`config.ts` 第 3 条
 * 纪律那句「900 秒由 timeScale 承担」就是这么站了很久的（见
 * `test/day-pace.test.ts` 与 `mechanism-claims-need-the-arithmetic` 的教训）。
 *
 * ## 今天量出来（2026-10-28，Windows 11 / Node 22）
 *
 * 跑真实 `MemoryRuntime`、真实设定集落成的世界、五个 `importanceHint = 0.9` 的
 * 大事同时在第一天出生，逐天 `tick` 一整天的世界时间：
 *
 * | 世界 | holder | 单日最慢 | 平均 | 对 10ms 预算 |
 * | --- | --- | --- | --- | --- |
 * | 灯潮界（设定集） | 8（2 村民 + 6 楼） | 4.30 ms | 1.10 ms | 余 2.3 倍 |
 * | 默认世界（`buildLargeWorld`） | 13（2 村民 + 11 楼） | **8.46 ms** | 1.65 ms | **余 1.2 倍** |
 *
 * 最慢的永远是**第 1 天**——所有断言都在那天出生，之后库里的东西只会被遗忘，
 * 不会新增。默认世界那个 8.46 ms 离预算只剩 1.2 倍：**不是不达标，但是也没有余量**。
 *
 * ## 这一条**不**主张什么
 *
 * - **不主张「8.46 ms 就是真的」。** 这是**墙钟**，跟机器有关，CI 上会不一样。
 *   能被机器搬动的是绝对值，不是形状——所以下面那道闸的阈值放到 50ms，
 *   是预算的 5 倍、实测最慢的 6 倍。它抓的是**量级退化**（哪天谁把传播改成
 *   每步全库扫描），不是抓 10ms 那条线。真要守 10ms，得先有一台固定的基准机。
 * - **不主张这是典型值。** 我把全部 holder 一字排开、间距 `talkDistance`，
 *   又让五个大事同一天出生——这是**最利于传播的摆法**，量到的是上界。
 *   真实作息的 holder 散在各处，配不成对的更多，一天更便宜。
 * - **不查 `paceFrame` / `tick` 自己算得对不对。** 那是 `eco-mode.test.ts` 与
 *   `frame-pace.test.ts` 的事；这里只从外部量总账。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';

/** §3.2 B 的预算：一天传播与日终整理的计算耗时。 */
const BUDGET_MS = 10;
/** 这道闸自己的阈值：预算的 5 倍。理由见文件头——它抓量级，不抓 10ms 那条线。 */
const CEILING_MS = 50;

const DAY_MS = DEFAULT_MEMORY_CONFIG.dayMs;
const TALK_DISTANCE = DEFAULT_MEMORY_CONFIG.talkDistance;
const VILLAGERS: readonly string[] = ['莞尔', '阿雾'];

/** 默认世界（大规格）落成的楼。`test/large-world.test.ts:144` 钉住它是十一栋。 */
function defaultWorldBuildingIds(): readonly string[] {
  const blueprints = parseBlueprintTable(
    JSON.parse(
      readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
    ) as Record<string, Record<string, unknown>>,
  );
  return buildLargeWorld(blueprints).buildings.map((building) => building.instanceId);
}

/**
 * 一天的世界时间要跑多少毫秒。
 *
 * holder 一字排开、间距 `talkDistance`，五个 `importanceHint = 0.9` 的大事同一天
 * 出生——最利于传播的摆法，量到的是上界。`day` 传第几天。
 */
function oneDayMilliseconds(buildingIds: readonly string[], day: number): number {
  const rt = new MemoryRuntime({ worldId: 'prop-cost', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    ...VILLAGERS.map((holderId, index) => ({
      holderId,
      type: 'character' as const,
      at: { x: index * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
    ...buildingIds.map((holderId, index) => ({
      holderId,
      type: 'place' as const,
      at: { x: (index + VILLAGERS.length) * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
  ]);
  for (let i = 0; i < 5; i += 1) {
    rt.observe(
      {
        eventId: `ev_${i}`,
        kind: 'workshop_accident',
        placeId: buildingIds[0],
        at: { x: 0, y: 0 },
        actors: VILLAGERS,
        outcome: {},
        importanceHint: 0.9,
      },
      undefined,
      1000 + i,
    );
  }
  for (let d = 1; d < day; d += 1) rt.tick(d * DAY_MS);
  const started = performance.now();
  rt.tick(day * DAY_MS);
  return performance.now() - started;
}

test('两个出货世界的 holder 数：设定集八个，默认世界十三个', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  assert.equal(pack.villagers.length + world.buildings.length, 8, '设定集的 holder 总数不再是八个');
  assert.equal(VILLAGERS.length + defaultWorldBuildingIds().length, 13, '默认世界的 holder 总数不再是十三个');
});

test('一天的世界时间跑得完：默认世界最慢那天也在预算的 5 倍之内', () => {
  // 第 1 天是永远最慢的那天（所有断言都在那天出生），所以只量它。
  const buildings = defaultWorldBuildingIds();
  const day1 = oneDayMilliseconds(buildings, 1);
  assert.ok(
    day1 < CEILING_MS,
    `默认世界第 1 天花了 ${day1.toFixed(2)}ms，超过这道闸的 ${CEILING_MS}ms——`
      + `§3.2 B 的预算本身是 ${BUDGET_MS}ms/天，这一条放到 ${CEILING_MS / BUDGET_MS} 倍是为了不跟机器噪声红。`
      + '真超了的话先看是不是传播改成了每步全库扫描，再回来把文件头那张表改对。',
  );
  // 顺带把「稳态比第 1 天便宜」这个形状钉住。这条不量快慢，只量方向：
  // 库里只有遗忘没有新增，所以后面几天不该更贵。
  const steady = oneDayMilliseconds(buildings, 6);
  assert.ok(
    steady < day1 * 2,
    `第 6 天 ${steady.toFixed(2)}ms 比第 1 天 ${day1.toFixed(2)}ms 贵了一倍以上——`
      + '库里的东西只会被遗忘不会新增，稳态不该比开局贵。这条红说明传播的代价不再由存量决定。',
  );
});

test('设定集那个小世界更便宜：比默认世界慢的日子不该出现', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const small = buildSettingWorld(pack).buildings.map((building) => building.instanceId);
  const large = defaultWorldBuildingIds();
  // 不比绝对值（机器相关），比同一次运行里的相对关系：holder 少的那个
  // 一天的传播配对也更少，没有理由更贵。留一倍噪声余量。
  assert.ok(
    oneDayMilliseconds(small, 1) < oneDayMilliseconds(large, 1) * 2,
    '八个 holder 的世界比十三个 holder 的世界还贵——传播的代价不再随规模走',
  );
});
