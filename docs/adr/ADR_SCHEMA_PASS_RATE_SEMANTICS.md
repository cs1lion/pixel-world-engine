# ADR_SCHEMA_PASS_RATE_SEMANTICS：A1 的口径定性（不改字段、不动存档契约）

- status: aligned
- verified_at: 2026-11-10
- verified_by: agent（逐调用点核实）
- evidence: `world-client/src/creator/engine.ts`, `world-client/src/world/creator/fuse.ts`, `world-client/src/scenes/SandboxScene.ts`, `docs/OPEN_ISSUES.md`（A1）

## 1. 问题（OPEN_ISSUES A1）

`schemaPassRate` / `manualModificationRate` 只在造物真的落地时记账，`schemaPassRate` 恒为 1、
`manualModificationRate` 恒为 0。用户要求本轮处理。

## 2. 逐调用点核实（不是推测）

| 事实 | 位置（按符号名，`grep` 即得） |
|---|---|
| `submitHumanApproval` 的 `approved` 参数在**全仓所有调用点都是 `true`**（src 4 处 + test 十余处），从没有 `false` | `CreatorEngine.submitHumanApproval()` 的定义，以及全仓对该名的调用 |
| 唯一生产记账点是落地成功后 `creator.submitHumanApproval('mapper', id, true, ...)` | `SandboxScene.settleCreationObservation()` 里的 `checkLandedBuilding(...).then` |
| 玩家造物 schema 失败只 `recordLedger`，**不进 fuse** | `SandboxScene.confirmCreation()` 的 catch 分支 |
| `cancelCreation()` 只 `endCreation()`，说「取消了，世界没动」，不记任何账 | `SandboxScene.cancelCreation()` |
| 自动提议被拒（熔断/抽检不放行）只 `recordLedger` 后 `return`，不进 fuse | `SandboxScene.stepCreatorProposal()` 里 `creation.verdict === 'rejected'` 那一支 |
| `planCreation` 找不到合规落点返回 `null`，直接 `return`，不进 fuse | `SandboxScene.stepCreatorProposal()` 里的 `proposal === null`；`CreatorEngine.planCreation()` |

> **2026-11-14 起，这张表不再写行号。**
> 它原先按行号指着 `SandboxScene.ts`，而这个文件在两次接线里分别被删了 12 行、
> 又下移了一次声明位置，表格被迫手工对位了三轮，`audit-references` 还红过一次。
> 行号不是这张表要表达的事实，符号名才是。复核方式：`grep` 上表第二列里的方法名，
> 不要拿某个数字去数行。`engine.ts` 那两处同理，也改成方法名。

**结论：不是「漏了记账点」，是引擎 API 里根本没有「人的确认结果是拒绝」这个输入。**
`schemaPassed` 实际测的是「这条造物有没有落地成功」，不是「Schema 校验通过率」。

## 3. 决策：采用 A1 选项 (3)，正式定名为「落地成功率」口径

- **不把玩家点错位置 / 取消 / 自动提议被熔断拒绝记成 `schemaPassed: false`**。
  A1 选项 (1) 自己就警告过「玩家点错位置会连累外环，是产品判断」；实测的三类
  「失败」里，没有一类是**外环生成质量**问题：
  - 玩家取消 = 人的意图撤回；
  - 玩家 schema 失败 = 玩家选了非法参数；
  - 熔断/抽检拒绝 = 系统按自治等级**主动**不放行，恰恰是门禁在正常工作。

  **而且后果比「拉低一点分数」严重得多**：`fuse.ts:594` 的降级触发条件是
  「拒绝率 > 10%」，单条 `schemaPassed: false` 就让拒绝率变成 100%，
  `checkDowngradeTriggers` 立刻熔断角色、清空指标窗口（`totalCommands` 归 0）。
  实测见 `test/creator-a1-semantics.test.ts`。也就是说误记一次玩家手滑，
  角色直接被隔离、外环停摆。这是不改口径的硬理由，不是保守。
- **不改字段名、不动 v7 存档契约**。全仓 20+ 处引用 `schemaPassRate` /
  `schemaPassCount`，含 `save.ts` 的 v7 路径集合、trace 格式、`creator/config.ts`
  门禁常量；重命名要升 v8，代价远大于收益，且 A2 刚落定。
- **在代码注释与本文档写清真实口径**，并补一条测试钉住「当前只数落地成功」，
  防止有人把 `schemaPassRate === 1` 误读成「校验跑过很多次」。
- `manualModificationRate` 同理：`wasManuallyModified` 只在 `modifications !== undefined`
  时为真，而所有生产调用都传 `undefined`，所以它恒为 0 是**口径**不是 bug。

## 4. 将来若要真实失败侧分母，该接哪个信号（不在本轮）

需要的是「**模型/外环产出的结构被 schema 拒了**」这一路，而不是玩家行为：
`world-client/src/world/creator-schema.ts` 的 `parseCreationPlan` 被 `planCreation`
调用时若抛错，才是真正的生成质量失败。今天 `planCreation` 在引擎内部先过了
白名单形状才返回（所以 `SandboxScene:2098` 硬编码 `schemaPassed: true` 是有依据的）。
将来给外环接 LLM 生成结构时，把那一处的解析失败递成 `schemaPassed: false`
才有意义。这条留作 A1 的真正修法，等「LLM 驱动外环」那一步一起做。

## 5. 不在范围

- 不改 C1 的自运行通道（它靠 `everCreated`，与本案比率无关）。
- 不动 `qualityGatesFor`、`FUSE_CONFIG` 阈值与爬梯判定。
- 不扩色板、不动配额（分别见 ADR_ART_PALETTE_DECISION / ADR_SAVE_AUTONOMY_PERSIST）。

## 6. 验证

- `test/creator-a1-semantics.test.ts` 新增：钉住 `submitHumanApproval(true)` 只记成功、
  没有 false 输入、以及三类「失败」路径都不进 fuse 指标窗口。
- 十一道闸门不受影响（无字段/契约改动）。
