import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildLargeWorld, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { Simulation } from '../src/world/simulation.ts';
import { composeReport } from '../src/world/report.ts';
import { syllablePlan } from '../src/audio/animalese.ts';
import { Bridge, toWorldCommand } from '../src/world/bridge.ts';
import { syncCommand } from './feed-helpers.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined
        ? null
        : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

/** 大世界：唯一会落民居的规格。上面那个 30×20 的夹具一栋民居都不落。 */
function makeLargeSim(): Simulation {
  const world = buildLargeWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined
        ? null
        : placeBlueprint(world.grid, blueprint, instanceId, world.altar);
    },
  });
}

// -------------------------------------------------------------------- report

test('还没交付时，日报说实话，不用填充句', () => {
  const report = composeReport(makeSim().snapshot());
  assert.equal(report.headline, '世界还没动静');
  assert.ok(report.lines[0].includes('还没有交付'));
  assert.ok(report.lines.length <= 3);
});

test('日报把暴雨写出来，不把三档折成「下没下雨」', () => {
  // 三元判断 `=== 'rain' ? '下着雨' : '晴着'` 会把暴雨写成晴——加第三档时最容易漏的
  // 正是这种不是 switch 的地方。
  //
  // 这一句也不带「今天」：`snapshot.weather` 是**这一拍**的读数，而世界钟里没有天
  // （`formatWorldClock` 打「第 N 分 MM 秒」，只增不减、从不翻篇）。「今天晴」断言了一个
  // 世界上不存在的单位，「今天下了雨」还多一层过去时——晴着的那一拍无从知道早些
  // 时候下没下过。所以只说手里这一拍：晴着 / 下着雨 / 刮着暴雨。
  const sim = makeSim();
  const snapshot = (): ReturnType<Simulation['snapshot']> => sim.snapshot();
  const weatherLine = (): string =>
    composeReport(snapshot()).lines.find((line) => /外头(晴着|下着雨|刮着暴雨)/.test(line)) ?? '';

  assert.match(weatherLine(), /外头晴着/);

  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  sim.update(16);
  assert.match(weatherLine(), /外头下着雨/);

  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  sim.update(16);
  assert.match(weatherLine(), /外头刮着暴雨/);
  // 三档都不许带时间词：世界上没有"今天"这个单位可比。
  assert.doesNotMatch(weatherLine(), /今天|昨日|刚才/);
});

test('交付一单之后，日报写的是这单本身', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (sim.snapshot().tasks[0]?.status !== 'done') {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  const report = composeReport(sim.snapshot());
  assert.ok(report.lines.some((line) => line.includes('交付 1 单')));
  assert.ok(report.lines.some((line) => line.includes('顺手看一眼')));
  assert.equal(report.headline, '已有交付', '没攒满里程碑就不能写"神恩"');
});

test('日报按角色与来源分账：上游与本地分开，不合并计数', () => {
  const sim = makeSim();
  // 上游单：完成权在上游日志，由 task.settled 收尾，归实际接单的角色。
  sim.enqueue(
    syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }] }),
  );
  let guard = 0;
  while (sim.snapshot().villager.mode !== 'working') {
    sim.update(100);
    if ((guard += 1) > 200) throw new Error('没走到铺子');
  }
  sim.enqueue(syncCommand({ finished: ['c_1'] }));
  sim.update(16);
  assert.equal(sim.snapshot().deliveries.feed, 1);
  guard = 0;
  while (sim.snapshot().villager.mode !== 'idle') {
    sim.update(100);
    if ((guard += 1) > 200) throw new Error('上游单没走完交付');
  }

  // 沙盒单：短活自己结束，计入本地。
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  guard = 0;
  while (sim.snapshot().deliveries.local !== 1) {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }

  // 断线后本地交付必须显式标成「离线本地」，日报据此分开写。
  sim.enqueue(syncCommand({ connected: false }));
  sim.update(16);
  const snapshot = sim.snapshot();
  assert.equal(snapshot.deliveries.feed, 1);
  assert.equal(snapshot.deliveries.local, 1);
  assert.deepEqual(
    snapshot.deliveriesByVillager.map((item) => [item.name, item.feed, item.local]),
    [
      ['莞尔', 1, 1],
      ['阿雾', 0, 0],
    ],
  );

  const report = composeReport(snapshot);
  const line = report.lines.find((item) => item.includes('交付')) ?? '';
  assert.ok(line.includes('莞尔交付 2 单'), line);
  assert.ok(line.includes('上游 1'), line);
  assert.ok(line.includes('离线本地 1'), line);
  assert.ok(!line.includes('交付 3 单'), '不能把两个人/两种来源合并成一个数');
  assert.equal(report.headline, '已有交付');
});

