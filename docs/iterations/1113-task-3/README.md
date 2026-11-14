# 1113 迭代任务 3 · 造物主 EDD（Phase 1 / Phase 2 / P0 收敛）

> **状态：两阶段已交付，P0 收敛完成；main 10/10 + held-out 6/6 分组全绿，`npm test` 2651 项零退化。**
> 2026-11-13 收材料并核对 → Phase 1 落数据集/评分器/防假绿单测（红灯 0/10、0/6）→ Phase 2 落内环实现并收口。
> 三条阻塞决策已定（见「三条决策，已定」）。Godot 迁移讨论同日被用户叫停，**本项目未做迁移**。

## 这组资料讲什么

一份面向 EDD（评测驱动开发）的造物主施工单，两阶段：

- **Phase 1（红灯先行）**：先建评测集与评分器——主集 10 条（M1~M6 造物行为 + K1~K4 回归不变量）、保留集 6 条（H1~H4 边界 + V1~V2 环境变体），再加一组防假绿单测。此时跑评分器**必须红**，红灯就是这张单子的第一份证据。
- **Phase 2（内环实现与收口）**：确定性螺旋选址（`findDeterministicSlot`）、门口四方向 BFS 自动铺路（`planRoadToMainNetwork`）、脚手架施工生命周期接线渲染与存档、人工改位逆向合成空间规则、连续违规触发熔断降级。验收口径是 main 10/10 + held-out 6/6，且既有测试与类型检查零退化。

它把 `docs/iterations/1027-task-2/` 那批「外环设计」往「运行时真跑起来」推了一步：那一批定的是接口与自治等级，这一批定的是**怎么证明接口真的在工作**。

## 文件

| 文件 | 内容 | 能不能直接用 |
| --- | --- | --- |
| [creator-edd-plan.md](creator-edd-plan.md) | 原样收存的方案全文（现状盘点、7 步文件级明细、两份评测集 JSON 全文、4 条执行命令）。**唯一改动**：指向尚未新建文件的 16 处反引号被去掉——否则 audit-citations 会把「待新建的路径」判成幽灵引用；文字与结构未动 | 读，别照抄 |
| [drafts/eval-creator.mjs](drafts/eval-creator.mjs) | 评分器草稿：Playwright + 10 个 check 函数，强制走真实存档字节 | 草稿，未接构建路径 |
| [drafts/creator-eval.test.ts](drafts/creator-eval.test.ts) | 防假绿自检单测草稿：数据集规格、ID 不相交、check 函数存在性、V* 变体时刻不重合 | 草稿，未接构建路径 |
| [drafts/creator-scaffolding-buildings.ts](drafts/creator-scaffolding-buildings.ts) | 施工生命周期与脚手架渲染对接草稿：入账 / 升级 / 按逻辑拍推进 / 三层视图刷新 | 草稿，未接构建路径 |

## 开工前核对（2026-11-13，HEAD `b8fb4dc`）

计划的「现状盘点」**大体成立**：`world-client/src/world/creator/` 下确实有 schema、synthesizer、fuse、config、metrics、types、index 七个文件，`RuleSynthesizer`、`AutonomousFuseController`、`runBusinessRulesCheck` 都在，`render/buildings.ts` 确实拆成 back / container / front 三层且留了 progress 画布。

但有一批具体的字面出入，照原文直接施工会卡在第一步：

