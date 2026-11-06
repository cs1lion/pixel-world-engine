/**
 * 设计判据的接线检查（要点 1 的结构前置）。
 *
 * 为什么不是纯函数单测：`phase-view.ts` 里 `import Phaser`，node 下 import 就崩
 * （同 `day-phase.test.ts` 里萤火虫那条注释的实测）。配方值本身已由
 * `day-phase.test.ts` 钉住，这里补的是另一半——**渲染层到底有没有读这些值**。
 * 只读源码文本，不执行 Phaser；删掉任何一个字段的消费都会红。
 *
 * 局限：这是接线检查，不是像素判据。要点 1 的亮度差仍要截图（见
 * docs/DESIGN_ACCEPTANCE.md §要点 1）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/render/phase-view.ts', import.meta.url),
  'utf8',
);

const recipeFields = [
  'dimColor',
  'dim',
  'glow',
  'ridge',
  'litWindows',
  'mist',
  'mistBand',
  'fireflies',
] as const;

test('blend 逐字段读四刻配方：不是只读 label 或只读一个亮度', () => {
  for (const field of recipeFields) {
    assert.match(
      source,
      new RegExp(`(?:from|to)\\.${field}\\b`),
      `blend 没有读 ${field}：配方里有值，渲染层不用`,
    );
  }
});

test('插值后的每个字段都在绘制路径里被消费，不是只存不用', () => {
  const consumed: readonly [string, RegExp][] = [
    ['压暗色', /view\.dimColor/],
    ['压暗浓度', /view\.dim\b/],
    ['暖光强度', /view\.glow/],
    ['屋脊受光', /view\.ridge/],
    ['亮窗数', /litWindowCount\(view/],
    ['雾浓度', /view\.mist\b/],
    ['雾带高度', /view\.mistBand/],
    ['萤火虫', /firefliesVisible\(view/],
  ];
  for (const [name, pattern] of consumed) {
    assert.match(source, pattern, `${name} 没有被绘制路径消费`);
  }
});

test('切换时用 PHASES 的两刻做插值，不是写死一份常量观感', () => {
  assert.match(
    source,
    /blend\(PHASES\[fromPhase\],\s*PHASES\[targetPhase\],\s*t\)/,
    '没有从 PHASES 取两刻配方，相位切换会退化成固定观感',
  );
});
