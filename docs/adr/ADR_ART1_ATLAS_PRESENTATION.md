# ADR_ART1_ATLAS_PRESENTATION：art1 图集管线、固定灯槽池与表现层自证读数

- status: aligned
- verified_at: 2026-11-20
- verified_by: agent（用户「路线 A 视觉升级 PR-B：新增可热替换 tile 图集管线、Phaser Light2D 光照、fx-ambient 表现层环境动效；双轨验收 ?art=0 零退化 + ?art=1 补单测与无头冒烟」）
- evidence: `world-client/src/render/art1/atlas-registry.ts`, `world-client/src/render/art1/atlas-tiles.ts`, `world-client/src/render/art1/atlas-buildings.ts`, `world-client/src/render/art1/atlas-villagers.ts`, `world-client/src/render/art1/lighting.ts`, `world-client/src/render/art1/lighting-pool.ts`, `world-client/src/render/art1/lighting-sources.ts`, `world-client/src/render/art1/lighting-readings.ts`, `world-client/src/render/fx-ambient/visual-clock.ts`, `world-client/src/render/fx-ambient/micro-fx.ts`, `world-client/src/render/fx-ambient/avatar-glide.ts`, `world-client/scripts/gen-art1-test-atlas.mjs`, `world-client/scripts/check-art1-smoke.mjs`, `world-client/scripts/audit-palette.mjs`, `world-client/test/atlas-registry.test.ts`, `world-client/test/atlas-tiles.test.ts`, `world-client/test/art1-lighting.test.ts`, `world-client/test/art1-light-pool.test.ts`, `world-client/test/fx-ambient.test.ts`, `world-client/test/layer-guard.test.ts`

## 1. 问题

`ADR_PRESENTATION_GATE_LAYERS.md` 把闸门口径分层之后，表现层还缺三件实东西：

1. **可换的美术资产管线**。`art-assets.ts` 那套管的是「一件素材一张 PNG」（一栋楼、
   一张表情），加一件就要生一张图、改一次清单。地面/石板路/水体/岸型这类东西本质
   是 **tile**，一张图集能铺满全图；照单件那条路走，等于给 6912 格地皮准备 6912 张图。
2. **光照**。黄昏蓝调、雨夜压暗、窗口暖光呼吸、神谕/回溯的临时金光——画进烘焙贴图
   就得每帧重烘（预算不允许），只能走渲染器的灯光。
3. **表现层「在不在跑」无法验收**。截图只能证明这一帧看起来还行，证明不了
   「图集整层接管了没有」「28 盏灯有几盏进了槽」「?art=0 时这些新层是不是真的没动画面」。
   没有读数，就只能靠人眼在两张图里找不同。

顺带撞出三个必须当场决定、否则会以更坏形式回来问题：灯数上限、位图观感被抢、
帧节奏阈值假红。

## 2. 决策

### 2.1 tile 图集：清单驱动，缺件整层回退

- `atlas-registry.ts` 定义 `TileAtlasManifest`（地形 / 石板路 / 水体 / 海岸 /
  建筑 back-body-front-roof / 居民 4 帧步态），16 与 32 两种格边长；
  sheet 走 `preload.spritesheet`，运行时只按格索引取。
- **缺件口径**：manifest 取不到、身份字段（`atlas: 'art1'`）不对、sheet 缺一张、
  清单里没登记这个地形/这栋楼/这个人——一律回 `null` 或 `active: false`，
  调用方落回原来的程序化绘制。图集**要么整层接管、要么整层不接管**：不做半层混铺，
  否则「素材缺一件不该让世界缺一块」会变成「世界缺一块但看不出来」。
- 槽位的键必须是**真实网格字段**能回答的东西：水体按地形（世界里的水只有
  `shallow`，潮位是叠加层不是地形），岸型按**陆侧地形**且边表直接复用
  `shore-band.ts#waterLandEdgesFromGrid`。写 `river`/`lake` 这种渲染代码
  根本不问的键，等于给清单放一堆装饰性字段。
- `gen-art1-test-atlas.mjs` 自带最小 PNG 编码器（IHDR/IDAT/IEND + mulberry32
  确定性像素），产出三张 **CC0 测试图集**与清单：脚本即作者，无第三方素材。
  用途是让全链路在没有任何生图产出时可验收；高色深（8 位通道渐变 + 纹理点）
  本身就是 palette 闸放行 `art1/` 的活证据。清单必须覆盖**两镇全部模板**
  （莞尔镇 12 个 + 灯潮界 10 个 = 22 个）：只登记一边，另一边整镇静默落回程序化。

### 2.2 烘焙合成而不是逐格对象（Canvas/WebGL 同一条路）

`atlas-tiles.ts` 的 Canvas 与 WebGL 后端**统一走离屏合成**：起一张
`textures.createCanvas`，按格 `drawImage` 把图集格切区拷进去，`refresh()` 上传，
再以一张 Image 贴进世界——每层每帧一条 draw 指令，与 `bake.ts` 产出同形态。

- 不选 Blitter：`Bob` 不带缩放（`flipX/flipY/tint/setFrame` 是它的全部可写面），
  32×32 图集在它手里没法缩回 16 逻辑像素。
