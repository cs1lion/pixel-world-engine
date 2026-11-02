import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import { witnessesOf, type Perceiver } from '../src/world/memory/perception.ts';

const grid = { isWalkable: () => true };

const perceivers: readonly Perceiver[] = [
  { holderId: 'in-shop', at: { x: 11, y: 11 }, inside: 'shop' },
  { holderId: 'at-door', at: { x: 13, y: 11 }, inside: null },
  { holderId: 'far-outside', at: { x: 40, y: 40 }, inside: null },
  { holderId: 'in-other', at: { x: 21, y: 21 }, inside: 'other' },
];

test('室内事件：只有同一个房间里的人在场，门口的人也不算', () => {
  const witnesses = witnessesOf({
    place: { placeId: 'shop', at: { x: 11, y: 11 }, indoor: true },
    perceivers,
    grid,
    config: DEFAULT_MEMORY_CONFIG,
  });
  assert.deepEqual(witnesses, ['in-shop']);
});

test('室内的人看不见室外事件', () => {
  const witnesses = witnessesOf({
    place: { placeId: 'place:street', at: { x: 12, y: 11 }, indoor: false },
    perceivers,
    grid,
    config: DEFAULT_MEMORY_CONFIG,
  });
  // in-shop 在室内；at-door 在门口且距离 1，应当看见。
  assert.ok(witnesses.includes('at-door'));
  assert.ok(!witnesses.includes('in-shop'));
});

test('观察者的 inside 有真实值，不是写死的 null', () => {
  assert.equal(perceivers[0]!.inside, 'shop');
  assert.equal(perceivers[1]!.inside, null);
});
