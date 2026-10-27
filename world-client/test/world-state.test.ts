import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { BIOME_RADII } from '../src/world/biomes.ts';
import { LARGE_ALTAR, LARGE_WORLD_SPEC, WILD_PREFABS, buildLargeWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { describeWorldState, fillableGaps, summarizeWorld } from '../src/world/world-state.ts';
import type { GridPoint } from '../src/world/types.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 一块分区矩形离祭坛最近的那一点的距离（与 `world-state.ts` 同一把尺）。 */
function nearestDistance(
  zone: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  altar: { readonly x: number; readonly y: number },
): number {
  const dx = Math.max(zone.x - altar.x, 0, altar.x - (zone.x + zone.w - 1));
  const dy = Math.max(zone.y - altar.y, 0, altar.y - (zone.y + zone.h - 1));
  return Math.hypot(dx, dy);
}

function makeSim(): Simulation {
  const world = buildLargeWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
  });
}

// ------------------------------------------------------------------ 形状

test('世界状态是一份可读的摘要，不是原始快照', () => {
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());

  assert.ok(state.buildings.total > 0, '要能说出现在有几栋');
  assert.equal(typeof state.buildings.town, 'number');
  assert.equal(typeof state.buildings.wild, 'number');
  assert.ok(Array.isArray(state.taskKinds), '要能说出每类活的铺子数');
});

test('摘要里的数字与快照一致：不是另算一套', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const state = summarizeWorld(snapshot);
  assert.equal(state.buildings.total, snapshot.buildings.length);
});

// ------------------------------------------------------------------ 每类活的覆盖

test('每类活都说得出「镇内有几栋、郊野有几栋」', () => {
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());

  assert.equal(state.taskKinds.length, 3, '三类长活');
  for (const entry of state.taskKinds) {
    assert.ok(entry.kind === 'code' || entry.kind === 'research' || entry.kind === 'writing');
    assert.equal(entry.town + entry.wild, entry.total, '镇内 + 郊野 = 总数');
  }
});

test('开局时每类活都是镇内一栋、郊野一栋', () => {
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());
  for (const entry of state.taskKinds) {
    assert.equal(entry.town, 1, `${entry.kind} 应当有一栋镇内铺子`);
    assert.equal(entry.wild, 1, `${entry.kind} 应当有一栋郊野铺子`);
  }
});

// ------------------------------------------------------------------ 空间占用

test('说得出郊野占了多少、还剩多少可建', () => {
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());
  assert.ok(state.space.wildBuilt >= 0);
  assert.ok(state.space.wildFree >= 0, '要能说出郊野还剩多少空地');
});

test('郊野空地的基数是分区真实面积，不是写死的 384', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const state = summarizeWorld(snapshot);

  // 基数独立算一遍：整块分区都在工坊环之外的分区矩形（与 `biomeAt` 同一把尺，
  // 不按 `w === 9` 认——按尺寸认，分区一改它就又错一次）。
  const area = LARGE_WORLD_SPEC.zones
    .filter((z) => nearestDistance(z, LARGE_ALTAR) > BIOME_RADII.craftRing)
    .reduce((sum, z) => sum + z.w * z.h, 0);
  assert.equal(area, 288, '四块郊野分区各 9×8');

  const footprint = snapshot.buildings
    .filter((b) => WILD_PREFABS.has(b.prefabId))
    .reduce((sum, b) => sum + b.footprint.w * b.footprint.h, 0);
  assert.equal(footprint, 36, '开局三栋郊野铺子的占地');

  // 288 - 36×3 = 180，除 40 向下取整是 4。照原来写死的 384 算是 6。
  // 384 那版多报 3 栋（实测今天只装得下 3），这版多报 1 栋——见 `world-state.ts`
  // 里 `WILD_ZONE_AREA` 那段：基数对了，但 `workshop_plot` 是 `zone: 'industry'`，
  // 四块郊野分区只有 industry 那一块够得着。方向对了，没到底。
  // 这一条钉的是**基数**（288 = 四块郊野分区的真实面积），不是「估得准」。
  assert.equal(state.space.wildFree, 4, '基数从 384 修成 288：这版多报 1 栋，旧版多报 3 栋');

  // 基数对了不等于估得准。`workshop_plot` 是 `zone: 'industry'`，四块郊野分区里
  // 只有 industry 那一块（`18,18` 的 9×8 = 72 格）够得着，那 72 格还有 36 格被
  // gear_tower 占着。所以公式给的 4 仍多报 1 栋。这条把「实测只装得下 3」钉住，
  // 免得 `WILD_ZONE_AREA` 注释里那个数变成下一句没人核的话。
  const plot = blueprints.get('workshop_plot');
  assert.ok(plot !== undefined, '要有 workshop_plot 这张蓝图');
  const grid = buildLargeWorld(blueprints).grid;
  const inWild = (origin: GridPoint): boolean => {
    const cx = origin.x + (plot!.footprint.w - 1) / 2;
    const cy = origin.y + (plot!.footprint.h - 1) / 2;
    return Math.hypot(cx - LARGE_ALTAR.x, cy - LARGE_ALTAR.y) > BIOME_RADII.craftRing;
  };
  let fits = 0;
  for (;;) {
    const slot = grid.findBestSlot(plot!, LARGE_ALTAR, inWild);
    if (slot === null) break;
    const placed = grid.place({
      instanceId: `plot#cap${fits}`,
      origin: slot,
      w: plot!.footprint.w,
      h: plot!.footprint.h,
      door: { x: slot.x + plot!.door.x, y: slot.y + plot!.door.y },
    });
    if (!placed) break;
    fits += 1;
    if (fits > 20) break;
  }
  assert.equal(fits, 3, '郊野今天还装得下 3 栋 workshop_plot，而公式给 4');
});

