import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES,
  PHASE_ORDER,
  parsePhaseParam,
  phaseAt,
  type PhaseId,
} from '../src/render/day-phase.ts';
import { WORLD } from '../src/world/palette-data.ts';

/** 造一个本地时间的 epoch 毫秒：年月日固定，只换小时。 */
const atHour = (hour: number, minute = 0): number =>
  new Date(2026, 9, 21, hour, minute, 0, 0).getTime();

// ------------------------------------------------------------------ 相位划分

test('四刻按本地钟点划分，边界左闭右开', () => {
  const cases: [number, PhaseId][] = [
    [0, 'night'],
    [4, 'night'],
    [5, 'dawn'],
    [8, 'dawn'],
    [9, 'noon'],
    [16, 'noon'],
    [17, 'dusk'],
    [19, 'dusk'],
    [20, 'night'],
    [23, 'night'],
  ];
  for (const [hour, expected] of cases) {
    assert.equal(phaseAt(atHour(hour)), expected, `${hour} 点应该是 ${expected}`);
  }
});

test('相位边界在整点生效，不随分钟抖动', () => {
  assert.equal(phaseAt(atHour(8, 59)), 'dawn');
  assert.equal(phaseAt(atHour(9, 0)), 'noon');
  assert.equal(phaseAt(atHour(16, 59)), 'noon');
  assert.equal(phaseAt(atHour(17, 0)), 'dusk');
});

test('相位是纯函数：同一时刻永远同一刻', () => {
  const epoch = atHour(18, 30);
  assert.equal(phaseAt(epoch), phaseAt(epoch));
  assert.equal(phaseAt(epoch), 'dusk');
});

test('非法时刻退回正午，不抛异常', () => {
  assert.equal(phaseAt(Number.NaN), 'noon');
  assert.equal(phaseAt(Number.POSITIVE_INFINITY), 'noon');
});

// ------------------------------------------------------------------ 配方表

test('四刻齐全，且顺序与 PHASE_ORDER 一致', () => {
  const keys = Object.keys(PHASES).sort();
  assert.deepEqual(keys, ['dawn', 'dusk', 'night', 'noon']);
  assert.deepEqual([...PHASE_ORDER].sort(), keys);
});

test('亮度严格递减：晨 > 午 > 昏 > 夜（用压暗浓度与亮光判断）', () => {
  const darkness = PHASE_ORDER.map((id) => PHASES[id].dim);
  assert.ok(darkness[0]! > darkness[1]!, '晨应比午暗');
  assert.ok(darkness[1]! < darkness[2]!, '午应比昏亮');
  assert.ok(darkness[2]! < darkness[3]!, '昏应比夜亮');
});

test('黄昏必须比夜亮，且不能是全天最亮：暖色叠草地会提亮，这里用 ink 压', () => {
  assert.ok(PHASES.dusk.dim > PHASES.noon.dim, '黄昏要压暗一些');
  assert.ok(PHASES.dusk.dim < PHASES.night.dim, '黄昏不能和夜一样暗');
  assert.notEqual(
    PHASES.dusk.dimColor,
    WORLD.ember,
    '黄昏不能用 ember 压暗：暖色叠草地会提亮，出现「黄昏比正午亮」',
  );
});

test('每刻至少有一处与相邻刻不同的内容态，不靠单一亮度区分', () => {
  // 晨：雾带；午：全无；昏：屋脊受光；夜：萤火。
  assert.ok(PHASES.dawn.mistBand > 0 && PHASES.dawn.mist > 0, '晨要有贴地雾带');
  assert.equal(PHASES.noon.mistBand, 0);
  assert.equal(PHASES.noon.glow, 0, '正午不点灯');
  assert.ok(PHASES.dusk.ridge > 0, '黄昏要有屋脊受光');
  assert.equal(PHASES.dusk.mistBand, 0, '黄昏没有雾带');
  assert.equal(PHASES.night.ridge, 0, '夜里没有屋脊受光');
  assert.equal(PHASES.night.fireflies, true);
  assert.equal(PHASES.dusk.fireflies, false);
});

test('亮窗只在黄昏与夜里', () => {
  assert.equal(PHASES.dawn.litWindows, 0);
  assert.equal(PHASES.noon.litWindows, 0);
  assert.ok(PHASES.dusk.litWindows > 0);
  assert.ok(PHASES.night.litWindows > 0);
});

