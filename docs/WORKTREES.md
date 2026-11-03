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
| D:/project/pwe-cast | feat/cast-artbook | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（首轮已合入，第三轮待补） |
| D:/project/pwe-fixtures | feat/fixtures | cs1lion | 2026-11-03 | 2026-11-10 | 占用中（续期：仍在活跃使用） |
| D:/project/pwe-funccreator | feat/func-creator | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-funcdaily | feat/func-daily | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-funcinteract | feat/func-interact | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-lively | feat/liveliness | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（未合入 main） |
| D:/project/pwe-routine | feat/routine-real | cs1lion | 2026-11-03 | 2026-11-10 | 占用中（续期：待第二轮合并） |
| D:/project/pwe-sample | sample/render-trials | cs1lion | 2026-11-03 | 2026-11-06 | 待回收（已合入 main；有 52 行未提交试验代码 `SandboxScene.ts`，待 owner 决定留或丢） |
| D:/project/pwe-scene | feat/scene-artbook | cs1lion | 2026-11-03 | 2026-11-17 | 活跃（尚无独有提交） |
| D:/project/pwe-scene-memory | feat/scene-memory | cs1lion | 2026-11-03 | 2026-11-10 | 占用中（续期：仍在活跃使用） |
| D:/project/pwe-warmup | feat/gate-warmup | cs1lion | 2026-11-03 | 2026-11-06 | 待回收（无独有提交） |
| D:/project/pwe-warmup-baseline | (detached) | cs1lion | 2026-11-03 | 2026-11-06 | 待回收（基线快照） |

**owner 口径**：本仓当前只有一位人类维护者，表里统一登记为 `cs1lion`。
若某个 worktree 实际由其他人/agent 创建，owner 应改成实际负责人或「待认领」，
不能继续挂默认值——巡检只认表，不认猜。
