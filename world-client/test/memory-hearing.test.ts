import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { heardBy, SOUND_RADIUS, soundKindOf } from '../src/world/memory/hearing.ts';
import type { Perceiver } from '../src/world/memory/perception.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

const openGrid = { isWalkable: () => true };
/** 一堵竖墙：x = 5 不可走。 */
const walledGrid = { isWalkable: (p: { x: number; y: number }) => p.x !== 5 };

function perceiversAt(...points: readonly [string, number, number][]): Perceiver[] {
  return points.map(([holderId, x, y]) => ({ holderId, at: { x, y }, inside: null }));
}

test('距离衰减：半径内听见，半径外听不见；声音类型不同半径不同', () => {
  const sound = { placeId: 'place:street', at: { x: 0, y: 0 }, indoor: false, kind: 'speech' as const };
  const near = perceiversAt(['near', 4, 0], ['just-out', 7, 0]);
  const heard = heardBy({ sound, perceivers: near, grid: openGrid, config: DEFAULT_MEMORY_CONFIG });
  assert.deepEqual(heard, ['near']);
  assert.equal(SOUND_RADIUS.speech, 6);

  const impact = heardBy({
    sound: { ...sound, kind: 'impact' },
    perceivers: near,
    grid: openGrid,
    config: DEFAULT_MEMORY_CONFIG,
  });
  assert.deepEqual(impact, ['near', 'just-out']);
});

test('墙体阻挡：墙后的人听不见', () => {
  const sound = { placeId: 'place:street', at: { x: 0, y: 0 }, indoor: false, kind: 'work' as const };
  const heard = heardBy({
    sound,
    perceivers: perceiversAt(['before-wall', 3, 0], ['behind-wall', 8, 0]),
    grid: walledGrid,
    config: DEFAULT_MEMORY_CONFIG,
  });
  assert.deepEqual(heard, ['before-wall']);
});

test('室内声音只传同一个房间', () => {
  const sound = { placeId: 'shop', at: { x: 11, y: 11 }, indoor: true, kind: 'work' as const };
  const heard = heardBy({
    sound,
    perceivers: [
      { holderId: 'same-room', at: { x: 11, y: 11 }, inside: 'shop' },
      { holderId: 'door', at: { x: 13, y: 11 }, inside: null },
    ],
    grid: openGrid,
    config: DEFAULT_MEMORY_CONFIG,
  });
  assert.deepEqual(heard, ['same-room']);
});

test('听见但没看见：写一条 sourceMode=heard 的条目，细节比目击低', () => {
  const memory = new MemoryRuntime({
    worldId: 'hearing-wiring',
    occlusion: openGrid,
  });
  memory.syncHolders([
    { holderId: 'worker', type: 'character', at: { x: 10, y: 10 } },
    { holderId: 'listener', type: 'character', at: { x: 12, y: 10 } },
  ]);
  memory.world.ingest({
    eventId: 'evt-heard-1',
    at: 0,
    kind: 'task_done',
    place: { placeId: 'place:street', at: { x: 10, y: 10 }, indoor: false },
    actors: ['worker'],
    outcome: { what: '有人交了一单活' },
    visibility: 'world',
    source: 'world',
    importanceHint: 0.5,
    parentEventId: null,
    witnesses: ['worker'],
    hearers: ['listener'],
    valence: 0.3,
  });
  const view = memory.viewOf('listener');
  assert.ok(view !== null);
  const heard = view!.memories.find((entry) => entry.sourceMode === 'heard');
  assert.ok(heard !== undefined, '听见的人要有条目');
  assert.equal(heard!.content.detailLevel, 2);
  assert.equal(heard!.confidence, 0.6);
  assert.deepEqual(heard!.eventRefs, ['evt-heard-1']);
});

test('声音类型映射：拆楼是 impact，神迹是 miracle', () => {
  assert.equal(soundKindOf('conflict'), 'impact');
  assert.equal(soundKindOf('celebration'), 'miracle');
  assert.equal(soundKindOf('task_done'), 'work');
});
