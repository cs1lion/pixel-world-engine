import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack, SettingPackError } from '../src/settings/load.ts';
import { routineProfiles, selectSetting } from '../src/settings/index.ts';
import { Simulation } from '../src/world/simulation.ts';
import { checkPlacement } from '../src/world/setup.ts';
import { parseOracleBuild } from '../src/world/oracle-build.ts';
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
  // 渡口站台要灯。其余四个区域一个都没声明 requires——它们不能因此变成门。
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
    '不声明 requires 的老设定集不能被这一版改变',
  );
});

test('requires 写错一个字母：当场拒绝，不留一道谁也过不去的门', () => {
  assert.throws(
    () =>
      loadSettingPack({
        ...DENGCHAO_RAW,
        regions: [
          { id: 'ferry', name: '渡口站台', x: 5, y: 8, w: 20, h: 10, requires: 'torch' as never },
        ],
      }),
    /requires 只能是 lamp\/shoes 或 null/,
  );
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

test('两位居民有独立出生点，潮位让作息选择真实变化', () => {
  const world = buildSettingWorld(pack);
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
