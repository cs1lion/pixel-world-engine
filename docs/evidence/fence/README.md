# 花径木栅 · 2026-11-09

设定集 p110–111 的「夹道栅栏」，原来的状态是一件都没有（`docs/OPEN_ISSUES.md` N 节第 3 条）。
这一笔新增 `kind: 'fence'`，**每帧 0 条命令、24 色不新增、不改通行**。
**依据等级 B：只有仓库转述，没有一手画册证据**（本机画册 PDF 99 页、无文字层，对不上
p110–111）。所以这是「按转述推的近形」，**不宣称还原设定集**。

## 1. 做了什么

| 位置 | 改动 |
|---|---|
| `world-client/src/settings/types.ts` | `SettingScenery['kind']` 加 `'fence'` |
| `world-client/src/settings/load.ts` | 装载期闭集 `SCENERY_KINDS` 加 `'fence'` |
| `world-client/src/render/bake.ts` | 新增 `bakeTexture`（只烘纹理、不落图），`bakeLayer` 改为复用它 |
| `world-client/src/render/setting-scenery.ts` | `fence` 分支 + 共享纹理名 `FENCE_TEXTURE` |
| `world-client/src/settings/dengchao/pack.ts` | 4 件，落在两列花床的南端面 `y25` |
| `world-client/test/fence.test.ts` | 闭集 / 落地 / 未知 kind 仍 throw 三条断言 |

**一件 = 一格**（4 件在 `(4,25) (5,25) (8,25) (9,25)`）。不是一件带 `length` 的长条，
因为 depth 必须按行算（`world-client/src/render/scenery-depth.ts`）：一根跨多格的长条
只有一个 depth，就没法与站在不同行的人分别判前后。

**一张纹理贴 4 次**。四段内容逐格相同，各烘一张就是 4 次 `generateTexture` 加 4 张
纹理在渲染器里来回切——这正是 N 节「代价」那条警告过的（件数上去会变成多次纹理切换）。
所以纹理只烘一张（`bakeTexture`），四件各自 `add.image` 复用同一个 key。

## 2. 为什么只做东西向（这一笔的结论）

**南北向的栅栏在这套投影里读不出来。** 这不是省事，是四种画法都试过之后的结果：

| # | 画法 | 1:1 下的读法 |
|---|---|---|
| v1 | 2px 单线 + 每格一根 4×4 立柱 | 一根带节的木杆 |
| v2 | 立柱改成每两格一根、侧面换木色暗面 | 一根木杆，节更稀 |
| v3 | 加宽成 5px 带（地影 / 暗面 / 栏杆 / 受光棱） | 一根木条躺在地上 |
| v4 | 2px 线 + 往右下错位 2px 的地影 | 一根立起来的木杆，仍不是栅栏 |

原因在几何上：**这套投影里「走向」和「高度」都落在屏幕竖直方向**。一道沿南北跑的
栅栏，栏杆在屏幕上是竖线、立柱在屏幕上也是竖线，两者平行，谁遮谁都分不出；能用的
只剩「线的两侧一亮一暗」和「错位地影」这两条弱线索，撑不起「一排竖直的立柱」。

东西向就没有这个死结：立柱竖着站、栏杆横着跑，两者正交，「立着」这件事一眼读出来。
所以栅栏只落在**两列花床的南端面**（人从南口进来先看到的那一面），把通道口收住。
**南北向的长栏一件没做**——「夹道」这一点只兑现到通道口的两段矮栏，如实记账。

废稿与成品都在 `world-client/tmp/garden-stone/fence{1,2,3,4,5}.png`（未跟踪）。

## 3. 与石灯籠的前后关系

栅栏与石灯籠都在 `(4,25)` 这一行上，取同一个 `sceneryDepth`，同 depth 时谁在前只剩
**创建顺序**。`pack.ts` 里栅栏写在石作**之前**，于是石作压住那一段栏杆——栏杆从
竿两侧的透明缝里露出来，读成「从石灯背后穿过去」，不是「从底座中间穿过去」。
反过来写的话，栏杆会横切灯籠的底座。

## 4. 读数

- **命令数不进统计**：栅栏是 Image，`renderStats()` 只数 Graphics 的 commandBuffer，
  所以 before / after 都是 **20,085**、`graphicsObjects` 都是 **119**。
  「+0 条」的准确含义是「不进命令统计」，不是「GPU 少画」——真实代价是 1 次
  `generateTexture` 加 1 张 16×16 纹理（4 件共用）。
- **逐像素差**（`after3.png` → `fence5.png`，同机位同冻帧；矩形都是**截图 px**）：
  - 西侧两段 `(128,320)–(192,352)`：**400 px / max 187**（其中 80 px 落在石灯籠那一格里，
    是栏杆从竿两侧透明缝露出来的部分）
  - 东侧两段 `(256,320)–(320,352)`：**640 px / max 195**
  - 两列花床 `(128,192)–(320,320)`：**0 px**——这一笔没碰花床
  - 全图 **1,040 px / max 195**，bbox `(128,330)–(319,345)`，正好是两条栅栏，
    没有零散异动（对比图 `f5wide-mark.png` 上只有两段红线）
- **确定性**：同配置双跑 **0 px / max 0**。
- **预算闸**：`check-ground-shadow` 绿，实测峰值 **28,068**、天花板 `34,666`、债务 0。
  上一笔（庭心石作）读 **28,076**，差 **−8**——这是 O4 记的**单时刻体态噪声**
  （±百余条），**既不能算本笔的下降，也不能拿来调阈值**。栅栏是 Image，不进命令统计。
- 机位与口径：`?world=dengchao&time=noon&feed=off&ledger=off&debug=1&now=960`、
  1010×700、世界冻住、潮位钉 1、晴、灯 / 摊 / 幌 / 烟四支动态全关、180 帧沉降、
  相机 `scrollX=0 / scrollY=240`（`centerCameraOn(72,400)`）。
- 产物（未跟踪）：`world-client/tmp/garden-stone/{after3,fence5,fence6}.png`、
  `f5wide-{base,cur,mark}.png`、`f5-*.png`。脚本 `world-client/tmp/garden-stone-shot.mjs`
  （`LABEL=`）、分区统计 `world-client/tmp/fence-regions.mjs`。

## 5. 没做的（别当待办捡回来／别当已完成）

- **南北向的夹道长栏**：没做。理由见 §2，这是几何结论不是取舍。
- **石垣**：同一分支另开一笔做掉了（花床北缘 `y20` 的一道矮墙，
  `docs/evidence/stone-wall/README.md`）；**瓦顶**同日第三笔补上（只换压顶 3px，
  见 `docs/evidence/wall-roof/README.md`）。
- **粉紫第 25 色**：仍不开。花圃只有暖红 + 米白。
- **夜里补光 +306**：没做，仍是「新增功能」。
- **A 档**：翻书拍到 p110–111 才能升 A；在那之前所有形制判断都只是 B 档。
- **通行**：`isWalkable` 不看 `scenery`，栅栏**只是画**——人和原来一样能从南口走进
  花径、也能横穿栅栏。这与树篱那条债同源（`docs/OPEN_ISSUES.md` O1）。
