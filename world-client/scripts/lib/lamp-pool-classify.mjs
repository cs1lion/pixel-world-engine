/**
 * 街面光池读数的分类表：**哪一格本来就该是纯黑，哪一格必须点亮**。
 *
 * 纯黑没有色度信息，硬算 McCamy 会得到约 2259K 的伪造色温，所以 `cct === null`
 * 的读数一律不给色温。但「纯黑」本身不等于故障：
 *
 * - 灯灭对照组（`force:false` 同帧各拍一页）本来就该是纯黑；
 * - 衰减曲线末端 4/6 格是**用来证明光真的衰减到零**的，`d >= 4` 的亮态纯黑是预期；
 * - 灯亮池心、两档潮位（都是灯亮态）、曲线 0.5–2.5 格是「必须点亮」的位置。
 *
 * 这一张表是业务知识、最会漂，所以从 `check-lamp-pool.mjs` 里抽出来单独放，
 * 由 `test/lamp-pool-classify.test.ts` 双向钉住：改动预期就会被测试打红。
 *
 * 判定口径：
 * - `[零光]`：不在「必须点亮」集合里的纯黑 → 只记录，**不判红**；
 * - `[判据前提不成立]`：「必须点亮」的位置采到纯黑 → 灯态没生效或取样链路坏了，
 *   **判红**（退出码 1）。这不是产品缺陷，是判据前提不成立。
 */

/** 曲线里必须点亮的最大格数。4/6 格远端明写「用来证明衰减到零」，不算必须点亮。 */
export const MUST_BE_LIT_CURVE_MAX = 2.5;

/**
 * 把一次运行的读数摊平成分类用例。
 *
 * @param {{
 *   closeReading: { lit: object, dark: object },
 *   curve: Array<{ d: number, lit: object, dark: object }>,
 *   tide: { low: { value: object }, high: { value: object } },
 * }} out
 * @returns {Array<{ label: string, reading: object, mustBeLit: boolean }>}
 */
export function readingCases(out) {
  return [
    { label: '灯亮（池心）', reading: out.closeReading.lit, mustBeLit: true },
    { label: '灯灭（池心）', reading: out.closeReading.dark, mustBeLit: false },
    ...out.curve.flatMap((row) => [
      { label: `${row.d} 格 亮`, reading: row.lit, mustBeLit: row.d <= MUST_BE_LIT_CURVE_MAX },
      { label: `${row.d} 格 灭`, reading: row.dark, mustBeLit: false },
    ]),
    { label: '潮位低（灯亮池心）', reading: out.tide.low.value, mustBeLit: true },
    { label: '潮位高（灯亮池心）', reading: out.tide.high.value, mustBeLit: true },
  ];
}

/**
 * @returns {{ zeroLight: string[], broken: string[] }}
 *   `zeroLight` 是预期零光（不红）；`broken` 是「必须点亮」却采到纯黑（判红）。
 */
export function classifyReadings(out) {
  const cases = readingCases(out);
  const zeroLight = [];
  const broken = [];
  for (const item of cases) {
    if (item.reading.cct !== null) continue;
    (item.mustBeLit ? broken : zeroLight).push(item.label);
  }
  return { zeroLight, broken };
}

/**
 * 打印分类结果并返回退出码（0 = 不红，1 = 判据前提不成立）。
 *
 * @param {object} out 同 `readingCases`
 * @param {{ error?: (...args: unknown[]) => void }} [options]
 * @returns {0 | 1}
 */
export function reportReadings(out, { error = (...args) => console.error(...args) } = {}) {
  const { zeroLight, broken } = classifyReadings(out);
  for (const label of zeroLight) {
    error(`[零光] ${label}：rgb 全黑，没有色度信息，不给色温（不在「必须点亮」集合，不判红）。`);
  }
  for (const label of broken) {
    error(`[判据前提不成立] ${label}：灯亮态采到纯黑——不是「灯本来就灭」，是灯态或取样链路坏了。`);
  }
  if (broken.length > 0) {
    error(`[判据前提不成立] 判红：${broken.length} 个「必须点亮」的读数没有有效像素。`);
    return 1;
  }
  return 0;
}
