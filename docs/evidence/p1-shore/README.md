# P1 岸线带证据（p1-shore）

- 日期：2026-11-07
- 分支：`feat/shore-band`，基点 `f1dfa00`（`origin/main`）
- 判据与设计：[docs/P1_SHORE_BAND_DESIGN.md](../../P1_SHORE_BAND_DESIGN.md)
- 实现：`world-client/src/render/shore-band.ts`、`world-client/src/render/tilemap.ts`、
  `world-client/src/settings/{types,load}.ts`、`world-client/src/settings/dengchao/pack.ts`
- 测试：[world-client/test/shore-band.test.ts](../../../world-client/test/shore-band.test.ts)
- 实现提交（v1）：`53c3d300885d9ab3546203fe554a15b26b40fbc4`
- 拐角修复提交（v3）：`5c0258bd01eea10842d4fd02c9a7cbcfa690ec4f`

> 本文件 §0–§5 是 v1（`53c3d30`）的口径，保留作历史；v3（`5c0258b`）的拐角修复、
> 不变量覆盖、融合复测与合并前检查清单一律追加在 §6。两套读数不要混用。

## 0. 文件清单

本目录递归 **28 个文件**（含本 README；v1 的 19 个 + §6 的 9 张 v3 产物），实测命令：
`Get-ChildItem -Recurse -File docs/evidence/p1-shore | Measure-Object`。

| 路径 | 内容 |
| --- | --- |
| `base/` | 改前（`f1dfa00`）六钉截图与 `runs.json`（相机 / dpr / 统计 / pinned 状态） |
| `head/` | 改后（`53c3d30`）同名六钉 |
| `noshore/` | 改后但删掉 `dengchao.shore` 配置的同名六钉（A2 反向验收） |
| `diff/screens-diff.json` | `base` vs `head`：sha256、exact/visible、连通区、bbox、位移搜索 |
| `diff/noshore-vs-head.json` | `noshore` vs `head`，用于证明 `noshore` 的 sha 与 `base` 相同 |
| `diff/masks/*.png` | 差异掩膜（差异像素染成品红 `255,0,255`） |
| `mask-check.json` | 掩膜像素按 §3.6 公式反解到格：`waterCellPixels` 与校准点 |
| `crops/noon-{low,high}-4x.png` | 岸段 `x42..57` 的 4× 观感对照（见 §2.1） |
| `v3/` | 拐角修复后的 4× 裁剪、直岸 4×、宽幅融合图与六钉整幅（9 张，见 §6.5） |

六钉口径不变：`nowMs=43200000`（noon）、`tideLevel` 钉在 0 / 1、7 位村民 frame 0、
`pinTrails([])`、`pinWeather(0,0)`、世界钟冻结、压暗层 `waitFadeSettled`、canvas-only。
潮位用 `Oracle.say('潮位 0%' / '潮位 100%')` 写入 grid，再冻结快照。

## 1. 三条补充的结论

### 1.1 潮位不改水/陆格分类（实测）

结论：**地形分类是静态的，`setTideLevel` 只写 `tideLevel`，不回写 `grid.terrain`。**
灯潮界 64×48 = 3072 格实测：

```
shallowCells              = 790
floodedAtTide0            = 0
floodedAtTide1            = 2343
floodedTerrainsAtTide1    = coal, grass, mud, shallow, tree
terrainArrayIdenticalAcrossTide = true
isFlooded('plaza', 1)     = false
```

因此：

- **J3 的「水」只能定义为 `terrain === 'shallow'`**（永久水，790 格）。
  若改用 `isFloodedAt`，低潮时是空集（查不出东西），满潮时把 2343 格陆地都算成水，
  「零入水」既没意义又必假。
- 固定岸带跟地形走是自洽的：岸带画在 `terrain === 'shallow'` 的邻边上，
  潮位抬升不改这条边的位置。
- 满潮时水幕会盖到岸带的两端（草地格 56/57，见 §2 的 `floodedLandCells`），
  但石板段 42..55 不被淹；这不是岸带越界，是潮汐层叠在它上面。

设计稿 §3.3.1 收录了同一组读数。

### 1.2 默认世界必须真配上 `shore`（A1/A2）

`dengchao` 的设定集写入：

```ts
shore: { style: 'inset', depthPx: 3, token: 'water', alpha: 0.5 },
```

