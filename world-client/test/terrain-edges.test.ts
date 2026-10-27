import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERRAIN_COLORS, WORLD } from '../src/world/palette-data.ts';
import {
  BRIGHT,
  CORNER_BIT,
  DARK,
  EDGE_VISIBLE_MIN_DL,
  SIDE_BIT,
  TERRAIN_EDGE_VARIANTS,
  TERRAIN_HEIGHT,
  cornerMask,
  primitiveCount,
  sideMask,
  type EdgeNeighbors,
} from '../src/render/terrain-edges.ts';
import type { TerrainId } from '../src/world/types.ts';

/** §1.2 地形拼接边：20 变体（16 邻边 + 4 内凹角）的纯函数锁。 */

const all = (v: TerrainId | null): EdgeNeighbors => ({
  north: v, northEast: v, east: v, southEast: v, south: v, southWest: v, west: v, northWest: v,
});
const around = (
  n: TerrainId | null, ne: TerrainId | null, e: TerrainId | null, se: TerrainId | null,
  s: TerrainId | null, sw: TerrainId | null, w: TerrainId | null, nw: TerrainId | null,
): EdgeNeighbors => ({ north: n, northEast: ne, east: e, southEast: se, south: s, southWest: sw, west: w, northWest: nw });

const TERRAINS: readonly TerrainId[] = ['tree', 'grass', 'farm', 'stone', 'plaza'];

test('变体总数 = 16 邻边 + 4 内凹角 = 20', () => {
  assert.equal(TERRAIN_EDGE_VARIANTS, 20);
});

test('材质高度序 tree > grass > farm > stone > plaza', () => {
  const order: readonly TerrainId[] = ['tree', 'grass', 'farm', 'stone', 'plaza'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      TERRAIN_HEIGHT[order[i - 1]!] > TERRAIN_HEIGHT[order[i]!],
      `${order[i - 1]} 必须高于 ${order[i]}`,
    );
  }
});

test('全同材质不画边', () => {
  for (const self of TERRAINS) {
    assert.equal(sideMask(self, all(self)), 0, `${self} 四周同材质时不该有边`);
    assert.equal(cornerMask(self, all(self)), 0);
    assert.equal(primitiveCount(self, all(self)), 0);
  }
});

test('边只画在高度更高的一侧', () => {
  for (const self of TERRAINS) {
    for (const other of TERRAINS) {
      const mask = sideMask(self, all(other));
      const shouldDraw = TERRAIN_HEIGHT[other] < TERRAIN_HEIGHT[self];
      assert.equal(
        mask !== 0,
        shouldDraw,
        `${self} 邻 ${other}：${shouldDraw ? '应画' : '不应画'}`,
      );
    }
  }
});

test('越界邻格（世界边界）不画边', () => {
  for (const self of TERRAINS) assert.equal(sideMask(self, all(null)), 0);
});

test('四面都更低时四条边全亮（mask=15）', () => {
  const low = around('plaza', 'plaza', 'plaza', 'plaza', 'plaza', 'plaza', 'plaza', 'plaza');
  assert.equal(sideMask('tree', low), 15);
});

