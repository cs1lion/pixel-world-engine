import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routineFor, type RoutineBeat } from '../src/world/routines.ts';

/** 汐的一圈：锚点、楼前、只在满潮去的滩边、只在退潮去的灯芯。 */
const beats: readonly RoutineBeat[] = [
  { id: 'altar', label: '在旧站牌下认路', going: '去旧站牌下', target: { x: 19, y: 15 }, dwellMs: 6500 },
  { id: 'promenade', label: '点亮楼前的长灯', going: '去楼前', target: { x: 32, y: 27 }, dwellMs: 5800 },
  { id: 'promenade', label: '满潮时收起滩边的灯', going: '去滩边收灯', target: { x: 39, y: 29 }, dwellMs: 4800, tide: 'high' },
  { id: 'promenade', label: '趁退潮拾回还能用的灯芯', going: '去滩边拾灯芯', target: { x: 50, y: 42 }, dwellMs: 6000, tide: 'low' },
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
  // 落点是调用方喂的那道门，不是锚点。
  //
  // 早先这里断言「躲雨回锚点」（target.x === 19）——那条断言钉的是一句假话：
  // 牌子写「缩进屋檐下躲暴雨」，落点却是露天的锚点。跑起来的人没被这句骗到，
  // 只因为 `Simulation.resolvedTarget` 另外单开一道，把 shelter 的落点改去了门口。
  // 于是纯函数与真实世界各说一套，而测试站在假的那一套那边。现在 `routineFor`
  // 由调用方喂真门，落点只有一个出处。
  const door = { x: 18, y: 9 };
  const beat = routineFor('storm', beats, 2, 0.2, door);
  assert.equal(beat.id, 'shelter');
  assert.equal(beat.target.x, 18, '躲雨落在门上，不落在锚点');
  assert.equal(beat.target.y, 9);
  assert.match(beat.label, /暴雨/);
  assert.doesNotMatch(beat.label, /站牌/, '牌子说的得是落点那儿的事');
});

test('一栋楼都没有时，躲雨退回锚点，牌子也照锚点说', () => {
  // 给不出门就别说是屋檐：世界可以在做不到时说「现在不行」，
  // 不能一边说屋檐一边把人放在露天里。
  const beat = routineFor('rain', beats, 2, 0.2, null);
  assert.equal(beat.id, 'shelter');
  assert.equal(beat.target.x, 19, '没有门就退回锚点');
  assert.equal(beat.target.y, 15);
  assert.doesNotMatch(beat.label, /屋檐/, '落点是露天，牌子不能说是屋檐');
  assert.match(beat.label, /祭坛边/);
});
