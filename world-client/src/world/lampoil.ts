/** 灯油：一盏灯的余量。**只活在渲染层**（#4）。
 *
 * 硬约束：`world/simulation.ts` 不引用本文件。灯油是画面，不是世界状态——
 * 「固定步长、无内部时钟、可确定性回放」那条契约比「灯会越烧越暗」重要得多。
 * 有人想在这里判「油尽了不能派活」的那天，先读这条：那会把一次渲染细节
 * 变成世界规则，而世界规则一改就得升存档、重放全部日志。
 *
 * 所以本文件只放纯函数：给它「多少油、过了多久、在干什么」，它还你「现在多少油」。
 * 不读墙钟、不碰 Phaser、不 import simulation——node 下能直接加载、能单测。
 *
 * **时钟用 simulation 时间，不用墙钟。** 世界暂停时灯也停，重放时灯走同一条曲线。
 * 代价是「油」跟着世界的那根钟走，不跟你手腕上那根一致；那正是要的——
 * 灯是世界里的灯。
 *
 * **见底之后会自己满回来。** 每过一个世界日重新满油（添油是每天的事，
 * 不是玩家的任务）。没有这条的话，第一盏灯烧干之后全世界永远是灰的，
 * 而那是把一个演示效果变成了永久状态。
 */

/** 满油。 */
export const LAMP_FULL = 1;

/** 灯油见底。低于它灯就灭，人也发灰。 */
export const LAMP_DRY = 0.12;

/** 一个世界日：满油能重新满一次的周期。24 个世界小时。 */
export const LAMP_DAY_MS = 24 * 60 * 60 * 1000;

/** 满油能烧几个世界小时。一小时：一局之内看得出灯在暗，又不至于刚点着就灭。 */
export const LAMP_HOURS_AT_FULL = 1;

/** 三类活动的小时耗油倍数。站着最省，走路费一些，干活最费。 */
export const LAMP_BURN_PER_HOUR = {
  idle: 1,
  walk: 1.8,
  work: 2.6,
} as const;

/** 一盏灯的忙碌程度。由渲染层从 `VillagerMode` 归出来——本文件不认识村民。 */
export type LampActivity = keyof typeof LAMP_BURN_PER_HOUR;

/** 一盏灯在渲染层里的状态。跟着提灯的那个人，不跟着帧。 */
export interface LampState {
  readonly oil: number;
  /** 上一次推进到的 simulation 时刻。 */
  readonly lastMs: number;
  /** 上一次推进时处在哪个世界日。换了日子就添满油。 */
  readonly day: number;
  /** 存档里那个余量只用来起头。见 `advanceLamp`。 */
  readonly seeded: boolean;
}

/** 一盏还没认过主人的灯。`day: -1` 表示「今天不算」，第一次推进时按存档起头。 */
export function newLamp(): LampState {
  return { oil: LAMP_FULL, lastMs: 0, day: -1, seeded: false };
}

/** 第几个世界日。纯函数，负数时刻也能稳定归日。 */
export function lampDayOf(worldNow: number): number {
  if (!Number.isFinite(worldNow)) return 0;
  return Math.floor(worldNow / LAMP_DAY_MS);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return LAMP_FULL;
  return value < 0 ? 0 : value > LAMP_FULL ? LAMP_FULL : value;
}

/**
 * 推进一盏灯。返回新状态，不改入参。
 *
 * `seed` 是存档里的余量（`SavedVillager.lampOil`），**只在第一次推进时用**。
 * 每帧都拿它当基准的话，灯永远被存档值拽回去，一帧也暗不下去；而存档那个数是
 * 上次退出时的快照，不是此刻的油量。所以起头一次，之后是渲染层自己烧出来的。
 *
 * 换了世界日就添满：`day` 由调用方从 simulation 时间算，本文件因此不认识时钟。
 */
export function advanceLamp(
  lamp: LampState,
  seed: number,
  worldNow: number,
  activity: LampActivity,
  day: number,
): LampState {
  if (!Number.isFinite(worldNow)) return lamp;
  if (!lamp.seeded) {
    return { oil: clamp01(seed), lastMs: worldNow, day, seeded: true };
  }
  if (day !== lamp.day) {
    // 新的一天：添满油，并且从这一刻重新起算。不把跨过午夜的整段算进去——
    // 那一刀会把昨晚烧掉的与今天该烧的一次结清，灯在添油的那一帧突然全满又突然全空。
    return { oil: LAMP_FULL, lastMs: worldNow, day, seeded: true };
  }
  const elapsed = worldNow - lamp.lastMs;
  if (elapsed <= 0) return { ...lamp, day };
  return {
    oil: clamp01(lamp.oil - burnFor(elapsed, activity)),
    lastMs: worldNow,
    day,
    seeded: true,
  };
}

/** 一段时间烧掉多少油。 */
export function burnFor(elapsedMs: number, activity: LampActivity): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const hours = elapsedMs / 3_600_000;
  return (LAMP_BURN_PER_HOUR[activity] / LAMP_HOURS_AT_FULL) * hours;
}

/** 灯还亮着吗。亮与灭是画面上的一道坎，中间那段由亮度连续过渡。 */
export function isLit(oil: number): boolean {
  return oil >= LAMP_DRY;
}

/**
 * 余量 → 灯的亮度，0..1。见底是 0，满油是 1，中间线性。
 *
 * 渲染层拿它同时缩放光晕的大小与浓度，所以油是连续变暗的，不是「到某个数突然灭」。
 * 那一下突然灭仍然在——`isLit` 管的是灯芯灭不灭，与周围那圈光分开。
 */
export function lampGlow(oil: number): number {
  if (!Number.isFinite(oil)) return 0;
  if (oil >= LAMP_FULL) return 1;
  if (oil <= LAMP_DRY) return 0;
  return (oil - LAMP_DRY) / (LAMP_FULL - LAMP_DRY);
}
