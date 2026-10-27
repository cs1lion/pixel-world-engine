import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRIME_SPECK_COUNT, SPECK_BOX, grimeSpecks } from '../src/render/prop-grime.ts';

/**
 * 摆件泥点的几何（SPEC_V2 §4.6 的渲染半边，§5 的第二道接缝）。
 *
 * 世界那半在 `grime.test.ts` / `grime-command.test.ts`。这里只问一件事：
 * **泥点画在哪儿、动不动。** 浓淡（`grime` → alpha）归 `decor.ts`，
 * 因为它得和「洗干净」的知觉下限（`GRIME_CLEAN`）对上。
 *
 * 方框从 `prop-grime.ts`  import 过来，不在这儿重抄一份：抄一份就成了两处真相，
 * 而「方框跟剪影什么关系」这件事昨天刚因为只有一处真相（注释里那句说反了的话）
 * 反了很久。关系本身由 `prop-silhouette.test.ts` 量剪影、钉方框。
 */

test('泥点铺在方框里：没有一粒跑到摆件外头', () => {
  // 灯、树、幡的剪影合起来是 x∈[-13,10]、y∈[-31,3]（`prop-silhouette.test.ts`
  // 量），方框整个在里头。泥点跑到剪影外头就是「地上有灰」而不是「东西脏了」——
  // 读法完全不同。
  const specks = grimeSpecks(12345);
  for (const speck of specks) {
    assert.ok(speck.x >= SPECK_BOX.left && speck.x <= SPECK_BOX.right, `x=${speck.x} 出了方框`);
    assert.ok(speck.y >= SPECK_BOX.top && speck.y <= SPECK_BOX.bottom, `y=${speck.y} 出了方框`);
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
