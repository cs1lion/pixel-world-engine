/** 天气：三档，切换要渐变，不能秒切。
 *
 * 世界法则（神谕说下雨/暴雨）和自动退场都走这里。退场用时长而不是"下一拍就停"，
 * 否则雨幕会像开关灯一样跳。
 *
 * **`storm` 不是新机制。** 它和 `rain` 走同一条路，只是目标浓淡更高、下得更久。
 * 渲染层本来就按 `intensity` 插值，所以这里多一档不需要渲染层加分支——
 * 这正是 v2 spec §4.4 说的「`storm` 是 `rain` 的强度档」。
 */

import type { Weather } from './types.ts';

/** 0..1 的浓淡，渲染层拿它插值雨幕。 */
export interface WeatherState {
  readonly kind: Weather;
  readonly intensity: number;
  /** 距离下一次自动变化还有多久；null 表示不会自己变。 */
  readonly remainingMs: number | null;
}

export const WEATHER_FADE_MS = 1800;
export const RAIN_DURATION_MS = 45_000;
/** 暴雨下得更久：它是一次天气事件，不是一阵过云雨。 */
export const STORM_DURATION_MS = 90_000;

/**
 * 每一档的目标浓淡。
 *
 * `clear` 是 0；`rain` 拉满到 1 —— 旧行为的量；`storm` 也是 1，
 * 因为强度上限就是 1。**暴雨与雨的差别因此必须落在别处**：
 * 更长的时长，以及渲染层按 `kind` 叠加的那一点（见 `weather-view`）。
 * 把 storm 的目标定到 >1 只会让插值永远差一截，看起来像雨没下完。
 */
const TARGET_INTENSITY: Readonly<Record<Weather, number>> = {
  clear: 0,
  rain: 1,
  storm: 1,
};

const DURATION_MS: Readonly<Record<Weather, number | null>> = {
  clear: null,
  rain: RAIN_DURATION_MS,
  storm: STORM_DURATION_MS,
};

/** 立刻放晴，浓淡归零。只用于初始化——运行中要转晴请用 `fadingToClear`。 */
export function clearWeather(): WeatherState {
  return { kind: 'clear', intensity: 0, remainingMs: null };
}

/**
 * 转晴：**从当前浓淡开始**慢慢退，而不是当场归零。
 *
 * 这条以前是漏的：`setWeather('clear')` 直接把状态换成 `clearWeather()`，
 * 雨幕一帧消失，正是注释里说要避免的"像开关灯一样跳"。
 * 现在换成这个，`stepWeather` 每拍把 `intensity` 往 0 推。
 */
export function fadingToClear(state: WeatherState): WeatherState {
  return { kind: 'clear', intensity: state.intensity, remainingMs: null };
}

/** 要下雨（或暴雨）。从当前浓淡开始渐入，不跳。 */
export function weatherFor(kind: Exclude<Weather, 'clear'>, intensity = 0): WeatherState {
  return { kind, intensity, remainingMs: DURATION_MS[kind] };
}

/** 旧名保留：只下普通的雨。 */
export function rainWeather(now: number): WeatherState {
  void now;
  return weatherFor('rain');
}

/** 推进浓淡与倒计时。天气自己到期就回到晴。 */
export function stepWeather(
  state: WeatherState,
  deltaMs: number,
): WeatherState {
  const target = TARGET_INTENSITY[state.kind];
  const step = deltaMs / WEATHER_FADE_MS;
  const intensity =
    state.intensity < target
      ? Math.min(target, state.intensity + step)
      : Math.max(target, state.intensity - step);

  if (state.remainingMs === null) return { ...state, intensity };

  const remaining = state.remainingMs - deltaMs;
  if (remaining > 0) return { ...state, intensity, remainingMs: remaining };
  return { kind: 'clear', intensity, remainingMs: null };
}

/** 渲染层判断"此刻还在下雨"用浓淡，不用 kind，避免刚转晴就立刻停雨。 */
export function isVisiblyRaining(state: WeatherState): boolean {
  return state.intensity > 0.05;
}

/** 天气的一两个字说法。状态行、日报、喂给模型的世界现状都从这里取，
 *  免得三处各写一份三元判断、加档时漏掉其中两处。 */
export const WEATHER_LABEL: Readonly<Record<Weather, string>> = {
  clear: '晴',
  rain: '雨',
  storm: '暴雨',
};

/**
 * 给渲染层的强度：暴雨在同样的 `intensity` 上再加一档。
 *
 * 为什么加在这里而不是渲染层：`Simulation.weatherIntensity()` 是渲染层唯一的输入，
 * 让它一次给全，渲染层就不必知道天气有几档——加第三档时渲染层一行没改，
 * 就是这条设计的回报。上限仍然是 1，因为插值的那几个量都是 0..1 语义。
 */
export function renderIntensity(state: WeatherState): number {
  if (state.kind !== 'storm') return state.intensity;
  // 加 0.25 而不是乘以系数：浓淡正在渐入时（比如 0.2）暴雨也该比雨重，
  // 乘法在低值时几乎看不出差别。
  return Math.min(1, state.intensity + 0.25);
}
