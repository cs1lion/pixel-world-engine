/**
 * 「一世界日要多少真实秒」——以及 §3.1 那个 `900` 今天达不达得到。
 *
 * ## 为什么要有这个文件
 *
 * `test/memory-day.test.ts` 钉的是**一天有多长**（24 世界小时，三处代码常量）。
 * `test/day-length-prose.test.ts` 钉的是**散文与那个数一致**。两个都绿，
 * 而「现实里看完一天要多久」这个**节奏**目标没有任何东西量。
 *
 * 于是有一段注释可以一直说下去而不会响：`src/world/memory/config.ts` 第 3 条
 * 纪律写着「`day_length_seconds = 900` 是节奏目标，由前端时间倍率承担」。
 * 机制那句话是对的，算术那句话没人核过——而这个仓库最不容的正是
 * 「读起来像真的、其实一次都没实现过」。
 *
 * ## 今天量出来（2026-10-28）
 *
 * `paceFrame` 稳定给出 **10 步/真实秒**，与帧率无关（60 / 30 / 20 / 10fps
 * 全都一样——池子按真实毫秒灌，每步只吃 `LOGIC_STEP_MS`）。每步推进
 * `LOGIC_STEP_MS × timeScale` 的世界时间，所以
 *
 * ```
 * 一世界日的真实秒数 = DAY_MS / (10 × LOGIC_STEP_MS × timeScale)
 *                   = DAY_MS / (1000 × timeScale)
 * ```
 *
 * | `timeScale` | 一世界日 | 相对 900 秒目标 |
 * | --- | --- | --- |
 * | 60（默认，也是上限） | 1440 秒（24 分钟） | 1.6 倍 |
 * | 96（要达标需要） | 900 秒（15 分钟） | 达标 |
 *
 * 这张表只适用于**默认的游玩时间驱动**（页面开着按倍率走、关页面即冻结），
 * 也适用于显式 `?clock=fast` / `?speed=`；显式 `?clock=real` 是 1:1，
 * 一世界日就是 24 小时。门槛写死 `MAX_TIME_SCALE = 60`——**900 秒这个目标
 * 在许可范围内永远达不到**。§3.1 给这个数的理由（「1 小时现实工作刚好经历
 * 4 个游戏日」）同样不成立：默认 60 下一小时经历 2.5 个世界日。
 *
 * ## 这一条**不**查什么
 *
 * - **不裁该选哪条路。** 抬上限还是回去改 §3.1，是设计决定，不是测试能定的。
 *   这条只保证「现状是多少」有人钉着：谁改了默认倍率、改了上限、改了步长，
 *   表会跟着动，而红的是那句话。
 * - **不查 `paceFrame` 自己算得对不对。** 那是 `eco-mode.test.ts` 与
 *   `frame-pace.test.ts` 的事。
 * - **不查世界内部有没有第二个时钟。** `timeScale` 只放大步长这一条由
 *   `SandboxScene` 的注释主张，本条只从外部量总账。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paceFrame } from '../src/render/eco-mode.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { DEFAULT_FAST_TIME_SCALE, MAX_TIME_SCALE } from '../src/world/real-clock.ts';

const LOGIC_STEP_MS = 100;

/** §3.1 的节奏目标：常态下一个世界日该花多少真实秒。 */
const TARGET_SECONDS = 900;

/**
 * 两个数从 `real-clock.ts` 读，不在这里重抄。
 *
 * 抄一份就多一处会漂的地方，而这两个数正是本条要盯的对象——抄了就成了
 * 「测试里写 60，代码里已经改成 120，测试照旧绿」。`SandboxScene` 的加速入口
 * 现在走 `resolveClockSelection`，这两个常量就是它的默认与上限。
 */
function readClockConstants(): { readonly defaultScale: number; readonly maxScale: number } {
  const text = readFileSync(new URL('../src/world/real-clock.ts', import.meta.url), 'utf8');
  const def = text.match(/DEFAULT_FAST_TIME_SCALE = (\d+)/);
  const max = text.match(/MAX_TIME_SCALE = (\d+)/);
  assert.ok(def !== null, 'real-clock.ts 里找不到 `DEFAULT_FAST_TIME_SCALE = N`——默认倍率换了写法，回来改这条判据');
  assert.ok(max !== null, 'real-clock.ts 里找不到 `MAX_TIME_SCALE = N`——上限换了写法，回来改这条判据');
  return { defaultScale: Number(def[1]), maxScale: Number(max[1]) };
}

/** 按给定帧率跑真实的一秒，数 `paceFrame` 给出几步。 */
function stepsPerRealSecond(fps: number): number {
  const elapsed = 1000 / fps;
  let pool = 0;
  let steps = 0;
  for (let frame = 0; frame < Math.round(fps); frame += 1) {
    const pace = paceFrame(pool, elapsed, LOGIC_STEP_MS, 5);
    pool = pace.leftover;
    steps += pace.steps;
  }
  return steps;
}

/** 一世界日花多少真实秒。 */
function realSecondsPerDay(timeScale: number, steps: number): number {
  return DAY_MS / (steps * LOGIC_STEP_MS * timeScale);
}

test('paceFrame 给的步数与帧率无关：10 步/真实秒', () => {
  // 这一条是全表的地基。它不是恒等式——池子按真实毫秒灌、每步只吃
  // `LOGIC_STEP_MS`，所以稳态下步数只由 `LOGIC_STEP_MS` 决定。哪天
  // `paceFrame` 改成按帧数喂，这条会红，而下面那张表就整体失效了。
  for (const fps of [60, 30, 20, 10]) {
    assert.equal(stepsPerRealSecond(fps), 10, `${fps}fps 下的稳态步数`);
  }
});

test('倍率模式下的一世界日：默认 24 分钟，默认就在上限', () => {
  const steps = stepsPerRealSecond(60);
  const { defaultScale, maxScale } = readClockConstants();
  assert.equal(
    realSecondsPerDay(defaultScale, steps),
    1440,
    `默认倍率 ${defaultScale} 下一世界日该是 24 分钟`,
  );
  assert.equal(realSecondsPerDay(maxScale, steps), 1440, `上限倍率 ${maxScale} 下一世界日也是 24 分钟`);
  assert.equal(defaultScale, DEFAULT_FAST_TIME_SCALE, '源码里的默认倍率与导出的常量一致');
  assert.equal(maxScale, MAX_TIME_SCALE, '源码里的上限与导出的常量一致');
});

test('§3.1 那个 900 秒，在倍率模式的范围内达不到', () => {  // 倍率模式，不含显式真实时钟
  const steps = stepsPerRealSecond(60);
  const { maxScale } = readClockConstants();
  // 要 900 秒一日，需要把倍率抬到多少。
  const needed = DAY_MS / TARGET_SECONDS / (steps * LOGIC_STEP_MS);
  assert.ok(
    needed > maxScale,
    `900 秒一日需要 timeScale = ${needed.toFixed(1)}，而 ?speed= 的上限是 ${maxScale}——`
      + '这条红说明上限被抬过（或者步长改过），那时 §3.1 的节奏目标可能第一次真的可达，'
      + '回来把 config.ts 第 3 条纪律与 docs/SPEC.md 一起改对。',
  );
  // 顺带钉住「最接近也差多少」：上限倍率下仍比目标慢 60%。
  const best = realSecondsPerDay(maxScale, steps);
  assert.ok(best > TARGET_SECONDS, `上限倍率下一日 ${best} 秒，仍慢于 ${TARGET_SECONDS} 秒目标`);
});
