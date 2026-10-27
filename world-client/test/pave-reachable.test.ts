/**
 * 「门口连不连得出去」这个信号，以及包这条路第一次真的拦它。
 *
 * `ADR_PACK_SKIPS_WORLD_BUDGET` 待办 A 记的是：默认世界两条路由
 * `assertWorldInvariants` 拦「与祭坛之间没有通路」（它往 problems 里推的那句原文），
 * 而编译后的设定集走 `buildSettingWorld`，谁都没查。同一栋连不出去的楼，
 * 在默认世界开工即抛，在包里静静成立。
 *
 * 这个文件钉三件事：
 *   1. `paveFrom` 说得清「有没有路」，而且**不拿 `road` 空不空当有没有路**；
 *   2. 包的新建路拿到这句，连不出去就当场拒；
 *   3. 灯潮界原封不动照样起得来——这是守卫，不是误杀。
 *
 * 原来这儿还有一句「同源的 `test/world-door-reachability.test.ts` 守的是『两条路的
 * 现状都是绿的』，这里守的是『分叉被堵上了』」——**那个文件已经没有了**，而且不是
 * 改名，是 `4cead00` 主动删的：它的判据 `grid.path(altar, door).length === 0` 两个
 * 方向都不 sound（假绿——door 是 path 的 goal，被别处占地盖住的门会被改写到
 * nearestWalkable，于是非空、报成「连得到」，正好漏掉它要防的死门；假红——门开在
 * hub 上时 `start === target` 直接返回空，被判成「连不到」）。删它的人写的是
 * 「既不 sound 又被取代」。
 *
 * 所以那句话现在**两半都假**：文件不在，「两条路的现状都是绿的」也再也没有第二道
 * 闸在守。本文件钉的是三件别的事（下面那三条），没有一件是它。留着这句不改，
 * 读的人会以为删掉的那份还在这儿顶着。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack, SettingPackError } from '../src/settings/load.ts';
import { WorldGrid } from '../src/world/grid.ts';
import { doorReaches, paveFrom } from '../src/world/setup.ts';
import type { GridSpec } from '../src/world/grid.ts';

/** 空地网格：四周一圈树篱不可走，其余全通。 */
const OPEN: GridSpec = { width: 12, height: 12, border: 1, zones: [] };

/** 在格子上摆一个 1×1 的障碍。门口随手摆在它脚底下——那格不影响任何断言。 */
function block(grid: WorldGrid, x: number, y: number, id: string): void {
  assert.ok(grid.place({ instanceId: id, origin: { x, y }, w: 1, h: 1, door: { x, y: y + 1 } }));
}

// ------------------------------------------------------- paveFrom 说得清什么

test('门口被围死：有路这件事要说出来', () => {
  const grid = new WorldGrid(OPEN);
  const door = { x: 5, y: 5 };
  block(grid, 4, 5, 'a');
  block(grid, 6, 5, 'b');
  block(grid, 5, 4, 'c');
  block(grid, 5, 6, 'd');

  const paved = paveFrom(grid, door, { x: 9, y: 9 });
  assert.equal(paved.reachable, false, '四邻都被占了，这门开在世界外');
  assert.deepEqual(paved.road, []);
});

test('路本来就已经铺好了：road 是空的，楼却是连得出去的', () => {
  // 这一段整条落在祭坛区里——小径不铺进祭坛（`paveFrom` 第三行就跳过它），
  // 于是 `road` 空。可门与祭坛明明只隔一格。
  //
  // 拿 `road` 空不空判「连不连得出」，就会把这种楼误判成死的，
  // 然后去拒一栋好楼——那比不报更糟。
  const grid = new WorldGrid({
    ...OPEN,
    zones: [{ id: 'altar', x: 4, y: 4, w: 2, h: 2 }],
  });
  const paved = paveFrom(grid, { x: 5, y: 5 }, { x: 4, y: 4 });
  assert.deepEqual(paved.road, [], '整条路都在祭坛区，小径一格都不该铺');
  assert.equal(paved.reachable, true, '路在祭坛区里，不等于没有路');
});

