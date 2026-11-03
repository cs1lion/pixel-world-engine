import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinVillagers } from '../src/render/villager-pin.ts';
import type { WorldSnapshot, VillagerSnapshot } from '../src/world/types.ts';

function villager(id: string, x: number, y: number, visible = true): VillagerSnapshot {
  return {
    id,
    name: id,
    pos: { x, y },
    visible,
    heading: 'south',
    style: 'slim',
    bubble: null,
  } as unknown as VillagerSnapshot;
}

function snapshot(): WorldSnapshot {
  const first = villager('v0', 10, 5);
  return {
    villagers: [first, villager('v1', 20, 7, false)],
    villager: first,
  } as unknown as WorldSnapshot;
}

test('没有钉子时原样返回：不复制快照', () => {
  const base = snapshot();
  assert.equal(pinVillagers(base, new Map()), base);
});

test('钉子只换目标：其余村民保持同一个对象', () => {
  const base = snapshot();
  const moved = pinVillagers(base, new Map([['v0', { x: 17, y: 25 }]]));
  assert.notEqual(moved, base);
  assert.deepEqual(moved.villagers[0]!.pos, { x: 17, y: 25 });
  assert.equal(moved.villagers[1], base.villagers[1]);
  assert.equal(base.villagers[0]!.pos.y, 5, '原快照不能被改');
});

test('钉上去的人强制可见：避免「人搬了但名字/气泡按原位置藏起来」', () => {
  const moved = pinVillagers(snapshot(), new Map([['v1', { x: 17, y: 27 }]]));
  assert.equal(moved.villagers[1]!.visible, true);
});

test('兼容字段 villager 跟 villagers[0] 对齐', () => {
  const moved = pinVillagers(snapshot(), new Map([['v0', { x: 17, y: 25 }]]));
  assert.equal(moved.villager, moved.villagers[0]);
});
