# P1 岸线带：判据与反向用例（设计稿）

> 状态：**设计稿，尚未写实现**。第二轮才给红→绿读数、像素差与预算差值。
> 基线：`feat/shore-band`，基点 `origin/main` = f1dfa00（2026-11-07 01:47:43 +0800，
> 合并提交 #29 feat/anim-fsm-render）。
> 纪律：不 push、不开 PR、不碰 `eval/screens`。

## 1. 基线与相位冲突判定（实测）

新建工作树与基点：

```
$ git -C D:\project\pwe-world-expand worktree add -b feat/shore-band D:\project\pwe-p1-shore origin/main
Preparing worktree (new branch 'feat/shore-band')
HEAD is now at f1dfa00 Merge pull request #29 from cs1lion/feat/anim-fsm-render

$ git -C D:\project\pwe-p1-shore rev-parse HEAD
f1dfa000665d193e2b3b0ab08ddfe88a3040fc45
```

动画 FSM 的现状：

- `feat/anim-fsm-render` 已在 main 里（上面那行 `f1dfa00` 就是它的合并提交）；
  `git diff --name-only origin/main...feat/anim-fsm-render` 输出为空。
- 仍在飞的 `feat/animation-express` 改动面：

```
README.md
docs/evidence/animation-express/*
docs/evidence/scene-motion/README.md
world-client/eval/live/*, world-client/eval/screens/*
world-client/package.json
world-client/scripts/anim-express-probe.ts, check-*.mjs, compare-ledger.mjs, lib/*
world-client/src/render/villager-face.ts, villager-frames.ts, villager-layout.ts,
                       villager-transition.ts, villager.ts
world-client/src/scenes/SandboxScene.ts
world-client/test/anim-express*.test.ts
```

P1 计划改动面（本轮设计，不含实现）：

```
world-client/src/render/shore-band.ts      （新建，纯函数，无 Phaser）
world-client/src/render/tilemap.ts         （接线：drawTerrain 末尾）
world-client/src/settings/types.ts         （SettingShore 类型）
world-client/src/settings/load.ts          （装载期 token/数值校验）
world-client/src/settings/dengchao/pack.ts （数据：岸型）
world-client/test/shore-band.test.ts       （新建）
docs/P1_SHORE_BAND_DESIGN.md               （本文件）
```

**交集：无。** 语义上也无相位冲突：岸带属于地形烘焙（开局画一次，静态贴图），
不参与逐帧；动画 FSM 只管角色表现与相位时钟，两边没有共享时钟或共享可变状态。
`SandboxScene.ts` 不需要改——`drawTerrain` 已经拿到 `this.pack ?? undefined` 作为
theme 参数（`SandboxScene.ts:793`），岸型从 pack 进来即可。
边界：本轮岸带**不跟随潮位重烘**（那会碰到 tide-view 的重烘节流，属于另一条线），
详见 3.3 的范围声明。

## 2. 参考依据：每条选择指到页，或标「自定」

已目视页的位置按**书页号 + 格号**写，页码取自页面页脚：

| # | 设计选择 | 依据（已目视页的具体位置） | 类型 |
| --- | --- | --- | --- |
| 1 | 岸带只压**陆侧**，水面内绘制像素为 0 | 书页 167 上部第 4 格（夜沼：水在左、泥岸在右，角色走在岸上）；书页 67 上部第 3 格（左下浅水与草岸）；书页 91 主图下部红栏桥旁水面 | 目视 |
| 2 | **水面不描边**：水陆交界不画比水面更亮的线 | 同上三处：交界只由陆侧的草/泥/石色压出，水面本身没有亮边 | 目视 |
| 3 | 岸线按**四邻接**枚举，对角接触不算岸 | 书里的岸是连续缓弯，没有网格语义可证 | 自定（书里无对应） |
| 4 | 直岸紧贴水边，k 格连续 = `k × TILE_PX` | 书里岸线是手绘曲线，没有像素整数格约定 | 自定（书里无对应） |
| 5 | 收进：岸带从水边向陆侧退 `insetPx` | 书里没有可分离出「退台岸带」的页 | 自定（书里无对应） |
| 6 | 材质只用仓库现有 24 色 token | 仓库预算（不引入第 25 色），参考库不提供色板 | 工程约束 |
| 7 | 8 个空格组合（`dawn×水边`、`dawn×山道`、`night×山道` 等） | **参考库里没有这些格**；只能按 KB 要点 4/7 推，本文件不声称有参考依据 | 明确无参考 |

