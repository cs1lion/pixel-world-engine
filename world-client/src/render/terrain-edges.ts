/** 地形拼接边：让材质之间长出台阶边，而不是硬切方块。
 *
 * （这个文件头与第 2 条规则原来各带一处 `ART_STYLE_TARGET §1.2` / `§1.3` / `§1.5`
 * 的引用——**那份美术文档不在这个仓库里**：`git log --all --diff-filter=A
 * -- '*ART_STYLE*'` 全史为空，`test/terrain-edge-visibility.test.ts` 的文件头
 * 早就记着这件事。规矩本身都在下面写着，不需要一个不存在的文档替它背书。已删。
 *
 * 原来那句「已删」**说过头了**：删掉的只有文件头和第 2 条规则那两处，正文里还留着
 * 四处 §1.2 / §1.5（`亮一档 token 名`、`暗边比底色更深`、`20 变体` 三行与
 * `buildings.ts` 的接触阴影），`155 行` 还有一处 §4.1:218。2026-10-27 一并清掉，
 * 一条引用都没留——规矩照留，出处删掉。）
 *
 * 为什么需要
 * ----------
 * 每格只铺一块基色 + 2×2 抖动，材质交界就是一条直角硬切。Stardew 靠 47 块 blob 图集
 * 让地面自己长出边和角；我们没有图集（纯 Graphics 手绘），取它的**可用子集**：
 *
 *   4 邻边掩码（N/E/S/W 各一位，16 种）+ 4 个内凹角修正（NW/NE/SW/SE 各一位）= 20 变体
 *
 * 这 20 个是**绘制原语**，不是一张 20 张图拼出来的图集：一格可以同时拥有多条边和多个
 * 角（例如北、西都更低、西北也更高时，三个原语同时生效），所以按格逐位判定直接画。
 *
 * 三条规则（本仓自己的规矩，出处是代码与实测，不是哪份美术文档）
 * ------------------------------------------------------------------
 * 1. **边只画在高材质一侧**。材质高度序 `tree > grass > farm > stone > plaza`；低的一侧
 *    不画。这样每条交界线上**恰好只有一条 1px 线**，不会出现 2px 双描边。
 * 2. **亮边在上/左，暗边在下/右**。世界的光统一从左上打（与建筑投影、角色接触阴影
 *    同向）。高台朝上/朝左的立面受光 → 用该材质**亮一档**
 *    的 token；朝下/朝右的立面背光 → 默认 `soil`（W02，全场最深的土色，兼作阴影色），
 *    但 `tree` 的底色本身就是 soil，用它等于白画，所以 `tree` 改用 `ink`（见 `DARK` 表）。
 * 3. **不加色**。两表一共只用在册的 **7 个** token：`soil / plaza / grassLit / ink /
 *    stone / trim / water`，24 色预算不变。
 *
 *    这条规则原写「三个」（`soil / plaza / grassLit`），而两表实际用到七个——同一个数
 *    错了很久没人发现，因为没有任何东西在数它。现在 `terrain-edges.test.ts` 有一条
 *    「边色 token 清单」把这份名单钉住：往表里加一个新 token 那条就会红，红的意思是
 *    来改这个数，不是去改测试。
 *
 * 内凹角修正是干什么的
 * --------------------
 * 相邻两格各自画出一条暗边时，两条线是「错开一格」的：上面的格画 y 行、左边的格画 x 列，
 * 交点那个像素不属于任何一条线，会留下 1px 缺口（实测在地图四角的树篱处必然出现）。
 * 修正就是由**斜角更高**的那一格把交点补上 1px，让 L 形转角连续。
 */

import type Phaser from 'phaser';
import type { TerrainId } from '../world/types.ts';
import { WORLD } from '../world/palette-data.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';
import { TILE_PX } from '../world/setup.ts';

/** 材质高度序：边只画在高度**更大**的一侧。 */
export const TERRAIN_HEIGHT: Readonly<Record<TerrainId, number>> = {
  tree: 4,
  grass: 3,
  farm: 2,
  stone: 1,
  plaza: 0,
  shallow: 1,
  mud: 1,
  coal: 2,
};

