import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { WorldGrid } from '../src/world/grid.ts';
import { placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { CarryItem, VillagerMode } from '../src/world/types.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

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
function gatedGrid(requires: CarryItem | null | undefined): WorldGrid {
  // 不给 requires 就是老设定集的样子：那个字段整个不存在。
  const region =
    requires === undefined
      ? { id: 'tide_gate', x: 6, y: 1, w: 1, h: 8 }
      : { id: 'tide_gate', x: 6, y: 1, w: 1, h: 8, requires };
  return new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [region] });
}

const LEFT = { x: 2, y: 5 };
const RIGHT = { x: 9, y: 5 };

/** 一个住在左岸、作息是「去对岸」的角色。 */
function makeSim(requires: CarryItem | null | undefined): Simulation {
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

test('门没要凭证：声明 null 和不声明，两手空空都过得去', () => {
  // 两种都要测：`requires: null` 是明说不设卡，不声明是老设定集的样子。
  // 只测一种，另一种回退分支错了没人知道。
  for (const requires of [null, undefined] as const) {
    const sim = makeSim(requires);
    runFor(sim, 400);
    assert.deepEqual(
      sim.snapshot().villagers[0]!.pos,
      RIGHT,
      `requires=${String(requires)} 不该拦人`,
    );
  }
});

test('带错了也过不去：灯过不了要鞋的门', () => {
  const sim = makeSim('shoes');
  sim.enqueue({ kind: 'setCarries', villagerId: 'v0', carries: ['lamp'] });
  runFor(sim, 400);

  assert.deepEqual(sim.snapshot().villagers[0]!.pos, LEFT, '凭证不对等于没有');
});

/**
 * 一间铺子在没门的那半，祭坛在门那半。
 *
 * 她得先有活干、走到铺子、干完，才会进 `delivering → toAltar` 那一跳——
 * 而那正是「到不了」被说成「已经到了」的地方。
 */
function makeDeliverySim(): Simulation {
  const grid = new WorldGrid({
    width: 40,
    height: 24,
    border: 1,
    zones: [
      // 铺子得落在自己的分区里，否则 checkPlacement 直接拒（outOfZone）。
      { id: 'industry', x: 3, y: 3, w: 12, h: 12 },
      { id: 'altar', x: 28, y: 6, w: 8, h: 8 },
    ],
    regions: [{ id: 'tide_gate', x: 20, y: 1, w: 1, h: 22, requires: 'lamp' }],
  });
  const altar = { x: 34, y: 12 };
  const blueprint = blueprints.get('code_forge');
  assert.ok(blueprint !== undefined, '得有一间铺子可摆');
  const placed = placeBlueprint(grid, blueprint, 'b_gate', altar, { x: 6, y: 9 });
  assert.ok(placed !== null, '铺子必须摆得下');
  return new Simulation({
    grid,
    buildings: [placed.building],
    altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
    villagerProfiles: [
      {
        at: { x: 6, y: 7 },
        routine: [{ id: 'altar', label: '在祭坛边', target: { x: 6, y: 7 }, dwellMs: 999_999 }],
      },
    ],
  });
}

/** 跑到她进入某个状态，或超时。 */
function runUntil(sim: Simulation, mode: VillagerMode, ticks = 6000): boolean {
  for (let i = 0; i < ticks; i += 1) {
    if (sim.snapshot().villagers[0]!.mode === mode) return true;
    sim.update(16);
  }
  return false;
}

test('门在祭坛那一侧而她没带凭证：交付不蒙成功，话说在明处', () => {
  // 这是这道门最坏的漏法：`path()` 在目标不可走时用 nearestWalkable 兜底，
  // 而那个兜底原来不认识门——于是目标落进门里，A* 找不到路，返回空数组，
  // 而 delivering → toAltar 把「空数组」当成「已经到了」。
  // 结果是她人还在没门的那一半，东西已经交付了。那不是「绕开」，是作弊。
  const sim = makeDeliverySim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '修一盏灯' });
  assert.ok(runUntil(sim, 'delivering'), '先得让她干完活、走到交付那一步');

  // 关键在**再走几拍**：delivering → toAltar 是下一拍才跳的。
  // 少了这几拍，断言会停在 delivering 上，两边都绿——那条测试就白写了。
  const teleported = runUntil(sim, 'idle', 400);
  assert.equal(teleported, false, '到不了祭坛不能算交付成功');
  const after = sim.snapshot().villagers[0]!;
  assert.ok(after.pos.x < 20, `她必须还在没门的那一半，实际 x=${after.pos.x}`);
});

test('带了灯就走得到祭坛：同一张图，交付真的发生', () => {
  // 上一条的对照组。没有它，「不蒙成功」可能只是因为世界根本不动。
  const sim = makeDeliverySim();
  sim.enqueue({ kind: 'setCarries', villagerId: 'v0', carries: ['lamp'] });
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '修一盏灯' });
  assert.ok(runUntil(sim, 'delivering'), '先得让她干完活');

  assert.ok(runUntil(sim, 'idle', 8000), '带了凭证就必须真的交付完');
  const after = sim.snapshot().villagers[0]!;
  assert.ok(after.pos.x >= 20, `她该被送到门那一边，实际 x=${after.pos.x}`);
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

