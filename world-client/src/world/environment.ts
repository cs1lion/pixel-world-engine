/** 环境帧：某一刻世界环境的**一份统一读数**。
 *
 * 天气、潮位、时辰、光照原先散在三处：`routines.ts` 直接 import 潮位常量，
 * `weather-effects.ts` 只认天气那一档，`timetable.ts` 自己按分钟走。三处各读
 * 一份的后果不是「算得慢」，而是**同一刻可以读成两个世界**——比如快进判定
 * 与落点判定各拿一份潮位，改一处忘另一处就分叉。
 *
 * 这个文件把它们收成一帧：`environmentAt()` 是唯一的构造函数，读的人只问
 * `frame.flags`。「雨 + 涨潮」「雾 + 收工」这类组合条件因此只是两个 flag
 * 同时成立，不必在每个调用处各写一遍。
 *
 * 纪律与 `timetable.ts` 相同：**纯函数、零状态**。输入是时刻、天气与潮位，
 * 输出是一帧；它不读 `Date.now()`、不碰 `Simulation`，也不进存档。
 */

import type { Weather } from './types.ts';
import { DAY_MS } from './memory/config.ts';
import { TIDE_HIGH_MIN, TIDE_LOW_MAX } from './tide.ts';
import { isQuietAt, minuteOfDay, siteOpenAt, TIMETABLE, type TimetableId } from './timetable.ts';
import { lampStreetLitAt, type LampPhase } from './lamp-street.ts';

/**
 * 一帧里成立的环境条件。
 *
 * 前十项是**世界自己就能算**的；灯的两项要渲染层的相位才定得下来（世界层的
 * 昼夜跟墙钟，不在这一帧里），所以只在调用方给了 `lighting` 时登记。
 * 没有 `lighting` 时那一帧就只是「灯态未知」，不是「灯不亮」。
 *
 * 市面的两项是 `siteOpenAt(now)` 的投影：闭市时两项都不在，是**确定的关着**，
 * 不是「未知」——场所相位只由世界时刻决定。
 */
export type EnvironmentFlag =
  | 'rain'
  | 'storm'
  | 'wet'
  | 'fog'
  | 'lowTide'
  | 'highTide'
  | 'quiet'
  | 'workEnded'
  | 'marketOpen'
  | 'nightMarket'
  | 'lampsLit'
  | 'lampsOut';

export interface EnvironmentFrame {
  /** 世界时刻（世界毫秒，与 `Simulation.now` 同一个口径）。 */
  readonly now: number;
  /** 世界日序，`now` 落在第几天。 */
  readonly day: number;
  /** 世界日内的第几分钟（06:00 = 360），与 `timetable.ts` 同一口径。 */
  readonly minuteOfDay: number;
  readonly weather: Weather;
  /** 有效潮位 0..1（调用方已经合并过覆盖）。 */
  readonly tideLevel: number;
  readonly flags: ReadonlySet<EnvironmentFlag>;
}

/** 光照读数：灯态要相位才定得下来，由渲染层递进来。 */
export interface EnvironmentLighting {
  readonly phase: LampPhase;
  readonly autoAdvancing: boolean;
}

/** 时刻表里某一拍的分钟数。缺那一拍是代码错误，当场抛，不静默退回某个数。 */
function timetableMinute(id: TimetableId): number {
  const beat = TIMETABLE.find((item) => item.id === id);
  if (beat === undefined) throw new Error(`时刻表缺少 ${id}`);
  return beat.minuteOfDay;
}

const WORK_END_MINUTE = timetableMinute('work_end');

/**
 * 构造一帧环境读数。
 *
 * 潮位门槛只在 `tide.ts` 声明、这里读：`lowTide` 是 `<=`、`highTide` 是 `>=`，
 * 与 `tideBeatApplies` 原先压线那一格的判定逐字相同。改回调用处比较就是让
 * 两处各写一遍，那条闸门（`routine-tide-single-source.test.ts`）盯着这个。
 */
export function environmentAt(
  now: number,
  weather: Weather,
  tideLevel: number,
  lighting?: EnvironmentLighting,
): EnvironmentFrame {
  const minute = minuteOfDay(now);
  const flags = new Set<EnvironmentFlag>();
  if (weather === 'rain') flags.add('rain');
  if (weather === 'storm') flags.add('storm');
  // 「下雨」这一档把 rain 与 storm 合在一起：行为上它们只差说法，不差躲不躲。
  if (weather === 'rain' || weather === 'storm') flags.add('wet');
  if (weather === 'fog') flags.add('fog');
  if (tideLevel <= TIDE_LOW_MAX) flags.add('lowTide');
  if (tideLevel >= TIDE_HIGH_MIN) flags.add('highTide');
  if (isQuietAt(now)) flags.add('quiet');
  if (minute >= WORK_END_MINUTE) flags.add('workEnded');
  const marketPhase = siteOpenAt(now);
  if (marketPhase === 'open') flags.add('marketOpen');
  if (marketPhase === 'night') flags.add('nightMarket');
  if (lighting !== undefined) {
    if (lampStreetLitAt(now, lighting.phase, lighting.autoAdvancing)) flags.add('lampsLit');
    else flags.add('lampsOut');
  }
  return {
    now,
    day: Math.floor(now / DAY_MS),
    minuteOfDay: minute,
    weather,
    tideLevel,
    flags,
  };
}

/** 这一帧里这些条件**同时**成立吗。组合条件（雨+涨潮、雾+收工）就走这里。 */
export function hasEnvironment(
  frame: EnvironmentFrame,
  ...flags: readonly EnvironmentFlag[]
): boolean {
  return flags.every((flag) => frame.flags.has(flag));
}
