import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, LARGE_ALTAR, biomeRingAllows, buildLargeWorld, buildWorld, checkPlacement, isWildSide, placeBlueprint } from '../src/world/setup.ts';
import { BIOME_RADII } from '../src/world/biomes.ts';
import { Simulation } from '../src/world/simulation.ts';
import { composeReport } from '../src/world/report.ts';
import { WorldGrid } from '../src/world/grid.ts';
import type { PrefabBlueprint } from '../src/world/types.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

const plot = blueprints.get('workshop_plot');
if (plot === undefined) throw new Error('测试依赖 workshop_plot 蓝图');

// ------------------------------------------------------------------ 合法位置

test('合法位置：扩建样板能落在它自己的分区里', () => {
  const world = buildWorld(blueprints);
  const slot = world.grid.findBestSlot(plot, ALTAR);
  assert.ok(slot !== null, '世界初始状态应当有空位');

  const result = checkPlacement(world.grid, plot, slot);
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
});

// ------------------------------------------------------------------ 五种拒绝理由

test('越界：原点在世界外 → edge', () => {
  const world = buildWorld(blueprints);
  const result = checkPlacement(world.grid, plot, { x: -2, y: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'edge');
});

test('越界：占地伸出世界右边界 → edge', () => {
  const world = buildWorld(blueprints);
  const result = checkPlacement(world.grid, plot, { x: world.grid.width - 1, y: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'edge');
});

test('分区不符：把工业区的样板放到书斋区 → outOfZone', () => {
  const world = buildWorld(blueprints);
  // 找一个明确属于 scholarly 分区的格子。
  let target: { x: number; y: number } | null = null;
  for (let y = 0; y < world.grid.height && target === null; y += 1) {
    for (let x = 0; x < world.grid.width; x += 1) {
      if (world.grid.zoneOf({ x, y }) === 'scholarly') {
        target = { x, y };
        break;
      }
    }
  }
  assert.ok(target !== null, '世界应当有 scholarly 分区');
  const result = checkPlacement(world.grid, plot, target);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'outOfZone');
});

test('被占用：落在已建楼的位置上 → occupied', () => {
  const world = buildWorld(blueprints);
  const existing = world.buildings[0];
  assert.ok(existing !== undefined);
  const result = checkPlacement(world.grid, plot, existing.origin);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'occupied');
});

/**
 * 合成网格：一整块 industry 分区，没有真实世界的既有建筑干扰。
 * 用来精确构造「只有这一条规则不满足」的场景。
 */
function syntheticGrid(width = 16, height = 12): WorldGrid {
  return new WorldGrid({
    width,
    height,
    border: 1,
    zones: [{ id: 'industry', x: 0, y: 0, w: width, h: height }],
  });
}

const syntheticPlot: PrefabBlueprint = {
  ...plot,
  footprint: { w: 4, h: 3 },
  // 关门放在占地正下方一格：留白为 0 时它才不会被 margin 检查覆盖。
  clearMargin: 0,
  door: { x: 1, y: 3 },
};

test('门口被堵：占地合法但门口被占 → doorBlocked', () => {
  const grid = syntheticGrid();
  // 在门口的落点先放一栋楼。
  grid.place({ instanceId: 'blocker', origin: { x: 5, y: 6 }, w: 3, h: 2, door: { x: 6, y: 5 } });

  const result = checkPlacement(grid, syntheticPlot, { x: 4, y: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'doorBlocked');
});

test('留白不足：占地空着，但紧贴已有建筑 → margin', () => {
  const grid = syntheticGrid();
  // 邻居放在 (4,4)，与待建占地之间只隔 0 格；margin=1 的蓝图会拒绝。
  grid.place({ instanceId: 'neighbor', origin: { x: 4, y: 4 }, w: 4, h: 3, door: { x: 5, y: 3 } });

  const withMargin: PrefabBlueprint = { ...syntheticPlot, clearMargin: 1, door: { x: 1, y: 3 } };
  const result = checkPlacement(grid, withMargin, { x: 4, y: 7 });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'margin');
});

