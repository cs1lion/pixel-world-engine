/**
 * 第四轮「动起来」的验收：
 *   - 行走 4 帧 / 待机 2 帧都必须真的在动（structural 帧差达标），不是整体位移；
 *   - 帧序只由步进计数决定，同一输入两次采样逐格相同；
 *   - 手持物（水桶、灯杖）按 2 帧周期摆动；
 *   - 每一帧相对静止母本的行宽变化 ≤ 1px，且跨人 30 组、同人三向判据在每一帧都仍然成立。
 *
 * 帧差用 structural 口径（减掉姿态里那 1px 整体上下浮），否则「整体位移」会被算成动作。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { loadSettingPack } from '../src/settings/load.ts';
import { resolveLook, type VillagerLook } from '../src/world/villager-look.ts';
import { VILLAGER_H, VILLAGER_W } from '../src/render/villager-layout.ts';
import {
  CAST_MOTION_FRAMES,
  CAST_MOTION_VIEWS,
  castFrameMask,
  castFramePixels,
  castFramePose,
  castFrameRects,
  framePixelDiff,
  maxRowWidthDelta,
} from '../src/render/cast-motion.ts';
import { silhouetteSimilarity } from '../src/render/silhouette-match.ts';

const MAIN = ['迷路人', '汐', '炉匠', '沉灯夫人', '灯笼头'] as const;
/** 行走相邻帧的 structural 帧差下限：实测最小 17（迷路人 侧面）。 */
const MIN_WALK_FRAME_DIFF = 16;
/** 待机两帧的 structural 帧差下限：实测最小 10（炉匠 背面）。 */
const MIN_IDLE_FRAME_DIFF = 8;
/** 每帧相对母本的单行宽度变化上限。 */
const MAX_ROW_WIDTH_DELTA = 1;
/** 跨人合成相似度上限（与 cast-artbook.test.ts 的 0.78 残余要求一致；0.85 的硬阈值不动）。 */
const MAX_PAIR_SIMILARITY = 0.78;
const SAME_PERSON_MIN = 0.6;
const SAME_PERSON_MAX = 0.9;
const pack = loadSettingPack(DENGCHAO_RAW);

const looks: readonly { name: string; look: VillagerLook }[] = MAIN.map((name) => {
  const villager = pack.villagers.find((item) => item.name === name);
  assert.ok(villager !== undefined, `缺少主要人物 ${name}`);
  return { name, look: resolveLook(villager.style) };
});

const FRAME_TAGS = [
  { tag: 'idle0', walking: false, index: 0 },
  { tag: 'idle1', walking: false, index: 1 },
  { tag: 'walk0', walking: true, index: 0 },
  { tag: 'walk1', walking: true, index: 1 },
  { tag: 'walk2', walking: true, index: 2 },
  { tag: 'walk3', walking: true, index: 3 },
] as const;

/** 指定行区间里最右/最左的格子列；用来量道具摆幅。 */
function columnRange(pixels: ReadonlyMap<string, string>, y0: number, y1: number): { left: number; right: number } {
  let left = -1;
  let right = -1;
  for (const key of pixels.keys()) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    if (y < y0 || y > y1) continue;
    if (left === -1 || x < left) left = x;
    if (x > right) right = x;
  }
  return { left, right };
}

test('行走 4 帧、待机 2 帧的帧数来自同一套帧常量', () => {
  assert.equal(CAST_MOTION_FRAMES.walk, 4);
  assert.equal(CAST_MOTION_FRAMES.idle, 2);
  assert.deepEqual([...CAST_MOTION_VIEWS], ['down', 'right', 'up']);
});

test('帧序按步进计数决定：同一输入两次采样逐格相同', () => {
  for (const { look } of looks) {
    for (const facing of CAST_MOTION_VIEWS) {
      for (const walking of [false, true]) {
        const count = walking ? CAST_MOTION_FRAMES.walk : CAST_MOTION_FRAMES.idle;
        for (let index = 0; index < count; index += 1) {
          assert.equal(castFramePose(walking, index).frame, index, `${facing} 第 ${index} 帧的姿态帧号不稳定`);
          assert.deepEqual(
            castFrameRects(look, facing, walking, index),
            castFrameRects(look, facing, walking, index),
            `${facing}/${walking ? 'walk' : 'idle'}#${index} 两次采样不一致`,
          );
        }
      }
    }
  }
});

