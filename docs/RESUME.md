# 断点续跑

## 当前断点

- 最后 HEAD: `487b6e5`（`main`，PR #57「世界时间回溯 + Trajectory 因果分叉可观测性」已合入）；
  主仓已从 `chore/branch-hygiene` 切回 `main` 并快进到 `origin/main`（`487b6e5`）。
- 未提交改动: 无已跟踪改动（对齐时按「main 为准」丢弃了与 PR #57 重叠的原型 daycard 改动与
  旧 RESUME/WORKTREES 改动，均已备份到仓外 `../pwe-prerework-backup-20261116/`）；
  另有 15 个未跟踪图片/JSON 资产（原样保留，不入仓）。
- 已跑闸门: 本单收尾只改 `docs/`（RESUME / WORKTREES），未碰代码与测试；
  合入前 PR #57 的四项 CI（world-client / world-client-browser / repo-harness / server）已全绿（run 43848176559）。
- 未跑/失败: 无。
- 下一步命令: 已回收 `D:/project/pwe-rewind` 工作树并删本地 `feat/time-rewind-trajectory` 分支；
  `node scripts/worktrees-audit.mjs --strict` 确认 exit 0。

## time-rewind 工作树返工收口（`feat/time-rewind-trajectory`，PR #57）

- 2026-11-16 返工三处（用户审阅 PR #57 后指出）：
  1. **孤儿闸门**：删掉误带入的孤儿脚本 audit-reports（base 上不存在、未登记 allowlist）；
     本地 `audit-orphan-gates` 0 未登记。
  2. **red:first**：`TrajectoryRecorder`/`PrunableHistoryStore` 统一从基线已存在的
     `scene-history.ts`/`store.ts` 桶导出；测试只静态 import 这两个入口 + 存在性断言
     （`typeof === 'function'`），base 上红在 AssertionError（分类=assertion），不再 ERR_MODULE_NOT_FOUND。
  3. **评测与产品脱节**：删掉合成 rewind-controller（平行造假状态）；评测探针的回溯面全部委托
     `SandboxScene` 真实方法（`resetWorldForEval`/`advanceWorldToDay`/`historyRestoreToDay`/
     `injectCreatorBuildingForTest`），走真实 `SceneHistory`/`TrajectoryRecorder`/`Simulation`；
     `daycard-panel.ts` 真正挂载行内两段式回溯按钮（[回溯此日]→[确认回溯 Dxx]/[取消]）与
     `#daycard-note` 时光轨迹状态摘要，确认才调 `historyRestoreToDay`（真回滚），
     打开面板与 `dayCardProof()` 保持 100% 纯读。
- 附带修复：`patch.ts` 的 `keyFnFor` 认 `memory.world.*` 路径（真实快照多一层 world），
  否则 entries/facts 按下标对齐导致还原指纹漂移（保真度自证因此才 100% 吻合）。
- 真实 UI 验证（playwright）：D4 点「回溯此日」只展开确认（day 不变）→ 取消零变化 →
  确认后世界真回滚到 D2、beliefs 65→39、状态栏显示 branch-1 与「指纹 100% 吻合」。

## time-rewind 工作树 Phase 2 收口（`feat/time-rewind-trajectory`）

- 2026-11-16：Phase 1 红绿已定（`eval-rewind.mjs` 0/16 预期红灯 = 缺 `restoreWorldToDay`）；
  完成 Phase 2 两阶段落地——
  1. 存储/历史层：`store.ts` 加 `pruneAfter(day)`（`MemoryHistoryStore` 与 `IdbHistoryStore` 实现）、
     `scene-history.ts` 加 `restoreSave(day, fromDay)`（`doc.memory` 重新序列化填回 `save.world.memory`、重置 `previous` 差分基准，保原只读 `rewind` 契约），
     轨迹锚点与保真度自证由 `trajectory-recorder.ts` 承载；
  2. 场景/UI 层：`SandboxScene.historyRestoreToDay(day)`（恢复 Simulation、MemoryRuntime 与 SaveStore，联动神谕光柱+钟声）、
     `daycard-panel.ts` 挂 `attachDayCardRewindAction` 两段式按钮 + `#daycard-note` 轨迹分支状态栏（不动 `dayCardProof` 纯读校验）、
     评测驱动全部走场景真实世界（`resetWorldForEval`/`advanceWorldToDay`/`historyRestoreToDay`）、`sensory-probe.ts` 委托回溯方法。