test('日报写清每个角色交付了几单', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  sim.update(16);
  sim.enqueue({ kind: 'dispatch', taskKind: 'research', summary: '查资料' });
  sim.update(16);
  let guard = 0;
  while (!sim.snapshot().villagers.every((item) => item.mode === 'working')) {
    sim.update(100);
    if ((guard += 1) > 300) throw new Error('两个人没同时开工');
  }
  sim.enqueue({ kind: 'complete', target: 'v0' });
  sim.update(16);
  assert.equal(sim.snapshot().villagers[1]?.mode, 'working', '指定交付不能串到另一个人');
  sim.enqueue({ kind: 'complete', target: '阿雾' });
  sim.update(16);

  const snapshot = sim.snapshot();
  assert.deepEqual(
    snapshot.deliveriesByVillager.map((item) => [item.name, item.feed, item.local]),
    [
      ['莞尔', 0, 1],
      ['阿雾', 0, 1],
    ],
  );
  const report = composeReport(snapshot);
  const line = report.lines.find((item) => item.includes('交付')) ?? '';
  assert.ok(line.includes('莞尔交付 1 单'), line);
  assert.ok(line.includes('阿雾交付 1 单'), line);
  assert.ok(line.includes('本地 1'), line);
  assert.equal(report.headline, '已有交付');
});

test('上游单按实际接单的角色分账', () => {
  const sim = makeSim();
  sim.enqueue(
    syncCommand({
      tasks: [
        { id: 'c_a', kind: 'code', title: '写爬虫' },
        { id: 'c_b', kind: 'research', title: '查资料' },
      ],
    }),
  );
  sim.update(16);
  let guard = 0;
  while (!sim.snapshot().villagers.every((item) => item.mode === 'working')) {
    sim.update(100);
    if ((guard += 1) > 300) throw new Error('两个人没各接一单');
  }
  sim.enqueue(syncCommand({ finished: ['c_a', 'c_b'] }));
  sim.update(16);
  const snapshot = sim.snapshot();
  assert.equal(snapshot.deliveries.feed, 2);
  assert.deepEqual(
    snapshot.deliveriesByVillager.map((item) => [item.name, item.feed, item.local]),
    [
      ['莞尔', 1, 0],
      ['阿雾', 1, 0],
    ],
  );
  const report = composeReport(snapshot);
  const line = report.lines.find((item) => item.includes('交付')) ?? '';
  assert.ok(line.includes('莞尔交付 1 单'), line);
  assert.ok(line.includes('阿雾交付 1 单'), line);
  assert.ok(line.includes('上游 1'), line);
});

test('日报收尾写清谁在忙、谁在做什么——不把闲人一律说成在祭坛', () => {
  // 两个人都空着且都在祭坛：措辞要能读。这一条能成立是因为**查过坐标**：
  // 开局那一拍两人真在祭坛格上（15,9）。旧写法不看坐标，见下面那条。
  const idle = composeReport(makeSim().snapshot());
  assert.ok(
    idle.lines.some((line) => line.includes('莞尔、阿雾都在祭坛边坐着')),
    idle.lines.join('|'),
  );

  // 一个人接活：另一个人写名字。
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  sim.update(16);
  const mixed = composeReport(sim.snapshot());
  assert.ok(
    mixed.lines.some(
      (line) => line.includes('莞尔手上是「写脚本」') && line.includes('阿雾在祭坛边坐着'),
    ),
    mixed.lines.join('|'),
  );

  // 两个人都忙：两个名字与两单都写出来。
  sim.enqueue({ kind: 'dispatch', taskKind: 'research', summary: '查资料' });
  sim.update(16);
  const busy = composeReport(sim.snapshot());
  assert.ok(
    busy.lines.some(
      (line) => line.includes('莞尔手上是「写脚本」') && line.includes('阿雾手上是「查资料」'),
    ),
    busy.lines.join('|'),
  );
});

