/**
 * 「隐形线」闸门：**边色不得与本格底色同色。**
 *
 * `terrain-edges.ts` 自己把这条规矩写在了 `BRIGHT.plaza` 的注释里——「给 trim
 * 而不是自身也是为此：万一将来改了高度序，画出来的边也不会与底色相同、变成
 * 隐形线」——同一个文件 `DARK` 的注释还记着一次真事：`tree` 的暗边曾与底色
 * 完全相同。那批像素的计数住在 `terrain-edges.ts` 里，由
 * `terrain-edge-pixels.test.ts` 钉住（默认世界 2597 个 tree 格、630 格画暗边、
 * 整批 11568 px）；这里**不重抄**那些数。
 *
 * 而这条不变量**只被守住一半**。`terrain-edges.test.ts` 有「暗边不能与本格底色
 * 相同」与「亮边不能与本格底色相同」两条，可它的 `TERRAINS` 只列 5 种——`shallow`、
 * `mud`、`coal` 三种被结构性地排除在外，色板也只有默认那一套。第一版这里写「全仓库没有一处守着」，那是假话：
 * 那两条就在那儿。把已经有人守的地方说成空白，比没有守卫更糟——照着这句话动手
 * 的人会以为自己在补缺口，其实那儿已经有人了，而他会重复问一个已经问过的问题。
 * （这两条原来带着行号 `:107` 与 `:127`——**是我自己写错的**：`29c20bf` 在同一笔
 * 里往上加了四行撤回过头的数，把这两条从 107/127 推到了 111/131，而我写的还是
 * 加行之前的号。`--strict` 查不出来，因为 107 与 127 两行都「有代码」，只是不再是
 * 这两条守卫。所以这里改成**只叫标题、不叫行**——测试的标题比行号稳。）
 *
 * 于是 `BRIGHT.shallow = 'water'` 与 `TERRAIN_COLORS.shallow = WORLD.water`
 * **同色**（实测 dL* 0.00）能一直躺着：莞尔镇一张 shallow 格都没有，所以肉眼
 * 从没看见过；而灯潮界有浅滩，它靠的是那份包把 `shallow` 的底色改成了
 * `moss`（2026-10-30 之前是 `copper`，那同样是撞对了而不是被守着——两次都
 * 只是恰好不等于 `water`，没有一条断言在守这件事）。
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
import { readFileSync } from 'node:fs';
import { TERRAIN_COLORS, WORLD } from '../src/world/palette-data.ts';
import { BRIGHT, DARK, EDGE_VISIBLE_MIN_DL } from '../src/render/terrain-edges.ts';
import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import type { TerrainId } from '../src/world/types.ts';
import type { WorldPalette } from '../src/world/theme.ts';

const PACK = loadSettingPack(DENGCHAO_RAW);

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 两座真的世界，为的是能数格子——`KNOWN_SAME` 那句 `why` 得有事可核。 */
const waner = { grid: buildLargeWorld(blueprints).grid };
const dengchao = { grid: buildSettingWorld(PACK).grid };

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
 * 修它属调色板决策，所以这里只登记、不擅自改色。
 *
 * 「需 ADR + 用户批准」这条规矩**不写在 `terrain-edges.ts` 里**——它写在兄弟
 * 守卫 `terrain-edge-visibility.test.ts` 的文件头（`terrain-edge-visibility.test.ts:35`）
 * 与 `KNOWN_FAILING` 的 `skipReason`（`:184`）上，根子在
 * `palette-data.ts` 记着的那次「2026-10-21 用户批准 24 色 ADR」（`creator-schema.ts`
 * 拿它当理由拒十六进制字面量）。第一版这段注释把原话安到了 `terrain-edges.ts`
 * 头上，那句话在那儿一个字都没有——指一处规矩得指对地方，指错了比不指更糟。
 * （第二版又错一处：写的是「同一条**断言消息**上」。它不是断言消息，是文件头
 *  的散文加一个 `skipReason` 字符串。实质的归属是对的，错的只是那个名词——
 *  可「写在断言消息上」会让人去断言里找，找不到就以为规矩没了。）
 */