第 7 条写在这里是为了防止下一轮把「引擎默认几何」说成「书里有」。
P1 不填那 8 个空格，也不为它们提供任何「已目视」声明。

## 3. 判据清单

### 3.1 J1 水陆邻接边查询

**契约**：给一片水、一片陆，枚举出所有四邻接边。一条边 = 水格与陆格共享的一条边；
`side` 从**陆格**看水在哪一侧（`north` 表示水在陆格北面，岸带画在陆格北沿）。
每条边只出现一次；输出顺序确定（先按陆格 y、再 x，再 north/east/south/west）。

**断言**：

1. 与独立暴力计数一致：`edges.length === Σ(每个水格的四邻中属于陆集合的个数)`。
2. 无重复：`water→land` 键集合大小等于边数。
3. 每条边的坐标满足 side 映射：`north` 时 `water.y === land.y - 1` 且 `water.x === land.x`，其余三侧同理。
4. 网格适配器与显式集合输入给出同一结果（同一 12×8 夹具对比）。

**退化形状（每个都写成固定断言）**：

| 夹具 | 形状 | 期望 |
| --- | --- | --- |
| D1 单格接触 | 水 `(0,0)`、陆 `(0,1)`，其余为空 | 1 条，side = `north` |
| D2 对角接触 | 水 `(0,0)`、陆 `(1,1)`，其余为空 | 0 条（四邻接，不含对角） |
| D3 环形水 | 5×5：外圈陆、中间 3×3 环为水、中心 `(2,2)` 为陆 | 16 条 = 内圈 4（中心四侧）+ 外圈 12（四条边各 3；四个外角只对角接触，贡献 0） |
| D4 单侧整排 | 水 2×1、陆 2×1，整边相接 | 2 条，同 side |

### 3.2 J2 岸型参数化到数据层

- 引擎预设（查表，不是分支）：`straight → insetPx 0`、`inset → insetPx 2`。
- 数据形状：`SettingShore { style, depthPx, token, alpha }`，写进 `SettingPack.shore?`
  的槽位；灯潮界（dengchao）数据显式选一种岸型，旧设定集不写就**不画岸带**。
- 绘制函数只吃解析后的数字（`depthPx` / `insetPx` / 颜色 / alpha），
  **不接收 `style` 字符串**，因此没有 `if (style === ...)` 这类写死分支。
- 装载期校验：`token` 必须落在 24 色 token 表内；数值交给纯函数守卫
  （守卫在生成器里，不在调用方：缺参/越界当场抛）。

**断言**：

1. 两种预设对同一段岸给出的矩形在垂直于岸的方向上正好相差 `insetPx` 像素。
2. 改数据 `style` 会改变矩形（直岸 0、收进 2），证明选择来自数据而不是渲染层写死。
3. 旧设定集 `shore` 缺席 → 矩形列表为空（不画），莞尔镇路径不变。
4. 源码检查：shore-band 模块的绘制函数里 `kind ===` / `style ===` 命中 0。

### 3.3 J3 像素不侵入水面

**检查器**：把每个矩形的每个像素（半开区间 `[x, x+w)`、`[y, y+h)`）映射回格子坐标，
若该格在水集合里就计数。判据是**计数必须为 0**，而不是「肉眼看着没进水」。

**断言**：

1. 直岸 / 收进 × `depthPx ∈ {1,2,4}` × `insetPx ∈ {0,2}`，在上述 D1–D4 与一段
   4 格直岸上，入水像素计数全为 0。
