# ADR_SAVE_AUTONOMY_PERSIST：外环自治状态入存档（v7）

- status: aligned
- verified_at: 2026-11-10
- verified_by: agent（代码与测试已落工作区，未提交；用户拍板「A2 扩展存档」）
- evidence: `world-client/src/world/save.ts`, `world-client/src/world/simulation.ts`, `world-client/src/world/creator/fuse.ts`, `world-client/src/creator/engine.ts`, `world-client/src/scenes/SandboxScene.ts`, `docs/save-v7.sample.json`, `world-client/test/autonomy-save-roundtrip.test.ts`

## 1. 问题

`CreatorEngine` 的外环状态——六个角色的自治等级（L0–L4）、滑动指标窗口、世界日计数、熔断态——只活在单次会话。刷新/重进后 `new CreatorEngine(...)` 把角色全部重置到 L0（OPEN_ISSUES A2）。

## 2. 决策

- **存档升 v7**，新增 `world.autonomy`：`readonly AutonomyRoleState[] | null`。每项带 `roleId`、`currentLevel`、`targetLevel`、`days`、`isFused`、`metrics`（完整的 `MetricWindow`）。`null` = 没有外环状态（新世界 / 旧档迁移），从 L0 重新开始。
- **迁移 v6→v7**：缺省 `autonomy: null`，不凭空给旧档安等级。`SCHEMA_V7_FINGERPRINT`、`SAVE_V7_ADDED_PATHS`、`assertSaveV6` 自证、`docs/save-v7.sample.json` 一并补齐。
- **职责分离**：`Simulation` 不持有外环状态。`toSave(memoryState, autonomyState)` 由场景把 `CreatorEngine.exportAutonomy()` 递进来，只负责搬运；`fromSave` 不碰它。
- **控制器层**：`AutonomousFuseController` 加 `exportRoleSnapshots()` / `restoreRoleSnapshots()`，恢复等级、目标、指标窗口、世界日计数、熔断态；`sampleTick` 与审计日志是可重算的派生量，不入档。角色对不上（换设定集）时静默跳过。
- **场景接线**：`SandboxScene` 的 `buildSave()` 统一组装（记忆段 + 外环快照），`pagehide` / `saveNow` / `maybeAutoSave` 都走它；构造 `CreatorEngine` 时传 `autonomy: loadedSave?.world.autonomy`。历史快照那条路刻意不带外环状态。

## 3. 不在范围

- 不复活 `worldChangeVersion`（OPEN_ISSUES B3，死字段）。
- **导演完整历史 / 熔断事件日志不入档**：`FuseEvent.details` 含 `Record<string, unknown>`，体积与不确定性都高。只存「重进后不从 L0 重来」的最小快照。
- **存档上限与配额逻辑不改，也不预先判定要不要改**：`world.autonomy` 只有 6 个角色的定长结构，体积远小于 `SETTLED_WARN_THRESHOLD`；是否需要动 `IMPORT_MAX_BYTES` / pre-push 阈值，等实测体积证据再决策（用户明确要求逐步深入）。
- 不改 `targetLevel` 语义：爬到目标等级就停。

## 4. 验证

- `test/save-*.test.ts` 81/81：v6 样例迁 v7 自动补 `autonomy: null`，指纹 `ab033c24db741ee3` 一致；各历史版本迁移链一路到 v7 均直接过 `assertSave`。
- `test/autonomy-save-roundtrip.test.ts` 4/4：非 L0 快照能过完整校验；存档 JSON 往返后等级、非空指标窗口、天数、熔断态逐一还原；空快照时全部 L0；角色对不上的快照静默跳过。
- `test/creator-engine.test.ts` 新增 1 条：用快照构造引擎后 mapper 仍是 L2、指标窗口还原，无快照时 L0。
