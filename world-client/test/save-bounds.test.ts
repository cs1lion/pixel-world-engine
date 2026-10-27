/** 存档里的坐标落在世界外面：查得到、指名得出来、读档链拦得住。
 *
 * 这一层补的是 `validateSaveFields` 天生问不了的问题——它跑在原始 JSON 上，
 * 那会儿还没有网格，而世界多大是 `GridSpec` 参数。所以「坐标在不在世界里」
 * 只能由知道世界多大的那一方递进来查（`findOutOfWorldCoordinates` + `WorldBounds`）。
 *
 * 三条断言各自守住一件事，别合并：
 *   1. 世界自己写出来的存档全在界内（这条要是不成立，后面两条就是炸弹）。
 *   2. 六类坐标越界各自被指名到 JSON 路径（指名到路径，玩家才改得动原档）。
 *   3. 读档与导入两条路都真的拦（拦住而不指名，等于逼玩家瞎猜）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import {
  ALTAR,
  buildWorld,
  buildWorldFromSave,
  LARGE_ALTAR,
  LARGE_WORLD_SPEC,
} from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { composeReport } from '../src/world/report.ts';
import {
  CURRENT_SCHEMA_VERSION,
  findOutOfWorldCoordinates,
  type WorldBounds,
  type WorldSave,
} from '../src/world/save.ts';
import { parseSaveText, SaveStore, type StorageLike } from '../src/ui/save-store.ts';
import { syncCommand } from './feed-helpers.ts';

const rawPrefabs = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(rawPrefabs);

/** 小世界 30×20：与既有存档测试同一个夹具。 */
const SMALL: WorldBounds = { width: 30, height: 20 };
/** 大世界 96×72：生产入口那一套。 */
const LARGE: WorldBounds = { width: LARGE_WORLD_SPEC.width, height: LARGE_WORLD_SPEC.height };

function makeSave(wallClock: () => number = () => 1000): WorldSave {
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock,
  });
  sim.update(16);
  return sim.toSave();
}

/** 改一份存档的 JSON，再走形状校验链（不递 bounds——界内界外正是要被检查的那件事）。 */
function editSave(save: WorldSave, edit: (world: Record<string, unknown>) => void): WorldSave {
  const raw = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
  edit(raw.world as Record<string, unknown>);
  const parsed = parseSaveText(JSON.stringify(raw));
  assert.equal(parsed.ok, true, `改过的存档应当仍是形状合法的档：${JSON.stringify(parsed)}`);
  return parsed.save;
}

/** 读档 + 跑若干拍。deps 按存档 buildings 重放网格，与 `main.ts` 同一条路。 */
function loadInto(save: WorldSave, ticks: number, large = false): Simulation {
  const world = large
    ? buildWorldFromSave(save.world.buildings, blueprints, LARGE_WORLD_SPEC, LARGE_ALTAR)
    : buildWorldFromSave(save.world.buildings);
  const sim = Simulation.fromSave(save, {
    grid: world.grid,
    buildings: world.buildings,
    altar: large ? LARGE_ALTAR : ALTAR,
    villagerName: save.world.villagers[0]?.name ?? '莞尔',
  });
  for (let i = 0; i < ticks; i += 1) sim.update(16);
  return sim;
}

// ---------------------------------------------------------------- 1. 世界自己写不出来

test('世界自己跑出来的存档，坐标全在界内', () => {
  const world = buildWorld(blueprints, LARGE_WORLD_SPEC, LARGE_ALTAR);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: LARGE_ALTAR,
    villagerName: '莞尔',
  });
  const kinds = ['code', 'research', 'writing', 'quick'] as const;
  // 240000 拍 = 64 分钟世界时间，八轮派活覆盖四类活——不是跑几拍做样子。
  for (let round = 0; round < 8; round += 1) {
    for (let i = 0; i < 30_000; i += 1) {
      if (i === 0) {
        sim.enqueue(
          syncCommand({
            tasks: [
              { id: `c_${round}_a`, kind: kinds[round % 4], title: '活 a' },
              { id: `c_${round}_b`, kind: 'quick', title: '活 b' },
            ],
            connected: true,
          }),
        );
      }
      if (i === 12_000) {
        sim.enqueue(
          syncCommand({
            tasks: [{ id: `c_${round}_c`, kind: kinds[(round + 1) % 4], title: '活 c' }],
            finished: [`c_${round}_a`],
            connected: true,
          }),
        );
      }
      sim.update(16);
    }
  }
  const save = sim.toSave();
  // **先证明这个世界真的活了。** 没有这一条，`sim.update` 哪怕整个变成空转，
  // 下面两个 deepEqual 也照样绿——「跑了 64 分钟」就只是个装饰性的数字。
  //
  // 为什么拿「结过账」当活证，而不拿「走过路」：`VillagerSnapshot` 不带 `path`，
  // 采样要走快照；而跑满 64 分钟那一刻她大概率站着发呆，存档里的 `path` 是空的——
  // 于是「她得走过路」会把一条本来成立的测试打成红。结得过账这件事本身要求她
  // 走到作坊、干完、送回来，所以它一条就够，而且它在存档里，跑完再看也来得及。
  assert.ok(save.world.settled.length > 0, '她得真的结过账，否则这条测试什么都没验');
  assert.deepEqual(
    findOutOfWorldCoordinates(save, LARGE),
    [],
    '世界自己写出来的存档不该有界外坐标——否则下面每一条测试都是在炸正常档',
  );
  // 存下来再读一遍：round-trip 也不该凭空多出界外坐标。
  const reloaded = loadInto(save, 0, true).toSave();
  assert.deepEqual(findOutOfWorldCoordinates(reloaded, LARGE), []);
});

