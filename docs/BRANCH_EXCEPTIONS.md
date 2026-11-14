# 分支例外登记表

> **这是例外登记的单一真相**：`scripts/audit-branches.mjs` 直接解析本表；
> `docs/BRANCH_HYGIENE.md` 只讲规则，不重复列分支。
> 表里没有、又不叫 `main` 的远端分支，`--strict` 会判红。
>
> 一条例外 = 一个**有意不删**的远端分支。合入即删是默认，不需要登记；
> 只有「还没合 / 永远不合 / 供人对照」才写进来。

| 分支 | 类型 | 理由 | 到期复核 | 处置 |
| --- | --- | --- | --- | --- |
| `exp/hd2d-p1` | draft-review | PR #30（Draft Open）标注「仅供 CI / 审阅，不合并」；7 笔未合入提交是 HD-2D P1 的实验对照，留着给审阅比对 | 2026-11-29 | 到期确认 #30 是否还要；不要就关 PR 并删分支，或按 `BRANCH_HYGIENE.md` 打归档 tag |

## 已归档（分支已删，内容仍在）

这两条**不是远端分支**，所以不进上表；列在这里是为了让「那 14 笔去哪了」有答案。

| 归档 tag | 原分支 | 内容 | 为什么没合 |
| --- | --- | --- | --- |
| `archive/docs-world-expansion-proposal` | `docs/world-expansion-proposal` | 1 笔，418 行《世界扩展提案（第一阶段）》 | 提案写完没提 PR，归档 tag 里的 WORLD_EXPANSION_PROPOSAL.md 在 main 上不存在。内容有价值，用 tag 保底，随时可重建分支补提 PR |
| `archive/feat-hd2d-p2` | `feat/hd2d-p2` | 13 笔 HD-2D P2 移轴第一版实现与取证 | #33 被关闭未合入；#34（`docs/hd2d-p2-negative`）已落「P2 移轴判死、留负面结论与三条可复用判断」，实验代码按结论不进 main |

## 写表规矩

- 每行必须填全五列；「理由」要写**为什么不合**，不写「以后再说」。
- 「到期复核」是硬日期，过期未复核 `--strict` 会报到期。
- 例外消失（分支删了 / PR 合了）就**删掉这一行**，不要留历史；历史看 `docs/BRANCH_AUDIT_*.md` 快照与 git log。
