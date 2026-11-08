/**
 * `?hpatch=` 调试演示口的钉子。**先红后绿**：在 base 上模块不存在，这里红在
 * 「模块必须先存在」那条断言上，而不是 import 崩掉。
 *
 * 钉住三条（这轮用户裁决的口径）：
 *   1. **只在 `?hd2d=on` 时解析**：关着时这个参数根本不进解析器——格式错也不抛。
 *   2. 开着时格式错必须 **throw**，不许静默降级成平地。
 *   3. 解析结果是纯数据，不写存档、不碰世界。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

interface DemoPatch {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly level: number;
}

interface DemoModuleLike {
  demoLevelPatchesOf(search: string | URLSearchParams, hd2dOn: boolean): DemoPatch[];
}

async function loadDemo(): Promise<DemoModuleLike | null> {
  try {
    return (await import('../src/world/height-demo.ts')) as DemoModuleLike;
  } catch {
    return null;
  }
}

describe('?hpatch 调试演示口', () => {
  it('模块必须先存在', async () => {
    assert.ok(await loadDemo(), 'src/world/height-demo.ts 必须先存在');
  });

  it('开关关着时结构上不解析：不写参数、格式写坏都不抛', async () => {
    const mod = await loadDemo();
    assert.ok(mod, 'src/world/height-demo.ts 必须先存在');
    assert.deepEqual(mod.demoLevelPatchesOf('', false), []);
    assert.deepEqual(mod.demoLevelPatchesOf('?hd2d=off&hpatch=whatever', false), []);
    assert.deepEqual(mod.demoLevelPatchesOf('?hpatch=1,2,3', false), [], '关着时连格式都不看');
  });

  it('开着时解析出一块：x,y,w,h,level', async () => {
    const mod = await loadDemo();
    assert.ok(mod, 'src/world/height-demo.ts 必须先存在');
    assert.deepEqual(mod.demoLevelPatchesOf('?hd2d=on&hpatch=10,20,3,3,1', true), [
      { x: 10, y: 20, w: 3, h: 3, level: 1 },
    ]);
    assert.deepEqual(mod.demoLevelPatchesOf(new URLSearchParams('hd2d=on&hpatch=4,5,1,1,2'), true), [
      { x: 4, y: 5, w: 1, h: 1, level: 2 },
    ]);
  });

  it('多块用分号分隔，顺序即后写的赢', async () => {
    const mod = await loadDemo();
    assert.ok(mod, 'src/world/height-demo.ts 必须先存在');
    assert.deepEqual(mod.demoLevelPatchesOf('?hd2d=on&hpatch=1,2,1,1,1;5,6,2,2,3', true), [
      { x: 1, y: 2, w: 1, h: 1, level: 1 },
      { x: 5, y: 6, w: 2, h: 2, level: 3 },
    ]);
  });

  it('格式错必须 throw：不许静默降级成平地', async () => {
    const mod = await loadDemo();
    assert.ok(mod, 'src/world/height-demo.ts 必须先存在');
    const bad = [
      '',
      'x',
      '1,2,3,4',
      '1,2,3,4,1.5',
      '1,2,0,1,1',
      '1,2,1,0,1',
      '-1,2,1,1,1',
      '1,2,1,1,4',
      '1,2,1,1,-1',
      '1,2,1,1,1;bad',
      '1,2,1,1,1;',
    ];
    for (const raw of bad) {
      assert.throws(
        () => mod.demoLevelPatchesOf(`?hd2d=on&hpatch=${raw}`, true),
        Error,
        `hpatch=${raw} 应当 throw`,
      );
    }
  });

  it('不写存档、不参与回放：模块只吐坐标，不 import 任何存储', async () => {
    const mod = await loadDemo();
    assert.ok(mod, 'src/world/height-demo.ts 必须先存在');
    const patch = mod.demoLevelPatchesOf('?hd2d=on&hpatch=7,8,1,1,1', true)[0];
    assert.deepEqual(Object.keys(patch).sort(), ['h', 'level', 'w', 'x', 'y']);
  });
});
