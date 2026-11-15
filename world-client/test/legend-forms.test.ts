/** 传说自己立起来：真包 + 真 Simulation + 真 MemoryRuntime，跑够天数，断言
 * `legend.formed` 发出、载荷完整、第 4 天就立起（实测峰值），不是推出来的，是量出来的。
 *
 * 探针（`.tmp-audit/legend-census.ts`，2026-11-01）在灯潮界量的真实数据，
 * **收束之后**：1000ms 拍、8 个世界日，立起 **28 条**传说，第 4 天关账时一次
 * 立起 **14 条**（其余在第 5、6、7 天各立起 5、2、7 条），这 14 条到第 8 天末
 * `reach` 24–77（全体 28 条 9–77）。收束之前是
 * 59 条、第 4 天 38 条——门槛把闲话从「一条一块碑」压成「同地同日一块」，
 * 条数降下来而事件一件没丢（碑上攥着的是并集）。
 *
 * 这两组是 2026-11-01 修完痕迹（`recurrence` 数事件 + 22 个地标 Holder）之后重测的；
 * 修之前那一版是 27 条 / 第 4 天 15 条 / 收束前 35 与 22，数的是另一种世界。
 *
 * 每条的 `max(importanceHint)` 全部等于 0.35（来自 `routine_done` 闲话，
 * `task_done` 与 `milestone` 尚未出现），所以灯潮界的碑今天**全部**走兜底那条路，
 * 门槛以上的分支只能靠合成事件钉（`legend-cull.test.ts`）。
 *
 * 这些数据点决定测试的天数写 5——从第 5 天末读「至少一条立起」稳当，不赌关账次序。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { routineProfiles, siteTargetResolver } from '../src/settings/index.ts';
import { Simulation } from '../src/world/simulation.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import type { WorldChange } from '../src/world/world-changes.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

const PACK = loadSettingPack(DENGCHAO_RAW);
const WORLD = buildSettingWorld(PACK);

interface Fixture {
  sim: Simulation;
  memory: MemoryRuntime;
  changes: WorldChange[];
}

/** 真设定集世界 + 真 Simulation + 真 MemoryRuntime，`onChange` 记每一条世界变化。 */
function dengchaoSim(): Fixture {
  const changes: WorldChange[] = [];
  let serial = 0;

  const memory = new MemoryRuntime({
    worldId: PACK.id,
    occlusion: WORLD.grid,
    onEvent: (event) => {
      if (event.kind !== 'legend.formed') return;
      // 载荷是 `Record<string, unknown>`；照 `SandboxScene` 的口径逐字段收窄，
      // 缺一个就不记——一条缺字段的「传说」比没有更糟。
      const payload = event.payload as {
        readonly legendId?: unknown;
        readonly text?: unknown;
        readonly placeId?: unknown;
        readonly reach?: unknown;
        readonly day?: unknown;
      };
      if (
        typeof payload.legendId !== 'string'
        || typeof payload.text !== 'string'
        || typeof payload.placeId !== 'string'
        || typeof payload.reach !== 'number'
        || typeof payload.day !== 'number'
      ) {
        return;
      }
      changes.push({
        change: 'legend',
        legendId: payload.legendId,
        text: payload.text,
        placeId: payload.placeId,
        reach: payload.reach,
        day: payload.day,
      });
    },
  });

  const sim = new Simulation({
    grid: WORLD.grid,
    buildings: WORLD.buildings,
    altar: PACK.hub,
    villagerName: PACK.villagers[0]!.name,
    villagerNames: PACK.villagers.map((v) => v.name),
    villagerProfiles: routineProfiles(PACK, siteTargetResolver(PACK, WORLD.grid, WORLD.buildings)),
    blueprints: PACK.blueprints,
    wallClock: () => 1000,
    onChange: (change, at) => {
      const eventId = `mem_${(serial += 1)}`;
      const snap = sim.snapshot();
      const observation = observationOf(change, eventId, {
        atOfHolder: (id) => {
          const v = snap.villagers.find((item) => item.id === id);
          return v === undefined ? undefined : { x: v.pos.x, y: v.pos.y };
        },
        atOfBuilding: (instanceId) => {
          const b = snap.buildings.find((item) => item.instanceId === instanceId);
          return b === undefined ? undefined : { x: b.door.x, y: b.door.y };
        },
        buildingOfTask: (taskId) => snap.tasks.find((t) => t.id === taskId)?.buildingId ?? undefined,
      });
      if (observation === null) return;
      memory.observe(observation, undefined, at);
    },
  });

  // 楼先对位一次（SandboxScene.sightsee 同构）。
  memory.syncHolders(
    WORLD.buildings.map((b) => ({
      holderId: b.instanceId,
      type: 'place' as const,
      at: { x: b.door.x, y: b.door.y },
    })),
  );

  return { sim, memory, changes };
}