// 这条扫描守的是「漏接一个调用点」。漏接的那种 bug 在单元测试里看不见——
// 世界上多一道谁都看得见、只有她视而不见的门。
test('Simulation 里每一次给角色寻路都过 pathFor：没有绕过门的后门', () => {
  const source = readFileSync(new URL('../src/world/simulation.ts', import.meta.url), 'utf8');
  const direct = source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    // pathFor 自己那一行不算；注释里提到 grid.path 的说明也不算。
    .filter(({ line }) => line.startsWith('this.grid.path(') || line.includes('= this.grid.path('))
    .map(({ line, number }) => `${number}: ${line}`);
  assert.deepEqual(direct, [], `这些寻路绕过了门：\n${direct.join('\n')}`);
});

// ---------------------------------------------- 门要的东西，人说得出口

test('神谕说「给她一盏灯」：门当场就开了，人真的过得去', () => {
  // 整条链：意图按名字点人 → 世界命令按 id → 寻路过门。
  // 少任何一环，这道门就是一面谁也打不开的墙——那比没有门更糟。
  // 这也是 `setCarries` 存在的理由：没有写的入口，carries 永远是空的。
  const sim = makeSim('lamp');
  sim.enqueue({
    kind: 'intent',
    intent: { kind: 'carry', villager: '莞尔', carries: ['lamp'] },
    raw: '给莞尔一盏灯',
  });
  runFor(sim, 400);

  assert.deepEqual(sim.snapshot().villagers[0]!.pos, RIGHT, '凭证交到她手上，她就必须过得去');
});

test('点了世界上没有的名字：拒，不顺手把灯递给别人', () => {
  const sim = makeSim('lamp');
  sim.enqueue({
    kind: 'intent',
    intent: { kind: 'carry', villager: '阿绣', carries: ['lamp'] },
    raw: '给阿绣一盏灯',
  });
  const results = sim.update(16);
  const last = results[results.length - 1]!;

  assert.equal(last.ok, false, '没这个人就不能办');
  assert.deepEqual(sim.snapshot().villagers[0]!.carries, [], '更不能因此把灯塞给站在边上的那位');
});

test('说「让她两手空空」：门跟着关上，不是只开不关', () => {
  // 只有给没有收，那道门就永远开着——世界再也回不到没人有灯的样子。
  const sim = makeSim('lamp');
  sim.enqueue({ kind: 'setCarries', villagerId: 'v0', carries: ['lamp'] });
  sim.enqueue({
    kind: 'intent',
    intent: { kind: 'carry', villager: '莞尔', carries: [] },
    raw: '让莞尔两手空空',
  });
  runFor(sim, 400);

  assert.deepEqual(sim.snapshot().villagers[0]!.carries, [], '灯得真的收回去');
  assert.deepEqual(sim.snapshot().villagers[0]!.pos, LEFT, '没收缴凭证她就该留在原处');
});

test('世界上有两个同名的人：拒，不把灯递给第一个', () => {
  // `villagerNames` 是调用方给的，读档也不查重名——所以「两个莞尔」进得来。
  // 名字点人用的是 `.find()`，它会把手里的东西交给排在前头的那位。
  // 而 `intent-schema.ts` 的 carry 注释答应的是「名字重了是世界的事——它拒，
  // 不替用户挑」，`demolishTargetOf` 对同模板的两栋楼正是这么办的。
  // 承诺与行为对不上，比没有承诺更糟。
  const sim = new Simulation({
    grid: gatedGrid('lamp'),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    villagerNames: ['莞尔', '莞尔'],
    wallClock: () => 1000,
    villagerProfiles: [
      {
        at: LEFT,
        routine: [{ id: 'promenade', label: '去对岸', target: RIGHT, dwellMs: 300 }],
      },
      {
        at: LEFT,
        routine: [{ id: 'promenade', label: '去对岸', target: RIGHT, dwellMs: 300 }],
      },
    ],
  });
  sim.enqueue({
    kind: 'intent',
    intent: { kind: 'carry', villager: '莞尔', carries: ['lamp'] },
    raw: '给莞尔一盏灯',
  });
  const results = sim.update(16);
  const last = results[results.length - 1]!;

  assert.equal(last.ok, false, '分不出是哪一个，就不能办');
  assert.match(last.message, /有 2 个人叫「莞尔」/, '得说清是为什么办不了');
  assert.match(last.message, /v0、v1/, '得把两个都点出来，用户才知道该说哪个');
  assert.deepEqual(
    sim.snapshot().villagers.map((villager) => villager.carries),
    [[], []],
    '谁都不该因此拿到灯',
  );
});
