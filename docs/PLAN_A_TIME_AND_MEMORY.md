# 计划 A：真实时钟、长期记忆与按日回溯

结论先行：**这条路可行，但不是一次改造。** 三件事互相依赖：真实时钟决定了“一天”的边界；长期记忆决定了每天要存什么；按日回溯又要求每天的状态可被完整取回。当前代码已经具备三块基石——固定的世界时间推进、v5 整档存档、只增事件日志与按世界日命名的记忆快照——但**没有“按天留档”的层**，也没有“输入/命令日志”，所以纯事件溯源不足以重建完整世界。

最大风险有两个：**[事实]** 世界的权威状态在客户端 `Simulation`，服务端日志只是派生；**[事实+推断]** 事件日志只记“世界改了什么”，不记“玩家/上游下了什么命令”，因此“从日志重算到某一天”缺输入。若把权威搬到服务端，会与 `ADR_WORLD_FACTS_SOURCE` 直接冲突。

三个需求的判定：

| 需求 | 判定 | 一句话理由 |
| --- | --- | --- |
| 真实时钟 1:1 | **需改造** | 时间机制可复用，但 `timeScale=6`、帧补齐上限与“关页不补”让它现在不等真实时间 |
| 长期真实记忆 | **需改造 + 需新建** | 快照/复原可直接复用；整段 JSON 进单槽存档在多年尺度会失效，需要分片/增量/保留策略 |
| 按日历回溯 | **需新建** | 没有按天留档；日志不足以重算完整状态。至少要先建“每日快照”层 |

标注：**[事实]** 可指到代码/实测；**[推断]** 是规划判断，未实测。

## A. 现状盘点：能直接用 / 需改造 / 需新建

### A1. 时间

| 项 | 判定 | 证据与说明 |
| --- | --- | --- |
| `DAY_MS` / 一天 24 世界小时 | **可直接复用** | `DAY_MS = 86_400_000`（[config.ts](file:///D:/project/pixel-world-engine/world-client/src/world/memory/config.ts#L39-L47)）；世界时间单位就是毫秒 |
| 固定步长 `LOGIC_STEP_MS=100` | **可直接复用** | [SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L119-L129) |
| `timeScale`（默认 6 / `?speed=` ≤60） | **需改造** | 每步推进 `100 × timeScale` 毫秒（[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L992-L999)）；默认一天 4 小时，`speed=60` 一天 24 分钟 |
| `paceFrame` 帧补齐 | **需改造/需决策** | 单帧最多补 250ms，隐藏标签页会主动走慢（[eco-mode.ts](file:///D:/project/pixel-world-engine/world-client/src/render/eco-mode.ts#L20-L31)、[eco-mode.ts](file:///D:/project/pixel-world-engine/world-client/src/render/eco-mode.ts#L51-L67)） |
| `Simulation.now` 推进 | **可直接复用** | `now += deltaMs`（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L737-L742)）；读档直接恢复档里的 `now`，**不补离线时间**（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L3260-L3268)） |

**“一天 = 真实一天”的成立条件**：`timeScale=1` + 页面持续运行 + 没有单帧超过 250ms 的补齐裁剪 + 没有改存档 `now`。任何一条不成立，世界时间都会比真实时间慢（隐藏页）或快（默认 6 / speed）。

### A2. 存档

