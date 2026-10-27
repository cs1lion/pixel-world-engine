/**
 * 三种摆件的剪影到底画在哪个范围里——**量出来的，不是抄的**。
 *
 * 这个文件存在的理由：`prop-grime.ts` 的 `SPECK_BOX` 声称自己跟剪影什么关系，
 * 而那个关系原来只写在注释里（「三个 draw 函数的实测范围各向外放一格」）。
 * 那句话是反的——方框整个在剪影**里头**。注释说反了没有机器会响，于是它反了
 * 很久，而下一个读者会照着「外放一格」去推理方框该在哪儿。
 *
 * 所以这里不抄数，**跑一遍真的 `drawLamp` / `drawTree` / `drawBanner`**，
 * 用一个记账的 Graphics 把每一次 `fillRect` 收下来，算并集。`decor.ts` 值级
 * 一行都不用 Phaser（只在类型位置提它），所以测试侧给 `phaser` 一个空壳就能
 * 把它加载起来——见 `test/phaser-hooks.mjs`。量的是这个仓库的文件，不是抄来的
 * 副本：`drawTree` 的 `size = seed % 3` 改一档，下面那个并集就跟着动。
 *
 * 钉的是两件事：
 *   1. **并集的数**：剪影合起来是 x∈[-13,10]、y∈[-31,3]。改了树冠尺寸，
 *      这条红，红的意思是去改 `prop-grime.ts` 那段注释，不是来改这条。
 *   2. **方框在里头**：`SPECK_BOX` 四面全不超出剪影。这是泥点不飘到地上的
 *      唯一保证，也是那个说反了的注释唯一该保住的那半句。
 *
 * 单跑这一个文件要带 loader，否则 `phaser` 会真的被加载、当场 `window is not defined`：
 *
 *     node --import ./test/phaser-hooks.mjs --test test/prop-silhouette.test.ts
 *
 * `npm test` 已经带着它（见 `package.json` 的 `test`）——那条是 CI 跑的那条。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawBanner, drawLamp, drawTree, type PropAccent } from '../src/render/decor.ts';
import { SPECK_BOX } from '../src/render/prop-grime.ts';

/** 扫多少个种子。三个 draw 的尺寸全看 `seed % 3` / `% 5` / `% 2`，512 覆盖全部档位。 */
const SEEDS = 512;