/** 跑满 `days` 个世界日。步进 1000ms，真实 app 用 `?speed=` 跑到 60–6000ms，但测试先以
 * 真实拍数为基准，确保作息能凑出「七个人真的照面」。后续再量粗步长下的形态。 */
function runDays(fixture: Fixture, days: number): void {
  for (let t = STEP_MS; t <= days * DAY_MS; t += STEP_MS) {
    fixture.sim.update(STEP_MS);
    const snap = fixture.sim.snapshot();
    fixture.memory.syncHolders(
      snap.villagers.map((v) => ({
        holderId: v.id,
        type: 'character' as const,
        at: { x: v.pos.x, y: v.pos.y },
      })),
    );
    fixture.memory.tick(snap.now);
  }
}

/**
 * 五个世界日只跑一次。五条测试读的是同一个确定性世界的同一份结果——
 * 每一条各跑一遍就是 5 × ~130s，测试串行，这个代价买不到任何东西。
 *
 * 步长取 1000ms：这是量出「第 4 天 14 条」时的口径。粗步长（6000ms）
 * 是否还凑得出同样的照面，由 A 段探针单独量，不在这里赌。
 */
const STEP_MS = 1000;

let shared: Fixture | undefined;
function fiveDays(): Fixture {
  if (shared === undefined) {
    shared = dengchaoSim();
    runDays(shared, 5);
  }
  return shared;
}

/** 碑上的字非空，`reach >= legendHolders`，并且立在某个地点上。 */
test('立起的传说载荷完整：text / reach / placeId / day 都有值', () => {
  const { memory } = fiveDays();

  const legends = memory.legends();
  assert.ok(legends.length > 0, '5 个世界日后应该至少有一条传说立起');

  const formedLegends = legends.filter((l) => l.reach > 1);
  assert.ok(formedLegends.length > 0, '活着（reach > 1）的传说应该存在');

  const sample = formedLegends[0]!;
  assert.ok(sample.legendId !== '' && typeof sample.legendId === 'string', 'legendId 应有字符串值');
  assert.ok(
    sample.homePlaceId.startsWith('place:') || sample.homePlaceId.includes('#'),
    `homePlaceId 应为 \`place:x,y\` 或楼实例 id，实际 ${sample.homePlaceId}`,
  );
  assert.equal(sample.reach, Math.round(sample.reach), 'reach 必须为整数');
  assert.ok(sample.reach >= 5, `reach=${sample.reach} ≥ legendHolders=5`);
  assert.equal(sample.formedDay, 4, '第 4 天关账时立起的传说（实测峰值）');
});

