/** 三栋接活的楼：真派得出活。这是「楼接活」那一段唯一的端到端证据。
 *
 * 上一版（`38074f2`）给灯潮界添了三栋带 `boundTask` 的楼——账房（writing）、
 * 灯录阁（research）、炉匠铺（code）。没有这份文件时，`boundTask` 只是三个
 * 字面量：装载校验能确认它们**合法**（`blueprints.ts:56-61` 的配对规则一装就查），
 * 但没有任何东西证明一条 code 活真能走进那扇门、在里头做完、被交出来。
 *
 * 这份文件补两段：
 *
 * 1. **静态三段**：配对、门口三查、以及一条「恒真也不奇怪」的前提守卫
 *    （见那条测试的注释——它测的不是位置好，是 `grid.ts:304-308` 这个实现）。
 * 2. **动态一段**：喂一条真实上游的 code 活，跑起来，断言
 *    `task.delivered` 带着 `taskKind === 'code'` 落到**炉匠铺**那一格上。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { doorReaches } from '../src/world/setup.ts';
import { routineProfiles } from '../src/settings/index.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { WorldChange } from '../src/world/world-changes.ts';
import { syncCommand } from './feed-helpers.ts';

const PACK = loadSettingPack(DENGCHAO_RAW);

interface Fixture {
  readonly sim: Simulation;
  readonly changes: WorldChange[];
  /** instanceId → 它接的活（从落成的世界里读，不重抄 pack 的字面量）。 */
  readonly bound: Map<string, string | null>;
}

/**
 * 真设定集落成的世界 + 真 Simulation，`onChange` 收到什么就记什么。
 *
 * 接线与 `SandboxScene` 同构但不带记忆层：这一条问的是「楼接不接得住活」，
 * 记忆是另一本账（`legend-forms.test.ts` 管它）。所以直接收 `onChange`，
 * 不经 `observationOf`——那一步是给记忆层用的。
 */
function dengchaoSim(): Fixture {
  const world = buildSettingWorld(PACK);
  const changes: WorldChange[] = [];
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: PACK.hub,
    villagerName: PACK.villagers[0]!.name,
    villagerNames: PACK.villagers.map((villager) => villager.name),
    villagerProfiles: routineProfiles(PACK),
    blueprints: PACK.blueprints,
    wallClock: () => 1000,
    onChange: (change) => {
      changes.push(change);
    },
  });
  const bound = new Map(
    world.buildings.map((building) => [building.instanceId, building.boundTask]),
  );
  return { sim, changes, bound };
}

/** `dengchaoSim` 附带网格——静态那三条要看格子的属性。 */
function dengchaoWorld() {
  return buildSettingWorld(PACK);
}

const WORKSHOPS = [
  { instanceId: 'soot_forge#1', task: 'code', accent: 'smoke' },
  { instanceId: 'lamp_archive#1', task: 'research', accent: 'pages' },
  { instanceId: 'ledger_house#1', task: 'writing', accent: 'ink' },
] as const;

test('三栋新楼都落了地，各自接一种活——从落成的世界读，不重抄 pack', () => {
  const { bound } = dengchaoSim();
  for (const item of WORKSHOPS) {
    assert.equal(
      bound.get(item.instanceId),
      item.task,
      `${item.instanceId} 该接 ${item.task}；接不上的话，「楼接活」这一段根本没有开始`,
    );
  }
});

test('boundTask 与 accent 成对（parseBlueprint 的三条配对规则装时就查了，这里查落成结果）', () => {
  const { buildings } = dengchaoWorld();
  for (const item of WORKSHOPS) {
    const building = buildings.find((b) => b.instanceId === item.instanceId);
    assert.ok(building !== undefined, `${item.instanceId} 没落位`);
    assert.equal(building.accent, item.accent, `${item.instanceId} 的 accent 与它接的活对不上`);
  }
});

