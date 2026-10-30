import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { WORLD } from '../src/world/palette-data.ts';
import type { WorldPalette } from '../src/world/theme.ts';
import type { WorldGrid } from '../src/world/grid.ts';
import type { TerrainId } from '../src/world/types.ts';
import {
  REGION_PATCHES,
  drawRegionGrounding,
  regionPaintsOf,
  slotColor,
  type PixelSink,
  type RegionSlots,
} from '../src/render/region-paint.ts';

/**
 * 地域三色槽位**真的画到了地上**。
 *
 * 那三个槽（`primary` / `accent` / `forbidden`）在这条改动之前是装载期验过、
 * 渲染层零个读者的三个字段。所以这组用例不是「实现细节的单测」，它是
 * **SPEC_V2 #17 / #28 唯一可机检的那一半**：
 *
 *   17. 我能一眼分出镇子的不同区域：每个区域有自己的主色、点缀色，
 *       而且区域内不出现被禁用的颜色。
 *   28. 我改一个区域的主色只改配置，不用改渲染代码。
 *
 * 屏幕上的「一眼分出」机检不了。能查的是它的因：**不同区域真的发出了不同颜色的
 * 像素**，以及**禁用色一笔都没发出去**。#28 则查「只改三个色值，输出就跟着变」。
 *
 * ## 为什么不用假 Graphics 的 `fillStyle` 计数就完事
 *
 * 计数只能证明「画了东西」。第一版就是这样：断言 `fills.length > 0`，它在一个
 * 只画禁用色的实现上也全绿。所以这里的判据是**色值集合**——把每次 `fillStyle`
 * 的色值收下来，再问：
 *   - 主色那个值**在**里面；
 *   - 禁用色那个值**不在**里面；
 *   - 两道区域的主色各自出现，且**互不相同**（这正是一条区域一条地界的读法）。
 */

/** 一个只记账、不出图的 sink。 */
function recorder(): PixelSink & {
  readonly fills: readonly { color: number; alpha: number; x: number; y: number; w: number; h: number }[];
} {
  const fills: { color: number; alpha: number; x: number; y: number; w: number; h: number }[] = [];
  let style = { color: 0, alpha: 1 };
  return {
    fills,
    fillStyle(color: number, alpha: number) {
      style = { color, alpha };
      return undefined;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ ...style, x, y, w, h });
      return undefined;
    },
  };
}

/**
 * 一张 8×2 的假网格：左四格属 `a`、右四格属 `b`，全是草地。
 *
 * 用假网格而不是真世界，是为了让「哪一格归谁」在用例里一眼看得见——
 * 拿灯潮界的 64×48 去断言像素集合，红的时候没人说得清是哪一格的账。
 */
function fakeGrid(): WorldGrid {
  const cells: { terrain: TerrainId; region?: string }[] = [];
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      cells.push({ terrain: 'grass', region: x < 4 ? 'a' : 'b' });
    }
  }
  return {
    width: 8,
    height: 2,
    at: (p: { x: number; y: number }) => cells[p.y * 8 + p.x],
  } as unknown as WorldGrid;
}

const SLOTS: readonly RegionSlots[] = [
  { id: 'a', x: 0, y: 0, w: 4, h: 2, primary: 'timber', accent: 'warmLight', forbidden: 'water' },
  { id: 'b', x: 4, y: 0, w: 4, h: 2, primary: 'terracotta', accent: 'trim', forbidden: 'moss' },
];

const PALETTE: WorldPalette = WORLD;

test('两道区域各发自己的主色，颜色互不相同——这是「一眼分出」的因', () => {
  const g = recorder();
  drawRegionGrounding(g, fakeGrid(), 0, 0, PALETTE, SLOTS);

  const colors = new Set(g.fills.map((fill) => fill.color));
  assert.ok(colors.has(PALETTE.timber), 'a 区的主色一个像素都没画出来');
  assert.ok(colors.has(PALETTE.terracotta), 'b 区的主色一个像素都没画出来');
  assert.notStrictEqual(PALETTE.timber, PALETTE.terracotta, '两区主色同值，那就不是两道区域');
});

test('禁用色一笔都落不下去：替换发生在发出像素之前', () => {
  const g = recorder();
  drawRegionGrounding(g, fakeGrid(), 0, 0, PALETTE, SLOTS);

  const colors = new Set(g.fills.map((fill) => fill.color));
  assert.strictEqual(colors.has(PALETTE.water), false, 'a 区禁 water，却画出来了');
  assert.strictEqual(colors.has(PALETTE.moss), false, 'b 区禁 moss，却画出来了');
});