test('内凹角：直角边都没画、斜角更低时才补角', () => {
  // 只有西北斜角更低，两条直角邻边（N/W）同高
  const onlyDiag = around('grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'plaza');
  assert.equal(sideMask('grass', onlyDiag), 0);
  assert.equal(cornerMask('grass', onlyDiag), CORNER_BIT.northWest);

  // N 也画了线 → 交点已被那条线覆盖，不再补角
  const northLow = around('plaza', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'plaza');
  assert.equal(sideMask('grass', northLow), SIDE_BIT.north);
  assert.equal(cornerMask('grass', northLow), 0);
});

test('每格最多 4 条边 + 4 个角', () => {
  const values: readonly (TerrainId | null)[] = [null, ...TERRAINS];
  for (const self of TERRAINS) {
    for (const v of values) {
      for (const diag of values) {
        // 四条边全画、四个斜角全更低但也可能补角，上界是 8
        const a = around(v, diag, v, diag, v, diag, v, diag);
        assert.ok(primitiveCount(self, a) <= 8);
      }
    }
  }
});

/**
 * 回归：tree 的底色就是 soil，暗边若也用 soil 会与底色完全相同、亮度落差 0.0，
 * 等于白画（实测 96 个 tree 格里有 48 个的边完全看不见，占总写入像素 25.6%）。
 * 修法是 tree 的暗边改用 ink。这条测试锁住「暗边不能等于本格底色」这个不变量。
 */
test('暗边不能与本格底色相同（tree 用 ink，其余用 soil）', () => {
  // 直接读源码导出的 DARK 表，不在测试里另建副本——副本会和实现脱钩，
  // 导致把实现改回 bug 时测试仍然绿（同义反复）。
  for (const self of TERRAINS) {
    assert.notEqual(
      WORLD[DARK[self]],
      TERRAIN_COLORS[self],
      `${self} 的暗边色与底色相同，画出来会隐形`,
    );
  }
  // tree 具体取值：必须比底色 soil 更深（亮度更低）
  assert.equal(DARK.tree, 'ink', 'tree 暗边必须用 ink：它的底色就是 soil，用 soil 落差 0.0');
  const lum = (hex: number): number =>
    0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);
  assert.ok(
    lum(WORLD.ink) < lum(WORLD.soil),
    'ink 必须比 soil 更深，否则 tree 暗边虽可见但不是「更暗」',
  );
});

test('亮边不能与本格底色相同', () => {
  for (const self of TERRAINS) {
    assert.notEqual(WORLD[BRIGHT[self]], TERRAIN_COLORS[self], `${self} 的亮边色与底色相同`);
  }
});

/**
 * plaza 是最低材质（高度 0），邻格不可能比它更低，所以它**永远不画边**。
 * 实测：30×20 世界里 16 个 plaza 格，画了边的 0 个。
 * 这条不是「不用管」，而是说明 BRIGHT.plaza / DARK.plaza 当前是取不到的死分支——
 * 但仍要求它们与自身底色不同，否则将来改动高度序时会静默画出一条隐形边。
 */
test('plaza 是最低材质，任何邻格都不触发它的边', () => {
  for (const other of TERRAINS) {
    assert.equal(sideMask('plaza', all(other)), 0, `plaza 邻 ${other} 不该画边`);
    assert.equal(cornerMask('plaza', all(other)), 0);
  }
  // 反向确认：其他材质邻 plaza 时会画边（plaza 更低）
  for (const self of ['tree', 'grass', 'farm', 'stone'] as const) {
    assert.notEqual(sideMask(self, all('plaza')), 0, `${self} 邻 plaza 应画边`);
  }
});

/* ------------------------------------------------------------------ 边可见性 */

/**
 * 1px 边的可辨性用 **ΔL\***（CIE L*，从 sRGB 换算）度量，不是 WCAG 比值。
 *
 * 为什么不用 WCAG：它的 +0.05 底数是给「中等亮度背景上的文字」校准的，而这套调色板
 * 本调色板里有 12 色在 L* 33 以下（24 色预算的正好一半）。同一个 ink vs grass，WCAG
 * 只给 1.59，ΔL* 是 18.05——用 WCAG 会得出「所有边都一样弱」的错误结论（实测暗边其实全部合格）。
 *
 * 阈值 6 的依据：画面里已证明可读的 1px 线是角色墨线（ink vs grass ΔL* 18.05）。
 * 但那是强轮廓，地形边只需弱一档；实测 6 以下（如原 grass 亮边 3.0、tree 暗边 0.0）
 * 肉眼不可辨。取 6 作为下限，留出与强轮廓的区分空间。
 *
 * 这条测试锁的是「改色/换 token 时边可见性不会静默退化」——2026-10-20 的 stone 明度
 * 重排（#3a3f3b → #3e433f）就把 stone 亮边从 ΔL* 6.72 压到 4.95，当时没有任何测试会红。
 */
/** sRGB 十六进制 → CIE L*。 */
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

