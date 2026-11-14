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

## §3.1 评审 minor checks 的边界（2026-11-14 复核）

| 担心 | 复核结果 |
| --- | --- |
| 回放结束漏 `await` 结算 | 不成立。`TraceRuntime.step()` 每拍都 `await settlePendingLandings()`；`runTrace` 与 `runTraceWithRuntime` 都 `await runtime.step()` 到最后一拍，`fingerprintsAt` 在 await 之后取。已用「把 build 放在轨迹最后一拍」的测试钉住 |
| 结算期间楼被拆、读数漂 | 生产 `demolish` 会拒「正在施工」，所以「结算完成前拆除」当前不可达；但仍把 `coverageRate` 与 `pathfindingConnected` 移到 `await checkLandedBuilding` **之前**从同一份捕获快照算定，不再在 await 之后读可变网格 |
| 实体找不到 | `settleUnplannedLanding` 用**当前快照** `buildings.find`，找不到直接返回，不凭缓存形状补幽灵记录 |
| 会话缓存上限 | 读侧缓存上限 200 是有意的：超出后旧楼回退为「无脚注」（`null`），绝不显示一条错的。持久真相仍是服务端 JSONL 账本；面板查询的 `placeId` 与写入的 `instanceId` 是同一个键 |
| 「今日」的时钟 | `composeReport` 与场景的 `currentDay` 都用 `snapshot.now / DAY_MS`（虚拟世界钟），全文件不读 `Date.now` / `performance.now`。倍速与回放不漂 |
| 长违规文案撑破面板 | `line()` 走 `textContent`（无 `innerHTML`）；`.building-landing` 加 `overflow-wrap: anywhere` |
| ADR 硬编码行号 | `ADR_SCHEMA_PASS_RATE_SEMANTICS` 那张表全面改成方法/符号名，不再写 `SandboxScene.ts:NNN` |

## §4 验证

`world-client/test/creator-landing-parity.test.ts` 用一条最小轨迹
（外层开启 + 一条普通 `build` 指令、模板取「开局还没落位」的第一张蓝图）钉住三条：

1. 无头回放也产出 landing 记录（改动前为 0 条，红在断言）；
2. 那条记录真的跑过业务规则（`hasConflict` / `invariantViolated` 是布尔，
   `replayHashConsistent` 为 `null`）；
3. 外环 `mapper.totalCommands` 仍为 0。

模板必须取「开局未落位」的那张：`Simulation.build` 会拒「同模板已有一栋」，
用开局已存在的模板会让用例退化成「什么都没发生」而是绿——那是假绿。
