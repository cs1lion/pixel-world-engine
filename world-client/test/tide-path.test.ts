import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid } from '../src/world/grid.ts';
import { tideLevelAt } from '../src/world/tide.ts';

/**
 * 一条草地通道，两边是石板大路。
 *
 * 宽度取 7 格是算过的：直穿 6 格草地 = 6；绕大路 = 上下各 2 格草地 +
 * 6 格石板 = 2 + 3 + 2 = 7。退潮时直穿便宜 1 格，涨潮时（草地 3.4）
 * 直穿 20.4 对绕路 16.6，胜负反过来。取 9 格宽时两者恰好都是 8，
 * A* 走哪条都对，测试就测不出东西了。
 */
function corridor(): WorldGrid {
  return new WorldGrid({
    width: 7,
    height: 5,
    border: 0,
    zones: [
      { id: 'street', x: 0, y: 0, w: 7, h: 1 },
      { id: 'living', x: 0, y: 1, w: 7, h: 3 },
      { id: 'street', x: 0, y: 4, w: 7, h: 1 },
    ],
  });
}

test('退潮时直穿草地', () => {
  const grid = corridor();
  grid.setTideLevel(0);
  const path = grid.path({ x: 0, y: 2 }, { x: 6, y: 2 });
  assert.ok(path.length > 0, '应当走得到');
  assert.ok(path.every((p) => p.y === 2), '退潮时应当直走，实际绕路了');
});

test('涨潮时绕上石板大路', () => {
  const grid = corridor();
  grid.setTideLevel(1);
  const path = grid.path({ x: 0, y: 2 }, { x: 6, y: 2 });
  assert.ok(path.length > 0, '应当仍然走得到——水不是墙');
  assert.ok(path.some((p) => p.y === 0 || p.y === 4), '涨潮时应当绕上大路，实际仍涉水直穿');
});

test('水不阻断通行：满潮时最深处也能走到', () => {
  const grid = corridor();
  grid.setTideLevel(1);
  // 起点终点都在淹掉的草地上。
  const path = grid.path({ x: 1, y: 2 }, { x: 5, y: 2 });
  assert.ok(path.length > 0, '满潮时也要能走过去，否则读档会把人卡死');
});

test('潮位越界被夹紧，不会让整张图变海', () => {
  const grid = corridor();
  grid.setTideLevel(999);
  assert.equal(grid.tideLevelNow(), 1);
  grid.setTideLevel(-5);
  assert.equal(grid.tideLevelNow(), 0);
  grid.setTideLevel(Number.NaN);
  assert.equal(grid.tideLevelNow(), 0);
});

test('潮位确实是 now 的纯函数，能驱动寻路改变', () => {
  const grid = corridor();
  const low = tideLevelAt(0);
  const high = tideLevelAt(6 * 60_000);
  assert.ok(high > low, '六分钟时应当比零分钟时高');
  grid.setTideLevel(low);
  const dry = grid.path({ x: 0, y: 2 }, { x: 6, y: 2 });
  grid.setTideLevel(high);
  const wet = grid.path({ x: 0, y: 2 }, { x: 6, y: 2 });
  assert.notDeepEqual(dry, wet, '潮位变了，路线应当跟着变');
});