test('闲人不在祭坛时，收尾照她本当在做的事说，不按祭坛说', () => {
  // 旧写法是 `idleNames.join('、') + '都在祭坛边坐着'`，一个坐标都不查。
  // 她走作息时在农田边、街口、屋檐下，那时她有牌子，说的就是牌子；
  // 没牌子又不在祭坛有四条路口（`abandonActiveTask` / `removeTask` /
  // `finishInPlace` / `arriveAtAltar`，由 `test/labelless-idle.test.ts` 各驱一次），
  // 不是原来写的「只有撤单那条路」。`routine` 也不是从第 0 拍就有：起手有一段
  // `1200 + index * 1400` 的空窗，由 `test/routine-warmup.test.ts` 核。
  const sim = makeSim();
  // 跑到「有人空着、有牌子、且人不在祭坛格上」那一拍再问。起手那一拍两人都在祭坛，
  // 而刚挂上牌子时人也才起身——不到时候问，问到的还是祭坛。
  let snapshot = sim.snapshot();
  const away = (s: ReturnType<Simulation['snapshot']>): boolean =>
    s.villagers.some(
      (villager) =>
        villager.taskId === null &&
        villager.routine !== null &&
        (Math.floor(villager.pos.x) !== s.altar.x || Math.floor(villager.pos.y) !== s.altar.y),
    );
  for (let guard = 0; guard < 600 && !away(snapshot); guard += 1) {
    sim.update(100);
    snapshot = sim.snapshot();
  }
  const idle = snapshot.villagers.filter((villager) => villager.taskId === null);
  assert.equal(idle.length, 2, '夹具：两个人都空着');
  // 夹具真的造出了"人不在祭坛"：都在祭坛的话这条测试就没在问它想问的。
  assert.ok(away(snapshot), `没等到有人离开祭坛：${idle.map((v) => `${v.name}@${v.pos.x},${v.pos.y}`).join(' ; ')}`);

  const report = composeReport(snapshot);
  const tail = report.lines.find((line) => /外头/.test(line)) ?? '';
  // 纸上说的每一句，都得是那个人自己的牌子。
  for (const villager of idle) {
    if (villager.routine === null) continue;
    assert.ok(
      tail.includes(`${villager.name}${villager.routine}`),
      `纸上没照 ${villager.name} 的牌子说话：${tail}`,
    );
  }
  // 也不许把不在祭坛的人说成在祭坛。
  for (const villager of idle) {
    const atAltar =
      Math.floor(villager.pos.x) === snapshot.altar.x &&
      Math.floor(villager.pos.y) === snapshot.altar.y;
    if (atAltar) continue;
    assert.ok(
      !tail.includes(`${villager.name}在祭坛边坐着`),
      `${villager.name} 不在祭坛，纸上说她在：${tail}`,
    );
  }
});

test('攒满里程碑后，标题写的是已经落地的那次神恩', () => {
  const sim = makeSim();
  for (let i = 0; i < 3; i += 1) {
    sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: `小事 ${i}` });
    let guard = 0;
    while (sim.snapshot().tasks[i]?.status !== 'done') {
      sim.update(100);
      if ((guard += 1) > 400) throw new Error('短活没结束');
    }
  }
  const report = composeReport(sim.snapshot());
  assert.equal(report.headline, '第 1 次神恩已落地');
});

test('日报会写上开局之后起的楼与落地的东西', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#1' });
  sim.update(16);
  const report = composeReport(sim.snapshot());
  assert.ok(report.lines.some((line) => line.includes('开局之后造物主起了 1 栋楼')));
});

test('神迹落了地而一单未交，头条不许说「世界还没动静」', () => {
  // 旧判据只看 `milestones === 0 && delivered === 0`。可零交付、零里程碑时神迹种的
  // 树已经落在祭坛边（实测 props=1），同一份报纸的第二行正写着「一棵神迹种的树
  // 已经落在祭坛边」——头条说没动静，纸上别处写着它动过。说错了比不说更糟。
  const sim = makeSim();
  sim.enqueue({ kind: 'miracle', miracle: 'tree' });
  for (let i = 0; i < 40; i += 1) sim.update(100);

  const snapshot = sim.snapshot();
  assert.equal(snapshot.props.length, 1, '夹具：树落下来了');
  assert.equal(snapshot.faith.milestones, 0, '夹具：没攒够里程碑');
  assert.equal(snapshot.deliveries.feed + snapshot.deliveries.local, 0, '夹具：一单未交');

  const report = composeReport(snapshot);
  assert.notEqual(
    report.headline,
    '世界还没动静',
    `纸上别处写着世界动过，头条说没有：${report.lines.join(' / ')}`,
  );
  // 头条也不带时间词——跟下面几条同一个纪律。
  assert.doesNotMatch(report.headline, /今天|刚|新/);
  // 真的什么都没发生时才这么说（开局那一拍、钟走了很远都算）。
  assert.equal(composeReport(makeSim().snapshot()).headline, '世界还没动静');
});

