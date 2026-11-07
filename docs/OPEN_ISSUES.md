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

### B7. red-first 把「静态 import 新导出」的正常 TDD 判成 ERROR（已知误报）

- **问题**：`red-first` 只把「断言失败」算合格的红。测试如果静态 `import { newThing } from '../scripts/...'`，而 base 上这个命名导出还不存在，Node 会报 `SyntaxError: ... does not provide an export named 'newThing'`；分类器按 `compile` 处理，闸门输出 `ERROR`（exit 2），不是 `PASS`。**[事实]**（实测：`world-client/test/red-first-lib.test.ts` 用静态 import 时本分支闸门为 ERROR；改成动态 import 后为 PASS）
- **触发条件**：本次改动在 `test/` 之外新增导出，且测试用静态 `import` 直接引用它。先写测试、后写实现的正常 TDD 正好命中。
- **规避方式**：测试改为动态 import + 存在性断言：
  ```ts
  const lib = (await import('../scripts/foo.ts')) as unknown as { newThing?: (...args) => T };
  assert.equal(typeof lib.newThing, 'function');
  // 再调用 lib.newThing 做行为断言
  ```
  base 上 `typeof` 是 `undefined` → 断言失败 → 合格的红；tip 上是函数 → 通过。分类器为此专门保留了 `typeof fn === 'function'` 这条断言路径。
- **保守侧**：`typeof` 只验证「导出存在」，抓不到函数签名/默认值变化。签名变化请继续用静态 import + 实际调用断言（导出本身存在，静态 import 不会误报）。这是有意的保守：宁可把「没跑起来」判 ERROR，也不让 import 写错冒充先红后绿。
- **影响**：不修的话，下一个照抄静态 import 的作者会长期看到 ERROR，误以为闸门坏了；写测试时需按上面的写法，或先把导出以 stub 形式落地。
- **建议时机**：下一次改 red-first 时再考虑加 lint/模板拦截；本轮只登记，不改工具。
- **是否需要用户决策**：否（已按「登记已知误报」处理）。

### B8. `TERRAIN_SPECK` 5 个键全仓无读点（死数据，只登记不删）

- **问题**：`TERRAIN_SPECK` 的 `grass` / `stone` / `plaza` / `farm` / `tree` 五个键在 `src/`、`test/`、`scripts/` 中均无读点，属死数据。**[事实]**（实测：`node world-client/scripts/audit-palette.mjs --strict --sites`，逐 token 列表里这 5 个键的读点为 0；其余 24 个 `WORLD` 槽均为 24/24 静态可证引用）
- **证据**：定义在 `world-client/src/world/palette-data.ts`；审计逐条读点明细见 `docs/evidence/palette-threshold/README.md`（「`refs` 反向核查」一节）。
- **影响**：读色板的人会以为它还有用；但删键可能连带影响打包/类型闭集与体积预算，风险大于收益。
- **建议时机**：等下一次要动 `palette-data.ts` 或打包清单时一并处理。
- **是否需要用户决策**：**是**（删除 vs 保留）。本轮按「只登记、不删表项、不改打包」处理。

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

## D. 待收敛（2026-11-05，merge main 时追加）

### D1. 两套睡眠

- **问题**：疲劳睡（`fatigue.ts` + `SLEEP_RULE`，就地睡）与 main 的定时夜休（`restGoal` → `settleForTheDay` / `dawnStep`，祭坛边歇下/睡下）并存；本轨迹里定时夜休每黎明清零疲劳，疲劳睡一次都不触发。两套共用一个「休息」定义才没有打架，但长期是两份时刻表。**[事实]**
- **影响**：默认种子下 `sleep` 决策 0 条；功能只在受控场景可见。
- **建议时机**：社会结构 / 经济线开工前，先决定是否合并成一套（或让定时夜休也走 `sleepGoal`）。
- **是否需要用户决策**：**是**。

### D2. 两套钉法

- **问题**：`routineLabel` 夜里归定时夜休独占，白天归作息拍；疲劳睡又在入睡到醒来之间独占同一字段。三种写者靠「谁先写谁占」的时序约定，没有类型层约束。**[事实+推断]**
- **影响**：新增任何一条会写 `routineLabel` 的规则都要重新推演优先级。
- **建议时机**：下一块行为规则前，补一条不变量测试（同一拍只允许一个写者）。
- **是否需要用户决策**：否（工程债）。