// ------------------------------------------------------------------ 与自动落位一致

test('校验与自动落位用同一套规则：findBestSlot 给出的位置必然通过', () => {
  const world = buildWorld(blueprints);
  for (const blueprint of blueprints.values()) {
    const slot = world.grid.findBestSlot(blueprint, ALTAR);
    if (slot === null) continue;
    const result = checkPlacement(world.grid, blueprint, slot);
    assert.equal(
      result.ok,
      true,
      `${blueprint.id} 的自动落点未通过校验：${result.ok === false ? result.reason : ''}`,
    );
  }
});

// ------------------------------------------------------------------ 指定位置建楼

test('指定位置建楼：落点就是玩家给的那个', () => {
  const world = buildWorld(blueprints);
  const slot = world.grid.findBestSlot(plot, ALTAR);
  assert.ok(slot !== null);

  const placed = placeBlueprint(world.grid, plot, 'plot#custom', ALTAR, slot);
  assert.ok(placed !== null);
  assert.deepEqual(placed.building.origin, slot, '必须落在指定位置，不能自己挑');
});

test('不指定位置时行为不变：仍然走 findBestSlot', () => {
  const world = buildWorld(blueprints);
  const expected = world.grid.findBestSlot(plot, ALTAR);
  const placed = placeBlueprint(world.grid, plot, 'plot#auto', ALTAR);
  assert.ok(placed !== null);
  assert.deepEqual(placed.building.origin, expected);
});

test('指定非法位置时返回 null，不建半截楼', () => {
  const world = buildWorld(blueprints);
  const before = world.grid.countOccupied();
  const placed = placeBlueprint(world.grid, plot, 'plot#bad', ALTAR, { x: -3, y: -3 });
  assert.equal(placed, null);
  assert.equal(world.grid.countOccupied(), before, '被拒时不能占用任何格子');
});

// ---------------------------------------------- 群落闸为什么必须存在

test('群落环的边界：craftRing 上是镇内，外侧一寸才是郊野', () => {
  // 距离按左上角在整数尺上量。这里全部取正东方向，dy=0，距离就是 dx。
  const east = (dx: number): { x: number; y: number } => ({
    x: LARGE_ALTAR.x + dx,
    y: LARGE_ALTAR.y,
  });

  // 郊野铺子：21 格还在工坊环内 → 拒；22 格出环 → 收。
  assert.equal(biomeRingAllows('gear_tower', east(21), LARGE_ALTAR), false);
  assert.equal(biomeRingAllows('gear_tower', east(22), LARGE_ALTAR), true);
  // 上界 wilderness(37)：37 收，38 已经出了郊野。
  assert.equal(biomeRingAllows('gear_tower', east(37), LARGE_ALTAR), true);
  assert.equal(biomeRingAllows('gear_tower', east(38), LARGE_ALTAR), false);

  // 镇内铺子正好相反。
  assert.equal(biomeRingAllows('workshop_plot', east(21), LARGE_ALTAR), true);
  assert.equal(biomeRingAllows('workshop_plot', east(22), LARGE_ALTAR), false);

  // 郊野民居与郊野铺子同侧——这正是旧代码分错的那一类。
  assert.equal(isWildSide('homestead_far'), true);
  assert.equal(biomeRingAllows('homestead_far', east(22), LARGE_ALTAR), true);
  assert.equal(biomeRingAllows('homestead_far', east(21), LARGE_ALTAR), false);
  // 镇内民居与镇内铺子同侧。
  assert.equal(biomeRingAllows('cottage_oak', east(21), LARGE_ALTAR), true);
  assert.equal(biomeRingAllows('cottage_oak', east(22), LARGE_ALTAR), false);
});

