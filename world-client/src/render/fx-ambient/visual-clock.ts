/** 表现层自己的视觉时钟与视觉 PRNG（`fx-ambient` 全层的唯一时间入口）。
 *
 * 这一层豁免 `Date.now()` / `Math.random()` 的纪律（见 `docs/SPEC.md` §12 与
 * `test/layer-guard.test.ts` 的防火墙），但**豁免不等于随便用**：
 *
 * - 时间只从 `update(nowMs)` 进来（Phaser 的 time 参数）。它是「这一帧的
 *   画面时刻」，不是世界时刻——世界暂停时它照走，镜头与回放不受影响；
 *   而截图比对与钉钟走 `?art=0`，这一层根本不参与，所以不欠确定性账。
 * - 随机只允许走本文件的 `visualNoise`：整数进、`0..1` 出、可复现。
 *   用 `Math.random()` 的话，同一帧两次刷新长得不一样，人眼看不出来但
 *   「这一页到底画了什么」就永远答不上来。
 *
 * 这一层严禁写 WorldState：不 import `src/world/`，连类型名都不出现。
 */

/** 视觉 PRNG（mulberry32 形态）：同一个 (a, b) 永远同一个结果。 */
export function visualNoise(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 把毫秒换算成「周期相位 0..1」。周期至少 1ms，脏数据不炸。 */
export function cyclePhase(nowMs: number, periodMs: number): number {
  const p = Math.max(1, periodMs);
  const t = Number.isFinite(nowMs) ? nowMs : 0;
  return (((t % p) + p) % p) / p;
}

/** 相位 → 正弦摆动（-1..1）。 */
export function swing(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}
