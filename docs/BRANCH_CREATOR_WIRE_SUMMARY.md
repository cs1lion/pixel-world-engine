# 外环造物接线分支：变更摘要

面向要审阅/合入这条分支的人。目标是让没跟过这轮对话的人能判断：**这批改动解决了什么、哪些预期被改过、还有什么没验到。**

- 分支：`feat/creator-engine-wire`
- 写作快照：`4d4e309`（之后仅追加 docs 提交，代码未变；最终 HEAD 见报告）
- 与 `main` 的起点（merge-base）：`ef4d6ff`
- 规模：**13 笔提交**，`git diff --stat main...HEAD` 为 **41 个文件，+4663 / -429**
- 完整问题清单见 [OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md)；本文只讲“这批改了什么、能不能看懂”。

## 一、提交列表（`git log main..HEAD`，按时间正序）

| # | short hash | 提交主题 |
| --- | --- | --- |
| 1 | `ebda956` | docs: 状态描述对齐代码，去掉与实现不符的声明 |
| 2 | `821ec25` | feat(save): 记忆进存档——world.memory 升 v5，写回接上自动存档节流 |
| 3 | `3beff11` | refactor(creator): 外环先拆假时钟与假指标——种子与时间由世界注入 |
| 4 | `bfd8b3c` | fix(creator): 色板按世界传入，两套造物 schema 合成一份解析 |
| 5 | `c26d6f8` | feat(creator): 造物引擎进生产路径——场景驱动，计划经 Simulation 的既有入口落地 |
| 6 | `eed975c` | docs(creator): 架构文档的集成接口与测试表对齐接线后的代码 |
| 7 | `6cabd93` | feat(creator): 落地后补两项真观测——门口可达与回放指纹，门禁能推到 L3 |
| 8 | `2b78cf9` | docs(creator): 补一份面向第一次接触者的外环讲解文档 |
| 9 | `fb187e1` | feat(creator): 落地后真跑业务规则——冲突与不变式有了分母，L2 不再白送 |
| 10 | `f8cd2d1` | feat(creator): 覆盖率每次造物现算一次——拆掉再建同一模板也能解除 L1 卡死 |
| 11 | `e3fc21a` | fix(smoke): 对齐期望改用视野原点，存档版本号不再写死 |
| 12 | `6cec3d7` | feat(oracle): 暴露外环指标窗口的只读计数 |
| 13 | `4d4e309` | fix(scripts): 造物落点换算走视野原点，抽共享投影 |

## 二、逐笔说明：解决了哪条问题、改了什么、怎么验

### 1. `ebda956` 文档状态对齐（不是功能改动）

- 问题：README / `SETTING_DENGCHAO` / `memory/index.yaml` 头部有几处与实现不符的声明（例如“引擎不在仓库”“存档仍 v3”）。
- 改动：只改状态性描述，补核对日期，不碰代码。
- 验证：文档审阅；后续代码改动以实际测试为准。

### 2. `821ec25` 记忆进存档（对应“记忆随存档往返”）