2. 结构断言（更强）：每个矩形的四个边界都落在它声明的陆格内，
   即矩形像素所属格子全部是陆格。
3. 第二轮的端到端版本：六钉截图的前后差异像素映射回网格，
   **任何落在浅滩格内的差异像素 = 失败**（把口径从「生成的矩形」推到「真实像素」）。

**范围声明**：水位/潮汐是动态的（`isFloodedAt` 会把涨潮淹没的草地也算水），
本轮岸带只按**地形浅滩**（`terrain === 'shallow'`）求岸，不跟随潮位重烘；
潮汐侧的泡沫线仍归 tide-view。**不声称「任意潮位自动跟随」**。
为什么「水」只能用地形浅滩、不能用 `isFloodedAt`，见 3.3.1 的实测结论。

### 3.3.1 潮位改不改水/陆格分类：结论（实测，2026-11-07）

**不改。** `TileCell.terrain` 不随潮位变化；潮位只写 `WorldGrid.tideLevel`，进而改
`isFloodedAt(p)` 这个**动态谓词**，以及 `render/tide-view.ts` 的水幕/泡沫。

代码事实（已读源码）：

- `world/tide.ts` 的 `TERRAIN_WATER_CLEARANCE` 是静态表，`isFlooded(terrain, level)`
  只是 `level > clearance`（严格大于）；
- `world/grid.ts` 的 `setTideLevel` 只写 `this.tideLevel`；`isFloodedAt` 每次现算，
  不写回任何格子的 `terrain`。

实测读数（灯潮界 64×48，`buildSettingWorld` 后逐格读，原样抄自运行输出）：

```
{ "width": 64, "height": 48,
  "shallowCells": 790,
  "floodedAt0": 0,
  "floodedAt1": 2343,
  "floodedTerrainsAt1": ["coal", "grass", "mud", "shallow", "tree"],
  "terrainArrayIdenticalAcrossTide": true,
  "isFloodedShallow0": false,
  "isFloodedShallow1": true,
  "isFloodedGrass031": true,
  "isFloodedPlaza1": false }
```

**对 J3 的含义（按这个写，否则判据会假）**：

1. J3 的「水」定义只能是**地形浅滩**（`terrain === 'shallow'`，灯潮界 790 格），
   不能是 `isFloodedAt`：用后者，低潮时水集合为空（0 格），判据空转；高潮时
   2343 格（含草地/农田/泥地/林地）都算水，岸带必然「入水」。
2. 在这个定义下，岸带按浅滩求边、只画在陆格内，**任何潮位都成立**。
3. 但**画面上**的高潮水线会向陆侧扩张，并盖住岸带（tide-view 在岸带之上，
   `TIDE_DEPTH` 高于地形烘焙）。这不是 J3 失败，是本轮的范围声明：岸带是静态
   烘焙，不跟随潮位重烘。第二轮必须拍一张**满潮**六钉截图作为证据，并注明
   哪些岸带段被水幕覆盖、哪些（石板/广场，`plaza/stone` 满潮也不淹，实测
   `isFlooded('plaza',1) === false`）仍然可见。

### 3.4 J4 直岸 k 格连续 = k × TILE_PX

- 连续的判定：同一 side、陆格坐标在岸线方向上逐格相连；断一格就拆成两段。
- 断言：k = 1..6 的直岸段，`lengthPx === k × 16`，且 `lengthPx % 16 === 0`。
- 反向夹具：3 格 + 空 1 格 + 1 格，必须是两段（3×16 与 1×16），不能读成 4 格连续。
- 收进段同样保持 `k × 16`（只在垂直于岸的方向退 2px），这条是附带保证。

### 3.5 J5 渲染预算

- 基线**不得复用**提案里的 15515 指令 / 28 Graphics（那是推断读数）；
  第二轮先在基点 f1dfa00 上复跑 `npm run test:render-budget` 取实测。