// ---------------------------------------------------------------- 2. 六类各自指名

test('六类坐标越界，各自指名到 JSON 路径', () => {
  const base = makeSave();
  const cases: readonly (readonly [string, (world: Record<string, unknown>) => void, string])[] = [
    [
      'villagers[].pos',
      (world) => {
        (world.villagers as { pos: unknown }[])[0].pos = { x: 99999, y: -98765 };
      },
      'world.villagers[0].pos = {x:99999, y:-98765}',
    ],
    [
      'villagers[].path[]',
      (world) => {
        (world.villagers as { path: unknown }[])[0].path = [{ x: 999, y: 999 }];
      },
      'world.villagers[0].path[0] = {x:999, y:999}',
    ],
    [
      'villagers[].pendingRoute[]',
      (world) => {
        (world.villagers as { pendingRoute: unknown }[])[0].pendingRoute = [{ x: -5, y: 4 }];
      },
      'world.villagers[0].pendingRoute[0] = {x:-5, y:4}',
    ],
    [
      'props[].at',
      (world) => {
        world.props = [
          {
            id: 'p1',
            kind: 'tree',
            at: { x: 500, y: 500 },
            label: '一棵树',
            sourceTaskKind: null,
            sourceTaskId: null,
            sourceSummary: null,
            grime: 0,
            reveal: null,
          },
        ];
      },
      'world.props[0].at = {x:500, y:500}',
    ],
    [
      'critters[].at',
      (world) => {
        world.critters = [{ id: 'cat_1', kind: 'cat', at: { x: -1, y: 0 }, leavesAt: 0 }];
      },
      'world.critters[0].at = {x:-1, y:0}',
    ],
    [
      'roads[]',
      (world) => {
        world.roads = [{ x: 30, y: 3 }];
      },
      'world.roads[0] = {x:30, y:3}',
    ],
  ];
  for (const [name, edit, expected] of cases) {
    const save = editSave(base, edit);
    assert.deepEqual(
      findOutOfWorldCoordinates(save, SMALL),
      [expected],
      `${name} 越界必须被指名，而且只指名这一处`,
    );
  }
});

test('建筑三类坐标也查，但不并成「落位合法」那一件事', () => {
  const base = makeSave();
  for (const slot of ['origin', 'door', 'workSpot'] as const) {
    const save = editSave(base, (world) => {
      (world.buildings as Record<string, { x: number; y: number }>[])[0][slot] = { x: 999, y: 999 };
    });
    assert.deepEqual(
      findOutOfWorldCoordinates(save, SMALL),
      [`world.buildings[0].${slot} = {x:999, y:999}`],
    );
  }
});

test('边界值：贴着边在里面，越一格就在外面', () => {
  const base = makeSave();
  const inside = editSave(base, (world) => {
    (world.villagers as { pos: unknown }[])[0].pos = { x: 29, y: 19 };
  });
  assert.deepEqual(findOutOfWorldCoordinates(inside, SMALL), [], '30×20 的右下角 (29,19) 在界内');

  // 30 与 20 是界外：判据与 `WorldGrid.inBounds` 同一条（x<width、y<height）。
  const outsideX = editSave(base, (world) => {
    (world.villagers as { pos: unknown }[])[0].pos = { x: 30, y: 0 };
  });
  assert.deepEqual(findOutOfWorldCoordinates(outsideX, SMALL), ['world.villagers[0].pos = {x:30, y:0}']);

  // 带小数是对的（`pos` 是 Vec2，她一路滑过来的），所以 29.9 在界内。
  const fractional = editSave(base, (world) => {
    (world.villagers as { pos: unknown }[])[0].pos = { x: 29.9, y: 0.5 };
  });
  assert.deepEqual(findOutOfWorldCoordinates(fractional, SMALL), []);
});

