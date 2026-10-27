import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid } from '../src/world/grid.ts';
import type { PlacedBuilding } from '../src/world/types.ts';
import { Simulation } from '../src/world/simulation.ts';

/**
 * §4.7「不弹提示」的**边界**：它禁的是世界自己开口，不禁世界回答玩家。
 *
 * `simulation.ts` 的 `stepDecrees` 那段把边界写在了注释里，这条文件把它钉住。
 * 少了它，那句话只是注释——将来有人「补全」§4.7，把每一处写 bubble 的地方
 * 都加上 `!inBreathing`，测试全绿，而玩家在呼吸段里说一句话世界再也不理。
 * 那是另一种坏，而且比留白里多一声更难看：用户在跟一个不理人的世界说话。
 *
 * 另一半（世界自己开口要被堵住）由 `breathing-world.test.ts` 的
 * 「呼吸段里的人不去举急件」钉住，这里不重复。
 */

/** 左半边（x∈[1,11]、y∈[1,16]）是呼吸段，右半边不是。 */
const INSIDE = { x: 4, y: 8 };
const OUTSIDE = { x: 18, y: 8 };
const ALTAR = { x: 20, y: 9 };

function grid(): WorldGrid {
  return new WorldGrid({
    width: 24,
    height: 18,
    border: 1,
    zones: [],
    regions: [{ id: 'shoal', x: 1, y: 1, w: 11, h: 16, breathing: true }],
  });
}

/** 屋檐在呼吸段外头：她要躲雨就得走出去，所以气泡是她站在留白里说的。 */
const SHELTER: PlacedBuilding = {
  instanceId: 'code_forge#1',
  prefabId: 'code_forge',
  displayName: '炼码工坊',
  zone: 'industry',
  origin: { x: 14, y: 4 },
  footprint: { w: 2, h: 2 },
  door: { x: 15, y: 7 },
  workSpot: { x: 15, y: 4 },
  chimney: { x: 15, y: 3 },
  accent: 'smoke',
  silhouette: 'flat',
  boundTask: 'code',
  palette: { body: 0x8a5a3b, roof: 0xb5562f, trim: 0xd8c9a3, window: 0xf2c14e },
};

/** 一个人站在呼吸段里，一个人站在外头。作息都指着祭坛，谁都没到点。 */
function makeSim(): Simulation {
  return new Simulation({
    grid: grid(),
    buildings: [SHELTER],
    altar: ALTAR,
    villagerName: '汐',
    wallClock: () => 1000,
    villagerProfiles: [
      {
        at: INSIDE,
        routine: [{ id: 'altar', label: '去祭坛', target: ALTAR, dwellMs: 5000 }],
      },
      {
        at: OUTSIDE,
        routine: [{ id: 'altar', label: '去祭坛', target: ALTAR, dwellMs: 5000 }],
      },
    ],
  });
}

/** 走一条命令。命令入口是 enqueue + update，apply 是私有的。 */
function run(sim: Simulation, command: Parameters<Simulation['enqueue']>[0]) {
  sim.enqueue(command);
  const results = sim.update(16);
  return results[results.length - 1]!;
}

// ------------------------------------------------------- 回答不堵

test('她站在呼吸段里也说「下雨了，快躲」：世界在回答玩家，不是在自言自语', () => {
  // 「下雨吧」是**玩家说的一句话**，`setWeather` 因此去叫醒户外的人。
  // 她此刻站在留白里，那句话照样得送到——不然就是玩家说了话世界不理。
  //
  // 挑下雨这一处来钉，是因为它同时满足两件事：气泡写在**她的位置**上
  // （于是「站在留白里的人说不说话」真的被观测到），而触发者是玩家
  // （于是它落在「回答」这一侧，不在「自己开口」那一侧）。
  const sim = makeSim();
  sim.update(16);
  assert.equal(sim.snapshot().villagers[0]!.mode, 'idle', '她还没到作息的点，人停在原地');

  const result = run(sim, { kind: 'setWeather', weather: 'rain' });
  assert.equal(result.ok, true, '下雨这条神谕本身不该被呼吸段拦');

  const villager = sim.snapshot().villagers[0]!;
  assert.equal(villager.mode, 'sheltering', '她听了话，动身去躲');
  assert.equal(villager.bubble, '下雨了，快躲！', '站在留白里的她也得听见世界回话');
});

test('没有呼吸段时一样说：这句话不是呼吸段带来的新行为', () => {
  // 少了这一条，上一条就可能靠「呼吸段里也会说」蒙混过去——
  // 而真相是这句话从来不问呼吸。对照组钉的正是「不是新长的」。
  const plain = new Simulation({
    grid: new WorldGrid({
      width: 24,
      height: 18,
      border: 1,
      zones: [],
      regions: [{ id: 'shoal', x: 1, y: 1, w: 11, h: 16 }],
    }),
    buildings: [SHELTER],
    altar: ALTAR,
    villagerName: '汐',
    wallClock: () => 1000,
    villagerProfiles: [
      { at: INSIDE, routine: [{ id: 'altar', label: '去祭坛', target: ALTAR, dwellMs: 5000 }] },
      { at: OUTSIDE, routine: [{ id: 'altar', label: '去祭坛', target: ALTAR, dwellMs: 5000 }] },
    ],
  });
  plain.update(16);
  run(plain, { kind: 'setWeather', weather: 'rain' });

  const villager = plain.snapshot().villagers[0]!;
  assert.equal(villager.mode, 'sheltering', '老区域照样躲');
  assert.equal(villager.bubble, '下雨了，快躲！', '说的话一字不差');
});

// ------------------------------------------------------- 门还在

test('同一次下雨里那道门还在：回答不是靠拆门换来的', () => {
  // 上一条会诱出一个坏修法：「让她说得了话」——把 `canTakeWork` 里的
  // `inBreathing` 也摘掉。于是留白里照样回话，可派活那道门一起没了。
  //
  // 断言落在「活给了外头那个人」而不是「被拒」：呼吸段是**改派**，
  // 不是拒绝。写成被拒就试不出摘没摘——摘了也一样派得出去，只是派错了人。
  //
  // 这里挑的还是最难分辨的一瞬：躲雨的人是 `sheltering`，而 `isFree` 认它——
  // 「她有空」和「她接得下」两问在这里分开（见 `canTakeWork` 的注释）。
  // 只有呼吸段这一条还拦着，所以这一拍最能试出摘没摘。
  const sim = makeSim();
  sim.update(16);
  run(sim, { kind: 'setWeather', weather: 'rain' });
  assert.equal(sim.snapshot().villagers[0]!.mode, 'sheltering', '留白里的人正在去躲雨的路上');
  assert.equal(sim.snapshot().villagers[1]!.mode, 'sheltering', '外头的人也在躲');

  const result = run(sim, { kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  assert.equal(result.ok, true, '世界上还有人，这条神谕不该被拒');

  const after = sim.snapshot();
  assert.equal(after.villagers[0]!.taskId, null, '站在留白里的人照旧不接活');
  assert.notEqual(after.villagers[1]!.taskId, null, '活给了外头那个人，没有因为谁在留白里被拒');
});
