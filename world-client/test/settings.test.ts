import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack, SettingPackError } from '../src/settings/load.ts';
import { routineProfiles, selectSetting } from '../src/settings/index.ts';
import { Simulation } from '../src/world/simulation.ts';
import { checkPlacement } from '../src/world/setup.ts';
import { parseOracleBuild } from '../src/world/oracle-build.ts';
import { GRIME_FULL } from '../src/world/grime.ts';
import { SaveStore, SAVE_STORAGE_KEY, type StorageLike } from '../src/ui/save-store.ts';

class Storage implements StorageLike {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const pack = loadSettingPack(DENGCHAO_RAW);

// ------------------------------------------------------- 渡有仪式（SPEC_V2 §4.6）

test('设定集可以给区域上一道门：requires 落到世界上，不设卡的区域照旧', () => {
  // 这里拿渡口做实验：把一道本来不设卡的区域改成要灯，看它真的开始要，
  // 而别的区域不因此变成门。原封不动的灯潮界里，要灯的只有叠浪楼——
  // 所以渡口在这儿照样谁都能进，那一行断的是「改设定集能改出门」。
  const gated = loadSettingPack({
    ...DENGCHAO_RAW,
    regions: DENGCHAO_RAW.regions.map((region) =>
      region.id === 'ferry' ? { ...region, requires: 'lamp' as const } : region,
    ),
  });

  // (10,16) 只在渡口里——浅滩轨道（y<14）盖不住它，才不会拿到浅滩的「没门」。
  const inside = { x: 10, y: 16 };
  const outside = { x: 2, y: 2 };
  const gatedGrid = buildSettingWorld(gated).grid;
  assert.equal(gatedGrid.requirementAt(inside), 'lamp', '声明了 requires 的区域必须真的要东西');
  assert.equal(gatedGrid.requirementAt(outside), null, '没声明的区域不设卡');

  // 而灯潮界原封不动的那一份，渡口照样谁都能进。
  assert.equal(
    buildSettingWorld(pack).grid.requirementAt(inside),
    null,
    '不声明 requires 的区域不能被这一版改变',
  );
});

test('requires 写错一个字母：当场拒绝，不留一道谁也过不去的门', () => {
  assert.throws(
    () =>
      loadSettingPack({
        ...DENGCHAO_RAW,
        regions: [
          {
            id: 'ferry', name: '渡口站台', x: 5, y: 8, w: 20, h: 10,
            requires: 'torch' as never,
            // 三色槽位照渡口站台原样给：这条用例问的是 requires 写错，
            // 与颜色无关，别让它顺带也变成一条颜色错的用例。
            primary: 'deepShade', accent: 'amber', forbidden: 'terracotta',
          },
        ],
      }),
    /requires 只能是 lamp\/shoes 或 null/,
  );
});

test('一道要凭证的区域，它的地整个都归它：没有被后声明的区域盖掉几格', () => {
  // 地域是**按声明顺序画上去的**，后画的盖先画的（`grid.ts` 那道循环）。
  // 一道要灯的区域若被后来一道不要的盖住几格，那几格就谁也不设卡——
  // 设定集里写了、世界里没有，而且静悄悄。叠浪楼与灯街压着同一块地，
  // 从前叠浪楼声明在前，于是它里头一百来格归了灯街：给它上一道门，
  // 门会一整片消失，只剩顶上两行。
  //
  // 这条按声明矩形逐格查，不抽样——抽样的那种只会告诉你"还有几格是对的"。
  const grid = buildSettingWorld(pack).grid;
  const gated = pack.regions.filter((region) => region.requires != null);
  assert.ok(gated.length > 0, '这张图上一道门都没有，这条就等于没跑');
  for (const region of gated) {
    const stolen: string[] = [];
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (let x = region.x; x < region.x + region.w; x += 1) {
        if (grid.at({ x, y })?.region !== region.id) stolen.push(`(${x},${y})`);
      }
    }
    assert.deepEqual(stolen, [], `${region.name}（要 ${region.requires}）有 ${stolen.length} 格被别的区域盖住了`);
  }
});

