# 剩余问题清单

面向决定“下一步做什么”的人。每条只写：**问题、证据、影响、建议时机、是否需要用户决策**。
分支状态与技术验证快照见 [BRANCH_CREATOR_WIRE_SUMMARY.md](file:///D:/project/pixel-world-engine/docs/BRANCH_CREATOR_WIRE_SUMMARY.md)；本文不重复那批改动“做了什么”。

标注约定：**[事实]** 指代码/实测可指认；**[推断]** 指基于代码的推演，未实测。

## A. 需要拍板的设计问题

### A1. `schemaPassRate` / `manualModificationRate` 缺少失败侧分母

- **问题**：这两个比率只在“造物真的落地”时记账。被 schema/落位拒绝的尝试从不调用 `submitHumanApproval`，所以 `totalCommands` 只数成功的那几次；`schemaPassRate` 恒为 1、`manualModificationRate` 恒为 0。**[事实]**
- **证据**：唯一的生产记账点是 `building.built` 之后的结算（[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L1099-L1146)）；`recordCommandResult` 只在这里被调用（[fuse.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/fuse.ts#L250-L314)）；升级确实检查这两项（[fuse.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/fuse.ts#L475-L479)）。
- **影响**：L0→L1 的“通过率 98% / 人工修改率 ≤2%”两条腿没有真实失败样本；它们不会误拒，但会给合入者“检查过了”的错觉。其余门禁（冲突、不变式、覆盖率）已有真实分母。
- **建议时机**：合入前定语义；实现可与本分支分批。
- **是否需要用户决策**：**是**。选项：(1) 把被拒尝试记成 `schemaPassed:false`（但玩家点错位置会连累外环，是产品判断）；(2) 只记外环自动提议的失败；(3) 正式把这条门禁改名为“落地成功率”并接受口径。

### A2. 外环状态不进存档

- **问题**：v5 存档只有 `world.memory`，没有外环等级、指标窗口、导演历史。刷新/重进会新建 `CreatorEngine`，等级回到 L0。**[事实]**
- **证据**：`SaveWorld` 只有 `world.memory` 这一处新增（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L413-L423)）；场景每次 `create()` 都 `new CreatorEngine(...)`（[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L780-L785)）。
- **影响**：玩家刷新后自治进度清零，镇子会突然不再自己造东西；在“14 天窗口”的晋级需求下，这条会变成主要体验断点。**[事实+推断]**
- **建议时机**：合入前拍板“会话级自治”还是“跨会话持久”；若选后者，需要扩存档契约。
- **是否需要用户决策**：**是**。选项：(a) 接受外环只活在单次会话；(b) 扩存档，持久化等级/窗口/导演历史（要定迁移与体积上限）。

### A3. `relationSymmetryRate` 只有 `null` 路径，`metrics.ts` 未接线

- **问题**：`metrics.ts` 的聚合门禁是一套完整实现，但生产路径没有调用方；`relationSymmetryRate` 没有关系图数据源，永远 `null`。**[事实]**
- **证据**：`relationSymmetryRate` 定义与判定（[metrics.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/metrics.ts#L57-L70)、[metrics.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/metrics.ts#L240-L240)、[metrics.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/metrics.ts#L373-L373)）；`runAllGateChecks` 无生产调用方（[metrics.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/metrics.ts#L106-L123)）；`src/` 下只有 `creator/index.ts` 的 re-export（[index.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/index.ts#L66-L73)）。
- **影响**：两套门禁并存（fuse 的 `qualityGatesFor` 是生产用的，metrics.ts 只在测试里），读代码的人容易把后者当成生效规则；`relationSymmetryRate` 是一条永远不会被满足的假要求。
- **建议时机**：合入后整理；暂不处理也可以，但需要在文档里保持“未接线”的标注。
- **是否需要用户决策**：**是**（删除 vs 接线）。若不接线，建议删除该字段与对应测试，避免误导。

## B. 工程债

### B1. `Simulation.build` 不支持同模板多栋；配色只能选 token

- **问题**：同一 `prefabId` 已存在时直接拒绝；造物配色是设定集 token 的闭集覆盖，不能给任意色值。**[事实]**
- **证据**：重复模板检查（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L2143-L2145)）；`palette` 走 `readPalette(...)`（[schema.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/schema.ts#L386-L390)）。
- **影响**：外环“再建一栋同类铺子”不可能；浏览器里“连续两次造物线性到 2”也因此难验；将来做城市生长会被这条规则卡住。**[事实+推断]**
- **建议时机**：合入后；若产品要“同模板多栋”，提前到合入前。
- **是否需要用户决策**：**是**（规则是否放开）。

### B2. `executeCommand` 只返回建议，不执行

- **问题**：`CreatorEngine.executeCommand` 只根据熔断决策返回 `allowed/reason`，没有落地动作；它看起来像执行入口，实际是策略查询。**[事实]**
- **证据**：[engine.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/engine.ts#L282-L326)；`src/` 下无生产调用方（grep 仅定义）。
- **影响**：后来者可能把它当执行器接上，绕过 `Simulation.enqueue` 的第二条写世界通道。**[推断]**
- **建议时机**：合入后重命名/加注释或删除。
- **是否需要用户决策**：否（工程整理；改名前需确认无外部调用）。

### B3. `worldChangeVersion` 是死字段

- **问题**：字段每档都有，但除了初始化、写档、读档之外从不递增；含义写着“折返计数”，实际恒为 0。**[事实]**
- **证据**：初始化（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L518-L518)）、写档/读档（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L3243-L3243)、[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L3388-L3388)）；schema 校验（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L403-L403)）。
- **影响**：存档契约里多一个无法解释的数；做日历回溯/分叉时会诱导人把它当成版本号使用。**[推断]**
- **建议时机**：合入后随下一次 schema 变更清理（需迁移链）。
- **是否需要用户决策**：否。