- 防假绿：5 项单测（EDD 防假绿 1–5）全绿；16 道闸门全绿；`eval-rewind.mjs` 16/16 全绿。
- 细节与口径：轨迹账本/保真度/反事实对比、影子段归档、`compareBranches` 见 `src/world/history/trajectory-recorder.ts`；
  历史层改动见 `src/world/history/scene-history.ts`、`store.ts`；UI 接入见 `src/scenes/SandboxScene.ts`、`daycard-panel.ts`、`sensory-probe.ts`。

**P1 已开工并落地一小步**（2026-11-14）：核实时发现 P1 的主体**main 已经做过**——

- 2026-11-15：red:first 落盘后完成增量实现（行为规则 rain-shelter、fx-layer 金色光柱+2 拍行礼、
  animalese 7 人声线、sfx 零外部素材+无头降级、debug-bridge 接入评测探针）并逐项修类型/口径；
  因 phase 纯净规则（world 内核不 import 上层），感官评测面整体收进上层 `src/ui/sensory-probe.ts`，
  world 桥只保留造物命令与存档读法，探针委托桥透传其余方法。
- 无建筑回退（H2）：新增 `src/settings/empty-map/` 空景设定集（7 位村民、0 建筑落点，复用莞尔镇网格与 24 色、
  `sites` 置空以避开建筑锚），`selectSetting` 注册 `world=empty-map`；`eval-sensory.mjs` 在 held-out 的 H2
  先切到该世界再评测，确保「无建筑回退」是真实命中而非空指针假绿。
- 全量验收：`eval-sensory.mjs` 16/16；`npm test` 2749 项全绿；17 道 CI 闸门全绿。
- 细节与口径见 `docs/iterations/` 对应迭代记录（如已建）；工作树改动见上方「未提交改动」。

**P1 已开工并落地一小步**（2026-11-14）：核实时发现 P1 的主体**main 已经做过**——
`SandboxScene.recordUnplannedLanding` 早就把神谕/世界入口的落地也跑业务规则并写进造物账本，
且不喂外环门禁；`ADR_SCHEMA_PASS_RATE_SEMANTICS` 也已定过口径。
真正缺的是**无头回放没有对应实现**：`TraceRuntime.settleLanding` 在 pending 里找不到就直接 return，
于是同一段轨迹在浏览器与回放里账本不同口径。
本笔补了 `settleUnplannedLanding` 与 `test/creator-landing-parity.test.ts`（3 条，先红后绿），
并写了 `docs/adr/ADR_LANDING_AUDIT_PARITY.md`（用户选「只记世界层账」）。
**P1 读侧也已落地**：`src/world/landing-readout.ts`（纯函数：来源分列、违规说出来、没记录就不写）
接进了两处——`composeReport(snapshot, landings)` 的日报一行（短讯上限 4→5），
和 `BuildingPanelView.landing` 的楼面板脚注（「外环提的；落地检查通过」）。
会话内缓存 `landingEntries` 只服务读侧，持久真相仍是服务端 JSONL 账本。

## 合并 main 之后的两处前提变更（都已处理）

1. **行号引用漂移**：main 新加的 `ADR_SCHEMA_PASS_RATE_SEMANTICS` 按 main 的行号引
   `SandboxScene.ts`，而本分支删了 12 行，`2240` 落进空行。五处引用逐条按函数重新对位，
   并在 ADR 里写明「数字以合并后的分支为准，复核靠 grep 不靠表格」。
2. **K2 口径**：main 的绘制管线会加载 `public/assets/**`（设定集素材、角色图标），
   「整页零外部图片请求」已不可能成立。改成「造物不新增图片请求」，基线取页面加载完那一刻；
   要守的不变量没变——楼与脚手架都是程序化烘焙。

另外：main 的 `ADR_SAVE_AUTONOMY_PERSIST` 已把外环自治状态做成 `world.autonomy` 并升 v7
（现为 v8），**A2 由 main 解决**，不由本项目解决；本项目的审计侧车只服务评测面。

## 本单三笔提交

| 笔 | sha | 内容 |
| --- | --- | --- |
| 1 | `8487ab7` | EDD 评测面：两份数据集、评分器、防假绿自检。单独检出跑评分器是 0/10 与 0/6 |
| 2 | `f7acc77` | 内环实现 + 内核单测 + 外部材料收存（P0 收敛时删改了其中三份平行实现） |
| 3 | `1ed63c8` | P0 收敛：删三套平行实现，桥降为生产存档字节的只读适配器，评测按 production/spec 分组 |

