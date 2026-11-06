# 世界扩展提案：不依赖地形高度的结构组件（第一阶段）

> 状态：提案，等待评审。**本文件是第一阶段唯一产物，未改 `world-client/src/` 下任何文件。**
> 日期：2026-11-06
> 工作树：`D:\project\pwe-docs-fix`，提交分支 `docs/world-expansion-proposal`，基线 `origin/main` 的 `a03a1cb`（地形高度阶段 1、动画 FSM 均已合入）
> 依据：设定集知识库（仓外，见 0.2）、`origin/main` 的 `a03a1cb`

---

## 0. 判据与边界

### 0.1 评审首先看什么（2026-11-06 追加校准）

1. **沉淀什么组件**：落地后仓库里多出来的是「一个可配置的构件类型 + 数据描述 + 一条渲染路径」，还是「一段只服务这张画面的绘制代码」。后者不合格，不论画面多像设定集。
2. **可证伪不变量**：必须能写成一条断言（几何、计数、映射完备性或像素阈值）。写不出的标成「待设计」，不进第一阶段结论。
3. **解锁哪类后续内容**：做完这个组件，后面能复用它造什么。只能造一处的按特例处理，不作为组件。

**边界（写进矩阵说明）**：我们承认设定集本身足以做出 demo，所以「做出一张像书里的图」不构成交付价值，**不写进验收**。还原度不是评分项；先做哪个，按「组件价值 ÷ 代价」排序，不按「最像设定集」排序。

### 0.2 证据等级与引用纪律

- **[实测]**：本工作树内用命令读到的事实，附录 A 给命令与原始输出。
- **[推断]**：由实测结构推出来、但没有本轮复跑验证的数字或行为。
- **仓外材料**（设定集知识库、浏览器打光方案）：不进仓，也不加 `audit-citations` 白名单。正文用文字描述，不写成可点击路径。这是 `6df4324` 定下的做法。
- 本文件不写任何会随提交漂移的闸门计数；需要现量的数在第二阶段报告里给。

### 0.3 本阶段范围

- 只写文档，不动产品代码。
- 不覆盖 `world-client/eval/screens/` 基线，不碰其他工作树，不 stash、不丢弃。
- 浏览器实测留到第二阶段：同机位、同天气、同一时刻，hud 隐藏、打光钉住、`waitFadeSettled` 等稳；本阶段不跑。
- 端口规则照旧：5210–5299，禁用 5188 / 5191 / 5202 / 5203，`--strictPort`。

---

## 1. 现状读数

### 1.1 地形与水面

| 项 | 读数 | 出处 | 等级 |
|---|---|---|---|
| 地形是烘焙纹理 | 开局画一次，depth `-10`，key `world-terrain-*` | `world-client/src/scenes/SandboxScene.ts:778` | 实测 |
| 地形三遍 | 底色 → 材质 → 拼接边，之后接种植床/篱笆/衣着/水线/地界 | `world-client/src/render/tilemap.ts:56` | 实测 |
| 岸线只有 1px | 只在 `shallow` 格朝下一侧画 `fillRect(…, TILE_PX - 3, 1)`，alpha `0.4` | `world-client/src/render/tilemap.ts:752` | 实测 |
| 潮水泡沫 1px | 潮水已烘焙成纹理；泡沫带用 `pale`，1px | `world-client/src/render/tide-view.ts:88` | 实测 |
| 现有岸线没有「带」 | 无岸滩过渡带、无芦苇、无岸线专属暗色 token；只有一条水色高光 | 全仓检索 `drawWaterline` / `pale` 调用点 | 实测 |

**结论**：书里要的是「岸」而不是「水」。我们现在的岸是一根 1px 的线，线下面直接换材质，没有过渡带，也没有可配置的岸型。

### 1.2 竖向交通与暗口