test('玩家一天都没动手时，日报不许数出楼来——大世界', () => {
  // 判据曾经是 `boundTask === null`（「不接活」）。民居也不接活，却是开局就落好的，
  // 于是大世界的日报在玩家什么都没做的那天写「造物主新起 5 栋楼」（旧措辞）。
  // 30×20 的夹具不落民居，所以那一侧永远绿——错的是没有人拿大世界问过它。
  const notTakingWork = buildLargeWorld(blueprints)
    .buildings.filter((building) => building.boundTask === null);
  assert.ok(notTakingWork.length > 0, '大世界里一栋「不接活」的楼都没有，这条没在问它想问的');

  const report = composeReport(makeLargeSim().snapshot());
  assert.ok(
    !report.lines.some((line) => line.includes('开局之后造物主起了')),
    `玩家一天都没动手，日报却数出了楼：${report.lines.join(' / ')}`,
  );
});

test('玩家一天都没动手时，日报不许数出楼来——设定集也照样', () => {
  // 第二张地图上同一个 bug 原样重现过：改成 `zone !== 'living'` 那一版修好了莞尔镇，
  // 灯潮界六栋楼却全是 `zone: 'industry'` + `boundTask: null`，那句话一字不改地回来。
  // 判据现在问的是「这次玩起来之后造的吗」，跟分区、跟接不接活都无关——
  // 所以这条钉的是**换一张地图也成立**，不是再钉一个分区名。
  const world = buildSettingWorld(loadSettingPack(DENGCHAO_RAW));
  const atStart = world.buildings.filter((b) => b.boundTask === null);
  assert.ok(atStart.length > 0, '灯潮界一栋「不接活」的楼都没有，这条没在问它想问的');

  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: loadSettingPack(DENGCHAO_RAW).hub,
    villagerName: loadSettingPack(DENGCHAO_RAW).villagers[0]!.name,
    wallClock: () => 1000,
  });
  const report = composeReport(sim.snapshot());
  assert.ok(
    !report.lines.some((line) => line.includes('开局之后造物主起了')),
    `玩家一天都没动手，日报却数出了楼：${report.lines.join(' / ')}`,
  );
});

test('小世界里玩家建一间民居，日报也写——修完不能修成吞话', () => {
  // `zone !== 'living'` 那一版在这里静默吞掉了一个真实的玩家动作：意图白名单只查
  // 模板在不在，不分区，所以小世界（开局不落民居）真能建起一间橡木小屋。
  // 修之前它靠 `boundTask === null` 蒙对了；改成按分区剪，这句话就整句不见了。
  const sim = makeSim();
  sim.enqueue({ kind: 'build', prefabId: 'cottage_oak', instanceId: 'cottage_oak#1' });
  sim.update(16);
  assert.ok(
    sim.snapshot().buildings.some((b) => b.instanceId === 'cottage_oak#1'),
    '小世界没建成民居，这条测试的夹具不成立',
  );
  const report = composeReport(sim.snapshot());
  const line = report.lines.find((item) => item.includes('开局之后造物主起了'));
  assert.ok(line !== undefined, `玩家建了楼，日报却没写：${report.lines.join(' / ')}`);
  assert.ok(line.includes('开局之后造物主起了 1 栋楼'), `只该数玩家那一栋：${line}`);
});

