/**
 * 「没牌子又不在祭坛」到底有哪几条路——注释原来写「只有撤单那条路」，那是假的。
 *
 * `idleLabel` 的退路是「人在祭坛格上才说祭坛，不在就说『这会儿没个准地方』」。
 * 这条退路成立的条件是：没牌子的时候她可能真不在祭坛。原来三处注释
 * （`villager-words.ts`、`report.ts`、`surface.test.ts`）说这种时刻**只有**
 * 撤单（`abandonActiveTask`）一条路。数一遍 `simulation.ts` 里清
 * `routineLabel` 的地方就知道不止：`finishInPlace`（quick 办完，人原地不动）、
 * `removeTask`（读档对账删单，人挪到门口）、`abandonActiveTask`（上游撤单，
 * 人也挪到门口）三条都清，而前两条跟撤单没有关系。
 *
 * 所以这里把三条各驱一次，量三件事：牌子是不是真没了、mode 是不是回 idle、
 * 人是不是不在祭坛格上。**退路本身仍然是对的**（判据就是 `atAltar`）——
 * 错的是「只有一条路」那句话：把局部真相说成普遍真理，读的人会以为别的情形
 * 不必防。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { syncCommand } from './feed-helpers.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);
const STEP = 100;

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
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
}

type Snapshot = ReturnType<Simulation['snapshot']>;

/** 她这一刻是不是正踩在祭坛那一格上。判据与生产同源（`villager-words.ts`）。 */
function atAltar(villager: Snapshot['villagers'][number], snapshot: Snapshot): boolean {
  return (
    Math.floor(villager.pos.x) === snapshot.altar.x &&
    Math.floor(villager.pos.y) === snapshot.altar.y
  );
}

test('quick 原地办完：牌子没了，人站在原地，那 1800 拍里她多半不在祭坛', () => {
  // 这条与撤单无关，却是最常见的一条：`quick` 的场地是 `in_place`，
  // `finishInPlace` 只翻 mode、清牌子、把 `nextRoutineAt` 推到 now+1800，
  // **一步都不挪人**。她站在接到活那一刻的位置——那一格哪儿都可能。
  const sim = makeSim();
  // 先等她离开祭坛再派：开局两个人都立在祭坛格上，那一刻派活，
  // 办完她还在祭坛，退路恰好是真的，那就证不反任何东西。
  let snapshot = sim.snapshot();
  for (let guard = 0; guard < 400 && snapshot.villagers.every((v) => atAltar(v, snapshot)); guard += 1) {
    sim.update(STEP);
    snapshot = sim.snapshot();
  }
  assert.ok(
    snapshot.villagers.some((villager) => !atAltar(villager, snapshot)),
    '夹具：总得有人先离开祭坛',
  );
  const away = snapshot.villagers.filter((villager) => !atAltar(villager, snapshot));
  const name = away[0]!.name;

  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  for (let guard = 0; guard < 200 && snapshot.deliveries.local < 1; guard += 1) {
    sim.update(STEP);
    snapshot = sim.snapshot();
  }
  assert.equal(snapshot.deliveries.local, 1, '夹具：那条 quick 该交掉了');

  const owner = snapshot.villagers.find((villager) => villager.name === name);
  assert.ok(owner !== undefined, '人不能凭空消失');
  assert.equal(owner.taskId, null, '办完了手上该空');
  assert.equal(owner.routine, null, '办完那一刻牌子该是空的');
  // 人还在原地：`finishInPlace` 不挪人，所以她此刻的格子就是接到活时的格子。
  assert.ok(
    !atAltar(owner, snapshot),
    `办完 quick 的人该还在原来那一格，可她落在祭坛格上（${owner.pos.x},${owner.pos.y}）`,
  );
});

