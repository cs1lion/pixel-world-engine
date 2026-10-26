import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { loadSettingPack, SettingPackError } from '../src/settings/load.ts';

/**
 * 24 色预算对**设定集**这一侧的守卫。
 *
 * 世界自己的 24 色由 `palette-budget.test.ts` 守；这一份守的是「换一份设定集
 * 也不能破预算」——SPEC_V2 §4.2 把预算定为引擎级约束，不是某一份配置的私事。
 */
test('设定集的 24 个槽各占一个不同的色值，重复值一律拒收', () => {
  // 这正是发生过的事：grassLit 与 stone 都填了 #52666a。
  // 只查「不超过 24」的装载器放它过去，画面上「草地受光面」这个槽根本不存在，
  // 而调用方以为 24 色都占着。
  const dup = { ...DENGCHAO_RAW, palette: { ...DENGCHAO_RAW.palette, grassLit: DENGCHAO_RAW.palette.stone } };
  assert.throws(() => loadSettingPack(dup), SettingPackError);

  // 换一对也一样：不是只盯着 grassLit 这一个名字。
  const dup2 = { ...DENGCHAO_RAW, palette: { ...DENGCHAO_RAW.palette, water: DENGCHAO_RAW.palette.amber } };
  assert.throws(() => loadSettingPack(dup2), SettingPackError);
});

test('漏填一个色板槽就拒收，不拿别的地形的颜色顶替', () => {
  const palette: Record<string, string> = { ...DENGCHAO_RAW.palette };
  delete palette.warmLight;
  assert.throws(() => loadSettingPack({ ...DENGCHAO_RAW, palette }), /缺少色板槽 warmLight/);
});

test('每种地形都要有自己的落点，缺一种就拒收', () => {
  const terrainColors: Record<string, string> = { ...DENGCHAO_RAW.terrainColors };
  delete terrainColors.coal;
  assert.throws(() => loadSettingPack({ ...DENGCHAO_RAW, terrainColors }), /缺少地形配色 coal/);

  // 指向一个不存在的 token 同样拒：那会让地形静默落到别色上。
  assert.throws(
    () => loadSettingPack({ ...DENGCHAO_RAW, terrainColors: { ...DENGCHAO_RAW.terrainColors, mud: '藤紫' } }),
    /色 藤紫 不在 24 色里/,
  );
});

test('合法配置仍然装载，且 24 个槽一个不少', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  assert.equal(Object.keys(pack.palette).length, 24);
  assert.equal(new Set(Object.values(pack.palette)).size, 24);
  assert.equal(Object.keys(pack.terrainColors).length, 8);
});
