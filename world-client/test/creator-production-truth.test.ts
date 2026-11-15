/**
 * P0 收敛的红灯：造物主评测必须只认生产真值，不许再养一套平行实现。
 *
 * 为什么用源码/文件级断言：要判的是「第二套实现**不存在**」，
 * 这不是某个函数的行为，没法用调用结果表达。仓库里 `audit-*` 那一族
 * 用的就是这个口径。括号里写了每条为什么要消失，免得后来者把它当
 * 「不许新建文件」的洁癖，又把平行实现接回来。
 *
 * 第 5 条是**生产锚点**，在 base 上就已经绿：它锁住收敛后必须保留的
 * 两个真入口。红灯只需要前四条红在断言上。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inSrc = (relative: string): string => join(ROOT, 'src', relative);
const read = (relative: string): string => readFileSync(inSrc(relative), 'utf8');

test('1. 不再有平行选址器：spatial-executor.ts 消失，桥也不再引用它', () => {
  assert.equal(
    existsSync(inSrc('world/creator/spatial-executor.ts')),
    false,
    '自动选址的唯一实现是 WorldGrid.findBestSlot（setup.ts 调它）；旁边再放一套螺旋选址器就是第二份真相',
  );
  assert.doesNotMatch(
    read('world/creator/debug-bridge.ts'),
    /spatial-executor/,
    '调试桥必须向 Simulation.enqueue 要落位结果，不能自己算坐标',
  );
});

test('2. 不再有平行施工视觉：creator-scaffolding-buildings.ts 消失，场景也不再动态 import', () => {
  assert.equal(
    existsSync(inSrc('render/creator-scaffolding-buildings.ts')),
    false,
    '生产已有 decor.syncScaffolds + SandboxScene.drawScaffolds，由 snapshot.constructions 驱动',
  );
  assert.doesNotMatch(
    read('scenes/SandboxScene.ts'),
    /creator-scaffolding-buildings/,
    '场景不应再挂第二套脚手架视图',
  );
});

test('3. 审计台账不再自己数施工拍：阶段由 snapshot.constructions 投影', () => {
  const source = read('world/creator/audit-state.ts');
  assert.doesNotMatch(
    source,
    /constructionTicksRemaining/,
    '施工时钟在生产里是 CONSTRUCTION_MS = 3200 的 remainingMs，台账只投影、不另立逻辑拍',
  );
  assert.match(
    read('world/creator/debug-bridge.ts'),
    /constructions/,
    '桥必须读生产快照的 constructions 来判 scaffolding / completed',
  );
});

test('4. 评测不再把规格夹具当生产验收：数据集要显式分组', () => {
  const main = JSON.parse(readFileSync(join(ROOT, 'eval', 'creator', 'main.json'), 'utf8')) as {
    readonly examples: readonly { readonly id: string; readonly mode?: string }[];
  };
  const held = JSON.parse(readFileSync(join(ROOT, 'eval', 'creator', 'held-out.json'), 'utf8')) as {
    readonly examples: readonly { readonly id: string; readonly mode?: string }[];
  };
  const all = [...main.examples, ...held.examples];

  // 生产里没有这六种能力；它们只能作为「还没实现的规格」存在，不能算生产验收。
  const SPEC_ONLY = ['M4', 'M5', 'M6', 'H1', 'H2', 'H4'];
  for (const example of all) {
    const expected = SPEC_ONLY.includes(example.id) ? 'spec' : 'production';
    assert.equal(
      example.mode,
      expected,
      `${example.id} 的 mode 必须是 ${expected}：生产没有对应能力却报成生产验收，就是假绿`,
    );
  }
});

test('5. 生产组的存档断言只认 v8 原生字段，不认调试侧车', () => {
  const main = JSON.parse(readFileSync(join(ROOT, 'eval', 'creator', 'main.json'), 'utf8')) as {
    readonly examples: readonly {
      readonly id: string; readonly mode?: string;
      readonly expect?: { readonly persistedFields?: readonly string[] };
    }[];
  };
  for (const example of main.examples) {
    const fields = example.expect?.persistedFields;
    if (fields === undefined) continue;
    assert.equal(example.mode, 'production', '带 persistedFields 的用例只该是生产组');
    assert.ok(
      fields.includes('autonomy'),
      `${example.id} 没有断言 v8 原生的 world.autonomy——生产验收不该只验调试侧车`,
    );
    for (const sidecar of ['creatorRules', 'fuseState']) {
      assert.equal(
        fields.includes(sidecar),
        false,
        `${example.id} 把侧车字段 ${sidecar} 算进生产验收了；它只该出现在 spec 组`,
      );
    }
  }
});

test('6. H2 必须是反事实路径差分，不许退回「只看连通率」', () => {
  const held = JSON.parse(readFileSync(join(ROOT, 'eval', 'creator', 'held-out.json'), 'utf8')) as {
    readonly examples: readonly { readonly id: string; readonly expect?: Record<string, unknown> }[];
  };
  const h2 = held.examples.find((example) => example.id === 'H2');
  assert.ok(h2 !== undefined, 'H2 不能删：它是绕行的唯一证据');
  for (const key of ['originDodged', 'routeChanged', 'roadCrossedObstacle', 'doorWalkableToAltar']) {
    assert.ok(
      h2.expect?.[key] !== undefined,
      `H2.expect 缺 ${key}：只剩连通率的话，它就与 M2 同构，绕行根本没被验证`,
    );
  }
});

test('7. 生产锚点：选址与铺路的真入口必须还在', () => {
  assert.match(read('world/grid.ts'), /findBestSlot\s*\(/, 'WorldGrid.findBestSlot 不能删');
  assert.match(read('world/setup.ts'), /export function paveFrom/, 'paveFrom 不能删');
  assert.match(read('world/simulation.ts'), /CONSTRUCTION_MS/, '施工时钟不能删');
});
