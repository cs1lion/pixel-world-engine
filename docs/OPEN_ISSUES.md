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
  - 2026-11-08：已让 `module` / `compile` 的红直接打印「命中的规则 + 全量输出行号 + 出错文件 + 上下文」，不再只给 `tail(output, 18)`；模板拦截仍未做。
- **是否需要用户决策**：否（已按「登记已知误报」处理）。

### B8. `TERRAIN_SPECK` 5 个键全仓无读点（死数据，只登记不删）

- **问题**：`TERRAIN_SPECK` 的 `grass` / `stone` / `plaza` / `farm` / `tree` 五个键在 `src/`、`test/`、`scripts/` 中均无读点，属死数据。**[事实]**（实测：`node world-client/scripts/audit-palette.mjs --strict --sites`，逐 token 列表里这 5 个键的读点为 0；其余 24 个 `WORLD` 槽均为 24/24 静态可证引用）
- **证据**：定义在 `world-client/src/world/palette-data.ts`；审计逐条读点明细见 `docs/evidence/palette-threshold/README.md`（「`refs` 反向核查」一节）。
- **影响**：读色板的人会以为它还有用；但删键可能连带影响打包/类型闭集与体积预算，风险大于收益。
- **建议时机**：等下一次要动 `palette-data.ts` 或打包清单时一并处理。
- **是否需要用户决策**：**是**（删除 vs 保留）。本轮按「只登记、不删表项、不改打包」处理。

### B9. `audit-reports` 只审计 delivery 块，散文里的数字不在输入里

- **问题**：`audit-reports` 只扫 `docs/**/*.md` 里的 `<!-- delivery {...} -->` 机器可读块；没有 delivery 块的证据 README，无论散文里写错文件数/像素数，报告都是 `reports=0 issues=0`。**[事实]**
- **证据**：2026-11-07 借 `feat/stair-flight` `c0cbd3c` 上的 `audit-reports` 脚本扫本分支 `docs/`，输出 `reports=0 artifacts=0 checks=0 issues=0`、exit 0；当时 `docs/evidence/p1-shore/` 的人读清单写成 18 个文件，实测递归 17 个。R1 的 bytes/sha 只校验 `artifacts[]` 逐条列出的路径，不校验散文里的计数。**[事实]**
- **影响**：报告纪律里最容易被漏掉的正是「人写的一句话数字」；lint 全绿会给出「已审计」的错觉。
- **建议时机**：下一次改报告纪律时；本分支只登记，不改工具。
- **是否需要用户决策**：否（登记缺口）。

### B10. P1 岸线带在 4× 观察下读成描边/色带（观感待改进）

- **问题**：`dengchao` 的 `shore: inset depthPx=3` 在石板段读成「浅边 + 深带」的双线，草地段几乎与草同色；两段都不像草泥过渡。**[事实]**（4× 裁剪 `docs/evidence/p1-shore/crops/noon-{low,high}-4x.png`）
- **证据**：带 12 设备像素、上下沿笔直；石板段带色 `#3e5b65`，与水之间隔 8 px 浅色陆边；草地段带 `#2d4a55` vs 草 `#30454a`（Δ≤11 色阶）。A1–A4 全绿只说明几何/像素关系，不说明观感。
- **v2 复测**：单格 8–14px 版（`depthPx 12`、实色三段 `deepShade/water/plaster`）在 4× 裁剪上仍读成「深蓝宽带 + 米色方块」，判定仍是②；全部改动存档在临时分支 `experiment/p1-shore-v2-archive`（提交 `e3868e5`，未验收、未合并、未丢弃）。
- **根因**：可辨阈值实测 ΔL* 6（ΔE2000 5.53）；24 色暖中性 L* 33–72 无中间档，`farm→plaster` 一步 ΔL* 39.5；参考岸宽折成 1.4–5.25 格，单格 16px 承载不了三档。继续调 `depthPx` 只会在「大跳」和「看不见」之间来回选。
- **影响**：若目标是「不描边」的岸，这一版是另一种错；继续加宽只会把线变粗，不会变成岸面。
- **建议时机**：v3 改走「构件化、跨 2–3 格」——夜岸用现成冷灰三档 `soil→farm→stone`、宽 24px、确定性错位；判据与分配规则见 [P1_SHORE_BAND_DESIGN.md](P1_SHORE_BAND_DESIGN.md) §6。停止再调单格宽度/第三组色值。
- **是否需要用户决策**：**是**（批准 v3 设计与「4× 仍②就停手」的停止规则）。

### B11. 分支收工前只跑本线检查，漏掉跨模块的静态自检

- **问题**：分支收工时只跑本线相关检查（`fixture:check` + `check-types`），不跑全量 `npm test`，跨模块的静态自检不会被发现。**[事实]**（2026-11-08 合并时：J1 的 `fe460a1` 重录只刷新了 `recorded`，漏改 `trace.eventRange.to`（101/458 未跟到 95/446）；`fixture:check` 6/6 全绿，而 `npm test` 的 `fixture-self-check.test.ts` 红）
- **影响**：语义层的回放闸门（`fixture:check`）不校验 `eventRange` 条数，只有全量测试里的静态自检会抓；只看回放绿会给出「夹具已对齐」的错觉。
- **建议时机**：立即生效——**分支收工前必须跑全量 `npm test`**，并在分支说明里贴 0 fail 的读数。
- **是否需要用户决策**：否（流程纪律，已记入收尾清单）。

### B12. 扫描磁盘的审计只在工作区验收，结论依赖本机残留状态

- **问题**：凡是以「磁盘上有/没有某个文件」为判据的审计（`audit-citations`、`audit-references`、`audit-orphan-gates` 之类），在工作区跑出的绿可能只是「这台机器上碰巧残留了生成物」。**[事实]**（2026-11-08 同一个晚上两次「本地绿、CI 红」：一次是 `tmp/witnessed-corroboration.json`（跑过测试才存在的运行时产物，被 gitignore），另一次是 `node_modules` junction；两者在干净检出里都不存在，判据于是翻转）
- **影响**：工作区绿把「判据依赖残留状态」伪装成「已通过」，问题只在 push 之后由 CI 暴露，定位成本翻倍；更坏的是有人会拿白名单把这种红按下去，判据从此少一层。
- **建议时机**：立即生效——**涉及扫描磁盘的审计，验收必须在 `git archive HEAD`（或等价）导出的干净检出里再跑一遍**，不能只在工作区跑；两种状态（干净检出 / 本地有残留）都要绿才算过。
- **是否需要用户决策**：否（流程纪律）。

### B13. `creation-ledger` 集成测试的就绪判据：一次 20 秒超时，根因未证（判据本身已实测排除）

- **现象 [实测]**（2026-11-08，合并后第一次 `npm test`）：`test/creation-ledger-server.integration.test.ts` 第 331 条「一端成功后另一端拿着旧队列重开页面」在 **20.15s** 报「服务在 20 秒内没起来：…」，而该子进程日志已打印 `INFO: Uvicorn running on http://127.0.0.1:1723`。同一文件单独复跑 6/6（10.8s），全套随后连跑两次均 0 fail。**没有把它当成已修好**。
- **就绪判据 [事实]**：`startServer` 每 200ms `GET http://127.0.0.1:<port>/api/creation-ledger/entries?worldId=probe`，只接受 **200**，20s deadline（`world-client/test/creation-ledger-server.integration.test.ts:130-155`）；4xx/5xx 会被当成「还没起来」；失败只输出最后 4000 字日志 +「20 秒内没起来」，**不报最后一次的 status / 错误码 / 距 spawn 的毫秒数**。
- **实测分布 [实测]**：连起 8 次真实 `uvicorn main:app`（与测试同一命令、同一 URL），`first200` = **849 / 860 / 861 / 871 / 876 / 885 / 901 / 908 ms**（p50 **871**、p95 **908**、max **908**）；`Uvicorn running` 日志 697–748ms；8/8 成功。冷启动阶段 4 次 `ECONNREFUSED`（预期），**8 次里没有出现任何 4xx/5xx**。
- **已排除**：
  1. **轮询问错路径/状态码** —— 同一 URL 实测 8/8 直接 200；
  2. **首次请求冷启动耗时** —— 实测 ≤0.908s，20s 阈值余量约 22×，不是「接近阈值」；
  3. **进程提前退出** —— 该分支会报「服务进程提前退出」而不是本条；
  4. **Windows 端口排除区** —— `netsh interface ipv4 show excludedportrange protocol=tcp` 只有 `50000–50059`，与那次 1723 无关。
- **未证根因 [事实]**：那次 20 秒里 fetch 始终没拿到 200，而本子进程日志已显示监听。剩余嫌疑是「1723 上的监听不是该子进程的 socket」或「连接层瞬时被拦（本机安全软件 / 瞬时端口占用）」，两者都**没有直接证据**。因此：**不调阈值**（8 次实测 p95 0.908s，没有调的依据）、**不复跑换绿**、**不改判据语义**。
- **若再红，先采什么 [计划]**：在同一失败时刻记录「最后一次 status / 错误码、从 spawn 到 running 的毫秒数、从 spawn 到第一次非 ECONNREFUSED 的毫秒数」；建议给 `startServer` 的失败信息补 `lastStatus / lastError / msSinceSpawn`（**只改诊断输出，不改判据**）。
- **不做的事**：不抬 20s、不加白名单、不把「复跑绿」当作结论。
- **建议时机**：CI 再次出现该条红时优先做；或下一次动这个集成测试时顺手补诊断字段。
- **是否需要用户决策**：**是**（是否给 `startServer` 补诊断输出，需要单独一次提交授权）。

### B14. 合并前没有在被合并的提交上跑过闸门（2026-11-08 登记）

- **问题**：`chore/eval-screens-audit` **一次 CI 都没跑过**就合进了 main（`gh run list --branch chore/eval-screens-audit` 为空）。它带进来的两个测试在 base 上的红不合规：`check-setting-scale-probe.test.ts` 裸 `await import` 新模块 → `ERR_MODULE_NOT_FOUND`（占 `module`），`audit-references.test.ts` 静态 import 新导出 `silentWindow` → `SyntaxError`（占 `compile`）。**[事实]**（`eafbcc3` 的 CI run `42421415005`：`world-client` job 红在 `red-first`，`RESULT=ERROR kind=module`；本地用同一 base `7636c64` 复现，全量输出里决定分类的是那两条，`shot-stable` 的断言红只是被 `tail` 留下的最后 18 行）
- **判据不动**：`red-first` 判红是对的，`classifyBaseFailure` 的优先级（`module > compile > crash > assertion`）与全部阈值都不改。修的是测试形状：模块不存在 / 新导出不存在，一律「动态 import + `typeof fn === 'function'` 断言」（B7）；**谁把判定范围放宽去容忍 module 红，等于把这道闸门关掉**。
- **建议时机**：立即生效——**合并前必须在被合并的那个提交上跑过一次 `red:first` 与全量 `npm test`，用与 CI 相同的 base；没跑过不许合。**
- **是否需要用户决策**：否（流程纪律）。

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

### D7. 残留的单层太阳语义（低优先级清理）

