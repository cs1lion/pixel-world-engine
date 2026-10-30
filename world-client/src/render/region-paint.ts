/** 地域的三色槽位（主色 / 点缀 / 禁用）怎么落到地面上。
 *
 * **在这之前，这三个槽一个读者都没有。** 设定集声明了五道区域、每道三个色，
 * `load.ts` 还专门在装载期对着 `TOKENS` 验一遍值——而 `src/` 里除类型声明外
 * 零处读取。于是 SPEC_V2 的两条验收是纸面的：
 *
 *   17. 我能一眼分出镇子的不同区域：每个区域有自己的主色、点缀色，
 *       而且区域内不出现被禁用的颜色。
 *   28. 我改一个区域的主色只改配置，不用改渲染代码。
 *
 * #17 的第一个症状是**所有区域长得一样**：`buildings.ts` 与 `setting-scenery.ts`
 * 全程读 `WORLD.*` 或 `pack.palette`，没有一处问「这一格属于哪道区域」。
 * 眼睛在图上看不出渡口、灯街、叠浪楼的分界，只能读 overlay 上那几个字。
 *
 * ## 这一层写错死四次，四次错的是同一件事
 *
 * 1. **虚线框**：邻格区域不同的那一侧，内缩 1px 铺一排断续的主色短线。满足字面
 *    要求（"能分出区域"），但在 1 倍缩放下读成 `?debug-grid=1` 那层调试网格。
 * 2. **alpha 面洗**：整格铺一层半透明主色。0.09 看不见；0.22–0.36 时整条街糊成
 *    一块，`palette-data.ts` 特意校准的 `stone`/`grass` 明度差（6.57）一次覆盖就
 *    白做，混出的中间色还都不在 24 色里。
 * 3. **Bayer 网点**：底层不动、按比例换色（色数没问题），但规则网点在一整片
 *    石街上读成波点壁纸；降到 12% 也只是稀疏的壁纸。
 * 4. **逐格碎斑 + 全场实线边**：位置不规则了，可密度是常数，读成满地撒的
 *    彩纸屑；实线边在截图里读成一个红色选中框。
 *
 * 四次的共同点：**覆盖度是个常数，或者记号围着整片区域**。前者让那层东西
 * 均匀铺满每一寸地，后者是一条 UI 的线。真实的地面不长那样——长苔的地方
 * 是一块一块变色，被水浸过的地方是一滩，其余地方干干净净，边界歪歪扭扭。
 *
 * 现在只有两层（见 `drawRegionGrounding`）：一块一块的斑块（覆盖率由低频噪声
 * 场定，内部是颗粒，边缘是颗粒淡出）加极稀的点缀色。**边界不画**——§4.1 那张表
 * 本来就只写「主色：这一区的地面与大块面积」，一句也没提边界。两块地分得开靠的是
 * 各自地面的色不一样，这正是配置能给、也应该由配置给的东西（#28）。
 *
 * ## 为什么判据是「色」而不是「区域 id」
 *
 * 按 id 分叉（`if (region.id === 'ferry')`）能画出更好看的母题，但那是把设定集
 * 的一个选择焊进渲染代码：换一份设定集，`ferry` 这个名字不再存在，那一支永远
 * 不跑；而 #28 要的正是「改配置就换样」。所以这里只读三个色槽，不认任何 id、
 * 不认任何名字——**画成什么样完全由入参的三个色决定**。
 *
 * ## 禁用色怎么执行
 *
 * 不用「不许出现」这种自我承诺，用**一次替换**：本文件每一次上色都过
 * `slotColor()`，但凡要用的 token 恰好等于这道区域的 `forbidden`，那一笔就不画
 * （返回 `null`）。于是「区域内不出现禁用色」在**这一层**是构造出来的，不是
 * 事后检查出来的。
 *
 * **这一层覆盖得没那么宽，说清楚**：它只管本文件画的地面。建筑
 * （`buildings.ts`）、构件（`setting-scenery.ts`）、角色（`villager.ts`）都不在
 * 这条保证里——那些层今天读的是别处的色。把这条读成「全画面一定没有禁用色」
 * 就是又一个「已修」式的假话。`test/region-paint.test.ts` 里那几个用例断言的是
 * **本文件发出的每一笔**，不是屏幕上的每一个像素。
 */

