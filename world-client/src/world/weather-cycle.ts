/** 按世界时间与种子排天的天气序列。
 *
 * **确定性来自种子，不来自「同一台机器」**：槽号由世界时间整除得到，
 * 槽里的天气由 `seedOf(worldSeed, 槽号, 'weather-slot')` 抽签。
 * 同一个种子、同一个时刻，两次跑逐项相同；换一个种子，整串天气就换一串。
 *
 * 不存游标：`weatherSlotsBetween(prevNow, now)` 只看两头跨过了哪些槽，
 * 与 `ambientBetween` / `beatsBetween` 同一条约束。读档后 `now` 从存档接着走，
 * 槽号还是同一个整数，序列自然接上——不需要把「今天第几槽」写进存档。
 */

import { worldHours } from './pace.ts';
import { seedOf, unitFromSeed } from './memory/seed.ts';
import type { Weather } from './types.ts';
import { fadingToClear, weatherFor, type WeatherState } from './weather.ts';

/**
 * 一槽 4 世界小时，一天 6 槽。
 *
 * 为什么不是 6 小时：4 小时一槽时，玩家在 24 分钟的现实一日里能看见 6 次天气变化，
 * 雨、雾、晴都有机会出现；6 小时一槽一天只有 4 次，雾常常整天不露面。
 * 槽长只影响「多快换景」，不影响确定性——槽号与种子仍是纯整数。
 */
export const WEATHER_SLOT_MS = worldHours(4);

/** 自动排天只排这三档。`storm` 是一次天气事件，只由神谕点。 */
export type ScheduledWeather = Exclude<Weather, 'storm'>;

export interface WeatherSlot {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly kind: ScheduledWeather;
}

/** 某一时刻落在第几槽。负时间按第 0 槽算。 */
export function weatherSlotIndexAt(now: number): number {
  return Math.floor(Math.max(0, now) / WEATHER_SLOT_MS);
}

/**
 * 第 `slot` 槽的天气。
 *
 * 权重是晴 45% / 雨 30% / 雾 25%：晴多一点才像日常，雾少一点才像「天气」。
 * 抽签只用种子的高 24 位（`unitFromSeed`），不碰 `Math.random`。
 */
export function weatherForSlot(seed: string, slot: number): ScheduledWeather {
  const unit = unitFromSeed(seedOf(seed, slot, 'weather-slot'));
  if (unit < 0.45) return 'clear';
  if (unit < 0.75) return 'rain';
  return 'fog';
}

export function weatherSlotAt(seed: string, now: number): WeatherSlot {
  const index = weatherSlotIndexAt(now);
  return {
    index,
    start: index * WEATHER_SLOT_MS,
    end: (index + 1) * WEATHER_SLOT_MS,
    kind: weatherForSlot(seed, index),
  };
}

/**
 * `(prevNow, now]` 这段跨过的槽，按时间先后。
 *
 * 槽 0 的天气在构造时已经落过，所以 `prevNow = 0` 到 `now < 4h` 之间不返回任何槽；
 * 只返回真正跨过边界的那几槽。一次大 delta 跨过多槽时也全部返回，后者覆盖前者。
 */
export function weatherSlotsBetween(
  seed: string,
  prevNow: number,
  now: number,
): readonly WeatherSlot[] {
  const first = weatherSlotIndexAt(prevNow);
  const last = weatherSlotIndexAt(now);
  const slots: WeatherSlot[] = [];
  for (let index = first + 1; index <= last; index += 1) {
    slots.push({
      index,
      start: index * WEATHER_SLOT_MS,
      end: (index + 1) * WEATHER_SLOT_MS,
      kind: weatherForSlot(seed, index),
    });
  }
  return slots;
}

/**
 * 把当前天气接到这一槽上。
 *
 * 雨的剩余时长不写成固定的 2 小时，而是**写到槽尾**：否则一槽 4 小时里
 * 雨下 2 小时就自己转晴，槽的后半段与抽签结果对不上，序列看起来就像假的。
 * 转晴仍走 `fadingToClear`，浓淡从当前值慢慢退。
 */
export function scheduledWeatherState(
  current: WeatherState,
  slot: WeatherSlot,
  now: number,
): WeatherState {
  if (slot.kind === 'clear') return fadingToClear(current);
  const from = current.kind === 'clear' ? 0 : current.intensity;
  const next = weatherFor(slot.kind, from);
  return { ...next, remainingMs: Math.max(0, slot.end - now) };
}

/** 构造时用：当前时刻那一槽的天气。 */
export function scheduledWeatherAt(seed: string, now: number, current: WeatherState): WeatherState {
  return scheduledWeatherState(current, weatherSlotAt(seed, now), now);
}

/** 证据/测试用：从第 0 槽起连排 `count` 槽。 */
export function weatherSequence(seed: string, count: number): readonly ScheduledWeather[] {
  const slots = Math.max(0, Math.floor(count));
  return Array.from({ length: slots }, (_, index) => weatherForSlot(seed, index));
}