- 改后同命令、同地图、同六钉条件复跑，记录：
  - Graphics 数量与峰值指令数；
  - 差值：Graphics 期望 **0**（岸带画进 `drawTerrain` 已有的 target Graphics，
    不新建对象）；指令差值 = 岸带段数 × 每段 fillRect 次数（段数由测试打印）。
- 硬闸：Graphics < 40、指令 < 30000；差值只报告，不拿「没超」当「没成本」。

### 3.6 像素 → 格子：DPR、zoom、scroll、canvas 偏移（第二轮新增）

截图上的「每格 16px」是**世界像素**，不是截图像素。灯潮界的实际链路是：

1. 相机 `cameraZoom`（本轮六钉推到 2；作者包默认 1）：1 世界像素 → `cameraZoom` 逻辑画布像素；
2. 画布显示：`scale.zoom = 2`（`src/main.ts` 的 `scale` 配置），即
   `canvasScale = canvasRect.width / canvas.width`（480×320 → 960×640）；
3. 设备像素：`deviceScaleFactor`（Playwright 默认 1；本轮六钉口径实测 1）；
4. 截图原点：元素截图实测是 **961×641**，而画布盒是 960×640：
   Playwright 对 `rect.x=25.5` 这类半像素位置做了取整，画布内容在截图里
   从 **(1,1)** 开始。偏移不能写死，按每张图的 `getBoundingClientRect()`
   与截图尺寸实测；本轮两张六钉都落在 (1,1)。

公式（`origin` 是**视野左上角**，不是 `scroll`；与 `render/camera-math.ts` 的
`viewOriginOf` 同式）：

```
originX = scrollX + cameraWidth/2 - cameraWidth/(2*cameraZoom)
originY = scrollY + cameraHeight/2 - cameraHeight/(2*cameraZoom)
cssX    = (worldX - originX) * cameraZoom * canvasScale
deviceX = cssX * deviceScaleFactor + offsetX * deviceScaleFactor
```

格子矩形（格坐标 → 设备像素）：

```
deviceX = (cell.x*16 - originX) * cameraZoom * canvasScale * dpr + offsetX*dpr
deviceY = (cell.y*16 - originY) * cameraZoom * canvasScale * dpr + offsetY*dpr
deviceW = 16 * cameraZoom * canvasScale * dpr     // 本轮六钉 = 16*2*2*1 = 64
```

**校准点（单测里钉死）**：`scroll=(240,160)`、`camera=480×320`、`zoom=2`、
`canvas=960×640`、`game=480×320`、`dpr=1`、`offset=(0,0)` →
`origin=(360,240)`；格 `(23,16)` 左上角 = `(32,64)`，尺寸 `64×64`；
`dpr=2` 且 `offset=(1,1)` 时左上角 = `(66,130)`，尺寸 `128×128`。
反向：设备 `(95,127)` → 格 `(23,16)`，`(96,128)` → `(24,17)`（半开区间）。

**本轮六钉实测（不是假设）**：灯潮界作者包开局相机 `zoom=1`（`zoomIndex:0`），
六钉抓拍用滚轮推到 `zoom=2` 后记录：

```
camera: scroll=(560,88) width=480 height=320 zoom=2 → worldView=(680,168)
canvas: rect=960×640，buffer=480×320，dpr=1
截图:   961×641 → 内容 offset=(1,1)
一格 = 16 × zoom(2) × canvasScale(2) × dpr(1) = 64 设备像素
```

校准：设备 `(1,297)` → css `(0,296)` → world `(680,242)` → 格 `(42,15)`，
该格 `terrain === 'stone'`（陆地，非浅滩）。改后差异的 bbox
`[1,297,960,308]` 与按上式的正解逐像素对齐。**若沿用「每格 16px」会差 4 倍**。

