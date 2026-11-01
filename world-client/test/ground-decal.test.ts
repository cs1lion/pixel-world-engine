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
  drawGroundDecals(canvas, [worn('t1', 0.3, 1)], { x: 3, y: 4 }, TILE);
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
  drawGroundDecals(fresh.canvas, [worn('t1', 0.3, 1)], { x: 0, y: 0 }, TILE);
  const faded = recorder();
  drawGroundDecals(faded.canvas, [worn('t1', 0.3, 0.4)], { x: 0, y: 0 }, TILE);
  assert.deepEqual(
    faded.calls.map((call) => call.alpha),
    fresh.calls.map((call) => call.alpha * 0.4),
    '风化之后每一笔的 alpha 都按 visibility 打折',
  );
});

test('浓的是 intensity：同一条路走得更勤，画得更宽', () => {
  const light = recorder();
  drawGroundDecals(light.canvas, [worn('t1', 0.3, 1)], { x: 0, y: 0 }, TILE);
  const heavy = recorder();
  drawGroundDecals(heavy.canvas, [worn('t1', 1, 1)], { x: 0, y: 0 }, TILE);
  const band = (calls: readonly Call[]): number => Math.max(...calls.map((call) => call.h));
  assert.ok(band(heavy.calls) > band(light.calls), '走得越勤，那条带越宽');
});

test('visibility 归零：一笔都不画', () => {
  // 风化到看不见就不该再画——记录还在（`exposedTraces` 那边照旧留着），
  // 只是屏幕上没有它。
  const { canvas, calls } = recorder();
  drawGroundDecals(canvas, [worn('t1', 1, 0)], { x: 0, y: 0 }, TILE);
  assert.deepEqual(calls, []);
});

test('同一个 traceId 两次画在同一处', () => {
  // 回放要看得出同一块地。位置由 traceId 定，不用随机数。
  const first = recorder();
  drawGroundDecals(first.canvas, [worn('trace_7', 0.5, 1)], { x: 2, y: 2 }, TILE);
  const second = recorder();
  drawGroundDecals(second.canvas, [worn('trace_7', 0.5, 1)], { x: 2, y: 2 }, TILE);
  assert.deepEqual(second.calls, first.calls);
});

test('两道不同的路散开，不叠在同一处', () => {
  const one = recorder();
  drawGroundDecals(one.canvas, [worn('trace_a', 0.5, 1)], { x: 0, y: 0 }, TILE);
  const two = recorder();
  drawGroundDecals(two.canvas, [worn('trace_a', 0.5, 1), worn('trace_b', 0.5, 1)], { x: 0, y: 0 }, TILE);
  assert.ok(two.calls.length > one.calls.length, '两道痕迹总得多画几笔');
  const xsOf = (calls: readonly Call[]): number[] => calls.map((call) => call.x);
  assert.notDeepEqual(xsOf(two.calls).slice(one.calls.length), xsOf(one.calls), '第二道不该正好压在第一条上');
});