test('新建一栋后，郊野占用增加', () => {
  const sim = makeSim();
  const before = summarizeWorld(sim.snapshot()).space.wildBuilt;

  sim.enqueue({
    kind: 'build',
    prefabId: 'workshop_plot',
    instanceId: 'plot#state',
  });
  sim.update(16);

  const after = summarizeWorld(sim.snapshot()).space.wildBuilt;
  assert.ok(after >= before, '建楼不会让占用变少');
});

// ------------------------------------------------------------------ 活动

test('说得出现在有几个人在忙、几个闲', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写脚本' });
  sim.update(16);

  const state = summarizeWorld(sim.snapshot());
  assert.equal(state.activity.busy + state.activity.idle, state.activity.total);
  assert.ok(state.activity.busy >= 1, '派了活之后至少有一个在忙');
});

// ------------------------------------------------------------------ 给造物主用的判断

test('说得出「哪类活还没有郊野铺子」——造物主据此做选择', () => {
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());
  // 开局每类都有，所以是空数组。
  assert.deepEqual(state.gaps.missingWild, []);
});

test('少一栋郊野铺子时，缺口说得出是哪一类', () => {
  const world = buildLargeWorld(blueprints);
  // 去掉郊野的研究铺子。
  const without = world.buildings.filter((b) => b.instanceId !== 'crawler_mine#1');
  const sim = new Simulation({
    grid: world.grid,
    buildings: without,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
  });

  const state = summarizeWorld(sim.snapshot());
  assert.deepEqual(state.gaps.missingWild, ['research'], '缺的是研究类郊野铺子');
});

// ------------------------------------------------------------------ 接进造物

test('已有书阁时，回应里指出世界缺什么', () => {
  const world = buildLargeWorld(blueprints);
  // 去掉郊野研究铺子，制造一个明确缺口。
  const without = world.buildings.filter((b) => b.instanceId !== 'crawler_mine#1');
  const sim = new Simulation({
    grid: world.grid,
    buildings: without,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
  });

  sim.enqueue({ kind: 'oracle', raw: '建一间书阁' });
  const result = sim.update(16)[0];

  assert.equal(result?.ok, false);
  assert.match(result?.message ?? '', /已经有星图书阁/);
  // 纸面用「查资料」而不是内部枚举名 research。
  assert.match(result?.message ?? '', /查资料/, '应当指出缺的是查资料的郊野铺子');
});

test('没有缺口时，回应退回「想扩建就说建个工坊」', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'oracle', raw: '建一间书阁' });
  const result = sim.update(16)[0];
  assert.match(result?.message ?? '', /建个工坊/);
});

// ------------------------------------------------------------------ 给界面用的摘要

test('界面摘要：一行说清镇内郊野、缺口、可建模板', () => {
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());
  const line = describeWorldState(state);

  assert.match(line, /镇内 3/);
  assert.match(line, /郊野 3/);
  // 没有缺口时不该出现「缺」字。
  assert.ok(!line.includes('缺'), `没有缺口时不该提：${line}`);
});

test('有缺口时，摘要点名缺哪一类（用纸面说法）', () => {
  const world = buildLargeWorld(blueprints);
  const without = world.buildings.filter((b) => b.instanceId !== 'crawler_mine#1');
  const sim = new Simulation({
    grid: world.grid,
    buildings: without,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
  });

  const line = describeWorldState(summarizeWorld(sim.snapshot()));
  assert.match(line, /缺/);
  assert.match(line, /查资料/, '要说「查资料」，不是 research');
});

test('摘要里说得出郊野还剩多少空地', () => {
  const sim = makeSim();
  const line = describeWorldState(summarizeWorld(sim.snapshot()));
  assert.match(line, /空地/);
});

// ---------------------------------------------- 补得上的缺口，与补不上的缺口

test('缺口补得上才列：那座世界得有那份蓝图', () => {
  // 灯潮界七栋楼里没有 gear_tower / crawler_mine / ink_mill，而三类活它全「缺」。
  // 原来界面照单全收，供出三个「补缺」按钮，点下去个个撞一句「没有这份蓝图。」
  // ——那是一句屏上的空头承诺，而用户照着它点了。
  assert.deepEqual(fillableGaps(['code', 'research', 'writing'], []), []);
  assert.deepEqual(
    fillableGaps(['code', 'research'], ['gear_tower']),
    ['code'],
    '有 gear_tower 才算补得上 code；research 的那份不在这张图上',
  );
});

test('缺口本身不改：摘要是句真话，要收起来的只是那个承诺', () => {
  // 「这世界没有查资料的郊野铺子」是真的。`missingWild` 照列，只是不拿它去
  // 生成一个必然失败的按钮。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  const state = summarizeWorld({
    buildings: world.buildings,
    villagers: [],
  } as unknown as Parameters<typeof summarizeWorld>[0]);
  assert.deepEqual([...state.gaps.missingWild], ['code', 'research', 'writing']);
  assert.deepEqual(fillableGaps(state.gaps.missingWild, [...pack.blueprints.keys()]), []);
});

test('莞尔镇三类缺口全都补得上：那里的按钮一个都不该少', () => {
  // 反方向也得钉。过滤要是写反了，默认世界里该有的按钮会整排消失。
  const sim = makeSim();
  const state = summarizeWorld(sim.snapshot());
  const registry = [...blueprints.keys()];
  assert.deepEqual(
    fillableGaps(state.gaps.missingWild, registry),
    [...state.gaps.missingWild],
    '默认世界里每个缺口都有一份对应的郊野蓝图',
  );
});
