/**
 * 作息说出去的话，和她真正做的事，必须是同一件。
 *
 * `routines.ts` 自己把这条立成了规矩：
 *
 *     世界可以在做不到时说「现在不行」，但不能一边说一边做别的——
 *     那句话是给外面看的唯一凭据，说谎比不去更糟。
 *
 * `routineFor` 守着它（潮汐不成立就借锚点的 id/label/target 一起退）。
 * `Simulation` 的交付路也守着它（`simulation.ts` 那段「空数组有两种意思」）。
 *
 * 但作息派活那一轮漏了：牌子先挂出去，路后问。`pathFor` 返回空数组时，
 * `routineLabel` 已经写着下一拍的説法，而她还站在原处——渡有仪式让
 * 「走不到」真的会出现（区域要凭证，她兜里没有），于是这句谎不是理论上的。
 *
 * 这个文件钉三件事：
 *   1. 走不到的那一拍，不许把话先说出去；
 *   2. 她本来就站在落点上的那一拍，也不挂话（原先就是对的，别改坏）；
 *   3. 一条路走不通时世界接着找下一条，不是就此闭嘴。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { CarryItem } from '../src/world/types.ts';

/**
 * 一张 12×10 的地，可走区 x∈[1,10]、y∈[1,8]；x=6 整列是一道要灯的门。
 * 与 `gate-walk.test.ts` 同一张图——同一个判定，这里问的是它漏嘴的那一半。
 */
function gatedGrid(requires: CarryItem | null | undefined): WorldGrid {
  const region =
    requires === undefined
      ? { id: 'tide_gate', x: 6, y: 1, w: 1, h: 8 }
      : { id: 'tide_gate', x: 6, y: 1, w: 1, h: 8, requires };
  return new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [region] });
}

const LEFT = { x: 2, y: 5 };
const RIGHT = { x: 9, y: 5 };

/** 住在左岸，作息是「去对岸」。落点是可走的——只是中间那道门她过不去。 */
function makeSim(
  routine: readonly { id: string; label: string; target: { x: number; y: number }; dwellMs: number }[],
): Simulation {
  return new Simulation({
    grid: gatedGrid('lamp'),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    wallClock: () => 1000,
    villagerProfiles: [{ at: LEFT, routine: routine as never }],
  });
}

function runFor(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) sim.update(16);
}

test('走不到的那一拍，话不许先说出去', () => {
  // 落点可走、门过不去：她留在原处。这时牌子若写着「去对岸」，
  // 读镇志的人会以为她去了——而她半步也没动。
  const sim = makeSim([{ id: 'promenade', label: '去对岸', target: RIGHT, dwellMs: 300 }]);
  runFor(sim, 400);

  const villager = sim.snapshot().villagers[0]!;
  assert.deepEqual(villager.pos, LEFT, '没带凭证她就该留在原处');
  assert.equal(villager.routine, null, '人没动，就不该挂着那一拍的説法');
});

test('她本来就站在落点上：那一拍也不挂话', () => {
  // 这一条现在是绿的。它守的是「别为了修上面那条，把话提前到选点之前挂」。
  const sim = makeSim([{ id: 'promenade', label: '去对岸', target: LEFT, dwellMs: 300 }]);
  runFor(sim, 400);

  const villager = sim.snapshot().villagers[0]!;
  assert.deepEqual(villager.pos, LEFT);
  assert.equal(villager.routine, null, '站在落点上不算去过');
});

test('一条路不通，接着找下一条：不是就此闭嘴', () => {
  // 第一拍去不了对岸，第二拍在左岸——她该走成第二拍，并挂着第二拍的话。
  // 只修「走不通不挂话」会把循环整个断在这儿：她再也不去任何地方。
  const sim = makeSim([
    { id: 'promenade', label: '去对岸', target: RIGHT, dwellMs: 300 },
    { id: 'garden', label: '去左岸的田边', target: { x: 3, y: 7 }, dwellMs: 300 },
  ]);
  runFor(sim, 400);

  const villager = sim.snapshot().villagers[0]!;
  assert.deepEqual(villager.pos, { x: 3, y: 7 }, '第二条路走得通，她就该走');
  assert.equal(villager.routine, '去左岸的田边', '挂着的必须是真正走了的那一句');
});
