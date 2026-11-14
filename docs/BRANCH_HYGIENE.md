# 分支生命周期与卫生约定

> 与 `docs/WORKTREES.md` 的分工：**那张表管本地 worktree，这份管远端分支**。
> 两者都是「人读登记表 + 机器巡检、脚本只列不删」，回收/删除动作归 owner。
>
> 建立于 2026-11-15，基线见 `docs/BRANCH_AUDIT_20261115.md`。

## 一、三层机制

| 层 | 机制 | 状态 |
| --- | --- | --- |
| **1 治本：合并即删** | 仓库 Settings → General → Pull Requests 勾了 `Automatically delete head branches`（`delete_branch_on_merge=true`）。PR 一合，远端 head 分支自动消失，不再产生新的堆积 | 2026-11-15 已开 |
| **2 边界：不许直推 main** | main 的远端分支保护（四项必要检查全绿、禁强推、禁删除、`enforce_admins=true`）+ `.githooks/pre-push`（拒推 main、拒新增大 blob） | 既有 |
| **3 巡检：例外必须登记** | `docs/BRANCH_EXCEPTIONS.md` 是单一真相；`npm run audit:branches -- --strict` 在 `repo-harness` job 里跑，未登记分支 / 悬空表项 / 例外过期即红 | 2026-11-15 新增 |

三层各管一段：第 1 层不让新垃圾产生，第 2 层不让 main 被绕过，第 3 层拦住「有意保留但没人说得清为什么」的分支。

## 二、分支生命周期

1. **起**：从**最新 `origin/main`** 拉，分支名按语义取（`feat/` `fix/` `docs/` `chore/` `exp/` `spike/` `verify/`）。**不复用旧分支名**——旧名在 PR 记录、登记表与本地 worktree 里都还指着旧含义。
2. **做**：一个分支一个 PR。开 worktree 时先去 `docs/WORKTREES.md` 加一行再开工（顺序反了巡检会报未登记，这是有意的）。
3. **合**：PR 走四项必要检查。合入后第 1 层自动删远端分支；本地那条 `git fetch --prune` 同步掉失效的远程追踪引用，worktree 按 `WORKTREES.md` 由 owner 回收。
4. **例外**：确实不能合、或要留着做审阅对照的，**先写进 `docs/BRANCH_EXCEPTIONS.md`**（五列填全，理由写「为什么不合」，到期复核给硬日期），否则 `--strict` 会红。
5. **归档**：实验被否、提案没提 PR、但有内容不想丢的，**先打归档 tag 再删分支**：
   ```bash
   git tag -a archive/<语义名> origin/<分支> -m "归档：<内容>；<为什么不进 main>"
   git push origin archive/<语义名>
   git push origin --delete <分支>
   ```
   tag 让提交对象留在仓库里，随时能 `git checkout archive/...` 或重建分支补提 PR；它不占分支列表。
6. **清**：例外到期复核，不需要了就关 PR、删分支、删表里那一行。历史看 `docs/BRANCH_AUDIT_*.md` 快照与 git log，**表里不留历史行**。

## 三、判别口径（别把 squash 当成未合并）

`ahead > 0` **不等于**「有未合入内容」。`squash` / `rebase` 合并会让分支头提交的哈希不在 main 里，但改动已经进去了。判据是 patch-id：

```bash
git cherry origin/main <分支tip>     # 全是 `-` = patch 已在 main，可安全删
                                     # 出现 `+` = 真有未合入内容，先归档
```

`git rev-list --left-right --count origin/main...origin/<分支>` 输出的是「behind ahead」，别读反。

## 四、巡检命令

```bash
# 本地：看全貌，不阻断
npm run audit:branches

# CI（repo-harness）/ 合入前：未登记、悬空、过期即 exit 1
npm run audit:branches -- --strict

# 本地 worktree 的兄弟巡检（只列不删）
npm run worktrees:audit
node scripts/worktrees-audit.mjs --strict

# 同步失效的远程追踪引用
git fetch --prune
```

脚本**不删任何东西**。删远端分支用 `git push origin --delete <branch>`，删之前按第三节判一遍 `git cherry`；批量删除先小批试一个，确认 `.githooks/pre-push` 放行。

## 五、这套机制的已知边界

- `audit-branches.mjs` 离线时会**明确打印 SKIP** 并只校验登记表，不把全仓分支误判成未登记；CI 上若长期 SKIP，要在 CI 读数里看出来，不能当成绿。
- 自动删分支只对**通过 PR 合入**的分支生效；本地直接 push 到 main（已被保护拒绝）或手动 merge 不触发。
- 巡检把「在途分支」排除在未登记判定之外：当前检出分支 + `GITHUB_HEAD_REF` / `GITHUB_REF_NAME`
  + 所有 OPEN PR 的 head（`gh pr list`）。它们是在做的工作，不是堆积；不排除的话每个 PR
  都会把自己和并行 PR 的分支判成「未登记」。CI 的 `repo-harness` 给这一步配了
  `GH_TOKEN` 与 `pull-requests: read`，`gh` 不可用时才退化到前两项并**打印提示**——
  读日志时看到那行提示，说明这次的「无未登记」只覆盖了自己的分支。
  合入后自动删分支会收掉它们，不需要登记。
- 例外表只管**远端分支**。本地 worktree 里那些「活跃未合入」的分支由 `WORKTREES.md` 管，见审计快照的 C 类。
- 归档 tag 不会自动过期，也不在巡检范围内；它们是有意保留的内容，不是垃圾。
- 「到期复核」用本地日历日，CI runner 是 UTC：边界日可能差一天，别把到期日设在临界点。