/**
 * 亮一档 token 名：只用现有 24 色里的 `grassLit` / `plaza`。
 *
 * 存 **token 名**而不是解析后的色值：设定集换掉 `plaza` 时，边要跟着换，
 * 存色值就等于把莞尔镇的颜色冻在第二座镇子的岸边上。色值到 `drawTileEdge`
 * 里按当次色板解析，默认仍是 `WORLD`。
 */
export const BRIGHT: Readonly<Record<TerrainId, WorldColor>> = {
  tree: 'grassLit',
  // grass 亮边用 plaza（ΔL* 9.5）；原 grassLit 对 grass 只有 3.0，落在
  // `EDGE_VISIBLE_MIN_DL`（6）以下——于是**每一条** grass 亮边都是看不见的，
  // 默认世界实测 176 条（北 95 + 西 81），一条不剩。
  //
  // 原注释写「18 条边不可见」。那个数对不上任何数法：默认世界 176 条、小世界
  // （30×20）16 条（北 2 + 西 14），连边带内凹角一起数也不是 18。已改成引
  // ΔL* 与下限——那两个有锁；条数没有锁，写死了只会再烂一次。
  grass: 'plaza',
  farm: 'plaza',
  stone: 'plaza',
  // plaza 是最低材质（高度序里唯一的 0），邻格不可能更低，所以它**永远不画边**。
  // 这不是数出来的，是 `isLower` 推出来的：默认世界 36 个 plaza 格、小世界 16 个，
  // 两边实测画出的边像素都是 0。这里给 trim 而不是自身也是为此：万一将来改了高度序，
  // 画出来的边也不会与底色相同、变成隐形线。
  plaza: 'trim',
  shallow: 'water',
  mud: 'stone',
  coal: 'stone',
};

/**
 * 暗边 token 名：按材质查表，**不能**全场统一用一个色。
 *
 * 原来全场统一用 soil（W02）。但 `tree` 的底色本身就是 soil
 * （`TERRAIN_COLORS.tree = WORLD.soil`），于是 tree 格朝下/朝右的暗边画出来
 * 与底色完全相同 —— 亮度落差 **0.0**，等于白画。
 *
 * 那批像素有多少：默认世界（`buildLargeWorld`，96×72）实测 2597 个 tree 格里有
 * 630 格画朝下/朝右的暗边（其中 82 格两边都画，合 712 条边），边是 11392 px；
 * 这 630 格还顺带补了 176 个暗内凹角，整批 11568 px。分母取**边写入总量**
 * 29387 px——那是 `fillRect` 的面积和，邻边共用的角像素被数了不止一次，去重后
 * 只有 29003 px，所以 29387 不是「有多少个像素」，是「写了多少像素次」。
 * 整批占 39.4%（11568/29387）；两边都按去重像素算是 11274/29003 = 38.9%。
 * 分母是边，不是「总写入像素」——连底色那趟一起算是 0.65%（11568/1769472，
 * 96×72 格 × 256 px），那个数没有信息量，所以原来选的分母本身就是含糊的。
 *
 * （这里原来写「96 个 tree 格里有 48 个（正好一半）……占总写入像素的 25.6%」。
 *  三个数都不对：96 是**小世界**（`buildWorld()`，30×20）的 tree 格数，默认世界
 *  是 2597；48 是 96÷2 算出来的、不是数出来的，实测 46 格（南 28 + 东 18，
 *  没有一格两边都画）；25.6% 对不上任何分母——边像素 28.6%、含底色 0.5%。
 *  已按默认世界重测重写。教训与 `bake.ts` 那条同源：把算术当实测。）
 *
 * （再往下还有一层，是上一笔重测时留下的：那次的 11392 / 38.8% / 小世界 736
 *  三个数口径不齐。11392 = 712 条边 × 16，只数了**边**，把 tree 顺带补的 176 个
 *  暗内凹角漏在批外；分母 29387 却把全部 411 个内凹角算在内——分子漏、分母不漏，
 *  两个数就不该相除。而 29387 被叫作「全部边像素」，它其实是 `fillRect` 的面积和：
 *  一格同时画南和西时，(px, py+15) 这个像素先被暗边写一次、再被亮边写一次，算两回。
 *  小世界那个 736 则是 46×16 算出来的、不是数出来的——实测另有 2 个暗内凹角，
 *  整批 738。现在四个数按同一口径重报，并由 `terrain-edge-pixels.test.ts` 钉住。）
 *
 * 这不是风格选择，是「暗边比底色更深」这条规矩在 tree 上的漏洞：它的底色
 * 已经是最深的土色，没有更深的同色可用。修法是 tree 的暗边改用 ink（W01，比 soil
 * 再深一档），落差 6.76 —— 压过边可见性下限 6，可辨，且仍在 24 色预算内，
 * 不新增颜色。
 *
 * 为什么其他材质不动：grass / farm / stone / plaza 的底色都比 soil 亮，落差
 * 9.98–20.80，全部压过下限 6，本来就清楚。只补 tree 这一处漏洞，不顺手改已有
 * 正确的东西。
 *
 * 这两段里的**落差数**有锁，其余没有，说清楚免得这句本身变成新的空话：
 *   - `6.76`（ink 比 soil 深一档）—— `terrain-edges.test.ts` 的「逐个引用」那条
 *   - `9.98–20.80`（其他材质对 soil 的区间）—— 同文件的「区间」那条
 *   - `6`（可辨下限）—— 就是本文件导出的 `EDGE_VISIBLE_MIN_DL`，两处测试都 import 它
 *   - `24`（色预算）—— 不在这儿锁，归 `palette-budget.test.ts`
 *   - 上一段的 `2597 / 630 / 712 / 11392 / 176 / 11568 / 29387 / 29003 / 39.4%`
 *     是**像素计数**，不是落差。它们由 `terrain-edge-pixels.test.ts` 钉住——那是
 *     本文件自己的守卫，会跟着世界改，红的意思是来改这段注释，不是去改测试。
 *     它们是默认世界（96×72）的数；小世界（30×20）是 96 个 tree 格 / 46 格画暗边
 *     （南 28 + 东 18，没有一格两边都画）/ 736 px 边 + 2 px 内凹角 = 738 px /
 *     2576 px 写入（2575 去重）/ 28.6%——别把两套混用。
 * 改色或换 token 之后，前三条会红；红的意思是来改注释，不是去改测试。
 */
