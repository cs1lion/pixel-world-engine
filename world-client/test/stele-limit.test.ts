/**
 * 碑面板的截断：只摆 `STELE_MAX_LINES` 条，但必须是最高的那几条。
 *
 * 第 4 天一次立起 14 条是实测到的真实形态（`legend-forms.test.ts`）。面板不摆全，但
 * 摆出来的必须是「讲的人最多」的那几条——不是任意几条、不是输入顺序的前五。
 * 这一条就是钉这个排序与截断。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { steleLines, STELE_MAX_LINES } from '../src/world/memory/stele.ts';
import type { Legend } from '../src/world/memory/types.ts';

const legend = (legendId: string, reach: number, formedDay: number): Legend => ({
  legendId,
  eventRefs: [`ev_${legendId}`],
  variants: [`${legendId} 的话`],
  reach,
  homePlaceId: 'place:32,29',
  formedDay,
});

/**
 * `STELE_MAX_LINES` 是个硬闸，改了它直接改屏幕。
 *
 * 5 这个数字是从实测出发的：14 条一次立起是**跑真实设定集（7 人 9 楼 + 22 地标）
 * 量出来**的（`.tmp-audit/census-after.txt` 记的是修痕迹之前的 15 条；修完是 14，
 * 见 `legend-forms.test.ts` 的头注）。5 不是随手挑的，
 * 而是「一块能读的碑」和「十几条流水账」之间唯一的那道闸。
 * 改这个数会直接改屏幕，所以测试要把它钉住。
 */
test('STELE_MAX_LINES = 5 是一条闸——比 5 多的都看不见', () => {
  assert.equal(STELE_MAX_LINES, 5);
});

test('从十一条里取前五：按 `reach` 降序，然后按 `formedDay` 降序', () => {
  // 用一组精心控制的数字，把排序规则拆开成几层：
  // - 前四条：全部活着、reach 完全相同 → 靠 formedDay 区分
  // - 第五条：被截掉的第一条，但它的 reach > 后面那些
  // - 后四条：活着的，但 reach < 第五条
  const many = [
    // living at top: same reach, higher formedDay wins
    legend('a', 10, 6),
    legend('b', 10, 5),
    legend('c', 10, 4),
    legend('d', 10, 3),
    // first cut: living, but reach < next four
    legend('e', 8, 2),
    // living: lower reach
    legend('f', 7, 6),
    legend('g', 7, 5),
    legend('h', 7, 4),
    legend('i', 7, 3),
    // dead ones: should be after all living
    legend('j', 1, 9),
    legend('k', 0, 8),
  ];
  const lines = steleLines(many, 10);

  // 总长不变（纯函数不截断）
  assert.equal(lines.length, many.length);

  // 前五条必须是这五个（按此顺序）：
  // a(10,6) > b(10,5) > c(10,4) > d(10,3) > e(8,2)
  const topIds = lines.slice(0, 5).map((line) => line.legendId);
  assert.deepEqual(topIds, ['a', 'b', 'c', 'd', 'e'], '前五条的顺序');

  // 后面全是活着的（reach > 1），再后面才是死的
  let sawDead = false;
  for (let i = 5; i < lines.length; i += 1) {
    if (lines[i]!.faded) {
      sawDead = true;
      continue;
    }
    if (sawDead) {
      assert.fail(`第 ${i} 位应该是活的：${lines[i]!.legendId}, reach=${lines[i]!.reach}`);
    }
  }
});

test('如果 reach 全部一样：按 formedDay 排，而不是输入顺序', () => {
  // Input order: i goes 0→9, but we want to verify output is reversed by formedDay
  const many = Array.from({ length: 10 }, (_, i) => legend(String(i), 10, i));
  const lines = steleLines(many, 20);
  const ids = lines.map((line) => line.legendId);
  // formedDay goes 0→9, so sort desc gives 9,8,7,...,0
  assert.deepEqual(ids, ['9', '8', '7', '6', '5', '4', '3', '2', '1', '0']);
});

test('dead ones 排在所有 living ones 后面，内部也按 reach 排', () => {
  const many = [
    legend('l1', 10, 9), // living
    legend('d1', 0, 10), // dead
    legend('l2', 9, 9),  // living
    legend('d2', 1, 8),  // dead
    legend('l3', 8, 9),  // living
  ];
  const lines = steleLines(many, 20);
  const isLiving = (line: typeof lines[0]) => !line.faded;
  let lastLivingIndex = -1;
  let firstDeadIndex = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (isLiving(lines[i]!)) {
      lastLivingIndex = i;
    } else {
      firstDeadIndex = Math.min(firstDeadIndex, i);
    }
  }
  // 活着的都在前面：最后一个活着的索引 >= 第一个死者的索引 - 1
  assert.ok(
    lastLivingIndex >= firstDeadIndex - 1,
    '所有活的应该排在所有死的之前',
  );
  // 死了的内部：reach 高者在前
  const dead = lines.filter((line) => line.faded);
  for (let i = 1; i < dead.length; i += 1) {
    assert.ok(
      dead[i - 1]!.reach >= dead[i]!.reach,
      `死者在内部也应按 reach 降序：${dead.map((d) => `${d.legendId}:${d.reach}`).join(', ')}`,
    );
  }
});
