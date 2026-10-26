import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack, SettingPackError } from '../src/settings/load.ts';
import { routineProfiles, selectSetting } from '../src/settings/index.ts';
import { Simulation } from '../src/world/simulation.ts';
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