export const DARK: Readonly<Record<TerrainId, WorldColor>> = {
  tree: 'ink',
  grass: 'soil',
  farm: 'soil',
  stone: 'soil',
  // 同 BRIGHT.plaza 的理由：plaza 永不画边；给 stone（比 plaza 暗）以防将来改高度序。
  plaza: 'stone',
  shallow: 'ink',
  mud: 'ink',
  coal: 'ink',
};

/**
 * 1px 地形边的**可辨下限**：边色与本格底色的 ΔL\* 低于它，那条边肉眼看不出来。
 *
 * 这是本仓库自己的「不退化」线，**不是** `terrain-edge-visibility.test.ts` 里那条
 * 验收线 8。那条管的是亮边对本格底色与对紧邻那一格两个方向，用途不同，两者不要混用
 * （那个测试文件的文件头把这句话写在那儿）。
 *
 * （原来这里写的是「**不是** §4.1:218 的验收线 8」。那个出处是
 * `ART_STYLE_TARGET` §4.1 第 218 行——**那份美术文档不在这个仓库里**，
 * `test/terrain-edge-visibility.test.ts` 文件头第 7-9 行早就记着这件事，
 * 它全文用 `§4.1:218` 当那条判据的标签。
 *
 * 所以它不是「指错了文档」，是**指着一份不在仓里的文档当依据**——而这正是本文件
 * 开头那条规矩要避免的事：规矩写在代码里，不需要一个不存在的文档替它背书。
 * 我上一版把这儿写成「`docs/SPEC.md` 的 §4.1 是仓库布局、全文 193 行没有 218 行」，
 * **那查错了对象**：从来没有人说它在 SPEC.md 里，它在 `ART_STYLE_TARGET` 里。
 * 拿两份不相干文档的目录去证一句假话，证的方式本身也是假的。已改。）
 *
 * 依据：画面里已证明可读的 1px 线是角色墨线（ink vs grass ΔL\* 18.05），那是强轮廓，
 * 地形边只需弱一档；实测 6 以下（原 grass 亮边 3.02、tree 暗边 0.0）肉眼不可辨。
 *
 * 放这儿而不是留在某个测试文件里：两个测试文件都要用它（边可见性回归锁，以及
 * `KNOWN_FAILING` 的兜底是否还撑得住），而 `DARK` 那段里「压过边可见性下限 6」
 * 那句也指着它——留成测试里的私有常量，那句话就仍然是没人算的 prose。
 *
 * 指的是**原句**，不是行号。这里原来写的是 `terrain-edges.ts` 第 79 行：那次往文件
 * 头部加注释把行号往下推了 7 行，第 79 行于是落到一段不相干的散文上，而
 * `audit-references.ts` 一声没响——它自己的文件头就写着「不查『那段说的是不是
 * 那件事』」，而且「指着注释是正当的」。语义上烂掉没有任何机器能挡，所以改成引
 * 原句，由 `terrain-edges.test.ts` 的「互相引用」那条钉住它还在。
 *
 * （顺带一笔：上面这几处**故意**写「第 89 行」而不写「:89」。`audit-references.ts`
 *  的 `REF` 认「文件名:行号」，分不清「这是一处引用」和「我在说一处坏掉的引用」——
 *  照原样写，这段历史陈述自己就会变成一处受查。**可这个风险今天并不成立**：实测
 *  把这里改成 `terrain-edges.ts:89` 再跑 `--strict`，存疑 0 处——`mud: 'stone',`
 *  今天在**第 89 行**（原写「第 79 行」，那今天是一行注释：`// ΔL* 与下限——那两个
 *  有锁；条数没有锁，写死了只会再烂一次。`），有代码，前四道检查全过。所以「照原样
 *  写就会红」是假的，别拿它当理由。真正的理由只剩一条：这里说的是**一处已经坏掉的
 *  引用**，让审计器去核准一处我们明知是坏的指针，准了反而是误导。第 89 行哪天落到
 *  空行上，`:89` 才会红，而那时候红是对的——那说明这段历史也该重写了。
 *  此处不写「共查 N 处」：那个 N 随每一次增删引用而变，写死了就是下一句假话。）
 */
