/**
 * 一座没有任何铺子的设定集：世界得说「没有」，不能说「没有空闲的」。
 *
 * 灯潮界六栋楼的 `boundTask` 全是 null——三种活一种都接不了。这是设定集
 * 作者的有意选择（每栋楼在 `pack.ts` 里都写着它是干什么的），而包这条路
 * 没有任何「venue 覆盖」法则，所以它静静成立：`validateCoverage` 只被
 * `buildWorld` 调，`loadSettingPack` / `buildSettingWorld` 都不调
 * （`ADR_PACK_SKIPS_WORLD_BUDGET` 待办 B）。
 *
 * 待办 B 问的是「一座包可不可以正当地图一地没有工坊」。这里的回答是
 * **可以，而且引擎早就容得下**：派活那一侧本来就拒，不编一座铺子出来。
 * 所以不断那座包——要修的是拒的时候说的那句话。
 *
 * 原来它在屏幕上说的是「没有空闲的 code 铺子。」。那句话是假的：它暗示
 * 有、只是忙，而这里一栋都没有。照着它去找的用户会去找一座不存在的铺子。
 * 「说谎比不去更糟」在这里不是比喻，是一句用户在屏幕上读到的假话。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { syncCommand } from './feed-helpers.ts';

function dengchaoSim(): Simulation {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: pack.hub,
    villagerName: pack.villagers[0]!.name,
    wallClock: () => 1000,
  });
}

/** 默认世界（莞尔镇）。对照组：它是有铺子的，所以同一条命令不能也失败。 */
function defaultSim(): Simulation {
  const blueprints = parseBlueprintTable(
    JSON.parse(
      readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
    ) as Record<string, Record<string, unknown>>,
  );
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
}

/** 派一条活，把世界回给用户的那句话拿出来。 */
function sayOnDispatch(sim: Simulation, taskKind: 'code' | 'research' | 'writing'): string {
  sim.enqueue({ kind: 'dispatch', taskKind, summary: '把编译错误修掉' });
  const results = sim.update(16);
  return results.map((item) => (item.ok ? '' : item.message)).join('');
}

test('灯潮界一栋接 code 的楼都没有：先确认这个前提，不然下面测的不是这件事', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  assert.ok(world.buildings.length > 0, '一座空图的镇志没有意义');
  assert.deepEqual(
    world.buildings.map((building) => building.boundTask),
    world.buildings.map(() => null),
    '灯潮界的楼都不接活——这是设定集的有意选择',
  );
});

test('一座铺子都没有时，说的是「没有」不是「没有空闲的」', () => {
  const message = sayOnDispatch(dengchaoSim(), 'code');
  assert.equal(message, '这座镇子没有接 code 的铺子。');
  assert.ok(
    !message.includes('空闲'),
    `「${message}」暗示有铺子只是忙——这里一栋都没有`,
  );
});

test('换成 research、writing 也一样：这三种它一种都不接', () => {
  const sim = dengchaoSim();
  for (const kind of ['research', 'writing'] as const) {
    assert.equal(
      sayOnDispatch(sim, kind),
      `这座镇子没有接 ${kind} 的铺子。`,
      `${kind} 也该得到同一句真话`,
    );
  }
});

test('对照组：有铺子的镇子同一条命令不失败，否则上面可能只是「派活本来就崩」', () => {
  const message = sayOnDispatch(defaultSim(), 'code');
  assert.ok(message === '', `默认世界该派得出 code，实际回的是「${message}」`);
});

test('上游的活也一样：派不出去要说是镇子没有，不是铺子在忙', () => {
  // 事件流那条路原来也只会说「没有空闲的镇内铺子承接」。它和屏幕上那句
  // 是同一个毛病的两处，所以一起钉住。
  const sim = dengchaoSim();
  const said: string[] = [];
  (sim as unknown as { log: (kind: string, message: string) => void }).log = (kind, message) => {
    said.push(`[${kind}] ${message}`);
  };
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '修一盏灯' }], connected: true }));
  for (let step = 0; step < 8; step += 1) sim.update(16);

  const joined = said.join('\n');
  assert.ok(
    joined.includes('这座镇子没有接 code 的铺子'),
    `上游那条路也该说「没有」，实际说的是：${joined || '（什么都没说）'}`,
  );
  assert.ok(!joined.includes('没有空闲的'), '上游那条路不该再说「没有空闲的」');
});