test('门就开在镇心上：也算连得出去', () => {
  // `grid.path` 在「起点即终点」时返回空数组——她人已经在那儿了。
  // 照抄这个返回值，「门开在祭坛上」会被报成与祭坛没有通路。
  const grid = new WorldGrid(OPEN);
  const paved = paveFrom(grid, { x: 5, y: 5 }, { x: 5, y: 5 });
  assert.deepEqual(paved.road, []);
  assert.equal(paved.reachable, true, '门开在镇心上，没有比这更连得出去的');
});

// ------------------------------------------------------- 包这条路现在拦它

/**
 * 一份只摆四栋楼的灯潮界：一栋 2×2 的「孤屋」，三栋 1×1 的墙把它围住。
 *
 * 围得住的前提是 `clearMargin: 0`——`clearMargin: 1` 时留白环让自由内部恒四连通、
 * 门口侧邻永不被封（`grid.ts:258-266` 的 `canPlace`，margin 把周围几圈算进检查），
 * 这正是今天的前馈数据构造不出这个失败的原因。
 * `clearMargin: 0` 是合法的（`blueprints.ts:45`），所以这不是一份假包。
 *
 * 四栋都声明 `zone: 'industry'`：灯潮界的 `grid.zones` 拿 industry 盖住整张图
 * （`pack.ts:41`，x 1–62、y 1–46），只有 x 30–34 一条窄巷是 street。
 * `checkPlacement` 要求整块占地都在蓝图声明的分区里，所以别去挤那条巷子。
 */
function walledInPack(): ReturnType<typeof loadSettingPack> {
  const box = {
    id: 'lonely_house', displayName: '孤屋', zone: 'industry',
    footprint: { w: 2, h: 2 }, clearMargin: 0, door: { x: 1, y: 2 },
    workSpots: [{ x: 0, y: 0 }], chimney: { x: 1, y: 0 },
    accent: 'smoke', silhouette: 'flat', boundTask: null,
    palette: { body: 'timber', roof: 'copper', trim: 'trim', window: 'amber' },
  };
  const wall = (id: string, displayName: string) => ({
    id, displayName, zone: 'industry',
    footprint: { w: 1, h: 1 }, clearMargin: 0, door: { x: 0, y: 1 },
    workSpots: [{ x: 0, y: 0 }], chimney: { x: 0, y: 0 },
    accent: 'smoke', silhouette: 'flat', boundTask: null,
    palette: { body: 'timber', roof: 'copper', trim: 'trim', window: 'amber' },
  });
  return loadSettingPack({
    ...DENGCHAO_RAW,
    prefabs: {
      lonely_house: box,
      wall_west: wall('wall_west', '西墙'),
      wall_east: wall('wall_east', '东墙'),
      wall_south: wall('wall_south', '南墙'),
    },
    // 孤屋在 (5,30)，门口在 (6,32)。四邻里 (6,31) 在它自己占地里，
    // 另外三格各摆一堵墙——门就开在世界外了。
    placements: [
      { prefabId: 'lonely_house', at: { x: 5, y: 30 } },
      { prefabId: 'wall_west', at: { x: 5, y: 32 } },
      { prefabId: 'wall_east', at: { x: 7, y: 32 } },
      { prefabId: 'wall_south', at: { x: 6, y: 33 } },
    ],
  });
}

test('包里的楼门口到不了镇心：当场拒，不静静开工', () => {
  // 这一条 `buildSettingWorld` 原先谁都不查。居民到不了那栋楼，
  // 那栋楼就是死的——而死得静悄悄。
  assert.throws(
    () => buildSettingWorld(walledInPack()),
    (error: unknown) => {
      assert.ok(error instanceof SettingPackError, `该是设定集的错：${String(error)}`);
      assert.match(error.message, /孤屋\s*的门口到不了镇心/);
      return true;
    },
  );
});

test('灯潮界原封不动照样起得来：这是守卫，不是误杀', () => {
  // 今天的前馈数据构造不出「门口被隔断」，所以这条现在必须是绿的。
  // 它红只有两种原因：守卫写错了，或者谁把某扇门真的隔了出去。
  const world = buildSettingWorld(loadSettingPack(DENGCHAO_RAW));
  assert.ok(world.buildings.length > 0, '一张空图的镇志没有意义');
});

