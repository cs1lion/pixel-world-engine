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

**2026-11-19 巡检**：`pwe-hud-ux`（feat/hud-and-villager-ux）已合入 main（经 PR #63，`480605c`），
worktree 已回收、本地与远端分支已删，表项同步移除。

## 登记快照（2026-11-03）

> 仓库当前有并行活动，worktree 数量可能继续变化。**以下表是快照，实时读数以巡检输出为准。**

| 路径 | 分支 | owner | 创建时间 | 预计回收时间 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D:/project/pixel-world-engine | main | cs1lion | 2026-10-25 | — | 主工作树（不回收） |
| D:/project/pwe-art-1111 | feat/art-ref-1111 | cindy 会话（art-ref-1111） | 2026-11-11 | 2026-11-25 | 已合入 main（经 PR #40，8 笔）；11-11 参考图集三轮落地，worktree 暂留作后续轮次，到期再判回收 |
| D:/project/pwe-anim-fsm | feat/anim-fsm | anim-fsm 线（在役会话） | 2026-11-06 | 2026-11-20 | 活跃（未合入 main；角色动画状态机 v1，未接管渲染） |
| D:/project/pwe-audit-fix | fix/audit-standards-20261105 | 待认领 | 2026-11-05 | 2026-11-19 | 活跃（未合入 main；审计标准修订线） |
| D:/project/pwe-before | (detached) | cs1lion | 2026-11-03 | 2026-11-29（2026-11-15 续期） | 基线快照（`54139dd`）；到期续登记，回收需 owner 确认（续期只表示尚未处理，不等于宣布留用或批准删除） |
| D:/project/pwe-spike | spike/depth-pipeline | cs1lion | 2026-11-03 | 2026-12-01（2026-11-17 续期） | 活跃（未合入 main）；到期续登记，回收需 owner 确认（续期只表示尚未处理，不等于宣布留用或批准删除）；本地领先 main 6 笔（1a/1b-1/1b-2 深度管线契约）且未推过远端，回收前先 `git push -u origin spike/depth-pipeline` |
| D:/project/pwe-delivery-ledger | feat/delivery-ledger | 待认领 | 2026-11-06 | 2026-11-20 | 已登记（补登记）；未合入 main，待 owner 回收 |
| D:/project/pwe-docs-fix | docs/verifiable-flows-fix | 待认领 | 2026-11-06 | 2026-11-20 | 已合入 main（经 `6df4324`）；worktree 待 owner 回收 |
| D:/project/pwe-eval | eval/ledger-facts-question | eval 线（在役会话） | 2026-11-04 | 2026-11-18 | 已合入 main（分支 tip `0a965ca`，经 `91c08e6` 合入；worktree 待 owner 回收） |
| D:/project/pwe-flaky-gates | fix/flaky-gates | 待认领 | 2026-11-04 | 2026-11-18 | 待回收（`486099c` 已合入 main，经 `39cff04`；分支待 worktree 回收后删） |
| D:/project/pwe-material | feat/interior-view | material-agent（Trae 会话，未推送） | 2026-11-04 | 2026-11-18 | `feat/material-upgrade` 已合入（`b6e8318`，经 `501eda1`）；当前 checkout 的 `feat/interior-view`（`7cd06eb`）未合入 |
| D:/project/pwe-p4-light | sample/phaser4-lighting | Phaser 4 升级/光照试点线（在役会话） | 2026-11-06 | 2026-11-20 | **保留，勿回收**：升级提交 `e3a67e1` 已合入 main（`430dd0d`）；`2250162`（`?light=terrain/graphics/on` 探针）留在分支、未 push、未合 main，是光照结论唯一代码载体；工作区干净 |
| D:/project/pwe-palette-before | (detached) | 待认领 | 2026-11-04 | 2026-11-18 | 基线快照（`6ff3314`，待认领） |
| D:/project/pwe-sample | sample/render-trials | cs1lion | 2026-11-03 | 2026-11-29（2026-11-15 续期） | 本轮未回收（工作区不干净）：`37c7946` 已合入 main，经 `ce92d97`；有 52 行未提交试验代码 `SandboxScene.ts`，待 owner 决定留或丢；到期续登记，回收需 owner 确认（续期不等于留用或批准删除） |
| D:/project/pwe-evidence-provenance | chore/evidence-provenance-audit | 证据同源审计线（在役会话） | 2026-11-07 | 2026-11-21 | 活跃（未合入 main；基点 `60f77cd`，分支 tip `92cea52`；只读 warn/exit 0，未接 CI、未登记 allowlist，本轮不并入） |
| D:/project/pwe-verify | verify/stall-motion（`25ecc77`） | 一次性独立复核树（证据已入分支，合并后可清理） | 2026-11-04 | 2026-11-18 | 活跃（未合入 main；证据已入 `verify/stall-motion`，合并后可清理） |
| D:/project/pwe-warmup-baseline | (detached) | cs1lion | 2026-11-03 | 2026-11-29（2026-11-15 续期） | 待回收（基线快照）；到期续登记，回收需 owner 确认（续期只表示尚未处理，不等于宣布留用或批准删除） |
| D:/project/pwe-p1-shore | feat/shore-band | P1 岸线带线（在役会话） | 2026-11-07 | 2026-11-21 | 活跃（未合入 main；基点 `f1dfa00`；组件与灯潮界配置已实现，证据见 `docs/evidence/p1-shore/`） |
| D:/project/pwe-art1-visual | feat/art1-visual-and-creator-ux | cs1lion | 2026-11-19 | 2026-12-03 | 活跃（未合入 main；基点 `d0bdf54`，stacked 在 PR #69 上；art1 可热替换 tile 图集管线 + 固定灯槽池光照 + fx-ambient 微动效 + `?atlas=1` 开关 + `test:art1-smoke` 闸门；造物落点/掀屋顶由 PR #69 承接；ADR `ADR_ART1_ATLAS_PRESENTATION.md`） |
| D:/project/pwe-creator-overlay | feat/creator-placement-overlay | cindy 会话（creator-placement-overlay） | 2026-11-19 | 2026-12-03 | 活跃（未合入 main；基点 `beaa33a`；造物主摆放遮罩 + 旁观掀屋顶，已开 PR #69，只改 world-client/ 与文档） |