| # | 计划里的写法 | 仓库实情 | 后果 |
| --- | --- | --- | --- |
| 1 | 「`eval/interaction/` 已有主集 10 + 保留集 6，scripts/eval-interaction.mjs」 | `eval/` 下只有 fixtures、live、screens；全仓没有 interaction 评测集，也没有那个脚本 | 「对照现有评分器」没有对照物；`when-api.ts` 只等 `window.Oracle`，不是评测桥 |
| 2 | Step 7「暴露 `dispatchCreatorCommand` / `applyHumanDiff` / `exportSaveBytes`」 | 三个名字全仓零命中；`window.__PIXEL_WORLD_DEBUG__` 也不存在 | 不是「暴露」而是**从零建桥**；而评分器每条 check 与单测第 4 条都硬依赖它 |
| 3 | Step 6「与 work-smoke.ts 联动」 | 没有这个文件；现有的是 `render/smoke.ts` 与 `world/smoke-motion.ts` | 联动点要重新选 |
| 4 | 「`creator/config.ts` 已声明门禁指标 `pathfindingConnectivity: 1.0`」 | 实键名是 `pathfindingConnectedRate`，挂在 `AUTONOMY_CLIMB_CONFIG.LAYOUT_AND_BUILDING.gateRequirements` 下 | 名字对不上；且那是**升级下限**不是观测值，`config.ts` 头注释专门解释过这个区分 |
| 5 | 评测集 input 用 `prefabId` / `region` / `origin` / `autoConnectRoad` | `PlaceBuildingCommand` 是 `templateId` + `at` + `orientation` + `purpose` | 17 条数据集的载荷形状对不上，得先改数据集或先扩 schema |
| 6 | M4 用 `UpgradeBuilding` | 五条白名单是 CreateRegion / PlaceBuilding / SpawnCharacter / SeedHistory / InjectEvent；`GENESIS_COMMAND_KINDS` 的注释写着「别处引用它来断言没有第六种」 | 要么改数据集，要么先动白名单——后者是**决策**，要碰 SPEC 与 `server/rules/schema.py` |
| 7 | env 用 `phase` / `seed` / `art` / `tide` | 页面认 `time=`（`parsePhaseParam`）、`debugPinSeed`、`debug` / `now` / `feed` / `world`；`art` 与 `tide` 两个参数在 `src/` 里没有消费方 | K2（`?art=0` 零图片请求）与 V1（夜间高潮位）按现在的 URL 契约跑不起来 |
| 8 | 「最新断点 54e625c」 | 实际 HEAD `b8fb4dc`（2026-11-09） | 只是旧读数，不影响施工，但别照着它判断基线 |
| 9 | 别处写存档 `schemaVersion` 5 | `CURRENT_SCHEMA_VERSION = 6` | K4 的「保持不变」方向对，算式要按 6 |

两处待核，不当成结论写：

- 计划说「既有 2714 项测试」。**2026-11-13 实测：`npm test` 是 2642 项（0 失败 / 9 skip），加本项目 4 条之前是 2638。** 所以 2714 是旧读数，不是笔误；照它写验收标准会核错。
- 计划给的单测命令是 `node --import tsx`，而 `tsx` 不在 devDependencies 里。仓库的跑法是 `node --import ./test/phaser-hooks.mjs --test "test/**/*.test.ts"`，新单测放进 `test/` 会被它自动收走。

## 三条决策，已定

1. **调试桥新开一个全局，不扩 `window.Oracle`。** 名字用 `window.__PIXEL_WORLD_DEBUG__`，**只在 `?debug=1` 下挂载**。
   理由：`window.Oracle` 是玩家与面板的 API，挂载时还要过十个接口子集的交集核对；把五个测试方法挂上去就是放宽生产面。
   双下划线调试全局在本仓有先例（`__RAIN_SEED__`、`__CAPTURE_STATE__`），名字不是新造的。
2. **`UpgradeBuilding` 不进白名单。** 它只是调试桥的内部动作；五条创世指令与服务端规则层一律不动。
   理由：白名单是 **LLM 的合法域**，调试桥是 **验收面**。混在一起，第一次为了测试放宽参数，LLM 能做的事就跟着变宽了。
   将来「原地升级」若要成为玩家动作，那是独立决策（要动 SPEC 的命令清单与两份清单），不夹带在这一单里。
3. **环境契约只认页面真有的参数。** `world` / `now`（分钟）/ `phase`（页面参数叫 `time`）/ `feed` / `debug` / `seed`（页面参数叫 `debugPinSeed`）；
   **删掉 `art` 与 `tide`**：K2 改成直接断言「页面零图片请求」（全仓无 `load.image`，这一条结构上恒成立，当棘轮用）；
   V1 的高潮位改用 `setup` 注入 `SetTide`。数据集因此多了一个字段：`setup`（检查前按序执行的桥命令）。

## Phase 1 交付与读数（2026-11-13）

