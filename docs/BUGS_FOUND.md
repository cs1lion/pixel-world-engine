# 造物构建功能测试发现的问题

测试分支：`feat/func-creator`（worktree `D:\project\pwe-funccreator`，基线 `54139dd`）。
测试入口：`world-client/test/creator-functional-l1.test.ts`、`creator-functional-l2.test.ts`、`creator-functional-l3.test.ts`。
下列两条原先用 `test(..., { todo: 'BUG-x' }, ...)` 保留失败读数；已在提交 `f58179d` 修复，对应用例翻成正常断言并通过。下面同时记录修复前后读数。

---

## BUG-1 覆盖率分母为 0 时，`creationCoverage` 返回 0 而不是「没测」

- **编号**：BUG-1
- **状态**：**已修**，提交 `f58179d`。
- **依据**：账本侧既定契约 `coverageAfterBuild()` 在 `blueprintCount <= 0` 时返回 `null`，并由 `reading()` 统一落成 `passed=null` / `reason=not_measured`（`src/creator/ledger.ts:172-214`）。业务规则侧必须同口径，「没测」不能写成 0 分。
- **修复**：`creationCoverage()` 返回类型改为 `number | null`，0 分母直接 `return null`；引擎 `submitHumanApproval` 只在 `typeof coverageRate === 'number'` 时记观测；`SandboxScene` / `trace/runtime.ts` 把 `null` 原样交给 `evaluateLandingGates`（该处已按 `null → passed=null` 处理）。`checkLandedBuilding` 只跑空间/不变式业务规则，不消费覆盖率，无需 null 分支。
- **修复前读数**：`creationCoverage(...) = 0`；落地门禁 `passed=false`、`reason=below_requirement`；计数器 `coverageChecks=1`（把没测算成一次 0 分观测）。
- **修复后读数**：`creationCoverage(...) = null`；落地门禁 `passed=null`、`reason=not_measured`；计数器 `coverageChecks=0`。
- **证据**：
  - 测试 `[L3] creationCoverage 在 0 分母时给 null，落地门禁与计数器都记 not_measured`，`creator-functional-l3.test.ts:130`，已通过；
  - 同文件 `[L3] 覆盖率分母为 0：账本记 not_measured，不是 0/1` 仍通过。
- **影响范围**：修复前，0 模板设定集/空世界会把「没测」误报成「覆盖率 0，低于 95%」，并给角色记一次假的 0 分覆盖率证据；修复后不再产生该错误读数。

---

## BUG-2 L0 熔断「降级」会把角色升到 L1

- **编号**：BUG-2
- **状态**：**已修**，提交 `f58179d`。
- **依据**：《补充架构设计与全量待定参数规格书 v1.0》§2.2「自治爬梯（L0–L4）的『双向熔断与自动降级机制』」明写熔断对象是「**处于 L2/L3 的模块**」，动作是「立即将该模块实时降级回 **L1**」（`docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md:80-85`）；v0.2 §2.2 同样表述为「从 L3/L2 降级回 L1」（`architecture-supplement-v0.2.md:101-105`）。文档没有「从 L0 升到 L1」的规则，且「降级」只能向下。因此无条件写 L1 是行为写反，不是有意设计。
- **修复**：`triggerDowngrade()` 取 `Math.min(oldLevel, AutonomyLevel.L1)`：L0 留 L0、L1 留 L1、L2/L3 才落到 L1；`isFused` 与窗口清零逻辑保持不变。
- **修复前读数**：`currentLevel = 1`（被「降级」抬高），`isFused = true`，事件 `fromLevel=0 → toLevel=1`。
- **修复后读数**：`currentLevel = 0`，`isFused = true`，事件 `fromLevel=0 → toLevel=0`。
- **证据**：
  - 测试 `[L3] 熔断降级不能把 L0 升成 L1`，`creator-functional-l3.test.ts:315`，已通过；
  - 原有 `creator-fuse.test.ts` 的「不变式被违反一次就当场熔断回 L1」「人类回滚一次就降级」「等级变化如实记下 from 与 to」全部通过，证明 L1/L2 路径未回退。
- **影响范围**：修复前 L0 人工拒绝一次就会「升层 + 熔断」，与「L0→L1 是升级爬梯、拒绝是降级」的语义相反；修复后各等级只降不升。

---

## 已通过、未记为缺陷的边界读数

以下边界在本轮测试中通过，说明实现是正确的；列出来避免后续误判：

- 同 prefabId 第二栋：真实 `Simulation` 返回 `这种铺子已经有一栋了。`，建筑数不变（L3）。
- 覆盖率 0 分母：`coverageAfterBuild` 返回 `null`，`evaluateProposalGates` 记 `passed=null`、`reason=not_measured`，`buildCreationRecord` 记 `rejectionGate=coverage`、`kind=not_measured`（L3）。
- 账本去重：重复 `recordId` 返回旧记录 `duplicate=true`，`seq` 不变、文件字节数不变（L3）。
- 队列上限：`maxItems=2` 时第三条入队丢第一条，`dropped=1`，持久化只剩最新两条；出队只发后两条（L3）。
- 重启：`seq` 从文件续号 `1→2→3`，时钟回拨时 `recordedAt` 保持上一条时间，不倒退（L3）。
- 7 日观测三态：`still_present` / `removed` / `modified` 均在第 7 世界日各出一条真实观测（L2）。
- 爬梯：真实造物 + 真实覆盖率/冲突/不变量观测，L0→L1→L2；只补 schema、覆盖率/冲突分母为 0 时 13 天仍停在 L1（L2）。
