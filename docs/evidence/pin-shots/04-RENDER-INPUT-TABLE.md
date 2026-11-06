# 渲染输入全集：把「冻结哪一刻」定义完整

分支 `fix/shot-pin-actor`。本轮不再点状补第七枚钉子，而是把 `WorldSnapshot` 的
**每个字段**一次性定性：画面上读不读、随不随世界时刻变、怎么处置。第六枚钉
（`trails`）是这张表的第一个产物，不是终点。

## 一、渲染输入字段表（25 个字段，一个不漏）

判定口径：三档等待 1200 / 2800 / 5000ms 各冻结一次，取冻结瞬间的原始快照
逐字段 JSON 比较（`runs.json`（与本文同目录）里的 `before.snapshot`）。实测只有 5 个字段变：

```
now / tide / villager / villagers / trails
```

其余 20 个字段在三档之间**逐字节相同**。处置分三类：

- **pin**：随时刻变，且进画面 → 并入 shot pin，三档钉成同一常量；
- **stable**：进画面，但三档冻结快照逐字节相同 → 「冻在哪一刻」不影响它，无需额外钉；
- **dom**：绘制路径不读 → 整组置空后 canvas 必须 0 差。

| 字段 | 读它的绘制函数（证据） | 三档冻结时变吗 | 处置 | 钉法 / 证据 |
| --- | --- | --- | --- | --- |
| `now` | `presentedNowOf`、`phaseInputOf`、`phase-view`（鸟/暗角/光晕）、`ambienceView`、`fogView` | **变**（301→303 分） | **pin** | `nowMs`（钉 07:34） |
| `tide` | `sim.environment() → tideView / settingScenery`（画面读 `env.tideLevel`） | **变**（0.9945→0.8802） | **pin** | `tideLevel`（钉 0） |
| `villagers` | `updateVillager`、`drawVillagerGroundShadow`、`overlay.sync`、`minimap.update` | **变** | **pin** | `actors`（pos/facing/mode/walking/frame/visible） |
| `trails` | `decor.syncTrails` | **变**（只增不减，晚冻 45 s 多一条） | **pin** | `trails`（整张表，强度/位置） |
| `villager` | 绘制不读；只有 `world/report.ts` 日报读 | 变（= villagers[0]） | dom | 与 `villagers` 同一来源，绘制路径静态检索 0 命中（第 23 条） |
| `buildings` | `syncBuildings`、`updateBuilding`、`phase-view`（亮窗/屋顶）、`minimap` | 不变（11 栋） | stable | 三档快照同值 |
| `startupBuildingIds` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `workstations` | `updateBuilding`、烟囱发射器、`phase-view`（在产亮窗） | 不变（11 个全 `idle`） | stable(注) | 三档快照同值；语义上在产时 `progress` 会变，那时必须钉 |
| `constructions` | `decor.syncScaffolds`、`drawScaffolds`（读 `remainingMs/totalMs`） | 不变（空表） | stable(注) | 空表无可比；非空时会随时长变，那时必须钉 |
| `props` | `decor.syncProps`、`phase-view`（灯芯光晕）、`minimap` | 不变（空表） | stable | 三档快照同值 |
| `critters` | `decor.syncCritters` | 不变（空表） | stable | 三档快照同值 |
| `roads` | `decor.redrawRoads` | 不变（空表） | stable | 三档快照同值 |
| `fog` | `fogView.update`、`refreshRuins`（读 `this.snapshot`） | 不变 | stable | 三档快照同值（center 48,36 / r38） |
| `harbor` | `harborView.update`（读 `this.snapshot`） | 不变（`null`） | stable | 三档快照同值 |
| `altar` | `phase-view` 祭坛光晕锚点（`snapshot.altar.x/y`） | 不变 | stable | 三档同值；**置空直接抛 `null.x`**，挪位置像素差 0.4167% |
| `weather` | `phase-view` `firefliesVisible(snapshot.weather)`；`statusLine` 也读（DOM） | 不变（`clear`） | stable | 三档同值；改值会动萤火 → 不是 dom |
| `tasks` | 绘制不读（状态行/队列 DOM） | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `pending` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `oracle` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `events` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `faith` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `deliveries` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `deliveriesByVillager` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `deliveryFailures` | 绘制不读 | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |
| `feed` | 绘制不读（状态行 DOM） | 不变 | dom | 绘制路径静态检索 0 命中（第 23 条） |