| 文件 | 内容 |
| --- | --- |
| `world-client/eval/creator/main.json` | 主集 10 条（M1~M6 + K1~K4） |
| `world-client/eval/creator/held-out.json` | 保留集 6 条（H1~H4 + V1~V2），V1 夜晚 / V2 清晨 |
| `world-client/scripts/eval-creator.mjs` | 评分器：Playwright + 10 个 check，每条都过 `exportSaveBytes` → `inspectSaveBytes` |
| `world-client/test/creator-eval.test.ts` | 防假绿自检 4 条（数据集规格 / 环境五要素 / check 真实实现 / V* 开局不重合） |
| `world-client/package.json` | **最终未改**：Phase 1 曾加 `test:creator-eval`，第二笔发现 `audit-orphan-gates` 会把它判为「新孤儿（未登记）」，已移除。评分器直接用 `node scripts/eval-creator.mjs` |

读数：

| 闸门 | 结果 |
| --- | --- |
| 防假绿单测 | **4/4 绿** |
| 评分器 main（隔离 dev 服 5299） | **0/10，exit 1**——10 条全失败在同一句「调试桥在 8000ms 内没有挂上」 |
| 评分器 held-out | **0/6，exit 1**——同上 |
| `npm test` | **2642 项 / 0 失败 / 9 skip** |
| `npm run check` | 语法 0 / 语义 0 |
| `audit:ports` / palette / claims / citations / sections / references | 全绿 |
| `npm run red:first` | **当时红**：`test/baseline-manifest.test.ts`（上一次提交带进来的）在旧 HEAD 上「base 上已经绿」；新测试尚未跟踪、不在它的 diff 里。这一项是拆两笔提交后才真正覆盖的，见「提交拆分与 red-first 证据」 |

红灯的**理由**比红灯本身要紧：失败落在「桥没挂上」，而不是「选择器错了」「断言写错了」。
Phase 2 的全部工作就是把这一条变绿，且不许动任何一条既有闸门。

## Phase 1 顺手修掉的两个自身缺陷

两个都是「看起来成功了」的那种，值得记下来：

1. **脚本空跑、退出码 0。** 入口判据写成 `import.meta.url === \`file://${process.argv[1]}\``，在 Windows 上恒假（`D:\\...` vs `file:///D:/...`），于是评分器什么都不做、退出 0。改成 `pathToFileURL` 比较，并补了一条「一条用例都没跑也是失败」。
2. **单条用例失败会中止整轮。** `openPage` 原本在 `try` 外面，桥没挂上时它抛出的错直接打断循环，十份报告缩成一条栈——读起来像评分器坏了，而不是世界没实现。现在每条用例独立收口。

## 施工时不得碰的四条既有门禁

- **24 色板**：草稿里有 5 个硬编码 `0x` 常量（竹木 / 绳结 / 进度条），`audit-palette.mjs --strict` 会拦；脚手架颜色必须走调色板 token。
- **三层深度与建筑烘焙**：`render/buildings.ts` 的 back / container / front 三层是截图校验过的锚点（门底贴墙底、台阶不被前檐横穿），另有一道 72 张 building-bake 门禁。
- **存档 schemaVersion**：字段一变就要升版本 + 写迁移，指纹测试会拦。
- **端口纪律**：新评分器只连接不监听；按 5211 这一段的约定取端口，别在脚本里写死禁用的那四个。

## 执行命令

```bash
cd world-client
# 1. 防假绿自检（毫秒级，不启浏览器）
node --import ./test/phaser-hooks.mjs --test test/creator-eval.test.ts
# 2. 起隔离 dev 服（别撞正在用的 5211）
PIXEL_WORLD_CLIENT_PORT=5299 npm run dev
# 3. 另一个终端跑评分器；Phase 2 完成前它必须红
EVAL_BASE_URL=http://127.0.0.1:5299/ node scripts/eval-creator.mjs --split=all
```

## Phase 2 交付与读数（2026-11-13）