export const EDGE_VISIBLE_MIN_DL = 6;

/** 四邻边掩码的位。 */
export const SIDE_BIT = { north: 1, east: 2, south: 4, west: 8 } as const;/** 四内凹角修正掩码的位。 */
export const CORNER_BIT = { northWest: 1, northEast: 2, southWest: 4, southEast: 8 } as const;

export const SIDE_VARIANTS = 16;
export const CORNER_VARIANTS = 4;
/** 20 变体 = 16 邻边 + 4 内凹角。 */
export const TERRAIN_EDGE_VARIANTS = SIDE_VARIANTS + CORNER_VARIANTS;

/** 一格周围 8 个邻格的材质；越界为 `null`（世界边界不算材质边界，不画边）。 */
export interface EdgeNeighbors {
  readonly north: TerrainId | null;
  readonly northEast: TerrainId | null;
  readonly east: TerrainId | null;
  readonly southEast: TerrainId | null;
  readonly south: TerrainId | null;
  readonly southWest: TerrainId | null;
  readonly west: TerrainId | null;
  readonly northWest: TerrainId | null;
}

/** 邻格比本格低（严格小于）→ 这一侧要画边。越界 / 同高 / 更高都不画。 */
function isLower(self: TerrainId, other: TerrainId | null): boolean {
  if (other === null) return false;
  return TERRAIN_HEIGHT[other] < TERRAIN_HEIGHT[self];
}

/** 四邻边掩码：某一位为 1 表示该侧的邻格材质更低，需要一条 1px 台阶边。 */
export function sideMask(self: TerrainId, around: EdgeNeighbors): number {
  let mask = 0;
  if (isLower(self, around.north)) mask |= SIDE_BIT.north;
  if (isLower(self, around.east)) mask |= SIDE_BIT.east;
  if (isLower(self, around.south)) mask |= SIDE_BIT.south;
  if (isLower(self, around.west)) mask |= SIDE_BIT.west;
  return mask;
}