**dom 的现行证据是静态检索**（第 23 条）：`src/render/` 下除两个快照合成模块外的
全部绘制模块 + `SandboxScene.renderSnapshot()` 方法体，逐个检索 11 个 dom 字段的
属性访问（`.field`），要求 0 命中。这条不依赖某一次运行，随代码演进自动报警。
文末「一次性历史读数」里的 `dom-blank` 是删口子之前拍的，**口子已删除，不可重跑**，
只作历史参照，不再作为结论依据。

计数：**pin 4 / stable 10 / dom 11 = 25**。

### ⚑ `stable` 的前提（不是通用结论）

`stable` 只由**本夹具的机器状态**背书：11 个工位全 `idle`、0 个在建、0 个道具、
0 个氛围实体。语义上会随世界时刻走的字段一旦在别的场景变成非空/在产：

- `workstations[].progress`（在产时烟囱/亮窗随时间走）
- `constructions[].remainingMs / totalMs`（在建时脚手架随时间走）

**必须钉**，不能继续拿 stable 当免钉理由。守卫测试只保证字段被登记，不保证
登记时的前提永远成立——换场景必须重新跑三档冻结快照逐字段 diff。代码侧已在
`pin-shot-state.ts` 的登记表注释与 `workstations` / `constructions` 两条 note 上
标了 `⚑`。

> `altar` 与 `weather` 原本被错标成 dom。置空证据一跑就抓到：`altar = null` 直接
> 在 `phase-view` 抛 `Cannot read properties of null (reading 'x')`；`weather` 的
> `firefliesVisible` 也会看它。两个都改归 `stable`，并把 dom 置空组缩到 11 个。
> 这条证据链确实抓到了登记表的错误。

### 快照之外的 world 读数

渲染还读三个不在快照里的值，三档实测同值：

| 读数 | 读它的函数 | 三档读数 |
| --- | --- | --- |
| `currentPhase()` | `phase-view` / `settingScenery` / `stallsPackedFor` | `dawn` / `dawn` / `dawn` |
| `weatherIntensity()` | `weatherView.update` | `0` / `0` / `0` |
| `weatherFogDensity()` | `weatherFogView.update` | 晴天随 `weatherIntensity` 同为 0 |

`preCoveredToday()` 读记忆（夹具 `localStorage.clear()` → 无雨记忆 → `false`，三档同值）。
这些值都由冻结后的世界时钟派生，三档 0 差已经是端到端证据。

## 二、三档两两读数（逐像素 0 差、结构块 0）

`scripts/screens-diff.py` 三层读数（精确差 / 可见差 / 8 连通结构块）：

| 组 | 精确差 | 可见差 | 结构块 |
| --- | --- | --- | --- |
| five 1200 vs 2800 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |
| five 1200 vs 5000 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |
| five 2800 vs 5000 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |

三张 PNG 的 sha256 完全相同：`28928885…EB99379`。

六钉对照（四钉仍随等待破）：

| 组 | 精确差 | 可见差 | 最大结构块 |
| --- | --- | --- | --- |
| four 1200 vs 2800（旧口径） | 1.4056% | 1.4035% | 8048 px（104×120）@ `[264,520,367,639]` |
| **five 1200 vs 2800** | **0** | **0** | **0** |
| **five 1200 vs 5000** | **0** | **0** | **0** |
| **five 2800 vs 5000** | **0** | **0** | **0** |

## 三、反向用例（现行夹具）

| 用例 | 改动 | 精确差 | 可见差 | 最大结构块 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `five-shift` | 莞尔 `pos.x` +1 格 | **2.6396%** | **2.4920%** | **14704 px**（148×124）@ `[476,264,623,387]` | **判红** |
| `trail-shift` | 钉住的痕迹 (49,36) → (48,36)，只挪一格 | **0.0104%**（64 px） | **0.0104%**（64 px） | **64 px**（8×8）@ `[332,620,339,627]` | **判红** |

`trail-shift` 的 64 px 与上一轮溯源的那条痕完全同一 bbox `[332,620,339,627]`
（`fillRect(px+3, py+11, 10, 2)` 露出的一截），即「改一处位置」被判红，且红在痕上。
两条反向用例同时证明判据没被钉死成永远绿：角色换一格出 14704 px，痕迹换一格出 64 px，
位置都落在被改的对象上。