test('禁用色确实咬得住：把主色换成禁用色，那条地界整条消失', () => {
  // 上一条断言「没有 water」。可如果这段代码压根不画蓝色，它也会绿——
  // 那是一条数不到分母的断言。这里把 a 区的主色**改成**它自己的禁用色，
  // 于是「该画而未画」被逼到台面上：主色那批像素必须归零。
  const cursed: readonly RegionSlots[] = [
    { ...SLOTS[0]!, primary: 'water' },
    SLOTS[1]!,
  ];
  const g = recorder();
  drawRegionGrounding(g, fakeGrid(), 0, 0, PALETTE, cursed);
  const colors = new Set(g.fills.map((fill) => fill.color));
  assert.strictEqual(colors.has(PALETTE.water), false, '主色等于禁用色时，一笔都不该落下去');
  assert.ok(colors.has(PALETTE.terracotta), '另一道区域不受影响——替换是按区域算的，不是全局的');
});

/**
 * 上一条证明「禁用色没有出现」。它证明不了**主色是怎么铺的**——整格糊一层
 * 半透明主色，色值集合与抖动**完全一样**：颜色都在册内，禁用色也都没落下去。
 *
 * 这条拦的是那个退路。这两个版本在屏幕上差得很远：整格覆盖会压平底层的石板缝
 * 与材质拼接边，还会在混出的中间色上生出 24 色之外的值（`palette-data.ts`
 * 里 `stone` 的明度就是为「别和草地糊成一片」校准过的）。而像素画表达
 * 「这块地归谁」用的是抖动——**底层像素一个不动**。
 */
test('铺的是抖动，不是整格覆盖：没有一笔盖满一整格，也没有一笔带 alpha', () => {
  const g = recorder();
  drawRegionGrounding(g, fakeGrid(), 0, 0, PALETTE, SLOTS);
  assert.ok(g.fills.length > 0, '一个像素都没画，下面的断言就没有分母');

  for (const fill of g.fills) {
    assert.ok(
      fill.w < 16 || fill.h < 16,
      `有一笔 ${fill.w}×${fill.h} 盖满了整格——这是面洗，不是抖动`,
    );
    // alpha < 1 会在底层混出一个不在 24 色预算里的值。
    assert.strictEqual(fill.alpha, 1, `有一笔 alpha=${fill.alpha}：半透明覆盖会造出册外的中间色`);
  }
});

/**
 * 抖动不许串到邻格。邻格可能归另一道区域——串过去就是「A 区的像素出现在
 * B 区的地上」，而那正是 #17 后半句在禁的事。这条查的是几何，不是颜色：
 * 每一笔都必须落在本格 16×16 的范围内。
 */
test('每一笔都落在自己那一格里：抖动不渗进邻格', () => {
  const g = recorder();
  drawRegionGrounding(g, fakeGrid(), 0, 0, PALETTE, SLOTS);
  // fakeGrid 每格 16px，8 列 2 行 ⇒ 画面 128×32。
  for (const fill of g.fills) {
    assert.ok(fill.x >= 0 && fill.y >= 0, `有一笔落在画布外：${fill.x},${fill.y}`);
    assert.ok(fill.x + fill.w <= 128 && fill.y + fill.h <= 32, `有一笔越界：${fill.x}+${fill.w}/128`);
    // 落点所属的格子，与「这笔画的是哪个主色」必须对得上。
    const cellX = Math.floor(fill.x / 16);
    const expected = cellX < 4 ? PALETTE.timber : PALETTE.terracotta;
    if (fill.color !== PALETTE.warmLight && fill.color !== PALETTE.trim) {
      assert.strictEqual(
        fill.color,
        expected,
        `第 ${cellX} 列画的是 ${cellX < 4 ? 'a 区' : 'b 区'}的主色，却发出了另一个颜色——抖动串了格`,
      );
    }
  }
});

test('改配置就换样（#28）：只动三个色值，画面上的色跟着换', () => {
  const before = recorder();
  drawRegionGrounding(before, fakeGrid(), 0, 0, PALETTE, SLOTS);

  const recolored: readonly RegionSlots[] = [
    { ...SLOTS[0]!, primary: 'copper', accent: 'plaster' },
    SLOTS[1]!,
  ];
  const after = recorder();
  drawRegionGrounding(after, fakeGrid(), 0, 0, PALETTE, recolored);

  const colorsOf = (g: { readonly fills: readonly { color: number }[] }): Set<number> =>
    new Set(g.fills.map((fill) => fill.color));
  assert.ok(colorsOf(before).has(PALETTE.timber));
  assert.strictEqual(colorsOf(after).has(PALETTE.timber), false, '改了主色，旧主色还在画——渲染代码里有一份写死的值');
  assert.ok(colorsOf(after).has(PALETTE.copper), '改了主色，新主色没画出来');
});