- 问题：记忆层此前只在内存里，刷新即归零。
- 改动：`CURRENT_SCHEMA_VERSION` 升到 5，新增叶子路径 `world.memory`（带 `memorySchemaVersion` 的 JSON 字符串）；`MemoryRuntime.toJSON()/fromJSON()`；`Simulation.toSave(memoryState?)` 搬运；场景三处存档传记忆；`memoryClient` 队列在自动存档节流后 flush。
- 关键位置：[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L413-L423)、[runtime.ts](file:///D:/project/pixel-world-engine/world-client/src/world/memory/runtime.ts#L246-L278)、[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L1955-L2010)。
- 验证：记忆存读逐字段、v4→v5 迁移、写回节流测试；浏览器实测 `saveNow → 刷新` 后 `world.memory` 8868 字符、条目 `m_0001` 原样保留。

### 3. `3beff11` 拆假时钟与假指标（对应“假指标”）

- 问题：`fuse.ts` 读 `Date.now()`；`submitHumanApproval` 给覆盖率/寻路/碰撞/溯源/回放写死“达标”，门禁永远有满分证据。
- 改动：时间与种子由调用方注入；人工确认只记“真点头”和“真量到”的项；`config.metrics` 改名 `gateRequirements`，把“要求”与“观测”分成两个名字。
- 关键位置：[fuse.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/fuse.ts#L459-L503)、[engine.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/engine.ts#L345-L360)。
- 验证：`creator-engine` / `creator-fuse` / `creator-config` 测试更新；后续门禁测试从“人工确认即满分”改为“没测就是 null”。

### 4. `bfd8b3c` 色板按世界传入（对应“色板解析”）

- 问题：`creator-schema.ts` 自己读点/查 24 色，用的是全局 `WORLD`；灯潮界与莞尔镇同名不同色会解析错。
- 改动：两套造物 schema 合成一份 `readPlaceBuilding`；色板改为显式 `WorldPalette` 参数，`parseCreationPlan` / `tokenNameOf` 都必填。
- 关键位置：[schema.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/schema.ts#L370-L390)、[creator-schema.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator-schema.ts#L41-L56)。
- 验证：灯潮界 token 解析、模板配色反查、两套世界共用 token 闭集的测试。

### 5. `c26d6f8` 引擎进生产路径（对应“接线”）

- 问题：`CreatorEngine` 只活在测试里，“外环自己造物”在生产路径上是假的。
- 改动：场景创建引擎，传入场景这一份 `BuiltWorld`、设定集 id 作种子、`snapshot.now` 作时钟；人工造物走 `proposeCreation` 后仍由 `Simulation.enqueue({kind:'build'})` 落地，没有第二条写世界通道；跨日调用 `closeWorldDay/processDayClosed`；只有熔断器 `allow` 才自动提议。
- 关键位置：[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L780-L785)、[engine.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/engine.ts#L442-L520)。
- 验证：`creator-wire.test.ts` 覆盖只补缺、同输入同计划、经 enqueue 真落地、同种子两次回放一致、L0 不自动建造。

### 6. `eed975c` 架构文档对齐

- 问题：架构文档还把引擎写成“不在仓库/过不了 check”。
- 改动：集成接口改成实际调用形状，补 `creator-wire.test.ts`，勾掉两项待办、写明未做的两项。
- 验证：文档审阅。

### 7. `6cabd93` 落地后补两项真观测（对应“观测补全”）

- 问题：门口连通与回放一致在落位前算不准，之前要么是假值，要么没有值。
- 改动：新增 `landing.ts`：`landingReachable` 用落地后的真实网格；`verifyCreationReplay` 用落地前冻结的 view 重跑计划比指纹；`freezeCreatorView` 把落位许可冻成位图；场景登记 pending，由 `building.built` 触发 `settleCreationObservation`，被拒的建造不记。
- 关键位置：[landing.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/landing.ts#L36-L118)、[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L1099-L1148)。
- 验证：`creator-landing.test.ts` 8 条（可达/围死/判定晚于落地/回放一致/篡改计划/篡改落地/不可跑 null）+ L2→L3 推进测试。

### 8. `2b78cf9` 讲解文档

- 问题：外环概念多、链路跳，第一次接触的人看不懂。
- 改动：新增 `docs/CREATOR_EXPLAINED.md`，按“目标 → 概念 → 三条链路 → 逐函数 → 易错点 → 后续方案”讲，带 Mermaid 与具体数字。
- 验证：文档审阅（`audit-sections` 等）。

### 9. `fb187e1` L2 门禁不再白送（对应“L2 门禁”）

- 问题：`conflictCount <= 0` 在没有分母时白送；`checkInvariants` 对建筑分支从未被调用。
- 改动：新增 `checkLandedBuilding`，用真实快照与网格折成 `WorldStateView`；实现五条不变式；`MetricWindow` 增加 `conflictChecks` / `invariantChecks`（`undefined` 不碰分母，`false` 才 +1）；L2 门禁“分母为 0 直接拒”。
- 关键位置：[business-rules.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/business-rules.ts#L54-L140)、[fuse.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/fuse.ts#L645-L654)。
- 验证：`creator-business-rules.test.ts` 覆盖正常落地（0 是“查过且为零”）、没查不放行、重叠冲突不放行、压住摆件的不变式违反不放行。

### 10. `f8cd2d1` 覆盖率死锁解除（对应“覆盖率死锁”）

- 问题：升级清零窗口后 `coverageRate = null`；灯潮界模板已全部落地、没有下一次可观测造物，L1→L2 结构上卡死。
- 改动：不再在登记 pending 时缓存覆盖率；`settleCreationObservation` 在落地后用当时快照现算“已落地模板数 / 模板总数”，每次造物都产生新观测；同模板拆掉再建也 +1 次 checks；门禁阈值与“清零”语义不变。
- 关键位置：[business-rules.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/business-rules.ts#L54-L70)、[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L1130-L1146)、[creator-business-rules.test.ts](file:///D:/project/pixel-world-engine/world-client/test/creator-business-rules.test.ts#L422-L521)。
- 验证：死锁解除、不能白送、观测真实性（3/10 = 0.3）三组测试。

### 11. `e3fc21a` smoke 过期期望（对应“smoke 过期期望”）

- 问题：overlay 期望坐标按 `(world - scrollX) * scale` 算，而生产用视野原点并乘相机 zoom；`zoom=2` 偏半个视野。顺带暴露“单槽里是 v3 JSON”也已过期（当前 v5）。
- 改动：期望值改走 `viewOriginOf` 等价式；补 `zoom=1` 真实滚轮断言；存档版本断言改为与运行时 `saveStatus().schemaVersion` 对齐，不写死版本号。
- 关键位置：[smoke.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/smoke.mjs#L68-L110)、[smoke.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/smoke.mjs#L312-L345)、[smoke.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/smoke.mjs#L793-L801)。
- 验证：`npm run test:browser` 由“13 项后中断”变为 **124 项全通过**。

### 12. `6cec3d7` Oracle 只读计数（对应“Oracle 只读计数”）

- 问题：四项计数只能靠临时插桩读，浏览器无法直接取证。
- 改动：`CreatorChecksView` + `DebugOracle.creatorChecks()`；从 `mapper` 的当前 `MetricWindow` 现取，返回新对象、无 setter；外环不存在时返回 `null`（不用全 0 冒替）；`OracleSurfaces` 交集检查保持。
- 关键位置：[debug-panel.ts](file:///D:/project/pixel-world-engine/world-client/src/ui/debug-panel.ts#L187-L228)、[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L2297-L2318)。
- 验证：真实浏览器造一栋楼，四项各 `0→1`、`coverageChecks=1`；改返回对象后重读仍为 0。

### 13. `4d4e309` 脚本坐标换算（对应“脚本坐标换算”）

- 问题：`check-creation.mjs` 用 `cam.scrollX/scrollY` 直接换算鼠标落点，`zoom≠1` 时偏半个视野。
- 改动：抽 `scripts/lib/camera-projection.mjs`（与生产 `viewOriginOf` / `projectWorldToCanvas` 同式），smoke 与 check-creation 共用；check-creation 新增 `zoom=1/2/3` 的真实落点断言，探测格故意不居中。
- 关键位置：[camera-projection.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/lib/camera-projection.mjs#L18-L45)、[check-creation.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-creation.mjs#L46-L75)、[check-creation.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/check-creation.mjs#L160-L212)。
- 验证：实测旧公式 `zoom=2` 偏 144.89 CSS px / 2 格，`zoom=3` 偏 289.77 px / 3 格；改后 17 项 `check-creation` 全过，三种倍率命中同一格。

## 三、行为变更导致的预期变化（区分“修好了”与“改松了”）

| 变化 | 改过的测试/断言 | 位置 | 为什么不是放水 |
| --- | --- | --- | --- |
| 结构性卡死从“预期卡死”改成“已解除” | `creator-business-rules.test.ts` 的死锁用例 | [L422-L488](file:///D:/project/pixel-world-engine/world-client/test/creator-business-rules.test.ts#L422-L488) | 行为改变导致预期改变；测试注释已写明“不是为了让测试变绿”。门禁阈值、清零语义未动 |
| 存档版本断言从 `v3` 改成“与运行时一致” | smoke 的“单槽里是 vN JSON”；save 系列测试 | [smoke.mjs L793-L801](file:///D:/project/pixel-world-engine/world-client/scripts/smoke.mjs#L793-L801)、[save-fingerprint.test.ts L91-L112](file:///D:/project/pixel-world-engine/world-client/test/save-fingerprint.test.ts#L91-L112) | 版本升到 v5 是契约变化；断言改成“当前版本”而不是某个历史数字，没有放宽容差 |
| 人工确认不再自动给五项满分 | `creator-engine` / `creator-fuse` 观测相关用例 | [engine.ts L345-L360](file:///D:/project/pixel-world-engine/world-client/src/creator/engine.ts#L345-L360) | 从“假值 1.0”改为“没测就是 null/不记”，门禁更严，不是更松 |
| L2 门禁从“>0 才拒”改成“没分母直接拒” | `creator-business-rules` 的门禁用例 | [fuse.ts L645-L654](file:///D:/project/pixel-world-engine/world-client/src/world/creator/fuse.ts#L645-L654) | 收紧：没查过不再等于零冲突 |
| 色板从全局常量改为显式参数 | `creator-schema` / `creator-commands` / `creator-metrics` 的入参 | [schema.ts L370-L390](file:///D:/project/pixel-world-engine/world-client/src/world/creator/schema.ts#L370-L390) | 是 API 形状变化（调用方必须给色板），不是断言变松 |
| overlay 容差 | 未改，仍是 `max(1, scale)`；新增 `zoom=1` 断言 | [smoke.mjs L104-L109](file:///D:/project/pixel-world-engine/world-client/scripts/smoke.mjs#L104-L109) | 只改期望值的换算来源，没有放大容差 |
| 测试总数变化（1853 → 1879） | 新增测试，非阈值变化 | 全量 `npm test` | 1870 通过 / 9 跳过是新增用例后的结果；原 9 条 `KNOWN_FAILING` 跳过未动 |

## 四、没有验证到的部分

1. **浏览器里的 14 天晋级。** 默认 `timeScale=6` 一世界日约 4 小时真实时间，`?speed=60` 也只是 24 分钟/日；一个 14 天窗口约 5.6 小时，L0→L1→L2 要两次。改写存档 `world.now` 可以让 `stepCreatorDayClosed` 连续触发，但这只证明链路能触发，**不构成晋级证据**。详见 [CREATOR_EXPLAINED.md](file:///D:/project/pixel-world-engine/docs/CREATOR_EXPLAINED.md#L167-L174)。
2. **连续两次造物线性到 2。** 单次造物实测四项各 +1；第二栋没有完成浏览器验证：两个设定集都只有一个未落位模板，同模板第二栋被 `Simulation.build` 拒绝；一次拆除尝试用了“把候车亭拆了吧”，被路由到意图模型并撞上上游 Step Plan 400。后来确认句首式“拆掉候车亭”其实有本地路径，但本轮没有重跑，因此仍算未验证。
3. **四项计数以外的门禁项。** `collisionChecks` / `constraintChecks` / `traceabilityChecks` / `schemaPassRate` / `manualModificationRate` 没有通过 Oracle 暴露，浏览器只验证了 `creatorChecks()` 的四项与 coverage。其余由单元测试覆盖。
4. **原 9 条 KNOWN_FAILING** 仍按原样跳过，没有新增通过，也没有移除。

## 五、写作时验证快照（代码快照 `4d4e309`）

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 语法 0 / 语义 0 |
| `npm test` | 1879 tests / 1870 pass / 9 skipped / 0 fail |
| 四道审计（palette / references / citations / sections，`--strict`） | 全部 0 缺陷 |
| `npm run test:browser`（`scripts/smoke.mjs`，需 dev:live） | 124 项通过 |
| `node scripts/check-creation.mjs`（需 `PIXEL_WORLD_URL`） | 17 项通过 |
| 浏览器外环语义窄查 | 基线 0、单次 +1、被拒不变、刷新归 0、日结算后计数保留；服务端 `building.built` 增量 0（被拒）/ 1（成功） |

浏览器证据（JSON 已入库，原始截图未入库）：`docs/evidence/20261102-live-check/`（`counter-semantics.json`、`server-event-delta.json`、`intent-400-evidence.json`、`oracle-checks.json`、`coords-before.json`）。

## 六、给合入者的判断

技术上：测试、审计、浏览器脚本均已绿，工作区在 HEAD 上干净；功能链路“确认造物 → `building.built` → 事后结算 → 计数/门禁”在真实浏览器成立。

产品上：是否可合入取决于 [OPEN_ISSUES.md](file:///D:/project/pixel-world-engine/docs/OPEN_ISSUES.md) 里 A 类三项决策——`schemaPassRate/manualModificationRate` 的语义、外环状态是否入档、零造物世界是否接受停在 L1。这三项没有在代码里擅自拍板。
