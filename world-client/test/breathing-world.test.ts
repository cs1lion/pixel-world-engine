import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import { syncCommand } from './feed-helpers.ts';

/**
 * 呼吸段（SPEC_V2 §4.7）落进世界：呼吸区里不派活、不触发随机事件、不弹提示；
 * 氛围实体（萤火、猫）照常。
 *
 * 这里测的是**命令入口这道接缝**（SPEC_V2 §5 的第一优先）。「哪一格在呼吸」
 * 是网格的事（`breathing.test.ts`），这里只管世界因此少了什么。
 *
 * 与 §4.6 的抵押同一条规矩：派活有三条路径（神谕、上游、自己的排队单），
 * 必须过同一道门。漏掉任一条就会出现「神谕派不下去，上游照样派」。
 */

/** 一张 24×18 的地。左半边（x∈[1,11]）是呼吸段，右半边不是。 */
function grid(breathing: boolean): WorldGrid {
  const region =
    breathing === false
      ? { id: 'shoal', x: 1, y: 1, w: 11, h: 16 }
      : { id: 'shoal', x: 1, y: 1, w: 11, h: 16, breathing: true };
  return new WorldGrid({ width: 24, height: 18, border: 1, zones: [], regions: [region] });
}

const INSIDE = { x: 4, y: 8 };
const OUTSIDE = { x: 18, y: 8 };
const ALTAR = { x: 20, y: 9 };

