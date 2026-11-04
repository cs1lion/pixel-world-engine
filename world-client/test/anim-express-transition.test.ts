/** 动画表现力线 · 第二步：过渡与打断回位。
 *
 * 全部判据都只依赖世界拍，不依赖真实时间；关掉开关后必须立即落终态。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOOR_BEATS,
  TURN_BEATS,
  VillagerTransition,
  animationTransitionsOn,
  setAnimationTransitions,
} from '../src/render/villager-transition.ts';
import { MOTION_SEQUENCES, MotionTracker } from '../src/render/villager-frames.ts';

test('转身固定 2 拍：第 0 拍旧朝向 + 1px 让位，第 1 拍新朝向', () => {
  const transition = new VillagerTransition();
  assert.deepEqual(transition.sampleFacing('down', 0), {
    facing: 'down',
    offsetX: 0,
    turning: false,
  });
  const first = transition.sampleFacing('right', 10);
  assert.equal(first.facing, 'down');
  assert.equal(first.offsetX, 1);
  assert.equal(first.turning, true);
  const second = transition.sampleFacing('right', 11);
  assert.equal(second.facing, 'right');
  assert.equal(second.offsetX, 0);
  assert.equal(second.turning, false);
  assert.equal(TURN_BEATS, 2);
});

test('进出固定 3 拍：淡出 1/0.5/0 后隐藏，淡入 0/0.5/1', () => {
  const transition = new VillagerTransition();
  assert.deepEqual(transition.sampleVisible(true, 0), { visible: true, alpha: 1, transitioning: false });
  const exit0 = transition.sampleVisible(false, 10);
  assert.equal(exit0.visible, true);
  assert.equal(exit0.alpha, 1);
  assert.equal(exit0.transitioning, true);
  assert.equal(transition.sampleVisible(false, 11).alpha, 0.5);
  const exitDone = transition.sampleVisible(false, 12);
  assert.equal(exitDone.visible, false);
  assert.equal(exitDone.alpha, 1);
  const enter0 = transition.sampleVisible(true, 20);
  assert.equal(enter0.visible, true);
  assert.equal(enter0.alpha, 0);
  assert.equal(transition.sampleVisible(true, 21).alpha, 0.5);
  assert.equal(transition.sampleVisible(true, 22).alpha, 1);
  assert.equal(DOOR_BEATS, 3);
});

test('开关关闭：转身与进出都立即落终态', () => {
  const transition = new VillagerTransition();
  transition.sampleFacing('down', 0);
  transition.sampleVisible(true, 0);
  setAnimationTransitions(false);
  assert.deepEqual(transition.sampleFacing('right', 10), {
    facing: 'right',
    offsetX: 0,
    turning: false,
  });
  assert.deepEqual(transition.sampleVisible(false, 10), {
    visible: false,
    alpha: 1,
    transitioning: false,
  });
  setAnimationTransitions(true);
  assert.equal(animationTransitionsOn(), true);
});

test('打断 5 次：回到原拍，落点与计划一致率 100%', () => {
  const cases = [3, 5, 2, 7, 4];
  let matched = 0;
  for (const loopPhase of cases) {
    // 每一轮用新播放器，避免上一轮相位污染。
    const tracker = new MotionTracker();
    let beat = 0;
    tracker.sample('working', false, beat);
    const intro = MOTION_SEQUENCES.work.intro.length;
    const target = intro + loopPhase;
    while (beat < target) {
      beat += 1;
      tracker.sample('working', false, beat);
    }
    const planned = tracker.current();
    assert.equal(planned?.kind, 'work');
    assert.equal(planned?.phaseBeat, target);
    // 被别的任务打断 3 拍。
    for (let away = 0; away < 3; away += 1) {
      beat += 1;
      tracker.sample('idle', true, beat);
    }
    // 回来干活：直接续到原拍（不重播预备，也不播走路的收步）。
    beat += 1;
    const resumed = tracker.sample('working', false, beat);
    assert.equal(resumed.kind, 'work');
    // 「落点」按画面帧判：续上的循环拍应与打断时同一个帧。
    const loopLength = MOTION_SEQUENCES.work.loop.length;
    const plannedLoop = (target - intro) % loopLength;
    const resumedLoop = ((resumed.phaseBeat - intro) % loopLength + loopLength) % loopLength;
    assert.equal(resumedLoop, plannedLoop);
    assert.equal(resumed.frame, planned?.frame);
    matched += 1;
  }
  assert.equal(matched / cases.length, 1);
});

test('打断超过保鲜期：不续拍，按重新开工重播预备', () => {
  const tracker = new MotionTracker();
  let beat = 0;
  tracker.sample('working', false, beat);
  for (let index = 0; index < 4; index += 1) {
    beat += 1;
    tracker.sample('working', false, beat);
  }
  // 打断超过 48 拍（这里 60 拍），且中间在走路：回来时先收步，再重播预备。
  for (let index = 0; index < 60; index += 1) {
    beat += 1;
    tracker.sample('idle', true, beat);
  }
  for (let index = 0; index < 3; index += 1) {
    beat += 1;
    tracker.sample('working', false, beat);
  }
  const resumed = tracker.current();
  assert.equal(resumed?.kind, 'work');
  assert.equal(resumed?.phaseBeat, 0);
  assert.equal(resumed?.frame, MOTION_SEQUENCES.work.intro[0]);
});

test('冻结帧 0 差异：同一世界拍重复采样逐字段相同', () => {
  const transition = new VillagerTransition();
  const a = transition.sampleFacing('right', 42);
  const b = transition.sampleFacing('right', 42);
  assert.deepEqual(a, b);
  const c = transition.sampleVisible(false, 42);
  const d = transition.sampleVisible(false, 42);
  assert.deepEqual(c, d);
});