形制标注为「自定（书里无对应）」：书里的 12 个已目视格没有岸带画法，
这里只借「湿色带比水线厚」的读法，不声称有参考位置。

- **A1 正向**：`head` 与 `base` 的六钉差异非零，读数见 §2。
- **A2 反向**：删掉 `shore` 后，`noshore` 与 `base` **逐字节相同**：
  - low `9e8bb941464fdfb92f8c04e0f5842447c14d08f2388032e8a451aa93281e8d6d`（13876 B）
  - high `10c21cd5b5df3f822ba954203e5b662f9b8293c62f4475f604512496e18df872`（14068 B）

  `diff/noshore-vs-head.json` 里 `noshore` 的 `oldSha256` 与 `base` 的同名图一致；
  相对 `head` 仍是 11520 / 10400 的差异，说明差异全部来自 `shore` 这一段配置。

### 1.3 像素 → 格子：DPR、zoom、scroll、canvas 偏移

公式（`origin` 是视野左上角，与 `render/camera-math.ts` 的 `viewOriginOf` 同式）：

```
originX = scrollX + cameraWidth/2  - cameraWidth /(2*cameraZoom)
originY = scrollY + cameraHeight/2 - cameraHeight/(2*cameraZoom)
cssX    = (cell.x*16 - originX) * cameraZoom * canvasScale
cssY    = (cell.y*16 - originY) * cameraZoom * canvasScale
deviceX = cssX * dpr + offsetX*dpr
deviceY = cssY * dpr + offsetY*dpr
deviceW = 16 * cameraZoom * canvasScale * dpr
```

本轮六钉实测（来自 `base/runs.json` / `head/runs.json`，不是假设）：

```
camera:  scroll=(560,88) width=480 height=320 zoom=2 → worldView=(680,168)
canvas:  rect=960×640，buffer=480×320，dpr=1
截图:    961×641 → 内容 offset=(1,1)
一格   = 16 × zoom(2) × canvasScale(2) × dpr(1) = 64 设备像素
```

**校准点**：设备 `(1,297)` → css `(0,296)` → world `(680,242)` → 格 `(42,15)`，
该格 `terrain === 'stone'`。改后差异的 bbox `[1,297,960,308]` 与该式正解逐像素对齐。
若沿用「每格 16px」而不做 zoom/canvasScale 换算，格宽会差 4 倍。
反向半开区间也钉在单测里：设备 `(95,127)` → 格 `(23,16)`，`(96,128)` → 格 `(24,17)`；
`dpr=2` 且 `offset=(1,1)` 时，格 `(23,16)` 的左上角 = `(66,130)`、尺寸 `128×128`。

掩膜反解（`mask-check.json`）：

```
noon-low   cellsTouched = x42..57,y15（两端 384 px，中间 768 px）
noon-high  cellsTouched = 同上
waterCellPixels = 0（低潮、满潮都是 0）
calibration = device(1,297) → cell(42,15) stone
```

`cellsTouched` 里 56/57 是满潮会被水幕覆盖的草地格（`floodedLandCells`），
岸带画在它们上面与水幕叠加，不是岸带画进了水面。

## 2. 验收读数（A1–A4）

| 项 | 读数 |
| --- | --- |
| A1 低潮 exact | 11520 px（1.8701%），bbox `[1,297,960,308]`，1 个连通区（960×12） |
| A1 低潮 visible | 11520 px（1.8701%），最大色差 `#52666a → #3e5b65`，`meanAbsDiff 13.80` |
| A1 满潮 exact | 11520 px（1.8701%），bbox 同上 |
| A1 满潮 visible | 10400 px（1.6883%），2 个连通区：10368（864×12，`meanAbsDiff 14.50`）+ 32（4×8，`7.0`） |
| A1 位移搜索 | `dx=0, dy=0`（`shiftGainPct=0`），差异不是整体位移 |
| A2 删配置 | `noshore` 与 `base` sha256 逐字节相同（低 `9e8bb941…` / 满 `10c21cd5…`） |
| A3 零入水 | `waterCellPixels=0`（低潮、满潮），反解只落在 `x42..57,y15` |
| A4 换算 | 校准 `(1,297)→(42,15)`，一格 64 设备像素（16 × 2 × 2 × 1） |