const KNOWN_SAME: Readonly<Record<string, { readonly dl: number; readonly why: string }>> = {
  '莞尔镇/shallow/亮边': {
    dl: 0,
    why:
      'BRIGHT.shallow = water，而 TERRAIN_COLORS.shallow 也是 water——同色。'
      + '莞尔镇一张 shallow 格都没有，所以肉眼从没看见过；灯潮界有浅滩，'
      + '靠的是那份包把 shallow 的底色改成了 moss，撞对了，不是被守着。',
  },
};

/**
 * 那句 `why` 的第三分句原来没有任何 stake。
 *
 * 「靠的是那份包把 shallow 的底色改成了 moss」是三句可验事实之一（另两句是
 * 莞尔镇没有浅滩、灯潮界有，都由下面那条测试钉着）。可集合比对只可能在一处
 * 让它红：底色变成**恰好** water。若改成别的任意 token，只要解析后的色值不等于
 * water，同色就消失了、`gone` 会红——那条路是通的；但若那个 token 解析出来**正是**
 * water（或将来有人在 `palette` 里把 water 改得与 moss 同值），同色照旧，
 * 集合比对一声不响，而这句话已经成了假话。
 *
 * 所以这里直接钉 token 名，并且钉「不是水色」这个实质。两条都指向
 * `DENGCHAO_RAW`——`loadSettingPack` 把一切都解析成数字了，token 名在装载器
 * 出口处就拿不到，而这句话说的恰恰是**写在包里的那个选择**。
 *
 * 2026-10-30：随 `terrainColors.shallow` 由 `copper` 改为 `moss` 一并更新。
 * 那条改动的理由是「`copper` 同时是 `shoal` 的主色，主色槽画上去等于没画」。
 */
test('登记理由的第三分句：灯潮界把 shallow 的底色选成了 moss，且那不是水色', () => {
  assert.equal(
    DENGCHAO_RAW.terrainColors.shallow,
    'moss',
    'KNOWN_SAME 那句「那份包把 shallow 的底色改成了 moss」成了假话——回去改注释',
  );
  assert.notEqual(
    PACK.terrainColors.shallow,
    PACK.palette.water,
    '灯潮界的浅滩底色与水色同值了——那句「撞对了」不再成立，这是新的同色退化',
  );
});

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
 * **别把这读成「登记了就能过」**——每登记一行就是多认一处破例，而改 BRIGHT
 * 表属调色板决策、需 ADR + 用户批准（规矩写在 `terrain-edge-visibility.test.ts`
 * 的文件头与 `skipReason` 上，见 `KNOWN_SAME` 上那段）。没有 ADR 就先别改色，也别登记。
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
 * `KNOWN_SAME` 那句 `why` 的依据，得是能核的。
 *
 * 那一行写着「莞尔镇一张 shallow 格都没有，所以肉眼从没看见过；灯潮界有浅滩」。
 * 这是**全部依据**：它解释了为什么一处 dL*=0 的隐形边能一直躺着没人发现。
 * 可它是散文——上面那条集合比对只量「边的颜色」，不量「世界上有没有这种格」。
 * 于是将来有人往莞尔镇加一片浅滩，`why` 变成了假话，而全套照样绿。
 *
 * 「说谎比不去更糟」对注释一样成立。所以把这句话的两半各钉一根桩：莞尔镇确实
 * 没有，灯潮界确实有。任一半塌了都会红，逼着改注释——而改注释的时候就会
 * 重新看见那处 dL*=0。
 */
test('登记理由的依据：莞尔镇没有浅滩，灯潮界有', () => {
  const count = (grid: { width: number; height: number; at: (p: { x: number; y: number }) => { terrain: TerrainId } | undefined }, terrain: TerrainId): number => {
    let n = 0;
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (grid.at({ x, y })?.terrain === terrain) n += 1;
      }
    }
    return n;
  };

  assert.equal(
    count(waner.grid, 'shallow'),
    0,
    '莞尔镇有浅滩了——KNOWN_SAME 那句「肉眼从没看见过」就是假话，回去改注释',
  );
  assert.ok(
    count(dengchao.grid, 'shallow') > 0,
    '灯潮界没有浅滩了——那句「灯潮界有浅滩，靠的是那份包把底色改成 moss」也是假话',
  );
});

