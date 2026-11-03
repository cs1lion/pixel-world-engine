import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAMP_BODY_BOTTOM,
  LAMP_BODY_H,
  LAMP_POST_TOP,
  SHOPFRONT_BASE_H,
  SHOPFRONT_STONE_H,
  SHOPFRONT_TOP,
  SHOPFRONT_WALL_H,
  settingSceneryMetrics,
} from '../src/render/setting-scale.ts';
import { TILE_PX } from '../src/world/setup.ts';
import { VILLAGER_H } from '../src/render/villager-layout.ts';

// ------------------------------------------------- 判据：立面按设定集比例

test('店面墙 48 = 人 30 的 1.6 倍，落在设定集 p37/p40 的 [1.5, 1.8] 区间', () => {
  const metrics = settingSceneryMetrics();
  const ratio = metrics.shopfrontH / metrics.personH;
  assert.equal(metrics.shopfrontH, 48);
  assert.equal(metrics.personH, VILLAGER_H);
  assert.ok(ratio >= 1.5 && ratio <= 1.8, `墙/人 = ${ratio.toFixed(2)}，应落在 [1.5, 1.8]`);
  assert.equal(ratio, 1.6);
});

test('灯柱 58 = 人 30 的 1.93 倍，灯下的人不顶头', () => {
  const metrics = settingSceneryMetrics();
  assert.equal(metrics.lampPostH, 58);
  assert.ok(metrics.lampPostH / metrics.personH >= 1.8, '灯柱应至少是人高的 1.8 倍');
  assert.equal(metrics.lampBodyBottom, 43);
  // 灯体下沿比人头再高 13px：从灯下走过，灯体压不到头顶。
  assert.equal(metrics.lampBodyBottom - metrics.personH, 13, '灯体下沿应高过头顶 13px');
});

// ------------------------------------------------- 判据：落地线一格不动

test('落地线未动：石脚底边仍是 y+32，与改尺度之前逐像素一致', () => {
  // 墙顶抬高 16px、墙高 44、石脚 4：44 - 16 + 4 = 32。
  assert.equal(SHOPFRONT_TOP, 16);
  assert.equal(SHOPFRONT_WALL_H, 44);
  assert.equal(SHOPFRONT_STONE_H, 4);
  assert.equal(SHOPFRONT_BASE_H, 32);
  // 石脚底边 = y + SHOPFRONT_BASE_H；占地、碰撞格、深度都按这条线算。
  assert.equal(SHOPFRONT_WALL_H - SHOPFRONT_TOP + SHOPFRONT_STONE_H, 32);
});

test('灯柱脚落在瓦片下沿：柱高 58 = 柱顶 42 + 一格 16', () => {
  assert.equal(LAMP_POST_TOP + TILE_PX, 58);
  assert.equal(LAMP_BODY_BOTTOM + TILE_PX, 43, '灯体下沿离地 = 27 + 16');
  assert.equal(LAMP_BODY_BOTTOM + LAMP_BODY_H, 39, '灯体上沿 = 27 + 12');
});

// ------------------------------------------------- 判据：读数与渲染同源

test('metrics 由常量算出，不另抄一份数字', () => {
  const metrics = settingSceneryMetrics();
  assert.equal(metrics.shopfrontTop, SHOPFRONT_TOP);
  assert.equal(metrics.shopfrontH, SHOPFRONT_WALL_H + SHOPFRONT_STONE_H);
  assert.equal(metrics.lampPostH, LAMP_POST_TOP + TILE_PX);
  assert.equal(metrics.lampBodyBottom, LAMP_BODY_BOTTOM + TILE_PX);
  // 灯体没有长到柱顶之上：灯体上沿 39 < 柱顶 42。
  assert.ok(LAMP_BODY_BOTTOM + LAMP_BODY_H < LAMP_POST_TOP);
});
