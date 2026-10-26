import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routineFor, type RoutineBeat } from '../src/world/routines.ts';

/** 汐的一圈：锚点、楼前、只在满潮去的滩边、只在退潮去的灯芯。 */
const beats: readonly RoutineBeat[] = [
  { id: 'altar', label: '在旧站牌下认路', target: { x: 19, y: 15 }, dwellMs: 6500 },
  { id: 'promenade', label: '点亮楼前的长灯', target: { x: 32, y: 27 }, dwellMs: 5800 },
  { id: 'promenade', label: '满潮时收起滩边的灯', target: { x: 39, y: 29 }, dwellMs: 4800, tide: 'high' },
  { id: 'promenade', label: '趁退潮拾回还能用的灯芯', target: { x: 50, y: 42 }, dwellMs: 6000, tide: 'low' },
];

test('潮位不成立的落点退回锚点，label 与 target 必须指向同一个地方', () => {
  // 退潮时不去滩边：她要回到锚点，而状态行也得说锚点那句。
  const ebbAtShoalBeat = routineFor('clear', beats, 2, 0.2);
  assert.equal(ebbAtShoalBeat.target.x, 19);
  assert.equal(ebbAtShoalBeat.target.y, 15);
  assert.equal(ebbAtShoalBeat.label, '在旧站牌下认路', '牌子不能说她去了别处');

  // 涨潮时不下浅滩：同样退回锚点。
  const floodAtEmberBeat = routineFor('clear', beats, 3, 0.9);
  assert.equal(floodAtEmberBeat.target.x, 19);
  assert.equal(floodAtEmberBeat.target.y, 15);
  assert.equal(floodAtEmberBeat.label, '在旧站牌下认路');

  // 停留时长是原落点的：她本来打算在那儿待多久，退回时照旧。
  assert.equal(ebbAtShoalBeat.dwellMs, 4800);
  assert.equal(floodAtEmberBeat.dwellMs, 6000);
});

test('潮位条件成立时原样放行，不被上面的退回改写', () => {
  const highTideShoal = routineFor('clear', beats, 2, 0.9);
  assert.equal(highTideShoal.target.x, 39);
  assert.equal(highTideShoal.label, '满潮时收起滩边的灯');

  const lowTideEmber = routineFor('clear', beats, 3, 0.1);
  assert.equal(lowTideEmber.target.x, 50);
  assert.equal(lowTideEmber.label, '趁退潮拾回还能用的灯芯');
});

test('没有潮汐条件的落点任何潮位都照常去', () => {
  for (const level of [0, 0.2, 0.5, 0.9, 1]) {
    const beat = routineFor('clear', beats, 1, level);
    assert.equal(beat.target.x, 32);
    assert.equal(beat.label, '点亮楼前的长灯');
  }
});

test('下雨仍然优先躲雨，潮汐判定插不进来', () => {
  const beat = routineFor('storm', beats, 2, 0.2);
  assert.equal(beat.id, 'shelter');
  assert.equal(beat.target.x, 19, '躲雨回锚点');
  assert.match(beat.label, /暴雨/);
});
