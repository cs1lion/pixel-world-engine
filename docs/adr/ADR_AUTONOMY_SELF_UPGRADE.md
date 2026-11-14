# ADR_AUTONOMY_SELF_UPGRADE：零造物世界也能自制升级（C1）

- status: aligned
- verified_at: 2026-11-10
- verified_by: agent（代码与测试已落工作区，未提交；用户拍板「C1 需要世界自制升级」）
- evidence: `world-client/src/world/creator/fuse.ts`, `world-client/test/autonomy-self-upgrade.test.ts`, `world-client/test/creator-business-rules.test.ts`

## 1. 问题

升级门禁全靠「造物观测」：`tryClimbUp` 要求 `schemaPassRate` 非 null，`qualityGatesFor(L2)` 要求 `coverageRate` 非 null 且 `conflictChecks` / `invariantChecks` > 0。安静的、不再扩张的世界这些恒为 0/null，于是卡在 L1（OPEN_ISSUES C1）。

## 2. 决策

新增「自运行观察」升级通道，**四条同时成立**才放行，且只升到 L2：

1. 世界确实在跑：`selfRunningDays >= FUSE_CONFIG.selfRunningRequiredDays`（7，`endOfDay` 真的被调过）；
2. 连续干净日 `cleanDays >= 7`：期间无新增冲突 / 不变式违反 / 回滚（出事即归零，用 `lastIssueTotal` 判当天增量）；
3. 累计问题数仍为 0，且未熔断；
4. **整个生命周期从没造过物**：`everCreated === false`。

`selfRunningDays` / `cleanDays` / `lastIssueTotal` / `everCreated` 放在 `CreatorRoleState` 上，不进 `MetricWindow`（升级清零不该抹掉它们），也**不入存档**（派生量，刷新后重新攒；等级本身由 A2 保留）。升级留 `climb_self_running` 事件，与常规 `climb_success` 区分，便于审计。

**只到 L2**：L3/L4 仍要真实的空间（寻路/碰撞/约束）与回放（溯源/哈希一致）证据，那不是「过日子天数」能替代的。

**防白送的关键**：`everCreated` 而非 `totalCommands === 0`。后者升级即清零，会把「造过物但窗口清零」冒充成「从没造过」——实测那样会让既有「不能白送」用例在 14 天时全角色白升 L2。

## 3. 不在范围

- 不引入可控时钟 / 加速测试入口（OPEN_ISSUES C2 另议）。C1 的天数证据由 `endOfDay` 驱动，浏览器里熬满 7 个世界日仍慢，这条未解决。
- 不改 `targetLevel` 语义，不改 L0「需要人工逐项确认」分支。
- 不动 A1（`schemaPassRate` 缺失败侧分母）：C1 走的是独立旁路，不靠修补常规比率。A1 仍是已登记未决项。
- 不与记忆层、感知层耦合：只读 `CreatorRoleState` 自身的计数。

## 4. 验证

- `test/autonomy-self-upgrade.test.ts` 6/6：零造物 7 天 L0→L1、再 7 天 L1→L2；天数不足不升；只升到 L2；出过冲突/违规/回滚不升；造过物但窗口清零仍走「不能白送」门禁；熔断中不升。
- `test/creator-*.test.ts` 234/234：既有「不能白送」「正常落地门禁放行」「死锁解除」等全部保持原语义，未被旁路绕过去。