import type { WorldGrid } from '../world/grid.ts';
import { TILE_PX } from '../world/setup.ts';
import type { TerrainId } from '../world/types.ts';
import type { WorldColor, WorldPalette } from '../world/theme.ts';

/** 一道区域的三色槽位。字段与 `SettingPack['regions']` 的前八样同形。 */
export interface RegionSlots {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly primary: WorldColor;
  readonly accent: WorldColor;
  readonly forbidden: WorldColor;
}

/** 一道区域此刻**生效**的三个色。值是 token 名，不是色值——见 `slotColor()`。 */
export interface RegionPaint {
  readonly primary: WorldColor;
  readonly accent: WorldColor;
  readonly forbidden: WorldColor;
}

/** 上色的最小接口。Phaser 的 `Graphics` 在结构上满足它，测试里塞一个数组就够。 */
export interface PixelSink {
  fillStyle(color: number, alpha: number): unknown;
  fillRect(x: number, y: number, width: number, height: number): unknown;
}

/** 区域 id → 三色槽。没声明的区域不在这张表里。 */
export function regionPaintsOf(regions: readonly RegionSlots[]): ReadonlyMap<string, RegionPaint> {
  return new Map(
    regions.map((region) => [
      region.id,
      { primary: region.primary, accent: region.accent, forbidden: region.forbidden },
    ]),
  );
}

/**
 * 这一笔能不能用这个 token 画。
 *
 * 等于本区的禁用色 → 返回 `null`（那一笔不画），否则原样返回。
 *
 * 为什么是「不画」而不是「换一个色」：换色要挑一个替代品，而挑谁都是编——
 * 编出来的替代色一旦恰好又是别的区域的禁用色，就把问题挪了个地方。少一笔
 * 记号是可见可测的，悄悄换色不是。
 */
export function slotColor(slot: WorldColor, paint: RegionPaint): WorldColor | null {
  return slot === paint.forbidden ? null : slot;
}