夹具末尾对 PNG 字节做二值断言（不是「近似相等」）：

- `five-2800 / five-5000` 必须与 `five-1200` **逐字节相同**；
- `five-shift / trail-shift` 必须与 `five-1200` **不同**。
  反向用例一旦退化成空操作，夹具直接抛错。

### 一次性历史读数（口子已删除，不可重跑）

下面两组是删除 `debugOverridePainting` **之前**拍的，只作历史参照；夹具里对应两跑
已一并移除。现行证据以第 23 条静态检索为准。

| 用例 | 改动 | 精确差 | 可见差 | 最大结构块 | 当时判定 |
| --- | --- | --- | --- | --- | --- |
| `dom-blank`（已删除） | 11 个 dom 字段整组置空 | 0 | 0 | 0 | 当时负控通过 |
| `altar-shift`（已删除） | stable 字段 `altar` 挪到 (1,1) | 0.4167% | 0.3281% | 2016 px @ `[268,612,339,639]` | 当时正控通过 |

## 四、守卫测试：防未来，不防今天

`world-client/test/pin-shot-state.test.ts` 第 21 条：

```ts
assert.deepEqual(unregisteredRenderFields(snapshot), [], '新字段没登记进渲染输入表');
assert.deepEqual(missingRenderFields(snapshot), [], '表里有死条目（字段已改名或删除）');
```

**这条测试今天是绿的，这恰恰是它的局限**：表是照着现有 25 个字段抄的。它挡的是
下一次 `types.ts` 给 `WorldSnapshot` 加字段时——新字段没在 `RENDER_INPUT_TABLE`
里登记就直接判红，逼着先回答「画面读不读、随不随时刻变、要不要钉」，再谈画面。
它不防今天的 `trails`（那已经补完并被三档 0 差证明），只防明天的第七、第八个。

同文件第 22 条做摊牌：真实快照 25 个键，表里恰好 4 pin / 10 stable / 11 dom，
多一个少一个都红。

**第 23 条：dom 字段的静态证明**（替代删掉的「置空一跑」）：

- 检索范围：`src/render/` 下除 `pin-shot-state.ts` / `villager-pin.ts`（只做快照合成、
  不画 canvas）之外的全部绘制模块，加上 `SandboxScene.renderSnapshot()` 的方法体；
- 检索式：11 个 dom 字段的**属性访问** `.field`（`\b` 保证 `villager` 不误吃 `villagers`）；
- 要求：**0 命中**；命中即判红，并指出「文件:字段:次数」；
- 防退化：两个非绘制模块必须真实存在、绘制文件数必须 > 0，改名/清空目录都会红；
- 防未来：新增绘制模块默认自动进入检索范围，不需要人记得加白名单。

这比「置空一跑 0 差」更强：不依赖某一次运行、不依赖夹具状态，随代码演进自动失效报警。

## 五、实现与契约

- `pin-shot-state.ts`：新增 `TrailPin`、`pinTrails`、`unpinTrails`、`pinnedTrailsOf`；
  `RENDER_INPUT_TABLE`（25 条）+ `unregisteredRenderFields` / `missingRenderFields`。
- 呈现态（快照之外）：`WeatherPin` / `pinWeather` / `unpinWeather` / `PRESENTATION_INPUTS`，
  见第八节；25 字段表与 `pinShotState` 签名未动。
- `SandboxScene.paintingSnapshot()`：`pinTrails → pinActors → pinnedVillagers` 三层覆盖，
  世界与判据仍读 `this.snapshot`。
- 入口并列、签名不动：`pinShotState(nowMs, tideLevel)` 一个字符没动；
  `pinTrails(trails)` / `unpinTrails()` 与 `pinActors` 并列；`unpinShotState()` 无参连带解。
- 证据口子 `debugOverridePainting` **已删除**：`paintingOverride` 字段、`DebugOracle`
  声明、夹具的 `dom-blank` / `altar-shift` 两跑全部移除。它曾挂在 `window.Oracle` 上，
  控制台/Playwright 都能任意改画面，属于判据后门；为两条一次性读数留后门不划算。
  已拍读数作为历史留在本文档，但不可重跑。
- `window.Oracle` 无条件挂载的问题只登记、不修改，见 `OPEN_ISSUES.md`。
- 只动夹具与 render 读取路径；不动世界逻辑、不重录基线。合并与推送按收口流程执行。