**端到端掩膜**：六钉差异掩膜的每个像素先按上式反解成格坐标，再判
「是否落在 `terrain === 'shallow'` 的格」。截图前必须记录
`Oracle.camera()` 的 `scrollX/scrollY/width/height/zoom`、`canvas.getBoundingClientRect()`、
`window.devicePixelRatio`；任何一项缺省，掩膜判据作废（宁可判「未验证」，不判绿）。

**口径限制**：结构断言只在 `deviceScaleFactor=1` 时按上面的整数读数成立；
换成 `dpr=2` 必须按公式重算，不能复用「每格 64px」。

## 4. 反向用例设计（故意越界必须红）

| # | 故意做错什么 | 期望的红 |
| --- | --- | --- |
| M1 | 把北岸带矩形整体上移 1px（`y -= 1`） | J3 检查器报告入水像素 ≥ 1 |
| M2 | 把岸带向东多画 1px，越过陆格边界进入水格 | J3 检查器报告入水像素 ≥ 1 |
| M3 | `depthPx = 0`；`insetPx = -1`；`depthPx + insetPx = 17` | 纯函数当场抛，错误文案点名参数（`depthPx` / `insetPx`） |
| M4 | 把 4 格连续段拆成 3 格 + 空 1px + 1 格 | J4 连续/长度断言红（不是 64） |
| M5 | 数据 `style` 从直岸改成收进 | 矩形沿垂直于岸方向差 2px（证明数据驱动；若仍相同则 J2 红） |
| M6 | 从灯潮界数据里删掉 `shore` | 矩形列表为空；同时确认旧设定集画面不动 |
| M7（第二轮） | 真实截图里岸带像素落进浅滩格 | 端到端差异检查红（3.3 第 3 条） |

M1/M2 的意义：**先证明检查器会红**，再用它来判「0 像素」；
只有绿的正向用例说明不了检查器是否真的在看。

### 4.1 验收（第二轮必须逐条给读数，缺一条不算完成）

| # | 验收 | 读数 |
| --- | --- | --- |
| A1 | **默认世界真的用上 `shore`**：`dengchao` 数据里配了 `shore`，六钉截图与改前**差异非零** | 差异像素数与 bbox（设备像素），并按 3.6 反解：差异必须只落在陆格 |
| A2 | **反向：删掉该配置 → 画面逐字节回到改前**（M6 升格为验收，不再只是反向用例） | 两份截图的 sha256 相同（逐字节），且差异像素数 = 0、bbox = 空 |
| A3 | **满潮证据**（3.3.1 第 3 条） | 一张满潮六钉截图；注明哪些岸带段被水幕覆盖、哪些（`plaza/stone`）仍可见；不声称岸带跟随潮位 |
| A4 | 预算改前/改后都在基点 f1dfa00 上**实测**，不沿用旧数 | Graphics 差值与指令差值（段数由测试打印） |

A1 是这条线的老毛病：只有「旧设定集不配就不画」的向后兼容，等于交付一段
永远不执行的代码。A2 是它的反面证明——这份画面差异确实来自这一项配置，
不是别处的改动。

## 5. 先红后实现（顺序不能反）

1. 先只提交测试文件（`world-client/test/shore-band.test.ts`）与本设计稿；测试用动态 import +
   `typeof` 断言，模块不存在时红在**断言**，不是 module-not-found。
2. 跑 `npm run red:first -- --base f1dfa00`，必须看到 `RESULT=RED`，
   且失败类型是 AssertionError，至少包含：
   - 「render/shore-band.ts 必须导出 waterLandEdges」；
   - 「灯潮界数据必须有 `shore`」；
   - 「潮位不改地形分类」的实测用例（这条在基点上应当绿，作为 J3 定义的前提）。
3. 再实现 render/shore-band.ts（新建）、接线、数据与装载校验；红转绿。
4. 第二轮报告：红→绿读数、六钉截图差（差异必须只在陆格）、预算改前改后差值、
   A1/A2/A3 的读数。

停止条件：若红不是断言红（编译/import 类），停手改测试，不进入实现。
