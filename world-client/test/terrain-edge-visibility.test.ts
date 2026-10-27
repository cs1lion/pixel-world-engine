/**
 * §4.1:218 源色口径闸门：边可见性。
 *
 * 判据原文：「`BRIGHT.<X>` 对本格底色 `dL*` >=8，**且** 对紧邻那一格底色 `dL*` >=8」。
 * 本文件逐对实现它：X 是高材质格，Y 是任意一个比 X 低的邻格，一共 10 对。
 *
 * **那份美术文档不在这个仓库里**（`ART_STYLE_TARGET` 从来未入库，git 全史查无此文件），
 * 所以这里没有可点的行号——上面抄的判据原文就是本仓库能拿到的最强依据，
 * 谁要核它对不上原文，改上面那三行，别去改下面的阈值。
 *
 * 口径：源色，不依赖渲染、不依赖浏览器，`npm run test:inprocess` 可跑。
 * 度量为 CIE `L*`（从 sRGB 换算）。阈值 8 是 §4.1 的验收线（`terrain-edges.test.ts`
 * 里的 6 是「不退化」下限，两者不同，不要混用）。
 *
 * 为什么「对邻格」也要管：亮边画在高格北/西内缘，外侧紧邻的就是低邻格。
 * 边色若等于邻格底色，那条交界上的边**必然**融进外侧、只让高格少 1px，是 no-op。
 *
 * 实测结论（2026-10-21，24 色）：**§4.1:218 的完整判据当前 1/10 达标**。
 *
 * **剩下 9 对不是缺陷，但也不是达标 —— 它们靠暗边或底色差兜底可用。**
 * 其中 `stone->plaza` 是真缺陷：兜底只剩暗边 20.80 一条线索（底色差 4.95 撑不住）。
 * 见 §1.4c。
 *
 * 这句话有两个不同的意思，不能混：
 *   - **文档写的标准达不到** —— 10 对里 9 对满足不了「对邻格 >=8」
 *   - **不等于这些边现在合格** —— 它们只是「靠兜底可用」，不是「靠 §4.1:218 达标」
 *
 * 所以 `KNOWN_FAILING` 里那 9 条的性质是**已知不达标 + 有替代线索**，不是「已验收」。
 * 测试记录差距，文档记录目标，两者不一致正是这个差距的表达 —— 不要把 `:218` 降成
 * 达到现状的宽松版，那会把这个差距抹掉。
 *
 * 达不到的原因不是实现 bug：`BRIGHT.grass/farm/stone` 都取 `plaza`，而 `plaza` 本身就是
 * 它们的低邻格之一，于是这些交界上边色与邻格同色（0.00）。一个 token 无法同时远离 4 个
 * 低邻格底色 —— 色带只有 20 L* 宽。要真达标只能改 `BRIGHT` 表，那属调色板决策，
 * 需 ADR + 用户批准。
 *
 * 防线是两条叠加的，缺一不可：
 *   1. 逐对测试 —— 达标的对真断言；不达标的按 `KNOWN_FAILING` skip
 *   2. 守卫测试 —— 不达标集合必须与清单完全一致，且登记值与实测一致（容差 0.05）
 *   单靠第 1 条不够：被 skip 的对没有断言在挡它们继续变差。单靠第 2 条也不够：
 *   它只查集合与登记值，不查每条边自己的断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_COLORS, WORLD } from '../src/world/palette-data.ts';
import { BRIGHT, DARK, EDGE_VISIBLE_MIN_DL, TERRAIN_HEIGHT } from '../src/render/terrain-edges.ts';
import type { TerrainId } from '../src/world/types.ts';

/** §4.1:218 的验收线。 */
const MIN_DL = 8;

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

const TERRAINS: readonly TerrainId[] = ['tree', 'grass', 'farm', 'stone', 'plaza'];

/** 一对「高格 X / 低邻格 Y」上亮边的实测结果。 */
interface PairResult {
  readonly key: string;
  readonly self: TerrainId;
  readonly neighbor: TerrainId;
  readonly token: number;
  /** 边色 vs 本格底色。 */
  readonly own: number;
  /** 边色 vs 邻格底色。 */
  readonly against: number;
  /** 按 §4.1:218 是否达标（两个条件都要满足）。 */
  readonly passes: boolean;
}

