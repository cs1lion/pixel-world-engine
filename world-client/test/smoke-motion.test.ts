import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SMOKE_MOTION_OFF,
  SMOKE_MOTION_ON,
  smokePuffsAt,
  smokePuffsStill,
  smokeSegmentStepMs,
} from '../src/world/smoke-motion.ts';

const MIN = 60_000;

test('三段烟：一段比一段高、一段比一段宽、一段比一段淡', () => {
  const puffs = smokePuffsAt(18 * 60 * MIN + 20_000, 0);
  assert.equal(puffs.length, 3);
  const p0 = puffs[0]!;
  const p1 = puffs[1]!;
  const p2 = puffs[2]!;
  assert.ok(p2.dy < p1.dy && p1.dy < p0.dy, '越往上离烟囱口越远');
  assert.ok(p2.width > p1.width && p1.width > p0.width, '越往上摊得越宽');
  assert.ok(p1.alpha < p0.alpha && p2.alpha < p1.alpha, '越往上越淡（消散）');
  for (const puff of puffs) {
    assert.ok(puff.dy < 0, '烟只往上，不会落回烟囱口');
    assert.ok(puff.dx >= 0, '横漂只朝东，不往墙里钻');
  }
});

test('三段速度不同：15 / 10 / 7 世界秒一拍，同一窗口里走得快慢分明', () => {
  assert.equal(smokeSegmentStepMs(0), 15_000);
  assert.equal(smokeSegmentStepMs(1), 10_000);
  assert.equal(smokeSegmentStepMs(2), 7_000);
  const start = 18 * 60 * MIN + 20_000;
  // 一分钟里各段都挪过不止一个位置（拍数：15s→4、10s→6、7s→8，越短越勤）。
  const seen = [new Set<number>(), new Set<number>(), new Set<number>()];
  for (let t = 0; t <= 60_000; t += 1000) {
    smokePuffsAt(start + t, 0).forEach((puff, i) => seen[i]!.add(puff.dx));
  }
  for (const [i, values] of seen.entries()) {
    assert.ok(values.size >= 2, `第 ${i + 1} 段一分钟里没有挪过位置`);
  }
});

test('漂移有边界：横移不超段落上限，宽度最多 +1px', () => {
  for (let i = 0; i < 60; i += 1) {
    for (const puff of smokePuffsAt(i * 3000, 2)) {
      assert.ok(puff.dx >= 0 && puff.dx <= 6);
      assert.ok(puff.width >= 6 && puff.width <= 15);
      assert.ok(puff.alpha > 0 && puff.alpha <= 0.16);
    }
  }
});

test('同一世界时刻必然同一帧；关掉时是固定姿态', () => {
  const a = smokePuffsAt(18 * 60 * MIN + 40_000, 1);
  const b = smokePuffsAt(18 * 60 * MIN + 40_000, 1);
  assert.deepEqual(a, b);
  const still = smokePuffsStill();
  assert.equal(still.length, 3);
  for (const puff of still) assert.equal(puff.dx, 0);
  assert.deepEqual(SMOKE_MOTION_ON, { drift: true });
  assert.deepEqual(SMOKE_MOTION_OFF, { drift: false });
});