test('换了世界大小，同一份存档的结论会变', () => {
  const base = makeSave();
  // 莞尔镇存档里的坐标在 96×72 的大世界里全合法——大世界包含原来的镇中心。
  assert.deepEqual(findOutOfWorldCoordinates(base, LARGE), []);
  const moved = editSave(base, (world) => {
    (world.villagers as { pos: unknown }[])[0].pos = { x: 50, y: 50 };
  });
  assert.deepEqual(findOutOfWorldCoordinates(moved, SMALL), ['world.villagers[0].pos = {x:50, y:50}']);
  assert.deepEqual(findOutOfWorldCoordinates(moved, LARGE), [], '同一个坐标在大世界里是合法的');
});

// ---------------------------------------------------------------- 3. 读档链真的拦

test('parseSaveText 给了 bounds 才查；不给就只做形状校验', () => {
  const base = makeSave();
  const broken = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((broken.world as { villagers: { pos: unknown }[] }).villagers)[0].pos = { x: 99999, y: -98765 };
  const text = JSON.stringify(broken);

  const withoutBounds = parseSaveText(text);
  assert.equal(withoutBounds.ok, true, '不递 bounds 就查不了——这一步是调用方的事，不是解析器能猜的');

  const withBounds = parseSaveText(text, SMALL);
  assert.equal(withBounds.ok, false);
  if (withBounds.ok) return;
  assert.equal(withBounds.reason, 'out-of-world');
  assert.deepEqual(withBounds.outside, ['world.villagers[0].pos = {x:99999, y:-98765}']);
});

class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/**
 * 越界坐标一多就只列前几条。
 *
 * 从一张更大的图搬过来的存档，越界的 road 格子能有一条报一条，几十上百行。
 * 一个两百行的状态栏是另一个 bug——所以截断，并把总数说清楚、完整的清单送进
 * 控制台（`console.warn`，那儿没有行长）。
 */
test('越界坐标一多就只列前几条：总数说清楚，完整清单进控制台', () => {
  const base = makeSave();
  const save = editSave(base, (world) => {
    world.roads = Array.from({ length: 12 }, (_, index) => ({ x: 100 + index, y: 3 }));
  });
  // 十二条越界坐标，`findOutOfWorldCoordinates` 一条都不省——截断发生在拼消息那一步，
  // 不发生在检查那一步。这两件事分开，检查才敢说「我全查了」。
  assert.equal(findOutOfWorldCoordinates(save, SMALL).length, 12);

  const storage = new FakeStorage();
  storage.setItem('xiaoxi.pixel-world.save.v1', JSON.stringify(save));
  const store = new SaveStore({ storage, bounds: SMALL, wallClock: () => 1700000000000 });

  const result = store.read();
  assert.equal(result.ok, false, '界外坐标按坏档处理');
  if (result.ok) return;
  const lines = result.message.split('\n');
  assert.equal(lines.length, 7, `表头一行 + 五条指控 + 一行「还有 7 处」，实际 ${lines.length} 行`);
  assert.match(lines[6]!, /还有 7 处/);
  assert.match(lines[6]!, /控制台/, '完整的清单得有个去处');
  // 前五条是指名到 JSON 路径的，不是摘要。
  assert.match(lines[1]!, /world\.roads\[0\] = \{x:100, y:3\}/);
});

test('读档拦住界外坐标：备份原档、指名、用新世界启动', () => {
  const base = makeSave();
  const broken = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((broken.world as { villagers: { pos: unknown }[] }).villagers)[0].pos = { x: 99999, y: -98765 };
  const text = JSON.stringify(broken);

  const storage = new FakeStorage();
  storage.setItem('xiaoxi.pixel-world.save.v1', text);
  const warnings: string[] = [];
  const store = new SaveStore({ storage, bounds: SMALL, onWarning: (m) => warnings.push(m) });

  const result = store.read();
  assert.equal(result.ok, false, '界外坐标按坏档处理');
  if (result.ok) return;
  // 指名到路径：玩家要能照着这句话去改备份里的原档。
  assert.match(result.message, /world\.villagers\[0\]\.pos = \{x:99999, y:-98765\}/);
  assert.equal(result.paused, false, '界外坐标不关自动存档——新世界照常存');
  // 原档备份在，一个字节都没丢。
  const backups = [...storage.data.keys()].filter((key) => key.startsWith('xiaoxi.pixel-world.save.v1.corrupt.'));
  assert.equal(backups.length, 1, '坏档要备份');
  assert.equal(storage.getItem(backups[0]), text);
  assert.equal(warnings.length, 1);
});

