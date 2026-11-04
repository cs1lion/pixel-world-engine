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
| D:/project/pixel-world-engine | main | cs1lion | 2026-10-25 | — | 主工作树（不回收） |
| D:/project/pwe-before | (detached) | cs1lion | 2026-11-03 | 2026-11-06 | 基线快照（`54139dd`） |
| D:/project/pwe-spike | spike/depth-pipeline | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-cast | feat/cast-artbook | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（`fe11a7f` 已合入 main；worktree 仍有未提交改动，待 owner 收尾） |
| D:/project/pwe-eval | eval/ledger-facts-question | eval 线（在役会话） | 2026-11-04 | 2026-11-18 | 活跃（分支 tip `39cff04`，暂无自有提交；审计按「已合入 main」计为回收候选） |
| D:/project/pwe-fixtures | feat/fixtures | cs1lion | 2026-11-03 | 2026-11-10 | 占用中（续期：仍在活跃使用） |
| D:/project/pwe-flaky-gates | fix/flaky-gates | 待认领 | 2026-11-04 | 2026-11-18 | 待回收（`699f54b` 已合入 main；分支保留） |
| D:/project/pwe-funccreator | feat/func-creator | cs1lion | 2026-11-03 | 2026-11-10 | 待回收（`4c47d92` 已合入 main；分支保留） |
| D:/project/pwe-funcdaily | feat/func-daily | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-funcinteract | feat/func-interact | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（`ae4cc61` 已合入 main；`7319ee4` 未合入） |
| D:/project/pwe-lively | feat/liveliness | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（`d725b7e` 已合入 main；`93da6d9` 未合入） |
| D:/project/pwe-material | feat/material-upgrade | material-agent（Trae 会话，未推送） | 2026-11-04 | 2026-11-18 | 活跃（未合入 main；材质层：路面/空地/外立面/人物，按类分四次提交） |
| D:/project/pwe-memexp | experiment/daycard-readonly | 记忆实验线（在役会话） | 2026-11-04 | 2026-11-18 | 活跃（`169418d`，未合入 main；合并期间外部创建） |
| D:/project/pwe-motion | feat/scene-motion | 场景动效线（在役） | 2026-11-04 | 2026-11-18 | 活跃（未合入 main） |
| D:/project/pwe-palette-before | (detached) | 待认领 | 2026-11-04 | 2026-11-18 | 基线快照（`6ff3314`，待认领） |
| D:/project/pwe-routine | feat/routine-real | cs1lion | 2026-11-03 | 2026-11-10 | 占用中（续期：待第二轮合并） |
| D:/project/pwe-sample | sample/render-trials | cs1lion | 2026-11-03 | 2026-11-06 | 待回收（已合入 main；有 52 行未提交试验代码 `SandboxScene.ts`，待 owner 决定留或丢） |
| D:/project/pwe-scene | feat/scene-artbook | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-scene-memory | feat/scene-memory | cs1lion | 2026-11-03 | 2026-11-10 | 占用中（续期：仍在活跃使用） |
| D:/project/pwe-soak | feat/soak-30d | 长周期浸泡线（在役） | 2026-11-04 | 2026-11-18 | 活跃（未合入 main） |
| D:/project/pwe-verify | verify/stall-motion（`3e417c7`） | 一次性独立复核树（证据已入分支，合并后可清理） | 2026-11-04 | 2026-11-18 | 待回收（证据已入 `verify/stall-motion`，合并后可清理） |
| D:/project/pwe-warmup | feat/gate-warmup | cs1lion | 2026-11-03 | 2026-11-10 | 待回收（`a098721` 已合入 main）；帧率/相位闸门校准，收尾完成 |
| D:/project/pwe-warmup-baseline | (detached) | cs1lion | 2026-11-03 | 2026-11-06 | 待回收（基线快照） |

**owner 口径**：本仓当前只有一位人类维护者，表里统一登记为 `cs1lion`。
若某个 worktree 实际由其他人/agent 创建，owner 应改成实际负责人或「待认领」，
不能继续挂默认值——巡检只认表，不认猜。
