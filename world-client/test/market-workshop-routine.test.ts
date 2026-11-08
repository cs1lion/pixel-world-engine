/**
 * 集市与工坊的作息落点：人按场所走进去，关着就退回锚点。
 *
 * 这一条钉五件事：
 *
 * 1. **锚落在摊位上**：集市的锚 (17,26) 必须真的有摊位（`stall_north_1`）——
 *    判据是「坐标上有没有摊」，不是「位移小不小」。
 * 2. **工坊没有新身份**：`boiler_annex#1` / `wave_house#1` 的 site id 就是建筑的
 *    `instanceId`；锅炉房用坐标锚 (33,15)（门 (31,17) 在要灯的区域里，炉匠没灯），
 *    大浴场清洗用建筑锚（门），两者不各造一套 id。
 * 3. **门控一份读数**：`workshop` 的 06:00–17:00 由 `siteStateAt` 折成
 *    `workshopOpen`；集市两态（早市 / 夜市）各是一个 flag，任一命中即开。
 * 4. **时钟边界**：所有 `fromMinute/toMinute` 都是引擎约定（设定集只给
 *    「午后 / 入夜」「白天斜射阳光」，没有钟点），期望值从 `TIMETABLE` 派生。
 * 5. **行为可观测**：开市窗口里有人站在锚点上，关着的窗口里没有——正反都钉。
 *
 * 动态 import 是刻意的：base 上包里没有 market / workshop 场所、没有
 * `workshopOpen`，测试必须红在**断言**上，不能变成 module / compile。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const MINUTE_MS = 60_000;

/** 集市锚：`stall_north_1` 就在这一格上（`lamp-street.ts`）。 */
const MARKET_AT = { x: 17, y: 26 } as const;
/** 锅炉房落点：现状作息点，距炉膛 1 / 煤堆 2；门 (31,17) 在要灯的区域里。 */
const BOILER_AT = { x: 33, y: 15 } as const;

