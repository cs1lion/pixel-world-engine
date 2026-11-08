/**
 * 高度层遮挡的钉子（P1）。**先红后绿**：在 base 上这两个模块不存在，
 * 本文件会红在「模块缺失」那条断言上——不是 import 崩掉（那算 ERROR）。
 *
 * 钉住三件事：
 *   1. 平面世界（全 0）不产生任何阶面与裁剪条 —— 这是 166 张基线 0 diff 的
 *      结构性理由，而不是「跑一遍看起来没变」。
 *   2. 遮挡几何**只读 `levelAt`**：给一个只暴露 width/height/levelAt 的代理，
 *      越权读任何别的字段就当场抛错。
 *   3. 裁剪条 depth 严格夹在「上一行的人」与「这一行的人」之间。
 *
 * 不测像素：像素在浏览器里、在 baseline 上验（见验收记录）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GridPoint } from '../src/world/types.ts';

/**
 * 这两个类型是**结构性写死的**，不用 `typeof import(...)`：
 * base 上模块还不存在，类型级 import 会让 red-first 变成 compile ERROR，
 * 而我们要的是「断言红」。见 docs/OPEN_ISSUES.md B7。
 */
interface LevelFieldLike {
  readonly width: number;
  readonly height: number;
  levelAt(p: GridPoint): number;
}
interface HeightViewLike {
  readonly LEVEL_PX: number;
  stepsOf(field: LevelFieldLike): { x: number; row: number; drop: number; top: number; height: number }[];
  occluderRowsOf(field: LevelFieldLike): { row: number; level: number }[];
  occluderStripDepth(row: number, altitude?: number): number;
  actorDepthOf(row: number, altitude?: number, level?: number): number;
}
interface SwitchesLike {
  hd2dEnabledOf(search: string | URLSearchParams): boolean;
  dofEnabledOf(search: string | URLSearchParams): boolean;
  occludersEnabledOf(search: string | URLSearchParams): boolean;
}

async function loadHeightView(): Promise<HeightViewLike | null> {
  try {
    return (await import('../src/render/height-view.ts')) as HeightViewLike;
  } catch {
    return null;
  }
}

async function loadSwitches(): Promise<SwitchesLike | null> {
  try {
    return (await import('../src/render/hd2d-switch.ts')) as SwitchesLike;
  } catch {
    return null;
  }
}

/** 只按坐标表回答高度的假世界。 */
function fieldOf(width: number, height: number, levels: Record<string, number>) {
  return {
    width,
    height,
    levelAt: (p: GridPoint): number => levels[`${p.x},${p.y}`] ?? 0,
  };
}

/** 只许读三个字段的代理：任何越权读都抛，用来钉「唯一真源」。 */
function strictField(width: number, height: number, levels: Record<string, number>) {
  const base = fieldOf(width, height, levels);
  return new Proxy(base, {
    get(target, key: string | symbol) {
      if (key === 'width' || key === 'height' || key === 'levelAt') {
        return Reflect.get(target, key);
      }
      throw new Error(`遮挡几何越权读了高度以外的东西：${String(key)}`);
    },
  });
}

