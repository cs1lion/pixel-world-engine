import { test } from 'node:test';
import assert from 'node:assert/strict';

import { villagerAtCell, type VillagerSnapshot } from '../src/world/types.ts';

/**
 * 点人的落点判据。
 *
 * 这一条是补一个真出过的错：原来写的是 `villager.pos.x === x`，而 `pos` 在她
 * 走路时是分数（实测 `27.3`）。于是**站着的人点得到、走着的人永远点不到**——
 * 而世界大部分时间都在走，屏幕上就是「点她没反应，顺手洗了脚边那盏灯」。
 * 下面第二条钉的就是那个形态：分数坐标必须落在 `floor` 那一格上。
 */

function villager(patch: Partial<VillagerSnapshot> = {}): VillagerSnapshot {
  return {
    id: 'v1',
    name: '汐',
    mode: 'idle',
    pos: { x: 23, y: 29 },
    walking: false,
    facing: 'down',
    visible: true,
    taskId: null,
    bubble: null,
    routine: null,
    umbrella: false,
    carrying: null,
    lampOil: 1,
    nameState: 'held',
    carries: [],
    ...patch,
  };
}

test('站在整格上：点那一格就中', () => {
  const hit = villagerAtCell([villager()], 23, 29);
  assert.equal(hit?.id, 'v1');
});

test('走在半路上：她脚下那一格仍然点得中——这是回归的那一条', () => {
  // 实测坐标：走路时 `pos` 是 `27.3` / `32`，指针算出来永远是整数格号。
  const walking = villager({ pos: { x: 27.3, y: 32 }, walking: true });
  assert.equal(villagerAtCell([walking], 27, 32)?.id, 'v1', 'floor(27.3) = 27，她就在这一格');
  assert.equal(villagerAtCell([walking], 28, 32), null, '还没走到下一格，点下一格不该中');
  assert.equal(villagerAtCell([walking], 27, 33), null);
});

test('不在画面上的人点不到', () => {
  assert.equal(villagerAtCell([villager({ visible: false })], 23, 29), null);
});

test('空格子是 null，不是最近的那个人', () => {
  assert.equal(villagerAtCell([villager()], 0, 0), null);
  assert.equal(villagerAtCell([], 23, 29), null);
});

test('同一格上有两个人：给名单里排在前面的那个，顺序可复现', () => {
  const first = villager({ id: 'v1' });
  const second = villager({ id: 'v2', pos: { x: 23.2, y: 29.1 } });
  assert.equal(villagerAtCell([first, second], 23, 29)?.id, 'v1');
  assert.equal(villagerAtCell([second, first], 23, 29)?.id, 'v2');
});