/** 枚举所有 (高格, 更低邻格) 对，逐对算实测值。 */
function measurePairs(): readonly PairResult[] {
  const out: PairResult[] = [];
  for (const self of TERRAINS) {
    for (const neighbor of TERRAINS) {
      if (TERRAIN_HEIGHT[neighbor] >= TERRAIN_HEIGHT[self]) continue;
      const token = WORLD[BRIGHT[self]];
      const own = dl(token, TERRAIN_COLORS[self]);
      const against = dl(token, TERRAIN_COLORS[neighbor]);
      out.push({
        key: `${self}->${neighbor}`,
        self,
        neighbor,
        token,
        own,
        against,
        passes: own >= MIN_DL && against >= MIN_DL,
      });
    }
  }
  return out;
}

const PAIRS = measurePairs();

/**
 * 兜底线索：这一对靠**哪一种**对比、**对谁**撑住。
 *
 * 只存种类和对象，**不存数字**。数字由 `fallbackDl()` 按当前色板现算，跳过原因里
 * 显示的也是算出来的那个。此前这里是手打的字符串（`'底色差 tree/grass'`、
 * `'仅暗边 soil 对 plaza 20.80（底色差 4.95 不足）'`），括号里那两个数没人核对——
 * 同一个仓库里刚查出四处这样的手打数字全错（见 `terrain-edges.test.ts` 的数字锁），
 * 所以这里改成算出来。
 *
 * 原手打字符串里 `stone->plaza` 还有个「仅」字，说它「只剩暗边一条线索」。没有为它
 * 单开字段：那句话的真正依据是它**两个方向都不达标**（own 4.95、against 0），而这两个数
 * 表里本来就有、也有守卫在核。加个 `sole` 只是把同一件事写第三遍——而试着给它写断言
 * 时发现，「底色差不到下限」这个我替它找的判据会把 `grass->stone`（4.56）和
 * `farm->stone`（5.87）一起圈进来，与文档只点名 `stone->plaza` 不符。所以不立这个字段。
 */
type Fallback =
  | { readonly kind: 'base-diff'; readonly with: TerrainId }
  | { readonly kind: 'dark-edge'; readonly with: TerrainId };

/** 兜底线索的实测落差。`sole` 表示只剩这一条线索（底色差撑不住）。 */
function fallbackDl(self: TerrainId, f: Fallback): number {
  return f.kind === 'base-diff'
    ? dl(TERRAIN_COLORS[self], TERRAIN_COLORS[f.with])
    : dl(WORLD[DARK[self]], TERRAIN_COLORS[f.with]);
}

/** 兜底线索的人话，数字现算。 */
function describeFallback(self: TerrainId, f: Fallback): string {
  const value = fallbackDl(self, f).toFixed(2);
  if (f.kind === 'base-diff') return `底色差 ${self}/${f.with} ${value}`;
  return `暗边 ${DARK[self]} 对 ${f.with} ${value}`;
}

/**
 * 已知不达标的对，附实测值与它靠什么兜底。
 *
 * 这张表是**已知限制清单**，不是豁免名单：
 *   - 新出现的不达标对 -> 清单外的 key -> 下面那条测试会红
 *   - 清单里的对修好了 -> 值变了 -> 也会红，提示把该行删掉
 *   - 兜底撑不住了 -> `fallbackDl` 掉到可辨下限以下 -> 也会红
 * 所以它不会悄悄过期。
 */
const KNOWN_FAILING: Readonly<
  Record<string, { readonly self: TerrainId; readonly own: number; readonly against: number; readonly fallback: Fallback }>