之后两笔是同步 main（`fbd8c71` 合并提交、`1494a73` 对位与口径修正）。

P0 的细节与三处口径变更见 `docs/iterations/1113-task-3/README.md`。
Godot 迁移同日被叫停：未建目录、未改引擎、未落 ADR。

## 中断前：覆盖写「当前断点」

在本文件顶部维护一节 `## 当前断点`（覆盖写，不追加历史；历史看 `git log`）。
最少五项，缺一项就等于没记录：

```markdown
## 当前断点

- 最后 HEAD: <sha> (<branch>)
- 未提交改动: <`git status --short` 的原文；没有就写「无」>
- 已跑闸门: check ✅ / test ✅ / build ✅ / palette ✅ / references ✅ / citations ✅ / sections ✅ / claims ✅ / pytest ✅
  （只勾真的跑过的；没跑写「未跑」，跑失败写「失败 + 首行读数」）
- 未跑/失败: <列出闸门名与原因；没有就写「无」>
- 下一步命令: <一条可直接粘贴的命令>
```

写法约束：

- **只写事实**。「应该没问题」「大概过了」不算读数，等于没跑。
- 读数贴**输出首行**（例如 `claims: markers=2 passed=2 failed=0`），不贴想象值。
- 未提交改动直接抄 `git status --short`，不要概括成「改了一些文件」。
- 下一步必须是**一条命令**，不是一句目标。目标是 `docs/` 里的事，命令是恢复入口。

## 恢复时：按顺序核对

```bash
git status --short --branch
git log -1 --format='%H %d %s'
git diff --stat
git stash list
```

- `git status` 告诉你断点记录之后有没有新改动；和「未提交改动」不一致时，
  **以工作区为准**，先看 `git diff` 再决定。
- `git log -1` 核对「最后 HEAD」。对不上说明中断后还有提交；用
  `git log --oneline <记录的 sha>..HEAD` 看多出来的部分。
- 已跑闸门不自动可信：环境、依赖、文件都可能变。**只重跑记录之后改动过的闸门**；
  记录里没写「已跑」的一律补跑。

九道闸门与 CI 对应关系见 `CLAUDE.md` 的「九道闸门」一节。最短恢复路径：

```bash
cd world-client && npm run check && npm test && npm run build
cd world-client && node scripts/audit-palette.mjs --strict
cd world-client && node scripts/audit-references.ts --strict && node scripts/audit-citations.ts --strict && node scripts/audit-sections.ts --strict && node scripts/audit-claims.ts --strict
cd server && python -m pytest
```

并行 worktree 造成的「改了但不是我这棵树」问题，用 `npm run worktrees:audit`
和 `docs/WORKTREES.md` 核对归属；不要靠猜分支。

### 浏览器闸门必须显式指定本 worktree 的端口

四道默认读 `PIXEL_WORLD_URL` 的闸门（`test:browser` smoke / `test:phases` /
`test:render-budget` / `test:persistence`）与只读 `PWE_URL` 的 `test:interact`，
不指定端口时都打 `5188`——而 `5188` 常常是另一个 worktree 的实例在跑。
2026-11-04 已因此产生两次假红：一次 8 项假红（读数来自别人的世界），
一次 `preCoverHabit is not a function`（对面构建比本树旧）。合并验收时：

```powershell
cd world-client; npm run build   # preview 服务的是 dist，先构建
$env:PIXEL_WORLD_URL="http://127.0.0.1:5190/"
$env:PWE_URL="http://127.0.0.1:5190/"
# preview 必须与闸门在同一次 shell 调用里起，调用结束就杀；换一棵树就换一个端口
```

回执里写清用的是哪个 URL——否则「红」到底是代码还是串台说不清。
`EVAL_OUT` 指向 `world-client/tmp/eval-*`，跑完 `git restore world-client/eval/screens`。

## 与提交的关系

- 断点记录本身可以提交（它就是仓库手续的一部分），但**不要求在每次中断都提交**；
  工作区里的记录同样有效，恢复时先读它。
- 如果中断时正在一个未提交的实验上，先 `git stash push -m '<一句话>'`，
  再把 stash 名写进「未提交改动」；直接丢工作区会让下一个人无法判断哪些是半成品。
