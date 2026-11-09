# 光层烘焙 · 三块单层差表（第 0 步）

> 2026-11-09 · 分支 `feat/light-bake`（HEAD `d1b5bd3`，与 `main` / `origin/main` 同点）· 工作区干净
>
> **本轮一行代码没动**：没有 `?bake=light-*` 开关、没有起服务、没有新截图。
> 口径按已定死的四条执行（三轴版本向量 / 连续量走 alpha / 双缓冲 / 每块先单层量差），本表一条不改。
> 本表是**盘点 + 判据表**，不是验收证据：「烘前/烘后」三行**全部未量**，原因与量法写在第三节。

## 1. 条数与落点【测】

读数源：`world-client/tmp/budget-map/{noon,dusk,night}.json`（`Oracle.debugCommandMap()`，2026-11-09 探针）。
口径：1010×700 / `?world=dengchao&time=<phase>&debug=1&now=1075` / 推到 18:10 / 潮位钉 1 / 晴 /
氛围隐藏 / 三支动态关 / `frame≈160`。三份 `errors` 均为 0。

| 块 | 对象 | depth | noon | dusk | night | 备注 |
|---|---|---|---:|---:|---:|---|
| 灯压暗环 | `root.19` | 700 | 16 | **3,078** | **3,078** | 1 张 Graphics，`lampLight` |
| 地面光池 | `root.12` | 3.2 | 0 | **2,552** | **2,552** | 1 张 Graphics，`lampPool` |
| 灯体 + 灯绳 | `lampRows`（按落地行分散） | `sceneryDepth(row, altitude)` | — | **1,472**（给定） | — | 与 `stallRows` / `bannerRows` 共层 |
| **合计** | | | | **7,102** | | 只在灯亮帧成立 |

三条必须说清的：

1. **3,078 不是「只有压暗环」**。`root.19` 是整张 `lampLight`：三档 `ink` 压暗环 + 灯体光晕/灯芯 +
   桥灯亮灭两态 + 店面窗光（见 `setting-scenery.ts` 的 `update()` 里 `lampLight` 那一段）。
   「每块先单层量差」之前得先决定这一层
   是整块烘还是按内容切开，否则「单层」指的不是一块。
2. **1,472 在逐对象读数里没有单独成组**。`lampRows` 按落地行建 Graphics，与摊位、幌布同用
   `sceneryDepth(row, altitude)`；13xx–14xx 段 12 个 Graphics 混着别人的内容，本表不替它凑数。
   实现时用 `__layerCmds`（建筑烘焙那套）单列，才有可核验的 1,472。
3. **读数是建筑烘焙工作期的旧构建**。建筑烘焙只改 `render/buildings.ts`，没碰 `setting-scenery.ts`，
   所以三块条数在 main 上应仍成立 —— 这是【推断】，**未在同一构建复测**，别当现测。
   另外 `34,037 / 34,613`（night / dusk 总量）与建筑烘焙后的 `28,076` 不是同一帧、同一构建，
   **不许相减**（B4：读数按记录器同源）。

## 2. 输入轴与 alpha 构成【测】

来源 `world-client/src/render/setting-scenery.ts:914–918`；`update()` 开头 5 个 `clear()` 说明三块**每帧整层重画**。

| 块 | 离散输入 | 连续输入 | alpha 写法 | 几何随帧变 |
|---|---|---|---|---|
| 灯压暗环 | `lit`、`localShade` | 逐灯 `brightness`（ignite / breathe）、`sway` 1px、`level` 潮位 | `ring.alpha × amount`（0.20 / 0.13 / 0.08）；光晕 `0.13 + level×0.02`、灯芯 `0.95 × amount`、窗光 0.20 / 0.10 | 是（`sway.dx/dy`） |
| 地面光池 | `lit` | 潮位 `level`（同时改半径与强度）、逐灯 `brightness` → `gain` | `band.alpha × gain` 逐圈；`fillEllipse` 半径由 `lampPoolBands(level)` 连续算 | 是（半径随潮位） |
| 灯体 + 灯绳 | `lit`、`motion.sway` 开关 | `sway` 1px（灯绳只中段）、`brightness` | 灯绳 `trim` α0.55 + `timberDark` **α1**；灯体亮 / 灭两态 | 是（1px 摆） |

**版本向量三轴已定死：「亮/灭 × 潮位 × 相位」**（交接口径）。仓内可检索到的旧实现是 HD-2D P2
留下的**两轴** `(terrainVersion, structuresVersion)`（`docs/investigations/HD2D_P2_TILT_BAKE_NEGATIVE.md:40`），
不是本线要用的那三轴。按上表：`lit` 与 `phase` 直接是两轴；**潮位 `level` 是连续量**（0..1，
`lampPoolBands(level)` 连续改半径与强度），进版本向量就意味着**必须先离散成档**，否则每帧潮位都变、
纹理每帧重烘，双缓冲 `a`/`b` 就失去意义 —— 这是动代码前要补的最后一条口径，本表不替你定档数。
呼吸 / 亮度 / `sway` 一律走 `Image.alpha` 与 `setPosition`，**不进闭包、不烘进纹理**；
双缓冲新烘完才换指针，不许 `remove` 掉还在用的纹理。

