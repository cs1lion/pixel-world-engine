/** 天气：三档，切换要渐变，不能秒切。
 *
 * 世界法则（神谕说下雨/暴雨）和自动退场都走这里。退场用时长而不是"下一拍就停"，
 * 否则雨幕会像开关灯一样跳。
 *
 * **`storm` 不是新机制。** 它和 `rain` 走同一条路，目标浓淡一样拉满到 1
 * （见下面 `TARGET_INTENSITY`），差别落在别处两样：下得更久（90 秒对 45 秒），
 * 以及 `renderIntensity` 给渲染层多加的那 0.25。
 * 所以这里多一档不需要渲染层加分支——这正是 v2 spec §4.4 说的
 * 「`storm` 是 `rain` 的强度档」。
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

/**
 * 天气的一两个字说法。
 *
 * **只有状态行从这里取**（`SandboxScene` 拼状态行那一句）。这里曾经写着「状态行、日报、
 * 喂给模型的世界现状都从这里取，免得三处各写一份三元判断」——那句话是假的：
 * 日报（`report.ts` 的天气那句）和喂模型的世界现状（`intent-context.ts` 的
 * 天气那句）各自写着自己的三元，一句话都没来过这儿。而这正是它说要防的那件事：
 * 三处三种说法，「外头晴着 / 天晴 / 晴」。
 *
 * 两句整话没法合成一张表：日报要「外头…着」的口气，喂模型要「天…」的口气，
 * 而状态行只要一两个字。所以不硬合，改为拿测试把**档位一致**钉住——
 * 三处对同一个 `Weather` 必须说出同一种天气（见 `weather-words.test.ts` 的
 * 「三处对同一档天气说出同一种天气」）。加第四档时漏掉哪一处，那条红。
 *
 * （上一版这儿挂着 `SandboxScene.ts` 的一个行号，而 `WEATHER_LABEL` 真正的读者
 * 在拼状态行那一句——偏了二十几行，`audit-references.ts` 还报「0 处存疑」：
 * 那一行有代码，所以它认，而它认不出那一行是不是说的那个东西。
 * 现在改成指名，不叫行号。）
 */
export const WEATHER_LABEL: Readonly<Record<Weather, string>> = {
  clear: '晴',
  rain: '雨',
  storm: '暴雨',
};

/**
 * 给渲染层的强度：暴雨在同样的 `intensity` 上再加一档。
 *
 * 为什么加在这里而不是渲染层：天气视图（`render/weather.ts`）只收这一个数，
 * 收齐了它就不必知道天气有几档——加第三档时它一行没改，就是这条设计的回报。
 * 整个 `src/render/` 只有两处碰天气，另一处是 `phase-view.ts` 的 `drawFireflies`
 * 调的那一句 `firefliesVisible`（**叫名字，不叫行号**：这里原先写
 * `phase-view.ts:197`，而行号跟着我自己的编辑漂——往 `drawFireflies` 里加一行，
 * 那个数指的就是别处了，而行号引用审计查不出来，因为那两行都"有代码"）。
 *
 * 这里原来写「`Simulation.weatherIntensity()` 是渲染层唯一的输入」，不成立——
 * 萤火虫也看天气。渲染层有两条天气通道：这条给浓淡，那条只给「是不是晴天」一个布尔。
 *
 * 「再加一档天气渲染层不用改」仍然是真的，但它**不是本来就有的，是补出来
 * 的**：萤火虫那句从 `996cbd3` 起写的是 `=== 'rain'`，那正是在数档位；加暴雨
 * 那一笔（`00d67ed`）改的就是它，改成 `!== 'clear'` 才不必再数。所以这条承诺
 * 靠两条通道一起做到，不是 `renderIntensity` 这一条独力。哪一天有人把
 * `!== 'clear'` 改回列举两种雨，红的是渲染层——而这句话已经先把原因写在这儿。
 *
 * （上面那句「哪一天有人把 `!== 'clear'` 改回列举两种雨，红的是渲染层」
 * 2026-10-27 才真的成立。此前它说的是空话：萤火虫那个天气条件**没有测试守着**，
 * `test/day-phase.test.ts` 只断言 `PHASES.night.fireflies` 这个配置值，
 * 没有一条用例把「暴雨天不该有萤火虫」跑成红。同日把那个条件从 `drawFireflies`
 * 里搬到 `day-phase.ts` 的 `firefliesVisible`——`drawFireflies` 长在一个 import
 * Phaser 的模块里，node 下一 import 就 `window is not defined`，用例根本跑不起来；
 * `day-phase.ts` 不碰 Phaser，测试已经在跑——并补了「萤火虫只要晴天的那几刻」
 * 与「加一档天气不必改这里」两条。现在把 `=== 'clear'` 改回列举两种雨，
 * 红的是 `test/day-phase.test.ts`。）
 *
 * 上限仍然是 1，因为插值的那几个量都是 0..1 语义。
 */
export function renderIntensity(state: WeatherState): number {
  if (state.kind !== 'storm') return state.intensity;
  // 加 0.25 而不是乘以系数：浓淡正在渐入时（比如 0.2）暴雨也该比雨重，
  // 乘法在低值时几乎看不出差别。
  return Math.min(1, state.intensity + 0.25);
}
