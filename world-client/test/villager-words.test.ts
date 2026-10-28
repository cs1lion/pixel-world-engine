import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import {
  ALTAR,
  buildWorld,
  placeBlueprint,
  type BuiltWorld,
} from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { syncCommand } from './feed-helpers.ts';
import { NOT_SOMEWHERE, idleLabel, villagerModeLabel } from '../src/world/villager-words.ts';
import type { TaskRecord } from '../src/world/types.ts';

/** 状态行/日报那句「她在干什么」，不许在她没牌子时替她安一个去处。
 *
 * 这条规矩在日报那边已经栽过一次并修好了（`report.ts` 的 `NOT_SOMEWHERE`），
 * 可状态行还是老写法 `routine ?? '在祭坛边闲逛'`——**两处各写各的，就一处修一处漏**。
 * 所以这里连状态行那一支一起钉，并把共用的那个判据（`atAltar`）一起钉。
 *
 * 缺陷形态：`routine === null` 而人不在祭坛时，屏上那句说她在祭坛。什么时候
 * 会这样：上游撤单（`abandonActiveTask` 把 `routineLabel` 清成 null，人按
 * `restoreOutOfBuilding` 挪到铺子门口）、原地办完（`finishInPlace` 同样清 null），
 * 以及 `stepIdle` 里所有落点都走不通时那一拍——那一种 `routineLabel` 会**一直**
 * 是 null。她站在铺子门口，屏上说她在祭坛边闲逛。
 */

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);
const STEP = 100;

function makeSim(): { sim: Simulation; grid: BuiltWorld['grid'] } {
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
  return { sim, grid: world.grid };
}

/** 把一条上游活派给她，等她真的走进工位（mode=working、visible=false）。 */
function dispatchAndWork(sim: Simulation, taskId: string): void {
  sim.enqueue(
    syncCommand({ tasks: [{ id: taskId, kind: 'writing', title: '上游来的活' }] }),
  );
  sim.update(STEP);
  for (let i = 0; i < 600; i += 1) {
    if (sim.snapshot().villager.mode === 'working') return;
    sim.update(STEP);
  }
  throw new Error('没能把角色送进工位');
}

/** 跑固定步数。 */
function tick(sim: Simulation, times: number): void {
  for (let i = 0; i < times; i += 1) sim.update(STEP);
}

test('上游撤单那一刻：她没牌子也不在祭坛，嘴里不许说她在祭坛', () => {
  const { sim } = makeSim();
  dispatchAndWork(sim, 'c_words');

  sim.enqueue(syncCommand({ cancelled: ['c_words'] }));
  sim.update(STEP);

  const snap = sim.snapshot();
  const villager = snap.villager;
  assert.equal(villager.mode, 'idle', '前置：状态机收回空闲');
  assert.equal(villager.routine, null, '前置：这一刻她嘴上没牌子');

  const atAltarCell =
    Math.floor(villager.pos.x) === snap.altar.x && Math.floor(villager.pos.y) === snap.altar.y;
  assert.equal(atAltarCell, false, '前置：她人在铺子门口，不在祭坛');

  // 这一句就是屏上状态行说的原话。它不许提「祭坛」。
  const said = villagerModeLabel(villager, snap, undefined, null);
  assert.equal(said, NOT_SOMEWHERE, `她不在祭坛又没牌子，状态行却说「${said}」`);
  assert.ok(!said.includes('祭坛'), `「${said}」替她安了一个没查过的去处`);
});

test('没牌子而她真在祭坛那一格：照说在祭坛，不升级成「没个准地方」', () => {
  const { sim } = makeSim();
  // 开局她就在祭坛边上；先让她真的站上祭坛格。
  const snap = sim.snapshot();
  const villager = snap.villager;
  assert.equal(villager.routine, null, '前置：开局还没排到第一块牌子');

  const onAltar = {
    ...villager,
    pos: { x: snap.altar.x + 0.2, y: snap.altar.y + 0.2 },
  };
  assert.equal(idleLabel(onAltar, snap), '在祭坛边闲逛', '人在祭坛格上才说祭坛');
});

test('有牌子时原样说牌子，不因为她在哪儿改口', () => {
  const { sim } = makeSim();
  const snap = sim.snapshot();
  const villager = snap.villager;
  const labelled = { ...villager, routine: '在街口站着看了一会儿' };
  assert.equal(idleLabel(labelled, snap), '在街口站着看了一会儿', '牌子是世界自己的说法');
});

