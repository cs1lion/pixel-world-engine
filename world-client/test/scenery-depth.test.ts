import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_PX } from '../src/world/setup.ts';
import { ACTOR_DEPTH_OFFSET } from '../src/render/prop-depth.ts';
import {
  SCENERY_DEPTH_OFFSET,
  actorDepthAtRow,
  sceneryDepth,
  sceneryFootY,
} from '../src/render/scenery-depth.ts';
import { LAMP_STREET_ASSETS } from '../src/settings/dengchao/lamp-street.ts';

const ALTITUDE = 1000;

// ------------------------------------------------- 判据：构件与人物同一把尺子

test('构件偏移落在「上一行的人」与「同一行的人」之间：遮挡方向只有一种', () => {
  assert.ok(
    SCENERY_DEPTH_OFFSET > ACTOR_DEPTH_OFFSET,
    `构件偏移 ${SCENERY_DEPTH_OFFSET} 应大于人物偏移 ${ACTOR_DEPTH_OFFSET}，否则同一行的人会钻到构件后面`,
  );
  assert.ok(
    SCENERY_DEPTH_OFFSET < ACTOR_DEPTH_OFFSET + TILE_PX,
    `构件偏移 ${SCENERY_DEPTH_OFFSET} 应小于 ${ACTOR_DEPTH_OFFSET + TILE_PX}，否则上一行的人会压到构件前面`,
  );
});

test('摊位用例：站在摊位后（上一行）应被遮挡，站在摊位前（同一行）应覆盖', () => {
  // pack.ts 里的 `stall_north_1`：at { x: 17, y: 26 }，cells: 2。
  const stallRow = 26;
  const stall = sceneryDepth(stallRow, ALTITUDE);
  const behind = actorDepthAtRow(stallRow - 1, ALTITUDE);
  const front = actorDepthAtRow(stallRow, ALTITUDE);
  assert.ok(behind < stall, `站在摊位后的人 depth ${behind} 应小于摊位 ${stall}（被挡住）`);
  assert.ok(front > stall, `站在摊位前的人 depth ${front} 应大于摊位 ${stall}（盖住它）`);
});

test('同一行的人比构件高 12px，上一行的人比构件低 4px：两边都不为零', () => {
  const stallRow = 26;
  const stall = sceneryDepth(stallRow, ALTITUDE);
  assert.equal(actorDepthAtRow(stallRow, ALTITUDE) - stall, 12);
  assert.equal(stall - actorDepthAtRow(stallRow - 1, ALTITUDE), 4);
});

test('构件不与楼体同 depth：挂在楼体最后一行的灯串不会靠创建顺序翻到墙前', () => {
  // 楼体 depth = altitude + baseY，baseY 是占地底边；灯串常挂在 baseY 上一行。
  const baseRow = 27; // lamp_lodge 占地底边
  const buildingDepth = ALTITUDE + baseRow * TILE_PX;
  const stringDepth = sceneryDepth(baseRow - 1, ALTITUDE);
  assert.equal(buildingDepth - stringDepth, 4, '灯串应低于楼体 4px，不能相等');
});

test('相邻两行的构件差恰好一格：行序不会翻转', () => {
  for (let row = 0; row < 48; row += 1) {
    assert.equal(sceneryDepth(row + 1, ALTITUDE) - sceneryDepth(row, ALTITUDE), TILE_PX);
  }
});

// ------------------------------------------------- 与真实资产表对齐

test('灯街的每一行都满足前后判据', () => {
  const rows = new Set(
    LAMP_STREET_ASSETS.filter((asset) => asset.kind !== 'paving').map((asset) => asset.at.y),
  );
  for (const row of rows) {
    const prop = sceneryDepth(row, ALTITUDE);
    assert.ok(actorDepthAtRow(row - 1, ALTITUDE) < prop, `第 ${row} 行的构件应挡住上一行的人`);
    assert.ok(actorDepthAtRow(row, ALTITUDE) > prop, `第 ${row} 行的构件应被同一行的人盖住`);
  }
  assert.ok(rows.size >= 6, `灯街至少跨 6 行，实得 ${rows.size}`);
});

test('落地 y 与绘制用的 `item.at.y * TILE_PX` 是同一个式子', () => {
  for (const asset of LAMP_STREET_ASSETS) {
    assert.equal(sceneryFootY(asset.at.y), asset.at.y * TILE_PX);
  }
});
