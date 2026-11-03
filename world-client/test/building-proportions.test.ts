/**
 * 门洞随角色放大后的比例与锚点（纯算术，不加载 Phaser）。
 *
 * 验收口径：
 *   1. 门高 ≈ 角色高的 90%（27/30），门宽 ≥ 角色宽的 85%（22/24）；
 *   2. 门底与墙底对齐（`doorRect` 的底边 = wallH，墙覆盖 0..wallH-1）；
 *   3. 门是贴图，不碰碰撞/寻路——档位常量只在这里，`building.door` 仍是那个格。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_PX } from '../src/world/setup.ts';
import { VILLAGER_H, VILLAGER_W } from '../src/render/villager-layout.ts';
import { DOOR, LEGACY_DOOR, doorBottomAligned, doorRect } from '../src/render/building-proportions.ts';

test('门高 ≈ 角色高的 90%，门宽 ≥ 角色宽的 85%', () => {
  assert.equal(VILLAGER_H, 30, '角色高度变了，门的比例要重算');
  assert.equal(VILLAGER_W, 24);
  const heightRatio = DOOR.h / VILLAGER_H;
  assert.ok(heightRatio >= 0.85 && heightRatio <= 0.95, `门高/角色高 = ${heightRatio.toFixed(2)}`);
  assert.ok(DOOR.w / VILLAGER_W >= 0.85, `门宽/角色宽 = ${(DOOR.w / VILLAGER_W).toFixed(2)}`);
  // 与 48px 档旧测算（门 86 / 角色 96 ≈ 0.90）同一条比例。
  assert.ok(Math.abs(heightRatio - 86 / 96) < 0.05, '应与 48px 档的门/人比例同一档');
});

test('门底与墙底对齐：最矮的 3 格楼也成立', () => {
  for (const cells of [3, 4, 6]) {
    const wallH = cells * TILE_PX;
    const rect = doorRect(0, wallH);
    assert.equal(rect.y + rect.h, wallH, `${cells} 格楼：门底必须落在墙底`);
    assert.ok(rect.y >= 0, `${cells} 格楼：门顶不能越过墙上沿`);
    assert.ok(doorBottomAligned(0, wallH), `${cells} 格楼：doorBottomAligned`);
  }
});

test('门洞不宽过最窄的楼：3 格宽也能放下 22px', () => {
  const narrowWall = 3 * TILE_PX;
  assert.ok(DOOR.w <= narrowWall, `门宽 ${DOOR.w} 超过 3 格宽 ${narrowWall}`);
  // 门框外沿（半宽 +1）也要落在墙内。
  assert.ok(DOOR.frameHalf + 1 <= narrowWall / 2, '门框外沿超出 3 格墙的一半');
});

test('旧门 14×18 保留为样板阶段常量，不与新门混用', () => {
  assert.equal(LEGACY_DOOR.w, 14);
  assert.equal(LEGACY_DOOR.h, 18);
  assert.ok(LEGACY_DOOR.h < DOOR.h && LEGACY_DOOR.w < DOOR.w);
});