## 3. 差表【测】2026-11-09 实测：三块全部留活

### 3.1 口径

- **装置**：`?bake=shade|pool|body|bodySorted` 一次只开一块；另设 `none`（自校验）与
  `blank`（空层对照）。`bodySorted` 与 `body` 同样烘 `lampRows`，但把 Image 用
  `scene.children.moveTo` 插回原 Graphics 的 displayList 索引，恢复**同 depth 渲染顺序**，
  用来分离「保序问题」与「α 叠色本质差」这两种成因。
- **触发时机**：冻世界 / 钉潮位 1 / 晴 / 氛围隐藏 / 三支动态关 → 200 帧沉降 → 显式置
  `window.__LIGHT_BAKE_NOW__` → 再推进 2 帧。**不在第一次 `update()` 烘**（那时 debug 设置未生效）。
- **图**：1010×700 视口下 canvas clip（960×640）；`shotStable` 连续 8 帧一致才截。
- **基线**：产品代码未改时抓 `before-none.png`，sha256 前 16 位 `ba55dd0ad14d4532`
  —— 与建筑烘焙 `tmp/building-bake/bisect` 的基线**同哈希**，口径同源。
- **比对**：浏览器内解码 PNG，逐像素取 RGBA 四通道最大差；`count` = 非零差像素数，`max` = 最大色阶差。
- **烘法**：把该块当帧 Graphics 的 `commandBuffer` 用 `generateTexture` 烘成 **1024×768** 全图纹理
  （设定集 64×48 格 × 16px），贴回同一 depth 的 Image，隐藏原 Graphics。与
  `buildings.ts:bakeStaticLayer` 同一条 Canvas2D 合成路径。
- **证据**：`world-client/tmp/light-bake/` 下的 before.json / after2.json / after3.json 与各配置 PNG，
  脚本 `world-client/tmp/light-bake-shots.mjs`。端口 5211 + `--strictPort`，连接前过树身份闸。
  `body` 在两次独立跑（after2 / after3）里 hash 同为 `42772f29599dcd8e`，读数可复现。

### 3.2 实测

| 配置 | 条数 | 变化像素 | 最大色阶差 | 最大差点 | 判定 |
|---|---:|---:|---:|---|---|
| `none`（自校验） | — | **0 px** | 0 | — | 装置不污染画面 |
| `blank`（全图空纹理对照） | — | **0 px** | 0 | — | 全屏透明 quad **无伪影** |
| `shade` 灯压暗环（整张 `lampLight`） | 3,078 | **32,688 px** | **14** | (346,146) `[44,51,52]→[30,43,52]`；bbox (0,58,960,326) | **留活** |
| `pool` 地面光池 | 2,552 | **49,400 px** | **17** | (578,428) `[129,114,84]→[112,101,74]`；bbox (0,224,960,238) | **留活** |
| `body` 灯体 + 灯绳（Image 插到末尾） | 1,472 | **3,564 px** | **114** | (20,196) `[73,101,97]→[187,145,107]`；bbox (0,178,958,182) | **留活** |
| `bodySorted` 同上但**保序** | 1,472 | **3,452 px** | **1** | (128,178) `[131,108,81]→[130,108,81]`；bbox (0,178,958,182) | **留活** |

各配置的 `renderStats().totalCommands` 一律 **28,339**：Graphics 隐藏后 `commandBuffer` 仍被统计、
Image 记 0。**本实验不产生命令数下降，只量像素差**，别把 28,339 当成「烘完的预算」。
`after3` 里 `none` 仍为 0 diff，`body` 读数与 `after2` 逐项一致，说明加保序配置没有污染原有对照。

### 3.3 归因（差 ≠ 0 就留活，但成因要分开）

- **shade / pool**：差沿整条灯街分布（bbox 横跨 960 px，分桶散在多个 100×100 区），量级
  max **14 / 17**，与建筑烘焙「未烘层」的 α<1 叠色差同类（`back` 4,096 px/max 1、
  招牌 5,052 px/max 31，`OPEN_ISSUES.md:1293–1297`）——烘一张再叠回地面 = **两次合成**。
  **本质差，留活。**