test('大世界里玩家真建了楼，日报照写，而且只数玩家建的那一栋', () => {
  // 修完不能修成一句废话：开局那几栋是不写了，玩家建的也得写。
  const sim = makeLargeSim();
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#1' });
  sim.update(16);
  const report = composeReport(sim.snapshot());
  const line = report.lines.find((item) => item.includes('开局之后造物主起了'));
  assert.ok(line !== undefined, `玩家建了楼，日报却没写：${report.lines.join(' / ')}`);
  assert.ok(line.includes('开局之后造物主起了 1 栋楼'), `只该数玩家那一栋：${line}`);
  assert.ok(
    !line.includes('小屋') && !line.includes('农舍'),
    `民居被数进来了：${line}`,
  );
});

test('读档之后，上一次造的楼不算「开局之后起的」——证不明就不判', () => {
  // 存档证明不了一栋楼是哪一次会话里造的。读档那一刻档里所有的楼都算"开局就有"，
  // 于是报纸宁可少说一句，不多说一句假的。少说一句的代价是这一句，
  // 多说一句的代价是又一场「造物主新起 6 栋楼」（旧措辞）。
  const played = makeSim();
  played.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#1' });
  played.update(16);
  assert.ok(
    composeReport(played.snapshot()).lines.some((line) => line.includes('开局之后造物主起了 1 栋楼')),
    '同一场里刚建的楼，报纸该写',
  );

  const save = played.toSave();
  const fresh = buildWorld(blueprints);
  const reloaded = Simulation.fromSave(JSON.parse(JSON.stringify(save)), {
    grid: fresh.grid,
    buildings: fresh.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
  assert.ok(
    reloaded.snapshot().buildings.some((b) => b.instanceId === 'plot#1'),
    '读档没把那一栋读回来，这条测试的夹具不成立',
  );
  assert.ok(
    !composeReport(reloaded.snapshot()).lines.some((line) => line.includes('开局之后造物主起了')),
    `读档后报纸把上一次造的楼说成开局之后起的：${composeReport(reloaded.snapshot()).lines.join(' / ')}`,
  );
});

test('楼放久了，报纸那句话不许跟着变——只有来路，没有时间', () => {
  // 这句话曾经写「造物主新起 N 栋楼」。「新」是句时间断言，可报纸是现算的
  // （composeReport 每次调用都从快照推一遍），日期还跟着世界钟走（formatWorldClock 打的
  // 是第几分第几秒）。楼是开局那一拍落的，到钟走过 5 分钟的那张报纸上它仍叫「新起」
  // ——越放越假。想按天收窄也做不到：PlacedBuilding 上没记落成时刻，没有时刻戳可比
  // （天界倒有，lampDayOf 按世界钟算得出第几天，可一天的两头只有一头）。
  // 所以改成说「开局之后」：只讲来路，不讲新旧。
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined
        ? null
        : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
  sim.enqueue({ kind: 'build', prefabId: 'workshop_plot', instanceId: 'plot#1' });
  sim.update(16);

  const lineOf = (): string =>
    composeReport(sim.snapshot()).lines.find((line) => line.includes('造物主起了')) ?? '';
  const soon = lineOf();
  const soonClock = composeReport(sim.snapshot()).clock;

  sim.update(5 * 60 * 1000);
  const later = lineOf();

  assert.ok(soon !== '', '刚建完那一会儿，报纸该写出这一句');
  assert.notEqual(
    composeReport(sim.snapshot()).clock,
    soonClock,
    '世界钟没动，这条测试没在问它想问的',
  );
  assert.equal(later, soon, `楼放久了，那句话变了：${soon} → ${later === '' ? '整句没了' : later}`);
  // 光钉「造物主起了」不够：换成「今天造物主起了」或把界整个去掉，上面三条全绿，
  // 而那句话恰恰又变成了句时间断言。这一条钉的是**界**，不是那几个字。
  assert.match(
    soon,
    /^开局之后造物主起了 \d+ 栋楼：/,
    `这一句得说清「开局之后」这个界，不能换成「今天」也不能不说：${soon}`,
  );
});

test('钟走了很远还什么都没发生，头条不许说「刚醒来」', () => {
  // 旧措辞是「世界刚醒来」。「刚」是句时间断言，而它只看「一单未交付、没攒够里程碑」
  // ——跟钟走了多久毫无关系。玩家开局发一条神谕（于是报纸重画），纸上日期已经是第 N 分，
  // 头条仍说刚醒来。
  const sim = makeSim();
  sim.update(16);
  assert.equal(
    composeReport(sim.snapshot()).headline,
    '世界还没动静',
    '刚开局那一拍，该写这一句',
  );

  sim.update(30 * 60 * 1000);
  const after = composeReport(sim.snapshot());
  assert.notEqual(after.clock, '第 0 分 00 秒', '钟没动，这条测试没在问它想问的');
  assert.equal(after.headline, '世界还没动静', `钟走了半小时，头条还在说「刚」：${after.headline}`);
});

test('读档之后，上一次会话交付的单不算「今日」', () => {
  // deliveries 由 settledLog 重建，而 settledLog 只追加不裁剪、整份落档（toSave 的
  // settled）。于是读档后这个数把上一次会话的单也数在内——可这一次会话一单还没交。
  // 旧措辞「今日有交付」就在这种时候说今天有交付。
  const played = makeSim();
  played.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' });
  let guard = 0;
  while (played.snapshot().tasks[0]?.status !== 'done') {
    played.update(100);
    if ((guard += 1) > 400) throw new Error('短活没结束');
  }
  assert.equal(composeReport(played.snapshot()).headline, '已有交付', '夹具：这一场确实交过');

  const savedNow = played.snapshot().now;
  const save = played.toSave();
  const fresh = buildWorld(blueprints);
  const reloaded = Simulation.fromSave(JSON.parse(JSON.stringify(save)), {
    grid: fresh.grid,
    buildings: fresh.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
  reloaded.update(30 * 60 * 1000);
  const after = composeReport(reloaded.snapshot());
  assert.ok(after.lines.some((line) => line.includes('交付 1 单')), '夹具：读档后那个数还在');
  // 拿存档那一刻的世界钟比，不拿「第 0 分 00 秒」这个字面量比：夹具跑到存档时
  // 钟早就过了 0（短活要 1.2 秒才交），跟那个字符串比永远不等于，等于没查。
  assert.ok(
    reloaded.snapshot().now >= savedNow + 30 * 60 * 1000,
    `钟没走够：存档那一刻 now=${savedNow}，半小时后 now=${reloaded.snapshot().now}`,
  );
  assert.equal(after.headline, '已有交付', '头条不许把上一次会话的单说成今天的');
});

test('「最近一单」数的是最晚交付的，不是数组末尾那一单', () => {
  // `snapshot.tasks` 照创建顺序 push（simulation.ts:1480、:2065，全程不排序），
  // `done` 过滤一遍还是那个顺序。两个人同时干活时创建顺序和交付顺序会分叉：
  // 先派下去的长活后交，后派下去的短活先交。照数组末尾取，报纸就把**先**交的
  // 那单叫「最近」——一句话说着当下，指的却是过去。
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    villagerNames: ['莞尔', '阿雾'],
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined
        ? null
        : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });

  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '甲长活' });
  let guard = 0;
  while (sim.snapshot().tasks[0]?.status !== 'in_progress') {
    sim.update(100);
    if ((guard += 1) > 400) throw new Error('长活没开工');
  }
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '乙短活' });
  guard = 0;
  while (sim.snapshot().tasks.some((task) => task.status !== 'done')) {
    sim.update(100);
    if ((guard += 1) > 800) throw new Error('活没交完');
  }

  const snapshot = sim.snapshot();
  const done = snapshot.tasks.filter((task) => task.status === 'done');
  assert.equal(done.length, 2, '夹具：两单都交了');
  const lastCreated = done[done.length - 1];
  const lastDelivered = [...done].sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0)).at(-1);
  assert.notEqual(
    lastCreated.summary,
    lastDelivered?.summary,
    '夹具没造出分叉：创建顺序和交付顺序一样，这条测试就没在问它想问的',
  );
  // 四个时刻戳按这个夹具钉住：`report.ts` 那段注释引的就是它们（「长活 8500
  // 交付、短活 3800 交付」）。不钉的话，那句话又是一处按不出来的数。
  const long = done.find((task) => task.kind === 'code');
  const short = done.find((task) => task.kind === 'quick');
  assert.equal(long?.createdAt, 100, '长活该在开局那一帧派下去');
  assert.equal(long?.completedAt, 8500, `长活该 8500 交付，实得 ${long?.completedAt}`);
  assert.equal(short?.createdAt, 2600, `短活该等长活开工后才派下去，实得 ${short?.createdAt}`);
  assert.equal(short?.completedAt, 3800, `短活该 3800 交付，实得 ${short?.completedAt}`);

  const line = composeReport(snapshot).lines.find((item) => item.includes('最近一单')) ?? '';
  assert.ok(
    line.includes(`最近一单：${lastDelivered?.summary ?? ''}`),
    `纸上说的不是最晚交付的那单：${line}`,
  );
  assert.ok(
    !line.includes(`最近一单：${lastCreated.summary}`),
    `纸上把先交的那单叫「最近」：${line}`,
  );
});