/**
 * WCAG 2.x 对比度：(亮的那一个 + 0.05) / (暗的那一个 + 0.05)，底数是**相对亮度 Y**，
 * 不是 L\*。上面那段用它说明「同一对色，WCAG 与 ΔL\* 会给出相反印象」。
 */
function wcagRatio(a: number, b: number): number {
  const lum = (hex: number): number => {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel((hex >> 16) & 0xff) +
      0.7152 * channel((hex >> 8) & 0xff) +
      0.0722 * channel(hex & 0xff)
    );
  };
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 亮边：对**本格底色**必须可辨。
 *
 * 两类豁免，各有硬理由（不是为了让测试变绿）：
 *
 * 1. **plaza** —— 最低材质永不画边（上面那条测试已锁），BRIGHT.plaza 是防将来改
 *    高度序的占位值，不参与实际绘制。
 *
 * 2. **stone 的亮边** —— 结构性不可见，与改色无关。stone 高度 1，唯一的低邻格是
 *    plaza（高度 0），而 `BRIGHT.stone = plaza`。于是这条亮边画出来**必然与它相邻的
 *    plaza 格同色**，融进邻格。QA 实测印证：269 个 stone/plaza 交界采样点里，stone
 *    侧贴边 4px 内 luma 抬升 >2 的 0 个；直接量 (13,11) 北边缘，亮线行与上方 plaza
 *    完全同色。**ΔL* 4.95 是「线 vs stone 底色」，但这条线在渲染里从不单独对着 stone
 *    底色出现**——它永远夹在同色的 plaza 与 stone 之间。
 *
 *    所以 stone/plaza 的边界**不靠这条亮边**，靠的是暗边：暗边取 soil，对 plaza
 *    底色差 20.80，压过下限 6。底色差本身只有 4.95（stone 27.84 vs plaza 32.79），
 *    撑不住——`terrain-edge-visibility.test.ts` 因此把 `stone->plaza` 记成真缺陷
 *    （只剩暗边一条线索）。两处说的是同一条边界，别读成矛盾。
 *    若将来要让 stone 有可见亮边，得换 `BRIGHT.stone` 为非 plaza 的 token
 *    （timber 是木色、trim 有白线风险），那是调色板决策，不是测试能推的。
 */
test('亮边色对本格底色 ΔL* ≥ 6（边可见性回归锁）', () => {
  const failing: string[] = [];
  for (const self of ['tree', 'grass', 'farm'] as const) {
    const value = dl(WORLD[BRIGHT[self]], TERRAIN_COLORS[self]);
    if (value < EDGE_VISIBLE_MIN_DL) {
      failing.push(`${self} 亮边 ΔL*=${value.toFixed(2)}`);
    }
  }
  assert.deepEqual(failing, [], `以下亮边不可辨（阈值 ${EDGE_VISIBLE_MIN_DL}）：${failing.join('、')}`);
});

/** 暗边：同上，plaza 豁免。 */
test('暗边色对本格底色 ΔL* ≥ 6（边可见性回归锁）', () => {
  const failing: string[] = [];
  for (const self of ['tree', 'grass', 'farm', 'stone'] as const) {
    const value = dl(WORLD[DARK[self]], TERRAIN_COLORS[self]);
    if (value < EDGE_VISIBLE_MIN_DL) {
      failing.push(`${self} 暗边 ΔL*=${value.toFixed(2)}`);
    }
  }
  assert.deepEqual(failing, [], `以下暗边不可辨（阈值 ${EDGE_VISIBLE_MIN_DL}）：${failing.join('、')}`);
});

/**
 * 锁住 stone 亮边豁免的**结构前提**。
 *
 * 上面那条测试把 stone 从亮边断言里豁免了，理由是「stone 唯一的低邻格是 plaza，
 * 而 BRIGHT.stone 也是 plaza，所以线必然融进邻格」。这是三个事实的合取，缺一不成立：
 *
 *   ① stone 的邻格里只有 plaza 比它低（否则会出现 stone 邻其他材质画边的情况）
 *   ② BRIGHT.stone 恰好等于 plaza 的底色（否则线不会融）
 *   ③ 低邻格的底色就是 plaza（同义反复，但如果将来 plaza 挪了色这条会提醒）
 *
 * 任何一条被改动（例如调高度序、给 BRIGHT.stone 换 token、改 plaza 的值），这条测试
 * 就会红——那时必须重新评估「stone 亮边是否还该豁免」，而不是让豁免默默失效。
 */
