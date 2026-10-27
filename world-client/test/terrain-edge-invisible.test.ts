/**
 * 「隐形线」闸门：**边色不得与本格底色同色。**
 *
 * `terrain-edges.ts` 自己把这条规矩写在了 `BRIGHT.plaza` 的注释里——「给 trim
 * 而不是自身也是为此：万一将来改了高度序，画出来的边也不会与底色相同、变成
 * 隐形线」——同一个文件 `DARK` 的注释还记着一次真事：`tree` 的暗边曾与底色
 * 完全相同，48 条边白画，占总写入像素的 25.6%。
 *
 * 而这条不变量**全仓库没有一处守着**。`terrain-edge-visibility.test.ts` 查的是
 * §4.1:218 那条更严的判据，但它的 `TERRAINS` 只列 5 种——`shallow`、`mud`、
 * `coal` 三种被结构性地排除在外，还硬钉「一共 10 对」。色板也只有默认那一套。
 *
 * 于是 `BRIGHT.shallow = 'water'` 与 `TERRAIN_COLORS.shallow = WORLD.water`
 * **同色**（实测 dL* 0.00）能一直躺着：莞尔镇一张 shallow 格都没有，所以肉眼
 * 从没看见过；而灯潮界有浅滩，它靠的是那份包把 `shallow` 的底色改成了
 * `copper`——撞对了，不是被守着。
 *
 * 本文件把缺口补上：**8 种材质 × 2 套已交付色板**，逐个比边色与本格底色。
 * 登记表 `KNOWN_SAME` 是已知限制清单，不是豁免名单——多出一处会红，修好一处
 * 也会红（提示删行）。所以它不会悄悄过期。
 *
 * 口径：源色，不依赖渲染、不依赖浏览器。`loadSettingPack` 已经把 palette 与
 * terrainColors 都解析成数字了，直接比。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_COLORS, WORLD } from '../src/world/palette-data.ts';
import { BRIGHT, DARK } from '../src/render/terrain-edges.ts';
import { loadSettingPack } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import type { TerrainId } from '../src/world/types.ts';
import type { WorldPalette } from '../src/world/theme.ts';

const PACK = loadSettingPack(DENGCHAO_RAW);

/** 两套已交付的色板，各带自己的地形底色表。 */
const PALETTES: readonly (readonly [string, WorldPalette, Readonly<Record<TerrainId, number>>])[] = [
  ['莞尔镇', WORLD, TERRAIN_COLORS],
  ['灯潮界', PACK.palette, PACK.terrainColors],
];

/** sRGB 十六进制 → CIE L*。与 `terrain-edge-visibility.test.ts` 同一份算法。 */
function lstar(hex: number): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((hex >> 16) & 0xff);
  const g = channel((hex >> 8) & 0xff);
  const b = channel(hex & 0xff);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y;
}

const dl = (a: number, b: number): number => Math.abs(lstar(a) - lstar(b));
const hex = (n: number): string => n.toString(16).padStart(6, '0');

/** 一种材质在一套色板上的两条边：实测落差，以及是否撞上了底色。 */
interface EdgeReading {
  readonly terrain: TerrainId;
  readonly palette: string;
  readonly base: number;
  readonly bright: number;
  readonly brightDl: number;
  readonly dark: number;
  readonly darkDl: number;
}

function measure(): readonly EdgeReading[] {
  const out: EdgeReading[] = [];
  for (const [name, palette, bases] of PALETTES) {
    for (const terrain of Object.keys(TERRAIN_COLORS) as readonly TerrainId[]) {
      const base = bases[terrain];
      const bright = palette[BRIGHT[terrain]];
      const dark = palette[DARK[terrain]];
      // token 名在色板里查不到时这里是 undefined。`loadSettingPack` 要求 24 个
      // 槽一个不少，所以今天到不了；但 `WORLD` 与包是两份数据，别赌。
      assert.ok(bright !== undefined, `${name} 的色板里没有 ${BRIGHT[terrain]}（${terrain} 的亮边）`);
      assert.ok(dark !== undefined, `${name} 的色板里没有 ${DARK[terrain]}（${terrain} 的暗边）`);
      out.push({
        terrain,
        palette: name,
        base,
        bright,
        brightDl: dl(bright, base),
        dark,
        darkDl: dl(dark, base),
      });
    }
  }
  return out;
}

const READINGS = measure();

/** 材质集合一变，这里就红——加一种地形就得连它一起量。 */
test('地形集合是 8 种：缺口正是从「只量了 5 种」里漏出去的', () => {
  assert.deepEqual(
    Object.keys(TERRAIN_COLORS).sort(),
    ['coal', 'farm', 'grass', 'mud', 'plaza', 'shallow', 'stone', 'tree'],
    '地形集合变了，重看这份覆盖面——shallow/mud/coal 曾经一种都没量过',
  );
  assert.equal(READINGS.length, 16, '8 种材质 × 2 套色板');
});

