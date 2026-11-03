/**
 * L2：组合与连续性。
 *
 * 钉四件事：
 * 1. 同一单位反复开关，面板 DOM 节点数不涨、document 监听器不增；
 * 2. 面板开着时世界照常推进——同一个选择重新取数，位置读数会变；
 * 3. 被楼遮住的可见单位仍然点得中（命中按格算，不按绘制深度）；真正离场的人点不到；
 * 4. 地图边缘与缩放下的命中：投影回算的误差与边界容差都给像素读数。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint, TILE_PX } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { viewOriginOf } from '../src/render/camera-math.ts';
import { installFakeDom } from './fake-dom.ts';
import {
  bindUnitStatusPanel,
  buildUnitStatus,
  cellAtScreenPoint,
  screenHitPointForCell,
  unitAtCell,
  type UnitStatusContent,
  type UnitStatusOracle,
  type UnitStatusView,
} from '../src/ui/unit-status.ts';
import type { VillagerSnapshot } from '../src/world/types.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

interface Rig {
  readonly world: ReturnType<typeof buildWorld>;
  readonly sim: Simulation;
}

function makeRig(): Rig {
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    // 开局定在 09:00，不是 00:00：22:00–05:00 是作息里的睡眠段，居民本来
    // 就该回锚点睡下。这条用例验的是「面板不暂停世界」，不是「半夜也会走动」。
    initialNow: 9 * 60 * 60 * 1000,
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined ? null : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
  return { world, sim };
}

function villagerOf(id: string, pos: { x: number; y: number }, visible = true): VillagerSnapshot {
  return {
    id,
    name: '汐',
    mode: 'idle',
    pos,
    walking: false,
    facing: 'down',
    visible,
    taskId: null,
    bubble: null,
    routine: null,
    umbrella: false,
    carrying: null,
    lampOil: 1,
    nameState: 'held',
    carries: [],
  };
}

/** 只做订阅的 oracle 替身；面板绑定真的会往 body 里写行。 */
function makeOracle(initial: UnitStatusView | null): {
  readonly oracle: UnitStatusOracle;
  emit(next: UnitStatusView | null): void;
} {
  let listener: ((next: UnitStatusView | null) => void) | null = null;
  return {
    oracle: {
      onUnitStatus(next) {
        listener = next;
        next(initial);
        return () => {
          listener = null;
        };
      },
      dismissUnitStatus() {},
      unitStatus: () => initial?.content ?? null,
    },
    emit(next) {
      listener?.(next);
    },
  };
}

function contentOf(lines: number): UnitStatusContent {
  return {
    kind: 'villager',
    id: 'v1',
    title: '汐',
    subtitle: '村民 v1',
    lines: Array.from({ length: lines }, (_, index) => ({ key: `键${index}`, value: `值${index}` })),
  };
}

test('L2-1 同一单位反复开关 100 次：DOM 节点数稳定，监听器不增', () => {
  const dom = installFakeDom([
    'unit-status',
    'unit-status-title',
    'unit-status-subtitle',
    'unit-status-body',
    'unit-status-close',
  ]);
  try {
    const panel = dom.byId('unit-status');
    panel.hidden = true;
    const content = contentOf(6);
    const stub = makeOracle({ content, anchor: { x: 10, y: 20 } });
    const bound = bindUnitStatusPanel(() => stub.oracle);

    assert.equal(panel.hidden, false);
    assert.equal(dom.doc.listeners.get('keydown')?.size, 1, '初始化挂 1 个 Esc');
    assert.equal(
      dom.byId('unit-status-close').listeners.get('click')?.size,
      1,
      '初始化挂 1 个关闭钮',
    );

    const firstNodes = dom.byId('unit-status-body').children.length;
    for (let round = 0; round < 100; round += 1) {
      stub.emit(null);
      assert.equal(panel.hidden, true, `第 ${round} 次收起`);
      stub.emit({ content, anchor: { x: 10, y: 20 } });
      assert.equal(panel.hidden, false, `第 ${round} 次打开`);
      assert.equal(
        dom.byId('unit-status-body').children.length,
        firstNodes,
        `第 ${round} 次打开后行数不涨（${firstNodes} 行）`,
      );
      // 每行 2 个子节点（key + value），节点总数与行数同倍。
      const nodes = dom.byId('unit-status-body').children.reduce(
        (sum, row) => sum + 1 + row.children.length,
        0,
      );
      assert.equal(nodes, 3 * content.lines.length, `第 ${round} 次打开的节点总数`);
    }

    assert.equal(dom.doc.listeners.get('keydown')?.size, 1, '100 次开关后 Esc 仍只有 1 个');
    assert.equal(
      dom.byId('unit-status-close').listeners.get('click')?.size,
      1,
      '100 次开关后关闭钮仍只有 1 个',
    );
    bound.dispose();
  } finally {
    dom.restore();
  }
});