test('stone 亮边豁免的结构前提（改这三条任一都必须重估豁免）', () => {
  // ① stone 是高度 1，比它低的只有 plaza（高度 0）
  const lowerNeighbors = TERRAINS.filter((t) => TERRAIN_HEIGHT[t] < TERRAIN_HEIGHT.stone);
  assert.deepEqual(lowerNeighbors, ['plaza'], 'stone 的低邻格必须只有 plaza');

  // ② BRIGHT.stone 用的就是 plaza 的底色
  assert.equal(BRIGHT.stone, 'plaza', 'BRIGHT.stone 必须等于 plaza 底色，豁免才成立');

  // ③ 低邻格的底色 = plaza（TERRAIN_COLORS.plaza）
  assert.equal(TERRAIN_COLORS.plaza, WORLD.plaza, 'plaza 的底色必须是 WORLD.plaza');
});

/**
 * 变异探针：这几条断言必须真能挡住退化。
 *
 * 用历史值验证——原 grass 亮边用 grassLit 是 ΔL* 3.02（不过），改 plaza 后 9.51（过）；
 * 原 tree 暗边用 soil 是 0.0（完全隐形），改 ink 后 6.76（过）。
 * 如果断言对这些历史退化值都给「过」，说明阈值或算式写错了。
 */
test('变异探针：历史退化值必须被判为不可辨', () => {
  // grass 底色下 grassLit 亮边 3.02 —— 不过（P0-2 修复前的状态）
  assert.ok(dl(WORLD.grassLit, WORLD.grass) < EDGE_VISIBLE_MIN_DL, 'grassLit 亮边应被判不可辨');
  // tree 底色下 soil 暗边 0.0 —— 完全隐形（P0-2 修复前的状态）
  assert.ok(dl(WORLD.soil, TERRAIN_COLORS.tree) < EDGE_VISIBLE_MIN_DL, 'soil 暗边在 tree 上应被判不可辨');
  // 反向：修复后的值必须过
  assert.ok(dl(WORLD.plaza, WORLD.grass) >= EDGE_VISIBLE_MIN_DL, 'grass 亮边改 plaza 后应通过');
  assert.ok(dl(WORLD.ink, TERRAIN_COLORS.tree) >= EDGE_VISIBLE_MIN_DL, 'tree 暗边改 ink 后应通过');
});

/* ------------------------------------------------- 注释里的 dL* 数字锁 */

/**
 * `terrain-edges.ts` 的注释用具体落差解释「为什么这个 token 是这个」——那些数字
 * 是论证的一部分，错了整段论证就反了。而它们此前没有任何东西在算：换设定集、改色、
 * 调 `BRIGHT`/`DARK` 表，注释里的数字照旧写着，没人会红。
 *
 * 已经这么错了四处，全是手打，没一个对得上它声称在说哪一对：
 *   - 「ink 比 soil 再深一档，落差 14.0」——实为 6.76（本文件自己的变异探针写的
 *     就是 6.76，注释和它自相矛盾）
 *   - 「其他材质暗边 soil，落差 20.9–45.6」——实为 9.98–20.80。20.9 其实是这组里
 *     的**最大**值（soil/plaza 20.80），被当成了下限。45.6 的出处查不到
 *     （`git log -S '45.6'` 只回到最初搬入那一笔），地形边这五个 token 两两之间
 *     也没有任何一对接近它——所以它只是个错数，别学我上头猜它像谁
 *   - 「stone/plaza 边界靠底色差 11.35」——实为 4.95
 *   - 「tree 底色与各邻格底色差 11.99 以上」——11.99 是 soil **自己的 L\***，不是差；
 *     实际最小 9.98。那条在 `terrain-edge-visibility.test.ts` 的 `KNOWN_FAILING`
 *     注释里，已随本次一并改掉
 *
 * 所以这里把每个数字连它声称在说哪一对一起钉住。红的时候意思是「去把注释里那个
 * 数字改掉」，不是「把这里的数改成新的」——注释才是给人看的那一份。
 *
 * **引用用原句，不用行号。** 这些数字全在注释里，而行号指进注释段正是
 * `scripts/audit-references.ts` 要存疑的那一类（它要求行号落在有代码的段上）。更要紧
 * 的是行号会自己漂：上一个会话刚因为「七处行号被上一笔推下去」补过一笔。原句不会漂，
 * 而且这里连「原句还在不在文件里」一起断言——注释被删被改，这条同样红，比行号强。
 *
 * 锁不住的部分也说清，免得这句本身变成新的空话：`terrain-edges.ts` 那句
 * 「96 个 tree 格里有 48 个……占总写入像素 25.6%」是**像素计数**，不是 dL*，这里
 * 没有它的锁；`24 色预算`归 `palette-budget.test.ts`；阈值 `6` 就是本文件 import 的
 * `EDGE_VISIBLE_MIN_DL` 本身，没有「实不实」可说。
 */