/**
 * `trim` 换到**第二套**已交付色板上还够格吗——「浅滩亮边缺色的理由不在 24 色里」
 * 那条只量了莞尔镇。
 *
 * （这里不写「上面那条」也不写行号：那条在本文件**下头**，而行号会漂。要找就按
 *  标题找——这文件自己的头一条注释刚记过一回指错位置的代价。）
 *
 * ## 为什么第二套必须单独量
 *
 * 那一条的结论（规则 3 清单里唯一候选是 `trim`，对莞尔镇的浅滩底色落差 **27.87**）
 * 是在默认色板上量出来的。可浅滩亮边要同时活在两座镇上，而**同一个 token 在两套
 * 色板上不是一回事**——最好的例子就是今天这一项：`BRIGHT.shallow` 取 `water`，
 * 在莞尔镇是 **0.00**（底色就是它自己），在灯潮界是 **8.36**（那份包的 `shallow`
 * 底色是自己选的 `moss`，不是水色）。同一条赋值，一座镇上隐形、另一座上看得见。
 *
 * 所以「在莞尔镇合格」推不出「在灯潮界合格」，必须单独量。
 *
 * ## 这三个数各有其主，别混
 *
 * 这一段原来写「`copper` 与 `water` 差 14.32，说明两套色板的浅滩底色不是一回事」
 * ——**指错了**。已逐个量过（2026-10-30 随底色 `copper`→`moss` 重算）：
 *
 *   - **8.36** = pack 的 `moss` 对 pack 自己的 `water`。这是**灯潮界 shallow
 *     亮边今天的落差**，不是「两套底色差多少」。（改色前是 14.32。）
 *   - **2.67** = pack 的 `moss` 对 `WORLD.water`。这才是两套浅滩底色之间的差。
 *     它**低于**可辨下限 6——所以「底色换了个色」这件事本身并不显眼。
 *     （改色前是 3.28，结论不变。）
 *   - **11.04** = `WORLD.water` 对 pack 的 `water`。同一个 token 名在两套色板上
 *     解析出的值差这么多，这才是「搬过去可能撞上」的真正原因。**它不随浅滩底色变**，
 *     量的是两个 `water`，不是底色。
 *   - **31.99** = pack 的 `ink` 对 pack 的 `moss`。这是灯潮界 shallow **暗边**今天的落差。
 *     （改色前对 `copper` 是 37.94——`docs/iterations/issue-bright-shallow.md` 那里
 *     记的是 37.40，那个数当初就算错了；两种底色都过下限 6，所以那条结论不受影响。）
 *
 * 三个数挨着写就容易串，这正是本文件在别处犯过的错。所以这里只钉要钉的那个：
 * `trim` 对 pack 的 `moss` 是 **38.20**，比底色亮，压过下限 6 六倍多。
 * （改色前对 `copper` 是 32.25。）
 *
 * ## 这条不授权改色
 *
 * 它只回答「候选在第二套上还成立吗」。改 `BRIGHT.shallow` 属调色板决策，需 ADR +
 * 用户批准——规矩写在 `terrain-edge-visibility.test.ts` 的文件头与 `KNOWN_FAILING`
 * 的 `skipReason` 上，不在本文件里。
 *
 * 莞尔镇那半个数（27.87）**不在这里重写一遍**，它已经有了：重写一处的代价是将来
 * 改色板要记着改两个地方，而漏改一个没有任何机器会响。也不碰那一条查过的——`trim`
 * 在不在规则 3 清单里、是不是唯一候选、比不比在用的三条亮边更醒目。那些是它的问题。
 */