## 六、闸门

| 闸门 | 命令 | 读数 |
| --- | --- | --- |
| 类型 | `npm run check` | 语法 0 处 / 语义 0 处 |
| 单测 | `npm test` | tests 2390 / pass 2381 / fail 0 / skipped 9 |
| 构建 | `npm run build` | dist 1,940.16 kB（gzip 540.32 kB），682ms（Phaser 4.2.1） |
| 调色板 | `node scripts/audit-palette.mjs --strict` | 通过，退出 0 |
| 行号引用 | `node scripts/audit-references.ts --strict` | 173 处，0 存疑 |
| 引用存在性 | `node scripts/audit-citations.ts --strict` | 3073 处，未解析 0 |
| 节号 | `node scripts/audit-sections.ts --strict` | 159 处，全部对得上 |
| 断言/ADR | `node scripts/audit-claims.ts --strict` | claims 5/5，ADR 10/10 |
| 服务端 | `python -m pytest` | 553 passed / 1 skipped |
| 工作树 | `npm run worktrees:audit -- --strict` | 绿：total=23 registered=23 unregistered=0 overdue=0；`pwe-a3` 表项悬空已清理（目录已不存在） |
| 负控 | `node scripts/check-shot-actor-pin.mjs` | 三档逐字节全同；两条反向全异 |
| 雨帧负控 | `node scripts/check-rain-pin.mjs` | 三跑逐字节同；`frames+1` / `intensity+0.01` 均判红（见第八节） |
| 像素 | `scripts/screens-diff.py` 七组配对 | 见第二、三节 |
| 浏览器 | `test:browser` / `test:phases` / `test:persistence` / `test:render-budget` / `test:setting` | 全绿：smoke 144 项 + 01 专用页 12 项 / 四刻 34 项 / 持久化 8 项 / 渲染预算 6 项 / 设定集 29 项（均在本轮 Phaser 4.2.1 树重跑） |

开发服务器端口 5211（避开 5188 / 5191 / 5202 / 5203）。浏览器闸门写出的
`eval/screens/*.png` 已用 `git checkout -- world-client/eval/screens` 还原，未夹带进提交。

## 七、合并后五钉三跑（新基线，2026-11-06）

之前内景线的 0 差是**四钉**（时刻 / 潮位 / 相机 / 缩放）口径，本分支加入角色钉后一律
作废，以这一组为准。

**方法**：`PIN_SHOTS=1` 跑 `scripts/smoke.mjs`；PIN 路径在钉呈现态之后调用
`Oracle.pinActors`——`01` 在看见行礼那一帧钉、`06` 随 `pinForShot` 钉、`07`/`08`
在站定 + 整点钉，`frame` 取整分处的自然帧 0。三跑各 13 张，主页面 144 项检查通过、
`01` 专用页面 12 项通过。

**三跑**：r1（与提交 `1d0052b` 内容相同的本地 canary）、r2、r3（merge 后的 `main`
工作树）。r1↔r2、r2↔r3、r1↔r3 三对由 `scripts/screens-diff.py` 配对。

| 文件 | r1↔r2（精确 / 可见 / 结构块） | r2↔r3 | r1↔r3 |
| --- | --- | --- | --- |
| `01-salute.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `06-faith.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `07-debug-panel.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `07-debug-panel-400ms.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `07-debug-panel-1s.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `07-debug-panel-filtered.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `08-overlay-100.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `08-overlay-200.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |
| `08-overlay-400.png` | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px | 0.00% / 0.00% / 0 px |

**不在本次口径内的四张**：`02-working` / `03-deliver` / `04-rain` / `05-build` 抓的是
「正在干活 / 交付 / 下雨 / 施工」的瞬时状态，三跑仍有非零差（精确 0.01%–3.91%，
最大结构块 80–5024 px）。它们不参与上面的 0 差结论，也不被五钉覆盖。

原始读数：`render-input/five-pin/diff-12.json`、`diff-23.json`、`diff-13.json`；
其余组（`four-*` / `five*` / `five-shift` / `trail-shift` / `dom-blank` / `altar-shift`）
的读数在 `render-input/<组>/screens-diff.json`，掩膜在同目录 `masks/`。

## 八、快照之外的呈现态（雨幕）

### 为什么之前漏了