| 项 | 读数 | 出处 | 等级 |
|---|---|---|---|
| 街面石阶写死 4 级 | 每级 4px，总高差 16px，尺寸不可配置 | `world-client/src/render/scene-artbook.ts:568` | 实测 |
| 渡口踏步写死 3 级 | 嵌在 `drawQuay` 内，与石堤同一条绘制路径 | `world-client/src/render/scene-artbook.ts:515` | 实测 |
| 台阶已是数据构件 | `steps` 是 `SettingScenery.kind` 之一，只有 `at` 与 `length` | `world-client/src/settings/types.ts:54` | 实测 |
| 构件 depth 有纯函数 | 落地行 + 12，可脱离 Phaser 验算 | `world-client/src/render/scenery-depth.ts:25` | 实测 |
| 门洞只有暗底 | `ink` 描边 + `charcoal` 面板，没有「框内透远景」 | `world-client/src/render/buildings.ts:634` | 实测 |
| 暗口没有独立层 | 相位压暗在 `8009/8010`，雾在 `7998`；门洞不参与 | `world-client/src/render/phase-view.ts:28` | 实测 |

**结论**：竖向交通已有「一条写死的画法」，没有「可配置的踏步构件」；暗口只有「暗」，没有「框」。

### 1.3 调色板与材质

| 项 | 读数 | 出处 | 等级 |
|---|---|---|---|
| 世界 24 色 | W01–W24，上限写进 ADR | `world-client/src/world/palette-data.ts:32` | 实测 |
| 只有语义槽，没有材质分组 | `timber/timberDark/stone/plaza/trim/moss/…`，没有「木构件 / 石构件 / 布幔」三套清单 | `world-client/src/world/theme.ts:64` | 实测 |
| 第 25 色要 ADR | 调色板预算不是本轮能自行突破的 | `docs/adr/ADR_PALETTE_24.md` | 实测 |

**结论**：书里的主题色是绑在构件清单上的（钟楼、汤屋外墙、灯笼、桥栏），我们这里是绑在**语义槽**上的。两者差在「构件 → 材质 → 色」这一层映射。

### 1.4 预算与 Image 盲点

| 项 | 读数 | 出处 | 等级 |
|---|---|---|---|
| 预算只数 Graphics | `children.list` 过滤 `item.type === 'Graphics'` | `world-client/src/scenes/SandboxScene.ts:4135` | 实测 |
| 指令上限 30000 | `MAX_COMMANDS = 30_000` | `world-client/scripts/check-render-budget.mjs:61` | 实测 |
| Graphics 上限 40 | `stats.graphicsObjects < 40` | `world-client/scripts/check-render-budget.mjs:358` | 实测 |
| 上次闸门读数 | 指令 `15515`、Graphics `28`、无报错 | `docs/evidence/VERIFIABLE_FLOWS.md:173` | 证据文件读数，本轮未复跑 |
| Image 不在闸门里 | 全仓 `scene.add.image` 只有 1 个调用点；`bakeLayer` 有 4 个调用点（地形、潮水、雾、内景） | `world-client/src/render/bake.ts:119` | 实测调用点；运行时张数为推断 |

**Image 结论**：静态调用点 1 处，运行时 Image 约 2–4 张（地形与潮水必在，雾与内景按场景出现）。这是闸门的盲点，第二阶段要主动报「改前 / 改后 Image 数量」，不能只报 Graphics。

### 1.5 高度与工作树状态

| 项 | 读数 | 命令 | 等级 |
|---|---|---|---|
| `origin/main` 已含阶段 1 | `a03a1cb Merge … 分层高度阶段 1（数据模型）` | `git log --oneline HEAD..origin/main` | 实测 |
| 调查时本地分支不含阶段 1 | 调查基线 `7e4844f` 没有地形 ADR；`a03a1cb` 不是它的祖先 | `Test-Path docs\adr\ADR_TERRAIN_HEIGHT.md` → `False`；`git merge-base --is-ancestor a03a1cb HEAD` → `1` | 实测（提交前） |
| 调查时本地分支落后 15 个提交 | 含动画 FSM 与 `ActorPin settled` 的合入 | `git log --oneline HEAD..origin/main` | 实测（提交前） |
| 本文件提交基线 | 已含阶段 1 与动画 FSM | `git log --oneline -1` → `a03a1cb` | 实测（提交时） |

