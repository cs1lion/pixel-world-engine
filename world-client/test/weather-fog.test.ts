import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WEATHER_FOG_PUFFS,
  WEATHER_FOG_RADII,
  weatherFogPuffs,
} from '../src/world/weather-fog.ts';

/**
 * 天气雾的雾团**必须真的在图内**。
 *
 * 审计的那句「14 团漂移全在 authored 图外」说的是探索迷雾：它的团沿揭示半径
 * 绕圈，整张图已揭示时半径就是图的对角线，圆心天然在图外。这一组测的是另一套
 * ——天气雾：团数固定、圆心从种子抽、坐标夹在边界内，且 10 秒后位移可测。
 */

const GRID = { width: 64, height: 48 } as const;

test('雾团数固定，全部圆心在图内', () => {
  const puffs = weatherFogPuffs('dengchao', GRID, 0);
  assert.equal(puffs.length, WEATHER_FOG_PUFFS);
  for (const puff of puffs) {
    assert.ok(puff.at.x > 0 && puff.at.x < GRID.width, `圆心 x 出图：${puff.at.x}`);
    assert.ok(puff.at.y > 0 && puff.at.y < GRID.height, `圆心 y 出图：${puff.at.y}`);
    // 半径也整枚在图内：圆心距边至少一个半径，画出来不会被裁成半团。
    assert.ok(puff.at.x - puff.radius >= 0, '雾团左边被图边裁掉');
    assert.ok(puff.at.y - puff.radius >= 0, '雾团上边被图边裁掉');
    assert.ok(puff.at.x + puff.radius <= GRID.width, '雾团右边被图边裁掉');
    assert.ok(puff.at.y + puff.radius <= GRID.height, '雾团下边被图边裁掉');
    assert.ok(WEATHER_FOG_RADII.includes(puff.radius as (typeof WEATHER_FOG_RADII)[number]));
  }
});

test('同一种子、同一时刻，两次取到的雾团逐项相同', () => {
  assert.deepEqual(weatherFogPuffs('dengchao', GRID, 12_000), weatherFogPuffs('dengchao', GRID, 12_000));
});

test('换种子，雾团位置整组不同', () => {
  const a = weatherFogPuffs('seed-a', GRID, 0);
  const b = weatherFogPuffs('seed-b', GRID, 0);
  assert.notDeepEqual(a, b);
});

test('10 秒后漂移可测：每团都动，至少 14 团走过半格', () => {
  const before = weatherFogPuffs('dengchao', GRID, 0);
  const after = weatherFogPuffs('dengchao', GRID, 10_000);
  let moved = 0;
  let movedHalfCell = 0;
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i]!;
    const b = after[i]!;
    const distance = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y);
    if (distance > 0.1) moved += 1;
    if (distance > 0.5) movedHalfCell += 1;
  }
  assert.equal(moved, before.length, '有雾团 10 秒一步没挪');
  assert.ok(movedHalfCell >= 14, `只 ${movedHalfCell} 团走过半格，漂移太小看不出来`);
});

test('雾团始终在图内：取 0..120 秒的每个采样都不出界', () => {
  for (let t = 0; t <= 120_000; t += 10_000) {
    for (const puff of weatherFogPuffs('dengchao', GRID, t)) {
      assert.ok(puff.at.x - puff.radius >= 0 && puff.at.x + puff.radius <= GRID.width);
      assert.ok(puff.at.y - puff.radius >= 0 && puff.at.y + puff.radius <= GRID.height);
    }
  }
});
