/**
 * MAT-G7：相位切换时旧辉光内容必须立刻清掉，不许跨 900ms 渐变期继续重画。
 *
 * 复现路径（渲染侧）：从 dusk / night 调 `Oracle.setPhase('dawn')`，渐变期里
 * `blend()` 按 `t < 0.5` 把上一刻的 `litWindows`（2 扇）与 `ridge`（0.55）
 * 继续交给 `drawGlows`，于是每帧重画整层旧辉光（2,840 条）。实测晨+雨连续
 * 峰值 33,741 / 33,549，稳态只有 31,301。
 *
 * 判据：**关灯方向**（目标值更小）从切换那一刻就取目标值；**点灯方向**仍保留
 * `t < 0.5` 的交叉，避免灯一帧全亮。连续量（dim / glow / mist）照常插值。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES } from '../src/render/day-phase.ts';

// ---------------------------------------------------------------- 动态模块
//
// `blend` 是这次合入才有的导出。静态 import 在 base 上会
// `SyntaxError: does not provide an export named`，被 `red:first` 归成
// compile（exit 2）；改成动态 import + 显式断言后，base 上红在断言上。

interface BlendView {
  readonly litWindows: number;
  readonly ridge: number;
  readonly glow: number;
  readonly dim: number;
}

interface PhaseViewModule {
  readonly blend?: (from: unknown, to: unknown, t: number) => BlendView;
}

const PHASE_VIEW_MODULE_PATH = '../src/render/phase-view.ts';

async function blendOf(): Promise<NonNullable<PhaseViewModule['blend']>> {
  let mod: PhaseViewModule = {};
  try {
    mod = (await import(PHASE_VIEW_MODULE_PATH)) as PhaseViewModule;
  } catch {
    // 模块整体不存在时也按「缺导出」处理：红在断言上，不红在解析上。
  }
  assert.equal(typeof mod.blend, 'function', 'render/phase-view.ts 必须导出 blend');
  return mod.blend!;
}

test('MAT-G7 关灯方向：渐变早期不再沿用上一刻的亮窗/屋脊', async () => {
  const blend = await blendOf();
  for (const from of [PHASES.dusk, PHASES.night] as const) {
    const early = blend(from, PHASES.dawn, 0.28);
    assert.equal(
      early.litWindows,
      0,
      `${from.label}→晨 t=0.28 仍亮着 ${early.litWindows} 扇窗：旧辉光层没清`,
    );
    assert.equal(
      early.ridge,
      0,
      `${from.label}→晨 t=0.28 屋脊受光仍为 ${early.ridge}：旧屋脊线还在重画`,
    );
  }
});

test('MAT-G7 切换瞬间（t=0）旧内容就已清掉', async () => {
  const blend = await blendOf();
  const atSwitch = blend(PHASES.dusk, PHASES.dawn, 0);
  assert.equal(atSwitch.litWindows, 0, 't=0 仍是黄昏的 2 扇亮窗');
  assert.equal(atSwitch.ridge, 0, 't=0 仍是黄昏的屋脊受光');
});

test('MAT-G7 点灯方向保留渐变：晨→昏 前半个渐变不立刻全亮', async () => {
  const blend = await blendOf();
  const early = blend(PHASES.dawn, PHASES.dusk, 0.2);
  assert.equal(early.litWindows, 0, '晨→昏 t=0.2 就亮满 2 扇：熄灯规则被误套到点灯方向');
  const late = blend(PHASES.dawn, PHASES.dusk, 0.7);
  assert.equal(late.litWindows, 2, '晨→昏 t=0.7 仍没亮窗');
});

test('MAT-G7 连续量仍插值：glow / dim 不许跟着离散内容一起跳', async () => {
  const blend = await blendOf();
  const mid = blend(PHASES.dusk, PHASES.dawn, 0.5);
  assert.ok(
    mid.glow > PHASES.dawn.glow && mid.glow < PHASES.dusk.glow,
    `glow=${mid.glow} 应落在 (${PHASES.dawn.glow}, ${PHASES.dusk.glow}) 之间`,
  );
  assert.ok(
    mid.dim > PHASES.dusk.dim && mid.dim < PHASES.dawn.dim,
    `dim=${mid.dim} 应落在 (${PHASES.dusk.dim}, ${PHASES.dawn.dim}) 之间`,
  );
});