第一节的表只回答一个问题：**`WorldSnapshot` 的每个字段画不画、怎么钉**。
雨幕的两个输入根本不在快照里，所以整张表看不见它们：

- `weather` 字段只到 `firefliesVisible(snapshot.weather)` 和状态行——它管的是
  晴天萤火可见性，**雨天雨幕不读它**；
- 雨幕浓淡来自 `sim.weatherIntensity()`（仿真派生值），雨滴相位来自
  `weather.ts` 内部按帧 delta 累加的 `elapsed`。

晴天时 `weatherIntensity()` 恒为 0（见「快照之外的 world 读数」三档 `0 / 0 / 0`），
三档 0 差把这条路径「看起来覆盖住了」；一旦下雨这个前提就失效。这不是表做错了，
是表只管快照——**快照之外还有一层呈现态输入**，此前没有任何测试逼它登记。

### 有哪些、谁读它

| 呈现输入 | 读它的函数 | 为什么不在快照里 | 钉法 |
| --- | --- | --- | --- |
| `weatherIntensity` | `weatherView.update`：雨滴三层 alpha（远 0.14+0.12·I、近 0.42+0.38·I、中 0.28+0.3·I）、压暗层、雾、水洼涟漪 | `sim.weatherIntensity()` 是连续派生值，冻结那刻实测 0.85～0.87 每次都不同 | `WeatherPin.intensity` 钉成常量 |
| `rainPhase` | 同上：150 颗雨滴的位置（`xs/ys`）与水洼波纹相位 | `weather.ts` 内部 `elapsed` 按帧 delta 累加，跑多少帧就推多远；同机位不同机器帧数不同 | `WeatherPin.frames` 钉成常量（固定步数） |

**分层**：这是**呈现态**，不是 `WorldSnapshot` 的第 26 个字段。`RENDER_INPUT_TABLE`
仍是 25 条（pin 4 / stable 10 / dom 11），第 21、22 条守卫一字未动；两条呈现输入
单独登记在 `PRESENTATION_INPUTS`（`weatherIntensity` / `rainPhase`），证据单列本节。

### 怎么钉

```ts
export interface WeatherPin {
  readonly intensity: number; // 冻结那一刻的浓淡（实测 0.85～0.87 → 钉 0.86）
  readonly frames: number;    // 从 __RAIN_SEED__ 重建后推进的固定步数（24）
}
```

- 入口并列、不改旧签名：`Oracle.pinWeather(intensity, frames)` / `unpinWeather()`；
  `pinShotState(nowMs, tideLevel)` 一个字符没动，`unpinShotState()` 无参连带解。
- **相位不靠墙钟**：钉住后 `weather.ts` 先 `setRainSeed(__RAIN_SEED__)` 重置 LCG、
  重建 150 颗雨滴的初始位置，再以固定步长 `1000/60 ms` 推进 `frames` 次
  （`rebuildToFrames`），之后每帧只 `paint`、不再累加。因此同一 `frames`
  在不同机器、不同帧率下得到**逐像素相同**的一帧；若继续用「按实际 delta 累加」，
  帧数不同的机器相位必然不同（跨组对照里那 0.115% 的主因之一）。
- 浓淡：`update` 读 `pin.intensity`，不读 `sim.weatherIntensity()`；雾密度
  `weatherFogDensity()` 由它派生，随之一起定住。
- 非法值（NaN / Infinity / 越界 / 非整数帧）整条丢弃、同值幂等；只解雨幕用
  `unpinWeather`，不会顺手抹掉时刻/潮位/角色/痕迹。
- 路由是静态断言的：`SandboxScene.renderSnapshot()` 必须写成
  `weatherView.update(…, this.shotPin.weather)`，测试第 24 条检索这一句，
  防止有人另接一条绕过钉的调用。

### 三跑 0 差（同机位雨景）

夹具 `scripts/check-rain-pin.mjs`：沿用 `capture-palette.mjs` 的三把锁
（`__RAIN_SEED__`、LCG 覆盖 `Math.random`、固定 rAF 帧计数/时间戳），第 30 帧按雨，
**第 240 帧**调 `Oracle.pinWeather(0.86, 24)`，第 241 帧停。三跑各拍一张。

