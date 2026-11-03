import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { ALTAR, buildWorld, buildWorldFromSave } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { assertSave, type WorldSave } from '../src/world/save.ts';

/**
 * 记忆段在存档里的样子：`world.memory` 是一段自带 `memorySchemaVersion` 的
 * JSON 字符串。这组测的是**存→读→状态一致**，也就是刷新之后记忆还在。
 *
 * 与场景的接线保持同一套分工：`Simulation.toSave(memoryState)` 只把这段
 * 字符串写进 `world.memory`，读档时由调用方（场景）在 `Simulation.fromSave`
 * 之后调 `memory.fromJSON(save.world.memory)`。记忆层不反向依赖世界存档。
 */

const rawPrefabs = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(rawPrefabs);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
}

function reload(save: WorldSave): Simulation {
  const world = buildWorldFromSave(save.world.buildings);
  return Simulation.fromSave(JSON.parse(JSON.stringify(save)) as WorldSave, {
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: save.world.villagers[0]?.name ?? '莞尔',
    wallClock: () => 1000,
  });
}

/** 造一段有内容的记忆：名册、事实、亲历、断言、痕迹、地名、传言、照面。 */
function buildMemory(): MemoryRuntime {
  const memory = new MemoryRuntime({ worldId: 'save-roundtrip' });
  memory.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 1, y: 1 } },
    { holderId: 'b', type: 'character', at: { x: 2, y: 1 } },
    { holderId: 'workshop', type: 'place', at: { x: 1, y: 2 }, name: '炉匠铺' },
  ]);
  memory.observe(
    {
      eventId: 'e1',
      kind: 'milestone',
      placeId: 'workshop',
      at: { x: 1, y: 2 },
      actors: ['a'],
      outcome: { what: '第一口井打成了' },
      importanceHint: 0.9,
    },
    ['a', 'b'],
    1000,
  );
  memory.world.createClaimFrom('e1', 'a', 1000);
  // 跨过日界：传言散出去，扇出也各留下一笔。关账会清空当天照面表，
  // 所以再对齐一次处境——运行时每拍都会做这件事，这里只是补上那一拍。
  memory.tick(DAY_MS + 1);
  memory.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 1, y: 1 } },
    { holderId: 'b', type: 'character', at: { x: 2, y: 1 } },
    { holderId: 'workshop', type: 'place', at: { x: 1, y: 2 }, name: '炉匠铺' },
  ]);
  return memory;
}

test('记忆环回：toSave(带记忆) → assertSave → 读档复原，状态逐字段一致', () => {
  const memory = buildMemory();
  const before = memory.toJSON();
  assert.notEqual(before, '', '这段记忆该是有内容的');

  const sim = makeSim();
  const save = sim.toSave(before);
  assert.equal(save.world.memory, before, '记忆字符串原样进存档，不被世界改写');
  assert.doesNotThrow(() => assertSave(save));

  // 读档：世界照旧走 Simulation.fromSave，记忆由调用方接着复原。
  const reloadedSim = reload(save);
  assert.equal(reloadedSim.snapshot().now, sim.snapshot().now, '世界时间照旧');

  const restored = new MemoryRuntime({ worldId: 'save-roundtrip' });
  assert.equal(restored.fromJSON(save.world.memory), true);
  const after = restored.toJSON();
  assert.deepEqual(JSON.parse(after), JSON.parse(before), '读回来的记忆必须与存下去的一模一样');

  // 不只是字符串相等：几扇读门拿到的也是同一份东西。
  assert.deepEqual(
    restored.viewOf('a')!.memories.map((entry) => entry.memoryId),
    memory.viewOf('a')!.memories.map((entry) => entry.memoryId),
  );
  assert.equal(restored.placeNamesOf('workshop')?.name, '炉匠铺');
  assert.equal(restored.day, memory.day, '第几天也跟回来了');
});

