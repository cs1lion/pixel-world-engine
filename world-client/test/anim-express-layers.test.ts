/** 动画表现力线 · 第三步：上下半身分层 + 表情覆盖层。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  faceBox,
  villagerLayeredLayout,
  villagerLayout,
} from '../src/render/villager-layout.ts';
import { emotionOf, expressionRects, isTalking, type EmotionId } from '../src/render/villager-face.ts';
import { LEGACY_LOOKS } from '../src/world/villager-look.ts';
import {
  FRAME_MS,
  MotionTracker,
  villagerMotionPose,
  type VillagerPose,
} from '../src/render/villager-frames.ts';

const POSE_IDLE: VillagerPose = { frame: 0, frameCount: 2, offsetY: 0, footLeft: 0, footRight: 0 };
const POSE_LIFT: VillagerPose = { frame: 1, frameCount: 2, offsetY: 1, footLeft: 1, footRight: -1 };

const FACINGS = ['down', 'right', 'up', 'left'] as const;

test('分层画序与整帧版逐项相同：两套姿态一致时矩形序列一字不差', () => {
  let checked = 0;
  for (const look of LEGACY_LOOKS) {
    for (const facing of FACINGS) {
      for (const pose of [POSE_IDLE, POSE_LIFT]) {
        for (const walking of [false, true]) {
          const flat = villagerLayout(look, facing, pose, walking, 'idle', 4242);
          const layers = villagerLayeredLayout(look, facing, pose, pose, walking, 'idle', 4242);
          const stitched = [...layers.cloth, ...layers.legs, ...layers.detail];
          assert.deepEqual(stitched, flat);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, LEGACY_LOOKS.length * FACINGS.length * 2 * 2);
});

test('上下半身各自播自己的序列：走路时腿走 5 拍循环，上身走 2 拍循环', () => {
  const lowerTracker = new MotionTracker();
  const upperTracker = new MotionTracker();
  const lower: number[] = [];
  const upper: number[] = [];
  for (let beat = 0; beat < 10; beat += 1) {
    const now = beat * FRAME_MS + FRAME_MS / 2;
    lower.push(villagerMotionPose('idle', true, now, lowerTracker).frame);
    upper.push(villagerMotionPose('idle', false, now, upperTracker).frame);
  }
  // 腿：预备两拍后进入 [0,0,1,2,3]；上身：待机 [0,1]。两条序列不同。
  assert.deepEqual(lower, [2, 2, 0, 0, 1, 2, 3, 0, 0, 1]);
  assert.deepEqual(upper, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  assert.notDeepEqual(lower, upper);
});

test('表情只有 1–2px 的 cell，且全部落在脸框内', () => {
  const emotions: readonly EmotionId[] = ['calm', 'joy', 'focus', 'weary', 'worry'];
  for (const look of LEGACY_LOOKS) {
    for (const facing of ['down', 'right', 'left'] as const) {
      const box = faceBox(look, facing);
      assert.notEqual(box, null);
      if (box === null) continue;
      for (const emotion of emotions) {
        for (const beat of [0, 1]) {
          const cells = expressionRects(look, facing, emotion, beat, true);
          for (const cell of cells) {
            assert.ok(cell.w <= 2 && cell.h <= 2, `cell ${cell.w}x${cell.h} 超过 2px`);
            assert.ok(cell.x >= box.x && cell.x + cell.w <= box.x + box.w, '水平越出脸框');
            assert.ok(cell.y >= box.y && cell.y + cell.h <= box.y + box.h, '垂直越出脸框');
          }
        }
      }
    }
  }
});

test('只换脸：身体区域 sha256 逐字节不变，脸框内确实变了', () => {
  const look = LEGACY_LOOKS[1] as (typeof LEGACY_LOOKS)[number];
  const facing = 'down' as const;
  const box = faceBox(look, facing);
  assert.notEqual(box, null);
  if (box === null) return;

  const body = villagerLayeredLayout(look, facing, POSE_IDLE, POSE_IDLE, false, 'idle', 4242);
  const bodyRects = [...body.cloth, ...body.legs, ...body.detail];
  const rasterOf = (emotion: EmotionId): Map<string, number> => {
    const grid = new Map<string, number>();
    let code = 1;
    const paints = new Map<string, number>();
    for (const rect of bodyRects) {
      const paintCode = paints.get(rect.paint) ?? code++;
      paints.set(rect.paint, paintCode);
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        for (let x = rect.x; x < rect.x + rect.w; x += 1) grid.set(`${x},${y}`, paintCode);
      }
    }
    for (const rect of expressionRects(look, facing, emotion, 0, isTalking('说话'))) {
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        for (let x = rect.x; x < rect.x + rect.w; x += 1) grid.set(`${x},${y}`, 99);
      }
    }
    return grid;
  };

  const hashOutsideFace = (grid: Map<string, number>): string => {
    const keys = [...grid.keys()].sort();
    const cells: string[] = [];
    for (const key of keys) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const inFace = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      if (!inFace) cells.push(`${key}:${grid.get(key)}`);
    }
    return createHash('sha256').update(cells.join('|'), 'utf8').digest('hex');
  };

  const calm = rasterOf('calm');
  const joy = rasterOf('joy');
  assert.equal(hashOutsideFace(calm), hashOutsideFace(joy), '脸框外必须逐字节不变');
  const hashAll = (grid: Map<string, number>): string =>
    createHash('sha256')
      .update([...grid.keys()].sort().map((key) => `${key}:${grid.get(key)}`).join('|'), 'utf8')
      .digest('hex');
  assert.notEqual(hashAll(calm), hashAll(joy), '只换情绪时脸必须真的换了');
});

test('情绪映射只认世界已有事实：mode / bubble', () => {
  assert.equal(emotionOf('working', null), 'focus');
  assert.equal(emotionOf('delivering', null), 'joy');
  assert.equal(emotionOf('bearingDecree', null), 'worry');
  assert.equal(emotionOf('idle', '…'), 'joy');
  assert.equal(emotionOf('idle', null), 'calm');
  assert.equal(isTalking('…'), true);
  assert.equal(isTalking(null), false);
});