满潮 visible 比 exact 少 1120 px，是因为水幕把草地格 56/57 上的岸带覆盖成同色；
`deltaHistogram`: low `ge8=11520`，high `ge8=10400`。

### 2.1 观感验收：4× 裁剪（低潮 / 满潮）

裁剪口径（设备像素，§1.3 的换算已实测）：岸段 `x42..57`，横向取可见全宽 `x0..960`；
纵向 `y281..332` = 8 px 真水面（281..288）+ 8 px inset 让出的陆侧空隙（289..296）
+ 12 px 岸带（297..308）+ 24 px 陆侧（309..332）；最近邻放大 4×，输出 `3844×208`。

| 时刻 | 文件 |
| --- | --- |
| 低潮 | `crops/noon-low-4x.png` |
| 满潮 | `crops/noon-high-4x.png` |

**读起来像什么（一句话）**：石板段（`x42..55`）读成**给水边描的一条深色带**——
上下沿完全笔直、带内是单一的水色半透明压过砖缝（`#3e5b65`），与水之间还隔着一
条 8 设备像素的浅色陆边（`#4c666c`/`#52666a`），观感是「浅边 + 深带」的双线；
草地段（`x56..57`）带色 `#2d4a55` 与草色 `#30454a` 只差 ≤11 个色阶，几乎看不见。
两段都不像草泥过渡。

**判定：② 读成描边/色带**，记入 [OPEN_ISSUES.md](../../OPEN_ISSUES.md) B9；
A1–A4 只证明几何与像素关系，不证明观感，不能拿数值全绿代替这一条。

与三处目视参考的差异（书页扫描不在仓内，对照依据是设计稿 §2 第 1 条记录的
页号 / 位置 / 描述，不是像素级比对）：

| 参考 | 差在哪 |
| --- | --- |
| 页 167 上部第 4 格（夜沼：水在左、泥岸在右，角色走在岸上） | **宽度**：参考的岸是一整块可走的泥面（以格计），我们只有 3 世界像素；**颜色层次**：参考有泥→湿泥的深浅变化，我们只有一层水色 50% 叠底；**边界**：参考被泥块打散，我们是直线。 |
| 页 67 上部第 3 格（左下浅水与草岸） | **颜色层次**：参考靠草簇与湿痕过渡，我们的带在草地上与草同色（Δ≤11 色阶），等于没有岸；**边界**：没有草簇/碎块，边界只剩整齐的格线。 |
| 页 91 主图下部红栏桥旁水面 | **边界**：参考的岸线被桥体/栏杆遮断并有阴影，我们一条直线拉满 16 格，遇砖缝只透底纹；**颜色**：单色带，无阴影变化。 |

### 2.2 `audit:reports` 对这次数字偏差的真实表现

本分支 `f1dfa00` 还没有 `audit-reports`（脚本在 `feat/stair-flight` 的 `c0cbd3c`），
借来跑一遍本仓 `docs/`：

```
audit-reports: reports=0 artifacts=0 checks=0 issues=0
audit-reports: 全部可自动核对项通过；人工检查点见 docs/agents/reporting.md
exit=0
```

它**没有**发现「18 个文件」这种偏差：这条 lint 只扫 `<!-- delivery -->` 机器可读块，
而本分支的证据 README 没有 delivery 块（报告规范文档也不在本分支），
散文里的数字不在它的输入里。缺口记入 [OPEN_ISSUES.md](../../OPEN_ISSUES.md) B8。

## 3. 红 → 绿

| 阶段 | 命令 | 读数 |
| --- | --- | --- |
| 先红（`f1dfa00` 源码 + 本次测试） | `npm run red:first -- --base f1dfa00` | `RESULT=RED`，exit=1，`AssertionError`：`render/shore-band.ts 必须导出 cellToDeviceRect`（模块缺席，红在断言而非 ERR_MODULE_NOT_FOUND），耗时 2762ms |
| 绿（岸线带单测） | `node --import ./test/phaser-hooks.mjs --test test/shore-band.test.ts` | tests 17 / pass 17 / fail 0 |
| 绿（全量） | `npm test` | tests 2480 / pass 2471 / fail 0 / skipped 9，47.3s |
| 类型 | `npm run check` | 语法 0 处 / 语义 0 处 |

## 4. 预算差值（基点实测）