/** 站在呼吸段里一个、站在外头一个。作息都指着外头——想出去照样出得去。 */
function makeSim(breathing: boolean, bothInside = false): Simulation {
  const second = bothInside ? INSIDE : OUTSIDE;
  return new Simulation({
    grid: grid(breathing),
    buildings: [],
    altar: ALTAR,
    villagerName: '汐',
    wallClock: () => 1000,
    villagerProfiles: [
      { at: INSIDE, routine: [{ id: 'altar', label: '去祭坛', target: OUTSIDE, dwellMs: 5000 }] },
      {
        at: second,
        routine: [{ id: 'altar', label: '在祭坛边坐着', target: second, dwellMs: 5000 }],
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

// ------------------------------------------------------------------ 不派活

test('站在呼吸段里的人接不到活，活落到外头的人头上', () => {
  // 留白也是规则，不是没内容。她正站在那一屏呼吸里，就不该被一件活拽走。
  const sim = makeSim(true);
  const result = run(sim, { kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  assert.equal(result.ok, true, '世界上还有能干的人，这条神谕不该被拒');

  const after = sim.snapshot();
  assert.equal(after.villagers[0]!.taskId, null, '呼吸段里的人不该被派活');
  assert.notEqual(after.villagers[1]!.taskId, null, '活应该落到外头的人头上');
});

test('没有呼吸段时照旧派给她：这道门不是凭空多出来的', () => {
  // 少了这一条，「不派活」就可能变成「谁都不派」——那是世界停了，不是留白。
  const sim = makeSim(false);
  run(sim, { kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  assert.notEqual(sim.snapshot().villagers[0]!.taskId, null, '没声明 breathing 的老区域不设卡');
});

test('只剩呼吸段里的人：神谕排给她，等她走出留白才开工', () => {
  // 与「每个人都抵押了名字」**不是**同一条规矩。抵押是永久状态，排进她的队列
  // 等于把单子埋了；呼吸段是此刻的事，她照旧会被作息带走，所以排队是对的。
  // 塞进队列不会埋单一——`pumpPending` 每一拍都问一次，她一出来就开工。
  const sim = makeSim(true);
  sim.enqueue({ kind: 'setNameState', villagerId: 'v1', nameState: 'pawned' });
  sim.update(16);

  const result = run(sim, { kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  assert.equal(result.ok, true, '世界上还有人，这条神谕该排着，不该被拒');
  assert.equal(sim.snapshot().villagers[0]!.taskId, null, '呼吸段里的人不立即开工');
  assert.equal(sim.snapshot().pending.length, 1, '单子排在她名下');

  // 走出去之后必须真的开工。数着拍子等她：作息第一拍在 1200ms，
  // 之后一路滑到外头——所以不是第几拍一定发生，而是**会发生**。
  // 少这一条，「留白」就会变成一单躺到存档过期的死单，
  // 而用户看到的是「已经排上了」。
  let started = false;
  for (let i = 0; i < 600 && !started; i += 1) {
    sim.update(16);
    if (sim.snapshot().villagers[0]!.taskId !== null) started = true;
  }
  assert.ok(started, '走出留白后排着的活要开工');
  assert.equal(sim.snapshot().pending.length, 0, '开过工的单一秒都不该留在队列里');
});

test('上游派的那条路也过同一道门：神谕派不下去，上游也别想派', () => {
  // 抵押那条在这里栽过一次——`canTakeWork` 漏了一处，于是「神谕派不下去，
  // 上游照样派」。呼吸段若只在 dispatch 那一支卡，同一件事会重演一次。
  const sim = makeSim(true);
  sim.enqueue(
    syncCommand({ tasks: [{ id: 't1', kind: 'quick', title: '上游的活' }], connected: true }),
  );
  sim.update(16);

  const after = sim.snapshot();
  assert.equal(after.villagers[0]!.taskId, null, '呼吸段里的人不接上游的活');
  assert.notEqual(after.villagers[1]!.taskId, null, '外头的人照常接');
});

// ------------------------------------------------------- 不触发随机事件、不弹提示

test('呼吸段里的人不去举急件：留白里不弹提示', () => {
  // 急件是世界自己发起的一件事（`awaitingDecree` 从上游状态里长出来），
  // 还会带一句「急件！」的气泡——它同时是「随机事件」和「提示」。
  // 呼吸段里两样都不该有：那一屏留白是给人歇的，不是给人派活的。
  //
  // 两个人都站在留白里：`stepDecrees` 挑的是「第一个闲人」，不看抵押。
  // 只把一个关进去，另一个照样会被派去举牌——那测试就绿了，而门没装上。
  const sim = makeSim(true, true);
  sim.enqueue(
    syncCommand({
      tasks: [
        { id: 'c_block', kind: 'quick', title: '要删掉 ./temp 吗？', question: '要删掉 ./temp 吗？' },
      ],
      connected: true,
    }),
  );
  sim.update(16);

  let sawBearer = false;
  for (let i = 0; i < 200; i += 1) {
    sim.update(100);
    if (sim.snapshot().villagers.some((v) => v.mode === 'bearingDecree')) sawBearer = true;
  }
  assert.equal(sawBearer, false, '所有人都站在一片留白里，不该有人跑去举急件');
});

test('没有呼吸段时照旧有人举急件：这道门不是凭空多出来的', () => {
  // 少了这一条，「不弹提示」就可能变成「从不弹提示」——那是世界哑了。
  const sim = makeSim(false, true);
  sim.enqueue(
    syncCommand({
      tasks: [
        { id: 'c_block', kind: 'quick', title: '要删掉 ./temp 吗？', question: '要删掉 ./temp 吗？' },
      ],
      connected: true,
    }),
  );
  sim.update(16);

  let sawBearer = false;
  for (let i = 0; i < 200; i += 1) {
    sim.update(100);
    if (sim.snapshot().villagers.some((v) => v.mode === 'bearingDecree')) sawBearer = true;
  }
  assert.ok(sawBearer, '没声明 breathing 的老区域照旧弹提示');
});

// ------------------------------------------------------------- 氛围实体照常

test('呼吸段里的猫和外头的猫同一时刻走：留白不赶氛围', () => {
  // §4.7 把「氛围实体（萤火、猫）照常」和三条禁令并列写成一句。它最容易在
  // 装门的时候被顺手带过去——`stepCritters` 只按 `leavesAt` 过期，本来就不看
  // 呼吸，所以**坏掉了也不报错**：猫只是悄悄早走或晚走，没人会注意到。
  //
  // 所以断言的是「同一时刻」而不是「后来走了」：拿一只外头的猫当尺子，
  // 留白里的猫是早走还是晚走，一比就出来。单跑一只永远绿。
  const inside = makeSim(true);
  run(inside, { kind: 'miracle', miracle: 'cat', at: INSIDE });
  inside.update(16);
  const outside = makeSim(true);
  run(outside, { kind: 'miracle', miracle: 'cat', at: OUTSIDE });
  outside.update(16);

  assert.equal(inside.snapshot().critters.length, 1, '猫落在了呼吸段里');
  assert.equal(outside.snapshot().critters.length, 1, '另一只落在外头');

  /** 数到猫不见的那一拍。400 拍 × 100ms 够它走完整个 dwell。 */
  const ticksUntilGone = (sim: Simulation): number => {
    for (let i = 1; i <= 400; i += 1) {
      sim.update(100);
      if (sim.snapshot().critters.length === 0) return i;
    }
    return -1;
  };

  const a = ticksUntilGone(inside);
  const b = ticksUntilGone(outside);
  assert.ok(a > 0, '留白里的猫到点走了');
  assert.ok(b > 0, '外头的猫到点走了');
  assert.equal(a, b, '留白不改变氛围实体的节律：不早走，也不晚走');
});
