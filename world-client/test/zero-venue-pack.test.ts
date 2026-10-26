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
import { ALTAR, buildLargeWorld, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { VenueCandidate } from '../src/world/venue.ts';
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

/** 莞尔镇大世界：镇内与郊野都有铺子。「都在郊野」那条路只有它走得出来。 */
function largeSim(): Simulation {
  const blueprints = parseBlueprintTable(
    JSON.parse(
      readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
    ) as Record<string, Record<string, unknown>>,
  );
  const world = buildLargeWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
  });
}

/** 把世界说的话收起来。warn 上不了屏幕，但上游那条路只走 warn。 */
function capture(sim: Simulation): string[] {
  const said: string[] = [];
  (sim as unknown as { log: (kind: string, message: string) => void }).log = (kind, message) => {
    said.push(`[${kind}] ${message}`);
  };
  return said;
}

/**
 * 把铺子候选换成指定的一组，只为看它因此说出的那句话。
 *
 * 为什么值得单开一条后门：真正把「镇内铺子全忙」走到，需要一个角色正占着那栋铺子，
 * 而大世界只有两个角色——占上了就没有空闲角色再来问一次。于是那句「没有空闲的」
 * 在真实游戏里几乎走不到，可它一旦被改错，用户在屏幕上读到的就是假话。
 * 所以这里直接指定候选，把「原因 → 那句话」的映射钉住。
 */
function withVenues(sim: Simulation, venues: readonly VenueCandidate[]): void {
  (sim as unknown as { venueCandidates: () => readonly VenueCandidate[] }).venueCandidates = () =>
    venues;
}

/** 一栋铺子。`busy` 表示被占、在施工、或故障中。 */
function venue(
  instanceId: string,
  kind: 'code' | 'research' | 'writing',
  isWild: boolean,
  busy = false,
): VenueCandidate {
  return { instanceId, boundTask: kind, isWild, busy };
}

/** 喂一条上游的活，跑几拍，把它说过的话交出来。
 *
 * 收话的钩子得**先装**：`update` 里说的话装钩子之后就没了。 */
function feedSays(sim: Simulation, kind: 'code' | 'research' | 'writing' | 'quick'): string {
  const said = capture(sim);
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind, title: '修一盏灯' }], connected: true }));
  for (let step = 0; step < 8; step += 1) sim.update(16);
  return said.join('\n');
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

// ---------------------------------------------- 三种挑不到铺子的原因，三句不同的话

test('上游那条路的三句话，一句都不能混', () => {
  // 「没有」「都闲着」「都在郊野」是三件不同的事实。曾有两种变异在全仓
  // 938 条测试里全绿：任一条路把三句并成一句。那句话是用户在屏幕上读到的，
  // 而它一半时间是假话——所以逐句钉住，连它说的原话一起。
  const cases: readonly { readonly venues: readonly VenueCandidate[]; readonly want: string }[] = [
    { venues: [venue('star#1', 'research', false)], want: '这座镇子没有接 code 的铺子，「修一盏灯」派不出去。' },
    { venues: [venue('forge#1', 'code', false, true)], want: '没有空闲的镇内铺子承接 code，「修一盏灯」先等着。' },
    { venues: [venue('gear#1', 'code', true)], want: '接 code 的铺子都在郊野，上游的活只去镇内，「修一盏灯」先等着。' },
  ];
  for (const item of cases) {
    const sim = largeSim();
    withVenues(sim, item.venues);
    const said = feedSays(sim, 'code');
    assert.ok(
      said.includes(item.want),
      `该说「${item.want}」，实际说的是：${said || '（什么都没说）'}`,
    );
  }
});

test('屏幕上那条路的两句话，也不能混', () => {
  // 同一条毛病的另一处：神谕派活失败时回给用户的那句。
  const cases: readonly { readonly venues: readonly VenueCandidate[]; readonly want: string }[] = [
    { venues: [venue('star#1', 'research', false)], want: '这座镇子没有接 code 的铺子。' },
    { venues: [venue('forge#1', 'code', false, true)], want: '没有空闲的 code 铺子。' },
  ];
  for (const item of cases) {
    const sim = largeSim();
    withVenues(sim, item.venues);
    assert.equal(sayOnDispatch(sim, 'code'), item.want);
  }
});