**含义**：本阶段所有提案按 **level 0** 设计，不依赖 `level` 的消费者；`level` 只作为阶段 2 的接口预留。提交基线已经是 `origin/main`（`a03a1cb`），第二阶段从这个**同一基点**新建工作树，不再复用调查时那条落后 15 个提交的分支。

---

## 2. 提案

每条按同一结构写：服务要点 → 改哪里 → 沉淀什么组件 → 可证伪不变量 → 解锁 → 代价 → 是否需要高度。

### P1 岸线带：把「水陆邻接边」做成可复用层

**服务要点**
- 设定集知识库要点 6（水嵌在地貌里）：`p039_L`（书页 76，峡谷底沼泽 + 隧道 + 列车）、`p034_R`（书页 67，"as if located on a river bank"）、`p094_L`（书页 186，海沼泽受光）。
- 次要：要点 8（`p092_R`，书页 183，大面积渐变色阶不足）——岸带可以给水陆交界补中间色阶，但这不是主目标。

**改哪里**
- 新建纯函数模块 render/shore-band.ts（尚未创建）：输入网格与水型，输出每条水陆邻接边的矩形与样式键。
- 在 `world-client/src/render/tilemap.ts:93` 的 `drawWaterline` 之后接一遍岸带绘制，仍走地形烘焙路径。
- 样式 token 从现有 24 色里取（石/广场/苔/水），**不新增第 25 色**。

**沉淀什么组件**
- 一个「水陆邻接边查询」+ 一个样式参数（宽度、材质 token、断续模式、朝向）+ 一条烘焙绘制路径。
- 数据描述是「岸型」，不是「某一坐标的一段纹样」；任意地图、任意潮位都能复用。

**可证伪不变量（断言）**
1. `shoreSegments(grid).length === landWaterAdjacencies(grid).length`，且每条邻接边只出现一次（纯函数，小网格夹具可验）。
2. 每条岸带矩形的像素范围完全落在**陆地格**内，不侵入水面格：`rect.x ∈ [landTile.x, landTile.x + TILE_PX)`，`rect.y` 同理。
3. 直线岸段 k 格 → 岸带连续长度为 `k × TILE_PX`，不出现 1px 断点（这是「连续段」的直接断言）。

**解锁**
- 任意水域地图的岸线；潮位变化下的岸（潮水已烘焙，岸带读取同一套网格）；后续渡口、堤岸、沼泽边、芦苇带都可以挂在这条邻接边上。

**代价**（相对上次读数 `15515` 指令 / `28` Graphics）【推断，未在第二阶段前复跑】
- 新增 Graphics 对象：**0**（并入已有地形烘焙 Graphics，`bake.ts` 只增加绘制指令，不增加对象）。
- 新增指令：每条邻接边约 2–4 条 `fillRect`；总量取决于地图岸长，第二阶段首次跑闸门时现量，预计远低于 30000 余量。
- 新增 Image：**0**（复用地形纹理）。
- 代码面：1 个纯函数模块 + 1 条绘制 pass + 夹具测试。

**是否需要高度**：**否**。岸带只读 terrain 邻接，不读 `level`；「岸随水位动」读潮位，不读地形高度。

---

### P2 踏步构件：把「N 级石阶」做成可配置构件

**服务要点**
- 设定集知识库要点 5（高差用竖向交通和视点表达）：`p034_R`（书页 67，石阶 + 石灯笼）、`p072_L`（书页 142，放弃楼梯改爬外墙）、`p073_L`（书页 144，顶层露台）。
- 旁证：`p035_R`（书页 69，"The signboard architecture becomes visible as they climb the stone stairs."）。

**改哪里**
- `world-client/src/settings/types.ts:54` 的 `SettingScenery.kind` 增加一个 `stair_flight`（或等价名），数据字段为 `steps / rise / tread / width / facing`。
- 新建纯函数 render/stair-flight.ts（尚未创建）：只算几何，不碰 Phaser。
- `world-client/src/render/scene-artbook.ts:66` 的分派里加一条分支，把几何画进**已有**的 ground / architecture Graphics。
- 摆放数据加在 `world-client/src/settings/dengchao/scene-artbook.ts:145` 一带（与现有 `street_steps` 并列）。