/**
 * 斑块浓度，按地形分档：`1` 是标准，`0` 是这片地不长斑块。
 *
 * ## 这一层试错了四次，值得记下来
 *
 * 1. **虚线框**（初版）：只画边界。1 倍缩放下读成 `?debug-grid=1` 那层调试网格。
 * 2. **alpha 面洗**（第二版）：整格铺一层半透明主色。0.09 看不见；0.22–0.36 时
 *    整条街糊成一块，`palette-data.ts` 特意校准的 `stone`/`grass` 明度差（6.57）
 *    一次覆盖就白做，混出的中间色一个都不在 24 色预算里。
 * 3. **Bayer 网点**（第三版）：底层不动、按比例换色，色数没问题，但规则网点
 *    在一整片石街上读成**波点壁纸**；降到 12% 也只是稀疏的壁纸。
 * 4. **逐格碎斑**（第四版）：位置不规则了，可**密度全场一致**，于是读成
 *    满地撒的彩纸屑——洒在一张图上的碎屑，而不是地本身。
 *
 * 四次错的其实是同一件事：**覆盖度是一个常数**。虚线是常数，面洗是常数，
 * 网点的 28% 是常数，碎斑的每格三块也是常数。真实的地面不长那样：长苔的
 * 地方是一整块一整块地变色，被水浸过的地方是一滩，其余地方干干净净；
 * 边界歪歪扭扭，用抖动的稀边淡出。
 *
 * 所以第五版把「多少」交给一个**低频噪声场**（见 `patchCoverage`）：整道区域
 * 上，覆盖率在 0 与 100% 之间缓慢起伏，有的地方一整片是主色，有的地方一点
 * 也没有，交界处用 Bayer 阈值淡出。读出来是「这片地偏暖」，而不是「这片地上
 * 有层东西」。
 *
 * ## 各档为什么是这个数
 *
 * - **石 / 广场 1**：石街面积最大，斑块要能连成片才看得出「这条街偏暖」。
 * - **草 0.8、农田 0.7**：草地的底色本来就碎（草团、花），斑块再重就读成杂色；
 *   农田有垄线要先让路。
 * - **淤泥 / 煤渣 1.2**：最平的两样，连草簇都没有，斑块可以更重、更连片。
 * - **浅滩 0.9**：比草略轻。这里**不写成 0**——浅滩在潮汐层（depth 3）下面，
 *   而那层只在淹掉时压色，退潮时一格不盖；退出来的滩涂正该露出它归谁。
 *   灯潮界那道上看不出差别是因为它自己的配色撞了（见下），不是因为这一层跳过它。
 * - **树 0**：树冠底下是土色与草团，再叠一层读成烂泥。这是唯一一个「按地形
 *   一律不画」的档——理由在材质本身，与哪份设定集无关。
 *
 * ## 配色碰撞，记在这儿而不是偷偷补一笔
 *
 * 这一层拿 `palette[primary]` 去盖 `terrainColors[terrain]` 的底色。两者是
 * **同一个 token** 时，画与不画完全相同。灯潮界今天只剩一处：
 *
 * | 区域 | 主色 | 撞上的底色 | 可见格数 | 点缀 (1/17) |
 * |---|---|---|---|---|
 * | 积尘滩 `sootbank` | `soil` | `terrainColors.mud = soil` | 156 / 299（52%） | 17 |
 *
 * （积尘滩脚下不是一种地形：155 格 `coal`（可见）+ 143 格 `mud`（撞色）+ 1 格
 * `stone`——那 1 格是 `lamp_workshop` 门口铺的门前石，`pack.terrain` 里写的是
 * `mud` 矩形，铺装把它改了。所以「`mud` 有多少格」这个数要问 `world.grid`，
 * 不能拿声明的矩形去减。）
 *
 * （按 `pack.palette` 算，不是全局 `WORLD`——灯潮界自带一套值，拿全局表去比会
 * 得出「没有碰撞」这个假答案。第一次就是这么算的，差点把这两行写成「全部可见」。）
 *
 * 这一层能做的只有**不编**：同色就是同色，凑一个替代色出来等于把第 25 个色
 * 引进画面，而那道区域仍然不是它声明的那道。所以 `slotColor()` 只管禁用色，
 * 不替主色挑替身；碰撞作为一条可知的事实留在这里。
 *
 * ## 浅滩轨道那一处：2026-10-30 修掉了，修在地形那一侧
 *
 * 原来 `shoal` 的主色 `copper` 与 `terrainColors.shallow = copper` 同值，
 * 806 格里只有 65 格（压 `stone` 的那部分）看得见，其余 741 格是空转。
 * 现在 `terrainColors.shallow` 换成 `moss`，806/806 全部可见。
 *
 * **没有动 `shoal.primary`。** 那是 §4.1 表里用户确认过的值，`settings-region-colors.test.ts`
 * 把 pack 与那张表逐格钉着。改地形底色只动 `terrainColors` 这一处。
 *
 * 候选是逐个量的，24 色里只有 `moss` 同时过四道：
 *
 * 1. **对主色 `copper` 可辨**：ΔE 6.15，过下限 6。但它是画得出的那四道区域里
 *    **最低的**——按每道区域**实际占到的每一格**取最小值：渡口 10.16（那 9 格
 *    `grass`）、灯街 33.42（20 格 `stone`）、叠浪楼 52.96（96 格 `stone`）。
 *    （积尘滩不在这个对比里：它对 `mud` 是 **0.00**，见下。）所以这是「够用」，不是「好」。
 * 2. **色相离水色够远**：`moss` 163°、`water` 199°，差 35°。这条是
 *    `pack.ts` 那句「水面叠上去才会真的变深、变蓝」的实质——色相同族的候选
 *    （`cloak` 191°、`stone` 190°、`charcoal` 203°）叠水后读不出「变蓝」。
 * 3. **边可辨**：对 `BRIGHT.shallow = water` 是 ΔL* 8.36，对 `DARK.shallow = ink`
 *    是 32.0，都过下限 6。
 * 4. **不撞别的笔**：不撞本区点缀 `plaster`、不禁用色 `terracotta`、不与其它
 *    七种地形的底色同 token、不等于 `pale`（否则泡沫隐形）。
 *
 * 被淘汰的候选与原因（都是量出来的，不是估的）：`plaster` 撞本区点缀色、
 * `pale` 撞泡沫色、`terracotta` 是本区禁用色、`timber` 亮边只有 5.43、
 * `ember` 纹理只有 1.3、`soil`/`charcoal`/`deepShade`/`timberDark`/`plaza`
 * 满潮叠色后 ΔL* 掉到 2.3 以下（潮汐会读不出来）、`stone`/`grass`/`farm`/`plaza`
 * 撞同名地形底色。
 *
 * **还剩的一处**：`sootbank` 那 52% 没修。它脚下 143 格 `mud`（底色 `soil`）与
 * 主色 `soil` 同值，而主色在 §4.1 里。有效的修法同样是换 `terrainColors.mud`
 * （那 143 格全图 100% 属于积尘滩——全图 `mud` 一共就 143 格），但要先量它与
 * `BRIGHT.mud = stone`、`DARK.mud = ink` 的对比度——按上面四道判据走一遍，
 * 不是换个 token 就算完。
 * 这里记的是「修了一半」，不是「已修」。
 */