| 世界 | 改前 `f1dfa00` | 改后 `53c3d30` | 差值 |
| --- | --- | --- | --- |
| 默认世界（硬闸口径） | 16163 指令 / 28 Graphics | 16163 指令 / 28 Graphics | **0 / 0** |
| 灯潮界 低潮 | 15118 指令 / 61 Graphics | 15118 指令 / 61 Graphics | **0 / 0** |
| 灯潮界 满潮 | 15286 指令 / 61 Graphics | 15286 指令 / 61 Graphics | **0 / 0** |

- 默认世界由 `npm run test:render-budget` 实测（`tmp/render-budget/render-budget-samples.json`，
  `measuredAt 2026-11-07T05:53:18Z`），三档硬闸 30000 指令未动。
- 灯潮界读数内嵌在六钉 `runs.json` 的 `stats` 字段，base/head 逐项相同。
- 差值为 0 的原因：岸带画在**既有地形烘焙 Graphics** 上（`drawTerrain` 的 `g`），
  不新建 Graphics；`fillRect` 在地形烘焙阶段执行，不进 live 峰值。
- 灯潮界 `61 Graphics` 在基点 `f1dfa00` 就已超过「40 Graphics」这条世界预算；
  该硬闸只测默认世界，本轮组件没有新增 Graphics（差 0）。

## 5. 复现

```powershell
# 先红（必须 RESULT=RED 且断言失败）
npm run red:first -- --base f1dfa00

# 绿
npm run check
npm test

# 预算
npm run test:render-budget
```

截图与掩膜是临时的 Playwright 脚本产出的，按仓库惯例不入库、跑完即删；口径如下：

1. 起 `vite`，打开 `?world=dengchao&time=noon&feed=off&ledger=off&debug=1&now=60&speed=0.1`
   并先 `localStorage.clear()`；滚轮把 `zoom` 推到 2。
2. `Oracle.say('潮位 0%' / '潮位 100%')` 写 grid，等快照潮位到位后
   `pinShotState(43200000, tide)` + `pinActors`（7 位 idle frame 0）+ `pinTrails([])` +
   `pinWeather(0,0)` + `freezeWorldClock` + `setCameraMode('free')` +
   `centerCameraOn(800,248)`，`waitFadeSettled` 后截 canvas。每次记录
   `Oracle.camera()`、`canvas.getBoundingClientRect()`、buffer 尺寸与 `dpr`（见 `runs.json`）。
3. `scripts/screens-diff.py` 出 sha256 / exact / visible / 连通区 / bbox；
   掩膜差异像素固定在 `(255,0,255)`，按 §1.3 公式反解成格，落成 `mask-check.json`。

## 6. v3 拐角修复与不变量（实现 `5c0258b`，2026-11-07 追加）

### 6.1 不变量判据（独立于实现方式，可证伪）

判据：**每条水陆边，陆侧贴水 1px 带上的每个像素 token 必须是 `steps[0].token`，
且 `steps[0]` 必须是 `soil`；拐角的两条腿各自独立成立，亮端允许被吸收或被铺装吞掉。**

实测覆盖（`J9 不变量` 用例，`world-client/test/shore-band.test.ts`）：

```
全图水陆边                      186 条
有岸型（走进同一条断言）           87 条 = 石材 72 + 草岸 15
贴水像素                        1392 px = 石材 1152 + 草岸 240
无岸型（不画带，但计入分母）        99 条 = 树 90 + 铺装 9
违规                              0 px
```

- 逐边累计断言：分组条数必须等于「有岸型」全集（87），像素数必须 = 87 × 16 = 1392；
  分组漏边或只测一类地形会直接报出分母。
- 证伪：石材、草岸各把一处贴水像素换成末段 token，同一检查器都必须报出该坐标。
- **修复前红样例（32 px）**：
  `7,9/west (112,152..159)=farm`、`7,10/west (112,160..167)=plaza`，
  `19,9/east (319,152..159)=farm`、`19,10/east (319,160..167)=plaza`。
  原因是发出顺序 `side` 先于段下标，竖带湿段被北带干段裁掉。

### 6.2 修复前后：四个拐角格的 4× 判定

