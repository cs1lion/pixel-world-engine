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
 *   2. **铺满三种摆件的剪影。** 灯、树、幡都画在 y∈[-23,2]、x∈[-9,8] 这一竖条里
 *      （`decor.ts` 里三个 draw 函数的实测范围），所以泥点也铺这一竖条——
 *      不按种类分开算，那等于把三个画法各抄一遍。
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

/** 默认泥点数。26 是这个剪影面积下「看得出来但还认得出原物」的密度。 */
export const GRIME_SPECK_COUNT = 26;

/** 泥点铺开的竖条：三个 draw 函数的实测范围各向外放一格。 */
const SPECK_BOX = { left: -9, right: 8, top: -25, bottom: 3 } as const;

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
