/**
 * 地标上的痕迹：画在哪一格、多浓、风化之后变浅还是变深。
 *
 * 楼上的痕迹画在墙上（`decal.ts` 的 `drawDecal`），地标上的画在地上
 * （`drawGroundDecals`）——同一张单子、同一道闸，只是落脚的地方不同。
 *
 * 与 `decal.test.ts` 同一套办法：假画布记账，验「画了什么」，不验像素。
 * 像素那一半在浏览器验收里（`?world=dengchao`，前后截图对比）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawGroundDecals, type DecalCanvas } from '../src/render/decal.ts';
import { WORLD } from '../src/world/palette-data.ts';
import type { NarrativeHint } from '../src/world/memory/hints.ts';

const TILE = 16;

interface Call {
  readonly color: number;
  readonly alpha: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function recorder(): { canvas: DecalCanvas; calls: Call[] } {
  const calls: Call[] = [];
  let color = 0;
  let alpha = 1;
  const canvas: DecalCanvas = {
    fillStyle(next: number, nextAlpha = 1) {
      color = next;
      alpha = nextAlpha;
      return canvas;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ color, alpha, x, y, w, h });
      return canvas;
    },
  };
  return { canvas, calls };
}

function worn(traceId: string, intensity: number, visibility: number): NarrativeHint {
  return { type: 'decal', placeId: 'place:19,15', traceId, layer: 'worn_path', intensity, visibility };
}

test('画在自己那一格里，一格都不越界', () => {
  const { canvas, calls } = recorder();
  drawGroundDecals(canvas, [worn('t1', 0.3, 1)], { x: 3, y: 4 }, TILE, WORLD, WORLD.grass);
  assert.ok(calls.length > 0, '一条路总得画点什么');
  for (const call of calls) {
    assert.ok(call.x >= 3 * TILE && call.x + call.w <= 4 * TILE, `横着越界：${call.x}+${call.w}`);
    assert.ok(call.y >= 4 * TILE && call.y + call.h <= 5 * TILE, `竖着越界：${call.y}+${call.h}`);
  }
});

test('alpha 就是 visibility：风化只降可见度', () => {
  // 协议 §11 那句话的唯一像素证据。两道同样旧的痕迹，重的那道更浓、不更清楚——
  // 所以浓淡由 intensity 决定（画多宽），alpha 只由 visibility 决定。
  const fresh = recorder();
  drawGroundDecals(fresh.canvas, [worn('t1', 0.3, 1)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  const faded = recorder();
  drawGroundDecals(faded.canvas, [worn('t1', 0.3, 0.4)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  assert.deepEqual(
    faded.calls.map((call) => call.alpha),
    fresh.calls.map((call) => call.alpha * 0.4),
    '风化之后每一笔的 alpha 都按 visibility 打折',
  );
});

test('浓的是 intensity：同一条路走得更勤，画得更宽', () => {
  const light = recorder();
  drawGroundDecals(light.canvas, [worn('t1', 0.3, 1)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  const heavy = recorder();
  drawGroundDecals(heavy.canvas, [worn('t1', 1, 1)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  const band = (calls: readonly Call[]): number => Math.max(...calls.map((call) => call.h));
  assert.ok(band(heavy.calls) > band(light.calls), '走得越勤，那条带越宽');
});

test('visibility 归零：一笔都不画', () => {
  // 风化到看不见就不该再画——记录还在（`exposedTraces` 那边照旧留着），
  // 只是屏幕上没有它。
  const { canvas, calls } = recorder();
  drawGroundDecals(canvas, [worn('t1', 1, 0)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  assert.deepEqual(calls, []);
});

test('同一个 traceId 两次画在同一处', () => {
  // 回放要看得出同一块地。位置由 traceId 定，不用随机数。
  const first = recorder();
  drawGroundDecals(first.canvas, [worn('trace_7', 0.5, 1)], { x: 2, y: 2 }, TILE, WORLD, WORLD.grass);
  const second = recorder();
  drawGroundDecals(second.canvas, [worn('trace_7', 0.5, 1)], { x: 2, y: 2 }, TILE, WORLD, WORLD.grass);
  assert.deepEqual(second.calls, first.calls);
});

test('两道不同的路散开，不叠在同一处', () => {
  const one = recorder();
  drawGroundDecals(one.canvas, [worn('trace_a', 0.5, 1)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  const two = recorder();
  drawGroundDecals(two.canvas, [worn('trace_a', 0.5, 1), worn('trace_b', 0.5, 1)], { x: 0, y: 0 }, TILE, WORLD, WORLD.grass);
  assert.ok(two.calls.length > one.calls.length, '两道痕迹总得多画几笔');
  const xsOf = (calls: readonly Call[]): number[] => calls.map((call) => call.x);
  assert.notDeepEqual(xsOf(two.calls).slice(one.calls.length), xsOf(one.calls), '第二道不该正好压在第一条上');
});

test('痕迹带不许和脚下那一格同色：石头路上也要看得见', () => {
  // 2026-11-02，修色板时量出来的：灯潮界的 `terrainColors.stone` 与
  // `palette.stone` **是同一个色值**（#52666a），而 `drawFlagstones` 用
  // `palette.stone` 铺石头地面。所以「痕迹带用 stone 槽」这条在石头格上
  // 对比度是 1.00——一格都看不见。15 个踩出痕迹的地标里有 2 个是石头地，
  // 其中一个正是 `place:19,15`（这一局踩得最多的那格）。
  //
  // 这条闸钉的是**不许同色**，不是某个具体色值：换设定集、换底色都该过。
  const dengchao = { ...WORLD, stone: 0x52666a, plaza: 0x7d8984, trim: 0xdfbd7a };
  for (const base of [dengchao.stone, dengchao.plaza, dengchao.grass, dengchao.soil]) {
    const { canvas, calls } = recorder();
    drawGroundDecals(canvas, [worn('t1', 0.5, 1)], { x: 0, y: 0 }, TILE, dengchao, base);
    const band = calls.filter((call) => call.w === TILE);
    assert.ok(band.length > 0, '整格那条带子该在');
    assert.notEqual(band[0]!.color, base, `底色 ${base.toString(16)} 上，带子画成了同一个色——看不见`);
  }
});

test('画的是这一次的色板：换设定集，石头色跟着换', () => {
  // 2026-11-02：这一条是补的。之前假画布记了 `color` 却从不断言，于是
  // `drawGroundDecals` 里写死 `WORLD.stone` 一直没人发现——灯潮界的地上画着
  // 莞尔镇的石头色（#3e433f），和同一格的地形石头（#52666a）挨着，两种石头
  // 色同屏。`tilemap.ts` 早就是 `theme?.palette ?? WORLD`，这一层没跟上。
  const dengchao = { ...WORLD, stone: 0x52666a, plaza: 0x7d8984 };
  const { canvas, calls } = recorder();
  drawGroundDecals(canvas, [worn('t1', 0.5, 1)], { x: 0, y: 0 }, TILE, dengchao, dengchao.grass);
  const band = calls.filter((call) => call.w === TILE);
  assert.ok(band.length > 0, '横贯整格的那条带子该在');
  for (const call of band) {
    assert.equal(call.color, dengchao.stone, '整格宽的带子是 stone 槽，且必须来自入参色板');
  }
  const specks = calls.filter((call) => call.w === 1);
  assert.ok(specks.length > 0, 'jitter 那几笔该在');
  for (const call of specks) {
    assert.equal(call.color, dengchao.plaza, 'jitter 那几笔是 plaza 槽，且必须来自入参色板');
  }
  assert.notEqual(WORLD.stone, dengchao.stone, '两份色板得真的不同，否则这条测不出东西');
});

test('色板是必填的：漏传是编译错，不是悄悄退回莞尔镇', () => {
  // 这个参数**没有缺省值**，是有意的。上一版的病正是「忘了传，于是用了 WORLD」
  // ——而那个 WORLD 不报错、不告警，只是把另一座镇子的颜色画上来。必填参数
  // 把「忘」变成 tsc 的一条 TS2554，`npm run check` 当场红。
  // 这一条用一份与 WORLD 不同的色板，证明传进去的那份真的生效。
  const other = { ...WORLD, stone: 0x112233 };
  const { canvas, calls } = recorder();
  drawGroundDecals(canvas, [worn('t1', 0.5, 1)], { x: 0, y: 0 }, TILE, other, other.grass);
  assert.equal(calls.filter((c) => c.w === TILE)[0]?.color, 0x112233);
});
