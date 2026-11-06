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
| 单测 | `npm test` | tests 2388 / pass 2379 / fail 0 / skipped 9 |
| 构建 | `npm run build` | dist 1,766.48 kB（gzip 500.91 kB），647ms |
| 调色板 | `node scripts/audit-palette.mjs --strict` | 通过，退出 0 |
| 行号引用 | `node scripts/audit-references.ts --strict` | 173 处，0 存疑 |
| 引用存在性 | `node scripts/audit-citations.ts --strict` | 3048 处，未解析 0 |
| 节号 | `node scripts/audit-sections.ts --strict` | 159 处，全部对得上 |
| 断言/ADR | `node scripts/audit-claims.ts --strict` | claims 5/5，ADR 10/10 |
| 服务端 | `python -m pytest` | 553 passed / 1 skipped |
| 工作树 | `npm run worktrees:audit -- --strict` | **红**：仓库级历史状态（2 未登记、3 过期），与本分支无关 |
| 负控 | `node scripts/check-shot-actor-pin.mjs` | 三档逐字节全同；两条反向全异 |
| 像素 | `scripts/screens-diff.py` 七组配对 | 见第二、三节 |
| 浏览器 | `test:browser` / `test:phases` / `test:persistence` / `test:render-budget` / `test:setting` | 全绿（smoke / 四刻 34 项 / 持久化 8 项 / 渲染预算 6 项 / 设定集） |

开发服务器端口 5211（避开 5188 / 5191 / 5202 / 5203）。浏览器闸门写出的
`eval/screens/*.png` 已用 `git checkout -- world-client/eval/screens` 还原，未夹带进提交。
原始读数在 `render-input/<组>/screens-diff.json`，掩膜在同目录 `masks/`。
