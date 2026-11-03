/**
 * 24×30 的跨格悬垂：深度仍按**脚底那一格**算，验收四条：
 *
 *   1. 站在门口格：前檐（front）压人，但再下一格不受压；
 *   2. 站在楼后（footprint 上一行）：楼体（body）压人；
 *   3. 站在树后（道具上一行）：道具压人；
 *   4. 水平最宽 21px ≤ 全图最窄的横向可走通道 2 格（32px），
 *      「窄走廊必破相」在这两张图的实际几何下不成立。
 *
 * 命中仍按整格（`villagerAtCell`），不由贴图尺寸决定——见 `villager-hit.test.ts`。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_PX } from '../src/world/setup.ts';
import {
  ACTOR_DEPTH_OFFSET,
  actorDepthAt,
  buildingBaseY,
  layerDepth,
} from '../src/render/building-depth.ts';
import { propDepth } from '../src/render/prop-depth.ts';
import type { WorldProp } from '../src/world/types.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { loadSettingPack } from '../src/settings/load.ts';
import { resolveLook } from '../src/world/villager-look.ts';
import { silhouetteOf } from '../src/render/villager-layout.ts';

const ALT = 1000;

/** 与 `villager.ts` 同一个算式：py = (pos.y + 1) * TILE_PX，depth = ALT + py + 8。 */
const villagerDepth = (gridY: number): number => ALT + (gridY + 1) * TILE_PX + ACTOR_DEPTH_OFFSET;

test('脚底锚点不变：depth 只看 pos.y，不看 30px 的高度', () => {
  assert.equal(ACTOR_DEPTH_OFFSET, 8);
  for (const y of [0, 9, 26, 29, 50]) {
    assert.equal(villagerDepth(y), actorDepthAt(y, ALT));
  }
});

test('站在门口格：前檐压人；再下一格不受前檐影响', () => {
  // 4 格高的楼：footprint 26..29? 取一组具体值即可，公式与楼实例无关。
  const originY = 20;
  const footprintH = 4;
  const baseY = buildingBaseY(originY * TILE_PX, footprintH);
  const doorY = originY + footprintH; // 门口格 = 占地底边下一行
  const body = layerDepth('body', baseY, ALT);
  const front = layerDepth('front', baseY, ALT);
  const atDoor = villagerDepth(doorY);
  const belowDoor = villagerDepth(doorY + 1);
  assert.ok(body < atDoor, '楼体必须在站门口的人之后');
  assert.ok(front > atDoor, '前檐必须压住站门口的人');
  assert.ok(front < belowDoor, '前檐不能压到门口下 1 格的人');
});

test('站在楼后（footprint 上一行）：楼体压人', () => {
  const originY = 20;
  const footprintH = 4;
  const baseY = buildingBaseY(originY * TILE_PX, footprintH);
  const body = layerDepth('body', baseY, ALT);
  const behind = villagerDepth(originY - 1);
  assert.ok(body > behind, `楼后角色 depth=${behind} 必须低于楼体=${body}`);
  // 但站在楼前（门口）时反过来：人在楼体之后。
  assert.ok(body < villagerDepth(originY + footprintH));
});

test('站在树后（道具上一行）：道具压人', () => {
  const prop: WorldProp = {
    id: 'tree#1',
    kind: 'tree',
    at: { x: 10, y: 26 },
    label: '树',
    sourceTaskKind: null,
    sourceTaskId: null,
    sourceSummary: null,
    grime: 0,
    reveal: null,
  };
  const treeDepth = propDepth(prop, 0, ALT);
  assert.ok(treeDepth > villagerDepth(25), '道具应压住上一格的角色');
  assert.ok(treeDepth < villagerDepth(26), '同格角色应在道具前');
});

test('水平最宽 ≤ 最窄横向通道（2 格 = 32px）——窄走廊不必然破相', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const widths = pack.villagers.map((villager) => silhouetteOf(resolveLook(villager.style)).bboxW);
  const widest = Math.max(...widths);
  // 实测：灯潮界最窄的横向可走通道是 2 格（41,34 那一行）；莞尔镇是 5 格。
  assert.ok(widest <= 2 * TILE_PX, `最宽剪影 ${widest}px 超过 2 格 ${2 * TILE_PX}px`);
});
