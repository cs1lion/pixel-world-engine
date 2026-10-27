/**
 * 「等屏幕安静」自己也得是被守住的那一个。
 *
 * 它是 `check-buttons.mjs` 里唯一拦着**上一颗按钮的迟到效果洗掉下一颗**的东西。
 * 悄悄闭上嘴的守卫比没有守卫更糟：它会一直绿灯，而整套按钮审计从此把有罪的
 * 按钮一个个放过去。所以这里拿假读数把它的每一种走法各演一遍。
 *
 * 时长按睡着的累计算（不看钟），于是「等满就收工」这一步是确定性的，不用真等。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameReading, waitForQuiet, type ScreenReading } from '../scripts/quiesce.ts';

/** 一份假屏幕：按调用次序给出预订的读数，读完就重复最后一个。 */
function fake(script: readonly ScreenReading[]) {
  let reads = 0;
  let slept = 0;
  const sleep = async (ms: number) => {
    slept += ms;
  };
  return {
    read: async () => {
      const value = script[Math.min(reads, script.length - 1)];
      reads += 1;
      assert.ok(value !== undefined, '预订的读数不能空');
      return value;
    },
    reads: () => reads,
    slept: () => slept,
    sleep,
  };
}

const A: ScreenReading = { reply: '', entries: 4, heading: '镇志 · 共 4 条' };
const B: ScreenReading = { ...A, entries: 5, heading: '镇志 · 共 5 条' };
const C: ScreenReading = { ...A, entries: 6, heading: '镇志 · 共 6 条' };
const D: ScreenReading = { ...A, entries: 7, heading: '镇志 · 共 7 条' };

/**
 * 一片永不安静的屏幕：四色轮转，**相邻两片必定不同**，所以永远等不到安静。
 *
 * 为什么是四色而不是两色：这一族测试要钉「返回的是末次读数」，末次是第 31 次读
 * （1 次摸底 + 30 步）。两色轮转时第 31 片的下标是 30，30 % 2 = 0，与第 1 片
 * 同色——**第一次和末次读数一模一样，断言于是分不出返回了哪一个**。第一版就是
 * 这么写的：`assert.deepEqual(out, A, '等满时返回末次读数，不是第一次')` 在
 * 「返回第一次」的变异体面前照样绿。四色轮转时 30 % 4 = 2，末次是 C，与第一次
 * 的 A 不同，这句话才真的在钉东西。
 *
 * 四色还要求 D ≠ A（轮转回到开头那一跳），所以四片两两不同。
 */
function flickerForever(): ScreenReading[] {
  const cycle = [A, B, C, D];
  const out: ScreenReading[] = [];
  for (let i = 0; i < 41; i += 1) out.push(cycle[i % 4]);
  return out;
}

test('屏幕本来就安静：读两次就收工，不再等', async () => {
  const screen = fake([A]);
  const out = await waitForQuiet(screen.read, screen.sleep, 3000, 100);
  assert.deepEqual(out, A);
  assert.equal(screen.reads(), 2, '第一次摸底，第二次确认——两片一样就该走了');
  assert.equal(screen.slept(), 100, '只睡了一步');
});

test('第三次才安静：等到那一次为止', async () => {
  // 上一颗的迟到效果正落在这一段里。等不到它，它就落进下一颗的窗口，
  // 把下一颗洗白。
  const screen = fake([A, B, B]);
  const out = await waitForQuiet(screen.read, screen.sleep, 3000, 100);
  assert.deepEqual(out, B, '返回末次读数——带着刚落下来的那一下');
  assert.equal(screen.reads(), 3);
  assert.equal(screen.slept(), 200);
});