describe('hd2d / dof 开关', () => {
  it('缺省必须是关（不写参数、写 off、写别的值都关）', async () => {
    const mod = await loadSwitches();
    assert.ok(mod, 'render/hd2d-switch.ts 必须先存在');
    assert.equal(mod.hd2dEnabledOf(''), false);
    assert.equal(mod.hd2dEnabledOf('?hd2d=off'), false);
    assert.equal(mod.hd2dEnabledOf('?hd2d=0'), false);
    assert.equal(mod.dofEnabledOf(''), false);
    assert.equal(mod.dofEnabledOf('?dof=off'), false);
    assert.equal(mod.dofEnabledOf('?hd2d=on'), false, 'hd2d 不能把 dof 一起打开');
  });

  it('只有 on / 1 算开', async () => {
    const mod = await loadSwitches();
    assert.ok(mod, 'render/hd2d-switch.ts 必须先存在');
    assert.equal(mod.hd2dEnabledOf('?hd2d=on'), true);
    assert.equal(mod.hd2dEnabledOf('?hd2d=1'), true);
    assert.equal(mod.dofEnabledOf('?dof=on'), true);
    assert.equal(mod.dofEnabledOf('?dof=1'), true);
    assert.equal(mod.hd2dEnabledOf(new URLSearchParams('hd2d=on')), true);
  });

  it('?occluders=off 只关遮挡条：高度层开着、遮挡条不出', async () => {
    const mod = await loadSwitches();
    assert.ok(mod, 'render/hd2d-switch.ts 必须先存在');
    assert.equal(mod.occludersEnabledOf('?hd2d=on'), true, '缺省跟随 hd2d=on');
    assert.equal(mod.occludersEnabledOf('?hd2d=1'), true);
    assert.equal(mod.occludersEnabledOf('?hd2d=on&occluders=off'), false);
    assert.equal(mod.occludersEnabledOf('?hd2d=on&occluders=0'), false);
    assert.equal(mod.occludersEnabledOf('?hd2d=on&occluders=bogus'), true, '只有 off/0 算关');
    assert.equal(mod.occludersEnabledOf(''), false, 'hd2d 关着时遮挡条本来就不该存在');
    assert.equal(mod.occludersEnabledOf('?occluders=on'), false, '单独开 occluders 不能绕过 hd2d');
  });
});

describe('平面世界：高度层必须是空操作', () => {
  it('全 0 的世界不产生阶面，也不产生裁剪条', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const flat = fieldOf(40, 30, {});
    assert.deepEqual(mod.stepsOf(flat), []);
    assert.deepEqual(mod.occluderRowsOf(flat), []);
  });

  it('?hd2d=on 但世界全 0 时仍然什么都不出（这就是 166 张 0 diff 的结构理由）', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const flat = fieldOf(40, 30, { '7,9': 0, '8,9': 0 });
    assert.equal(mod.stepsOf(flat).length, 0);
    assert.equal(mod.occluderRowsOf(flat).length, 0);
  });
});

describe('阶面只在南缘（D2：无旋转、无侧立面）', () => {
  it('单格抬高一级：只出一条朝南的阶面，贴在自己这一行的下沿', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const field = fieldOf(8, 8, { '2,2': 1 });
    const steps = mod.stepsOf(field);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].x, 2);
    assert.equal(steps[0].row, 2);
    assert.equal(steps[0].drop, 1);
    assert.equal(steps[0].height, mod.LEVEL_PX);
    assert.equal(steps[0].top, 2 * mod.LEVEL_PX);
  });

  it('东、西两侧同高不顺带出侧立面：只按「正南更低」这一条判', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    // 横着抬三格，正南全是 0：每格各出一条自己的南缘阶面，共 3 条；
    // 东/西方向的相邻高差一条都不该出（D2：不做侧立面）。
    const field = fieldOf(8, 8, { '1,2': 1, '2,2': 1, '3,2': 1 });
    assert.deepEqual(
      mod.stepsOf(field).map((step) => step.x),
      [1, 2, 3],
      '只该有每格的南缘阶面，不该多出侧立面',
    );
  });

  it('多级台阶：阶面高度不再被一行夹住（H3 台面上移已做）', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const field = fieldOf(8, 8, { '2,2': 3 });
    const [step] = mod.stepsOf(field);
    assert.equal(step.drop, 3);
    assert.equal(step.height, 3 * mod.LEVEL_PX, '三级台阶必须画三级高的崖面');
    // 顶边 = 行底 + 一格 - drop*一格：三级时落到 row-1 的南半格，正是压住北侧人的那条带。
    assert.equal(step.top, 2 * mod.LEVEL_PX + mod.LEVEL_PX - 3 * mod.LEVEL_PX);
  });

  it('一级台阶的读数与上一笔逐字段相同（0 diff 的结构理由不靠重录）', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const [step] = mod.stepsOf(fieldOf(8, 8, { '2,2': 1 }));
    assert.equal(step.height, mod.LEVEL_PX);
    assert.equal(step.top, 2 * mod.LEVEL_PX);
  });
});

