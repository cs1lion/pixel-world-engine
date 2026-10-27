/** 清洗即还原（SPEC_V2 §4.6）：物件上的污浊度与露话。
 *
 * 两个槽位都在 `WorldProp` 上、都进存档，但在 v3 之前它们一动不动——
 * 出生时写 0 与 null，之后再没有第二个人写过。字段在那儿，世界不用它。
 * 这个文件是那个「用」。
 *
 * 三条规则，一句一条：
 *
 *   1. **污浊度按世界时间攒，攒满停在 1。** 世界自己往前走，不围着玩家转。
 *      洗干净是玩家按下的一个时刻，不是永久状态——否则 `0..1` 该是个布尔。
 *   2. **露话按摆件的序数从池子里取。** 不随机：同一个存档必须回放出同一句，
 *      这是 v1 以来一切确定性测试的地基。随机要一个种子，而种子又是一份状态。
 *   3. **没有露话就不攒脏。** 污浊度是盖住露话的那层东西；没有什么可盖的
 *      物件，攒脏只会得到一个「洗了也不怎样」的噪音。
 *
 * 这里全是纯函数：不读墙钟、不碰网格、不知道有命令这回事。
 * `purity.test.ts` 的 OWNERS 盯着这一条。
 */

import type { WorldProp } from './types.ts';

/** 污浊度的满值：1 是刚积满，0 是洗干净。 */
export const GRIME_FULL = 1;

/**
 * 从洗干净到重新积满要多久（**世界**时间，不是墙上时间）。
 *
 * 240 秒是拍的，参照物是世界的其他节律：一场雨 45 秒、一场暴雨 90 秒。
 * 选一个数量级而不是一个精确值——它要的是「洗完能安心读一会儿，
 * 但不会读到以为它永远干净」。实测时按体感调，调完只改这一个数。
 */
export const GRIME_FILL_MS = 240_000;

/**
 * 低于这个数就是干净的。
 *
 * 污浊度是个连续量（渲染层拿它定噪点浓淡），所以「洗干净」不能写成 `=== 0`：
 * 命令在某一拍的 `update` 里生效，而**同一拍**也让世界往前走了 `deltaMs`——
 * 于是洗完立刻又是 `deltaMs / GRIME_FILL_MS` 那么脏。写 `=== 0` 的话这条
 * 判断永远走不到，玩家洗第二下只会再听一遍「洗干净了」，像世界没听见他
 * 第二次说话。
 *
 * 1/128 是这个量的知觉下限：噪点浓淡低到这个数，画面上什么也看不出来。
 * 顺带把一帧的灰尘整个吃进去——世界走 1875ms 才攒得到这个数，
 * 而真实的一帧是 16ms。
 */
export const GRIME_CLEAN = 1 / 128;

/**
 * 走过 `deltaMs` 之后的污浊度。
 *
 * 线性，且夹在 0..1：这个量是给渲染层定噪点浓淡的，溢出去的部分没有任何
 * 用处，而浮点累加攒到 1.0000000002 是必然的。
 */
export function grimeAfter(grime: number, deltaMs: number): number {
  if (!(deltaMs > 0)) return clamp01(grime);
  return clamp01(grime + deltaMs / GRIME_FILL_MS);
}

/**
 * 第 `ordinal` 件摆件配池子里的哪句话。池子空或没给就是 null——不编。
 *
 * 按余数取而不是按第几圈：`ordinal` 是「它落地时世界上已经有几件」，
 * 读档回来件数一样，所以这句话跨存档稳定。
 */
export function revealFor(
  pool: readonly string[] | undefined,
  ordinal: number,
): string | null {
  if (pool === undefined || pool.length === 0) return null;
  if (!Number.isFinite(ordinal) || ordinal < 0) return pool[0] ?? null;
  return pool[ordinal % pool.length] ?? null;
}

/**
 * 一件摆件落进世界时的样子：露话按序配好，脏是落地就有的。
 *
 * 两个调用点（神谕换的里程碑、神迹点的灯）共用它——「落地即脏」这条规则
 * 只需要被写对一次。漏掉任一处的表现是静默的：那件摆件永远不脏，
 * 而它的露话打一开始就明面上摆着。
 *
 * 只动 `grime` 与 `reveal` 两个槽，其余原样带着（位置连对象都不复制）。
 */
export function landProp(
  prop: WorldProp,
  pool: readonly string[] | undefined,
  ordinal: number,
): WorldProp {
  const reveal = revealFor(pool, ordinal);
  return { ...prop, reveal, grime: reveal === null ? 0 : GRIME_FULL };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= GRIME_FULL) return GRIME_FULL;
  return value;
}
