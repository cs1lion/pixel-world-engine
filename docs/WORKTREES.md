# Worktree 登记表

本仓同时有多个 worktree（分支并行开发）。这张表回答四件事：**谁在用、从哪来、什么时候该回收、现在算不算过期**。

- 登记表是**人读**的约定；`npm run worktrees:audit`（仓库根目录）是**机器读**的巡检。
  两边用同一张表的列；脚本以 `git worktree list --porcelain` 为实时清单，
  表里没有的 worktree 会被报「未登记」。
- **不自动删除**。脚本只列候选，回收动作由 owner 手工执行（`git worktree remove <path>`）。
- owner 必填；预计回收时间必填（没有明确日期就写「创建 + 14 天」）。已合入 `main`
  的 worktree 应在 3 个工作日内回收或写明续期理由。
- 新建 worktree 时先加一行，再开工——顺序反过来，巡检就会先报一次未登记，
  这是有意的：**没登记的并行工作不应默认为正常**。

## 巡检

```bash
npm run worktrees:audit
node scripts/worktrees-audit.mjs --strict   # 未登记 / 过期未回收 / 表项悬空 -> exit 1
PWE_WORKTREE_TTL_DAYS=7 node scripts/worktrees-audit.mjs
```

判定口径：

| 类别 | 判据 | `--strict` 是否红 |
| --- | --- | --- |
| 未登记 | 实时清单里有，表里没有 | 红 |
| 过期未回收 | 今天 >= 预计回收时间，且状态不是「不回收 / 保留」 | 红 |
| 已合入未回收 | 分支已并进 `main`，worktree 仍存在 | 只提示（回收时点由 owner 判断） |
| 表项悬空 | 表里有，实时清单里没有 | 红 |

## 登记快照（2026-11-03）

> 仓库当前有并行活动，worktree 数量可能继续变化。**以下表是快照，实时读数以巡检输出为准。**

