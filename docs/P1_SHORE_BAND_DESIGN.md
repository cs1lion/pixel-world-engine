# P1 岸线带：判据与反向用例（设计稿）

> 状态：v1 已验收（判据 J1–J5）；v2（单格 8–14px）已存档并判定②；
> **v3（构件化、跨 2–3 格）为本轮新设计，尚未实装**（见 §6）。
> 第一轮：设计稿；第二轮给红→绿读数、像素差与预算差值。
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

## 6. v3 新方向：构件化岸带，跨 2–3 格（设计，未实装）

### 6.1 停掉 v2 的依据（不是目视，是实测）

单格 8–14px 路线停手，不再调宽度、不再试第三组色值。两条实测：

1. **可辨阈值**：16×16 平铺色块、4× 最近邻人工判读，ΔL* 2/3 看不见、4 极弱、
   5 能指出边界、6 稳定；对应 ΔE2000 2.96/3.50/4.08/4.88/5.53。v1 草带
   ΔL* 1.9 低于「看不见」下限，所以画面上只剩那条深带，它当然长成描边。
2. **面积**：参考页岸宽折成 22–84 art px，即 1.4–5.25 格（1× 相机下 2.7–10.5 格）。
   一格 16px 里塞三档，每档最多 4–5px，只能靠大跳色；v2 实色
   `farm→plaster` 一步 ΔE2000 42.0，结果就是「两条深带 + 一块亮沙板」。

v2 的全部改动已存档到临时分支 `experiment/p1-shore-v2-archive`，
提交 `e3868e5`（11 个文件，+790/−620），用途写明「4× 仍判定②、未验收」。
没有 stash、没有丢弃；`feat/shore-band` 上的工作树已回到基点 `b1ae013`。

### 6.2 目标形态（夜岸）

- 宽度 **24 art px**（1.5 格），跨 **2 格**落地；引擎契约允许 `depthPx` 8..48，
  即最多跨 3 格，灯潮界本轮只用 24。
- 三档冷灰全部取自现有 24 色：`soil #202b35` → `farm #3d5154` → `stone #52666a`。
  实测 L* 16.9 / 33.0 / 41.7，相邻 ΔL* 16.0 / 8.8，ΔE2000 12.85 / 7.48，
  两段都过 6 / 5.53 的稳定阈值（见 §6.5）。
- **实色平铺**：不叠 alpha、不做 dither；每一段是一块不透明矩形。
- 24 色里不新增槽位；不换 token 值。

### 6.3 数据形状（只改数据，不写分支）

沿用 §3.2 的查表思路，把「跨格」表达成数值，而不是新样式字符串：

```ts
SettingShore {
  style: ShoreStyleId;        // 仍是 straight / inset 查表，渲染函数不接字符串
  depthPx: number;            // 8..48；>16 即跨格，24 = 1.5 格
  staggerPx: number;          // 4 或 8
  staggerStep: number;        // 错位加在哪一段；v3 取最后一段
  steps: readonly { token, depthPx }[]   // 2..3 段，和 = depthPx
}
```

装载期与纯函数守卫的增量：

- `depthPx` 上界从 14 放宽到 48；下限仍 8。
- 删除「`insetPx + depthPx ≤ TILE_PX`，带子会跨出陆格」这条旧守卫，
  换成「`insetPx + depthPx + staggerPx ≤ 48`」（3 格）。
- 其余（段数 2..3、和 = `depthPx`、`staggerPx ∈ {4,8}`、`staggerStep` 下标）
  原样保留。

**不许**在渲染函数里写 `if (style === ...)`：跨格数量由 `depthPx` 推导，
每段落在哪一格也由数值推导（见 §6.4）。

### 6.4 J6 跨格承载分配

**局部横坐标 `t`**：从陆格 `L` 贴水的那条边起算，`t=0` 是水线；
`insetPx` 是让出的陆侧空隙，所以带子占 `t ∈ [inset, inset+depth)`。
每个格子的窗口是 `[k×16, (k+1)×16)`，`k=0` 就是 `L` 自己，
`k=1` 是沿「背离水」的法线方向的下一个陆格，`k=2` 再下一个。

**分配规则**：