export const REGION_PATCHES: Readonly<Record<TerrainId, number>> = {
  grass: 0.8,
  farm: 0.7,
  tree: 0,
  stone: 1,
  plaza: 1,
  shallow: 0.9,
  mud: 1.2,
  coal: 1.2,
};

/**
 * 噪声场的周期，单位是**格**。3 意味着斑块约 3×3 格（48×48 像素）一团。
 *
 * 太大则一道 20 格宽的区域里只有两三团，读成「一大块脏」；太小则退回到
 * 第四版的碎斑（满地彩纸屑）。3 是「一眼看得出是几团、又不至于糊成一片」的
 * 那一档——苔痕、水渍、被踩秃的草，差不多就是这个尺寸。
 */
const BLOB_PERIOD = 3;

/**
 * 噪声映射到覆盖率的窗口：低于 `LO` 一格不画，高于 `HI` **整片实心**，
 * 中间那一条用阈值拆成颗粒淡出。
 *
 * 窗口很窄（0.08），这是第五版的关键。窗口一宽，大片区域就停在 25%–60%
 * 这种半覆盖状态，而**任何半覆盖在大面积上都读成一层撒上去的东西**——第四版
 * 是满地彩纸屑，第三版是波点壁纸。窄窗口把绝大多数地方推到 0 或 1：要么这块
 * 地整片是主色，要么干净，只有边缘一两像素是过渡。
 *
 * 窗口**位置**（0.70–0.76，不是 0–0.06）决定斑块占多大面积。必须放在高段：
 * 主色盖掉一两成的地，读成苔痕水渍；盖掉四成，读成泼出来的颜料。
 */
const BLOB_LO = 0.70;
const BLOB_HI = 0.76;

/** 斑块内部最浓时的覆盖率。不是 1，见 `patchCoverage` 末尾那段。 */
const BLOB_CAP = 0.55;