test('两单同一拍落成时不说「最近一单」：那会儿没有更近的那一单', () => {
  // 上面那条测的是"分叉时选最晚交付的"。这一条测它对面：`completedAt` 打平时
  // 根本没有最晚可言，纸上却仍写「最近一单：甲」——一句话说着唯一，那儿有两个。
  //
  // 夹具走的是**唯一**那条打得平的路：同一帧里派两条 `quick`，两个村民都空着。
  // 两条都原地办（`finishInPlace`，铺子是 null），于是在同一拍写上同一个
  // `this.now`。实测 createdAt 100/100、completedAt 1300/1300。
  // 不是「同一帧派两单就会打平」：四类活时长两两不同，不同类落不到同一拍；
  // 同一类派两条，第二条连单都建不出来。也只有一个村民时打不平（第二条要排队）。
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });

  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '甲' });
  sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary: '乙' });
  sim.update(100);
  let guard = 0;
  while (sim.snapshot().tasks.some((task) => task.status !== 'done')) {
    sim.update(100);
    if ((guard += 1) > 600) throw new Error('两单没交完');
  }

  const done = sim.snapshot().tasks.filter((task) => task.status === 'done');
  assert.equal(done.length, 2, '夹具：两单都交了');
  assert.ok(
    done.every((task) => task.buildingId === null),
    '夹具得走原地办那条路：`quick` 不进铺子，两条才能在同一个 this.now 上落成',
  );
  assert.equal(
    done[0]!.completedAt,
    done[1]!.completedAt,
    '夹具没造出打平：这一条就没在问它想问的',
  );

  const line = composeReport(sim.snapshot()).lines.find((item) => item.includes('交付')) ?? '';
  assert.ok(!line.includes('最近一单'), `打平时不该指定哪一单最近：${line}`);
  // 少的只是排名，单数照实：两单分在两个工人名下，各一单。
  assert.ok(line.includes('交付 1 单'), `两单都报到了，只是不排名：${line}`);
});