test('集市与工坊作息：锚落在摊上、按场所门控、关着退回锚点', async () => {
  const load = await import('../src/settings/load.ts');
  const index = await import('../src/settings/index.ts');
  const packModule = await import('../src/settings/dengchao/pack.ts');
  const env = await import('../src/world/environment.ts');
  const routines = await import('../src/world/routines.ts');
  const table = await import('../src/world/timetable.ts');
  const simModule = await import('../src/world/simulation.ts');
  if (typeof load.loadSettingPack !== 'function') assert.fail('loadSettingPack 缺失');
  if (typeof index.routineProfiles !== 'function') assert.fail('routineProfiles 缺失');
  if (typeof index.siteTargetResolver !== 'function') assert.fail('siteTargetResolver 缺失');
  if (typeof routines.siteBeatApplies !== 'function') assert.fail('siteBeatApplies 缺失');
  if (typeof simModule.Simulation !== 'function') assert.fail('Simulation 缺失');

  const raw = packModule.DENGCHAO_RAW;
  const pack = load.loadSettingPack(raw);
  const world = load.buildSettingWorld(pack);
  const sites = (pack as unknown as {
    sites?: readonly { id: string; kind: string; x?: number; y?: number; building?: string }[];
  }).sites;
  if (sites === undefined || sites.length === 0) assert.fail('包里没有 sites：落点无处解析');

  // 1. 集市锚：id = market（时刻表已有的门），锚必须落在摊位上。
  const market = sites.find((site) => site.id === 'market');
  assert.equal(market?.kind, 'market', '集市锚必须登记 kind market');
  assert.deepEqual({ x: market?.x, y: market?.y }, MARKET_AT, '集市锚取 (17,26)');
  const stalls = (raw.scenery as readonly { kind: string; at: { x: number; y: number } }[])
    .filter((item) => item.kind === 'stall');
  assert.ok(
    stalls.some((stall) => stall.at.x === MARKET_AT.x && stall.at.y === MARKET_AT.y),
    '集市锚的坐标上必须有摊位：判据是「坐标上有没有摊」，不是位移',
  );

  // 2. 工坊：id 就是建筑的 instanceId，两种锚形式互斥。
  const boiler = sites.find((site) => site.id === 'boiler_annex#1');
  assert.equal(boiler?.kind, 'workshop', '锅炉房锚必须登记 kind workshop');
  assert.deepEqual({ x: boiler?.x, y: boiler?.y }, BOILER_AT, '锅炉房锚取现状作息点 (33,15)');
  assert.equal('building' in (boiler ?? {}), false, '锅炉房是坐标锚，不许同时给 building');
  const bath = sites.find((site) => site.id === 'wave_house#1');
  assert.equal(bath?.kind, 'workshop', '大浴场清洗锚必须登记 kind workshop');
  assert.equal(bath?.building, 'wave_house#1', '建筑锚的 id 必须等于该建筑的 instanceId');
  assert.equal(bath?.x, undefined, '建筑锚不许同时给 x');
  assert.equal(bath?.y, undefined, '建筑锚不许同时给 y');

  // 3. 解析：坐标锚原样落地；建筑锚走门；解析不到都 throw，不静默。
  const resolve = index.siteTargetResolver(pack, world.grid, world.buildings);
  assert.deepEqual(resolve('market'), MARKET_AT, '集市锚必须在摊位上落地');
  assert.deepEqual(resolve('boiler_annex#1'), BOILER_AT, '锅炉房锚必须落在现状作息点');
  const bathPoint = resolve('wave_house#1');
  assert.ok(world.grid.isWalkable(bathPoint), `大浴场清洗落点不可走：(${bathPoint.x}, ${bathPoint.y})`);
  // 门是 (31,26)：允许 nearestWalkable 挪一格，但落点必须贴着门。
  assert.ok(
    Math.abs(bathPoint.x - 31) + Math.abs(bathPoint.y - 26) <= 1,
    `大浴场清洗落点离门太远：(${bathPoint.x}, ${bathPoint.y})`,
  );
  assert.throws(() => resolve('no_such_site'), /未知场所 no_such_site/);
  // 建筑锚没有建筑表就必须 throw，不许悄悄退成 (0,0) 或坐标。
  assert.throws(
    () => index.siteTargetResolver(pack, world.grid)('wave_house#1'),
    /建筑/,
    '没有建筑表时，建筑锚必须 throw',
  );

  // 4. 时钟边界：从 TIMETABLE 派生，不抄字面量。
  const beatMinute = (id: string): number => {
    const beat = table.TIMETABLE.find((item) => item.id === id);
    if (beat === undefined) assert.fail(`时刻表里没有 ${id}`);
    return beat.minuteOfDay;
  };
  const frameAt = (minute: number) => env.environmentAt(minute * MINUTE_MS, 'clear', 0.5);

  assert.ok(table.SITE_KINDS.includes('workshop'), 'SITE_KINDS 必须收 workshop（门控种类）');
  const workshopRow = table.SITE_TABLE.find((site) => site.id === 'workshop');
  assert.equal(workshopRow?.kind, 'workshop', 'SITE_TABLE 必须有 workshop 门控行');
  assert.deepEqual(
    workshopRow?.bands.map((band) => [band.fromMinute, band.toMinute, band.phase]),
    [[beatMinute('wash_bridge'), beatMinute('work_end'), 'open']],
    '工坊 06:00–17:00 是引擎约定：两端都从 TIMETABLE 派生',
  );

  // 5. 门控：一份读数，集市两态任一命中。
  const gate = (site: string, minute: number, label: string): boolean => {
    try {
      return routines.siteBeatApplies(site, frameAt(minute));
    } catch (error) {
      assert.fail(`${label} 的门控没接上：${(error as Error).message}`);
    }
  };
  assert.equal(gate('market', 15 * 60, '15:00 集市'), true, '午后集市该开');
  assert.equal(gate('market', 20 * 60, '20:00 集市'), true, '入夜灯笼点亮，夜市也该开');
  assert.equal(gate('market', 17 * 60 + 30, '17:30 集市'), false, '收工后到开夜之前该关');
  assert.equal(gate('market', 23 * 60, '23:00 集市'), false, '22:00 之后该关');
  assert.equal(gate('workshop', 10 * 60, '10:00 工坊'), true, '白天斜射阳光，工坊该开');
  assert.equal(gate('workshop', 18 * 60, '18:00 工坊'), false, '收工后该关');
  assert.equal(gate('workshop', 5 * 60 + 30, '05:30 工坊'), false, '打水之前该关');

  assert.ok(frameAt(10 * 60).flags.has('workshopOpen'), '10:00 帧里必须有 workshopOpen');
  assert.ok(!frameAt(18 * 60).flags.has('workshopOpen'), '18:00 帧里不许有 workshopOpen');
  assert.ok(!frameAt(5 * 60 + 30).flags.has('workshopOpen'), '05:30 帧里不许有 workshopOpen');

  // 6. 登记表：数组非空、顺序无关；集市两个 flag 都要在。
  const flagsTable = (routines as unknown as {
    SITE_FLAGS?: Readonly<Record<string, readonly string[]>>;
  }).SITE_FLAGS;
  if (flagsTable === undefined) assert.fail('routines.ts 必须导出 SITE_FLAGS（门控登记表）');
  assert.deepEqual(flagsTable.market, ['marketOpen', 'nightMarket'], '集市的开关是两态任一');
  assert.ok(flagsTable.workshop?.includes('workshopOpen'), '工坊的开关是 workshopOpen');
  for (const [kind, flags] of Object.entries(flagsTable)) {
    assert.ok(flags.length > 0, `场所 ${kind} 的开关是空表：那是永不开的静默门`);
  }

  // 7. 行为：开着的窗口里有人站在锚点上，关着的窗口里没有。
  const profiles = index.routineProfiles(pack, resolve);
  const hitsAt = (initialNow: number, hours: number, target: { x: number; y: number }): Set<string> => {
    const sim = new simModule.Simulation({
      grid: world.grid,
      buildings: world.buildings,
      altar: pack.hub,
      villagerName: pack.villagers[0]!.name,
      villagerNames: pack.villagers.map((villager) => villager.name),
      villagerProfiles: profiles,
      blueprints: pack.blueprints,
      wallClock: () => 1000,
      initialNow,
    });
    const hits = new Set<string>();
    const end = hours * 60 * MINUTE_MS;
    // 落点可能被 nearestWalkable 挪一格，取锚周围 1 格都算「站在那儿」。
    for (let t = 0; t < end; t += 1000) {
      sim.update(1000);
      for (const villager of sim.snapshot().villagers) {
        if (Math.abs(villager.pos.x - target.x) + Math.abs(villager.pos.y - target.y) <= 1) {
          hits.add(villager.id);
        }
      }
    }
    return hits;
  };

  const minuteMs = (minute: number): number => minute * MINUTE_MS;
  const marketNoon = hitsAt(minuteMs(8 * 60 + 30), 2, MARKET_AT);
  assert.ok(marketNoon.size > 0, '08:30–10:30 集市锚上必须有人');
  assert.ok(hitsAt(minuteMs(19 * 60 + 30), 1, MARKET_AT).size > 0, '19:30–20:30 夜市锚上必须有人');
  assert.equal(hitsAt(minuteMs(22 * 60 + 30), 1.5, MARKET_AT).size, 0, '22:30 之后集市锚上不该有人');
  assert.ok(hitsAt(minuteMs(8 * 60 + 30), 2, BOILER_AT).size > 0, '08:30–10:30 锅炉房锚上必须有人');
  assert.ok(hitsAt(minuteMs(8 * 60 + 30), 2, bathPoint).size > 0, '08:30–10:30 大浴场清洗落点上必须有人');
  assert.equal(hitsAt(minuteMs(17 * 60 + 30), 2, BOILER_AT).size, 0, '收工后锅炉房锚上不该有人');
  assert.equal(hitsAt(minuteMs(17 * 60 + 30), 2, bathPoint).size, 0, '收工后大浴场清洗落点上不该有人');

  console.log(JSON.stringify({ marketAt: MARKET_AT, boilerAt: BOILER_AT, bathPoint, marketNoon: [...marketNoon] }));
});