/**
 * 四内凹角修正掩码：某个角的两条直角邻边**都不画**、但斜角更低时，补 1px 交点。
 *
 * 两条直角邻边都不画意味着相邻两格不会替我们补这个交点，缺口只能由本格自己补；
 * 若某条直角邻边已经画了线，交点被那条线覆盖，不需要也不应该重复补。
 */
export function cornerMask(self: TerrainId, around: EdgeNeighbors): number {
  const side = sideMask(self, around);
  let mask = 0;
  if (
    (side & (SIDE_BIT.north | SIDE_BIT.west)) === 0 &&
    isLower(self, around.northWest)
  ) {
    mask |= CORNER_BIT.northWest;
  }
  if (
    (side & (SIDE_BIT.north | SIDE_BIT.east)) === 0 &&
    isLower(self, around.northEast)
  ) {
    mask |= CORNER_BIT.northEast;
  }
  if (
    (side & (SIDE_BIT.south | SIDE_BIT.west)) === 0 &&
    isLower(self, around.southWest)
  ) {
    mask |= CORNER_BIT.southWest;
  }
  if (
    (side & (SIDE_BIT.south | SIDE_BIT.east)) === 0 &&
    isLower(self, around.southEast)
  ) {
    mask |= CORNER_BIT.southEast;
  }
  return mask;
}

/** 本格用到几个绘制原语（0 表示这格什么都不画）。调试与单测用。 */
export function primitiveCount(self: TerrainId, around: EdgeNeighbors): number {
  return bitCount(sideMask(self, around)) + bitCount(cornerMask(self, around));
}

function bitCount(value: number): number {
  let rest = value;
  let count = 0;
  while (rest !== 0) {
    count += rest & 1;
    rest >>>= 1;
  }
  return count;
}

/**
 * 画一格的地形边。在底色与抖动纹理之后调用，只写本格内部的 1px 像素，不越界。
 *
 * `palette` 决定亮/暗边落在哪个色值上：换设定集时边跟着新色板走，
 * 不传就用莞尔镇的 24 色（旧调用点的行为完全不变）。
 *
 * 绘制顺序：先暗边（下/右）再亮边（上/左），最后补角。暗亮在角上共用同一个像素时
 * 让亮边胜出——光从左上来，转角靠光的那一侧是受光面。
 */
export function drawTileEdge(
  g: Phaser.GameObjects.Graphics,
  self: TerrainId,
  around: EdgeNeighbors,
  px: number,
  py: number,
  palette: WorldPalette = WORLD,
): void {
  const side = sideMask(self, around);
  const corner = cornerMask(self, around);
  if (side === 0 && corner === 0) return;

  const size = TILE_PX;
  const bright = palette[BRIGHT[self]];
  // 暗边按材质取色：tree 用 ink（底色本身是 soil，用 soil 会隐形），其余用 soil。
  const dark = palette[DARK[self]];

  if ((side & SIDE_BIT.south) !== 0) {
    g.fillStyle(dark, 1);
    g.fillRect(px, py + size - 1, size, 1);
  }
  if ((side & SIDE_BIT.east) !== 0) {
    g.fillStyle(dark, 1);
    g.fillRect(px + size - 1, py, 1, size);
  }
  if ((side & SIDE_BIT.north) !== 0) {
    g.fillStyle(bright, 1);
    g.fillRect(px, py, size, 1);
  }
  if ((side & SIDE_BIT.west) !== 0) {
    g.fillStyle(bright, 1);
    g.fillRect(px, py, 1, size);
  }

  if ((corner & CORNER_BIT.northWest) !== 0) {
    g.fillStyle(bright, 1);
    g.fillRect(px, py, 1, 1);
  }
  if ((corner & CORNER_BIT.northEast) !== 0) {
    g.fillStyle(bright, 1);
    g.fillRect(px + size - 1, py, 1, 1);
  }
  if ((corner & CORNER_BIT.southWest) !== 0) {
    g.fillStyle(dark, 1);
    g.fillRect(px, py + size - 1, 1, 1);
  }
  if ((corner & CORNER_BIT.southEast) !== 0) {
    g.fillStyle(dark, 1);
    g.fillRect(px + size - 1, py + size - 1, 1, 1);
  }
}
