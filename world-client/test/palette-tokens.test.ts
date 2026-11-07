import { readFileSync } from 'node:fs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * 解析不出的 palette token **不许静默丢弃**。
 *
 * 旧实现只把能匹配 `name: 0xRRGGBB` / `name: WORLD.x` 的行收进 tokens，
 * 其余 `continue` 掉；别名指向不存在的槽也会被 `filter` 掉。于是「24 色」这句
 * 永远成立——哪怕某一行被写成 `'#4e6241'`，或指向了 `WORLD.ghost`。
 * 这里钉住：形状漂移与别名断链都要报出**符号名 + 原始值 + 原因**。
 *
 * 脚本模块是 `.mjs`（`tsconfig` 不开 allowJs），所以动态 import + 自己写接口。
 */

interface Token {
  readonly object: string;
  readonly name: string;
  readonly fullName: string;
  readonly raw: string;
  readonly hex: string;
  readonly aliasOf: string | null;
}
interface Dropped {
  readonly object: string;
  readonly name: string | null;
  readonly fullName: string;
  readonly raw: string;
  readonly reason: string;
}
interface PaletteModule {
  PALETTE_OBJECTS?: string[];
  parsePaletteTokens?: (
    source: string,
    options?: { file?: string },
  ) => { tokens: Token[]; dropped: Dropped[] };
}

const MODULE_PATH: string = '../scripts/lib/palette-tokens.mjs';
const load = async (): Promise<PaletteModule> => {
  try {
    return (await import(MODULE_PATH)) as unknown as PaletteModule;
  } catch {
    return {};
  }
};

const SOURCE = readFileSync(new URL('../src/world/palette-data.ts', import.meta.url), 'utf8');

test('正例：真实 palette-data.ts 全部解析，dropped=0', async () => {
  const lib = await load();
  assert.equal(typeof lib.parsePaletteTokens, 'function', '缺 parsePaletteTokens 导出');
  const { tokens, dropped } = lib.parsePaletteTokens!(SOURCE);
  assert.deepEqual(dropped, [], `正例不应有丢弃：${JSON.stringify(dropped, null, 2)}`);
  assert.equal(tokens.length, 37, `正例 token 数变了：${tokens.length}`);
  const objects = lib.PALETTE_OBJECTS ?? ['WORLD', 'TERRAIN_COLORS', 'TERRAIN_SPECK'];
  const counts = Object.fromEntries(
    objects.map((object) => [object, tokens.filter((token) => token.object === object).length]),
  );
  assert.deepEqual(counts, { WORLD: 24, TERRAIN_COLORS: 8, TERRAIN_SPECK: 5 }, JSON.stringify(counts));
});

test('形状漂移 moss: 0x4e6241 → moss: \'#4e6241\'：报出符号名与原始值', async () => {
  const lib = await load();
  assert.equal(typeof lib.parsePaletteTokens, 'function', '缺 parsePaletteTokens 导出');
  const drifted = SOURCE.replace('  moss: 0x4e6241,', "  moss: '#4e6241',");
  const { tokens, dropped } = lib.parsePaletteTokens!(drifted);
  assert.equal(dropped.length, 1, `应报 1 条丢弃，实际：${JSON.stringify(dropped, null, 2)}`);
  assert.equal(dropped[0]!.fullName, 'WORLD.moss', '位置要用符号名，不用行号');
  assert.match(dropped[0]!.raw, /#4e6241/);
  assert.match(dropped[0]!.reason, /形状不符/);
  assert.equal(tokens.length, 36, '被丢弃的那条不能混进 tokens');
});

test('别名指向不存在的槽：报出别名符号名与目标', async () => {
  const lib = await load();
  assert.equal(typeof lib.parsePaletteTokens, 'function', '缺 parsePaletteTokens 导出');
  const drifted = SOURCE.replace('  grass: WORLD.grass,', '  grass: WORLD.ghost,');
  const { dropped } = lib.parsePaletteTokens!(drifted);
  assert.equal(dropped.length, 1, `应报 1 条丢弃，实际：${JSON.stringify(dropped, null, 2)}`);
  assert.equal(dropped[0]!.fullName, 'TERRAIN_COLORS.grass');
  assert.equal(dropped[0]!.raw, 'WORLD.ghost');
  assert.match(dropped[0]!.reason, /不存在的 token：WORLD\.ghost/);
});

test('对象块缺失：报出块名而不是静默跳过', async () => {
  const lib = await load();
  assert.equal(typeof lib.parsePaletteTokens, 'function', '缺 parsePaletteTokens 导出');
  const missing = SOURCE.replace(/export const TERRAIN_SPECK = \{/, 'const TERRAIN_SPECK = {');
  const { dropped } = lib.parsePaletteTokens!(missing);
  assert.equal(dropped.length, 1, `应报 1 条块缺失，实际：${JSON.stringify(dropped, null, 2)}`);
  assert.equal(dropped[0]!.fullName, 'TERRAIN_SPECK');
  assert.match(dropped[0]!.reason, /块定义/);
});