const DOCUMENTED_DL: readonly {
  /** 这句话在哪个文件里。 */
  readonly file: string;
  /** 原句。先断言它还在那个文件里——注释没了这条也红。 */
  readonly quote: string;
  readonly a: number;
  readonly b: number;
  /** 注释里写的数。 */
  readonly says: number;
}[] = [
  { file: 'src/render/terrain-edges.ts', quote: 'grass 亮边用 plaza（ΔL* 9.5）', a: WORLD.plaza, b: TERRAIN_COLORS.grass, says: 9.5 },
  { file: 'src/render/terrain-edges.ts', quote: '原 grassLit 对 grass 只有 3.0', a: WORLD.grassLit, b: TERRAIN_COLORS.grass, says: 3.0 },
  { file: 'src/render/terrain-edges.ts', quote: '亮度落差 **0.0**', a: WORLD.soil, b: TERRAIN_COLORS.tree, says: 0.0 },
  { file: 'src/render/terrain-edges.ts', quote: '落差 6.76', a: WORLD.ink, b: WORLD.soil, says: 6.76 },
  // 阈值 6 的**全部依据**（`EDGE_VISIBLE_MIN_DL` 的文档）。这个数此前一把锁都没有，
  // 而它一错，下限 6 的理由整个悬空。原写 18.1，实测 18.05，已改成两位小数。
  { file: 'src/render/terrain-edges.ts', quote: 'ink vs grass ΔL\\* 18.05', a: WORLD.ink, b: TERRAIN_COLORS.grass, says: 18.05 },
  { file: 'test/terrain-edges.test.ts', quote: '底色差本身只有 4.95', a: TERRAIN_COLORS.stone, b: TERRAIN_COLORS.plaza, says: 4.95 },
  { file: 'test/terrain-edges.test.ts', quote: '对 plaza 底色差 20.80', a: WORLD.soil, b: TERRAIN_COLORS.plaza, says: 20.8 },
  // 这两条住在另一个文件的 KNOWN_FAILING 注释里，一起钉。
  { file: 'test/terrain-edge-visibility.test.ts', quote: '与各邻格底色差 9.98 以上（最小是 tree/farm）', a: TERRAIN_COLORS.tree, b: TERRAIN_COLORS.farm, says: 9.98 },
  // 路面板岩的缝色（`decor.ts` 画 slabs 那段）。这一对原来也写着 11.35，而上面那份
  // 「已经这么错了四处」的清单里早就记了「实为 4.95」——记录在，源注释没改，锁也没有，
  // 于是它又继续错着。补上：quote 现在指向 decor.ts 改过的那一句。
  { file: 'src/render/decor.ts', quote: '缝用 stone（对 plaza ΔL* 4.95）', a: TERRAIN_COLORS.stone, b: TERRAIN_COLORS.plaza, says: 4.95 },
];