拐角图口径：noon / 潮位 0 / zoom 2；每张图用各自的 `camera.worldViewX/Y`，
`device = (world − worldView) × 4 + 1`（不是六钉的 scroll）。
裁剪范围是拐角格 ±1 格（48 art px → 192 设备 px → 4× 768×768）。

| 拐角格 | 修复前竖岸湿边纵序 | 修复前断口 | 修复前判定 | 修复后（4×） | 判定 |
| --- | --- | --- | --- | --- | --- |
| `(7,9)` 北+西 | `soil 8 → farm 8 → plaza 8 → soil 8`（x=112） | 0 | ② 亮端贴水 | `soil` 连续全程；8×8 `farm` 退到内角，`plaza` 被北带吞 | ① |
| `(19,9)` 北+东 | 同上（x=319） | 0 | ② 亮端贴水 | 同上 | ① |
| `(28,14)` 北+西 | `soil 16 → farm 8 → plaza 8`（x=448） | 0 | ① | 原样，湿边全程 `soil` | ① |
| `(36,14)` 北+东 | `soil 20 → farm 8 → plaza 4`（x=591） | 0 | ① | 原样，湿边全程 `soil` | ① |

**断口 = 0（四处）** 的口径：J9 把 `pieces` 栅格化成像素 → token，逐条边取贴水带；
87 条边 1392 px 中被裁掉的 256 px **全部被另一条腿盖住**，`cover` 没有缺像素，
所以「水边漏画」为 0。4× 图只用于判「湿边第一段是不是 soil」，不用于数面积。

修复只改发出顺序：格坐标 → **段下标（湿端优先）** → side。没有新增矩形、
没有 `world === '…'` 分支、不动跨格承载；并集不变（§6.3）。

### 6.3 重叠与截断（复测）

```
stone: overlapPx 2656, truncatedPx 0, maxOverlapPx 2656（回归棘轮）
grass: overlapPx    0, truncatedPx 0, maxOverlapPx    0
反向：maxOverlapPx 2655 必须抛 `/重叠 2656 px 超过上限 2655/`
```

`2656` 是「不许变大」的棘轮，不是合格线；16 格逐格被裁面积与枚举表见设计稿 §6.4。

### 6.4 末段融合复测（修复后重拍）

`v3/wide/stone-wide.png`，相机中心 `(744,248)`、`worldView=(624,168)`、潮位 0：

```
行 15 石板段岸线：27 格 / 432 art px
融合：28 art px（6.5%），4 段，外沿全在行 16
  x 698..702（5） 格 43
  x 752..759（8） 格 47
  x 816..822（7） 格 51
  x 848..855（8） 格 53
```

融合口径：末段（`plaza`）最后一行与其正下方一行在同一像素列上都是 `plaza` 实色；
融合处只是「外边界不可见」，不算「三档通行证」，其余 404 art px 仍按三档判。
拐角修复前后这组读数逐项相同（融合与拐角不在同一段岸线）。

### 6.5 本轮落地的 9 张图（字节 + sha256）

| 文件 | bytes | sha256 |
| --- | --- | --- |
| `v3/corners/07-09-NW-3cell-4x.png` | 4323 | `c24028876c7bc64cb11f95b65ff902a1ce3e6c4bf19b8dae2a16fc0e7b323671` |
| `v3/corners/19-09-NE-3cell-4x.png` | 4275 | `342e8edd7bf233a4a7d9f84c3d5536f5c1fcd848f59eebe59b284b7e62a66727` |
| `v3/corners/28-14-NW-3cell-4x.png` | 4279 | `eabea38ae52ef5df2c81e049ea0cffb3d948ae45e2ba0d9a78148f4f3ae61029` |
| `v3/corners/36-14-NE-3cell-4x.png` | 4031 | `eb6474a49154a2fd2ec4cb3b46e6960279b70554226ae5a9be1b97c8c4009bd8` |
| `v3/straight/noon-low-stone-4x.png` | 8170 | `9f9aa412e031c001532deeb028c946ca6c766e3c3748d1a58b425b19656a6dc8` |
| `v3/straight/noon-low-grass-4x.png` | 4180 | `ff3340778f06999f85b17009749f23c71d471a9b462c847b1097399f21c117db` |
| `v3/wide/stone-wide.png` | 12129 | `f819a04df35d5fe2eb6e025c111f5871f2560bf544b41bfd47aa5145f5f2ad54` |
| `v3/head/noon-low.png` | 12041 | `2878d5c22af36b26c14f7e0edfcd868d3eb6422a3f9cd9eb82d7404c9c258567` |
| `v3/head/noon-high.png` | 12233 | `743ad2a828da2eb3af5b02b5eacb5dcf0da4d01e0e0d29d2fe4b234d41e84042` |