test('L2-2 面板不暂停世界：同一个选择重新取数，位置读数会变', () => {
  const { sim } = makeRig();
  const start = sim.snapshot();
  const villager = start.villagers[0]!;
  const ref = { kind: 'villager' as const, id: villager.id };
  const before = buildUnitStatus(start, ref);
  assert.ok(before !== null);
  const beforeWhere = before.lines.find((line) => line.key === '位置')?.value ?? '';

  const startCell = { x: Math.floor(villager.pos.x), y: Math.floor(villager.pos.y) };
  let elapsed = 0;
  while (elapsed < 5_000_000) {
    sim.update(1000);
    elapsed += 1000;
    const next = sim.snapshot();
    const moved = next.villagers.find((item) => item.id === villager.id)!;
    if (Math.floor(moved.pos.x) !== startCell.x || Math.floor(moved.pos.y) !== startCell.y) {
      break;
    }
  }
  assert.ok(elapsed < 5_000_000, '世界在 5000 世界秒内没用冻住');
  const later = sim.snapshot();
  const after = buildUnitStatus(later, ref);
  assert.ok(after !== null);

  assert.ok(later.now > start.now, `世界时间在推进（${start.now} → ${later.now}）`);
  const afterWhere = after.lines.find((line) => line.key === '位置')?.value ?? '';
  assert.notEqual(afterWhere, beforeWhere, `读数真的会变：${beforeWhere} → ${afterWhere}`);
  assert.equal(
    afterWhere,
    `格子 (${Math.floor(later.villagers.find((item) => item.id === villager.id)!.pos.x)}, ${Math.floor(later.villagers.find((item) => item.id === villager.id)!.pos.y)})`,
    '变的是新快照里的位置，不是编出来的',
  );
});

test('L2-3 被楼遮住的可见单位仍然命中；离场的人点不到', () => {
  const { sim } = makeRig();
  const base = sim.snapshot();
  const building = base.buildings.find((item) => item.footprint.w >= 2 && item.footprint.h >= 2);
  assert.ok(building !== undefined, '开局至少有一栋两格以上的楼');
  const inside = {
    x: building.origin.x + Math.floor(building.footprint.w / 2),
    y: building.origin.y + Math.floor(building.footprint.h / 2),
  };
  const world = {
    ...base,
    buildings: [building],
    villagers: [villagerOf('occluded', inside)],
  };

  assert.deepEqual(
    unitAtCell(world, inside.x, inside.y),
    { kind: 'villager', id: 'occluded' },
    '画的先后不影响命中：人在这一格就先给走人',
  );

  const hidden = {
    ...world,
    villagers: [villagerOf('gone', inside, false)],
  };
  assert.deepEqual(
    unitAtCell(hidden, inside.x, inside.y),
    { kind: 'building', id: building.instanceId },
    '人不在画面上，这一点落在楼身上',
  );
});

