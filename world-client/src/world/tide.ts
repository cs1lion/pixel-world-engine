/** 潮汐：世界自己的时钟。
 *
 * 它不读墙钟，只吃 `Simulation` 已经走过的 `now`。同一个存档、同一串步长，
 * 回放出来的潮位曲线逐帧一致——这是「可确定性回放」这条契约的一部分。
 *
 * 形状：一次完整的涨落是一个周期。周期 12 分钟，每个周期的长度带 ±2 分钟
 * 抖动，抖动由周期序号经一个整数哈希决定，不用 Math.random，也不存状态。
 * 于是"规律本身是惊喜"成立，而"同一天重开是同一片海"也成立。
 *
 * 这里原来写「只做涨/退两档。波浪与涟漪属于渲染层的自选装饰，不在这个文件里」——
 * 前半句是假的：`tideLevelAt` 沿余弦返回 0..1 的**连续值**，`TideOverride.level`
 * 收任意数，`describeTide` 有四个标签（满潮 / 退潮见底 / 涨潮 / 退潮），
 * 命令入口 `oracle.ts` 的 `parseTideLevel` 也收任意数值，另有两个端点词
 * （涨 = 1、退 = 0）。这句话后来被 `render/tide-view.ts` 抄了一遍，
 * 两份都是假的。（"波浪与涟漪不在这里"这半句仍成立：`src/` 下没有波浪或涟漪。）
 */

/** 一个周期的基础长度：12 分钟。 */
export const TIDE_PERIOD_MS = 12 * 60_000;
/** 每个周期长度的抖动幅度：±2 分钟。 */
export const TIDE_JITTER_MS = 2 * 60_000;

/**
 * 「低处」的判定线：潮位高于它就算淹。
 *
 * 这里原来写「它不是潮位阈值，而是地形高度的说法：地形自身的高度（见
 * `terrainHeight`）低于当前水位就被淹。0.34 让草地与农田的一部分在满潮时进水」——
 * 三处都不成立：
 *
 * - **`terrainHeight` 全仓不存在。** grep 只命中这条注释自己。真实存在的是下面
 *   这张 `TERRAIN_HEIGHT` 表与 `isFlooded()`。
 * - **`TIDE_FLOOD_LEVEL` 是死常量。** 它 export 出来，而 `src/`、`test/`、
 *   `scripts/` 下零个读者——真正决定淹不淹的是 `TERRAIN_HEIGHT`（grass 0.3 /
 *   farm 0.18 / plaza 1.3 / stone 1.2）。把「0.34 让草地与农田进水」这个效果
 *   归给一个没人读的数，读的人会去改它，然后发现什么都没变。
 * - **0.34 这个语义在别处是硬编码字面量**：`simulation.ts` 的作息潮位条件写的
 *   就是 `beat.tide === 'low' && level > 0.34`，没有 import 这个常量。
 *
 * 它现在还在，是因为删一个 export 要确认没有外部消费者；但在它被接上或被删掉
 * 之前，注释不该把效果归给它。
 */
export const TIDE_FLOOD_LEVEL = 0.34;

/**
 * 地形离水面的高度。越小越容易被淹。
 *
 * 路面给 1.2，**高于潮位上限 1**：满潮时 `level === 1` 而 `1 > 1` 为假
 * （`isFlooded` 是严格大于），所以路面不淹。留出的那 0.2 是余量，不是门槛。
 *
 * 这里原来写「路面必须**严格高于 1**：……路基若正好是 1，满潮时 `level > height`
 * 仍然成立，整张路网会被判成水里」——**理由是反的**。`isFlooded` 用的是严格大于
 * （`return level > (height ?? TERRAIN_HEIGHT.grass)`），路基正好取 1.0 时
 * `1 > 1` 为 false，本来就不淹。而 `level` 确实能取到正好 1：`tideLevelAt` 在半个
 * 周期处返回 `(1 - cos(pi)) / 2 = 1`，覆盖那条路也被 `clampLevel` 夹在 1。
 *
 * 结论（给 1.2）没错，但写下来的理由会把后来调表的人带错——他会以为 1.0 是个
 * 必须避开的数，于是把 1.2 往上再加，或者反过来以为「严格大于」是笔误而去改
 * `isFlooded`。两边都是白改。
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
  shallow: 0.12,
  mud: 0.24,
  coal: 0.75,
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

// ------------------------------------------------------------ 有期限的覆盖

/**
 * 潮位覆盖：一句话让潮水涨/退，但它有期限。
 *
 * 潮位本来是 `now` 的纯函数，可确定性回放靠的就是这一条。让命令直接写潮位
 * 会当场毁掉它，所以命令写的是一条**有期限的覆盖**：到期自动失效，
 * 世界回到自己的节律上。覆盖本身进存档，回放仍然唯一。
 *
 * 形状与存档里那份是同一个（`save.ts` 从这里导入，不是各写一份）。
 */
