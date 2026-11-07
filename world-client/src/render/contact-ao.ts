/** 接触暗部「只许压暗」的判定与计数。纯模块：不 import Phaser，node 下可单测。
 *
 * 为什么单独拎出来：这条判定同时管两件事——
 *   1. 阴影色必须比基底暗（`ΔL > 0`，语义）；
 *   2. **基底未知时不许画**。上一版把 `groundBase === undefined` 当成亮底放行，
 *      等于把「不知道」当「安全」；真出现这种情况，说明调用方把 AO 落点那格取错了
 *      （`terrainBaseOf({x: origin.x−1, y: origin.y+footprint.h})`），该红，不该静默画。
 *
 * 计数在 `buildings.ts` 的绘制路径上累加；证据脚本读 `renderStats().contactAoUnknownBase`
 * 并断言为 0，单测也直接钉这条。
 */

/** 0xRRGGBB 的 Rec.709 亮度（0..255）；「必须压暗」按它判，不靠肉眼。 */
export function lumaOf(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let unknownBaseCount = 0;

/**
 * 这一块接触暗部该不该画。
 *
 * - `groundBase === undefined`：**不画**，并记一次「基底未知」。这不是可容忍的缺省，
 *   而是调用方取错了位置——由单测与证据脚本断言计数为 0。
 * - 已知基底：只有阴影色的 Rec.709 亮度严格小于基底才画（保证 `ΔL > 0`）。
 *
 * 把「未知」与「提亮」分成两种不画的理由，是为了让红的时候能看出是哪一种。
 */
export function shouldDrawContactAo(groundBase: number | undefined, shade: number): boolean {
  if (groundBase === undefined) {
    unknownBaseCount += 1;
    return false;
  }
  return lumaOf(shade) < lumaOf(groundBase);
}

/** 本页累计「基底未知」的接触暗部次数。正常应为 0。 */
export function contactAoUnknownBaseCount(): number {
  return unknownBaseCount;
}

/** 单测用：把计数清回 0，避免同一进程里跨用例互相污染。 */
export function resetContactAoUnknownBaseCount(): void {
  unknownBaseCount = 0;
}