test('行走 4 帧：脚部交替 + 身体 1px 上下浮，且相邻帧 structural 帧差 ≥ 16', () => {
  const feet = looks.map(({ name }) => {
    const offsets = [0, 1, 2, 3].map((index) => {
      const pose = castFramePose(true, index);
      return `${pose.footLeft}/${pose.footRight}`;
    });
    assert.ok(new Set(offsets).size >= 2, `${name} 的脚没有交替：${offsets.join(' ')}`);
    return name;
  });
  assert.equal(feet.length, looks.length);
  for (const { name, look } of looks) {
    for (const facing of CAST_MOTION_VIEWS) {
      const lifts = [0, 1, 2, 3].map((index) => castFramePose(true, index).offsetY);
      assert.ok(lifts.includes(1) && lifts.includes(0), `${name} ${facing} 没有 1px 上下浮：${lifts.join('')}`);
      for (let index = 0; index < CAST_MOTION_FRAMES.walk - 1; index += 1) {
        const diff = framePixelDiff(
          castFramePixels(look, facing, true, index),
          castFramePixels(look, facing, true, index + 1),
        );
        assert.ok(diff >= MIN_WALK_FRAME_DIFF, `${name} ${facing} walk${index}→${index + 1} 只差 ${diff} 格`);
      }
      const far = framePixelDiff(
        castFramePixels(look, facing, true, 0),
        castFramePixels(look, facing, true, 2),
      );
      assert.ok(far >= MIN_WALK_FRAME_DIFF, `${name} ${facing} walk0→walk2 只差 ${far} 格，步子没交替`);
    }
  }
});

test('待机 2 帧：structural 帧差 ≥ 8，不是整体位移', () => {
  for (const { name, look } of looks) {
    for (const facing of CAST_MOTION_VIEWS) {
      const diff = framePixelDiff(
        castFramePixels(look, facing, false, 0),
        castFramePixels(look, facing, false, 1),
      );
      assert.ok(diff >= MIN_IDLE_FRAME_DIFF, `${name} ${facing} 待机两帧只差 ${diff} 格`);
    }
  }
});

test('手持物按 2 帧周期摆动：水桶收 1px、灯杖内收 1px', () => {
  const bucket = looks.find((item) => item.name === '迷路人')!.look;
  const staff = looks.find((item) => item.name === '灯笼头')!.look;
  // 水桶在胴体下方右侧（gy 21–25）；待机第 2 帧桶沿右缘内收 1px。
  const down0 = castFramePixels(bucket, 'down', false, 0);
  const down1 = castFramePixels(bucket, 'down', false, 1);
  const y0 = 21;
  const y1 = 25;
  const right0 = columnRange(down0, y0, y1).right;
  const right1 = columnRange(down1, y0, y1).right;
  assert.equal(right0 - right1, 1, `迷路人水桶待机摆幅不是 1px：${right0}→${right1}`);
  // 灯杖是右侧竖杆（gy 5–28）；待机第 2 帧内收 1px。
  const staff0 = castFramePixels(staff, 'right', false, 0);
  const staff1 = castFramePixels(staff, 'right', false, 1);
  const rightStaff0 = columnRange(staff0, 22, 28).right;
  const rightStaff1 = columnRange(staff1, 22, 28).right;
  assert.ok(rightStaff1 < rightStaff0, `灯笼头灯杖待机没摆动：${rightStaff0}→${rightStaff1}`);
});

