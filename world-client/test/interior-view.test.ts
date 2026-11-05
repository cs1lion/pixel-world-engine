import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlacedBuilding, Silhouette } from '../src/world/types.ts';
import {
  INTERIOR_ROOM_H,
  INTERIOR_ROOM_W,
  INTERIOR_SWITCH_SWAP_FRAME,
  INTERIOR_TRANSITION_FRAMES,
  interiorFloorsFor,
  interiorLayoutFor,
  interiorSwitchOpacity,
  interiorTransitionProgress,
  seedAt,
  seatFor,
  smoothStep,
  stairDirectionAt,
  wallSeed,
} from '../src/render/interior-layout.ts';

/** 只填布局用得到的那几个字段；其余交给 `unknown` 转换，别把测试写成存档样例。 */
function building(
  instanceId: string,
  originX = 12,
  originY = 9,
  zone = 'industry',
  silhouette: Silhouette = 'gable',
): PlacedBuilding {
  return {
    instanceId,
    prefabId: 'forge',
    displayName: '炉底层',
    zone,
    origin: { x: originX, y: originY },
    footprint: { w: 4, h: 3 },
    door: { x: originX + 2, y: originY + 3 },
    silhouette,
  } as unknown as PlacedBuilding;
}

function insideRoom(rect: { x: number; y: number; w: number; h: number }): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w > 0 &&
    rect.h > 0 &&
    rect.x + rect.w <= INTERIOR_ROOM_W &&
    rect.y + rect.h <= INTERIOR_ROOM_H
  );
}

test('内景布局：同一个楼、同一层，两次算出来逐字段相同', () => {
  const target = building('forge-a');
  const first = interiorLayoutFor(target);
  const second = interiorLayoutFor(building('forge-a'));
  assert.deepEqual(first, second);
});

test('内景布局：换了楼就换布局，别长得一模一样', () => {
  const a = interiorLayoutFor(building('forge-a'));
  const b = interiorLayoutFor(building('forge-b'));
  assert.notEqual(a.seed, b.seed);
  assert.notDeepEqual(a.seats, b.seats);
});

test('内景布局：楼梯与门都落在房间内，且互不重叠', () => {
  const layout = interiorLayoutFor(building('forge-a'));
  assert.ok(insideRoom(layout.stairs), '楼梯越界');
  assert.ok(insideRoom(layout.door), '门越界');
  const overlap =
    layout.stairs.x < layout.door.x + layout.door.w &&
    layout.door.x < layout.stairs.x + layout.stairs.w &&
    layout.stairs.y < layout.door.y + layout.door.h &&
    layout.door.y < layout.stairs.y + layout.stairs.h;
  assert.equal(overlap, false, '楼梯和门压在了一起，点了分不清');
});

test('内景布局：烘焙纹理名带楼 id 与层号，两层不会撞名', () => {
  const layout = interiorLayoutFor(building('forge-a'), 1);
  const upper = interiorLayoutFor(building('forge-a'), 2);
  assert.equal(layout.key, 'interior:forge-a:f1');
  assert.notEqual(layout.key, upper.key);
  assert.equal(layout.floor, 1);
  assert.equal(upper.floor, 2);
});

test('内景布局：民居没有炉口，工业楼有', () => {
  assert.equal(interiorLayoutFor(building('home-a', 1, 1, 'living')).hearth, null);
  assert.notEqual(interiorLayoutFor(building('forge-a')).hearth, null);
});

test('种子派生：同一盐稳定，不同盐分开', () => {
  const seed = wallSeed(building('forge-a'));
  assert.equal(wallSeed(building('forge-a')), seed);
  assert.notEqual(seedAt(seed, 1), seedAt(seed, 2));
});

test('过渡进度：0 帧为 0，满帧为 1，中途单调不减且夹在 0..1', () => {
  assert.equal(interiorTransitionProgress(0), 0);
  assert.equal(interiorTransitionProgress(INTERIOR_TRANSITION_FRAMES), 1);
  assert.equal(interiorTransitionProgress(INTERIOR_TRANSITION_FRAMES + 30), 1);
  assert.equal(interiorTransitionProgress(-5), 0);

  let previous = 0;
  for (let frames = 0; frames <= INTERIOR_TRANSITION_FRAMES; frames += 1) {
    const value = interiorTransitionProgress(frames);
    assert.ok(value >= previous, `第 ${frames} 帧倒退了`);
    assert.ok(value >= 0 && value <= 1);
    previous = value;
  }
});