- **问题**：地形的倒角受光、角色衣缘的受光/暗边、幌布的偏移，仍按「单一光源方向」写死；本轮统一的是**建筑接地影**的方向语义（静态结构/接触影，不来自太阳），没有覆盖这三处。它们当前不会随相位改向，读起来像「一直有一盏灯在左上方」。**[事实]**
- **位置 [事实]**：
  - [tilemap.ts](file:///D:/project/pwe-lighting/world-client/src/render/tilemap.ts#L335-L336)：石块上/左各 1px 受光，注释「光从左上打」；
  - [villager-layout.ts](file:///D:/project/pwe-lighting/world-client/src/render/villager-layout.ts#L415-L419)：左缘 1px 受光、右缘 1px 暗部，注释「光从左上来」；
  - [banner-motion.ts](file:///D:/project/pwe-lighting/world-client/src/world/banner-motion.ts#L85-L85)：幌布影比布身多走 1px，注释「光从西边来」。
- **为什么不现在改**：这三处都在 24 色平涂的**结构线**里，改向会动到地形/角色/幌布整片像素基线；G1 的 4× 对照判为「看不出来」，按规则只改注释、不记待裁决项。本轮不动像素。**[事实+推断]**
- **建议时机**：下一次动地形/角色/幌布基线时，与像素改动同批处理；只改注释也可以，但不能让「太阳」两个字继续暗示有相位光。
- **是否需要用户决策**：否（低优先级清理；是否并入相位光照系统，到下一次基线变更时再议）。

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
- **2026-11-06 已落地 [事实]**：按用户裁决统一写入口——所有出图 gate 默认写未跟踪的 world-client/tmp/screens/<脚本名>/；写回 `eval/screens` 基线须显式 `--write-baseline` 或 `EVAL_OUT=eval/screens`；目标目录命中已跟踪文件又无授权时直接拒绝退出，并打印会被覆盖的文件清单与两条放行命令。判断集中在 [shot-output.mjs](file:///D:/project/pwe-docs-fix/world-client/scripts/lib/shot-output.mjs)，已接入 A 档 12 条（含 `check-creation`、`check-dengchao` 两条原本无出口的）、B 档 5 条，以及 `check-shot-actor-pin` / `check-rain-pin` / `accept-live`；`lamp-band-before*` 三件仍保留在 `eval/screens/`（E7 修死接后：before JSON 已补 `params`，`check-lamp-band` 实测读它做像素差；缺件/协议不符会判红退出），不随输出目录漂走。
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

### E7. `eval/screens` 的 157 张 PNG 基线没有 CI 消费方（已结案：选 B，2026-11-07）

- **现状 [事实]**：`world-client/eval/screens` 跟踪 **169 件 = 157 PNG + 3 HTML + 9 JSON**（HEAD `bfe4487`）。
  "157" 只是 PNG 数，不是全部跟踪件；12 件 sidecar 一直没进过任何计数。
- **读取方 [实测]**：CI 六条闸门都不读这批图，但不是零读取方：
  `check-lamp-blindspot.mjs:25-27` 实际读 `lamp-band-after.json` 与 `-lit/-dark`（:34-36 缺件即抛错）；
  `check-lamp-band.mjs` 读 before 三件（`lamp-band-before.{json,lit,dark.png}`）并做像素差。
  **2026-11-07 修死接后**：before JSON 已由产出方补写 `params`（seed=20261019、trueClear=true），
  缺件 / 缺 params / 种子不符 / 非真晴 / 尺寸不一致一律打印原因并退出 1，不再静默跳过。
- **分类 [实测]**：① 闸门读取 **6** 件（after 三件 + before 三件）；② 文档/证据引用 **160** 件；③ 零消费零引用 **3** 件
  （ground-shadow-closed-t.png、scene-motion-dark-t.png、scene-motion-dark-t1.png）。
  逐件证据（脚本行号 / 文档行号）与全量表见 `docs/evidence/E7_SCREENS_CONSUMPTION.md`。
- **before/after 对比首次跑通 [实测，2026-11-07]**：灯亮图 10476 / 563520 像素变化（1.9%，最大差 19）；
  灯灭图 0 / 563520（0.0%，最大差 0）。灯灭图逐像素不变；灯亮变化的 bbox 为 x226..959 / y238..449，
  横跨整街且高于地面光池（band y435..535）——`POINT_POOL_RX` 同时波及灯体周围光照，
  脚本注释里「只在池子附近变」的旧假设不成立。这一段判据被静默跳过期间，没人能看见这件事。
- **选项**：A 接进 CI（先钉住重跑不稳的图，再让 `check-*` 把 `eval/screens` 当逐字节基线）；
  B 降级为人工视觉参考（不接闸门，保留 44px 裁切与 7.8–8.9% 材质漂移标注）；
  C 整批删除（承认这批图无法判断 FSM 变化）。
- **本轮 [事实]**：选 **B**。A 前置不成立：144 张可生产图里 108 张尺寸不同、23 张同尺寸但同构建重跑即变
  （`docs/evidence/ANIMATION_BASELINE_VERDICT.md` §2.1）；C 会打断 163 件证据引用并删掉 3 件实测读取件。
  已删除 ③ 的 3 件，删除提交说明含"删了什么 / 凭什么判定 / 如何复核"；**不新增闸门**。
- **复核 [实测，2026-11-07]**：删除后 `check-lamp-blindspot` / `check-lamp-band` / `check-scene-motion` /
  `check-ground-shadow` 全绿；`npm test` 唯一红是工作树目录名导致的 `audit-citations` 既有引用
  （主树同测试 5/5 绿），与删除的 3 件无关。现计数 **166 件 = 154 PNG + 3 HTML + 9 JSON**。
- **建议时机**：下一次要把某组证据转成回归时。届时唯一现成读取入口是 `check-lamp-blindspot`（after 组）；
  其余组要改各自 `check-*` 的读取逻辑，属"新建闸门语义"，不在本条范围。
- **是否需要用户决策**：**否**（本轮已按证据裁决 B 并执行；要改 A/C 再单独裁决）。

### E8. `memory-witnessed-corroboration` 测试直接改写已跟踪证据文件（已修，2026-11-07）

> 编号说明：E7（`eval/screens` 基线消费审计）原在 `fix/entry-hint-clip` 分支登记、未合入；
> 本条分支已完成审计并结案（见上），**E8 编号保持不变**。

- **现状 [事实]**（2026-11-07 已修）：该测试默认只写 `world-client/tmp/witnessed-corroboration.json`（gitignore；运行期生成，不入仓），并对已跟踪证据做 EOL 归一化后的内容比对；仅显式 `PWE_WRITE_WITNESSED=1` 才写回 `docs/evidence/soak/`。`verify-all.mjs` 里为此存在的 `PRESERVE` 备份/还原已删除。
- **复现 [历史]**：2026-11-07 两次 `npm test` 均复现；内容语义未变，但行尾从 CRLF 变 LF，`git status` 立刻多出一条 `M`。
- **问题 [事实]**：检查应当只读或写临时副本；靠「跑完再还原」兜底，迟早有人把 LF 重写当成正常 diff 提交，或者忘还原后把噪音带进提交。
- **落地验证 [实测]**：删掉自动改写后连跑两遍 `npm test`（2525 tests / 2516 pass / 0 fail / 9 skip），`git status --porcelain` 只剩本次代码改动的两个文件；该文件 `git hash-object` 前后均为 `b9c3214bc1568de714ebe8e9fbfec7384b0be5be`。
- **新边界 [事实]**：基线数据或分桶变化导致读数与已跟踪证据不一致时，测试会红并提示用 `PWE_WRITE_WITNESSED=1` 刷新，不再静默改写。
- **临时纪律**：原「跑完必须 `git checkout -- docs/evidence/soak/witnessed-corroboration.json`」已失效，不要再按那条做。
- **建议时机**：下一次动 memory/witness 测试或 CI 时。
- **是否需要用户决策**：**否**（方向明确：检查不许改写工作区）。

### E9. `canvas.screenshot()` 会把 DOM 叠层截进字节：逐字节像素闸门的前提要先复核

- **现象 [实测]**：`canvas.screenshot()` 截的是「页面渲染后裁到元素包围盒」，不是 canvas backing buffer —— DOM 叠层会被截进字节。注入 40×40 纯红 DOM 后，画布截图字节立刻变化；`#topbar`（0–56px）、`#minimap`、`overlay-name` 都压在画布区域上。
- **证据级别 [事实]**：这条是**实测**，不是推测。它与 `check-shot-actor-pin` 在 CI 首跑 1/1 红「根因未证」是**两件事**，不要混写：那条只说明「本机 30 轮 0 红，测不出来」，这条说明「截图面本身不纯」。
- **影响面 [事实]**：所有做逐字节比对的像素闸门都可能受同一因素影响——至少点名 `check-ground-shadow`、`check-shot-actor-pin`、`check-phases-negative`，以及直接对 `canvas` 元素截图的 `check-phases`。
  - 已错误地把「DOM overlay 不在画布里」写进注释：`world-client/scripts/check-shot-actor-pin.mjs` 第 14 行（「只拍 `#app canvas`：DOM overlay（名字/气泡）与纸面不在画布里」）。该断言与实测不符，必须按错的写。
  - 这条不是没人踩过：`check-banner-smoke`、`check-stall-motion`、`check-scene-motion`、`check-ground-shadow`、`check-glow-contrast` 与 `capture-palette` 的部分档位都主动隐藏了 `#world-overlay` / `#debug-panel`，说明问题已被局部绕过，但没有统一前提。
- **续证（2026-11-08）[实测]**：`canvas.toDataURL()` 在这套 WebGL 上下文里返回**全黑**（480×320，`r=g=b=0`、alpha 全 255）——「改读 backing buffer」不是免费选项，需要 `preserveDrawingBuffer: true` 或渲染后 `gl.readPixels`，两者都要动渲染初始化并处理取样时序，成本如实记在这里。
  - `#world-overlay` 实测是**透明容器**（`background: rgba(0,0,0,0)`、`background-image: none`、`pointer-events: none`、`z-index: 6`，与 canvas 同框），不是压暗层；压暗画在 canvas 上。隐藏整个容器会把区域名/露话一起藏掉，那等于换了判据对象。
  - 判别实验：`check-phases-negative` 的整画布雨幕取样，隐藏 `#world-overlay` 与保持原样**都是 60 帧未收敛**（正控 5 帧收敛）——说明该反例测的是画布雨幕，不是 overlay。
  - 测量面分组已收敛为单一来源 `world-client/scripts/lib/measure-surface.mjs`：`CHROME`（隐藏）/ `SCENE_DOM`（保留）/ `DYNAMIC`（逐帧会动，逐字节判据取字节前隐藏）。两个像素闸门都改用它，并在真实页面上断言隐藏清单的选择器都存在。
- **为什么重要**：如果 CI 与本地在字体、抗锯齿、叠层布局上不同，那么「逐字节相同」这个前提在 CI 上可能**永远不成立**——`shotStable` 修法（等连续 8 帧逐字节相同）会等不到第 8 帧，先卡在前提上。所以顺序必须是：先决定截图面要不要剔掉 DOM（隐藏叠层，或直接取 canvas backing buffer），再决定判据要不要改；顺序反了，就会把「重试换绿」当成修法。
- **不做的事**：**先不修，只登记**。等 `check-shot-actor-pin` 的撤回落定后单独排期。
- **建议时机**：下一次动任何逐字节像素闸门之前。
- **是否需要用户决策**：**是**（「截图面剔 DOM」还是「改判据」，二选一要先定）。

### E10. `扫描：木框立柱 X（= 墙高）` 从 `2589366` 起名不副实：判据只写在 ADR 里，代码从未比较（2026-11-08 修）

- **比较对象原文**：`check-setting-scale.mjs` 曾打印
  `扫描：木框立柱 ${frameH}（= 墙高）`。`（= 墙高）` 是**硬编码文案**，不是比较结果——
  代码里没有任何一处把 `scanned.frameH` 与 `metrics.shopfrontH` 比过；语义上的对照
  对象是 `metrics.shopfrontH`（48），但等号是字符串拼上去的。
- **消费方（全部）[实测]**：① 控制台那一行；② JSON 的 `scanned.frameH`；③ 并排图
  「像素读数」表格里的「店面墙 · 扫描」格。其它脚本、单测都不读它（全仓检索
  `frameH` 只命中这三处加上本文件）。所以它是**参考读数**，没有判据消费。
- **判据出处与失效起点**：ADR 决策「两者不一致即为失败」把它当成判据输入，但从未落到
  代码。`2589366`（2026-11-04，材质升级）在扫描列上画了 4 颗木纹刺后，读数从 48 变成
  13；此后每条回执都在打印 `13（= 墙高）`，直到 2026-11-08 重拍才发现。它不是「闸门变红
  没人管」，而是**闸门只有一句文案、没有比较**。
- **处置（2026-11-08）[实测]**：新增 `scanned.wallBandH`——允许 ≤3 世界像素断点的连续
  段，量到檐口下沿；同帧对照：新 PNG `frameH 13 / wallBandH 48`，旧 PNG `48 / 48`。
  控制台改为 `墙高 48（= 墙高 48）；连续段口径 13（受木纹刺/板缝影响，不等于墙高）`；
  `frameH` 保留但明确标「不等于墙高」，并排图表格改用 `wallBandH`。
- **守卫 [实测]**：`annotateEquality` 只有真相等才产出 `（= 墙高 48）`，不等产出
  `（≠ 墙高：读数 13，期望 48，差 -35）`；`check-setting-scale.mjs` 在
  `wallBandH ≠ shopfrontH` 时打 `[扫描自洽]` 并 exit 1。单测钉住：相等写等号、不等写
  `≠` 且不许出现 `（=`、非有限数直接抛（`test/check-setting-scale-probe.test.ts`）。
- **判据本身跑红的证据（2026-11-08）[实测]**：桩页 `mismatch`（钩子仍报 48、桩页把墙
  画成 56px，判据常量一个字没动）跑出
  `扫描：墙高 56（≠ 墙高：读数 56，期望 48，差 8）`，
  stderr `[扫描自洽] 判红：墙高扫描 56 ≠ 常量 48，差 8`，exit=1；JSON 在判红前已落盘，
  exit 1 使它不构成通过。`node test/fixtures/setting-scale-hook-probe.mjs` **6/6 PASS**。
- **容差与独立性 [实测]**：`≤3 世界像素断点` 是政策常数（为什么是 3、放宽到 6 要如何
  记账，见 `docs/adr/ADR_SCALE_DUAL_READING.md` 的「政策常数」与「量法的适用边界」）。
  同一冻结帧对三家 `shopfront`（`(12,27)` / `(36,27)` / `(48,27)`）各量一次，
  `wallBandH` **均 48**；`frameH` 12/13/12 的差异只来自木刺位置。窗（`x+5` 起）、
  窄立面门（`x+width-18` 起）、竖招牌（`x+width-7`）、挂灯（檐下幔脚）都不在左木框
  列，故不打断。边界：本口径只覆盖 `shopfront` 这一种 48px 窄立面，`shopfront_gable`
  （y=23、落地线不同、带圆窗）不在本闸门扫描范围。
- **建议时机**：已修；下次改扫描列或材质时检查列上是否有 1–3px 纹理。
- **是否需要用户决策**：**否**。

### E11. 扫描面地板仍有 22% 的「无感塌陷窗口」——有意的取舍（2026-11-08 登记）

- **现状 [实测]**：基线刷新后 `references` = 529，允许降 `max(5, 2%) = 11` → 地板 518；
  过期线 = 529 + `ceil(529×20%)` = 635。两者之间 **117 处（22%）** 的回落不会触发任何
  红。`ports`：基线 155 → 地板 150、过期线 186，窗口 **36 处（23%）**。绿路径现在直接
  打印这组读数，由 `silentWindow` 实算，不写死。
- **为什么留窗**：地板要容忍正常波动（挪函数、改注释只漂几处），过期线要容忍正常文档
  增长；两头都收紧到「任何回落都红」，会把每次文档改动都变成红，训练人忽略红——那比
  22% 的窗更糟。
- **现在为什么不收紧**：没有按文件粒度的引用记账，只能看总数；总数说不出「哪一篇文档
  没了」，碎了也定位不到，先把窗口显示出来。
- **将来什么条件才允许收紧**：有了按文件/按扫描根粒度的记账（能指出具体少了哪一篇）
  之后，可把 `minDrop`、2%、20% 一起收紧；届时按政策常数记账（理由 + 当时的实测面 +
  谁批的）。
- **本轮不做什么**：不改 `minDrop=5`、`ratio=2%`、`STALE_RATIO=0.2`；这条是把窗口变成
  读数，不是堵窗口。
- **建议时机**：有按文件粒度记账之后。
- **是否需要用户决策**：**否**。

### E12. `check-ground-shadow` 未锁镜头，测到的是自动导演 pan——不是场景内的帧驱动微动（2026-11-08 判别更正）


- **定性更正 [实测]**：原文的定性（「画面里有一处按渲染帧推进、不随世界钟推进的微动」）是错的。判别实验把那处变化的来源定位到**自动导演的镜头平移**，不是场景内容：该闸门从未锁机位模式，世界冻住后导演在 ~1000 帧自己 pan 一整屏，画布上看到的变化是**视图变换**在推进。原文的 11 px 只是 pan 尾部的 sub-pixel 边沿（楼体右上沿的抗锯齿边），不是独立的动画源。
- **判别读数（两组，互相印证）[实测]**：
  - 隐藏后比对（按测量面契约的 CHROME + DYNAMIC 清单隐藏叠层，先用现成断言确认这些选择器在真实页面上都存在）：闸门口径（世界冻在 18:10、隔离全开、机位 400/470、冻结帧时钟逐帧步进）下，DOM 可见时目标 ROI **0/59 帧有变化、maxΔ 0**；隐藏后反而 **6/59 帧变、maxΔ 22**。变化没有消失——不是 E9 那类 DOM 叠层被截进字节。
  - 换取样面（绕开 `canvas.screenshot()`，直接从画布 backing buffer 取）：目标 ROI（3×2）**18/109** 帧变，整幅 **42/109** 帧变，两者**首变同为帧 1002**。screenshot 与 backing 两个取样面看到同一个起点。
  - 自动导演段：**45/109** 帧变，整幅 563,520 px 里每帧 **17–35%** 在变，bbox 覆盖整幅，maxΔ **198–225**，镜头 scrollX 由 **167.50 → 272.00**——整屏横移，不是某处 11 px 的抖动。
  - 隐形对照：把机位模式锁成 `free` 后，同样步进 109 帧**变化为 0/109**。同一世界状态、同一冻结帧号，只是不让导演动镜头，变化全部消失。
- **坐标空间更正 [实测]**：原文把 `(794,11)` 当页面/世界落点是错的。
  - `(794,11)` 是 **canvas clip 坐标**；换成页面落点是 `(819.5,123.8)`，落在 `#minimap` 的 rect（`816.5, 119.797, 162×122`）里。`#minimap` 属于 CHROME（测量面契约默认隐藏），所以那 11 px 从来不是 minimap 自己在动。
  - `960×587` 也不是画布尺寸：backing 是 480×320，CSS 是 960×640，640 高的画布被 700 高的视口裁到 587。拿 960×587 当坐标系，会把裁切边当成世界边界。
- **修法落在测量侧 [事实]**：给闸门锁镜头（`setCameraMode('free')`），**不动渲染**。镜头平移是合法的视图变换：世界钟驱动该管「场景内容」（摊位开合、灯、影），不该管「取景」。为了让测试方便而把全景镜头绑到世界钟，等于把测试缺陷写进产品。其他像素闸门早已锁 free，这一个漏了，才让「冻结世界 → 逐字节静止」的前提失效。
- **判据改钉语义读数 [实测]**：新增一条正面判据——世界钟 18:11（闭市）→ 19:11（夜市支摊，跨 19:00 边界）后，`STALL_ROI` 的像素必须变、摊位 `open` 读数必须由全 false 翻成全 true。
  - 判据主体钉在 **`open` 语义读数**上，不靠像素差下结论：闭市收摊时像素差仍有 **1340 px**（道具磨损、布面变化），单看「像素有变化」会**假绿**。
  - 红证：把 `open` 造坏后闸门 exit 1，恰好 1 条红（摊位开合读数没有随世界钟翻面）；恢复后文件 sha256 核对为 `209BEFA1D69A9342D933E9EB36EE86A178B9462A728FDEF26C866F8D51801EC8`。
- **与「暂停」成对 [事实]**：原来的「冻结后逐字节静止」只知道「不许动」，不知道「该动的时候要动」。两条一起才叫「由世界钟驱动」：冻结时静止、推进世界钟时变化。
- **影响面与结论更新 [事实]**：像素级回放确定性**在固定镜头 + 同一帧号下成立**；原先「场景里存在一处按帧推进、不随世界钟推进的微动」这个前提不存在了。帧号对齐仍是采样前提（`performance.now` 在初始化脚本里就被换成帧量化值，**亚帧时序与真实 rAF 抖动不在覆盖范围内**），但不再需要为「场景内帧驱动源」保留例外。
- **峰值读数更新 [实测]**：本闸门当前 `peakCommands` 为 **34,522**（同配置连跑 5 轮单值），比 base 的 34,666 少 144 条——18:10 闭市、摊位不支（场所开关按世界钟投影）；把 `open` 造坏成常真才回到 34,666。**天花板 `PEAK_CEILING = 34,666` 未动**：抬升仍要单独记账、由等量删除或重取天花板来抵，不能「先跑绿再说」（口径见 G5）。
- **不做的事**：不改渲染、不改 8 帧前提、不改 `PEAK_CEILING` 或任何阈值、不把这个 bbox 加进任何排除清单、不把闸门从任何地方摘掉。
- **建议时机**：下一次动任何逐字节像素闸门或镜头模式时。
- **是否需要用户决策**：**否**（判别已完成：不是产品动画，修法在测量侧，判据已补）。

### E13. `setting-scale-after.png` 是量测输入，却与运行产物同名同址：一次基线重拍会静默换掉已跟踪基线

> 编号说明（2026-11-08 全类型扫描）：E10 / E11 在 `chore/eval-screens-audit` 分支（旧基线、扫描面地板窗口）；
> **E12 已被帧相位线的在途改动占用**（`main` 工作树未提交：`check-ground-shadow.mjs` 的步进注释、
> `shot-stable.mjs` 文件头、`shot-stable.test.ts` 都已引用）；本条按用户指定用 **E13**。
> 该分支的 E9（旧 `setting-scale-after` 基线）与 main 的 E9 同号、且 main 先入（`ba78b96` 03:04:30
> vs `6386299` 03:52:55），按 M3 顺延；E10 / E11 已被引用不能动，E12 已占用，故 **合并时改为 E14**。
> 全仓最终占用：E9（main）、E10 / E11（chore）、E12（帧相位）、E13（本条）、E14（chore 的旧 E9）。

- **现状 [实测]**：`world-client/eval/screens/setting-scale-after.png` 同时是两样东西：
  (1) `check-setting-scale` 的**量测输入**——脚本把 PNG 解码回像素、算窗口占屏比；
  (2) `--write-baseline` / `EVAL_OUT=eval/screens` 时的**落盘目标**——文件名由 `OUT` +
  `setting-scale-after.png` 重拼，**每次运行都写同一个名字**。默认输出是
  `world-client/tmp/screens/check-setting-scale`（不入仓）；只有显式授权才写跟踪目录。
- **有没有机制能发现「某次运行把已跟踪基线改掉」[实测]**：**没有**。
  - `resolveShotDir` 只在「未授权 + 目标目录里已有已跟踪文件」时拒绝；`--write-baseline` /
    `EVAL_OUT=eval/screens` 是显式授权，授权之后直接写，不再比对字节。
  - `.github/workflows/ci.yml` 的 browser job 把 `EVAL_OUT` 指到 runner 临时目录，收尾用
    `git status --porcelain` 查脏；但 **`check-setting-scale` 不在该 job 的脚本列表里**，
    这条写入链路不被 CI 覆盖。
  - `eval/screens/` 没有 manifest / sha256 / 摘要清单；`setting-scale-after.json` 里的
    `"file": "eval/screens/setting-scale-after.png"` 也不参与任何校验（`load()` 用 `OUT`
    重拼真实路径）。没有任何「已记录摘要」可以拿来判「字节还是不是那一份」。
  - 因此发现方式只剩人工 `git diff` / `git status`，或事后某条闸门读数变了才发现。
- **后果 [事实]**：一次带授权的重拍会把「量测输入」和「本次输出」写成同一份字节；如果新读数变差，
  基线已经先被替换，之后所有比较都拿新字节当基准——「基线是 2026-11-08 那次重拍的已跟踪字节」
  这个前提静默失效，工作区里的旧字节不可恢复（只能翻 git 历史）。
- **修法选项**（本轮只记账，未动代码）：
  1. **临时输出 + 显式 `--update-baseline`**：`check-setting-scale` 永远先写 `tmp/screens/...`；
     另设 `--update-baseline` 才由人把新字节拷进 `eval/screens/` 并单独提交。默认路径里不存在
     「运行即覆盖基线」。
  2. **落盘前比对已记录摘要**：在 `eval/screens/` 放一份 `.sha256` 清单（或 JSON manifest）；
     落盘前算当前 PNG 的 sha256，与清单不符且没有 `--update-baseline` → 打印
     `[判据前提不成立]` 并非 0 退出，不写。
  两者可组合：1 管「写哪儿」，2 管「字节还是不是那一份」。
- **为什么现在不改**：`chore/eval-screens-audit` 已冻结（`de549f3`，不再加提交），且该分支刚重拍过
  这份基线（E9 / `3b68819`）；本轮若在别的分支动同一 PNG / JSON，合并时必然与重拍冲突。
- **顺带收**：`setting-scale-after.json` 的 `"file": "eval/screens/setting-scale-after.png"` 是死字段
  ——它在落盘时写死（`check-setting-scale.mjs` 的 `writeFileSync`），但读取时被 `load()` 用
  `OUT` 重拼的路径覆盖，没有消费者。合入后与上面第 1 项一起删掉（或改成真实相对路径）；
  本轮不动，避免与 chore 分支对同一 JSON 的重写打架。
- **建议时机**：`chore/eval-screens-audit` 合入后、下一次要重拍 `setting-scale` 基线之前。
- **是否需要用户决策**：**是**（选 1 / 2 / 两者）。

### E14. 旧 `setting-scale-after` 基线出自 `2194c52` 构建，落后 350 个提交（2026-11-08 重拍）

- **现状 [实测]**（2026-11-08）：重拍 after 时 `ancient` / `metrics` 的五个尺度值逐一同值
  （30 / 48 / 16 / 58 / 43），但三处读数与图像变了：`scanned.frameH` 48→13、
  `scanned.stoneH` 4→3、`stats.totalCommands` 12363→30021、`stats.graphicsObjects`
  46→155，PNG 哈希不同。命令数 2.4 倍、Graphics 3.4 倍，不是「来源字段过期」能解释的量级。
- **旧基线出处 [实测]**：`git log --follow` 该文件只有两个提交——`2194c52`（2026-11-04，
  「scale: 店面墙 32→48px、灯柱 37→58px」）写入，以及本次 `3b68819` 重拍。`2194c52`
  当时新建了 setting-scale 的 before / after / 并排图三件套，并改
  `world-client/src/render/setting-scale.ts`、`world-client/src/render/setting-scenery.ts`、
  `world-client/src/scenes/SandboxScene.ts`、`world-client/src/ui/debug-panel.ts`。
  `2194c52..HEAD` 共 **350 个提交**（含动画状态机、光照缺口、岸线带、调色板审计、
  设计验收等合入）。所以旧基线不是「过期的来源字段」，是**旧构建的整份产物**。
- **48→13 / 4→3：画面真的变了，但不是板缝——是木纹刺与石脚受光边（2026-11-08 更正）**：
  拿**当前**扫描几何（frameX 148、frameRow 315、frameRefRow 276、stoneX 152、stoneRow 315）
  分别套旧 PNG 与新 PNG：旧 PNG 得 48 / 4 / 43，新 PNG 得 13 / 3 / 43；两图的扫描几何、
  脚本算法完全同一份（脚本扫描段自 `2194c52` 起未改）。差别在像素本身：旧图该列是一整段
  65,45,50 的 192 屏幕像素连续涂装；新图是 61,48,55（52px）与 100,67,64（8px）交替。
  逐段定位后，8px 断点是 `2589366`（「房屋外立面——灰泥颗粒、木纹木刺、石脚砌缝」）在
  木框 `x+1` 处画的 **1×2px `c.timber` 木纹刺，正好压在扫描列 577 上**；4 颗木刺按
  9px 间距把 48px 墙切成 13/7/7/6/6 段，所以「连续段」只数到 13。`stoneH 4→3` 是同一
  提交在石脚顶压的 1px `plaza 0.9` 受光边，吃掉了一行同色石带。基色 65,45,50→61,48,55
  也不是板缝，是新材质/受光层叠加。**此前把 48→13 归因于
  `world-client/src/render/buildings.ts` 的 `WALL_SEAM_PITCH` 是错的：店面的左木框走
  `setting-scenery.ts` 的 `drawShopfront`，根本不经过那段板缝代码。** 结论仍然是
  「算法没换、取样没错，是画面（美术层）变了」。
- **12363→30021 / 46→155：递归口径 + 350 个提交的合计，不是尺度带来的**：旧
  `renderStats` 只报顶层；`9617f3a` 改成递归计数（`visited`、嵌套 `sub.totalCommands`），
  并新增 `top`（仅顶层）与 `containers`。重拍后 `top` 仍是 17,664 / 60，
  `totalCommands` 才是 30,021 / 155。新值与 `check-render-budget` 现峰值 **33,445**
  （G5 天花板 34,666）同量级，说明它是当前构建的真实读数。旧值 12,363 / 46 **与同一
  `2194c52` 的 before 拍统计完全相同**（before 的 `stats.totalCommands` 就是 12,363、
  `graphicsObjects` 就是 46）——直接证明旧 after 记的是那个旧构建。逐个功能归因
  **未做**（需要一次二分，收益不抵「旧基线不可用」这个结论）；350 个提交合入的动画
  状态机、光照缺口、岸线带、调色板审计、设计验收等，共同构成本轮合计读数。
- **为什么不能比 [事实]**：ADR 要求「同机位、同冻结帧、只差尺度这一件事」。旧基线同时
  差了 350 个提交（功能 + 美术 + 计数口径），任何差值都无法归因到尺度；拿它做差会把
  「旧构建」的差异算到本次改动头上。
- **新基线怎么来 [实测]**：`3b68819` 在当前构建上用 `--write-baseline` 重拍 after，
  五个值 30 / 48 / 16 / 58 / 43；JSON 的 `metricsSource` 是实测、
  `metricsFromBaselineConstant` 为 `false`。`before` 未重拍，仍是基线常量口径；并排图
  允许出现，但图上标注「改前为基线常量、非实测、未参与判定」，该 JSON 不带 `metrics`。
- **复核**：`git log --follow -- world-client/eval/screens/setting-scale-after.json`；
  把当前扫描几何套回 `2194c52` 的 after PNG（`git show 2194c52:world-client/eval/screens/setting-scale-after.png`）
  应得 48 / 4 / 43，套当前 PNG 应得 13 / 3 / 43。
- **建议时机**：下一次改尺度、改扫描列或再重拍基线时。
- **是否需要用户决策**：**否**（结论已由像素与提交史证实；重拍保留）。

### E15. P2 移轴：≥1000 建筑附属物在远带露出锐边（S-4 未闭合，C8b 按三机位实测棘轮记账）

- **现状 [实测]**（2026-11-09，`dengchao`，视口 1080×760、糊图在 depth 999，`?dof=on`）：
  剥掉 DOM 地点标签、把 depth ≥1000 的立体构件**藏掉**后，三个机位的远带连续锐边
  全部为 **0 px**（C8 = 闭包完整性，成立）；把构件放回来后残留如下（C8b）：

  | 机位 | 坐标 | 远带构图 | 残留 px | 连通簇 | 最长连续段 |
  | --- | --- | --- | ---: | ---: | ---: |
  | 渡口 `harbor` | (300,160) | 含水 | 471 | 9 | 16.5 world px |
  | 林地 `woodland` | (200,400) | 树林 + 屋顶，无水 | **13,393** | **191** | **88.5 world px** |
  | 屋面 `rooftops` | (800,700) | 屋顶 + 煤场，无水 | 12,760 | 120 | 72.5 world px |

  最差为**林地**（无水机位，最容易露馅的那一个），不是渡口。
- **成因 [事实]**：≥1000 的建筑物、灯街、围栏、招牌与人物按**落地行逐行交错**
  （`sceneryDepth` 与 `villagerDepthAt` 都按落地行取值）。一张平面糊图不可能同时
  压在建筑上、垫在人物下；Phaser 4 的 WebGL 后端又不支持 GeometryMask（只打警告）。
  所以这不是 compose 漏层（藏掉 ≥1000 后 C8 为 0 已证），是**结构上拿不到**：
  要闭合需要逐行重排的立体闭包。
- **定性**：**S-4 未闭合**。P2 成立的范围是「贴地带整片」，立体构件留在 S-4。
- **阈值 [实测推翻后重定]**：用户 2026-11-08 拍的 `≤600 px / ≤12 簇 / ≤18 world px`
  是按渡口单机位估的（远带只有一栋楼的屋顶探进来，残留 471 px）。实测任何无水机位的
  远带都必然收进整片街景或整栋楼，像素级残留 5k–19k（(100,640) 最小 5,317、(120,480)
  最大 19,688），600 在三机位口径下不可达。C8b 因此改为**三机位实测最差 + 余量**的
  回归棘轮：**≤14,000 px / ≤200 簇 / ≤96 world px**。它守「不许悄悄变多」，
  **不是可接受线**；一旦变多，说明有新的 ≥1000 构件越线或糊图闭包被改动。
- **判据落点**：`world-client/scripts/check-dof.mjs` 的 C8 / C8b；三个机位各量一遍，
  取最差打印与记账，读数写进该脚本输出的报告 JSON 的 c8 段。
- **复核**：`npm run test:dof`（需先起 5211 dev server），看
  `C8 闭包完整性：harbor 0px/0px / woodland 0px/0px / rooftops 0px/0px` 与
  `C8b 已知残留最差：woodland 13393px / woodland 191 簇 / woodland 88.5 world px`。
- **建议时机**：做 S-4（逐行立体闭包）时一并收；在此之前不许调高棘轮来「变绿」。
- **是否需要用户决策**：**是**（已知：600/12/18 被实测推翻，用户在 2026-11-09 要求
  改记「三机位最差」；阈值口径与 S-9 是否关路径由用户裁决）。

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

### G1. `npm test` 曾改写 `docs/evidence/soak/witnessed-corroboration.json`（编号 E8，已关闭 2026-11-07）

- **现象 [历史]**：跑一次 `npm test` 之后，该文件被写成 LF 行尾，`git status --short` 显示 `M`，但 `git diff` 为空（纯行尾差异，内容逐字未变）。
- **影响 [事实+推断]**：每次跑测试都会在工作区留 `M`，交付账本默认拒绝脏工作区；靠人记「复位一下」不是判据。
- **处置 [实测]**：旁证测试默认只写 `world-client/tmp/` 并与已跟踪证据做内容比对，不再改写工作区；验证读数见 E8。

### G2. 合并窗口内的前向引用（已关闭，2026-11-07）

- **引用 [事实]**：新 ADR 引用的岸带设计文档，以及岸带根因调查引用的岸带证据说明；两份目标文档都只存在于 `feat/shore-band` 分支。
- **消解点 [事实]**：`feat/shore-band` 已合入（`475a792`）；合入后 `audit-citations --strict` 受查 3630 处、这 2 处均已解析，回访通过。
- **残留 [事实]**：合入后另有 8 处未解析，全部指向 `tmp/` 下未入库的一次性脚本（见 `docs/evidence/p1-shore/README.md`），已按「临时产物改普通叙述」处置，不计入本条。
- **状态**：关闭。
- **是否需要用户决策**：否。

### G3. 合并窗口期间 anim-fsm 工作树存在并发写入（2026-11-07）

- **事实**：19:0x 首次核对时为 7 个已改 + 3 个未跟踪；19:14–19:36 之间又新增/改写了 5 项（MAT-G2 板缝测试、建筑渲染源码、剩余问题清单、指标账本、soak 证据），mtime 距核对时间仅数分钟，说明该线仍在写。
- **处置**：合并窗口暂停第 2 条，不 add / 不 commit / 不 checkout / 不跑测试（跑测试会改写工作区文件，已两次复现 LF 副作用）；等该线自行收尾并以它自己的提交为准，再按 `origin/main..feat/anim-fsm-render` 核对。
- **影响**：并发写入期间任何提交都可能截到半成品，且事后无法分清哪部分已定稿。
- **是否需要用户决策**：是（由该线声明收尾时间）。

### G4. 引用幻影（2026-11-07）

- **定义**：文档引用的文件**在任何历史提交里都不存在**，连「曾经存在、后被删除」都不是。它比「未解析」更硬：后者可能是路径写错或前向引用，前者说明这个引用从来没有真实来源。
- **本轮实例 [事实]**：`docs/investigations/P1_SHORE_ROOTCAUSE.md` 曾引用一个踏步生成器文件名，`git rev-list --all --objects` 全历史检索为空；已改为「踏步生成器」普通叙述，文件名本身不再重复，避免再造一个引用幻影。
- **判据**：文档引用必须能在 `git ls-files` 或 `git rev-list --all --objects` 中命中至少一次；两处都空，即登记为引用幻影。
- **是否需要用户决策**：否（登记口径）。

### G5. 四线合并后的 render 峰值抬升与 `check-ground-shadow` 预算口径（2026-11-07）

- **实测 [事实]**：main（四线全合，`2e22e9f`）同一 dev server 会话（5240）复跑：
  - `check-render-budget` 逐帧递归峰值 **33,445**（昏+暴风雨+灯全开，帧 2565），比材质线基线
    33,357 高 **+88**；8 组合、切换帧与归组方式均未变。
  - `check-ground-shadow` 按自己的机位读出 **34,666**；与 33,445 **不是同一配置，不可互换**。
- **抬升来源 [事实+推断]**：四线里只有 lighting 有逐帧新增——灯压暗环（每盏亮灯 3 环 × 4 条
  `fillRect`）、接触 AO（每栋楼 1 条）、落地影分段；shore 的 321 条只进一次性烘焙
  （`bakeLayer` 的临时 Graphics 不进显示列表），逐帧增量 **0**；anim-fsm 的 MAT-G2 命令中性
  （逐栋板缝 13→13）。+88 是合并后的实测净差，未逐项拆账。
- **处置 [事实]**：按「新功能抬升必须单独记账」，`check-render-budget` 天花板由 33,400 改为
  **33,488**（= 33,445 + 43 条政策余量；相对旧值 +88，全部归 lighting），设计目标 30,000 未动；
  这 43 是材质线 33,357 那组同配置 3 跑（极差 0）设的政策常数，**不是本轮独立采样得出**；
  账本 `render.drawCalls.static.p50` 同步为 33,445、`script_sha` 同步。**这不是把抬升后的值
  当新基线**：+88 记在本条，后续收紧只能来自等量或更多删除。
- **已执行 [事实]**：owner 定走两级口径（目标不动、天花板按本记录器自己的采样）。改动：
  `check-ground-shadow.mjs` 设计目标仍 **30,000**；另设 `PEAK_CEILING = 34,666`
  （同配置连跑 **2 次**峰值均 34,666、**极差 0**，故余量 0；**不套** render-budget 的
  33,445/33,488）。峰值 `(30,000, 34,666]` 记账不红，`> 34,666` 才红。复跑
  `[判据] 绿`、`[记账] 债务 4666`。
- **仍未闭合 [事实]**：该脚本仍不在 CI，只是手工检查；零余量意味着任何新增命令都要重新
  记账，不能用「先跑绿再说」放行。下一步：与其余孤儿闸门一起排期接线（见本节末清单）。
- **是否需要用户决策**：否（口径已定，执行完毕）。

## H. 判据冲突（2026-11-07）

### H1. KB 要点 4 的 `0.18`：**判据造假**（验收文档写了没人测过的数字）

- **严重度**：**判据造假**，不是「参数待调」。验收文档里出现了一个没有任何测量来源的阈值，
  且违反该文档自己第 225 行「`暂定`（0.18 / 2 / 8 / 4）必须在同一份提交里附标定截图和旧值→新值的原因」——
  标定图**不存在**。读数差一点可以调参，伪造靶子只能重立判据。
- **谁定的 [事实]**：`docs/DESIGN_ACCEPTANCE.md` 要点 4，
  `ea762a6d20c9de77399b77fcd5463144bf0618f9`（2026-11-06，guoyu）新增。原始素材只有画册引文
  `p037_L`（72）——*"by reducing the surrounding colors, the color shined like gold."*——**引文无数值**。
  判据形态自标 `像素（阈值暂定，须标定）`；第 105 行写「暂定值 `0.18` 先不进闸门；`dusk` 与 `noon`
  两张标定图落地后再钉」；第 225 行见上。KB 仓库内 `0.18` 只出现在该条判据
  （读数器只在输出行把它当常量打印，见 `measure-design-readouts.mjs` 第 233 行）。
- **差在哪 [事实]**：
  1. **没测过**：`0.18` 不是任何一轮测量的产物，是写判据时的占位值。
  2. **单位没写**：判据写「8×8 patch / 32×32 annulus」而无单位；KB 读数器按**截图 px** 套
     （`patchSize=8` / `outer=32`），本批实测按**世界 px**。annulus 覆盖的世界范围不同，**同一比值不是同一个量**。
  3. **帧态没写**：判据没说 dim 前/后。绝对差会被全局 dim 压缩（dusk `ink` α0.16 → `L' = 0.84L + 2.79`），
     拿 dim 后的帧套 dim 前的绝对差是不同源比较。
  4. **形式与反例自相矛盾**：公式是绝对差 `(patch−annulus)/255`，而反例「全屏压暗而不动发光块：
     比值同样抬高」只在**相对量**下成立；对绝对差，压暗只会让差变小。
- **已定（2026-11-07，用户拍板）——判据改 ②，有界相对量**：
  ```text
  D = (meanL(patch) − meanL(annulus)) / max(meanL(annulus), ANNULUS_FLOOR)
  ANNULUS_FLOOR = 32        // 8 位 luma；写死，不随相位/机位/参数变
  ```
  - 选 ② 的理由：绝对差量纲绑死在全屏 dim 上，每调一次曝光、每换一档时相，判据就换一个意思，
    进不了闸门；相对量在 dim 下近似不变。
  - 必须带分母下限：裸 `(patch−annulus)/annulus` 在 annulus 趋暗时发散；`max(annulus, 32)` 把分母
    钉在 1/8 满刻度，`D` 上界 `(255−32)/32 = 6.97`。`32` 是**防发散用的政策常数**（非实测、来源无读数），
    与阈值一起评审。
  - 残余误差：本仓 dim 是 `ink` 覆盖（仿射 `L' = 0.84L + 2.79`），相对形式仍有 `2.79/annulus ≈ 3%` 残余；
    标定时须同时记录 dim 参数与帧态。
- **`0.18` / `0.10` 的对外口径（一律降级）[事实]**：不得写「未达标 / 不通过」。
  只能写「**靶子无效，当前几何 + dim 下的上界是 0.09–0.10**」。前者指向改美术，后者指向重立判据——
  对后续决策影响完全不同。`0.18` 的标注固定为「**未标定，来源无实测**」，连「暂定」都不写。
- **顺序**：先定形式（已完成），再标定（未做）。顺序反了就是拿一把错的尺子去量。
  **在拿到一张真实参考帧的标定之前，要点 4 不进闸门**——只输出读数。
- **待办**：
  1. `world-client/scripts/check-glow-contrast.mjs` 的比值与红条改为 `D` 形式；`ANNULUS_FLOOR` 与
     未标定标记写进输出。产物（`glow-contrast.json` / `check-glow-contrast-three-phase.log`）里
     现存的 `thresholds: 0.18 / 0.10` 与红条是**撤回前口径**，保留作历史，不得引用为「未达标」。
  2. 主仓 `DESIGN_ACCEPTANCE.md` 由**合并窗口**统一改（含 `0.18` 降级与有界相对形式），本分支不动主仓。
  3. 标定：需要一张 dusk（必要时加一张 noon）真实参考帧，同时记录几何单位与 dim 前后，才可钉阈值。
- **影响**：本批读数 dusk 0.065 / noon 0.026 / dawn 0.065（旧式）；按 `D` 换算为 0.199 / 0.074 / 0.191，
  两项同时「过旧靶子」——结论随形式反转，这正是必须先钉形式的原因。
- **建议时机**：合并窗口处理主仓文档；标定随下一次黄昏美术取样。
- **是否需要用户决策**：**否**（形式已拍板为 ②；剩标定与文档改写，按上述执行）。

## I. 材质细节与后处理（`MAT-` 前缀）

光照线用同一套 `G0–G4` 编号且含义不同（LIGHT-G1 方向契约 / LIGHT-G2 影末端渐隐 / LIGHT-G3 接缝 AO）。
本节编号一律加 `MAT-`，合并进同一份文档时不会互相指错。

### MAT-G1 辉光从「叠层」改为「环带」（已落地）

- **现状（改前）[事实]**：`phase-view.ts` 的 `addGlow` 画三块**嵌套矩形**：外层 `a`、中层 `0.55a`、内芯 `1.15a`。ADD 混合下中心像素被盖 3 层，累加 **2.70a**，而语义上的峰值只有 1.15a。这不是设计亮度，是叠加副作用：没画得更亮，预算却按三层算。
- **处置 [事实]**：抽出纯函数 `glowLayers(cx,cy,w,h,alpha) → { layers, peakAlpha }`，三圈 `0.55a / 1a / 1.15a` 互不重叠；`drawGlows` 只照单 `fillRect`。
- **判据（可证伪）[事实]**：任一像素覆盖层数 ≤ 1；累加 alpha ≤ `peakAlpha`（1.15a）。用例 `world-client/test/mat-g1-glow.test.ts`，五档现网尺寸。
- **红→绿 [事实]**：改前 5 档全部报「像素 (20,20) 被覆盖 3 层，累加 2.70a（声明峰值 1.15a）」；拆环带后 0 失败。
- **读数（环化后、配平前；夜帧祭坛邻域 40×28 世界像素，world-client/tmp/screens/mat-g1/glow-night-{before,after}-4x.png）[事实]**（最终配平状态看下面的对比度行，不要把这张表当成交付读数）：

  | | uniqueColors | outsidePalette | 总能量 Σ(R+G+B) |
  |---|---|---|---|
  | 改前 | 39 | 39 | 808,378 |
  | 改后 | 45 | 45 | 772,266 |

  R 通道 32 一档（0–255）：改前 `[308,3016,604,328,120,80,24,0]`，改后 `[308,3284,616,48,176,48,0,0]`；能量偏差 **−4.47%**。
- **中心变暗与配平判据 [事实]**：中心从 2.70a 降到 1.15a（−57%）。不给视觉拍板，改给一条可测的判据：**光池中心与周边暗街的局部对比度**。
  - 取样框：全部 6×4 世界像素（12×8 后备像素）。中心框 `x 785..791 / y 588..592`（夜帧祭坛光池，开局取景把 (788,590) 钉在后备 (280,188)）；暗街同尺寸两框 `x 765..771` 与 `x 805..811`，同一 y，**取较暗的一框**当参照。
  - 通道/亮度：`scripts/audit-palette.mjs` 同一套口径——sRGB 线性化后的相对亮度 `Y = 0.2126R + 0.7152G + 0.0722B`，对比度 = `(Y亮+0.05)/(Y暗+0.05)`（WCAG 比值）。另附 Michelson `(Lc−Ls)/(Lc+Ls)` 作参考。
  - 下限 **1.67 : 1**。依据是仓里已有的标尺，不是 WCAG 1.4.11（后者 3:1 是给 UI 控件的）：`SETTING_DENGCHAO.md` 实测对子里对比度 **1.00 = 同值、一格都看不见**，**1.67 = 看得见**。**下限必须与这把尺子的「看得见」同值，不能取到它之下**——先前写的 1.5 就是这个问题：读数 1.66 明明低于 1.67 却被判绿，等于用一把标注了「1.67 才看得见」的尺子量完、却把及格线定在它下面。1.5 已作废。
  - 读数（world-client/tmp/screens/mat-g1/glow-night-{before,after}.png）：

    | | 中心均值 RGB | 暗街均值 RGB | WCAG | Michelson | 裁剪像素（邻域 / 整幅） |
    |---|---|---|---|---|---|
    | 改前（三叠层） | 117.3 / 98.5 / 62.5 | 48.5 / 56.5 / 54.6 | **2.05** | 0.2925 | 0 / 0 |
    | 环化后（未配平） | 76.3 / 69.5 / 51.5 | 同上 | **1.26** | 0.1203 | 0 / 0 |

    “裁剪像素” = 任一通道 ≥255 的像素计数。**改前也是 0**：旧亮度不是 ADD 饱和裁剪撑出来的，−57% 是真的丢了光，不是把过曝抹掉。
- **重新配平 [事实]**：环化后 1.26 低于下限 1.67，按判据必须补。补的依据是**不裁剪前提下能给出的最大中心能量**，不是「看起来跟以前一样」：`GLOW_GAIN = 1.62`（`phase-view.ts`，所有 `addGlow` 的 alpha 统一乘上它）。
  - 配平后夜帧（晴、灯全开；tmp/night-wcag-frames.mjs **逐帧采样 20 帧**，读数恒定）：中心均值 97.3 / 87.5 / 61.5，WCAG **1.683**（≥ 1.67），Michelson 0.2319，裁剪 **0 / 0**。
  - 不裁剪余量：最亮的一档是 dusk（glow 1.2），1.62 倍时整幅单像素最大通道 R=**250**，离 255 只剩 **5 级**，整幅 **0** 个任一通道 ≥255 的像素。
  - 读数文件：tmp/screens/mat-g1/worst-{night,dusk}-{clear,rain}-lamps.png。
- **可行窗口 [事实]**：下限来自夜帧 WCAG 1.67，上限来自「整幅零裁剪」（任一通道不得为 255）。2026-11-07 把 `GLOW_GAIN` 逐档改值实测（4 组最坏帧，tmp/glow-worst.mjs，读数落在 tmp/glow-{166,170,174,176}.txt）：

  | GLOW_GAIN | 夜晴 WCAG | 夜雨 WCAG | 昏晴最大通道 R | 昏晴裁剪像素 | 判定 |
  |---|---|---|---|---|---|
  | 1.62（现取值） | 1.683 | 1.737 | 250 | 0 | 过下限 +0.8% |
  | 1.66 | 1.690 | 1.745 | 251 | 0 | |
  | 1.70 | 1.715 | 1.770 | 252 | 0 | |
  | **1.74** | **1.768** | **1.824** | **254** | **0** | **零裁剪边界** |
  | 1.76 | 1.768 | 1.824 | **255** | **40** | 已溢出 |

  - 可行区间 **`GLOW_GAIN ∈ [约 1.61, 1.74]`**（下限由 1.67 的 WCAG 线卡住，实测 1.6 → 1.66；上限由 255 裁剪卡住，1.74 是最后一档全幅 0 裁剪）。
  - 窗口宽度 **0.13（约 8%）**；对应 **WCAG 上限 1.768**（夜晴），比下限 1.67 只高 **5.9%**。
  - **结论**：窗口存在但两端都贴边——1.62 距下限只剩 0.8%，1.74 距饱和尚有 1 级。它**不是**「配平完成、可以随便再抬」；辉光模型的结构性余量确实薄，若以后要明显提亮，必须与「有芯的光池」一并改，靠调 `GLOW_GAIN` 会在 1.76 处直接溢出 40 个像素。
- **最坏帧裁剪 [事实]**：雨 + 灯全开 + 辉光最强的组合，逐项读数（同一取样框与 WCAG 口径）：

  | 组合 | 中心均值 RGB | 暗街均值 RGB | WCAG | 整幅最大通道 R/G/B | 裁剪像素 |
  |---|---|---|---|---|---|
  | 夜 + 晴 + 灯全开 | 97.3 / 87.5 / 61.5 | 48.5 / 56.5 / 54.6 | 1.683 | 242 / 200 / 182 | **0** |
  | 夜 + 雨 + 灯全开（用户点名档） | 94.7 / 88.5 / 66.3 | 44.9 / 54.9 / 56.2 | 1.737 | 242 / 200 / 182 | **0** |
  | 昏 + 晴 + 灯全开（辉光最强档） | 118.3 / 95.8 / 57.0 | 61.4 / 64.8 / 56.8 | 1.740 | **250** / 200 / 182 | **0** |
  | 昏 + 雨 + 灯全开（最不利档） | 114.6 / 97.2 / 63.8 | 56.3 / 62.3 / 58.2 | 1.825 | 242 / 200 / 182 | **0** |

  雨幕上屏前必须先让雨渐变走完（先冻世界钟则雨一帧都不上屏，实测）；这四张图之间的 clear/rain 像素差为 133,836 / 154,080，证明雨真的在画面上。
  「最坏帧裁剪数必须为 0」已写成断言：`scripts/check-phases.mjs` 的 `captureWorstFrame`，night 与 dusk 两档各一条 `check(clip === 0, …)`。天气叠加（雨）实际上是**压暗**整幅（最大通道 250 → 242），当前天气集合里没有会往上叠亮的项；余量守的是这条断言，不是靠肉眼。

- **代价 [事实]**：单团辉光从 3 个 `fillRect` 变 9 个（环带 4+4+内芯 1）；这些指令按递归口径计入 `totalCommands`（见 MAT-G4 预算行）。
- **是否需要用户决策**：**否**（判据、下限、配平都已经落成可复跑的数字）。

### MAT-G3 构件边饰统一（台阶 + 墙都已落地）

- **判据 [事实]**：`buildings.ts` 的 `edgeRows(kind, rect)` 返回**抬升构件的固定边饰**计划——**上/左亮、下/右暗**，token 只用既有 `soil / timberDark / ink`，alpha 恒 1（半透明会被下层石板透成脏灰）。这是**作图约定，不是光照推导**：建筑影已被重定义为固定右下的静态结构/接触影、不来自太阳，所以「受光面/背光边」在这里没有依据。
- **台阶 [事实]**：`drawDoorStep` 消费 `edgeRows('doorStep')`，在 stone 行（22px、两端各内缩 1）下面补 1px `soil`。逐世界像素 diff：**恰 22 格变化**，全在同一行（`col=9..30 row=13`，`#393f2f/#5b523c… → #1b211c`），没有第二行、没有越界。
- **4× 目视 ①② [事实]**：world-client/tmp/screens/mat-g3/step-{before,after}-4x.png（40×24 世界像素 / 4× 最近邻）。判 **①**：1px 暗行只贴在台阶底、与 stone 同宽，读成台阶立面的接触阴影，不读成描边、双线或墙角发黑。没有加宽、没有叠第二层、没有靠加深掩盖。若后续改动把这条读成 ②，按红线立刻停。
- **墙 [事实]**：`drawWall` 现在消费 `edgeRows('wall', {x:0, y:roofH+2, w, h:h-roofH-8})`，在右缘补 1px `timberDark`，竖高与左列 `warmLight` 一致（从檐下阴影下沿到横梁上沿）。方向不再是悬空项：光照线的 G1 结论是「看不出来」，建筑影已是固定右下，右侧收暗与之一致。
  - 逐世界像素 diff（tmp/screens/mat-g3/wall-{before,after}-native.png，同机位）：**恰 1 列 × 33 格**变化，全在世界 `x=719`、`y=442..474`，`#8a5a44 → #4a3f39`。暗列从 `roofH+2` 起画，而那一行本来就是横向 `timberDark` 梁，所以 34 行里只数到 33 处变化。
  - **4× 目视 ①②**：tmp/screens/mat-g3/wall-{before,after}-4x.png（24×36 世界像素 / 4× 最近邻）。判 **①**：1px 暗列贴在墙右缘、直接接生地面，读成墙角的结构收边，不读成描边/双线/墙角发黑。没有加宽、没有叠第二层。
- **skip 已取消 [事实]**：`test/mat-g3-edge.test.ts` 的「墙右暗列接入 drawWall」不再是 skip，是真断言（`# SKIP` 会被计入 `# pass`，等于自己给自己发绿卡）。
- **代价 [事实]**：每栋楼 +1 个 `fillRect`（11 栋 → +11），零新增色。**这 +11 已计入新口径**：楼体 Graphics 在容器里，`renderStats()` 改成递归后它们进 `totalCommands`（口径见 MAT-G4 预算行）。
- **是否需要用户决策**：**否**。

### MAT-G2 墙面纹理按世界坐标锚定（已落地）

- **现状 [事实]**：地面纹理按世界坐标哈希（跨格连续），墙面横板缝却由 `roofH` 与门位 `seed` 派生的**局部坐标**决定，所以两栋同排、同材质、只差楼高（`roofH`）的建筑，板缝相对世界基线取模后对不上——相邻建筑同朝向会错位。
- **预留测试名**：`MAT-G2 墙面纹理按世界坐标连续（相邻建筑同朝向不错位）`（`test/mat-g2-wall-seam.test.ts`）。
- **先红读数 [事实]**（tmp/mat-g2-red.txt，2026-11-07）：
  - `MAT-G2 墙面纹理按世界坐标连续（相邻建筑同朝向不错位）` **FAIL**：同基线、同 seed、`roofH=20` vs `34` 的板缝取模集合 **`1,13` vs `11,15`**；
  - 同一用例里「板缝位置与 seed 无关」的强断言也失败（旧逻辑行位置由 seed 决定）；
  - 另两条（墙带内 / 零新增色）先绿，它们是绿版要守住的边界，不是判据本体。
- **绿版实现 [事实]**：`WALL_SEAM_PITCH = 16`，第一行从 `ceil((worldBaseY + roofH + 3) / PITCH) * PITCH` 起、到 `h - 8` 止，每 16px 一条整行；`seed` 只决定深浅（0.3 / 0.26），不决定位置。`drawWall` 消费 `wallSeamRows()` 的返回值，坐标换算只用 `building.origin.y * TILE_PX`（同一场景的 `originY` 是常量，跨栋比较时相位一致）。
- **绿读数 [事实]**（tmp/mat-g2-green.txt）：3/3 通过（世界坐标连续 / 墙带内 / 零新增色）。
- **像素取证 [事实]**（tmp/screens/mat-g2/，同一确定性协议：正午 + 晴 + 冻钟 00:35 + 居民钉死 + 相机 free 钉在 `code_forge#1` 与 `star_archive#1` 之间；相机 zoom=2，可见世界 240×160）：
  - `png-diff`（before vs after，480×320）：**972 像素（0.63%）**，最大通道差 **36**；
  - **bbox 只落墙带**：世界 `x 641..878.5`、`y 448.5..465`；墙带是 `roofH+3 .. h-8` = 世界 `441..472`，**越界像素 0**（14 个右缘像素是墙最右一列的半像素容差，改判后归零）；
  - **零新增色**：before / after 都是 **304** 色，`after` 相对 `before` 新增 **0** 色（板缝仍只用 `timberDark`，alpha 仍是 0.3 / 0.26）；
  - **4× / 单栋特写**：`code-forge-{before,after}-8x.png`。板缝在板壁区内**横贯整面墙**，只在竖柱 / 横梁 / 门 / 窗台家具处断开——那些构件是在板缝之后画的（`drawWall` 的既有顺序「只在梁与柱之间画」），不是板缝自己断成虚线。
  - 取证用了 `code_forge#1` 与 `star_archive#1`（同排 `origin.y=26`、同高 `h=64 / roofH=22`、门位不同 → seed 不同）：两栋的板缝落在同一组世界 y 上，跨栋对齐；现地图没有「同排 + 不同 `roofH`」的两栋楼，`roofH` 那条由单测合成覆盖。
- **预算 [事实]**：**命令中性（Δ = 0）**——现地图只有 `h=48` 与 `h=64` 两档：旧逻辑分别是 1 条 / 2 条缝，新逻辑落点也分别是 1 条 / 2 条（`h=48` 局部 y 32；`h=64` 局部 y 32、48）。闸门同源读数 **33,357**（昏 + 暴风雨 + 灯全开，帧 2336）≤ 33,400，涨的 6 条落在观测噪声里，不是 MAT-G2 抬的。
- **抬升记账（按用户口径）[事实]**：MAT-G2 **+0 条**（谁抬：无；抬多少：0；为什么：缝条数 1→1 / 2→2，只有位置变）。若以后出现更高楼（`h` 更大）导致缝条数超过旧逻辑的 2 条，**那部分新增命令要单独记账后**才允许抬天花板。
- **是否需要用户决策**：**否**（方向已认可：这是三平面映射唯一能迁到 2D 的等价物）。

### MAT-G4 四时相只读读数（已抓，作为后续改动的准入基线）

- **口径 [事实]**：`?ledger=off&time=<phase>&debug=1`，与 `check-phases` 同一条钉法（取景对准祭坛、free 模式写死中心、时钟 00:35）。输出 world-client/tmp/screens/mat-g4/phase-{dawn,noon,dusk,night}.png，**没有写 `eval/screens`**。不写死哈希。
- **读数（整幅 480×320）[事实]**：

  | 时相 | uniqueColors | outsidePalette |
  |---|---|---|
  | dawn | 582 | 574 |
  | noon | 318 | 301 |
  | dusk | 354 | 345 |
  | night | 360 | 352 |

- **读法 [事实]**：**24 色是源色上限，不是出画颜色上限。**`WORLD` 约束的是「画什么色」，不是「屏幕上出现几种色」：运行时 alpha、ADD 叠加、时相压暗都会合成出 24 色之外的色。表里 `outsidePalette` 四档全大于 0，连最干净的正午整幅也有 **301** 种板外色。所以这张表**不是**「24/24 全绿」，不能读成「画面上只有 24 色」；`outsidePalette > 0` 是预期读数，不是缺陷。
- **用途 [事实]**：它是「辉光/色彩分级改动前后有没有把暗部抬灰」的准入基线，**不要当失败去修**。
- **预算（递归口径，2026-11-07 重测）[事实]**：正午开局（帧 82）逐层读数如下。`renderStats()` 已改成**递归遍历容器**（`top` 是直接挂在显示列表上的，`containers` 是每个容器子树的读数，`graphicsObjects` / `totalCommands` 是整场景合计）。

  | 层 | Graphics | 指令 | 说明 |
  |---|---|---|---|
  | 顶层（`top`） | 28 | 15,515 | 楼体痕迹层（decal）、装饰/道具、时相（glows/fireflies/mist）、天气、天气雾、探索迷雾等；最大一张 14,800 |
  | 楼体容器 ×33（`<id>.back/.body/.front`） | 99 | 11,090 | 11 栋 × 9；back 47/栋、body 821–1,028/栋、front 49/栋 |
  | 居民容器 ×2（`top[25]` / `top[34]`） | 4 | 832 | 每个容器 shadow + body 两个 Graphics（走位时帧间浮动） |
  | **总计** | **131** | **27,453** | `totalCommands = top + Σ(depth-1 容器) = 15,515 + 11,938`（加法校验通过） |

  - **不会重复计数**：Phaser 的 `Container.add()` 会把子对象从场景显示列表里摘掉，容器里的对象只有一条父链；从显示列表根递归，每个对象恰好走到一次，`visited` 只作兜底。同一帧 `top + Σ(depth-1)` 与 `totalCommands` 的加法校验在开局帧和峰值帧都成立。
  - **同一帧新旧口径对照**（旧 = 只数 `children.list` 顶层；新 = 递归整场景）：

    | 帧 | 状态 | 旧口径 | 新口径 | 差（= 容器子树小计） |
    |---|---|---|---|---|
    | 82 | 正午开局 | 15,515 | 27,453 | +11,938 |
    | 133 | 正午（另一采样落点） | 16,171 | 28,109 | +11,938 |
    | 546 | 昏 + 雾 + 灯全开 | 40,203 | 52,125 | +11,922 |
    | 653 | 晨 + 雨 + 灯全开 | 21,579 | 33,621 | +12,042 |

    差值恒等于容器子树（楼体固定 11,090 + 居民 832–952），不是把同一批对象数了两遍；先前 `16,163 → 16,163` 的「没涨」正是因为那 +11 条画在容器里、旧口径看不见。
- **真实峰值（逐帧，不是开局快照）[事实]**：world-client/tmp/peak-frames.mjs（一次性探针，未入库）用 rAF 逐帧读 `renderStats()`，采样 **587 帧 / 10,480.5 ms**（Phaser 帧号 104–690，rAF 与帧 1:1）；覆盖正午开局、夜 + 灯、夜 + 雨 + 灯、昏 + 雨 + 灯、昏 + 暴风雨 + 灯、昏 + 雾 + 灯、推镜头、晨 + 雨 + 灯。

  | 段 | 帧数 | 峰值帧号 | 新口径峰值 | 旧口径峰值 |
  |---|---|---|---|---|
  | 正午开局 | 65 | 133 | 28,109 | 16,171 |
  | 夜 + 灯全开 | 75 | 243 | **30,795** | 18,801 |
  | 夜 + 雨 + 灯全开 | 85 | 248 | **33,101** | 21,043 |
  | 昏 + 雨 + 灯全开 | 84 | 408 | **33,351** | 21,309 |
  | 昏 + 暴风雨 + 灯全开 | 71 | 440 | **33,383** | 21,341 |
  | 昏 + 雾 + 灯全开 | 77 | **546** | **52,125** | 40,203 |
  | 昏 + 雨 + 灯（推镜头） | 75 | 561 | 33,375 | 21,333 |
  | 晨 + 雨 + 灯全开 | 55 | 653 | **33,621** | 21,579 |

  峰值那一帧的 `largest = [21168, 15448, 2840, 416, 395]`：21,168 是天气雾的 puff 层（**2,646 块 × 8 条**，见下）；15,448 是主图层；2,840 只在夜/昏出现、晨帧消失（灯光/辉光层）；另有常驻痕迹层 1,800。旧稿把 2,840 写成「雨幕」是误读：晨 + 雨同强度下它不存在。
- **`MAX_COMMANDS = 30,000` 是否还站得住 [事实]**：**站不住了。** 真实峰值 **52,125**（帧 546，昏 + 雾 + 灯全开）比上限高 **74%**；即使不算雾，用户点名的「雨 + 夜 + 灯全开」也有 **33,101**（帧 248），而「夜 + 灯全开、无雨」已经到 **30,795**（帧 243）——**不叠天气也越线**。按指示**没有调高上限**；上限与采样口径是另一件事，需要先看这份分布再定。
- **闸门为什么还是绿的 [事实]**：`scripts/check-render-budget.mjs` 的 `measurePass` 只在页面刚打开时读**一次**正午快照（27,453–28,109 < 30,000），不是逐帧峰值——绿的来源是采样窗口，不是余量。该脚本里的 `graphicsObjects < 40` 已改为读 `stats.top.graphicsObjects`（顶层 28；阈值一字未动），否则会被递归后的 131 误判成红。`.github/workflows/ci.yml` 未改。
- **是否需要用户决策**：**已决策并落地**（见下四节：先归因，再改采样窗口，再两级阈值，最后修雾）。
- **逐层归因（帧 546 / 帧 248）[事实]**：帧 248 的复测落在帧 348（同一状态，33,109 vs 33,101，差 8 条），两份都做了 `top + Σ(depth-1) == totalCommands` 的加法校验。

  | 层 | 帧 546（昏 + 雾 + 灯全开） | 帧 248/348（夜 + 雨 + 灯全开） |
  |---|---|---|
  | 顶层合计 `top` | 40,203（28 张） | 21,067（27 张） |
  | ├ 天气雾 puff 层 | **21,168** | 0 |
  | ├ 主图层（最大一张） | 15,448 | 15,448 |
  | ├ 灯光/辉光层（晨帧消失） | 2,840 | 2,664 |
  | ├ 常驻痕迹层 | 1,800 | 1,800 |
  | └ 其余顶层（25 / 24 张） | 747 | 1,155 |
  | 容器合计（depth-1） | 11,922 | 12,042 |
  | ├ 楼体容器 ×33 / 99 Graphics | 11,090 | 11,090 |
  | └ 居民容器 ×2 / 4 Graphics | 832 | 952 |
  | **总计** | **52,125** | **33,109**（原探针 33,101） |

  雾不是「雨幕的别名」：暴风雨 → 雾的净增是 **18,862**，而雾层本身是 **21,168**；差额来自雾天不画雨/风暴层（2,306 条，按帧间差反推）。所以用户看到的「雾单独多 18,862」是对的，它不是雾的全部指令数。
- **雾的实现方式 [事实]**：`weather-fog-view.ts` 不是 4px，`BLOCK_PX = 8`；18 团（`WEATHER_FOG_PUFFS = 18`），半径 `[2.6, 3.4, 4.2]` 格 = 41.6 / 54.4 / 67.2 px，每档 6 团。
  - 每团方块数按 `dy/dx = -r … r step 8`、圆内 `hypot(dx,dy)/r ≤ 1` **精确复算**：41.6px 档 **83 块**、54.4px 档 **142 块**、67.2px 档 **216 块**；`6 × (83 + 142 + 216) = 2,646` 块。
  - 每块 `fillStyle` 占 **3 条** commandBuffer（命令 + color + alpha），`fillRect` 占 **5 条**（命令 + x + y + w + h），合计 **8 条/块**：`2,646 × 8 = 21,168`，与峰值帧 `largest[0]` 一字不差。
  - 没走烘焙是因为它每帧 `puffs.clear()` 后整层重画：圆心由 `timeMs` 连续漂移（`DRIFT_RATE_X = 0.055`、`DRIFT_RATE_Y = 0.04`），每块 alpha 又按 `(1 - d)²` 逐块衰减并乘 `puff.alpha * shown`；它是**实时几何**，不是可复用的静态贴图，旧实现里也没有纹理缓存。
- **闸门采样窗口（改造后）[事实]**：`check-render-budget.mjs` 不再只读开局帧，按 `PEAK_STATES` 的 8 个时相/天气组合逐帧采样，每个组合报峰值帧号（页面内 Phaser 帧号；每段起点/终点写在 tmp/gate-postfog-2.txt）：

  | 组合 | 采样帧段 | 峰值帧 | 峰值 |
  |---|---|---|---|
  | 正午开局 | 1950–1989 | 1950 | 28,117 |
  | 夜 + 灯全开 | 2025–2074 | 2073 | 30,771 |
  | 夜 + 雨 + 灯全开 | 2214–2273 | 2251 | 33,125 |
  | 昏 + 雨 + 灯全开 | 2304–2363 | 2323 | 33,319 |
  | 昏 + 暴风雨 + 灯全开 | 2433–2482 | 2468 | **33,343** |
  | 昏 + 雾 + 灯全开 | 2561–2610 | 2561 | 30,925 |
  | 昏 + 雨 + 灯全开（推镜头） | 2789–2838 | 2789 | 33,319 |
  | 晨 + 雨 + 灯全开 | 2985–3024 | 2985 | 31,261 |

  - **采样与天花板同源（2026-11-07 改造）[事实]**：闸门自己就是一台**连续记录器**，从正午开局一路录到晨 + 雨，覆盖 8 个组合及其相位/天气切换帧；读数按 `Oracle.currentPhase()` 归组（`setPeakLabel()` 之后、状态还没换的那一两帧不算）。不再出现「闸门窗口 33,343 / 天花板取自另一次 587 帧探针」的错配。
  - 闸门实跑（修掉 MAT-G7 后，tmp/gate-g7fix2.txt；MAT-G2 落地后再跑 tmp/gate-mat-g2.txt）：晨 + 雨 **31,261 / 31,275**（≤31,301），全局最坏 **33,351 → 33,357**（昏 + 雨 + 灯全开（推镜头）帧 2605 / 昏 + 暴风雨 + 灯全开 帧 2336）。33,3xx 是**合法成本**（两扇亮窗 + 屋脊 + 满雨幕），不是泄漏；两次差 6 条是角色走位/开工窗帧噪声。
  - 旧天花板 33,741 来自 tmp/peak-frames.mjs 的帧 635，已确认是 **MAT-G7 泄漏帧**（见下），不是成本。`≤31,301` 只能写成「**晨 + 雨**修掉后 ≤31,301」；写成全局会当场把**合法的**昏 + 雨稳态判红。另：上表「晨 + 雨 33,621 @ 帧 653」同样落在渐变期，修掉 MAT-G7 后应在 31,3xx 量级。
- **两级阈值与债务登记 [事实]**：
  - `MAX_COMMANDS = 30_000`：**设计目标，未动**（用户要求保持为意图）。
  - `MAX_COMMANDS_CEILING = 33_400`：**来自修掉 MAT-G7 后的同一次连续采样**。同一配置（同一脚本、同一 8 组合、同一连续记录器、同一窗口）跑了 **3 次**，峰值都是 **33,357**（帧 2336 / 2421 / 2435），**极差 0**；天花板 = 33,357 + **43 条政策余量**。43 不是「凑出来的」：它只用于容纳记录器之外的观测抖动（角色走位 / 开工窗帧），而当前峰值是**结构性**的（昏 + 暴风雨 + 两扇亮窗 + 屋脊 + 满雨幕），三次读数完全一致；留 43 是为了不把任何一个未来的角色帧抖动直接判红，同时债务仍锁在 3,400。若哪天 CI 偶发红，先查真实抬升，**不许用「重跑一次绿了」当通过**。
  - 历史：52,125（修雾前）→ 33,741（修雾后，含 MAT-G7 泄漏帧）→ **33,400**（修掉 MAT-G7 后，自动下降 341 条，全部来自泄漏删除）。**没有在 33,741 上叠层**：33,741 已从账本分母和天花板里同时删除。
  - `MAX_COMMANDS_DEBT = CEILING − MAX = 3_400`：**显式债务额度**，口径对齐 `chore/orphan-gates` 的 `pendingCiBudget`——峰值 ≤ 30,000 不欠债；30,000 < 峰值 ≤ 33,400 只**记账**（`record(...)` 打印/落盘、不红）；峰值 > 33,400 **硬红**。
  - 闸门实跑输出（MAT-G2 后，tmp/gate-mat-g2.txt；另两次 tmp/gate-mat-g2-r2.txt / -r3.txt）：`[债务] 设计目标 30000 / 实测峰值 33357（昏+暴风雨+灯全开，帧 2336）/ 欠 3357 条 / 天花板 33400（额度 3400 条）`、`[记账] 超出设计目标 3357 条已登记（额度 3400）；峰值 > 33400 即硬红。`
  - 同一次采样的分组峰值（tmp/gate-mat-g2.txt）：正午 28,123 / 夜+灯 30,769 / 夜+雨+灯 33,131 / 昏+雨+灯 **33,349** / 昏+暴风雨+灯 **33,357** / 昏+雾+灯 30,931 / 昏+雨+灯（推镜头）**33,357** / 晨+雨+灯 **31,275**。`≤31,301` 的落点只在**晨+雨**这一组（31,275），全局被合法的昏+雨 / 昏+暴风雨 33,3xx 卡住——**不能写成全局 ≤31,301**，否则当场把合法成本判红。
  - 抬升口径（用户给定，2026-11-07）：天花板只因「删掉等价或更多命令」自动下降；**新功能导致的抬升必须单独记账**（谁抬、抬多少、为什么），不许夹带别的削减，也不许把抬升后的值当新基线往下卖。**本轮 MAT-G2 = +0 条**：逐栋核对 11 栋楼，旧逻辑 13 条缝、新逻辑 13 条缝（`h=48` 1→1、`h=64` 2→2，只有位置变），tmp/mat-g2-counts.txt 的 `deltaCommands: 0`。没有抬天花板。
  - 债务历史：修雾前 **22,125**（52,125 − 30,000），修雾后 **3,741**（33,741 − 30,000），修 MAT-G7 后 **3,400**。债务只随天花板往下缩，不许先写大再慢慢还。
- **修雾：逐方块 Graphics → 烘焙纹理 [事实]**：把 18 团按半径烘成 **3 张纹理**（每张在透明画布上按 8px 方块铺圆盘，块 alpha = `0.32 × (1-d)²` 烘死），运行时 **18 个 Image** 每帧只 `setPosition(round(x), round(y))` + `setAlpha(puff.alpha * shown)`，阴影视图不再产生任何 Graphics 指令。
  - 冻钟后的同一雾帧（tmp/fog-shot.mjs，昏 + 雾 + 灯全开）：改前 `totalCommands 50,989` / Graphics 131 / 顶层 28；改后 **29,821 / 130 / 27**，差值 **恰 −21,168**（雾层全额）。
  - 像素对照（tmp/fog-diff.mjs，480×321）：变化像素 82.9%，**最大通道差 2/255**、平均 0.83、差 >8 的像素 **0**。差异来自纹理块落点用 `round(dx)`、旧写法逐块 `round(cx+dx)`，最多平移 1px；半透明覆盖层上不可见。
  - **对既有基线的冲击（2026-07 审计，tmp/fog-audit-*）[事实]**：
    - 仓库内**已跟踪基线 169 件** = 157 PNG + 3 HTML + 9 JSON（`git ls-files world-client/eval/screens`）。**其中雾态采集 0 件**：`capture-palette` 明确断言 rain/非 rain，`check-lamp-band` / `check-setting-scale` / 四刻 phase 都在晴或雨态，`scene-motion` / `banner-smoke` / `ground-shadow` / `stall-motion` 的世界时间是 18:10（seed `dengchao` 的天气槽 4 = clear）。因此**失效 0 / 完好 169**（本段为 E7 删除前读数；E7 后为 **166 件 = 154 PNG + 3 HTML + 9 JSON**，见 E7）。
    - 非雾态下雾层在 `shown <= 0.01` 时直接 `setVisible(false)` + `puffs.clear()` 提前返回，**贡献 0 像素**；before/after 在这些状态里的差异全部来自角色走位 / 雨点相位（A/A 对照自己就有 200–4,888 像素、最大通道差 80–192），不是雾层。
    - 雾态同一冻结帧（tmp/screens/fog/before.png vs `after.png`）：**最大通道差 2/255**、平均 0.829、>8 像素 **0**（见上一行）。这个差在**逐字节断言**下会红，所以雾态若将来进硬基线，必须用容差 2 而不是 sha；当前 166 件（E7 前 169）里没有雾态，故无冲突。
    - **5 条回放夹具**（`fixtures/*.json`，`scripts/fixture-check.ts`）全部是**模拟轨迹**，字段只有 `world / events / memory / creator`，`weather` 一律 `clear`，**没有任何渲染字段**；雾层实现不参与它们的计算，改前改后都碰不到。当前实测 **5/5 FAIL**，但差异是 `facts 60→78`、`events 101→95`、`archived 9→0` 这类**模拟/记忆漂移**，与雾烘焙无因果关系（本次改动只动 `src/render/` 与脚本/文档，`git diff --name-only` 无 `src/world/`、`src/sim/`）。这 5 条应由模拟线单独重录基线，不能算在雾改动账上。
    - **锐利比对实测**：`check-lamp-band` 通过（before 三件由 `check-lamp-band` 实读：灯亮图 1.9% 像素变化、灯灭图 0/563520，见 E7）；`check-anim-fsm-transition`（逐字节 sha，晴）通过；`check-shot-actor-pin`（雾槽 now=301，逐字节正/负对照）通过。岸带 J3「差异 0 像素」不在本仓库，无法在此树复跑——按「基点比改动还旧」的教训，**不改它的基线**，由岸带线自己用同一容差口径复核。
  - 天花板随之下棘轮：52,125 → **33,400**（修雾后先落 33,741，再把其中的 MAT-G7 泄漏 341 条删掉后自动降到 33,400，见 MAT-G7）；债务 22,125 → **3,400**。
- **`eval/ledger.json` 分母改峰值 [事实]**：`render.drawCalls.static.p50` 的 `value` 从 27,453（正午开局）改为 **33,357**（合法全局峰值，昏 + 暴风雨 + 灯全开，帧 2336；同一配置三次跑均为 33,357）。**不取 33,741**——那是 MAT-G7 泄漏帧，取它等于把 bug 当基线。`denominator` 写明「8 组合连续采样（含相位/天气切换帧）/ 同一台闸门记录器 / 全域峰值帧 2336」，note 里保留修雾前 52,125 与修雾后含泄漏的 33,741 两段历史。台账分母取开局帧会让以后每张图都比在错误基准上。

### MAT-G7 相位切换时旧辉光未清（已修复，登记为缺陷）

- **定性 [事实]**：这是**缺陷**，不是合法成本。它在 900ms 相位渐变期把上一相位的离散内容（亮窗、屋脊）连同整层辉光重画一遍，属于「切换瞬间旧辉光层未清」；修前它污染了绘制指令峰值，并被误当作天花板（33,741 @ 帧 635）。
- **复现条件 [事实]**：
  1. 当前相位为 `dusk` 或 `night`（`litWindows = 2`、`ridge = 0.55`），执行 `Oracle.setPhase('dawn')` 进入 900ms 渐变；
  2. 旧实现 `blend()` 对离散内容用 `t < 0.5 ? from : to`，前半个渐变仍返回旧相位的 `litWindows = 2` / `ridge = 0.55`；
  3. `drawGlows()` 只在 `glowKey` 变化时重画，但渐变期内 `view.glow > 0.001` 就每帧重画整层（旧层 **2,840** 条）+ 屋脊 + 亮窗；
  4. 叠加晨 + 雨满雨幕，峰值被抬到 **33,549 / 33,741**（帧 635），而修后同一状态只有 **31,261 / 31,275**。
- **修法 [事实]**（`src/render/phase-view.ts`）：
  - 新增 `contentAt(from, to, t)`：**关灯方向**（`to <= from`）从 `t = 0` 起立即取目标值，不再让旧亮窗/屋脊跨渐变重画；点灯方向保留 `t < 0.5` 的交叉，避免亮窗凭空跳亮。
  - 屋脊：目标为 0 时立刻归零（`to.ridge === 0 ? 0 : lerp(...)`）；萤火虫：目标关闭时立刻关。
  - `setPhase()` 中保留 `glows.clear()`，配合 `contentAt` 才能把泄漏命令数真正删掉；单独 `glows.clear()` 不够。
  - 连续量（`dim` / `glow` / `mist`）仍按 `lerp` 渐变，视觉上的渐暗/渐亮不变。
- **读数 [事实]**（`test/mat-g7-phase-switch.test.ts` 先红后绿：tmp/mat-g7-red.txt 2/4 失败 → tmp/mat-g7-green.txt 全过）：
  - 晨 + 雨：**33,549 / 33,741 → 31,261**（tmp/gate-g7fix2.txt，帧 2834），MAT-G2 后再跑 **31,275**（tmp/gate-mat-g2.txt，帧 2794），两跑都 **≤31,301**；
  - 全局最坏：**33,741 → 33,357**（昏 + 暴风雨 / 昏 + 雨 + 灯全开，帧 2336 / 2637；同一配置三次跑均 33,357）。这 33,357 是**合法成本**（两扇亮窗 + 屋脊 + 满雨幕），不是泄漏。
- **「修掉后 ≤31,301」的正确写法 [事实]**：**晨 + 雨**修掉 MAT-G7 后 ≤ **31,301**（实测 31,261 / 31,275，满足）。**不能写成全局 ≤31,301**：全局被合法的昏 + 雨 / 昏 + 暴风雨 33,3xx 卡住，写成全局会当场把合法成本判红。原「修掉后天花板应 ≤31,301」的口径只在晨 + 雨这一组成立；本次提交的天花板确实是**按修后峰值重取**的 33,357，不是 33,741 上叠层。
- **棘轮处理 [事实]**：天花板从 33,741 **按修后同源峰值重取**为 33,357，再加 43 条政策余量 → **33_400**（同配置 3 跑极差 0）；下降的 341 条**全部来自删除 MAT-G7 泄漏**，没有夹带任何新功能削减，也没有把 33,741 留在基线里。
- **是否需要用户决策**：**否**（已按 2026-11-07 指示修复并登记）。

### MAT-G5 1.5× 相机缩放（只登记 + 静态锁三条）

- **现状 [事实]**：`ZOOM_STEPS = [1, 1.5, 2, 3]`（`src/render/camera-math.ts`）；1.5 是非整数倍，像素边缘会落在半个设备像素上。
- **处置 [事实]**：删不删是 owner 的 UX 决定，**本轮只登记、不判定失败**。现在正确的三条已加静态断言锁住（`test/mat-pixel-crisp.test.ts`，绿）：`pixelArt: true`、`roundPixels: true`、无显式 `antialias: true`、canvas 为 `image-rendering: pixelated` 且无 `auto`。
- **是否需要用户决策**：**是**（只针对 1.5× 档去留）。

### MAT-G6 Canvas 回退路径的椭圆抗锯齿（登记不修）

- **现状 [事实]**：回退渲染（2D Canvas fallback）画椭圆/弧线时走浏览器抗锯齿，边缘是灰阶过渡；主路径（WebGL）不受影响。
- **处置**：只登记、不修。它只在回退路径出现，改动收益低且会引入「两套像素风不一致」的新问题。
- **是否需要用户决策**：**否**。

### 闸门接线状态（本批不做）

- 三个新测试只在本地 `node --import ./test/phaser-hooks.mjs --test test/mat-*.test.ts` 与 `npm test` 里红→绿（`npm test` 退出码 0）。
- `.github/workflows/ci.yml` **本批未改**：`chore/orphan-gates` 未合并，两条分支同时改会冲突。接线与「从允许清单删条目」留到合并后统一做。

## J. 回放夹具基线漂移（2026-11-07）

### J1. 回放夹具漂移（已定位 + 已按 (a) 重录，已合入 main `cd1e02f`）

- **现象 [事实]**：合并后在 main 上跑 `fixture:check`，5 条夹具 100 项断言 0 通过 / 5 失败。本轮复跑代表读数：memory-decay facts 277→379、timetable facts 9→23、archived 9→0、dropped 145→204、世界/记忆指纹全变。
- **读数更正 [事实]**：**更正：`facts 277→379` 属 memory-decay；build-demolish 为 60→78。** 原记录把 277→379 错记在 build-demolish 名下；两条都漂，但别混在一起引用。
- **归属 [事实]**：材质线声明与雾改烘焙、相位泄漏无关；本轮用二进制定位证实是模拟线三笔行为变更，不是「既有模拟漂移」这种无主结论。
- **根因提交 [事实]**（`git bisect`/first-parent 二分，判据为 `fixture:check --only <夹具>` 退出码）：
  | 提交 | 内容 | 首先翻红的夹具 | 读数变化 |
  | --- | --- | --- | --- |
  | `0dfcd2f` | merge liveliness `d725b7e`；代码由 `0fd53a6`（街头小事入 `world.event` 并入账）、`937f247`（重要度/激励阈值）、`1905bdd`（限流/跨天衰减/五人轮转）带入 | build-demolish、memory-decay、timetable | memory facts 277→297，archived 9→0，dropped 145→187（该提交实测）；build/timetable 同时首次翻红（HEAD 终值 build facts 60→78、bonds 0→2） |
  | `49c953b` | merge routine-real `2cc0efe`；代码由 `ec42e91`（市面四拍、打水到水边、旁白改口）带入 | creator-dayclose；并继续抬高 memory/timetable | memory 297→393；timetable 继续增至终值 23（+market_open/work_end/night_market/market_close） |
  | `df69173` | merge behavior-queue | natural-bond-witness | memory 393→379（routine_done 120→105、street_together +1）；bond 业务读数不变、仅指纹变 |
  上一笔 `a6da49e` 在 5 条夹具上全部 PASS；`0dfcd2f` 是第一笔让读数翻转的 mainline 提交。
- **为什么 facts 从 277 变 379 [事实]**：终局事实 379 = tide_turn 120 + routine_done 105 + daily_water 20 + daily_lamp 20 + street_greet 20 + street_together 14 + market_open 20 + work_end 20 + night_market 20 + market_close 20。相对 277 的 +102 = 新增 6 类事件共 114 条（street_greet 20、street_together 14、market_open/work_end/night_market/market_close 各 20）− routine_done 12（117→105，逐提交归属见下条「+114 / −12」）。样本里的 eventId/placeId/actors 均来自实际回放事件；新 kind 在 `world-changes.ts` 中声明、在 `simulation.ts` 中发射。
- **方向判据与证据 [判据]**：判「行为变对了、基线旧了」，用了三条：
  1. **新生事件是真实行为**：新增 fact 逐条对应 `world.event`（street_greet/together、market 四拍、work_end），kind 已声明、actor/place 可读、无凭空重复；不是指纹噪声。
  2. **旧语义没有被改坏**：build-demolish、creator-dayclose、natural-bond-witness 的**全部人工语义断言仍通过**，只是录制指纹/读数变；natural-bond 的业务读数（facts 2 / entries 14 / bonds 5 / trust 合计 0.18）与旧基线逐字段相同，只有内部指纹变。
  3. **归档逻辑没有丢**：`archived 9→0` 不是分支被删。`consolidate.ts` 的归档分支仍在，`test/memory-archive-reach.test.ts` 在 HEAD 上仍绿；0 是预算先淘汰：基线里第二个 holder 每天收集 0–2 条、有条目活到第 13 天强度 0.142（< `T_forget=0.15`）才归档；新行为下同一 holder 每天 1–4 条，day 桶（16 条）先把旧条目淘汰，20 天窗口里最老只活到 7 天、强度 0.377，到不了归档阈值；dropped 145→204 同源。
- **出处追查（2026-11-07 追加）[事实]**：为「行为变对了」补可追链条。方法：在隔离 worktree 里用 `TraceRuntime` 手工步进复跑三条夹具的同一参数轨迹（memory-decay：seed `fixture-decay`、`initialNow=0`、`stepMs=3600000`、480 拍；build-demolish：seed `fixture-cycle`、`initialNow=21600000`、101 拍 + 3 条注入；timetable：seed `fixture-timetable`、`initialNow=17400000`、`stepMs=120000`、396 拍），终局按 `fact.kind` 分组，并从 `memory.consolidated` 事件的 `stats` 合计 `archived/dropped`。探针未入库，原始读数如下（每行一个 first-parent 提交，省略未变化字段）：

  ```text
  a6da49e  memory-decay facts 277 archived 9 dropped 145 | routine_done 117 tide_turn 120 daily_lamp 20 daily_water 20
  0dfcd2f  memory-decay facts 297 archived 0 dropped 187 | + street_yield 20，其余同上
  49c953b  memory-decay facts 393 archived 0 dropped 217 | market_open/work_end/night_market/market_close 各 20，street_greet 20，street_together 13，routine_done 120，street_yield 0
  df69173  memory-decay facts 379 archived 0 dropped 204 | routine_done 105，street_together 14，其余同上
  a6da49e  build        facts 60  bonds 0 | routine_done 24 tide_turn 25 daily_lamp 4 daily_water 4 milestone 2 conflict 1
  0dfcd2f  build        facts 64  bonds 0 | + street_yield 4
  49c953b  build        facts 81  bonds 0 | market_open 5 market_close 4 night_market 4 work_end 4 street_greet 5 street_together 2 routine_done 21 street_yield 0
  df69173  build        facts 78  bonds 2 | routine_done 18，其余同上
  a6da49e  timetable    facts 9  | routine_done 4 tide_turn 3 daily_lamp 1 daily_water 1
  0dfcd2f  timetable    facts 21 | + street_greet 5 street_together 2 street_yield 5
  49c953b  timetable    facts 23 | + market_open 1 work_end 1
  df69173  timetable    facts 23（不变）
  ```

  三条夹具的出处表：

  | 夹具 | 行为改变（旧基线 → 现在） | 引入提交（mainline 合并 ← 分支代码） | 提交自称 | 文档支持 |
  | --- | --- | --- | --- | --- |
  | memory-decay | street_yield +20、archived 9→0、dropped 145→187；随后 market 4×20、street_greet 20、street_together 13，yield 归 0；最后 routine_done 120→105、together +1 | `0dfcd2f` ← `0fd53a6`（建街头互动代码并落 `world.event`，但 20 天读数与旧基线逐项相同，属「代码先到、行为未显」）、`937f247`（首笔可观察变化：yield 37、archived 归 0）、`1905bdd`（限流到 20）；`49c953b` ← `ec42e91`（市面四拍/打水到水边/夜休）；`df69173` ← `e362a9a`（需求层-饥饿）、`cfb5afa`（疲劳与睡眠）、`ec58c4c`（与 origin/main 合并） | 见右列文档；`ec42e91` 自称修 BUG-003（docs 里查不到该条目） | `docs/BUGS_FOUND.md` BUG-1（街头互动按 12 次/天、greet/yield/together 分布）；`docs/evidence/soak/REPORT.md` 第 10 行默认环线「醒 / 打水 / 市面四拍 / 睡」与 394–408 行按天计数；`docs/evidence/PROGRESS.md` 块 8/9（疲劳睡、夜休、`22:00 翻牌`，501–502 行）；`docs/BUGS_FOUND.md` 555 行的 90 日淘汰样本也按 kind 列出 greet/together/market 四拍/`routine_done` 的常态分布 |
  | build-demolish | 60→64（yield 4）→81（market 17、greet 5、together 2、routine_done −3、yield −4）→78（routine_done −3、bonds 0→2） | 同上三笔合并、同一组分支提交 | 同上 | 同上 |
  | timetable-daily-markers | 9→21（greet 5、together 2、yield 5）→23（market_open 1、work_end 1） | `0dfcd2f` + `49c953b`，分支代码 `0fd53a6/937f247/1905bdd` 与 `ec42e91` | 同上 | 同上 |

  ADR 方面：**没有针对街头互动或市面四拍的 ADR**；`docs/adr/ADR_WORLD_ALIVE.md` 只支持「居民按作息由 `Simulation.update` 驱动」这一层。`docs/adr/ADR_MEMORY.md` 未涉及预算/归档，不能算支持。

- **`+114 / −12` 的归属 [事实]**：净 +102 的唯一算式仍是 +114 − 12，逐项落到提交：

  | 项 | 条数 | 引入提交 | 改动类型 |
  | --- | --- | --- | --- |
  | `street_greet` | +20 | 行为由 `0fd53a6` 建立；20 条读数在 `49c953b` 合并后才成立（单跑 liveliness 分支为 0） | 新增世界行为 + `world.event` 落账 |
  | `street_together` | +14 | 行为由 `0fd53a6` 建立；13 条在 `49c953b`，+1 在 `df69173` | 同上 |
  | `market_open / work_end / night_market / market_close` | 各 +20（共 +80） | `ec42e91` 发射（`6f1404c` 只建时刻表骨架，`a6da49e` 上四类一条都没有）；经 `49c953b` 合入 | 时刻表 + 四拍各自落 `world.event` |
  | `routine_done` | −12（117→105） | `e362a9a` −4、`cfb5afa` −10、合并 `ec58c4c` +2 | 需求层/疲劳睡眠改写作息占位，不是事件被删 |
  | 合计 | +114 − 12 = +102 | | |

  另有一笔不进 +114 的进出：`street_yield` 在 `937f247` 分支上出现 37 条、`1905bdd` 限流到 20，`49c953b` 合并后归 0。它一进一出净 0，所以 +114 只数 6 类；但它不是「少了一类」，是让路分支在合并后不再成立（逐行原因未追，见下一条）。

- **`archived 9→0` 的机制出处 [事实]**：
  1. **归档分支本身可达**：`test/memory-archive-reach.test.ts` 断言摘要晋升与归档段非空；该测试由 `fc1b11a` 引入，HEAD 实跑 `1..1 / pass 1 / fail 0`。
  2. **归零是「日预算先淘汰」**：`budget.day = 16` 由 `6514cae` 设定，**此后没有任何提交改过这个值**；`fc1b11a` 只在同一 `budget` 里补了 `legend` 与 `bytes`（`day: 16` 未动）。`docs/BUGS_FOUND.md` 第 499 行独立记录了同一机制：「日层条目过归档期后被 `day` 桶预算裁掉」。
  3. **触发者是负载不是参数**：`0fd53a6` 单跑仍是 277 / archived 9 / dropped 145（代码先到、行为未显）；`937f247` 首次把 archived 打到 0（277→314、dropped 145→221）；`1905bdd` 限流后 archived 仍 0（297 条、dropped 187）；`ec42e91` 单跑时 archived 回到 8（无街头负载，360 条），`49c953b` 合并后又回 0。mainline 上第一笔翻红仍是 `0dfcd2f`。
  4. **结论**：「哪个提交改了日预算」**没有答案**——窗口内没有提交改 `budget.day`；归零是 `937f247` 起新增的街头事实把日桶填满导致的。机制有出处（`6514cae` 的 `day: 16` + `fc1b11a` 的双预算留痕 + BUG-2 测试），参数变更没有出处。

- **找不到单一出处的项 [事实]**（不编理由）：
  1. `street_greet 20 / street_together 14`：kind 的代码可追到 `0fd53a6`，但 20/14 这两个数**不属于任何单笔提交**。单跑 liveliness 分支：`0fd53a6` 与旧基线完全相同（277/9/145，无 street），`937f247` 只有 yield 37，`1905bdd` 限流后 yield 20、greet/together 仍为 0；单跑 routine-real（`ec42e91`）street 全 0；只有两线合并（`49c953b`）才出现 greet 20/together 13，再加 behavior-queue 合并（`df69173`）变 14。方向判定依赖业务断言（`.length`、`actorCounts`、`places`、`beatOrder`）与 `BUGS_FOUND.md` BUG-1 的行为描述，不是单笔提交的意图。
  2. `routine_done −12`：同样没有单一出处。相对旧基线 117→105 是三段相加：`e362a9a` −4、`cfb5afa` −10、合并 `ec58c4c` +2（合并后与 routine-real 的作息竞争）。单看任一提交都不是 −12。
  3. `street_yield 20→0`：`937f247` 加入、`49c953b` 合并后归零；「为什么让路分支不再成立」没有单独提交可指，差异分散在 `0fd53a6/937f247/1905bdd` 与 `ec42e91` 的合并交互。
  4. `ec42e91` 的提交说明写「BUG-003」，但 `docs/` 里查不到 BUG-003 条目（`docs/BUGS_FOUND.md` 的 BUG-3 是「传说碑文预算」，与四拍无关）；这条方向只有提交说明与 `soak/REPORT.md` 的默认环线描述支持，**没有 ADR**。`docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md` 只是被同一合并碰过，内容与四拍无关。
  5. `archived 9→0` 在分支上先在 `937f247` 归零、`ec42e91` 单跑又回 8、合并后再归零，**不存在一笔「把归档关掉」的提交**；它由「日桶容量 + 新增负载」两件事叠加，没有单一出处。

- **收口 [判据]**：基线更新的依据是 `0dfcd2f`（`0fd53a6/937f247/1905bdd`）、`49c953b`（`ec42e91`）、`df69173`（`e362a9a/cfb5afa/ec58c4c`）这三笔 mainline 合并与对应分支提交，加上 `docs/BUGS_FOUND.md` BUG-1/BUG-2、`docs/evidence/PROGRESS.md` 块 8/9、`docs/evidence/soak/REPORT.md` 的默认环线读数，不是「反正现在跑出来是这样」。其中 `market 四拍 +80` 有单一提交 `ec42e91`，归档归零有单一机制（`6514cae` 的 `day: 16` + `937f247` 的负载）但无参数变更提交；`street_greet/together` 的 20/14 与 `routine_done −12` 是合并交互的结果，找不到单一提交，方向判定依赖业务断言而非提交意图。

- **处置 [事实]**：按 (a) 在隔离 worktree `D:/project/pwe-j1-drift`（分支 `chore/j1-fixture-drift`）重录 5 条夹具，并同步重录 `recorded.checkpoints`；重录后 `fixture:check` = 5 条夹具 / 100 项断言 / **5 通过 0 失败**，`verifyTrace` 5 条均 `replayable`（三枚指纹与录制值逐项一致）。重录只改 `world-client/fixtures/*.json`，未改 `eval/screens` 截图、未 push、未动主树工作区。
- **残余 [判据]**：memory-decay 20 天窗口内归档不再触发，夹具已更新 `purpose`/`covers`/`doesNotCover` 写明原因，归档路径由 `test/memory-archive-reach.test.ts` 覆盖；若产品要求「20 天内必须看到软遗忘」，那是预算标定的新决策，不在本次重录里偷偷改 `budget.day`。
- **纪律**：未合并前不许把该检查从 CI 或手工清单里静默移除；一个长期红且无人认领的检查等于没有检查。
- **是否需要用户决策**：**否**（(a) 已按本轮任务执行并合入 main `cd1e02f`）。

## K. 合并窗口未闭合清单（2026-11-07）

用于决定合并窗口是否关闭。按编号、归属线、下一步逐条列出：

1. **J1** 回放夹具 5/5 FAIL（100 断言 0 通过）— 已定位到 `0dfcd2f`/`49c953b`/`df69173` 三笔模拟行为变更并按 (a) 重录（worktree `D:/project/pwe-j1-drift`，分支 `chore/j1-fixture-drift`）；重录后 6/6 PASS（195 项断言），已合入 main `cd1e02f`；`fixture:check` 已接 CI（pending-ci 20）。
2. **G5 剩余** 两级口径已落地并复跑 `[判据] 绿`（设计目标 30,000 / 天花板 34,666=2 跑极差 0），但 `check-ground-shadow` 仍不在 CI — lighting 线；下一步：与孤儿闸门一起排期接线。
3. **E8 — 已闭合（2026-11-07）** 旁证测试默认只写 `world-client/tmp/`，不再改写已跟踪的 `docs/evidence/soak/witnessed-corroboration.json`；连跑两遍 `npm test` 后 `git status --porcelain` 无该文件，`git hash-object` 前后一致（`b9c3214b…`）；`verify-all` 的 `PRESERVE` 已删除。原「跑完必须 `git checkout`」的临时纪律已失效。
4. **孤儿闸门** `fixture:check`、`check-phases-negative`、`check-rain-pin`、`check-shot-actor-pin`、`check-lamp-band`、`check-lamp-pool`（另加 `check-ground-shadow`，见 2）都不在 `.github/workflows/ci.yml` — 归属各线；下一步：等 `chore/orphan-gates` 合并后逐条接线，接一条删一条允许清单。
5. **同一棵树上两条线并行写** `pwe-anim-fsm` 那 6 个未提交文件（`ci.yml`、`package.json`、check-anim-fsm-transition.mjs、png-diff.mjs、两份 docs）— 动画线；本窗口未碰、未带进合并。下一步：由动画线自己提交或丢弃，关闭窗口前确认归属。
6. **要点 4 阈值 `T_dusk / T_noon` — 已论证不可按当前测量标定（2026-11-07）** — 设计验收线。
   - **证据**：`docs/evidence/glow-calibration/{dusk,noon}.png` + 同名 `.json` + `samples.json`。两张图都从**同一张原始帧缓冲**标注（记录 `image.annotatedFromRawSha256` = `frame.rawSha256`），同一记录器（`world-client/scripts/check-glow-contrast.mjs`）、同一窗口（viewport 1010×700，canvas clip 960×640）。网格 1 格 = 4 世界 px = 8 截图 px，且对齐取样中心：patch = 2×2 格，annulus 外框 = 8×8 格。
   - **几何双口径**：patch 8×8 世界 px = 16×16 截图 px（世界 box 644,400,8,8 / 截图 box 200,76,16,16）；annulus 32×32 世界 px = 64×64 截图 px（632,388,32,32 / 176,52,64,64）；换算依据 `截图 px = (世界 − camera.worldView) × 2 × zoom`（2× 渲染，zoom 1）。
   - **本帧读数**（第 21 盏灯串，中心世界 648,404）：dusk meanL patch 98.87 / annulus 82.72 ⇒ **D 0.195**（dim α0.16 ink 反解后 patch 114.38 / annulus 95.15 ⇒ D 0.202）；noon patch 95.85 / annulus 89.60 ⇒ **D 0.070**（α=0，前后同一批像素）。
   - **为什么不能标定**：
     1. **亮/灭区间重叠，不存在可分离阈值**。同一批中心、10 盏灯：亮灯 D 0.195–0.489（p50 0.334）；同位置灯全关 D −0.047–0.314（p50 0.139）；noon 关灯 D 0.009–0.328（p50 0.147）。最大灭灯 0.314 > 最小亮灯 0.195 —— 任何能排除全部灭灯样本的 `T_dusk` 都会判掉一盏真实点亮的灯。
     2. **D 不专属灯，量的是位置**。10 盏灯 patch 内「灯足迹」（同帧开/关灯 luma 差 ≥5 的像素）只占 21.9%–70.3%（中位 46.9%）；本帧选中的「最亮灯」足迹仅 21.9%，其最亮像素 R=255 已裁剪（既有窗光 ADD），patch 大部分是窗/墙等静态环境。同一套灯美术只换位置，D 就从 0.195 到 0.489（2.5×），阈值会编码位置而不是发光质量。
     3. **跨相位不可比**。同一中心 dusk D 0.195、noon D 0.070；dim 反解只解释 0.195→0.202，其余是环境亮度差 —— `T_dusk` 与 `T_noon` 是两个互不推导的数，不能当成同一把尺子的两端。
     4. **样本面窄**：10 盏 / 1 个冻结帧 / 1 个场景（灯潮）/ 晴 / 潮位 1 / 村民钉住 / 全部运动停掉。没有天气、潮位、呼吸/点燃/摆动状态。
     5. **没有标签**。「亮得成立」是人的判断，这套读数没有任何人工标注；任何 T 都只能描述这一帧，不能标定「成立」。
   - **反证旧值的巧合**：本帧 0.195 / 0.070 恰好落在 `0.18 / 0.10` 两侧 —— 若只采这一盏，就会「验证」这两个从未有实测来源的数。但 10 盏里 noon D ≥ 0.10 有 6 盏、dusk 灭灯 D ≥ 0.18 有 2 盏；照这两个数上闸门，会判红一半以上的 noon 灯、放行两盏死灯。
   - **缺什么才能标定**：
     a. **标签**：人工标注「亮 / 不亮 / 边界」的样本，覆盖多场景、多相位、多帧态；先定义「发光成立」的可观察含义。
     b. **灯专用测量**：patch 只取灯足迹像素，或直接判 `ΔD = D(开灯) − D(同位置关灯)`；annulus 排除窗光/相邻灯；中心选择不得落在窗/墙上，并剔除裁剪像素。
     c. **样本量**：多场景 × 多灯 × 多天气/潮位/运动状态，足以给出分布与分位。
     d. **相位政策**：闸门覆盖哪些相位、为什么；若 dusk 与 noon 都用，二者关系要写明，不能各取一个孤立数。
     e. **窗光占优的归属**：既有 ADD 窗光会把 patch 打到裁剪，先定「这算灯的功劳还是窗的」。
   - **当前状态**：只读数、不进闸门；`0.18 / 0.10` 继续失效，不得作为目标值。下一步不是再标一次，而是补齐 a–e 后重做判据形式。
7. **V1 — 已闭合（2026-11-07）** `red:first` 与 `pytest` 已在真 CI 实跑：run `42381670587`（push main，`f1dfa00..c52745d`）。`red:first` 的 base 为 `f1dfa000665d193e2b3b0ab08ddfe88a3040fc45`，以 `AssertionError` 收场（`actual 'undefined'` / `expected 'function'`），`RESULT=RED elapsed=21713ms`，不是 module / compile；`server` job 16s success。
8. **B1 天花板棘轮 — 已锁定（2026-11-07）** 新增 `test/policy-ceilings.test.ts` + `scripts/policy-ceilings.json`：脚本常量 > 已批准值即红，记录必须含 `approved_at` / `approved_by` / `reason`；`[实测]` 把 `MAX_COMMANDS_CEILING` 从 33,488 改到 33,489 会红，降到 33,000 只提示不红。拦不住：运行时 env 覆盖、先降再涨回原值（仍 ≤ 已批准值）、`reason` 真伪。
9. **`test:phases` CI 耗时接近单相位上限** 实测 run `42381670587` 的 `world-client-browser` job：`test:phases` 350s（`14:29:40.709` → `14:35:30.844`）；四个相位 `waitVillagersSettled` 各约 25.6s（25,592 / 25,683 / 25,565 / 25,692 ms），单相位上限 45s，占 57%，余量约 19s — 浏览器闸门线。处置口径：**撞线就减每相位的等待量，不许抬 45s 上限**。本地读数 26s 是错的量级，**本地耗时不构成 CI 的时间依据**；以后估 CI 时间只认真 CI 数据。
10. **E 编号终局核对 + 主树在途 E12 正文将变假** — 编号纪律 M6 的合并动作，**必须在本窗口关闭前做**。
   - **主树在途 E12 的正文写着「E10/E11 未被占用」**（`D:/project/pixel-world-engine` 工作树未提交的 `docs/OPEN_ISSUES.md`）。`chore/eval-screens-audit` 合入后，E10/E11 就被占用，这句当场变成假话 —— 合并时必须改掉，不能留一个「已知会错」的句子进主树。
   - **终局核对**：全仓 `E` 编号唯一、无同号不同事；生成最终登记表（号 → 标题 → 归属分支 → 合入提交）。预期占用：E9（main）、E10/E11（chore）、E12（帧相位）、E13（PNG 覆盖，本 fix 分支）、E14（chore 旧 E9，按 M3 顺延）。
   - **分支上的编号只是临时占位**：`fix/silent-readings` 本轮占用 E13，可能与帧相位线（E12）与 chore（E10/E11/E14）在合并时相邻；以主树定稿为准。

## L. 命名冲突：`RoutineId` 的 `garden` 指农田（2026-11-08 登记，未改）

- **现象 [事实]**：`world-client/src/world/routines.ts` 的 `RoutineId` 里已有一个 `'garden'`，它的 label 是「去看了一眼农田」，目标是 `altar.x - 8, altar.y + 4`（`routineBeats` 里按世界坐标硬编码）。设定集里的「庭院 / 花径 / 桥头前庭」才是这一轮想用 `garden` 指的东西：同一个词，两个意思。
- **处置 [判据]**：不现在改。场所种类改用 `courtyard`，避开这处既有词；本轮不做 `SiteKind` 改名（纯改名在 `red-first` 闸门下无法给出「断言红」，见本轮回滚 `acfae31`）。
- **下一步**：`RoutineId.garden` 是否改成 `farm` 需单独评估——该值可能已进存档（`world-client/src/world/save.ts` 的作息字段）、也可能进世界事件与回放夹具（`routine_done` 的读数列）。单开一笔，先枚举它的消费面，再决定改名与迁移；不要顺手改。

**本次 push 路径记录（不是未闭合项）**：推送 `c52745d` 时 `.githooks/pre-push` 按设计拦下 main 直推；改用钩子头注释写明的豁免 `PWE_ALLOW_PUSH_MAIN=1`（未用 `--no-verify`），结果 `f1dfa00..c52745d main -> main`。豁免是逐次显式动作、每次推送仍需单独授权，**main 直推不是常态、也不是被默认允许的路径**。该豁免在 2026-11-07 已改为**只跳过 main 保护**，大文件检查（默认 5 MB）在豁免路径下照跑，`npm run check:hooks` 的五条反向用例覆盖这两种路径（见 `docs/evidence/ENVIRONMENT_BUILDABILITY.md` §风险：[ENVIRONMENT_BUILDABILITY.md](file:///D:/project/pixel-world-engine/docs/evidence/ENVIRONMENT_BUILDABILITY.md#L596-L599)）。

## M. `red-first` 的模型缺「测试 diff 是回退」这一判定（2026-11-08 登记，未修）

- **事实 [读数]**：`acfae31`（`git revert dc061f4`）推上去后，CI 的 `world-client` job 在 `red-first 红灯闸门` 判红；本地 `npm run red:first -- --base dc061f4` 复现同一句——测试 7 条全绿 → `FAIL 测试在 base 上已经绿`；而 `--base acfae31` 是 SKIP（该次没有世界代码改动）。
- **性质 [判据]**：判据本身没写错——「本次测试 diff 在 base 上必须红」对新增断言成立。缺的是模型里没有「这次测试 diff 是把测试改回旧内容」这一分支：revert 的测试 diff 在 base 上必然绿，所以**任何 revert 都天然不满足闸门**，与操作顺序无关。
- **代价 [事实]**：一笔内容正确的回滚会长期留一条红 run。用「再推一个纯文档提交、让下一次运行的 diff 为空从而跳过闸门」只是让 HEAD 看起来绿，等于把「这里红过一次」从视野里拿掉——**不作为通行做法**，也不许用提交前缀白名单或 `--no-verify` 绕。
- **修复方案待定**：可选方向（都未选）——按 diff 语义识别「测试回退」并降级为 SKIP＋显式记录；或对 revert 提交要求「回滚前后测试集合一致」的等价性证据。两条都要单独评估，这一笔只记事实与代价。



## N. 花径（设定集 p110–111）的降级清单（2026-11-08 登记，本轮已落地一半）

- **范围 [事实]**：只做「场所实体」这一半——西侧草地口袋外框 `x3..9 × y19..25`，三边各 2 格 `tree` 树篱、中间 3 格宽草地小径（不铺 `plaza`：`plaza` 的潮位清水位与草地不同，铺装会改掉 `shore-band` 冻结的潮位格数 2343）、南端 `y26..27` 留草口接广场、庭心一件 `statue`、两侧各三床 `flower_bed`。**不碰人物行为**：没有 `courtyard` 的 `SITE_TABLE` 行，也没有场所时钟——现在没有行为消费方，加了就是零消费的死数据。
- **实现 [判据]**：`flower_bed` 进 `SettingScenery['kind']` 闭集（`src/settings/types.ts`）与装载期 `SCENERY_KINDS`（`src/settings/load.ts`），绘制分支在 `src/render/setting-scenery.ts`。花圃与石作都走 `bakeLayer`：每件一条纹理（花圃 16×12＝768 byte、石作 16×19＝1,216 byte），每帧 0 条命令；石作原来的四条 `fillRect` 因此从 `propRows` 撤出。
- **读数 [读数]**：`check-ground-shadow` 口径（`?world=dengchao`、机位 400/470、1010×700、世界冻住、8/8 帧逐值相等）**34,493**——与「把一件 statue 改走 bake」的读数同值，即这处花径**净增 0 条**；144 条余量一条没动。复核：本读数在 `40d6149` 与 `9cccdcc` 都成立；自 `f084cbb` 起实测 **34,453**（−40 来自花径作息换了两个人的姿态，同一个体态敏感现象，见 O4）；本笔 `1489b46` 后 **34,573**。
- **降级 [事实]（这是与设定集的差距，不是还原）**：
  1. **无粉紫**：24 色里没有粉/紫，杜鹃与绣球做不出来；花圃只用暖红（`ember` / `terracotta`）＋米白（`plaster`）。
  2. **花墙读作小树丛**：画出来的是灌木花床，读不出「修剪过的花墙」那条直线与高度。
  3. **木栅 / 石垣 / 瓦顶本轮不做**：p110–111 的夹道栅栏、石垣与瓦屋顶一件都没有。
  4. **庭心不是设定集的石作**：只有一件通用 `statue` 的四条矩形，没有基座与纹样。
- **代价 [事实]**：花圃与石作的绘制量从 `renderStats().totalCommands` 里消失（Image 不被统计），所以「净增 0」的准确含义是「不进命令统计」，不是「GPU 少画」。真实代价是每件一次 `generateTexture` 与一张纹理（件数上去会变成多次纹理切换）。
- **是否需要用户决策**：否（本轮按范围执行；要还原花墙需先解 25 色 ADR 与栅栏/瓦顶资产，另开一笔）。

## O. 花径走进去之后暴露的两件事（2026-11-08 登记）

### O0. N 节的几何描述已过期（勘误，不改 N 的四条降级）

- **现状 [事实]**：N 节写的 `x3..9 × y19..25`、3 格宽小径、两侧各三床花圃，是**上一版**。
  按参考图重开为 `x2..11 × y19..27`：北篱 `x2..11 y19..20`、西篱 `x2..3 y21..27`、
  东篱 `x10..11 y21..27`；可走内里 `x4..9 y21..27`；花床左 `x4..5`、右 `x8..9`（`y21..24`，16 件）；
  中央净空 `x6..7`（2 格宽 × 7 深）；南口 `y27` 的 `x4..9`（6 格宽）；石作移到 `(4,25)`。
  `peakCommands` 当时仍是 34,493（`9cccdcc` 复跑同值）、`shore-band` 浅水 790 / 潮位 1 认水 2343 未动；`f084cbb` 起为 34,453，链式账见 O4。
- **不变的部分**：N 的四条降级（无粉紫 / 花墙读作小树丛 / 木栅石垣瓦顶不做 / 庭心不是设定集石作）照旧成立，未改一字。

### O1. 人穿篱：潮位窗里树篱是抄近路的干通道

- **现状 [事实]**：`tree`（含树篱）**一直可通行**，`WALK_COST.tree = 2.5`，`isWalkable(tree)` 为真。
  此前文档里「树篱不可通行、铺两格即一道墙」的说法是错的（`ADR_TERRAIN_HEIGHT.md` §4.3 已带日期更正）。
- **实测机制 [事实]**：这次把东篱从 `x8..9 y21..25` 延到 `x10..11 y21..27` 后，四格
  `(10,26) (11,26) (10,27) (11,27)` 从 `grass` 变成 `tree`。潮位 `0.39742778614314456`
  （世界 08:38）时草地被淹（代价 **3.40**），树不淹（**2.50**），于是 `x10..11` 变成一条
  接上 `y28` 广场的连续干通道：`迷路人` 从 `(37,29)` 去 `(19,15)` 的路径由 38 格
  （总代价 47.25）改走 54 格（46.55），净省 0.70——**是真实改选，不是 A\* 等价路径 tie-break**
  （tie-break 固定对此无效；这条判断也写进记录，不抹掉上一轮的错误方向）。
  按潮位扫过：≤0.30 与 ≥0.43 两张网格选同一条路；只在 **0.31–0.42** 分叉。
- **walkable 差异 [事实]**：44 格地形变了（29 格 grass→tree、15 格 tree→grass），
  **`walkable` 差异 0 格**——没有新增阻挡，纯粹是代价场变了。
- **影响 [事实]**：高潮窗口里村民会**从篱笆里穿出来**进出花径（不是走 6 格宽的南口）；
  08:38 那一拍因此改了路线，`timetable-daily-markers` / `timetable-night-close` 的
  世界/记忆/事件三指纹随之改变（重录账见夹具提交）。
- **本轮不做 [判据]**：**不改 `tree` 的通行性与代价**。要让树篱真挡人（不可走或高代价），
  会动全部回放基线与所有野外寻路，必须单开一笔、带完整影响面评估。
- **长期解触发条件 [判据]**：当地图改动频繁到每次都要重录夹具时，才考虑固定 A\* tie-break；
  这一条本身不适用（不是等代价），要做的是「树篱是否可走」的语义决策，不在本轮范围。

### O2. 夜里的花径是全黑的（不当作已实现）

- **现状 [事实]**：石作 `(4,25)` 没有灯。夜里的花径只有地形与花圃的暗色，**没有光**。
- **为什么不做 [事实]**：给石作补一盏灯实测 **+306 条**命令，`34,493 + 306 = 34,799`
  （按本笔基线 34,573 算是 34,879）超过天花板 `34,666`，余量一次吃穿（本笔后余量
  **93**，口径见 O4）。所以这一刀明确不加灯。
- **如实记账 [判据]**：夜里走到花径是黑的，这不是 bug 修复完成，是**降级**；
  不要在任何"已实现"清单里把它当成有照明的一处。
- **2026-11-09 更正 [读数]**：上一行「夜里全黑」只成立为**这一段没有光源**，
  **不成立为「屏幕归零」**。实测口径 `?world=dengchao&hd2d=off&time=night`、
  天气 clear、世界钟冻住、1010×700：主街 19:30 平均亮度 **65.8**、花径 19:30 **61.4**；
  两处 `luma<8` 的像素都是 **0.00%**，最暗的 1% 仍在 **32–36**。对比正午
  （主街 80.2 / 花径 74.3），夜间是「乘 0.54 再叠 46% `deepShade`」压到深蓝灰的底，
  不是压成黑；非零色主街 1,706 种 / 花径 1,783 种（正午 1,047）。
- **更正佐证 [读数]**：把 28 盏街灯强制关掉，主街只有 **11.80%** 的像素变化，
  这些像素平均增亮 **+8.2**，整帧平均亮度只降 **0.9**——暖光是聚落式的小块，
  暗部本来就有地形色。22:00 与 19:30 的光照读数逐位相同（p10/p25/p50 一致），
  22:00 只少人物与摊布动画。
- **因此**：补灯仍是 **+306**（见上一条），余量 **93**，本轮不做；
  但不要把这条当成「夜里没有任何光」去重做一套**已经存在**的光照，也不要把花径
  当成有照明的一处。本条只追加读数，不改上面的历史结论。
- **2026-11-09 更正 [事实]**：「`nightMarket` 在渲染层零消费者」是**误判**。
  消费者是**间接的**：`setting-scenery.ts` 的摊位门控是
  `clock.open ?? (siteOpenAt(now) !== 'closed')`，而 `siteOpenAt` 与
  `environmentAt` 里的 `marketOpen` / `nightMarket` 出自同一张 `SITE_TABLE`
  （market：8:00–17:00 `open`、19:00–22:00 `night`）。所以 17:00–19:00 与
  22:00 之后摊位火本来就已经灭，行为是对的；`nightMarket` 也确实有人读，
  只是隔着 `siteOpenAt` 这一跳。按「有个 flag 没人读」去接线是 no-op 重构，
  本轮不做。上面「零消费者」的说法不要再当传说引用。
- **新记 [读数]**：白天 8:00–17:00 摊位火盆**是亮着的**——世界钟 12:00 下
  `debugStallUnits()` 六摊全开，`fireLevel` **0.64–0.95**。这**没有设定集依据**：
  设定集给的是黄昏街、灯笼暖光、幌布与店铺立面，白天的火盆是我们自己的约定。
  **判据**：`?world=dengchao&hd2d=off&time=noon&debug=1&now=720` 下强制关掉摊位火
  前后各取一帧做像素差，差值与摊位包络即这条的账（**尚未测**，等裁决时一并取）。
  **触发条件**：早市视觉定稿时一并裁决，本轮不改，也不许拿它去换一次基线刷新。
- **注 [判据]**：「同一封闭区域逐字节相同」这条验收判据**在当前实现下不可达**：
  烟、萤火、光池由世界分钟与实时 delta 驱动，即使摊位门控一致，差异也会由它们带进来
  （22:30 与 23:30 摊位 0 的 40×40 框内仍差 501 px）。要用这条判据，必须先固定
  presentation time，或给氛围元素加隔离开关。

### O3. 首拍即 fallback 锚点：第一拍承载不了门控；集市单点锚表示不了「一条街」

- **现存结构 [事实]**：`routineFor` 的退路是 `fallbackTo` = `beats[0]`，而 `beats[0]`
  同时就是这一天的**第一拍**。于是首拍既是最早要走的落点，又是「关着时退回哪儿」。
  给首拍挂 `site` 门控会当场自指：关着时 `siteBeatApplies` 为 false，人退回
  `fallbackTo` = 同一条首拍 → 门控空转，首拍永远按字面坐标执行。
- **实证 [读数]**：炉匠作息的 `index 0` 是 `(39,38)`——**炉匠铺门口**（`soot_forge#1`
  的门），同时是这条作息的 fallback 锚点。所以「炉匠铺白天开」这个想法，
  **不能用给首拍加门控来做**。受影响作息只有这一条（唯一首拍带 `site` 的作息）。
- **以后真要做 [判据]**：是「首拍换镇心」的顺序改动——把首拍从铺门挪到镇心、
  让铺门变成非首拍，再给它挂 `site`；不是加个 flag 就完事。
- **集市单点锚的表示缺口 [事实]**：本包集市是 6 个摊散在 `x15..48 × y26..33`
  （`stall_north_1 (17,26)` / `stall_north_2 (34,26)` / `stall_south_1 (24,33)` /
  `stall_south_2 (15,32)` / `stall_south_3 (33,32)` / `stall_east (47,31)`，
  `lamp-street.ts`）。`SettingSite` 只有**一个坐标**，表示不了「一条街的集市」。
  本轮取 `(17,26)`，判据是「锚的坐标上真有摊」——格上就是 `stall_north_1`，
  不按包络中心取（中心 `(31,29)/(31,30)` 被账房屋占住、不可走）。
  要表达整条街需要「多点锚 / 区域锚」，属于 schema 改动，本轮不做。
- **既有事实（一并记账）[读数]**：引擎自带的市面点 `marketSpot()` = `(40,26)`
  是**空街口**（格上无摊，最近摊 `stall_north_2 (34,26)` 距 6 格）；
  `routineBeats` 里那条 `(41,27)` **不可走**。两者离最近摊位都是 6–7 格。
  回放夹具里 `place:40,26` 的来源就是这个没落在摊上的 `marketSpot()` 点——
  本轮不改它（改它会动回放基线），只记账。
- **配膳间缺口 [事实]**：设定集有配膳间，但本包 `placements` 里没有这栋建筑，
  所以不为它造场所锚。以后盖起来按同一套接：`id` = `instanceId`、用建筑锚。
- **是否需要用户决策**：否（三条都在本轮范围外，只做记账）。

### O4. `peakCommands` 对冻结时刻的人物体态敏感：单时刻单点读数当不了长期预算基线

- **现象 [读数]**：本笔（集市/工坊作息锚，`1489b46`）`check-ground-shadow` 峰值 **34,573**，
  比 base `f084cbb`（**34,453**）高 **+120**；四相位（dawn/noon/dusk/night）的增量**完全相同**，
  `renderStats().top` 的直接 Graphics 读数两边一字不差（15,278），场景几何/材质/颜色一格没动。
- **定名 [读数]**：7 个人物容器里**只有一个**从 `332` 变 `452`（+120），其余 6 个值不变。
  把 base 与本分支在 18:10 的每个村民位置/状态逐项导出对比（`Oracle.view().villagers`
  的 `pos` / `walking` / `mode`，两页各开一次），只有 **炉匠（`v3`）** 不同：
  - base：`(39,16.1)`、`walking=true`——正往锅炉房走；
  - 本笔：`(39,38)`、`walking=false`——停在炉匠铺门口（O3 说的首拍 fallback 锚点）。
  其余 6 人（迷路人 / 汐 / 灯笼头 / 沉灯夫人 / 账房先生 / 洗衣妇）位置与状态逐字相同。
  所以这 120 条只来自**人物体绘制**（走位姿态 vs 站立姿态），不是新增物件。
- **链式读数账 [读数]**（同一台机器、同一口径、只切 commit）：

  | commit | 峰值 | 备注 |
  |---|---|---|
  | `40d6149`（花径实体） | **34,493** | 本轮复跑实测，判据绿 |
  | `9cccdcc`（小径保持草地） | **34,493** | 复跑同值——**不是**这 40 条的来源 |
  | `f084cbb`（花径作息） | **34,453** | 连跑两次稳定，极差 0；−40 从这一笔开始 |
  | `1489b46`（本笔） | **34,573** | 连跑两次稳定，极差 0；+120 |

  天花板 `34,666` **不动**；余量 144 → **93**；债务 **4,573**。
  勘误：此前把 −40 归给 `9cccdcc` 的地形分类，是**推断且错了**；实测 `9cccdcc` 与
  `40d6149` 同值，−40 实际发生在 `f084cbb`（同一个体态敏感现象，提前发生过一次）。
  这也说明 `34,493` 从 `40d6149` 被抄进 `f084cbb` 的账时**没有重测**。
- **结论 [判据]**：**单时刻单点读数不足以充当长期预算基线**。世界冻在同一时刻，但
  「谁在这一刻站着、谁在走」会随作息改动变化，人物体绘制命令数随之变化；任何改作息/寻路的笔
  都会在预算上留下 ±百余条的、与渲染物无关的噪声。
- **长期解（二选一，本轮不做）[判据]**：
  1. **多时刻取最大**：若干固定世界时刻各拍一次，取 `max`；
  2. **固定姿态采样**：采样前把所有人姿态钉成同一帧（`pinShotState` 那套），
     使读数只反映场景，不反映谁在走。
- **触发条件 [判据]**：改作息 / 寻路 / 采样时刻 / 相位集合时，`peakCommands` 的 ±百余条
  必须按本条记账，不得当成本笔渲染增量去调阈值；天花板与阈值一个数都不许动。
- **巡检口径 [判据]**：预算读数必须在**停服冷启后**取；首次启动与 vite 依赖预打包重叠时
  读到 **34,565**（低 8 条），属测量侧启动竞态，不是渲染侧少画。冷启后三次稳定 34,573
  （含一次冷启复跑）。读到偏低先怀疑启动时序，不要先翻渲染代码。
- **是否需要用户决策**：否（本轮只记账；两解的取舍另开一笔）。
