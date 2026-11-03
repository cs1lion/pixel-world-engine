import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { fnv1a64Hex } from '../src/world/save.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { applyOps, diffDoc, type HistoryDoc } from '../src/world/history/patch.ts';
import { SceneHistory } from '../src/world/history/scene-history.ts';
import { MemoryHistoryStore } from '../src/world/history/store.ts';

/**
 * 只读回溯：每日字段级补丁 + 30 天全量。
 *
 * 这一组钉四件事：
 * 1. `diffDoc` / `applyOps` 往返一致（含「数组换了顺序」这种最容易漏的差）；
 * 2. 回溯到第 N 天，角色记得的条目与当时记录一致；
 * 3. 回溯前后当前世界状态 hash 不变（证明只读）；
 * 4. 没有记录的那一天如实说「没有」，不插值。
 */

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

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

/** 一个两天就有内容的小世界：一个人、一间铺子、每天一件事。 */
function scripted(): { sim: Simulation; memory: MemoryRuntime } {
  const memory = new MemoryRuntime({ worldId: 'scene-history' });
  memory.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 1, y: 1 } },
    { holderId: 'b', type: 'character', at: { x: 2, y: 1 } },
    { holderId: 'hall', type: 'place', at: { x: 1, y: 2 }, name: '书斋' },
  ]);
  return { sim: makeSim(), memory };
}

function observe(memory: MemoryRuntime, eventId: string, day: number, kind = 'milestone'): void {
  memory.observe(
    {
      eventId,
      kind,
      placeId: 'hall',
      at: { x: 1, y: 2 },
      actors: ['a'],
      outcome: { what: `第${day}天的一件事`, name: '书斋' },
      importanceHint: 0.6,
      valence: 0.4,
      arousal: 0.4,
      placeType: 'building',
      landmark: {
        change: 'built',
        displayName: '书斋',
        origin: { x: 1, y: 2 },
        footprint: { w: 2, h: 2 },
      },
    },
    ['a', 'b'],
    day * DAY_MS + 1000,
  );
}

test('差分往返：改字段、增删元素、数组换顺序，全都还原得回来', () => {
  const prev = {
    day: 0,
    save: { schemaVersion: 5, world: {}, meta: {} },
    memory: {
      entries: [
        { memoryId: 'm1', strength: 1, archived: false },
        { memoryId: 'm2', strength: 0.8, archived: false },
        { memoryId: 'm3', strength: 0.5, archived: true },
      ],
      facts: [{ eventId: 'e1', importanceHint: 0.6 }],
      metToday: [['a\u0000b', 1]],
    },
  } as unknown as HistoryDoc;
  const next = {
    day: 2,
    save: { schemaVersion: 5, world: { now: 200 }, meta: {} },
    memory: {
      // 顺序：m3 提到最前，m2 删掉，m4 新增。
      entries: [
        { memoryId: 'm3', strength: 0.4, archived: true },
        { memoryId: 'm1', strength: 0.7, archived: false },
        { memoryId: 'm4', strength: 1, archived: false },
      ],
      facts: [
        { eventId: 'e1', importanceHint: 0.9 },
        { eventId: 'e2', importanceHint: 0.4 },
      ],
      metToday: [],
    },
  } as unknown as HistoryDoc;

  const copy = JSON.parse(JSON.stringify(prev)) as HistoryDoc;
  applyOps(copy, diffDoc(prev, next));
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(next)));
});

test('回溯到第 N 天：角色记得的那几条与当时记录一致', async () => {
  const { sim, memory } = scripted();
  const store = new MemoryHistoryStore();
  const history = new SceneHistory({ worldId: 'scene-history', store, everyDays: 30 });
  const expected = new Map<number, readonly string[]>();

  for (let day = 0; day < 4; day += 1) {
    observe(memory, `ev_${day}`, day);
    memory.tick((day + 1) * DAY_MS);
    const closed = memory.closedThroughDay;
    history.capture(closed, {
      day: closed,
      save: sim.toSave(''),
      memory: memory.toSnapshot(),
    });
    // 与 `summariseMemories` 同一个排序：天倒序、同天 id 倒序、取前 5。
    expected.set(
      closed,
      [...memory.viewOf('a')!.memories]
        .sort((a, b) => b.createdDay - a.createdDay || (a.memoryId < b.memoryId ? 1 : -1))
        .slice(0, 5)
        .map((entry) => entry.memoryId),
    );
  }
  await history.flush();

  for (const day of [1, 2, 3]) {
    const result = await history.rewind(day);
    assert.equal(result.missing, false, `第 ${day} 天该有记录`);
    const character = result.characters.find((item) => item.holderId === 'a');
    assert.ok(character !== undefined);
    assert.deepEqual(
      character.memories.map((line) => line.memoryId),
      expected.get(day)!,
      `第 ${day} 天回溯出的条目应与当时一致（同一份快照、同一个排序）`,
    );
    assert.equal(result.eraLabel !== null, true, '时代标签在场景记忆里');
  }
});

test('回溯是只读的：前后的当前世界存档 hash 完全相同', async () => {
  const { sim, memory } = scripted();
  const store = new MemoryHistoryStore();
  const history = new SceneHistory({ worldId: 'scene-history', store });
  for (let day = 0; day < 3; day += 1) {
    observe(memory, `ev_${day}`, day);
    memory.tick((day + 1) * DAY_MS);
    history.capture(memory.closedThroughDay, {
      day: memory.closedThroughDay,
      save: sim.toSave(''),
      memory: memory.toSnapshot(),
    });
  }
  await history.flush();

  const before = fnv1a64Hex(JSON.stringify(sim.toSave(memory.toJSON())));
  const view = await history.rewind(2);
  assert.equal(view.missing, false);
  const after = fnv1a64Hex(JSON.stringify(sim.toSave(memory.toJSON())));
  assert.equal(after, before, '回溯读的是自己的副本，活动世界一个字节都没变');
});

test('没有记录的那一天如实说「没有」：不插值、不拿今天倒推', async () => {
  const { sim, memory } = scripted();
  const store = new MemoryHistoryStore();
  const history = new SceneHistory({ worldId: 'scene-history', store });
  observe(memory, 'ev_0', 0);
  memory.tick(DAY_MS);
  history.capture(0, { day: 0, save: sim.toSave(''), memory: memory.toSnapshot() });
  history.markMissing(1);
  observe(memory, 'ev_2', 2);
  memory.tick(3 * DAY_MS);
  history.capture(2, { day: 2, save: sim.toSave(''), memory: memory.toSnapshot() });
  await history.flush();

  const missing = await history.rewind(1);
  assert.equal(missing.missing, true);
  assert.equal(missing.save, null);
  assert.deepEqual(missing.characters, []);
  // 第 1 天没有记录；第 2 天与前一份快照隔了一天以上，于是那份是**全量**
  // （隔日的补丁接不上去——补丁只对「紧挨着的昨天」成立）。
  assert.deepEqual(history.days().map((item) => item.kind), ['base', 'missing', 'base']);
});
