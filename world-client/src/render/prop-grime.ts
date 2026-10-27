/** 摆件上的泥点：位置固定，浓淡由上层按 `grime` 调。
 *
 * 为什么单独一个文件：`decor.ts` 依赖 Phaser，泥点的几何必须能在 Node 里
 * 直接验算（同 `prop-depth.ts` 那条理由）。塞进 decor.ts 就只能靠肉眼判断
 * 「看起来够不够脏」，而那是没有验收标准的。
 *
 * 三件事这个文件负责，别的什么都不管：
 *
 *   1. **位置固定。** 同一件摆件的泥点永远在同样的像素上。泥点会乱跑的话，
 *      画面读起来是「信号不好」，不是「脏」。
 *   2. **泥点不离开摆件。** 灯、树、幡的剪影合起来是 x∈[-13,10]、y∈[-31,3]
 *      （`decor.ts` 里三个 draw 函数的实测范围，`test/prop-silhouette.test.ts`
 *      每次跑都量一遍），泥点的方框整个落在这范围**里头**——不按种类分开算，
 *      那等于把三个画法各抄一遍。它**没有**铺满：树冠顶上 6 行、左沿 4 列、
 *      右沿 2 列没有泥点，见 `SPECK_BOX` 那段。
 *   3. **只给几何，不给浓淡。** `grime` 到 alpha 的映射是渲染层的一句话，
 *      不该在这儿被拍成一个系数——那会让「洗干净」的知觉下限有两个家。
 */

/** 泥点：摆件自己的像素坐标（`drawProp` 里 Graphics 的原点就是摆件落点）。 */
export interface GrimeSpeck {
  readonly x: number;
  readonly y: number;
  /** 1 是尘，2 是泥块。 */
  readonly size: 1 | 2;
}

/**
 * 默认泥点数。26 是 `SPECK_BOX` 那 18×29 = 522 格里「看得出来但还认得出原物」的
 * 密度（约每 20 格一粒）。调它之前先看清分母：剪影合起来有 24×35 = 840 格，
 * 方框只盖其中 522 格，所以「一株树上 26 粒」说的不是剪影上 26 粒。
 *
 * （这里原来写「18×20 = 360」「约每 14 格一粒」。三个数都不对：`SPECK_BOX` 是
 * `top: -25, bottom: 3`，`spanY = 3 - (-25) + 1 = 29`，不是 20；面积 18×29 = 522；
 * 522/26 ≈ 20.1。原来那个 20 大概是拿 `bottom - top` 直接当行数（28）又抹了零头。
 * 面积与密度由 `prop-silhouette.test.ts` 的「方框的面积与密度」那条钉住——方框一改
 * 它就红，红的意思是来改这段注释，不是去改测试。）
 */
export const GRIME_SPECK_COUNT = 26;

/**
 * 泥点铺开的方框：整个落在三种摆件剪影的实测范围**里头**，一格也不外放。
 *
 * 原写「三个 draw 函数的实测范围各向外放一格」——**反了**。实测剪影合起来是
 * x∈[-13,10]、y∈[-31,3]（`test/prop-silhouette.test.ts` 每次跑都量一遍），
 * 这个方框是 x∈[-9,8]、y∈[-25,3]：左沿收进 4 格、右沿收进 2 格、上沿收进 6 格，
 * 只有底面齐平。收进来的格子没有泥点，最显眼的是树冠顶上那 6 行——
 * `drawTree` 最大的那档（`size 2`）最高画到 y=-31。
 *
 * 「不外放」是这个方框唯一要保住的 invariant：整个在剪影里，泥点就不会飘到摆件
 * 外边、读成「地上有灰」。铺不铺满是另一件事，它要看密度
 * （`GRIME_SPECK_COUNT`）跟面积配不配——没配的话先去调密度，别先把方框撑大，
 * 撑大了先得到的是「地上有灰」。
 */
export const SPECK_BOX = { left: -9, right: 8, top: -25, bottom: 3 } as const;

/** 泥块（size 2）占的比例。剩下的是尘。 */
const CLOD_RATE = 0.22;

/**
 * 一件摆件上的泥点。同一个 `seed` 永远得到同一组。
 *
 * `seed` 是摆件 id 的哈希（`decor.ts` 的 `propHash`），不是 id 本身：
 * 这个模块因此不需要知道「摆件有个字符串 id」这件事。
 */
export function grimeSpecks(seed: number, count: number = GRIME_SPECK_COUNT): readonly GrimeSpeck[] {
  const rand = makeRand(seed);
  const spanX = SPECK_BOX.right - SPECK_BOX.left + 1;
  const spanY = SPECK_BOX.bottom - SPECK_BOX.top + 1;
  const out: GrimeSpeck[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: SPECK_BOX.left + Math.floor(rand() * spanX),
      y: SPECK_BOX.top + Math.floor(rand() * spanY),
      size: rand() < CLOD_RATE ? 2 : 1,
    });
  }
  return out;
}

/**
 * 由种子生的确定性随机源，每次调用返回 [0, 1)。
 *
 * xorshift 变体，与 `tide.ts` 的 `periodLength` 同一路数——那个文件里有一段
 * 实测教训：位运算返回**有符号** int32，漏了 `>>> 0` 会算出负数来。
 */
function makeRand(seed: number): () => number {
  let h = Math.imul(Math.trunc(seed) ^ 0x9e3779b9, 2654435761) >>> 0;
  return () => {
    h = (h ^ (h >>> 15)) >>> 0;
    h = Math.imul(h, 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 0x100000000;
  };
}