**沉淀什么组件**
- 「N 级踏步几何生成器」：输入步数、每级高差、踏面宽、总宽、朝向，输出每级矩形 + **底部 / 顶部锚点**。
- 一个构件类型 + 一条数据 + 一条渲染路径。锚点是为阶段 2 的高度系统预留的接口，但本阶段不消费。

**可证伪不变量（断言）**
1. `flight.topY === flight.footY - flight.steps * flight.rise`（总高差 = 步数 × 级高，整数像素，无 ±1 误差）。
2. 相邻踏面的 y 差恒等于 `flight.rise`：`tread[i].y - tread[i - 1].y === rise`，对所有 `i` 成立。
3. 每级踏面宽度恒等于 `width`，整个构件包围盒为 `width × (steps × rise)`。
4. 所有绘制矩形的像素范围不越出声明的包围盒。
5. 落点：`footY === at.y * TILE_PX`（与 `world-client/src/render/scenery-depth.ts:28` 同源）。

**解锁**
- 桥头阶、堤阶、崖壁外挂梯、屋顶 / 露台入口都可以用同一构件摆；参数不同，代码不复制。
- 阶段 2 接 `level` 时，顶部 / 底部锚点直接变成抬人与遮挡的输入，不用重画一套。

**代价**（相对上次读数）【推断】
- 新增 Graphics 对象：**0**（复用 ground / architecture 层，`world-client/src/render/scene-artbook.ts:50` 已有层）。
- 新增指令：每级约 3 条 `fillRect`（踏面、踢面、压线），4–8 级约 12–24 条。
- 新增 Image：**0**。
- 代码面：1 个纯函数模块 + 1 条分派分支 + 1 条摆放数据 + 几何夹具测试。

**是否需要高度**：**否**。本阶段只做纯视觉构件：人物不会真被抬高，走上台阶只是视觉上「上了」。真实攀爬与站高标「等阶段 2」。

**为什么不用动态摆件 `PropKind`**：那会每实例新建 2 个 Graphics（`world-client/src/render/decor.ts:199`），还会撞存档重建与 `props=stable` 的证据口径。用 `SettingScenery.kind` 规避这两样。

---

### P3 暗口取景框：把「框暗 / 目标亮」做成构件

**服务要点**
- 设定集知识库要点 7（暗口看亮远处）：`p033_L`（书页 64，隧道口 + 彩窗）、`p094_R`（书页 187，车窗看岛）、`p022_L`（书页 42，远处钟楼）。
- 机制侧：要点 4（`p037_L`，书页 72，"by reducing the surrounding colors, the color shined like gold."）。

**改哪里**
- 新建纯函数 render/aperture.ts（尚未创建）：输出框矩形、框内暗区矩形、远亮矩形。
- `SettingScenery.kind` 增加 `aperture`；`world-client/src/render/scene-artbook.ts:66` 加分派。
- 若需要独立遮挡层，会碰 `world-client/src/render/phase-view.ts:28` 的 `7998–8011` 层；本阶段不建议动那一层。

**沉淀什么组件**
- 一个参数化视距构件：框（门洞 / 隧道口 / 车窗）+ 框内暗区 + 一个「远亮目标」矩形；暴露三段几何。
- 它必须能挂到任意墙面或洞口，不是给某一面墙画一张暗贴图。

**可证伪不变量（断言）**
1. 几何：`farLightRect ⊆ apertureRect ⊆ hostRect`（远亮在框内，框在宿主范围内），纯函数可验。
2. 光度（**待设计**）：框内平均亮度低于框外周边 ≥ Δ，远亮矩形高于框内 ≥ Δ。Δ 与取样窗口未定，不进本阶段结论。
3. 层级：aperture 的 depth 低于村民，人物经过时不被暗框盖住（层级断言）。