test('门口三查：可建、可达镇心、不在呼吸段', () => {
  const { grid, buildings } = dengchaoWorld();
  for (const item of WORKSHOPS) {
    const building = buildings.find((b) => b.instanceId === item.instanceId)!;
    assert.ok(grid.isWalkable(building.door), `${item.instanceId} 的门口不可走`);
    assert.ok(
      !grid.breathingAt(building.door),
      `${item.instanceId} 的门口落在呼吸段里——呼吸段不派活，这栋楼永远接不到单`,
    );
    // 可达镇心：装载时 `buildSettingWorld` 已经拦过一轮（门口到不了镇心直接抛），
    // 所以这一句在**这份包**上是复述前提。它防的是「有人把这条闸拆了」：
    // `settings-regions.test.ts` 的 GATE 夹具测的是闸本身，这里测的是这栋楼此刻过没过。
    assert.ok(doorReaches(grid, building.door, PACK.hub), `${item.instanceId} 的门口连不到镇心`);
  }
});

test('门口满潮不淹——这条恒真，它钉的是「门口被铺成 stone」这个前提', () => {
  // 别把这条读成「这三栋楼位置挑得好」。`grid.place()` 落位时把门口那一格
  // 无条件改成 `walkable: true, terrain: 'stone'`（`grid.ts:304-308`），
  // stone 不会被满潮淹——所以断言在今天的实现下**永远过**。
  // 它的价值在反方向：哪天有人让门口保留原地形，这条立刻红，而那时
  // 「门口泡在水里」才第一次成为可能，得回来重新设计这条断言该说什么。
  const { grid, buildings } = dengchaoWorld();
  grid.setTideLevel(1);
  for (const item of WORKSHOPS) {
    const building = buildings.find((b) => b.instanceId === item.instanceId)!;
    assert.equal(
      grid.isFloodedAt(building.door),
      false,
      `${item.instanceId} 的门口淹了——先去看 grid.place 是不是不再铺 stone 了，再决定这条怎么改`,
    );
  }
});

test('喂一条真实上游的 code 活：有人走进炉匠铺、做完、交出来', () => {
  // 端到端的那一段。三种挑法之外的可能失败都在这里现形：
  // 楼在但没被 `venueCandidates` 枚举、作息挡住了占位、`pickVenue` 判它郊野……
  // 断言链走到底：sync → 有人 working 在 soot_forge → finished → task.delivered。
  const { sim, changes } = dengchaoSim();
  sim.enqueue(
    syncCommand({ tasks: [{ id: 'c_venue', kind: 'code', title: '把编译错误修掉' }], connected: true }),
  );

  // 先等到「有人进了那栋楼」。步长 100ms 与 `world-changes.test.ts` 同一口径：
  // 走路动画按 deltaMs 结算，100 是走得动的最小常用拍。
  let guard = 0;
  let taskBuildingId: string | null | undefined;
  for (;;) {
    sim.update(1000);
    const snap = sim.snapshot();
    const inForge = snap.workstations.find(
      (station) =>
        station.buildingId === 'soot_forge#1' && station.activity.kind === 'operating',
    );
    if (inForge !== undefined) {
      // 交付之后这条活就从 `tasks` 里摘掉了（`dropFromList`），所以楼要趁它还在时记下来。
      taskBuildingId = snap.tasks.find((item) => item.id === 'c_venue')?.buildingId;
      break;
    }
    if ((guard += 1) > 4000) {
      const modes = snap.villagers.map((v) => `${v.name}:${v.mode}`).join(', ');
      throw new Error(`跑了 ${guard} 拍还没人进炉匠铺。各人状态：${modes}`);
    }
  }

  // 上游说这单成了。交付统计与 `onChange` 都得跟上。
  sim.enqueue(syncCommand({ finished: [{ id: 'c_venue', completedAt: 2000 }] }));
  guard = 0;
  for (;;) {
    sim.update(1000);
    if (sim.snapshot().deliveries.feed >= 1) break;
    if ((guard += 1) > 600) throw new Error('上游说成了，交付却没记上');
  }

  const delivered = changes.filter((item) => item.change === 'task.delivered');
  assert.equal(delivered.length, 1, `task.delivered 该只有一条，实际 ${delivered.length} 条`);
  const change = delivered[0];
  if (change?.change === 'task.delivered') {
    assert.equal(change.taskKind, 'code', '交付的不是 code——派活派到别的楼去了');
    assert.equal(change.source, 'feed', '这是上游的活，source 该是 feed');
    assert.equal(change.taskId, 'c_venue');
  }

  // 干活的时候这单挂在哪栋楼。交付后 `tasks` 会摘掉它，所以上面在有人开工那一刻就记下了。
  assert.equal(taskBuildingId, 'soot_forge#1', '这单 code 不在炉匠铺做的');
});
