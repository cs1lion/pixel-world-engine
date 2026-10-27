import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOG_INITIAL_RADIUS,
  fogAt,
  revealedRadiusFor,
  type FogState,
} from '../src/world/fog.ts';
import { LARGE_WORLD_SPEC } from '../src/world/setup.ts';
import { LARGE_ALTAR } from '../src/world/setup.ts';

const CENTER = { x: 40, y: 30 };
const state = (radius: number): FogState => ({ center: CENTER, revealedRadius: radius });

/**
 * 地图上离祭坛最远的那格，单位格。
 *
 * 从规格现算，不写死 96×72：改了 `LARGE_WORLD_SPEC` 或 `LARGE_ALTAR`，
 * 凡是引用「约 60 格」的注释与上限都该跟着动，写死就发现不了。
 *
 * 用的是 `fogAt` 自己那把尺子——整数格坐标（`Math.hypot(point.x - center.x, …)`）。
 */
function farthestCell(): number {
  let farthest = 0;
  for (let y = 0; y < LARGE_WORLD_SPEC.height; y += 1) {
    for (let x = 0; x < LARGE_WORLD_SPEC.width; x += 1) {
      farthest = Math.max(farthest, Math.hypot(x - LARGE_ALTAR.x, y - LARGE_ALTAR.y));
    }
  }
  return farthest;
}

// ------------------------------------------------------------------ 判定

test('初始只点亮镇中心一圈，外围是迷雾', () => {
  assert.ok(FOG_INITIAL_RADIUS >= 10, '至少盖住整个核心镇');
  const s = state(FOG_INITIAL_RADIUS);
  assert.equal(fogAt(CENTER, s), false, '中心不该有雾');
  assert.equal(fogAt({ x: CENTER.x + FOG_INITIAL_RADIUS - 1, y: CENTER.y }, s), false);
  assert.equal(fogAt({ x: CENTER.x + FOG_INITIAL_RADIUS + 1, y: CENTER.y }, s), true);
});

test('迷雾判定是纯函数：同输入同输出', () => {
  const s = state(20);
  const p = { x: 55, y: 30 };
  assert.equal(fogAt(p, s), fogAt(p, s));
});

test('半径扩大后，原本有雾的地方被点亮', () => {
  const p = { x: CENTER.x + 25, y: CENTER.y };
  assert.equal(fogAt(p, state(20)), true);
  assert.equal(fogAt(p, state(30)), false);
});

test('揭示是单向的：交付数再少也不会小于初始半径', () => {
  // 参数是**交付单数**，不是半径。
  assert.equal(revealedRadiusFor(0), FOG_INITIAL_RADIUS);
  assert.equal(revealedRadiusFor(1), FOG_INITIAL_RADIUS);
  assert.equal(revealedRadiusFor(Number.NaN), FOG_INITIAL_RADIUS, '坏数字退回初始值');
  assert.ok(revealedRadiusFor(30) > FOG_INITIAL_RADIUS, '交付多了会变大');
});

// ------------------------------------------------------------------ 与交付挂钩

test('交付越多，揭示越大，但有上限', () => {
  const r1 = revealedRadiusFor(0);
  const r2 = revealedRadiusFor(10);
  const r3 = revealedRadiusFor(1000);
  assert.ok(r2 > r1, '交付 10 单应比 0 单揭得多');
  assert.ok(r3 > r2);
  // 原话是「半径不该超过地图半宽」——半宽是 48，约 60 的是**最远角**，名字错了。
  // 数也从规格现算，不写死 60：写死的那个 60 与 MAX_RADIUS 的 58 各说各话，
  // 而 58 其实没到最远角（见下一条）。
  assert.ok(
    r3 <= farthestCell(),
    `半径 ${r3} 越过了地图最远角 ${farthestCell().toFixed(2)}`,
  );
});

/**
 * 揭示半径的上限必须够到地图最远角。
 *
 * `MAX_RADIUS` 的理由原文是「地图最远角约 60，超过它就没有意义了」——
 * 可它取 58，而最远角在 60.0（`fogAt` 的整数格尺子）。58 **没到**那儿，
 * 于是四角各剩一小撮永远揭不亮：实测 19 格 / 6912 = 0.27%。
 * 「交付越多看见越多」到顶了也看不见全图，而注释说的理由是另一件事。
 *
 * 这条把上限钉在规格上：谁把世界改大，上限不跟着动，这里就红。
 */
test('揭示半径的上限够得到最远角：不留永远揭不亮的一圈', () => {
  const capped = revealedRadiusFor(Number.MAX_SAFE_INTEGER);
  assert.ok(
    capped >= farthestCell(),
    `上限只到 ${capped}，而最远格在 ${farthestCell().toFixed(2)}——` +
      `那一圈永远揭不亮，注释里「超过最远角就没有意义」也就成了空话`,
  );
  // 反面对照：真有那么一格在上限之外，它就该报有雾——否则这条是空过的。
  assert.equal(fogAt({ x: 0, y: 0 }, { center: LARGE_ALTAR, revealedRadius: capped }), false,
    '最远角那一格在顶格半径下必须已经点亮');
});

test('揭示半径增长是阶梯的，不是每单都变', () => {
  // 同一档内的交付数给出同一个半径。
  assert.equal(revealedRadiusFor(4), revealedRadiusFor(7), '4 与 7 应落在同一档');
  // 跨档才变。
  assert.ok(revealedRadiusFor(8) > revealedRadiusFor(7), '跨档应当变大');
});