export interface TideOverride {
  /** 0..1，命令要求的潮位。 */
  readonly level: number;
  /** 世界时间，到这个时刻覆盖失效。 */
  readonly until: number;
}

/**
 * 一次命令最多能压住潮汐多久。
 *
 * 2 分钟是拍的（spec §8 记了这条：没有实测依据）。下限的理由是硬规则——
 * 「潮汐是时钟」这条承诺只有在覆盖**必然会过去**时才成立。上限不超过
 * 一个周期的一半：超过半周期，覆盖就比潮汐自己走完还能造成的改变更大，
 * 那就不是"一句话拨了一下"，是夺权。
 */
export const TIDE_OVERRIDE_MAX_MS = 2 * 60_000;

/**
 * 把读到的潮位夹回 0..1。只在**读**的那一侧用，不在命令那侧。
 *
 * 存档是可以被手改的文件，读到 `1.5` 也不该让整片海变成负高度。命令那条路
 * 走不到越界值——`tideOverrideRejection` 先拒了；这里留着只是防手改的存档。
 */
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level));
}

/**
 * 此刻的有效潮位。
 *
 * 覆盖到期就自动作废——**不需要谁去删它**：读的时候按 `now` 判，
 * 这样回放与读档都不会因为「清理字段」的时序不同而分叉。
 */
export function effectiveTideLevel(now: number, override: TideOverride | null): number {
  if (override === null) return tideLevelAt(now);
  if (now >= override.until) return tideLevelAt(now);
  return clampLevel(override.level);
}

/** 覆盖是否还有效。存档里留着过期的覆盖无害，但不必显示它。 */
export function isOverrideActive(now: number, override: TideOverride | null): boolean {
  return override !== null && now < override.until;
}

/**
 * 快照里的潮汐一栏。纯函数，好离线断言。
 *
 * `overridden` 与 `label` 都要看覆盖：被压住时潮水可能停着不动，
 * 只报「满潮」会让用户以为潮汐坏了。
 */
export function tideView(
  now: number,
  override: TideOverride | null,
  previous: number,
): { level: number; label: string; rising: boolean; overridden: boolean } {
  const level = effectiveTideLevel(now, override);
  const active = isOverrideActive(now, override);
  return {
    level,
    label: active
      ? `潮位被人拨住了（${describeTide(level, previous)}）`
      : describeTide(level, previous),
    rising: level > previous,
    overridden: active,
  };
}

/** 一条覆盖请求为什么站不住。给调用方一个稳定的词，而不是一句中文。 */
export type TideOverrideRejection = 'level-out-of-range' | 'duration-not-positive' | 'duration-too-long';

/**
 * 校验一条覆盖请求。`null` = 可以落。
 *
 * **超上限是拒，不是夹。** 夹住会让「拨 10 分钟」变成「拨了 2 分钟」——
 * 世界照办了，但办的不是那件事，而调用方拿到的是成功。这里宁可整条命令失败：
 * 至少失败是看得见的。
 */
export function tideOverrideRejection(
  level: number,
  durationMs: number,
): TideOverrideRejection | null {
  if (!Number.isFinite(level) || level < 0 || level > 1) return 'level-out-of-range';
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'duration-not-positive';
  if (durationMs > TIDE_OVERRIDE_MAX_MS) return 'duration-too-long';
  return null;
}

/**
 * 造一条覆盖。调用前必须已经过了 `tideOverrideRejection`——
 * 这里不重复校验，只做"落到具体时刻"这件纯算术。
 */
export function makeTideOverride(level: number, durationMs: number, now: number): TideOverride {
  return { level, until: now + Math.round(durationMs) };
}