/**
 * 已知的同色边，附实测落差与它为什么今天没人看见。
 *
 * 这张表是**已知限制清单**：清单外多出一处会红，清单里的修好了也会红。
 * 修它属调色板决策（`terrain-edges.ts` 自己写着「改 BRIGHT 表需 ADR + 用户
 * 批准」），所以这里只登记、不擅自改色。
 */
const KNOWN_SAME: Readonly<Record<string, { readonly dl: number; readonly why: string }>> = {
  '莞尔镇/shallow/亮边': {
    dl: 0,
    why:
      'BRIGHT.shallow = water，而 TERRAIN_COLORS.shallow 也是 water——同色。'
      + '莞尔镇一张 shallow 格都没有，所以肉眼从没看见过；灯潮界有浅滩，'
      + '靠的是那份包把 shallow 的底色改成 copper，撞对了，不是被守着。',
  },
};

/** 撞底色的边，按「色板/材质/边」作键。 */
export function sameColorEdges(readings: readonly EdgeReading[]): readonly string[] {
  return readings
    .flatMap((r) => [
      ...(r.bright === r.base ? [`${r.palette}/${r.terrain}/亮边`] : []),
      ...(r.dark === r.base ? [`${r.palette}/${r.terrain}/暗边`] : []),
    ])
    .sort();
}

/**
 * 实测撞底色的集合与 `KNOWN_SAME` 的差集。
 *
 * `appeared` 是**新退化**（实测有、登记没有）；`gone` 是**记录过期**（登记有、
 * 实测没有）。两个方向都是红的——只看一边的闸门会被「悄悄修好」绕过，
 * 而清单失真之后，下一次真退化就会被当成已知项放过去。
 */
export function diffAgainstKnown(
  readings: readonly EdgeReading[],
  known: Readonly<Record<string, unknown>>,
): { readonly appeared: readonly string[]; readonly gone: readonly string[] } {
  const measured = sameColorEdges(readings);
  const registered = Object.keys(known).sort();
  return {
    appeared: measured.filter((k) => !(k in known)),
    gone: registered.filter((k) => !measured.includes(k)),
  };
}

/**
 * 未登记的、落差已到「肉眼分不出」的边（阈值 `FAINT_DL`）。
 *
 * 已登记的那几处不在这儿重复报警：集合比对已经钉着它们，且它们的落差就是 0，
 * 写在这里只会让同一次运行喊两遍同一句话。
 */
export const FAINT_DL = 3;

export function faintEdges(
  readings: readonly EdgeReading[],
  known: Readonly<Record<string, unknown>>,
): readonly string[] {
  return readings
    .filter(
      (r) =>
        !(r.bright === r.base && `${r.palette}/${r.terrain}/亮边` in known)
        && !(r.dark === r.base && `${r.palette}/${r.terrain}/暗边` in known),
    )
    .filter((r) => r.brightDl < FAINT_DL || r.darkDl < FAINT_DL)
    .map(
      (r) =>
        `${r.palette}/${r.terrain}：亮边 ${r.brightDl.toFixed(2)}`
        + `（${hex(r.bright)} vs 底 ${hex(r.base)}）、暗边 ${r.darkDl.toFixed(2)}`
        + `（${hex(r.dark)}）`,
    );
}

/**
 * **不变量本身**：撞底色的边的集合，必须与 `KNOWN_SAME` 一模一样。
 *
 * 两个方向都查（`diffAgainstKnown`）：多出清单外的一处 → 新退化；清单里的一处
 * 已经不撞底色了 → 记录过期。所以清单不会悄悄长，也不会悄悄失真。
 *
 * **别把这读成「登记了就能过」**——每登记一行就是多认一处破例，而
 * `terrain-edges.ts` 自己写着改 BRIGHT 表需 ADR + 用户批准。没有 ADR 就先别改色，
 * 也别登记。
 */
test('撞底色的边的集合必须与 KNOWN_SAME 一模一样', () => {
  const { appeared, gone } = diffAgainstKnown(READINGS, KNOWN_SAME);
  assert.deepEqual(
    appeared,
    [],
    `出现清单外的隐形边，属新退化：${appeared.join('、')}。`
      + ' 改 BRIGHT/DARK 表属调色板决策，需 ADR + 用户批准；没有 ADR 就别改色，也别登记。',
  );
  assert.deepEqual(
    gone,
    [],
    `这些隐形边已经不撞底色了，KNOWN_SAME 里的记录过期了，删掉对应行：${gone.join('、')}`,
  );
});

