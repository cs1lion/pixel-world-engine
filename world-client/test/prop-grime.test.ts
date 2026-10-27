import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRIME_SPECK_COUNT, grimeSpecks } from '../src/render/prop-grime.ts';

/**
 * 摆件泥点的几何（SPEC_V2 §4.6 的渲染半边，§5 的第二道接缝）。
 *
 * 世界那半在 `grime.test.ts` / `grime-command.test.ts`。这里只问一件事：
 * **泥点画在哪儿、动不动。** 浓淡（`grime` → alpha）归 `decor.ts`，
 * 因为它得和「洗干净」的知觉下限（`GRIME_CLEAN`）对上。
 */

/** 三个 draw 函数的实测剪影：y∈[-23,2]、x∈[-9,8]，各向外放一格。 */
const BOX = { left: -9, right: 8, top: -25, bottom: 3 };

test('泥点铺在三种摆件的剪影里：没有一粒落在画面外', () => {
  // 灯、树、幡都画在这一竖条里（`decor.ts` 三个 draw 的实测范围）。
  // 泥点跑到剪影外头就是「地上有灰」而不是「东西脏了」——读法完全不同。
  const specks = grimeSpecks(12345);
  for (const speck of specks) {
    assert.ok(speck.x >= BOX.left && speck.x <= BOX.right, `x=${speck.x} 出了竖条`);
    assert.ok(speck.y >= BOX.top && speck.y <= BOX.bottom, `y=${speck.y} 出了竖条`);
    assert.ok(speck.size === 1 || speck.size === 2, `size=${speck.size} 只能是尘或泥块`);
  }
});

test('泥点不动：同一个种子永远得到同一组', () => {
  // 泥点会乱跑的话，画面读起来是「信号不好」，不是「脏」。
  // 这一条也是 v1 以来一切确定性测试的地基——同一个存档回放出同一个画面。
  assert.deepEqual(grimeSpecks(777), grimeSpecks(777), '两次必须一模一样');
});

test('两件摆件的泥点不一样：不然它们看起来是同一件', () => {
  const a = grimeSpecks(1);
  const b = grimeSpecks(2);
  assert.notDeepEqual(a, b, '相邻两个种子得给出不同的分布');
});

test('默认密度下认得出原物：泥点数是那个数', () => {
  // 密度是这个文件唯一的效果旋钮，所以它值得被钉住：
  // 调密了会盖住剪影，调疏了看不出脏。
  assert.equal(grimeSpecks(999).length, GRIME_SPECK_COUNT);
});

test('密度可以调小：测试与以后的效果分级都用一个参数', () => {
  assert.equal(grimeSpecks(999, 4).length, 4);
});

test('泥块只占少数：一整片 2px 方块读起来像马赛克，不像泥', () => {
  const specks = grimeSpecks(4242);
  const clods = specks.filter((speck) => speck.size === 2).length;
  assert.ok(clods > 0, '总得有几块泥，不然全是尘');
  assert.ok(clods < specks.length / 2, `泥块 ${clods}/${specks.length} 太多了`);
});
