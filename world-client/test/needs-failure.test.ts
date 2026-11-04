/**
 * 失败原型：饿到顶的人干完活，交付失败一次。
 *
 * 只钉三件事：
 *   1. 阈值以下照常交付；
 *   2. 饿到顶（1.0）交付失败，任务走已有的 `failed` 状态，交付数不涨；
 *   3. 吃一口（读数回 0）之后再派一单，能正常交付；且同一单不会失败第二次。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { NEEDS_HUNGER_FAIL_THRESHOLD } from '../src/world/needs.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >,
);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    villagerNames: ['莞尔'],
    wallClock: () => 1000,
  });
}

function dispatchQuick(sim: Simulation, summary: string): void {
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary });
  sim.update(16);
}

/**
 * 跑到某一单落到终态；超时就抛错，避免挂死。
 *
 * 原地单的 `estimateMs` 是 300 秒（见 `taskProfile` 的 quick 档），所以默认窗口
 * 要跨过它，不能用「看起来差不多」的 30 秒。
 */
function runUntilSettled(sim: Simulation, summary: string, limitMs = 400_000): string {
  let elapsed = 0;
  while (elapsed < limitMs) {
    const task = sim.snapshot().tasks.find((item) => item.summary === summary);
    if (task !== undefined && (task.status === 'done' || task.status === 'failed')) return task.status;
    sim.update(500);
    elapsed += 500;
  }
  throw new Error(`等了 ${limitMs}ms，${summary}仍未落终态`);
}

test('饿到顶 → 交付失败一次：任务走已有 failed 状态，交付数不涨', () => {
  const sim = makeSim();
  sim.update(16);
  const villagerId = sim.snapshot().villagers[0]!.id;

  dispatchQuick(sim, '顺手看一眼');

  // 开工之后才饿到顶：上一次吃饭记在 3 个世界日之前，读数封顶 1.0。
  sim.setLastMealAt(villagerId, sim.snapshot().now - 3 * DAY_MS);
  assert.equal(sim.needsOf(villagerId)!.hunger, 1);
  assert.ok(sim.needsOf(villagerId)!.hunger >= NEEDS_HUNGER_FAIL_THRESHOLD);

  assert.equal(runUntilSettled(sim, '顺手看一眼'), 'failed', '饿到顶的人这一趟该失败');
  assert.equal(sim.snapshot().deliveries.local, 0, '失败的这一趟不能记成交付');
  assert.match(sim.snapshot().villagers[0]!.bubble ?? '', /没送到/, '她得说出这一趟为什么没送到');
});

test('吃一口之后再派一单能正常交付，同一单不会失败第二次', () => {
  const sim = makeSim();
  sim.update(16);
  const villagerId = sim.snapshot().villagers[0]!.id;

  dispatchQuick(sim, '饿着送的');
  sim.setLastMealAt(villagerId, sim.snapshot().now - 3 * DAY_MS);
  assert.equal(runUntilSettled(sim, '饿着送的'), 'failed');

  // 吃一口：读数回到 0（运行时的 `lastMealAt`，不落档）。
  sim.setLastMealAt(villagerId, sim.snapshot().now);
  assert.equal(sim.needsOf(villagerId)!.hunger, 0);

  dispatchQuick(sim, '吃饱再送');
  assert.equal(runUntilSettled(sim, '吃饱再送'), 'done', '吃过就不该再失败');
  assert.equal(sim.snapshot().deliveries.local, 1);
  // 前一单已记为 failed，不会再被重复结算。
  assert.equal(sim.snapshot().tasks.find((item) => item.summary === '饿着送的')!.status, 'failed');
});
