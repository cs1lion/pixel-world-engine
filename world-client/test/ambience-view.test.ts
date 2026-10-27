/**
 * 氛围层（天上的鸟与蝙蝠）在层叠里的位置，得一直是对的。
 *
 * `ambience-view.ts` 的文件头写着那句话：「压在角色之上、时相压暗（8009）之下：
 * 鸟在天上，但不该比夜色更亮。」两个断言，各有一种看不见的破法：
 *
 *   1. **鸟比夜色亮。** `DIM_DEPTH` 掉到 `AMBIENCE_DEPTH` 以下时，时相压暗那块
 *      矩形盖不住鸟——夜里鸟还是亮的。没有任何测试看画面，所以这件事要等到有人
 *      半夜盯屏才会发现。
 *   2. **鸟钻到人后面。** `AMBIENCE_DEPTH` 掉进行角色的 depth 带时，有的格子上
 *      鸟画在人背后。鸟在天上，这个破法违反的是常识，可 depth 是个数，
 *      改一个数不会有任何东西红。
 *
 * 这两个数都住在 import Phaser 的文件里，Node 里读不到（`building-depth.ts`
 * 的文件头记着同一个难题，它的解法是把算术抽成纯函数）。这里不需要抽——
 * 要守的是两个**常量的大小关系**，扫源码就够，用的正是 `source-scan.ts`
 * 那套剔注释的手法。所以这里只读常量，不 import 那两个视图。
 *
 * 顺带说明为什么这算一条真闸门而不是摆样子：`ambience-view.ts` 此前没有任何
 * 测试 import 它（`prose-numbers.ts` 至今还把它列在「没有任何测试 import 它」
 * 那一档，判据是 import，见下），那个文件的 depth 说法一行回归保护都没有。
 * 这是补上的第一条。
 *
 * 也要说清它**盖不住**的那一块：`prose-numbers.ts` 只认「有测试 import 它」
 * 这一种守卫，而本文件扫源码、不 import——`ambience-view.ts` import Phaser，
 * Node 里跑不起来。所以那个工具仍旧会把 8009 报成候选。那不是漏账，是两种
 * 守卫的判据不同：它答「有没有机器在看这个数」，这里答「层叠顺序还是不是
 * 对的」。真要让它闭嘴，得给它加一条「扫到源文件的测试也算」的判据——
 * 那是它的改动，不在这里顺手做。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { codeOf } from './source-scan.ts';
import { LARGE_WORLD_SPEC } from '../src/world/setup.ts';
import { actorDepthAt } from '../src/render/building-depth.ts';

const SRC = new URL('../src/render/', import.meta.url);

/** 从一个源码文件里读出一个数字常量的值。注释已经由 `codeOf` 剔掉。 */
function constOf(file: string, name: string): number {
  const m = codeOf(new URL(file, SRC)).match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  assert.ok(m !== null, `${file} 里找不到 const ${name}`);
  const n = m[1];
  assert.ok(n !== undefined, `${file} 里 ${name} 没有数值`);
  return Number(n);
}

const AMBIENCE_DEPTH = constOf('ambience-view.ts', 'AMBIENCE_DEPTH');
const DIM_DEPTH = constOf('phase-view.ts', 'DIM_DEPTH');
const FOG_DEPTH = constOf('fog-view.ts', 'FOG_DEPTH');

/**
 * 角色 depth 的基准高度。
 *
 * `SandboxScene.ts` 把它传给 `updateVillager(view, villager, now, 0, 0, ALTITUDE)`
 * （原点是 0,0）。它是那个文件的私有常量，读源码取——与 `building-depth.ts`
 * 里「改一处必须改两处」是同一条规矩，这里多一处耦合，换来的是能在 Node 里验算。
 */
const ALTITUDE = constOf('../scenes/SandboxScene.ts', 'ALTITUDE');

test('鸟在时相压暗之下：夜里鸟跟着一起暗，不会比夜色更亮', () => {
  assert.ok(
    AMBIENCE_DEPTH < DIM_DEPTH,
    `氛围层 ${AMBIENCE_DEPTH} 不该盖过时相压暗 ${DIM_DEPTH}——` +
      '盖过了，夜里的鸟就还是亮的，而没有任何测试会看画面',
  );
});

test('鸟压在角色之上：鸟在天上，不钻到人背后', () => {
  // 角色 depth = ALTITUDE + (pos.y + 1) * TILE_PX + 8，最深的一行是界内最后一行。
  const deepestActor = actorDepthAt(LARGE_WORLD_SPEC.height - 1, ALTITUDE);
  assert.ok(
    AMBIENCE_DEPTH > deepestActor,
    `氛围层 ${AMBIENCE_DEPTH} 该在最深的角色 ${deepestActor} 之上——` +
      '掉进行角色的 depth 带，有的格子上鸟就画到人背后去了',
  );
});

test('氛围层在迷雾之上：雾里的鸟看得见，不叫雾整个糊掉', () => {
  // 这一条不是文件头那句话的一部分，是它成立的位置前提：迷雾 7950、氛围 7990。
  // 两条挨得近，改迷雾那一侧时容易一手压过鸟——压过了鸟就跟着雾一起消失，
  // 而「视野外的鸟不画」本来就已经由 `shouldAnimateAt` 管着，两件事会互相掩盖。
  assert.ok(
    AMBIENCE_DEPTH > FOG_DEPTH,
    `氛围层 ${AMBIENCE_DEPTH} 该在迷雾 ${FOG_DEPTH} 之上——并反了鸟会跟着雾一起被盖掉`,
  );
});