| 路径 | 分支 | owner | 创建时间 | 预计回收时间 | 状态 |
| --- | --- | --- | --- | --- | --- |
| C:/Users/18712/AppData/Local/Temp/pwe-main-probe | (detached) | 合并线 | 2026-11-06 | 2026-11-13 | 临时对照工作树（用后移除，非长期资产；到期回收，不续期） |
| D:/project/pixel-world-engine | main | cs1lion | 2026-10-25 | — | 主工作树（不回收） |
| D:/project/pixel-world-engine/.cindy-worktrees/steady-turing | cindy/steady-turing | cindy 会话（steady-turing） | 2026-11-10 | 2026-11-24 | 已合入 main `dcfcb95`（经 PR #38，31 笔）；worktree 暂留作后续轮次，到期再判回收 |
| D:/project/pwe-art-1111 | feat/art-ref-1111 | cindy 会话（art-ref-1111） | 2026-11-11 | 2026-11-25 | 已合入 main（经 PR #40，8 笔）；11-11 参考图集三轮落地，worktree 暂留作后续轮次，到期再判回收 |
| D:/project/pwe-anim | feat/animation-express | 待认领 | 2026-11-05 | 2026-11-19 | 活跃（未合入 main；动画表现力线） |
| D:/project/pwe-anim-fsm | feat/anim-fsm | anim-fsm 线（在役会话） | 2026-11-06 | 2026-11-20 | 活跃（未合入 main；角色动画状态机 v1，未接管渲染） |
| D:/project/pwe-audit-fix | fix/audit-standards-20261105 | 待认领 | 2026-11-05 | 2026-11-19 | 活跃（未合入 main；审计标准修订线） |
| D:/project/pwe-baseline-audit | chore/eval-screens-audit | E7 审计会话（Trae） | 2026-11-07 | 2026-11-14 | 已合入 main `f388494`（E7 屏幕消费表 + `check-lamp-band` 死接修复）；3 日内回收 |
| D:/project/pwe-before | (detached) | cs1lion | 2026-11-03 | 2026-11-13 | 基线快照（`54139dd`）；到期续登记，回收需 owner 确认（续期只表示尚未处理，不等于宣布留用或批准删除） |
| D:/project/pwe-spike | spike/depth-pipeline | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-cast | feat/cast-artbook | cs1lion | 2026-11-03 | 2026-11-17 | 已合入 main（`fe11a7f`，经 `119397e`）；本轮未回收：`tmp/` 有 49 张页面扫描图（gitignored），待确认 |
| D:/project/pwe-docs-flows | docs/verifiable-flows | 待认领 | 2026-11-06 | 2026-11-20 | 已合入 main（经 `48042a3`）；worktree 待 owner 回收 |
| D:/project/pwe-docs-fix | docs/verifiable-flows-fix | 待认领 | 2026-11-06 | 2026-11-20 | 已合入 main（经 `6df4324`）；worktree 待 owner 回收 |
| D:/project/pwe-eval | eval/ledger-facts-question | eval 线（在役会话） | 2026-11-04 | 2026-11-18 | 已合入 main（分支 tip `0a965ca`，经 `91c08e6` 合入；worktree 待 owner 回收） |
| D:/project/pwe-j1-drift | chore/j1-fixture-drift | J1 漂移调查线（在役会话） | 2026-11-07 | 2026-11-21 | 已合入 main `cd1e02f`；`fixture:check` 已接 CI；回收前仍须先拆 `world-client/node_modules` junction 再删目录 |
| D:/project/pwe-flaky-gates | fix/flaky-gates | 待认领 | 2026-11-04 | 2026-11-18 | 待回收（`486099c` 已合入 main，经 `39cff04`；分支待 worktree 回收后删） |
| D:/project/pwe-funccreator | feat/func-creator | cs1lion | 2026-11-03 | 2026-11-10 | 待回收（`4c47d92` 已合入 main，经 `9d80f7b`；分支待 worktree 回收后删） |
| D:/project/pwe-funcdaily | feat/func-daily | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-funcinteract | feat/func-interact | cs1lion | 2026-11-03 | 2026-11-17 | 已合入 main（`e8afbe6`，经 `c4266dc`；早期 `ae4cc61` 亦已入 main） |
| D:/project/pwe-lively | feat/liveliness | cs1lion | 2026-11-03 | 2026-11-17 | 已合入 main（`58c462c`，经 `f3bde10`；早期 `d725b7e` 亦已入 main） |
| D:/project/pwe-material | feat/interior-view | material-agent（Trae 会话，未推送） | 2026-11-04 | 2026-11-18 | `feat/material-upgrade` 已合入（`b6e8318`，经 `501eda1`）；当前 checkout 的 `feat/interior-view`（`7cd06eb`）未合入 |
| D:/project/pwe-memexp | experiment/daycard-readonly | 记忆实验线（在役会话） | 2026-11-04 | 2026-11-18 | 已合入 main（`169418d`，经 `3f4ed0f` 合入；worktree 待 owner 回收） |
| D:/project/pwe-motion | feat/scene-motion | 场景动效线（在役） | 2026-11-04 | 2026-11-18 | 已合入 main（`9cdcf78`，经 `ff63b96`；worktree 待 owner 回收） |
| D:/project/pwe-p4-light | sample/phaser4-lighting | Phaser 4 升级/光照试点线（在役会话） | 2026-11-06 | 2026-11-20 | **保留，勿回收**：升级提交 `e3a67e1` 已合入 main（`430dd0d`）；`2250162`（`?light=terrain/graphics/on` 探针）留在分支、未 push、未合 main，是光照结论唯一代码载体；工作区干净 |
| D:/project/pwe-palette-before | (detached) | 待认领 | 2026-11-04 | 2026-11-18 | 基线快照（`6ff3314`，待认领） |
| D:/project/pwe-sample | sample/render-trials | cs1lion | 2026-11-03 | 2026-11-13 | 本轮未回收（工作区不干净）：`37c7946` 已合入 main，经 `ce92d97`；有 52 行未提交试验代码 `SandboxScene.ts`，待 owner 决定留或丢；到期续登记，回收需 owner 确认（续期不等于留用或批准删除） |
| D:/project/pwe-evidence-provenance | chore/evidence-provenance-audit | 证据同源审计线（在役会话） | 2026-11-07 | 2026-11-21 | 活跃（未合入 main；基点 `60f77cd`，分支 tip `92cea52`；只读 warn/exit 0，未接 CI、未登记 allowlist，本轮不并入） |
| D:/project/pwe-scene-memory | feat/scene-memory | cs1lion | 2026-11-03 | 2026-11-10 | 已合入 main（`2d7406a`，经 `860f2bb`）；远程分支已删（2026-11-05）；worktree 待回收 |
| D:/project/pwe-soak | feat/soak-30d | 长周期浸泡线（在役） | 2026-11-04 | 2026-11-18 | 已合入 main（`3a41541`，经 `89e0a88`；worktree 待 owner 回收） |
| D:/project/pwe-verify | verify/stall-motion（`25ecc77`） | 一次性独立复核树（证据已入分支，合并后可清理） | 2026-11-04 | 2026-11-18 | 活跃（未合入 main；证据已入 `verify/stall-motion`，合并后可清理） |
| D:/project/pwe-warmup-baseline | (detached) | cs1lion | 2026-11-03 | 2026-11-13 | 待回收（基线快照）；到期续登记，回收需 owner 确认（续期只表示尚未处理，不等于宣布留用或批准删除） |
| D:/project/pwe-p1-shore | feat/shore-band | P1 岸线带线（在役会话） | 2026-11-07 | 2026-11-21 | 活跃（未合入 main；基点 `f1dfa00`；组件与灯潮界配置已实现，证据见 `docs/evidence/p1-shore/`） |
| D:/project/pwe-orphan-gates | chore/wire-orphan-gates | 孤儿闸门接线线（在役会话） | 2026-11-07 | 2026-11-21 | 已合入 main `0b450bd`；孤儿检测、预算等值断言、三闸门接线与 `fixture:check` 已落地（`check-ground-shadow` 已撤回 pending-ci） |
| D:/project/pwe-skill-standard | docs/skill-iteration-standard | skill 规范线（在役会话） | 2026-11-07 | 2026-11-21 | 已合入 main `a320987`；X3、`SKILL_ITERATION_STANDARD.md` 与两个只读审计已落地 |

