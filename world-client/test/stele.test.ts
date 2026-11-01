/**
 * 碑上的行：排序、淡去、原文照搬、年龄口径。
 *
 * 这一层是纯函数，所以这些测试不碰世界、不碰 DOM、不碰时钟——输入一份传说，
 * 输出排好序的 `SteleLine[]`，四种性质各自一条。
 *
 * **截断不在这一层。** `steleLines` 原样返回全部，数得清总共有几条；面板才
 * 是决定「摆几条」的那一侧（`test/stele-limit.test.ts` 钉它）。把截断塞进纯
 * 函数里，这里就只能测「摆了五条」，测不到「一共有二十二条」——而后者正是这条
 * 链最要紧的那个数。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { steleLines, STELE_MAX_LINES, type SteleLine } from '../src/world/memory/stele.ts';
import type { Legend } from '../src/world/memory/types.ts';

const legend = (
  legendId: string,
  reach: number,
  formedDay: number,
  variants: readonly string[] = [`${legendId} 的那句话`],
): Legend => ({
  legendId,
  eventRefs: [`ev_${legendId}`],
  variants,
  reach,
  homePlaceId: 'place:32,29',
  formedDay,
});

const ids = (lines: readonly SteleLine[]): string[] => lines.map((line) => line.legendId);

test('没有传说时返回空数组——碑是空的，不是缺数据', () => {
  assert.deepEqual(steleLines([], 5), []);
});

test('一条传说：字段原样搬过来，age 走 voice.ts 同一口径', () => {
  const lines = steleLines([legend('legend_1', 7, 4, ['潮水退过一半', '滩涂露出来了'])], 5);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.legendId, 'legend_1');
  assert.equal(lines[0]!.reach, 7);
  assert.equal(lines[0]!.formedDay, 4);
  assert.equal(lines[0]!.faded, false, 'reach 7 远在 1 以上');
  assert.equal(lines[0]!.age, '昨天', '第 5 天看第 4 天立的碑');
  // 几种讲法原样，顺序不变，不合并、不改写。
  assert.deepEqual([...lines[0]!.texts], ['潮水退过一半', '滩涂露出来了']);
});

test('age 三档：今天 / 昨天 / N 天前', () => {
  // 照 `villager-voice.test.ts` 的写法：三个整档各一条，不靠边界推。
  assert.equal(steleLines([legend('a', 5, 4)], 4)[0]!.age, '今天');
  assert.equal(steleLines([legend('b', 5, 4)], 5)[0]!.age, '昨天');
  assert.equal(steleLines([legend('c', 5, 4)], 9)[0]!.age, '5 天前');
});

test('按 reach 降序：讲的人多的排前面', () => {
  const lines = steleLines(
    [legend('low', 6, 4), legend('high', 13, 4), legend('mid', 9, 4)],
    5,
  );
  assert.deepEqual(ids(lines), ['high', 'mid', 'low']);
});

test('reach 相同按 formedDay 降序：后立的那条排前面', () => {
  const lines = steleLines([legend('old', 8, 3), legend('new', 8, 6)], 7);
  assert.deepEqual(ids(lines), ['new', 'old']);
});

test('淡去（reach <= 1）的排到最后，并带 faded 标记', () => {
  // 淡去是传说的晚年，不是删除：它留在碑上，但排在还活着的人讲的后面。
  const lines = steleLines(
    [legend('dead', 1, 2), legend('alive', 6, 4), legend('almost', 2, 3)],
    6,
  );
  assert.deepEqual(ids(lines), ['alive', 'almost', 'dead']);
  assert.equal(lines.at(-1)!.faded, true, 'reach 1 就算淡去');
  assert.equal(lines[0]!.faded, false);
});

test('多条淡去时它们内部也按 reach 降序，不是按输入顺序', () => {
  const lines = steleLines([legend('d1', 1, 2), legend('d0', 0, 2)], 6);
  assert.deepEqual(ids(lines), ['d1', 'd0']);
});

/**
 * 实测形态：十几条同时立起。
 *
 * `STELE_MAX_LINES` 是「多少条就撑爆一块能读的碑」的那个数，而第 4 天关账时
 * 一次立起 14 条是**跑真实设定集量出来的**（7 人 9 楼 + 22 地标，见
 * `test/legend-forms.test.ts`；修痕迹之前是 22）。这里故意取比实测更大的 22，
 * 钉的是纯函数不替调用方截断：22 条进来，22 条出去。
 */
test('一次来二十二条，二十二条全都返回——截断不是这一层的事', () => {
  const many = Array.from({ length: 22 }, (_, i) => legend(`legend_${i}`, 6 + (i % 7), 4));
  const lines = steleLines(many, 5);
  assert.equal(lines.length, 22);
  // 把「多少条才摆得下」也钉一遍：这个数改了会直接改屏幕。
  assert.equal(STELE_MAX_LINES, 5);
  // 排好序之后取前五条，`reach` 不递增就说明排序坏了。
  const top = lines.slice(0, STELE_MAX_LINES).map((line) => line.reach);
  for (let i = 1; i < top.length; i += 1) {
    assert.ok(top[i - 1]! >= top[i]!, `前五条的 reach 应当不递增：${top.join(' / ')}`);
  }
});