- **body —— 两种成因已用 `bodySorted` 对照分离【测】**：
  - `body` 的 max **114** 是**完全不同的颜色**（暗青绿 → 暖橙灯笼色），来自**同 depth 渲染顺序**：
    `add.image` 默认插到 displayList 末尾，盖住了本该盖住它的东西。这是**装置引入的**。
  - `bodySorted` 把 Image 移回原 Graphics 的索引后，max **114 → 1**，剩下 3,452 px 全是 ±1
    量化差（样本 `[131,108,81]→[130,108,81]`）。**上轮「114 是保序问题」的推断已被实测证实。**
  - 剩下的 max **1** 与建筑烘焙「未烘层」的 `back`（4,096 px / max 1）**同量级、同成因**：
    烘一张再叠回地面 = **两次合成**的舍入。这是本质差，不是包围盒或顺序能消掉的。
  - **仍非 0 ⇒ 按判据仍留活。** 若将来要放宽到「容差 1 可接受」，那是改判据、要单独裁决，
    本轮口径是「差非 0 就留活」，不改。
- **作废的脏读数**：第一次跑（未显式触发、烘在第一次 `update()`）读到 shade 34,284 px/max 32、
  pool 52,716/max 18、body 5,996/max 177 —— 烘到的是错帧内容。**已作废，一切以 `after2` 为准。**

### 3.4 结论

**三块差全非 0 → 按「差非 0 就留活」，三块全部留活，本轮不烘任何一块**，7,102 条的
烘焙收益在本口径下拿不到。

**上轮留的两个岔路，第二个已经走完并关闭**：保序修复（`bodySorted`）把 body 的 max 从 114
压到 1，证明那 114 是装置问题；但 **1 仍是两次合成的舍入，不会因改成紧贴内容的包围盒纹理而变 0**
（`blank` 已证全图透明 quad 本身 0 伪影，包围盒能省的只有纹理尺寸，省不掉这一次额外合成）。
所以「改包围盒 + 重试 body」没有可期待的收益，本线到此可以**收口**。

结论只对**本装置**（全图纹理 + Canvas2D 烘一次 + 同 depth 顺序已保）成立；要翻案只有两条路，
都要单独裁决而不是调参：**改判据**（允许容差 ≥1）或**换合成路径**（不走 `generateTexture` 再贴回）。
本轮都没做。

## 4. 命令数差【算】

- 灯亮帧：三块全烘，`renderStats` 减 **7,102** 条；`Image +N` / `Graphics −N`，Image 在 `renderStats` 记 0
  —— 与建筑烘焙 `OPEN_ISSUES.md:1285` 同义：是「从统计里消失」，不是 GPU 少画 7,102 个 quad。
- 灯灭帧（noon）：`lampLight` 只剩 16、`lampPool` 为 0，**省不到 7,102**。所以只能写成
  「灯亮帧的存量」，不能写成「峰值下降 7,102」。
- 预算余量：建筑烘焙后 `check-ground-shadow` 余量 **6,590**（28,076 / 天花板 34,666）、债务 0；
  `check-render-budget` 25,167 / 债务 0。这两个数与本表的 7,102 **不同源、不相减**。
- **本轮实测装置不产生命令数下降**（各配置一律 28,339，见 §3.2）。上面两条是「若最终实现
  真把三块烘掉」的推算，不是本轮读数。

## 5. 装置状态与复跑

- **装置已撤（2026-11-09 收口）**：`setting-scenery.ts` 已用 `git restore --source=HEAD`
  恢复到 `d1b5bd3`，对该文件的 `git diff` 为空，产品代码回到交接起点。原 +83 行装置完整导出为
  `world-client/tmp/light-bake/light-bake-experiment.patch`（104 行，`git apply` 可原样重放）。
  它只服务于量差，**不是**三轴版本向量 / 连续量 alpha / 双缓冲 `a`-`b` 那套最终实现；
  `bodySorted` 只是归因用的对照配置。装置缺省时画面 0 diff 已由 `none` 自校验钉住。
- **复跑前置条件**：装置已不在代码里，直接跑脚本会读不到 `?bake=` 开关、得到全 0 的**假绿**。
  必须先 `git apply` 那份 patch，跑完再 `git restore --source=HEAD` 撤掉。
- 复跑（端口 5210–5299 + `--strictPort`；取改造前对照用 `git show HEAD:<path>` 导出，
  **不开 worktree、不用 stash**，W2 纪律）：

```bash
cd world-client
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run dev -- --port 5211 --strictPort
# 阶段 A：装置未装时抓改造前基线
LABEL=before CFGS=none PIXEL_WORLD_URL=http://127.0.0.1:5211/ node tmp/light-bake-shots.mjs
# 阶段 B：装上装置，逐块量
git apply tmp/light-bake/light-bake-experiment.patch
LABEL=after CFGS=none,shade,pool,body,bodySorted,blank PIXEL_WORLD_URL=http://127.0.0.1:5211/ node tmp/light-bake-shots.mjs
```

- 本轮**只做了单层量差**。handoff 判据里的「两道闸前后读数 / 49 帧逐字节 0 /
  18:00 点灯与 05:00 熄灯前后各 5 分钟 / Image 四边 alpha=0 断言」属于**实现后的验收**；
  三块都留活 ⇒ 本轮没有实现可验，这四项未做，不是遗漏。