| 项 | 判定 | 证据与说明 |
| --- | --- | --- |
| v5 schema / 迁移链 / 路径白名单 / 指纹 | **可直接复用** | `CURRENT_SCHEMA_VERSION=5`（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L36-L38)）、指纹与新增路径（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L70-L70)、[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L259-L259)）、迁移链（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L1331-L1331)、[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L1455-L1468)） |
| 单槽 vs 多槽/命名存档 | **需改造** | `SaveStore` 每个设定集一个 `storageKey`，只有主槽 + 最近 3 份坏档备份（[save-store.ts](file:///D:/project/pixel-world-engine/world-client/src/ui/save-store.ts#L60-L60)、[save-store.ts](file:///D:/project/pixel-world-engine/world-client/src/ui/save-store.ts#L234-L247)、[save-store.ts](file:///D:/project/pixel-world-engine/world-client/src/ui/save-store.ts#L476-L498)）；无命名多槽 |
| 单档体积 | **现状可接受，长期需治理** | 记忆段浏览器实测 8.8KB（`docs/evidence/20261102-live-check/counter-semantics.json` 的 `memoryTextLength=8868`）；整档随 `settled` 无上限增长（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L2942-L2951)、[save-store.ts](file:///D:/project/pixel-world-engine/world-client/src/ui/save-store.ts#L331-L336)）；构建单 chunk 1,530.68KB（[vite.config.ts](file:///D:/project/pixel-world-engine/world-client/vite.config.ts#L23-L23)） |

**结论**：v5 可以原样当“一天的完整快照”来用；缺的是**多份快照的存放与索引**，以及外环状态的位置。

### A3. 事件日志

| 项 | 判定 | 证据与说明 |
| --- | --- | --- |
| 客户端 `since` 续读 | **可直接复用** | `since` 排他续读（[events-client.ts](file:///D:/project/pixel-world-engine/world-client/src/world/events-client.ts#L94-L130)），轮询与折叠（[feed.ts](file:///D:/project/pixel-world-engine/world-client/src/world/feed.ts#L75-L100)） |
| 服务端只增日志 | **可直接复用** | 插入只追加（[log.py](file:///D:/project/pixel-world-engine/server/events/log.py#L176-L184)）、按 id 升序读（[log.py](file:///D:/project/pixel-world-engine/server/events/log.py#L188-L220)） |
| 从日志重建某一天 | **需新建（不够用）** | 现成的投影只重建“建筑 id 集合”（[projection.py](file:///D:/project/pixel-world-engine/server/events/projection.py#L64-L90)、[projection.py](file:///D:/project/pixel-world-engine/server/events/projection.py#L140-L183)）；没有村庄、任务、记忆、外环状态，也没有输入命令 |

**结论**：日志能回答“发生过什么”，不能单独回答“那一天的世界长什么样”。回溯必须以快照为主、日志为辅。

### A4. 记忆

| 项 | 判定 | 证据与说明 |
| --- | --- | --- |
| `MemoryRuntime.toJSON/fromJSON`、逐字段复原 | **可直接复用** | [runtime.ts](file:///D:/project/pixel-world-engine/world-client/src/world/memory/runtime.ts#L246-L278) |
| 现在的持久化粒度 | **需改造** | 客户端是**整段记忆一个 JSON 字符串**，跟着单槽存档整体重写；不是按天/按人分片 |
| 服务端按天命名 | **可借鉴，需新建接线** | 每日一份按世界日编号的快照，放在 `entries/` 目录下（[paths.py](file:///D:/project/pixel-world-engine/server/memory/paths.py#L132-L140)）；事件一人一文件（同文件下一段）；索引只维护 `last_event_seq`（[writer.py](file:///D:/project/pixel-world-engine/server/memory/writer.py#L169-L207)） |

**歧义点名 [事实]**：代码里没有“玩家角色”这个实体，玩家是神；持有记忆的是 NPC 与地点 Holder。“每个人的真实记忆”有两种解释：

1. **只指 NPC/角色**：当前 `MemoryRuntime` 已经是这个口径，长期化主要是存储与保留问题。
2. **另指一个“玩家化身/旁观者”的连续记忆**：需要新建一个 player holder，并把“神谕、查看、干预”这类玩家行为记进去；这与现在的世界事实源不同。

两者工作量差别很大，需要先确认。

### A5. 外环

| 项 | 判定 | 证据与说明 |
| --- | --- | --- |
| 等级/指标窗口/导演历史 | **需改造** | `CreatorEngine` 每次场景创建都从 L0 开始（[engine.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/engine.ts#L220-L226)）；导演保留最近 7 天历史（[director.ts](file:///D:/project/pixel-world-engine/world-client/src/world/director.ts#L135-L195)）；存档里没有这些字段（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L421-L423)） |

回溯到某一天时，外环要么**从快照恢复**（需要先入档），要么**重置为 L0**（则那天的等级不是历史真值）。后者会直接毁掉“按日历回溯完整状态”的定义。

### A6. 确定性

| 项 | 判定 | 证据与说明 |
| --- | --- | --- |
| 种子与世界时间注入 | **可直接复用** | 种子取设定集 id、时钟取 `snapshot.now`（[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L780-L785)）；熔断器时钟注入（[engine.ts](file:///D:/project/pixel-world-engine/world-client/src/creator/engine.ts#L220-L221)） |
| 墙钟依赖 | **需隔离** | `Simulation` 的 `wallClock` 只用于本地交付的 `completedAt` 与存档元信息（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L652-L652)、[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L2942-L2951)、[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L3248-L3248)）；不影响核心玩法，但会让“同档重放”不完全逐字节一致 |
| 输入顺序 | **需新建** | 玩家命令、上游事件、网络到达顺序没有一条可重放的输入日志；渲染/本地输入本身不确定（推断） |

## B. 三个需求的实现路径与取舍

### B1. 真实时钟 1:1

- **语义**：把 `timeScale` 从“玩法加速倍率”改成“真实时钟源”。建议保留固定步长，但每帧的世界时间由**锚点 + 单调时钟增量**决定，而不是把 `100ms × N` 当世界步长。
- **日界锚点**（待决策，见 C）：本地午夜 / 固定 UTC 偏移 / 世界自己的时钟。DST 只在“本地午夜”方案里需要处理；固定偏移最简单；世界自己的时钟不随系统时区变。
- **离线补算**：读档时 `now` 与真实时钟已脱节（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L3260-L3268)）。两种做法：(1) 逐日调用 `MemoryRuntime.tick` / 日结算（[runtime.ts](file:///D:/project/pixel-world-engine/world-client/src/world/memory/runtime.ts#L445-L465)），但 Simulation 的日常事件只按当前时间槽生成，长跳会丢中间事件（推断）；(2) 合并成一次结算，快但会漏掉每日模式。建议逐日补齐并设上限 N（见 C）。
- **时钟被改/回拨**：会话内用单调时钟（performance.now 类）算增量；跨会话保存最后一次真实时间与单调锚点；检测回拨只记日志、不回退世界；检测大幅前进按 N 天上限补算。

### B2. 长期真实记忆

- **整段 JSON 的失效点**：体积随 NPC 条目线性增长；每次自动存档都整体重写（[SandboxScene.ts](file:///D:/project/pixel-world-engine/world-client/src/scenes/SandboxScene.ts#L1955-L2010)）；localStorage 有配额；多标签页会互相覆盖。多年尺度不可行。
- **候选结构**：按天/按人分片（IndexedDB 或服务端文件），增量追加 + 索引（holderId, day, memoryId）；保留策略按显著度/年龄压缩，归档到冷存储；整段 JSON 只保留“最近 N 天热数据”。
- **权威方**：客户端 `MemoryRuntime` 是现在的事实源；服务端 `entries/`、`characters/`、`events/` 是从日志派生的编年史（[writer.py](file:///D:/project/pixel-world-engine/server/memory/writer.py#L169-L207)）。两者不能同时被当作权威，否则分叉。
- **玩家 vs NPC 的歧义**见 A4。

### B3. 按日历回溯（两种方案）

| 维度 | (a) 每日快照 + 事件日志 | (b) 纯事件溯源按天重算 |
| --- | --- | --- |
| 需要的新数据 | 每天一份 v5 快照（含外环状态），按天索引 | 完整初始状态 + 全部输入/命令日志 |
| 存储成本 | 约每档体积 × 天数（当前整档 KB 级，可接受；记忆分片后可更大） | 主要是日志，但输入日志会显著增加 |
| 恢复耗时 | 载入快照 O(1)，当天内查事件 O(事件数) | 从起点重放 O(总事件/命令)，越老越慢 |
| 回溯粒度 | 以天为单位；天内需要再存小时快照或输入日志 | 任意时刻（前提是输入可重放） |
| 对 schema 影响 | 需要 v6：外环状态；快照存外部索引可不进主档 | 需要命令日志格式与重放契约，改动更大 |
| 与“权威在客户端” | 快照就是客户端存档，冲突较小 | 重算通常在服务端，直接冲突（[ADR_WORLD_FACTS_SOURCE.md](file:///D:/project/pixel-world-engine/docs/adr/ADR_WORLD_FACTS_SOURCE.md#L96-L96)） |

**只读 vs 可分叉**：只读查看可以只加载快照、不写世界；分叉则要在某个历史点复制出一份新状态并继续写。后者与“事件日志只增不改”冲突（[ADR_WORLD_ALIVE.md](file:///D:/project/pixel-world-engine/docs/adr/ADR_WORLD_ALIVE.md#L191-L191)）：要么给日志加 `timelineId`，要么每个分支一份新日志；无论哪种都不是现有“单条只增日志”的直接延伸。**[推断]** 这会是最贵的一块，且必须先拍板语义。

## C. 需要用户拍板的设计决策

| 决策 | 选项 | 代价 / 影响 |
| --- | --- | --- |
| 日界锚点 | (1) 本地午夜；(2) 固定 UTC 偏移；(3) 世界自己的时钟（从开档起算） | 本地午夜要处理 DST 与跨时区；固定偏移简单但不能跟随玩家时区；世界时钟不随系统变，但“日历日”与玩家直觉不一致 |
| 回溯语义 | (1) 只读查看；(2) 可从中分叉 | 只读便宜、与只增日志兼容；分叉要时间线 ID/新日志，存储与合并成本高 |
| 记忆权威方 | (1) 客户端；(2) 服务端；(3) 双写 | 客户端符合现 ADR；服务端便于跨设备但要让出权威；双写必须解决冲突与顺序 |
| 离线补算上限 N | 0（不补）/ 7 / 30 / 无限 | 0 会让真实时钟在关页期间停摆；无限会让一次打开补算很久并生成大量日事件；N 是体验与成本的折中 |

## D. 分阶段实施计划

### 阶段 1：真实时钟最小闭环（必须先做）

- **目标**：真实时钟下跑通“一天”，日结算/记忆关账在真实午夜发生；不做回溯、不做多槽。
- **改动文件**：新增一个时间源模块（真实时间源 + 日界计算，尚未存在）；`SandboxScene.ts` 的时间推进与 `timeScale` 分支；`save.ts` 增加时间锚点字段（v6 或先放 `meta`）；`MemoryRuntime` 的 day 计算对齐。
- **验证**：单元测试用可控时钟跨日；浏览器把 `now` 设到日界前 1–2 分钟等真实跨日；确认 `stepCreatorDayClosed` 与记忆关账发生。可跑 `npm run check`、`npm test`、`npm run test:browser`。
- **风险**：真实时钟 vs 固定步长的漂移；隐藏页慢走；DST。**依赖**：无。

### 阶段 2：外环状态入档

- **目标**：刷新后等级/指标窗口/导演历史不丢；为回溯提供“那天的外环”。
- **改动**：`save.ts` 新增 `world.creator` 段与迁移；`SandboxScene` 创建/恢复引擎；`CreatorEngine` 序列化/复原。
- **验证**：存读后等级与窗口逐字段一致；浏览器刷新后 `creatorChecks()` 不再归零。
- **风险**：schema 指纹与路径白名单变更；窗口数据体积。**依赖**：阶段 1（真实日界稳定后再存）。

### 阶段 3：记忆分片与保留

- **目标**：多年尺度下不爆档；按人/按天可增量。
- **改动**：新存储层（IndexedDB 或服务端文件）+ 索引；`MemoryRuntime` 的 toJSON/fromJSON 改为“热数据整段 + 冷数据分片”；保留/压缩策略。
- **验证**：合成 30/365 天数据，测读写延迟与体积；刷新后抽样比对同一 holder 的记忆。
- **风险**：权威分叉、迁移复杂、删除策略不可逆。**依赖**：C 的记忆权威决策。

### 阶段 4：每日快照 + 只读日历回溯

- **目标**：选择某一天，加载完整状态（人、楼、记忆、事件、外环）只读查看。
- **改动**：每日日界写一份 v5 快照（外部索引或新槽）；加载路径支持“快照 + 当天事件”；UI 日历。
- **验证**：选第 N 天，断言快照的建筑/角色/记忆/外环与当天日志一致；不写主档。
- **风险**：存储增长、快照与日志不一致。**依赖**：阶段 2、3。

### 阶段 5（可选）：分叉

- **目标**：从历史点复制并继续。
- **改动**：时间线 ID / 分支日志 / 分支存档。
- **验证**：分叉后只影响新分支；原日志不变。
- **风险**：与“日志只增”冲突，成本最高。**依赖**：C 的回溯语义拍板。

## E. 与现有约定的冲突

1. **“世界权威状态在客户端”**：纯事件溯源若在服务端重算，直接冲突（[ADR_WORLD_FACTS_SOURCE.md](file:///D:/project/pixel-world-engine/docs/adr/ADR_WORLD_FACTS_SOURCE.md#L96-L96)）。只读快照方案可以绕开：快照仍是客户端存档。
2. **“事件日志只增不改”**：分叉必须加时间线维度或新日志，不能改写原日志（[ADR_WORLD_ALIVE.md](file:///D:/project/pixel-world-engine/docs/adr/ADR_WORLD_ALIVE.md#L191-L191)、[ADR_WORLD_ALIVE.md](file:///D:/project/pixel-world-engine/docs/adr/ADR_WORLD_ALIVE.md#L282-L282)）。**待决策**。
3. **“升级即清零窗口”**：回溯恢复外环时，如果直接恢复“当天等级 + 清零后的窗口”，那天的窗口可能不完整；若恢复完整窗口，又和“清零”的语义冲突（[fuse.ts](file:///D:/project/pixel-world-engine/world-client/src/world/creator/fuse.ts#L501-L502)）。**待决策**：历史快照存“等级 + 完整窗口”，还是存“等级 + 清零状态”。
4. **v5 冻结契约**：新增外环/时间锚点必须走 v6 + 迁移 + 指纹，不能静默加字段（[save.ts](file:///D:/project/pixel-world-engine/world-client/src/world/save.ts#L1099-L1127)）。这是必须改的，不是可以绕开的。
5. **真实时钟 vs 可重放**：`wallClock` 已隔离到诊断字段（[simulation.ts](file:///D:/project/pixel-world-engine/world-client/src/world/simulation.ts#L652-L652)），可以绕开；但“离线补算”和“输入记录”会把真实时间/输入顺序引入重放，必须在阶段 1/4 前定策略。**待决策**。
6. **记忆整段进存档 vs 长期分片**：与“存档字段冻结/指纹”冲突，需要外部存储或 v6。**待决策**（记忆权威）。

## 自检

一个没跟过这轮对话的人，看完这份文档应该能回答：三件事各自现在能不能直接用（A 三栏）、先做哪一步（D 阶段 1）、哪些必须先拍板（C）、哪些会撞现有 ADR（E）。细节实现留到阶段计划，不在本文展开。