/**
 * **闸门不能是空的**：拿合成读数把三个方向各演一遍。
 *
 * 真跑一遍退化要改 `terrain-edges.ts` 的 BRIGHT 表，那是调色板决策、要 ADR，
 * 不能为了验证测试去改。所以这里直接用假读数喂同一个函数——函数是导出的，
 * 真测试与这一条跑的是同一份代码，不是一份抄的。
 */
test('闸门不是空的：新退化、记录过期、几乎同色，三个方向都喊', () => {
  const known: Readonly<Record<string, unknown>> = {
    '莞尔镇/shallow/亮边': { dl: 0 },
  };
  const base = (over: Partial<EdgeReading> = {}): EdgeReading => ({
    terrain: 'grass',
    palette: '莞尔镇',
    base: 0x3d6b7a,
    bright: 0x4d7b8a,
    brightDl: 5,
    dark: 0x1d4b5a,
    darkDl: 6,
    ...over,
  });
  /** 与登记表对齐的那一处：亮边撞底色，且已登记。合成读数得**照着它给**。 */
  const knownShallow = base({ terrain: 'shallow', bright: 0x3d6b7a, brightDl: 0 });
  const cleanList = [base(), knownShallow];

  // 干净：三个方向都不喊。
  assert.deepEqual(diffAgainstKnown(cleanList, known).appeared, []);
  assert.deepEqual(diffAgainstKnown(cleanList, known).gone, []);
  assert.deepEqual(faintEdges(cleanList, known), []);

  // 新退化：实测撞了底色，登记里没有 → appeared 喊。
  const newOne = base({ terrain: 'mud', bright: 0x3d6b7a, brightDl: 0 });
  assert.deepEqual(
    diffAgainstKnown([...cleanList, newOne], known).appeared,
    ['莞尔镇/mud/亮边'],
  );
  // 登记那一处还在，所以 gone 不喊——不能因为多出一处就把旧的吞掉。
  assert.deepEqual(diffAgainstKnown([...cleanList, newOne], known).gone, []);

  // 记录过期：登记里有，实测没有了 → gone 喊。
  assert.deepEqual(diffAgainstKnown([base()], known).gone, ['莞尔镇/shallow/亮边']);

  // 几乎同色：没撞上底色，但落差掉到 3 以下 → 哨兵喊。亮边暗边都查。
  for (const drift of [
    base({ terrain: 'stone', brightDl: 1.2 }),
    base({ terrain: 'coal', darkDl: 0.8 }),
  ]) {
    const faint = faintEdges([...cleanList, drift], known);
    assert.equal(faint.length, 1, `这一条本该被哨兵抓住：${drift.terrain}`);
    assert.match(String(faint), new RegExp(drift.terrain));
  }
  // 撞了底色却已登记的那一处，哨兵不重复喊——集合比对已经钉着它。
  assert.deepEqual(faintEdges(cleanList, known), []);
});

/** 登记的落差必须仍然成立，否则清单在说假话。 */
test('KNOWN_SAME 登记的落差必须与当前一致', () => {
  const drift: string[] = [];
  for (const r of READINGS) {
    for (const [side, value] of [
      ['亮边', r.brightDl],
      ['暗边', r.darkDl],
    ] as const) {
      const key = `${r.palette}/${r.terrain}/${side}`;
      const known = KNOWN_SAME[key];
      if (known === undefined) continue;
      if (Math.abs(known.dl - value) > 0.05) {
        drift.push(`${key} 记为 ${known.dl}，实为 ${value.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(drift, [], `以下登记已失真：${drift.join('；')}`);
});

/**
 * 未登记的、落差已到「肉眼分不出」的边。
 *
 * 0.05 与 0.00 在屏幕上没有区别。集合比对守的是「同色」这个硬事实，这一条守
 * 「几乎同色」——后者不会一次性出现，会一点点漂过去，而逐次都看着还行。
 * 阈值取自 `terrain-edge-visibility.test.ts` 的「不退化」下限 6 的一半：
 * 这里只当哨兵，不当验收线（验收仍是那一条的 8）。
 */
test('没有一条未登记的边落在「几乎同色」里（dL* >= 3）', () => {
  assert.deepEqual(
    faintEdges(READINGS, KNOWN_SAME),
    [],
    `这些边与底色的落差已在「肉眼分不出」的量级上：${faintEdges(READINGS, KNOWN_SAME).join('；')}。`
      + ' 这里只是哨兵，验收线仍是 terrain-edge-visibility.test.ts 的 8。',
  );
});