**解锁**
- 隧道口、门洞、车窗、檐下暗区；远景亮目标可复用现有对岸钟塔 / 窗火。

**代价**【推断】
- 新增 Graphics 对象：**0**（复用已有层）或 **+1**（独立遮罩层）；两者都远低于 40。
- 新增指令：每构件约 2–6 条。
- 新增 Image：**0**（除非用遮罩纹理，不作为首选实现）。
- 代码面：1 个纯函数 + 1 个分派 + 1 条数据；光度阈值需要额外一套浏览器读数工具。

**是否需要高度**：**否**（视距靠遮挡与明暗，不靠地形高度）。「从高处俯瞰」才需要阶段 2。

**风险**：最大不确定是「远亮目标从哪来」。没有远处的实体，暗口只是一个黑洞，容易退化成一次性贴图。

---

### P4 构件材质色组：把「构件清单 → 材质」做成总函数

**服务要点**
- 设定集知识库要点 3（主题色绑构件清单）：`p037_L`（书页 72，红色分配到钟楼、汤屋外墙、灯笼、桥栏）。
- 次要：要点 2（同页，先定光源实体与色温）、要点 4（同页，压周围才发光）。

**改哪里**
- 新建纯函数 world/material.ts（尚未创建）：`kind → material`（木 / 石 / 布）的完备映射。
- `world-client/src/world/theme.ts:64` 增加材质解析入口；渲染层调用点改读材质 token，而不是各自散落常量。
- **不新增第 25 色**；色值仍从 `world-client/src/world/palette-data.ts:32` 的 24 色里取。

**沉淀什么组件**
- 一张「构件清单 → 材质 token」的总函数 + 主题解析入口；新增 kind 必须显式归类（TypeScript 穷尽检查）。
- 数据描述是材质分类，不是某张图的调色表。

**可证伪不变量（断言）**
1. 完备性：每个 `SettingScenery.kind` 恰好映射 1 个材质，无遗漏（编译期穷尽 + 运行时枚举测试）。
2. 调色板仍为 24 色（`audit-palette` 断言不破）。
3. 纯函数：同一 `(kind, theme)` 重复调用结果完全相同。
4. 数量稳定：同一构件清单下，材质 token 数量恒为 3（木 / 石 / 布），不随场景规模变化。

**解锁**
- 所有后续构件默认有材质归类；主题切换；构件层次。
- **不能**解锁「画面层次一定更清楚」——那需要美术判断，不作验收。

**代价**【推断】
- 新增 Graphics / 指令 / Image：**0 / 0 / 0**。
- 但改多处调用点；颜色一变，全仓截图基线会大面积漂移。
- 实际换色需要 ADR 或用户批准，价值兑现慢。

**是否需要高度**：**否**。

---

## 3. 可行性矩阵

### 3.1 组件判据优先（新增三列在前）

| 提案 | 沉淀组件 | 可证伪不变量 | 解锁 | 要点出处 | 改模块 | 代价（Graphics / 指令 / Image） |
|---|---|---|---|---|---|---|
| P1 岸线带 | 水陆邻接边查询 + 岸型参数 + 烘焙绘制路径 | 邻接边计数一一对应；像素不侵入水面；直线岸 k 格连续 `k×16` | 任意水域地图、潮位、渡口/堤岸/沼泽边 | 要点 6；旁证要点 8 | `world-client/src/render/tilemap.ts`、新纯函数 | 0 / +（按岸长，待第二阶段现量）/ 0 |
| P2 踏步构件 | N 级踏步几何生成器 + 锚点 + 构件类型 | `topY = footY − steps×rise`；相邻差恒为 `rise`；不越包围盒 | 桥头阶、堤阶、崖梯、露台入口；阶段 2 直接接锚点 | 要点 5 | `world-client/src/settings/types.ts`、`world-client/src/render/scene-artbook.ts`、新纯函数 | 0 / +12–24 / 0 |
| P3 暗口取景框 | 框 + 内暗 + 远亮的参数化视距构件 | 几何包含关系；层级低于村民；光度阈值待设计 | 隧道口、门洞、车窗、檐下暗区 | 要点 7；机制旁证要点 4 | 新纯函数 + `world-client/src/render/scene-artbook.ts`；可能碰相位层 | 0 或 +1 / +2–6 / 0 |
| P4 构件材质色组 | `kind → 材质` 总函数 + 主题解析 | 映射完备；24 色不变；纯函数；token 数恒为 3 | 所有后续构件的默认归类、主题切换 | 要点 3；旁证要点 2、4 | `world-client/src/world/theme.ts`、新纯函数、多处调用点 | 0 / 0 / 0 |

