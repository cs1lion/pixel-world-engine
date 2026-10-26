import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { CarryItem } from '../src/world/types.ts';

/**
 * 渡有仪式（SPEC_V2 §4.6）在**跑着的世界**里长什么样。
 *
 * `region-gate.test.ts` 测的是寻路这道接缝（`WorldGrid.path(start, goal, accept?)`）；
 * 这里测的是同一个判定接进 `Simulation` 之后还作数：角色按作息想去对岸，
 * 兜里没灯就走不到，兜里有灯就走得到。
 *
 * 为什么值得单开一条：接缝绿了不代表世界绿了。`pathFor` 有六个调用点，
 * 漏接一个就是「世界上有一道谁都看得见、只有她视而不见的门」。
 */

/** 一张 12×10 的地，可走区 x∈[1,10]、y∈[1,8]；x=6 整列是一道要灯的门。 */
function gatedGrid(requires: CarryItem | null): WorldGrid {
  return new WorldGrid({
    width: 12,
    height: 10,
    border: 1,
    zones: [],
    regions: [{ id: 'tide_gate', x: 6, y: 1, w: 1, h: 8, requires }],
  });
}

const LEFT = { x: 2, y: 5 };
const RIGHT = { x: 9, y: 5 };

/** 一个住在左岸、作息是「去对岸」的角色。 */
function makeSim(requires: CarryItem | null): Simulation {
  return new Simulation({
    grid: gatedGrid(requires),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    wallClock: () => 1000,
    villagerProfiles: [
      {
        at: LEFT,
        routine: [{ id: 'promenade', label: '去对岸', target: RIGHT, dwellMs: 300 }],
      },
    ],
  });
}

/** 跑到她该动的时候。作息第一拍在 1200ms，之后每 300ms 一拍。 */
function runFor(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) sim.update(16);
}

test('对岸要灯而她没带：世界如实让她留在原处，不给她一条穿门的路', () => {
  const sim = makeSim('lamp');
  runFor(sim, 400);

  const villager = sim.snapshot().villagers[0]!;
  assert.equal(villager.pos.x, LEFT.x, '没带凭证的人不该被挪到对岸去');
  assert.equal(villager.pos.y, LEFT.y);
});

test('她带了灯：作息照走，人真的到对岸去', () => {
  const sim = makeSim('lamp');
  // 先把灯放进她兜里——否则这道门对她就是永远的墙，而那是死状态不是世界。
  sim.enqueue({ kind: 'setCarries', villagerId: 'v0', carries: ['lamp'] });
  runFor(sim, 400);

  const villager = sim.snapshot().villagers[0]!;
  assert.deepEqual(villager.pos, RIGHT, '带了凭证就必须过得去，而且真的走到');
});

test('这道门不要灯：两手空空的人也过得去', () => {
  // 区域声明了 requires: null，或者根本没声明——两者都不能变成门。
  for (const requires of [null] as const) {
    const sim = makeSim(requires);
    runFor(sim, 400);
    assert.deepEqual(sim.snapshot().villagers[0]!.pos, RIGHT, `requires=${requires} 不该拦人`);
  }
});

test('带错了也过不去：灯过不了要鞋的门', () => {
  const sim = makeSim('shoes');
  sim.enqueue({ kind: 'setCarries', villagerId: 'v0', carries: ['lamp'] });
  runFor(sim, 400);

  assert.deepEqual(sim.snapshot().villagers[0]!.pos, LEFT, '凭证不对等于没有');
});

// ------------------------------------------------------------------ 命令

test('setCarries 只认闭集里的词：写错的一个字都进不了世界', () => {
  const sim = makeSim('lamp');
  sim.enqueue({
    kind: 'setCarries',
    villagerId: 'v0',
    carries: ['torch' as CarryItem],
  });
  // 命令入口是队列，结果在下一拍的结算里。
  const results = sim.update(16);
  const last = results[results.length - 1]!;
  assert.equal(last.ok, false, '白名单外的词必须被拒');
  assert.match(last.message, /lamp、shoes/);
  assert.deepEqual(sim.snapshot().villagers[0]!.carries, [], '被拒之后兜里不该多出东西');
});

// ------------------------------------------------------------------ 接线

test('Simulation 里每一次给角色寻路都过 pathFor：没有绕过门的后门', () => {
  // 这条扫描守的是「漏接一个调用点」。漏接的那种 bug 在单元测试里看不见——
  // 世界上多一道谁都看得见、只有她视而不见的门。
  const source = readFileSync(new URL('../src/world/simulation.ts', import.meta.url), 'utf8');
  const direct = source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    // pathFor 自己那一行不算；注释里提到 grid.path 的说明也不算。
    .filter(({ line }) => line.startsWith('this.grid.path(') || line.includes('= this.grid.path('))
    .map(({ line, number }) => `${number}: ${line}`);
  assert.deepEqual(direct, [], `这些寻路绕过了门：\n${direct.join('\n')}`);
});
