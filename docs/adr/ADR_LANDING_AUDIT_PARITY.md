# ADR_LANDING_AUDIT_PARITY：落地检查归世界层，两个执行器同口径

- status: aligned
- verified_at: 2026-11-14
- verified_by: agent 起草，用户 2026-11-14 拍板「只记世界层账」
- evidence: `world-client/src/trace/runtime.ts`, `world-client/src/scenes/SandboxScene.ts`, `world-client/src/creator/business-rules.ts`, `world-client/test/creator-landing-parity.test.ts`, `docs/adr/ADR_SCHEMA_PASS_RATE_SEMANTICS.md`

## §1 问题

一个世界有两个执行器：浏览器里的 `SandboxScene`、无头回放里的 `TraceRuntime`。
对「谁建的楼」这件事，浏览器侧早就分开了——`recordUnplannedLanding` 会把非造物主
提案的落地（神谕、世界入口）也跑一遍 `checkLandedBuilding` 并写一条 landing 记录；
而无头侧只要 `pendingCreations` 里没有这个 id 就直接 `return`。

于是同一段轨迹在两个执行器里长出不同的账。这类缺陷最坏的地方是两边都「正常」：
浏览器检查了、回放没检查，「同种子回放哈希一致」这条门禁就建立在一个覆盖不全的账本上。

## §2 决策

1. **落地后业务规则检查归世界层**，不归外环。任何来源落地的楼都过
   `checkLandedBuilding`（越界 / 门口在占地内 / 压镇心 / 压摆件 / 门口到不了镇心）。
2. **两个执行器同口径**：`TraceRuntime` 补 `settleUnplannedLanding`，与
   `SandboxScene.recordUnplannedLanding` 字段一致；没有冻住落地前 view 的入口，
   `replayHashConsistent` 记 `null`——「没跑」不是「通过」。
3. **外环自评不因此加分**：神谕/世界入口的落地一次都不调 `submitHumanApproval` /
   `recordCommandResult`。外环的通过率只算它自己提的案，这与
   `ADR_SCHEMA_PASS_RATE_SEMANTICS` 的口径一致（那边定的是「落地成功率」，不是「Schema 通过率」）。

## §3 不在范围

- 不给神谕入口补「落地前冻结视图」，因此它的回放一致性只能记 `null`。
- 不新增外环指标字段（例如「外来落地违规率」）。用户 2026-11-14 选了「只记世界层账」，
  将来要单独立门禁时再另起 ADR，因为那要动 `MetricWindow` 与存档契约。
- 不改 `schemaPassRate` / `manualModificationRate` 的既有定义。

## §4 验证

`world-client/test/creator-landing-parity.test.ts` 用一条最小轨迹
（外层开启 + 一条普通 `build` 指令、模板取「开局还没落位」的第一张蓝图）钉住三条：

1. 无头回放也产出 landing 记录（改动前为 0 条，红在断言）；
2. 那条记录真的跑过业务规则（`hasConflict` / `invariantViolated` 是布尔，
   `replayHashConsistent` 为 `null`）；
3. 外环 `mapper.totalCommands` 仍为 0。

模板必须取「开局未落位」的那张：`Simulation.build` 会拒「同模板已有一栋」，
用开局已存在的模板会让用例退化成「什么都没发生」而是绿——那是假绿。