### 3.2 可行性矩阵（原四列）

| 提案 | 不需要高度就能做 | 需要阶段 2 | 与动画状态机冲突 | 风险 |
|---|---|---|---|---|
| P1 岸线带 | **是** | 否（「岸随水位」读潮位，不读地形高度） | **代码无冲突**（动画线未改 `tilemap.ts` / `tide-view.ts`）；**证据冲突**：岸线落在全图水边，若进入 18 张相位帧的钉住区域，会破坏「区域外零差异」 | 全图水边像素变化，水面基线大面积漂移；色阶是否变连续必须由像素读数证明 |
| P2 踏步构件 | **是**（纯视觉，人物不真抬升） | 真实攀爬 / 站高、遮挡抬升标「等阶段 2」，用锚点接 | **代码无冲突**（FSM 只改村民渲染与 `SandboxScene` 调试口）；用 `SettingScenery.kind` 避开 `PropKind` 的存档与 `props=stable` 口径 | 落位若进入相位钉住区域会破坏区外零差异；静态台阶只能「看起来上了」，需在验收里明说 |
| P3 暗口取景框 | **是**（视距靠遮挡与明暗） | 「从高处俯瞰」需要阶段 2 | **局部遮罩可控**；若改相位层整屏压暗，会破坏相位帧区外零差异 | 远亮目标来源不明；光度不变量阈值待设计；容易退化成一次性暗贴图 |
| P4 构件材质色组 | **是** | 否 | **代码无冲突**；但全屏颜色变化比 P3 更广，会破坏相位帧证据 | 不变量只能证明「映射完备 / 24 色不变」，不能证明「层次更清楚」；换色需 ADR |

**冲突判定依据（实测）**：`origin/main` 已合入动画 FSM（`6c66d8b`）、FSM 校准（`cd52a4c`）与 `ActorPin settled`（`d1a5f12`），本文件提交基线 `a03a1cb` 已包含这些提交（调查时的本地分支 `7e4844f` 尚未包含）。第二阶段仍要从同一基点新建工作树后**重新判一次代码冲突**，不能沿用本表的结论。本表只判到「动画线已合入的改动范围」：村民渲染文件与 `SandboxScene` 调试口。

**明确不做的写法（不合格示例）**：
- 只给登潮镇某一段水边画一条岸带纹样；
- 只把某一面墙压暗做成「暗口」；
- 只给某一张图换一套颜色。
这些都能做出「像书里的图」，但没有可配置构件、没有不变量、只能造一处，**不构成交付价值，不写进验收**。

---

## 4. 推荐先做的一个：P2 踏步构件

按「组件价值 ÷ 代价」排序，**P2 第一，P1 第二**。

**为什么是 P2**
1. **不变量最硬**：`topY = footY − steps×rise` 是整数几何，Node 单测可验，不需要浏览器就能先红。这正是用户给的「N 级石阶的总高差 = N × 级高」原型。
2. **代价最小**：0 新 Graphics、0 新 Image、每实例十几条指令；复用已有构件层，不碰地形烘焙。
3. **像素足迹最小**：只改一个构件所在区域，其余屏幕可以要求零差异。这对动画线的相位帧证据最友好。
4. **解锁面最直接**：同一构件可造桥头阶、堤阶、崖梯、露台入口；锚点即阶段 2 的高度接口。
5. **不碰动态摆件**：避开 `PropKind` 的存档重建与 `props=stable` 证据口径。