**2026-11-06 巡检**：`pwe-a3`（detached @ `ae89fc6`）表项悬空——目录已不存在，
按 `--strict` 的「表项悬空」口径删掉表项；未动任何工作树。
同日补登 `pwe-docs-flows`、`pwe-docs-fix`（docs 修复线，均已在 main），
分支 tip 分别为 `48042a3`、`6df4324`；只登记，未动其工作树。

**owner 口径**：本仓当前只有一位人类维护者，表里统一登记为 `cs1lion`。
若某个 worktree 实际由其他人/agent 创建，owner 应改成实际负责人或「待认领」，
不能继续挂默认值——巡检只认表，不认猜。

## 已回收的工作树（2026-11-05）

| 路径 | 分支 | 归属 | 创建日期 | 回收日期 | 备忘 |
|---|---|---|---|---|---|
| D:/project/pwe-warmup | feat/gate-warmup | cs1lion | 2026-11-03 | 2026-11-05 | 已回收（`a098721`，经 `a6da49e`，证据已并入 main），分支已删 |
| D:/project/pwe-fixtures | feat/fixtures | cs1lion | 2026-11-03 | 2026-11-05 | 已回收（`effefc9`，经 `3c45887`，证据已并入 main），分支已删 |
| D:/project/pwe-scene | feat/scene-artbook | cs1lion | 2026-11-03 | 2026-11-05 | 已回收（`49d63bb`，经 `bba0aed`，证据已并入 main），分支已删 |
| D:/project/pwe-routine | feat/routine-real | cs1lion | 2026-11-03 | 2026-11-05 | 已回收（`2cc0efe`，经 `49c953b`，证据已并入 main），分支已删 |