test('注释里逐个引用的 dL* 数字必须与当前色板一致', () => {
  const wrong: string[] = [];
  for (const { file, quote, a, b, says } of DOCUMENTED_DL) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    if (!text.includes(quote)) {
      wrong.push(`${file} 里找不到原句「${quote}」——注释被删改过，这条断言失去了对象`);
      continue;
    }
    const real = dl(a, b);
    if (Math.abs(real - says) > 0.05) {
      wrong.push(`${file}「${quote}」：写 ${says}，实为 ${real.toFixed(2)}`);
    }
  }
  assert.deepEqual(wrong, [], `以下注释数字已失真，去改注释：` + wrong.join('；'));
});

/**
 * 注释里引用的 **L* 绝对值** 同样要锁，与上面的落差表分开。
 *
 * 这两类数单位一样、长得像，但不是一回事：落差是两个色相减的绝对值，L* 是一个色自己
 * 的明度。本次修的那处「与各邻格底色差 11.99 以上」，11.99 其实就是 soil 自己的
 * L*——把绝对值当成差写，正是这两类混用才会犯的错。所以分开两张表，别合并。
 */
const DOCUMENTED_LSTAR: readonly {
  readonly file: string;
  readonly quote: string;
  readonly color: number;
  readonly says: number;
}[] = [
  { file: 'test/terrain-edge-visibility.test.ts', quote: '那是 soil 自己的 L*', color: WORLD.soil, says: 11.99 },
  { file: 'test/terrain-edges.test.ts', quote: 'stone 27.84 vs plaza 32.79', color: TERRAIN_COLORS.stone, says: 27.84 },
  { file: 'test/terrain-edges.test.ts', quote: 'stone 27.84 vs plaza 32.79', color: TERRAIN_COLORS.plaza, says: 32.79 },
];

test('注释里逐个引用的 L* 绝对值必须与当前色板一致', () => {
  const wrong: string[] = [];
  for (const { file, quote, color, says } of DOCUMENTED_LSTAR) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    if (!text.includes(quote)) {
      wrong.push(`${file} 里找不到原句「${quote}」`);
      continue;
    }
    const real = lstar(color);
    if (Math.abs(real - says) > 0.05) {
      wrong.push(`${file}「${quote}」：写 ${says}，实为 ${real.toFixed(2)}`);
    }
  }
  assert.deepEqual(wrong, [], `以下注释数字已失真，去改注释：` + wrong.join('；'));
});

/**
 * 注释里写的**区间**同样要锁。
 *
 * `terrain-edges.ts` 那句「grass / farm / stone / plaza 的底色都比 soil 亮，落差
 * 9.98–20.80」。这句话的两个端点此前都是手打的，而且两个都错：写的是 20.9–45.6，
 * 其中 20.9 其实是这组的**最大**值（soil/plaza 20.80）被当成了下限，45.6 则查不到
 * 出处（`git log -S '45.6'` 只回到最初搬入那一笔）。实测区间就是 9.98–20.80。
 */
test('注释里引用的 dL* 区间必须与当前色板一致', () => {
  const drops = (['grass', 'farm', 'stone', 'plaza'] as const).map((t) => dl(WORLD.soil, TERRAIN_COLORS[t]));
  const realMin = Math.min(...drops);
  const realMax = Math.max(...drops);
  assert.ok(
    Math.abs(realMin - 9.98) <= 0.05 && Math.abs(realMax - 20.80) <= 0.05,
    `terrain-edges.ts 写的区间 9.98–20.80 已失真，实为 ${realMin.toFixed(2)}–${realMax.toFixed(2)}。`
      + '去改注释，别改这里。',
  );
});

/**
 * 边色 token 清单：`BRIGHT` 与 `DARK` 两表一共用到哪些在册 token。
 *
 * 文件头规则 3 写的是个数（「只用在册的 7 个」）。这个数此前手写成「三个」，而两表
 * 实际用到七个——同一个数错了很久没人发现，因为没有任何东西在数它。审阅它的人自己
 * 数成了 6，列出来的却是 7 个：手数七个去重项本来就容易漏一个，所以这里让代码数。
 *
 * 往任一表里加一个**新** token，这条会红。红的意思是「规则 3 那个数和这份名单该
 * 更新了」，不是「把断言改成新的」——24 色预算是硬约束，多用一个 token 是决策。
 *
 * 顺带也钉住「不加色」那半：用到的每个 token 都必须在 `WORLD` 里，即确实是在册色，
 * 没有为边新增颜色。
 */