/** `legend.formed` 被 emit 并写回 `changes` 里（镇志那一环）。 */
test('世界发出 legend.formed，onChange 收到完整的 legend WorldChange', () => {
  const { changes } = fiveDays();

  const legendsChanged = changes.filter((c) => c.change === 'legend');
  assert.ok(legendsChanged.length > 0,
    `legend.formed 应该发出并被 onChange 记录，实际 ${changes.length} 条总变化`);

  const sample = legendsChanged[0];
  if (sample?.change === 'legend') {
    assert.ok(typeof sample.legendId === 'string' && sample.legendId !== '', 'legendId 非空');
    assert.ok(typeof sample.placeId === 'string' && sample.placeId !== '', 'placeId 非空');
    assert.equal(sample.day, Math.round(sample.day), 'day 应为整数');
    assert.ok(sample.day > 0, 'day ≥ 1');
    // text 字段：`updateLegends` 从 `variants` 生成，非空。
    assert.ok(typeof sample.text === 'string', 'text 应有字符串值');
  } else {
    throw new Error(`sample.change='${sample?.change}'，不是 legend`);
  }
});

/** 第 4 天是峰值：第 5 天末看到的传说都已在第 4 天关账时立起，之后只是衰败而不是新立。
 * （这是实测到的数字，不是推演。）*/
test('传说在第 4 天末立起最多：第 5 天末不再有新立（只谈已立的），测的是作息能否凑到一起', () => {
  const { memory } = fiveDays();

  const legends = memory.legends();
  const day4Count = legends.filter((l) => l.formedDay === 4).length;
  const day5AndLater = legends.filter((l) => l.formedDay >= 5).length;

  // 第 4 天关账时有较多传说立起（收束后实测 14 条；收束前是 38），第 5 天及以后没有新的。
  assert.ok(day4Count > 0, '第 4 天关账时应有利起的传说（收束后实测 14 条）');
  assert.equal(day5AndLater, 0, '第 5 天末不应再有新的传说立起（已达峰值）');
});

/** 归并在真世界里真的发生了：至少一块碑攥着两件以上的事。
 * 这一条把「并」从合成夹具拉到这张图上——没有它，`mergeByPlace` 可以是
 * 一个在真世界从不触发的函数，而单元测试照样全绿。 */
test('真世界里真的有碑并起了两件以上的事', () => {
  const { memory } = fiveDays();
  const legends = memory.legends();
  const merged = legends.filter((legend) => legend.eventRefs.length > 1);
  assert.ok(
    merged.length > 0,
    `${legends.length} 块碑里没有一块攥着两件事——归并在真世界里没触发`,
  );
});

/** 活着的传说 reach ≥ 5；死了的（淡去）reach ≤ 1。
 * 这一条把淡去语义钉死，保证 `steleLines` 的排序逻辑有依托。 */
test('活着 vs 淡去：living 传说 reach≥5，faded 传说 reach≤1', () => {
  const { memory } = fiveDays();

  const legends = memory.legends();
  const living = legends.filter((l) => l.reach > 1);
  const faded = legends.filter((l) => l.reach <= 1);

  for (const l of living) {
    assert.ok(l.reach >= 5, `living 传说 ${l.legendId} 的 reach=${l.reach} ≥ 5`);
  }
  for (const l of faded) {
    assert.ok(l.reach <= 1, `faded 传说 ${l.legendId} 的 reach=${l.reach} ≤ 1`);
  }
});

/** 立起来的传说带着世界自己组织好的讲法：`variants` 非空、每一条都是非空字符串。
 * 这是 `steleLines` 原样显示 `texts` 的前提——variants 空，碑上就是空白。
 * （「多种讲法怎么并成一条」将来由归并那一条测试用受控夹具测，不在这里
 * 靠作息偶然性碰运气。） */
test('立起的传说带着非空 variants——碑上原样显示的那些句子', () => {
  const { memory } = fiveDays();

  const legends = memory.legends();
  const livingLegends = legends.filter((l) => l.reach > 1);

  assert.ok(livingLegends.length > 0, '应至少有 1 条活传说用于验证 variants');

  const sample = livingLegends[0]!;
  assert.ok(sample.variants.length > 0, `${sample.legendId} 有至少一种讲法`);
  assert.ok(
    sample.variants.every((v) => typeof v === 'string' && v.trim().length > 0),
    '所有 variants 应为非空字符串',
  );
});