1. 每段 `[a,b)` 与每个格窗求交集；交集长度 >0 就发一个矩形。
2. 交集在哪一格，就画在哪一格的窗口内；**被格边切开的段不压缩、不重排**：
   同一 token 在两格上各画一段，长度之和 = 原段长。
3. 若目标格不是陆格（`terrain === 'shallow'`、越界、被别的地形占用），
   该段在格边截断，并记 `truncatedPx`；截断量进读数，**不许**把像素画进水里。
4. 沿水线的每一格都按自己的 16px 全宽发截面，格子之间不留缝。

**24px 的实际承载（灯潮界，`inset=0`）**：

| 格 | 窗口 | 承担 | 长度 |
| --- | --- | --- | --- |
| 水侧格（行 15） | `t[0,16)` | `soil` 8 + `farm` 8 | 16 |
| 陆侧格（行 16） | `t[16,24)` | `stone` 8（错位时 12） | 8 / 12 |

拐角处同一格可能收到两条边的带子：按段下标**湿段优先**（`soil` 最后画、
`stone` 最先画）覆盖，保证水侧连续；被覆盖的干段记 `overlapPx`，
只允许出现在至少两条边相邻的拐角格。顺序由格坐标排序决定，可复现。

**断言**：

1. 24px 带在直岸上恰好落在 2 格；每格的「承担段」与上表逐项一致。
2. 段被格边切开时（例如 20px 带、段界 8/16/20），两格上的同 token 长度之和
   等于原段长，且没有 0 长矩形。
3. 每个矩形的每个像素都落在 `terrain !== 'shallow'` 的格；`truncatedPx=0`
   是灯潮界灯潮线的期望读数（行 15/16 都是陆格）。
4. 反向 M8：把第二格的干段人为推进水面 1px，J9 必须报 `leaked>0`。

### 6.5 J7 三档逐段可辨（量化，不靠「看着像」）

**色值判据**（相邻段，实测 token）：

| 相邻 | ΔL* | ΔE2000 | 阈值 | 结论 |
| --- | --- | --- | --- | --- |
| `soil → farm` | 16.0 | 12.85 | ≥6 / ≥5.53 | 过 |
| `farm → stone` | 8.8 | 7.48 | ≥6 / ≥5.53 | 过 |

**几何判据**：

- 每段沿横坐标长度 **≥8 art px**。24px = 3×8，刚好是下限；错位只能加在
  **最后一段的外侧**，不许从中间段借宽度（借了最后一段就掉到 4px，等于又回到
  v2 的「大跳 + 窄条」）。
- 六钉口径 1 art px = 4 device px，所以每段 ≥32 device px；4× 裁剪里 ≥128 px。
- 外边界允许与背景同值：石岸的 `stone` 段与石铺同色，第三档靠
  `farm → stone` 的内边界读出来，外边界直接承接铺装；这不是「看不见的带子」，
  因为该段的**内边界**必须可见（ΔL* 8.8）。

**测量判据**（4× 裁剪，逐段取中心样区）：

1. 每段取横坐标中心 4 art px × 沿水线 4 art px（设备 16×16，4× 裁剪 64×64），
   读均值；均值与声明 token 的每通道差 ≤2。
2. 相邻样区均值的 ΔL* ≥6；三段都要有样区，缺一段即失败。
3. 若某段长度 <8px，或任意相邻 ΔL* <6，判失败——**不许用 alpha 叠色、
   dither 或再加宽蒙过去**。

### 6.6 J8 确定性错位（禁随机）

- `phase(cell) = (cell.x × 3 + cell.y × 5) % 2`，与 v2 同一式；只用格坐标，
  无随机、无种子、无时钟。
- 错位加在**最后一段的外侧**：`phase=1` 的格，`stone` 段 8→12px，
  带子总宽 24→28px；水侧 `t=0` 不动。
- 因此水线始终连续（零入水的几何前提），陆侧外边界按格交替 8/12px，
  在格内至少错开一次 4px（1/4 格）；`staggerPx=8` 时错开半格。
- 断言：
  1. 同一输入调用两次，矩形列表 `deepEqual`（逐字节可复现）。
  2. 源码扫描：模块内 `Math.random` 命中 0。
  3. 相邻两格的陆侧外边界差 = `staggerPx`，水侧起点差 = 0。
  4. 每段长度仍 ≥8px（错位只加宽最后一段）。