/**
 * 地形权重怎么落到面积上：权重不改变斑块的**浓淡**（那会退回半覆盖），
 * 只改变**有多少地长斑块**——权重小的地形，噪声要被推到更高才算数。
 *
 * 于是 `REGION_PATCHES` 的 0.7 与 1.2 读起来是「这块地的斑块稀疏些 / 密些」，
 * 而不是「这块地的斑块淡些 / 浓些」。半透明的浓淡是面洗的语法，已经试过了。
 */
const BLOB_BIAS = 0.2;

/**
 * 落笔的粒度：一块几乘几像素。
 *
 * 2 而不是 1——1px 的颗粒在 1 倍缩放下读成噪点（电视雪花），而且一格的绘制
 * 指令翻四倍。2×2 的颗粒在 1 倍下是「麻」，2 倍下看得出是一块一块的。
 */
const GRAIN = 2;

/**
 * 阈值：这一像素落不落笔。
 *
 * 用**坐标哈希**而不是 Bayer 矩阵。第三版用过 8×8 Bayer，它在 50% 附近
 * 是一张棋盘格——规则图案在大面积上读成「网」。坐标哈希给出的是均匀散布的
 * 孤立像素，同样的覆盖率读成**颗粒**而不是网。这一层要的是地的质感，
 * 不是印刷网点。
 *
 * 与 `tilemap.ts`、`REGION_PATCHES` 用同一套 `hash2`：同一坐标永远同结果，
 * 截图可复现。
 */
function thresholdAt(x: number, y: number): number {
  return (hash2(x, y) & 1023) / 1023;
}

/**
 * 点缀色的稀度：每多少格点一颗（1/17，设定集里一道 200 格的区域落十来颗）。
 *
 * §4.1 把「点缀色」列为三个槽之一，它就得在画面上找得着；但密了就与斑块
 * 混成一片，读不出「这是点缀」。**它是唯一带硬轮廓的一笔**：2×2 的点缀色
 * 压在 1px 主色底边上，所以哪怕是同一族颜色也看得出这是一个具体的记号。
 */
const ACCENT_EVERY = 17;