test('开局落位每一栋都过群落环：规则与 buildLargeWorld 的 accept 是同一份', () => {
  const world = buildLargeWorld(blueprints);
  for (const building of world.buildings) {
    assert.ok(
      biomeRingAllows(building.prefabId, building.origin, LARGE_ALTAR),
      `${building.instanceId} 落在 (${building.origin.x},${building.origin.y})，过不了群落环`,
    );
  }
});

/**
 * `checkPlacement` 不知道「郊野」是什么意思——它只看出界 / 分区 / 占地 / 留白 /
 * 门口。所以单靠它，玩家能把郊野铺子的幽灵拖进镇子并确认成功。
 *
 * `SandboxScene.canPlaceBlueprintHere` 那道群落闸是唯一拦住它们的东西，
 * 而它没有运行时测试（没有测试 new 过 SandboxScene）。这条把它的**存在理由**
 * 钉住：`checkPlacement` 自己会放行多少个镇内落点。谁改了分区或半径，让这组数
 * 不再成立，这里会红——而不是让 `SandboxScene.ts` 里那段注释慢慢变成一句
 * 没人核的话。
 *
 * 数与 `SandboxScene.ts` 那段注释同源，都是默认设定集（莞尔镇）的开局大世界
 * 一格一格枚举出来的——灯潮界七栋楼里这三栋郊野铺子一栋都没有，所以这组数
 * 只对默认设定集成立。
 */
test('checkPlacement 自己会放行镇内的郊野落点——群落闸不是装饰', () => {
  const world = buildLargeWorld(blueprints);

  /** 枚举某份蓝图在开局世界里的全部合法左上角，附它到祭坛的距离（整数尺）。 */
  const legalSlots = (
    id: string,
  ): { readonly x: number; readonly y: number; readonly d: number }[] => {
    const bp = blueprints.get(id);
    assert.ok(bp !== undefined, `要有 ${id} 这份蓝图`);
    const out: { x: number; y: number; d: number }[] = [];
    for (let y = 0; y < world.grid.height - bp.footprint.h + 1; y += 1) {
      for (let x = 0; x < world.grid.width - bp.footprint.w + 1; x += 1) {
        if (!checkPlacement(world.grid, bp, { x, y }).ok) continue;
        out.push({ x, y, d: Math.hypot(x - LARGE_ALTAR.x, y - LARGE_ALTAR.y) });
      }
    }
    return out;
  };

  // 注释里承重的那三个数，逐个独立可复算。
  const mine = legalSlots('crawler_mine');
  assert.equal(mine.length, 47, '开局世界 crawler_mine 的合法左上角共 47 个');

  const inRing = mine.filter((s) => s.d <= BIOME_RADII.craftRing);
  assert.equal(inRing.length, 31, '其中 31 个在 craftRing(21) 内，checkPlacement 一律放行');

  const nearest = mine.reduce((a, b) => (b.d < a.d ? b : a));
  assert.deepEqual({ x: nearest.x, y: nearest.y }, { x: 56, y: 27 }, '圈内最近的那个落点');
  assert.equal(nearest.d.toFixed(3), '12.042', '它离祭坛 12.042 格');

  // 上面那个 31 有个死区，得说清，否则它看着比实际灵敏：圈内最远 18.358、
  // 圈外最近 27.019，两者之间一个合法槽位都没有。于是 craftRing 取这个区间里
  // 任何一个值，31 都不变——把半径从 21 改成 25，这条照绿，而注释里写的 21
  // 已经过期。所以半径本身单独钉一道：它一动，这里就逼着人去改那段注释。
  const farthestIn = inRing.reduce((a, b) => (b.d > a.d ? b : a));
  const outside = mine.filter((s) => s.d > BIOME_RADII.craftRing);
  assert.equal(farthestIn.d.toFixed(3), '18.358', '圈内最远的合法槽位');
  assert.equal(outside.length, 16, '圈外合法的槽位');
  assert.equal(
    outside.reduce((a, b) => (b.d < a.d ? b : a)).d.toFixed(3),
    '27.019',
    '圈外最近的合法槽位——与 18.358 之间是死区',
  );
  assert.equal(
    BIOME_RADII.craftRing,
    21,
    '半径钉住：上面那个 31 对 18.358～27.019 之间的任何半径都不灵敏',
  );

  // 另两类同形状。注释里写着 52/36 与 42/26，就把这两个数也钉死——
  // 只断言「过半」的话，那两对数就成了注释里没人核的话。
  for (const [id, total, inside] of [
    ['ink_mill', 52, 36],
    ['gear_tower', 42, 26],
  ] as const) {
    const slots = legalSlots(id);
    assert.equal(slots.length, total, `${id} 的合法左上角`);
    assert.equal(
      slots.filter((s) => s.d <= BIOME_RADII.craftRing).length,
      inside,
      `${id} 其中 ${inside} 个在圈内`,
    );
  }

  // 郊野民居：`checkPlacement` 在镇内放行成百上千个落点，而群落环一个都不放。
  // 这条钉住旧代码分错的那一类——SandboxScene 原来拿 `WILD_PREFABS` 认郊野，
  // 漏了 `homestead_far` / `homestead_ridge` 两栋民居（它们的 zone 是三栋镇内
  // 民居共用的 `living`，`ZONE_DEFAULT` 也是 `living`，分区那道关拦不住）。
  for (const id of ['homestead_far', 'homestead_ridge']) {
    const bp = blueprints.get(id);
    assert.ok(bp !== undefined, `要有 ${id} 这份蓝图`);
    let checkOkInTown = 0;
    let ringOkInTown = 0;
    for (let y = 0; y < world.grid.height - bp.footprint.h + 1; y += 1) {
      for (let x = 0; x < world.grid.width - bp.footprint.w + 1; x += 1) {
        const origin = { x, y };
        if (!checkPlacement(world.grid, bp, origin).ok) continue;
        if (Math.hypot(x - LARGE_ALTAR.x, y - LARGE_ALTAR.y) > BIOME_RADII.craftRing) continue;
        checkOkInTown += 1;
        if (biomeRingAllows(id, origin, LARGE_ALTAR)) ringOkInTown += 1;
      }
    }
    assert.ok(checkOkInTown > 0, `${id} 在镇内有 checkPlacement 判合法的落点，否则这条没测到东西`);
    assert.equal(ringOkInTown, 0, `${id} 是郊野民居，镇内一个都不许放`);
  }
});