### 6.7 J9 零入水（跨格版）

- 结构断言：所有矩形的像素所属格全部是陆格（`terrain !== 'shallow'`），
  包括第二格、第三格；第一格之外不再有「默认陆」的假设。
- 反向夹具：
  - M9 第二格故意推进水面 1px → `leaked > 0`；
  - M10 带子跨到浅滩单格岛 → 必须截断且 `leaked = 0`，`truncatedPx > 0`；
  - M11 段和 ≠ `depthPx`、`depthPx < 8`、`inset+depth+stagger > 48` → 纯函数抛，
    错误文案点名参数。
- 端到端：六钉截图差异掩膜按 §3.6 反解，`waterCellPixels` 必须为 0；
  低潮、满潮各一张。

### 6.8 J10 预算

- 岸带仍画在既有地形烘焙 Graphics 上，不新建 Graphics；期望增量 **0**。
- 指令增量 = 矩形段数（由测试打印）；硬闸不变：指令 <30000、Graphics <40、
  无 JS 报错。24px 跨 2 格比 v2 多出的矩形数要进读数，不拿「没超」当「没成本」。

### 6.9 与台阶生成器不合并 API（理由）

台阶生成器（另一分支的 `stair-flight`）和岸带生成器都是「几何输入 → 矩形列表」，
但只共享这一句抽象：

| | 台阶 | 岸带 |
| --- | --- | --- |
| 输入 | 竖向截面：x/y、宽、踏数、踏高、踏深 | 水陆四邻边：陆格 + side + 地形 |
| 输出 | treads 逐级抬升的矩形 | 跨 2–3 格的横向色阶矩形 |
| 不变量 | 踏面连续、`rise` 反向必须红 | 零入水、湿→干单调、每段 ≥8px |
| 调用方 | 街面 4 级、渡口 3 级 | 地形烘焙（每个岸边一次） |
| 失败语义 | 高度/踏数不匹配 | 像素越界进水面 |

合并会造出一个带可选轴的「万能扫掠」，参数互相牵制，两个不变量都难断言；
两个用例不值得一层框架。**保持两个独立生成器**。唯一可共享的是
「格坐标 → 确定性相位」这类一行纯函数，本轮不抽。

### 6.10 v3 验收读数（实装后必须逐条给）

| # | 读数 | 通过条件 |
| --- | --- | --- |
| J6 | 24px 落 2 格、每格承担段、`truncatedPx`、`overlapPx` | 与 §6.4 表一致；截断 0；重叠只在拐角 |
| J7 | 三段实测均值、相邻 ΔL*、每段长度 | 每段 ≥8px；相邻 ΔL* ≥6；均值差 ≤2/通道 |
| J8 | 两次调用 deepEqual、源码扫描、外边界差 | 全过；无 `Math.random` |
| J9 | 结构断言 + M8/M9/M10/M11 | 正向 leaked 0；反向 leaked>0 |
| J10 | Graphics / 指令 / 矩形段数 | 增量 Graphics 0；硬闸 3 项 |
| 观感 | 低潮/满潮 4× 裁剪、8× 近景 | 自己判 ①/②；仍②就停手报「走不通」 |
| A1–A4 | 六钉 exact diff、bbox、`waterCellPixels`、`bestShift` | `waterCellPixels=0`、`dx=dy=0` |

停止规则：4× 仍读成②时，**不许再加宽、不许再换第三组色值**，
直接报「这条单格/叠色路线走不通」，并写清是面积、色阶还是背景纹理导致的。

### 6.11 实施顺序

1. 先红：`world-client/test/shore-band.test.ts` 补 J6–J10 与 M8–M11，
   在基点实现上必须红在断言（跨格能力尚不存在）。
2. 再改 `world-client/src/render/shore-band.ts`：跨格分配 + 最后段外侧错位；
   保持 `waterLandEdges`、`cellToDeviceRect`、`zero water` 组件不动。
3. 再接数据：`world-client/src/settings/{types,load}.ts` 放宽上界；
   `world-client/src/settings/dengchao/pack.ts` 写 24px / `soil→farm→stone`。
4. 最后实拍：六钉低潮/满潮、J3 反解、4× 裁剪、预算读数。
5. 观感判 ①/②；②就停手，不再调参。