test('其余各 mode 都带着世界自己的状态，没有可编的空档', () => {
  const { sim } = makeSim();
  const snap = sim.snapshot();
  const villager = snap.villager;
  const cases: readonly (readonly [string, string])[] = [
    ['saluting', '正向神谕行礼'],
    ['toWork', '赶往 齿轮塔'],
    ['working', '在 齿轮塔 干活「抄一段书」'],
    ['delivering', '正在交付'],
    ['toAltar', '赶回祭坛'],
    ['sheltering', '跑向屋檐下躲雨'],
    ['bearingDecree', '举着急件跑向祭坛'],
  ];
  const task: TaskRecord = {
    id: 't',
    kind: 'writing',
    summary: '抄一段书',
    buildingId: 'b1',
    source: 'sandbox',
    status: 'in_progress',
    createdAt: 0,
    completedAt: null,
    blockedQuestion: null,
    workerId: 'v0',
  };
  for (const [mode, expected] of cases) {
    const one = { ...villager, mode } as typeof villager;
    const own: TaskRecord | undefined =
      mode === 'working' || mode === 'toWork' ? task : undefined;
    assert.equal(
      villagerModeLabel(one, snap, own, '齿轮塔'),
      expected,
      `mode=${mode} 该说「${expected}」`,
    );
  }
  // 铺子查不到时不编铺子名，也**不编地点**。
  const toWork = { ...villager, mode: 'toWork' } as typeof villager;
  assert.equal(villagerModeLabel(toWork, snap, undefined, null), '赶路');
  const working = { ...villager, mode: 'working' } as typeof villager;
  assert.equal(
    villagerModeLabel(working, snap, undefined, null),
    '正在干活',
    '没有铺子时只说她在干活，不给她安一个去处',
  );
  const withTask = { ...villager, mode: 'working' } as typeof villager;
  assert.equal(
    villagerModeLabel(withTask, snap, task, null),
    '正在办「抄一段书」',
    '有活就说活，不提地点',
  );
});

test('working 而没有铺子时，不许说她在祭坛边——她人不在那儿', () => {
  // 一条真事的回归。这一支曾经说「在祭坛边办「xxx」」，而**她不在祭坛**：
  // 原地办的那种活（`startInPlace`，`simulation.ts:1666`）`path = []`，
  // 根本不挪人——她站在接到活那一刻的位置，那一刻她可以在世界任何一格。
  //
  // 而这条路常见得很：`tasks.ts:13` 的 quick 活 `venue: 'in_place'`，
  // **每一条 quick 都走它**。两条来路都通到 `startInPlace`：神谕派活
  // （`simulation.ts:1874`——「顺手看一眼」那个按钮 `index.html:628` 发的
  // 就是这条命令）与上游事件流（`simulation.ts:1614`）。不是罕见状态，是常态。
  //
  // 上一版还把「在祭坛边办「」」写成了 `assert.equal` 的期望值——那句话本身
  // 是假的，而它是一条会红的测试。谁想修这句假话，得先改测试。锁错了方向
  // 比不锁更糟：不锁只是没人拦，锁错了是拦着人不让修。
  const { sim } = makeSim();
  const snap = sim.snapshot();
  // 把她放到离祭坛很远的一格上：`atAltar` 为假，世界对她的位置只有坐标。
  const far = {
    ...snap.villager,
    mode: 'working' as const,
    pos: { x: snap.altar.x + 9, y: snap.altar.y + 9 },
  };
  const task: TaskRecord = {
    id: 't',
    kind: 'writing',
    summary: '抄一段书',
    buildingId: null,
    source: 'sandbox',
    status: 'in_progress',
    createdAt: 0,
    completedAt: null,
    blockedQuestion: null,
    workerId: 'v0',
  };
  const said = villagerModeLabel(far, snap, task, null);
  assert.ok(!said.includes('祭坛'), `她不在祭坛格上，屏上却说「${said}」`);
  assert.ok(said.includes('抄一段书'), '活的名字照常说：那是世界真有的一条');
  assert.ok(!said.includes('「」'), `空引号不是一句话：「${said}」`);
});

test('赶路的四支说得像正在赶路，不说已经到达', () => {
  // 这四个 mode 的世界状态全是「路还没走完」：`walk()` 只在 path 空掉那一刻
  // 才翻 mode（`simulation.ts` 的 toWork / toAltar / sheltering 三支都是这个
  // 形状）。所以这四支的说法必须带进行时的动词。
  //
  // 曾经 toAltar 说「回到祭坛」、sheltering 说「跑到屋檐下躲雨」——两个都断言
  // 人已经到了，而那一刻她还在半路上，状态行每帧都这么播。同开关里 toWork 的
  // 「赶往」与 bearingDecree 的「跑向」本来就是对的写法，照着办。
  const { sim } = makeSim();
  const snap = sim.snapshot();
  const villager = snap.villager;
  const walking = ['toWork', 'toAltar', 'sheltering', 'bearingDecree'] as const;
  for (const mode of walking) {
    const one = { ...villager, mode } as typeof villager;
    const said = villagerModeLabel(one, snap, undefined, '齿轮塔');
    assert.ok(
      /(赶往|赶回|跑向|赶路)/.test(said),
      `mode=${mode} 该是进行中的说法，实际「${said}」`,
    );
  }
});

test('活体：撤单之后屏上那一行确实不说祭坛', () => {
  const { sim } = makeSim();
  dispatchAndWork(sim, 'c_live');
  const before = sim.snapshot().villager;
  assert.equal(before.mode, 'working', '前置：在干活');

  sim.enqueue(syncCommand({ cancelled: ['c_live'] }));
  sim.update(STEP);

  const snap = sim.snapshot();
  const said = villagerModeLabel(snap.villager, snap, undefined, null);
  assert.equal(said, NOT_SOMEWHERE);
  // 世界效果不受影响：人真的被挪出了建筑、看得见、也真能走动。
  assert.equal(snap.villager.visible, true, '恢复可见');
  tick(sim, 120);
  const moved = Math.hypot(
    sim.snapshot().villager.pos.x - snap.villager.pos.x,
    sim.snapshot().villager.pos.y - snap.villager.pos.y,
  );
  assert.ok(moved > 0.5, `撤单后该能走动，实际位移 ${moved.toFixed(2)}`);
});
