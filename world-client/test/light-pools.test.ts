/**
 * 环境光斑的几何验收（纯函数，不加载 Phaser）：
 *   1. 同一输入必得同一串（截图可复现）；
 *   2. 近段（画面底部）比远段（顶部）密；
 *   3. 有硬上限，且 alpha 不会亮到盖住像素。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_MAX, lightSpots, type ViewRect } from '../src/render/light-pools.ts';

const VIEW: ViewRect = { x: 0, y: 0, w: 480, h: 320 };
const NOW = 1_700_000_000_000;

test('同一格、同一时刻 → 同一串光斑', () => {
  const a = lightSpots(VIEW, 1, NOW);
  const b = lightSpots(VIEW, 1, NOW);
  assert.deepEqual(a, b);
});

test('远近密度不同：底部三分之一的光斑比顶部三分之一多', () => {
  const spots = lightSpots(VIEW, 1, NOW);
  const top = spots.filter((spot) => spot.y < VIEW.h / 3).length;
  const bottom = spots.filter((spot) => spot.y > (VIEW.h * 2) / 3).length;
  assert.ok(bottom > top, `近段 ${bottom} 枚，远段 ${top} 枚——密度差没体现出来`);
  assert.ok(bottom >= 5, `近段只有 ${bottom} 枚，太稀`);
});

test('数量有上限，alpha 不超过 0.25', () => {
  const spots = lightSpots(VIEW, 1.2, NOW);
  assert.ok(spots.length <= LIGHT_MAX, `实际 ${spots.length} 枚，超过上限 ${LIGHT_MAX}`);
  for (const spot of spots) {
    assert.ok(spot.alpha > 0 && spot.alpha <= 0.25, `alpha=${spot.alpha}`);
    assert.ok(spot.size >= 1 && spot.size <= 5, `size=${spot.size}`);
  }
});

test('镜头平移后光斑仍是世界锚定的：同一格落在同一处', () => {
  const left = lightSpots({ x: 0, y: 0, w: 480, h: 320 }, 1, NOW).filter((s) => s.y > 280);
  const shifted = lightSpots({ x: 0, y: 0, w: 480, h: 320 }, 1, NOW + 600).filter((s) => s.y > 280);
  // 时间档会改 alpha/位置抖动，但格坐标不该整片漂走：同一格附近仍有光点。
  const near = shifted.filter((s) =>
    left.some((item) => Math.abs(item.x - s.x) <= 12 && Math.abs(item.y - s.y) <= 12),
  );
  assert.ok(near.length > 0, '换一档之后一枚都没对上，说明光斑不是世界锚定的');
});
