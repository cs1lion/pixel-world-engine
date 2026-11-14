# 远端分支清理与未合并情况审计（2026-11-15）

- main 基线：`a9c7ef4`（PR #48 合入后）
- 复核命令：`git ls-remote --heads origin`、`git rev-list --left-right --count origin/main...origin/<b>`、`git cherry origin/main <tip>`、`gh pr list --state all`
- 处置：`docs/BRANCH_HYGIENE.md`（机制）、`docs/BRANCH_EXCEPTIONS.md`（例外单一真相）
- **本文是一次性快照**，不随分支状态更新；之后看例外表与 git log。

## 一、已确认删除（22 个）

删前逐个复核，不盲信排查报告。删后 `git ls-remote --heads origin` 只剩 `main` 与 `exp/hd2d-p1`。

| 类别 | 数量 | 判据 | 分支 |
| --- | --- | --- | --- |
| 已合入 PR、ahead=0 | 17 | 完全被 main 包含 | `cindy/steady-turing`、`docs/ci-attempt1-ledger`、`docs/readme-2026-11-11`、`docs/readme-story`、`feat/actions-interaction`、`feat/anim-fsm`、`feat/anim-fsm-calibration`、`feat/anim-fsm-render`、`feat/art-ref-1111`、`feat/light-bake`、`feat/site-activities`、`feat/ui-glass-1111`、`fix/walk-anim` 等 |
| 无 PR、ahead=0、落后 284–305 提交 | 3 | 无独立改动 | `fix/test-glob-recursive`、`fix/claims-probe-recursive`、`fix/port-parallel-rule` |
| squash/rebase 造成 1–2 ahead | 4 | `git cherry` 全是 `-`，patch 已在 main | `docs/hd2d-p2-negative`(1)、`docs/w2-junction`(2)、`feat/building-bake`(1)、`feat/night-market`(2) |
| 有独立内容、先归档再删 | 2 | 见第二节 | `docs/world-expansion-proposal`、`feat/hd2d-p2` |

`feat/light-bake` 删后本地同名分支失去 upstream（工作区改动未受影响）；已写进 `docs/RESUME.md` 断点。

## 二、未合并情况与原因（本次整理的重点）

### A. 远端仍在、有意不删（1 个，已登记例外）

| 分支 | 未合入 | 原因 | 处置 |
| --- | --- | --- | --- |
| `exp/hd2d-p1` | 7 笔 | PR **#30（Open / Draft）** 标注「仅供 CI / 审阅，不合并」；内容是 HD-2D P1 的实验对照，留作审阅比对。落后 main 86 提交 | 保留，写进 `BRANCH_EXCEPTIONS.md`，到期复核 2026-11-29。到期确认 #30 是否还要；不要就关 PR 删分支 |

### B. 内容保底已归档、分支已删（2 个，共 14 笔）

| 归档 tag | 原分支 | 未合入 | 为什么没合 |
| --- | --- | --- | --- |
| `archive/docs-world-expansion-proposal` | `docs/world-expansion-proposal` | 1 笔 / 418 行《世界扩展提案（第一阶段）：四个不依赖高度的组件与可行性矩阵》 | **提案写完没提 PR**。归档 tag 里的 WORLD_EXPANSION_PROPOSAL.md 在 main 上不存在。内容有价值，用 tag 保底，随时可重建分支补提 PR |
| `archive/feat-hd2d-p2` | `feat/hd2d-p2` | 13 笔（P2 纯烘焙移轴第一版：整数 box blur、行裁切窗、双缓冲 + 取证与读数落账） | PR **#33 被关闭未合入**；PR **#34**（`docs/hd2d-p2-negative`）已落结论「HD-2D P2 移轴判死，留负面结论与三条可复用判断」。按该结论，实验代码不进 main，只留结论文档 |

两个 tag 都已推到远端并校验：提案文档可从 tag `cat-file` 读回，P2 的 13 笔全部可达。

### C. 本地 worktree 里的「活跃未合入」（不受本次远端清理影响）

这些分支**只在本地 worktree**，没有对应远端分支，属于 `docs/WORKTREES.md` 的管辖范围，owner 手工回收，脚本只列不删：

| worktree | 分支 | 登记表写的原因 |
| --- | --- | --- |
| `pwe-anim` | `feat/animation-express` | 动画表现力线，待认领 |
| `pwe-anim-fsm` | `feat/anim-fsm-render` | 角色动画状态机 v1，未接管渲染 |
| `pwe-audit-fix` | `fix/render-budget-threshold` | 审计标准修订线，待认领 |
| `pwe-evidence-provenance` | `chore/evidence-provenance-audit` | 只读 warn/exit 0，未接 CI、未登记 allowlist，本轮不并入 |
| `pwe-funcdaily` | `feat/func-daily` | 未写具体原因 |
| `pwe-p1-shore` | `feat/shore-band` | P1 岸线带线，组件与灯潮界配置已实现，证据在 `docs/evidence/p1-shore/` |
| `pwe-spike` | `spike/depth-pipeline` | 未写具体原因 |
| `pwe-verify` | `verify/stall-motion` | 一次性复核树，证据已入分支，合并后可清理 |

另有 4 个**未登记** worktree（`sincere-pasteur`、`pwe-delivery-ledger`、`pwe-terrain-design`、`pwe-world-expand`），按 `WORKTREES.md` 需补登记。

### D. 「假未合并」：本地 28 个领先 main 的分支里，4 个是 squash 残影

`docs/hd2d-p2-negative`、`docs/w2-junction`、`feat/building-bake`、`feat/night-market` 本地还算 `ahead>0`，但 `git cherry` 全 `-`，改动已在 main。这类**不要**当成待合内容，也不要为它们建 PR。其余本地分支（`spike/depth-pipeline` 6 笔、`fix/fixture-check-revive` 10 笔、`feat/stair-flight` 5 笔等）是真有本地未合入提交，由各自 worktree 的 owner 决定去留。

## 三、核实中发现的两处登记错误

1. **`npm run worktrees:audit` 里 `pwe-docs-fix`（`docs/world-expansion-proposal`）标为「已合入 main（经 `6df4324`）」是错的**。`6df4324` 是 `docs/verifiable-flows-fix` 的 merge，改的是 `docs/evidence/` 三份文件；提案文档在 main 上不存在。所以没有直接删，先打了归档 tag。登记表这行需 owner 更正。
2. 排查报告写 `feat/hd2d-p2`「需确认是否已被 #34 否定归档」——实际 13 笔 `git cherry` **全部 `+`**，一笔都没进 main；#34 只合入了 51 行负面结论文档。所以按「被否的实验」归档，不是「已包含」。

## 四、清理后留下的待办

| 项 | 状态 |
| --- | --- |
| 仓库自动删分支 | ✅ 已开（`delete_branch_on_merge=true`） |
| 分支卫生巡检 + 例外登记 | ✅ `npm run audit:branches`，接进 `repo-harness` |
| 17 个已合入未回收的本地 worktree | ⏳ owner 手动回收（`worktrees:audit` 只列不删）；`pwe-cast` 的 `tmp/` 有 49 张 gitignored 扫描图，`pwe-j1-drift` 要先拆 `node_modules` junction |
| `WORKTREES.md` 两条悬空表项 | ⏳ `pwe-main-probe`、`pwe-baseline-audit` |
| `pwe-docs-fix` 的错误合入声明 | ⏳ 见第三节 |
| `CLAUDE.md` 补一条指向 `BRANCH_HYGIENE.md` 的指针 | ⏳ 该文件有用户未提交改动，本次未动，留给那笔一起带 |
