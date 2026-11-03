# 造物构建功能测试发现的问题

测试分支：`feat/func-creator`（worktree `D:\project\pwe-funccreator`，基线 `54139dd`）。
测试入口：`world-client/test/creator-functional-l1.test.ts`、`creator-functional-l2.test.ts`、`creator-functional-l3.test.ts`。
下列两条在测试里用 `test(..., { todo: 'BUG-x' }, ...)` 标注，不跳过、不放宽断言；失败读数即为证据。

---

## BUG-1 覆盖率分母为 0 时，`creationCoverage` 返回 0 而不是「没测」

- **编号**：BUG-1
- **现象**：账本门禁 `coverageAfterBuild()` 对 0 分母返回 `null`，并正确记成 `not_measured`；但生产落地路径用的 `creationCoverage()`（`src/creator/business-rules.ts:54-65`）在 `blueprints.size === 0` 时直接 `return 0`。`SandboxScene` 把这个 0 喂给 `evaluateLandingGates` 的 `actualCoverageRate`，于是「没测」被记成「覆盖率 0，低于 95%」。
- **最小复现**：
  1. 取真实 `DENGCHAO_RAW` 设定集，把 `blueprints` 置空（不写任何世界状态）；
  2. 用 `buildSettingWorld` + 真实 `Simulation` 起一个空世界；
  3. 调 `creationCoverage(emptySim.snapshot(), emptyPack.blueprints)`。
- **期望**：`null`（与 `coverageAfterBuild` 的 0 分母契约一致，调用方才能记 `not_measured`）。
- **实际**：`0`。
- **证据**：
  - 测试 `[L3] creationCoverage 在 0 分母时也应给 not_measured（已知缺陷）`，`creator-functional-l3.test.ts:129`；
  - 断言失败读数：`Expected values to be strictly equal: 0 !== null`；
  - 对照：同文件 `[L3] 覆盖率分母为 0：账本记 not_measured，不是 0/1` 通过，证明账本侧契约本身是对的，缺口在业务规则 feeder。
- **影响范围**：当前莞尔镇设定集 `blueprints.size = 10`，正常路径不会触发；属于 0 模板设定集/边界输入的口径不一致，但一旦触发会把「没测」误报成「不达标」。

---

## BUG-2 L0 熔断「降级」会把角色升到 L1

- **编号**：BUG-2
- **现象**：`AutonomousFuseController.triggerDowngrade()`（`src/world/creator/fuse.ts:540-559`）不区分当前等级，`immediate` 时无条件 `state.currentLevel = AutonomyLevel.L1`。在 L0 记录一次被拒命令后，拒绝率 `1/1 = 100% > 10%` 触发降级，结果把 L0 **升**到 L1 并熔断；随后 `isFused` 让后续 `recordCommandResult` 直接返回，L0 的窗口证据不再更新。
- **最小复现**：
  1. 真实 `CreatorEngine`，`targetLevel = L1`，`mapper` 初始 `currentLevel = 0`、`isFused = false`；
  2. 调公开接口 `submitHumanApproval('mapper', 'reject-1', false)`；
  3. 读 `getRoleState('mapper')`。
- **期望**：`currentLevel = 0`（降级不能越级向上），`isFused = true`（100% 拒绝率仍应熔断）。
- **实际**：`currentLevel = 1`，`isFused = true`；`downgrade_trigger` / `fuse_triggered` 事件把 `fromLevel=0`、`toLevel=1` 记成一次「降级」。
- **证据**：
  - 测试 `[L3] 熔断降级不能把 L0 升成 L1（已知缺陷）`，`creator-functional-l3.test.ts:289`；
  - 断言失败读数：`降级不能把 L0 升成 L1: 1 !== 0`；
  - 代码位置：`fuse.ts:546-553`。
- **影响范围**：L0 人工拒绝一次就会「升层 + 熔断」，与「L0→L1 是升级爬梯、拒绝是降级」的语义相反。

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