test('边色 token 清单：7 个在册色，且都在 WORLD 里', () => {
  const used = [...new Set([...Object.values(BRIGHT), ...Object.values(DARK)])].sort();
  assert.deepEqual(
    used,
    ['grassLit', 'ink', 'plaza', 'soil', 'stone', 'trim', 'water'],
    `文件头规则 3 写的是这 7 个。若这里变了，去改规则 3 的那个数与这份名单。`,
  );
  for (const token of used) {
    assert.ok(
      typeof WORLD[token as keyof typeof WORLD] === 'number',
      `${token} 不在 WORLD 里——「不加色」被破坏了`,
    );
  }
});

/**
 * 「为什么不用 WCAG」那一段的三个数。
 *
 * 那段的论据是「调色板太暗，WCAG 会失真」，而它自己带着的三个数此前**一个都没锁**：
 *   - 上段「L* 33 以下」的计数 —— 实测 **12** 色，原写的那个少一个。这个错法和
 *     文件头规则 3 的「三个」是同一类：手数的，没有任何东西在数它。
 *   - 「ink vs grass ΔL* 18.05」—— 实测就是这个数，一位小数 18.1。它是阈值 6 的
 *     **全部依据**（见 `EDGE_VISIBLE_MIN_DL` 的文档），却是全仓库最没保障的一个数。
 *   - 「WCAG 只给 1.59」—— 精确。
 *
 * 计数那一半**只认注释行**（以 ` * ` 开头），这是要紧的：这条测试自己也在同一个
 * 文件里，直接搜字符串会搜到自己——头一版就是这么写的，绿了，而注释里那个数照旧
 * 错着。那是条永远绿的空断言，比没有断言更糟。
 */
test('「为什么不用 WCAG」那一段的三个数必须与当前色板一致', () => {
  // 不写类型谓词：`WORLD` 的值是数字字面量联合，`v is number` 那个谓词 tsc 不认
  // （TS2677：谓词类型必须能赋给参数类型）。`typeof` 窄化就够，`lstar` 收 number。
  const numeric = Object.values(WORLD).filter((v) => typeof v === 'number');
  const under = numeric.filter((v) => lstar(v) < 33);

  // 计数：只在本文件的注释行里找那句话，且只允许有一处。
  const own = readFileSync(new URL('../test/terrain-edges.test.ts', import.meta.url), 'utf8');
  const claims = own
    .split('\n')
    .filter((line) => line.startsWith(' * '))
    .map((line) => /(\d+)\s*色在 L\* 33 以下/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null);
  assert.equal(claims.length, 1, `注释里「N 色在 L* 33 以下」出现了 ${claims.length} 处，应恰好一处`);
  assert.equal(
    Number(claims[0]?.[1]),
    under.length,
    `注释写「${claims[0]?.[1]} 色在 L* 33 以下」，实测 ${under.length} 色`
      + `（24 色预算的正好一半）。去改那段，别改这条。`,
  );

  // ΔL* 18.05：阈值 6 的依据，也是 DOCUMENTED_DL 里锁着的那个数。
  assert.equal(
    dl(WORLD.ink, TERRAIN_COLORS.grass).toFixed(2),
    '18.05',
    'ink vs grass 的 ΔL* 变了，`EDGE_VISIBLE_MIN_DL` 文档里那个 18.05 与下限 6 的理由要一起重估。',
  );

  // WCAG 1.59：精确到两位。这个数反过来证明「WCAG 会失真」那句话。
  assert.equal(
    wcagRatio(WORLD.ink, TERRAIN_COLORS.grass).toFixed(2),
    '1.59',
    'ink vs grass 的 WCAG 比值变了，注释里那个 1.59 要一起改。',
  );
});