**2026-11-06 巡检**：`pwe-a3`（detached @ `ae89fc6`）表项悬空——目录已不存在，
按 `--strict` 的「表项悬空」口径删掉表项；未动任何工作树。

**2026-11-16 巡检**：`pwe-rewind`（feat/time-rewind-trajectory）已合入 main（经 PR #57，`487b6e5`），
worktree 已回收、本地分支已删，表项同步移除；同日发现 `pwe-sensory` 表项悬空——目录已不存在，
其工作已合入 main（经 PR #55，`09a186ce`），按同一口径删掉表项。
同日补登 `pwe-docs-flows`、`pwe-docs-fix`（docs 修复线，均已在 main），
分支 tip 分别为 `48042a3`、`6df4324`；只登记，未动其工作树。

**2026-11-19 巡检**：`pwe-oracle-hygiene`（`feat/oracle-prompt-hygiene`）已合入
main（经 PR #61，`35754ad`），worktree 与本地分支已回收，表项按「已合入即清理」
口径移除；其开工登记内容见该 PR 的提交说明。同日 `pwe-creator-overlay` 建仓未登记，
按上表口径补登记（owner 写「待认领」，实际负责人认领后改掉）；`pwe-world-bundle`
由该线自己登记（world-bundle 线在役会话）；`pwe-unlock-gates`（本线）按「先登记再开工」登记。

**2026-11-19 巡检**：`pwe-world-bundle`（`feat/world-bundle-compiler`）已合入
main（经 PR #62，`49e523d`），worktree 已回收、本地分支已删，表项同步移除。

**2026-11-19 巡检**：`pwe-unlock-gates`（`chore/unlock-presentation-gates`）已合入
main（经 PR #65，`6d831a7`），worktree 已回收、本地分支已删，表项按「已合入即清理」
口径移除。

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