| 文件 | 内容 |
| --- | --- |
| 自研螺旋选址 + 门口 BFS（spatial-executor，**P0 已删**） | 改认生产 `WorldGrid.findBestSlot` / `grid.path` / `paveFrom` |
| `world-client/src/world/creator/audit-state.ts` | 施工台账、空间规则、熔断读数、指标计算；可序列化，按逻辑拍推进 |
| `world-client/src/world/creator/debug-bridge.ts` | `window.__PIXEL_WORLD_DEBUG__`：dispatch / stepTicks / exportSaveBytes / inspectSaveBytes / reloadFromBytes / stateHash / gridSnapshot |
| 脚手架楼体视图（creator-scaffolding-buildings，**P0 已删**） | 改认生产 `decor.syncScaffolds` + `drawScaffolds`（由 `snapshot.constructions` 驱动） |
| `world-client/src/scenes/SandboxScene.ts` | `?debug=1` 下用**动态 import** 挂桥并做施工视图联动；生产主 bundle 不含调试桥 |
| `world-client/scripts/eval-creator.mjs` | 补 `heldout` 别名、H2 绕行断言、K4 真落盘断言、K3 双干净 context |

接线覆盖：`Simulation.enqueue({kind:'build'})` 真落楼 → `sim.update(100)` 按逻辑拍结算 → `SaveStore.write/readRawText` 真存档字节 →
`RuleSynthesizer` 逆向合成 → `AutonomousFuseController` 双向熔断 → `syncBuildingConstructionView` 渲染联动。

读数：

| 闸门 | 结果 |
| --- | --- |
| 评分器 `--split=all` | **16/16 通过，exit 0**（main 10/10、held-out 6/6） |
| 防假绿单测 | 4/4 绿，且已并入 `npm test` |
| `npm test` | **当时 2642 项 / 0 失败 / 9 skip**（P0 之后为 2651 项，见下节） |
| `npm run check` | 语法 0 / 语义 0 |
| `npm run build` | 通过（动态 import 多一个 chunk，Vite 仅提示体积告警） |
| `audit:ports` / palette / claims / citations / sections / references | 全绿 |
| `server` 的 `python -m pytest` | 退出码 0 |
| `npm run red:first` | **绿**：拆两笔提交后，`--base <Phase 1 sha>` 与默认 `merge-base(HEAD, origin/main)` 两种口径都报 `PASS base 上按预期红（断言失败，exit=1）` / `RESULT=RED` |

### 三处「绿得可疑」被补实

第一遍跑出 16/16 之后复查，发现三条断言太宽，全部收紧后重跑仍全绿：

1. **H2 曾经是假绕行**：障碍种在门口旁边，BFS 碰巧没经过，路径与 M2 一模一样（4 格）。
   改成「先算无碍最短路 → 把它的第二格封成岩石 → 再铺路」，并在评分器里断言
   障碍确实存在、路径不穿障碍、`pathLength > straightDistance`。现在读数 6 格。
2. **K4 曾经只记了台账**：`sim.enqueue(build)` 被 `build()` 的「这种铺子已经有一栋了」静默拒绝，
   楼只活在台账里。加上「新楼 instanceId 必须出现在 `exportSaveBytes()` 的 `world.buildings` 里」后当场红，
   改用「世界里还没有同款的真蓝图 + `checkPlacement` 整块终审」才变绿。
3. **K3 曾经两次开局不同**：`page.reload()` 触发 `pagehide` 写档，第二次读到的是已经建过楼的存档。
   改成两个独立 browser context 各开一次干净页面。

### 一条设计取舍，写清楚免得后人踩

计划要求把 `creatorRules` / `fuseState` 写进存档，同时 `schemaVersion` 保持不变——**这两句在本仓不能同时成立**：
`SAVE_V6_PATH_SET` 是冻结路径集合，加一个键会被 `assertSave` 按「字段漂移」拒；要加就得升 v7、写迁移、
换冻结指纹与 `docs/save-v6.sample.json`、改一批指纹测试。而这两个字段记的是**外环审计**（哪条规则被人工否决、
熔断器处在什么等级），不是玩家世界的地形与人物，`docs/OPEN_ISSUES.md` 本来就把「外环状态跨会话持久化」列为未落地项。

