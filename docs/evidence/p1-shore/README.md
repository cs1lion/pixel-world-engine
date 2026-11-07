# P1 岸线带证据（p1-shore）

- 日期：2026-11-07
- 分支：`feat/shore-band`，基点 `f1dfa00`（`origin/main`）
- 判据与设计：[docs/P1_SHORE_BAND_DESIGN.md](../../P1_SHORE_BAND_DESIGN.md)
- 实现：`world-client/src/render/shore-band.ts`、`world-client/src/render/tilemap.ts`、
  `world-client/src/settings/{types,load}.ts`、`world-client/src/settings/dengchao/pack.ts`
- 测试：[world-client/test/shore-band.test.ts](../../../world-client/test/shore-band.test.ts)
- 实现提交：`53c3d300885d9ab3546203fe554a15b26b40fbc4`

## 0. 文件清单

本目录递归 **19 个文件**（含本 README 与 2 张 4× 裁剪），实测命令：
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
而本分支的证据 README 没有 delivery 块（`docs/agents/reporting.md` 也不在本分支），
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