**为什么不是 P1 第一**：P1 的组件价值更大，但它改的是全图水边；像素足迹铺满地图，最容易撞相位帧的「区外零差异」，也最容易让水面基线大面积漂移。它的不变量（邻接边计数、连续段长度）同样可验，适合排第二。

**为什么不是 P3 / P4 第一**：P3 的远亮目标来源与光度阈值都还没定；P4 的颜色变化全屏铺开，且不变量只能证明结构完备，证明不了「层次更清楚」。

### 4.1 第二阶段验收计划（待批准后执行）

1. 从 `origin/main`（`a03a1cb`）新建分支与工作树，不复用本阶段的文档分支。
2. TDD 先红：先写几何断言（`steps×rise`、相邻差、包围盒、落点），红在断言上，不红在 import 或编译。
3. 实现：纯函数 + 分派 + 一条摆放数据；不改地形、水面、相位层。
4. 浏览器实拍：同机位、同天气、同一时刻；hud 隐藏（白流 `visibility`、绝对浮层 `display:none`）；`Oracle.setPhase` 后必须 `waitFadeSettled`，不 sleep；改前 / 改后各一张，写 `tmp/screens`，不写 `eval/screens`。
5. 报告：`Get-ChildItem` 清单 + 每张 sha256 与字节数；用 `screens-diff.py` 的精确差 / 结构差给「变化落在哪个矩形、差多少像素」，不接受「看起来更像」。
6. 预算：自跑 `test:render-budget`，报「指令 < 30000 / Graphics < 40 / 无 JS 报错」三道硬闸的原始输出；**另报 Image 数量变化**（现闸门不数 Image）。
7. 若落位进入动画线的相位钉住区域，先停，改落位或说明为什么必须进。

---

## 附录 A：本阶段调查命令与原始输出（实测）

### A.1 调查时的工作树与分支（提交前读数）

> 这一节保留调查当时的原始输出，基线是 `7e4844f`；本文件最终提交在 `docs/world-expansion-proposal`（基于 `origin/main` 的 `a03a1cb`）。

```
> git status --short
（空）
> git log --oneline -3
7e4844f 仓外清单引用改成文字描述，撤掉两条白名单
9a2607d Merge branch 'fix/port-parallel-rule'：截图输出默认 tmp，写回 eval/screens 须显式授权；夜雨基线漂移证据与 E6 登记
f98700a 夜雨基线漂移证据补入同日复跑读数
> git branch --show-current
fix/port-parallel-rule
```

### A.2 本工作树与 origin/main 的差距

```
> git log --oneline HEAD..origin/main
a03a1cb Merge branch 'docs/layered-terrain-design'：分层高度阶段 1（数据模型）与两个 TERRAIN_HEIGHT 改名
8bd5ed7 test: red-first 兼容 push main 的 base=f11852c
c41ab61 feat(terrain): 阶段 1 数据模型 —— level / levelAt、v6 terrainEdits、删过渡别名
ee57759 refactor(terrain): 两张同名 TERRAIN_HEIGHT 各自改名，消除歧义
f11852c Merge branch 'fix/test-glob-recursive'：npm test 递归跑子目录，README 去掉写死的测试文件数
6a37573 fix: npm test 递归跑子目录；README 去掉写死的测试文件数
d1a5f12 Merge pull request #28 from cs1lion/feat/anim-pin-settled
dedcb74 Merge branch 'fix/claims-probe-recursive'：audit-claims 测试文件数改递归计数，失败时列出参与文件
23fb468 fix: audit-claims 测试文件数探针改递归，失败时列出参与文件
8556eb1 feat: ActorPin 增加 settled 稳态标记（缺省 true，未接渲染）
cd52a4c Merge pull request #27 from cs1lion/feat/anim-fsm-calibration
71c5408 fix: 标注未验证转移时长、残影丢弃下限与状态机边界
6c66d8b Merge pull request #26 from cs1lion/feat/anim-fsm
72b2f2d Merge branch 'fix/port-parallel-rule'：仓外清单引用改文字，撤掉两条白名单
52a4f1f docs: 同步测试文件数 278→279（含新增 anim-fsm 用例）
36f1566 test: 文档比对前统一换行，避免 Windows 检出误红
eee3077 test: 状态机用例改为动态加载，缺实现时红在断言上
131047f test: 动画状态机迁移用例与第二版接入预案
0c672a9 feat: 引擎无关的村民动画状态机 v1（不进渲染路径）
ec6dde2 chore: 登记 pwe-anim-fsm 工作树（feat/anim-fsm）
```