### B4. 世界变大后的三处隐患

- **问题与证据**：
  1. **意图全量读日志**：服务端在客户端没给 `context` 时按页读全量日志重放建筑（[projection.py](file:///D:/project/pixel-world-engine/server/events/projection.py#L159-L183)）。世界越老，每次意图请求成本越高。
  2. **`settled` 无上限**：交付持续追加（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L2942-L2951)），存档只在超过 5000 条时告警一次，不截断（[save-store.ts](file:///D:/project/pixel-world-engine/world-client/src/ui/save-store.ts#L331-L336)、[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L40-L40)）。
  3. **单 chunk 1.5MB**：`npm run build` 实测 `dist/assets/index-*.js = 1,530.68 kB`（gzip 426.63 kB），Vite 配置没有拆包（[vite.config.ts](file:///D:/project/pixel-world-engine/world-client/vite.config.ts#L23-L23)）。
- **影响**：长时钟 + 长期记忆会让世界寿命变长，这三处分别变成请求延迟、存档膨胀、首屏加载问题。**[推断]**
- **建议时机**：合入后，先加观测阈值；不要现在改协议。
- **是否需要用户决策**：**是**（是否接受当前上限，或先做分片/拆包）。

### B5. 工程卫生

- **问题与证据**：
  - 根 `node_modules/` 存在但 0 项（空目录）；
  - `world-client/.git` 是嵌套 git 目录，容易让工具把两套历史混淆；
  - `resume-v3/` 有 8 个与项目无关的简历文件；
  - `tmp/` 累计了多份日志/脚本/事件库（`tmp/` 已在 gitignore，但会持续变大）；
  - `server/requirements.txt` 全部是 `>=`，没有上界（`fastapi>=0.110` / `uvicorn>=0.27` / `pytest>=7.4` / `httpx>=0.27` / `pyyaml>=6.0`）；
  - `test:live` 把截图写进已入库目录：`accept-live.mjs` 的 `OUT = eval/live`（[accept-live.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/accept-live.mjs#L35-L35)），该目录已有 5 个 tracked PNG，跑一次就会产生 `git status` 噪音。
- **影响**：环境不可复现、误提交截图、工具扫描混淆；不直接影响运行。
- **建议时机**：合入前做一次清理（至少嵌套 `.git`、空 `node_modules`、`test:live` 输出目录）。
- **是否需要用户决策**：否（纯卫生；删除嵌套 `.git` 前确认里面没有独有历史）。

### B6. `creator/metrics.ts` 与 `creator/synthesizer.ts` 无生产调用方

- **问题**：两个模块完整、有测试，但生产路径不 import；`creator/index.ts` 只做 re-export。**[事实]**
- **证据**：`runAllGateChecks`（[metrics.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/metrics.ts#L106-L123)）；`RuleSynthesizer`（[synthesizer.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/synthesizer.ts#L126-L126)）；re-export（[index.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/index.ts#L45-L73)）。
- **影响**：两套门禁/合成器与生产规则并行，维护成本与误读风险；测试通过会给人“在用”的错觉。**[事实+推断]**
- **建议时机**：合入后决定删或接。
- **是否需要用户决策**：**是**（与 A3 同源，删除/接线都改变后续工作量）。

## C. 设计边界（不是 bug，但需要被知道）

### C1. 零造物世界会停在 L1

- **问题**：升级即清零窗口；如果之后没有任何一次造物，`coverageRate` 保持 `null`，L1→L2 结构上过不去。**[事实]**
- **证据**：死锁解除只在“又有一次新观测”时成立（[creator-business-rules.test.ts](file:///D:/project/pixel-world-engine/world-client/test/creator-business-rules.test.ts#L422-L488)）；“不能白送”用例明确断言无造物仍不通过（[creator-business-rules.test.ts](file:///D:/project/pixel-world-engine/world-client/test/creator-business-rules.test.ts#L490-L501)）；文档同结论（[CREATOR_EXPLAINED.md](file:///D:/project/pixel-world-engine/docs/CREATOR_EXPLAINED.md#L154-L161)）。
- **影响**：安静的、不再扩张的世界无法继续自治升级；这是“不白送”的代价。**[事实+推断]**
- **建议时机**：合入前接受或改判定；不要偷偷默认放行。
- **是否需要用户决策**：**是**（接受“零造物停在 L1”，或引入另一个可观测维度）。

### C2. 14 天晋级无法按真实时间验证

- **问题**：默认的游玩时间驱动下 `timeScale=6`，一日约 4 小时，`?speed=60` 也要 24 分钟/日，一个 14 天窗口约 5.6 小时；显式 `?clock=real` 则要按真实时间熬满 14 天。修改存档 `world.now` 可让日结算连续触发，但那只是链路证据，不是“真的熬了 14 天”。**[事实]**
- **证据**：`DAY_MS` 与倍率换算（[config.ts](file:///D:/project/pixel-world-engine/world-client/src/world/memory/config.ts#L39-L47)）；逐日关账（[runtime.ts](file:///D:/project/pixel-world-engine/world-client/src/world/memory/runtime.ts#L445-L465)）；已写明的验证边界（[CREATOR_EXPLAINED.md](file:///D:/project/pixel-world-engine/docs/CREATOR_EXPLAINED.md#L167-L174)）。
- **影响**：浏览器无法给出“晋级成功”的诚实证据；只能靠单元测试或可控时钟。**[事实]**
- **建议时机**：合入后补“可控时钟/加速测试入口”，再做端到端晋级验证。
- **是否需要用户决策**：**是**（是否接受纯测试验证，或投入可控时钟）。

### C3. 上游 Step Plan 订阅导致非句首说法失败

- **问题**：意图模型上游 `api.stepfun.com/step_plan/v1` 返回 400 `you have no active step plan subscription`；非本地解析器覆盖的口语说法（例如“把候车亭拆了吧”）会落到模型分支并失败。**[事实]**
- **证据**：上游调用与 400 映射（[orchestrator.py](file:///D:/project/pixel-world-engine/server/oracle/orchestrator.py#L222-L244)）；HTTP 面按契约回 200+unknown（[api.py](file:///D:/project/pixel-world-engine/server/oracle/api.py#L59-L79)）；句首式拆除有本地路径（[oracle-build.ts](file:///D:/project/pixel-world-engine/world-client/src/world/oracle-build.ts#L23-L87)）。证据 JSON 在 `docs/evidence/20261102-live-check/intent-400-evidence.json`。
- **影响**：不是“拆楼功能坏了”，而是“部分措辞依赖模型”；玩家换句首说法可绕过，但体验不一致。**[事实+推断]**
- **建议时机**：合入/演示前解决环境（开通订阅或换可用端点）。
- **是否需要用户决策**：**是**（提供可用凭据 / 改部署配置 / 接受只支持本地短语）。