所以采用**审计侧车**：桥把台账写进独立的 localStorage 键，`exportSaveBytes()` 把真存档原始字节与它打成一个包。
存档本体只读不改，`schemaVersion` 恒等（K4 判的是「起停前后相同」，实测 v6 → v6）；
新造的楼则通过 `SaveStore.write()` 真写进 `world.buildings`。**没有放宽任何一条断言来换绿。**

### 五处碰了既有纪律，逐个改掉（不是放宽闸门）

| 报错 | 修法 |
| --- | --- |
| `purity`：world 层不能出现 `ledger` 一词 | 文件改名 `audit-state.ts`，变量名全改 |
| `purity`：world 不 import 上层 | 去掉 `SaveStore` 类型 import，改成本地 `SavePort` 结构端口 |
| `pack-owns-world-data`：预制体 id 归配置包 | 评测蓝图只存「按 id 排序后的位次」，代码里不写死 id |
| `audit-citations`：幽灵引用 work-smoke.ts | 去掉反引号（那份名字来自外部草稿，仓里没有这个文件） |
| `audit-references`：两处 `SandboxScene.ts:NNN` 漂移 | **不修文档**：把桥改成动态 import、去掉新增字段，文件前部行数不变，行号引用自动恢复 0 存疑 |
| `repo-harness`（CI）：`audit:orphan-gates` 报 `npm:world-client#test:creator-eval` 是「新孤儿（未登记）」 | 删掉那个 `test:` 前缀的 npm 脚本。`eval-creator.mjs` 不以 `check-`/`audit-` 开头，本来就不在扫描面里；评分器仍可直接 `node` 跑，允许清单与四类预算一个数没动 |

## CI 上的一次红

PR 开出来后 `repo-harness` 13 秒就红了，本地 `npm run audit:orphan-gates` 复现为
「[新孤儿（未登记）] 1 → `npm:world-client#test:creator-eval`」。原因是那个新建的
`test:` 前缀脚本没有 workflow 消费方。修法见上表；修完本地读数
「清单：允许 38 条，孤儿 38 条 / 0 未登记」，四类预算仍是 29/2/6/1。
这一条没有通过往允许清单里塞条目或改预算消红。

## 提交拆分与 red-first 证据

按「先红后绿」的验收口径拆成**两笔提交**，中间不夹带实现：

| 笔 | sha | 内容 |
| --- | --- | --- |
| 1 | `8487ab7503cddd86d03b32645554b54daa756c52` | EDD 评测面：两份数据集、评分器、防假绿自检。单独看这一笔，跑评分器是 0/10 与 0/6 |
| 2 | 见 `git log -1` | 内环实现 + 4 条内核单测 + 外部材料收存 + 索引登记 |

`red-first` 只把 `world-client/test/` 的 diff 套到 base 上，所以第二笔里必须有一个**依赖 `src` 实现、且缺了会红在断言上**的新测试：
`test/creator-runtime.test.ts` 用动态 `import()` 取模块，只吞「文件不在」，模块写坏则原样抛。
四种口径实测：

```text
npm run red:first -- --base 8487ab7503cddd86d03b32645554b54daa756c52
  → files=test/creator-runtime.test.ts
  → PASS base 上按预期红（断言失败，exit=1） / RESULT=RED / exit 0

npm run red:first
  → base=b8fb4dc source=merge-base(HEAD, origin/main)
  → files=test/creator-eval.test.ts, test/creator-runtime.test.ts
  → PASS base 上按预期红（断言失败，exit=1） / RESULT=RED / exit 0
```

原先那道红（`test/baseline-manifest.test.ts` 在旧 HEAD 上「base 上已经绿」）在拆两笔之后不再出现——
它属于更早的一笔提交，不是被本单修好的，也没有通过放宽脚本口径来抹掉。

## P0 收敛（2026-11-13，真链路取证之后）

### 起因

按上游概念回头核对，发现两件事：**造物主在生产里本来就能工作**（`findBestSlot` / `paveFrom` /
`CONSTRUCTION_MS` / `decor.syncScaffolds` / `drawScaffolds` 全已有），而本项目前两笔提交
另外造了三套平行实现；同时真链路取证显示 `Oracle.build`（神谕/上游路径）的
`creatorChecks` 全程 0，只有手动造物那条路会 +1。评测守着平行实现、门禁只覆盖一条路径，
这两条比"再加个功能"更该先修。

