/**
 * 痕迹上屏的算术：画在哪、画几笔、多浓。
 *
 * `decal.ts` 不提 Phaser，只要求一个能 `fillStyle` / `fillRect` 的东西，所以这里
 * 用一个记账的假画布——验的是「画了什么」，不是像素。像素那一半在浏览器验收里
 * （`?world=dengchao`，前后截图对比）。
 *
 * 这一层守的是协议 §11 那句话的唯一证据：**风化只降可见度**。所以
 * alpha 必须等于 `visibility`，而不是 `intensity`——两道同样旧的痕迹，
 * 重的那道该更浓，不该更清楚。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decalSpot, drawDecal, roofHeight, type DecalCanvas } from '../src/render/decal.ts';
import type { NarrativeHint } from '../src/world/memory/hints.ts';
import type { TraceLayer } from '../src/world/memory/types.ts';

const W = 64;
const H = 64;
const ROOF = roofHeight(H);

interface Call {
  readonly color: number;
  readonly alpha: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 记账用的假画布：记下每一次 fillRect 与当时的颜色/alpha。 */
function recorder(): { canvas: DecalCanvas; calls: Call[]; styles: number[] } {
  const calls: Call[] = [];
  const styles: number[] = [];
  let color = 0;
  let alpha = 1;
  const canvas: DecalCanvas = {
    fillStyle(next: number, nextAlpha = 1) {
      color = next;
      alpha = nextAlpha;
      styles.push(nextAlpha);
      return canvas;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ color, alpha, x, y, w, h });
      return canvas;
    },
  };
  return { canvas, calls, styles };
}

function hint(
  layer: TraceLayer,
  visibility = 1,
  intensity = 0.8,
  traceId = `t_${layer}`,
): NarrativeHint {
  return { type: 'decal', placeId: 'p1', traceId, layer, intensity, visibility };
}

const LAYERS: readonly TraceLayer[] = [
  'scorch',
  'damage',
  'patch',
  'garland',
  'worn_path',
  'inscription',
];

test('屋面高度与楼体那边同一个算式', () => {
  assert.equal(roofHeight(64), Math.max(10, Math.round(64 * 0.34)));
  assert.equal(roofHeight(16), 10, '矮楼也留 10px 屋面，不然墙没有地方挂东西');
});

test('每一种痕迹都画得出东西，且都落在墙上', () => {
  for (const layer of LAYERS) {
    const { canvas, calls } = recorder();
    drawDecal(canvas, hint(layer), W, H, ROOF);
    assert.ok(calls.length > 0, `${layer} 一笔都没画`);
    for (const call of calls) {
      assert.ok(
        call.y >= ROOF && call.y + call.h <= H,
        `${layer} 画到墙外去了：y=${call.y} h=${call.h}，墙在 ${ROOF}..${H}`,
      );
      assert.ok(call.x >= 0 && call.x + call.w <= W, `${layer} 横向出界：x=${call.x} w=${call.w}`);
    }
  }
});

test('alpha 就是可见度：风化的那道更淡，不是更小', () => {
  const fresh = recorder();
  const faded = recorder();
  drawDecal(fresh.canvas, hint('scorch', 1, 0.9), W, H, ROOF);
  drawDecal(faded.canvas, hint('scorch', 0.25, 0.9), W, H, ROOF);

  assert.equal(fresh.styles[0], 1);
  assert.equal(faded.styles[0], 0.25, '第一笔的 alpha 必须等于 visibility');
  assert.equal(
    fresh.calls.length,
    faded.calls.length,
    '风化只降可见度：笔数（形状）不该变，变的只是淡浓',
  );
});

test('可见度为 0 的痕迹一笔都不画——它在库里，但不在画面上', () => {
  const { canvas, calls } = recorder();
  drawDecal(canvas, hint('scorch', 0), W, H, ROOF);
  assert.deepEqual(calls, []);
});

test('位置是确定的：同一个 traceId 永远落在同一处', () => {
  const a = decalSpot(hint('scorch', 1, 0.8, 'trace_42'), W, H, ROOF);
  const b = decalSpot(hint('scorch', 1, 0.8, 'trace_42'), W, H, ROOF);
  assert.deepEqual(a, b, '回放要看得出同一面墙，位置不能每次刷新都换');
  const c = decalSpot(hint('scorch', 1, 0.8, 'trace_43'), W, H, ROOF);
  assert.notDeepEqual(a, c, '不同的痕迹该散开，不叠在同一处');
});

test('花环贴檐、磨损贴墙脚：两者的纵向带子不重叠', () => {
  const garland = decalSpot(hint('garland', 1, 0.8, 'x'), W, H, ROOF);
  const worn = decalSpot(hint('worn_path', 1, 0.8, 'x'), W, H, ROOF);
  assert.ok(garland.y < worn.y, `花环该在檐下（${garland.y}），磨损该在墙脚（${worn.y}）`);
});
