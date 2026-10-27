/**
 * 潮汐判据只有一个出处。
 *
 * 这条规则原先在**两处各写了一份字面量**：`routines.ts` 的退回判定与
 * `simulation.ts` 的快进判定，两边都是 `> 0.34` 与 `< 0.6`，没有 import 同一个
 * 常量。两份手抄的规则必然分叉——改一处忘另一处时，世界会一边说「现在不行」
 * 一边把她送过去，而画面上那只表现为「她偶尔晚一步」，看不出来。
 *
 * 现在两处都走 `routines.ts` 的 `tideBeatApplies`，两个数收在 `tide.ts`
 * （`TIDE_LOW_MAX` / `TIDE_HIGH_MIN`）。这一条盯的就是「别再有第三份」。
 *
 * 三条各自盯一件不同的事，缺一件这个闸门就有一个方向的盲区：
 *   1. **源码里没有裸判据**——`src/` 任何一处都不许拿字面量与这两条线比。
 *      正则的两个数从 `tide.ts` **读**，不写死：改了常量，闸门跟着改。
 *   2. **压线那一格算过得去**——`low` 是 `<=`、`high` 是 `>=`。两份手抄最
 *      容易在这一点上差一个等号，而那是唯一看不见的分叉。
 *   3. **`routineFor` 的退回归这道判据管**——放行原落点当且仅当判据说去得了。
 *      防的是把条件又抄回 `routineFor`：抄回去时与 `simulation.ts` 那边
 *      差一个等号，牌子与快进就在不同潮位上分叉。
 * 外加一条结构检查：`simulation.ts` 真的在调这道判据（`docs/SPEC_V2.md` §3
 * 「可验证性」第 33 条——潮汐、灯油、时辰三者谁读谁各有一条源码扫描锁住，
 * 这里是潮汐那一份）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIDE_HIGH_MIN, TIDE_LOW_MAX } from '../src/world/tide.ts';
import { routineFor, tideBeatApplies, type RoutineBeat } from '../src/world/routines.ts';
import { codeOf, sourceFiles, srcRelative } from './source-scan.ts';

/**
 * 一个潮汐门槛值在源码里可能长成的样子。
 *
 * `String(0.6)` 是 `"0.6"`，而源码里完全可以写 `0.60`——同一个数，另一种
 * 写法。**把末尾的 0 放开**：一个「换写法就能绕过的闸门」比没有闸门更糟，
 * 它给人一个假的安全感。放开之后 `0.6` / `0.60` / `0.600` 都认。
 */
function literalPattern(value: number): string {
  const [whole, frac = ''] = String(value).split('.');
  return `${whole}\\.${frac.replace(/0+$/, '')}0*`;
}

test('src/ 里没有任何一处拿裸字面量与这两条潮汐线比', () => {
  const srcRoot = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const patterns = [TIDE_LOW_MAX, TIDE_HIGH_MIN].map(literalPattern);
  // 任何一边与这两个数之一作比较。不锚变量名：锚了名字，`lvl > 0.34` 这种
  // 换个名字的写法就能绕过去。
  const COMPARISON = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_.])[A-Za-z0-9_.]+\s*(?:>=|<=|>|<)\s*(?:${patterns.join('|')})\b`,
  );

  const offenders: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const rel = srcRelative(file, srcRoot);
    codeOf(file)
      .split('\n')
      .forEach((line, index) => {
        if (COMPARISON.test(line)) offenders.push(`${rel}:${index + 1}  ${line.trim()}`);
      });
  }

  assert.deepEqual(
    offenders,
    [],
    '这两条潮汐线只许在 `tide.ts` 声明、`tideBeatApplies` 读取。'
      + '别处再写一份字面量，就是让两份规则分叉：\n' + offenders.join('\n'),
  );
});

test('压线那一格算过得去：low 是 <=，high 是 >=', () => {
  // 两份手抄的判据最容易在「压线那一格算不算」上分叉：一边 `> 0.34` 退回，
  // 一边 `>= 0.34` 退回。差的是潮位正好压在线上时她去不去得了。
  // 这一条把选择钉住——要改它的人得先改这儿，而不是两处各改一处。
  assert.equal(tideBeatApplies('low', TIDE_LOW_MAX), true, '正好在低潮线上：过得去');
  assert.equal(tideBeatApplies('low', TIDE_LOW_MAX + 1e-9), false, '高过一线：去不了');
  assert.equal(tideBeatApplies('high', TIDE_HIGH_MIN), true, '正在高潮线上：过得去');
  assert.equal(tideBeatApplies('high', TIDE_HIGH_MIN - 1e-9), false, '差一线：去不了');

  // 没写 `tide` 的落点不挑潮位：它不是「永远退潮」，是「与潮位无关」。
  assert.equal(tideBeatApplies(undefined, 0), true);
  assert.equal(tideBeatApplies(undefined, 1), true);
});

test('routineFor 放行原落点，当且仅当这道判据说去得了', () => {
  // 防的是把条件又抄回 `routineFor`。抄回去时它与 `simulation.ts` 的快进
  // 判定就是两份，差一个等号，牌子与快进在不同潮位上分叉。
  const beats: readonly RoutineBeat[] = [
    { id: 'altar', label: '在旧站牌下认路', going: '去旧站牌下', target: { x: 19, y: 15 }, dwellMs: 6500 },
    { id: 'promenade', label: '点亮楼前的长灯', going: '去楼前', target: { x: 32, y: 27 }, dwellMs: 5800 },
    { id: 'promenade', label: '满潮时收起滩边的灯', going: '去滩边收灯', target: { x: 39, y: 29 }, dwellMs: 4800, tide: 'high' },
    { id: 'promenade', label: '趁退潮拾回还能用的灯芯', going: '去滩边拾灯芯', target: { x: 50, y: 42 }, dwellMs: 6000, tide: 'low' },
  ];
  // 门槛那一格也在扫的范围内：`<=` 与 `<` 的差别就在这儿。
  const levels = [0, 0.1, TIDE_LOW_MAX, 0.45, TIDE_HIGH_MIN, 0.9, 1];

  for (const level of levels) {
    for (let index = 0; index < beats.length; index += 1) {
      const beat = beats[index]!;
      const got = routineFor('clear', beats, index, level);
      if (tideBeatApplies(beat.tide, level)) {
        assert.equal(
          got,
          beat,
          `潮位 ${level} 时「${beat.label}」该原样放行——它被改写了`,
        );
      } else {
        assert.notEqual(
          got,
          beat,
          `潮位 ${level} 时「${beat.label}」该退回锚点——它照原样放行了`,
        );
      }
    }
  }
});

test('Simulation 的快进判定调的是这道判据，tide.ts 也没请回死常量', () => {
  const simulation = codeOf(new URL('../src/world/simulation.ts', import.meta.url));
  assert.match(
    simulation,
    /tideBeatApplies\(/,
    '快进判定必须走 `tideBeatApplies`。自己比一遍的话，它与 `routineFor` 的'
      + '退回判定就是两份规则，改一处忘另一处，世界一边说「现在不行」一边送她过去',
  );

  // `TIDE_FLOOD_LEVEL` 曾经 export 出来而全仓零个读者，它的注释还把「草地
  // 进水」这个效果归给它——读的人会去改它，然后发现什么都没变。已经删了，
  // 别再请回来。
  const tide = codeOf(new URL('../src/world/tide.ts', import.meta.url));
  assert.doesNotMatch(
    tide,
    /TIDE_FLOOD_LEVEL/,
    '真正决定淹不淹的是 `TERRAIN_HEIGHT` 与 `isFlooded`，不是任何一个潮位阈值',
  );
});