- 缩放在烘焙那一次做完（目标矩形恒为 `TILE_PX`），运行时零缩放开销。
- 建筑四层里**前檐只有 3px 高**（与 `drawFrontLayer` 同高：那一层要压在站在门口的人
  身上，整格 16px 会盖到胸口）。图集没有 3px 的格，所以取**格底边 3 行像素原尺度**
  贴（`sliceBottomPx`）——压扁会破坏像素刻度，不能干。

### 2.3 独立屋顶层：让掀屋顶在图集上成立

`atlas-buildings.ts` 给每栋楼四个格，其中 **roof 是独立一层**。这不是美术偏好，是
功能前提：位图单件的整栋楼是一张图，`roofIsWholeBuilding: true`，PR-A 的掀屋顶状态机
对它不成立（淡出屋面 = 淡出整栋楼，街景里也没有内景可露）。图集把屋面拆成一格之后，
`?art=1` 的楼也能掀——且 `roofLifts` 一行都不用改。

读数：`BuildingView.roofFromAtlas`（屋面来自图集独立格）与
`roofIsWholeBuilding !== true` 同数，冒烟据此报「N/N 可掀」。

### 2.4 光照：固定灯槽池，不是一灯一对象

Phaser 4 的 `LightsPlugin` 在 `DefaultScene` 插件表里（每个场景都有），但
`setLighting` 标 `@webglOnly`、`runLightPipeline` 在没有灯管线时直接早退——
**Canvas 渲染器下灯光是空转**。因此：

- `lightsSupported(scene)`（WebGL 判定）+ `enabled`（`?art=0` 判定）两道闸缺一不可；
  任何一道不过就返回空转壳，一个灯都不建、`lights` 数组保持原样。
- **容量必须固定**：`maxLights` 缺省 **10**（`GetValue(renderConfig, 'maxLights', 10, config)`），
  而灯潮界光街灯就有 28 盏。一灯一对象会超上限，且增删 Light 会牵动
  `lights` 数组与着色器管线。所以 `LightPool` **一次建满、永不增删**，
  每帧只决定「谁进哪个槽」：`selectLights` 按 `priority` 降序、同档按离镜头距离升序，
  挤不进去的如实记账（`droppedLastFrame`），**不静默丢**。
- 优先级分档写进数据：神谕/回溯（3）> 灯塔（2）> 街灯 = 窗口（1）。
  窗口最初按「基准强度 < 0.5」降档，结果是 28 盏街灯永远把窗光挤掉——
  「这屋里有人」的读数被街灯吃掉，属于设计缺陷而非取舍，已改成 kind 表给档。
- 环境光只有 `setAmbientColor`（无独立强度旋钮），强度用**混到黑**表达：
  `setAmbientColor(mixRgb(0x000000, tint.rgb, tint.strength))`。
- 呼吸相位吃 `presentedNow`（场景呈现时刻），不吃 `Date.now()`：钉钟/回放时
  暖光呼吸停在同一相位，截图比对才连帧一致。

### 2.5 fx-ambient：本层自己的时钟与 PRNG，世界读数只进不改

- `visual-clock.ts` 是这一层**唯一**的时间与随机入口：`visualNoise(a,b)`（整数进、
  0..1 出、可复现）、`cyclePhase`、`swing`。豁免 `Date.now()`/`Math.random()`
  不等于随便用——用 `Math.random()` 的话同一帧两次刷新长得不一样，
  「这一页到底画了什么」永远答不上来。
- 三个硬约束由 `layer-guard.test.ts` 守：不 import `src/world/`、不出现
  `WorldState`、以及第三条「每帧开销由**可见区**决定」——`budgetFor` 把涟漪与
  小点数封顶，世界变大不会让帧成本变大。
- 一格的像素边长（`DEFAULT_TILE_PX`）也作入参递进来：本层不 import
  `world/setup.ts`，那条 import 会撞自己的防火墙。
- 与既有模块的分工先查后写，不重复造：昼鸟/夜蝠仍在 `ambience-view.ts`，
  雨幕与水洼仍在 `weather.ts`，萤火锚点仍读 `fireflies.ts` 的固定表。
  本层加的是**原来没有的**：草摆、涟漪、按 `visualNoise` 的漂移、镜头阻尼。

### 2.6 头像阻尼跟随：默认关，转正需连带改两份断言

`avatar-glide.ts` 是临界阻尼弹簧（`1 - exp(-k·dt)`，帧率无关、不超调），到位即拆、
控制权交回 `CameraController`。**但场景里默认不接管**（`avatarDamping = false`）：
`village-hud.test.ts` 钉着「点头像 → 调 `followVillager` 恰好一次」，
`camera-controller.test.ts` 的 `cam.follow(...)` 调用序列也钉在桩上——阻尼抢那条路
会让两处断言拿到空数组。这不是「实现没做完」，是**转正的代价已经写明**：要开就得
连带改那两份断言，那是另一笔工作，不夹在视觉升级里。

### 2.7 `?atlas=1`：图集默认不抢位图