查实的 16 条里有 6 条测的是**生产根本不存在的能力**：M4 原位升级、M5 逆向规则、
M6 熔断注入、H1 满载、H2 门口障碍、H4 熔断恢复。所以「全改读生产真值」不成立，
硬改会把规格测试伪装成生产验收。

### 红灯

`test/creator-production-truth.test.ts`：4 条红在断言（`testCodeFailure`）、1 条生产锚点绿。
断言的是「平行实现必须消失」「台账不再数施工拍」「评测集必须按 mode 分组」「生产真入口还在」。

### 动作

| 文件 | 动作 |
| --- | --- |
| spatial-executor 与 creator-scaffolding-buildings 两个文件 | **删** |
| `SandboxScene.ts` | 去掉脚手架动态 import 与 `onConstructionTick` 回调，只留挂桥 |
| `audit-state.ts` | 删 `constructionTicksRemaining` / `tickBuildingConstruction` / `constructionReadout`，只剩评测会话状态与从建筑形状算指标的纯函数 |
| `debug-bridge.ts` | 降为「生产存档字节的只读适配器」：落位只 `sim.enqueue(build)`，读数全部来自 `world.buildings / roads / constructions / now`；连通性问 `doorReaches`，分区问 `grid.zoneOf` |
| 两份数据集 | 16 条加 `mode`：**production 10 条**（M1 M2 M3 K1 K2 K3 K4 H3 V1 V2）/ **spec 6 条**（M4 M5 M6 H1 H2 H4） |
| `eval-creator.mjs` | 报告按组标注与分列；`placedRegion` 改由生产网格给出（之前是回显 input，属于假绿）；H2 断言换成生产契约 |
| `creator-runtime.test.ts` | 改测生产 `findBestSlot` / `paveFrom` / `doorReaches` / `CONSTRUCTION_MS` |

### 两处口径变更，写清楚免得被当成放宽闸门

1. **H2** 旧的 `pathLength > straightDistance` 卡的是本仓曾经那套平行 BFS 的绕行长度。
   收敛后道路是生产 `grid.path` 的存档增量，长度由生产算法决定，旧尺子不适用。
   现改为：障碍真种进生产 `WorldGrid`、`存档新增道路格`不穿障碍、`doorReaches` 仍判连通。
   **代价说清**：H2 现在验的是「有障碍时仍能铺出连通路」，不再验「比直线长」；
   要精确验绕行，得按预测门口位置种植障碍，属于 spec 组后续增强。
2. **M1** 的 `placedRegion` 从「回显 `input.region`」改成 `grid.zoneOf(落位结果)`。
   前者永远为真，是这一轮自己抓出来的假绿。

### 读数

| 闸门 | 结果 |
| --- | --- |
| 新红灯 | **5/5 绿** |
| `npm test` | **2651 项 / 0 失败 / 9 skip** |
| 评分器 `--split=all` | 生产组 **10/10**、规格组 **6/6**，合计 16/16 |
| `check` / `build` / 六道审计 / `audit:orphan-gates` / `pytest` | 全绿 |

### 仍未取证的

外环**跨日提议**需要 `stepCreatorDayClosed` + 至少两个 14 世界日窗口；`speed=1` 下
一个世界日 = 24 小时现实时间。本轮没有伪造这个读数。要取它得另写一条按逻辑拍快进的
无头回放（复用 `src/trace/replay.ts`），是单独一单。

## 相关

- 定位与体验判据：`docs/DESIGN_ACCEPTANCE.md`（现有 8 条是视觉判据，行为判据还没写进去）
- 外环既有设计与实现状态：`docs/iterations/1027-task-2/README.md`
- 存档冻结集合与字段漂移判据：`world-client/src/world/save.ts`
- 上游愿景文本（本仓不收）：`AI原生像素个人助理世界架构设计`，现在只在 Downloads 里
- Godot 迁移：2026-11-13 讨论过六类边界，用户随后决定「先不走迁移路线，保持现状」，**未落 ADR、未建目录、未改引擎**