| 配对 | 精确差 | 可见差 | 结构块 | 字节 / sha |
| --- | --- | --- | --- | --- |
| baseline-1 ↔ baseline-2 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** | 22435 B / `303eced7af05132e` |
| baseline-2 ↔ baseline-3 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** | 同 |
| baseline-1 ↔ baseline-3 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** | 同 |

三张 PNG 逐字节相同（sha256 前 16 位 `303eced7af05132e`），`screens-diff.py`
的 `identicalBytes: true`、`deltaHistogram` 全 0。

**跨引擎复核（2026-11-06，rebase 到 `430dd0d` = Phaser 4.2.1 之后重跑）**：同一夹具、
同一 `pinWeather(0.86, 24)`，三跑 sha 仍是 `303eced7af05132e`、bytes 仍是 22435，
与 rebase 前（Phaser 3.90.0）**逐字节相同**；两条扰动也原样复现
（`ec997a9dd9a84c4c` / `d54f2d2e263babc2`，读数同为 0.0964% / 40.96%）。
即补钉之后，Phaser 3 vs 4 的雨帧从「0.115% 判不了」变成**逐字节 0 差**——
差异确实来自未钉的呈现态，不是引擎。

夹具细节：轮询改成 `polling: 100`。脚本接管了 `requestAnimationFrame`，
Playwright 默认的 `raf` 轮询在最后一帧后拿不到回调，会等不到 `done`；这与判据无关，
但会让夹具假红。

原始读数：`render-input/rain-pin/diff-12.json`、`diff-23.json`、`diff-13.json`、
`diff-frame.json`、`diff-intensity.json`。

### 反向用例（必须判红，且红在被改的地方）

| 用例 | 改动 | 精确差 | 可见差 | 结构块 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `shift-frame` | `frames` 24 → **25**（雨滴相位错开一帧） | **0.0964%**（592 px），bbox `[30,144,779,501]` | **0.0964%** | **10 块**，最大 **80 px**（8×20）@ `[546,270,553,289]` | **判红** |
| `shift-intensity` | `intensity` 0.86 → **0.87**（浓淡改一点） | **40.96%**（251686 px），bbox `[0,0,959,639]` | 0.0000%（0 px） | 0 块 | **判红**（精确层） |

- `shift-frame` 的红全落在雨滴自身：10 个块都是 4×12 / 4×18 / 8×20 的雨线，
  旧帧那条已落下、新帧整体下移一行，色值在 `#929791` 与 `#404a45` 之间互换。
- `shift-intensity` 的红是**全画布精确差**：浓淡只改 alpha，每像素差值都 < 8
  （`deltaHistogram`：`ge8 = 0`、`ge32 = 0`），所以「可见层」按 8 级阈值看不见；
  但精确层 40.96% 判红。这条反向用例同时说明：**判据必须看精确层**，
  只看可见层会把整体淡变当噪声放过。
- sha：`shift-frame` `ec997a9dd9a84c4c`（22453 B）、
  `shift-intensity` `d54f2d2e263babc2`（22447 B），均与基线不同。

### 这解释了雨帧「判不了」，不是升级有问题

Phaser 3 vs 4 的跨组对照里，四个场景逐字节相同，只有雨帧跨组 0.115%；
而同组三跑本身抖动 0.068%～0.151%——0.115% 落在自己的噪声区间内，
既判不了「没变」也判不了「变了」。原因正是本节两条输入没钉：

- `weatherIntensity` 每次冻结落在 0.85～0.87 之间（跨组/同组各取各的值），
  按 `shift-intensity` 的读数，仅 0.01 的差就足以造成大面积精确差；
- 雨滴相位按实际跑的帧数走，跨组/同组各跑各的帧数，按 `shift-frame` 的读数，
  差一帧就是 0.0964%。

两者叠加即可到 0.1% 量级，与同组抖动同阶。引擎本身没问题——四个非雨场景逐字节
相同已经证明了同输入同输出。补钉后雨帧三跑 0 差、两条扰动稳定判红，这一帧才从
「判不了」变成「可判」，Phaser 4 升级的该组读数也才有意义。

验证入口：`scripts/check-rain-pin.mjs`（三跑 + 两条扰动）、
`test/pin-shot-state.test.ts` 第 24 条（25 字段表不变、实时 0.85/0.87 不影响画面值、
`PRESENTATION_INPUTS` 恰好两条、路由静态断言）与第 25 条（只解雨幕、非法整条丢弃、
同值幂等）。
