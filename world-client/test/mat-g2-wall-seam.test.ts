/**
 * MAT-G2：墙面横板缝必须按**世界坐标**锚定，不许按楼体局部坐标（`roofH` 派生）。
 *
 * 判据：两栋**同排、同材质、不同 `roofH`** 的建筑，板缝 y 集合对世界基线取模后
 * 必须相等。当前位置由 `bodyTop = roofH + 3` 与 `seed` 派生，`roofH` 一变整排
 * 缝就跟着平移，取模必然不等——这是先红要打的点。
 *
 * 绿版口径：`WALL_SEAM_PITCH = 16`，从世界基线上取整落第一行；`seed` 只决定
 * 深浅（alpha），不决定位置。板缝必须整行落在墙带 `roofH + 3 .. h - 8` 内。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- 动态模块
//
// `WALL_SEAM_PITCH` / `wallSeamRows` 是这次合入才有的导出。静态 import 在 base
// 上会 `SyntaxError: does not provide an export named`，被 `red:first` 归成
// compile（exit 2）；改成动态 import + 显式断言后，base 上红在断言上。

interface WallSeamModule {
  readonly WALL_SEAM_PITCH?: number;
  readonly wallSeamRows?: (baseY: number, roofH: number, h: number, seed: number) => readonly number[];
}

interface WallSeamApi {
  readonly pitch: number;
  readonly rows: (baseY: number, roofH: number, h: number, seed: number) => readonly number[];
}

const BUILDINGS_MODULE_PATH = '../src/render/buildings.ts';

async function wallSeam(): Promise<WallSeamApi> {
  let mod: WallSeamModule = {};
  try {
    mod = (await import(BUILDINGS_MODULE_PATH)) as WallSeamModule;
  } catch {
    // 模块整体不存在时也按「缺导出」处理：红在断言上，不红在解析上。
  }
  assert.equal(typeof mod.WALL_SEAM_PITCH, 'number', 'render/buildings.ts 必须导出 WALL_SEAM_PITCH');
  assert.equal(typeof mod.wallSeamRows, 'function', 'render/buildings.ts 必须导出 wallSeamRows');
  return { pitch: mod.WALL_SEAM_PITCH!, rows: mod.wallSeamRows! };
}

const H = 96;

/** 板缝相对世界基线取模后的集合（排序后拼成字符串，便于断言相等）。 */
function residues(seam: WallSeamApi, baseY: number, roofH: number, h: number, seed: number): string {
  const set = new Set(
    seam.rows(baseY, roofH, h, seed).map((y) => {
      const world = baseY + y;
      return ((world % seam.pitch) + seam.pitch) % seam.pitch;
    }),
  );
  return [...set].sort((a, b) => a - b).join(',');
}

test('MAT-G2 墙面纹理按世界坐标连续（相邻建筑同朝向不错位）', async () => {
  const seam = await wallSeam();
  const BASE_Y = 5 * seam.pitch;
  // 同一排 = 同一个世界基线；同材质 = 同一套 24 色；roofH 不同是因为楼高不同。
  const short = { roofH: 20, h: H };
  const tall = { roofH: 34, h: H };

  const shortRows = seam.rows(BASE_Y, short.roofH, short.h, 0x12345678);
  const tallRows = seam.rows(BASE_Y, tall.roofH, tall.h, 0x12345678);
  assert.ok(shortRows.length > 0, '矮楼的板缝集合为空，判据不成立');
  assert.ok(tallRows.length > 0, '高楼的板缝集合为空，判据不成立');

  assert.equal(
    residues(seam, BASE_Y, short.roofH, short.h, 0x12345678),
    residues(seam, BASE_Y, tall.roofH, tall.h, 0x12345678),
    `同排同材质、不同 roofH 的两栋楼板缝对世界基线取模不等：`
      + `${residues(seam, BASE_Y, short.roofH, short.h, 0x12345678)} vs `
      + `${residues(seam, BASE_Y, tall.roofH, tall.h, 0x12345678)}`,
  );

  // 同材质不等于同一个门位：seed 由门位派生，跨栋本来就不会相同。
  // 板缝位置必须与 seed 无关（seed 只许改深浅），否则相邻两栋照样错位。
  assert.equal(
    residues(seam, BASE_Y, short.roofH, short.h, 0x0badf00d),
    residues(seam, BASE_Y, tall.roofH, tall.h, 0x12345678),
    '板缝位置随 seed 变了：seed 只能决定深浅，不能决定位置',
  );
});

test('MAT-G2 板缝整行落在墙带内（roofH + 3 .. h - 8）', async () => {
  const seam = await wallSeam();
  const BASE_Y = 5 * seam.pitch;
  for (const roofH of [20, 34]) {
    const rows = seam.rows(BASE_Y, roofH, H, 0x12345678);
    for (const y of rows) {
      assert.ok(y >= roofH + 3, `板缝 y=${y} 越到檐影/屋顶里（墙带上沿 ${roofH + 3}）`);
      assert.ok(y <= H - 8, `板缝 y=${y} 越到横梁/地基里（墙带下沿 ${H - 8}）`);
    }
  }
});

test('MAT-G2 板缝只用既有暗色 token（零新增色）', () => {
  const source = readFileSync(new URL('../src/render/buildings.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const seams = wallSeamRows');
  const end = source.indexOf('const specks =');
  assert.ok(start >= 0 && end > start, 'drawWall 里找不到 board-seam 绘制段');
  const body = source.slice(start, end);
  const tokens = [...body.matchAll(/paletteFor\(\)\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual(
    new Set(tokens),
    new Set(['timberDark']),
    `板缝用了暗色 token 之外的颜色：${[...new Set(tokens)].join(', ')}`,
  );
});