/** 四个来源记号全都扫：它们是可达形状（`accentFor` 按活给），不是装饰。 */
const ACCENTS: readonly PropAccent[] = [null, 'gear', 'book', 'inkstone'];

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function blank(): Box {
  return { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
}

function widen(box: Box, x: number, y: number, w: number, h: number): void {
  box.x0 = Math.min(box.x0, x);
  box.x1 = Math.max(box.x1, x + w - 1);
  box.y0 = Math.min(box.y0, y);
  box.y1 = Math.max(box.y1, y + h - 1);
}

/** 跑一个 draw 函数，收下它画过的全部像素的包围盒。 */
function measure(
  draw: (g: never, seed: number, accent: PropAccent) => void,
  seed: number,
  accent: PropAccent,
): Box {
  const box = blank();
  const g = {
    fillStyle: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => widen(box, x, y, w, h),
  } as never;
  draw(g, seed, accent);
  return box;
}

function envelope(draw: (g: never, seed: number, accent: PropAccent) => void): Box {
  const box = blank();
  for (let seed = 0; seed < SEEDS; seed += 1) {
    for (const accent of ACCENTS) {
      const one = measure(draw, seed, accent);
      widen(box, one.x0, one.y0, 1, 1);
      widen(box, one.x1, one.y1, 1, 1);
    }
  }
  return box;
}

const SHAPES = [
  { name: 'lamp', draw: drawLamp },
  { name: 'tree', draw: drawTree },
  { name: 'banner', draw: drawBanner },
] as const;

const UNION = envelope((g, seed, accent) => {
  for (const shape of SHAPES) shape.draw(g, seed, accent);
});

function span(box: Box): string {
  return `x∈[${box.x0},${box.x1}] y∈[${box.y0},${box.y1}]`;
}

test('三种摆件的剪影合起来是 x∈[-13,10]、y∈[-31,3]', () => {
  // 分形状也钉一下：错的那个数（树冠最高那几行）只在 tree 上。
  for (const shape of SHAPES) {
    const box = envelope(shape.draw);
    assert.ok(box.x0 >= UNION.x0 && box.x1 <= UNION.x1 && box.y0 >= UNION.y0 && box.y1 <= UNION.y1,
      `${shape.name} 的 ${span(box)} 跳出了并集 ${span(UNION)}`);
  }
  assert.equal(UNION.x0, -13, `左沿该是 -13（tree 的 book 记号画到 x=-13），实得 ${UNION.x0}`);
  assert.equal(UNION.x1, 10, `右沿该是 10（tree 最大那档），实得 ${UNION.x1}`);
  assert.equal(UNION.y0, -31, `上沿该是 -31（tree 最大那档的树冠），实得 ${UNION.y0}`);
  assert.equal(UNION.y1, 3, `下沿该是 3（lamp 的灯下光池），实得 ${UNION.y1}`);
});

test('泥点方框整个在剪影里头：一格也不外放', () => {
  // 这是 `SPECK_BOX` 唯一要保住的 invariant。外放了，泥点就会落到摆件外边，
  // 读成「地上有灰」而不是「东西脏了」——两种读法，差得远。
  assert.ok(SPECK_BOX.left >= UNION.x0,
    `方框左沿 ${SPECK_BOX.left} 超出了剪影左沿 ${UNION.x0}`);
  assert.ok(SPECK_BOX.right <= UNION.x1,
    `方框右沿 ${SPECK_BOX.right} 超出了剪影右沿 ${UNION.x1}`);
  assert.ok(SPECK_BOX.top >= UNION.y0,
    `方框上沿 ${SPECK_BOX.top} 超出了剪影上沿 ${UNION.y0}`);
  assert.ok(SPECK_BOX.bottom <= UNION.y1,
    `方框下沿 ${SPECK_BOX.bottom} 超出了剪影下沿 ${UNION.y1}`);
});

test('方框没铺满剪影：收进来的那几格按边记下来', () => {
  // 这一条不是 invariant，是**现状**——`prop-grime.ts` 那段注释说的就是它。
  // 把它钉住，是为了「铺满」两个字不能再被顺手写回去：哪天想铺满，先来改这条，
  // 顺带决定密度（`GRIME_SPECK_COUNT`）要不要跟着调。
  assert.equal(SPECK_BOX.left - UNION.x0, 4, '左沿收进 4 格');
  assert.equal(UNION.x1 - SPECK_BOX.right, 2, '右沿收进 2 格');
  assert.equal(SPECK_BOX.top - UNION.y0, 6, '上沿收进 6 格');
  assert.equal(UNION.y1 - SPECK_BOX.bottom, 0, '下沿齐平');
});

test('剪影不是一竖条：原来的 y∈[-23,2]、x∈[-9,8] 按不出来', () => {
  // 那段注释还顺带说过剪影自己是「y∈[-23,2]、x∈[-9,8] 这一竖条」。
  // 实测三家里最高到 -31、最左到 -13、最右到 10——树比灯和幡高一大截。
  // 留这一条是为了让「竖条」这个读法彻底死掉：三种摆件不是同一个竖直范围。
  assert.ok(UNION.y0 < -23, `剪影上沿该比 -23 还高，实得 ${UNION.y0}`);
  assert.ok(UNION.x0 < -9, `剪影左沿该比 -9 还左，实得 ${UNION.x0}`);
  assert.ok(UNION.x1 > 8, `剪影右沿该比 8 还右，实得 ${UNION.x1}`);
});