test('读档路不查这一条：存档是照着一份当年通过的世界写的', () => {
  // 读档分支不铺路（`load.ts:308` 直接 grid.place），一份没铺路的格子上
  // `grid.path` 当然大多是空的。拿它判，每一份旧存档都别想再打开。
  const pack = walledInPack();
  const buildings = buildSettingWorld(loadSettingPack(DENGCHAO_RAW)).buildings;
  const reloaded = buildSettingWorld(pack, buildings);
  assert.equal(reloaded.buildings.length, buildings.length);
});

// ------------------------------------------------------- 镇心不可走时别误杀

test('镇心在树篱上、门是离它最近的那块地：这是连得出去的', () => {
  // `loadSettingPack` 对 hub 只查越界，不查可走——hub 落在四周树篱环上是合法的。
  // 而 `grid.path` 在目标不可走时会把目标改写成离它最近的一块可走地；
  // 改写结果正好是这扇门时，它返回空数组，与「走不到」长得一模一样。
  //
  // 于是「门口到不了镇心」会报在一扇曼哈顿距离 1 的门上——那是全图离镇心
  // 最近的一块可走格。错误信息说的是假话，比不报更糟。
  const grid = new WorldGrid({
    width: 30,
    height: 20,
    border: 1,
    zones: [{ id: 'industry', x: 1, y: 1, w: 28, h: 18 }],
  });
  const door = { x: 1, y: 10 };
  // hub 在北边树篱上（x=0 整列都不可走），它周围唯一可走的就是 (1,10)。
  assert.equal(grid.isWalkable({ x: 0, y: 10 }), false, '树篱上不可走');
  assert.equal(grid.isWalkable(door), true);
  assert.deepEqual(grid.nearestWalkable({ x: 0, y: 10 }), door);
  assert.equal(doorReaches(grid, door, { x: 0, y: 10 }), true, '一门之隔，没有比这更连得出去的');
  // 反面对照：门在别处，hub 仍在树篱上——那种也该放行（改写后走得过去）。
  assert.equal(doorReaches(grid, { x: 20, y: 10 }, { x: 0, y: 10 }), true);
});

test('一扇真被围死的门，在同一个格子上仍然报死', () => {
  // 上面那条放过的是「改写后起点即终点」，不是「一律放过」。
  const grid = new WorldGrid({
    width: 30,
    height: 20,
    border: 1,
    zones: [{ id: 'industry', x: 1, y: 1, w: 28, h: 18 }],
  });
  const door = { x: 15, y: 10 };
  block(grid, 14, 10, 'a');
  block(grid, 16, 10, 'b');
  block(grid, 15, 9, 'c');
  block(grid, 15, 11, 'd');
  assert.equal(doorReaches(grid, door, { x: 0, y: 10 }), false, '四邻都被占了，这门开在世界外');
});

// ---------------------------------------------- 同一个病，隔十一行还有一处

test('作息点就踩在出生点上：这是连得出去的，不是到不了', () => {
  // `loadSettingPack` 对 `at` 和每个作息点只查越界（`load.ts:285`/`:288`），
  // 对 `at === stop` 一个字都没禁——而「她就站在那个点上」是一份完全合法的
  // 设定集：守夜人认路认到自己的脚底下。
  //
  // `grid.path` 在起点即终点时返回空数组。`load.ts:362` 照抄这个返回值，
  // 于是这份包被拒，还说「她 到不了 就站在起点上」——那句话是假话，
  // 比不报更糟。`doorReaches` 早就特判了这种，这一处没沾上。
  const pack = loadSettingPack({
    ...DENGCHAO_RAW,
    villagers: [
      {
        name: '守夜人',
        at: { x: 23, y: 29 },
        routine: [{ x: 23, y: 29, label: '就在原地站着', dwellMs: 5000 }],
      },
    ],
  });
  const world = buildSettingWorld(pack);
  assert.equal(world.grid.isWalkable({ x: 23, y: 29 }), true, '前提：那个点真的可走');
});

