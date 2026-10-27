/** 确定性种子：所有随机都从它派生，不用 `Math.random`。
 *
 * 协议第 16 节：`seed = hash(world_id, day, holder_id, op_id)`。同一份事件流
 * 两次回放必须得到完全相同的记忆库，而记忆库里有随机的地方只有两处——
 * 重构性回忆的 `p_blur`，以及传播时的说话顺序。两处都从这里取种子。
 *
 * 形状：FNV-1a 32 位。选它是因为**实现只有五行**，不引依赖，也不会因为
 * 运行时版本变化而改结果（`Math.random` 会，哈希表迭代顺序会）。
 */

/** FNV-1a 32 位。对字符串逐码点折叠。 */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // 乘 16777619 用移位拼，避免超过 32 位精度后取整误差。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 一次操作的种子。
 *
 * 分段之间用 `\u0000` 而不是逗号或竖线：那两种都可能出现在 holder id 或
 * op id 里，于是 `('a|b', 'c')` 与 `('a', 'b|c')` 会撞成同一个种子——
 * 撞了之后两次不同的操作共享同一串随机数，回放仍然确定，但不再是**各自的**随机。
 */
export function seedOf(...parts: readonly (string | number)[]): number {
  return hash32(parts.map((part) => String(part)).join('\u0000'));
}

/** 把种子变成 [0, 1) 的浮点。取高位：低位在 FNV 上分布较差。 */
export function unitFromSeed(seed: number): number {
  return (seed >>> 8) / 0x1000000;
}

/** 种子落进 [0, 1) 后是否小于 `p`。重构性回忆与传言变形都用它。 */
export function rollBelow(seed: number, p: number): boolean {
  return unitFromSeed(seed) < p;
}