test('L2-4 地图边缘：四角与界外格的命中，误差 0.00px', () => {
  const { world, sim } = makeRig();
  const snapshot = sim.snapshot();
  const game = { width: 480, height: 320 };
  const canvas = { left: 0, top: 0 };
  // 四角在 zoom=1 时才全部落在视野里（zoom>1 时 Phaser 以镜头中心缩放，
  // 贴边那一圈本来就在画布外）。缩放下的命中由 L2-5 用画面中央的格子验。
  const zoom = 1;
  const grid = world.grid;
  const corners = [
    { x: 0, y: 0 },
    { x: grid.width - 1, y: 0 },
    { x: 0, y: grid.height - 1 },
    { x: grid.width - 1, y: grid.height - 1 },
  ];

  // 镜头贴左上角 / 右下角时的视野原点（`scroll` 是镜头中心，见 camera-math）。
  const leftTop = {
    x: viewOriginOf(0, game.width, zoom),
    y: viewOriginOf(0, game.height, zoom),
  };
  const rightBottom = {
    x: viewOriginOf(grid.width * TILE_PX - game.width, game.width, zoom),
    y: viewOriginOf(grid.height * TILE_PX - game.height, game.height, zoom),
  };

  for (const cell of corners) {
    const viewport = {
      x: cell.x === 0 ? leftTop.x : rightBottom.x,
      y: cell.y === 0 ? leftTop.y : rightBottom.y,
    };
    const point = screenHitPointForCell(cell, viewport, zoom, canvas);
    assert.deepEqual(
      cellAtScreenPoint(point, viewport, zoom, canvas),
      cell,
      `角 ${cell.x},${cell.y} 的格心要回算成同一格`,
    );
    const error = Math.hypot(
      point.x - (canvas.left + ((cell.x + 0.5) * TILE_PX - viewport.x) * zoom),
      point.y - (canvas.top + ((cell.y + 0.5) * TILE_PX - viewport.y) * zoom),
    );
    assert.ok(error <= 0.5, `角 ${cell.x},${cell.y} 的投影误差 ${error.toFixed(2)}px`);
  }

  // 界外：左上角再往外一格，命中 null，而不是折回 0。
  const outside = cellAtScreenPoint({ x: -1, y: -1 }, leftTop, zoom, canvas);
  assert.equal(outside.x, -1);
  assert.equal(outside.y, -1);
  assert.equal(unitAtCell(snapshot, outside.x, outside.y), null);
  // 界外右侧同理。
  const farRight = cellAtScreenPoint(
    { x: game.width + 1, y: game.height / 2 },
    rightBottom,
    zoom,
    canvas,
  );
  assert.ok(farRight.x >= grid.width, `右侧界外应落在网格外，实际 x=${farRight.x}`);
  assert.equal(unitAtCell(snapshot, farRight.x, farRight.y), null);
});

test('L2-5 缩放命中：zoom 1/2/3 × CSS 2 倍，偏移 3.61px 仍命中，边界容差 0.5px', () => {
  const { world, sim } = makeRig();
  const snapshot = sim.snapshot();
  const villager = snapshot.villagers[0]!;
  const cell = { x: Math.floor(villager.pos.x), y: Math.floor(villager.pos.y) };
  const game = { width: 480, height: 320 };
  const rect = { width: game.width * 2, height: game.height * 2 };
  const cssScale = rect.width / game.width;
  const canvas = { left: 24, top: 31 };
  const scroll = { x: (cell.x + 0.5) * TILE_PX, y: (cell.y + 0.5) * TILE_PX };

  for (const cameraZoom of [1, 2, 3]) {
    const viewport = {
      x: viewOriginOf(scroll.x, game.width, cameraZoom),
      y: viewOriginOf(scroll.y, game.height, cameraZoom),
    };
    const effectiveZoom = cameraZoom * cssScale;
    const center = screenHitPointForCell(cell, viewport, effectiveZoom, canvas);

    // 真实指针不会正好落在格心：偏 3px / 2px。
    const offset = { x: 3, y: 2 };
    const hit = cellAtScreenPoint(
      { x: center.x + offset.x, y: center.y + offset.y },
      viewport,
      effectiveZoom,
      canvas,
    );
    assert.deepEqual(hit, cell, `zoom=${cameraZoom}×${cssScale} 时偏 3.61px 仍命中`);
    assert.deepEqual(
      unitAtCell(snapshot, hit.x, hit.y),
      { kind: 'villager', id: villager.id },
      `zoom=${cameraZoom}×${cssScale} 时命中的是同一个人`,
    );

    // 边界：从左边界内 0.5px 与左边界外 0.5px 各点一下。
    const half = (TILE_PX * effectiveZoom) / 2;
    const insideLeft = cellAtScreenPoint(
      { x: center.x - half + 0.5, y: center.y },
      viewport,
      effectiveZoom,
      canvas,
    );
    const outsideLeft = cellAtScreenPoint(
      { x: center.x - half - 0.5, y: center.y },
      viewport,
      effectiveZoom,
      canvas,
    );
    assert.deepEqual(insideLeft, cell, `zoom=${cameraZoom} 边界内 0.5px 仍是这一格`);
    assert.equal(outsideLeft.x, cell.x - 1, `zoom=${cameraZoom} 边界外 0.5px 落到左一格`);

    // 投影回算的误差：把格心换算到屏幕再换回来，两者必须同格，误差 0.00px。
    const roundTrip = cellAtScreenPoint(center, viewport, effectiveZoom, canvas);
    const error = Math.hypot(
      center.x - screenHitPointForCell(roundTrip, viewport, effectiveZoom, canvas).x,
      center.y - screenHitPointForCell(roundTrip, viewport, effectiveZoom, canvas).y,
    );
    assert.ok(error <= 0.5, `zoom=${cameraZoom}×${cssScale} 投影回算误差 ${error.toFixed(2)}px`);
  }

  assert.equal(world.grid.width > 0, true);
});
