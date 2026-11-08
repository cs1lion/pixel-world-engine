/**
 * 花径作息：村民要真的走进那处口袋，到点站着，不是只换一块牌子。
 *
 * 这一条钉四件事：
 *
 * 1. **按场所解析落点**：作息的目标不再写死坐标，`site: 'courtyard'` 由包的
 *    `sites` 表 + 地图的可走格解析；解析不到就 throw，不许静默落到 (0,0)。
 * 2. **门控只有一份读数**：花径开不开由 `siteStateAt('courtyard')` 决定，
 *    再折成环境帧 flag——不在作息里另写一套时间判断。
 * 3. **落点是走得到的草地/小径**：落在中央净空（x6..7），不在花床
 *    （两列 x4..5 / x8..9，y21..24），不在树篱（x2..3、x10..11、y19..20）。
 * 4. **行为可观测**：14:00–17:00 的花径口袋里有人（≥1），09:00–11:00 是 0。
 *    正反两条都钉——只钉正例会假绿（人本来就站在那儿也能过）。
 *
 * 动态 import 是刻意的：base 上包里没有 `sites`、也没有 `site` 落点，测试必须红在
 * **断言**上，不能变成 module / compile。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS } from '../src/world/memory/config.ts';

const MINUTE_MS = 60_000;

/** 花径口袋：外框 x2..11 × y19..27，可走的是内里 x4..9 × y21..27。 */
const POCKET = { x0: 2, y0: 19, x1: 11, y1: 27 } as const;
const WALKABLE_IN_POCKET = { x0: 4, y0: 21, x1: 9, y1: 27 } as const;
/** 中央净空：两格宽，两个人并排各占一格。 */
const CENTER = { x0: 6, y0: 21, x1: 7, y1: 27 } as const;
/** 两列花床的格子：x4..5 与 x8..9，y21..24——落点不许压在花上。 */
const FLOWER_BEDS = new Set(
  [4, 5, 8, 9].flatMap((x) => [21, 22, 23, 24].map((y) => `${x},${y}`)),
);

function inPocket(x: number, y: number): boolean {
  return x >= POCKET.x0 && x <= POCKET.x1 && y >= POCKET.y0 && y <= POCKET.y1;
}

/** 「人在花径里」只算可走内里：树篱（x10..11 / y19..20）是树，可走但不算站在花径。 */
function inCourtyard(x: number, y: number): boolean {
  return x >= WALKABLE_IN_POCKET.x0 && x <= WALKABLE_IN_POCKET.x1
    && y >= WALKABLE_IN_POCKET.y0 && y <= WALKABLE_IN_POCKET.y1;
}

function onBed(x: number, y: number): boolean {
  return FLOWER_BEDS.has(`${x},${y}`);
}