test('灯潮界的叠浪楼真的要一盏灯：渡有仪式在这张图上真的落下来了', () => {
  // 从前没有一份设定集声明过 requires——判定、命令、提示词三处都齐了，
  // 就是没有一个区域真的要东西。这道门在整个世界里一直是潜伏的。
  //
  // 落在叠浪楼上而不是灯街：镇心 (32,29) 与两位居民的出生点都在灯街里，
  // 灯街要灯就把世界的中心锚点和没带灯的人一起关在门后。叠浪楼不要灯，
  // 而汐的第一个作息点「点亮楼前的长灯」正在它里面，迷路人那个
  // 「在叠浪楼外等潮水退去」说的本来就是外头。
  const grid = buildSettingWorld(pack).grid;
  assert.equal(grid.requirementAt({ x: 32, y: 27 }), 'lamp', '叠浪楼里头要灯');
  assert.equal(grid.requirementAt({ x: 31, y: 26 }), 'lamp', '叠浪楼的门口也在门后');
  assert.equal(grid.requirementAt({ x: 32, y: 29 }), null, '楼外不要——镇心就在楼下两步');
  assert.equal(grid.requirementAt({ x: 36, y: 29 }), null, '汐的出生点不在门后');
  assert.equal(grid.requirementAt({ x: 23, y: 29 }), null, '迷路人的出生点不在门后');
  assert.equal(grid.requirementAt({ x: 50, y: 42 }), null, '积尘滩不要灯');
});

test('灯潮界：六栋建筑显式落位，五个语义区域不改建造分区', () => {
  const world = buildSettingWorld(pack);
  assert.equal(world.buildings.length, 6);
  assert.equal(world.grid.at({ x: 20, y: 10 })?.region, 'shoal');
  assert.equal(world.grid.at({ x: 20, y: 10 })?.zone, 'industry');
  assert.equal(world.grid.at({ x: 20, y: 7 })?.terrain, 'shallow');
  world.grid.setTideLevel(0.9);
  assert.equal(world.grid.isFloodedAt({ x: 20, y: 7 }), true);
  world.grid.setTideLevel(0);
  assert.equal(world.grid.isFloodedAt({ x: 20, y: 7 }), false);
  assert.equal(selectSetting('').authored, false);
});

test('设定集拒绝越界作息与未知蓝图，不带着半个世界开工', () => {
  assert.throws(() => loadSettingPack({ ...DENGCHAO_RAW, placements: [{ prefabId: 'missing', at: { x: 0, y: 0 } }] }), SettingPackError);
  assert.throws(() => buildSettingWorld({ ...pack, villagers: [{ ...pack.villagers[0]!, at: { x: 0, y: 0 } }] }), SettingPackError);
  assert.throws(() => loadSettingPack({ ...DENGCHAO_RAW, palette: { ...DENGCHAO_RAW.palette, amber: 'orange' } }), SettingPackError);
});

test('开局带什么凭证从设定集来：汐带着灯，迷路人两手空空', () => {  // `SettingVillagerStyle` 从前在整个代码库里没有被任何人读过——`style.lamp: true`
  // 是死数据。设定集里汐明明提着一盏灯，世界里她开局两手空空，于是叠浪楼
  // 那道门她一辈子也进不去，而她的第一个作息点就在楼里。
  //
  // 从 style 派生 carries，不在包里再开一个 carries 字段：两个字段就得永远
  // 对齐，而对不上的表现正是「她明明提着灯，那道门就是不认」。
  const world = buildSettingWorld(pack);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '迷路人',
    villagerNames: pack.villagers.map((v) => v.name),
    villagerProfiles: routineProfiles(pack),
    blueprints: pack.blueprints,
  });
  const carriesOf = (name: string): readonly string[] | undefined =>
    sim.snapshot().villagers.find((v) => v.name === name)?.carries;

  assert.deepEqual(carriesOf('汐'), ['lamp'], '设定集说她带着灯，开局她就带着');
  assert.deepEqual(carriesOf('迷路人'), [], '没说带就是两手空空');
});

test('生在一道进不去的门里：当场拒，不让她静静生下来然后一步也动不了', () => {
  // 她兜里那几件过不了脚下这道门，于是世界里会有一个人永远站着不动，
  // 而没有任何东西会报错。装载期认得出这件事（style.lamp 已经算成 carries），
  // 所以在这儿拒——这正是上面那段「可达性故意不过门」的例外：门后的作息点
  // 可以合法，出生点不行，她 t=0 就在那儿。
  const trapped = loadSettingPack({
    ...DENGCHAO_RAW,
    villagers: [
      {
        name: '守夜人',
        at: { x: 32, y: 27 },
        routine: [{ x: 32, y: 29, label: '下楼去', dwellMs: 5000 }],
      },
    ],
  });
  assert.throws(() => buildSettingWorld(trapped), /守夜人 出生在要 lamp 的叠浪楼里/);
});