test('过渡缓动：两端是 0 与 1，中点为 0.5', () => {
  assert.equal(smoothStep(0), 0);
  assert.equal(smoothStep(0.5), 0.5);
  assert.equal(smoothStep(1), 1);
  assert.equal(smoothStep(2), 1);
  assert.equal(smoothStep(-1), 0);
});

test('座位分配：先坐满桌子，多出来的人在门口站开，再多就不画', () => {
  const layout = interiorLayoutFor(building('forge-a'));
  assert.deepEqual(seatFor(layout, 0), layout.seats[0]);
  assert.deepEqual(seatFor(layout, layout.seats.length - 1), layout.seats[layout.seats.length - 1]);
  assert.notEqual(seatFor(layout, layout.seats.length), null);
  assert.equal(seatFor(layout, 6), null);
});

test('层数：按剪影读，flat 1 层、gable 2 层、tower 3 层；世界状态里不存', () => {
  assert.equal(interiorFloorsFor(building('a', 1, 1, 'living', 'flat')), 1);
  assert.equal(interiorFloorsFor(building('a', 1, 1, 'living', 'gable')), 2);
  assert.equal(interiorFloorsFor(building('a', 1, 1, 'industry', 'tower')), 3);
});

test('楼层入参越界时被夹回 1..floors，不会烘出不存在的层', () => {
  const layout = interiorLayoutFor(building('forge-a'), 9);
  assert.equal(layout.floor, layout.floors);
  const lower = interiorLayoutFor(building('forge-a'), -4);
  assert.equal(lower.floor, 1);
});

test('楼梯分上下两段：上半 up、下半 down，互不重叠且都在房间内', () => {
  const layout = interiorLayoutFor(building('forge-a'));
  assert.ok(insideRoom(layout.stairUp));
  assert.ok(insideRoom(layout.stairDown));
  assert.equal(layout.stairUp.y + layout.stairUp.h, layout.stairDown.y);

  const mid = {
    x: layout.stairs.x + 2,
    y: layout.stairs.y + Math.floor(layout.stairs.h / 2),
  };
  assert.equal(stairDirectionAt(layout, mid.x, layout.stairUp.y + 1), 'up');
  assert.equal(stairDirectionAt(layout, mid.x, layout.stairDown.y + 1), 'down');
  // 楼梯左右之外不给方向；门那一片也不该被当成楼梯。
  assert.equal(stairDirectionAt(layout, layout.stairs.x - 2, mid.y), null);
  assert.equal(stairDirectionAt(layout, layout.door.x, layout.door.y), null);
});

test('切层边界：底层只可上、顶层只可下，中间两层都可', () => {
  const ground = interiorLayoutFor(building('forge-a'), 1);
  assert.equal(ground.canUp, true);
  assert.equal(ground.canDown, false);
  const top = interiorLayoutFor(building('forge-a'), 2);
  assert.equal(top.canUp, false);
  assert.equal(top.canDown, true);
  const towerGround = interiorLayoutFor(building('forge-b', 12, 9, 'industry', 'tower'), 2);
  assert.equal(towerGround.canUp, true);
  assert.equal(towerGround.canDown, true);
});

test('切层过渡：0 帧与满帧不透明度为 1，中点帧为 0', () => {
  assert.equal(interiorSwitchOpacity(0), 1);
  assert.equal(interiorSwitchOpacity(INTERIOR_SWITCH_SWAP_FRAME), 0);
  assert.equal(interiorSwitchOpacity(INTERIOR_TRANSITION_FRAMES), 1);
  // 中点必须是整数帧——不然「中点换图」会落在两帧之间，接缝就可能被看到。
  assert.equal(Number.isInteger(INTERIOR_SWITCH_SWAP_FRAME), true);
});

test('楼上没有灶：炉口只画在底层，这是「切层真的换了图」的可见线索', () => {
  const ground = interiorLayoutFor(building('forge-a'), 1);
  const upper = interiorLayoutFor(building('forge-a'), 2);
  assert.notEqual(ground.hearth, null);
  assert.equal(upper.hearth, null);
  // 家具按层号派生：同一栋楼的上下两层不该长得一模一样。
  assert.notEqual(ground.seed, upper.seed);
});
