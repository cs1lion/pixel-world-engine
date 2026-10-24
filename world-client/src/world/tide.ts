/** 潮汐：世界自己的时钟。
 *
 * 它不读墙钟，只吃 `Simulation` 已经走过的 `now`。同一个存档、同一串步长，
 * 回放出来的潮位曲线逐帧一致——这是「可确定性回放」这条契约的一部分。
 *
 * 形状：一次完整的涨落是一个周期。周期 12 分钟，每个周期的长度带 ±2 分钟
 * 抖动，抖动由周期序号经一个整数哈希决定，不用 Math.random，也不存状态。
 * 于是"规律本身是惊喜"成立，而"同一天重开是同一片海"也成立。
 *
 * 只做涨/退两档。波浪与涟漪属于渲染层的自选装饰，不在这个文件里。
 */

/** 一个周期的基础长度：12 分钟。 */
export const TIDE_PERIOD_MS = 12 * 60_000;
/** 每个周期长度的抖动幅度：±2 分钟。 */
export const TIDE_JITTER_MS = 2 * 60_000;

/**
 * 潮位在这个高度以下算「低处」。
 *
 * 它不是潮位阈值，而是地形高度的说法：地形自身的高度（见 `terrainHeight`）
 * 低于当前水位就被淹。0.34 让草地与农田的一部分在满潮时进水，石板路与广场
 * 始终露出——路要是也淹了，镇子就断成两半，那不叫潮汐，叫灾难。
 */
export const TIDE_FLOOD_LEVEL = 0.34;

/**
 * 地形离水面的高度。越小越容易被淹。
 *
 * 路面必须**严格高于 1**：潮位上限就是 1，路基若正好是 1，满潮时
 * `level > height` 仍然成立，整张路网会被判成水里——镇子断成两半，
 * 那不叫潮汐，叫灾难。所以路面给 1.2，留出余量。
 */
export const TERRAIN_HEIGHT: Readonly<Record<string, number>> = {
  // 广场与石板是垫高的路基，永远在潮线之上。
  plaza: 1.3,
  stone: 1.2,
  // 草地低平：满潮时进水。
  grass: 0.3,
  // 农田更低，是滩涂改的。
  farm: 0.18,
  // 林地比草地略高一点（树根固土），但满潮时也会湿脚。
  tree: 0.42,
};

/**
 * 被水淹的格子走起来更贵，而不是不可走。
 *
 * 不可走会让读档时落在水里的角色直接卡死（同「迷雾只拦建造」那条教训：
 * 通行规则一旦能让存档里的位置失效，读档就会造出孤岛）。代价抬高到
 * 涉水很慢，A* 自己会绕开，但真有需要时仍然走得过去。
 */
export const FLOODED_WALK_COST = 3.4;

/** 第 n 个周期的长度。纯函数：同样的 n 永远得到同样的长度。 */
export function periodLength(n: number): number {
  // 整数哈希（xorshift 变体），只为把 n 打散到 [0, 1)。
  // 每一步异或之后都要 `>>> 0`：JS 的位运算返回**有符号** int32，
  // 漏了这一步 h 会变成负数，算出来的周期长度直接越界（实测过 536227ms）。
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  const unit = h / 0x100000000; // [0, 1)
  return TIDE_PERIOD_MS + Math.round((unit * 2 - 1) * TIDE_JITTER_MS);
}

/**
 * 世界时间 `now` 的潮位，0（退到底）到 1（满潮）。
 *
 * 一个周期里：前半段涨，后半段退。用余弦而不是线性，涨落两端会自然变慢，
 * 看起来像真的潮水而不是电梯。
 */
export function tideLevelAt(now: number): number {
  if (!Number.isFinite(now) || now <= 0) return 0;
  let remaining = now;
  let index = 0;
  // 周期长度在 10–14 分钟，一天（以世界时间算）也不过几十个周期，
  // 这个循环不会成为热点；写死上限只是防 `now` 被喂进一个离谱的数。
  while (index < 100_000) {
    const length = periodLength(index);
    if (remaining < length) {
      const progress = remaining / length;
      // 0 → 1 → 0 的平滑曲线。
      return (1 - Math.cos(progress * Math.PI * 2)) / 2;
    }
    remaining -= length;
    index += 1;
  }
  return 0;
}

/** 这个地形在这个潮位下是不是被淹了。 */
export function isFlooded(terrain: string, level: number): boolean {
  const height = TERRAIN_HEIGHT[terrain];
  // 没登记的地形按草地算：宁可湿脚，也不要因为漏配一个地形就让整片区域变干。
  return level > (height ?? TERRAIN_HEIGHT.grass);
}

/** 潮汐的一句话状态，给状态行用。 */
export function describeTide(level: number, previous: number): string {
  const rising = level > previous;
  if (level >= 0.85) return '满潮';
  if (level <= 0.15) return '退潮见底';
  return rising ? '涨潮' : '退潮';
}