test('上游撤单：牌子没了，人被挪到铺子门口，同样不在祭坛', () => {
  // 这条是三处注释**唯一**写到的一条。它确实成立——这里把它也钉住，
  // 免得将来只留上面那条，读的人又以为撤单这条路没了。
  const sim = makeSim();
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }], connected: true }));
  let snapshot = sim.snapshot();
  // 先让她真的进屋干活：`abandonActiveTask` 只在 `isOnTask(owner)` 时调。
  for (let guard = 0; guard < 400; guard += 1) {
    sim.update(STEP);
    snapshot = sim.snapshot();
    if (snapshot.villagers.some((villager) => villager.taskId === 'c_1' && villager.mode === 'working')) {
      break;
    }
  }
  const working = snapshot.villagers.find((villager) => villager.taskId === 'c_1');
  assert.ok(working !== undefined, '夹具：得有人接手 c_1');
  assert.equal(working.mode, 'working', '她该已经进屋了');

  sim.enqueue(syncCommand({ tasks: [], cancelled: ['c_1'], connected: true }));
  sim.update(STEP);
  snapshot = sim.snapshot();
  const owner = snapshot.villagers.find((villager) => villager.name === working.name);
  assert.ok(owner !== undefined, '人不能凭空消失');
  assert.equal(owner.taskId, null, '单撤了，手上该空');
  assert.equal(owner.routine, null, '撤单清牌子');
  assert.equal(owner.mode, 'idle', '撤单把人放回空闲');
  assert.ok(!atAltar(owner, snapshot), `她被挪到铺子门口，不该还在祭坛格上（${owner.pos.x},${owner.pos.y}）`);
  // 门口那一待就是 1800 拍：这 1800 拍里她说自己在祭坛，就是编的。
  // `nextRoutineAt` 不在快照里（快照只有 `routine`），所以这儿不读字段，
  // 直接数：牌子该在**第 18 个 100ms** 重新挂上，一次都不该早。
  let reattachAfter = -1;
  for (let t = 1; t <= 30; t += 1) {
    sim.update(STEP);
    const now = sim.snapshot();
    const her = now.villagers.find((villager) => villager.name === working.name);
    if (her !== undefined && her.routine !== null) {
      reattachAfter = t;
      break;
    }
  }
  assert.equal(reattachAfter, 18, `撤单后该空 1800 拍（18 个 100ms）才挂新牌子，实得第 ${reattachAfter} 个`);
});

test('清牌子的路口一共四条：三条会把人留在祭坛外', () => {
  // 这一条不驱世界，直接数源码：`routineLabel = null` 在 simulation.ts 里
  // 出现几次，各自在哪个函数里。数出来是 7 处赋值，其中让人回到 idle 且没有
  // 牌子的路口是 `abandonActiveTask`、`removeTask`、`finishInPlace`、
  // `arriveAtAltar` 四个——最后那个她人就在祭坛，退路恰好是真的。
  //
  // 另外三处都不回 idle，所以不在那四条里：`routeToBuilding`（她正赶往工位）、
  // `arriveAtWork`（她已到工位）、`stepDecrees`（她举着急件跑向祭坛）。三处的
  // 说法都归 `villagerModeLabel` 按 mode 分支管，压根不读牌子——清与不清都不
  // 改变屏上与纸上。**别把「7 处」读成「七条路口」**：能问「她人在哪儿」的
  // 只有回到 idle 那四条，另外三处那一刻她有别的说法。
  //
  // 为什么值得数：注释里那句「只有撤单那条路」就是因为没人数过才活下来的。
  // 数一遍不会让新加的路口自动进注释，但能让「到底有几条」有个可复按的数。
  const source = readFileSync(new URL('../src/world/simulation.ts', import.meta.url), 'utf8');
  const assignments = [...source.matchAll(/routineLabel = null/g)];
  assert.equal(assignments.length, 7, `simulation.ts 里清牌子的地方该是 7 处，实得 ${assignments.length}`);
  // 四个路口名都在文件里——少一个就说明有人删了一条路，那段注释得重看。
  for (const fn of ['abandonActiveTask', 'removeTask', 'finishInPlace', 'arriveAtAltar']) {
    assert.ok(source.includes(fn), `simulation.ts 里找不到 ${fn}——清牌子的路口变了`);
  }
});
