import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOG_INITIAL_RADIUS,
  fogAt,
  revealedRadiusFor,
  wholeGridRadius,
  type FogState,
} from '../src/world/fog.ts';
import { LARGE_ALTAR, LARGE_WORLD_SPEC, SMALL_WORLD_SPEC } from '../src/world/setup.ts';

const CENTER = { x: 40, y: 30 };
const state = (radius: number): FogState => ({ center: CENTER, revealedRadius: radius });

/**
 * 地图上离祭坛最远那一格的**距离**，单位格。
 *
 * 从规格现算，不写死 96×72：`MAX_RADIUS` 这个上限跟着世界尺寸走，
 * 写死一个 60 就只能发现手改的那一半，改了规格那一半照样静。
 *
 * 用的是 `fogAt` 自己那把尺子——整数格坐标（`Math.hypot(point.x - center.x, …)`）。
 * 它量的是**格位**不是格心：最远那格的格心只差 59.30，而格位是 60.00。
 * 取大的那个，因为 `fogAt` 比的正是格位；60 也是「每一格都点得亮」的最小半径。
 */
const FARTHEST_CELL_DISTANCE = (() => {
  let farthest = 0;
  for (let y = 0; y < LARGE_WORLD_SPEC.height; y += 1) {
    for (let x = 0; x < LARGE_WORLD_SPEC.width; x += 1) {
      farthest = Math.max(farthest, Math.hypot(x - LARGE_ALTAR.x, y - LARGE_ALTAR.y));
    }
  }
  return farthest;
})();

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
  // 数也从规格现算：写死 60 与 MAX_RADIUS 的 58 各说各话，而 58 其实没到最远角。
  assert.ok(
    r3 <= FARTHEST_CELL_DISTANCE,
    `半径 ${r3} 越过了地图最远角 ${FARTHEST_CELL_DISTANCE.toFixed(2)}`,
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
    capped >= FARTHEST_CELL_DISTANCE,
    `上限只到 ${capped}，而最远格在 ${FARTHEST_CELL_DISTANCE.toFixed(2)}——` +
      `那一圈永远揭不亮，注释里「超过最远角就没有意义」也就成了空话`,
  );
  // 边界那一格压在半径上：必须算点亮。这一条守的是 `fogAt` 用严格 `>` 而不是
  // `>=`——MAX_RADIUS 现在就正好等于最远角距离，改成 `>=` 整张图的角就黑了。
  const corner = { x: 0, y: 0 };
  assert.equal(fogAt(corner, { center: LARGE_ALTAR, revealedRadius: capped }), false,
    '最远角那一格压在半径上，必须算已经点亮');
  // 真对照：半径收一格，同一格就该回雾里。少了这条，上面那条把 fogAt 桩成
  // 「永远返回 false」也能过——那正是它声称排除的失败。
  assert.equal(fogAt(corner, { center: LARGE_ALTAR, revealedRadius: capped - 1 }), true,
    '半径收一格，最远角那一格必须回到雾里');
});

test('揭示半径增长是阶梯的，不是每单都变', () => {
  // 同一档内的交付数给出同一个半径。
  assert.equal(revealedRadiusFor(4), revealedRadiusFor(7), '4 与 7 应落在同一档');
  // 跨档才变。
  assert.ok(revealedRadiusFor(8) > revealedRadiusFor(7), '跨档应当变大');
});

// ------------------------------------------------- 整图可见（设定集专用）

/**
 * 仓库里真有的三种网格形状，不编尺寸：
 * 96×72 是默认世界上限（`LARGE_WORLD_SPEC`），30×20 是小世界（`SMALL_WORLD_SPEC`），
 * 64×48 是灯潮界（`docs/` 下的设定集）。第三种写死而不引常量，因为它在 `src/` 里
 * 没有对应的规格对象——引不到就不要假装引到了。
 */
const GRID_SHAPES = [
  { width: LARGE_WORLD_SPEC.width, height: LARGE_WORLD_SPEC.height },
  { width: 64, height: 48 },
  { width: SMALL_WORLD_SPEC.width, height: SMALL_WORLD_SPEC.height },
];

/**
 * 网格里是否有一格在迷雾里。
 *
 * 圆心固定取左上角 (0,0)——那是离**所有**格子都最远的位置。所以「连这个圆心
 * 都盖得住」比「祭坛当圆心盖得住」强：后者只证明了一个圆心，前者证明了任意圆心。
 */
function anyFoggy(grid: { readonly width: number; readonly height: number }, radius: number): boolean {
  const center = { x: 0, y: 0 };
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (fogAt({ x, y }, { center, revealedRadius: radius })) return true;
    }
  }
  return false;
}

test('盖住整张网格的半径：设定集的地图整张都该是「已经到过的地方」', () => {
  for (const grid of GRID_SHAPES) {
    const radius = wholeGridRadius(grid);
    assert.equal(
      anyFoggy(grid, radius),
      false,
      `半径 ${radius} 盖不住 ${grid.width}×${grid.height}：还有格子在迷雾里，` +
        `而设定集的注释声称整张图都是已经到过的地方`,
    );
  }
});

test('整图半径的对照：只给一个宽，角上就漏回迷雾', () => {
  // 反面对照，证明上一条**会红**。上一条只断言「没有雾」，单看它像句永远为真的话；
  // 这一条把尺子架在**宽**上——圆心在左上角时最远那一格比宽远（96×72 是 118.6
  // 对 96），所以「return grid.width」这种实现会让上一条红在这儿。
  //
  // 它**不**防「取个大到离谱的数」：`revealedRadius` 的所有下游（`fogAt`、
  // `fog-view` 的渐隐、`fog-drift` 的烟圈半径）都只会「更大 = 揭得更开」，
  // 取 Infinity 与取 168 在画面上没有区别。那不是这条声称要防的失败，
  // 所以别把它写成这条的理由——写了的后果是下一个人真去防它，然后发现防不住。
  for (const grid of GRID_SHAPES) {
    assert.equal(
      anyFoggy(grid, grid.width),
      true,
      `${grid.width}×${grid.height} 在半径=宽 时居然没有迷雾——这条对照失效了，` +
        `说明这个形状量不出「宽不够」，上一条也就没有了牙齿`,
    );
  }
});