describe('裁剪条：只在由北向南抬升的那一行', () => {
  it('台阶那一行要出裁剪条，低处那一行不出', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const field = fieldOf(8, 8, { '2,2': 1 });
    assert.deepEqual(mod.occluderRowsOf(field), [{ row: 2, level: 1 }]);
  });

  it('连成片的台地只出第一条边：内部同高的行不该多切一条', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const field = fieldOf(8, 8, { '2,2': 1, '2,3': 1, '2,4': 1 });
    assert.deepEqual(mod.occluderRowsOf(field), [{ row: 2, level: 1 }]);
  });

  it('一行里有多个格子时取最高的那级', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const field = fieldOf(8, 8, { '1,3': 1, '4,3': 2 });
    assert.deepEqual(mod.occluderRowsOf(field), [{ row: 3, level: 2 }]);
  });

  it('裁剪条 depth 严格夹在上一行与这一行的人之间（含缩放无关的整数像素）', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const TILE = 16;
    // 角色 depth = 脚底 y + 8（villager.ts 的 villagerDepthAt）；第 r 行脚底在 (r+1)*TILE。
    const actorDepth = (row: number): number => (row + 1) * TILE + 8;
    for (let row = 1; row < 30; row += 1) {
      const strip: number = mod.occluderStripDepth(row);
      assert.ok(strip > actorDepth(row - 1), `第 ${row} 行的裁剪条压不住北侧的人`);
      assert.ok(strip < actorDepth(row), `第 ${row} 行的裁剪条会盖住站在台地上的人`);
      assert.equal(Number.isInteger(strip), true, 'depth 必须是整数像素');
      assert.equal(mod.occluderStripDepth(row, 100), strip + 100, 'altitude 只能整体平移');
    }
  });

  it('台地上的人仍压在裁剪条之上（level 只做极小分档，不改行序）', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    for (let row = 1; row < 30; row += 1) {
      const strip: number = mod.occluderStripDepth(row);
      const north = mod.actorDepthOf(row - 1, 0, 0);
      const onTop = mod.actorDepthOf(row, 0, 1);
      assert.ok(strip > north, `第 ${row} 行：北侧人（level 0）必须被压住`);
      assert.ok(onTop > strip, `第 ${row} 行：站在台地上的人（level 1）必须在条之上`);
      assert.equal(mod.actorDepthOf(row, 0, 0), (row + 1) * 16 + 8, 'level 0 与旧公式逐字相同');
      assert.equal(mod.actorDepthOf(row, 0, 1), (row + 1) * 16 + 8 - 0.5, 'level 1 只低 0.5');
    }
  });
});

describe('唯一真源：几何只读 levelAt', () => {
  it('给一个只暴露 width/height/levelAt 的代理也能算完', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const strict = strictField(8, 8, { '2,2': 1 });
    assert.equal(mod.stepsOf(strict).length, 1);
    assert.deepEqual(mod.occluderRowsOf(strict), [{ row: 2, level: 1 }]);
  });

  it('同一世界的两次计算逐字段相同（不看时钟、不看相机）', async () => {
    const mod = await loadHeightView();
    assert.ok(mod, 'render/height-view.ts 必须先存在');
    const field = fieldOf(12, 9, { '3,4': 2, '4,4': 1, '5,4': 1 });
    assert.deepEqual(mod.stepsOf(field), mod.stepsOf(field));
    assert.deepEqual(mod.occluderRowsOf(field), mod.occluderRowsOf(field));
  });
});