test('花径作息：按场所解析落点、按 siteStateAt 门控、到点有人停留', async () => {
  const load = await import('../src/settings/load.ts');
  const index = await import('../src/settings/index.ts');
  const packModule = await import('../src/settings/dengchao/pack.ts');
  const env = await import('../src/world/environment.ts');
  const simModule = await import('../src/world/simulation.ts');
  if (typeof load.loadSettingPack !== 'function') assert.fail('loadSettingPack 缺失');
  if (typeof index.routineProfiles !== 'function') assert.fail('routineProfiles 缺失');
  if (typeof index.siteTargetResolver !== 'function') assert.fail('siteTargetResolver 缺失：落点只能写死坐标');
  if (typeof env.environmentAt !== 'function') assert.fail('environmentAt 缺失');
  if (typeof simModule.Simulation !== 'function') assert.fail('Simulation 缺失');

  const raw = packModule.DENGCHAO_RAW;
  const pack = load.loadSettingPack(raw);
  const world = load.buildSettingWorld(pack);

  // 1. 包里得有场所表与指向花径的作息。
  const sites = (pack as unknown as { sites?: readonly { id: string; kind: string; x: number; y: number }[] }).sites;
  if (sites === undefined || sites.length === 0) assert.fail('包里没有 sites：落点无处解析');
  const courtyardSites = sites.filter((site) => site.kind === 'courtyard');
  if (courtyardSites.length === 0) assert.fail('包里没有 courtyard 场所');
  const stops = pack.villagers.flatMap((villager) => villager.routine as readonly { site?: string }[]);
  const courtyardStops = stops.filter(
    (stop) => typeof stop.site === 'string' && courtyardSites.some((site) => site.id === stop.site),
  );
  if (courtyardStops.length === 0) assert.fail('没有任何一条作息指向花径：人不会走过去');

  // 2. 解析：落到口袋里可走的草地，不压花、不站树篱；两个站位互不重叠。
  const resolve = index.siteTargetResolver(pack, world.grid);
  const points = courtyardSites.map((site) => resolve(site.id));
  if (points.length < 2) assert.fail('花径只有一个站位锚：中央净空两格宽，两个人得各占一格');
  for (const point of points) {
    assert.ok(inPocket(point.x, point.y), `落点跑出口袋：(${point.x}, ${point.y})`);
    assert.ok(
      point.x >= WALKABLE_IN_POCKET.x0 && point.x <= WALKABLE_IN_POCKET.x1
      && point.y >= WALKABLE_IN_POCKET.y0 && point.y <= WALKABLE_IN_POCKET.y1,
      `落点不在可走区：(${point.x}, ${point.y})`,
    );
    assert.ok(
      point.x >= CENTER.x0 && point.x <= CENTER.x1 && point.y >= CENTER.y0 && point.y <= CENTER.y1,
      `落点不在中央净空：(${point.x}, ${point.y})`,
    );
    assert.ok(!onBed(point.x, point.y), `落点压在花床上：(${point.x}, ${point.y})`);
    assert.ok(world.grid.isWalkable(point), `落点不可走：(${point.x}, ${point.y})`);
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i]!;
      const b = points[j]!;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(a.x !== b.x || a.y !== b.y, `两个人占同一格：(${a.x}, ${a.y})`);
      assert.ok(gap >= 1, `两个站位挨得太近：${gap}`);
    }
  }

  // 3. 解析失败必须确定：未知场所 throw；解析不到可走格 throw。
  assert.throws(() => resolve('park'), /未知场所 park/);
  const deadGrid = { nearestWalkable: () => null };
  assert.throws(
    () => index.siteTargetResolver(pack, deadGrid)('courtyard'),
    /解析不到可走格/,
  );

  // 4. 门控只有一份读数：花径 14:00–17:00 开，09:00 不开。
  const open = env.environmentAt(15 * 60 * MINUTE_MS, 'clear', 0.5);
  const shut = env.environmentAt(9 * 60 * MINUTE_MS, 'clear', 0.5);
  assert.ok(open.flags.has('courtyardOpen'), '15:00 花径该开着');
  assert.ok(!shut.flags.has('courtyardOpen'), '09:00 花径不该开');

  // 5. 行为：跑真 Simulation，两个窗口各取一次读数。
  const profiles = index.routineProfiles(pack, resolve);
  const sample = (initialNow: number, hours: number): { minute: number; id: string; x: number; y: number }[] => {
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
    const hits: { minute: number; id: string; x: number; y: number }[] = [];
    const end = hours * 60 * MINUTE_MS;
    for (let t = 0; t < end; t += 1000) {
      sim.update(1000);
      const minute = initialNow / MINUTE_MS + Math.round(t / MINUTE_MS);
      for (const villager of sim.snapshot().villagers) {
        if (inCourtyard(villager.pos.x, villager.pos.y)) {
          hits.push({ minute, id: villager.id, x: villager.pos.x, y: villager.pos.y });
        }
      }
    }
    return hits;
  };

  const afternoon = sample(14 * 60 * MINUTE_MS, 3);
  if (afternoon.length === 0) assert.fail('14:00–17:00 花径里一个人也没有');
  const morning = sample(9 * 60 * MINUTE_MS, 2);
  assert.equal(morning.length, 0, `09:00–11:00 花径里不该有人，实测 ${morning.length} 条读数`);

  // 读数交给出口打印，测试本身只钉「有 / 没有」。
  const first = afternoon[0]!;
  const representative = afternoon.find((hit) => !onBed(hit.x, hit.y));
  if (representative === undefined) assert.fail('到过花径的人都压在花床上');
  console.log(JSON.stringify({
    courtyardPoints: points,
    firstContact: first,
    sample: [0, Math.floor(afternoon.length / 2), afternoon.length - 1]
      .map((i) => afternoon[i])
      .filter((hit) => hit !== undefined),
    dayMs: DAY_MS,
  }));
});