> = {
  // tree 亮边 grassLit 只比 4 个低邻格的底色亮 1.54-6.49，但 tree 底色 soil 极深，
  // 与各邻格底色差 9.98 以上（最小是 tree/farm），边界靠底色差就够。这 4 条不是缺陷。
  // 注意别把这个数写成 11.99——那是 soil 自己的 L*，不是任何差。
  'tree->grass': { self: 'tree', own: 14.31, against: 3.02, fallback: { kind: 'base-diff', with: 'grass' } },
  'tree->farm': { self: 'tree', own: 14.31, against: 4.33, fallback: { kind: 'base-diff', with: 'farm' } },
  'tree->stone': { self: 'tree', own: 14.31, against: 1.54, fallback: { kind: 'base-diff', with: 'stone' } },
  'tree->plaza': { self: 'tree', own: 14.31, against: 6.49, fallback: { kind: 'base-diff', with: 'plaza' } },
  // grass/farm 亮边都是 plaza，邻 stone 时只有 4.95；靠暗边 soil 对 stone 兜底。
  'grass->stone': { self: 'grass', own: 9.51, against: 4.95, fallback: { kind: 'dark-edge', with: 'stone' } },
  'farm->stone': { self: 'farm', own: 10.82, against: 4.95, fallback: { kind: 'dark-edge', with: 'stone' } },
  // grass/farm 邻 plaza 时边色与邻格同色（0.00）。grass 靠底色差，farm 靠底色差。
  'grass->plaza': { self: 'grass', own: 9.51, against: 0, fallback: { kind: 'base-diff', with: 'plaza' } },
  'farm->plaza': { self: 'farm', own: 10.82, against: 0, fallback: { kind: 'base-diff', with: 'plaza' } },
  // stone 唯一低邻格就是 plaza，边色与它同色（0.00）；对本格也只有 4.95。
  // 底色差 stone/plaza 也只有 4.95，撑不住，只剩暗边一条线索 —— 真缺陷，见 §1.4c。
  'stone->plaza': { self: 'stone', own: 4.95, against: 0, fallback: { kind: 'dark-edge', with: 'plaza' } },
};

/* ---------------------------------------------------------- 逐对断言（§4.1:218） */

for (const pair of PAIRS) {
  const known = KNOWN_FAILING[pair.key];
  // 达标的对真跑断言；不达标的按已知限制跳过，skip 原因里带实测值，
  // 免得三个月后有人以为这条边是好的。
  const skipReason = pair.passes
    ? false
    : known === undefined
      ? false // 未登记的不达标对：不跳过，让它直接红
      : `§4.1:218 未达标（本格 ${pair.own.toFixed(2)} / 邻格 ${pair.against.toFixed(2)}），`
        + `靠 ${describeFallback(known.self, known.fallback)} 兜底。`
        + '改 BRIGHT 表属调色板决策，需 ADR + 用户批准';

  test(`§4.1:218 ${pair.key}：边色对本格与对邻格 dL* 均 >= ${MIN_DL}`, { skip: skipReason }, () => {
    assert.ok(
      pair.own >= MIN_DL,
      `${pair.key} 对本格底色只有 ${pair.own.toFixed(2)}`, 
    );
    assert.ok(
      pair.against >= MIN_DL,
      `${pair.key} 对邻格底色只有 ${pair.against.toFixed(2)}`,
    );
  });
}

/* ---------------------------------------------------------- 清单守卫 */

/**
 * 上面的逐对测试对已知不达标的对是 skip，所以它们永远不会红。
 * 这条负责真正的闸门作用：**不达标集合必须与 KNOWN_FAILING 完全一致**。
 *
 * 两种偏差都会红：
 *   1. 出现清单外的不达标对（新的退化）
 *   2. 清单内的对已达标（清单过期，该删行）
 */
test('不达标集合必须与 KNOWN_FAILING 完全一致（防新退化与清单过期）', () => {
  const failingKeys = PAIRS.filter((p) => !p.passes).map((p) => p.key).sort();
  const registeredKeys = Object.keys(KNOWN_FAILING).sort();

  const appeared = failingKeys.filter((k) => !(k in KNOWN_FAILING));
  const fixed = registeredKeys.filter((k) => !failingKeys.includes(k));

  assert.deepEqual(
    appeared,
    [],
    `出现清单外的不达标边，属新退化：${appeared.join('、')}。`
      + ' 要么修 BRIGHT 表，要么登记进 KNOWN_FAILING 并写清兜底。',
  );
  assert.deepEqual(
    fixed,
    [],
    `这些边已达标，KNOWN_FAILING 里的记录过期了，删掉对应行：${fixed.join('、')}`,
  );
});

/** 登记的实测值必须仍然成立，否则清单在说假话。 */
test('KNOWN_FAILING 的实测值必须与当前一致（容差 0.05）', () => {
  const drift: string[] = [];
  for (const pair of PAIRS) {
    const known = KNOWN_FAILING[pair.key];
    if (known === undefined) continue;
    if (Math.abs(known.own - pair.own) > 0.05 || Math.abs(known.against - pair.against) > 0.05) {
      drift.push(
        `${pair.key} 记为 本格 ${known.own} / 邻格 ${known.against}，`
          + `实为 ${pair.own.toFixed(2)} / ${pair.against.toFixed(2)}`,
      );
    }
  }
  assert.deepEqual(drift, [], `以下登记已失真：${drift.join('；')}`);
});