/** 稳定的整数哈希：同坐标永远同结果，截图可复现（与 `tilemap.ts` 同一套）。 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 低频噪声场：给 (x, y)（单位是像素）一个 0–1 的平滑值。 */
function patchMask(x: number, y: number): number {
  const period = BLOB_PERIOD * TILE_PX;
  const gx = Math.floor(x / period);
  const gy = Math.floor(y / period);
  const fx = smoothstep((x % period) / period);
  const fy = smoothstep((y % period) / period);
  const at = (ix: number, iy: number): number => (hash2(ix * 31 + 7, iy * 17 + 3) % 1000) / 999;
  const top = at(gx, gy) * (1 - fx) + at(gx + 1, gy) * fx;
  const bottom = at(gx, gy + 1) * (1 - fx) + at(gx + 1, gy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** 三次平滑：噪声格点之间的过渡不要线性（线性会在格点上留下折角）。 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 这一点该不该铺主色：0 = 不铺，1 = 铺满，中间交给 `thresholdAt` 拆成颗粒。
 *
 * 三步：噪声场定「这一带长不长斑块」→ 窗口把它拉成 0/1 的两端（中间一条
 * 过渡带）→ 权重平移窗口，决定**有多少地**长斑块。
 */
function patchCoverage(x: number, y: number, weight: number): number {
  // 权重平移窗口而不是缩放覆盖率：窗口整体右移 ⇒ 够格的面积变小，但够格的地方
  // 仍然整片实心。权重 1.2 时窗口左移，斑块更大。
  const shift = (1 - weight) * BLOB_BIAS;
  const lo = BLOB_LO + shift;
  const hi = BLOB_HI + shift;
  const raw = (patchMask(x, y) - lo) / (hi - lo);
  // 乘 `BLOB_CAP` 而不是到 1：斑块内部也得是颗粒，不然一块实心色压在石板上，
  // 读成泼上去的漆。0.55 的意思是「最浓的地方也只换掉五成半的像素」，
  // 底下石板的缝与石缘从颗粒间透出来——这正是第二版面洗丢掉的那点信息。
  return Math.min(1, Math.max(0, raw)) * BLOB_CAP;
}

/**
 * 把地域的三色画到地面上：**一层斑块 + 少量点缀**。
 *
 * 只有两层，这是试错四轮之后砍下来的结果。前四版都多画了第三层「记号」——
 * 虚线框、面洗、网点、碎斑——四次都是同一个错：覆盖度是个常数，于是那层东西
 * 均匀地铺满每一寸地，读成「贴上去的一层」（见 `REGION_PATCHES` 文件头）。
 * 剩下的两层各自回答一个不同的问句：
 *
 * 1. **斑块**（`patchCoverage`）：这片地整体偏暖还是偏冷？覆盖率由低频噪声场
 *    定，在一整道区域上缓慢起伏：有的地方整片是主色，有的地方一点也没有，
 *    交界处用阈值拆成颗粒。**没有边界线**——两块地的分界落在一边有斑、
 *    一边没有的那条不规则接缝上，就像两片真草地的深浅在交界处自己变过来。
 * 2. **点缀**（1/17 的格）：这一区用哪个颜色作记号？2×2 点缀色压在 1px 主色
 *    底边上。稀疏到能在图上数出来；密了就成了噪点。
 *
 * 两层都过 `slotColor()`：禁用色一笔都落不下去。
 */
export function drawRegionGrounding(
  g: PixelSink,
  grid: WorldGrid,
  originX: number,
  originY: number,
  palette: WorldPalette,
  regions: readonly RegionSlots[],
): void {
  if (regions.length === 0) return;
  const paints = regionPaintsOf(regions);

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.at({ x, y });
      if (cell === undefined || cell.region === undefined) continue;
      const paint = paints.get(cell.region);
      if (paint === undefined) continue;
      const primary = slotColor(paint.primary, paint);
      if (primary === null) continue; // 主色被禁 ⇒ 这一格什么也不画
      const px = originX + x * TILE_PX;
      const py = originY + y * TILE_PX;

      // 1 斑块。噪声场按**世界像素坐标**取，所以跨格连续：一整道区域是一张
      //    连片的地，而不是每格各长各的。按格起噪声会在每条 16px 的格界上
      //    露出一道缝——第四版的碎斑就是这么来的。
      const weight = REGION_PATCHES[cell.terrain];
      if (weight !== 0) {
        g.fillStyle(palette[primary], 1);
        const steps = TILE_PX / GRAIN;
        for (let gy = 0; gy < steps; gy += 1) {
          for (let gx = 0; gx < steps; gx += 1) {
            const blockX = px + gx * GRAIN;
            const blockY = py + gy * GRAIN;
            if (thresholdAt(blockX, blockY) >= patchCoverage(blockX, blockY, weight)) continue;
            g.fillRect(blockX, blockY, GRAIN, GRAIN);
          }
        }
      }

      // 2 点缀：极稀的 2×2，带 1px 主色底边。两笔各自过禁用色——
      //    禁用色恰好是点缀色时，这一颗整颗都不画，而不是留一个没有底边的浮块。
      if (hash2(x, y) % ACCENT_EVERY === 0) {
        const accent = slotColor(paint.accent, paint);
        if (accent !== null) {
          const h = hash2(x, y);
          // 锁在 [4,10]×[5,13]，加上 2×2 与 1px 底边仍在格内（16px）。
          // 越界会渗进邻格，而邻格可能属于另一道区域，颜色就串了。
          const ax = px + 4 + ((h >>> 4) % 7);
          const ay = py + 5 + ((h >>> 12) % 9);
          g.fillStyle(palette[primary], 1);
          g.fillRect(ax, ay + 2, 2, 1);
          g.fillStyle(palette[accent], 1);
          g.fillRect(ax, ay, 2, 2);
        }
      }
    }
  }
}