图集分支默认**不**接管建筑与居民。位图单件是已经过人眼验收的观感（19→72 件，
`ADR_ART_DEFAULT_ON` 的立论就是「别再让用户看不到这批图」），新管线一上线就盖掉它，
等于拿验收过的画面赌新代码。`?atlas=1` 显式抢位，两条路都能跑，
冒烟按开关**分别**要求：带 `atlas=1` 时必须 9/9 可掀 + 7/7 图集步态，
不带时必须是 0——「不悄悄抢位」这件事也得有读数。

### 2.8 自证读数 + 无头冒烟（art=0 / art=1 双轨）

`window.Oracle.debugArt1()`（复用既有 `?debug=1` 面板，不扩 `window.Oracle` 的
玩家语义）返回：图集地面/岸带的 `active` + `cells` + 纹理尺寸、建筑与居民的图集
接管数与可掀数、光照的 `capacity`/`requests`/`dropped`、微动效的本帧实画条数。

`check-art1-smoke.mjs`（npm `test:art1-smoke`，CI 浏览器 light lane）钉六条：

1. 地面层整层接管，格数 = `widthPx/16 × heightPx/16`（缺件回退口径要求整层）；
2. `atlas=1` 时建筑 9/9 走图集且**全部可掀**，默认时必须 0；居民同理 7/7 / 0；
3. 岸带层 active 且格数 > 0；
4. 光照 active：槽容量 > 0、夜相下有请求、`dropped` 记账非负；
5. 微动效非 hidden 且草/波/点至少一类非零；
6. **`?art=0` 全部读数回落**（图集两层 off、光照 off、微动效 hidden）+ 两跑零
   pageerror + 帧节奏。

**帧节奏阈值改过一次，理由是假红**：最初写「rAF 中位 ≤ 16.6ms」。rAF 间隔被 vsync
钉死在 16.67ms，这台机连 `art=0` 都有单次 33ms 的 GC 停顿——绝对阈值恒红，
而它测的是 runner 体质不是表现层代价。仓库已经为同一件事交过学费
（`check-render-budget.mjs` 的三类 fps 断言因此降级为「只记录不阻塞」）。
现在阻塞判据是**同轮相对对照**：`art=1` 帧中位不许比 `art=0` 慢超过 1.5ms；
两跑中位都必须在 vsync 一档（差一整档说明这页根本没在 60Hz 跑）；p95/max 只打印。

绘制指令预算仍归 `check-render-budget.mjs`：本轮实测峰值 25,181 ≤ 硬顶 33,488，
欠债 0 条。**图集没有把预算按格数吹大**（烘焙合成的直接结果）。

### 2.9 色板与 red:first 两处配套

- `audit-palette.mjs` 的 `ART1_DIR` / `FX_AMBIENT_DIR` 放行从「约定性、目录未建」
  变成实指（#65 已登记，本轮只是真的有了文件）。放行报告里那句
  「当前存在/未建」的读数因此从「未建」翻成「存在」——那是这条闸门的自证。
- `red-first-lib.ts` 给五个新测试文件登记**目录级之外的按文件免跑**：
  它们依赖 base 上不存在的 `src/render/art1/**` 与 `src/render/fx-ambient/**`，
  base 上会 `ERR_MODULE_NOT_FOUND` 报 ERROR（kind=module）而不是断言红。
  这不是放宽先红后绿：登记理由写明「base 上无对应实现，红灯判据不成立」，
  与 `labs/` 那条同一口径，产品判据由 `npm test` 与本文件的 62 项单测守。

## 3. 备选与否决

- **Blitter 贴 tile**：否决。`Bob` 无缩放，32 格图集回不到 16 逻辑像素。
- **TilemapLayer / addTilesetImage**：否决。Phaser 4 的 Tilemap 数据结构与本仓的
  `WorldGrid` 账本对不上，等于在世界旁边再存一份地形。
- **一灯一 Light 对象、按世界增删**：否决。见 §2.4。
- **图集直接盖位图（不加开关）**：否决。见 §2.7。
- **`art=0` 也跑表现层再靠 alpha 藏**：否决。基线画面必须逐字节不变，
  screens-diff 5/5 与三套 EDD 都建立在「基线根本不建这层」上。
- **阻尼跟随直接上线替换 `panTo`**：见 §2.6，代价写明后本轮不做。

## 4. 后果

- 表现层第一次有了「换一套美术不用改渲染代码」的入口：换 `public/assets/art1/`
  下的 PNG 与 `manifest.json` 即可。
- 多了一个 URL 参数（`?atlas=1`）与一个环境变量（`ATLAS_FIRST=1`）。前者是玩家
  可试的观感开关，后者只是冒烟脚本的第二轮。
- CI 浏览器 light lane 多一道 `test:art1-smoke`；本分支改了 `src/**`，
  三条 lane 全跑（路径分流的 `RUN_RE` 已命中，不需要改过滤规则）。
- 债务：`avatarDamping` 与 `ATLAS_FIRST` 默认都关，转正各需一笔独立工作
  （改 UI/相机断言、观感验收对比图）。