六张新 4× 裁剪 = 4 张拐角 + 2 张直岸（石板 / 草岸）；宽幅图用于融合统计，
两张六钉整幅是它们的原始截图。4× 均为最近邻放大，脚本按仓库惯例不入库。

### 6.6 命令与退出码

| 命令 | 读数（本次运行） | exit |
| --- | --- | --- |
| `node --import ./test/phaser-hooks.mjs --test test/shore-band.test.ts` | tests 36 / pass 36 / fail 0 | 0 |
| `npm test` | tests 2499 / pass 2490 / fail 0 / skipped 9 | 0 |
| `npm run check` | 语法 0 处 / 语义 0 处 | 0 |
| 拐角截图 `tmp/p1-shore-v3/corner.mjs` | 4 张，`errors=0` ×4，camera 各自 `worldView` 与 `runs.json` 一致 | 0 |
| 融合统计 `tmp/p1-shore-v3/fusion.py` | 27 格 / 432 art px，融合 28 art px | 0 |

实现（拐角修复）提交：`5c0258bd01eea10842d4fd02c9a7cbcfa690ec4f`（`feat/shore-band`，
本地提交，未推）。本节证据与测试紧随其后单独提交；`status.sha` 指**实现**。

### 6.7 合并前检查清单（本分支到此停，等合并窗口）

**改了哪些文件**

- `world-client/src/render/shore-band.ts`：`portions.sort` 改为 格 → 段下标 → side（+注释）。
- `world-client/test/shore-band.test.ts`：J9 不变量扩到全图 186 条边、`steps[0] === 'soil'`、石材/草岸各一证伪。
- `docs/P1_SHORE_BAND_DESIGN.md`：§6.4 / §6.5.5 / §6.10 的修复前后读数与 1392 px 口径。
- `docs/evidence/p1-shore/README.md` + `v3/` 9 张图（本节）。
- `docs/evidence/soak/witnessed-corroboration.json`：仅 mtime/行尾脏标记，blob 与 HEAD 相同
  （`b9c3214…`），已用 `git add` 清掉 stat 噪声，内容零改动。

**岸带新增矩形数（旧口径下不可见的成本）**

```
pieces 321（石材 270 + 草岸 51），每块一次 fillRect
按 token：soil 108 / farm 111 / plaza 86 / copper 16
平均每边 1.73 块（186 条水陆边）
```

- 全部写进**既有地形烘焙 Graphics**，不新建 Graphics；所以旧闸读数仍是
  `15118/15286 指令、61 Graphics`，与修复前逐项相同。
- `[推断]` 递归口径下约 **+321 条指令**，占真实峰值 **52,125** 的 **0.62%**
  （321 / 52,125，纯算术）。依据：材质线在递归统计下读出 52,125，而
  `renderStats()` 只数顶层 Graphics（楼体 99 个 / 11,090 条没进数）；
  岸带的 321 块同样在递归口径才可见。**这是「新口径待测」，不是实测值**。
- 结论：在这之前**不合并**——闸门绿只是因为只读开局帧，30,000 的硬闸已经
  被真实峰值 52,125 超了 74%；岸带的增量要等递归统计 + 两级阈值落地后再复测。

**CI 会跑哪些步骤（当前 `.github/workflows/ci.yml`）**

- `world-client`：`npm ci` → `pip install -r ../server/requirements.txt` →
  `npm run check` → `npm run audit:ports` → `npm test` →
  `red:first --base <base sha>` → `npm run build` → `audit-palette` →
  `audit-references` → `audit-citations` → `audit-sections` → `audit-claims`。
- `world-client-browser`：`playwright install` → `build` → `preview:5211` →
  `test:persistence` → `test:render-budget` → `test:phases` → `git status` 必须干净。
- `repo-harness`：`check:hooks`（安装前后各一次）、`worktrees:audit`。
- `server`：`pytest`。
- 缺口：`audit:reports --strict` **没有接入 CI**，且本分支没有该脚本
  （只在 `feat/stair-flight` 的 `c0cbd3c`）；合并后要在带该脚本的分支上补跑一次。

