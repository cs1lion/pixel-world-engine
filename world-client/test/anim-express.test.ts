/** 动画表现力线 · 第一步：关键姿势 / hold / 预备 / 收招。
 *
 * 这些断言只加载纯函数（不引 Phaser），所以能在 node --test 里跑。
 * 判据全部落在世界拍上：同一串 (mode, walking, beat) → 同一串帧号。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_HOLD_BEATS,
  MOTION_INTRO_BEATS,
  MOTION_OUTRO_BEATS,
  MOTION_SEQUENCES,
  MotionTracker,
  motionKindOf,
  villagerMotionPose,
} from '../src/render/villager-frames.ts';

interface BeatRow {
  readonly beat: number;
  readonly frame: number;
  readonly hold: boolean;
  readonly keyPose: boolean;
  readonly kind: string;
}

function drive(
  schedule: readonly (readonly [boolean, boolean])[],
  startBeat = 0,
): BeatRow[] {
  const tracker = new MotionTracker();
  const rows: BeatRow[] = [];
  for (let index = 0; index < schedule.length; index += 1) {
    const [walking, working] = schedule[index] as readonly [boolean, boolean];
    const sample = tracker.sample(working ? 'working' : 'idle', walking, startBeat + index);
    rows.push({
      beat: startBeat + index,
      frame: sample.frame,
      hold: sample.hold,
      keyPose: sample.keyPose,
      kind: sample.kind,
    });
  }
  return rows;
}

const walkThenStop = [
  ...Array.from({ length: 8 }, () => [false, false] as const),
  ...Array.from({ length: 24 }, () => [true, false] as const),
  ...Array.from({ length: 8 }, () => [false, false] as const),
];

test('走路序列：预备 2 拍 → 循环含关键姿势 hold 2 拍 → 收步缓冲 2 拍', () => {
  const rows = drive(walkThenStop);
  // 第 8 拍起步：预备帧 2 连续两拍。
  assert.deepEqual(rows.slice(8, 10).map((row) => row.frame), [2, 2]);
  // 预备之后进入循环段 [0,0,1,2,3]，0 号是关键姿势。
  assert.deepEqual(rows.slice(10, 15).map((row) => row.frame), [0, 0, 1, 2, 3]);
  assert.equal(rows[10]?.keyPose, true);
  assert.equal(rows[11]?.keyPose, true);
  assert.equal(rows[12]?.keyPose, false);
  // 停步：先播上一套动作的收招 [3,2]，再回待机。
  const stopAt = 32;
  assert.deepEqual(rows.slice(stopAt, stopAt + 2).map((row) => row.frame), [3, 2]);
  assert.equal(rows[stopAt + 2]?.kind, 'idle');
  assert.deepEqual(
    [MOTION_INTRO_BEATS, MOTION_HOLD_BEATS, MOTION_OUTRO_BEATS],
    [2, 2, 2],
  );
});

test('干活序列：预备 → 关键姿势停两拍 → 收工缓冲', () => {
  const rows = drive([
    ...Array.from({ length: 4 }, () => [false, false] as const),
    ...Array.from({ length: 12 }, () => [false, true] as const),
    ...Array.from({ length: 6 }, () => [false, false] as const),
  ]);
  assert.deepEqual(rows.slice(4, 6).map((row) => row.frame), [0, 0]);
  assert.deepEqual(rows.slice(6, 9).map((row) => row.frame), [1, 1, 0]);
  assert.equal(rows[6]?.keyPose, true);
  assert.equal(rows[7]?.keyPose, true);
  assert.deepEqual(rows.slice(16, 18).map((row) => row.frame), [0, 1]);
});

test('hold 帧占比在循环里严格大于 0，且关键姿势保持时长可枚举', () => {
  const walkLoop = MOTION_SEQUENCES.walk.loop;
  const workLoop = MOTION_SEQUENCES.work.loop;
  const walkHolds = walkLoop.filter((frame, index) => index > 0 && frame === walkLoop[index - 1]).length;
  const workHolds = workLoop.filter((frame, index) => index > 0 && frame === workLoop[index - 1]).length;
  assert.ok(walkHolds / walkLoop.length > 0, '走路循环必须有 hold');
  assert.ok(workHolds / workLoop.length > 0, '干活循环必须有 hold');
  assert.equal(MOTION_SEQUENCES.walk.keyHoldBeats, 2);
  assert.equal(MOTION_SEQUENCES.work.keyHoldBeats, 2);
});

test('同种子两跑：同一串快照逐拍逐字相同', () => {
  const a = JSON.stringify(drive(walkThenStop));
  const b = JSON.stringify(drive(walkThenStop));
  assert.equal(a, b);
  // 换一个起点也要自洽：世界拍平移不改变序列形状。
  const shifted = drive(walkThenStop, 1000);
  assert.equal(
    JSON.stringify(shifted.map((row) => [row.frame, row.hold, row.keyPose, row.kind])),
    JSON.stringify(drive(walkThenStop).map((row) => [row.frame, row.hold, row.keyPose, row.kind])),
  );
});

test('冻结帧：同一世界拍重复采样 0 差异', () => {
  const tracker = new MotionTracker();
  const first = tracker.sample('idle', true, 40);
  const second = tracker.sample('idle', true, 40);
  assert.deepEqual(first, second);
  // 渲染两次用同一个 pose，矩形序列也必须一字不差。
  const poseA = villagerMotionPose('idle', true, 40 * (1000 / 12), tracker);
  const poseB = villagerMotionPose('idle', true, 40 * (1000 / 12), tracker);
  assert.deepEqual(poseA, poseB);
});

test('判据与旧实现同源：走路看 path，干活看 mode', () => {
  assert.equal(motionKindOf('idle', true), 'walk');
  assert.equal(motionKindOf('working', true), 'walk');
  assert.equal(motionKindOf('working', false), 'work');
  assert.equal(motionKindOf('saluting', false), 'idle');
  assert.equal(motionKindOf('toWork', false), 'idle');
});