test('拆掉镇内唯一的 code 铺子之后，上游的活说的是「都在郊野」', () => {
  // 这一条钉的是一个真能走到的状态。demolish 没有覆盖校验兜底
  // （`demolish.test.ts` 明说「世界允许把镇子拆空」），拆掉炼码工坊之后，
  // 只剩郊野的齿轮塔接 code。这时候说「没有空闲的镇内铺子」是假话：
  // 镇内一栋都不剩，它却告诉用户「有，只是忙」。
  const sim = largeSim();
  sim.enqueue({ kind: 'demolish', instanceId: 'code_forge#1' });
  sim.update(16);
  const said = feedSays(sim, 'code');
  assert.ok(
    said.includes('都在郊野'),
    `该说「都在郊野」，实际说的是：${said || '（什么都没说）'}`,
  );
  assert.ok(
    !said.includes('没有空闲的镇内铺子'),
    '镇内一栋接 code 的楼都不剩时，不许说「没有空闲的镇内铺子」',
  );
});

test('上游的 quick 单原地就办，不拿铺子说事', () => {
  // quick 是 in_place，压根不占铺子。它曾和别的活一起进 pickVenue，于是回一句
  // 「这座镇子没有接 quick 的铺子」——把「这类活不占铺子」说成了「这座镇子缺
  // 一座铺子」。这句话在灯潮界说，在有三栋铺子的镇子也说，两句都是误导。
  const sim = dengchaoSim();
  const said = feedSays(sim, 'quick');
  assert.ok(
    !said.includes('没有接 quick 的铺子'),
    `quick 不占铺子，不该拿铺子说事：${said}`,
  );
  assert.ok(said.includes('原地办'), `quick 该被原地办掉，实际：${said || '（什么都没说）'}`);
});

test('同一句「派不下去」只说一遍，不说十六遍', () => {
  // pumpPending 每个空闲角色每拍都问一遍：两个角色跑八拍，同一句 warn 就在
  // 事件流里连排十六条。而事件流就是世界的记忆——十六条同样的话会把真正发生
  // 的事挤出那十二条的窗口，记忆里那一晚只剩一句重复过十六遍的抱怨。
  // 说错了比不说更糟，可把一句话说十六遍也不是诚实，是噪音。
  const sim = dengchaoSim();
  const said = capture(sim);
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '修一盏灯' }], connected: true }));
  for (let step = 0; step < 8; step += 1) sim.update(16);

  const complaints = said.filter((line) => line.includes('派不出去'));
  assert.equal(complaints.length, 1, `该只说一遍，实际说了 ${complaints.length} 遍：${complaints.join(' / ')}`);
});

test('原因变了就再说：那时是句新话', () => {
  // 反方向也得钉。dedupe 要是按任务 id 一刀切，镇子从「都闲着」变成「一栋都
  // 没有」（或反过来）时，屏幕上就再也不更新了——那又成了假的沉默。
  const sim = largeSim();
  const said = capture(sim);
  withVenues(sim, [venue('forge#1', 'code', false, true)]);
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '修一盏灯' }], connected: true }));
  for (let step = 0; step < 4; step += 1) sim.update(16);
  const busyCount = said.filter((line) => line.includes('没有空闲的镇内铺子')).length;
  assert.equal(busyCount, 1, '忙那句该说一遍');

  // 把镇内那栋也撤了：现在只剩郊野，原因是句新话，该再开口。
  withVenues(sim, [venue('gear#1', 'code', true)]);
  for (let step = 0; step < 4; step += 1) sim.update(16);
  const wildCount = said.filter((line) => line.includes('都在郊野')).length;
  assert.equal(wildCount, 1, `原因变了该再说一遍，实际 ${wildCount} 遍`);
  assert.equal(
    said.filter((line) => line.includes('没有空闲的镇内铺子')).length,
    busyCount,
    '旧原因那句不该跟着重复',
  );
});