test('一道区域都不声明：一个像素都不画（莞尔镇的画面不该被这层改动碰到）', () => {
  const g = recorder();
  drawRegionGrounding(g, fakeGrid(), 0, 0, PALETTE, []);
  assert.deepStrictEqual(g.fills, [], `regions: [] 时不该有像素，实际发了 ${g.fills.length} 笔`);
});

test('没被任何区域覆盖的格子不画：不属于谁的地不该有地界', () => {
  const cells: { terrain: TerrainId; region?: string }[] = [];
  for (let x = 0; x < 8; x += 1) cells.push({ terrain: 'grass' });
  const bare = { width: 8, height: 1, at: (p: { x: number }) => cells[p.x] } as unknown as WorldGrid;
  const g = recorder();
  drawRegionGrounding(g, bare, 0, 0, PALETTE, SLOTS);
  assert.deepStrictEqual(g.fills, [], '格子上没有 region 就等于「不属于谁」，那就不画');
});

test('slotColor 只拦「恰好等于本区禁用色」的那一个 token', () => {
  const paint = regionPaintsOf(SLOTS).get('a')!;
  assert.strictEqual(slotColor('timber', paint), 'timber');
  assert.strictEqual(slotColor('water', paint), null);
  // 别的区域的禁用色与本区无关：替换按区域算，不是全局黑名单。
  assert.strictEqual(slotColor('moss', paint), 'moss');
});

test('斑块按地形分档：只有树一律不落，平色的淤泥/煤渣最重', () => {
  // 这一条锁的是配方本身，不是它的效果。效果由上面那几条按像素集合查。
  // 树冠底下是土色与草团，再叠一层读成烂泥——这是唯一一个「按地形一律不画」
  // 的档，理由在材质本身，与哪份设定集无关。
  assert.strictEqual(REGION_PATCHES.tree, 0);
  // **浅滩不写 0**：它在潮汐层下面，而那层只在淹掉时压色、退潮时一格不盖，
  // 退出来的滩涂正该露出它归谁。这一条是防「又把浅滩填回 0」的回退。
  assert.ok(REGION_PATCHES.shallow > 0, '浅滩不是树的材质，没有理由一律不画');
  assert.ok(REGION_PATCHES.mud > REGION_PATCHES.grass, '最平的地上该落得比草地上多');
  assert.ok(REGION_PATCHES.stone > 0, '石街是这张图上面积最大的地面，它一个斑块都不落就没戏了');
  for (const terrain of Object.keys(REGION_PATCHES) as TerrainId[]) {
    assert.ok(REGION_PATCHES[terrain] >= 0, `${terrain} 的斑块数是负的`);
  }
});

// ------------------------------------------------- 「画了」与「画进画面」是两件事

/**
 * 上一组用例证明 `drawRegionGrounding` **会画**。它证明不了 `drawTerrain`
 * **调用了它**——把那一行删掉，上面全绿。这正是本仓记过的「一个永远返回
 * 空数组的函数也能让真仓库绿着」。
 *
 * 拿真 `Phaser.GameObjects.Graphics` 不行（`node --test` 加载不了 Phaser），
 * 所以这里走**源码扫描**：`drawTerrain` 的函数体里必须真的有一句把
 * `theme.regions` 递进去的调用。它不是行为测试，它拦的是「有人把这一行删了」，
 * 而那正是这层最容易的退化方式。判据写死在下面，改的时候会被迫读这段注释。
 */
test('drawTerrain 真的调用了这一层，并把 theme.regions 递进去', () => {
  const source = readFileSync(new URL('../src/render/tilemap.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /drawRegionGrounding\([^)]*theme\?\.regions[^)]*\)/,
    'drawTerrain 没有把 theme.regions 递给 drawRegionGrounding——画得出，但画不进画面',
  );
  const scene = readFileSync(new URL('../src/scenes/SandboxScene.ts', import.meta.url), 'utf8');
  assert.match(
    scene,
    /drawTerrain\(/,
    'SandboxScene 不再调 drawTerrain，上面那一句就没人接住了',
  );
});

/**
 * 设定集一侧：`SettingPack['regions']` 的形状必须**结构上**能直接当 `RegionSlots`
 * 用。这条是编译期保证的，写在这里是让它有个名字——有人给 `RegionSlots` 加一个
 * 必填字段时，`SandboxScene` 那一处的实参就不匹配了，而不是在运行时少画一层。
 */
test('RegionSlots 只要 id/坐标/三色这九样，设定集不必为渲染层多背字段', () => {
  const keys = ['id', 'x', 'y', 'w', 'h', 'primary', 'accent', 'forbidden'] as const;
  const sample: RegionSlots = {
    id: 'x', x: 0, y: 0, w: 1, h: 1, primary: 'ink', accent: 'pale', forbidden: 'amber',
  };
  for (const key of keys) assert.ok(key in sample, `RegionSlots 缺 ${key}`);
});
