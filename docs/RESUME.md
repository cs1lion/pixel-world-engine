# 断点续跑

## 当前断点

- 最后 HEAD: `299bc8b` (`origin/main`)——**PR #47 已合入 main**（merge commit `299bc8b`）；
  本地分支 `feat/light-bake` 的 `9a77663` 已被包含，落后 main 一笔
- 合入后 main 的 push CI：run `43572850706` **四项全 success**（server / repo-harness / world-client / world-client-browser）
- 未提交改动: 只剩用户原有的四处改动；本单的作业已全部提交并推送：

```text
 M .githooks/pre-push
 M CLAUDE.md
 M docs/RESUME.md
 M docs/evidence/ENVIRONMENT_BUILDABILITY.md
?? .workbuddy/ 等未跟踪图片（用户原有，本单未碰）
```

- 已跑闸门: check ✅ 0/0 / test ✅ 2736 项（2727 pass、0 fail、9 skip）/ build ✅ /
  red:first ✅（合并后 base=355ec75，`PASS/RESULT=RED`）/ ports ✅ 0 处禁用端口 /
  palette ✅ / references ✅ 559 处 0 存疑 / citations ✅ 4444 处 0 未解析 /
  sections ✅ / claims ✅ markers=3、adr-schema 24/24 / audit:orphan-gates ✅ 0 未登记 /
  pytest ✅ / 评分器 ✅ 生产组 10/10 + 规格组 6/6
- 未跑/失败: 无。外环**跨日提议**仍未取证（`speed=1` 下一个世界日 = 24 小时现实时间），
  没有伪造读数。
- P1 评审 minor checks 已收口：最后一拍 await、读数冻在同一份快照、缓存上限回退为无脚注、
  虚拟世界钟、CSS 长文本兜底、ADR 行号改符号名；`test/creator-landing-hardening.test.ts` 8 条钉住。
- 下一步命令: `cd world-client && npm test && npm run check`

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