/**
 * 兜底必须真的兜得住。
 *
 * 上面几条只核 `own`/`against` 两个数，**不核「靠什么兜底」那句话**。于是兜底可以
 * 随便写：写「靠底色差」而底色差其实只有 2，测试照绿，而那句话是假的——正是这个
 * 仓库最不容的那类事。
 *
 * 所以这里按当前色板重算每条兜底的落差，要求它压过**可辨下限**（
 * `EDGE_VISIBLE_MIN_DL`，本文件从 `terrain-edges.ts` import 它）。掉下去意味着这一对
 * 不再只是「不达标但可用」，而是**可辨线索全断了**，得升级成真缺陷处理。
 *
 * 判据为什么不是 §4.1:218 的 8：那条判据原文只管 `BRIGHT.<X>` 对本格与对邻格两个
 * 方向，而 9 条兜底里 5 条是**底色差**（根本不是边色）、4 条是**暗边**（`DARK`，
 * 判据完全没提）。拿 8 去卡暗边和底色差，就是把两条不同用途的线混用——本文件头
 * 12–13 行明写「阈值 8 是 §4.1 的验收线，6 是不退化下限，两者不同，不要混用」。
 * 且五色全挤在 20 L* 带内，「相邻底色差 >=8」是 spec 从未写过、色板未必满足的新约束。
 *
 * 6 是保守的：底色差是整格对整格，比 1px 线更容易看出来；拿 1px 线的下限去要求它，
 * 只会让这条测试更不容易误报，不会放过真的断裂。
 */
test('每条兜底的落差必须压过可辨下限，否则这一对是断的可辨线索', () => {
  const broken: string[] = [];
  for (const [key, known] of Object.entries(KNOWN_FAILING)) {
    const value = fallbackDl(known.self, known.fallback);
    if (value < EDGE_VISIBLE_MIN_DL) {
      broken.push(`${key} 靠${describeFallback(known.self, known.fallback)}，不到 ${EDGE_VISIBLE_MIN_DL}`);
    }
  }
  assert.deepEqual(broken, [], `以下兜底已撑不住：\n  ${broken.join('\n  ')}`);
});

/**
 * key、`self`、`fallback.with` 三处必须说的是同一对。
 *
 * key 是 `"self->neighbor"`，而 `self` 与 `fallback.with` 是另写的两个字段——同一个
 * 事实写三遍，就有一处可能单独改错。`self` 打错一行，`fallbackDl` 会静默算成另一对
 * 的落差，而 `own`/`against` 那条守卫照样绿。所以这里把它们拆开对一遍。
 */
test('KNOWN_FAILING 的 key 与 self/with 字段必须指向同一对材质', () => {
  const wrong: string[] = [];
  for (const [key, known] of Object.entries(KNOWN_FAILING)) {
    const [self, neighbor] = key.split('->');
    if (known.self !== self) wrong.push(`${key} 的 self 写的是 ${known.self}`);
    if (known.fallback.with !== neighbor) {
      wrong.push(`${key} 的 fallback.with 写的是 ${known.fallback.with}`);
    }
  }
  assert.deepEqual(wrong, [], `以下登记三处对不上：` + wrong.join('；'));
});

/**
 * 当前达标率必须与文档一致。
 *
 * §4.1:218 写的是「均 >=8」，而实测 10 对只有 1 对达标。这条把那个比例锁住，
 * 避免有人以为 §4.1:218 已经全线生效。修好若干对之后这个数字会变，届时同步改文档。
 */
test('达标对数与文档记录一致（当前 1/10）', () => {
  const passing = PAIRS.filter((p) => p.passes).map((p) => p.key);
  assert.equal(
    PAIRS.length,
    10,
    '材质对数量变了，说明高度序或材质集合被改过，需重看 §4.1:218 的覆盖面',
  );
  assert.deepEqual(
    passing,
    ['grass->farm'],
    `当前只有 grass->farm 达标（实测），其余靠 KNOWN_FAILING 里登记的兜底。`
      + ` 若这里变了，§4.1:218 与 §1.4c 的结论要一起更新。实为：${passing.join('、') || '无'}`,
  );
});