### D3. 睡眠姿态

- **问题**：睡着时人站着不动，没有躺下/闭眼等可见姿态；牌子只靠 `routineLabel` 上屏。**[事实]**
- **影响**：玩家能读到状态，但看不出「在睡」。
- **建议时机**：渲染线（cast / motion）下一次接入时一起做。
- **是否需要用户决策**：**是**（是否占用新色位/新帧）。

### D4. 睡觉必须回家

- **问题**：本版疲劳睡是「就地睡」，不引用 `homecoming` / `homesOf`；与回家线的对接是显式后续依赖。**[事实]**
- **影响**：镇外/路途中睡着不符合「回家睡」的生活常识。
- **建议时机**：`feat/interior-view` 合入后另起一块。
- **是否需要用户决策**：**是**。

### D5. 回家后还问不问规则表（已定：进屋即睡下）

- **问题**：`stepHomecoming` 排在规则表之前并 `return`，22:00–06:00 规则表完全不被问。于是上一轮刚合进来的 `rest`（定时夜休，含黎明清零疲劳）与疲劳 `sleep` 在默认轨迹里被上游截断：默认大世界 `rest` 决策 9 → 4；`sleep` 反而 0 → 1——黎明分支不再刷新「上次睡醒」，疲劳在第 1 天下午跨阈，就地睡了 4 小时 51 分。**[事实]**
- **已定（C）**：**进屋即睡下**。`enterHome` 调 `settleRestAt(id, now)`（simulation 层唯一的「休息」定义），与定时夜休、疲劳睡共用一个「上次睡醒」读数；默认大世界 `sleep` 归 0，非安静离场率回到 1.25（main 1.227，差异见下）。**D4 解决「睡在哪」，D5 解决「回家之后还问不问规则表」**；D1 是两套睡眠时刻表的收敛方向，C 把它落成同一个休息定义。
- **数字**：`func-daily-l2` 的 1.2 阈值一个字未动；合并后实测 **55 次 / 1.250**（main 54 次 / 1.227）。多出的 1 次是 00:00 开局那一趟「回家」——夹具从 00:00 起跑时人还在街上，homecoming 立刻让她走回家；main 没有回家线，所以没有这一趟。
- **仍在 D3**：睡眠姿态（躺下/闭眼）仍待定，本项只定「睡不睡」，不定「怎么睡」。
- **建议时机**：D3 一起做；`rest` 是否干脆改成 `sleepGoal` 由社会结构线决定。
- **是否需要用户决策**：**是**（D3 的姿态部分）。

### D6. 冻结轨迹不覆盖 homecoming（判据盲区）

- **事实**：`traces/outer-baseline-v5.json` 里只有 `star_archive`，**没有 living 区住宅**，`homeOf()` 恒为 `null`，homecoming 在冻结轨迹上从不触发。所以合并前后 `rest` 346 → 346、`sleep` 0 → 0，442 条决策 digest `b190aecb…` 与四枚指纹（世界 `0663b93f…` / 记忆 `0604c712…` / 造物 `c1c83fb2…` / 夜雨 `2cb7cdb0…`）逐字不变。这是**没覆盖到**，不是覆盖了。**[事实]**
- **后果**：谁改回家线（起床时刻、进门条件、屋里做什么），四枚指纹照样全绿，我们会误以为验过；行为差只在 `buildLargeWorld` 的默认世界（5 栋住宅）里出现。
- **提案方向**：默认大世界也要有一条可复放轨迹，纳入 `trace:replay` 与四枚指纹；代价是新增一份可复放存档 + 一条轨迹并重录一次基线。
- **建议时机**：下一次动回家线之前。
- **是否需要用户决策**：**是**（要不要为它付一份新基线）。

## E. 调试面与证据链

### E1. `window.Oracle` 无条件挂载，生产同样可达

