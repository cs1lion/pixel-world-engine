/**
 * MAT-G3：边饰统一（台阶底 1px / 墙右下 1px）。
 *
 * 判据是 `edgeRows(kind)` 返回的**计划**：抬升构件的固定边饰——上/左亮、下/右暗，
 * 这是作图约定，不是光照推导（建筑影是固定右下的静态结构/接触影，不来自太阳）。
 * token 只用既有暗色（soil / timberDark / ink），不新增色、不叠第二层。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORLD } from '../src/world/palette-data.ts';

// ---------------------------------------------------------------- 动态模块
//
// `edgeRows` 是这次合入才有的导出。静态 import 在 base 上会
// `SyntaxError: does not provide an export named`，被 `red:first` 归成
// compile（exit 2）；改成动态 import + 显式断言后，base 上红在断言上。

interface EdgeRowView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly token: string;
  readonly alpha: number;
}

interface BuildingsModule {
  readonly edgeRows?: (
    kind: 'doorStep' | 'wall',
    rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ) => readonly EdgeRowView[];
}

const BUILDINGS_MODULE_PATH = '../src/render/buildings.ts';

async function edgeRowsOf(): Promise<NonNullable<BuildingsModule['edgeRows']>> {
  let mod: BuildingsModule = {};
  try {
    mod = (await import(BUILDINGS_MODULE_PATH)) as BuildingsModule;
  } catch {
    // 模块整体不存在时也按「缺导出」处理：红在断言上，不红在解析上。
  }
  assert.equal(typeof mod.edgeRows, 'function', 'render/buildings.ts 必须导出 edgeRows');
  return mod.edgeRows!;
}

const step = { x: 0, y: 100, w: 24, h: 3 };

test('MAT-G3 台阶有底部暗行：1px、既有暗色、不越出台阶', async () => {
  const edgeRows = await edgeRowsOf();
  const rows = edgeRows('doorStep', step);
  assert.ok(rows.length > 0, '台阶没有底部暗行：edgeRows 返回空');
  const bottom = rows.filter((row) => row.y === step.y + step.h - 1);
  assert.equal(bottom.length, 1, `台阶底应恰好一条 1px 暗行，实际 ${bottom.length} 条`);
  const row = bottom[0]!;
  assert.equal(row.h, 1, '台阶底暗行必须是 1px 高');
  assert.equal(row.alpha, 1, '暗边用实色：半透明会被下面石板透上来，读成脏灰');
  assert.ok(row.x >= step.x && row.x + row.w <= step.x + step.w, '暗行越出台阶范围');
  assert.ok(
    (WORLD as Record<string, number>)[row.token] !== undefined,
    `暗行 token ${row.token} 不在 24 色 palette 里（零新增色是硬条件）`,
  );
});

test('MAT-G3 墙右下有 1px 暗列：判据', async () => {
  const edgeRows = await edgeRowsOf();
  const wall = { x: 0, y: 30, w: 64, h: 40 };
  const rows = edgeRows('wall', wall);
  const column = rows.find((row) => row.w === 1 && row.h === wall.h);
  assert.ok(column !== undefined, '墙没有整列暗边：edgeRows 返回空');
  assert.equal(column.x, wall.x + wall.w - 1, '暗列必须贴在墙的右下边（固定边饰）');
  assert.ok(
    (WORLD as Record<string, number>)[column.token] !== undefined,
    `暗列 token ${column.token} 不在 24 色 palette 里`,
  );
});

test('MAT-G3 墙右暗列接入 drawWall', () => {
  const source = readFileSync(new URL('../src/render/buildings.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function drawWall');
  const end = source.indexOf('function drawFacade');
  const body = source.slice(start, end);
  assert.ok(body.includes("edgeRows('wall'"), 'drawWall 还没有消费 edgeRows(\'wall\')');
});