### A.3 本工作树没有地形 ADR，也没有阶段 1 的 level 消费者

```
> Test-Path docs\adr\ADR_TERRAIN_HEIGHT.md
False
> git merge-base --is-ancestor a03a1cb HEAD
（退出码 1）
```

### A.4 代码落点（只读检索）

```
> 检索 world-client/src/render/tilemap.ts：drawWaterline
93:  drawWaterline(grid, originX, originY, g, palette);
752: function drawWaterline(
759:   g.fillStyle(palette.water, 0.4);
766:   g.fillRect(originX + x * TILE_PX, originY + (y + 1) * TILE_PX, TILE_PX - 3, 1);

> 检索 world-client/src/render/scene-artbook.ts：分派 / drawSteps / 渡口踏步
66:  for (const item of pack.scenery) {
75:    } else if (item.kind === 'steps') {
568: function drawSteps(
578:   for (let step = 0; step < 4; step += 1) {
515:   // 堤头三级踏步：在东端往下走到水面，越靠外越亮。
516:   for (let step = 0; step < 3; step += 1) {

> 检索 world-client/src/settings/types.ts：SettingScenery.kind
54: export interface SettingScenery {
55:   readonly kind:
90:     | 'steps'

> 检索 world-client/src/world/palette-data.ts
32: export const WORLD = {
94: } as const;
96: export type WorldColor = keyof typeof WORLD;

> 检索 world-client/src/world/theme.ts
64: export function paletteFor(worldId: string = activeWorldId): WorldPalette {
69: export function terrainFor(worldId: string = activeWorldId): TerrainPalette {

> 检索 world-client/src/render/decor.ts：drawProp
199: function drawProp(
212:   const shape = scene.add.graphics();
227:   const noise = scene.add.graphics();

> 检索 world-client/src/scenes/SandboxScene.ts：预算统计
4136:         const graphics = this.children.list.filter(
4137:           (item) => item.type === 'Graphics',
4141:           graphicsObjects: graphics.length,
4142:           totalCommands: counts.reduce((sum, n) => sum + n, 0),

> 检索 world-client/src/render/bake.ts：add.image 调用点
119:       image = scene.add.image(0, 0, key).setOrigin(0, 0);

> 检索 world-client/src：bakeLayer 调用点
SandboxScene.ts:778、fog-view.ts:90、interior-view.ts:347、tide-view.ts:88
```

### A.5 上次预算读数（证据文件，本轮未复跑）

```
docs/evidence/VERIFIABLE_FLOWS.md:173
"2026-11-06 本机实测：硬闸 3 项通过（指令 15515、Graphics 28、无报错），记录项 3 项 pass。"

docs/evidence/eval-ledger/render-budget-runs.txt:21
"两档极差 648（约 4%），两档都远低于 MAX_COMMANDS = 30000；graphicsObjects = 28"
```

---

## 附录 B：待设计清单（不进第一阶段结论）

1. **P3 光度不变量**：框内 / 框外 / 远亮的取样窗口与 Δ 阈值未定。没有它，P3 只有几何不变量，不能证明「暗口真的建立了视距」。
2. **P3 远亮目标来源**：是复用现有对岸钟塔 / 窗火，还是允许构件自带一个远景矩形；后者可能变成一次性贴图。
3. **P4 的「层次更清楚」**：不可证伪，不作验收；只保留「映射完备 / 24 色不变 / token 数恒为 3」三条结构断言。
4. **P1 的岸型枚举**：沙 / 泥 / 石三型是否够用，需要先看现有地形枚举与设定集证据，不在本轮拍板。