test('门落下之后两个人的路真的不一样：汐进得去叠浪楼，迷路人进不去', () => {
  // 这是整条链唯一看得见的后果。判定、命令、提示词、开局凭证四处都接上了，
  // 若这里还是两个人走得一样，那道门就只是数据里的一行字。
  const world = buildSettingWorld(pack);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '迷路人',
    villagerNames: pack.villagers.map((v) => v.name),
    villagerProfiles: routineProfiles(pack),
    blueprints: pack.blueprints,
  });
  // 叠浪楼的声明矩形。汐的第一个作息点「点亮楼前的长灯」就在它里面，
  // 迷路人四个作息点一个都不在。
  const inBathhouse = (p: { x: number; y: number }): boolean =>
    p.x >= 27 && p.x <= 38 && p.y >= 17 && p.y <= 27;
  const entered = new Set<string>();
  for (let i = 0; i < 900; i += 1) {
    sim.update(100);
    for (const villager of sim.snapshot().villagers) {
      if (inBathhouse(villager.pos)) entered.add(villager.name);
    }
  }

  assert.ok(entered.has('汐'), '汐兜里有灯，她该进得去叠浪楼');
  assert.equal(entered.has('迷路人'), false, '迷路人两手空空，她一步也不该进去');
});

// ------------------------------- 露话池（清洗即还原，SPEC_V2 §4.6）

test('露话池整条链通到世界上：灯潮界的灯洗得出它自己那句话', () => {
  // 链是四段：池子写在设定集里 → 装载器编译成一张表 → 世界落件时按种类
  // 取一句 → 洗干净那句话才出来。断在任何一环，清洗就只是数据里的一行字。
  const world = buildSettingWorld(pack);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '汐',
    villagerNames: pack.villagers.map((v) => v.name),
    villagerProfiles: routineProfiles(pack),
    blueprints: pack.blueprints,
    propReveals: pack.propReveals,
  });

  sim.enqueue({ kind: 'miracle', miracle: 'light' });
  sim.update(16);
  const prop = sim.snapshot().props[0]!;
  assert.equal(prop.kind, 'lamp', '夹具：神迹落下的是一盏灯');
  assert.equal(prop.grime, GRIME_FULL, '落地就脏——话在脏底下');
  assert.ok(
    DENGCHAO_RAW.propReveals!.lamp.includes(prop.reveal!),
    `配的得是灯潮界写的那三句之一，结果是 ${prop.reveal}`,
  );

  sim.enqueue({ kind: 'cleanProp', propId: prop.id });
  const results = sim.update(16);
  const reply = results[results.length - 1]!;
  assert.equal(reply.ok, true, `洗不该被拒：${reply.message}`);
  assert.ok(reply.message.includes(prop.reveal!), '回执里得有那句话本身');
});

test('露话池的种类写错一个字母：当场拒绝，不留一类永远不脏的摆件', () => {
  // 按 `Record<string, …>` 收原文，这个错才写得出来。若按 PropKind 收，
  // 类型上就没有 `lanp` 这种键，装载期那道校验也就白写了。
  assert.throws(
    () => loadSettingPack({
      ...DENGCHAO_RAW,
      propReveals: { ...DENGCHAO_RAW.propReveals, lanp: ['写错了'] },
    }),
    /不是 lamp \/ tree \/ banner 之一/,
  );
});

test('露话池写了却空着：拒绝——「还没想好」和「不想给」是两件事', () => {
  // `lamp: []` 那句话的实际行为是「灯不脏」，可它读起来像「这儿有话」。
  // 诚实的省略是整项省掉，所以空池子必须被拒。
  assert.throws(
    () => loadSettingPack({ ...DENGCHAO_RAW, propReveals: { lamp: [] } }),
    /露话池是空的/,
  );
  assert.throws(
    () => loadSettingPack({ ...DENGCHAO_RAW, propReveals: { tree: [' ', ''] } }),
    /露话池里有一句是空的/,
  );
});

test('一份露话都不给：编译成「没有」，不是错误', () => {
  // 莞尔镇就是这样。v2 只交付承载设定的槽位（§6）——槽空着不是失败。
  const bare = loadSettingPack({ ...DENGCHAO_RAW, propReveals: undefined });
  assert.equal(bare.propReveals, undefined, '没有池子就是没有');
});

test('两位居民有独立出生点，潮位让作息选择真实变化', () => {  const world = buildSettingWorld(pack);
  const sim = new Simulation({ grid: world.grid, buildings: world.buildings, altar: world.altar, villagerName: '迷路人', villagerNames: pack.villagers.map(v => v.name), villagerProfiles: routineProfiles(pack), blueprints: pack.blueprints });
  assert.notDeepEqual(sim.snapshot().villagers[0]?.pos, sim.snapshot().villagers[1]?.pos);
  assert.equal(sim.snapshot().villagers[1]?.lampOil, 1);
  for (let i = 0; i < 500; i++) sim.update(100);
  assert.ok(sim.snapshot().villagers.every(v => v.routine !== null), '居民必须实际进入自己的日常');
});