test('每一帧相对静止母本的行宽变化 ≤ 1px', () => {
  for (const { name, look } of looks) {
    for (const facing of CAST_MOTION_VIEWS) {
      const base = castFrameMask(look, facing, false, 0);
      for (const { tag, walking, index } of FRAME_TAGS) {
        const frame = castFrameMask(look, facing, walking, index);
        const delta = maxRowWidthDelta(base, frame);
        assert.ok(
          delta.delta <= MAX_ROW_WIDTH_DELTA,
          `${name} ${facing} ${tag} 第 ${delta.row} 行宽变化 ${delta.delta}px`,
        );
      }
    }
  }
});

test('动画帧复测：同帧跨人 30 组 ≤ 0.78，同人三向 ∈ [0.60, 0.90]', () => {
  let worst = { similarity: -1, a: '', b: '', facing: '', tag: '' };
  for (const { tag, walking, index } of FRAME_TAGS) {
    for (const facing of CAST_MOTION_VIEWS) {
      for (let i = 0; i < looks.length; i += 1) {
        for (let j = i + 1; j < looks.length; j += 1) {
          const sim = silhouetteSimilarity(
            castFrameMask(looks[i]!.look, facing, walking, index),
            castFrameMask(looks[j]!.look, facing, walking, index),
          );
          if (sim > worst.similarity) {
            worst = { similarity: sim, a: looks[i]!.name, b: looks[j]!.name, facing, tag };
          }
          assert.ok(
            sim <= MAX_PAIR_SIMILARITY,
            `${tag} ${facing} ${looks[i]!.name}/${looks[j]!.name} 相似度 ${sim.toFixed(3)} > ${MAX_PAIR_SIMILARITY}`,
          );
        }
      }
      for (const { name, look } of looks) {
        const masks = new Map(
          CAST_MOTION_VIEWS.map((view) => [view, castFrameMask(look, view, walking, index)]),
        );
        for (const [a, b] of [['down', 'right'], ['down', 'up'], ['right', 'up']] as const) {
          const sim = silhouetteSimilarity(masks.get(a)!, masks.get(b)!);
          assert.ok(
            sim >= SAME_PERSON_MIN && sim <= SAME_PERSON_MAX,
            `${tag} ${name} ${a}/${b} 同人相似度 ${sim.toFixed(3)} 越界`,
          );
        }
      }
    }
  }
  assert.ok(worst.similarity <= MAX_PAIR_SIMILARITY);
});

/** 像素集合的包围盒：上下沿 + 左右列，用来证明「每帧尺寸/锚点一致，不跳一下」。 */
function boundsOf(pixels: ReadonlyMap<string, string>): { top: number; bottom: number; left: number; right: number } {
  const box = { top: Infinity, bottom: -1, left: Infinity, right: -1 };
  for (const key of pixels.keys()) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    if (y < box.top) box.top = y;
    if (y > box.bottom) box.bottom = y;
    if (x < box.left) box.left = x;
    if (x > box.right) box.right = x;
  }
  return box;
}

test('每帧尺寸/锚点一致：上下沿不动，左右最多让 1px，画布仍是 24×30', () => {
  for (const { name, look } of looks) {
    for (const facing of CAST_MOTION_VIEWS) {
      const base = boundsOf(castFramePixels(look, facing, false, 0));
      for (const { tag, walking, index } of FRAME_TAGS) {
        const box = boundsOf(castFramePixels(look, facing, walking, index));
        assert.equal(box.top, base.top, `${name} ${facing} ${tag} 顶边上移，角色跳了`);
        assert.equal(box.bottom, base.bottom, `${name} ${facing} ${tag} 底边移动，锚点跳了`);
        assert.ok(Math.abs(box.left - base.left) <= 1, `${name} ${facing} ${tag} 左沿移动超过 1px`);
        assert.ok(Math.abs(box.right - base.right) <= 1, `${name} ${facing} ${tag} 右沿移动超过 1px`);
        assert.ok(box.left >= 0 && box.right < VILLAGER_W, `${name} ${facing} ${tag} 超出 24px 画布`);
        assert.ok(box.top >= 0 && box.bottom < VILLAGER_H, `${name} ${facing} ${tag} 超出 30px 画布`);
      }
    }
  }
});