// ------------------------------------------------------------------ animalese

test('同一句话永远生成同一串音高', () => {
  assert.deepEqual(syllablePlan('吾神降旨'), syllablePlan('吾神降旨'));
});

test('标点不发声，但会占一拍', () => {
  const plan = syllablePlan('好！');
  assert.deepEqual(plan, [plan[0], 0]);
});

test('空白不产生音节', () => {
  assert.deepEqual(syllablePlan('   '), []);
});

test('音高偏移落在 0.85..1.25 之间', () => {
  for (const value of syllablePlan('把便笺整理成三版标题')) {
    if (value === 0) continue;
    assert.ok(value >= 0.85 && value <= 1.25, `越界：${value}`);
  }
});

// --------------------------------------------------------------------- bridge

test('外部任务消息翻成世界命令', () => {
  assert.deepEqual(
    toWorldCommand({ type: 'task.assigned', taskId: 'a', taskKind: 'code', summary: '写' }),
    { kind: 'dispatch', taskKind: 'code', summary: '写' },
  );
  assert.deepEqual(toWorldCommand({ type: 'task.completed', taskId: 'a' }), { kind: 'complete' });
  assert.deepEqual(toWorldCommand({ type: 'world.weather', weather: 'rain' }), {
    kind: 'setWeather',
    weather: 'rain',
  });
});

test('桥接的收件箱取一次就空，不重复投递', () => {
  const bridge = new Bridge();
  bridge.feed({ type: 'world.weather', weather: 'rain' });
  assert.equal(bridge.takeInbox().length, 1);
  assert.equal(bridge.takeInbox().length, 0);
});

test('桥接上行只取出一次，不重复上报', () => {
  const bridge = new Bridge();
  bridge.emit({ type: 'task.delivered', taskId: 't1', summary: '写完' });
  assert.equal(bridge.drain().length, 1);
  assert.equal(bridge.drain().length, 0);
});