test('导入同样拦，而且原文件已备份', () => {
  const base = makeSave();
  const broken = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  ((broken.world as { villagers: { pos: unknown }[] }).villagers)[0].pos = { x: 99999, y: -98765 };
  const text = JSON.stringify(broken);

  const storage = new FakeStorage();
  const store = new SaveStore({ storage, bounds: SMALL });
  const result = store.importText(text);
  assert.equal(result.ok, false);
  assert.match(result.message, /world\.villagers\[0\]\.pos/);
  const backups = [...storage.data.keys()].filter((key) => key.startsWith('xiaoxi.pixel-world.save.v1.corrupt.'));
  assert.equal(backups.length, 1);
  assert.equal(storage.getItem(backups[0]), text);
  // 没写进主槽：拦住的档不该生效。
  assert.equal(storage.getItem('xiaoxi.pixel-world.save.v1'), null);
});

// ---------------------------------------------------------------- 4. 到底坏在哪（实测）

test('界外 pos：她从此接不到任何活，而另一个村民照常', () => {
  const base = makeSave();
  const save = editSave(base, (world) => {
    (world.villagers as { pos: unknown }[])[0].pos = { x: 99999, y: -98765 };
  });
  const sim = loadInto(save, 0);
  sim.enqueue(syncCommand({ tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }], connected: true }));
  for (let i = 0; i < 30_000; i += 1) sim.update(16);

  const snap = sim.snapshot();
  const stranded = snap.villagers[0];
  const healthy = snap.villagers[1];
  assert.ok(stranded !== undefined && healthy !== undefined, '这份夹具有两个村民');
  assert.equal(stranded.mode, 'idle');
  assert.equal(stranded.taskId, null);
  // 活派给了另一个人，不是她——所以连「她卡在活儿上」都看不出来。
  assert.equal(healthy.taskId, 'c_1');
  // 一单都没结：她在世界外，铺子的门她一辈子走不到。
  assert.deepEqual(snap.deliveries, { feed: 0, local: 0 });
});

test('界外 path 格子会把她一路拖出世界，而且不回来', () => {
  const base = makeSave();
  const save = editSave(base, (world) => {
    (world.villagers as { path: unknown; mode: unknown }[])[0].path = [{ x: 999, y: 999 }];
    (world.villagers as { mode: unknown }[])[0].mode = 'toWork';
  });
  const sim = loadInto(save, 0);
  const before = sim.snapshot().villagers[0].pos;
  assert.ok(before !== undefined);
  assert.ok(
    before.x < 30 && before.y < 20,
    `起点必须在界内，否则这条断言跟拖不拖出去无关：${before.x},${before.y}`,
  );
  for (let i = 0; i < 30_000; i += 1) sim.update(16);
  const after = sim.snapshot().villagers[0].pos;
  assert.ok(after !== undefined);
  assert.ok(
    after.x > 30 || after.y > 20,
    `她应当已经被拖出 30×20 的世界，实际停在 ${after.x},${after.y}`,
  );
});

test('界外 prop：日报说它落在祭坛边，地图上哪都没有它', () => {
  const base = makeSave();
  const save = editSave(base, (world) => {
    world.props = [
      {
        id: 'p1',
        kind: 'tree',
        at: { x: 500, y: 500 },
        label: '一棵神迹种的树',
        sourceSummary: '神迹',
        sourceTaskId: null,
        sourceTaskKind: null,
        grime: 0,
        reveal: null,
      },
    ];
  });
  const sim = loadInto(save, 0);
  const snap = sim.snapshot();
  // 摆件确实在快照里——所以纸面那一句不是凭空编的，它只是对着一张没有它的地图说。
  assert.equal(snap.props.length, 1);
  assert.equal(snap.props[0].at.x, 500);
  const report = composeReport(snap);
  assert.ok(
    report.lines.some((line) => line.includes('一棵神迹种的树') && line.includes('祭坛边')),
    `日报该提到这棵树，实际：${JSON.stringify(report.lines)}`,
  );
  assert.equal(sim.snapshot().props[0].kind, 'tree');
});

test('正常档读得进来，界外坐标那一拦不影响它', () => {
  const base = makeSave();
  const storage = new FakeStorage();
  storage.setItem('xiaoxi.pixel-world.save.v1', JSON.stringify(base));
  const store = new SaveStore({ storage, bounds: SMALL });
  const result = store.read();
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.save.schemaVersion, CURRENT_SCHEMA_VERSION);
});