test('一直不安静：等满就收工，不无限等', async () => {
  // 世界自己在动（潮位、天气、呼吸），屏幕可能一直翻。等下去只是拖慢全套。
  // 41 片预订读数、每片都跟上一片不同，于是永远等不到安静。脚本的末片走不到，
  // 末前一片才是第 31 次读的那片。写成 for 而不是手数：手数 40 个 A/B 的那一版，
  // 我把期望值数成了 B——第 31 片（下标 30）是 A。
  const screen = fake(flickerForever());
  const out = await waitForQuiet(screen.read, screen.sleep, 3000, 100);
  assert.equal(screen.slept(), 3000, '等满 maxMs 就收工');
  assert.equal(screen.reads(), 31, '1 次摸底 + 30 步');
  // 等满这条路返回的也得是末次读数。这一句与下面那条「返回末次读数」钉的是同一
  // 件事的两条出路——合成一个 return 之前，改了一条忘了另一条不会有任何测试红。
  //
  // 第一版这句是 `deepEqual(out, A)`：两色轮转时第 1 次和第 31 次读到的都是 A，
  // 于是「返回第一次」的变异体在这儿照样绿，整句是空转。现在末次是 C（见
  // `flickerForever` 的说明），这一句真的分得出返回了哪一个。
  assert.deepEqual(out, C, '等满时返回末次读数，不是第一次');
  assert.notEqual(out, A, '第一次读到的不是末次——否则上一句分不出返回了哪一个');
});

test('返回的是末次读数，不是第一次', async () => {
  // 这一条单独钉：返回第一次的话，这道等法就白等了——落下来的效果还是在窗外。
  const screen = fake([A, B, B]);
  const out = await waitForQuiet(screen.read, screen.sleep, 3000, 100);
  assert.notEqual(out, A);
  assert.deepEqual(out, B);
});

test('等满按睡着的累计算：maxMs 不是整数倍时，睡到第一个不低于它的整步', async () => {
  // 第一版这条测试用 `fake([A])`——屏幕第一次读就安静，于是循环在第一步后就
  // break，`maxMs` 那个界**根本没被读到**：250、50、3000 三种取值下断言全都一样。
  // 而它的断言消息还写着「等满 250 前只走到 200」，与实际行为正好相反。
  //
  // 循环是 `while (waited < maxMs) { sleep(stepMs); waited += stepMs; ... }`，
  // 所以它睡的是「第一个让 waited 不低于 maxMs 的整步」：maxMs=250、stepMs=100
  // 时 waited 走 0→100→200→300，共睡 300，比 maxMs 多 50。这不是 bug——检查安静
  // 只能发生在整步的末尾——但把它说成「不会多睡一步」就是假话。
  const screen = fake(flickerForever());
  await waitForQuiet(screen.read, screen.sleep, 250, 100);
  assert.equal(
    screen.slept(),
    300,
    '睡到第一个不低于 maxMs 的整步：waited 走 0→100→200→300，300 ≥ 250 才停',
  );
  // 这条真的在盯那个界：改成 `waited <= maxMs` 会睡 400，改成
  // `waited + stepMs <= maxMs` 会睡 200，两种都会红。
  assert.ok(screen.slept() > 250, '等满必须真的等够了，不能提前收工');
  assert.ok(screen.slept() < 400, '也不能在越界之后还多睡一步');
});

test('sameReading 逐键比，键集合不同也算不一样', () => {
  assert.equal(sameReading(A, { ...A }), true);
  assert.equal(sameReading(A, B), false);
  assert.equal(sameReading(A, { ...A, extra: 1 }), false, '多一个键也是两次不同的屏');
  assert.equal(sameReading({}, {}), true, '两面都没有字，也是一样');
  // `undefined` 与「没有这个键」在这道判据里不是一回事：键集合那一条已经拦了。
  assert.equal(sameReading({ a: undefined }, {}), false);
});

test('读数里出现 undefined 与 null 时，判据不混', () => {
  // 界面上「没有这个元素」读回来是 undefined 或 ''，两种都可能。它们不可互换。
  assert.equal(sameReading({ a: undefined }, { a: null }), false);
  assert.equal(sameReading({ a: '' }, { a: undefined }), false);
  assert.equal(sameReading({ a: null }, { a: null }), true);
});