- **现状 [事实]**：`SandboxScene.create()` 无条件调用 `registerOracleApi()`，`window.Oracle = oracle` 无条件赋值（[SandboxScene.ts](file:///D:/project/pwe-material/world-client/src/scenes/SandboxScene.ts#L1439-L1439)、[SandboxScene.ts](file:///D:/project/pwe-material/world-client/src/scenes/SandboxScene.ts#L4653-L4654)）。它暴露的不只是只读读数，还有 `pinShotState` / `pinActors` / `pinTrails` / `debugSetWeather` 等会改状态的调试方法；本轮已删除唯一一个「任意改画面」的 `debugOverridePainting`，但口子面仍在。
- **既有依赖 [事实]**：`scripts/smoke.mjs`、`check-phases.mjs`、`check-persistence.mjs`、`check-render-budget.mjs`、`check-dengchao.mjs`、`check-shot-actor-pin.mjs` 等全部经 `window.Oracle` 取状态、挪镜头、钉快照；没有它，这套浏览器证据链无法工作。
- **风险 [事实+推断]**：任何页面脚本、控制台命令、Playwright 会话都能调用这些方法改世界状态或镜头，且与「正常游玩路径」没有类型隔离；截图闸门因此可以被外部脚本影响（本轮删掉的 `debugOverridePainting` 是最极端的一例）。生产环境同样可达，玩家本地脚本也能用。
- **提案方向**：三选一——(a) 仅在 DEV 或测试构建挂载（`import.meta.env.DEV` / 专门构建）；(b) 只暴露只读方法，写入类挪到测试专用入口；(c) 保留现状但在文档里明确它是「测试面」并接受风险。
- **代价**：任何一项都会影响全部既有浏览器脚本与证据链（需要同步改脚本入口或加构建开关），并要求重跑五道浏览器闸门。不是本轮能顺手改的。
- **建议时机**：下一次动浏览器闸门或重构调试面板时。
- **是否需要用户决策**：**是**（选 (a)/(b)/(c)）。

### E2. `worktrees:audit --strict` 把「未登记」与「过期」混在同一条失败里

- **现状 [事实]**：`scripts/worktrees-audit.mjs` 的 strict 判红条件是「未登记 ∪ 过期未回收 ∪ 表项悬空」，三者都只改 `process.exitCode = 1`（[worktrees-audit.mjs](file:///D:/project/pwe-material/scripts/worktrees-audit.mjs#L193-L195)）。输出虽分段，但退出码不区分。
- **问题**：这两类性质不同——**未登记是纪律问题**（新建 worktree 没先登记，说明流程没走），**过期是记账问题**（owner 还没处理回收，续期即可）。混判后，一次「补账」就能把纪律问题一起转绿，读数上看不出哪天漏登记过；反之，一个拖期的旧快照也会让 CI 红，掩盖真正的新漏登记。
- **影响 [推断]**：strict 红失去可读性，值班人只能靠读输出段落人工分辨；长期会逼人把过期项一律写成「保留」来消红，登记表退化成摆设。
- **提案方向**：拆成两个判据——未登记 / 表项悬空仍红（exit 1）；过期未回收单独提示，或给独立退出码（例如 exit 2），CI 可只对前者失败。需要同时改脚本与本文判定口径表。
- **代价**：改一处脚本 + 一处文档口径 + CI 调用方式；不改历史表项数据。
- **本轮回溯**：本轮只补账（补登 2 条、3 个过期项续期到 2026-11-13）并让 strict 转绿，**没有改判据**。
- **建议时机**：下一次改 worktree 巡检或 CI 门禁时。
- **是否需要用户决策**：**是**（是否拆退出码、CI 是否只认未登记为红）。

### E3. 压暗收敛用墙钟判，本身脆

- **现状 [事实]**：`waitFadeSettled` 以墙钟上限（2026-11-06 从 6 s 调到 8 s）+「连续 3 帧逐字节相同」判收敛，超时返回 `settled:false`（[capture.mjs](file:///D:/project/pwe-material/world-client/scripts/lib/capture.mjs)）。**2026-11-06 晚些时候已把上限改成帧进度 `maxFrames = 60`**，见下方「已落地」。
- **问题 [事实]**：同一份代码，本地实测 319–840ms，共享 CI runner 实测 **6217ms / 25 帧**——阈值只能覆盖已知机器。压暗层按帧 delta 累加（`FADE_MS = 900`），机器越慢、截图越贵，墙钟就越长；换更慢的 runner，8 s 也可能不够。另有反向用例暴露的第二个盲点：26×26 小样区在雨幕里会因「连续三帧没有雨滴穿过」误报收敛（实测 2146ms / 15 帧），说明「连续 3 帧相同」不完全等于「压暗收敛」。
- **影响 [推断]**：阈值会跟着最慢机器水涨船高，判据逐步从「收敛了」退化成「等够久了」；红绿的可解释性变差。但不会漏红——真的不收敛，8 s 后仍 `settled:false`（反向用例实测 8139ms / 56 帧，闸门 FAIL），只是判红的理由变成「墙钟到点」而不是「进度没走完」。
- **提案方向**：长期改成**按帧数**判（先累计足够的帧 delta，再判画面静止），或**钉住时钟**（测试用假时钟 / 手动 step 世界与渲染）后再判；两者都能把「机器快慢」从判据里拿掉。
- **2026-11-06 已落地 [事实]**：选了**按帧进度**方案——上限由墙钟 `capMs = 8000` 改为 `maxFrames = 60`（判据只数探针取样帧，`waitedMs` 仅作读数）。N 的依据与正控/反例读数见 [GATE_CALIBRATION.md](file:///D:/project/pwe-material/docs/GATE_CALIBRATION.md) §9.1：正控 8 帧 / 1216ms 收敛；反例（雨幕、整块画布）**恰在第 60 帧**判红（7835ms）。反向用例已重写为「正控 + 反例」，脚本自身退出 0 = 反例成立（[check-phases-negative.mjs](file:///D:/project/pwe-material/world-client/scripts/check-phases-negative.mjs)）。
- **仍未解决 [事实]**：**小样区假收敛**没修——26×26 草地样区在雨里可能连续三帧没有雨滴穿过，探针误报 `settled:true`（实测 2146ms / 15 帧）。本轮只换上限口径，没有换采样区。
- **代价**：已付——`capture.mjs` 与 `check-phases.mjs` 的文案/返回值同步改，反向用例重写。
- **建议时机**：下次动相位渲染或抓拍脚本时，再决定是否换采样区。
- **是否需要用户决策**：**是**（是否把「小样区假收敛」一并修；按帧 vs 钉时钟已定为按帧）。

### E4. 夹具默认输出落在已跟踪目录

- **现状 [事实]**：`check-shot-actor-pin.mjs` 默认写 `world-client/eval/screens/actor-pin`（[check-shot-actor-pin.mjs](file:///D:/project/pwe-material/world-client/scripts/check-shot-actor-pin.mjs#L29-L29)），产出 9 张源图 + `runs.json`，而这套夹具的默认输出位置正落在 `eval/screens/` 这棵已跟踪目录树里（同树下另有 169 个已跟踪基线，`actor-pin/` 子目录本身是未跟踪）；`setting` 闸门的 `check-dengchao.mjs` 固定写 `world-client/eval/screens/dengchao-*.png`，且没有 `EVAL_OUT` 覆盖（[check-dengchao.mjs](file:///D:/project/pwe-material/world-client/scripts/check-dengchao.mjs#L26-L26)），每跑一次都要 `git restore` 三张基线。
- **问题 [事实]**：噪音与误提交风险来自「默认输出位置」，不是产物本身——同一目录既放比对底片，又放夹具新产物，`git add -A` 分不开。
- **影响 [推断]**：`git add -A` 会把未跟踪产物一次扫入；setting 每次手动还原，漏还原或误还原都没人挡。
- **提案方向**：默认输出改到 `world-client/tmp/`（`tmp/` 已在 ignore 内），由 `EVAL_OUT` 覆盖；setting 的三张基线仍留在 `eval/screens`（它们是比对底片）。
- **代价**：需同步更新 `03-ACTOR-PIN.md` 等文档里的路径描述，属一次性迁移；同时改两个脚本的默认常量。
- **本轮 [事实]**：**不改默认，只登记**；只给 `actor-pin/`、`actor-pin-pairs/` 加了**精确** ignore（见根 `.gitignore`），未加任何 `eval/screens/` 宽规则，169 个已跟踪基线不受影响。
- **2026-11-06 已落地 [事实]**：按用户裁决统一写入口——所有出图 gate 默认写未跟踪的 `world-client/tmp/screens/<脚本名>/`；写回 `eval/screens` 基线须显式 `--write-baseline` 或 `EVAL_OUT=eval/screens`；目标目录命中已跟踪文件又无授权时直接拒绝退出，并打印会被覆盖的文件清单与两条放行命令。判断集中在 [shot-output.mjs](file:///D:/project/pwe-docs-fix/world-client/scripts/lib/shot-output.mjs)，已接入 A 档 12 条（含 `check-creation`、`check-dengchao` 两条原本无出口的）、B 档 5 条，以及 `check-shot-actor-pin` / `check-rain-pin` / `accept-live`；`lamp-band-before*` 三件仍从 `eval/screens/` 只读复用，不随输出目录漂走。
- **建议时机**：下一次动抓拍夹具或 setting 闸门时。
- **是否需要用户决策**：**否**（默认已迁移；旧路径兼容性由显式 `EVAL_OUT` 承担）。

### E5. GitHub 默认视图只显示最新 attempt，重跑会把首跑的红藏起来

- **现状 [事实]**：网页 run 页、`gh run list`、以及不带 `--attempt` 的 `gh run view` 都只显示**最新 attempt**。一次 `gh run rerun --failed` 成功之后，attempt 1 的失败在默认视图里消失，只剩 success。
- **复现 [事实]**：按「首跑红、最终绿」口径，`world-client-browser` 自 2026-11-02 22:27（+0800，`29597bd` 接入 CI）至 2026-11-06 共 **82 个 run**，其中 **15 条重跑过、14 条首跑红被重跑掩盖**（默认视图全是 success，必须 `--attempt 1` 才看得到）：
  - `42157897952`（`05a34abf`，phases 6217ms/25 帧）
  - `42154120584`（`ac4fe28a`，phases 6248ms/24 帧）
  - `41780154730`（`ed9eb4cd`，background 19.0/10.0）
  - `41698910545`（`db948016`，background 32.0/11.0 vs 10.67）
  - `41686628894`（`20d98412`，drag 32.4/25.1、restore 31.0/36.0）
  - `41630373031`（`9a02fcda`，restore 29.0/33.0）
  - `41624984892`（`e9a39d8b`，restore 30.0/38.0）
  - `41616480893`（`d3f133e8`，restore 26.0/36.0）
  - `41612010831`（`b10a8165`，restore 31.0/36.0）
  - `41580036942`（`860f2bb2`，drag 44.1/39.7、restore 31.0/36.0）
  - `41575068959`（`2d7406a8`，drag 57.0/45.4）
  - `41569115855`（`5fdd603d`，dawn 65.36 vs noon 66.60，差 -1.24）
  - `41553639144`（`85a06118`，restore 37.3，前台 46.7）
  - `41553156868`（`fcb225b9`，drag 43.6/35.2）
- **不算「被掩盖」的一条 [事实]**：`41661860644`（`ba6e616f`）attempt 1/2/3 三次全红、最终仍 failure，单列在此、不计入上面 14 条。重跑掩盖的判据是「首跑红、最终绿」；最终仍红本来就是默认视图可见的红。
- **统计边界 [事实]**：`ci-attempt1-audit.mjs` 只看 attempt 1、只到 run 级、不区分 job，因此看不到「attempt 2 红、attempt 3 绿」这类更深的掩盖；本时间窗（82 run）没有这类漏检（`41661860644` 的 attempt 2 也红、最终仍红，属于可见红）。
- **影响 [事实]**：review 只看默认视图，会把「首跑红」当成没发生，「这个 job 一直绿」的判断因此失真；反过来，拿首跑红去改代码，会追一个只在慢机器上出现的假红。
- **纪律**：review 任何一次 run，**必须**看首跑：`gh run view <run-id> --attempt 1`。重跑成功不等于首跑成功。
- **只读入口（不进 CI）**：`npm run ci:attempt1 -- --since 2026-11-04`（[ci-attempt1-audit.mjs](file:///D:/project/pwe-material/scripts/ci-attempt1-audit.mjs)）列出时间窗内「attempt 1 失败、最终却 success」的 run，并打印逐条 `gh run view … --attempt 1`。只读 `gh` 数据，不改判据、不进工作流。
- **建议时机**：已落地（纪律 + 入口）。
- **是否需要用户决策**：否（review 纪律）。

### E6. `phase-night-rain.png` 是否继续当硬基线

- **现状 [事实]**：`check-phases.mjs` 的 night-rain 分支只做 `waitFadeSettled` → `say('下雨吧')` → 固定 `waitForTimeout(3000)`，读数记成 `method: 'fixed(rain)'`、`frames: -1`（[check-phases.mjs](file:///D:/project/pwe-docs-fix/world-client/scripts/check-phases.mjs#L210-L219)）。它**没有** `waitVillagersSettled`、没有 `jumpWorldClock(35)` / `freezeWorldClock`、没有 `pinShotState`，所以居民行走相位与雨丝相位都随墙钟落点漂。四张计分 phase 图有 `villagers-inside + clock-pin(00:35) + fade-probe`，同日重跑逐字节不变；night-rain 则每次重写都不同。
- **读数 [事实]**：一次重跑与 HEAD 的差异为 961×641 中 ≥1 差 427,246 px（69.358%）、≥10 差 5,451 px；高差块集中在顶部中央居民精灵 `x545–672 / y28–128`，全帧 ±1–2 是雨幕亮度相位。两个 sha256、四张同组 phase 逐字节相同的旁证、以及一次「先判雨丝、实为居民」的误判更正，见 [05-NIGHT-RAIN-BASELINE-DRIFT.md](file:///D:/project/pwe-docs-fix/docs/evidence/pin-shots/05-NIGHT-RAIN-BASELINE-DRIFT.md)。
- **问题 [事实]**：作为硬基线，它**不可复现、每次跑都漂**；漂移量与居民/雨的随机相位同量级，无法用阈值区分「真的坏了」与「又漂了」。
- **候选路径 A：补钉**。照四张计分 phase 的口径加 `waitVillagersSettled` + `jumpWorldClock(35)` + `freezeWorldClock`（必要时补 `pinShotState`），按 [04-RENDER-INPUT-TABLE.md](file:///D:/project/pwe-docs-fix/docs/evidence/pin-shots/04-RENDER-INPUT-TABLE.md) 的 `now / tide / villagers / trails` 四类输入钉住。目标：三跑逐字节 0 差，night-rain 继续当硬基线；代价是这一镜的「雨刚上来」语义被冻钟改变，需要重新定构图时刻。
- **候选路径 B：降级为单幅结构度量**。按 [02-STRUCTURE-GATE.md](file:///D:/project/pwe-docs-fix/docs/evidence/pin-shots/02-STRUCTURE-GATE.md) 的「结构档」口径，只断言单幅存在 + 雨幕可见 + 亮度/结构指标在范围内，不再逐字节比较。目标：不再要求复现，night-rain 退出硬基线名单；代价是丢掉「同机位逐像素」这层保护。
- **本轮 [事实]**：**不改判据**，只登记两条候选；漂移文件已按纪律还原，基线未更新。
- **建议时机**：下一次动 night-rain 判据或天气呈现时。
- **是否需要用户决策**：**是**（A 补钉 vs B 降级为结构度量）。

## F. Phaser 4 升级遗留（2026-11-06）

### F1. `?light=` 探针的去向：留分支、不进 main

- **现状 [事实]**：探针提交 `2250162` 在 `sample/phaser4-lighting`，仅在 URL 带 `?light=terrain|graphics|on` 时装配（[light-probe.ts](file:///D:/project/pwe-p4-light/world-client/src/render/light-probe.ts)、[SandboxScene.ts](file:///D:/project/pwe-p4-light/world-client/src/scenes/SandboxScene.ts)）；默认 URL 完全不进入该分支，不写世界状态、不改渲染顺序、不新增源色。升级提交 `e3a67e1` 已合入 main（`430dd0d`），**探针未合 main、分支未 push**。
- **不合并的理由 [事实]**：实测光照把 24 色平涂压成渐变，属于**风格冲突**，不是参数还能调的问题。判据读数已记在上一轮试点的证据里（Graphics 受光成立、预算 16171→16171 不变、三跑 sha 相同），但「能不能受光」与「该不该受光」是两个问题，后者在风格上是否定的。
- **分支为什么要留 [事实]**：它是这套「Phaser 4 光照补表现力」结论唯一的代码载体；删分支等于把实测入口一起删掉，后续任何一条路都要从零重搭。
- **如果要继续，三条路**：
  1. **局部夜灯场景**：只在夜景/室内等小范围开光照，接受渐变，作为局部氛围而不是全场景基调；
  2. **贴图离线烘焙**：把光照烘进地形/建筑贴图，运行时仍走 24 色平涂，避免实时 Light 改掉风格；
  3. **放弃**：保留分支与证据，不再投入；main 已用 Phaser 4，但不启用 Light。
- **建议时机**：下一次决定「表现力 vs 平涂风格」优先级时。
- **是否需要用户决策**：**是**（选哪条路，或长期挂起）。

### F2. 小幅度性能变化要换指标：帧间隔分位数 + 长帧计数 + 单帧 WebGL 耗时

- **现状 [事实]**：新的可复现帧率口径（[fps-protocol.mjs](file:///D:/project/pixel-world-engine/world-client/scripts/fps-protocol.mjs)、[证据](../evidence/phaser4-upgrade/README.md)）钉住世界与机位后，两轮 6 轮中位为 **59.9 / 59.9 / 11.0**、极差 0.0、相对离散度 0.0%。
- **问题 [事实]**：fps 均值在 vsync 下被 60Hz 截顶，**量不出 1/60 秒以下的差别**；0.0% 只能证明「两次测量是同一条件」，不能证明「引擎没变重」。要判定小幅度性能变化，均值本身没有分辨力。
- **提案方向**：改为记录**帧间隔分位数（p50 / p95）**、**长帧计数（>20ms 的帧数）**、**单帧 WebGL 耗时**（GPU timer query 或渲染阶段耗时；不可得时退化为 CPU 提交耗时并标注）。这三项对截顶不敏感，能把「重了 0.5ms」从噪声里分出来。
- **为什么不进闸门 [事实]**：共享 CI runner 的调度与 GPU 无隔离，同一份代码在快慢机器上的分位数会差出数倍；一旦写成阈值，机器波动会变成假红，反而逼人调阈值。先作为**记录项**落盘（沿用 `fps-protocol` 的口径与钉住条件），等积累多台 runner 的分布后再决定是否入闸。
- **代价**：需要扩展取样脚本（记录原始帧间隔、按阈值计长帧、接入 GPU 计时）；不改现有闸门阈值。
- **建议时机**：下一次要做「升级/优化前后」的性能判定时。
- **是否需要用户决策**：**否**（先按记录项推进；入闸时机再议）。

## G. 合并窗口登记（2026-11-07）

### G1. `npm test` 会改写 `docs/evidence/soak/witnessed-corroboration.json`

- **现象 [事实]**：跑一次 `npm test` 之后，该文件被写成 LF 行尾，`git status --short` 显示 `M`，但 `git diff` 为空（纯行尾差异，内容逐字未变）。已在本轮合并中两次复现。
- **影响 [事实+推断]**：每次跑测试都会在工作区留 `M`，交付账本默认拒绝脏工作区；靠人记「复位一下」不是判据，下一个人遇到同样的 `M` 会怀疑真的有内容改动。
- **建议**：该测试应在临时副本上跑，不许改写工作区文件；这不是本轮合并能顺手改的范围。
- **是否需要用户决策**：否（登记为待修项）。

### G2. 合并窗口内的前向引用（允许记红放行，结束回访）

- **引用 [事实]**：新 ADR 引用的岸带设计文档，以及岸带根因调查引用的岸带证据说明；两份目标文档都只存在于 `feat/shore-band` 分支。
- **消解点 [事实]**：两份文件都在 `feat/shore-band` 上（第 3 步合入），合入后应由 `audit-citations --strict` 自动消解。
- **纪律**：合并结束时逐条回访；一条没消解就是失败，不许当「已知红」长期挂着。
- **是否需要用户决策**：否（前向引用登记，不是缺陷）。

### G3. 合并窗口期间 anim-fsm 工作树存在并发写入（2026-11-07）

- **事实**：19:0x 首次核对时为 7 个已改 + 3 个未跟踪；19:14–19:36 之间又新增/改写了 5 项（MAT-G2 板缝测试、建筑渲染源码、剩余问题清单、指标账本、soak 证据），mtime 距核对时间仅数分钟，说明该线仍在写。
- **处置**：合并窗口暂停第 2 条，不 add / 不 commit / 不 checkout / 不跑测试（跑测试会改写工作区文件，已两次复现 LF 副作用）；等该线自行收尾并以它自己的提交为准，再按 `origin/main..feat/anim-fsm-render` 核对。
- **影响**：并发写入期间任何提交都可能截到半成品，且事后无法分清哪部分已定稿。
- **是否需要用户决策**：是（由该线声明收尾时间）。


