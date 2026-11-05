/**
 * 需求层第一版：饥饿一个标量。
 *
 * 钉四件事：
 *   1. 读数是纯值对象：给定世界时刻与上次吃饭时刻，值只由这两个数决定；
 *   2. 速率 / 阈值是可枚举常量，跨阈时刻可以手算；
 *   3. 跨阈 → 产生吃饭目标 → 在现有摊子消费，读数回到 0；
 *   4. 不落档：存档里不出现饥饿读数。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import {
  NEEDS_HUNGER_EAT_THRESHOLD,
  NEEDS_HUNGER_PER_DAY,
  hungerAt,
  needsAt,
} from '../src/world/needs.ts';

/** 跨阈需要多少个世界日：手算一处，测试与文档都认这个数。 */
const CROSS_DAYS = NEEDS_HUNGER_EAT_THRESHOLD / NEEDS_HUNGER_PER_DAY;

function makeSim(initialNow = 0): Simulation {
  return new Simulation({
    grid: new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [] }),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    villagerNames: ['莞尔'],
    wallClock: () => 1000,
    initialNow,
    // 现有摊子就是吃饭的落点：不新造地点种类。
    stallsAt: [{ x: 6, y: 6 }],
    villagerProfiles: [
      {
        at: { x: 2, y: 2 },
        routine: [{ id: 'promenade', label: '去街口', going: '去街口', target: { x: 8, y: 5 }, dwellMs: 300 }],
      },
    ],
  });
}

test('饥饿读数是纯值对象：同一对数永远算出同一个值', () => {
  assert.equal(hungerAt(0, 0), 0);
  assert.equal(hungerAt(DAY_MS, 0), NEEDS_HUNGER_PER_DAY);
  assert.equal(hungerAt(10, 20), 0, '时钟往回拨也不能出现负饥饿');
  assert.equal(hungerAt(10 * DAY_MS, 0), 1, '封顶在 1');
  assert.deepEqual(needsAt(0, 0), { hunger: 0, hungry: false });
  assert.equal(needsAt(CROSS_DAYS * DAY_MS, 0).hungry, true);
});

test('速率与阈值可枚举：跨阈时刻 = 阈值 / 每日速率', () => {
  assert.equal(NEEDS_HUNGER_PER_DAY, 1 / 3);
  assert.equal(NEEDS_HUNGER_EAT_THRESHOLD, 0.9);
  assert.ok(Math.abs(CROSS_DAYS - 2.7) < 1e-9, `跨阈日数应为 2.7，实际 ${CROSS_DAYS}`);

  // 冻结的 50 小时轨迹（约 2.08 个世界日）里不该有人跨阈：
  assert.ok(CROSS_DAYS * DAY_MS > 50 * 60 * 60 * 1000);
});

test('跨阈后产生吃饭目标，在现有摊子消费，读数回到 0', () => {
  // 开局世界时刻已经过了 2.8 天，而上一次吃饭记在第 0 天：开局即饿。
  const sim = makeSim(Math.floor(2.8 * DAY_MS));
  const villagerId = sim.snapshot().villagers[0]!.id;
  sim.setLastMealAt(villagerId, 0);
  assert.equal(sim.needsOf(villagerId)?.hungry, true);
  assert.ok(sim.needsOf(villagerId)!.hunger >= 0.9);

  sim.setDecisionLogEnabled(true);
  let ate = false;
  for (let index = 0; index < 600 && !ate; index += 1) {
    sim.update(2000);
    for (const record of sim.drainDecisions()) {
      if (record.rule !== 'eat') continue;
      assert.deepEqual([record.targetX, record.targetY], [6, 6], '吃饭落点应是现有摊子');
    }
    // 走到摊子、坐下吃完，读数才回 0。
    if (sim.needsOf(villagerId)!.hunger === 0) ate = true;
  }
  assert.equal(ate, true, '饿了却没在摊子上吃完');
  assert.equal(sim.goalInterruptCount(), 0, '吃饭不该触发打断');
});

test('饥饿读数不落档', () => {
  const sim = makeSim(Math.floor(2.8 * DAY_MS));
  const villagerId = sim.snapshot().villagers[0]!.id;
  sim.setLastMealAt(villagerId, 0);
  sim.update(2000);

  const save = JSON.stringify(sim.toSave());
  assert.equal(save.includes('hunger'), false, '存档里不该出现 hunger');
  assert.equal(save.includes('lastMeal'), false, '存档里不该出现 lastMeal');
});
