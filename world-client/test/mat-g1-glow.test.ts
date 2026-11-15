/**
 * MAT-G1：辉光环化的判据。
 *
 * 现状（改前）是三层**嵌套矩形**：外层 `a`、中层 `0.55a`、内芯 `1.15a`。ADD 混合
 * 不遮挡，三层叠在中心像素上就是 `2.70a`——不是设计出来的亮度，是叠加的副作用。
 *
 * 判据只有两条，都可证伪：
 *   1. 任一像素被覆盖的层数 ≤ 1；
 *   2. 任一像素的累加 alpha ≤ `peakAlpha`（声明峰值 1.15a）。
 *
 * 口径说明：alpha 是**相加**的权重，不是覆盖率；像素级的覆盖由 `fillRect` 的
 * 整数坐标算，和 Graphics 实际写的像素一一对应（glowLayers 已经把坐标取整）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 现网实际出现的五档尺寸与基底 alpha（见 phase-view.ts 的 addGlow 调用点）。 */
const CASES = [
  { label: '亮窗 13×9', w: 13, h: 9, alpha: 0.11 },
  { label: '门口光池 18×11', w: 18, h: 11, alpha: 0.1 },
  { label: '郊野灯笼 10×8', w: 10, h: 8, alpha: 0.16 },
  { label: '祭坛 20×13', w: 20, h: 13, alpha: 0.12 },
  { label: '路灯 12×9', w: 12, h: 9, alpha: 0.11 },
];

// ---------------------------------------------------------------- 动态模块
//
// `glowLayers` 是这次合入才有的导出。静态 import 在 base 上会直接
// `SyntaxError: does not provide an export named`，被 `red:first` 归成 compile
// （exit 2）；改成动态 import + 显式 typeof 断言后，base 上红在断言上。

interface GlowLayerView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly token: string;
  readonly alpha: number;
}

interface GlowPlanView {
  readonly layers: readonly GlowLayerView[];
  readonly peakAlpha: number;
}

interface PhaseViewModule {
  readonly glowLayers?: (cx: number, cy: number, w: number, h: number, alpha: number) => GlowPlanView;
}

const PHASE_VIEW_MODULE_PATH = '../src/render/phase-view.ts';

async function glowLayersOf(): Promise<NonNullable<PhaseViewModule['glowLayers']>> {
  let mod: PhaseViewModule = {};
  try {
    mod = (await import(PHASE_VIEW_MODULE_PATH)) as PhaseViewModule;
  } catch {
    // 模块整体不存在时也按「缺导出」处理：红在断言上，不红在解析上。
  }
  assert.equal(typeof mod.glowLayers, 'function', 'render/phase-view.ts 必须导出 glowLayers');
  return mod.glowLayers!;
}

test('MAT-G1 辉光：任一像素至多被一层覆盖，累加 alpha ≤ 声明峰值', async () => {
  const glowLayers = await glowLayersOf();
  const failures: string[] = [];
  for (const item of CASES) {
    const plan = glowLayers(20, 20, item.w, item.h, item.alpha);
    if (plan.peakAlpha > item.alpha * 1.15 + 1e-9) {
      failures.push(`${item.label}：声明峰值被抬到 ${(plan.peakAlpha / item.alpha).toFixed(2)}a（上限 1.15a）`);
    }
    const cover = new Map<string, { count: number; sum: number }>();
    for (const layer of plan.layers) {
      for (let y = layer.y; y < layer.y + layer.h; y += 1) {
        for (let x = layer.x; x < layer.x + layer.w; x += 1) {
          const key = `${x},${y}`;
          const cell = cover.get(key) ?? { count: 0, sum: 0 };
          cell.count += 1;
          cell.sum += layer.alpha;
          cover.set(key, cell);
        }
      }
    }
    let worstCount = 0;
    let worstSum = 0;
    let worstKey = '-';
    for (const [key, cell] of cover) {
      if (cell.count > worstCount || cell.sum > worstSum) {
        worstCount = Math.max(worstCount, cell.count);
        worstSum = Math.max(worstSum, cell.sum);
        worstKey = key;
      }
    }
    if (worstCount > 1 || worstSum > plan.peakAlpha + 1e-9) {
      failures.push(
        `${item.label}：像素 ${worstKey} 被覆盖 ${worstCount} 层，累加 alpha ` +
          `${(worstSum / item.alpha).toFixed(2)}a（声明峰值 ${(plan.peakAlpha / item.alpha).toFixed(2)}a）`,
      );
    }
  }
  assert.deepEqual(
    failures,
    [],
    '辉光必须拆成互不重叠的环带：叠层会把中心积分成 2.70a，而声明峰值只有 1.15a。\n' +
      failures.join('\n'),
  );
});

test('MAT-G1 辉光只用既有 amber / warmLight，不新增色', async () => {
  const glowLayers = await glowLayersOf();
  const plan = glowLayers(20, 20, 13, 9, 0.11);
  for (const layer of plan.layers) {
    assert.ok(
      layer.token === 'amber' || layer.token === 'warmLight',
      `辉光层出现不在册的 token：${layer.token}`,
    );
  }
});
