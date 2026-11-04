# 读档出处闸证据（eval-import-guard）

- 日期：2026-11-04
- 分支：`eval/ledger-facts-question`，基线 `39cff04`（worktree `D:\project\pwe-eval`）
- 修的是 [EVAL-BUG-1](../BUGS_FOUND.md)
- 实现：[world-client/src/world/memory/import-guard.ts](../../../world-client/src/world/memory/import-guard.ts)（闸本体），
  [runtime.ts](../../../world-client/src/world/memory/runtime.ts)（`fromSnapshot` 调用 + `lastImport` 报告），
  [eval-import-guard-support.ts](../../../world-client/test/eval-import-guard-support.ts)（探针），
  [memory-import-guard.test.ts](../../../world-client/test/memory-import-guard.test.ts)（回归）

## 命令与读数

| 命令 | 读数 | 退出码 |
| --- | --- | --- |
| `node world-client/scripts/eval-import-guard.ts --soak <save-90d.json> --out docs/evidence/eval-import-guard/import-guard.json` | 契约 **5/5**，41–62ms（含读 1.6MB 存档） | 0 |
| `node world-client/scripts/eval-import-guard.ts --guard-red` | 关闸后假记忆以 `witnessed` 复活 → RED | **1（设计如此）** |
| `node --import ./test/phaser-hooks.mjs --test test/memory-import-guard.test.ts` | 5/5，约 0.86s（含 Node 启动） | 0 |

## 两类悬空怎么分：判据是「有没有旁证」，不是「能不能解析」

事件被淘汰后 `eventRefs` 悬空**是设计允许的**。所以闸不写「witnessed 必须能解析到事件」，
而是问快照里**还有没有第二份记录**——事件被摄入时，记忆层同时写下：

| 旁证 | 写在哪 | 何时写 |
| --- | --- | --- |
| 断言 | `claims[].eventRefs` | `ingest` 里 `birthClaim(fact, …)`，一事一条 |
| 信念 | `beliefs[].eventRefs` | 谁信了这条断言 |
| 痕迹 | `traces[].entries[].eventRef` | 地点上的物证 |
| 传说 / 史诗 | `legends[].eventRefs` / `epics[].eventRefs` | 反复讲述后升格 |
| 成长记录 | `turningPoints[].eventRefs` | 信念反转 |
| 关系账本 | `bonds[].evidence` | 谁对谁做了什么 |
| 地标一生 | `landmarks[].phases[].causeEventRef` | 建 / 拆 / 改名 |
| 地名史 | `placeNames[].history[].fromEventRef` | 改名历史链 |

事实库（`facts`）会被淘汰，这些不会（隐私删除时级联摘引用，同时也会摘掉条目自己的引用，
即 `danglingRefs=0` 那条契约）。于是三类分得开：

| 情形 | 处置 | 报告字段 |
| --- | --- | --- |
| 引用在 `facts` 里 | 照常导入 | — |
| 引用不在 `facts`，但在任一旁证库里 | **放行**（历史淘汰，无法用事实库核实） | `prunedUnverifiable` |
| 引用在快照里一处旁证都没有 | **降级为 `heard`**（导入时编造） | `dowgradedEntries` |
| 条目形状坏（无 id / 无 `eventRefs` / `sourceMode` 不认识） | **拒绝**（丢弃） | `refusedEntries` |

没有「静默通过」这一档；也没有回调里的 try/catch 吞错。

## 三个数（90 天存档 vs 真 v5 样品）

| 存档 | witnessed before → after | 拒绝 | 降级 | 因淘汰无法用事实库核实 |
| --- | --- | --- | --- | --- |
| pwe-soak 的 90 天存档（319 条 / 71 条 witnessed） | **71 → 71** | **0** | **0** | **12** |
| `traces/outer-baseline-v5.json`（25 条 witnessed） | **25 → 25** | 0 | 0 | 0 |
| 注入 1 条 `witnessed` 假记忆（`eval-ghost-never-happened`） | 3 → 2 | 0 | **1** | 0 |

淘汰/编造的对照组：同一个假世界里删掉 `facts` 里的那条事实但**保留断言** → 仍是
`witnessed`（`prunedUnverifiable=2`）；再把断言/信念/痕迹/传说…全部清空 → 降级为
`heard`（`dowgradedEntries=2`，当天两条汇总记忆都指这条事件）。这说明判据不是
「只要有淘汰水位就放行」。

## 造错守卫（两边都跑）

- 闸开着（默认）：契约 5/5，退出 **0**。
- 关闸（`--guard-red`）：绕过 `MemoryRuntime` 直连 `world.restoreSnapshot`，同一假记忆
  `recalled=true`、`sourceMode=witnessed` → 断言红，退出 **1**。`guard-red.txt` 是原始输出。
- 即：把断言写松（关掉闸）必然红，写对（装着闸）必然绿。

## 来源与只读引用

- 90 天存档：pwe-soak 证据树，提交 **`3a41541ccaa7ce42dd432a6b8aa1caf40df0a673`**，
  路径 `<pwe-soak>/docs/evidence/soak/soak-a/save-90d.json`
  - sha256 **`ea68ad60c504032fca286316e5334db90a4fbc1215e86f83875e344a435c123a`**（1.6MB，未复制进本分支）
- 真 v5 样品：本分支 `world-client/traces/outer-baseline-v5.json`。
- 90 天存档来自比 `39cff04` 更新的 pwe-soak 树，快照多一个 `digests` 段；读档闸只读它认识的
  段，多余段不拦——这也是一条「跨版本迁移不拒档」的实测。

## 会误伤的真实场景（按任务要求写明）

1. **玩家手改存档**：把 `facts` 里某条事件删掉、留下记忆条目和断言 → 不降级（旁证还在）；
   若连断言一起删 → 条目降为 `heard`。内容不丢，只是不再自称亲历。
2. **未来的保留策略如果连断言/传说一起淘汰**：老事件的旁证没了，合法的 `witnessed` 会被
   降级（降级，不删除）。到时要么把淘汰水位写进快照，要么给断言的保留期加下限。
3. **跨版本迁移**：v1 档没有 `landmarks` / `bonds` 等段，迁移补空数组；闸对缺失段按空处理，
   不因此拒档。
4. **伪造「整份存档」的人**：如果他连 `claims`/`beliefs` 一起编，闸看不出——闸能挡的是
   「往合法存档里塞一条假亲历」这一类（原缺陷的现实形态）。这条限制写在这里，不假装没有。