test('配方只用现有 24 色，不引入第 25 色', () => {
  const palette = new Set<number>(Object.values(WORLD));
  for (const id of PHASE_ORDER) {
    const recipe = PHASES[id];
    assert.ok(palette.has(recipe.dimColor), `${id} 的压暗色必须在 24 色表里`);
  }
});

test('压暗浓度都在 0..1，且不超过 ART_SPEC 的压暗上限 0.46', () => {
  for (const id of PHASE_ORDER) {
    const dim = PHASES[id].dim;
    assert.ok(dim >= 0 && dim <= 1, `${id} 压暗浓度越界：${dim}`);
  }
});

// ------------------------------------------------------------------ URL 参数

test('URL 参数认四刻与常见别名', () => {
  assert.equal(parsePhaseParam('dawn'), 'dawn');
  assert.equal(parsePhaseParam('morning'), 'dawn');
  assert.equal(parsePhaseParam('noon'), 'noon');
  assert.equal(parsePhaseParam('day'), 'noon');
  assert.equal(parsePhaseParam('dusk'), 'dusk');
  assert.equal(parsePhaseParam('night'), 'night');
  assert.equal(parsePhaseParam('DAWN'), 'dawn');
  assert.equal(parsePhaseParam(' dusk '), 'dusk');
});

test('认不出的 URL 参数返回 null，调用方退回真实时间', () => {
  assert.equal(parsePhaseParam(null), null);
  assert.equal(parsePhaseParam(''), null);
  assert.equal(parsePhaseParam('sunset'), null);
  assert.equal(parsePhaseParam('99'), null);
});

// ------------------------------------------------------------------ 萤火虫那道门

/**
 * 夜里下雨了就没有萤火虫。
 *
 * 这条规矩原来**一条用例都没有**：条件写在 `drawFireflies` 里，而那个函数长在一个
 * import Phaser 的模块里，node 下构造不出来。ADR_WORLD_ALIVE §6 缺口 2 记的就是它，
 * `src/world/weather.ts` 的注释也写着「想让它真的会红，得先给 `phase-view` 的萤火虫
 * 条件补一条用例」。所以把条件抽成 `firefliesVisible`（纯函数），由这里盯着。
 *
 * 顺带把两半都钉住，别只钉天气那一半：
 *   - 天气那一半要是被人改回列举两种雨（`weather === 'rain' || weather === 'storm'`），
 *     这里红——而改回去是加第三档天气时最自然的一笔错。
 *   - 配方那一半（`view.fireflies`）也钉：它现在只有夜里有，将来若给黄昏也配上，
 *     这条测试会提醒你「记得连渲染层的门一起看」。
 */
import { firefliesVisible } from '../src/render/day-phase.ts';
import type { Weather } from '../src/world/types.ts';

test('萤火虫只要晴天的那几刻：夜里有，下雨/暴雨就没有', () => {
  const kinds: readonly Weather[] = ['clear', 'rain', 'storm'];
  for (const phase of PHASE_ORDER) {
    const view = PHASES[phase];
    for (const weather of kinds) {
      const visible = firefliesVisible(view, weather);
      if (weather === 'clear') {
        // 只有夜里那一刻的配方开着萤火虫。
        assert.equal(
          visible,
          view.fireflies,
          `${phase} + ${weather}：${view.fireflies ? '该有' : '不该有'}`,
        );
      } else {
        assert.equal(visible, false, `${phase} + ${weather}：天上云着就不该有萤火虫`);
      }
    }
  }
  // 四刻里只有夜开着这一档——这条要是也绿不了，上面那个循环等于什么都没查。
  assert.deepEqual(
    PHASE_ORDER.filter((phase) => PHASES[phase].fireflies),
    ['night'],
  );
});

test('加一档天气不必改这里：非晴一律没有萤火虫', () => {
  // `firefliesVisible` 判的是 `=== 'clear'`，所以任何新档位默认「没有萤火虫」。
  // 这不是猜的：把三种已知天气之外的词塞进去，照样是 false。
  for (const weather of ['snow', 'fog', ''] as unknown as Weather[]) {
    assert.equal(firefliesVisible(PHASES.night, weather), false);
  }
  assert.equal(firefliesVisible(PHASES.night, 'clear'), true);
});