// ------------------------------------------------------------------ 建筑来源

test('造物模式建出的楼记着自己是从哪来的', () => {
  const world = buildWorld(blueprints);
  const slot = world.grid.findBestSlot(plot, ALTAR);
  assert.ok(slot !== null);

  const placed = placeBlueprint(world.grid, plot, 'plot#src', ALTAR, slot, {
    taskId: 't_42',
    summary: '开一间新工坊',
  });
  assert.ok(placed !== null);
  assert.equal(placed.building.sourceTaskId, 't_42');
  assert.equal(placed.building.sourceSummary, '开一间新工坊');
});

test('开局常驻的楼没有来源：它们是世界自带的，不是谁建的', () => {
  const world = buildWorld(blueprints);
  for (const building of world.buildings) {
    assert.equal(building.sourceTaskId, null, `${building.instanceId} 不该有来源`);
    assert.equal(building.sourceSummary, null);
  }
});

test('有来由的楼在日报里写清来由', () => {
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR, at, source);
    },
  });
  sim.enqueue({
    kind: 'build',
    prefabId: 'workshop_plot',
    instanceId: 'plot#report',
    source: { taskId: 'creation-1', summary: '在 (2,2) 建了新工坊' },
  });
  sim.update(16);

  const report = composeReport(sim.snapshot());
  const line = report.lines.find((item) => item.includes('造物主起了'));
  assert.ok(line !== undefined, '日报应当提到新建的楼');
  assert.match(line, /在 \(2,2\) 建了新工坊/, '日报要写清这栋楼是怎么来的');
});