**与 `chore/orphan-gates` 的 `ci.yml` 是否冲突**

`Compare-Object` 比对两支的 `ci.yml`：对方相对本分支只有 **4 行新增**
（一行注释、`name: 孤儿闸门检测`、`run: npm run audit:orphan-gates`、空行），
无删除、无改写。文本上不冲突，任一先后合并都可干净 rebase；
本分支没有新增脚本，不会触发对方的孤儿清单例外。

<!-- delivery
{
  "artifacts": [
    { "path": "docs/evidence/p1-shore/v3/corners/07-09-NW-3cell-4x.png", "bytes": 4323,
      "sha256": "c24028876c7bc64cb11f95b65ff902a1ce3e6c4bf19b8dae2a16fc0e7b323671" },
    { "path": "docs/evidence/p1-shore/v3/corners/19-09-NE-3cell-4x.png", "bytes": 4275,
      "sha256": "342e8edd7bf233a4a7d9f84c3d5536f5c1fcd848f59eebe59b284b7e62a66727" },
    { "path": "docs/evidence/p1-shore/v3/corners/28-14-NW-3cell-4x.png", "bytes": 4279,
      "sha256": "eabea38ae52ef5df2c81e049ea0cffb3d948ae45e2ba0d9a78148f4f3ae61029" },
    { "path": "docs/evidence/p1-shore/v3/corners/36-14-NE-3cell-4x.png", "bytes": 4031,
      "sha256": "eb6474a49154a2fd2ec4cb3b46e6960279b70554226ae5a9be1b97c8c4009bd8" },
    { "path": "docs/evidence/p1-shore/v3/straight/noon-low-stone-4x.png", "bytes": 8170,
      "sha256": "9f9aa412e031c001532deeb028c946ca6c766e3c3748d1a58b425b19656a6dc8" },
    { "path": "docs/evidence/p1-shore/v3/straight/noon-low-grass-4x.png", "bytes": 4180,
      "sha256": "ff3340778f06999f85b17009749f23c71d471a9b462c847b1097399f21c117db" },
    { "path": "docs/evidence/p1-shore/v3/wide/stone-wide.png", "bytes": 12129,
      "sha256": "f819a04df35d5fe2eb6e025c111f5871f2560bf544b41bfd47aa5145f5f2ad54" },
    { "path": "docs/evidence/p1-shore/v3/head/noon-low.png", "bytes": 12041,
      "sha256": "2878d5c22af36b26c14f7e0edfcd868d3eb6422a3f9cd9eb82d7404c9c258567" },
    { "path": "docs/evidence/p1-shore/v3/head/noon-high.png", "bytes": 12233,
      "sha256": "743ad2a828da2eb3af5b02b5eacb5dcf0da4d01e0e0d29d2fe4b234d41e84042" }
  ],
  "checks": [
    { "name": "node --import ./test/phaser-hooks.mjs --test test/shore-band.test.ts", "exit": 0 },
    { "name": "npm test", "exit": 0 },
    { "name": "npm run check", "exit": 0 }
  ],
  "diff": {
    "method": "structure-block",
    "threshold": 0,
    "size": "768x768",
    "shots": 4,
    "scope": "四个拐角格 ±1 格 4× 裁剪；判据是贴水带缺像素数与 token 纵序，不是整屏逐字节"
  },
  "status": {
    "state": "local-commit",
    "sha": "5c0258bd01eea10842d4fd02c9a7cbcfa690ec4f",
    "branch": "feat/shore-band",
    "pushed": false,
    "pr": false
  },
  "reportedAt": "2026-11-07T18:10:00+08:00",
  "inferences": [
    { "claim": "递归口径下岸带约新增 321 条指令，占真实峰值 52,125 的 0.62%",
      "basis": "321 = 石材 270 + 草岸 51 块 piece，每块一次 fillRect；52,125 取自材质线递归实测，比例是算术，不是本次实测" },
    { "claim": "与 chore/orphan-gates 的 ci.yml 不冲突",
      "basis": "Compare-Object 比对：对方只有 4 行新增（注释、step 名、run audit:orphan-gates），无删除改写" }
  ]
}
-->