/**
 * 注释之间互相引用的**名字/原句**必须还在目标文件里。
 *
 * 由来是一件真事，就发生在这批改动里：`terrain-edges.ts` 的 `EDGE_VISIBLE_MIN_DL`
 * 那段原来写着「`terrain-edges.ts` 第 79 行那句『压过边可见性下限 6』」。而**同一批改动**
 * 往文件头部加了两段注释，行号往下走了 7 行，第 79 行落到一段不相干的散文上——
 * `audit-references.ts --strict` 一声没响，照样报 0 处存疑。
 *
 * 它响不了不是它坏了：它自己的文件头写着「不查『那段说的是不是那件事』……指着注释
 * 是正当的」。`hasCode()` 只判「那段不是空行、不只是括号」，注释行算过关。所以
 * **行号指注释时，语义漂移没有任何机器能挡**——只有引原句能挡，因为原句被删掉时
 * 字符串就搜不到了。
 *
 * （这儿的「第 79 行」是**故意**不写成「:79」的：审计的 `REF` / `BARE_REF` 两条
 *  正则认「文件名:行号」与反引号里的「:行号」，分不清引用与「我在说一处坏引用」。
 *  写回带行号的写法，这段历史陈述自己就变成几处存疑，`--strict` 下是红的。）
 *
 * 于是这批注释里凡是 prose 指另一句 prose，一律引原句、不写行号，并登记在这儿。
 * `fromSays` 是引用处还在的凭据，`mustSay` 是被指的那个名字，`times` 是它在目标
 * 文件里必须出现的次数。同文件自引要 `times >= 2`：引用处一次、被指的那句一次，
 * 掉到 1 就说明被指的那句已经没了。
 */
const CROSS_QUOTES: readonly {
  readonly from: string;
  readonly fromSays: string;
  readonly in: string;
  readonly mustSay: string;
  readonly times: number;
}[] = [
  // EDGE_VISIBLE_MIN_DL 那段指着 DARK 注释里的原句。同一个文件，所以要出现两次。
  {
    from: 'src/render/terrain-edges.ts',
    fromSays: '「压过边可见性下限 6」',
    in: 'src/render/terrain-edges.ts',
    mustSay: '压过边可见性下限 6',
    times: 2,
  },
  // 文件头规则 3 点名的那条测试（「加一个新 token 那条就会红」）。
  {
    from: 'src/render/terrain-edges.ts',
    fromSays: '「边色 token 清单」',
    in: 'test/terrain-edges.test.ts',
    mustSay: '边色 token 清单',
    times: 1,
  },
  // DARK 那段点名的那两条数字锁。
  {
    from: 'src/render/terrain-edges.ts',
    fromSays: '「逐个引用」那条',
    in: 'test/terrain-edges.test.ts',
    mustSay: '逐个引用',
    times: 1,
  },
  {
    from: 'src/render/terrain-edges.ts',
    fromSays: '「区间」那条',
    in: 'test/terrain-edges.test.ts',
    mustSay: 'dL* 区间',
    times: 1,
  },
  // EDGE_VISIBLE_MIN_DL 那段点名本文件这条测试。
  {
    from: 'src/render/terrain-edges.ts',
    fromSays: '「互相引用」那条',
    in: 'test/terrain-edges.test.ts',
    mustSay: '互相引用',
    times: 1,
  },
];

test('注释互相引用的名字/原句必须还在目标文件里（行号指注释时没有机器能挡）', () => {
  const cache = new Map<string, string>();
  const text = (file: string): string => {
    const hit = cache.get(file);
    if (hit !== undefined) return hit;
    const fresh = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    cache.set(file, fresh);
    return fresh;
  };

  const wrong: string[] = [];
  for (const { from, fromSays, in: target, mustSay, times } of CROSS_QUOTES) {
    if (!text(from).includes(fromSays)) {
      wrong.push(`${from} 里已经没有「${fromSays}」这句了——引用别人的那段注释被改过`);
      continue;
    }
    const found = text(target).split(mustSay).length - 1;
    if (found < times) {
      wrong.push(
        `${from} 指着 ${target} 里的「${mustSay}」，那儿只出现 ${found} 次（要 ${times} 次）`,
      );
    }
  }
  assert.deepEqual(wrong, [], `以下互相引用已断：` + wrong.join('；'));
});