test('记忆段覆盖全部状态：名册/事实/亲历/断言/痕迹/地名/传言/照面都在', () => {
  const snapshot = JSON.parse(buildMemory().toJSON()) as {
    memorySchemaVersion: number;
    world: Record<string, unknown>;
  };
  assert.equal(snapshot.memorySchemaVersion, 2, '记忆层自带版本线，与存档 schemaVersion 无关');

  const keys = Object.keys(snapshot.world).sort();
  assert.deepEqual(keys, [
    'announcements',
    'beliefs',
    'claims',
    'cooldowns',
    'credibility',
    'currentDay',
    'entries',
    'facts',
    'fanout',
    'holders',
    'legends',
    'metToday',
    'nextSerial',
    'placeAnchors',
    'placeNames',
    'tells',
    'traces',
    'verifyPlans',
    'written',
  ]);

  const world = snapshot.world as Record<string, unknown[]>;
  assert.equal(world.holders!.length, 3);
  assert.equal(world.facts!.length, 1);
  assert.ok(world.entries!.length >= 1, '亲历条目');
  assert.equal(world.claims!.length, 1, '断言');
  assert.ok(world.traces!.length >= 1, '里程碑在炉匠铺留下一道碑文');
  assert.equal(world.placeNames!.length, 1, '地点名');
  assert.ok(world.beliefs!.length >= 1, '隔一格该听得见传言');
  assert.ok(world.metToday!.length >= 1, '照面记录');
  assert.ok((world.fanout as unknown as { counts: unknown[] }).counts.length >= 1, '当日扇出计数');
});

test('需要特定条件才出现的两段（求证排期 / 可信度分数）也原样回得来', () => {
  // 这两段要靠冲突与辟谣才会自然出现，造起来牵扯一串规则。这里直接喂
  // 合法形状，验的是「解析 → 复原 → 再序列化」这条存档通路，不是规则本身。
  const base = JSON.parse(buildMemory().toJSON()) as {
    world: Record<string, unknown>;
  };
  base.world.verifyPlans = [
    {
      holderId: 'b',
      plans: [
        { holderId: 'b', placeId: 'workshop', claimId: 'c_test', impulse: 0.5, reason: 'trace' },
      ],
    },
  ];
  base.world.credibility = [['a', 0.42]];
  const text = JSON.stringify(base);

  const restored = new MemoryRuntime();
  assert.equal(restored.fromJSON(text), true);
  assert.deepEqual(JSON.parse(restored.toJSON()), base);
});

test('空串是「没有记忆」，不是坏档：返回 false 且世界照常可读', () => {
  const memory = new MemoryRuntime();
  assert.equal(memory.fromJSON(''), false);
  assert.equal(memory.toJSON().includes('"holders":[]'), true);
  // 世界照旧能走：新档就该是一间空屋子，而不是读不出来。
  const sim = makeSim();
  const save = sim.toSave('');
  assert.equal(save.world.memory, '');
  assert.doesNotThrow(() => assertSave(save));
  assert.equal(reload(save).snapshot().now, sim.snapshot().now);
});

test('坏记忆不拖垮世界：坏 JSON / 版本不符 / 缺 world → false，不抛', () => {
  const cases: [string, string][] = [
    ['坏 JSON', '{ not json'],
    ['版本不符', JSON.stringify({ memorySchemaVersion: 99, lastClosedDay: 0, started: false, now: 0, positions: [], world: {} })],
  ];
  for (const [label, text] of cases) {
    const memory = new MemoryRuntime();
    assert.equal(memory.fromJSON(text), false, `${label} 该被拒绝`);
  }

  // 结构缺口也拒绝：`world` 不是对象时喂进 `restoreSnapshot` 会崩。
  const missingWorld = JSON.stringify({
    memorySchemaVersion: 1,
    lastClosedDay: 0,
    started: false,
    now: 0,
    positions: [],
    world: {},
  });
  const memory = new MemoryRuntime();
  assert.equal(memory.fromJSON(missingWorld), false);

  // 被拒之后世界仍是一间干净屋子，下一次存档照常。
  const sim = makeSim();
  const save = sim.toSave('');
  assert.doesNotThrow(() => assertSave(save));
});
