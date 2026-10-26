/**
 * 天气的退场与渲染语义——纯函数层的精确契约。
 *
 * 天气的**渐入**由 `world.test.ts` 钉；`fadingToClear` 那条修好的 bug 与
 * 「暴雨比雨重」在集成层也已粗守过（`tide-override.test.ts:251-270` 用
 * `setWeather('clear')` 后 `weatherIntensity() > wet*0.5` 断言转晴不跳变，
 * `:210-224` 用 `weatherIntensity()` 断言暴雨更重）。但那两处走的是
 * `Simulation`、用的是粗阈值，钉不死下面这些**精确值**——正是本文件补的：
 *
 *   1. **转晴不跳变。** `fadingToClear` 把当前浓淡原样留下（0.7 还是 0.7），
 *      交给 `stepWeather` 一级级退，而不是当场归零。
 *   2. **「还在下雨」看浓淡，不看 kind。** `isVisiblyRaining` 的阈值是严格
 *      `> 0.05`：刚转晴那一刻 kind 已是 clear、浓淡还没退完，仍算在下雨；
 *      雨刚起、浓淡还没过线，反而不算。这条集成层没碰过。
 *   3. **暴雨与雨的差别落在别处。** 两者目标浓淡都是 1，所以暴雨靠「下得更久」
 *      + 渲染层那一档（`renderIntensity` 的 +0.25，且夹在 1）区分开。
 *
 * 全是纯函数，不碰 Simulation、不碰渲染后端——天气是 now 的纯事实，
 * 同样的 (state, deltaMs) 永远得到同样的下一帧。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWeather,
  fadingToClear,
  isVisiblyRaining,
  renderIntensity,
  stepWeather,
  weatherFor,
  WEATHER_FADE_MS,
  RAIN_DURATION_MS,
  STORM_DURATION_MS,
  type WeatherState,
} from '../src/world/weather.ts';

// ------------------------------------------------------- 转晴不跳变

test('fadingToClear 保留当前浓淡，不把雨幕一秒掐掉', () => {
  // 这正是那条修好的 bug：直接换成 clearWeather() 会让 intensity 归零，
  // 雨幕这一帧还在、下一帧没了。fadingToClear 只翻 kind，浓淡原样交给
  // stepWeather 一级级退。集成层只粗守「掉不过一半」；这里钉死纯函数——
  // 浓淡原样是 0.7，一拍都没动。
  const raining: WeatherState = { kind: 'rain', intensity: 0.7, remainingMs: 12_000 };
  const clearing = fadingToClear(raining);
  assert.equal(clearing.kind, 'clear', '种类当场转晴');
  assert.equal(clearing.intensity, 0.7, '浓淡原样保留，不跳');
  assert.equal(clearing.remainingMs, null, '转晴没有倒计时');

  // 与「立刻放晴」对照：clearWeather 是初始化用的，浓淡归零。
  assert.equal(clearWeather().intensity, 0);
  assert.notEqual(clearing.intensity, clearWeather().intensity, '两者不是一回事');
});

test('转晴后浓淡一级级退到 0：递减、不为负、不一帧归零', () => {
  let state = fadingToClear({ kind: 'rain', intensity: 0.7, remainingMs: 1000 });
  const seen: number[] = [state.intensity];
  // 每拍 WEATHER_FADE_MS 的一半，0.7 → 0.2 → 0（两步退到底，之后保持 0）。
  for (let i = 0; i < 3; i += 1) {
    state = stepWeather(state, WEATHER_FADE_MS / 2);
    seen.push(state.intensity);
  }
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i]! <= seen[i - 1]!, `浓淡该只退不涨：${seen.join(' → ')}`);
  }
  assert.ok(seen[1]! > 0, '第一拍不该已经归零——那又是一帧切完');
  assert.equal(state.intensity, 0, '退到底必须是 0');
  assert.ok(seen.every((v) => v >= 0), '不为负');
});

test('到期只翻 kind，不把浓淡归零：雨停了，雨幕还在退', () => {
  // remainingMs 走完时 stepWeather 把 kind 换成 clear，但 intensity 由渐变
  // 公式算出（这里还在往 1 满，故不降）——只有 kind 翻过去。清零才会让
  // 到期那一帧雨幕突然消失；退场是靠后续的 stepWeather 完成的。
  const expiring: WeatherState = { kind: 'rain', intensity: 0.9, remainingMs: 100 };
  const after = stepWeather(expiring, 500);
  assert.equal(after.kind, 'clear', '到期转晴');
  assert.ok(after.intensity >= expiring.intensity,
    `到期不该把浓淡压下去：${expiring.intensity} → ${after.intensity}`);
  assert.equal(after.remainingMs, null, '转晴后没有倒计时');
});

// ------------------------------------------------------- 看浓淡，不看 kind

test('isVisiblyRaining 看浓淡不看 kind：刚转晴那一刻还算在下雨', () => {
  // kind 已是 clear、浓淡还没退完——这一刻视觉上仍在落雨，渲染层要接着画。
  assert.equal(isVisiblyRaining({ kind: 'clear', intensity: 0.1, remainingMs: null }), true,
    '刚转晴、浓淡还在，不能立刻停雨幕');
  // 反过来：kind 是 rain 但浓淡还没起来（刚下雨第一帧）——不算真在下。
  assert.equal(isVisiblyRaining({ kind: 'rain', intensity: 0.02, remainingMs: 45_000 }), false,
    '浓淡还没过线，不算看得见的雨');
  assert.equal(isVisiblyRaining({ kind: 'rain', intensity: 0.06, remainingMs: 45_000 }), true);
  // 阈值是严格大于：刚好压在 0.05 上不算，避免边界抖动。
  assert.equal(isVisiblyRaining({ kind: 'rain', intensity: 0.05, remainingMs: 45_000 }), false);
  assert.equal(isVisiblyRaining(clearWeather()), false, '全晴不算');
});

// ------------------------------------------------------- 暴雨与雨的差别

test('renderIntensity：暴雨加一档，且永不越过 1', () => {
  // 雨与晴原样返回——这一档只加在暴雨上。
  assert.equal(renderIntensity({ kind: 'rain', intensity: 0.5, remainingMs: 45_000 }), 0.5);
  assert.equal(renderIntensity({ kind: 'clear', intensity: 0.5, remainingMs: null }), 0.5);
  // 暴雨：+0.25，让它在同样浓淡下比雨更重。
  assert.equal(renderIntensity({ kind: 'storm', intensity: 0.5, remainingMs: 90_000 }), 0.75);
  // 但上限仍是 1：插值的那几个量都是 0..1 语义，越界会让渲染算出怪值。
  assert.equal(renderIntensity({ kind: 'storm', intensity: 0.9, remainingMs: 90_000 }), 1);
  assert.equal(renderIntensity({ kind: 'storm', intensity: 1, remainingMs: 90_000 }), 1);
});

test('暴雨与雨目标浓淡相同，差别全在时长', () => {
  // 注释把这点说得很死：storm 的目标也是 1（强度上限就是 1）。所以若只看
  // 目标浓淡，暴雨和雨一模一样——真正区分它的是「下得更久」。
  const rain = weatherFor('rain');
  const storm = weatherFor('storm');
  assert.equal(rain.remainingMs, RAIN_DURATION_MS);
  assert.equal(storm.remainingMs, STORM_DURATION_MS);
  assert.ok(STORM_DURATION_MS > RAIN_DURATION_MS,
    `暴雨该下得更久：${STORM_DURATION_MS} vs ${RAIN_DURATION_MS}`);
  // 拉满之后两者都正好是 1：暴雨的目标并不比雨高。若有人把 storm 的目标
  // 定到 >1（weather.ts 明确警告过），插值会永远差一截，这条先红。
  assert.equal(stepWeather(rain, 5 * WEATHER_FADE_MS).intensity, 1, '雨拉满是 1');
  assert.equal(stepWeather(storm, 5 * WEATHER_FADE_MS).intensity, 1, '暴雨拉满也是 1，目标不更高');
});

test('weatherFor 从指定浓淡渐入，时长对上，默认从零开始', () => {
  assert.deepEqual(weatherFor('rain'), { kind: 'rain', intensity: 0, remainingMs: RAIN_DURATION_MS });
  assert.deepEqual(weatherFor('storm', 0.3),
    { kind: 'storm', intensity: 0.3, remainingMs: STORM_DURATION_MS });
  // 从半浓淡起，一帧（WEATHER_FADE_MS）推进到满：step 恰为 1，被 target 夹住。
  const halfWay = weatherFor('rain', 0.4);
  assert.equal(stepWeather(halfWay, WEATHER_FADE_MS).intensity, 1, '一帧拉满');
});