test('trim 换到灯潮界的浅滩底色上也够格吗', () => {
  const base = PACK.terrainColors.shallow;
  const trim = PACK.palette.trim;
  const trimDl = dl(trim, base);

  assert.ok(
    lstar(trim) > lstar(base),
    `灯潮界的 trim（${hex(trim)}）已经不比浅滩底色（${hex(base)}）亮了——它不再是「高光」，`
      + '「浅滩亮边缺色的理由不在 24 色里」那条唯一候选的结论要重看',
  );
  assert.ok(
    trimDl >= EDGE_VISIBLE_MIN_DL,
    `trim 对灯潮界浅滩底色只有 ${trimDl.toFixed(2)}，低于可辨下限 ${EDGE_VISIBLE_MIN_DL}`
      + '——搬过去会得到一条看不见的边，这正是 #17 想避免的那件事',
  );
  assert.ok(
    Math.abs(trimDl - 38.20) <= 0.05,
    `trim 对灯潮界浅滩底色的落差实为 ${trimDl.toFixed(2)}，上面那段钉的 38.20 失真了`,
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
 * 阈值 3 是**可辨下限 6 的一半**：那个 6 是 `terrain-edges.ts` 导出的
 * `EDGE_VISIBLE_MIN_DL`，`terrain-edge-visibility.test.ts` 只是 import 它，
 * 并不拥有它。这里只当哨兵，不当验收线（验收线是那一条的 8）。
 */
test('没有一条未登记的边落在「几乎同色」里（dL* >= 3）', () => {
  assert.deepEqual(
    faintEdges(READINGS, KNOWN_SAME),
    [],
    `这些边与底色的落差已在「肉眼分不出」的量级上：${faintEdges(READINGS, KNOWN_SAME).join('；')}。`
      + ' 这里只是哨兵，验收线仍是 terrain-edge-visibility.test.ts 的 8。',
  );
});

/**
 * 「24 色里挑不出一个能当浅滩亮边」是假话：规则 3 那张清单里就有一个。
 *
 * `docs/iterations/issue-bright-shallow.md` 写着「24 色里再也挑不出一个与
 * `WORLD.water` 有落差、又适合当水面色高光的 token」，据此推出「这个约束下无解」，
 * 要么破例加色（违反 `terrain-edges.ts` 规则 3 的「不加色」），要么让浅滩不画亮边。
 * **前半句是假的。**（原来这里写着「第 22 行」，还写着「那份文档每天都被推走」——
 * 两句都不对。这份文档一共只有两笔（`afdd7ba` 建、`951ee6e` 改），都在一个钟头里；
 * 而那个行号**从生下来就是错的**：`afdd7ba` 建它时第 22 行已经是
 * `## 为什么单独立项` 这个标题，那句话在第 26 行。它不是被推走的，是当初就指错了。
 * 「那句话是假话」这个判断同样是 `afdd7ba` 写文档时就写下的（`git log -S` 只有那一笔），
 * `951ee6e` 改的是 `BRIGHT` 表那句**引文**与 A/A′ 两个选项——「再也挑不出一个」
 * 在它的增删行里一行都没有。所以行号删掉，归错了的功劳也删掉。）
 *
 * 实测：规则 3 那张 7 token 清单（`terrain-edges.ts` 文件头第 3 条，由
 * `terrain-edges.test.ts` 的「边色 token 清单」钉住）里，`trim` 比 `WORLD.water`
 * **亮**，落差 **27.87**——压过可辨下限 6 四倍多，也比 grass / farm / mud 三条
 * 已经在用的亮边（9.51 / 10.82 / 14.42）都醒目。而 `trim` 本来就在册、本来就在
 * 那张清单里：用它不新增颜色、不动 24 色预算、不违反 `terrain-edges.ts` 规则 3
 * 的「不加色」。
 *
 * 那份文档把两件事混成了一件：**调色板无解**（假）与**清单里没有一个比水色亮的**
 * （也假，`trim` 就是）。真正无解的是更窄的一句——「清单里除 trim 外没有第二个」，
 * 而这一句不构成阻碍。文档因此列出的 A（破例加色）建立在不存在的前提上。
 *
 * 这条测试钉住那个实测事实。哪天 `trim` 离开了清单、或色板改了让 `trim` 不再
 * 比水色亮，这里会红——红的意思是「文档那句要重新看」，不是去改测试。
 *
 * **这不授权改 `BRIGHT.shallow`。** 换色是调色板决策，要 ADR + 用户批准
 * （规矩写在 `terrain-edge-visibility.test.ts` 的文件头与 `KNOWN_FAILING` 的
 * `skipReason` 上）。这里只把「为什么一直没换」的真实理由查实，不代决。
 *
 * 盖不住的那一半：「适合当水面色高光」里的**适合**是审美判断，机器判不了。
 * 这里只钉客观的那半——比底色亮、落差压过可辨下限、且在册。`trim` 是暖金色，
 * 当作水面高光好不好看，得人盯着屏幕定。
 */
test('浅滩亮边缺色的理由不在 24 色里：规则 3 的清单内就有一个能用的 token', () => {
  const base = TERRAIN_COLORS.shallow;

  // 今天的状态：`shallow` 的亮边就是水色自己，与底色同色。
  assert.equal(WORLD[BRIGHT.shallow as keyof typeof WORLD], base, 'BRIGHT.shallow 已经不与底色同色了——KNOWN_SAME 那一行该删，这条也该重新看');

  // 规则 3 那张清单（BRIGHT 与 DARK 两表合起来用到的在册 token）。
  const whitelist = [...new Set([...Object.values(BRIGHT), ...Object.values(DARK)])].sort();
  assert.deepEqual(
    whitelist,
    ['grassLit', 'ink', 'plaza', 'soil', 'stone', 'trim', 'water'],
    '规则 3 的清单变了——这条测的是「清单内有没有能用的」，先回来重看它在问什么',
  );

  /** 够格当浅滩亮边：比水色亮（高光的定义），且落差压过可辨下限。 */
  const usable = whitelist.filter((token) => {
    const value = WORLD[token as keyof typeof WORLD];
    return typeof value === 'number' && lstar(value) > lstar(base) && dl(value, base) >= EDGE_VISIBLE_MIN_DL;
  });

  assert.deepEqual(
    usable,
    ['trim'],
    '规则 3 的清单里，能当浅滩亮边的 token 不是正好 trim 一个——'
      + '文档「再也挑不出一个」的依据变了，回去重写那段',
  );

  // 它不光「够」，比现有三条亮边都醒目。这条是那份文档真正的错处：它把
  // 「没有理想的」写成了「一个都没有」，而实测有一个比在用的都好的。
  const trimDl = dl(WORLD.trim, base);
  assert.ok(
    Math.abs(trimDl - 27.87) <= 0.05,
    `trim 对水色的落差实为 ${trimDl.toFixed(2)}，注释里写的 27.87 失真了`,
  );
  for (const terrain of ['grass', 'farm', 'mud'] as const) {
    const inUse = dl(WORLD[BRIGHT[terrain] as keyof typeof WORLD], TERRAIN_COLORS[terrain]);
    assert.ok(
      trimDl > inUse,
      `trim 的落差 ${trimDl.toFixed(2)} 已经不比 ${terrain} 那条在用的亮边（${inUse.toFixed(2)}）醒目了——`
        + '「比现有亮边都好」这半句成了假话',
    );
  }
});

/**
 * 上一条的判据不能是空转的：喂一个**暗** token 与一个**落差不够**的 token，
 * 它们必须被筛掉。否则「usable 只有 trim」可能只是判据什么都没筛。
 */
test('上条的判据不是空转的：暗于底色、或落差不够的，都进不了 usable', () => {
  const base = TERRAIN_COLORS.shallow;
  const usable = (token: keyof typeof WORLD): boolean =>
    lstar(WORLD[token]) > lstar(base) && dl(WORLD[token], base) >= EDGE_VISIBLE_MIN_DL;

  assert.equal(usable('water'), false, '同色当然不够');
  assert.equal(usable('stone'), false, `stone 比水色暗（${dl(WORLD.stone, base).toFixed(2)}）——暗 token 当不了高光`);
  assert.equal(usable('terracotta'), false, `terracotta 比水色亮但落差只有 ${dl(WORLD.terracotta, base).toFixed(2)}，不到下限`);
  assert.equal(usable('trim'), true, 'trim 该过得去——上一条靠它成立');
});