test('存档读写、清空与坏档备份全部绑定自己的设定集槽', () => {
  const storage = new Storage();
  const world = buildSettingWorld(pack);
  const sim = new Simulation({ grid: world.grid, buildings: world.buildings, altar: world.altar, villagerName: '迷路人', villagerNames: ['迷路人', '汐'] });
  const legacy = new SaveStore({ storage });
  const other = new SaveStore({ storage, storageKey: pack.saveKey, wallClock: () => 44 });
  other.write(sim.toSave());
  assert.equal(storage.getItem(SAVE_STORAGE_KEY), null);
  assert.ok(storage.getItem(pack.saveKey));
  legacy.write(sim.toSave());
  other.backupCorrupt('{bad');
  assert.ok(other.listBackups()[0]?.startsWith(`${pack.saveKey}.corrupt.`));
  other.clear();
  assert.ok(storage.getItem(SAVE_STORAGE_KEY), '灯潮界清档不能清掉旧世界');
  assert.equal(storage.getItem(pack.saveKey), null);
});

test('构件越界与长度缺失在装载时就被拒绝，不会安静地画到地图外', () => {
  const outside = { ...DENGCHAO_RAW, scenery: [{ kind: 'statue' as const, at: { x: 999, y: 4 } }] };
  assert.throws(() => loadSettingPack(outside), SettingPackError);

  const noLength = { ...DENGCHAO_RAW, scenery: [{ kind: 'track' as const, at: { x: 2, y: 8 } }] };
  assert.throws(() => loadSettingPack(noLength), SettingPackError);

  const overrun = { ...DENGCHAO_RAW, scenery: [{ kind: 'track' as const, at: { x: 40, y: 8 }, length: 40 }] };
  assert.throws(() => loadSettingPack(overrun), SettingPackError);
});

test('浅滩底色与水色不同：潮汐得在画面上看得出来，不能只是 HUD 上的数字', () => {
  const water = pack.palette.water;
  const shallowGround = pack.terrainColors.shallow;
  assert.notEqual(shallowGround, water, '退潮滩涂与满潮水面不能是同一块颜色');
  // 站台站在石砌码头上，不是浮在水面。
  assert.equal(buildSettingWorld(pack).grid.at({ x: 12, y: 12 })?.terrain, 'stone');
});

test('灯潮界至少留一个能建成的模板：所有模板都落位，白名单建造就永远只能被拒', () => {
  const placed = new Set(pack.placements.map((placement) => placement.prefabId));
  const buildable = [...pack.blueprints.keys()].filter((id) => !placed.has(id));
  assert.ok(
    buildable.length > 0,
    '没有一个未落位的模板，building.add 在这张图上是一句永远做不到的话',
  );
  // 留白的那一个必须是世界真能落下的：找到至少一格合法空地。
  const world = buildSettingWorld(pack);
  const blueprint = pack.blueprints.get(buildable[0]!)!;
  let spot: { x: number; y: number } | null = null;
  for (let y = 2; y < world.grid.height - 4 && spot === null; y += 1) {
    for (let x = 2; x < world.grid.width - 5; x += 1) {
      if (checkPlacement(world.grid, blueprint, { x, y }).ok) {
        spot = { x, y };
        break;
      }
    }
  }
  assert.ok(spot !== null, `${blueprint.displayName} 一个合法位置都找不到`);
});

test('灯潮界的模板随名字能被说出来：造物规则要认得它的显示名', () => {
  const intent = parseOracleBuild('建一座候车亭', pack.blueprints);
  assert.notEqual(intent, null, '「建一座候车亭」应当认成造物，而不是落到问模型');
  assert.equal(intent?.action, 'build');
  assert.equal(intent?.templateId, 'waiting_shelter');
  // 旧世界里没有这份蓝图：同一条别名表不能把旧世界也带偏。
  const legacy = selectSetting('').blueprints;
  assert.equal(parseOracleBuild('建一座候车亭', legacy), null);
});

test('输入框举的例子必须在这张图上真能办到：未落位的模板都得能按名字说出来', () => {
  // `main.ts` 拿第一个未落位模板的显示名去写输入框占位符。占位符是玩家看到的
  // 第一个例句，如果那句解析不出造物、或模板根本不存在，例句就成了个坑。
  const unplaced = [...pack.blueprints.values()].filter(
    (blueprint) => !pack.placements.some((placement) => placement.prefabId === blueprint.id),
  );
  assert.ok(unplaced.length > 0);
  for (const blueprint of unplaced) {
    const intent = parseOracleBuild(`建一座${blueprint.displayName}`, pack.blueprints);
    assert.equal(intent?.templateId, blueprint.id, `「建一座${blueprint.displayName}」认不出来`);
  }
});
